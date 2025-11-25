/**
 * claude.ai: every selector, and every request, in one file — the Claude
 * adapter, answering exactly the list src/content/chatgpt-read.js answers.
 *
 * The selectors follow the rule every site's table here follows: several
 * spellings each, newest first, and **never** collapse a list to one current
 * selector. Those below lead with what claude.ai drew when this was written:
 * a virtualised transcript whose rows carry `data-index`, `data-testid`
 * hooks on the user and assistant messages, a ProseMirror composer.
 *
 * **Nothing in claude.ai's markup carries a message's uuid.** So a row is
 * tied to the tree by position — its `data-index` is its place on the path
 * shown — and that is confirmed by comparing the row's text with the node's.
 * When the two disagree, the answer is no turn at all rather than the likely
 * one: a pin mark on the wrong answer is worse than none. The one exception is
 * a sibling whose text does match — that is what the page looks like when its
 * own arrows have been used, and the text says so plainly.
 *
 * Conversations are read from claude.ai's own API, with the page's cookies
 * and nothing else: the organisation is the `lastActiveOrg` cookie the page
 * sets, or the first organisation that can chat.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const ChatSites = ns.ChatSites || req('../shared/chat-sites.js');
    const ChatTree = ns.ChatTree || req('../shared/chat-tree.js');
    const ClaudeFormat = ns.ClaudeFormat || req('../shared/claude-format.js');

    const SITE = ChatSites.get('claude');

    const SELECTORS = Object.freeze({
        /** One virtualised row of the transcript: a prompt or an answer. */
        row: ['[data-testid="transcript-row"]', '[data-index]'],
        userTurn: ['[data-testid="user-message"]'],
        assistantTurn: ['[data-testid="assistant-message"]', '.font-claude-response', '.font-claude-message'],
        streaming: ['[data-is-streaming="true"]'],
        scroller: ['[data-autoscroll-container="true"]', '[data-testid="chat-column-body"]', 'main'],
        composer: [
            'div.ProseMirror[data-testid="chat-input"]',
            'div.ProseMirror[contenteditable="true"]',
            '[contenteditable="true"][aria-label*="prompt" i]',
            'textarea[aria-label*="prompt" i]',
        ],
        send: ['button[aria-label="Send message"]', 'button[aria-label*="Send" i]'],
        stop: ['button[aria-label="Stop response"]', 'button[aria-label*="Stop" i]'],
        siblingPrev: ['button[aria-label="Previous"]', 'button[aria-label*="Previous" i]'],
        siblingNext: ['button[aria-label="Next"]', 'button[aria-label*="Next" i]'],
        siblingCount: ['span', 'div'],
        header: ['[data-testid="chat-header"]', 'header'],
        headerActions: ['[data-testid="wiggle-controls-actions"]', '[data-testid="chat-header"] [data-testid*="actions"]'],
        composerTools: ['[data-testid="input-menu-plus"]', 'button[aria-label*="Add files" i]', 'button[aria-label*="attach" i]'],
        limitNotice: ['[data-testid*="limit" i]', '[role="alert"]', '[role="status"]', 'fieldset ~ div', '[data-testid="chat-footer-row"]'],
        signIn: ['a[href="/login"]', '[data-testid="login-form"]'],
    });

    const shown = (element) => !!element && (typeof element.getClientRects !== 'function' || element.getClientRects().length > 0);

    function find(name, scope = document, { visible = false } = {}) {
        for (const selector of SELECTORS[name] || []) {
            let found = [];
            try { found = scope.querySelectorAll(selector); } catch (_) { continue; }
            for (const element of found) if (!visible || shown(element)) return element;
        }
        return null;
    }

    function findAll(name, scope = document) {
        for (const selector of SELECTORS[name] || []) {
            let found = null;
            try { found = scope.querySelectorAll(selector); } catch (_) { continue; }
            if (found && found.length) return Array.from(found);
        }
        return [];
    }

    // ------------------------------------------------------------ reading

    /** Letters and digits only, lower case: what survives both Markdown and its rendering. */
    const fingerprint = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

    /** A node's words as the page would render them: links to their text, no footnotes, no fences. */
    function nodeWords(node) {
        const text = (node.blocks.length ? node.blocks.filter((b) => b.kind === 'text').map((b) => b.text).join('\n') : node.text)
            .replace(/\[\^\d+\]/g, '')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, '');
        return fingerprint(text);
    }

    /**
     * Which node of `conv` a row at `index` showing `text` is — the one at
     * that place on the path shown, or a sibling of it, and only when its
     * words are in the row. [] when nothing matches, which is a real answer.
     */
    function matchTurn(conv, index, text) {
        const path = ChatTree.activePath(conv);
        const expected = path[index];
        if (!expected) return [];
        const row = fingerprint(text).slice(0, 600);
        const matches = (id) => {
            const want = nodeWords(conv.nodes[id]).slice(0, 24);
            return want.length >= 4 && row.includes(want);
        };
        if (matches(expected)) return [expected];
        const parent = conv.nodes[conv.nodes[expected].parent];
        const sibling = parent && parent.children.find((id) => id !== expected && matches(id));
        return sibling ? [sibling] : [];
    }

    const turnElements = () => findAll('row');

    /** The message inside a row: its text, without the row's buttons and labels. */
    const messageOf = (row) => find('userTurn', row) || find('assistantTurn', row) || row;

    function turnRole(row) {
        const perf = row.getAttribute('data-perf-row');
        if (perf) return perf === 'human' ? 'user' : 'assistant';
        return find('userTurn', row) ? 'user' : 'assistant';
    }

    function turnIds(row, conv) {
        const index = Number(row.getAttribute('data-index'));
        if (!Number.isInteger(index) || !conv) return [];
        return matchTurn(conv, index, messageOf(row).textContent);
    }

    /** `2 / 3` → { index, count }, and nothing else is a count. */
    function readCount(text) {
        const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(text || ''));
        if (!match) return null;
        const index = Number(match[1]);
        const count = Number(match[2]);
        return index >= 1 && count >= 2 && index <= count ? { index, count } : null;
    }

    function siblingNav(row) {
        const prev = find('siblingPrev', row);
        const next = find('siblingNext', row);
        if (!prev || !next) return null;
        let scope = prev.parentElement;
        while (scope && !scope.contains(next)) scope = scope.parentElement;
        for (const candidate of scope ? findAll('siblingCount', scope) : []) {
            if (candidate.children.length) continue;
            const count = readCount(candidate.textContent);
            if (count) return { ...count, prev, next };
        }
        return null;
    }

    /**
     * The arrows may only be drawn while the pointer is over a turn. A hover
     * is announced to the page, which draws them; clicking them needs no more.
     */
    function revealSiblingNav(row) {
        for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter']) {
            row.dispatchEvent(new MouseEvent(type, { bubbles: type.endsWith('over'), cancelable: true }));
        }
    }

    const composer = () => find('composer', document, { visible: true });
    const sendButton = () => find('send', document, { visible: true });
    const stopButton = () => find('stop', document, { visible: true });

    // --------------------------------------------------------- the bridge

    /**
     * What src/content/claude-page.js has heard on the page's own fetch.
     * Until it has said anything the DOM is all there is — the bridge may not
     * be loaded, or the page may have taken its own `fetch` before it was.
     */
    const bridge = { heard: false, streaming: false, endedAt: 0, limit: null };
    const detailOf = (event) => { try { return JSON.parse(event.detail) || {}; } catch (_) { return {}; } };
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('bb:claude:stream', (event) => {
            const detail = detailOf(event);
            bridge.heard = true;
            bridge.streaming = detail.phase === 'start';
            if (detail.phase === 'end') bridge.endedAt = Date.now();
        });
        document.addEventListener('bb:claude:limit', (event) => { bridge.limit = detailOf(event); });
    }

    /**
     * The bridge first. Just after it heard an answer end, it outweighs a
     * stop button the page has not taken down yet — that lag is what it is
     * for, in a background tab. Otherwise, the stop button and the page's
     * own streaming flag.
     */
    function isStreaming(now = Date.now()) {
        if (bridge.streaming) return true;
        if (bridge.heard && now - bridge.endedAt < 3000) return false;
        return !!stopButton() || !!find('streaming');
    }

    /**
     * The limit the stream reported, in the shape ChatSites.readLimit gives a
     * notice — and exact, where a notice is a time of day to be parsed. Null
     * within the limit, and once a reported reset has passed.
     */
    function streamLimit(now = Date.now()) {
        const limit = bridge.limit;
        if (!limit || !/exceeded|approaching/.test(limit.type || '')) return null;
        if (limit.resetsAt && limit.resetsAt <= now) return null;
        return {
            model: '',
            until: limit.resetsAt || null,
            blocked: /exceeded/.test(limit.type),
            approaching: /approaching/.test(limit.type),
            remaining: limit.remaining,
            window: '',
        };
    }

    function composerBox() {
        const box = composer();
        return box ? (box.closest('fieldset') || box.closest('form') || box.parentElement) : null;
    }

    function composerSlot() {
        const box = composerBox();
        const tool = box && find('composerTools', box);
        return tool ? tool.parentElement : null;
    }

    function headerSlot() {
        return find('headerActions') || find('header');
    }

    function headerBottom() {
        const header = find('header');
        return header ? Math.max(0, header.getBoundingClientRect().bottom) : 56;
    }

    function threadRight() {
        const edges = [...findAll('userTurn'), ...findAll('assistantTurn'), composer()].filter(Boolean)
            .map((element) => element.getBoundingClientRect().right).filter((right) => right > 0);
        return edges.length ? Math.max(...edges) : null;
    }

    /** The limit notice's text, believed only when ChatSites.readLimit reads it as one. */
    function limitNotice() {
        const box = composer();
        for (const selector of SELECTORS.limitNotice) {
            let found = [];
            try { found = document.querySelectorAll(selector); } catch (_) { continue; }
            for (const element of found) {
                if (box && element.contains(box)) continue;
                const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
                if (text.length > 15 && text.length < 400 && ChatSites.readLimit('claude', text)) return text;
            }
        }
        return null;
    }

    /** Where a chat is: a conversation, or the page a new one starts on. Nothing under /code. */
    const onChatPage = (pathname = location.pathname) => !!SITE.convIdOf(pathname) || SITE.isNewChat(pathname);

    // ------------------------------------------------------------- the api

    /**
     * claude.ai's own API, as its page calls it: same-origin, with the page's
     * cookies, and no token of ours to keep.
     */
    function createApi(fetchImpl = (...args) => fetch(...args), cookie = () => document.cookie) {
        let org = null;

        async function orgId(force) {
            if (org && !force) return org;
            const stored = /(?:^|;\s*)lastActiveOrg=([^;]+)/.exec(cookie() || '');
            if (stored && !force) return (org = decodeURIComponent(stored[1]));
            const response = await fetchImpl('/api/organizations', { credentials: 'include' });
            const orgs = response.ok ? await response.json().catch(() => null) : null;
            const chat = Array.isArray(orgs) && orgs.find((one) => (one.capabilities || []).includes('chat'));
            if (!chat) throw Object.assign(new Error('Not signed in to Claude'), { code: 'signed-out' });
            return (org = chat.uuid);
        }

        async function get(path) {
            const call = async (force) => fetchImpl(`/api/organizations/${await orgId(force)}${path}`, { credentials: 'include' });
            let response = await call(false);
            // A cookie left over from another organisation: ask once which is right.
            if (response.status === 403) response = await call(true);
            if (!response.ok) throw Object.assign(new Error(`Claude answered ${response.status}`), { status: response.status });
            return response.json();
        }

        return {
            orgId,
            async fetchConversation(id) {
                return ClaudeFormat.normalize(await get(`/chat_conversations/${encodeURIComponent(id)}?tree=True&rendering_mode=messages&render_all_tools=true`));
            },
            async listConversations({ offset = 0, limit = 28 } = {}) {
                const body = await get(`/chat_conversations?limit=${limit}&offset=${offset}`);
                const items = (Array.isArray(body) ? body : []).map(ClaudeFormat.listItem);
                // No total is given. A full page means there may be more.
                return { items, total: items.length === limit ? offset + limit + 1 : offset + items.length };
            },
        };
    }

    const api = createApi();

    const adapter = Object.freeze({
        site: 'claude',
        convIdOf: (pathname = location.pathname) => SITE.convIdOf(pathname),
        isNewChat: (pathname = location.pathname) => SITE.isNewChat(pathname),
        onChatPage: () => onChatPage(),
        fetchConversation: (id) => api.fetchConversation(id),
        listConversations: (options) => api.listConversations(options),
        scroller: () => find('scroller'),
        turnElements,
        turnIds,
        turnRole,
        siblingNav,
        revealSiblingNav,
        composer,
        sendButton,
        stopButton,
        isStreaming: () => isStreaming(),
        /** The exact limit off the completion stream, when the bridge has one. */
        limit: () => streamLimit(),
        headerSlot,
        headerBottom,
        threadRight,
        composerSlot,
        composerBox,
        limitNotice,
        signedOut: () => !!find('signIn', document, { visible: true }),
        chatUrl: (id, options) => SITE.chatUrl(id, options),
    });

    const ClaudeRead = { SELECTORS, find, findAll, fingerprint, matchTurn, readCount, onChatPage, createApi, adapter, bridge, isStreaming, streamLimit };

    root.BB = root.BB || {};
    root.BB.ClaudeRead = ClaudeRead;
    if (typeof module !== 'undefined' && module.exports) module.exports = ClaudeRead;
})(typeof globalThis !== 'undefined' ? globalThis : this);
