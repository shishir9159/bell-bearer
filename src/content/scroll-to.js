/**
 * Landing on something in a page whose scroll is not the window's.
 *
 * Skim solved this first — a match inside a docs site's sidebar, a comment
 * inside a panel that scrolls on its own — and these were private to it. The
 * chat outline needs exactly the same thing, because ChatGPT's thread and
 * Claude's both scroll inside a container of their own and the window does
 * not move at all. So they live here, unchanged in behaviour, and Skim calls
 * them from here.
 */
(function (root) {
    'use strict';

    /** How long the arrival marker follows a smooth scroll before giving up. */
    const PULSE_MS = 900;

    /** The closest ancestor that scrolls on its own, or null. */
    function innerScroller(element) {
        for (let node = element; node && node !== document.body; node = node.parentElement) {
            const style = getComputedStyle(node);
            const scrolls = /(auto|scroll|overlay)/.test(style.overflowY);
            if (scrolls && node.scrollHeight > node.clientHeight + 4) return node;
        }
        return null;
    }

    /** Is the element inside something the page keeps still while it scrolls? */
    function isPinned(element) {
        for (let node = element; node && node !== document.body; node = node.parentElement) {
            const position = getComputedStyle(node).position;
            if (position === 'sticky' || position === 'fixed') return true;
        }
        return false;
    }

    /**
     * A collapsed section has no height to aim at, so it is opened before
     * anything is measured — and left open afterwards.
     */
    function openDetails(element) {
        for (let node = element; node; node = node.parentElement) {
            if (node.tagName === 'DETAILS' && !node.open) node.open = true;
        }
    }

    /**
     * Scroll `scroller` so that `rect` — a viewport rectangle inside it — sits
     * `at` from the top of the scroller's own box: 'center', or a number of
     * pixels, which is what a thread with a header over its top edge wants.
     */
    function bring(scroller, rect, at = 'center', behavior = 'smooth') {
        const box = scroller.getBoundingClientRect();
        const offset = at === 'center' ? scroller.clientHeight / 2 : Number(at) || 0;
        scroller.scrollTo({ top: scroller.scrollTop + (rect.top - box.top) - offset, behavior });
    }

    /** Scroll state kept per marker element, so two markers never share a timer. */
    const following = new WeakMap();

    /**
     * A box drawn over the target for a moment. The highlight (or the target
     * itself) says where it is; this says that it just arrived, which is what
     * the eye needs after the page has moved under it.
     *
     * It follows the scroll: the page is still gliding when this is drawn, so
     * a box placed once would be left behind. `rectOf` is asked again on every
     * scroll event for that reason.
     */
    function markArrival(pulse, rectOf, ms = PULSE_MS) {
        if (!pulse) return;
        const previous = following.get(pulse);
        if (previous) {
            clearTimeout(previous.timer);
            window.removeEventListener('scroll', previous.draw, true);
        }

        const draw = () => {
            const rect = rectOf();
            pulse.style.left = `${Math.round(rect.left)}px`;
            pulse.style.top = `${Math.round(rect.top)}px`;
            pulse.style.width = `${Math.round(rect.width)}px`;
            pulse.style.height = `${Math.round(rect.height)}px`;
        };
        draw();
        pulse.hidden = false;
        pulse.classList.remove('is-on');
        void pulse.offsetWidth;
        pulse.classList.add('is-on');

        window.addEventListener('scroll', draw, true);
        const timer = setTimeout(() => {
            window.removeEventListener('scroll', draw, true);
            following.delete(pulse);
            pulse.hidden = true;
        }, ms);
        following.set(pulse, { timer, draw });
    }

    const ScrollTo = { PULSE_MS, innerScroller, isPinned, openDetails, bring, markArrival };

    root.BB = root.BB || {};
    root.BB.ScrollTo = ScrollTo;
    if (typeof module !== 'undefined' && module.exports) module.exports = ScrollTo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
