/**
 * Per-site branding for the dashboard's site launcher and the settings page's
 * site-specific panels: one colored glyph, a name and a one-line description
 * per site Bell Bearer knows how to work with.
 *
 * Each glyph is a single hand-picked path lifted from Simple Icons rather
 * than the whole package — there is no bundler here to tree-shake an npm
 * dependency down to the icons actually used, so the same effect is had by
 * only ever copying in the one path a site needs.
 *
 * YouTube is the only entry today. src/content/site.js already recognises
 * Netflix, Reddit and Twitter/X for the generic speed-shortcut player, so
 * those are the next natural entries here once they grow features of their
 * own beyond that.
 */
(function (root) {
    'use strict';

    const SITES = {
        youtube: {
            id: 'youtube',
            name: 'YouTube',
            description: 'Checkpoints on videos and channel subscriptions organized into topics',
            color: '#FF0000',
            viewBox: '0 0 24 24',
            path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.016 3.016 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.016 3.016 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
        },
    };

    const ORDER = ['youtube'];

    function list() {
        return ORDER.map((id) => SITES[id]);
    }

    function get(id) {
        return SITES[id] || null;
    }

    /** An inline `<svg>` for the site, its brand color baked in via `fill`. */
    function svg(id, { size = 24 } = {}) {
        const site = get(id);
        if (!site) return '';
        return `<svg viewBox="${site.viewBox}" width="${size}" height="${size}" aria-hidden="true" focusable="false"><path fill="${site.color}" d="${site.path}"/></svg>`;
    }

    const SiteIcons = { list, get, svg };

    root.BB = root.BB || {};
    root.BB.SiteIcons = SiteIcons;
    if (typeof module !== 'undefined' && module.exports) module.exports = SiteIcons;
})(typeof globalThis !== 'undefined' ? globalThis : this);
