/**
 * What changed between two answers — two regenerates, or the answers to a
 * prompt before and after it was edited.
 *
 * A word-level Myers diff. Whitespace stays attached to the word before it,
 * so the pieces rejoin into exactly the two inputs: joining the '=' and '-'
 * pieces gives the first, the '=' and '+' pieces the second, byte for byte.
 * That is what lets the comparison view draw either side from one result.
 *
 * Past a cap on the number of edits it falls back to the same algorithm over
 * lines. A two-thousand-word answer rewritten from scratch is not worth a
 * quadratic word diff, and a line diff of it reads better anyway: every word
 * changed says nothing a changed paragraph does not. Past the cap on lines
 * too, the two are simply shown as one removed and one added.
 *
 * Pure, node-tested.
 */
(function (root) {
    'use strict';

    /** Edits a word diff may take before it gives way to lines. */
    const WORD_EDITS = 400;
    const LINE_EDITS = 1200;

    /** Words with the whitespace after them, and any leading whitespace on its own. */
    const words = (text) => String(text || '').match(/^\s+|\S+\s*/g) || [];
    /** Lines with their newline. */
    const lines = (text) => String(text || '').match(/[^\n]*\n|[^\n]+/g) || [];

    /**
     * Myers' O((N+M)D) shortest edit script, or null once it would need more
     * than `max` edits. Returns [op, token] pairs in order.
     */
    function myers(a, b, max) {
        const n = a.length;
        const m = b.length;
        const offset = max + 1;
        const v = new Int32Array(2 * max + 3);
        const trace = [];

        for (let d = 0; d <= max; d++) {
            trace.push(v.slice());
            for (let k = -d; k <= d; k += 2) {
                let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
                    ? v[offset + k + 1]
                    : v[offset + k - 1] + 1;
                let y = x - k;
                while (x < n && y < m && a[x] === b[y]) { x++; y++; }
                v[offset + k] = x;
                if (x >= n && y >= m) return backtrack(trace, a, b, offset);
            }
        }
        return null;
    }

    function backtrack(trace, a, b, offset) {
        const ops = [];
        let x = a.length;
        let y = b.length;
        for (let d = trace.length - 1; d >= 0; d--) {
            const v = trace[d];
            const k = x - y;
            const prevK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
            const prevX = v[offset + prevK];
            const prevY = prevX - prevK;
            while (x > prevX && y > prevY) {
                ops.push(['=', a[x - 1]]);
                x--;
                y--;
            }
            if (d > 0) {
                if (x === prevX) ops.push(['+', b[y - 1]]);
                else ops.push(['-', a[x - 1]]);
            }
            x = prevX;
            y = prevY;
        }
        return ops.reverse();
    }

    /** Neighbouring pieces with the same op, as one. */
    function merge(pairs) {
        const out = [];
        for (const [op, text] of pairs) {
            const last = out[out.length - 1];
            if (last && last.op === op) last.text += text;
            else if (text) out.push({ op, text });
        }
        return out;
    }

    /**
     * Diff two token lists: the common head and tail are taken off first,
     * which is most of any two answers to the same prompt, and only the
     * middle is handed to Myers.
     */
    function script(a, b, max) {
        let head = 0;
        while (head < a.length && head < b.length && a[head] === b[head]) head++;
        let tail = 0;
        while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
        const middle = myers(a.slice(head, a.length - tail), b.slice(head, b.length - tail), max);
        if (!middle) return null;
        return [
            ...a.slice(0, head).map((t) => ['=', t]),
            ...middle,
            ...a.slice(a.length - tail).map((t) => ['=', t]),
        ];
    }

    /** { ops, unit } — unit is 'word', 'line' or 'whole', which the view can say. */
    function compare(a, b, { wordEdits = WORD_EDITS, lineEdits = LINE_EDITS } = {}) {
        const left = String(a || '');
        const right = String(b || '');
        if (left === right) return { ops: left ? [{ op: '=', text: left }] : [], unit: 'word' };

        const byWord = script(words(left), words(right), wordEdits);
        if (byWord) return { ops: merge(byWord), unit: 'word' };
        const byLine = script(lines(left), lines(right), lineEdits);
        if (byLine) return { ops: merge(byLine), unit: 'line' };
        return { ops: merge([['-', left], ['+', right]]), unit: 'whole' };
    }

    const diff = (a, b, options) => compare(a, b, options).ops;

    /** One side back out of a diff: 'a' is the '=' and '-' pieces, 'b' the '=' and '+'. */
    const rejoin = (ops, side) => ops.filter((piece) => piece.op === '=' || piece.op === (side === 'a' ? '-' : '+'))
        .map((piece) => piece.text).join('');

    const ChatDiff = { diff, compare, rejoin, words, lines, WORD_EDITS, LINE_EDITS };

    root.BB = root.BB || {};
    root.BB.ChatDiff = ChatDiff;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatDiff;
})(typeof globalThis !== 'undefined' ? globalThis : this);
