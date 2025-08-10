/**
 * Take X's promoted posts and its own Premium upsells out of the timeline.
 *
 * Two different things, hidden for one reason: neither is something anybody
 * followed. A promoted post is a paid placement from an advertiser; an upsell
 * is X selling you X. They are found differently, though, which is why there
 * are two passes below rather than one selector list.
 *
 * Promoted posts are found structurally, not by their label. X wraps a paid
 * placement in `[data-testid="placementTracking"]` — its own hook for the
 * impression ping — so the test is "is this post inside one of those", which
 * needs no word list and works in every language X ships. Reading the DOM for
 * the string "Promoted" would need eleven translations and would also catch a
 * post about promotion.
 *
 * Nothing is removed from the page. Every hidden thing keeps its box in the
 * DOM with `display: none` on it, because X's timeline is virtualised — it
 * measures its own rows and recycles them as you scroll, and a node deleted
 * out from under that bookkeeping makes the scroll position jump. Hiding
 * leaves X's model of the page intact and costs one class.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const TwitterPage = ns.TwitterPage || req('./twitter-page.js');

    /** The class content.css hides. One class for both kinds. */
    const HIDDEN = 'bb-x-ad-hidden';

    /**
     * The cell a timeline entry sits in. Hiding the <article> itself leaves
     * X's own padding and separator behind as a stripe of empty page, so the
     * whole cell goes.
     */
    const CELL = '[data-testid="cellInnerDiv"]';

    function createTwitterAds({ watcher, isEnabled }) {
        /**
         * Hide what is on screen now. Never reports itself done: posts arrive
         * for as long as the timeline is scrolled.
         *
         * The `:not` guards are what keep this cheap — each pass looks only at
         * what it has not already dealt with, so a still timeline costs two
         * empty querySelectorAll calls per frame.
         */
        function sweep() {
            if (!isEnabled()) return false;
            hidePromoted();
            hideUpsells();
            return false;
        }

        function hidePromoted() {
            for (const selector of TwitterPage.SELECTORS.promoted) {
                for (const placement of document.querySelectorAll(`${selector}:not([data-bb-ad])`)) {
                    placement.setAttribute('data-bb-ad', '1');
                    (placement.closest(CELL) || placement).classList.add(HIDDEN);
                }
            }
        }

        function hideUpsells() {
            for (const selector of TwitterPage.SELECTORS.upsell) {
                for (const upsell of document.querySelectorAll(`${selector}:not([data-bb-ad])`)) {
                    upsell.setAttribute('data-bb-ad', '1');
                    // An upsell in the timeline sits in a cell like a post; one
                    // in the right-hand column is a top-level <aside> with no
                    // cell around it, and closest() answering null is the
                    // difference between the two.
                    (upsell.closest(CELL) || upsell).classList.add(HIDDEN);
                }
            }
        }

        /**
         * Put everything back. Turning the setting off has to undo the hiding
         * on the page that is already open — the alternative is telling
         * someone to reload before they can see whether the switch did
         * anything.
         */
        function restore() {
            document.querySelectorAll(`.${HIDDEN}`).forEach((el) => el.classList.remove(HIDDEN));
            document.querySelectorAll('[data-bb-ad]').forEach((el) => el.removeAttribute('data-bb-ad'));
        }

        function install() {
            if (isEnabled()) watcher.add('x-ads', sweep);
        }

        /** The setting changed, or X navigated. */
        function sync() {
            if (isEnabled()) {
                if (!watcher.has('x-ads')) watcher.add('x-ads', sweep);
                sweep();
            } else {
                watcher.remove('x-ads');
                restore();
            }
        }

        return { install, sync, sweep, restore, HIDDEN };
    }

    const TwitterAds = { createTwitterAds, HIDDEN, CELL };

    root.BB = root.BB || {};
    root.BB.TwitterAds = TwitterAds;
    if (typeof module !== 'undefined' && module.exports) module.exports = TwitterAds;
})(typeof globalThis !== 'undefined' ? globalThis : this);
