/**
 * Skim — the arithmetic behind the in-page launcher, and the table of
 * actions it can run.
 *
 * Everything here is pure: no DOM, no chrome.*. The launcher itself is
 * src/content/skim.js, the hints are src/content/link-hints.js and the
 * browser-side half is src/background/skim.js. They share this file so the
 * placement rule and the action list exist once.
 *
 * The placement rule is the whole point of Skim, so it is worth stating.
 * Browser find drops a match wherever the scroll happens to land — often one
 * line above the fold, or under a sticky header. Skim reserves the strip the
 * launcher covers and puts the match just below it, close enough to read in
 * the same glance as the query that found it.
 *
 * The design's own prototype centred the match in the whole band left over,
 * which put it near the bottom of the window — a long way from the launcher
 * and from where the eye already was. GAP below the launcher is that fix.
 * The centre-of-the-band arithmetic is still used for the two cases where
 * the page has no scroll left to spend and the launcher itself has to move.
 *
 * A match that can already be read where it is moves nothing. Placing every
 * match exactly under the launcher meant the page lurched on each arrow
 * press, through matches that were all on screen, and the launcher hopped
 * to an edge for a match it was not even covering.
 */
(function (root) {
    'use strict';

    /** The launcher's margin from a viewport edge when it is pushed to one. */
    const EDGE = 16;
    /** How far below the launcher the match lands: close, but not touching. */
    const GAP = 40;
    /**
     * Space a match needs from the window's foot to count as read where it
     * is. The top needs only EDGE: a sticky header over it is caught by the
     * page itself (`covered`), and nothing has to be pushed down to be read.
     */
    const FOOT = 48;
    /** A match further than this many windows away is not glided to all the way. */
    const FAR = 1.25;
    /** How much of a window the glide to a far match still covers. */
    const LEAD = 0.4;
    /** Fewer characters than this and nothing is searched for. */
    const MIN_QUERY = 2;
    /** Page hits stop being collected here; a query this loose is not a search. */
    const MAX_HITS = 400;
    /** How many page hits the list offers. The rest are counted, not listed. */
    const MAX_PAGE_ROWS = 40;
    /** Rows visible in the list at once; past this it scrolls. */
    const VISIBLE_ROWS = 4;

    /** Home-row first, so one keystroke eliminates most of the board. */
    const HINT_CHARS = 'fjdkslaghwnv';

    /**
     * What a hit can be marked in, each chosen against what that match sits
     * on (hitInk). `ink` fills the match being looked at and rings it as it
     * arrives, with `text` over it; `soft` marks every other match.
     *
     * The marks used to wear the skin's own red, which vanished on a red
     * banner and turned to a dark smudge on a dark page or a code block.
     * Crimson by day and yellow by night carry most pages; cyan is for
     * yellowish darks, and the two neutrals for mid-tones none of the three
     * stands out on.
     */
    const HIT_INKS = Object.freeze([
        { ink: '#c8102e', text: '#ffffff', soft: 'rgba(200, 16, 46, .26)' },
        { ink: '#ffd60a', text: '#141414', soft: 'rgba(255, 214, 10, .42)' },
        { ink: '#00c8ff', text: '#141414', soft: 'rgba(0, 200, 255, .4)' },
        { ink: '#141414', text: '#ffffff', soft: 'rgba(20, 20, 20, .2)', neutral: true },
        { ink: '#ffffff', text: '#141414', soft: 'rgba(255, 255, 255, .34)', neutral: true },
    ]);

    /** The sources, in the order the list shows them when none is picked. */
    const SOURCES = Object.freeze(['page', 'tabs', 'history', 'actions']);

    const SOURCE_LABELS = Object.freeze({
        page: 'On this page',
        tabs: 'Tabs',
        history: 'History',
        actions: 'Actions',
    });

    /**
     * What Skim can do to the browser for you.
     *
     * Chrome has no API that enumerates its own menu commands, so this is a
     * hand-kept list of the ones worth reaching for from the keyboard. The
     * worker runs them — see src/background/skim.js, which switches on `id`,
     * and must gain a branch for anything added here.
     *
     * `needs` names the permission the branch uses, as a note for whoever
     * adds the next one; nothing reads it at runtime.
     */
    const ACTIONS = Object.freeze([
        { id: 'new-tab', title: 'New tab', sub: 'opens beside this one' },
        { id: 'duplicate-tab', title: 'Duplicate this tab', sub: 'same page, new tab' },
        { id: 'close-tab', title: 'Close this tab', sub: '' },
        { id: 'close-others', title: 'Close every other tab in this window', sub: '' },
        { id: 'reload', title: 'Reload this page', sub: '' },
        { id: 'hard-reload', title: 'Reload this page ignoring the cache', sub: '' },
        { id: 'pin-tab', title: 'Pin or unpin this tab', sub: '' },
        { id: 'mute-tab', title: 'Mute or unmute this tab', sub: '' },
        { id: 'detach-tab', title: 'Move this tab to a window of its own', sub: '' },
        { id: 'reopen-tab', title: 'Reopen the last tab I closed', sub: '', needs: 'sessions' },
        { id: 'copy-markdown', title: 'Copy this page as a Markdown link', sub: '[title](url)' },
        { id: 'open-dashboard', title: 'Open the Bell Bearer dashboard', sub: '' },
        { id: 'open-history', title: 'Open the browser history page', sub: 'chrome://history' },
        { id: 'open-downloads', title: 'Open downloads', sub: 'chrome://downloads' },
        { id: 'open-extensions', title: 'Open extensions', sub: 'chrome://extensions' },
    ]);

    /** Where the launcher's top edge sits for each of its three positions. */
    function overlayTop(pos, viewport, height) {
        if (pos === 'top') return EDGE;
        if (pos === 'bottom') return Math.max(EDGE, Math.round(viewport - height - EDGE));
        return Math.max(EDGE, Math.round((viewport - height) / 2));
    }

    /**
     * Where in the viewport the match should come to rest.
     *
     * Normally just under the launcher. In the two positions the launcher
     * only takes when the page cannot scroll any further, the match is
     * centred in the band that is left instead — there is no scrolling left
     * to place it precisely with, so the roomiest spot is the useful one.
     */
    function landing(pos, viewport, height) {
        if (pos === 'top') return Math.round((EDGE + height + viewport) / 2);
        if (pos === 'bottom') return Math.round(overlayTop('bottom', viewport, height) / 2);
        return overlayTop('center', viewport, height) + height + GAP;
    }

    const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

    /**
     * Can a match `y` from the window's top, `size` tall, be read where it
     * is — inside the window and clear of the launcher at `pos`?
     */
    function readable(pos, viewport, height, y, size = 0) {
        const top = overlayTop(pos, viewport, height);
        const clear = y + size < top - 8 || y > top + height + 8;
        return clear && y >= EDGE && y + size <= viewport - FOOT;
    }

    /**
     * Where to scroll to, and where the launcher should be while it happens.
     *
     * @param {object} at
     * @param {number} at.viewport    height of the scrolling viewport
     * @param {number} at.scrollTop   where it is scrolled now
     * @param {number} at.scrollMax   its largest scrollTop
     * @param {number} at.target      the match's top, in document coordinates
     * @param {number} at.height      the launcher's own height
     * @param {boolean} [at.pinned]   the match is inside a sticky/fixed panel
     * @param {string} [at.pos]       where the launcher is now
     * @param {number} [at.size]      the match's own height
     * @param {boolean} [at.covered]  something of the page's is drawn over it
     * @returns {{pos: string, scrollTop: number, moved: boolean, note: string}}
     */
    function plan({ viewport, scrollTop, scrollMax, target, height, pinned = false, pos: now = 'center', size = 0, covered = false }) {
        // A sticky panel does not move when the page scrolls, so the match
        // cannot be brought to the launcher. The launcher leaves instead, to
        // whichever edge the match is furthest from.
        if (pinned) {
            const where = (target - scrollTop) / Math.max(1, viewport);
            return {
                pos: where < 0.55 ? 'bottom' : 'top',
                scrollTop,
                moved: false,
                note: 'pinned panel — the window stepped aside',
            };
        }

        if (!covered && readable(now, viewport, height, target - scrollTop, size)) {
            return { pos: now, scrollTop, moved: false, note: 'already in place' };
        }

        const max = Math.max(0, scrollMax);
        let pos = 'center';
        let note = '';
        let wanted = target - landing('center', viewport, height);

        // A launcher already pushed to an edge stays there while the page
        // can still bring matches to it: hopping back to the centre for one
        // match and out again for the next is the restlessness to avoid.
        const kept = now !== 'center' ? target - landing(now, viewport, height) : NaN;
        if (kept >= 1 && kept <= max - 1) {
            pos = now;
            wanted = kept;
            note = 'placed beside the window';
        } else if (wanted > max - 1) {
            pos = 'top';
            wanted = target - landing('top', viewport, height);
            note = 'end of the page — the window moved to the top edge';
        } else if (wanted < 1) {
            pos = 'bottom';
            wanted = target - landing('bottom', viewport, height);
            note = 'top of the page — the window moved to the bottom edge';
        }

        const next = clamp(Math.round(wanted), 0, max);
        // A few pixels out is in place. Nudging the page under a reader who
        // is already looking at the right line is the most irritating thing
        // a find can do, so within the tolerance the answer is where the
        // page already is, not a rounded version of it.
        const moved = Math.abs(next - scrollTop) > 4;
        if (!note) note = moved ? 'placed under the window' : 'already in place';
        return { pos, scrollTop: moved ? next : scrollTop, moved, note };
    }

    /**
     * How the page travels from `from` to `to`: where the glide starts, and
     * how long it takes — long enough to follow, short enough not to wait on.
     *
     * A match several windows away would otherwise glide past screens of
     * text that mean nothing on the way. So the page is put most of the way
     * there at once and glides the last LEAD of a window, which is still
     * enough to see which way it went.
     */
    function glide(from, to, viewport) {
        const distance = Math.abs(to - from);
        const lead = Math.round(viewport * LEAD);
        const far = distance > viewport * FAR;
        const travel = far ? lead : distance;
        return {
            start: far ? to - Math.sign(to - from) * lead : from,
            ms: Math.round(clamp(140 + travel * 0.35, 200, 380)),
        };
    }

    // ---------------------------------------------------- the hit colours

    /**
     * A computed colour as `{ r, g, b, a }`: the rgb()/rgba() a browser
     * gives for most colours, commas or spaces, and 'transparent'. Anything
     * else — oklch(), color() — is null, for the caller to convert.
     */
    function parseColor(text) {
        const value = String(text || '').trim();
        if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
        const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(value);
        if (!m) return null;
        const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
        return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: clamp(alpha, 0, 1) };
    }

    /** `top` laid over an opaque `base`; a missing or clear top is the base. */
    function over(top, base) {
        if (!top || !(top.a > 0)) return base;
        const mix = (key) => Math.round(top[key] * top.a + base[key] * (1 - top.a));
        return { r: mix('r'), g: mix('g'), b: mix('b'), a: 1 };
    }

    const channel = (value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const hexColor = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
    };

    /** WCAG contrast between two opaque colours, 1 to 21. */
    function contrast(one, two) {
        const a = luminance(one);
        const b = luminance(two);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }

    /** Hue in degrees and saturation 0–1, for telling a red page from a grey one. */
    function hueOf({ r, g, b }) {
        const max = Math.max(r, g, b) / 255;
        const min = Math.min(r, g, b) / 255;
        const d = max - min;
        const sat = d === 0 ? 0 : d / (1 - Math.abs(max + min - 1));
        if (!d) return { hue: 0, sat };
        const [R, G, B] = [r / 255, g / 255, b / 255];
        const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
        return { hue: (h * 60 + 360) % 360, sat };
    }

    /**
     * Which of HIT_INKS stands out on `background` (opaque `{ r, g, b }`), as
     * its index. The coloured ink with the most contrast wins, discounted on
     * a page of nearly its own hue — yellow on an olive band has the numbers
     * and still reads as part of it. Short of 3:1, the least a mark needs to
     * be seen at all, the better neutral is used instead.
     */
    function hitInk(background) {
        const back = hueOf(background);
        let best = -1;
        let score = 0;
        HIT_INKS.forEach((one, i) => {
            if (one.neutral) return;
            const ink = hexColor(one.ink);
            const gap = Math.abs(hueOf(ink).hue - back.hue) % 360;
            const near = back.sat > 0.3 && Math.min(gap, 360 - gap) < 40;
            const value = contrast(ink, background) * (near ? 0.6 : 1);
            if (value > score) {
                best = i;
                score = value;
            }
        });
        if (contrast(hexColor(HIT_INKS[best].ink), background) >= 3) return best;
        const neutrals = HIT_INKS.map((one, i) => i).filter((i) => HIT_INKS[i].neutral);
        return neutrals.reduce((a, b) => (
            contrast(hexColor(HIT_INKS[b].ink), background) > contrast(hexColor(HIT_INKS[a].ink), background) ? b : a));
    }

    /**
     * One label per target. Up to the length of the alphabet they are single
     * characters; past that the first character is spread across the set, so
     * one keystroke still clears most of the board.
     */
    function hintLabels(count, chars = HINT_CHARS) {
        const set = String(chars || '').toLowerCase().replace(/[^a-z]/g, '') || HINT_CHARS;
        if (count <= set.length) return set.slice(0, Math.max(0, count)).split('');
        const out = [];
        for (let i = 0; i < count; i++) {
            out.push(set[i % set.length] + set[Math.floor(i / set.length) % set.length]);
        }
        return out;
    }

    /** Rows whose title or subtitle contains the query, in their own order. */
    function filterRows(rows, query) {
        const needle = String(query || '').trim().toLowerCase();
        if (needle.length < MIN_QUERY) return [];
        return (rows || []).filter((row) => {
            const title = String(row.title || '').toLowerCase();
            const sub = String(row.sub || '').toLowerCase();
            return title.includes(needle) || sub.includes(needle);
        });
    }

    /**
     * The line a page hit shows: what runs up to the match, the match, and
     * what follows. Whitespace is flattened — a match inside a wrapped
     * paragraph would otherwise bring the paragraph's line breaks with it.
     */
    function snippet(text, at, length, span = 46) {
        const full = String(text || '');
        const start = Math.max(0, at - span);
        const end = Math.min(full.length, at + length + span);
        const tidy = (part) => part.replace(/\s+/g, ' ');
        return {
            pre: (start > 0 ? '…' : '') + tidy(full.slice(start, at)),
            mid: full.slice(at, at + length),
            post: tidy(full.slice(at + length, end)) + (end < full.length ? '…' : ''),
        };
    }

    /** The source after `source`, for the key that cycles them. */
    function nextSource(source) {
        const at = SOURCES.indexOf(source);
        return SOURCES[(at + 1) % SOURCES.length];
    }

    /**
     * The groups, with the chosen source first. Every source is still listed:
     * a query typed to find a tab often turns out to be on the page, and
     * having to reopen the launcher to see that is the thing to avoid.
     */
    function orderGroups(groups, source) {
        const first = groups.filter((group) => group.source === source);
        const rest = groups.filter((group) => group.source !== source);
        return [...first, ...rest];
    }

    const Skim = {
        EDGE, GAP, FOOT, FAR, LEAD, MIN_QUERY, MAX_HITS, MAX_PAGE_ROWS, VISIBLE_ROWS, HINT_CHARS,
        SOURCES, SOURCE_LABELS, ACTIONS, HIT_INKS,
        overlayTop, landing, readable, plan, glide, parseColor, over, contrast, hitInk,
        hintLabels, filterRows, snippet, nextSource, orderGroups,
    };

    root.BB = root.BB || {};
    root.BB.Skim = Skim;
    if (typeof module !== 'undefined' && module.exports) module.exports = Skim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
