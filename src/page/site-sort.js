/**
 * Dragging the site cards into your own order.
 *
 * The whole card is the handle — there is no grip icon to find. A press
 * that moves less than a few pixels is still a click and opens the site; one
 * that moves further lifts the card off the grid, and the lifted card stays
 * with the pointer until it is let go, wherever the pointer wanders.
 *
 * What makes it feel like picking something up rather than moving a box:
 *
 *   - the lifted card rides a spring toward the pointer rather than being
 *     nailed to it, so it trails a hair behind a fast flick and catches up;
 *   - it tilts with the pointer's swing and rights itself as the pointer
 *     slows, like something held at one corner;
 *   - the other cards glide out of its way (FLIP: measured before and after
 *     the move, then animated from one to the other), and a glide that is
 *     interrupted by the next move carries on from wherever it had got to,
 *     because the "before" is measured with the glide still in it;
 *   - on release it settles into its slot instead of vanishing into it.
 *
 * Slots are hit-tested against each card's *layout* box (offsetLeft/Top),
 * which a glide in progress does not move. Hit-testing the animated boxes
 * made a card swap back and forth while its neighbour was still sliding
 * past the pointer.
 *
 * Reduced motion keeps the drag and drops the flourishes: no tilt, no
 * spring, no glides.
 */
(function (root) {
    'use strict';

    /** Movement under this is a click, not a drag. */
    const DRAG_PX = 6;
    /** How far the lifted card closes on the pointer each frame. */
    const SPRING = 0.38;
    /** Degrees of tilt per pixel-per-frame of sideways swing, and the most. */
    const TILT = 0.7;
    const MAX_TILT = 9;
    const GLIDE_MS = 240;
    const SETTLE_MS = 220;
    /** Within this of the window's edge the page scrolls under the drag. */
    const EDGE_PX = 48;
    const EASE = 'cubic-bezier(.2, .8, .2, 1)';

    const still = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /**
     * The drag the page-wide class is for. A drop's settle used to take the
     * class off whatever was being dragged when it ran out, so a card picked
     * up again inside those few hundred milliseconds lost it mid-drag.
     */
    let owner = null;

    /** The ids of `grid`'s cards, in the order they stand. */
    const idsOf = (grid, selector) => Array.from(grid.querySelectorAll(selector), (card) => card.dataset.site);

    /**
     * Where a card should move to, as an index into `ids`, for a keyboard
     * move of `step` from `from`. Pure, and clamped at both ends.
     */
    function moved(ids, from, step) {
        const next = ids.slice();
        const to = Math.max(0, Math.min(next.length - 1, from + step));
        next.splice(to, 0, next.splice(from, 1)[0]);
        return next;
    }

    /**
     * Make `grid`'s cards draggable. `onOrder(ids)` is told the new order
     * once a drag lands somewhere different from where it began. Returns a
     * function that takes it all off again.
     */
    function attach(grid, { selector = '.site-card', onOrder = () => {} } = {}) {
        let press = null;
        let drag = null;
        /** Drops still settling, each its own finish; taking the grid down ends them. */
        const settling = new Set();

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
            window.removeEventListener('keydown', onKey, true);
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
                tilt: 0,
                start: idsOf(grid, selector),
                frame: 0,
                calm: still(),
            };
            owner = drag;
            place();
            // Lifted: a touch larger, as if it came up off the page.
            requestAnimationFrame(() => { if (drag) drag.body.classList.add('is-up'); });
            drag.frame = requestAnimationFrame(tick);
        }

        /** One frame: follow the pointer, swing, find the slot, scroll the page. */
        function tick() {
            if (!drag) return;
            const aimX = drag.px - drag.grabX;
            const aimY = drag.py - drag.grabY;
            const k = drag.calm ? 1 : SPRING;
            const dx = (aimX - drag.gx) * k;
            drag.gx += dx;
            drag.gy += (aimY - drag.gy) * k;
            // The swing is the sideways speed, eased so it settles rather
            // than snapping upright the moment the pointer stops.
            const want = drag.calm ? 0 : Math.max(-MAX_TILT, Math.min(MAX_TILT, dx * TILT));
            drag.tilt += (want - drag.tilt) * 0.25;
            place();
            seek();
            edgeScroll();
            drag.frame = requestAnimationFrame(tick);
        }

        function place() {
            drag.ghost.style.transform = `translate3d(${drag.gx}px, ${drag.gy}px, 0)`;
            drag.body.style.setProperty('--tilt', `${drag.tilt.toFixed(2)}deg`);
        }

        function edgeScroll() {
            const y = drag.py;
            if (y < EDGE_PX) window.scrollBy(0, -Math.ceil((EDGE_PX - y) / 4));
            else if (y > window.innerHeight - EDGE_PX) window.scrollBy(0, Math.ceil((y - window.innerHeight + EDGE_PX) / 4));
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
            glide(() => grid.insertBefore(drag.card, to > from ? over.nextSibling : over));
        }

        /**
         * Move cards in the DOM and let them glide there. The "before" boxes
         * include any glide still running, so an interrupted glide carries
         * on from where it had got to instead of jumping.
         */
        function glide(mutate) {
            const all = cards();
            const before = new Map(all.map((card) => [card, card.getBoundingClientRect()]));
            mutate();
            if (drag && drag.calm) return;
            const moving = [];
            for (const card of all) {
                if (drag && card === drag.card) continue;
                const was = before.get(card);
                const now = card.getBoundingClientRect();
                const dx = was.left - now.left;
                const dy = was.top - now.top;
                if (!dx && !dy) continue;
                card.style.transition = 'none';
                card.style.transform = `translate(${dx}px, ${dy}px)`;
                moving.push(card);
            }
            if (!moving.length) return;
            void grid.offsetWidth; // one reflow, so every card starts from its inverted place
            for (const card of moving) {
                card.style.transition = `transform ${GLIDE_MS}ms ${EASE}`;
                card.style.transform = '';
                clearTimeout(card.__bbGlide);
                card.__bbGlide = setTimeout(() => { card.style.transition = ''; }, GLIDE_MS + 20);
            }
        }

        // -------------------------------------------------------- landing

        /**
         * Let go. The copy settles onto the slot and only then gives way to
         * the card underneath; cancelled (Escape, a lost pointer), the cards
         * go back to where they started first.
         */
        function land(cancelled) {
            const done = drag;
            drag = null;
            cancelAnimationFrame(done.frame);
            window.removeEventListener('keydown', onKey, true);

            if (cancelled) {
                glide(() => done.start.forEach((id) => {
                    const card = grid.querySelector(`${selector}[data-site="${CSS.escape(id)}"]`);
                    if (card) grid.appendChild(card);
                }));
            }

            const slot = done.card.getBoundingClientRect();
            const finish = () => {
                clearTimeout(finish.timer);
                settling.delete(finish);
                done.ghost.remove();
                done.card.classList.remove('is-drag-origin');
                if (owner !== done) return;
                owner = null;
                document.documentElement.classList.remove('is-dragging-site');
            };
            if (done.calm) {
                finish();
            } else {
                done.ghost.style.transition = `transform ${SETTLE_MS}ms ${EASE}`;
                done.ghost.style.transform = `translate3d(${slot.left}px, ${slot.top}px, 0)`;
                done.body.classList.remove('is-up');
                done.body.style.setProperty('--tilt', '0deg');
                finish.timer = setTimeout(finish, SETTLE_MS);
                settling.add(finish);
            }

            // The click that ends a drag is not a click on the card.
            const swallow = (event) => { event.stopPropagation(); event.preventDefault(); };
            window.addEventListener('click', swallow, true);
            setTimeout(() => window.removeEventListener('click', swallow, true), 0);

            const order = idsOf(grid, selector);
            if (!cancelled && order.join() !== done.start.join()) onOrder(order);
        }

        function onKey(event) {
            if (event.key !== 'Escape' || !drag) return;
            event.preventDefault();
            event.stopPropagation();
            land(true);
            release();
        }

        /**
         * Alt+Arrow moves the focused card one place, for anyone not using
         * a pointer — the same order, saved the same way.
         */
        function onCardKey(event) {
            if (!event.altKey || drag) return;
            const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
            const card = event.target.closest(selector);
            if (!step || !card) return;
            event.preventDefault();
            const ids = idsOf(grid, selector);
            const next = moved(ids, ids.indexOf(card.dataset.site), step);
            if (next.join() === ids.join()) return;
            glide(() => next.forEach((id) => grid.appendChild(grid.querySelector(`${selector}[data-site="${CSS.escape(id)}"]`))));
            card.focus();
            onOrder(next);
        }

        const onDownCapture = (event) => {
            onDown(event);
            if (press) window.addEventListener('keydown', onKey, true);
        };
        // A native drag of the card's <svg> would fight ours.
        const noNativeDrag = (event) => { if (event.target.closest(selector)) event.preventDefault(); };

        grid.addEventListener('pointerdown', onDownCapture);
        grid.addEventListener('keydown', onCardKey);
        grid.addEventListener('dragstart', noNativeDrag);

        return function detach() {
            if (drag) land(true);
            settling.forEach((finish) => finish());
            release();
            grid.removeEventListener('pointerdown', onDownCapture);
            grid.removeEventListener('keydown', onCardKey);
            grid.removeEventListener('dragstart', noNativeDrag);
        };
    }

    /** Whether a drag is under way anywhere on this page. */
    const dragging = () => document.documentElement.classList.contains('is-dragging-site');

    const SiteSort = { attach, moved, dragging, DRAG_PX };

    root.BB = root.BB || {};
    root.BB.SiteSort = SiteSort;
    if (typeof module !== 'undefined' && module.exports) module.exports = SiteSort;
})(typeof globalThis !== 'undefined' ? globalThis : this);
