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
 * The `id` is the one src/content/site.js#detectSite returns, so a card, a
 * settings panel and the popup all name a site the same way.
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
        chess: {
            id: 'chess',
            name: 'Chess.com',
            description: 'Games played, win/loss by time control and time on the clock',
            color: '#81B64C',
            viewBox: '0 0 24 24',
            path: 'M12 0a3.85 3.85 0 0 0-3.875 3.846A3.84 3.84 0 0 0 9.73 6.969l-2.79 1.85c0 .622.144 1.114.434 1.649H9.83c-.014.245-.014.549-.014.925 0 .025.003.048.006.071-.064 1.353-.507 3.472-3.62 5.842-.816.625-1.423 1.495-1.806 2.533a.33.33 0 0 0-.045.084 8.124 8.124 0 0 0-.39 2.516c0 .1.216 1.561 8.038 1.561s8.038-1.46 8.038-1.561c0-2.227-.824-4.048-2.24-5.133-4.034-3.08-3.586-5.74-3.644-6.838h2.458c.29-.535.434-1.027.434-1.649l-2.79-1.836a3.86 3.86 0 0 0 1.604-3.123A3.873 3.873 0 0 0 13.445.275c-.004-.002-.01.004-.015.004A3.76 3.76 0 0 0 12 0Z',
        },
    };

    const ORDER = ['youtube', 'chess'];

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
