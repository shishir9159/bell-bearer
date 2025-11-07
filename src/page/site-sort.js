/**
 * Dragging the site cards into your own order.
 *
 * The whole card is the handle — there is no grip icon to find. A press
 * that moves less than a few pixels is still a click and opens the site; one
 * that moves further lifts the card off the grid, and the lifted card stays
 * with the pointer until it is let go, wherever the pointer wanders.
 *
 * Slots are hit-tested against each card's layout box (offsetLeft/Top), so
 * the copy under the pointer never gets in the way of finding them.
 */
(function (root) {
    'use strict';

    /** Movement under this is a click, not a drag. */
    const DRAG_PX = 6;
    /** The ids of `grid`'s cards, in the order they stand. */
    const idsOf = (grid, selector) => Array.from(grid.querySelectorAll(selector), (card) => card.dataset.site);

    /**
     * Make `grid`'s cards draggable. `onOrder(ids)` is told the new order
     * once a drag lands somewhere different from where it began. Returns a
     * function that takes it all off again.
     */
    function attach(grid, { selector = '.site-card', onOrder = () => {} } = {}) {
        let press = null;
        let drag = null;

        const cards = () => Array.from(grid.querySelectorAll(selector));

        // ------------------------------------------------------- pressing

        function onDown(event) {
            if (event.button !== 0 || drag) return;
            const card = event.target.closest(selector);
            if (!card || !grid.contains(card)) return;
            press = { card, x: event.clientX, y: event.clientY, id: event.pointerId };
            window.addEventListener('pointermove', onMove, true);
            window.addEventListener('pointerup', onUp, true);
            window.addEventListener('pointercancel', onCancel, true);
        }

        function onMove(event) {
            if (press && !drag) {
                if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_PX) return;
                lift(press, event);
            }
            if (!drag) return;
            event.preventDefault();
            drag.px = event.clientX;
            drag.py = event.clientY;
            // The slot is found on the move itself, not only on the next
            // frame: a frame comes only when something repaints.
            seek();
        }

        function onUp() {
            if (drag) land(false);
            release();
        }

        function onCancel() {
            if (drag) land(true);
            release();
        }

        function release() {
            press = null;
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
            window.removeEventListener('pointercancel', onCancel, true);
        }

        // ------------------------------------------------------- lifting

        /**
         * Pick the card up. The card itself stays in the grid as the slot it
         * will land in; what follows the pointer is a copy of it, so the
         * grid's own layout — and the hit-testing done against it — is never
         * disturbed by the thing being dragged.
         */
        function lift({ card, x, y }, event) {
            const box = card.getBoundingClientRect();
            const ghost = document.createElement('div');
            ghost.className = 'site-card-ghost';
            ghost.style.width = `${box.width}px`;
            ghost.style.height = `${box.height}px`;
            const body = card.cloneNode(true);
            body.removeAttribute('id');
            body.classList.add('site-card-lifted');
            body.setAttribute('aria-hidden', 'true');
            body.tabIndex = -1;
            ghost.appendChild(body);
            document.body.appendChild(ghost);

            card.classList.add('is-drag-origin');
            document.documentElement.classList.add('is-dragging-site');

            drag = {
                card, ghost, body,
                // Where on the card it was grabbed, so it hangs from that point.
                grabX: x - box.left,
                grabY: y - box.top,
                gx: box.left, gy: box.top,
                px: event.clientX, py: event.clientY,
                start: idsOf(grid, selector),
                frame: 0,
            };
            place();
            drag.frame = requestAnimationFrame(tick);
        }

        /** One frame: follow the pointer, and find the slot under it. */
        function tick() {
            if (!drag) return;
            drag.gx = drag.px - drag.grabX;
            drag.gy = drag.py - drag.grabY;
            place();
            seek();
            drag.frame = requestAnimationFrame(tick);
        }

        function place() {
            drag.ghost.style.transform = `translate3d(${drag.gx}px, ${drag.gy}px, 0)`;
        }

        // ------------------------------------------------ finding the slot

        /**
         * The card whose layout box holds the pointer, if it is not the one
         * being dragged. The gaps between cards hold nothing, which is what
         * keeps two neighbours from trading places over and over while the
         * pointer rests on the line between them.
         */
        function seek() {
            // The grid is the cards' offset parent (dashboard.css positions
            // it for exactly this), so their offsets are measured from it.
            const origin = grid.getBoundingClientRect();
            const x = drag.px - origin.left - grid.clientLeft;
            const y = drag.py - origin.top - grid.clientTop;
            const all = cards();
            const over = all.find((card) => x >= card.offsetLeft && x < card.offsetLeft + card.offsetWidth &&
                y >= card.offsetTop && y < card.offsetTop + card.offsetHeight);
            if (!over || over === drag.card) return;
            const from = all.indexOf(drag.card);
            const to = all.indexOf(over);
            grid.insertBefore(drag.card, to > from ? over.nextSibling : over);
        }

        // -------------------------------------------------------- landing

        /**
         * Let go: the copy gives way to the card in its slot. Cancelled — the
         * pointer lost to the browser — the cards go back where they started.
         */
        function land(cancelled) {
            const done = drag;
            drag = null;
            cancelAnimationFrame(done.frame);

            if (cancelled) {
                done.start.forEach((id) => {
                    const card = grid.querySelector(`${selector}[data-site="${CSS.escape(id)}"]`);
                    if (card) grid.appendChild(card);
                });
            }

            done.ghost.remove();
            done.card.classList.remove('is-drag-origin');
            document.documentElement.classList.remove('is-dragging-site');

            // The click that ends a drag is not a click on the card.
            const swallow = (event) => { event.stopPropagation(); event.preventDefault(); };
            window.addEventListener('click', swallow, true);
            setTimeout(() => window.removeEventListener('click', swallow, true), 0);

            const order = idsOf(grid, selector);
            if (!cancelled && order.join() !== done.start.join()) onOrder(order);
        }

        // A native drag of the card's <svg> would fight ours.
        const noNativeDrag = (event) => { if (event.target.closest(selector)) event.preventDefault(); };

        grid.addEventListener('pointerdown', onDown);
        grid.addEventListener('dragstart', noNativeDrag);

        return function detach() {
            if (drag) land(true);
            release();
            grid.removeEventListener('pointerdown', onDown);
            grid.removeEventListener('dragstart', noNativeDrag);
        };
    }

    /** Whether a drag is under way anywhere on this page. */
    const dragging = () => document.documentElement.classList.contains('is-dragging-site');

    const SiteSort = { attach, dragging, DRAG_PX };

    root.BB = root.BB || {};
    root.BB.SiteSort = SiteSort;
    if (typeof module !== 'undefined' && module.exports) module.exports = SiteSort;
})(typeof globalThis !== 'undefined' ? globalThis : this);
