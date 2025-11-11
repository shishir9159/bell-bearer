/**
 * Everything Bell Bearer puts on a chat site, and the conversation it keeps
 * in memory while a chat is open.
 *
 * This file never names a site. It is handed an adapter —
 * src/content/chatgpt-read.js's, today — and that is the whole of what it may
 * ask: where the thread is, what a turn is, how to fetch the tree. The panel
 * frame is src/content/chat-panel.js, and moving the page is
 * src/content/chat-nav.js; this is the part that knows what is open and keeps
 * the three in step.
 *
 * The conversation is fetched when a chat is navigated into, kept for the
 * page's life and never stored: the site has it, and a copy in storage would
 * be a second history to go stale.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('../shared/settings.js');
    const ChatTree = ns.ChatTree || req('../shared/chat-tree.js');
    const ChatPanel = ns.ChatPanel || req('./chat-panel.js');
    const Theme = ns.Theme || req('./theme.js');

    const TOGGLE_ID = 'bb-chat-toggle';
    const PANEL_KEY = Settings.DATA.chatPanel;

    const TOGGLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10"></path><path d="M4 12h7"></path><path d="M4 18h10"></path><rect x="15.5" y="4" width="4.5" height="16" rx="1.2"></rect></svg>';

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    /**
     * `getSettings` reads the content script's settings mirror, and defaults
     * to the schema's own defaults — so a caller that passes none gets the
     * extension at rest rather than a quietly different set.
     */
    function createChatUi({ adapter, watcher, notify, getSettings = () => Settings.DEFAULTS }) {
        /** The chat this page is on, and what we know of it. */
        const chat = { id: null, conv: null, error: '', loading: false, token: 0 };

        const panel = ChatPanel.createChatPanel({
            site: adapter.site,
            tabs: () => tabs(),
            bodyHtml: (tab) => bodyHtml(tab),
            onBodyClick: (event, tab) => onBodyClick(event, tab),
            threadRight: () => adapter.threadRight(),
            top: () => adapter.headerBottom() + 8,
            appearance: () => Theme.appearance(),
            dress: (element, look) => Theme.dress(element, look),
            onState: (state) => {
                syncToggle();
                Settings.set({ [PANEL_KEY]: state });
            },
        });

        // --------------------------------------------------- the conversation

        /**
         * Fetch `id`, and draw it once it lands — unless the page has moved on
         * to another chat in the meantime, in which case the answer is for a
         * conversation nobody is looking at any more and is dropped.
         */
        async function load(id) {
            const token = ++chat.token;
            chat.loading = true;
            chat.error = '';
            repaint();
            try {
                const conv = await adapter.fetchConversation(id);
                if (token !== chat.token) return;
                chat.conv = conv;
            } catch (error) {
                if (token !== chat.token) return;
                chat.error = error && error.code === 'signed-out'
                    ? 'Sign in to read this chat.'
                    : `Could not read this chat${error && error.status ? ` (${error.status})` : ''}.`;
            } finally {
                if (token === chat.token) chat.loading = false;
            }
            repaint();
        }

        // ------------------------------------------------------------ panel

        /** The panel's tabs. Each feature that has one adds it here. */
        function tabs() {
            return [];
        }

        function heading() {
            if (!chat.id) return [adapter.isNewChat() ? 'New chat' : '', ''];
            if (!chat.conv) return [chat.error ? 'This chat' : 'Reading…', chat.error];
            const path = ChatTree.activePath(chat.conv);
            const prompts = path.filter((id) => chat.conv.nodes[id].role === 'user').length;
            const forks = ChatTree.forks(chat.conv).length;
            return [chat.conv.title, `${plural(prompts, 'prompt')}${forks ? ` · ${plural(forks, 'branch point')}` : ''}`];
        }

        function bodyHtml() {
            if (!chat.id) return ChatPanel.emptyHtml('Open a conversation and its outline, branches and pins show up here.');
            if (chat.error) return ChatPanel.emptyHtml(chat.error);
            if (!chat.conv) return ChatPanel.emptyHtml('Reading the conversation…');
            return '';
        }

        function onBodyClick() {}

        function repaint() {
            if (!panel.isOpen()) return;
            const [title, sub] = heading();
            panel.setHeading(title, sub);
            panel.render();
        }

        // ----------------------------------------------------------- toggle

        /**
         * The toggle in the chat's own header. Always there, like the Pouch
         * rows on the other sites — the panel is not one of the switchable
         * surfaces, and without it nothing here is discoverable.
         *
         * Never done, and for X's reason: the site rebuilds its header on its
         * own schedule, so a task that retired after placing it once would
         * leave it gone for the rest of the session.
         */
        function injectToggle() {
            if (document.getElementById(TOGGLE_ID)) return false;
            const slot = adapter.headerSlot();
            if (!slot) return false;

            const button = document.createElement('button');
            button.id = TOGGLE_ID;
            button.type = 'button';
            button.className = 'bb-chat-toggle';
            button.setAttribute(ChatPanel.KEEP, '1');
            button.title = 'Bell Bearer — outline, branches, pins and queue';
            button.setAttribute('aria-label', 'Bell Bearer chat panel');
            button.innerHTML = TOGGLE_ICON;
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openPouch();
            });
            slot.prepend(button);
            syncToggle();
            return false;
        }

        function syncToggle() {
            const button = document.getElementById(TOGGLE_ID);
            if (!button) return;
            button.classList.toggle('is-on', panel.isOpen());
            button.setAttribute('aria-pressed', String(panel.isOpen()));
        }

        /** Shift+P, and the toggle. The cross-site name main.js calls. */
        function openPouch(options) {
            if (panel.isOpen()) panel.close();
            else {
                panel.open(options);
                repaint();
            }
        }

        // ----------------------------------------------------------- wiring

        function install() {
            watcher.add('chat-toggle', injectToggle);
            // Put the panel back if it was left open — but only where it
            // docks. An overlay that opens by itself on page load covers the
            // chat you came to read.
            Settings.get([PANEL_KEY]).then((stored) => {
                const state = stored[PANEL_KEY];
                if (!state || !state.open || panel.isOpen()) return;
                if (ChatPanel.fitsBeside(window.innerWidth, adapter.threadRight())) {
                    panel.open({ tab: state.tab });
                    repaint();
                }
            });
            onNavigate();
        }

        /** For the specs, which build a fresh UI per test against one document. */
        function uninstall() {
            watcher.remove('chat-toggle');
            chat.token++;
            if (panel.isOpen()) panel.close();
            const toggle = document.getElementById(TOGGLE_ID);
            if (toggle) toggle.remove();
        }

        /**
         * The site navigated. It is a single-page app and announces nothing,
         * so main.js calls this off the shared observer, as it does for X.
         */
        function onNavigate() {
            const id = adapter.convIdOf();
            if (id !== chat.id) {
                chat.id = id;
                chat.conv = null;
                chat.error = '';
                chat.token++;
                chat.loading = false;
                if (id) load(id);
            }
            panel.place();
            repaint();
        }

        /** A setting changed in the dashboard; both directions, on the open page. */
        function refreshSurfaces() {
            repaint();
            watcher.schedule();
        }

        return {
            install, uninstall, onNavigate, openPouch, refreshSurfaces, panel, injectToggle,
            conversation: () => chat.conv,
            reload: () => (chat.id ? load(chat.id) : Promise.resolve()),
        };
    }

    const ChatUi = { createChatUi, TOGGLE_ID };

    root.BB = root.BB || {};
    root.BB.ChatUi = ChatUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
