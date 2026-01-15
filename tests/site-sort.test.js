/**
 * Dragging the site cards into order, with real pointer events against a
 * real grid. The grid is styled inline rather than from dashboard.css, which
 * the suite does not load: what is under test is where the cards end up and
 * what is reported, not how the dashboard happens to look.
 *
 * Wrapped, because this file shares the global scope with the other specs.
 */
(function () {
    'use strict';

    const SiteSort = () => window.BB.SiteSort;
    const HOST_ID = 'bb-site-sort-test';

    function stageGrid(ids = ['youtube', 'chess', 'lichess', 'twitter']) {
        teardown();
        const grid = document.createElement('div');
        grid.id = HOST_ID;
        grid.style.cssText = 'position:relative;display:grid;grid-template-columns:repeat(4,100px);gap:10px;width:430px;';
        grid.innerHTML = ids.map((id) =>
            `<button class="site-card" type="button" data-site="${id}" style="height:80px">${id}</button>`).join('');
        document.body.appendChild(grid);
        return grid;
    }

    function teardown() {
        const grid = document.getElementById(HOST_ID);
        if (grid) grid.remove();
        document.querySelectorAll('.site-card-ghost').forEach((node) => node.remove());
        document.documentElement.classList.remove('is-dragging-site');
    }

    const order = (grid) => Array.from(grid.children, (card) => card.dataset.site);
    const frames = (n = 3) => new Promise((done) => {
        let left = n;
        const step = () => (--left <= 0 ? done() : requestAnimationFrame(step));
        requestAnimationFrame(step);
    });
    // Frames only come when something changes; a timeout keeps the spec
    // moving in a runner that is not painting.
    const pause = (ms = 60) => Promise.race([frames(), new Promise((done) => setTimeout(done, ms))]);

    const at = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y,
    }));

    /** Press on a card's middle, travel to (x, y) in steps, and optionally let go. */
    async function drag(card, x, y, { drop = true } = {}) {
        const box = card.getBoundingClientRect();
        const sx = box.left + box.width / 2;
        const sy = box.top + box.height / 2;
        at(card, 'pointerdown', sx, sy);
        for (let i = 1; i <= 6; i++) {
            at(window, 'pointermove', sx + ((x - sx) * i) / 6, sy + ((y - sy) * i) / 6);
            await pause();
        }
        if (drop) at(window, 'pointerup', x, y);
    }

    const middleOf = (card) => {
        const box = card.getBoundingClientRect();
        return [box.left + box.width / 2, box.top + box.height / 2];
    };

    /**
     * Every drag that ends swallows the next click on the page until a timer
     * lets it go, and the runner goes from one spec to the next without a
     * timer ever running in between. A spec that ends a drag and stops there
     * handed the swallow on: the first click of the chat specs, which follow
     * these in index.html, was eaten, and "the panel did not open".
     */
    const letGo = () => new Promise((done) => setTimeout(done, 10));

    /**
     * Take the grid down whether or not the spec reached its end. A spec that
     * failed mid-drag used to leave the drag live, and with it the window's
     * Escape listener, which ate the chat compare spec's Escape two suites on.
     */
    async function clear(detach) {
        detach();
        await letGo();
        teardown();
    }

    suite('site cards — dragging into order', () => {
        test('a card dragged onto another takes its place, and the order is reported', async () => {
            const grid = stageGrid();
            const told = [];
            const detach = SiteSort().attach(grid, { onOrder: (ids) => told.push(ids) });
            try {
                await drag(grid.children[0], ...middleOf(grid.children[2]));
                assertDeepEqual(order(grid), ['chess', 'lichess', 'youtube', 'twitter']);
                assertDeepEqual(told, [['chess', 'lichess', 'youtube', 'twitter']]);
            } finally { await clear(detach); }
        });

        test('the card is held by a copy that follows the pointer until let go', async () => {
            const grid = stageGrid();
            const detach = SiteSort().attach(grid, {});
            try {
                await drag(grid.children[1], 300, 300, { drop: false });
                const ghost = document.querySelector('.site-card-ghost');
                assert(ghost, 'nothing was picked up');
                assert(ghost.textContent.includes('chess'), 'the wrong card was picked up');
                assert(grid.querySelector('.is-drag-origin'), 'no slot was left behind');
                assert(SiteSort().dragging());
                at(window, 'pointerup', 300, 300);
                await new Promise((done) => setTimeout(done, 300));
                assertEqual(document.querySelector('.site-card-ghost'), null, 'the copy outlived the drop');
                assertEqual(grid.querySelector('.is-drag-origin'), null);
            } finally { await clear(detach); }
        });

        test('a press that barely moves is still a click on the card', async () => {
            const grid = stageGrid();
            const detach = SiteSort().attach(grid, {});
            try {
                let clicked = null;
                grid.addEventListener('click', (event) => { clicked = event.target.closest('.site-card').dataset.site; });
                const [x, y] = middleOf(grid.children[3]);
                at(grid.children[3], 'pointerdown', x, y);
                at(window, 'pointermove', x + 2, y + 1);
                at(window, 'pointerup', x + 2, y + 1);
                grid.children[3].click();
                assertEqual(clicked, 'twitter');
                assertEqual(document.querySelector('.site-card-ghost'), null);
            } finally { await clear(detach); }
        });

        test('the click that ends a drag does not open the card', async () => {
            const grid = stageGrid();
            const detach = SiteSort().attach(grid, {});
            try {
                let clicks = 0;
                grid.addEventListener('click', () => { clicks++; });
                await drag(grid.children[0], ...middleOf(grid.children[1]));
                grid.children[0].click();
                assertEqual(clicks, 0, 'dropping a card opened it');
                await new Promise((done) => setTimeout(done, 10));
                grid.children[0].click();
                assertEqual(clicks, 1, 'the next real click was swallowed too');
            } finally { await clear(detach); }
        });

        test('Escape puts every card back and reports nothing', async () => {
            const grid = stageGrid();
            const told = [];
            const detach = SiteSort().attach(grid, { onOrder: (ids) => told.push(ids) });
            try {
                await drag(grid.children[0], ...middleOf(grid.children[3]), { drop: false });
                assertEqual(order(grid)[3], 'youtube', 'the drag did not move the slot');
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                assertDeepEqual(order(grid), ['youtube', 'chess', 'lichess', 'twitter']);
                assertDeepEqual(told, []);
            } finally { await clear(detach); }
        });

        test('a card picked up again while the last one settles stays picked up', async () => {
            // The first drop's settle ran out under the second drag and took
            // the page's drag class with it.
            const grid = stageGrid();
            const detach = SiteSort().attach(grid, {});
            try {
                await drag(grid.children[0], ...middleOf(grid.children[1]));
                await letGo();
                await drag(grid.children[2], 300, 300, { drop: false });
                await new Promise((done) => setTimeout(done, 300));
                assert(SiteSort().dragging(), 'the earlier drop let go of the page');
                at(window, 'pointerup', 300, 300);
            } finally { await clear(detach); }
        });

        test('taking the grid down ends a settle still running', async () => {
            const grid = stageGrid();
            const detach = SiteSort().attach(grid, {});
            try {
                await drag(grid.children[0], ...middleOf(grid.children[1]));
                detach();
                assertEqual(document.querySelector('.site-card-ghost'), null, 'the copy outlived the grid');
                assert(!SiteSort().dragging(), 'the page is still dragging');
            } finally { await letGo(); teardown(); }
        });

        test('Alt and an arrow move the focused card one place', async () => {
            const grid = stageGrid();
            const told = [];
            const detach = SiteSort().attach(grid, { onOrder: (ids) => told.push(ids) });
            try {
                grid.children[1].focus();
                grid.children[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
                assertDeepEqual(order(grid), ['youtube', 'lichess', 'chess', 'twitter']);
                assertDeepEqual(told, [['youtube', 'lichess', 'chess', 'twitter']]);
                assert(document.activeElement === grid.children[2], 'focus did not travel with the card');
            } finally { await clear(detach); }
        });
    });
})();
