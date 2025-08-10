/**
 * claude.ai's conversation, read into the shape src/shared/chat-tree.js
 * describes — src/shared/chatgpt-format.js's counterpart, and the only file
 * that knows what `chat_conversations/<uuid>?tree=True` hands back.
 *
 * Claude's shape is flatter than ChatGPT's: a list of messages, each naming
 * its parent, one message a turn. The root's parent is an all-zero sentinel
 * uuid, which becomes the tree's root node. The leaf the page shows is
 * `current_leaf_message_uuid` — present once a chat has an answer, and absent
 * before, when the newest message is the leaf.
 *
 * A message's `content` is a list of typed parts: text (with citations),
 * thinking, tool calls and their results. An artifact is not a message at
 * all; it is a document the messages edit, through a tool called
 * `artifacts`. Each edit becomes an `artifact` block here, and
 * ChatExport.artifacts replays them into each document's final text — a
 * block the core understands, so the replaying names no site.
 *
 * Text pasted into a prompt arrives as an attachment with its text
 * extracted. That is part of what the answer was answering — in a debugging
 * chat it is usually the log — so it is kept. Uploaded files are named, never
 * fetched.
 *
 * Pure, and node-tested.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const ChatTree = ns.ChatTree || req('./chat-tree.js');
    const ChatSites = ns.ChatSites || req('./chat-sites.js');

    const SENTINEL = '00000000-0000-4000-8000-000000000000';

    const toMs = (value) => {
        const parsed = Date.parse(String(value || ''));
        return Number.isFinite(parsed) ? parsed : 0;
    };

    /**
     * Footnotes for a text part's citations, each at the end of the span it
     * cites — or at the end of the part, for a citation that gives no span.
     * Numbered within the turn; `cites` is the turn's list, extended in place.
     */
    function citeText(text, citations, cites) {
        let out = String(text || '');
        const placed = [];
        for (const citation of Array.isArray(citations) ? citations : []) {
            const details = citation.details || {};
            const url = citation.url || details.url || '';
            if (!/^https?:/.test(url)) continue;
            let cite = cites.find((known) => known.url === url);
            if (!cite) {
                cite = { n: cites.length + 1, title: String(citation.title || details.title || url), url };
                cites.push(cite);
            }
            const end = Number.isInteger(citation.end_index) ? Math.min(citation.end_index, out.length) : out.length;
            placed.push({ end, mark: `[^${cite.n}]` });
        }
        // From the back, so each insert leaves the earlier offsets alone.
        placed.sort((a, b) => b.end - a.end).forEach(({ end, mark }) => { out = out.slice(0, end) + mark + out.slice(end); });
        return out;
    }

    /** A tool call as the blocks it contributes. */
    function toolUse(part) {
        const input = part.input || {};
        const name = String(part.name || '');
        if (name === 'artifacts') {
            return [{
                kind: 'artifact',
                command: String(input.command || 'create'),
                id: String(input.id || ''),
                title: String(input.title || ''),
                type: String(input.type || ''),
                language: String(input.language || ''),
                content: input.content == null ? '' : String(input.content),
                old: input.old_str == null ? '' : String(input.old_str),
                new: input.new_str == null ? '' : String(input.new_str),
            }];
        }
        if (/search/i.test(name)) return [{ kind: 'tool', text: input.query ? `Searched the web: "${input.query}"` : 'Searched the web' }];
        if (/fetch/i.test(name)) return [{ kind: 'tool', text: input.url ? `Read ${input.url}` : 'Read a page' }];
        if (/^(repl|analysis)/i.test(name) && input.code) return [{ kind: 'code', lang: 'javascript', text: String(input.code) }];
        return [{ kind: 'tool', text: `Used ${name || 'a tool'}` }];
    }

    function resultText(part) {
        const content = Array.isArray(part.content) ? part.content : [];
        return content.map((piece) => piece && piece.text).filter(Boolean).join(' ').slice(0, 200) || 'the tool failed';
    }

    function blocksOf(message, cites) {
        const parts = Array.isArray(message.content) && message.content.length
            ? message.content
            // Older conversations have text and no content.
            : (message.text ? [{ type: 'text', text: message.text }] : []);
        const out = [];
        for (const part of parts) {
            if (!part) continue;
            if (part.type === 'text' && String(part.text || '').trim()) {
                out.push({ kind: 'text', text: citeText(part.text, part.citations, cites) });
            } else if (part.type === 'thinking' && part.thinking) {
                out.push({ kind: 'thinking', text: String(part.thinking) });
            } else if (part.type === 'tool_use') {
                out.push(...toolUse(part));
            } else if (part.type === 'tool_result' && part.is_error) {
                out.push({ kind: 'tool', text: `Error: ${resultText(part)}` });
            }
        }
        for (const attachment of Array.isArray(message.attachments) ? message.attachments : []) {
            if (attachment && attachment.extracted_content) {
                out.push({ kind: 'attachment', name: String(attachment.file_name || 'pasted text'), text: String(attachment.extracted_content) });
            }
        }
        for (const file of Array.isArray(message.files) ? message.files : []) {
            if (file) out.push({ kind: 'file', name: String(file.file_name || file.name || 'a file') });
        }
        return out;
    }

    /** The turn's readable Markdown: what it says, not how it got there. */
    function textOf(blocks) {
        return blocks.map((block) => {
            if (block.kind === 'text') return block.text;
            if (block.kind === 'code') return ChatTree.fence(block.text, block.lang);
            if (block.kind === 'artifact' && block.title) return `[artifact: ${block.title}]`;
            if (block.kind === 'file') return `[file: ${block.name}]`;
            return null;
        }).filter(Boolean).join('\n\n');
    }

    function normalize(raw) {
        const messages = (raw && Array.isArray(raw.chat_messages) ? raw.chat_messages : []).filter((m) => m && m.uuid);
        const id = String((raw && raw.uuid) || '');
        const known = new Set(messages.map((m) => m.uuid));
        const parentOf = (m) => (m.parent_message_uuid && known.has(m.parent_message_uuid) ? m.parent_message_uuid : SENTINEL);
        // Siblings are ordered as the page numbers them: by when each was
        // written, the message's own index breaking a tie.
        const order = (a, b) => (toMs(a.created_at) - toMs(b.created_at)) || ((a.index || 0) - (b.index || 0));

        const nodes = { [SENTINEL]: { role: 'root', parent: null, children: [] } };
        for (const message of messages.slice().sort(order)) {
            const cites = [];
            const blocks = blocksOf(message, cites);
            nodes[message.uuid] = {
                parent: parentOf(message),
                children: [],
                role: message.sender === 'human' ? 'user' : 'assistant',
                blocks,
                text: textOf(blocks),
                model: message.sender === 'human' ? '' : String((raw && raw.model) || ''),
                at: toMs(message.created_at),
                cites,
            };
        }
        // Linked in a second pass: a parent written in the same millisecond
        // as its child may sort after it, and must exist to be linked to.
        for (const message of messages.slice().sort(order)) nodes[parentOf(message)].children.push(message.uuid);

        let current = raw && raw.current_leaf_message_uuid;
        if (!nodes[current] || current === SENTINEL) {
            const leaves = messages.filter((m) => !nodes[m.uuid].children.length).sort(order);
            current = leaves.length ? leaves[leaves.length - 1].uuid : null;
        }

        return ChatTree.build({
            site: 'claude',
            id,
            title: raw && raw.name,
            url: id ? ChatSites.get('claude').chatUrl(id) : '',
            createdAt: toMs(raw && raw.created_at),
            updatedAt: toMs(raw && raw.updated_at),
            root: SENTINEL,
            current,
            nodes,
        });
    }

    /** A row of the conversation list, the shape the library draws. */
    const listItem = (item) => ({
        id: String(item.uuid || ''),
        title: String(item.name || '').trim() || 'Untitled chat',
        updatedAt: toMs(item.updated_at || item.created_at),
    });

    const ClaudeFormat = { SENTINEL, normalize, listItem, blocksOf, citeText, toolUse };

    root.BB = root.BB || {};
    root.BB.ClaudeFormat = ClaudeFormat;
    if (typeof module !== 'undefined' && module.exports) module.exports = ClaudeFormat;
})(typeof globalThis !== 'undefined' ? globalThis : this);
