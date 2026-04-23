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

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const Icons = (root.BB && root.BB.Icons) || req('../shared/icons.js');

    const LAYOUTS = Object.freeze([
        Object.freeze({
            id: 'dock', title: 'Dock: video beside the transcript',
            icon: Icons.svg('square-split-horizontal', { size: 18 }),
        }),
        Object.freeze({
            id: 'float', title: 'Float: a transcript card over the video',
            icon: Icons.svg('picture-in-picture', { size: 18 }),
        }),
        Object.freeze({
            id: 'glass', title: 'Glass: fullscreen video, slim transcript',
            icon: Icons.svg('frame-corners', { size: 18 }),
        }),
        Object.freeze({
            id: 'band', title: 'Band: three sentences under the video',
            icon: Icons.svg('subtitles', { size: 18 }),
        }),
        Object.freeze({
            id: 'focus', title: 'Focus: transcript first, player pinned',
            icon: Icons.svg('article', { size: 18 }),
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
     * Narrower than this, a layout that sets two things side by side stacks
     * them. Side by side, dock's column alone wanted 330 pixels and the video
     * was given what was left — at 344 wide, nothing: a 0 by 0 player.
     */
    const NARROW = 720;
    /** Shorter than this, the docked video's title and chapters give their room to the video. */
    const SHORT = 480;

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

        const narrow = W < NARROW;
        if (L === 'float') {
            const v = fit(W, H - BAR);
            const m = narrow ? 12 : 22;
            const cw = Math.round(Math.min(clamp(W * 0.29, 320, 392), W - m * 2));
            const ch = Math.max(Math.min(160, H - BAR - m * 2), H - BAR - m - 92);
            g.stage = rect(0, BAR, W, H - BAR);
            g.video = rect((W - v.vw) / 2, BAR + (H - BAR - v.vh) / 2, v.vw, v.vh);
            g.panel = rect(clamp(W - cw - m + card.dx, 0, W - cw), clamp(BAR + m + card.dy, BAR, H - ch), cw, ch);
            Object.assign(g, { tabs: true, grip: true, corner: true });
        } else if (L === 'glass' && narrow) {
            // The video across the top, and the slim column under it with its tools.
            const v = fit(W, Math.round(H * 0.45));
            g.stage = rect(0, 0, W, v.vh);
            g.video = rect((W - v.vw) / 2, 0, v.vw, v.vh);
            g.bar = rect(0, v.vh, W, GLASS_BAR);
            g.panel = rect(0, v.vh + GLASS_BAR, W, Math.max(0, H - v.vh - GLASS_BAR));
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
        } else if (L === 'focus' && narrow) {
            // The transcript across the page, and the player pinned under it;
            // the highlights list has no room of its own.
            const v = fit(W - 24, Math.round((H - BAR) * 0.4));
            g.panel = rect(0, BAR, W, Math.max(0, H - BAR - v.vh - 24));
            g.video = rect(clamp((W - v.vw) / 2 + vcard.dx, 0, W - v.vw), clamp(H - v.vh - 12 + vcard.dy, BAR, H - v.vh), v.vw, v.vh);
            g.vgrip = true;
            g.type.gutter = TYPE.dock.gutter;
        } else if (L === 'focus') {
            // The pinned player is as wide as what the transcript's side
            // leaves: at 62% for the transcript it was too small to follow.
            const leftW = Math.round(W * 0.58);
            const size = g.type.size * (state.scale || 1);
            const colW = Math.max(240, Math.min(660, leftW - 120, state.measure ? state.measure * size : Infinity));
            const sw = W - leftW - 28;
            const sh = Math.round(sw * 9 / 16);
            g.panel = rect((leftW - colW) / 2 - 40, BAR, colW + 70, H - BAR);
            g.video = rect(clamp(leftW + 6 + vcard.dx, 0, W - sw), clamp(H - sh - 22 + vcard.dy, BAR, H - sh), sw, sh);
            g.side = rect(leftW + 6, BAR + 14, sw, Math.max(0, H - BAR - 14 - sh - 40));
            g.vgrip = true;
        } else if (narrow) {
            // Dock, stacked: the video over the column, its title and chapters left out.
            const pad = 12;
            const top = BAR + BAR_GAP;
            const v = fit(W - pad * 2, Math.round((H - top - pad) * 0.45));
            g.video = rect((W - v.vw) / 2, top, v.vw, v.vh);
            g.panel = rect(pad, top + v.vh + 12, W - pad * 2, Math.max(0, H - top - v.vh - 12 - pad));
            Object.assign(g, { tabs: true, corner: true });
        } else {
            const pad = 16;
            const pw = Math.round(clamp(W * 0.34, 330, 440));
            const top = BAR + BAR_GAP;
            const under = H < SHORT ? 0 : 150;
            const v = fit(W - pw - pad * 3, H - top - pad - under);
            g.video = rect(pad, top, v.vw, v.vh);
            g.under = under ? rect(pad, top + v.vh + 16, v.vw, Math.max(0, H - top - v.vh - 16 - pad)) : null;
            g.panel = rect(W - pw - pad, top, pw, H - top - pad);
            Object.assign(g, { tabs: true, corner: true });
        }

        g.type.size = Math.round(g.type.size * (state.scale || 1) * 10) / 10;
        g.type.lead = Math.round(g.type.lead * (state.leadScale || 1) * 100) / 100;
        return g;
    }

    const ReaderLayout = { LAYOUTS, LAYOUT_IDS, LEGACY, BAR, BAR_GAP, GLASS_BAR, BAND, NARROW, SHORT, TYPE, layoutOf, fit, geometry };

    root.BB = root.BB || {};
    root.BB.ReaderLayout = ReaderLayout;
    if (typeof module !== 'undefined' && module.exports) module.exports = ReaderLayout;
})(typeof globalThis !== 'undefined' ? globalThis : this);
