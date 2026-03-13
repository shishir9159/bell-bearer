/**
 * A highlight as a span of an article's text, and what is worked out from
 * one: where its words begin and end, how two that touch become one, and a
 * link that opens the page at it.
 *
 * A highlight is `{ start, end, exact }`: offsets into the article's text —
 * every text node of the reader's copy, in order, nothing collapsed — and the
 * words they cover. The offsets are what is drawn from; `exact` is how a
 * highlight that no longer lines up is found again (`locate`), or known to
 * be gone rather than drawn over the wrong words. Nothing here is stored:
 * a highlight lives as long as the page it was made on.
 *
 * Pure, so node can check it; the reader turns a selection into offsets and
 * back (src/content/article-highlights.js).
 */
(function (root) {
    'use strict';

    /** A letter, a digit or a mark that belongs to one: what a word is made of, in any script. */
    const WORD = /[\p{L}\p{N}\p{M}]/u;
    /** An apostrophe inside a word, which is still the word: don't, l'homme. */
    const JOINER = /['’]/u;

    const isWord = (text, at) => {
        const ch = text[at];
        if (ch === undefined) return false;
        if (WORD.test(ch)) return true;
        return JOINER.test(ch) && WORD.test(text[at - 1] || '') && WORD.test(text[at + 1] || '');
    };

    /**
     * `start`–`end` grown to whole words and shorn of the space around them:
     * a selection let go a letter short of a word's end takes the word, as
     * the YouTube reader's pen does word by word.
     */
    function snap(text, start, end) {
        let a = Math.max(0, Math.min(start, end));
        let b = Math.min(text.length, Math.max(start, end));
        while (a < b && /\s/.test(text[a])) a++;
        while (b > a && /\s/.test(text[b - 1])) b--;
        if (a >= b) return null;
        if (isWord(text, a)) while (a > 0 && isWord(text, a - 1)) a--;
        if (isWord(text, b - 1)) while (b < text.length && isWord(text, b)) b++;
        return { start: a, end: b };
    }

    /** The words of a span as they read: runs of white space as one space. */
    const quote = (text, start, end) => text.slice(start, end).replace(/\s+/g, ' ').trim();

    /**
     * `mark` added to `marks`, every highlight it touches or overlaps taken
     * into it — two strokes over one passage are one passage. Notes of the
     * highlights taken in are kept, in order. Answers the new list, in text
     * order, and the highlight `mark` became.
     */
    function merge(marks, mark, text) {
        let start = mark.start;
        let end = mark.end;
        const notes = [];
        const kept = [];
        for (const one of marks) {
            // Touching counts, and so does a gap of nothing but space.
            const between = one.end <= start ? text.slice(one.end, start) : one.start >= end ? text.slice(end, one.start) : '';
            if (one.end < start || one.start > end) {
                if (!(between && !/\S/.test(between))) { kept.push(one); continue; }
            }
            start = Math.min(start, one.start);
            end = Math.max(end, one.end);
            if (one.note) notes.push(one.note);
        }
        if (mark.note) notes.push(mark.note);
        const made = { ...mark, start, end, exact: text.slice(start, end), note: notes.join('\n\n') };
        return { marks: [...kept, made].sort((x, y) => x.start - y.start), made };
    }

    /**
     * Where a highlight is in `text` now: its own offsets if they still
     * cover its words, else the occurrence of its words nearest where they
     * were, else null — gone, and not drawn somewhere it never was.
     */
    function locate(text, mark) {
        if (text.slice(mark.start, mark.end) === mark.exact) return { start: mark.start, end: mark.end };
        if (!mark.exact) return null;
        let best = -1;
        for (let at = text.indexOf(mark.exact); at >= 0; at = text.indexOf(mark.exact, at + 1)) {
            if (best < 0 || Math.abs(at - mark.start) < Math.abs(best - mark.start)) best = at;
        }
        return best < 0 ? null : { start: best, end: best + mark.exact.length };
    }

    /** A text fragment's part, escaped: its own `-`, `,` and `&` would read as its syntax. */
    const part = (words) => encodeURIComponent(words).replace(/-/g, '%2D');

    /** Up to `n` words of `text` going one way from `at`. */
    function words(text, at, n, backward) {
        const side = backward ? text.slice(0, at) : text.slice(at);
        const list = side.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        return (backward ? list.slice(-n) : list.slice(0, n)).join(' ');
    }

    /**
     * `#:~:text=…`, the fragment that opens a page at a passage and marks it
     * (Chrome, Edge and Safari read it; elsewhere it is ignored and the page
     * opens at its top). A long passage is named by its first words and its
     * last, which also survives a footnote mark in its middle; a passage
     * whose words occur more than once in the article carries the words
     * either side of it, to say which.
     */
    function fragment(text, start, end) {
        const exact = quote(text, start, end);
        if (!exact) return '';
        const all = exact.split(' ');
        const body = all.length > 10 ? `${part(all.slice(0, 5).join(' '))},${part(all.slice(-5).join(' '))}` : part(exact);
        const flat = text.replace(/\s+/g, ' ');
        const twice = flat.indexOf(exact) !== flat.lastIndexOf(exact);
        if (!twice) return `#:~:text=${body}`;
        const before = words(text, start, 3, true);
        const after = words(text, end, 3, false);
        return `#:~:text=${before ? `${part(before)}-,` : ''}${body}${after ? `,-${part(after)}` : ''}`;
    }

    const TextAnchor = { snap, quote, merge, locate, fragment, isWord };

    root.BB = root.BB || {};
    root.BB.TextAnchor = TextAnchor;
    if (typeof module !== 'undefined' && module.exports) module.exports = TextAnchor;
})(typeof globalThis !== 'undefined' ? globalThis : this);
