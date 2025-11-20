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

    // ------------------------------------------------------------- prompts

    const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

    /**
     * The prompt templates, which every chat site shares. The rows are the
     * LeetCode templates list's own (src/page/leet-templates-view.js) — the
     * same list, with sites where that one has languages — so they wear its
     * styling. A prompt is several lines of prose, so it is edited in a dialog
     * at a comfortable size rather than in the row.
     */
    function mountPrompts(host) {
        const { PromptTemplates } = BB;
        let templates = [];
        let dragId = null;

        host.innerHTML = `
            <div class="subscriptions-header">
                <h2>Prompts</h2>
                <div class="subscriptions-controls">
                    <button class="btn-secondary" data-chat-restore="1">Restore the starters</button>
                    <button class="btn-primary" data-chat-new="1">+ New prompt</button>
                </div>
            </div>
            <p class="x-pouch-hint">Prompts you would otherwise retype. On a chat site, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd>
               offers them — last used first — and puts one in the prompt box. <code>{{name}}</code> asks for a value when it is
               used; <code>{{selection}}</code> is whatever you had selected on the page. Drag to reorder.</p>
            <div class="leet-tpl-manage"></div>`;
        const list = host.querySelector('.leet-tpl-manage');

        const sitesText = (template) => (template.sites.length
            ? template.sites.map((id) => ChatSites.get(id).name).join(', ') : 'every chat site');

        function paint() {
            list.innerHTML = templates.length ? templates.map((template) => {
                const fields = PromptTemplates.fields(template.body);
                return `<div class="leet-tpl-item" data-chat-prompt="${att(template.id)}" draggable="true">
                    <div class="leet-tpl-bar">
                        <span class="leet-tpl-grip" title="Drag to reorder" aria-hidden="true">${GRIP}</span>
                        <button type="button" class="leet-tpl-open" data-chat-edit="1">
                            <span class="leet-tpl-title">${esc(template.name)}</span>
                            <span class="leet-tpl-sub">${esc(sitesText(template))}${fields.length ? ` · asks for ${esc(fields.join(', '))}` : ''}${template.uses ? ` · used ${template.uses}×` : ''}</span>
                        </button>
                        <button type="button" class="leet-tpl-del" data-chat-delete="1" title="Delete this prompt" aria-label="Delete this prompt">×</button>
                    </div>
                </div>`;
            }).join('') : '<div class="empty-inline"><span>No prompts. Make one, or put the starters back.</span></div>';
        }

        /** The edit dialog; `template` null makes a new one. */
        function edit(template) {
            const value = template || { name: '', body: '', sites: [] };
            const modal = Ui.openModal(`
                <h3>${template ? 'Edit prompt' : 'New prompt'}</h3>
                <input type="text" class="modal-input chat-prompt-name" placeholder="What is it called?" value="${att(value.name)}" maxlength="${PromptTemplates.NAME_CAP}">
                <textarea class="modal-input chat-prompt-body" rows="12" placeholder="The prompt. {{fields}} are asked for when it is used.">${esc(value.body)}</textarea>
                <div class="chat-prompt-sites">Offered on: ${ChatSites.list().map((site) => `
                    <label><input type="checkbox" value="${att(site.id)}"${value.sites.includes(site.id) ? ' checked' : ''}> ${esc(site.name)}</label>`).join('')}
                    <span class="chat-prompt-hint">— none ticked is every one</span></div>
                <div class="import-modal-buttons">
                    <button class="btn-primary" data-chat-save="1">Save</button>
                    <button class="import-modal-close">Cancel</button>
                </div>`);
            const $ = (selector) => modal.element.querySelector(selector);
            $('.chat-prompt-name').focus();
            $('[data-chat-save]').addEventListener('click', async () => {
                const form = {
                    name: $('.chat-prompt-name').value,
                    body: $('.chat-prompt-body').value,
                    sites: Array.from(modal.element.querySelectorAll('.chat-prompt-sites input:checked'), (box) => box.value),
                };
                if (!form.name.trim() || !form.body.trim()) {
                    Ui.toast('A prompt needs a name and something to say', 'warning');
                    return;
                }
                if (template) await PromptTemplates.edit(template.id, form);
                else await PromptTemplates.create(form);
                modal.close();
            });
        }

        list.addEventListener('click', async (event) => {
            const item = event.target.closest('[data-chat-prompt]');
            const template = item && templates.find((one) => one.id === item.dataset.chatPrompt);
            if (!template) return;
            if (event.target.closest('[data-chat-edit]')) edit(template);
            if (event.target.closest('[data-chat-delete]')) {
                const ok = await Ui.confirmDialog({
                    title: 'Delete this prompt?', message: `"${template.name}" is deleted. A starter can be put back; your own cannot.`,
                    confirmLabel: 'Delete it', danger: true,
                });
                if (ok) await PromptTemplates.remove(template.id);
            }
        });
        host.querySelector('[data-chat-new]').addEventListener('click', () => edit(null));
        host.querySelector('[data-chat-restore]').addEventListener('click', async () => {
            const before = templates.length;
            const after = await PromptTemplates.restoreStarters();
            Ui.toast(after.length > before ? `Put back ${after.length - before} starter${after.length - before === 1 ? '' : 's'}` : 'Every starter is already here', 'info');
        });

        // Reordering: the same delegated drag the templates list uses.
        list.addEventListener('dragstart', (event) => {
            const item = event.target.closest('[data-chat-prompt]');
            if (item) dragId = item.dataset.chatPrompt;
        });
        list.addEventListener('dragover', (event) => { if (dragId) event.preventDefault(); });
        list.addEventListener('drop', async (event) => {
            const item = event.target.closest('[data-chat-prompt]');
            const moving = dragId;
            dragId = null;
            if (!moving || !item || item.dataset.chatPrompt === moving) return;
            event.preventDefault();
            await PromptTemplates.move(moving, item.dataset.chatPrompt);
        });
        list.addEventListener('dragend', () => { dragId = null; });

        async function reload() {
            templates = await PromptTemplates.load();
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
        scope.querySelectorAll('[data-chat-prompts]').forEach((host) => {
            const view = mountPrompts(host);
            view.reload();
            watched.push([BB.PromptTemplates.KEYS, view]);
        });
        // A pin made on the site, in another tab, arrives while this is open.
        for (const [keys, view] of watched) Settings.watch(keys, () => view.reload());
    }

    BB.ChatViews = { mountAll, mountPins, mountPrompts, pinUrl };
})(typeof globalThis !== 'undefined' ? globalThis : this);
