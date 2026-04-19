/**
 * Typing into a chat site's composer, the prompt picker, and the queue:
 * prompts sent one after another through the page's own send button, the
 * strip above the composer, and holding on a limit. The page is
 * tests/chat-stage.js, whose send button "streams" an answer behind a stop button.
 */
(function () {
    'use strict';

    const { BB, settle, waitFor, conversation, stagePage, teardown, onChat } = window.ChatStage;

    suite('chat — typing into the composer', () => {
        /** A box on the page for the length of `run`. */
        async function withBox(make, run) {
            const box = make();
            document.body.appendChild(box);
            try {
                return await run(box);
            } finally {
                box.remove();
            }
        }
        const element = (tag, props = {}) => () => Object.assign(document.createElement(tag), props);
        /** A box that takes a paste the way ProseMirror does: a paragraph per line. */
        const proseMirror = () => {
            const box = element('div', { contentEditable: 'true', className: 'ProseMirror' })();
            box.addEventListener('paste', (event) => {
                event.preventDefault();
                if (box.textContent.trim() === '') box.innerHTML = '';
                event.clipboardData.getData('text/plain').split('\n').forEach((line) => {
                    const p = document.createElement('p');
                    p.textContent = line;
                    box.appendChild(p);
                });
            });
            return box;
        };

        test('a paste lands as paragraphs, after what was already there', () => withBox(proseMirror, async (box) => {
            box.innerHTML = '<p>Already here</p>';
            assert(await BB().Composer.insert(box, 'First line\nSecond line'), 'it did not land');
            assertDeepEqual(Array.from(box.querySelectorAll('p'), (p) => p.textContent), ['Already here', 'First line', 'Second line']);
            assert(!BB().Composer.isEmpty(box));
            BB().Composer.clear(box);
            assert(BB().Composer.isEmpty(box), 'clear left text behind');
        }));

        test('a box that ignores the paste is typed into instead', () => withBox(element('div', { contentEditable: 'true' }), async (box) => {
            assert(await BB().Composer.insert(box, 'typed in\nand on'), 'the fallback did not land either');
            assert(BB().Composer.read(box).replace(/\s+/g, ' ').includes('typed in and on'));
        }));

        test('a textarea gets the value and an input event, the way React listens', () => withBox(element('textarea'), async (box) => {
            let heard = 0;
            box.addEventListener('input', () => heard++);
            assert(await BB().Composer.insert(box, 'hello'));
            assertEqual(box.value, 'hello');
            assertEqual(heard, 1);
        }));

        test('text that lands nowhere goes on the clipboard, and says so', () => withBox(element('div'), async (box) => {
            const copied = [];
            assertEqual(await BB().Composer.insert(box, 'lost', { copy: async (text) => { copied.push(text); return true; } }), false);
            assertDeepEqual(copied, ['lost']);
        }));

        test('send is pressed only when it can be', () => {
            const button = document.createElement('button');
            let pressed = 0;
            button.addEventListener('click', () => pressed++);
            button.disabled = true;
            assertEqual(BB().Composer.submit(button), false);
            button.disabled = false;
            button.setAttribute('aria-disabled', 'true');
            assertEqual(BB().Composer.submit(button), false);
            button.removeAttribute('aria-disabled');
            assertEqual(BB().Composer.submit(button), true);
            assertEqual(pressed, 1);
            assertEqual(BB().Composer.submit(null), false);
        });
    });

    suite('chat — the prompt picker', () => {
        const store = { bbPromptTemplates: [
            { id: 't1', name: 'Code review', body: 'Review this:\n\n{{code}}\n\nAbout {{selection}}.' },
            { id: 't2', name: 'Plain one', body: 'Just this.' },
        ] };
        const templates = () => window.MockChrome.state.localStore.bbPromptTemplates;

        test('Ctrl+Alt+I, a filter, a field and Ctrl+Enter put the filled prompt in the box', () => onChat({ pairs: 4, store }, async ({ page }) => {
            const box = page.host.querySelector('#prompt-textarea');
            // What is selected on the page is what {{selection}} means.
            const range = document.createRange();
            range.selectNodeContents(page.host.querySelector('[data-turn-id="a1"] p'));
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            box.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', key: 'i', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
            const picker = document.getElementById('bb-chat-picker');
            assert(picker, 'the picker did not open');
            await waitFor(() => picker.querySelectorAll('[data-bb-pick]').length === 2, 'the templates');
            const query = picker.querySelector('.bb-chat-picker-q');
            query.value = 'review';
            query.dispatchEvent(new Event('input'));
            assertEqual(picker.querySelectorAll('[data-bb-pick]').length, 1);
            query.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            const field = picker.querySelector('textarea[data-bb-field="code"]');
            assert(field, 'a code field should be a tall box');
            field.value = 'x = 1';
            field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
            await waitFor(() => /x = 1/.test(box.textContent), 'the prompt in the box');
            assertDeepEqual(Array.from(box.querySelectorAll('p'), (p) => p.textContent), ['Review this:', '', 'x = 1', '', 'About Answer number 1..']);
            assert(!document.getElementById('bb-chat-picker'), 'the picker stayed open');
            assert(page.host.querySelector('[data-testid="send-button"]'), 'the page did not see the text');
            await waitFor(() => templates().find((t) => t.id === 't1').uses === 1, 'the use counted');
        }));

        test('what is in the box can be saved as a template, named by the filter', () => onChat({ pairs: 4, store }, async ({ ui, page }) => {
            page.host.querySelector('#prompt-textarea').innerHTML = '<p>Explain it to me like a colleague.</p>';
            ui.onHotkey(new KeyboardEvent('keydown', { code: 'KeyI', key: 'i', ctrlKey: true, altKey: true, cancelable: true }));
            const picker = document.getElementById('bb-chat-picker');
            await waitFor(() => picker.querySelector('.is-save'), 'the save row');
            picker.querySelector('.bb-chat-picker-q').value = 'Colleague';
            picker.querySelector('.is-save').click();
            await waitFor(() => templates().length === 3, 'the new template');
            const made = templates()[2];
            assertDeepEqual([made.name, made.body, made.sites], ['Colleague', 'Explain it to me like a colleague.', ['chatgpt']]);
        }));
    });

    suite('chat — the prompt queue', () => {
        const item = (id, text, extra = {}) => ({
            id, site: 'chatgpt', conv: 'c1', chain: 'pc_1', text, model: '', notBefore: 0,
            status: 'waiting', note: '', createdAt: 1, sentAt: 0, ...extra,
        });
        const queued = (...items) => ({ bbPromptQueue: { items } });
        const queue = () => window.MockChrome.state.localStore.bbPromptQueue;
        const fast = { chatgptQueueGapSeconds: 1 };
        const notice = (text) => (page) => {
            const alert = document.createElement('div');
            alert.setAttribute('role', 'alert');
            alert.textContent = text;
            page.host.appendChild(alert);
        };
        const HOURLY = 'You’ve reached our limit of messages per hour. Please try again in 30 minutes.';

        test('queued prompts are typed in and sent in turn, each after the last answer', () => onChat({
            pairs: 4, settings: fast, store: queued(item('q1', 'First'), item('q2', 'Second\nwith two lines'), item('q3', 'Third')),
        }, async ({ page }) => {
            await waitFor(() => page.page.sent.length === 3, 'three prompts sent', 12000);
            assertDeepEqual(page.page.sent, ['First', 'Second\nwith two lines', 'Third']);
            await waitFor(() => queue().items.every((one) => one.status === 'sent'), 'all marked sent', 4000);
            assertDeepEqual(queue().leases, {}, 'the lease outlived the queue');
        }));

        test('someone typing in the box is never typed over', () => onChat({
            pairs: 4, settings: fast, store: queued(item('t1', 'Queued one')),
            prepare: (page) => { page.host.querySelector('#prompt-textarea').innerHTML = '<p>half a thought</p>'; },
        }, async ({ ui, page }) => {
            const box = page.host.querySelector('#prompt-textarea');
            await settle(400);
            assertDeepEqual(page.page.sent, [], 'it sent over the reader');
            assertEqual(box.textContent, 'half a thought');
            box.innerHTML = '<p><br></p>';
            ui.wakeQueue();
            await waitFor(() => page.page.sent.length === 1, 'the queued prompt, once the box was empty', 5000);
        }));

        test('pressing the site’s stop pauses the queue instead of carrying on', async () => {
            window.MockChrome.reset({ localStore: queued(item('s1', 'Long one'), item('s2', 'Follow-up')) });
            const page = stagePage(conversation(4));
            // Streams until stopped, so the stop lands mid-answer however slowly the tab runs.
            page.page.answerMs = 10 * 60 * 1000;
            const runner = BB().ChatRunner.createRunner({
                adapter: Object.assign({}, BB().ChatgptRead.adapter, { convIdOf: () => 'c1', isNewChat: () => false }),
                pageId: 'test', notify() {}, getSettings: () => Object.assign({}, BB().Settings.DEFAULTS, fast), trusted: () => true,
            });
            try {
                runner.start();
                await waitFor(() => page.host.querySelector('[data-testid="stop-button"]'), 'the first answer streaming', 5000);
                page.host.querySelector('[data-testid="stop-button"]').click();
                await waitFor(() => queue().paused && queue().paused['chatgpt:c1'], 'the pause', 5000);
                await settle(300);
                assertDeepEqual(page.page.sent, ['Long one'], 'the follow-up went anyway');
                assertEqual(queue().items.find((one) => one.id === 's2').status, 'waiting');
            } finally { runner.stop(); teardown(); }
        });

        /** A runner for the staged chat c1, as the page `pageId` — a tab of its own. */
        const runnerAs = (pageId) => BB().ChatRunner.createRunner({
            adapter: Object.assign({}, BB().ChatgptRead.adapter, { convIdOf: () => 'c1', isNewChat: () => false }),
            pageId, notify() {}, getSettings: () => Object.assign({}, BB().Settings.DEFAULTS, fast), trusted: () => true,
        });

        test('two tabs on one chat send its prompt once between them', async () => {
            // Each found the lease free on a read and claimed it on a write
            // after, so both typed the prompt in and pressed send.
            window.MockChrome.reset({ localStore: queued(item('o1', 'Only once')) });
            const page = stagePage(conversation(4));
            const runners = [runnerAs('tab-a'), runnerAs('tab-b')];
            try {
                runners.forEach((runner) => runner.start());
                await waitFor(() => queue().items[0].status === 'sent', 'the prompt sent', 8000);
                await settle(300);
                assertDeepEqual(page.page.sent, ['Only once']);
            } finally { runners.forEach((runner) => runner.stop()); teardown(); }
        });

        test('a claim the store could not write sends nothing', async () => {
            window.MockChrome.reset({ localStore: queued(item('f1', 'Never written')) });
            const page = stagePage(conversation(4));
            const local = chrome.storage.local;
            const set = local.set;
            // Every write fails, the claim's first among them.
            local.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
            const error = console.error;
            console.error = () => {};
            const runner = runnerAs('tab-a');
            try {
                runner.start();
                await settle(600);
                assertDeepEqual(page.page.sent, [], 'it sent a prompt it had not claimed');
                assertEqual(page.host.querySelector('#prompt-textarea').textContent.trim(), '', 'it typed the prompt in');
            } finally {
                local.set = set;
                console.error = error;
                runner.stop();
                teardown();
            }
        });

        test('the strip above the composer lists what is queued and changes it', async () => {
            const later = Date.now() + 3 * 3600 * 1000;
            await onChat({ pairs: 4, settings: fast, store: queued(
                item('v1', 'Scheduled one', { notBefore: later }),
                item('v2', 'Held one', { status: 'held', note: 'Its time passed while the browser was shut — send it anyway?' }),
                item('v3', 'Third'),
            ) }, async ({ ui, page }) => {
                await waitFor(() => document.getElementById('bb-chat-queue'), 'the strip');
                const strip = document.getElementById('bb-chat-queue');
                assertEqual(strip.nextElementSibling, page.host.querySelector('form'), 'the strip is not just above the composer');
                assert(strip.textContent.includes('3 queued'), strip.textContent);
                assert(strip.querySelector('[data-bb-q="release"]'), 'a held prompt cannot be sent anyway');
                strip.querySelector('[data-bb-q="remove"][data-bb-q-id="v3"]').click();
                await waitFor(() => queue().items.length === 2, 'the removal');
                strip.querySelector('[data-bb-q="pause"]').click();
                await waitFor(() => queue().paused['chatgpt:c1'], 'the pause');
                await waitFor(() => document.getElementById('bb-chat-queue').textContent.includes('paused'), 'the strip saying so');
                ui.openPouch({ tab: 'queue' });
                assertEqual(document.querySelectorAll('#bb-chat-panel .bb-chat-q-row').length, 2, 'the Queue tab is not the same list');
                ui.panel.close();
                // The clock opens the time editor, and "an hour" sets an hour from now.
                document.querySelector('#bb-chat-queue [data-bb-q="when"][data-bb-q-id="v1"]').click();
                await waitFor(() => document.querySelector('#bb-chat-queue [data-bb-q="hour"]'), 'the time editor');
                const before = Date.now();
                document.querySelector('#bb-chat-queue [data-bb-q="hour"]').click();
                await waitFor(() => queue().items[0].notBefore < later, 'the new time');
                assert(Math.abs(queue().items[0].notBefore - (before + 3600000)) < 60000, 'not an hour from now');
            });
            assert(!document.getElementById('bb-chat-queue'), 'the strip outlived its page');
        });

        test('a limit notice offers to hold the queue, and one that blocks holds it by itself', async () => {
            let alert = null;
            await onChat({ pairs: 4, settings: fast, prepare: (page) => {
                notice('You’ve hit the Free plan limit for GPT-5. Responses will use another model until your limit resets after 11:58 PM.')(page);
                alert = page.host.querySelector('[role="alert"]');
                // A prompt about limits, being typed, is not a notice.
                page.host.querySelector('#prompt-textarea').innerHTML = '<p>Explain the rate limit that resets after 3 PM</p>';
            } }, async ({ ui }) => {
                ui.limitNow();
                const chip = document.getElementById('bb-chat-limit');
                assert(chip && /GPT-5 is back after 11:58/.test(chip.textContent), chip && chip.textContent);
                chip.querySelector('[data-bb-limit="hold"]').click();
                await waitFor(() => queue() && queue().holds.chatgpt, 'the hold');
                const reset = new Date(); reset.setHours(23, 58, 0, 0);
                if (reset.getTime() <= Date.now()) reset.setDate(reset.getDate() + 1);
                assertEqual(queue().holds.chatgpt.until, reset.getTime() + 60000, 'not a minute past the reset');

                alert.textContent = HOURLY;
                ui.limitNow();
                assert(/queue waits/.test(document.getElementById('bb-chat-limit').textContent), 'a blocking notice was only offered');
                await waitFor(() => queue().holds.chatgpt.until < reset.getTime(), 'the queue held for the half hour');
            });
            assert(!document.getElementById('bb-chat-limit'), 'the chip outlived its page');
        });

        test('a blocking notice whose time moves with the clock is held once, not on every look', () => onChat({
            pairs: 4, settings: fast, prepare: notice(HOURLY),
        }, async ({ ui }) => {
            // "In 30 minutes" is read afresh each time, and the queue was rewritten on every pass.
            ui.limitNow();
            await waitFor(() => queue() && queue().holds.chatgpt, 'the hold');
            const first = queue().holds.chatgpt.until;
            for (let i = 0; i < 4; i++) {
                await settle(20);
                ui.limitNow();
            }
            await settle(100);
            assertEqual(queue().holds.chatgpt.until, first, 'the hold was written again');
        }));

        test('the composer buttons are drawn only while asked for, and do what the hotkeys do', () => onChat({
            pairs: 4, settings: Object.assign({ chatgptComposerTools: true }, fast),
        }, async ({ ui, values, page }) => {
            ui.refreshSurfaces();
            const tools = document.getElementById('bb-chat-tools');
            assert(tools && tools.parentElement === page.host.querySelector('form'), 'not beside the composer’s own buttons');
            page.host.querySelector('form').insertAdjacentHTML('beforeend', '<button type="button" data-testid="stop-button">Stop</button>');
            page.host.querySelector('#prompt-textarea').innerHTML = '<p>From the button</p>';
            tools.querySelector('[data-bb-tool="queue"]').click();
            await waitFor(() => queue() && queue().items.length === 1, 'the queued item');
            values.chatgptComposerTools = false;
            ui.refreshSurfaces();
            assert(!document.getElementById('bb-chat-tools'), 'turning it off left the buttons on the open page');
        }));

        test('Ctrl+Alt+Q queues what is in the box and clears it', () => onChat({
            pairs: 4, settings: fast, prepare: (page) => {
                page.page.answerMs = 60000;
                page.host.querySelector('form').insertAdjacentHTML('beforeend', '<button type="button" data-testid="stop-button">Stop</button>');
                page.host.querySelector('#prompt-textarea').innerHTML = '<p>Then do the next part.</p>';
            },
        }, async ({ page }) => {
            const box = page.host.querySelector('#prompt-textarea');
            box.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
            await waitFor(() => queue() && queue().items.length === 1, 'the queued item');
            assertDeepEqual([queue().items[0].text, queue().items[0].conv], ['Then do the next part.', 'c1']);
            await waitFor(() => BB().Composer.isEmpty(box), 'the box to be cleared once the prompt was safely queued');
            assertDeepEqual(page.page.sent, [], 'it went while an answer was still streaming');
        }));
    });
})();
