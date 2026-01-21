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
    const Dom = ns.Dom || req('../shared/dom.js');
    const Keybindings = ns.Keybindings || req('../shared/keybindings.js');
    const ChatSites = ns.ChatSites || req('../shared/chat-sites.js');
    const ChatExport = ns.ChatExport || req('../shared/chat-export.js');
    const ChatTree = ns.ChatTree || req('../shared/chat-tree.js');
    const ChatPins = ns.ChatPins || req('../shared/chat-pins.js');
    const ChatPanel = ns.ChatPanel || req('./chat-panel.js');
    const ChatNav = ns.ChatNav || req('./chat-nav.js');
    const ChatTreeView = ns.ChatTreeView || req('./chat-tree-view.js');
    const ChatCompare = ns.ChatCompare || req('./chat-compare.js');
    const ChatLibrary = ns.ChatLibrary || req('./chat-library.js');
    const ChatPicker = ns.ChatPicker || req('./chat-picker.js');
    const ChatRunner = ns.ChatRunner || req('./chat-runner.js');
    const Composer = ns.Composer || req('./composer.js');
    const PromptQueue = ns.PromptQueue || req('../shared/prompt-queue.js');
    const ChatQueueView = ns.ChatQueueView || req('./chat-queue-view.js');
    const Theme = ns.Theme || req('./theme.js');

    const TOGGLE_ID = 'bb-chat-toggle';

    const STRIP_ID = 'bb-chat-queue';
    const CHIP_ID = 'bb-chat-limit';
    const TOOLS_ID = 'bb-chat-tools';
    /** On a turn of the site's own that is pinned. Inert without content.css. */
    const PINNED = 'data-bb-chat-pinned';
    const PANEL_KEY = Settings.DATA.chatPanel;
    /** How long the page has to settle before an unknown turn means a refetch. */
    const REFETCH_MS = 1500;

    const TOGGLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10"></path><path d="M4 12h7"></path><path d="M4 18h10"></path><rect x="15.5" y="4" width="4.5" height="16" rx="1.2"></rect></svg>';

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    /** The clipboard, when main.js has not handed over the Markdown module's. */
    const defaultCopy = (text) => Dom.copyText(text);

    /**
     * `getSettings` reads the content script's settings mirror, and defaults
     * to the schema's own defaults — so a caller that passes none gets the
     * extension at rest rather than a quietly different set.
     */
    function createChatUi({ adapter, watcher, notify, getSettings = () => Settings.DEFAULTS, copyText = defaultCopy }) {
        /** The chat this page is on, and what we know of it. */
        const chat = { id: null, conv: null, error: '', loading: false, token: 0 };
        let refetchTimer = 0;
        /**
         * Which stay on a chat this is: moves on when the page goes to
         * another chat, or the UI is taken down. A walk to a turn (ChatNav)
         * stops once it has moved. Not `chat.token`, which a refetch of the
         * same chat moves too — halfway through a branch switch, on purpose.
         */
        let visit = 0;
        const walk = () => {
            const mine = visit;
            return { alive: () => mine === visit };
        };
        let wasStreaming = false;
        /** The unknown turns last refetched for, so a selector gone stale refetches once, not forever. */
        let lastUnknown = '';

        const panel = ChatPanel.createChatPanel({
            site: adapter.site,
            tabs: () => tabs(),
            bodyHtml: (tab) => bodyHtml(tab),
            onBodyClick: (event, tab) => onBodyClick(event, tab),
            onBodyKey: (event, tab) => onBodyKey(event, tab),
            onHeadClick: (event) => onHeadClick(event),
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
            land();
        }

        /**
         * `#bb-node=<id>`: the dashboard opened a pin. Read once, taken off
         * the address — a reload should not jump again — and reached once the
         * conversation is in, switching branch first if the pin is on another.
         */
        let landing = null;

        function readLanding() {
            const match = /^#bb-node=(.+)$/.exec(location.hash || '');
            if (!match) return;
            landing = decodeURIComponent(match[1]);
            try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) { /* a sandboxed page */ }
        }

        function land() {
            if (!landing || !chat.conv) return;
            const id = landing;
            landing = null;
            if (chat.conv.nodes[id]) goTo(id);
            else notify('That pinned message is no longer in this chat', 'warning');
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
            // The site's own arrows were used: follow the page rather than
            // go on describing a branch it no longer shows. Not mid-switch,
            // when the page is between branches on purpose.
            const stray = !switching && ChatNav.strayTurn(adapter, chat.conv);
            if (stray) {
                chat.conv = { ...chat.conv, current: ChatTree.leafUnder(chat.conv, stray) };
                repaint();
            }
            return false;
        }

        let switching = false;

        /**
         * Switch the page to the branch `target` is on. A tree the page has
         * moved past is refetched once and the walk tried again; after that,
         * whatever stopped it is said rather than worked around.
         */
        async function switchBranch(target) {
            if (switching || !chat.conv) return false;
            switching = true;
            const here = walk();
            try {
                let result = await ChatNav.switchTo(adapter, chat.conv, target, here);
                if (!result.ok && result.stale) {
                    await load(chat.id);
                    if (chat.conv && chat.conv.nodes[target]) result = await ChatNav.switchTo(adapter, chat.conv, target, here);
                }
                if (!here.alive()) return false;
                if (!result.ok) {
                    notify(result.reason, 'warning');
                    return false;
                }
                chat.conv = { ...chat.conv, current: ChatTree.leafUnder(chat.conv, target) };
                repaint();
                return true;
            } finally {
                switching = false;
            }
        }

        // ------------------------------------------------------------ panel

        /** The panel's tabs. Each feature that has one adds it here. */
        function tabs() {
            return [{ id: 'outline', label: 'Outline' }, { id: 'tree', label: 'Tree' }, { id: 'pins', label: 'Pins' }, { id: 'queue', label: 'Queue' }];
        }

        const path = () => (chat.conv ? ChatTree.activePath(chat.conv) : []);

        /**
         * The outline, with each pinned turn wearing its pin. A pinned answer
         * that wrote no headings has no row of its own in an outline, so it is
         * given one — otherwise the pin would have nowhere to show.
         */
        function outline() {
            if (!chat.conv) return [];
            const pinned = new Map(myPins().map((pin) => [pin.node, pin]));
            const byTurn = new Map();
            for (const entry of ChatTree.outline(chat.conv)) {
                if (!byTurn.has(entry.id)) byTurn.set(entry.id, []);
                byTurn.get(entry.id).push(entry);
            }
            const out = [];
            for (const id of path()) {
                const own = byTurn.get(id) || [];
                const pin = pinned.get(id);
                if (!own.length && pin) own.push({ id, level: 1, text: pin.label || pin.excerpt || 'Pinned answer' });
                own.forEach((entry, index) => out.push(index === 0 && pin ? { ...entry, pinned: true } : entry));
            }
            return out;
        }

        // ------------------------------------------------------------- pins

        let pinState = {};
        let editingPin = null;
        let unwatchPins = null;

        const myPins = () => (chat.id ? ChatPins.forConv(pinState, adapter.site, chat.id) : []);

        async function reloadPins() {
            pinState = await ChatPins.load();
            repaint();
            markPinned();
        }

        /**
         * Mark each pinned turn on the page. A watcher task, and never done:
         * a virtualised thread unmounts a turn as it scrolls away and mounts a
         * fresh element when it comes back, without the mark.
         */
        function markPinned() {
            if (!chat.conv) return false;
            for (const element of adapter.turnElements()) {
                const pinned = adapter.turnIds(element, chat.conv)
                    .some((id) => ChatPins.isPinned(pinState, adapter.site, chat.id, id));
                if (pinned !== element.hasAttribute(PINNED)) element.toggleAttribute(PINNED, pinned);
            }
            return false;
        }

        /** Ctrl+Alt+P: pin the message being read, or unpin it if it already is. */
        async function togglePin() {
            if (!chat.conv) return;
            const at = ChatNav.current(adapter, chat.conv);
            if (!at) {
                notify('Scroll a message into view first', 'warning');
                return;
            }
            const where = { site: adapter.site, conv: chat.id, node: at.id };
            if (ChatPins.isPinned(pinState, adapter.site, chat.id, at.id)) {
                await ChatPins.unpin(where);
                notify('Unpinned', 'info');
                return;
            }
            await ChatPins.pin({
                ...where, title: chat.conv.title, url: adapter.chatUrl(chat.id), excerpt: chat.conv.nodes[at.id].text,
            });
            notify('Pinned — it is in the panel’s Pins tab', 'success');
        }

        function saveLabel(input) {
            const node = input.dataset.bbChatLabel;
            editingPin = null;
            ChatPins.relabel({ site: adapter.site, conv: chat.id, node, label: input.value });
        }

        function heading() {
            if (!chat.id) return [adapter.isNewChat() ? 'New chat' : '', ''];
            if (!chat.conv) return [chat.error ? 'This chat' : 'Reading…', chat.error];
            const path = ChatTree.activePath(chat.conv);
            const prompts = path.filter((id) => chat.conv.nodes[id].role === 'user').length;
            const forks = ChatTree.forks(chat.conv).length;
            return [chat.conv.title, `${plural(prompts, 'prompt')}${forks ? ` · ${plural(forks, 'branch point')}` : ''}`];
        }

        function bodyHtml(tab) {
            // The queue is the one tab a new chat has: prompts queued there
            // make the chat.
            if (tab === 'queue') {
                return queueListHtml(true) || ChatPanel.emptyHtml('Nothing queued. Ctrl+Alt+Q queues what is in the prompt box to go when the answer being written is finished.');
            }
            if (!chat.id) return ChatPanel.emptyHtml('Open a conversation and its outline, branches and pins show up here.');
            if (chat.error) return ChatPanel.emptyHtml(chat.error);
            if (!chat.conv) return ChatPanel.emptyHtml('Reading the conversation…');
            if (tab === 'tree') {
                const forks = ChatTree.forks(chat.conv).length;
                const hint = forks
                    ? `${plural(forks, 'branch point')}. The path the page shows is marked; click any turn to switch the page to it, or shift-click two to compare them.`
                    : 'No branches yet — edit a prompt or ask for another answer and one starts here.';
                return `<p class="bb-chat-hint">${hint}</p>
                    <div class="bb-chat-tree-wrap">${ChatTreeView.render(ChatTree.layout(chat.conv), { picked })}</div>`;
            }
            if (tab === 'pins') {
                const onPath = new Set(path());
                return ChatPanel.pinsHtml(myPins(), { onPath: (node) => onPath.has(node), editing: editingPin });
            }
            return ChatPanel.outlineHtml(outline());
        }

        function onBodyClick(event, tab) {
            if (tab === 'queue') {
                onQueueClick(event);
                return;
            }
            const unpin = event.target.closest('[data-bb-chat-unpin]');
            if (unpin) {
                ChatPins.unpin({ site: adapter.site, conv: chat.id, node: unpin.dataset.bbChatUnpin });
                return;
            }
            const relabel = event.target.closest('[data-bb-chat-relabel]');
            if (relabel) {
                editingPin = relabel.dataset.bbChatRelabel;
                repaint();
                const input = panel.element && panel.element.querySelector('[data-bb-chat-label]');
                if (input) { input.focus(); input.select(); }
                return;
            }
            const entry = event.target.closest('[data-bb-chat-reach]');
            if (entry) goTo(entry.dataset.bbChatReach, entry.dataset.bbChatHeading);
            const node = event.target.closest('[data-bb-chat-node]');
            if (node) {
                // A folded run goes to its first turn; there is no branch
                // inside one to switch to, and nothing in one to compare.
                const id = node.dataset.bbChatNode.replace(/^run:/, '');
                if (event.shiftKey) pick(node.dataset.bbChatNode);
                else goTo(id);
            }
        }

        /** Turns shift-clicked in the tree, waiting for a second to compare with. */
        let picked = [];

        function pick(id) {
            if (/^run:/.test(id)) return;
            picked = picked.includes(id) ? picked.filter((one) => one !== id) : [...picked, id];
            if (picked.length === 2) {
                const [a, b] = picked;
                picked = [];
                ChatCompare.open({
                    conv: chat.conv, a, b,
                    appearance: () => Theme.appearance(),
                    dress: (element, look) => Theme.dress(element, look),
                });
            }
            repaint();
        }

        // ----------------------------------------------------------- export

        let menuOpen = false;

        const setting = (kind) => getSettings()[ChatSites.siteKey(adapter.site, kind)];

        /** The header's actions: Export, and the menu under it when open. */
        function actionsHtml() {
            const libraryButton = '<button type="button" class="bb-chat-act" data-bb-chat-library="1" title="Pick chats from your history and save them as one zip">Library</button>';
            if (!chat.conv) return libraryButton;
            const menu = menuOpen ? `
                <div class="bb-chat-menu" role="menu">
                    <button type="button" role="menuitem" data-bb-chat-export="md">Markdown file</button>
                    <button type="button" role="menuitem" data-bb-chat-export="json">JSON, every branch</button>
                    <button type="button" role="menuitem" data-bb-chat-export="copy">Copy as Markdown</button>
                </div>` : '';
            return `<button type="button" class="bb-chat-act${menuOpen ? ' is-on' : ''}" data-bb-chat-menu="1"
                            aria-haspopup="menu" aria-expanded="${menuOpen}">Export</button>${menu}${libraryButton}`;
        }

        const library = ChatLibrary.createLibrary({
            adapter, notify, getSettings,
            appearance: () => Theme.appearance(),
            dress: (element, look) => Theme.dress(element, look),
        });

        function onHeadClick(event) {
            if (event.target.closest('[data-bb-chat-library]')) {
                menuOpen = false;
                repaint();
                library.open();
                return;
            }
            if (event.target.closest('[data-bb-chat-menu]')) {
                menuOpen = !menuOpen;
                repaint();
                return;
            }
            const item = event.target.closest('[data-bb-chat-export]');
            if (!item) return;
            menuOpen = false;
            repaint();
            exportChat(item.dataset.bbChatExport);
        }

        /**
         * Markdown is the path the page shows, with the site's maths and
         * reasoning settings applied; JSON is the whole tree. The chat is the
         * one in memory — the site's own history, never a copy we stored.
         */
        async function exportChat(format) {
            const conv = chat.conv;
            if (!conv) return;
            if (format === 'json') {
                Dom.download(ChatExport.fileName(conv, 'json'),
                    JSON.stringify(ChatExport.json(conv, { branches: 'all' }), null, 2), 'application/json');
                return;
            }
            const text = ChatExport.markdown(conv, {
                dollars: setting('exportDollars') !== false,
                thinking: setting('exportThinking') === true,
            });
            if (format === 'copy') {
                const ok = await copyText(text);
                notify(ok ? 'Copied the chat as Markdown' : 'Could not copy — try the Markdown file', ok ? 'success' : 'warning');
                return;
            }
            Dom.download(ChatExport.fileName(conv, 'md'), text, 'text/markdown');
        }

        /** Enter names the pin and Escape leaves it as it was. */
        function onBodyKey(event) {
            const input = event.target.closest && event.target.closest('[data-bb-chat-label]');
            if (!input) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                saveLabel(input);
            } else if (event.key === 'Escape') {
                editingPin = null;
                repaint();
            }
        }

        /**
         * Reach a turn from the panel. An overlaid panel steps aside first:
         * it is covering the thread the turn is about to be shown in.
         */
        async function goTo(id, heading = '') {
            if (!chat.conv) return false;
            if (panel.isOpen() && !panel.docked) panel.close();
            // On another branch — a pin, a node in the tree: switch to it,
            // which lands on it as its last step.
            if (!path().includes(id)) return switchBranch(id);
            const here = walk();
            const landed = await ChatNav.reach(adapter, chat.conv, id, { heading, ...here });
            if (!landed && here.alive()) notify('Could not find that turn on the page — scroll to it and try again', 'warning');
            return landed;
        }

        function repaint() {
            if (!panel.isOpen()) return;
            const [title, sub] = heading();
            panel.setHeading(title, sub);
            panel.setActions(actionsHtml());
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
            'chat-pin': () => togglePin(),
            'chat-prompts': () => picker.toggle(),
            'chat-queue': () => queueBox(),
        };

        // ------------------------------------------------------------ queue

        // This page's name on the queue's lease: fresh per UI, which on a
        // real page is once per load.
        const runner = ChatRunner.createRunner({ adapter, pageId: Math.random().toString(36).slice(2, 10), notify, getSettings });

        /**
         * Ctrl+Alt+Q: take what is in the box and queue it behind the answer
         * being written. On the new-chat page it joins the chain already
         * waiting there, so "ask these three in a new chat" stays one chat.
         */
        async function queueBox() {
            const box = adapter.composer();
            const text = box ? Composer.read(box).trim() : '';
            if (!text) {
                notify('Nothing in the prompt box to queue', 'warning');
                return;
            }
            const conv = adapter.convIdOf();
            await PromptQueue.update((state) => {
                const waiting = !conv && PromptQueue.itemsFor(state, adapter.site, null).find((item) => item.status === 'waiting');
                const model = conv ? '' : new URLSearchParams(location.search).get('model') || '';
                return PromptQueue.add(state, { site: adapter.site, conv, chain: waiting ? waiting.chain : undefined, text, model }).state;
            });
            Composer.clear(box);
            notify(adapter.isStreaming() ? 'Queued — it goes when this answer finishes' : 'Queued', 'success');
            runner.tick();
        }

        // --------------------------------------------------- queue strip

        let queueState = PromptQueue.blank();
        let editingItem = null;
        let unwatchQueue = null;

        /** This chat's items: its own, or on the new-chat page every unbound chain. */
        const myItems = () => PromptQueue.itemsFor(queueState, adapter.site, adapter.convIdOf());
        const myKey = () => {
            const first = myItems()[0];
            return first ? PromptQueue.keyOf(first) : PromptQueue.chatKey(adapter.site, adapter.convIdOf(), 'none');
        };
        const writeQueue = (mutate) => PromptQueue.update(mutate);

        async function reloadQueue() {
            queueState = await PromptQueue.load();
            drawStrip();
            if (panel.tab === 'queue') repaint();
        }

        function queueListHtml(head) {
            return ChatQueueView.listHtml(myItems(), {
                paused: !!queueState.paused[myKey()], editing: editingItem, head, resetAt: limit && limit.until,
            });
        }

        /**
         * The strip above the composer, whenever this chat has anything
         * queued. A watcher task and never done: the site rebuilds the area
         * round its composer on its own schedule, strip and all.
         */
        function drawStrip() {
            const html = queueListHtml(true);
            let strip = document.getElementById(STRIP_ID);
            const box = adapter.composerBox();
            if (!html || !box) {
                if (strip) strip.remove();
                return false;
            }
            if (!strip) {
                strip = document.createElement('div');
                strip.id = STRIP_ID;
                strip.className = 'bb-chat-q';
                strip.setAttribute(ChatPanel.KEEP, '1');
                Dom.holdFocus(strip);
                strip.addEventListener('click', onQueueClick);
                Theme.appearance().then((look) => { if (strip.isConnected) Theme.dress(strip, look); });
            }
            if (strip.nextElementSibling !== box) box.parentElement.insertBefore(strip, box);
            if (strip.dataset.bbDrawn !== html) {
                strip.innerHTML = html;
                strip.dataset.bbDrawn = html;
            }
            return false;
        }

        function onQueueClick(event) {
            const next = ChatQueueView.onClick(event, { items: myItems(), key: myKey(), write: writeQueue, editing: editingItem });
            if (next !== editingItem) {
                editingItem = next;
                drawStrip();
                repaint();
                const field = document.querySelector(`#${STRIP_ID} [data-bb-q-text], #bb-chat-panel [data-bb-q-text]`);
                if (field) field.focus();
            }
        }

        // ------------------------------------------------------------ limit

        /** The site's limit notice, read: { text, model, until, blocked }, or null. */
        let limit = null;
        /** The reset time of a chip that was waved away; it stays away until the time changes. */
        let dismissedAt = 0;
        let heldUntil = 0;

        const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

        /**
         * The watcher task: read the notice, hold the queue on one that blocks
         * sending outright, and offer the chip on one that only falls back to
         * a smaller model. Never done — notices come and go.
         */
        function watchLimit() {
            // A site that reports its limit exactly — Claude's completion
            // stream carries the reset as an epoch — wins over the banner,
            // whose time of day is parsed; the banner is the fallback.
            const exact = adapter.limit ? adapter.limit() : null;
            const text = exact ? '' : adapter.limitNotice();
            const read = exact || (text ? ChatSites.readLimit(adapter.site, text) : null);
            const was = limit && `${limit.until}/${limit.blocked}/${limit.approaching}`;
            limit = read ? { ...read, text, window: read.window || (limit && limit.until === read.until ? limit.window : '') } : null;
            if (limit && limit.blocked) {
                holdForLimit(limit);
                nameWindow(limit);
            }
            if (was !== (limit && `${limit.until}/${limit.blocked}/${limit.approaching}`)) drawStrip();
            drawChip();
            return false;
        }

        /**
         * Which allowance ran out, when the site has more than one and the
         * notice did not say: the five-hour session and the week are very
         * different waits, and holding a queue until Monday is something to
         * be told plainly. Asked of the site once per reset time.
         */
        let namedFor = 0;
        async function nameWindow(read) {
            if (read.window || !adapter.usage || !read.until || namedFor === read.until) return;
            namedFor = read.until;
            const usage = await adapter.usage().catch(() => null);
            if (!usage || !limit || limit.until !== read.until) return;
            const closest = Object.entries(usage).filter(([, w]) => w && w.resetsAt)
                .sort(([, a], [, b]) => Math.abs(a.resetsAt - read.until) - Math.abs(b.resetsAt - read.until))[0];
            if (closest) {
                limit.window = closest[0];
                drawChip();
            }
        }

        /** "your 5-hour session resets at 5:00 PM", "your weekly limit resets Monday at 9:00 AM". */
        function windowText(read) {
            if (!read.until) return 'the site did not say when it resets';
            const day = new Date(read.until).toLocaleDateString([], { weekday: 'long' });
            if (read.window === 'weekly') return `your weekly limit resets ${day} at ${clock(read.until)}`;
            if (read.window === 'session') return `your 5-hour session resets at ${clock(read.until)}`;
            return `it resets at ${clock(read.until)}`;
        }

        /**
         * A blocking notice holds the site's queue by itself, until a minute
         * past the time it names — the reset is rounded, and a send a minute
         * early is a wasted one. With no time to read, a quarter of an hour,
         * and then it is looked at again.
         *
         * A hold already standing is not written again for a time that only
         * moved with the clock. "Try again in 30 minutes", or no time at all,
         * gave a new `until` on every pass of the watcher, and the queue was
         * rewritten — and sent to every chat tab, the worker and the
         * dashboard — every time the page so much as changed.
         */
        function holdForLimit(read) {
            const now = Date.now();
            const until = (read.until || now + 15 * 60000) + 60000;
            if (until === heldUntil) return;
            if (heldUntil > now && (!read.until || Math.abs(until - heldUntil) < 60000)) return;
            heldUntil = until;
            writeQueue((state) => PromptQueue.hold(state, adapter.site, until, read.model ? `${read.model} limit` : 'usage limit'));
        }

        function drawChip() {
            let chip = document.getElementById(CHIP_ID);
            const box = adapter.composerBox();
            const held = !!(limit && limit.blocked);
            const offer = !!(limit && limit.until && !held && setting('limitSuggest') !== false && dismissedAt !== limit.until);
            if (!box || !(held || offer)) {
                if (chip) chip.remove();
                return;
            }
            const name = (ChatSites.get(adapter.site) || {}).name || 'The site';
            const dismiss = '<button type="button" class="bb-chat-limit-x" data-bb-limit="dismiss" aria-label="Dismiss">×</button>';
            let html;
            if (held) {
                html = `<span>${Dom.escapeHtml(name)} says a limit has been reached — ${Dom.escapeHtml(windowText(limit))}, and your queue waits until then.</span>`;
            } else if (limit.approaching) {
                // Nearly out: nothing is falling back yet, so the offer is
                // only to keep what is queued for after the reset.
                const left = Number.isFinite(limit.remaining) ? `${limit.remaining} message${limit.remaining === 1 ? '' : 's'} left` : 'Nearly at the limit';
                html = `<span>${Dom.escapeHtml(left)} until ${Dom.escapeHtml(clock(limit.until))}</span>
                   <button type="button" data-bb-limit="hold">Hold the rest of my queue until then</button>${dismiss}`;
            } else {
                html = `<span>${Dom.escapeHtml(limit.model || 'The better model')} is back after ${Dom.escapeHtml(clock(limit.until))}</span>
                   <button type="button" data-bb-limit="hold">Hold my queue until then</button>
                   <button type="button" data-bb-limit="later">Queue this for then</button>${dismiss}`;
            }
            if (!chip) {
                chip = document.createElement('div');
                chip.id = CHIP_ID;
                chip.className = 'bb-chat-limit';
                chip.setAttribute(ChatPanel.KEEP, '1');
                Dom.holdFocus(chip);
                chip.addEventListener('click', onChipClick);
                Theme.appearance().then((look) => { if (chip.isConnected) Theme.dress(chip, look); });
            }
            const before = document.getElementById(STRIP_ID) || box;
            if (chip.nextElementSibling !== before) before.parentElement.insertBefore(chip, before);
            if (chip.dataset.bbDrawn !== html) {
                chip.innerHTML = html;
                chip.dataset.bbDrawn = html;
            }
        }

        async function onChipClick(event) {
            const button = event.target.closest('[data-bb-limit]');
            if (!button || !limit) return;
            const until = limit.until + 60000;
            const verb = button.dataset.bbLimit;
            if (verb === 'dismiss') dismissedAt = limit.until;
            if (verb === 'hold') {
                await writeQueue((state) => PromptQueue.hold(state, adapter.site, until, `${limit.model || 'model'} limit`));
                notify(`Your queue waits until ${clock(until)}`, 'success');
            }
            if (verb === 'later') {
                const box = adapter.composer();
                const text = box ? Composer.read(box).trim() : '';
                if (!text) { notify('Nothing in the prompt box to queue', 'warning'); return; }
                const conv = adapter.convIdOf();
                // A new chat can say which model it wants in its address, so
                // the scheduled tab opens on the model that was out.
                const model = conv ? '' : String(limit.model || '').toLowerCase().replace(/\s+/g, '-');
                await writeQueue((state) => PromptQueue.add(state, { site: adapter.site, conv, text, model, notBefore: until }).state);
                Composer.clear(box);
                notify(`Queued for ${clock(until)}`, 'success');
            }
            drawChip();
        }

        // ---------------------------------------------------- composer tools

        /**
         * Prompts and Queue beside the site's own composer buttons. Off until
         * asked for (`<site>ComposerTools`), by the rule the X and LeetCode
         * surfaces follow: it is the extension drawing into somebody else's
         * composer. The hotkeys and the panel reach both either way.
         *
         * Never done: the composer is rebuilt on every navigation.
         */
        function injectTools() {
            const placed = document.getElementById(TOOLS_ID);
            if (setting('composerTools') !== true) {
                if (placed) placed.remove();
                return false;
            }
            const slot = adapter.composerSlot();
            if (!slot || (placed && slot.contains(placed))) return false;
            if (placed) placed.remove();
            const tools = document.createElement('span');
            tools.id = TOOLS_ID;
            tools.className = 'bb-chat-tools';
            tools.setAttribute(ChatPanel.KEEP, '1');
            tools.innerHTML = `
                <button type="button" class="bb-chat-tool" data-bb-tool="prompts" title="Insert a prompt template (Ctrl+Alt+I)">Prompts</button>
                <button type="button" class="bb-chat-tool" data-bb-tool="queue" title="Queue what is in the box (Ctrl+Alt+Q)">Queue</button>`;
            Dom.holdFocus(tools);
            tools.addEventListener('click', (event) => {
                const button = event.target.closest('[data-bb-tool]');
                if (!button) return;
                event.preventDefault();
                event.stopPropagation();
                if (button.dataset.bbTool === 'prompts') picker.toggle();
                else queueBox();
            });
            slot.appendChild(tools);
            return false;
        }

        const picker = ChatPicker.createPicker({
            site: adapter.site,
            composer: () => adapter.composer(),
            notify,
            appearance: () => Theme.appearance(),
            dress: (element, look) => Theme.dress(element, look),
        });

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
            return ChatNav.step(adapter, chat.conv, direction, walk());
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
         *
         * A toggle already placed is moved when the slot is somewhere else.
         * claude.ai draws its header before the actions beside Share, and a
         * toggle put wherever the header first offered stayed there for the
         * whole session — at the header's left edge, nowhere near Share.
         */
        function injectToggle() {
            const slot = adapter.headerSlot();
            const placed = document.getElementById(TOGGLE_ID);
            if (placed) {
                if (slot && placed.parentElement !== slot) slot.prepend(placed);
                return false;
            }
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
            // These walk every mounted turn, and a streaming answer mutates
            // the page on every frame: on a long Claude thread that was each
            // row's text fingerprinted several times a frame. A mark or a
            // refetch a fifth of a second late is not seen to be.
            watcher.add('chat-sync', sync, { every: 200 });
            watcher.add('chat-pin-marks', markPinned, { every: 150 });
            // A pin made in another tab, or taken off in the dashboard, is
            // drawn here as it happens.
            unwatchPins = Settings.watch([ChatPins.KEY], reloadPins);
            reloadPins();
            runner.start();
            // Redrawn directly whenever the queue or the limit changes; the
            // watcher only puts them back when the site rebuilds the area
            // round its composer, and reads the site's notice.
            watcher.add('chat-queue-strip', drawStrip, { every: 250 });
            watcher.add('chat-limit', watchLimit, { every: 500 });
            watcher.add('chat-composer-tools', injectTools);
            unwatchQueue = Settings.watch([PromptQueue.KEY], reloadQueue);
            reloadQueue();
            readLanding();
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
            watcher.remove('chat-pin-marks');
            if (unwatchPins) unwatchPins();
            document.querySelectorAll(`[${PINNED}]`).forEach((element) => element.removeAttribute(PINNED));
            window.removeEventListener('scroll', onScroll, { capture: true, passive: true });
            document.removeEventListener('keydown', onHotkey, true);
            clearTimeout(refetchTimer);
            picker.close();
            runner.stop();
            watcher.remove('chat-queue-strip');
            watcher.remove('chat-limit');
            watcher.remove('chat-composer-tools');
            const tools = document.getElementById(TOOLS_ID);
            if (tools) tools.remove();
            const chip = document.getElementById(CHIP_ID);
            if (chip) chip.remove();
            if (unwatchQueue) unwatchQueue();
            const strip = document.getElementById(STRIP_ID);
            if (strip) strip.remove();
            chat.token++;
            visit++;
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
                visit++;
                chat.loading = false;
                lastUnknown = '';
                if (id) load(id);
            }
            panel.place();
            repaint();
            runner.tick();
        }

        /** A setting changed in the dashboard; both directions, on the open page. */
        function refreshSurfaces() {
            // Both directions, on the page already open: a switch that only
            // took effect on the next load would read as a switch that did
            // nothing. Turning a surface off is the half that needs code.
            injectTools();
            drawChip();
            repaint();
            watcher.schedule();
        }

        return {
            install, uninstall, onNavigate, openPouch, refreshSurfaces, panel, injectToggle, goTo, onHotkey, isAltGr,
            // The watcher's task, for the specs, which have no watcher running.
            syncNow: sync,
            limitNow: watchLimit,
            markNow: markPinned,
            /** The worker says a scheduled prompt is due: look now rather than at the next cue. */
            wakeQueue: () => runner.tick(),
            runner,
            conversation: () => chat.conv,
            reload: () => (chat.id ? load(chat.id) : Promise.resolve()),
        };
    }

    const ChatUi = { createChatUi, TOGGLE_ID, REFETCH_MS };

    root.BB = root.BB || {};
    root.BB.ChatUi = ChatUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
