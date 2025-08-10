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
 */
(function (root) {
    'use strict';

    /** The launcher's margin from a viewport edge when it is pushed to one. */
    const EDGE = 16;
    /** How far below the launcher the match lands: close, but not touching. */
    const GAP = 40;
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
     * Where to scroll to, and where the launcher should be while it happens.
     *
     * @param {object} at
     * @param {number} at.viewport    height of the scrolling viewport
     * @param {number} at.scrollTop   where it is scrolled now
     * @param {number} at.scrollMax   its largest scrollTop
     * @param {number} at.target      the match's top, in document coordinates
     * @param {number} at.height      the launcher's own height
     * @param {boolean} [at.pinned]   the match is inside a sticky/fixed panel
     * @returns {{pos: string, scrollTop: number, moved: boolean, note: string}}
     */
    function plan({ viewport, scrollTop, scrollMax, target, height, pinned = false }) {
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

        const max = Math.max(0, scrollMax);
        let pos = 'center';
        let note = '';
        let wanted = target - landing('center', viewport, height);

        if (wanted > max - 1) {
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
        EDGE, GAP, MIN_QUERY, MAX_HITS, MAX_PAGE_ROWS, VISIBLE_ROWS, HINT_CHARS,
        SOURCES, SOURCE_LABELS, ACTIONS,
        overlayTop, landing, plan, hintLabels, filterRows, snippet, nextSource, orderGroups,
    };

    root.BB = root.BB || {};
    root.BB.Skim = Skim;
    if (typeof module !== 'undefined' && module.exports) module.exports = Skim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
