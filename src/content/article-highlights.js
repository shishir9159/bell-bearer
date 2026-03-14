/**
 * Highlighting in the text reader: a pen over the article.
 *
 * **Nothing is stored.** A highlight lives in the page it was made on, as
 * long as that page is open — closing the reader and opening it again finds
 * it where it was, a reload does not.
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

    /** The blocks the text is counted in: a line break between two of them. */
    const BLOCKS = 'p, li, h2, h3, h4, h5, h6, blockquote, pre, td, th, dt, dd, figcaption, caption, summary';
    /** Containers whose own white space is layout, not text: no ink on it. */
    const LAYOUT = /^(UL|OL|DL|TABLE|THEAD|TBODY|TFOOT|TR|DIV|FIGURE|DETAILS|BLOCKQUOTE|SECTION)$/;

    const ICON = Object.freeze({
        pen: Icons.svg('highlighter', { size: 18 }),
    });

    // ------------------------------------------------------- the text

    /**
     * The article's text and where each of its text nodes starts in it. A
     * text node in another block than the one before is a line further on.
     */
    function modelOf(body) {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
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


    // ---------------------------------------------------- the pen

    function createHighlights({ element, body, tools, selection, toast, onChange }) {
        let marks = [];
        let pen = true;
        let alt = false;
        let alive = true;

        const penButton = document.createElement('button');
        penButton.type = 'button';
        penButton.className = 'tr-btn tr-pen';
        penButton.title = 'Pen — letting go of a selection inks it (Alt to erase)';
        penButton.setAttribute('aria-label', 'Pen');
        penButton.innerHTML = ICON.pen;
        tools.prepend(penButton);

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
            element.classList.toggle('has-marks', marks.length > 0);
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

        // --------------------------------------------------- events

        body.addEventListener('pointerup', (event) => {
            if (event.button !== 0) return;
            const erasing = event.altKey;
            // After the browser has settled the selection the press made.
            setTimeout(() => take(erasing), 0);
        });
        // Alt and a click on a highlight takes it off.
        body.addEventListener('click', (event) => {
            const ink = event.target.closest('mark.tr-mark');
            const sel = selection();
            if (ink && event.altKey && (!sel || !sel.range || sel.range.collapsed)) remove(ink.dataset.h);
        });
        penButton.addEventListener('click', () => setPen(!pen));

        setPen(true);

        return {
            load,
            setPen,
            /** Alt held: the pen erases. */
            setAlt(on) {
                alt = !!on;
                element.classList.toggle('is-erasing', alt && pen);
            },
            /** Highlighting switched off in Settings: the ink comes off the article, and what was highlighted is kept for its return. */
            destroy() {
                alive = false;
                for (const mark of marks) unpaint(body, mark.id);
                element.classList.remove('has-marks', 'is-pen', 'is-erasing');
                penButton.remove();
            },
            get records() { return marks.map((one) => ({ ...one })); },
            get pen() { return pen; },
        };
    }

    const ArticleHighlights = { createHighlights, modelOf, offsetOf, paint, unpaint, ICON };

    root.BB = root.BB || {};
    root.BB.ArticleHighlights = ArticleHighlights;
    if (typeof module !== 'undefined' && module.exports) module.exports = ArticleHighlights;
})(typeof globalThis !== 'undefined' ? globalThis : this);
