/**
 * A line over time, drawn as one inline <svg>.
 *
 * The repo had a heat map and nothing else, and a heat map answers "when" but
 * never "how much". This is the other half, and it follows the same contract
 * as src/page/heat-map.js so the two sit beside each other without argument: a
 * page module that hangs itself off `BB`, returns a string of markup, and
 * **bakes in no colour**. The line takes `--accent` and the band takes
 * `--accent-soft` from dashboard.css, so it follows a skin or a day/night
 * change without being drawn again.
 *
 * The one thing worth stating about the arithmetic: **x is scaled by value,
 * not by index.** A series of races with a fortnight's gap in the middle has
 * to show that fortnight as a gap. Spacing the points evenly is the obvious
 * shape and it is wrong — it draws a break in practice as one flat step and
 * makes the week after it look like the week before.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});

    /** Room for the value labels down the left, and for the line's own width. */
    const PAD = Object.freeze({ left: 34, right: 6, top: 8, bottom: 16 });

    const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    /** One decimal is under a tenth of a pixel; more is bytes nobody reads. */
    const n = (value) => Math.round(value * 10) / 10;

    const finite = (value) => Number.isFinite(Number(value));

    /** The points that can actually be plotted, oldest first. */
    function usable(points) {
        return (Array.isArray(points) ? points : [])
            .filter((point) => point && finite(point.x) && finite(point.y))
            .map((point) => ({ ...point, x: Number(point.x), y: Number(point.y) }))
            .sort((a, b) => a.x - b.x);
    }

    /**
     * A moving average over the last `window` points.
     *
     * Trailing rather than centred: the last value has to be the run *as it
     * stands*, and a centred window cannot produce one for the points at the
     * end — which are the only points anybody looks at on a chart of how they
     * are doing.
     */
    function trend(points, window = 10) {
        const rows = usable(points);
        const span = Math.max(1, Math.round(window));
        const out = [];
        let total = 0;
        for (let i = 0; i < rows.length; i++) {
            total += rows[i].y;
            if (i >= span) total -= rows[i - span].y;
            out.push({ x: rows[i].x, y: total / Math.min(i + 1, span) });
        }
        return out;
    }

    /**
     * The scales, as two functions from value to pixel.
     *
     * A series with no spread in x — every race on one day — is spaced by
     * index instead, because dividing by a span of zero is the only case where
     * "by value" has nothing to say. A series with no spread in y is drawn
     * down the middle rather than along the floor: a run of identical scores
     * is a flat line, not a line at nought.
     */
    function scales(rows, width, height) {
        const left = PAD.left;
        const right = width - PAD.right;
        const top = PAD.top;
        const bottom = height - PAD.bottom;

        const xs = rows.map((row) => row.x);
        const ys = rows.map((row) => row.y);
        const xLow = Math.min(...xs);
        const xHigh = Math.max(...xs);
        let yLow = Math.min(...ys);
        let yHigh = Math.max(...ys);
        if (yHigh === yLow) { yLow -= 1; yHigh += 1; }
        // A little air above and below, or the best race sits on the frame.
        const air = (yHigh - yLow) * 0.08;
        yLow -= air;
        yHigh += air;

        const spread = xHigh - xLow;
        const x = (value, index) => (spread > 0
            ? left + ((value - xLow) / spread) * (right - left)
            : left + (rows.length > 1 ? (index / (rows.length - 1)) * (right - left) : (right - left) / 2));
        const y = (value) => bottom - ((value - yLow) / (yHigh - yLow)) * (bottom - top);

        return { x, y, left, right, top, bottom, yLow, yHigh };
    }

    const pathOf = (rows, scale) =>
        rows.map((row, i) => `${i ? 'L' : 'M'}${n(scale.x(row.x, i))} ${n(scale.y(row.y))}`).join('');

    /**
     * @param {object} options
     * @param {{x: number, y: number}[]} options.points x is a timestamp, y the value
     * @param {number} [options.width]
     * @param {number} [options.height]
     * @param {{x: number, lo: number, hi: number}[]} [options.band] drawn behind the line
     * @param {{x: number, y: number}[]} [options.trend] a second, quieter line
     * @param {(point: object) => string} [options.describe] a point's tooltip
     * @param {(value: number) => string} [options.label] how a value is written on the axis
     * @param {string} [options.title] what a screen reader is told the chart is
     */
    function line({ points, width = 640, height = 160, band, trend: run, describe, label, title } = {}) {
        const rows = usable(points);
        // Nothing to draw is an empty string, not an empty <svg>: the panel
        // puts its own "no races yet" in the space instead, and a 640-pixel
        // box of nothing above it would read as a chart that had broken.
        if (!rows.length) return '';

        const scale = scales(rows, width, height);
        const say = typeof label === 'function' ? label : (value) => String(Math.round(value));

        let bandPath = '';
        const bandRows = usable((band || []).map((row) => ({ ...row, y: row.lo })));
        if (bandRows.length > 1) {
            const top = bandRows.map((row, i) => `${i ? 'L' : 'M'}${n(scale.x(row.x, i))} ${n(scale.y(Number(row.hi)))}`).join('');
            const back = bandRows.slice().reverse()
                .map((row, i) => `L${n(scale.x(row.x, bandRows.length - 1 - i))} ${n(scale.y(Number(row.lo)))}`).join('');
            bandPath = `<path class="spark-band" d="${top}${back}Z"/>`;
        }

        const runRows = usable(run);
        const runPath = runRows.length > 1
            ? `<path class="spark-trend" d="${pathOf(runRows, scale)}" fill="none"/>`
            : '';

        const dots = typeof describe === 'function'
            ? rows.map((row, i) =>
                `<circle class="spark-dot" cx="${n(scale.x(row.x, i))}" cy="${n(scale.y(row.y))}" r="2.5"><title>${esc(describe(row))}</title></circle>`).join('')
            : '';

        // Two labels rather than a scale: the top and the bottom of what is
        // drawn. Any more and they crowd a chart this size.
        const axis = `
            <text class="spark-label" x="0" y="${n(scale.top + 4)}">${esc(say(scale.yHigh))}</text>
            <text class="spark-label" x="0" y="${n(scale.bottom)}">${esc(say(scale.yLow))}</text>
            <line class="spark-axis" x1="${PAD.left - 6}" y1="${n(scale.bottom)}" x2="${width - PAD.right}" y2="${n(scale.bottom)}"/>`;

        return `<svg class="spark-svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}"
                     preserveAspectRatio="none" role="img" aria-label="${esc(title || 'A line over time')}">
                ${axis}${bandPath}${runPath}
                <path class="spark-line" d="${pathOf(rows, scale)}" fill="none"/>
                ${dots}
            </svg>`;
    }

    BB.Spark = { line, trend, usable, scales, PAD };

    if (typeof module !== 'undefined' && module.exports) module.exports = BB.Spark;
})(typeof globalThis !== 'undefined' ? globalThis : this);
