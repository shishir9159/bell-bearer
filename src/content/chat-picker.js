/**
 * The prompt picker: a small list over a chat site, filtered as you type,
 * that puts a template into the composer.
 *
 * It is the LeetCode suggester (src/content/leet-ui.js) with prose in place
 * of code: this site's templates, most recently used first, arrows and Enter.
 * A template with `{{fields}}` asks for them before it goes in — one box per
 * field, and a tall one for the fields that take a block of something, code
 * or a log. And "Save what is in the box as a template" is always a row while
 * the composer has text, with whatever was typed into the filter as its name:
 * what you typed looking for a template that turned out not to exist is what
 * that template should be called.
 *
 * `{{selection}}` is whatever was selected on the page when the picker
 * opened, read before the picker takes the focus and loses it.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const PromptTemplates = ns.PromptTemplates || req('../shared/prompt-templates.js');
    const Composer = ns.Composer || req('./composer.js');

    const PICKER_ID = 'bb-chat-picker';
    /** Fields that hold a block of something rather than a phrase. */
    const TALL = /^(code|text|error|plan|log|diff)$/;

    const esc = (text) => Dom.escapeHtml(text);

    /**
     * @param {object} deps
     * @param {string} deps.site
     * @param {() => Element|null} deps.composer   the site's prompt box
     */
    function createPicker({ site, composer, notify, appearance, dress }) {
        let state = null;

        const isOpen = () => !!state;

        function close() {
            if (!state) return;
            state.element.remove();
            document.removeEventListener('keydown', onKey, true);
            state = null;
        }

        function open() {
            close();
            if (!document.body) return;
            const selection = String((window.getSelection && window.getSelection()) || '').trim();
            const box = composer();
            const element = document.createElement('div');
            element.id = PICKER_ID;
            element.className = 'bb-chat-picker';
            element.setAttribute('data-bb-keep-panel', '1');
            element.setAttribute('role', 'dialog');
            element.setAttribute('aria-label', 'Insert a prompt template');
            element.innerHTML = `
                <input type="text" class="bb-input bb-chat-picker-q" placeholder="Filter prompts…" aria-label="Filter prompts" spellcheck="false">
                <div class="bb-chat-picker-body"></div>
                <div class="bb-chat-picker-foot"></div>`;
            document.body.appendChild(element);
            Dom.holdFocus(element);
            appearance().then((look) => { if (element.isConnected) dress(element, look); });

            state = {
                element, selection, index: 0, rows: [], templates: [], filling: null,
                boxText: box ? Composer.read(box) : '',
            };
            const query = element.querySelector('.bb-chat-picker-q');
            query.addEventListener('input', () => { state.index = 0; draw(); });
            element.querySelector('.bb-chat-picker-body').addEventListener('click', (event) => {
                const row = event.target.closest('[data-bb-pick]');
                if (row) pick(Number(row.dataset.bbPick));
                if (event.target.closest('[data-bb-fill-go]')) insertFilled();
                if (event.target.closest('[data-bb-fill-back]')) { state.filling = null; draw(); query.focus(); }
            });
            document.addEventListener('keydown', onKey, true);

            PromptTemplates.load().then((templates) => {
                if (!state || state.element !== element) return;
                state.templates = templates;
                draw();
            });
            draw();
            query.focus();
        }

        const toggle = () => (state ? close() : open());

        function rows() {
            const text = state.element.querySelector('.bb-chat-picker-q').value;
            const out = PromptTemplates.search(state.templates, site, text).map((template) => ({ kind: 'insert', template }));
            if (state.boxText.trim()) out.unshift({ kind: 'save' });
            return out;
        }

        function draw() {
            if (!state) return;
            const body = state.element.querySelector('.bb-chat-picker-body');
            const foot = state.element.querySelector('.bb-chat-picker-foot');
            state.element.querySelector('.bb-chat-picker-q').hidden = !!state.filling;
            if (state.filling) {
                const { template, fields } = state.filling;
                body.innerHTML = `<p class="bb-chat-picker-title">${esc(template.name)}</p>${fields.map((name, index) => `
                    <label class="bb-chat-picker-field"><span>${esc(name)}</span>
                        ${TALL.test(name)
                            ? `<textarea class="bb-input" rows="5" data-bb-field="${Dom.escapeAttr(name)}" spellcheck="false"${index ? '' : ' autofocus'}></textarea>`
                            : `<input type="text" class="bb-input" data-bb-field="${Dom.escapeAttr(name)}">`}
                    </label>`).join('')}
                    <div class="bb-chat-picker-actions">
                        <button type="button" class="bb-btn" data-bb-fill-back="1">Back</button>
                        <button type="button" class="bb-btn bb-btn-primary" data-bb-fill-go="1">Insert</button>
                    </div>`;
                foot.textContent = 'Ctrl+Enter to insert · Esc to go back';
                return;
            }
            state.rows = rows();
            state.index = Math.min(state.index, Math.max(0, state.rows.length - 1));
            body.innerHTML = state.rows.length ? `<div class="bb-chat-picker-list" role="listbox">${state.rows.map((row, index) => {
                const on = index === state.index ? ' is-on' : '';
                if (row.kind === 'save') {
                    return `<button type="button" class="bb-chat-picker-row is-save${on}" data-bb-pick="${index}" role="option">
                        <span class="bb-chat-picker-name">Save what is in the box as a template…</span></button>`;
                }
                const fields = PromptTemplates.fields(row.template.body);
                return `<button type="button" class="bb-chat-picker-row${on}" data-bb-pick="${index}" role="option">
                    <span class="bb-chat-picker-name">${esc(row.template.name)}</span>
                    ${fields.length ? `<span class="bb-chat-picker-fields">${esc(fields.join(', '))}</span>` : ''}</button>`;
            }).join('')}</div>` : '<p class="bb-chat-picker-none">No prompt matches. Templates are kept in the dashboard, under this site.</p>';
            foot.textContent = '↑↓ to choose · Enter to insert · Esc to close';
        }

        function onKey(event) {
            if (!state) return;
            const claim = () => { event.preventDefault(); event.stopPropagation(); };
            if (event.key === 'Escape') {
                claim();
                if (state.filling) { state.filling = null; draw(); state.element.querySelector('.bb-chat-picker-q').focus(); } else close();
                return;
            }
            if (state.filling) {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { claim(); insertFilled(); }
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                claim();
                const n = state.rows.length;
                if (n) state.index = (state.index + (event.key === 'ArrowDown' ? 1 : -1) + n) % n;
                draw();
            } else if (event.key === 'Enter') {
                claim();
                pick(state.index);
            }
        }

        async function pick(index) {
            const row = state && state.rows[index];
            if (!row) return;
            if (row.kind === 'save') {
                const name = state.element.querySelector('.bb-chat-picker-q').value.trim();
                const body = state.boxText;
                if (!name) {
                    notify('Type a name in the filter first, then save', 'warning');
                    return;
                }
                // Closed once it is saved, so a failure leaves the name where it was typed.
                if (!(await PromptTemplates.create({ name, body, sites: [site] }))) {
                    notify('Could not save the prompt template — try again', 'error');
                    return;
                }
                close();
                notify(`Saved “${name}” as a prompt template`, 'success');
                return;
            }
            const fields = PromptTemplates.fields(row.template.body);
            if (!fields.length) return put(row.template, {});
            state.filling = { template: row.template, fields };
            draw();
            const first = state.element.querySelector('[data-bb-field]');
            if (first) first.focus();
            return undefined;
        }

        function insertFilled() {
            if (!state || !state.filling) return;
            const values = {};
            state.element.querySelectorAll('[data-bb-field]').forEach((input) => { values[input.dataset.bbField] = input.value; });
            put(state.filling.template, values);
        }

        async function put(template, values) {
            const text = PromptTemplates.fill(template.body, { ...values, [PromptTemplates.SELECTION]: state.selection });
            close();
            const landed = await Composer.insert(composer(), text);
            if (landed) PromptTemplates.touch(template.id);
            else notify('Could not type into the prompt box — the prompt is on your clipboard, paste it', 'warning');
        }

        return { open, close, toggle, isOpen };
    }

    const ChatPicker = { createPicker, PICKER_ID, TALL };

    root.BB = root.BB || {};
    root.BB.ChatPicker = ChatPicker;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatPicker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
