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
            description: 'Games played, win/loss and time management by time control, time at the board',
            color: '#81B64C',
            viewBox: '0 0 24 24',
            path: 'M12 0a3.85 3.85 0 0 0-3.875 3.846A3.84 3.84 0 0 0 9.73 6.969l-2.79 1.85c0 .622.144 1.114.434 1.649H9.83c-.014.245-.014.549-.014.925 0 .025.003.048.006.071-.064 1.353-.507 3.472-3.62 5.842-.816.625-1.423 1.495-1.806 2.533a.33.33 0 0 0-.045.084 8.124 8.124 0 0 0-.39 2.516c0 .1.216 1.561 8.038 1.561s8.038-1.46 8.038-1.561c0-2.227-.824-4.048-2.24-5.133-4.034-3.08-3.586-5.74-3.644-6.838h2.458c.29-.535.434-1.027.434-1.649l-2.79-1.836a3.86 3.86 0 0 0 1.604-3.123A3.873 3.873 0 0 0 13.445.275c-.004-.002-.01.004-.015.004A3.76 3.76 0 0 0 12 0Z',
        },
        lichess: {
            id: 'lichess',
            name: 'Lichess',
            description: 'Games played, win/loss and time management by time control, time at the board',
            // Lichess's mark is black on white; currentColor keeps it legible at night.
            color: 'currentColor',
            viewBox: '0 0 24 24',
            path: 'M10.457 6.161a.237.237 0 0 0-.296.165c-.8 2.785 2.819 5.579 5.214 7.428.653.504 1.216.939 1.591 1.292 1.745 1.642 2.564 2.851 2.733 3.178a.24.24 0 0 0 .275.122c.047-.013 4.726-1.3 3.934-4.574a.257.257 0 0 0-.023-.06L18.204 3.407 18.93.295a.24.24 0 0 0-.262-.293c-1.7.201-3.115.435-4.5 1.425-4.844-.323-8.718.9-11.213 3.539C.334 7.737-.246 11.515.085 14.128c.763 5.655 5.191 8.631 9.081 9.532.993.229 1.974.34 2.923.34 3.344 0 6.297-1.381 7.946-3.85a.24.24 0 0 0-.372-.3c-3.411 3.527-9.002 4.134-13.296 1.444-4.485-2.81-6.202-8.41-3.91-12.749C4.741 4.221 8.801 2.362 13.888 3.31c.056.01.115 0 .165-.029l.335-.197c.926-.546 1.961-1.157 2.873-1.279l-.694 1.993a.243.243 0 0 0 .02.202l6.082 10.192c-.193 2.028-1.706 2.506-2.226 2.611-.287-.645-.814-1.364-2.306-2.803-.422-.407-1.21-.941-2.124-1.56-2.364-1.601-5.937-4.02-5.391-5.984a.239.239 0 0 0-.165-.295z',
        },
        twitter: {
            id: 'twitter',
            // "Twitter", not "X". The site renamed itself; nobody who uses it
            // did, and a one-letter name in a row of proper nouns reads as a
            // rendering fault rather than as a brand. The id stays `twitter`,
            // which is what detectSite has always returned.
            name: 'Twitter',
            description: 'People and posts filed into two sets of topics, and a daily time limit',
            // X's mark is black on white, so it takes the page's ink the way
            // Lichess's does rather than a brand colour that vanishes at night.
            color: 'currentColor',
            viewBox: '0 0 24 24',
            path: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
        },
        leetcode: {
            id: 'leetcode',
            name: 'LeetCode',
            description: 'Problems timed and graded, a review schedule, notes and code templates',
            color: '#FFA116',
            viewBox: '0 0 24 24',
            path: 'M13.483 0a1.374 1.374 0 0 0-.961.438L7.116 6.226l-3.854 4.126a5.266 5.266 0 0 0-1.209 2.104 5.35 5.35 0 0 0-.125.513 5.527 5.527 0 0 0 .062 2.362 5.83 5.83 0 0 0 .349 1.017 5.938 5.938 0 0 0 1.271 1.818l4.277 4.193.039.038c2.248 2.165 5.852 2.133 8.063-.074l2.396-2.392c.54-.54.54-1.414.003-1.955a1.378 1.378 0 0 0-1.951-.003l-2.396 2.392a3.021 3.021 0 0 1-4.205.038l-.02-.019-4.276-4.193c-.652-.64-.972-1.469-.948-2.263a2.68 2.68 0 0 1 .066-.523 2.545 2.545 0 0 1 .619-1.164L9.13 8.114c1.058-1.134 3.204-1.27 4.43-.278l3.501 2.831c.593.48 1.461.387 1.94-.207a1.384 1.384 0 0 0-.207-1.943l-3.5-2.831c-.8-.647-1.766-1.045-2.774-1.202l2.015-2.158A1.384 1.384 0 0 0 13.483 0zm-2.866 12.815a1.38 1.38 0 0 0-1.38 1.382 1.38 1.38 0 0 0 1.38 1.382H20.79a1.38 1.38 0 0 0 1.38-1.382 1.38 1.38 0 0 0-1.38-1.382z',
        },
        typeracer: {
            id: 'typeracer',
            name: 'TypeRacer',
            description: 'Races logged, the letter pairs you stall on, and what correcting them costs',
            // The one glyph here that is not lifted from Simple Icons, because
            // Simple Icons has no TypeRacer mark to lift. It is a keyboard,
            // drawn as one path of plain key rectangles — which is also why it
            // takes the page's ink rather than a brand colour: there is no
            // brand mark to borrow one from, and an invented colour in a row
            // of real ones reads as a mistake.
            color: 'currentColor',
            viewBox: '0 0 24 24',
            path: 'M2 4h3v3h-3zM6.25 4h3v3h-3zM10.5 4h3v3h-3zM14.75 4h3v3h-3zM19 4h3v3h-3zM4.125 8.25h3v3h-3zM8.375 8.25h3v3h-3zM12.625 8.25h3v3h-3zM16.875 8.25h3v3h-3zM2 12.5h3v3h-3zM6.25 12.5h3v3h-3zM10.5 12.5h3v3h-3zM14.75 12.5h3v3h-3zM19 12.5h3v3h-3zM6.25 16.75h11.5v3h-11.5z',
        },
        reddit: {
            id: 'reddit',
            name: 'Reddit',
            description: 'A daily time limit, and how much of today has gone to it',
            color: '#FF4500',
            viewBox: '0 0 24 24',
            path: 'M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z',
        },
    };

    const ORDER = ['youtube', 'chess', 'lichess', 'twitter', 'reddit', 'leetcode', 'typeracer'];

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
