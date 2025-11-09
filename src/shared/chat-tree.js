/**
 * The conversation, as every chat module sees it: a tree of turns, whichever
 * site it came from.
 *
 * Both sites keep a tree. Editing a prompt or asking for another answer does
 * not replace anything — it starts a sibling, and the page shows one path
 * through the tree with a `< 2/3 >` where it splits. Each site's format module
 * (src/shared/chatgpt-format.js) turns that site's raw shape into this one,
 * and nothing past it knows what the raw shape was:
 *
 *   { site, id, title, url, createdAt, updatedAt, root, current,
 *     nodes: { [id]: { id, parent, children, role, text, blocks, ids, model, at, cites } } }
 *
 * A node is a *turn*, not a raw message. An answer that searched the web is
 * four or five raw messages on ChatGPT and one turn on the page, and the page
 * is what the outline, the pins and the tree have to agree with. `ids` lists
 * every raw id a turn spans, for matching against what the page draws.
 *
 * `root` is a node of its own, role 'root', never drawn. It exists because
 * the *first* prompt can be edited too, and then it has siblings, which need
 * a parent to be siblings under.
 *
 * Pure: node-tested, and loaded by the content script only.
 */
(function (root) {
    'use strict';

    const ROLES = Object.freeze(['user', 'assistant']);

    const asArray = (value) => (Array.isArray(value) ? value : []);

    /** A node with every field present, whatever the format module left out. */
    function makeNode(fields) {
        return {
            id: String(fields.id),
            parent: fields.parent == null ? null : String(fields.parent),
            children: asArray(fields.children).map(String),
            role: fields.role === 'root' || ROLES.includes(fields.role) ? fields.role : 'assistant',
            text: String(fields.text || ''),
            blocks: asArray(fields.blocks),
            ids: asArray(fields.ids).length ? asArray(fields.ids).map(String) : [String(fields.id)],
            model: String(fields.model || ''),
            at: Number(fields.at) || 0,
            cites: asArray(fields.cites),
        };
    }

    /**
     * Assemble a conversation, dropping any child that names a node that is
     * not there. A dangling id in `children` is a crash in every walk below,
     * and it is what a half-written raw tree hands over.
     */
    function build({ site, id, title, url, createdAt, updatedAt, root: rootId, current, nodes }) {
        const out = {};
        for (const [key, fields] of Object.entries(nodes || {})) out[key] = makeNode({ id: key, ...fields });
        for (const node of Object.values(out)) node.children = node.children.filter((child) => out[child]);
        return {
            site: String(site || ''),
            id: String(id || ''),
            title: String(title || '').trim() || 'Untitled chat',
            url: String(url || ''),
            createdAt: Number(createdAt) || 0,
            updatedAt: Number(updatedAt) || 0,
            root: rootId,
            current: out[current] ? current : null,
            nodes: out,
        };
    }

    const node = (conv, id) => (conv && conv.nodes && conv.nodes[id]) || null;

    /** The ids from the first turn down to `id`, without the root. */
    function pathTo(conv, id) {
        const out = [];
        const seen = new Set();
        for (let at = node(conv, id); at && at.role !== 'root' && !seen.has(at.id); at = node(conv, at.parent)) {
            seen.add(at.id);
            out.unshift(at.id);
        }
        return out;
    }

    /** The newest child at every step down from `id`: where a branch ends up. */
    function leafUnder(conv, id) {
        let at = node(conv, id);
        while (at && at.children.length) {
            const kids = at.children.map((child) => node(conv, child));
            at = kids.reduce((best, kid) => (kid.at >= best.at ? kid : best));
        }
        return at ? at.id : null;
    }

    /** The path the page is showing. */
    function activePath(conv) {
        const leaf = node(conv, conv.current) ? conv.current : leafUnder(conv, conv.root);
        return pathTo(conv, leaf);
    }

    /** Every node that has more than one child — every `< k/n >` on the page. */
    function forks(conv) {
        return Object.values((conv && conv.nodes) || {}).filter((n) => n.children.length > 1).map((n) => n.id);
    }

    /** Where a node sits among its siblings, 1-based — the page's `2/3`. */
    function siblingIndex(conv, id) {
        const parent = node(conv, (node(conv, id) || {}).parent);
        if (!parent) return { index: 1, count: 1 };
        return { index: parent.children.indexOf(id) + 1, count: parent.children.length };
    }

    /** Which turn a raw id the page drew belongs to, or null for one we do not know. */
    const byRaw = new WeakMap();
    function turnOf(conv, rawId) {
        if (!conv) return null;
        let map = byRaw.get(conv);
        if (!map) {
            map = new Map();
            for (const n of Object.values(conv.nodes)) n.ids.forEach((raw) => map.set(raw, n.id));
            byRaw.set(conv, map);
        }
        return map.get(String(rawId)) || null;
    }

    // ----------------------------------------------------------- markdown

    const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

    /**
     * The lines of `text` that are not inside a code fence, each with its
     * line number. A `#` in a shell script is a comment, not a heading, and a
     * Python answer is full of them — this is the one thing the outline must
     * not get wrong.
     */
    function proseLines(text) {
        const out = [];
        let open = null;
        String(text || '').split('\n').forEach((line, at) => {
            const mark = FENCE_OPEN.exec(line);
            if (open) {
                const closes = mark && mark[1][0] === open[0] && mark[1].length >= open.length &&
                    !line.slice(mark[0].length).trim();
                if (closes) open = null;
                return;
            }
            if (mark) { open = mark[1]; return; }
            out.push({ line, at });
        });
        return out;
    }

    /** `#`–`###` headings, outside fences, as { level, text }. */
    function headings(text) {
        const out = [];
        for (const { line } of proseLines(text)) {
            const match = /^ {0,3}(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
            if (match) out.push({ level: match[1].length, text: match[2].replace(/[*_`]/g, '').trim() });
        }
        return out;
    }

    /** The first non-empty line, cut to `cap` characters on a word. */
    function firstLine(text, cap = 80) {
        const line = (String(text || '').split('\n').find((l) => l.trim()) || '').trim().replace(/\s+/g, ' ');
        if (line.length <= cap) return line;
        const cut = line.slice(0, cap - 1);
        const space = cut.lastIndexOf(' ');
        return `${(space > cap * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
    }

    /**
     * A code block that survives its own contents: the fence is one backtick
     * longer than the longest run inside. An answer that quotes a Markdown
     * file with a fence in it otherwise closes the export's fence halfway
     * through, and the rest of the file renders as prose.
     */
    function fence(text, lang = '') {
        const body = String(text == null ? '' : text).replace(/\n+$/, '');
        const longest = (body.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
        const ticks = '`'.repeat(Math.max(3, longest + 1));
        return `${ticks}${String(lang || '').trim()}\n${body}\n${ticks}`;
    }

    /**
     * The table of contents of a path: every prompt, by its first line, and
     * every heading an answer wrote, under it.
     */
    function outline(conv, path = activePath(conv)) {
        const out = [];
        for (const id of path) {
            const turn = node(conv, id);
            if (!turn) continue;
            if (turn.role === 'user') {
                out.push({ id, level: 0, text: firstLine(turn.text) || '(empty prompt)' });
            } else {
                headings(turn.text).forEach((h) => out.push({ id, level: h.level, text: h.text, heading: h.text }));
            }
        }
        return out;
    }

    const ChatTree = {
        ROLES, makeNode, build, node, pathTo, leafUnder, activePath, forks, siblingIndex, turnOf,
        proseLines, headings, firstLine, fence, outline,
    };

    root.BB = root.BB || {};
    root.BB.ChatTree = ChatTree;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatTree;
})(typeof globalThis !== 'undefined' ? globalThis : this);
