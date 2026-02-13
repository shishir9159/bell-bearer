/**
 * Where everything in the reader goes, in each of its five layouts.
 *
 * Worked out here, from the reader's own width and height, rather than left
 * to five CSS grids. The layouts are not one grid rearranged: the video is
 * fitted at 16:9 into whatever room a layout leaves it, the transcript is a
 * docked column in one, a card floating over the video in another and a
 * three-sentence band in a third, and the move from one to the next is
 * animated. Each piece is absolutely placed from the numbers below, so a
 * change of layout is a change of four numbers per piece and the browser
 * animates it; reader.js only writes them out.
 *
 * Nothing here touches the page, so every layout can be checked in node.
 */
(function (root) {
    'use strict';

    const icon = (body) => `<svg width="22" height="16" viewBox="0 0 22 16" fill="none" stroke="currentColor"
        stroke-width="1.3" aria-hidden="true"><rect x="1" y="1.5" width="20" height="13" rx="2"></rect>${body}</svg>`;

    const LAYOUTS = Object.freeze([
        Object.freeze({
            id: 'dock', title: 'Dock: video beside the transcript',
            icon: icon('<rect x="3.5" y="4" width="9" height="6" rx="0.8" fill="currentColor" stroke="none"></rect><path d="M15 5h3.5M15 8h3.5M15 11h3.5"></path>'),
        }),
        Object.freeze({
            id: 'float', title: 'Float: a transcript card over the video',
            icon: icon('<rect x="3.5" y="4" width="15" height="8" rx="0.8" fill="currentColor" fill-opacity="0.28" stroke="none"></rect><rect x="12.5" y="5" width="5" height="6.5" rx="0.8" fill="currentColor" stroke="none"></rect>'),
        }),
        Object.freeze({
            id: 'glass', title: 'Glass: fullscreen video, slim transcript',
            icon: icon('<rect x="3.5" y="4" width="15" height="8" rx="0.8" fill="currentColor" fill-opacity="0.28" stroke="none"></rect><path d="M13 6h4.5M13 8.5h4.5M13 11h3"></path>'),
        }),
        Object.freeze({
            id: 'band', title: 'Band: three sentences under the video',
            icon: icon('<rect x="5" y="3.6" width="12" height="5.6" rx="0.8" fill="currentColor" stroke="none"></rect><path d="M5.5 11.6h11"></path>'),
        }),
        Object.freeze({
            id: 'focus', title: 'Focus: transcript first, player pinned',
            icon: icon('<path d="M4 5h8M4 7.7h8M4 10.4h6"></path><rect x="13.5" y="8.6" width="5" height="3.6" rx="0.6" fill="currentColor" stroke="none"></rect>'),
        }),
    ]);
    const LAYOUT_IDS = Object.freeze(LAYOUTS.map((layout) => layout.id));

    /**
     * The reader had four layouts before these five, and the setting may
     * still hold one of them. Each opens in the one nearest it rather than
     * in the default: split was the docked column, stacked put the column
     * under the video, and theatre gave the video the screen.
     */
    const LEGACY = Object.freeze({ split: 'dock', stacked: 'band', theatre: 'glass' });

    const layoutOf = (id) => (LAYOUT_IDS.includes(id) ? id : LEGACY[id] || 'dock');

    /** The bar along the top, in every layout but glass. */
    const BAR = 48;
    /**
     * What stands under the bar stands this far clear of it. The docked
     * video and its column started on the bar's last pixel, which is where
     * a skin rules the bar off: the column's frame ran into that rule.
     */
    const BAR_GAP = 6;
    /** Glass has no bar across the video: its tools sit over the slim column. */
    const GLASS_BAR = 52;
    /** The band's closed height: three sentences, the middle one large. */
    const BAND = 144;

    /**
     * The transcript's type in each layout: size in px, leading, the gutter
     * the times hang in, and the column's padding. Focus is set for reading
     * — the transcript is the page there — and the float card is the
     * smallest, because it sits over the picture. The float card and the
     * glass column have no gutter: their times sit between the paragraphs.
     */
    const TYPE = Object.freeze({
        dock: Object.freeze({ size: 16, lead: 1.62, gutter: 48, pad: '6px 22px 80px 8px' }),
        float: Object.freeze({ size: 15, lead: 1.6, gutter: 0, pad: '8px 18px 72px 18px' }),
        glass: Object.freeze({ size: 16, lead: 1.6, gutter: 0, pad: '20px 18px 64px 18px' }),
        band: Object.freeze({ size: 16, lead: 1.6, gutter: 58, pad: '18px 150px 72px 10px' }),
        focus: Object.freeze({ size: 19, lead: 1.72, gutter: 64, pad: '26px 24px 140px 0' }),
    });

    /** The largest 16:9 box in `w` by `h`. */
    function fit(w, h) {
        let vw = Math.max(0, w);
        let vh = vw * 9 / 16;
        if (vh > h) {
            vh = Math.max(0, h);
            vw = vh * 16 / 9;
        }
        return { vw: Math.round(vw), vh: Math.round(vh) };
    }

    const rect = (left, top, width, height) => ({
        left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height),
    });

    const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

    /**
     * Every piece's box in a `W` by `H` reader, for `layout`:
     *
     *   bar, video, under (the title and chapters under a docked video),
     *   panel (the transcript), side (focus's highlights list), stage (the
     *   dark ground behind a video that does not fill its room)
     *
     * — any of them null where the layout has none — plus what the layout
     * shows: `tabs` (Transcript and Highlights), `grip` (the float card's
     * handle), `vgrip` (the pinned player's), `band`, `corner` (deco's
     * ornament) and `barTitle`, and the transcript's `type`.
     *
     * `state` carries what the user has moved: `card` and `vcard`, the float
     * card's and the pinned player's offsets from where they start, kept on
     * the screen whatever they hold; `bandOpen`; and `scale`, `leadScale`
     * and `measure` from the typography settings.
     */
    function geometry(layout, W, H, state = {}) {
        const L = layoutOf(layout);
        const { card = { dx: 0, dy: 0 }, vcard = { dx: 0, dy: 0 }, bandOpen = false } = state;
        const g = {
            layout: L, bar: rect(0, 0, W, BAR), video: null, under: null, panel: null, side: null, stage: null,
            tabs: false, grip: false, vgrip: false, band: false, corner: false, barTitle: L !== 'glass',
            type: Object.assign({}, TYPE[L]),
        };

        if (L === 'float') {
            const v = fit(W, H - BAR);
            const cw = Math.round(clamp(W * 0.29, 320, 392));
            const ch = Math.max(160, H - BAR - 22 - 92);
            g.stage = rect(0, BAR, W, H - BAR);
            g.video = rect((W - v.vw) / 2, BAR + (H - BAR - v.vh) / 2, v.vw, v.vh);
            g.panel = rect(clamp(W - cw - 22 + card.dx, 0, W - cw), clamp(BAR + 22 + card.dy, BAR, H - ch), cw, ch);
            Object.assign(g, { tabs: true, grip: true, corner: true });
        } else if (L === 'glass') {
            const pw = Math.round(clamp(W * 0.24, 280, 340));
            const v = fit(W - pw, H);
            g.stage = rect(0, 0, W - pw, H);
            g.video = rect((W - pw - v.vw) / 2, (H - v.vh) / 2, v.vw, v.vh);
            g.panel = rect(W - pw, GLASS_BAR, pw, H - GLASS_BAR);
            g.bar = rect(W - pw, 0, pw, GLASS_BAR);
        } else if (L === 'band') {
            const v = fit(W * 0.84, H - BAR - BAR_GAP - 12 - BAND - 16);
            const vx = (W - v.vw) / 2;
            const vy = BAR + BAR_GAP;
            const open = Math.round((H - BAR) * 0.64);
            g.video = rect(vx, vy, v.vw, v.vh);
            g.panel = bandOpen ? rect(vx, H - 16 - open, v.vw, open) : rect(vx, vy + v.vh + 12, v.vw, BAND);
            Object.assign(g, { band: true, corner: true });
            if (!bandOpen) g.type.pad = '0 170px 0 10px';
        } else if (L === 'focus') {
            const leftW = Math.round(W * 0.62);
            const size = g.type.size * (state.scale || 1);
            const colW = Math.max(240, Math.min(660, leftW - 120, state.measure ? state.measure * size : Infinity));
            const sw = W - leftW - 28;
            const sh = Math.round(sw * 9 / 16);
            g.panel = rect((leftW - colW) / 2 - 40, BAR, colW + 70, H - BAR);
            g.video = rect(clamp(leftW + 6 + vcard.dx, 0, W - sw), clamp(H - sh - 22 + vcard.dy, BAR, H - sh), sw, sh);
            g.side = rect(leftW + 6, BAR + 14, sw, Math.max(0, H - BAR - 14 - sh - 40));
            g.vgrip = true;
        } else {
            const pad = 16;
            const pw = Math.round(clamp(W * 0.34, 330, 440));
            const top = BAR + BAR_GAP;
            const v = fit(W - pw - pad * 3, H - top - pad - 150);
            g.video = rect(pad, top, v.vw, v.vh);
            g.under = rect(pad, top + v.vh + 16, v.vw, Math.max(0, H - top - v.vh - 16 - pad));
            g.panel = rect(W - pw - pad, top, pw, H - top - pad);
            Object.assign(g, { tabs: true, corner: true });
        }

        g.type.size = Math.round(g.type.size * (state.scale || 1) * 10) / 10;
        g.type.lead = Math.round(g.type.lead * (state.leadScale || 1) * 100) / 100;
        return g;
    }

    const ReaderLayout = { LAYOUTS, LAYOUT_IDS, LEGACY, BAR, BAR_GAP, GLASS_BAR, BAND, TYPE, layoutOf, fit, geometry };

    root.BB = root.BB || {};
    root.BB.ReaderLayout = ReaderLayout;
    if (typeof module !== 'undefined' && module.exports) module.exports = ReaderLayout;
})(typeof globalThis !== 'undefined' ? globalThis : this);
