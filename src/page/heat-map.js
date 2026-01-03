/**
 * A calendar heat map — a column per week, a square per day — drawn as one
 * inline <svg>.
 *
 * It follows the layout of @uiw/react-heat-map (11px squares, 2px gaps, month
 * names along the top, Mon / Wed / Fri down the side, a Less → More legend),
 * but as a string of markup: that package needs React and a bundler, and this
 * extension has neither by design.
 *
 * The squares carry a level class, never a color. dashboard.css mixes each
 * level from the skin's own accent and surface, so the map follows a skin or
 * day/night change without being drawn again.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const Dom = BB.Dom || req('../shared/dom.js');
    const Time = BB.Time || req('../shared/time.js');

    const SIZE = 11;
    const GAP = 2;
    const LEFT = 30;
    const TOP = 18;
    const STEP = SIZE + GAP;

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const WEEKDAYS = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };

    const esc = (text) => Dom.escapeHtml(text);

    const keyOf = (date) => Time.dayKey(date);

    /** 0 for nothing, then 1-4 by the upper bounds in `steps`. */
    function levelOf(value, steps) {
        if (!value) return 0;
        const index = steps.findIndex((bound) => value <= bound);
        return index === -1 ? steps.length + 1 : index + 1;
    }

    /**
     * @param {object} options
     * @param {Object<string, {value: number}>} options.days keyed 'YYYY-MM-DD', local time
     * @param {number} [options.end] the last day shown (its week is the last column)
     * @param {number} [options.weeks]
     * @param {number[]} [options.steps] upper bounds of levels 1-3; above the last is level 4
     * @param {(day: object|undefined, date: Date) => string} options.describe a square's tooltip
     * @param {string[]} [options.legend] a tooltip per legend square, level 0 first
     */
    function render({ days, end = Date.now(), weeks = 53, steps, describe, legend = [] }) {
        const last = new Date(end);
        last.setHours(0, 0, 0, 0);
        const first = new Date(last);
        first.setDate(first.getDate() - (weeks - 1) * 7 - first.getDay());

        const cells = [];
        const months = [];
        let lastLabelCol = -3;
        const date = new Date(first);

        for (let col = 0; col < weeks; col++) {
            for (let row = 0; row < 7; row++) {
                if (date > last) break;
                // A month is named over the first column whose Sunday falls in
                // it. The first column only names its month when enough of that
                // month is left to hold the word before the next one starts.
                if (row === 0) {
                    const opens = col === 0 ? date.getDate() <= 14 : date.getDate() <= 7;
                    if (opens && col - lastLabelCol >= 3) {
                        months.push(`<text class="hm-label" x="${LEFT + col * STEP}" y="${TOP - 6}">${MONTHS[date.getMonth()]}</text>`);
                        lastLabelCol = col;
                    }
                }
                const day = days[keyOf(date)];
                const level = levelOf(day ? day.value : 0, steps);
                cells.push(`<rect class="hm-cell hm-l${level}" x="${LEFT + col * STEP}" y="${TOP + row * STEP}" width="${SIZE}" height="${SIZE}" rx="2" ry="2"><title>${esc(describe(day, new Date(date)))}</title></rect>`);
                date.setDate(date.getDate() + 1);
            }
        }

        const labels = Object.entries(WEEKDAYS).map(([row, name]) =>
            `<text class="hm-label" x="0" y="${TOP + Number(row) * STEP + SIZE - 2}">${name}</text>`).join('');

        const width = LEFT + weeks * STEP;
        const height = TOP + 7 * STEP;

        const legendCells = [0, 1, 2, 3, 4].map((level) =>
            `<span class="hm-swatch hm-l${level}" title="${esc(legend[level] || '')}"></span>`).join('');

        return `
            <div class="hm-scroll">
                <svg class="hm-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Heat map, one square per day">
                    ${months.join('')}${labels}${cells.join('')}
                </svg>
            </div>
            <div class="hm-legend"><span>Less</span>${legendCells}<span>More</span></div>`;
    }

    BB.HeatMap = { render, levelOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
