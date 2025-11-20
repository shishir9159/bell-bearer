/**
 * The dashboard's chat panels: every pinned turn on a site, the prompt
 * templates, and the queue — one of each per chat site, filled into
 * `[data-chat-pins="<site>"]`, `[data-chat-prompts]` and
 * `[data-chat-queue="<site>"]`.
 *
 * The split the X pouch keeps: on the chat site you pin, insert and queue
 * with the conversation in front of you, and here is where the whole list is
 * looked at and tidied. Nothing here can read a conversation — the dashboard
 * has no session on the site — so everything it shows is what the stores
 * kept, and opening a pin is opening the chat and letting the page land on it.
 *
 * Rendered wholesale into innerHTML with one delegated listener per panel,
 * as everything else on this page is.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Settings, ChatSites, ChatPins, Dom, Ui } = BB;

    const esc = Dom.escapeHtml;
    const att = Dom.escapeAttr;

    const day = (ms) => (ms ? new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '');

    // ---------------------------------------------------------------- pins

    /**
     * Opening a pin opens its chat with the turn named in the address. The
     * page reads `#bb-node=`, drops it with history.replaceState, and reaches
     * the turn once the conversation has loaded — see src/content/chat-ui.js.
     */
    const pinUrl = (pin) => `${pin.url || ChatSites.get(pin.site).chatUrl(pin.conv)}#bb-node=${encodeURIComponent(pin.node)}`;

    function mountPins(host, siteId) {
        let pins = [];
        /** The last pin taken off, for Undo. */
        let undone = null;

        host.innerHTML = `
            <div class="subscriptions-header"><h2>Pins</h2></div>
            <p class="x-pouch-hint">The turns you pinned in ${esc(ChatSites.get(siteId).name)} chats, newest first. On the
               site, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd> pins the message you are reading; the panel's Pins tab lists a chat's own.</p>
            <div class="chat-view-undo" hidden></div>
            <div class="chat-view-list"></div>`;
        const list = host.querySelector('.chat-view-list');
        const undoBar = host.querySelector('.chat-view-undo');

        function paint() {
            list.innerHTML = pins.length ? pins.map((pin) => `
                <div class="chat-view-row" data-chat-pin="${att(pin.conv)}|${att(pin.node)}">
                    <div class="chat-view-main">
                        <span class="chat-view-title">${esc(pin.label || pin.excerpt || 'Pinned message')}</span>
                        <span class="chat-view-sub">${esc(pin.title || 'Untitled chat')} · pinned ${esc(day(pin.at))}</span>
                        ${pin.label && pin.excerpt ? `<span class="chat-view-excerpt">${esc(pin.excerpt)}</span>` : ''}
                    </div>
                    <div class="chat-view-actions">
                        <a class="btn-small" href="${Dom.safeUrlAttr(pinUrl(pin))}" target="_blank" rel="noopener noreferrer">Open</a>
                        <button type="button" class="btn-small" data-chat-relabel="1">Name</button>
                        <button type="button" class="btn-small delete" data-chat-unpin="1">Unpin</button>
                    </div>
                </div>`).join('')
                : '<div class="empty-inline"><span>Nothing pinned yet.</span></div>';
            undoBar.hidden = !undone;
            undoBar.innerHTML = undone ? `<span>Unpinned “${esc(undone.label || undone.excerpt || 'a message')}”.</span>
                <button type="button" class="btn-small" data-chat-undo="1">Undo</button>` : '';
        }

        const find = (row) => {
            const [conv, node] = row.dataset.chatPin.split('|');
            return pins.find((pin) => pin.conv === conv && pin.node === node);
        };

        list.addEventListener('click', async (event) => {
            const row = event.target.closest('[data-chat-pin]');
            const pin = row && find(row);
            if (!pin) return;
            if (event.target.closest('[data-chat-relabel]')) {
                const label = await Ui.promptDialog({ title: 'Name this pin', label: 'A name to find it by', value: pin.label, placeholder: pin.excerpt });
                if (label !== null) await ChatPins.relabel({ site: siteId, conv: pin.conv, node: pin.node, label });
            } else if (event.target.closest('[data-chat-unpin]')) {
                undone = pin;
                await ChatPins.unpin({ site: siteId, conv: pin.conv, node: pin.node });
            }
        });

        undoBar.addEventListener('click', async (event) => {
            if (!event.target.closest('[data-chat-undo]') || !undone) return;
            const pin = undone;
            undone = null;
            await ChatPins.pin({ site: siteId, conv: pin.conv, node: pin.node, title: pin.title, url: pin.url, excerpt: pin.excerpt, now: pin.at });
            if (pin.label) await ChatPins.relabel({ site: siteId, conv: pin.conv, node: pin.node, label: pin.label });
        });

        async function reload() {
            pins = ChatPins.all(await ChatPins.load(), siteId);
            paint();
        }
        return { reload };
    }

    /** Fill every chat panel on the page and keep each current. */
    function mountAll(scope = document) {
        const watched = [];
        scope.querySelectorAll('[data-chat-pins]').forEach((host) => {
            if (!ChatSites.get(host.dataset.chatPins)) return;
            const view = mountPins(host, host.dataset.chatPins);
            view.reload();
            watched.push([ChatPins.KEYS, view]);
        });
        // A pin made on the site, in another tab, arrives while this is open.
        for (const [keys, view] of watched) Settings.watch(keys, () => view.reload());
    }

    BB.ChatViews = { mountAll, mountPins, pinUrl };
})(typeof globalThis !== 'undefined' ? globalThis : this);
