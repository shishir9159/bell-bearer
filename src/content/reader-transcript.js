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

    const ReaderTranscript = { ROW_CLASS, entriesOf, rowsHtml, activeIndex, rowAt, indexOf };

    root.BB = root.BB || {};
    root.BB.ReaderTranscript = ReaderTranscript;
    if (typeof module !== 'undefined' && module.exports) module.exports = ReaderTranscript;
})(typeof globalThis !== 'undefined' ? globalThis : this);
