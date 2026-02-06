/**
 * The reader's transcript column: the snippets as rows, which row is playing,
 * and which rows a selection or a checkpoint covers.
 *
 * Pulled out of src/content/reader.js because it is the part most likely to
 * need changing when YouTube's caption shapes move, and because almost all of
 * it is arithmetic over the snippet list that can be tested without a page.
 *
 * **A row is anchored by its time, never by where it sits in the DOM.** The
 * rows are our own rendering of a transcript we fetched, so a checkpoint's
 * `start` and `end` already say which rows it covers. There is nothing like
 * obsidian-clipper's XPath-plus-quote anchoring here, because there is
 * nothing here that can go stale.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Time = ns.Time || req('../shared/time.js');

    const ROW_CLASS = 'bb-rt-row';

    /**
     * The snippets as `{ start, end, text }`, in time order, with the blank
     * ones left out — auto-generated tracks carry empty snippets as spacers,
     * and an empty row is a row you can click on and nothing happens.
     */
    function entriesOf(transcript) {
        const snippets = (transcript && transcript.snippets) || [];
        return snippets
            .map((snippet) => ({
                start: Number(snippet.start) || 0,
                end: (Number(snippet.start) || 0) + Math.max(0, Number(snippet.duration) || 0),
                text: String(snippet.text || '').replace(/\s+/g, ' ').trim(),
            }))
            .filter((entry) => entry.text)
            .sort((a, b) => a.start - b.start);
    }

    function rowsHtml(entries) {
        return entries.map((entry, index) => `
            <p class="${ROW_CLASS}" data-i="${index}" data-start="${entry.start}"><span
               class="bb-rt-time" aria-hidden="true">${Time.formatTime(entry.start)}</span><span
               class="bb-rt-text">${Dom.escapeHtml(entry.text)}</span></p>`).join('');
    }

    /**
     * The row playing at `t`: the last one that has started.
     *
     * A floor search over the starts rather than transcript.getSnippetAtTime,
     * which answers null in the gap between two snippets. That gap is every
     * pause in speech, and a highlight that blinks off at each one reads as
     * the reader losing its place.
     */
    function activeIndex(entries, t) {
        let low = 0;
        let high = entries.length - 1;
        let found = -1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (entries[mid].start <= t) {
                found = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return found;
    }

    /** The row element a node sits in, or null. Text nodes are walked up from. */
    function rowAt(node) {
        let at = node && node.nodeType === 3 ? node.parentNode : node;
        while (at && at.nodeType === 1) {
            if (at.classList && at.classList.contains(ROW_CLASS)) return at;
            at = at.parentNode;
        }
        return null;
    }

    const indexOf = (row) => (row ? Number(row.dataset.i) : -1);

    /**
     * The row at one end of a range. A drag that ends in the whitespace past
     * the last line leaves the boundary on the container rather than in a
     * row, pointing between two children — the one before it is the row
     * the selection actually reached, and the one after is where it began.
     */
    function rowAtBoundary(container, offset, side) {
        const direct = rowAt(container);
        if (direct || !container || container.nodeType !== 1) return direct;
        const children = container.childNodes || [];
        // Walked past the whitespace text between the rows' markup.
        const step = side === 'end' ? -1 : 1;
        for (let i = side === 'end' ? offset - 1 : offset; i >= 0 && i < children.length; i += step) {
            const child = children[i];
            if (child.nodeType !== 1) continue;
            if (rowAt(child)) return rowAt(child);
            const rows = child.querySelectorAll ? child.querySelectorAll(`.${ROW_CLASS}`) : [];
            if (rows.length) return side === 'end' ? rows[rows.length - 1] : rows[0];
        }
        return null;
    }

    /**
     * Where the next line starts, when it starts before this one says it
     * ends. Auto-generated captions overlap each other by design, and a
     * checkpoint ending at the last line's own end would reach into — and
     * shade — the line after it that was never selected.
     */
    function endOf(entries, index) {
        const entry = entries[index];
        const next = entries[index + 1];
        return next && next.start > entry.start && next.start < entry.end ? next.start : entry.end;
    }

    /**
     * The span a selection covers, as `{ first, last, start, end }`, or null
     * when it is not a selection of these rows. `start` is the first row's
     * start and `end` the last row's end — the times *are* the anchor.
     */
    function selectionToRange(range, entries) {
        if (!range || range.collapsed) return null;
        const first = indexOf(rowAtBoundary(range.startContainer, range.startOffset, 'start'));
        let last = indexOf(rowAtBoundary(range.endContainer, range.endOffset, 'end'));
        // A triple-click, or a drag let go at the start of a line, ends the
        // range at offset 0 of the *next* row. Nothing of that row is in it.
        if (last > first && range.endOffset === 0 && rowAt(range.endContainer)) last--;
        if (first < 0 || last < first || !entries[first] || !entries[last]) return null;
        return { first, last, start: entries[first].start, end: endOf(entries, last) };
    }

    /**
     * What was selected, exactly — half a sentence if that is what you took
     * — with the time labels left out and one space between lines, which the
     * browser's own toString() does not put there.
     */
    function rangeText(range) {
        const fragment = range.cloneContents();
        const texts = fragment.querySelectorAll ? fragment.querySelectorAll('.bb-rt-text') : [];
        const raw = texts.length
            ? Array.from(texts, (node) => node.textContent).join(' ')
            : fragment.textContent;
        return String(raw || '').replace(/\s+/g, ' ').trim();
    }

    /**
     * How many checkpoints cover each row: a row is covered when it starts
     * inside a checkpoint's span. A checkpoint that is a point in time rather
     * than a span covers the row playing at that moment.
     *
     * A count rather than a flag, so overlapping checkpoints deepen the
     * shading instead of two rules fighting over one row.
     */
    function marksFor(entries, checkpoints) {
        const marks = new Array(entries.length).fill(0);
        for (const checkpoint of checkpoints || []) {
            const start = typeof checkpoint.start === 'number' ? checkpoint.start : checkpoint.time;
            const end = typeof checkpoint.end === 'number' ? checkpoint.end : null;
            if (typeof start !== 'number') continue;
            if (end === null || end <= start) {
                const at = activeIndex(entries, start);
                if (at >= 0) marks[at]++;
                continue;
            }
            for (let i = Math.max(0, activeIndex(entries, start)); i < entries.length; i++) {
                if (entries[i].start >= end) break;
                if (entries[i].start >= start) marks[i]++;
            }
        }
        return marks;
    }

    // ------------------------------------------------ paragraphs and words

    /**
     * How the lines are gathered into paragraphs. A caption track is a run of
     * two-second lines, and set one to a row it reads as a list rather than
     * as speech. A paragraph closes at the first sentence end once it has run
     * PARA_MIN seconds, and wherever it has reached PARA_MAX regardless — an
     * auto-generated track can go minutes without a full stop.
     */
    const PARA_MIN = 15;
    const PARA_MAX = 40;

    /**
     * A sentence ends at its stop. One that runs on past SENTENCE_SOFT words
     * ends at the next line break as well, and past SENTENCE_HARD at any
     * word: the band layout sets the playing sentence large, in a box three
     * lines tall, and an unpunctuated track would otherwise be one sentence.
     */
    const SENTENCE_SOFT = 28;
    const SENTENCE_HARD = 44;

    const STOP = /[.?!…]["'”’)\]]*$/;

    /**
     * The transcript as paragraphs of sentences of words, each word with the
     * time it is said at:
     *
     *   { words: [{ i, t, time, end, p, s, e }], paras: [{ i, start, from, to }],
     *     sentences: [{ i, from, to, p }], entryWords: [[from, to]], end }
     *
     * A line only says when it starts and ends, so its words are spread over
     * that span by their length — a long word takes longer to say than "a".
     * `end` is when the word gives way to the next: the next word's time, or
     * for a line's last word the line's own end.
     *
     * A chapter starts a paragraph of its own, so the transcript breaks where
     * the chapter chips under the player do.
     */
    function build(entries, { chapters = [] } = {}) {
        const words = [];
        const paras = [];
        const sentences = [];
        const entryWords = [];
        const starts = chapters.map((chapter) => chapter.start).filter((t) => t > 0).sort((a, b) => a - b);
        let para = null;
        let sentence = null;

        const closeSentence = () => {
            if (sentence) sentences.push(sentence);
            sentence = null;
        };
        const closePara = () => {
            closeSentence();
            if (para) paras.push(para);
            para = null;
        };

        entries.forEach((entry, e) => {
            const previous = entries[e - 1];
            const chapterHere = previous && starts.some((t) => t > previous.start && t <= entry.start);
            const ran = para ? entry.start - para.start : 0;
            const stopped = previous && STOP.test(previous.text);
            if (para && (chapterHere || ran >= PARA_MAX || (ran >= PARA_MIN && stopped) || /^>>/.test(entry.text))) closePara();
            if (!para) para = { i: paras.length, start: entry.start, from: words.length, to: words.length };

            const end = endOf(entries, e);
            const tokens = entry.text.split(' ');
            const length = entry.text.length || 1;
            let at = 0;
            const first = words.length;
            tokens.forEach((t, k) => {
                if (!sentence) sentence = { i: sentences.length, from: words.length, to: words.length, p: para.i };
                const word = {
                    i: words.length, t, time: entry.start + (at / length) * (end - entry.start),
                    end, p: para.i, s: sentence.i, e,
                };
                if (k > 0) words[words.length - 1].end = word.time;
                words.push(word);
                at += t.length + 1;
                para.to = sentence.to = word.i;
                const count = sentence.to - sentence.from + 1;
                const lineEnd = k === tokens.length - 1;
                if (STOP.test(t) || count >= SENTENCE_HARD || (lineEnd && count >= SENTENCE_SOFT)) closeSentence();
            });
            entryWords.push([first, words.length - 1]);
        });
        closePara();
        const last = entries[entries.length - 1];
        return { words, paras, sentences, entryWords, end: last ? endOf(entries, entries.length - 1) : 0 };
    }

    /** The word being said at `t`: the last one started, or -1 before the first. */
    function wordAt(model, t) {
        let low = 0;
        let high = model.words.length - 1;
        let found = -1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (model.words[mid].time <= t) {
                found = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return found;
    }

    /** Slack for a time that was rounded to the hundredth on its way to storage. */
    const EPS = 0.006;

    const hundredth = (value) => Math.round(value * 100) / 100;

    /**
     * The times a run of words covers, as a checkpoint stores them: from the
     * first word's start to the last word's end, to the hundredth.
     */
    function spanOf(model, from, to) {
        return { start: hundredth(model.words[from].time), end: hundredth(model.words[to].end) };
    }

    const textOf = (model, from, to) => model.words.slice(from, to + 1).map((word) => word.t).join(' ');

    /**
     * The words a checkpoint covers, as `{ from, to }`, or null when it falls
     * outside the transcript. Every word that starts inside the span — so a
     * highlight saved from these words maps back onto exactly them, and an
     * older checkpoint floored to the whole second, or made by holding Ctrl+B
     * over a passage, covers what was said while it ran. A point in time with
     * no span covers the line playing at that moment.
     */
    function rangeOf(model, checkpoint) {
        const start = typeof checkpoint.start === 'number' ? checkpoint.start : checkpoint.time;
        const end = typeof checkpoint.end === 'number' ? checkpoint.end : null;
        if (typeof start !== 'number' || !model.words.length || start >= model.end) return null;
        if (end === null || end <= start) {
            const at = wordAt(model, start + EPS);
            if (at < 0) return null;
            const [from, to] = model.entryWords[model.words[at].e];
            return { from, to };
        }
        const from = firstFrom(model, start - EPS);
        const to = firstFrom(model, end - EPS) - 1;
        if (to < from) {
            // Shorter than the gap between two words: the word it began in.
            const at = wordAt(model, start + EPS);
            return at < 0 ? null : { from: at, to: at };
        }
        return { from, to };
    }

    /** The first word that starts at or after `t`; the word count when none does. */
    function firstFrom(model, t) {
        let low = 0;
        let high = model.words.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (model.words[mid].time < t) low = mid + 1;
            else high = mid;
        }
        return low;
    }

    /**
     * A note Bell Bearer wrote, not one the user did: Ctrl+B and the segment
     * keys label each checkpoint with its own times. The reader shows a note
     * under the passage it belongs to, and a label there is only noise.
     */
    const ownNote = (note) => {
        const text = String(note || '').trim();
        return /^(Checkpoint|Segment:) \d/.test(text) ? '' : text;
    };

    /**
     * Fold a range into the highlights it touches. Any highlight it overlaps,
     * or that ends on the word before it or starts on the word after it,
     * becomes part of one: two marks side by side are one passage, and the
     * reader draws them as one. Their notes are kept, joined in order.
     *
     * `base` is the highlight being dragged or trimmed: it is replaced by
     * the range rather than merged with it, so a trim can shrink it. The one
     * kept is `base`, or else the first one absorbed; `absorbed` is every
     * other one, for the caller to delete.
     */
    function merge(highlights, range, base = null) {
        const own = base ? highlights.find((h) => h.id === base) : null;
        let { from, to } = range;
        let note = own ? own.note || '' : '';
        let keep = own ? own.id : null;
        const absorbed = [];
        const sorted = highlights.slice().sort((a, b) => a.from - b.from);
        for (const h of sorted) {
            if (own && h.id === own.id) continue;
            if (h.to >= from - 1 && h.from <= to + 1) {
                from = Math.min(from, h.from);
                to = Math.max(to, h.to);
                if (h.note) note = note ? `${note} ${h.note}` : h.note;
                if (keep) absorbed.push(h.id);
                else keep = h.id;
            }
        }
        return { from, to, note, keep, absorbed, merged: !!(keep && keep !== base) || absorbed.length > 0 };
    }

    /**
     * The transcript's markup: a paragraph per block, its time in the gutter,
     * each sentence a span of word spans. The space after a word is its own
     * span carrying the word's index, so a highlight can run across it and a
     * pointer over it still lands on a word; the space after a sentence sits
     * outside the sentence, so the playing sentence's underline stops at its
     * last word.
     */
    function paragraphsHtml(model) {
        const esc = Dom.escapeHtml;
        return model.paras.map((para) => {
            let html = '';
            for (let s = model.words[para.from].s; s <= model.words[para.to].s; s++) {
                const sentence = model.sentences[s];
                let inner = '';
                for (let w = sentence.from; w <= sentence.to; w++) {
                    inner += `<span class="rd-w" data-w="${w}">${esc(model.words[w].t)}</span>`;
                    if (w < sentence.to) inner += `<span class="rd-sp" data-w="${w}"> </span>`;
                }
                html += `<span class="rd-s" data-s="${s}">${inner}</span>`;
                if (sentence.to < para.to) html += `<span class="rd-sp" data-w="${sentence.to}"> </span>`;
            }
            return `<div class="rd-p" data-p="${para.i}"><button type="button" class="rd-stamp" data-t="${para.start}"
                title="Play from here">${Time.formatTime(para.start)}</button><div class="rd-pbody"><p
                class="rd-text">${html}</p></div></div>`;
        }).join('');
    }

    const ReaderTranscript = {
        ROW_CLASS, entriesOf, rowsHtml, activeIndex, rowAt, indexOf,
        endOf, selectionToRange, rangeText, marksFor,
        PARA_MIN, PARA_MAX, SENTENCE_SOFT, SENTENCE_HARD,
        build, wordAt, spanOf, textOf, rangeOf, ownNote, merge, paragraphsHtml,
    };

    root.BB = root.BB || {};
    root.BB.ReaderTranscript = ReaderTranscript;
    if (typeof module !== 'undefined' && module.exports) module.exports = ReaderTranscript;
})(typeof globalThis !== 'undefined' ? globalThis : this);
