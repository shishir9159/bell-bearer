/**
 * Typing into a chat site's composer, the prompt picker, and the queue:
 * prompts sent one after another through the page's own send button, the
 * strip above the composer, and holding on a limit. The page is
 * tests/chat-stage.js, whose composer takes a paste the way ProseMirror does
 * and whose send button "streams" an answer behind a stop button.
 *
 * Wrapped, because this file shares the global scope with the other specs.
 */
(function () {
    'use strict';

    const { BB, TURN_PX, settle, waitFor, conversation, stagePage, teardown, makeUi } = window.ChatStage;

    // ---------------------------------------------------------- composer

    suite('chat — typing into the composer', () => {
        /** A box that handles a paste the way ProseMirror does: a paragraph per line. */
        function proseMirror() {
            const box = document.createElement('div');
            box.contentEditable = 'true';
            box.className = 'ProseMirror';
            box.addEventListener('paste', (event) => {
                event.preventDefault();
                const lines = event.clipboardData.getData('text/plain').split('\n');
                if (box.textContent.trim() === '') box.innerHTML = '';
                lines.forEach((line) => {
                    const p = document.createElement('p');
                    p.textContent = line;
                    box.appendChild(p);
                });
            });
            document.body.appendChild(box);
            return box;
        }

        test('a paste lands as paragraphs, after what was already there', async () => {
            const box = proseMirror();
            try {
                box.innerHTML = '<p>Already here</p>';
                assert(await BB().Composer.insert(box, 'First line\nSecond line'), 'it did not land');
                assertDeepEqual(Array.from(box.querySelectorAll('p'), (p) => p.textContent), ['Already here', 'First line', 'Second line']);
                assert(!BB().Composer.isEmpty(box));
                BB().Composer.clear(box);
                assert(BB().Composer.isEmpty(box), 'clear left text behind');
            } finally { box.remove(); }
        });

        test('a box that ignores the paste is typed into instead', async () => {
            const box = document.createElement('div');
            box.contentEditable = 'true';
            document.body.appendChild(box);
            try {
                assert(await BB().Composer.insert(box, 'typed in\nand on'), 'the fallback did not land either');
                assert(BB().Composer.read(box).replace(/\s+/g, ' ').includes('typed in and on'));
            } finally { box.remove(); }
        });

        test('a textarea gets the value and an input event, the way React listens', async () => {
            const box = document.createElement('textarea');
            document.body.appendChild(box);
            let heard = 0;
            box.addEventListener('input', () => heard++);
            try {
                assert(await BB().Composer.insert(box, 'hello'));
                assertEqual(box.value, 'hello');
                assertEqual(heard, 1);
            } finally { box.remove(); }
        });

        test('text that lands nowhere goes on the clipboard, and says so', async () => {
            const box = document.createElement('div');
            document.body.appendChild(box);
            const copied = [];
            try {
                const landed = await BB().Composer.insert(box, 'lost', { copy: async (text) => { copied.push(text); return true; } });
                assertEqual(landed, false);
                assertDeepEqual(copied, ['lost']);
            } finally { box.remove(); }
        });

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

    // ------------------------------------------------------------ picker

    suite('chat — the prompt picker', () => {
        const templates = [
            { id: 't1', name: 'Code review', body: 'Review this:\n\n{{code}}\n\nAbout {{selection}}.' },
            { id: 't2', name: 'Plain one', body: 'Just this.' },
        ];

        test('Ctrl+Alt+I, a filter, a field and Ctrl+Enter put the filled prompt in the box', async () => {
            window.MockChrome.reset({ localStore: { bbPromptTemplates: templates } });
            const conv = conversation(4);
            const page = stagePage(conv);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                const box = page.host.querySelector('#prompt-textarea');
                // Something selected on the page is what {{selection}} means.
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
                assertDeepEqual(Array.from(box.querySelectorAll('p'), (p) => p.textContent),
                    ['Review this:', '', 'x = 1', '', 'About Answer number 1..']);
                assert(!document.getElementById('bb-chat-picker'), 'the picker stayed open');
                assert(page.host.querySelector('[data-testid="send-button"]'), 'the page did not see the text');
                await waitFor(() => window.MockChrome.state.localStore.bbPromptTemplates.find((t) => t.id === 't1').uses === 1, 'the use counted');
            } finally { restore(); }
        });

        test('what is in the box can be saved as a template, named by the filter', async () => {
            window.MockChrome.reset({ localStore: { bbPromptTemplates: templates } });
            const conv = conversation(4);
            const page = stagePage(conv);
            const { ui, restore } = makeUi(conv);
            try {
                ui.install();
                page.host.querySelector('#prompt-textarea').innerHTML = '<p>Explain it to me like a colleague.</p>';
                ui.onHotkey(new KeyboardEvent('keydown', { code: 'KeyI', key: 'i', ctrlKey: true, altKey: true, cancelable: true }));
                const picker = document.getElementById('bb-chat-picker');
                await waitFor(() => picker.querySelector('.is-save'), 'the save row');
                picker.querySelector('.bb-chat-picker-q').value = 'Colleague';
                picker.querySelector('.is-save').click();
                await waitFor(() => window.MockChrome.state.localStore.bbPromptTemplates.length === 3, 'the new template');
                const made = window.MockChrome.state.localStore.bbPromptTemplates[2];
                assertEqual(made.name, 'Colleague');
                assertEqual(made.body, 'Explain it to me like a colleague.');
                assertDeepEqual(made.sites, ['chatgpt']);
            } finally { restore(); }
        });
    });

})();
