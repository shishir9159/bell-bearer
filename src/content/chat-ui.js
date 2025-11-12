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
 * The conversation is fetched when a chat is navigated into and fetched again,
 * debounced, when an answer finishes or the page draws a turn the tree does
 * not know — an edit, a regenerate, a prompt sent. It is kept for the page's
 * life and never stored: the site has it, and a copy in storage would be a
 * second history to go stale.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('../shared/settings.js');
    const Keybindings = ns.Keybindings || req('../shared/keybindings.js');
    const ChatTree = ns.ChatTree || req('../shared/chat-tree.js');
    const ChatPanel = ns.ChatPanel || req('./chat-panel.js');
    const ChatNav = ns.ChatNav || req('./chat-nav.js');
    const Theme = ns.Theme || req('./theme.js');

    const TOGGLE_ID = 'bb-chat-toggle';
    const PANEL_KEY = Settings.DATA.chatPanel;
    /** How long the page has to settle before an unknown turn means a refetch. */
    const REFETCH_MS = 1500;

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
        let refetchTimer = 0;
        let wasStreaming = false;
        /** The unknown turns last refetched for, so a selector gone stale refetches once, not forever. */
        let lastUnknown = '';

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

        function refetchSoon() {
            clearTimeout(refetchTimer);
            refetchTimer = setTimeout(() => { if (chat.id) load(chat.id); }, REFETCH_MS);
        }

        /**
         * The watcher task that keeps the tree current. Never done: a chat
         * grows for as long as the page is open.
         *
         * An answer finishing is the main cue. The other is a turn on the
         * page that the tree has no node for — which is what an edited
         * prompt looks like before anything else has said so.
         */
        function sync() {
            const streaming = adapter.isStreaming();
            if (wasStreaming && !streaming) refetchSoon();
            wasStreaming = streaming;
            if (streaming || !chat.id || !chat.conv || chat.loading) return false;
            const turns = adapter.turnElements();
            const unknown = turns.filter((element) => !adapter.turnIds(element, chat.conv).length).length;
            const key = `${unknown}/${turns.length}`;
            if (unknown && key !== lastUnknown) {
                lastUnknown = key;
                refetchSoon();
            }
            return false;
        }

        // ------------------------------------------------------------ panel

        /** The panel's tabs. Each feature that has one adds it here. */
        function tabs() {
            return [{ id: 'outline', label: 'Outline' }];
        }

        const path = () => (chat.conv ? ChatTree.activePath(chat.conv) : []);
        const outline = () => (chat.conv ? ChatTree.outline(chat.conv) : []);

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
            return ChatPanel.outlineHtml(outline());
        }

        function onBodyClick(event) {
            const entry = event.target.closest('[data-bb-chat-reach]');
            if (entry) goTo(entry.dataset.bbChatReach, entry.dataset.bbChatHeading);
        }

        /**
         * Reach a turn from the panel. An overlaid panel steps aside first:
         * it is covering the thread the turn is about to be shown in.
         */
        async function goTo(id, heading = '') {
            if (!chat.conv) return false;
            if (panel.isOpen() && !panel.docked) panel.close();
            const landed = await ChatNav.reach(adapter, chat.conv, id, { heading });
            if (!landed) notify('Could not find that turn on the page — scroll to it and try again', 'warning');
            return landed;
        }

        function repaint() {
            if (!panel.isOpen()) return;
            const [title, sub] = heading();
            panel.setHeading(title, sub);
            panel.render();
            markCurrent();
        }

        /**
         * Mark the outline row being read. Classes only, never a redraw: this
         * runs on scroll, and a redraw would throw away the panel's own
         * scroll position under the reader's pointer.
         */
        function markCurrent() {
            const host = panel.element;
            if (!host || !chat.conv || panel.tab !== 'outline') return;
            const rows = host.querySelectorAll('[data-bb-chat-entry]');
            if (!rows.length) return;
            const at = ChatPanel.currentEntry(outline(), path(), ChatNav.current(adapter, chat.conv));
            rows.forEach((row) => {
                const on = Number(row.dataset.bbChatEntry) === at;
                if (on === row.classList.contains('is-current')) return;
                row.classList.toggle('is-current', on);
                if (on) row.scrollIntoView({ block: 'nearest' });
            });
        }

        let spyFrame = 0;
        /** The thread scrolled. At most once a frame; nothing at all with the panel shut. */
        function onScroll() {
            if (spyFrame || !panel.isOpen()) return;
            spyFrame = requestAnimationFrame(() => {
                spyFrame = 0;
                markCurrent();
            });
        }

        // ---------------------------------------------------------- hotkeys

        /**
         * Ctrl+Alt+J/K and the rest, on a capture-phase keydown of their own.
         *
         * Not through src/content/shortcuts.js, for leet-ui.js's reason: its
         * isTypingTarget stands aside for every contenteditable, and a chat
         * site's composer is one and has the focus nearly all the time. These
         * have to fire with the caret in it. The panel itself is Shift+P —
         * the pouch key, which does go through shortcuts.js and so types a P
         * in the composer, as a capital letter should.
         */
        const HOTKEYS = {
            'chat-next': () => step(1),
            'chat-prev': () => step(-1),
        };

        /**
         * AltGr is Ctrl+Alt as far as a keydown can tell on Windows, and it
         * is how half of Europe types: AltGr+Q is @ on a German keyboard. A
         * keystroke the browser says had AltGraph down, or that produced a
         * symbol rather than its letter, is typing and is left alone.
         */
        function isAltGr(event) {
            if (event.getModifierState && event.getModifierState('AltGraph')) return true;
            return typeof event.key === 'string' && event.key.length === 1 && !/[\p{L}\p{N}]/u.test(event.key);
        }

        function onHotkey(event) {
            // Every keystroke in the composer passes through here. A chat
            // hotkey always carries a modifier — it fires in a text box — so
            // a bare key is turned away before anything is resolved.
            if (!event.ctrlKey && !event.altKey && !event.metaKey) return;
            if (isAltGr(event)) return;
            const shortcuts = getSettings().shortcuts;
            for (const id of Object.keys(HOTKEYS)) {
                const binding = Keybindings.resolve(shortcuts, id);
                if (!binding || !binding.enabled || !Keybindings.matches(event, binding.combo, binding.kind)) continue;
                event.preventDefault();
                event.stopPropagation();
                HOTKEYS[id]();
                return;
            }
        }

        /** The next or previous prompt, from wherever the reader is. */
        function step(direction) {
            if (!chat.conv) return Promise.resolve(false);
            return ChatNav.step(adapter, chat.conv, direction);
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
            watcher.add('chat-sync', sync);
            // The thread scrolls inside a container of its own, which a
            // capture listener on window hears without having to find it.
            window.addEventListener('scroll', onScroll, { capture: true, passive: true });
            document.addEventListener('keydown', onHotkey, true);
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
            watcher.remove('chat-sync');
            window.removeEventListener('scroll', onScroll, { capture: true, passive: true });
            document.removeEventListener('keydown', onHotkey, true);
            clearTimeout(refetchTimer);
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
                lastUnknown = '';
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
            install, uninstall, onNavigate, openPouch, refreshSurfaces, panel, injectToggle, goTo, onHotkey, isAltGr,
            conversation: () => chat.conv,
            reload: () => (chat.id ? load(chat.id) : Promise.resolve()),
        };
    }

    const ChatUi = { createChatUi, TOGGLE_ID, REFETCH_MS };

    root.BB = root.BB || {};
    root.BB.ChatUi = ChatUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
