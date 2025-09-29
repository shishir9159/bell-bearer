/**
 * The framed plate a settings section sits in: two inner rules, a corner motif
 * in each corner, and a title notched into the top rule.
 *
 * Taken from the standalone design export, which is the live version of it —
 * CORNERS and the skin mapping below are that file's own, not one of the
 * earlier frame studies. There are four sets and one of them is empty:
 *
 *   default   plain     nothing at all. No corners, no inner rules — the
 *                       section is a plain card and its title a plain heading.
 *   riso      blocks    three flat squares, the spot inks stacked in a corner.
 *   medieval  bracket   a square bracket, a hairline inside it, and a lozenge
 *                       where the two meet — a ruled page, not a flourish.
 *   deco      fan       the quarter-round fan and its stepped returns.
 *
 * That `plain` is empty is the whole shape of the thing: the frame is each
 * skin's own idiom, and the default skin's idiom is to have none. So the plain
 * skin must come out looking exactly like an undecorated section.
 *
 * One corner is drawn and the other three are that same set flipped, so a
 * motif is one path list rather than four. Everything is inline SVG because a
 * data: URI cannot read a CSS variable, and the colours have to come from the
 * skin.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Dom, Settings, Skin } = BB;

    /** The tone names the design's paths ask for, as this stylesheet's vars. */
    const INK = {
        accent: 'var(--accent)',
        gold: 'var(--gold)',
        borderStrong: 'var(--border-strong)',
        surface: 'var(--surface)',
        border: 'var(--border)',
    };

    const paint_ = (name) => (name === 'none' ? 'none' : INK[name] || name);

    /** Drawn into the top-left corner of a 56×56 box. */
    const CORNERS = {
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

    const SKIN_CORNER = {
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

    function cornerForSkin(skinId) {
        return SKIN_CORNER[skinId] || SKIN_CORNER.default;
    }

    function cornersHtml(name) {
        const paths = CORNERS[name] || CORNERS.plain;
        if (!paths.length) return '';
        const drawn = paths.map((path) => `<path d="${path.d}" stroke="${paint_(path.stroke)}"`
            + ` fill="${paint_(path.fill)}" stroke-width="${path.w}"></path>`).join('');
        return POSITIONS.map((position) => `
            <svg class="bb-plate-corner" width="56" height="56" viewBox="0 0 56 56"
                 fill="none" aria-hidden="true" focusable="false" style="${position}">${drawn}</svg>`).join('');
    }

    /**
     * Frame `host` itself, keeping everything already inside it — those nodes
     * are live: the shortcut rows carry listeners from ShortcutList, so the
     * body is moved into the frame rather than re-created from its HTML.
     *
     * The frame goes on the host rather than into a wrapper inside it, so a
     * section is one card and not a card inside a card. `data-plate-proper`
     * asks for a legend the uppercasing skins leave alone — a site's own name
     * is spelled the way the site spells it.
     */
    function wrap(host, title) {
        if (!host || host.classList.contains('bb-plate')) return;

        const body = document.createElement('div');
        body.className = 'bb-plate-body';
        while (host.firstChild) body.appendChild(host.firstChild);

        const proper = host.hasAttribute('data-plate-proper') ? ' bb-proper' : '';
        host.classList.add('bb-plate');
        host.innerHTML = `
            <div class="bb-plate-rule is-second"></div>
            <div class="bb-plate-rule is-third"></div>
            <div class="bb-plate-corners"></div>
            ${title ? `<h3 class="bb-plate-legend${proper}">${Dom.escapeHtml(title)}</h3>` : ''}`;
        host.appendChild(body);
    }

    /**
     * Redraw every plate's corners for `skinId`, or for the skin now showing.
     *
     * The id is passed in when the repaint comes from a storage change: the
     * watchers run in the order they registered, and this one can run before
     * BB.Skin has had a chance to put the new skin on <body> — reading it off
     * the DOM there would draw the corners of the skin just left.
     */
    function paint(scope = document, skinId) {
        const name = cornerForSkin(skinId || document.body.dataset.skin);
        scope.querySelectorAll('.bb-plate').forEach((plate) => {
            plate.dataset.corner = name;
            plate.querySelector('.bb-plate-corners').innerHTML = cornersHtml(name);
        });
    }

    /**
     * Frame every `[data-plate]` on the page, titled by the attribute, and
     * keep the corners in step with the skin.
     */
    function mountAll(scope = document) {
        scope.querySelectorAll('[data-plate]').forEach((host) => wrap(host, host.dataset.plate));
        paint(scope);

        if (Settings && Skin) Settings.watch([Skin.KEY], (changed) => paint(scope, changed[Skin.KEY]));
    }

    const Plate = { mountAll, wrap, paint, CORNERS, SKIN_CORNER, cornerForSkin, cornersHtml };

    BB.Plate = Plate;
    if (typeof module !== 'undefined' && module.exports) module.exports = Plate;
})(typeof globalThis !== 'undefined' ? globalThis : this);
