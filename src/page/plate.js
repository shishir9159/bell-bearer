/**
 * The framed plate a settings section sits in: two inner rules, a corner motif
 * in each corner, and a title notched into the top rule.
 *
 * The corner motifs are BB.Corners' (src/shared/corners.js), which the
 * YouTube reader frames its panels with too. One set is empty — the default
 * skin's — and that is the whole shape of the thing: the frame is each skin's
 * own idiom, and the default skin's idiom is to have none. So the plain skin
 * must come out looking exactly like an undecorated section.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Dom, Settings, Skin, Corners } = BB;

    /** The tone names the design's paths ask for, as this stylesheet's vars. */
    const INK = {
        accent: 'var(--accent)',
        gold: 'var(--gold)',
        borderStrong: 'var(--border-strong)',
        surface: 'var(--surface)',
        border: 'var(--border)',
    };

    const cornerForSkin = (skinId) => Corners.forSkin(skinId);
    const cornersHtml = (name) => Corners.html(name, INK, 'bb-plate-corner');

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

    const Plate = { mountAll, wrap, paint, CORNERS: Corners.SETS, SKIN_CORNER: Corners.SKIN, cornerForSkin, cornersHtml };

    BB.Plate = Plate;
    if (typeof module !== 'undefined' && module.exports) module.exports = Plate;
})(typeof globalThis !== 'undefined' ? globalThis : this);
