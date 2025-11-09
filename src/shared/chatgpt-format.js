/**
 * ChatGPT's conversation, read into the shape src/shared/chat-tree.js
 * describes. The only file that knows what `backend-api/conversation/<id>`
 * hands back; everything past normalize() works on the tree.
 *
 * The raw shape is a `mapping` of messages by id, each naming its parent and
 * children, and a `current_node` for the leaf the page is showing. Three
 * things in it are not what the page draws, and all three are folded here:
 *
 *   - A synthetic root with no message, and under it system messages and the
 *     user's custom instructions, all hidden. They pass straight through: a
 *     turn under one is a turn under whatever was above it.
 *   - An answer that used a tool is a chain — the call, the tool's reply, the
 *     reasoning, the text — and the page draws the chain as one turn. It is
 *     one node here too, whose id is the chain's *first* raw id, because that
 *     is the id a regenerate makes a sibling of. `ids` keeps all of them: the
 *     page marks the turn with a later one.
 *   - Answers that searched carry private-use markers where each citation
 *     goes. They become footnotes, and anything left over is removed — an
 *     export must never contain a character that renders as a box.
 *
 * Pure, and node-tested against a fixture built to that shape.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const ChatTree = ns.ChatTree || req('./chat-tree.js');
    const ChatSites = ns.ChatSites || req('./chat-sites.js');

    /** The private-use block ChatGPT's citation markers are written in. */
    const PRIVATE_USE = /[-]/g;
    /** One marker:  cite  turn0search3 , or a run of several. */
    const MARKER = /[^]*/g;

    /** Seconds (the conversation), ISO (the list) or milliseconds, as milliseconds. */
    function toMs(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? Math.round(value * 1000) : value;
        const parsed = Date.parse(String(value || ''));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    const roleOf = (message) => (message && message.author && message.author.role) || '';
    const typeOf = (message) => (message && message.content && message.content.content_type) || '';

    /** Is this a message the page draws at all? */
    function visible(message) {
        const role = roleOf(message);
        if (!['user', 'assistant', 'tool'].includes(role)) return false;
        if (message.metadata && message.metadata.is_visually_hidden_from_conversation) return false;
        return !/_editable_context$/.test(typeOf(message));
    }

    /**
     * What a tool call was, in one line: the query a search ran, the image
     * asked for. Tools whose input is code are drawn as code instead.
     */
    function toolLine(recipient, input) {
        let parsed = null;
        try { parsed = JSON.parse(input); } catch (_) { /* a bare string query */ }
        if (/^(web|browser)/.test(recipient)) {
            const queries = parsed && (parsed.search_query || parsed.queries || parsed.query);
            const first = Array.isArray(queries) ? (queries[0] && (queries[0].q || queries[0])) : queries;
            const quoted = /search\("([^"]+)"\)/.exec(String(input || ''));
            const query = String(first || (quoted && quoted[1]) || '').trim();
            return query ? `Searched the web: "${query}"` : 'Searched the web';
        }
        if (/^dalle|image_gen/.test(recipient)) return 'Made an image';
        if (/^canmore/.test(recipient)) {
            const name = parsed && (parsed.name || parsed.title);
            return name ? `Wrote a canvas: "${name}"` : 'Edited a canvas';
        }
        return `Used ${recipient}`;
    }

    /** One raw message as the blocks it contributes to its turn. */
    function blocksOf(message) {
        const content = message.content || {};
        const role = roleOf(message);
        const recipient = message.recipient || 'all';
        const strings = (parts) => (Array.isArray(parts) ? parts : []).filter((p) => typeof p === 'string').join('\n');

        switch (typeOf(message)) {
            case 'text': {
                const text = strings(content.parts);
                if (role === 'assistant' && recipient !== 'all') return [{ kind: 'tool', text: toolLine(recipient, text) }];
                // A tool's own reply is what the next message is written
                // from, and the page never shows it.
                if (role === 'tool' || !text.trim()) return [];
                return [{ kind: 'text', text }];
            }
            case 'multimodal_text':
                return (content.parts || []).map((part) => {
                    if (typeof part === 'string') return part.trim() ? { kind: 'text', text: part } : null;
                    if (part && /image/.test(part.content_type || '')) return { kind: 'image' };
                    if (part && part.content_type === 'audio_transcription' && part.text) return { kind: 'text', text: part.text };
                    return null;
                }).filter(Boolean);
            case 'code': {
                const lang = content.language && content.language !== 'unknown' ? content.language : '';
                if (role === 'assistant' && recipient !== 'all' && recipient !== 'python') {
                    return [{ kind: 'tool', text: toolLine(recipient, content.text) }];
                }
                return content.text ? [{ kind: 'code', lang: recipient === 'python' ? 'python' : lang, text: content.text }] : [];
            }
            case 'execution_output':
                return content.text ? [{ kind: 'output', text: content.text }] : [];
            case 'thoughts': {
                const text = (content.thoughts || []).map((thought) => [
                    thought.summary ? `**${thought.summary}**` : '', thought.content || '',
                ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
                return text ? [{ kind: 'thinking', text }] : [];
            }
            case 'reasoning_recap':
                return content.content ? [{ kind: 'thinking', text: String(content.content), recap: true }] : [];
            case 'system_error':
                return [{ kind: 'tool', text: `Error: ${content.text || content.name || 'the tool failed'}` }];
            default:
                return [];
        }
    }

    /**
     * Swap each citation marker for footnote references, numbered within the
     * message's turn, and drop everything that is not one. `cites` is the
     * turn's list so far; it is extended in place.
     */
    function citeText(text, references, cites) {
        let out = String(text || '');
        for (const ref of Array.isArray(references) ? references : []) {
            if (!ref || !ref.matched_text) continue;
            const sources = (Array.isArray(ref.items) && ref.items.length ? ref.items : [ref])
                .filter((item) => item && /^https?:/.test(item.url || ''));
            const marks = sources.map((item) => {
                let cite = cites.find((known) => known.url === item.url);
                if (!cite) {
                    cite = { n: cites.length + 1, title: String(item.title || item.attribution || item.url), url: item.url };
                    cites.push(cite);
                }
                return `[^${cite.n}]`;
            });
            out = out.split(ref.matched_text).join(marks.join(''));
        }
        return out.replace(MARKER, '').replace(PRIVATE_USE, '');
    }

    /** The turn's readable Markdown: what an answer says, not how it got there. */
    function textOf(blocks) {
        return blocks.map((block) => {
            if (block.kind === 'text') return block.text;
            if (block.kind === 'code') return ChatTree.fence(block.text, block.lang);
            if (block.kind === 'output') return ChatTree.fence(block.text, 'output');
            if (block.kind === 'image') return '[image]';
            return null;
        }).filter((part) => part != null && part !== '').join('\n\n');
    }

    function normalize(raw) {
        const mapping = (raw && raw.mapping) || {};
        const id = String((raw && (raw.conversation_id || raw.id)) || '');
        const rootRaw = Object.keys(mapping).find((key) => !mapping[key].parent || !mapping[mapping[key].parent]);

        const turns = {};
        const turnOfRaw = {};
        if (rootRaw) {
            turns[rootRaw] = { role: 'root', parent: null, children: [], messages: [], ids: [rootRaw] };
            turnOfRaw[rootRaw] = rootRaw;
        }

        const open = (rawId, role, parent) => {
            turns[rawId] = { role, parent, children: [], messages: [], ids: [] };
            turns[parent].children.push(rawId);
            return rawId;
        };

        // Depth first, each node's children in the order the raw tree lists
        // them — which is the order the page numbers siblings in.
        const stack = rootRaw ? [...(mapping[rootRaw].children || [])].reverse().map((child) => [child, rootRaw]) : [];
        while (stack.length) {
            const [rawId, parentRaw] = stack.pop();
            const rawNode = mapping[rawId];
            if (!rawNode || turnOfRaw[rawId]) continue;
            const message = rawNode.message;
            const above = turnOfRaw[parentRaw];

            let turn = above;
            if (visible(message)) {
                const role = roleOf(message) === 'user' ? 'user' : 'assistant';
                // An assistant or tool message carries on the answer above it
                // unless that is where a regenerate forked, or there is no
                // answer above it to carry on.
                const carries = role === 'assistant' && turns[above].role === 'assistant' &&
                    (mapping[parentRaw].children || []).length === 1;
                turn = carries ? above : open(rawId, role, above);
                turns[turn].messages.push(message);
                turns[turn].ids.push(rawId);
            }
            turnOfRaw[rawId] = turn;
            [...(rawNode.children || [])].reverse().forEach((child) => stack.push([child, rawId]));
        }

        const nodes = {};
        for (const [turnId, turn] of Object.entries(turns)) {
            const cites = [];
            const blocks = [];
            for (const message of turn.messages) {
                const references = message.metadata && message.metadata.content_references;
                for (const block of blocksOf(message)) {
                    blocks.push(block.kind === 'text' ? { ...block, text: citeText(block.text, references, cites) } : block);
                }
            }
            // The model is on the messages that wrote text, not on the tool
            // calls and reasoning steps around them.
            const answered = turn.messages.filter((m) => roleOf(m) === 'assistant' && m.metadata &&
                (m.metadata.model_slug || m.metadata.resolved_model_slug));
            const last = answered[answered.length - 1];
            nodes[turnId] = {
                parent: turn.parent,
                children: turn.children,
                role: turn.role,
                blocks,
                text: textOf(blocks),
                ids: turn.ids.length ? turn.ids : [turnId],
                model: last ? (last.metadata.model_slug || last.metadata.resolved_model_slug || '') : '',
                at: turn.messages[0] ? toMs(turn.messages[0].create_time) : 0,
                cites,
            };
        }

        return ChatTree.build({
            site: 'chatgpt',
            id,
            title: raw && raw.title,
            url: id ? ChatSites.get('chatgpt').chatUrl(id) : '',
            createdAt: toMs(raw && raw.create_time),
            updatedAt: toMs(raw && raw.update_time),
            root: rootRaw,
            current: turnOfRaw[raw && raw.current_node] || null,
            nodes,
        });
    }

    /** A row of the conversation list, the shape the library draws. */
    function listItem(item) {
        return {
            id: String(item.id || ''),
            title: String(item.title || '').trim() || 'Untitled chat',
            updatedAt: toMs(item.update_time || item.create_time),
        };
    }

    const ChatgptFormat = { normalize, listItem, blocksOf, citeText, toolLine, visible, toMs, PRIVATE_USE };

    root.BB = root.BB || {};
    root.BB.ChatgptFormat = ChatgptFormat;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatgptFormat;
})(typeof globalThis !== 'undefined' ? globalThis : this);
