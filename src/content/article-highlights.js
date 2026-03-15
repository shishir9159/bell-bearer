/**
 * Highlighting in the text reader: a pen over the article, a note under a
 * passage, and all of it copied out as Markdown when the reading is done.
 *
 * **Nothing is stored.** A highlight lives in the page it was made on, as
 * long as that page is open — closing the reader and opening it again finds
 * it where it was, a reload does not. What is kept of a reading is what is
 * copied out of it: the passages, their notes and a link back to each.
 *
 * **The pen is the browser's own selection.** Unlike the YouTube reader,
 * whose transcript is words with times and drawn word by word, an article is
 * any markup at all, and a selection already knows how to cross it. With the
 * pen on, letting go of a selection inks it at once, snapped to whole words,
 * with an Undo — no menu to confirm it through. With the pen off a selection
 * is a selection, for copying. Alt held makes the pen an eraser. Ink is
 * <mark> around the article's text: the article is the reader's own copy,
 * so splitting its text nodes breaks nothing of the page's.
 *
 * A highlight is offsets into the article's text (src/shared/text-anchor.js)
 * — the text nodes in order, with a line break counted between blocks, so a
 * paragraph's last word and the next one's first are two words, and a
 * passage across them quotes as two lines.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Icons = ns.Icons || req('../shared/icons.js');
    const Ids = ns.Ids || req('../shared/ids.js');
    const TextAnchor = ns.TextAnchor || req('../shared/text-anchor.js');

    /** How long the toolbar outlives the pointer leaving its highlight: long enough to reach it. */
    const HIDE_MS = 280;

    /** The blocks the text is counted in: a line break between two of them, and a note goes under one. */
    const BLOCKS = 'p, li, h2, h3, h4, h5, h6, blockquote, pre, td, th, dt, dd, figcaption, caption, summary';
    /** Containers whose own white space is layout, not text: no ink on it. */
    const LAYOUT = /^(UL|OL|DL|TABLE|THEAD|TBODY|TFOOT|TR|DIV|FIGURE|DETAILS|BLOCKQUOTE|SECTION)$/;

    const ICON = Object.freeze({
        pen: Icons.svg('highlighter', { size: 18 }),
        list: Icons.svg('quotes', { size: 18 }),
        note: Icons.svg('note-pencil', { size: 16 }),
        link: Icons.svg('link-simple', { size: 16 }),
        trash: Icons.svg('trash', { size: 16 }),
        copy: Icons.svg('copy', { size: 14 }),
    });

    // ------------------------------------------------------- the text

    /**
     * The article's text and where each of its text nodes starts in it.
     * A note drawn under a passage is not the article's text; a text node
     * in another block than the one before is a line further on.
     */
    function modelOf(body) {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => (node.parentElement && node.parentElement.closest('.tr-note') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
        });
        const segments = [];
        const at = new Map();
        let text = '';
        let block = null;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const own = (node.parentElement && node.parentElement.closest(BLOCKS)) || body;
            if (block && own !== block) text += '\n';
            block = own;
            const segment = { node, start: text.length };
            segments.push(segment);
            at.set(node, segment);
            text += node.data;
        }
        return { text, segments, at };
    }

    /** A boundary in the DOM — a selection's end — as an offset into the text, or null outside it. */
    function offsetOf(model, container, offset) {
        if (container.nodeType === 3) {
            const segment = model.at.get(container);
            return segment ? segment.start + offset : null;
        }
        const point = document.createRange();
        try { point.setStart(container, offset); } catch (_) { return null; }
        let found = 0;
        for (const { node, start } of model.segments) {
            if (point.comparePoint(node, node.data.length) >= 0) break;
            found = start + node.data.length;
        }
        return found;
    }

    /** Ink over `start`–`end`: each text node it crosses split at the ends and wrapped. */
    function paint(model, mark) {
        const pieces = [];
        for (const { node, start } of model.segments) {
            const from = Math.max(mark.start, start);
            const to = Math.min(mark.end, start + node.data.length);
            if (from < to) pieces.push([node, from - start, to - start]);
            if (start >= mark.end) break;
        }
        const made = [];
        for (const [node, a, b] of pieces) {
            const parent = node.parentElement;
            // Formulas are MathML, which a <mark> inside would break; and the
            // white space between two blocks is layout, which ink would show.
            if (!parent || parent.closest('math')) continue;
            if (!/\S/.test(node.data.slice(a, b)) && LAYOUT.test(parent.tagName)) continue;
            let target = node;
            if (b < target.data.length) target.splitText(b);
            if (a > 0) target = target.splitText(a);
            const ink = document.createElement('mark');
            ink.className = 'tr-mark';
            ink.dataset.h = mark.id;
            target.parentNode.insertBefore(ink, target);
            ink.appendChild(target);
            made.push(ink);
        }
        if (made.length) {
            made[0].classList.add('is-start');
            made[made.length - 1].classList.add('is-end');
        }
        return made;
    }

    function unpaint(body, id) {
        for (const ink of body.querySelectorAll(`mark.tr-mark[data-h="${id}"]`)) {
            const parent = ink.parentNode;
            while (ink.firstChild) parent.insertBefore(ink.firstChild, ink);
            ink.remove();
            parent.normalize();
        }
    }

    /** A passage as Markdown quotes it: a line of the quote for each block it crosses. */
    function quoteLines(text) {
        return text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    }

    /**
     * Every highlight of a reading as Markdown: under each article's title,
     * linked, each passage quoted with a link that opens the page at it, and
     * its note under it. `articles` is `[{ title, url, text, marks }]`.
     */
    function markdownOf(articles) {
        const out = [];
        for (const { title, url, text, marks } of articles) {
            if (!marks.length) continue;
            const base = String(url || '').split('#')[0];
            out.push(`## [${String(title || base).replace(/([[\]])/g, '\\$1')}](${base})`, '');
            for (const mark of marks) {
                const lines = quoteLines(text.slice(mark.start, mark.end));
                if (!lines.length) continue;
                const link = TextAnchor.fragment(text, mark.start, mark.end);
                lines[lines.length - 1] += link ? ` [↗](${base}${link})` : '';
                out.push(...lines.map((line) => `> ${line}`), '');
                if (mark.note && mark.note.trim()) out.push(mark.note.trim(), '');
            }
        }
        return out.join('\n').trim();
    }

    // ---------------------------------------------------- the pen

    function createHighlights({ element, body, aside, tools, selection, toast, copyText, jumpTo, onChange, article }) {
        let marks = [];
        let pen = true;
        let alt = false;
        let picked = null;
        let editing = null;
        let hideTimer = 0;
        let alive = true;

        const toolbar = document.createElement('div');
        toolbar.className = 'tr-tb';
        toolbar.hidden = true;
        toolbar.innerHTML = `<button type="button" class="tr-tb-note" title="Note" aria-label="Note">${ICON.note}</button>
            <button type="button" class="tr-tb-link" title="Copy a link to this passage" aria-label="Copy a link to this passage">${ICON.link}</button>
            <button type="button" class="tr-tb-remove" title="Remove (Backspace)" aria-label="Remove">${ICON.trash}</button>`;
        element.appendChild(toolbar);

        const penButton = document.createElement('button');
        penButton.type = 'button';
        penButton.className = 'tr-btn tr-pen';
        penButton.title = 'Pen — letting go of a selection inks it (Alt to erase)';
        penButton.setAttribute('aria-label', 'Pen');
        penButton.innerHTML = ICON.pen;
        const listButton = document.createElement('button');
        listButton.type = 'button';
        listButton.className = 'tr-btn tr-list-btn';
        listButton.title = 'Highlights';
        listButton.setAttribute('aria-label', 'Highlights');
        listButton.innerHTML = `${ICON.list}<span class="tr-list-count"></span>`;
        tools.prepend(penButton, listButton);

        const model = () => modelOf(body);

        function setPen(on) {
            pen = !!on;
            penButton.setAttribute('aria-pressed', String(pen));
            element.classList.toggle('is-pen', pen);
        }

        // -------------------------------------------- drawing them all

        /** Every highlight drawn afresh from `next`, which becomes the list. */
        function redraw(next) {
            for (const mark of marks) unpaint(body, mark.id);
            marks = next.slice().sort((a, b) => a.start - b.start);
            const now = model();
            // Last first. Painting splits text nodes, and a split keeps the
            // text before it in the node the model knows; painted in reading
            // order, a second highlight in the same paragraph was looked for
            // in a node the first had already cut short, and never drawn.
            for (const mark of marks.slice().reverse()) paint(now, mark);
            if (picked && !marks.some((one) => one.id === picked)) picked = null;
            renderNotes();
            renderList();
            if (onChange) onChange(marks.map((one) => ({ ...one })), now.text);
        }

        /** Highlights kept from before — this article opened again — each found where its words are now. */
        function load(records) {
            const { text } = model();
            const found = [];
            for (const record of records || []) {
                const at = TextAnchor.locate(text, record);
                if (at) found.push({ ...record, ...at, exact: text.slice(at.start, at.end) });
            }
            marks = [];
            redraw(found);
        }

        function add(start, end) {
            const { text } = model();
            const span = TextAnchor.snap(text, start, end);
            if (!span) return;
            const before = marks.slice();
            const { marks: next } = TextAnchor.merge(marks, { id: Ids.next('th'), ...span, note: '' }, text);
            redraw(next);
            toast('Highlighted', () => redraw(before));
        }

        function remove(id) {
            const before = marks.slice();
            hideToolbar(true);
            redraw(marks.filter((one) => one.id !== id));
            toast('Highlight removed', () => redraw(before));
        }

        /** The eraser: every highlight the stroke crossed. */
        function erase(start, end) {
            const hit = marks.filter((one) => one.start < end && one.end > start);
            if (!hit.length) return;
            const before = marks.slice();
            redraw(marks.filter((one) => !hit.includes(one)));
            toast(hit.length === 1 ? 'Highlight removed' : `${hit.length} highlights removed`, () => redraw(before));
        }

        /** The selection let go of, inked or erased; anything else is left as it was. */
        function take(erasing) {
            if (!alive || !pen) return;
            const sel = selection();
            const range = sel && sel.range;
            if (!range || range.collapsed) return;
            if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return;
            const now = model();
            const a = offsetOf(now, range.startContainer, range.startOffset);
            const b = offsetOf(now, range.endContainer, range.endOffset);
            if (a === null || b === null || a === b) return;
            sel.clear();
            if (erasing) erase(Math.min(a, b), Math.max(a, b));
            else add(Math.min(a, b), Math.max(a, b));
        }

        // ------------------------------------------------- the toolbar

        const inksOf = (id) => [...body.querySelectorAll(`mark.tr-mark[data-h="${id}"]`)];

        function showToolbar(id, near) {
            clearTimeout(hideTimer);
            toolbar.dataset.h = id;
            toolbar.hidden = false;
            const box = element.getBoundingClientRect();
            const at = (near || inksOf(id)[0]).getBoundingClientRect();
            const width = toolbar.offsetWidth;
            toolbar.style.left = `${Math.max(8, Math.min(at.left - box.left + at.width / 2 - width / 2, box.width - width - 8))}px`;
            toolbar.style.top = `${Math.max(56, at.top - box.top - toolbar.offsetHeight - 6)}px`;
        }

        function hideToolbar(now) {
            clearTimeout(hideTimer);
            const go = () => {
                toolbar.hidden = true;
                if (picked) inksOf(picked).forEach((ink) => ink.classList.remove('is-picked'));
                picked = null;
            };
            if (now) go();
            else hideTimer = setTimeout(go, HIDE_MS);
        }

        function pick(id, near) {
            if (picked && picked !== id) inksOf(picked).forEach((ink) => ink.classList.remove('is-picked'));
            picked = id;
            inksOf(id).forEach((ink) => ink.classList.add('is-picked'));
            showToolbar(id, near);
        }

        async function copyLink(id) {
            const mark = marks.find((one) => one.id === id);
            if (!mark) return;
            const { text } = model();
            const url = String(article().url || '').split('#')[0] + TextAnchor.fragment(text, mark.start, mark.end);
            toast((await copyText(url)) ? 'Copied a link to the passage' : 'Could not reach the clipboard');
        }

        toolbar.addEventListener('pointerenter', () => clearTimeout(hideTimer));
        toolbar.addEventListener('pointerleave', () => { if (!picked) hideToolbar(); });
        Dom.holdFocus(toolbar);
        toolbar.addEventListener('click', (event) => {
            const id = toolbar.dataset.h;
            if (event.target.closest('.tr-tb-note')) startNote(id);
            else if (event.target.closest('.tr-tb-link')) copyLink(id);
            else if (event.target.closest('.tr-tb-remove')) remove(id);
        });

        // ---------------------------------------------------- notes

        /** Under the block a highlight ends in: a list item's or a cell's own end, else after the block. */
        function placeNote(note, mark) {
            const inks = inksOf(mark.id);
            const last = inks[inks.length - 1];
            if (!last) return;
            const block = last.closest(BLOCKS);
            if (!block || !body.contains(block)) last.after(note);
            else if (/^(LI|TD|TH|DD|DT)$/.test(block.tagName)) block.appendChild(note);
            else block.after(note);
        }

        function renderNotes() {
            body.querySelectorAll('.tr-note').forEach((note) => note.remove());
            for (const mark of marks) {
                if (!(mark.note && mark.note.trim()) && editing !== mark.id) continue;
                const note = document.createElement('div');
                note.className = 'tr-note';
                note.dataset.h = mark.id;
                if (editing === mark.id) {
                    note.classList.add('is-editing');
                    note.innerHTML = `<textarea rows="2" placeholder="A note on this passage" aria-label="Note"></textarea>`;
                    const field = note.querySelector('textarea');
                    field.value = mark.note || '';
                    field.addEventListener('input', () => {
                        mark.note = field.value;
                        if (onChange) onChange(marks.map((one) => ({ ...one })), model().text);
                        renderList();
                    });
                    field.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            field.blur();
                        }
                    });
                    field.addEventListener('blur', () => {
                        if (editing !== mark.id) return;
                        editing = null;
                        renderNotes();
                    });
                    placeNote(note, mark);
                    field.focus({ preventScroll: true });
                } else {
                    note.innerHTML = `${ICON.note}<span></span>`;
                    note.querySelector('span').textContent = mark.note.trim();
                    note.title = 'Edit the note';
                    placeNote(note, mark);
                }
            }
        }

        function startNote(id) {
            hideToolbar(true);
            editing = id;
            renderNotes();
        }

        // ------------------------------------------------------ list

        /** The highlights beside the column: each passage, its note, and Copy for them all. */
        function renderList() {
            const count = marks.length;
            listButton.querySelector('.tr-list-count').textContent = count ? String(count) : '';
            element.classList.toggle('has-marks', count > 0);
            if (!count) {
                aside.innerHTML = '';
                return;
            }
            const { text } = model();
            aside.innerHTML = `<div class="tr-aside-head"><p class="tr-aside-title">Highlights <span>${count}</span></p>
                <button type="button" class="tr-copy" title="Copy every highlight as Markdown">${ICON.copy}<span>Copy</span></button></div>
                <ol class="tr-hl-list">${marks.map((mark) => `<li><button type="button" class="tr-hl" data-h="${Dom.escapeAttr(mark.id)}">
                    <span class="tr-hl-quote">${Dom.escapeHtml(TextAnchor.quote(text, mark.start, mark.end))}</span>
                    ${mark.note && mark.note.trim() ? `<span class="tr-hl-note">${Dom.escapeHtml(mark.note.trim())}</span>` : ''}</button></li>`).join('')}</ol>`;
        }

        aside.addEventListener('click', (event) => {
            if (event.target.closest('.tr-copy')) {
                copyAll();
                return;
            }
            const item = event.target.closest('.tr-hl');
            if (!item) return;
            const first = inksOf(item.dataset.h)[0];
            if (first) {
                jumpTo(first);
                pick(item.dataset.h, first);
            }
        });

        async function copyAll() {
            const label = aside.querySelector('.tr-copy span');
            const ok = await copyText(markdownOf(article().all()));
            if (!alive) return;
            toast(ok ? 'Copied the highlights as Markdown' : 'Could not reach the clipboard');
            if (ok && label) {
                label.textContent = 'Copied';
                setTimeout(() => { if (label.isConnected) label.textContent = 'Copy'; }, 1600);
            }
        }

        // --------------------------------------------------- events

        body.addEventListener('pointerup', (event) => {
            if (event.button !== 0) return;
            const erasing = event.altKey;
            // After the browser has settled the selection the press made.
            setTimeout(() => take(erasing), 0);
        });
        body.addEventListener('click', (event) => {
            const ink = event.target.closest('mark.tr-mark');
            const sel = selection();
            if (ink && (!sel || !sel.range || sel.range.collapsed)) {
                if (event.altKey) remove(ink.dataset.h);
                else pick(ink.dataset.h, ink);
                return;
            }
            const note = event.target.closest('.tr-note:not(.is-editing)');
            if (note) startNote(note.dataset.h);
            else if (picked && !event.target.closest('.tr-tb')) hideToolbar(true);
        });
        body.addEventListener('pointerover', (event) => {
            const ink = event.target.closest('mark.tr-mark');
            if (ink && !picked && !editing) showToolbar(ink.dataset.h, ink);
        });
        body.addEventListener('pointerout', (event) => {
            const ink = event.target.closest('mark.tr-mark');
            if (ink && !picked && !(event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('mark.tr-mark'))) hideToolbar();
        });
        penButton.addEventListener('click', () => setPen(!pen));
        listButton.addEventListener('click', () => element.classList.toggle('is-list-open'));

        setPen(true);
        renderList();

        return {
            load,
            setPen,
            /** Alt held: the pen erases. */
            setAlt(on) {
                alt = !!on;
                element.classList.toggle('is-erasing', alt && pen);
            },
            /** Escape: lets go of a picked highlight first. Answers whether it did anything. */
            escape() {
                if (picked || !toolbar.hidden) {
                    hideToolbar(true);
                    return true;
                }
                return false;
            },
            removePicked() {
                if (!picked) return false;
                remove(picked);
                return true;
            },
            /** The column moved: the toolbar over a word that is no longer there goes. */
            onScroll() {
                if (!toolbar.hidden) hideToolbar(true);
            },
            copyAll,
            /** Highlighting switched off in Settings: the ink comes off the article, and the list is kept. */
            destroy() {
                alive = false;
                for (const mark of marks) unpaint(body, mark.id);
                body.querySelectorAll('.tr-note').forEach((note) => note.remove());
                aside.innerHTML = '';
                element.classList.remove('has-marks', 'is-pen', 'is-erasing', 'is-list-open');
                clearTimeout(hideTimer);
                toolbar.remove();
                penButton.remove();
                listButton.remove();
            },
            get records() { return marks.map((one) => ({ ...one })); },
            get pen() { return pen; },
        };
    }

    const ArticleHighlights = { createHighlights, modelOf, offsetOf, paint, unpaint, markdownOf, quoteLines, HIDE_MS, ICON };

    root.BB = root.BB || {};
    root.BB.ArticleHighlights = ArticleHighlights;
    if (typeof module !== 'undefined' && module.exports) module.exports = ArticleHighlights;
})(typeof globalThis !== 'undefined' ? globalThis : this);
