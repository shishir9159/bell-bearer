/**
 * The dashboard's Templates panel: where code templates are actually managed.
 *
 * The same split the X pouch keeps. The panel on leetcode.com reads, inserts
 * and saves a selection — the things you do with the editor in front of you —
 * and everything that changes the shape of the library happens here:
 * reordering it, rewriting a body at a comfortable size, changing which
 * language a template belongs to, deleting one. Those are decisions you make
 * while looking at the whole list, not while solving a problem.
 *
 * Rendered wholesale into innerHTML with listeners bound once on the
 * container and dispatched by delegation, as everything else on this page is.
 *
 * A template body is the user's own code and goes through escapeHtml like
 * anything else; it is also the one field here where whitespace is load-
 * bearing, which is why it is a <textarea> with `white-space: pre` rather
 * than an input.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Settings, LeetTemplates, Dom, Ui, Icons } = BB;

    const esc = Dom.escapeHtml;
    const att = Dom.escapeAttr;

    const ICONS = {
        grip: Icons.svg('dots-six-vertical'),
        trash: Icons.svg('trash'),
    };

    function mountPanel(host) {
        let templates = [];
        /** The id open in the editor, 'new', or null. Not persisted. */
        let editing = null;
        let dragId = null;

        host.innerHTML = `
            <div class="subscriptions-header">
                <h2>Templates</h2>
                <div class="subscriptions-controls">
                    <button class="btn-primary" data-leet-tpl-new="1">+ New template</button>
                </div>
            </div>
            <p class="x-pouch-hint">Snippets to paste before you start. Nothing ships with the extension —
               these are yours. On leetcode.com, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> offers the ones
               for the language you are in, and saves the editor's selection as a new one. Drag to reorder.</p>
            <div class="leet-tpl-manage"></div>`;

        const list = host.querySelector('.leet-tpl-manage');

        function paint() {
            const open = editing === 'new'
                ? { id: 'new', name: '', lang: '', body: '', uses: 0 }
                : templates.find((template) => template.id === editing);

            list.innerHTML = `
                ${templates.length || open ? '' : emptyHtml()}
                ${templates.map((template) => rowHtml(template, open)).join('')}
                ${open && open.id === 'new' ? editorHtml(open) : ''}`;

            const field = list.querySelector('.leet-tpl-name-input');
            if (field && open && open.id === 'new') field.focus();
        }

        const emptyHtml = () => `
            <div class="empty-inline">
                <span>No templates yet. Make one here, or select working code on LeetCode and press
                <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>.</span>
            </div>`;

        function rowHtml(template, open) {
            const isOpen = open && open.id === template.id;
            const lines = template.body ? template.body.split('\n').length : 0;
            return `
                <div class="leet-tpl-item${isOpen ? ' is-open' : ''}" data-leet-tpl-id="${att(template.id)}" draggable="true">
                    <div class="leet-tpl-bar">
                        <span class="leet-tpl-grip" title="Drag to reorder" aria-hidden="true">${ICONS.grip}</span>
                        <button type="button" class="leet-tpl-open" data-leet-tpl-edit="${att(template.id)}">
                            <span class="leet-tpl-title">${esc(template.name)}</span>
                            <span class="leet-tpl-sub">${esc(LeetTemplates.labelFor(template.lang))}${
                                lines ? ` · ${lines} line${lines === 1 ? '' : 's'}` : ' · empty'}${
                                template.uses ? ` · used ${template.uses}×` : ''}</span>
                        </button>
                        <button type="button" class="leet-tpl-del" data-leet-tpl-delete="${att(template.id)}"
                                title="Delete this template" aria-label="Delete this template">${ICONS.trash}</button>
                    </div>
                    ${isOpen ? editorHtml(template) : ''}
                </div>`;
        }

        function editorHtml(template) {
            const langs = LeetTemplates.list();
            return `
                <div class="leet-tpl-editor"${template.id === 'new' ? ' data-leet-tpl-id="new"' : ''}>
                    <div class="leet-tpl-fields">
                        <input type="text" class="modal-input leet-tpl-name-input" placeholder="What is it called?"
                               value="${att(template.name)}" maxlength="${LeetTemplates.NAME_CAP}">
                        <select class="modal-input leet-tpl-lang-input">
                            <option value=""${template.lang ? '' : ' selected'}>Any language</option>
                            ${langs.map((entry) => `
                                <option value="${att(entry.id)}"${entry.id === template.lang ? ' selected' : ''}>${esc(entry.label)}</option>`).join('')}
                        </select>
                    </div>
                    <textarea class="modal-input leet-tpl-body-input" rows="12" spellcheck="false"
                              placeholder="The code to paste in">${esc(template.body)}</textarea>
                    <div class="leet-tpl-actions">
                        <button type="button" class="btn-primary" data-leet-tpl-save="${att(template.id)}">Save</button>
                        <button type="button" class="btn-secondary" data-leet-tpl-cancel="1">Cancel</button>
                    </div>
                </div>`;
        }

        /** What the three controls in the open editor hold right now. */
        function readForm() {
            const name = list.querySelector('.leet-tpl-name-input');
            const lang = list.querySelector('.leet-tpl-lang-input');
            const body = list.querySelector('.leet-tpl-body-input');
            if (!name || !lang || !body) return null;
            return { name: name.value, lang: lang.value, body: body.value };
        }

        async function save(id) {
            const form = readForm();
            if (!form) return;
            if (!form.name.trim()) {
                Ui.toast('Give the template a name first', 'warning');
                return;
            }
            if (id === 'new') await LeetTemplates.create(form);
            else await LeetTemplates.edit(id, form);
            editing = null;
            await reload();
        }

        async function remove(id) {
            const template = templates.find((entry) => entry.id === id);
            if (!template) return;
            const ok = await Ui.confirmDialog({
                title: 'Delete this template?',
                message: `"${template.name}" is deleted. There is no copy of it anywhere else.`,
                confirmLabel: 'Delete it',
                danger: true,
            });
            if (!ok) return;
            if (editing === id) editing = null;
            await LeetTemplates.remove(id);
            await reload();
        }

        // ---------------------------------------------------------- wiring

        list.addEventListener('click', (event) => {
            const edit = event.target.closest('[data-leet-tpl-edit]');
            if (edit) {
                const id = edit.dataset.leetTplEdit;
                editing = editing === id ? null : id;
                paint();
                return;
            }
            const del = event.target.closest('[data-leet-tpl-delete]');
            if (del) return void remove(del.dataset.leetTplDelete);

            const saveButton = event.target.closest('[data-leet-tpl-save]');
            if (saveButton) return void save(saveButton.dataset.leetTplSave);

            if (event.target.closest('[data-leet-tpl-cancel]')) {
                editing = null;
                paint();
            }
        });

        host.querySelector('[data-leet-tpl-new]').addEventListener('click', () => {
            editing = 'new';
            paint();
        });

        /**
         * Reordering. Array order is display order, so a drop is a splice and
         * nothing else is stored — the same arrangement the pouch topic lists
         * use, and the same delegated dragstart/dragover/drop.
         */
        list.addEventListener('dragstart', (event) => {
            const item = event.target.closest('[data-leet-tpl-id]');
            if (!item || item.dataset.leetTplId === 'new') return;
            dragId = item.dataset.leetTplId;
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });

        list.addEventListener('dragover', (event) => {
            if (dragId) event.preventDefault();
        });

        list.addEventListener('drop', async (event) => {
            const item = event.target.closest('[data-leet-tpl-id]');
            if (!dragId || !item) return;
            event.preventDefault();
            const over = item.dataset.leetTplId;
            const moving = dragId;
            dragId = null;
            if (!over || over === moving || over === 'new') return;
            await LeetTemplates.move(moving, over);
            await reload();
        });

        list.addEventListener('dragend', () => { dragId = null; });

        async function reload() {
            templates = await LeetTemplates.load();
            paint();
        }

        return { reload, render: paint };
    }

    /** Draw every `[data-leet-templates]` panel and keep it current. */
    function mountAll(scope = document) {
        const hosts = Array.from(scope.querySelectorAll('[data-leet-templates]'));
        if (!hosts.length) return;

        const panels = hosts.map((host) => {
            const panel = mountPanel(host);
            panel.reload();
            return panel;
        });

        // Saving a selection on leetcode.com writes the same key from another
        // tab; a list that only read on load would be stale while somebody is
        // actively filling it.
        Settings.watch(LeetTemplates.KEYS, () => panels.forEach((panel) => panel.reload()));
    }

    BB.LeetTemplatesView = { mountAll, mountPanel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
