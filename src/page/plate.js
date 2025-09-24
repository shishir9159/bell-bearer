/**
 * The framed plate: a double rule, four corner motifs and a legend title that
 * breaks the top border. Settings uses it to set the keyboard shortcuts apart
 * from the rows of toggles around them.
 *
 * Five corner motifs were drawn, one per skin, and the mapping is SKIN_MOTIF
 * below — the whole point is that the frame is not one house style imposed on
 * four skins, but each skin's own idiom. 'full' is drawn and unassigned; put
 * it in the table to use it.
 *
 * The motifs are inline SVG rather than a background-image, because a data:
 * URI cannot read a CSS variable and the two rule colours have to come from
 * the skin. They are painted with var(--plate-ink) and var(--plate-gilt),
 * which default to the skin's own border and accent.
 *
 * One corner is drawn and the other three are the same path flipped, so a
 * motif is one path set, not four.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Dom, Settings, Skin } = BB;

    const ink = 'stroke:var(--plate-ink)';
    const gilt = 'stroke:var(--plate-gilt)';

    /** `size` is the viewBox square; `paths` are drawn into the top-left corner. */
    const MOTIFS = {
        stepped: {
            size: 46,
            paths: `<path d="M0 46V18h10V10h8V0h28" style="${ink}"></path>
                    <path d="M5 46V23h10v-8h8V5h23" style="${gilt}"></path>`,
        },
        fan: {
            size: 54,
            paths: `<path d="M0 40A40 40 0 0 0 40 0" style="${ink}"></path>
                    <path d="M0 31A31 31 0 0 0 31 0" style="${gilt}"></path>
                    <path d="M0 0l40 40M0 0l14 44M0 0l44 14" style="${gilt}"></path>`,
        },
        lozenge: {
            size: 30,
            paths: `<rect x="7" y="7" width="10" height="10" transform="rotate(45 12 12)"
                          style="fill:var(--plate-gilt);stroke:none"></rect>
                    <rect x="9.5" y="9.5" width="5" height="5" transform="rotate(45 12 12)"
                          style="fill:var(--surface);stroke:none"></rect>`,
        },
        full: {
            size: 62,
            paths: `<path d="M0 46A46 46 0 0 0 46 0" style="${ink}"></path>
                    <path d="M0 34A34 34 0 0 0 34 0" style="${gilt}"></path>
                    <path d="M0 0l46 46M0 0l16 50M0 0l50 16M0 0l30 54M0 0l54 30"
                          style="${gilt}" stroke-width=".7"></path>
                    <rect x="20" y="20" width="7" height="7" transform="rotate(45 23.5 23.5)"
                          style="fill:var(--plate-gilt);stroke:none"></rect>`,
        },
        medieval: {
            size: 58,
            paths: `<path d="M2 40C2 18 18 2 40 2" style="${ink}"></path>
                    <path d="M2 26c8 0 14 6 14 14" style="${gilt}"></path>
                    <path d="M26 2c0 8 6 14 14 14" style="${gilt}"></path>
                    <circle cx="9" cy="9" r="3.4" style="fill:var(--plate-gilt);stroke:none"></circle>
                    <path d="M16 40c0-13 11-24 24-24" style="${gilt}" stroke-width=".8"></path>`,
        },
    };

    const SKIN_MOTIF = {
        default: 'lozenge',
        riso: 'stepped',
        medieval: 'medieval',
        deco: 'fan',
    };

    /** Top-left, then the same path mirrored into the other three corners. */
    const CORNERS = [
        'left:-1px;top:-1px',
        'right:-1px;top:-1px;transform:scaleX(-1)',
        'left:-1px;bottom:-1px;transform:scaleY(-1)',
        'right:-1px;bottom:-1px;transform:scale(-1,-1)',
    ];

    function cornersHtml(motifName) {
        const motif = MOTIFS[motifName] || MOTIFS.lozenge;
        return CORNERS.map((position) => `
            <svg class="bb-plate-corner" width="${motif.size}" height="${motif.size}"
                 viewBox="0 0 ${motif.size} ${motif.size}" fill="none" stroke-width="1"
                 aria-hidden="true" focusable="false" style="${position}">${motif.paths}</svg>`).join('');
    }

    /** The little run of dots that closes the plate. */
    const FOOT = `
        <div class="bb-plate-foot" aria-hidden="true">
            <span class="bb-plate-hr"></span>
            <svg width="34" height="9" viewBox="0 0 34 9" style="fill:var(--plate-gilt)">
                <circle cx="17" cy="4.5" r="4"></circle>
                <circle cx="27" cy="4.5" r="2.6"></circle><circle cx="7" cy="4.5" r="2.6"></circle>
                <circle cx="33" cy="4.5" r="1.4"></circle><circle cx="1" cy="4.5" r="1.4"></circle>
            </svg>
            <span class="bb-plate-hr"></span>
        </div>`;

    function motifForSkin(skinId) {
        return SKIN_MOTIF[skinId] || SKIN_MOTIF.default;
    }

    /**
     * Frame everything already inside `host`, keeping those nodes — they are
     * live: the shortcut rows carry listeners from ShortcutList, so the body
     * is moved into the frame rather than re-created from its HTML.
     */
    function wrap(host, title) {
        if (!host || host.querySelector(':scope > .bb-plate')) return;

        const plate = document.createElement('div');
        plate.className = 'bb-plate';
        plate.innerHTML = `
            <div class="bb-plate-rule"></div>
            <div class="bb-plate-rule is-inner"></div>
            <div class="bb-plate-corners"></div>
            ${title ? `<h3 class="bb-plate-legend">${Dom.escapeHtml(title)}</h3>` : ''}
            <div class="bb-plate-body"></div>
            ${FOOT}`;

        const body = plate.querySelector('.bb-plate-body');
        while (host.firstChild) body.appendChild(host.firstChild);
        host.appendChild(plate);
    }

    /** Redraw every plate's corners for the skin now showing. */
    function paint(scope = document) {
        const motif = motifForSkin(document.body.dataset.skin);
        scope.querySelectorAll('.bb-plate').forEach((plate) => {
            plate.dataset.motif = motif;
            plate.querySelector('.bb-plate-corners').innerHTML = cornersHtml(motif);
        });
    }

    /**
     * Frame every `[data-plate]` on the page, titled by the attribute, and
     * keep the corners in step with the skin.
     */
    function mountAll(scope = document) {
        scope.querySelectorAll('[data-plate]').forEach((host) => wrap(host, host.dataset.plate));
        paint(scope);

        if (Settings && Skin) Settings.watch([Skin.KEY], () => paint(scope));
    }

    BB.Plate = { mountAll, wrap, paint, MOTIFS, SKIN_MOTIF, motifForSkin };
})(typeof globalThis !== 'undefined' ? globalThis : this);
