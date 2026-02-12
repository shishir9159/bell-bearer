/**
 * The corner motifs the skins frame a panel with, shared by the settings
 * plate (src/page/plate.js) and the YouTube reader, so a skin's corner is one
 * drawing wherever it is shown. The reader used to draw deco's with bordered
 * spans of its own, and it came out as a different ornament.
 *
 * Taken from the standalone design export, which is the live version of it —
 * the sets and the skin mapping below are that file's own, not one of the
 * earlier frame studies. There are four sets and one of them is empty:
 *
 *   default   plain     nothing at all. No corners, no inner rules — the
 *                       section is a plain card and its title a plain heading.
 *   riso      blocks    three flat squares, the spot inks stacked in a corner.
 *   medieval  bracket   a square bracket, a hairline inside it, and a lozenge
 *                       where the two meet — a ruled page, not a flourish.
 *   deco      fan       the quarter-round fan and its stepped returns.
 *
 * One corner is drawn and the other three are that same set flipped, so a
 * motif is one path list rather than four. Everything is inline SVG because a
 * data: URI cannot read a CSS variable, and the colours have to come from the
 * skin.
 */
(function (root) {
    'use strict';

    /** Drawn into the top-left corner of a 56×56 box. */
    const SETS = {
        plain: [],
        bracket: [
            { d: 'M3 42V3h39', stroke: 'accent', fill: 'none', w: 1.2 },
            { d: 'M8 42V8h34', stroke: 'gold', fill: 'none', w: 0.7 },
            { d: 'M15 8.5 21.5 15 15 21.5 8.5 15Z', stroke: 'none', fill: 'gold', w: 0 },
            { d: 'M15 11.6 18.4 15 15 18.4 11.6 15Z', stroke: 'none', fill: 'surface', w: 0 },
        ],
        fan: [
            { d: 'M0.37 14.22A13.91 13.91 0 0 0 14.28 0.38', stroke: 'gold', fill: 'none', w: 0.9 },
            { d: 'M0.36 16.25A15.94 15.94 0 0 0 16.31 0.38', stroke: 'gold', fill: 'none', w: 0.9 },
            { d: 'M56 2.84L2.84 2.84L2.84 56', stroke: 'accent', fill: 'none', w: 0.9 },
            { d: 'M7.77 0.37L7.77 7.77L18.75 7.77', stroke: 'accent', fill: 'none', w: 0.9 },
            { d: 'M37.21 2.84L37.21 4.89L15.64 4.89', stroke: 'gold', fill: 'none', w: 0.9 },
            { d: 'M0.37 28.23L0.37 0.37L28.23 0.37', stroke: 'accent', fill: 'none', w: 0.9 },
            { d: 'M0.37 7.77L7.77 7.77L7.77 18.75', stroke: 'accent', fill: 'none', w: 0.9 },
            { d: 'M2.84 37.21L4.89 37.21L4.89 15.64', stroke: 'gold', fill: 'none', w: 0.9 },
        ],
        blocks: [
            { d: 'M0 0h16v16H0z', stroke: 'none', fill: 'accent', w: 0 },
            { d: 'M19 0h9v9h-9z', stroke: 'none', fill: 'gold', w: 0 },
            { d: 'M0 19h9v9H0z', stroke: 'none', fill: 'borderStrong', w: 0 },
        ],
    };

    const SKIN = {
        default: 'plain',
        riso: 'blocks',
        medieval: 'bracket',
        deco: 'fan',
    };

    /** Top-left, then the same set mirrored into the other three corners. */
    const POSITIONS = [
        'left:0;top:0',
        'right:0;top:0;transform:scaleX(-1)',
        'left:0;bottom:0;transform:scaleY(-1)',
        'right:0;bottom:0;transform:scale(-1,-1)',
    ];

    function forSkin(skinId) {
        return SKIN[skinId] || SKIN.default;
    }

    /**
     * Set `name` drawn into all four corners, as SVG for a positioned box.
     * `ink` maps the tone names the paths ask for — accent, gold, surface,
     * border, borderStrong — to colours, so each surface paints the same
     * drawing from its own palette; `className` is what it places them by.
     */
    function html(name, ink, className) {
        const paths = SETS[name] || SETS.plain;
        if (!paths.length) return '';
        const paint = (tone) => (tone === 'none' ? 'none' : ink[tone] || tone);
        const drawn = paths.map((path) => `<path d="${path.d}" stroke="${paint(path.stroke)}"`
            + ` fill="${paint(path.fill)}" stroke-width="${path.w}"></path>`).join('');
        return POSITIONS.map((position) => `
            <svg class="${className}" width="56" height="56" viewBox="0 0 56 56"
                 fill="none" aria-hidden="true" focusable="false" style="${position}">${drawn}</svg>`).join('');
    }

    const Corners = { SETS, SKIN, forSkin, html };

    root.BB = root.BB || {};
    root.BB.Corners = Corners;
    if (typeof module !== 'undefined' && module.exports) module.exports = Corners;
})(typeof globalThis !== 'undefined' ? globalThis : this);
