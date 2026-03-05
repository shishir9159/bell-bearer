/**
 * Bulk export: pick chats from your history and take them away as one zip.
 *
 * It lives on the chat site, in an overlay, because it has to: every request
 * needs the site's session, which the dashboard does not have.
 *
 * The list is the site's own, a page at a time, with a filter over the titles
 * already loaded — a filter, not a search. Export fetches one chat at a time,
 * about one a second with some jitter, backs off when the site answers 429 and
 * stops after the third in a row. This is your own history read at a person's
 * pace; the roster's reasoning about not probing for the edge of what a site
 * tolerates applies here too. Cancel keeps what has been fetched and offers
 * it, rather than throwing away a minute of waiting.
 *
 * The pacing and the archive are pure and node-tested; the overlay is not.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Icons = ns.Icons || req('../shared/icons.js');
    const ChatSites = ns.ChatSites || req('../shared/chat-sites.js');
    const ChatExport = ns.ChatExport || req('../shared/chat-export.js');
    const Zip = ns.Zip || req('../shared/zip.js');
    const Overlay = ns.Overlay || req('./overlay.js');

    const OVERLAY_ID = 'bb-chat-library';
    const PAGE = 28;
    /** Three 429s in a row is the site saying stop, not a hiccup. */
    const STRIKES = 3;

    const esc = (text) => Dom.escapeHtml(text);

    /** Between two chats: a second, give or take. */
    const pace = (random = Math.random) => Math.round(900 + random() * 700);

    /** After the nth 429 in a row: 5s, 10s, 20s. */
    const backoff = (strikes) => 5000 * 2 ** Math.max(0, strikes - 1);

    const day = (ms) => {
        const at = new Date(ms);
        return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    };

    /** `name`, or `name (2)` and so on when two chats share a day and a title. */
    function unique(name, taken) {
        if (!taken.has(name)) { taken.add(name); return name; }
        const dot = name.lastIndexOf('.');
        for (let n = 2; ; n++) {
            const next = `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
            if (!taken.has(next)) { taken.add(next); return next; }
        }
    }

    /**
     * The archive's files: each chat as Markdown, JSON or both, and an
     * index.md listing every chat and its file.
     */
    function archive(convs, { site, format = 'md', dollars = true, thinking = false, now = Date.now() }) {
        const name = (ChatSites.get(site) || { name: site }).name;
        const taken = new Set(['index.md']);
        const files = [];
        const rows = [];
        for (const conv of convs) {
            const saved = [];
            if (format !== 'json') {
                const file = unique(ChatExport.fileName(conv, 'md'), taken);
                files.push({ name: file, data: ChatExport.markdown(conv, { dollars, thinking, now }), at: conv.updatedAt || now });
                saved.push(file);
            }
            if (format !== 'md') {
                const file = unique(ChatExport.fileName(conv, 'json'), taken);
                files.push({ name: file, data: JSON.stringify(ChatExport.json(conv, { branches: 'all', now }), null, 2), at: conv.updatedAt || now });
                saved.push(file);
            }
            const link = (file) => `[${file.slice(file.lastIndexOf('.') + 1)}](${encodeURI(file)})`;
            rows.push(`- ${conv.title.replace(/[[\]]/g, '')} — ${saved.map(link).join(' · ')}${conv.updatedAt ? ` — updated ${day(conv.updatedAt)}` : ''}`);
        }
        const index = `# ${name} export — ${day(now)}\n\n${rows.length} chat${rows.length === 1 ? '' : 's'}.\n\n${rows.join('\n')}\n`;
        return [{ name: 'index.md', data: index, at: now }, ...files];
    }

    const zipName = (site, now = Date.now()) => `${site}-export-${day(now)}.zip`;

    /**
     * @param {object} deps
     * @param {object} deps.adapter        the site's; listConversations and fetchConversation are used
     * @param {() => object} deps.getSettings
     */
    function createLibrary({ adapter, notify, appearance, dress, getSettings, sleep, random = Math.random }) {
        const wait = sleep || ((ms) => new Promise((done) => setTimeout(done, ms)));
        const setting = (kind) => getSettings()[ChatSites.siteKey(adapter.site, kind)];

        function open() {
            const state = { items: [], total: 0, loading: false, error: '', filter: '', format: 'md', picked: new Set(), last: -1, run: null };
            const dialog = Overlay.open({
                id: OVERLAY_ID,
                contentHtml: `
                    <div class="bb-panel bb-panel-lg bb-chat-library" data-bb-keep-panel="1">
                        <div class="bb-panel-head"><h3>Export chats</h3>
                            <button type="button" class="bb-close" data-bb-close="1" aria-label="Close">${Icons.svg('x')}</button></div>
                        <div class="bb-panel-body">
                            <input type="search" class="bb-input bb-chat-lib-filter" placeholder="Filter the titles loaded so far" spellcheck="false">
                            <div class="bb-chat-lib-list" role="list"></div>
                            <div class="bb-chat-lib-foot"></div>
                        </div>
                    </div>`,
            });
            if (!dialog) return null;
            dialog.element.classList.add('bb-modal-top');
            dialog.element.setAttribute('data-bb-keep-panel', '1');
            appearance().then((look) => { if (dialog.element.isConnected) dress(dialog.element, look); });
            const $ = (selector) => dialog.element.querySelector(selector);
            const alive = () => dialog.element.isConnected;

            const shown = () => {
                const needle = state.filter.trim().toLowerCase();
                return state.items.filter((item) => !needle || item.title.toLowerCase().includes(needle));
            };

            function draw() {
                if (!alive()) return;
                const rows = shown();
                $('.bb-chat-lib-list').innerHTML = rows.map((item) => `
                    <label class="bb-chat-lib-row" role="listitem">
                        <input type="checkbox" data-bb-lib-id="${Dom.escapeAttr(item.id)}"${state.picked.has(item.id) ? ' checked' : ''}>
                        <span class="bb-chat-lib-title">${esc(item.title)}</span>
                        <span class="bb-chat-lib-when">${item.updatedAt ? esc(day(item.updatedAt)) : ''}</span>
                    </label>`).join('') ||
                    `<p class="bb-muted">${esc(state.loading ? 'Loading your chats…' : state.error || 'No chats match.')}</p>`;
                drawFoot();
            }

            function drawFoot() {
                const run = state.run;
                const more = state.items.length < state.total
                    ? `<button type="button" class="bb-btn" data-bb-lib-more="1"${state.loading ? ' disabled' : ''}>Load more (${state.items.length} of ${state.total})</button>` : '';
                if (run && !run.over) {
                    $('.bb-chat-lib-foot').innerHTML = `<span class="bb-chat-lib-progress">${esc(run.note || `Fetching ${run.done + 1} of ${run.ids.length}…`)}</span>
                        <button type="button" class="bb-btn" data-bb-lib-cancel="1">Cancel</button>`;
                    return;
                }
                const leftover = run && run.over && run.convs.length && !run.saved
                    ? `<button type="button" class="bb-btn bb-btn-primary" data-bb-lib-save="1">Save the ${run.convs.length} fetched</button>` : '';
                const formats = [['md', 'Markdown'], ['json', 'JSON'], ['both', 'Both']].map(([id, label]) =>
                    `<option value="${id}"${state.format === id ? ' selected' : ''}>${label}</option>`).join('');
                $('.bb-chat-lib-foot').innerHTML = `${more}
                    <span class="bb-chat-lib-note">${esc(run && run.note ? run.note : '')}</span>
                    <select class="bb-input bb-chat-lib-format" aria-label="Format">${formats}</select>
                    ${leftover}
                    <button type="button" class="bb-btn bb-btn-primary" data-bb-lib-export="1"${state.picked.size ? '' : ' disabled'}>Export ${state.picked.size || ''}</button>`;
            }

            async function loadMore() {
                if (state.loading) return;
                state.loading = true;
                draw();
                try {
                    const page = await adapter.listConversations({ offset: state.items.length, limit: PAGE });
                    const known = new Set(state.items.map((item) => item.id));
                    state.items.push(...page.items.filter((item) => !known.has(item.id)));
                    state.total = Math.max(page.total, state.items.length);
                } catch (error) {
                    state.error = error && error.code === 'signed-out' ? 'Sign in to list your chats.' : 'Could not list your chats.';
                } finally {
                    state.loading = false;
                }
                draw();
            }

            function save(convs) {
                const now = Date.now();
                const files = archive(convs, {
                    site: adapter.site, format: state.format, now,
                    dollars: setting('exportDollars') !== false, thinking: setting('exportThinking') === true,
                });
                Dom.download(zipName(adapter.site, now), Zip.build(files), 'application/zip');
            }

            /** One chat at a time, paced, until done, cancelled or told to stop. */
            async function run() {
                const ids = state.items.filter((item) => state.picked.has(item.id)).map((item) => item.id);
                const job = { ids, done: 0, convs: [], failed: 0, strikes: 0, cancelled: false, over: false, saved: false, note: '' };
                state.run = job;
                drawFoot();
                for (let i = 0; i < ids.length && !job.cancelled && alive(); i++) {
                    try {
                        job.convs.push(await adapter.fetchConversation(ids[i]));
                        job.strikes = 0;
                    } catch (error) {
                        if (error && error.status === 429) {
                            job.strikes++;
                            if (job.strikes >= STRIKES) { job.note = `The site asked us to slow down three times — stopped at ${job.done} of ${ids.length}.`; break; }
                            job.note = `The site asked us to slow down — waiting ${backoff(job.strikes) / 1000}s.`;
                            drawFoot();
                            await wait(backoff(job.strikes));
                            job.note = '';
                            i--;
                            continue;
                        }
                        job.failed++;
                    }
                    job.done++;
                    drawFoot();
                    if (i < ids.length - 1) await wait(pace(random));
                }
                job.over = true;
                if (!job.cancelled && job.convs.length && !job.strikes) {
                    save(job.convs);
                    job.saved = true;
                    job.note = `Saved ${job.convs.length} chat${job.convs.length === 1 ? '' : 's'}${job.failed ? `; ${job.failed} could not be read` : ''}.`;
                } else if (job.cancelled) {
                    job.note = `Cancelled after ${job.convs.length}.`;
                }
                drawFoot();
            }

            $('.bb-chat-lib-filter').addEventListener('input', (event) => { state.filter = event.target.value; draw(); });
            $('.bb-chat-lib-list').addEventListener('click', (event) => {
                const box = event.target.closest('[data-bb-lib-id]');
                if (!box) return;
                const rows = shown();
                const at = rows.findIndex((item) => item.id === box.dataset.bbLibId);
                // Shift-click ticks or unticks everything between this and the last one.
                const range = event.shiftKey && state.last >= 0 ? rows.slice(Math.min(at, state.last), Math.max(at, state.last) + 1) : [rows[at]];
                range.forEach((item) => (box.checked ? state.picked.add(item.id) : state.picked.delete(item.id)));
                state.last = at;
                draw();
            });
            $('.bb-chat-lib-foot').addEventListener('change', (event) => {
                if (event.target.classList.contains('bb-chat-lib-format')) state.format = event.target.value;
            });
            $('.bb-chat-lib-foot').addEventListener('click', (event) => {
                if (event.target.closest('[data-bb-lib-more]')) loadMore();
                else if (event.target.closest('[data-bb-lib-export]')) run();
                else if (event.target.closest('[data-bb-lib-cancel]') && state.run) state.run.cancelled = true;
                else if (event.target.closest('[data-bb-lib-save]') && state.run) {
                    save(state.run.convs);
                    state.run.saved = true;
                    drawFoot();
                }
            });

            loadMore();
            return { element: dialog.element, close: dialog.close, state };
        }

        return { open };
    }

    const ChatLibrary = { createLibrary, archive, pace, backoff, unique, zipName, OVERLAY_ID, STRIKES };

    root.BB = root.BB || {};
    root.BB.ChatLibrary = ChatLibrary;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatLibrary;
})(typeof globalThis !== 'undefined' ? globalThis : this);
