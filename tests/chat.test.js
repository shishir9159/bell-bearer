/**
 * The chat panel on the tests/chat-stage.js page: opening, the outline
 * reaching turns the page has not mounted, switching branch through the
 * page's own arrows, comparing, exporting, pins, and the skins.
 */
(function () {
    'use strict';

    const { BB, TURN_PX, settle, waitFor, conversation, onChat } = window.ChatStage;

    /** True once the turn `id` sits within `px` of the top of the thread. */
    const atTop = (page, id, px, within = (top) => top >= 0 && top < px) => {
        const turn = page.host.querySelector(`[data-turn-id="${id}"]`);
        return turn && within(turn.getBoundingClientRect().top - page.scroller.getBoundingClientRect().top);
    };
    const hotkey = (code) => new KeyboardEvent('keydown', {
        code, key: code.slice(3).toLowerCase(), ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
    });

    suite('chat — the panel', () => {
        test('the toggle goes into the chat header, and opens and shuts the panel', () => onChat({}, async ({ ui }) => {
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
        }));

        test('the outline lists every prompt and the headings under each answer', () => onChat({}, async ({ ui }) => {
            ui.openPouch();
            await waitFor(() => document.querySelectorAll('.bb-chat-entry').length, 'the outline');
            const texts = Array.from(document.querySelectorAll('.bb-chat-entry'), (row) => row.textContent.trim());
            assertEqual(texts[0], 'Prompt number 1');
            assert(texts.includes('Part 3A') && texts.includes('Part 3B'), 'the headings are missing');
            assertEqual(texts.filter((t) => /^Prompt/.test(t)).length, 12);
        }));

        test('an outline row reaches a turn the page has not mounted', () => onChat({ pairs: 20 }, async ({ ui, page }) => {
            ui.openPouch();
            await waitFor(() => document.querySelectorAll('.bb-chat-entry').length, 'the outline');
            assert(!page.host.querySelector('[data-turn-id="u17"]'), 'prompt 17 should start unmounted');
            Array.from(document.querySelectorAll('.bb-chat-entry')).find((entry) => entry.textContent.trim() === 'Prompt number 17').click();
            await waitFor(() => atTop(page, 'u17', 120), 'prompt 17 at the top of the thread', 4000);
        }));

        test('a heading row lands on the heading, not the top of its answer', () => onChat({}, async ({ ui, page }) => {
            await waitFor(() => ui.conversation(), 'the conversation');
            assert(await ui.goTo('a9', 'Part 9B'), 'reach said it could not');
            const heading = Array.from(page.host.querySelectorAll('h2')).find((h) => h.textContent === 'Part 9B');
            await waitFor(() => {
                const top = heading.getBoundingClientRect().top - page.scroller.getBoundingClientRect().top;
                return top >= 0 && top < 80;
            }, 'the heading at the top', 3000);
        }));

        test('a pin opened from the dashboard lands on its turn, and the address forgets it', () => onChat({
            prepare: () => history.replaceState(history.state, '', `${location.pathname}${location.search}#bb-node=u9`),
        }, async ({ page }) => {
            assertEqual(location.hash, '', 'the address kept the pin');
            await waitFor(() => atTop(page, 'u9', 80, (top) => Math.abs(top) < 80), 'prompt 9 at the top', 4000);
        }));

        test('next and previous prompt step from where the reader is', () => onChat({}, async ({ ui, page }) => {
            await waitFor(() => ui.conversation(), 'the conversation');
            page.scroller.scrollTop = 4 * TURN_PX; // u3 at the top
            page.mount();
            document.body.dispatchEvent(hotkey('KeyJ'));
            await waitFor(() => atTop(page, 'u4', 40, (top) => Math.abs(top) < 40), 'prompt 4 after Ctrl+Alt+J', 3000);
        }));
    });

    suite('chat — branches', () => {
        const nodeIn = (id) => document.querySelector(`#bb-chat-panel [data-bb-chat-node="${id}"]`);

        test('the tree marks the path shown and labels every fork with the page’s own numbers', () => onChat({}, async ({ ui }) => {
            ui.openPouch({ tab: 'tree' });
            await waitFor(() => nodeIn('u1'), 'the tree');
            assert(nodeIn('u1').classList.contains('is-path') && !nodeIn('a2x').classList.contains('is-path'));
            assertDeepEqual(Array.from(document.querySelectorAll('.bb-tree-sib'), (t) => t.textContent).sort(), ['1/2', '1/2', '2/2', '2/2']);
        }));

        test('a turn two forks away is reached by clicking the page’s arrows at each', () => onChat({ current: 'a2x' }, async ({ ui, page }) => {
            ui.openPouch({ tab: 'tree' });
            await waitFor(() => nodeIn('a4x'), 'the tree');
            nodeIn('a4x').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await waitFor(() => page.path.includes('a4x'), 'the page showing the edited prompt’s answer', 8000);
            assertEqual(page.page.clicks, 2, 'one click at each fork');
            await waitFor(() => ui.conversation().current === 'a4x', 'the panel following');
            // Overlaid, the panel steps aside to show the page; opened again it marks the new path.
            ui.panel.open({ tab: 'tree' });
            assert(nodeIn('a4x').classList.contains('is-path'), 'the tree still marks the old path');
        }));

        test('shift-clicking two turns compares them, side by side or in one column', () => onChat({}, async ({ ui }) => {
            try {
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
            }
        }));

        test('the panel follows the page when the site’s own arrows are used', () => onChat({}, async ({ ui, page }) => {
            await waitFor(() => ui.conversation(), 'the conversation');
            page.host.querySelector('[data-turn-id="a2"] [data-test-step="1"]').click();
            await waitFor(() => page.host.querySelector('[data-turn-id="a2x"]'), 'the page switching');
            ui.syncNow();
            assertEqual(ui.conversation().current, 'a2x');
        }));
    });

    /** Dom.download recording into `saved` for the length of `run`. */
    async function capturingDownloads(run) {
        const real = BB().Dom.download;
        const saved = [];
        BB().Dom.download = (name, data, type) => saved.push({ name, data, type });
        try {
            return await run(saved);
        } finally {
            BB().Dom.download = real;
        }
    }

    suite('chat — export', () => {
        test('Export offers Markdown and JSON, and each is a download of the chat in memory', () => onChat({ pairs: 6 }, ({ ui }) => capturingDownloads(async (saved) => {
            ui.openPouch();
            await waitFor(() => document.querySelector('[data-bb-chat-menu]'), 'the Export button');
            document.querySelector('[data-bb-chat-menu]').click();
            document.querySelector('[data-bb-chat-export="md"]').click();
            assert(!document.querySelector('.bb-chat-menu'), 'the menu stayed open');
            document.querySelector('[data-bb-chat-menu]').click();
            document.querySelector('[data-bb-chat-export="json"]').click();
            await waitFor(() => saved.length === 2, 'two downloads');
            assert(/ A long chat\.md$/.test(saved[0].name), saved[0].name);
            assert(saved[0].data.includes('## You\n\nPrompt number 6'), 'the Markdown is not the chat');
            assertEqual(saved[1].type, 'application/json');
            assert(JSON.parse(saved[1].data).nodes.a2x, 'the JSON left out a branch');
        })));

        test('picked chats are fetched in turn, a 429 is waited out, and the zip is saved', () => onChat({ pairs: 4, install: false }, ({ adapter }) => capturingDownloads(async (saved) => {
            const listed = Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, title: `Chat ${i}`, updatedAt: Date.UTC(2025, 10, 1 + i) }));
            let throttled = false;
            const fetched = [];
            adapter.listConversations = async () => ({ items: listed, total: listed.length });
            adapter.fetchConversation = async (id) => {
                if (id === 'k2' && !throttled) { throttled = true; throw Object.assign(new Error('slow down'), { status: 429 }); }
                fetched.push(id);
                return { ...conversation(2), id, title: `Chat ${id.slice(1)}` };
            };
            const library = BB().ChatLibrary.createLibrary({
                adapter, notify() {}, getSettings: () => BB().Settings.DEFAULTS,
                appearance: async () => ({ theme: 'light', skin: 'default' }), dress() {}, sleep: () => settle(0),
            });
            const dialog = library.open();
            await waitFor(() => dialog.element.querySelectorAll('[data-bb-lib-id]').length === 5, 'the list');
            const box = (id) => dialog.element.querySelector(`[data-bb-lib-id="${id}"]`);
            box('k1').click();
            box('k3').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
            assertEqual(dialog.state.picked.size, 3, 'shift-click did not pick the range');
            dialog.element.querySelector('[data-bb-lib-export]').click();
            await waitFor(() => saved.length, 'the zip', 4000);
            assertDeepEqual(fetched, ['k1', 'k2', 'k3'], 'not one at a time, in order, with k2 retried');
            assert(/^chatgpt-export-\d{4}-\d\d-\d\d\.zip$/.test(saved[0].name), saved[0].name);
            assertEqual(saved[0].type, 'application/zip');
            assert(saved[0].data instanceof Uint8Array && saved[0].data.length > 200, 'the archive is empty');
            dialog.close();
        })));
    });

    suite('chat — pins', () => {
        test('Ctrl+Alt+P pins the message being read, marks it and lists it', () => onChat({}, async ({ ui, page }) => {
            await waitFor(() => ui.conversation(), 'the conversation');
            page.scroller.scrollTop = 5 * TURN_PX; // a3 at the top
            page.mount();
            document.body.dispatchEvent(hotkey('KeyP'));
            await waitFor(() => window.MockChrome.state.localStore.bbChatPins, 'the pin to be written');
            const chat = window.MockChrome.state.localStore.bbChatPins['chatgpt:c1'];
            assertDeepEqual(chat.pins.map((pin) => pin.node), ['a3']);
            assertEqual(chat.title, 'A long chat');
            // The stage re-renders after the scroll, wiping a mark that landed
            // first; on a real page the watcher puts it back, as markNow does here.
            await waitFor(() => {
                ui.markNow();
                return page.host.querySelector('[data-turn-id="a3"][data-bb-chat-pinned]');
            }, 'the mark on the page');

            ui.openPouch({ tab: 'pins' });
            await waitFor(() => document.querySelector('.bb-chat-pin'), 'the pins tab');
            assert(document.querySelector('.bb-chat-pin-label').textContent.includes('Part 3A'), 'the excerpt is not the answer');
            ui.panel.open({ tab: 'outline' });
            assertEqual(document.querySelector('.bb-chat-entry.is-pinned').dataset.bbChatReach, 'a3', 'the outline does not wear the pin');
        }));

        test('a pin is named in place and unpinned from its row', () => onChat({ store: { bbChatPins: {
            'chatgpt:c1': { title: 'A long chat', url: '', updatedAt: 1, pins: [{ node: 'a4', label: '', excerpt: 'Answer number 4.', at: 1 }] },
        } } }, async ({ ui }) => {
            ui.openPouch({ tab: 'pins' });
            await waitFor(() => document.querySelector('[data-bb-chat-relabel]'), 'the pin row');
            document.querySelector('[data-bb-chat-relabel]').click();
            const input = document.querySelector('[data-bb-chat-label]');
            assert(input && document.activeElement === input, 'the name field did not take the focus');
            input.value = 'the fix';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await waitFor(() => document.querySelector('.bb-chat-pin-label') &&
                document.querySelector('.bb-chat-pin-label').textContent === 'the fix', 'the new name');
            document.querySelector('[data-bb-chat-unpin]').click();
            await waitFor(() => document.querySelector('.bb-chat-empty'), 'the empty pins tab');
            assertDeepEqual(window.MockChrome.state.localStore.bbChatPins, {});
        }));
    });

    suite('chat — skins', () => {
        test('every surface drawn on a chat site is dressed in the skin that is on', async () => {
            for (const skin of ['default', 'riso', 'medieval', 'deco']) {
                await onChat({
                    pairs: 4,
                    settings: { chatgptComposerTools: true },
                    store: {
                        skin,
                        bbPromptQueue: { items: [{ id: 'k1', site: 'chatgpt', conv: 'c1', chain: 'pc_1', text: 'Later', model: '',
                            notBefore: Date.now() + 3600000, status: 'waiting', note: '', createdAt: 1, sentAt: 0 }] },
                    },
                    prepare: (page) => {
                        const alert = document.createElement('div');
                        alert.setAttribute('role', 'alert');
                        alert.textContent = 'You have hit the Free plan limit for GPT-5. Responses will use another model until your limit resets after 11:58 PM.';
                        page.host.appendChild(alert);
                    },
                }, async ({ ui }) => {
                    ui.openPouch();
                    ui.limitNow();
                    ui.onHotkey(new KeyboardEvent('keydown', { code: 'KeyI', key: 'i', ctrlKey: true, altKey: true, cancelable: true }));
                    await waitFor(() => document.getElementById('bb-chat-queue'), 'the strip');
                    for (const id of ['bb-chat-panel', 'bb-chat-queue', 'bb-chat-limit', 'bb-chat-picker']) {
                        await waitFor(() => {
                            const element = document.getElementById(id);
                            return element && element.classList.contains('bb-themed') && element.dataset.bbSkin === skin;
                        }, `${id} in ${skin}`);
                    }
                });
            }
        });
    });
})();
