/**
 * Dragging the site cards into order, with real pointer events against a real
 * grid. The grid is styled inline: dashboard.css is not loaded, and what is
 * under test is where the cards end up and what is reported.
 */
(function () {
    'use strict';

    const SiteSort = () => window.BB.SiteSort;
    const HOST_ID = 'bb-site-sort-test';
    const IDS = ['youtube', 'chess', 'lichess', 'twitter'];

    function stageGrid() {
        teardown();
        const grid = document.createElement('div');
        grid.id = HOST_ID;
        grid.style.cssText = 'position:relative;display:grid;grid-template-columns:repeat(4,100px);gap:10px;width:430px;';
        grid.innerHTML = IDS.map((id) =>
            `<button class="site-card" type="button" data-site="${id}" style="height:80px">${id}</button>`).join('');
        document.body.appendChild(grid);
        return grid;
    }

    /** Settings' grid: each card in a slot beside its switch, and the slot dragged. */
    function stageSlots() {
        const grid = stageGrid();
        grid.innerHTML = IDS.map((id) => `
            <div class="site-slot" data-site="${id}" style="position:relative;display:flex">
                <button class="site-card" type="button" data-site="${id}" style="height:80px;flex:1">${id}</button>
                <label class="site-switch" style="position:absolute;top:4px;right:4px"><input type="checkbox" data-site-switch="${id}" checked></label>
            </div>`).join('');
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
    // Frames only come when something changes; the timeout keeps a runner that is not painting moving.
    const pause = (ms = 60) => Promise.race([frames(), new Promise((done) => setTimeout(done, ms))]);
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));

    const at = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y,
    }));

    const middleOf = (card) => {
        const box = card.getBoundingClientRect();
        return [box.left + box.width / 2, box.top + box.height / 2];
    };

    /** Press on a card's middle, travel to (x, y) in steps, and optionally let go. */
    async function drag(card, x, y, { drop = true } = {}) {
        const [sx, sy] = middleOf(card);
        at(card, 'pointerdown', sx, sy);
        for (let i = 1; i <= 6; i++) {
            at(window, 'pointermove', sx + ((x - sx) * i) / 6, sy + ((y - sy) * i) / 6);
            await pause();
        }
        if (drop) at(window, 'pointerup', x, y);
    }

    /**
     * A grid with the sorter attached for `run`, taken down however it ends.
     * A drag left live kept its Escape listener (which ate a chat spec's
     * Escape), and the click a drop swallows is only let go on a timer —
     * without the wait, the chat specs' first click went instead.
     */
    async function onGrid({ slots = false } = {}, run) {
        const grid = slots ? stageSlots() : stageGrid();
        const told = [];
        let attached = true;
        const off = SiteSort().attach(grid, { ...(slots ? { selector: '.site-slot' } : {}), onOrder: (ids) => told.push(ids) });
        const detach = () => { if (attached) off(); attached = false; };
        try {
            await run({ grid, told, detach });
        } finally {
            detach();
            await wait(10);
            teardown();
        }
    }

    const altRight = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));

    suite('site cards — dragging into order', () => {
        test('a card dragged onto another takes its place, and the order is reported', () => onGrid({}, async ({ grid, told }) => {
            await drag(grid.children[0], ...middleOf(grid.children[2]));
            assertDeepEqual(order(grid), ['chess', 'lichess', 'youtube', 'twitter']);
            assertDeepEqual(told, [['chess', 'lichess', 'youtube', 'twitter']]);
        }));

        test('the card is held by a copy that follows the pointer until let go', () => onGrid({}, async ({ grid }) => {
            await drag(grid.children[1], 300, 300, { drop: false });
            const ghost = document.querySelector('.site-card-ghost');
            assert(ghost && ghost.textContent.includes('chess'), 'nothing, or the wrong card, was picked up');
            assert(grid.querySelector('.is-drag-origin'), 'no slot was left behind');
            assert(SiteSort().dragging());
            at(window, 'pointerup', 300, 300);
            await wait(300);
            assertEqual(document.querySelector('.site-card-ghost'), null, 'the copy outlived the drop');
            assertEqual(grid.querySelector('.is-drag-origin'), null);
        }));

        test('a press that barely moves is still a click on the card', () => onGrid({}, ({ grid }) => {
            let clicked = null;
            grid.addEventListener('click', (event) => { clicked = event.target.closest('.site-card').dataset.site; });
            const [x, y] = middleOf(grid.children[3]);
            at(grid.children[3], 'pointerdown', x, y);
            at(window, 'pointermove', x + 2, y + 1);
            at(window, 'pointerup', x + 2, y + 1);
            grid.children[3].click();
            assertEqual(clicked, 'twitter');
            assertEqual(document.querySelector('.site-card-ghost'), null);
        }));

        test('the click that ends a drag does not open the card', () => onGrid({}, async ({ grid }) => {
            let clicks = 0;
            grid.addEventListener('click', () => { clicks++; });
            await drag(grid.children[0], ...middleOf(grid.children[1]));
            grid.children[0].click();
            assertEqual(clicks, 0, 'dropping a card opened it');
            await wait(10);
            grid.children[0].click();
            assertEqual(clicks, 1, 'the next real click was swallowed too');
        }));

        test('Escape puts every card back and reports nothing', () => onGrid({}, async ({ grid, told }) => {
            await drag(grid.children[0], ...middleOf(grid.children[3]), { drop: false });
            assertEqual(order(grid)[3], 'youtube', 'the drag did not move the slot');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            assertDeepEqual(order(grid), IDS);
            assertDeepEqual(told, []);
        }));

        test('a card picked up again while the last one settles stays picked up', () => onGrid({}, async ({ grid }) => {
            // The first drop's settle ran out under the second drag and took the page's drag class.
            await drag(grid.children[0], ...middleOf(grid.children[1]));
            await wait(10);
            await drag(grid.children[2], 300, 300, { drop: false });
            await wait(300);
            assert(SiteSort().dragging(), 'the earlier drop let go of the page');
            at(window, 'pointerup', 300, 300);
        }));

        test('taking the grid down ends a settle still running', () => onGrid({}, async ({ grid, detach }) => {
            await drag(grid.children[0], ...middleOf(grid.children[1]));
            detach();
            assertEqual(document.querySelector('.site-card-ghost'), null, 'the copy outlived the grid');
            assert(!SiteSort().dragging(), 'the page is still dragging');
        }));

        test('Alt and an arrow move the focused card one place, focus and all', () => onGrid({}, ({ grid, told }) => {
            grid.children[1].focus();
            altRight(grid.children[1]);
            assertDeepEqual(order(grid), ['youtube', 'lichess', 'chess', 'twitter']);
            assertDeepEqual(told, [['youtube', 'lichess', 'chess', 'twitter']]);
            assert(document.activeElement === grid.children[2], 'focus did not travel with the card');
        }));

        test('in slots, Alt and an arrow keep the focus on the card that moved', () => onGrid({ slots: true }, ({ grid, told }) => {
            const card = grid.children[1].querySelector('.site-card');
            card.focus();
            altRight(card);
            assertDeepEqual(order(grid), ['youtube', 'lichess', 'chess', 'twitter']);
            assertDeepEqual(told, [['youtube', 'lichess', 'chess', 'twitter']]);
            // Focusing the slot, which cannot take focus, dropped it to the page.
            assert(document.activeElement === card, 'focus did not stay on the card');
        }));

        test('in slots, a press on the switch is a click and the slot moves whole', () => onGrid({ slots: true }, async ({ grid, told }) => {
            const input = grid.querySelector('[data-site-switch="chess"]');
            const [x, y] = middleOf(input);
            at(input, 'pointerdown', x, y);
            at(window, 'pointerup', x, y);
            input.click();
            assertEqual(input.checked, false, 'the switch did not take the click');
            assertDeepEqual(told, []);

            await drag(grid.children[0].querySelector('.site-card'), ...middleOf(grid.children[2]));
            assertDeepEqual(order(grid), ['chess', 'lichess', 'youtube', 'twitter']);
            assert(grid.children[2].querySelector('[data-site-switch="youtube"]'), 'the switch was left behind');
        }));
    });
})();
