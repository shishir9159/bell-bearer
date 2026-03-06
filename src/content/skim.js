/**
 * Skim — the launcher drawn over the page.
 *
 * Shift+F opens it on the page itself, Shift+H on your history and Shift+A
 * on the actions it can run; whichever key opened it, every source is still
 * listed underneath and Tab moves to the next one. The arithmetic for where
 * a match comes to rest is src/shared/skim.js, and anything that needs a
 * privileged API is asked of src/background/skim.js.
 *
 * Two things about the page search are deliberate.
 *
 * It does not touch the page's DOM. The obvious way to highlight a match is
 * to wrap it in a <span>, which is what the design prototype does — but that
 * rewrites part of a page it does not own, and every event listener bound to
 * the nodes it replaces goes with it. The CSS Custom Highlight API paints
 * ranges instead: nothing in the document changes, so nothing can break, and
 * clearing a search is one line. Where the API is missing the search still
 * works and still scrolls; only the paint is gone.
 *
 * And the match lands just below this window rather than in the middle of
 * the space left over. See the note in src/shared/skim.js.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Skim = ns.Skim || req('../shared/skim.js');
    const Dom = ns.Dom || req('../shared/dom.js');
    const Icons = ns.Icons || req('../shared/icons.js');
    const ScrollTo = ns.ScrollTo || req('./scroll-to.js');

    const PANEL_ID = 'bb-skim';
    const HIGHLIGHT = 'bb-skim-hit';
    const HIGHLIGHT_ACTIVE = 'bb-skim-hit-active';
    const DEBOUNCE_MS = 120;

    // No fallback for a missing Dom: one that returned the text raw would put
    // page titles and history into innerHTML unescaped. Failing at load is
    // the better way to find out it was not loaded.
    const esc = (text) => Dom.escapeHtml(text);

    const highlightsAvailable = () =>
        typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';

    /** What each kind of row is marked with, ahead of its text. */
    const MARKS = {
        page: Icons.svg('paragraph', { size: 13 }),
        tab: Icons.svg('browser', { size: 13 }),
        history: Icons.svg('clock-counter-clockwise', { size: 13 }),
        action: Icons.svg('command', { size: 13 }),
    };

    /**
     * @param {object} deps
     * @param {(message: string, type?: string) => void} deps.notify
     * @param {() => object} deps.appearance  `{ theme, skin }` for the panel
     * @param {(message: object) => Promise<object>} deps.ask  the worker
     */
    function createSkim({ notify, appearance, ask }) {
        let panel = null;
        let input = null;
        let listBox = null;
        let footer = null;
        let counter = null;
        let pulse = null;

        let open = false;
        let source = 'page';
        let query = '';
        let selected = 0;
        let pos = 'center';
        let rows = [];          // the flattened list, in the order drawn
        let hits = [];          // page matches, in document order
        let remote = { tabs: [], history: [] };
        let debounce = 0;
        // The query the worker was last asked for. null is 'never asked',
        // which is not the same as asked-for-the-empty-string: opening on
        // history with nothing typed still has to fetch the recent pages.
        let asked = null;

        // ------------------------------------------------------ the page

        /**
         * Every match for `text`, as Ranges. Text nodes inside our own panel,
         * inside a script or style, and inside anything not being drawn are
         * passed over — a match in a hidden menu has no position to scroll to
         * and would count towards a total the reader cannot see.
         */
        function findHits(text) {
            const needle = text.toLowerCase();
            const out = [];
            if (!document.body) return out;

            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    if (!node.data || node.data.toLowerCase().indexOf(needle) < 0) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    const parent = node.parentElement;
                    if (!parent || parent.closest(`#${PANEL_ID}, script, style, noscript`)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return parent.getClientRects().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                },
            });

            while (walker.nextNode() && out.length < Skim.MAX_HITS) {
                const node = walker.currentNode;
                const lower = node.data.toLowerCase();
                let at = lower.indexOf(needle);
                while (at >= 0 && out.length < Skim.MAX_HITS) {
                    const range = document.createRange();
                    range.setStart(node, at);
                    range.setEnd(node, at + needle.length);
                    out.push({ range, node, at, length: needle.length });
                    at = lower.indexOf(needle, at + needle.length);
                }
            }
            return out;
        }

        function paintHits() {
            if (!highlightsAvailable()) return;
            try {
                if (!hits.length) {
                    CSS.highlights.delete(HIGHLIGHT);
                    CSS.highlights.delete(HIGHLIGHT_ACTIVE);
                    return;
                }
                CSS.highlights.set(HIGHLIGHT, new Highlight(...hits.map((hit) => hit.range)));
                const active = rows[selected];
                if (active && active.kind === 'page') {
                    CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(active.hit.range));
                } else {
                    CSS.highlights.delete(HIGHLIGHT_ACTIVE);
                }
            } catch (_) { /* a range whose node has since been replaced */ }
        }

        function clearHits() {
            hits = [];
            if (!highlightsAvailable()) return;
            try {
                CSS.highlights.delete(HIGHLIGHT);
                CSS.highlights.delete(HIGHLIGHT_ACTIVE);
            } catch (_) { /* nothing was painted */ }
        }

        /** The nearest heading above a match, as a breadcrumb for its row. */
        function crumbFor(node) {
            let element = node.parentElement;
            while (element && element !== document.body) {
                let previous = element.previousElementSibling;
                while (previous) {
                    if (/^H[1-6]$/.test(previous.tagName)) {
                        return previous.textContent.trim().replace(/\s+/g, ' ').slice(0, 48);
                    }
                    previous = previous.previousElementSibling;
                }
                element = element.parentElement;
            }
            return document.title.slice(0, 48);
        }

        // ------------------------------------------------------- the jump

        // Finding the scroller, opening a <details> and marking the arrival
        // are src/content/scroll-to.js, shared with the chat outline. Where
        // the window comes to rest is Skim's own: it steps out of the way of
        // its own panel, which nothing else on the page has to.
        function jump(hit) {
            const element = hit.node.parentElement;
            if (!element) return;

            ScrollTo.openDetails(element);

            // Two scrolls, in order: the container brings the match into its
            // own view, then the page places the container.
            const sub = ScrollTo.innerScroller(element);
            if (sub) ScrollTo.bring(sub, hit.range.getBoundingClientRect());

            const doc = document.scrollingElement || document.documentElement;
            const viewport = window.innerHeight || doc.clientHeight;
            const rect = hit.range.getBoundingClientRect();
            const plan = Skim.plan({
                viewport,
                scrollTop: doc.scrollTop,
                scrollMax: Math.max(0, doc.scrollHeight - viewport),
                target: doc.scrollTop + rect.top,
                height: panel ? panel.offsetHeight : 240,
                pinned: ScrollTo.isPinned(element),
            });

            if (plan.pos !== pos) {
                pos = plan.pos;
                place();
            }
            if (plan.moved) window.scrollTo({ top: plan.scrollTop, behavior: 'smooth' });
            // The highlight says where the match is; the marker says that it
            // just arrived, which is what the eye needs after the page moved.
            ScrollTo.markArrival(pulse, () => hit.range.getBoundingClientRect());
            setFooter(`${crumbFor(hit.node)} · ${plan.note}`);
        }

        // ------------------------------------------------------ the model

        function pageRows() {
            return hits.slice(0, Skim.MAX_PAGE_ROWS).map((hit) => {
                const parts = Skim.snippet(hit.node.data, hit.at, hit.length);
                return { kind: 'page', hit, ...parts, crumb: crumbFor(hit.node) };
            });
        }

        /**
         * The groups, in the order they are drawn. A query under two
         * characters searches nothing — but the source that was asked for
         * still shows what it has, so Shift+H opens on recent history rather
         * than on an empty box.
         */
        function groups() {
            const short = query.trim().length < Skim.MIN_QUERY;
            const pick = (kind, all) => (short ? (source === kind ? all : []) : Skim.filterRows(all, query));

            const out = [
                { source: 'page', rows: short ? [] : pageRows(), total: hits.length },
                { source: 'tabs', rows: pick('tabs', remote.tabs).map((row) => ({ kind: 'tab', ...row })) },
                {
                    source: 'history',
                    rows: pick('history', remote.history).map((row) => ({ kind: 'history', ...row })),
                },
                {
                    source: 'actions',
                    rows: pick('actions', Skim.ACTIONS).map((row) => ({ kind: 'action', ...row })),
                },
            ].filter((group) => group.rows.length);

            return Skim.orderGroups(out, source);
        }

        // ----------------------------------------------------- the drawing

        function rowHtml(row, index) {
            const mark = MARKS[row.kind] || Icons.svg('dot', { size: 13 });
            const text = row.kind === 'page'
                ? `${esc(row.pre)}<b>${esc(row.mid)}</b>${esc(row.post)}`
                : esc(row.title);
            return `<div class="bb-skim-row${index === selected ? ' is-on' : ''}" data-row="${index}">
                        <span class="bb-skim-mark">${mark}</span>
                        <span class="bb-skim-text">${text}</span>
                        <span class="bb-skim-crumb">${esc(row.crumb || row.sub || '')}</span>
                    </div>`;
        }

        function draw() {
            const model = groups();
            rows = model.flatMap((group) => group.rows);
            if (selected >= rows.length) selected = Math.max(0, rows.length - 1);

            let index = 0;
            const html = model.map((group) => {
                const count = group.total && group.total > group.rows.length
                    ? `${group.total} · showing ${group.rows.length}`
                    : String(group.rows.length);
                const body = group.rows.map((row) => rowHtml(row, index++)).join('');
                return `<div class="bb-skim-group">
                            <div class="bb-skim-grouphead">
                                <span>${esc(Skim.SOURCE_LABELS[group.source])}</span>
                                <span class="bb-skim-rule"></span>
                                <span>${esc(count)}</span>
                            </div>${body}
                        </div>`;
            }).join('');

            listBox.innerHTML = html || emptyHtml();
            counter.textContent = rows.length
                ? `${selected + 1} / ${rows.length}`
                : (query.trim().length >= Skim.MIN_QUERY ? '0 results' : '');
            fitList();
            panel.dataset.source = source;
        }

        function emptyHtml() {
            if (query.trim().length >= Skim.MIN_QUERY) {
                return `<div class="bb-skim-empty">
                            <b>No matches for “${esc(query.trim())}”</b>
                            <span>Nothing on this page, and nothing in your tabs, history or actions.</span>
                        </div>`;
            }
            return `<div class="bb-skim-empty">
                        <b>Start typing</b>
                        <span>Two characters begin the match. Tab moves to the next source;
                              arrowing a page match scrolls it to just under this window.</span>
                    </div>`;
        }

        /**
         * The list is held at the one height it can ever need — four rows,
         * each under a group heading of its own — and scrolls for the rest.
         *
         * It used to be sized to what was drawn, which made the launcher grow
         * and shrink on almost every keystroke. That is not only restless to
         * look at: the panel is placed by its own height, so in the centre
         * position the box you are typing into slid up the screen as results
         * came in and back down as they went. Reserving the tallest layout up
         * front costs some empty space under a short list and buys a window
         * that does not move while you type. Arrowing through page matches
         * still moves it — that is `jump()` stepping out of the way of a
         * match, which is a different thing and deliberate.
         *
         * Measured rather than written into the CSS because the row and the
         * heading are sized in the skin's own fonts.
         */
        const METRICS = { row: 34, head: 26 };

        function fitList() {
            const row = listBox.querySelector('.bb-skim-row');
            const head = listBox.querySelector('.bb-skim-grouphead');
            if (row && row.offsetHeight) METRICS.row = row.offsetHeight;
            if (head && head.offsetHeight) METRICS.head = head.offsetHeight;

            const tallest = Skim.VISIBLE_ROWS * METRICS.row
                + Skim.SOURCES.length * METRICS.head;
            listBox.style.height = `${tallest}px`;
        }

        function setFooter(text) {
            footer.textContent = text;
        }

        /** Put the panel where the current position says, and nowhere else. */
        function place() {
            if (!panel) return;
            const viewport = window.innerHeight || 800;
            panel.style.top = `${Skim.overlayTop(pos, viewport, panel.offsetHeight)}px`;
        }

        function scrollRowIntoView() {
            const row = listBox.querySelector('.bb-skim-row.is-on');
            if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
        }

        // ------------------------------------------------------- behaviour

        function select(next) {
            if (!rows.length) return;
            selected = (next + rows.length) % rows.length;
            draw();
            scrollRowIntoView();
            paintHits();
            const row = rows[selected];
            if (row && row.kind === 'page') jump(row.hit);
        }

        async function activate(row) {
            if (!row) return;
            if (row.kind === 'page') {
                // The page is already where it belongs — Enter is "done".
                close();
                return;
            }
            close();
            if (row.kind === 'tab') {
                await ask({ action: 'skimFocusTab', tabId: row.id });
                return;
            }
            if (row.kind === 'history') {
                await ask({ action: 'skimOpenLink', url: row.url });
                return;
            }
            const out = await ask({ action: 'skimRun', id: row.id });
            if (out && out.note) notify(out.note, out.ok ? 'success' : 'warning');
        }

        /**
         * Ask the worker for tabs and history. Debounced, and skipped when
         * the query has not actually changed — arrowing through results must
         * not send a message per keystroke.
         */
        function refreshRemote() {
            clearTimeout(debounce);
            debounce = setTimeout(async () => {
                const wanted = query.trim();
                if (wanted === asked) return;
                asked = wanted;
                const out = await ask({ action: 'skimSearch', query: wanted });
                if (!open) return;
                remote = { tabs: (out && out.tabs) || [], history: (out && out.history) || [] };
                draw();
            }, DEBOUNCE_MS);
        }

        function onInput() {
            query = input.value;
            selected = 0;
            clearHits();
            if (query.trim().length >= Skim.MIN_QUERY) hits = findHits(query.trim());
            paintHits();
            draw();
            place();
            refreshRemote();
            if (rows[0] && rows[0].kind === 'page') select(0);
        }

        /**
         * Every key the launcher answers to, taken at `window` in the
         * capture phase — the first place a keystroke can be seen.
         *
         * It used to be a listener on the input, which is the last place:
         * plenty of sites bind Escape with a capture listener on window and
         * stop it dead, so Escape reached the page's own handler and never
         * reached ours, and the launcher would not close. Being first also
         * means the arrows scroll our list rather than the page underneath.
         */
        function onKey(event) {
            if (!open) return;
            const claim = () => {
                event.preventDefault();
                event.stopImmediatePropagation();
            };

            if (event.key === 'Escape') {
                claim();
                close();
            } else if (event.key === 'ArrowDown' || (event.ctrlKey && event.key.toLowerCase() === 'n')) {
                claim();
                select(selected + 1);
            } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key.toLowerCase() === 'p')) {
                claim();
                select(selected - 1);
            } else if (event.key === 'Enter') {
                claim();
                activate(rows[selected]);
            } else if (event.key === 'Tab') {
                claim();
                source = Skim.nextSource(source);
                selected = 0;
                asked = null;
                refreshRemote();
                draw();
                place();
            } else if (event.target !== input && !event.ctrlKey && !event.altKey && !event.metaKey) {
                // The page can take the focus back from under us — YouTube
                // does it on navigation. A printable key then belongs to the
                // query, so it is put there by hand rather than lost.
                if (event.key.length === 1) {
                    claim();
                    input.value += event.key;
                    input.focus();
                    onInput();
                } else if (event.key === 'Backspace') {
                    claim();
                    input.value = input.value.slice(0, -1);
                    input.focus();
                    onInput();
                }
            }
        }

        function build({ theme, skin }) {
            panel = document.createElement('div');
            panel.id = PANEL_ID;
            panel.className = 'bb-themed bb-skim';
            panel.dataset.bbTheme = theme;
            panel.dataset.bbSkin = skin;
            panel.innerHTML = `
                <div class="bb-skim-head">
                    <span class="bb-skim-caret">›</span>
                    <input class="bb-skim-input" type="text" spellcheck="false"
                           placeholder="Search this page, your tabs, history and actions">
                    <span class="bb-skim-count"></span>
                </div>
                <div class="bb-skim-list"></div>
                <div class="bb-skim-foot">
                    <span class="bb-skim-rule-text"></span>
                    <span class="bb-skim-keys">
                        <span>↑↓ move</span><span>⏎ go</span><span>⇥ source</span><span>esc close</span>
                    </span>
                </div>`;

            pulse = document.createElement('div');
            pulse.className = 'bb-skim-pulse';
            pulse.hidden = true;

            document.documentElement.append(panel, pulse);

            input = panel.querySelector('.bb-skim-input');
            listBox = panel.querySelector('.bb-skim-list');
            counter = panel.querySelector('.bb-skim-count');
            footer = panel.querySelector('.bb-skim-rule-text');

            input.addEventListener('input', onInput);
            panel.addEventListener('mousedown', (event) => {
                const row = event.target.closest('[data-row]');
                if (!row) return;
                event.preventDefault();
                selected = Number(row.dataset.row);
                activate(rows[selected]);
            });
            window.addEventListener('resize', place);
        }

        /**
         * The hit colours are painted by ::highlight() onto the page's own
         * elements, which cannot see the tokens on our panel — so the skin
         * and the light/dark go on <html> for as long as the launcher is up,
         * and come off with it. See the note in content.css.
         */
        function dressRoot(on) {
            const html = document.documentElement;
            if (!on) {
                delete html.dataset.bbSkimSkin;
                delete html.dataset.bbSkimTheme;
                return;
            }
            html.dataset.bbSkimSkin = panel.dataset.bbSkin || 'default';
            html.dataset.bbSkimTheme = panel.dataset.bbTheme || 'light';
        }

        async function show(from) {
            source = Skim.SOURCES.includes(from) ? from : 'page';
            if (open) {
                input.focus();
                input.select();
                selected = 0;
                asked = null;
                refreshRemote();
                draw();
                return;
            }

            if (!panel) build(await appearance());
            else {
                // The skin may have changed, or the page's own light/dark,
                // since the last time it was opened.
                const look = await appearance();
                panel.dataset.bbTheme = look.theme;
                panel.dataset.bbSkin = look.skin;
            }
            dressRoot(true);
            open = true;
            window.addEventListener('keydown', onKey, true);
            query = '';
            selected = 0;
            pos = 'center';
            remote = { tabs: [], history: [] };
            asked = null;
            input.value = '';
            panel.classList.add('is-open');
            setFooter('Skim');
            draw();
            place();
            input.focus();
            refreshRemote();
        }

        function close() {
            if (!open) return;
            open = false;
            window.removeEventListener('keydown', onKey, true);
            clearHits();
            dressRoot(false);
            clearTimeout(debounce);
            if (panel) panel.classList.remove('is-open');
            if (pulse) pulse.hidden = true;
            rows = [];
        }

        return { show, close, isOpen: () => open };
    }

    const SkimContent = { createSkim };

    root.BB = root.BB || {};
    root.BB.SkimContent = SkimContent;
    if (typeof module !== 'undefined' && module.exports) module.exports = SkimContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
