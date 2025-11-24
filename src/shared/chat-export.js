/**
 * One chat, out as a file: Markdown to read, JSON to keep.
 *
 * Modelled on src/shared/bookmarks.js's buildExport — one versioned JSON
 * shape and one readable one. Markdown is a reading format and gets the path
 * the page was showing, top to bottom; the whole tree, every branch, is what
 * the JSON is for.
 *
 * Three things are done to the Markdown on the way out, each for a reason:
 *
 *   - Code keeps its fence and its language, and the fence is longer than
 *     any run of backticks inside it (ChatTree.fence), so an answer that
 *     quotes a Markdown file exports as one block.
 *   - ChatGPT writes maths as \( \) and \[ \]. With `dollars` on those become
 *     $ and $$, which Obsidian and GitHub render — but never inside code: a
 *     regex answer is full of \( and it must come out exactly as it went in.
 *   - Citations are footnotes, numbered through the whole file.
 *
 * Tables are Markdown already and pass through untouched. Pure, node-tested.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const ChatTree = ns.ChatTree || req('./chat-tree.js');
    const ChatSites = ns.ChatSites || req('./chat-sites.js');

    const TYPE = 'bell-bearer-chat';
    const VERSION = 1;
    const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

    /**
     * Markdown as runs of prose and code, so a rewrite can be applied to one
     * and not the other. Fenced blocks are code; within prose, so are inline
     * code spans.
     */
    function segments(markdown) {
        const out = [];
        const push = (code, text) => {
            const last = out[out.length - 1];
            if (last && last.code === code) last.text += text;
            else out.push({ code, text });
        };
        let open = null;
        const lines = String(markdown || '').split('\n');
        lines.forEach((line, index) => {
            const text = index < lines.length - 1 ? `${line}\n` : line;
            const mark = FENCE_OPEN.exec(line);
            if (open) {
                if (mark && mark[1][0] === open[0] && mark[1].length >= open.length && !line.slice(mark[0].length).trim()) open = null;
                push(true, text);
                return;
            }
            if (mark) {
                open = mark[1];
                push(true, text);
                return;
            }
            // Inline code spans: a run of backticks closed by the same run.
            let at = 0;
            for (const span of text.matchAll(/(`+)[^`]*?\1/g)) {
                push(false, text.slice(at, span.index));
                push(true, span[0]);
                at = span.index + span[0].length;
            }
            push(false, text.slice(at));
        });
        return out.filter((segment) => segment.text);
    }

    /** Rewrite the prose of `markdown` and leave every piece of code alone. */
    const inProse = (markdown, rewrite) => segments(markdown)
        .map((segment) => (segment.code ? segment.text : rewrite(segment.text))).join('');

    /** \[ … \] → $$ … $$ and \( … \) → $…$, outside code. */
    function toDollars(markdown) {
        return inProse(markdown, (prose) => prose
            .replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => `$$${body}$$`)
            .replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => `$${body.trim()}$`));
    }

    const iso = (ms) => (ms ? new Date(ms).toISOString() : '');

    /** Front matter values as YAML double-quoted strings, which JSON strings are. */
    const yaml = (value) => JSON.stringify(String(value || ''));

    // ----------------------------------------------------------- artifacts

    /** A document's type as the language its fence is labelled with. */
    const ARTIFACT_LANGS = Object.freeze({
        'text/markdown': 'markdown',
        'text/html': 'html',
        'application/vnd.ant.react': 'jsx',
        'image/svg+xml': 'svg',
        'application/vnd.ant.mermaid': 'mermaid',
    });

    /**
     * The documents a chat wrote and rewrote — Claude's artifacts — replayed
     * along `path` into each one's final text, in the order they were made.
     *
     * An artifact is not a message; it is a document the messages edit.
     * `create` and `rewrite` set its text, `update` swaps one passage for
     * another. An update whose passage is not there marks the document
     * *stale* and changes nothing, rather than guessing where the edit went.
     * An artifact edited only on a branch the page is not showing is not
     * replayed at all: it is not part of the chat being exported.
     */
    function artifacts(conv, path = ChatTree.activePath(conv)) {
        const byId = new Map();
        for (const turnId of path) {
            for (const block of conv.nodes[turnId].blocks) {
                if (block.kind !== 'artifact' || !block.id) continue;
                let doc = byId.get(block.id);
                if (!doc) {
                    doc = { id: block.id, title: '', type: '', language: '', content: '', stale: false, lastTurn: turnId, turns: [] };
                    byId.set(block.id, doc);
                }
                if (block.title) doc.title = block.title;
                if (block.type) doc.type = block.type;
                if (block.language) doc.language = block.language;
                if (block.command === 'update') {
                    const at = block.old ? doc.content.indexOf(block.old) : -1;
                    if (at < 0) doc.stale = true;
                    else doc.content = doc.content.slice(0, at) + block.new + doc.content.slice(at + block.old.length);
                } else {
                    doc.content = block.content;
                }
                doc.lastTurn = turnId;
                if (!doc.turns.includes(turnId)) doc.turns.push(turnId);
            }
        }
        return [...byId.values()].map((doc) => ({
            ...doc,
            title: doc.title || 'Untitled artifact',
            language: ARTIFACT_LANGS[doc.type] || doc.language || '',
        }));
    }

    /** A document in full: its title, and its text in a fence long enough to hold it. */
    const artifactMarkdown = (doc) => `### ${doc.title}\n\n${ChatTree.fence(doc.content, doc.language)}${
        doc.stale ? '\n\n*(an edit to this could not be applied, so it may be out of date)*' : ''}`;

    /**
     * One turn's Markdown from its blocks — or its text, for a node that has
     * none. `docs` is the chat's replayed artifacts: each is printed in full
     * once, after the turn that last touched it, and every earlier touch is a
     * line pointing at that — so the file reads top to bottom without the
     * same three-hundred-line component printed five times.
     */
    function turnMarkdown(turn, { thinking, docs = [] }) {
        if (!turn.blocks.length) return turn.text;
        const parts = [];
        const recap = turn.blocks.filter((b) => b.kind === 'thinking' && b.recap).map((b) => b.text)[0] || 'Thinking';
        const thoughts = turn.blocks.filter((b) => b.kind === 'thinking' && !b.recap).map((b) => b.text).join('\n\n');
        let thought = false;
        for (const block of turn.blocks) {
            if (block.kind === 'text') parts.push(block.text);
            else if (block.kind === 'code') parts.push(ChatTree.fence(block.text, block.lang));
            else if (block.kind === 'output') parts.push(ChatTree.fence(block.text, 'output'));
            else if (block.kind === 'image') parts.push('[image]');
            else if (block.kind === 'tool') parts.push(`*${block.text}*`);
            else if (block.kind === 'file') parts.push(`[file: ${block.name}]`);
            else if (block.kind === 'attachment') {
                // Pasted text is part of what the answer was answering — in a
                // debugging chat, usually the log — so it is kept, folded.
                parts.push(`<details><summary>${block.name}</summary>\n\n${ChatTree.fence(block.text)}\n\n</details>`);
            } else if (block.kind === 'artifact') {
                const doc = docs.find((one) => one.id === block.id);
                const said = doc && doc.lastTurn !== turn.id ? `*(${block.command === 'create' ? 'wrote' : 'updated'} "${doc.title}" — final version below)*` : '';
                if (said && !parts.includes(said)) parts.push(said);
            }
            else if (block.kind === 'thinking' && thinking && thoughts && !thought) {
                thought = true;
                parts.push(`<details><summary>${recap}</summary>\n\n${thoughts}\n\n</details>`);
            }
        }
        for (const doc of docs) if (doc.lastTurn === turn.id) parts.push(artifactMarkdown(doc));
        return parts.filter(Boolean).join('\n\n');
    }

    /**
     * The chat as Markdown: front matter, then `## You` and the site's own
     * name for the other side, turn by turn along `path`.
     */
    function markdown(conv, { dollars = true, thinking = false, path = ChatTree.activePath(conv), now = Date.now() } = {}) {
        const site = ChatSites.get(conv.site);
        const speaker = site ? site.speaker : 'Assistant';
        const models = [...new Set(path.map((id) => conv.nodes[id].model).filter(Boolean))];
        const docs = artifacts(conv, path);
        const notes = [];
        const byUrl = new Map();

        const body = path.map((id) => {
            const turn = conv.nodes[id];
            let text = turnMarkdown(turn, { thinking, docs });
            // The turn numbers its own footnotes from 1; the file numbers them
            // once, and a source cited twice is one footnote.
            if (turn.cites.length) {
                const local = new Map();
                for (const cite of turn.cites) {
                    if (!byUrl.has(cite.url)) {
                        byUrl.set(cite.url, byUrl.size + 1);
                        notes.push(`[^${byUrl.size}]: [${cite.title.replace(/[[\]]/g, '')}](${cite.url})`);
                    }
                    local.set(String(cite.n), byUrl.get(cite.url));
                }
                text = inProse(text, (prose) => prose.replace(/\[\^(\d+)\]/g, (whole, n) => (local.has(n) ? `[^${local.get(n)}]` : whole)));
            }
            if (dollars) text = toDollars(text);
            return `## ${turn.role === 'user' ? 'You' : speaker}\n\n${text.trim()}`;
        });

        const front = [
            '---',
            `title: ${yaml(conv.title)}`,
            `site: ${site ? site.name : conv.site}`,
            conv.url ? `url: ${conv.url}` : '',
            conv.createdAt ? `created: ${iso(conv.createdAt)}` : '',
            conv.updatedAt ? `updated: ${iso(conv.updatedAt)}` : '',
            models.length ? `models: ${JSON.stringify(models)}` : '',
            `exported: ${iso(now)}`,
            '---',
        ].filter(Boolean).join('\n');

        return `${front}\n\n# ${conv.title}\n\n${body.join('\n\n')}\n${notes.length ? `\n${notes.join('\n')}\n` : ''}`;
    }

    /**
     * The chat as JSON. `branches: 'all'` keeps every node; 'active' only the
     * path shown. `raw` is the site's own answer, kept whole if asked for.
     */
    function json(conv, { branches = 'active', raw = null, now = Date.now() } = {}) {
        const path = ChatTree.activePath(conv);
        const keep = branches === 'all' ? Object.keys(conv.nodes) : [conv.root, ...path];
        const nodes = {};
        for (const id of keep) {
            const node = conv.nodes[id];
            if (!node) continue;
            nodes[id] = branches === 'all' ? node : { ...node, children: node.children.filter((child) => keep.includes(child)) };
        }
        const out = {
            type: TYPE, version: VERSION, exportedAt: iso(now),
            site: conv.site, id: conv.id, title: conv.title, url: conv.url,
            createdAt: conv.createdAt, updatedAt: conv.updatedAt,
            root: conv.root, current: conv.current, path, branches, nodes,
        };
        const docs = artifacts(conv, path);
        if (docs.length) out.artifacts = docs.map(({ id, title, type, language, content, stale }) => ({ id, title, type, language, content, stale }));
        if (raw) out.raw = raw;
        return out;
    }

    /**
     * `2025-11-09 Fix the flaky test.md`. Stripped of what Windows refuses in
     * a name and of trailing dots and spaces, which it silently drops and
     * then cannot find the file under, and capped at 120 characters.
     */
    function fileName(conv, ext, { now = Date.now() } = {}) {
        const at = new Date(conv.createdAt || now);
        const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
        const suffix = `.${ext}`;
        const title = String(conv.title || 'chat')
            .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const stem = `${day} ${title}`.slice(0, 120 - suffix.length).replace(/[. ]+$/, '');
        return `${stem || day}${suffix}`;
    }

    const ChatExport = { TYPE, VERSION, segments, toDollars, markdown, json, fileName, artifacts, fence: ChatTree.fence };

    root.BB = root.BB || {};
    root.BB.ChatExport = ChatExport;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatExport;
})(typeof globalThis !== 'undefined' ? globalThis : this);
