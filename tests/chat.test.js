/**
 * The chat panel, for the parts only a real DOM can answer: opening and
 * docking, the outline reaching a turn the page has not mounted, the tree
 * switching branch by clicking the page's own arrows, comparing, exporting,
 * pins, and every surface in every skin. The page they run against is
 * tests/chat-stage.js.
 *
 * Like the LeetCode specs, these call the injectors straight off the factory
 * rather than through the watcher, which only runs on an animation frame.
 *
 * Wrapped, because this file shares the global scope with the other specs.
 */
(function () {
    'use strict';

    const { BB, TURN_PX, settle, waitFor, conversation, stagePage, teardown, makeUi } = window.ChatStage;

    // ------------------------------------------------------------- panel

    suite('chat — the panel', () => {
        test('the toggle goes into the chat header, and opens and shuts the panel', async () => {
            window.MockChrome.reset();
            const conv = conversation();
            stagePage(conv);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                ui.injectToggle();
                const toggle = document.getElementById('bb-chat-toggle');
                assert(toggle && toggle.parentElement.id === 'conversation-header-actions', 'the toggle is not in the header');
                toggle.click();
                const panel = document.getElementById('bb-chat-panel');
                assert(panel, 'the panel did not open');
                await waitFor(() => panel.querySelector('.bb-chat-title').textContent === 'A long chat', 'the title');
                assertEqual(toggle.getAttribute('aria-pressed'), 'true');
                toggle.click();
                assert(!document.getElementById('bb-chat-panel'), 'a second press did not close it');
                await settle(20);
                assertEqual(window.MockChrome.state.localStore.bbChatPanel.open, false, 'shut was not remembered');
            } finally { restore(); }
        });

        test('the outline lists every prompt and the headings under each answer', async () => {
            window.MockChrome.reset();
            const conv = conversation();
            stagePage(conv);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                ui.openPouch();
                await waitFor(() => document.querySelectorAll('.bb-chat-entry').length, 'the outline');
                const texts = Array.from(document.querySelectorAll('.bb-chat-entry'), (row) => row.textContent.trim());
                assertEqual(texts[0], 'Prompt number 1');
                assert(texts.includes('Part 3A') && texts.includes('Part 3B'), 'the headings are missing');
                assertEqual(texts.filter((t) => /^Prompt/.test(t)).length, 12);
            } finally { restore(); }
        });

        test('an outline row reaches a turn the page has not mounted', async () => {
            window.MockChrome.reset();
            const conv = conversation(20);
            const page = stagePage(conv);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                ui.openPouch();
                await waitFor(() => document.querySelectorAll('.bb-chat-entry').length, 'the outline');
                assert(!page.host.querySelector('[data-turn-id="u17"]'), 'prompt 17 should start unmounted');
                const row = Array.from(document.querySelectorAll('.bb-chat-entry'))
                    .find((entry) => entry.textContent.trim() === 'Prompt number 17');
                row.click();
                await waitFor(() => {
                    const turn = page.host.querySelector('[data-turn-id="u17"]');
                    if (!turn) return false;
                    const top = turn.getBoundingClientRect().top - page.scroller.getBoundingClientRect().top;
                    return top >= 0 && top < 120;
                }, 'prompt 17 at the top of the thread', 4000);
            } finally { restore(); }
        });

        test('a heading row lands on the heading, not the top of its answer', async () => {
            window.MockChrome.reset();
            const conv = conversation(12);
            const page = stagePage(conv);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                await waitFor(() => ui.conversation(), 'the conversation');
                const landed = await ui.goTo('a9', 'Part 9B');
                assert(landed, 'reach said it could not');
                const heading = Array.from(page.host.querySelectorAll('h2')).find((h) => h.textContent === 'Part 9B');
                await waitFor(() => {
                    const top = heading.getBoundingClientRect().top - page.scroller.getBoundingClientRect().top;
                    return top >= 0 && top < 80;
                }, 'the heading at the top', 3000);
            } finally { restore(); }
        });

        test('a pin opened from the dashboard lands on its turn, and the address forgets it', async () => {
            window.MockChrome.reset();
            const conv = conversation(12);
            const page = stagePage(conv);
            history.replaceState(history.state, '', `${location.pathname}${location.search}#bb-node=u9`);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                assertEqual(location.hash, '', 'the address kept the pin');
                await waitFor(() => {
                    const turn = page.host.querySelector('[data-turn-id="u9"]');
                    return turn && Math.abs(turn.getBoundingClientRect().top - page.scroller.getBoundingClientRect().top) < 80;
                }, 'prompt 9 at the top', 4000);
            } finally { restore(); }
        });

        test('next and previous prompt step from where the reader is', async () => {
            window.MockChrome.reset();
            const conv = conversation(12);
            const page = stagePage(conv);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                await waitFor(() => ui.conversation(), 'the conversation');
                page.scroller.scrollTop = 4 * TURN_PX; // u3 at the top
                page.mount();
                const key = (code) => new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase(), ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
                document.body.dispatchEvent(key('KeyJ'));
                await waitFor(() => {
                    const turn = page.host.querySelector('[data-turn-id="u4"]');
                    return turn && Math.abs(turn.getBoundingClientRect().top - page.scroller.getBoundingClientRect().top) < 40;
                }, 'prompt 4 after Ctrl+Alt+J', 3000);
            } finally { restore(); }
        });
    });

    // ---------------------------------------------------------- branches

    suite('chat — branches', () => {
        const nodeIn = (id) => document.querySelector(`#bb-chat-panel [data-bb-chat-node="${id}"]`);

        test('the tree marks the path shown and labels every fork with the page’s own numbers', async () => {
            window.MockChrome.reset();
            const conv = conversation(12);
            stagePage(conv);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                ui.openPouch({ tab: 'tree' });
                await waitFor(() => nodeIn('u1'), 'the tree');
                assert(nodeIn('u1').classList.contains('is-path') && !nodeIn('a2x').classList.contains('is-path'));
                const labels = Array.from(document.querySelectorAll('.bb-tree-sib'), (t) => t.textContent).sort();
                assertDeepEqual(labels, ['1/2', '1/2', '2/2', '2/2']);
            } finally { restore(); }
        });

        test('a turn two forks away is reached by clicking the page’s arrows at each', async () => {
            window.MockChrome.reset();
            const conv = conversation(12);
            conv.current = 'a2x';
            const page = stagePage(conv);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                ui.openPouch({ tab: 'tree' });
                await waitFor(() => nodeIn('a4x'), 'the tree');
                nodeIn('a4x').dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await waitFor(() => page.path.includes('a4x'), 'the page showing the edited prompt’s answer', 8000);
                assertEqual(page.page.clicks, 2, 'one click at each fork');
                await waitFor(() => ui.conversation().current === 'a4x', 'the panel following');
                // An overlaid panel steps aside to show the page; docked, it
                // stays. Either way, opened again it marks the new path.
                ui.panel.open({ tab: 'tree' });
                assert(nodeIn('a4x').classList.contains('is-path'), 'the tree still marks the old path');
            } finally { restore(); }
        });

        test('shift-clicking two turns compares them, side by side or in one column', async () => {
            window.MockChrome.reset();
            const conv = conversation(12);
            stagePage(conv);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                ui.openPouch({ tab: 'tree' });
                await waitFor(() => nodeIn('a2x'), 'the tree');
                nodeIn('a2').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
                await waitFor(() => nodeIn('a2') && nodeIn('a2').classList.contains('is-picked'), 'the first pick marked');
                nodeIn('a2x').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
                const dialog = document.getElementById('bb-chat-compare');
                assert(dialog, 'no comparison opened');
                assertEqual(dialog.querySelectorAll('.bb-chat-compare-col').length, 2);
                assert(dialog.querySelector('del') && dialog.querySelector('ins'), 'nothing is marked as changed');
                dialog.querySelector('[data-bb-compare-mode="inline"]').click();
                assertEqual(dialog.querySelectorAll('.bb-chat-compare-col').length, 1);
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                assert(!document.getElementById('bb-chat-compare'), 'Escape did not close it');
                assert(document.getElementById('bb-chat-panel'), 'Escape took the panel with it');
                assert(!document.querySelector('.bb-tree-node.is-picked'), 'the picks outlived the comparison');
            } finally {
                const left = document.getElementById('bb-chat-compare');
                if (left) left.remove();
                restore();
            }
        });

        test('the panel follows the page when the site’s own arrows are used', async () => {
            window.MockChrome.reset();
            const conv = conversation(12);
            const page = stagePage(conv);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                await waitFor(() => ui.conversation(), 'the conversation');
                page.host.querySelector('[data-turn-id="a2"] [data-test-step="1"]').click();
                await waitFor(() => page.host.querySelector('[data-turn-id="a2x"]'), 'the page switching');
                ui.syncNow();
                assertEqual(ui.conversation().current, 'a2x');
            } finally { restore(); }
        });
    });

})();
