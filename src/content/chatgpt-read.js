/**
 * chatgpt.com: every selector, and every request, in one file.
 *
 * The rest of the chat code never names ChatGPT. It is handed `adapter`, at
 * the foot of this file, and that is the whole of what it may ask a site —
 * src/content/claude-read.js answers the same list for claude.ai.
 *
 * The selectors follow this repo's rule for somebody else's markup, and more
 * strictly than anywhere else, because OpenAI ships a UI change most weeks:
 * several spellings each, newest first, and **never** collapse a list to "the
 * current one". Two things are validated rather than trusted — a sibling
 * count must read as `2/3` or it is not the sibling control, and a composer
 * must be on screen, because chatgpt.com keeps a hidden <textarea> with the
 * composer's own name beside the real one.
 *
 * Conversations are read from ChatGPT's own backend-api, the one its page
 * uses, and never scraped off the DOM: a long thread is not all mounted at
 * once, and what is mounted has lost the tree. The DOM is where things are
 * drawn and clicked. Sending is never a request — see src/content/composer.js.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const ChatSites = ns.ChatSites || req('../shared/chat-sites.js');
    const ChatTree = ns.ChatTree || req('../shared/chat-tree.js');
    const ChatgptFormat = ns.ChatgptFormat || req('../shared/chatgpt-format.js');

    const SITE = ChatSites.get('chatgpt');

    const SELECTORS = Object.freeze({
        /**
         * One turn — a prompt, or an answer however many messages it took.
         * A <section> since 2026; an <article> before that.
         */
        turn: [
            'section[data-testid^="conversation-turn-"]',
            'article[data-testid^="conversation-turn-"]',
            '[data-turn-id][data-turn]',
        ],
        /** The raw message ids a turn draws, which is what ties it to the tree. */
        message: ['[data-message-id]'],
        /** The element that actually scrolls the thread; the window does not. */
        scroller: ['[data-scroll-root]', 'main div[class*="overflow-y-auto"]', 'main'],
        /** ProseMirror. The hidden <textarea> of the same name is passed over. */
        composer: [
            '#prompt-textarea',
            'div.ProseMirror[contenteditable="true"]',
            'textarea[name="prompt-textarea"]',
        ],
        /** Only there while the composer has something in it. */
        send: ['[data-testid="send-button"]', 'button[aria-label="Send prompt"]', 'form button[aria-label*="Send" i]'],
        stop: ['[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]', 'form button[aria-label*="Stop" i]'],
        /** The `< 2/3 >` under an edited prompt or a regenerated answer. */
        siblingPrev: ['button[aria-label="Previous response"]', 'button[aria-label*="Previous" i]'],
        siblingNext: ['button[aria-label="Next response"]', 'button[aria-label*="Next" i]'],
        siblingCount: ['.tabular-nums', 'div[class*="tabular"]', 'span', 'div'],
        /** Where the panel's toggle goes: beside Share, in the chat's own header. */
        headerActions: [
            '#conversation-header-actions',
            '#page-header [data-testid="share-chat-button"]',
            '#page-header [data-testid="conversation-options-button"]',
        ],
        header: ['#page-header', 'main header', 'header'],
        /** Where Prompts and Queue go: beside the composer's own + button. */
        composerTools: [
            'form[data-type="unified-composer"] [data-testid="composer-plus-btn"]',
            'form [data-testid="composer-plus-btn"]',
            'form button[aria-label*="Add photos" i]',
        ],
        signIn: ['[data-testid="login-button"]', 'a[href*="/auth/login"]', 'button[data-testid="signup-button"]'],
        /**
         * Where a limit notice has been seen: a banner over the composer, or
         * an alert. Broad on purpose, because the wording is what is believed
         * — see limitNotice.
         */
        limitNotice: ['[data-testid*="limit" i]', '[role="alert"]', '[role="status"]', '#thread-bottom-container div', '#thread-bottom div'],
    });

    const shown = (element) => !!element && (typeof element.getClientRects !== 'function' || element.getClientRects().length > 0);

    /** The first element matching any spelling, in order. */
    function find(name, scope = document, { visible = false } = {}) {
        for (const selector of SELECTORS[name] || []) {
            let found = [];
            try { found = scope.querySelectorAll(selector); } catch (_) { continue; }
            for (const element of found) if (!visible || shown(element)) return element;
        }
        return null;
    }

    /** Every element matching the first spelling that matches anything. */
    function findAll(name, scope = document) {
        for (const selector of SELECTORS[name] || []) {
            let found = null;
            try { found = scope.querySelectorAll(selector); } catch (_) { continue; }
            if (found && found.length) return Array.from(found);
        }
        return [];
    }

    // ------------------------------------------------------------ reading

    /** `2/3` → { index: 2, count: 3 }, and anything else is not a count. */
    function readCount(text) {
        const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(text || ''));
        if (!match) return null;
        const index = Number(match[1]);
        const count = Number(match[2]);
        return index >= 1 && count >= 2 && index <= count ? { index, count } : null;
    }

    const turnElements = () => findAll('turn');

    function turnRole(element) {
        const role = element.getAttribute('data-turn') ||
            ((element.querySelector('[data-message-author-role]') || element).getAttribute('data-message-author-role'));
        return role === 'user' ? 'user' : 'assistant';
    }

    /**
     * The turns in `conv` this element draws. Every raw id on it is asked
     * about — the turn's own and each message's — because an answer's turn is
     * marked with a different id from the message it shows, and which of the
     * chain's ids the page picks has changed before.
     */
    function turnIds(element, conv) {
        const raw = [element.getAttribute('data-turn-id'),
            ...Array.from(element.querySelectorAll('[data-message-id]'), (m) => m.getAttribute('data-message-id'))];
        const out = [];
        for (const id of raw) {
            const turn = id && ChatTree.turnOf(conv, id);
            if (turn && !out.includes(turn)) out.push(turn);
        }
        return out;
    }

    /** The turn's `< k/n >`, or null when it has no siblings to switch between. */
    function siblingNav(element) {
        const prev = find('siblingPrev', element);
        const next = find('siblingNext', element);
        if (!prev || !next) return null;
        // The count sits between the two buttons. Searched from their shared
        // parent rather than the whole turn, so a "1/2" inside the answer's
        // own text can never be read as the control.
        let scope = prev.parentElement;
        while (scope && !scope.contains(next)) scope = scope.parentElement;
        for (const candidate of scope ? findAll('siblingCount', scope) : []) {
            if (candidate.children.length) continue;
            const count = readCount(candidate.textContent);
            if (count) return { ...count, prev, next };
        }
        return null;
    }

    const composer = () => find('composer', document, { visible: true });
    const sendButton = () => find('send', document, { visible: true });
    const stopButton = () => find('stop', document, { visible: true });

    function headerSlot() {
        const action = find('headerActions');
        if (action) return action.id === 'conversation-header-actions' ? action : action.parentElement;
        return find('header');
    }

    /**
     * The right edge of the conversation column: the widest message, or the
     * composer, whichever reaches further. Null with neither on the page.
     */
    function threadRight() {
        const edges = [...document.querySelectorAll('[data-message-id]'), find('composer', document, { visible: true })]
            .filter(Boolean)
            .map((element) => element.getBoundingClientRect().right)
            .filter((right) => right > 0);
        return edges.length ? Math.max(...edges) : null;
    }

    /** Where the chat's own header ends, so the panel starts below it. */
    function headerBottom() {
        const header = find('header');
        return header ? Math.max(0, header.getBoundingClientRect().bottom) : 56;
    }

    /**
     * The limit notice's text, or null. The selectors only say where to
     * look; what is believed is text that ChatSites.readLimit reads as a
     * limit. Anything holding the composer is passed over, so a prompt being
     * typed about rate limits is never mistaken for one.
     */
    function limitNotice() {
        const box = composer();
        for (const selector of SELECTORS.limitNotice) {
            let found = [];
            try { found = document.querySelectorAll(selector); } catch (_) { continue; }
            for (const element of found) {
                if (box && element.contains(box)) continue;
                const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
                if (text.length > 20 && text.length < 400 && ChatSites.readLimit('chatgpt', text)) return text;
            }
        }
        return null;
    }

    /** The composer's own frame, which the queue strip sits just above. */
    function composerBox() {
        const box = composer();
        return box ? (box.closest('form') || box.parentElement) : null;
    }

    function composerSlot() {
        const plus = find('composerTools');
        return plus ? plus.parentElement : null;
    }

    // ------------------------------------------------------------- the api

    /**
     * ChatGPT's own backend-api, as its page calls it.
     *
     * The access token comes from /api/auth/session and is kept in memory for
     * the life of the page — never in storage, where it would outlive the
     * session it belongs to — and fetched once more on a 401. These are
     * same-origin requests, so the page's cookies go with them. A bare Bearer
     * is enough today; if that ever changes, the fallback is a page-world
     * hook copying the headers of ChatGPT's own requests. Written down, not
     * built.
     */
    function createApi(fetchImpl = (...args) => fetch(...args)) {
        let token = null;

        async function session(force) {
            if (token && !force) return token;
            const response = await fetchImpl('/api/auth/session', { credentials: 'include' });
            const body = response.ok ? await response.json().catch(() => null) : null;
            token = (body && body.accessToken) || null;
            if (!token) throw Object.assign(new Error('Not signed in to ChatGPT'), { code: 'signed-out' });
            return token;
        }

        async function get(path) {
            const call = async (force) => fetchImpl(path, {
                credentials: 'include',
                headers: { Authorization: `Bearer ${await session(force)}` },
            });
            let response = await call(false);
            if (response.status === 401) response = await call(true);
            if (!response.ok) {
                throw Object.assign(new Error(`ChatGPT answered ${response.status}`), { status: response.status });
            }
            return response.json();
        }

        return {
            session,
            async fetchConversation(id) {
                return ChatgptFormat.normalize(await get(`/backend-api/conversation/${encodeURIComponent(id)}`));
            },
            async listConversations({ offset = 0, limit = 28 } = {}) {
                const body = await get(`/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`);
                const items = (body && Array.isArray(body.items) ? body.items : []).map(ChatgptFormat.listItem);
                return { items, total: Number(body && body.total) || items.length };
            },
        };
    }

    const api = createApi();

    const adapter = Object.freeze({
        site: 'chatgpt',
        convIdOf: (pathname = location.pathname) => SITE.convIdOf(pathname),
        isNewChat: (pathname = location.pathname) => SITE.isNewChat(pathname),
        /** Every chatgpt.com page is a chat page or the start of one. */
        onChatPage: () => true,
        fetchConversation: (id) => api.fetchConversation(id),
        listConversations: (options) => api.listConversations(options),
        scroller: () => find('scroller'),
        turnElements,
        turnIds,
        turnRole,
        siblingNav,
        composer,
        sendButton,
        stopButton,
        isStreaming: () => !!stopButton(),
        headerSlot,
        headerBottom,
        threadRight,
        composerSlot,
        composerBox,
        limitNotice,
        signedOut: () => !!find('signIn', document, { visible: true }),
        chatUrl: (id, options) => SITE.chatUrl(id, options),
    });

    const ChatgptRead = { SELECTORS, find, findAll, readCount, turnIds, siblingNav, createApi, adapter };

    root.BB = root.BB || {};
    root.BB.ChatgptRead = ChatgptRead;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatgptRead;
})(typeof globalThis !== 'undefined' ? globalThis : this);
