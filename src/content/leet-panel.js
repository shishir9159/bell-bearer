/**
 * The LeetCode pouch: a panel over the page, a rail of lists on the left and
 * the problems in the chosen one on the right.
 *
 * It is the YouTube sheet's shape rather than the X panel's, and the reason is
 * what a row has to carry. An X row is a name and five words of note, so that
 * panel is drawn at the width of the nav column it covers. A row here is a
 * problem, its difficulty, when it is next due, and a note you are expected to
 * read and edit — so it needs the room, and the frosted full-width sheet is
 * what has it.
 *
 * Loading follows src/content/pouch-sheet.js: open the frame first, hydrate
 * behind it. There is only one storage read here rather than five, so the gap
 * is short — but it is not zero, and a panel that appears instantly on
 * "Loading…" beats one that appears a beat after the key was pressed. Every
 * async continuation re-checks `alive`, because the user can close the panel
 * inside that beat and a render into a detached node is a leak with a
 * stack trace attached.
 *
 * Everything drawn is either LeetCode's text or the user's own note, so it all
 * goes through escapeHtml and the one URL through safeUrlAttr.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Leet = ns.Leet || req('../shared/leetcode.js');
    const LeetTemplates = ns.LeetTemplates || req('../shared/leet-templates.js');
    const Overlay = ns.Overlay || req('./overlay.js');

    const OVERLAY_ID = 'bb-leet-overlay';

    const esc = (text) => Dom.escapeHtml(text);
    const att = (text) => Dom.escapeAttr(text);

    /**
     * The rail, in order. `id` is both the sentinel the rail row carries and
     * the key Leet.lists hands back, so picking a row is a lookup rather than
     * a switch — the same trick PLAYLISTS_VIEW plays in pouch-sheet.js.
     */
    const VIEWS = Object.freeze([
        Object.freeze({ id: 'due', label: 'Due', empty: 'Nothing is due. Solve something new and grade it.' }),
        Object.freeze({ id: 'toSolve', label: 'To solve', empty: 'Every problem you have opened has been solved.' }),
        Object.freeze({ id: 'solved', label: 'Solved', empty: 'Nothing solved yet.' }),
    ]);

    /**
     * The templates rail. A sentinel rather than a fourth entry in VIEWS,
     * because it behaves like a rail row in every way the DOM cares about but
     * its pane is not a list of problems — the same arrangement pouch-sheet.js
     * uses for PLAYLISTS_VIEW.
     */
    const TEMPLATES_VIEW = '__templates__';

    const DAY_MS = 864e5;

    /** Whole days between two instants, rounded towards the nearer day. */
    const daysBetween = (from, to) => Math.round((to - from) / DAY_MS);

    /**
     * When a problem is next wanted, in words.
     *
     * Overdue is said plainly rather than as a date: the point of the Due rail
     * is that these are late, and "3 days ago" carries that where "Nov 14"
     * makes you work it out.
     */
    function dueText(problem, now) {
        const due = Leet.nextDue(problem);
        if (!due) return 'not graded yet';
        const days = daysBetween(now, due);
        if (days < -1) return `${Math.abs(days)} days overdue`;
        if (days <= 0) return 'due today';
        if (days === 1) return 'due tomorrow';
        if (days < 31) return `in ${days} days`;
        const months = Math.round(days / 30);
        if (months < 12) return `in ${months} month${months === 1 ? '' : 's'}`;
        const years = Math.round(days / 365);
        return `in ${years} year${years === 1 ? '' : 's'}`;
    }

    /**
     * `insertTemplate` puts a template's body into LeetCode's editor and
     * answers whether it landed; `currentLang` is what the page world says
     * the editor is in. Both are absent off a problem page, which is why the
     * Insert button is disabled rather than missing there — a button that
     * comes and goes is harder to find than one that is greyed.
     */
    function createLeetPanel({ notify, openDashboard, goTo, appearance, dress, insertTemplate, currentLang }) {

        /** Open now, fill in behind it. See the file comment. */
        function open() {
            const dialog = Overlay.open({ id: OVERLAY_ID, contentHtml: shellHtml() });
            if (!dialog) return null;

            dialog.element.classList.add('bb-leet-overlay');
            appearance().then((look) => {
                if (dialog.element.isConnected) dress(dialog.element, look);
            });

            const panel = new Panel({ dialog, notify, openDashboard, goTo, insertTemplate, currentLang });
            panel.start();

            Promise.all([Leet.load(), LeetTemplates.load()]).then(([state, templates]) => {
                if (panel.alive) panel.hydrate(state, templates);
            });
            return panel;
        }

        return { open, VIEWS, TEMPLATES_VIEW };
    }

    function shellHtml() {
        return `
            <div class="bb-leet-sheet">
                <div class="bb-leet-head">
                    <div class="bb-leet-heading">
                        <h2 class="bb-leet-title">Pouch</h2>
                        <p class="bb-leet-sub">Loading…</p>
                    </div>
                    <button type="button" class="bb-leet-close" data-bb-close="1"
                            title="Close" aria-label="Close">
                        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
                             stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12"></path><path d="M18 6 6 18"></path></svg>
                    </button>
                </div>
                <div class="bb-leet-body">
                    <nav class="bb-leet-rail" aria-label="Lists"></nav>
                    <div class="bb-leet-pane"></div>
                </div>
            </div>`;
    }

    /** One open panel. */
    class Panel {
        constructor({ dialog, notify, openDashboard, goTo, insertTemplate, currentLang }) {
            this.dialog = dialog;
            this.notify = notify;
            this.openDashboard = openDashboard;
            this.goTo = goTo;
            this.insertTemplate = insertTemplate;
            this.currentLang = currentLang || (() => '');

            this.state = null;
            this.view = 'due';
            /** The slug whose note is being edited, or null. */
            this.editing = null;

            this.templates = [];
            /** The template open in the editor: an id, 'new', or null. */
            this.template = null;

            const $ = (selector) => dialog.element.querySelector(selector);
            this.el = { rail: $('.bb-leet-rail'), pane: $('.bb-leet-pane'), sub: $('.bb-leet-sub') };
        }

        get alive() {
            return this.dialog.element.isConnected;
        }

        start() {
            this.wire();
            this.render();
        }

        hydrate(state, templates) {
            this.state = state;
            this.templates = templates;
            // Open on whichever rail has something in it. Landing on an empty
            // "Due" when there are twelve problems waiting to be solved is a
            // panel that looks broken.
            const lists = Leet.lists(state, Date.now());
            if (!lists.due.length) this.view = lists.toSolve.length ? 'toSolve' : 'solved';
            this.render();
        }

        /** Repaint from storage — the dashboard may have changed it under us. */
        async refresh() {
            if (!this.alive) return;
            const [state, templates] = await Promise.all([Leet.load(), LeetTemplates.load()]);
            if (!this.alive) return;
            this.state = state;
            this.templates = templates;
            this.render();
        }

        close() {
            this.dialog.close();
        }

        // ------------------------------------------------------- rendering

        lists() {
            return Leet.lists(this.state || Leet.blank(), Date.now());
        }

        render() {
            if (!this.alive) return;
            this.renderRail();
            this.renderPane();
        }

        renderRail() {
            if (!this.state) {
                this.el.rail.innerHTML = '<div class="bb-leet-rail-label">Lists</div>';
                return;
            }
            const lists = this.lists();
            this.el.rail.innerHTML = '<div class="bb-leet-rail-label">Lists</div>' +
                VIEWS.map((view) => railRow(view.id, view.label, lists[view.id].length, view.id === this.view)).join('') +
                '<div class="bb-leet-rail-label">Code</div>' +
                railRow(TEMPLATES_VIEW, 'Templates', this.templates.length, this.view === TEMPLATES_VIEW);

            const total = lists.due.length + lists.toSolve.length + lists.solved.length;
            this.el.sub.textContent = total
                ? `${plural(lists.due.length, 'problem')} due of ${total} tracked`
                : 'Nothing tracked yet — open a problem on LeetCode.';
        }

        renderPane() {
            if (!this.state) {
                this.el.pane.innerHTML = '<div class="bb-leet-empty">Loading…</div>';
                return;
            }
            if (this.view === TEMPLATES_VIEW) return this.renderTemplates();

            const view = VIEWS.find((v) => v.id === this.view) || VIEWS[0];
            const rows = this.lists()[view.id];
            if (!rows.length) {
                this.el.pane.innerHTML = `<div class="bb-leet-empty"><p>${esc(view.empty)}</p></div>`;
                return;
            }
            const now = Date.now();
            this.el.pane.innerHTML = `<ul class="bb-leet-list">${rows.map((problem) => this.rowHtml(problem, now)).join('')}</ul>`;
        }

        rowHtml(problem, now) {
            const url = problem.url || `https://leetcode.com/problems/${problem.slug}/`;
            const editing = this.editing === problem.slug;
            return `
                <li class="bb-leet-row" data-bb-slug="${att(problem.slug)}">
                    <div class="bb-leet-row-main">
                        <a class="bb-leet-name" href="${Dom.safeUrlAttr(url)}" data-bb-open="${att(url)}">${esc(problem.title || problem.slug)}</a>
                        <div class="bb-leet-meta">
                            ${problem.difficulty ? `<span class="bb-leet-diff is-${att(problem.difficulty.toLowerCase())}">${esc(problem.difficulty)}</span>` : ''}
                            <span class="bb-leet-when">${esc(dueText(problem, now))}</span>
                            ${problem.attempts.length ? `<span class="bb-leet-tries">${plural(problem.attempts.length, 'attempt')}</span>` : ''}
                        </div>
                    </div>
                    ${editing ? this.noteFormHtml(problem) : this.noteHtml(problem)}
                </li>`;
        }

        /**
         * The note as it reads, or an invitation to write one.
         *
         * A button rather than a div even when empty: the whole point of
         * having notes on the panel as well as the dashboard is that the
         * moment you want to write one is the moment you have just finished
         * the problem, and hunting for where to click is what stops people.
         */
        noteHtml(problem) {
            if (!problem.note) {
                return `<button type="button" class="bb-leet-note is-empty" data-bb-note="${att(problem.slug)}">+ note</button>`;
            }
            return `<button type="button" class="bb-leet-note" data-bb-note="${att(problem.slug)}"
                            title="Edit this note">${esc(problem.note)}</button>`;
        }

        noteFormHtml(problem) {
            return `
                <div class="bb-leet-note-form">
                    <textarea class="bb-input bb-leet-note-input" rows="2"
                              placeholder="What was the trick?">${esc(problem.note)}</textarea>
                    <div class="bb-leet-note-actions">
                        <button type="button" class="bb-btn bb-btn-primary" data-bb-note-save="1">Save</button>
                        <button type="button" class="bb-btn" data-bb-note-cancel="1">Cancel</button>
                    </div>
                </div>`;
        }

        // ------------------------------------------------------- templates

        /** The template currently open in the editor, or null for none. */
        openTemplate() {
            if (this.template === 'new') {
                return { id: 'new', name: '', lang: this.currentLang(), body: '', uses: 0 };
            }
            return this.templates.find((t) => t.id === this.template) || null;
        }

        renderTemplates() {
            const lang = this.currentLang();
            const open = this.openTemplate();
            // Ordered the way the hotkey's suggester orders them, so the list
            // you read here is the list you will be offered there.
            const rows = LeetTemplates.forLang(this.templates, lang);

            this.el.pane.innerHTML = `
                <div class="bb-leet-tpl">
                    <div class="bb-leet-tpl-list">
                        <div class="bb-leet-tpl-head">
                            <span>${lang ? esc(LeetTemplates.labelFor(lang)) : 'All templates'}</span>
                            <button type="button" class="bb-btn" data-bb-tpl-new="1">+ New</button>
                        </div>
                        ${rows.length
                            ? `<ul class="bb-leet-tpl-rows">${rows.map((template) => `
                                <li>
                                    <button type="button" class="bb-leet-tpl-row${template.id === this.template ? ' is-on' : ''}"
                                            data-bb-tpl="${att(template.id)}">
                                        <span class="bb-leet-tpl-name">${esc(template.name)}</span>
                                        <span class="bb-leet-tpl-lang">${esc(LeetTemplates.labelFor(template.lang))}</span>
                                    </button>
                                </li>`).join('')}</ul>`
                            : `<p class="bb-leet-tpl-none">No templates yet. Select working code in the editor and
                               press save, or write one here.</p>`}
                    </div>
                    ${open ? this.templateFormHtml(open) : `
                        <div class="bb-leet-tpl-editor is-empty">
                            <p>Pick a template to edit it, or make a new one.</p>
                        </div>`}
                </div>`;
        }

        templateFormHtml(template) {
            const langs = LeetTemplates.list();
            const canInsert = !!this.insertTemplate && template.id !== 'new';
            return `
                <div class="bb-leet-tpl-editor">
                    <div class="bb-leet-tpl-fields">
                        <input type="text" class="bb-input bb-leet-tpl-title" placeholder="What is it called?"
                               value="${att(template.name)}" maxlength="${LeetTemplates.NAME_CAP}">
                        <select class="bb-input bb-leet-tpl-select">
                            <option value=""${template.lang ? '' : ' selected'}>Any language</option>
                            ${langs.map((entry) => `
                                <option value="${att(entry.id)}"${entry.id === template.lang ? ' selected' : ''}>${esc(entry.label)}</option>`).join('')}
                        </select>
                    </div>
                    <textarea class="bb-input bb-leet-tpl-body" rows="12" spellcheck="false"
                              placeholder="The code to paste in">${esc(template.body)}</textarea>
                    <div class="bb-leet-tpl-actions">
                        <button type="button" class="bb-btn bb-btn-primary" data-bb-tpl-save="1">Save</button>
                        <button type="button" class="bb-btn" data-bb-tpl-insert="1"${canInsert ? '' : ' disabled'}
                                title="${canInsert ? 'Paste it at the cursor' : 'Open a problem to insert a template'}">Insert</button>
                        ${template.id === 'new' ? '' : '<button type="button" class="bb-btn bb-leet-tpl-del" data-bb-tpl-delete="1">Delete</button>'}
                    </div>
                </div>`;
        }

        /** What the three controls currently hold. */
        readTemplateForm() {
            const $ = (selector) => this.el.pane.querySelector(selector);
            const name = $('.bb-leet-tpl-title');
            const lang = $('.bb-leet-tpl-select');
            const body = $('.bb-leet-tpl-body');
            if (!name || !lang || !body) return null;
            return { name: name.value, lang: lang.value, body: body.value };
        }

        async saveTemplate() {
            const form = this.readTemplateForm();
            if (!form) return;
            if (!form.name.trim()) {
                this.notify('Give the template a name first', 'warning');
                return;
            }

            if (this.template === 'new') {
                const id = await LeetTemplates.create(form);
                this.template = id;
            } else {
                await LeetTemplates.edit(this.template, form);
            }
            if (!this.alive) return;
            await this.refresh();
            if (this.alive) this.notify('Template saved', 'success');
        }

        async deleteTemplate() {
            const id = this.template;
            if (!id || id === 'new') return;
            await LeetTemplates.remove(id);
            if (!this.alive) return;
            this.template = null;
            await this.refresh();
        }

        /**
         * Paste it at the cursor and get out of the way.
         *
         * Closing the panel is the point: the cursor is in the editor behind
         * it, and a template inserted under a full-screen sheet is one you
         * then have to dismiss to see.
         */
        async insert() {
            const template = this.openTemplate();
            if (!template || !this.insertTemplate) return;
            // Whatever is in the field wins over what is stored — editing a
            // template and inserting without saving should insert the edit.
            const form = this.readTemplateForm();
            const body = form ? form.body : template.body;

            this.close();
            const landed = this.insertTemplate(body);
            if (landed !== false) LeetTemplates.touch(template.id);
        }

        // ---------------------------------------------------------- wiring

        /**
         * One delegated listener per region, wired once against containers
         * that outlive every redraw — the rail and the pane are replaced
         * wholesale on each render, so a listener per row would be re-added
         * every time and fire once per render after three renders.
         */
        wire() {
            this.el.rail.addEventListener('click', (event) => {
                const row = event.target.closest('[data-bb-view]');
                if (!row) return;
                this.view = row.dataset.bbView;
                this.editing = null;
                this.render();
            });

            this.el.pane.addEventListener('click', (event) => {
                if (this.view === TEMPLATES_VIEW) return this.onTemplateClick(event);

                const open = event.target.closest('[data-bb-open]');
                if (open) {
                    // A real <a> with a real href, so the middle click and the
                    // context menu work — but a plain left click goes through
                    // the caller, which knows whether LeetCode's own router
                    // can take it without a reload.
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                    event.preventDefault();
                    this.close();
                    this.goTo(open.dataset.bbOpen);
                    return;
                }

                const note = event.target.closest('[data-bb-note]');
                if (note) {
                    this.editing = note.dataset.bbNote;
                    this.renderPane();
                    const input = this.el.pane.querySelector('.bb-leet-note-input');
                    if (input) { input.focus(); input.select(); }
                    return;
                }

                if (event.target.closest('[data-bb-note-cancel]')) {
                    this.editing = null;
                    this.renderPane();
                    return;
                }

                if (event.target.closest('[data-bb-note-save]')) this.saveNote();
            });

            // Enter saves, Shift+Enter is a new line. Escape cancels rather
            // than closing the panel — overlay.js lets a keystroke inside a
            // field belong to that field, which is what makes this possible.
            this.el.pane.addEventListener('keydown', (event) => {
                if (!event.target.classList.contains('bb-leet-note-input')) return;
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    this.saveNote();
                } else if (event.key === 'Escape') {
                    this.editing = null;
                    this.renderPane();
                }
            });
        }

        onTemplateClick(event) {
            if (event.target.closest('[data-bb-tpl-new]')) {
                this.template = 'new';
                this.renderTemplates();
                const field = this.el.pane.querySelector('.bb-leet-tpl-title');
                if (field) field.focus();
                return;
            }
            if (event.target.closest('[data-bb-tpl-save]')) return void this.saveTemplate();
            if (event.target.closest('[data-bb-tpl-delete]')) return void this.deleteTemplate();
            if (event.target.closest('[data-bb-tpl-insert]')) return void this.insert();

            const row = event.target.closest('[data-bb-tpl]');
            if (!row) return;
            this.template = row.dataset.bbTpl;
            this.renderTemplates();
        }

        async saveNote() {
            const slug = this.editing;
            const input = this.el.pane.querySelector('.bb-leet-note-input');
            if (!slug || !input) return;
            const note = input.value;

            this.editing = null;
            await Leet.setNote(slug, note);
            if (!this.alive) return;
            await this.refresh();
        }
    }

    /**
     * A rail row. One template for all of them, so a row's metrics cannot
     * drift between the list that is selected and the ones that are not —
     * pouch-sheet.js keeps its topic rows the same way.
     */
    function railRow(id, label, n, selected) {
        return `
            <button type="button" class="bb-leet-rail-row${selected ? ' is-on' : ''}"
                    data-bb-view="${att(id)}" aria-pressed="${selected ? 'true' : 'false'}">
                <span class="bb-leet-rail-name">${esc(label)}</span>
                <span class="bb-leet-rail-n">${n}</span>
            </button>`;
    }

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    const LeetPanel = { createLeetPanel, OVERLAY_ID, VIEWS, TEMPLATES_VIEW, dueText, railRow };

    root.BB = root.BB || {};
    root.BB.LeetPanel = LeetPanel;
    if (typeof module !== 'undefined' && module.exports) module.exports = LeetPanel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
