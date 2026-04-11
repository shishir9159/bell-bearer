/**
 * The chat surfaces on a claude.ai-shaped page, through Claude's adapter.
 * It differs from chat-stage.js's as claude.ai does: rows carry `data-index`
 * and nothing names a message, so a row is tied to the tree by its place and
 * words; a fork's arrows are drawn only on hover; and an answer's end comes
 * from the bridge's `bb:claude:stream` event, as there is no stop button.
 */
(function () {
    'use strict';

    const { BB, NO_WATCHER, HOST_ID, TURN_PX, settle, waitFor, teardown, onChat } = window.ChatStage;

    /**
     * claude.ai's two headers: a chat's, title on the left and Activity and
     * Share in the actions slot on the right; and /new's, whose slot holds
     * only the incognito button.
     */
    const CHAT_ACTIONS = `<div data-testid="wiggle-controls-actions" style="display:flex">
                <div id="session-activity-header-toggle"><button type="button" aria-label="Activity panel">A</button></div>
                <div data-testid="wiggle-controls-actions-group"><button type="button" data-testid="wiggle-controls-actions-share">Share</button></div>
            </div>`;
    const chatHeader = (actions = CHAT_ACTIONS) => `
        <div data-testid="chat-header" style="height:48px;display:flex;align-items:center">
            <div data-testid="session-title-split"><button type="button">A long chat</button></div>
            <div style="flex:1"></div>
            <div id="dframe-header-actions-slot" style="display:flex">${actions}</div>
        </div>`;
    const NEW_CHAT_HEADER = `
        <header style="height:48px"><div style="display:flex;align-items:center">
            <div style="flex:1"></div>
            <div id="dframe-header-actions-slot" style="display:flex"><button type="button" aria-label="Use incognito">I</button></div>
        </div></header>`;

    function stageClaude(conv, { header = chatHeader() } = {}) {
        teardown();
        const Tree = BB().ChatTree;
        const page = { leaf: conv.current, clicks: 0, sent: [], answerMs: 150 };
        const shown = () => Tree.pathTo(conv, page.leaf);
        const host = document.createElement('div');
        host.id = HOST_ID;
        host.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:520px;background:#fff;color:#000;z-index:1;';
        host.innerHTML = `
            ${header}
            <div data-autoscroll-container="true" style="position:relative;height:360px;overflow-y:auto">
                <div data-testid="transcript-list" style="position:relative"></div>
            </div>
            <fieldset>
                <button type="button" data-testid="input-menu-plus">+</button>
                <div class="ProseMirror" data-testid="chat-input" contenteditable="true"><p><br></p></div>
                <button type="button" aria-label="Send message">Send</button>
            </fieldset>`;
        document.body.appendChild(host);
        const scroller = host.querySelector('[data-autoscroll-container]');
        const list = host.querySelector('[data-testid="transcript-list"]');
        const composer = host.querySelector('[data-testid="chat-input"]');
        composer.addEventListener('paste', (event) => {
            event.preventDefault();
            if (!composer.textContent.trim()) composer.innerHTML = '';
            event.clipboardData.getData('text/plain').split('\n').forEach((line) => {
                const p = document.createElement('p');
                p.textContent = line;
                composer.appendChild(p);
            });
        });

        const mount = () => {
            const path = shown();
            list.style.height = `${path.length * TURN_PX}px`;
            const from = Math.floor(scroller.scrollTop / TURN_PX) - 2;
            const to = Math.ceil((scroller.scrollTop + scroller.clientHeight) / TURN_PX) + 2;
            list.innerHTML = path.map((id, index) => {
                if (index < from || index > to) return '';
                const turn = conv.nodes[id];
                const body = turn.text.split('\n').map((line) => {
                    const heading = /^## (.+)$/.exec(line);
                    return heading ? `<h2>${heading[1]}</h2>` : `<p>${line}</p>`;
                }).join('');
                const message = turn.role === 'user'
                    ? `<div data-testid="user-message">${body}</div>`
                    : `<div data-testid="assistant-message" data-is-streaming="false"><div class="font-claude-response">${body}</div></div>`;
                return `<div data-testid="transcript-row" data-index="${index}" data-perf-row="${turn.role === 'user' ? 'human' : 'assistant'}"
                             style="position:absolute;left:0;right:0;top:${index * TURN_PX}px;height:${TURN_PX - 20}px;overflow:hidden">${message}<div class="bb-test-arrows"></div></div>`;
            }).join('');
        };
        list.addEventListener('mouseover', (event) => {
            const row = event.target.closest('[data-testid="transcript-row"]');
            if (!row) return;
            const { index, count } = Tree.siblingIndex(conv, shown()[Number(row.dataset.index)]);
            if (count < 2) return;
            row.querySelector('.bb-test-arrows').innerHTML = `<button aria-label="Previous" data-test-step="-1">‹</button>
                <span>${index} / ${count}</span><button aria-label="Next" data-test-step="1">›</button>`;
        });
        list.addEventListener('click', (event) => {
            const button = event.target.closest('[data-test-step]');
            if (!button) return;
            const id = shown()[Number(button.closest('[data-index]').dataset.index)];
            const siblings = conv.nodes[conv.nodes[id].parent].children;
            const next = siblings[siblings.indexOf(id) + Number(button.dataset.testStep)];
            if (!next) return;
            page.clicks++;
            page.leaf = Tree.leafUnder(conv, next);
            setTimeout(mount, 30);
        });
        // Send: the box empties and the bridge says the answer started, then ended.
        host.querySelector('[aria-label="Send message"]').addEventListener('click', () => {
            if (!composer.textContent.trim()) return;
            page.sent.push(Array.from(composer.querySelectorAll('p'), (p) => p.textContent).join('\n'));
            composer.innerHTML = '<p><br></p>';
            const say = (phase) => document.dispatchEvent(new CustomEvent('bb:claude:stream', { detail: JSON.stringify({ phase, conv: 'c1' }) }));
            say('start');
            setTimeout(() => say('end'), page.answerMs);
        });
        let seen = -1;
        const poll = setInterval(() => {
            if (!host.isConnected) { clearInterval(poll); return; }
            if (scroller.scrollTop !== seen) { seen = scroller.scrollTop; mount(); }
        }, 20);
        mount();
        return { host, scroller, mount, page, get path() { return shown(); } };
    }

    function makeClaudeUi(conv, { settings = {} } = {}) {
        const values = Object.assign({}, BB().Settings.DEFAULTS, settings);
        const adapter = Object.assign({}, BB().ClaudeRead.adapter, {
            convIdOf: () => 'c1', isNewChat: () => false, onChatPage: () => true, fetchConversation: async () => conv,
        });
        const ui = BB().ChatUi.createChatUi({ adapter, watcher: NO_WATCHER, notify() {}, getSettings: () => values });
        return { ui, adapter, values, restore: () => { ui.uninstall(); teardown(); } };
    }

    /** onChat on claude.ai: Claude's site, page and adapter. */
    const onClaude = ({ header, ...options }, run) => onChat({
        pairs: 4, site: 'claude', stage: (conv) => stageClaude(conv, { header }), make: makeClaudeUi, ...options,
    }, run);
    const atTop = (page, index) => {
        const row = page.host.querySelector(`[data-index="${index}"]`);
        return row && Math.abs(row.getBoundingClientRect().top - page.scroller.getBoundingClientRect().top) < 80;
    };
    const say = (limit) => document.dispatchEvent(new CustomEvent('bb:claude:limit', { detail: JSON.stringify(limit) }));
    const holds = () => window.MockChrome.state.localStore.bbPromptQueue;

    suite('chat — on claude.ai', () => {
        test('the toggle goes first among the actions on the right, before Activity and Share', () => onClaude({}, ({ ui, page }) => {
            ui.injectToggle();
            const toggle = document.getElementById('bb-chat-toggle');
            assert(toggle && page.host.querySelector('[data-testid="wiggle-controls-actions"]').firstElementChild === toggle,
                'the toggle is not first among the actions');
            const title = page.host.querySelector('[data-testid="session-title-split"]');
            assert(toggle.getBoundingClientRect().left > title.getBoundingClientRect().right, 'the toggle is not right of the title');
            toggle.click();
            assert(document.getElementById('bb-chat-panel'), 'the panel did not open');
            toggle.click();
            assert(!document.getElementById('bb-chat-panel'), 'a second press did not close it');
        }));

        test('a toggle placed before a chat’s actions were drawn moves in among them', () => onClaude({ header: chatHeader('') }, ({ ui, page }) => {
            ui.injectToggle();
            const slot = page.host.querySelector('#dframe-header-actions-slot');
            const toggle = document.getElementById('bb-chat-toggle');
            assert(toggle && toggle.parentElement === slot, 'the toggle did not wait in the actions slot');
            assert(page.host.querySelector('[data-testid="chat-header"]').firstElementChild !== toggle, 'the toggle went to the header’s left edge');
            slot.insertAdjacentHTML('beforeend', CHAT_ACTIONS);
            ui.injectToggle();
            assert(document.getElementById('bb-chat-toggle') === toggle, 'the toggle was drawn again rather than moved');
            assert(slot.querySelector('[data-testid="wiggle-controls-actions"]').firstElementChild === toggle,
                'the toggle stayed where the header first offered');
        }));

        test('on /new the toggle sits beside the incognito button, and a header with no actions gets none', () => onClaude({ header: NEW_CHAT_HEADER }, ({ ui, page }) => {
            ui.injectToggle();
            const toggle = document.getElementById('bb-chat-toggle');
            assert(toggle && toggle.nextElementSibling === page.host.querySelector('[aria-label="Use incognito"]'),
                'the toggle is not beside the incognito button');
            toggle.remove();
            page.host.querySelector('#dframe-header-actions-slot').remove();
            ui.injectToggle();
            assert(!document.getElementById('bb-chat-toggle'), 'a header with no actions was given the toggle at its edge');
        }));

        test('the outline reaches a Claude turn the page has not mounted, by its place and its words', () => onClaude({ pairs: 20 }, async ({ ui, page }) => {
            await waitFor(() => ui.conversation(), 'the conversation');
            assert(!page.host.querySelector('[data-index="30"]'), 'turn 31 should start unmounted');
            assert(await ui.goTo('u16'), 'reach said it could not');
            await waitFor(() => atTop(page, 30), 'prompt 16 at the top', 4000);
        }));

        test('a row whose words disagree with the tree is no turn at all, and is never marked', () => onClaude({
            store: { bbChatPins: { 'claude:c1': { title: '', url: '', updatedAt: 1, pins: [{ node: 'a1', label: '', excerpt: '', at: 1 }] } } },
            prepare: (page) => { page.host.querySelector('[data-index="1"] .font-claude-response').textContent = 'Something else entirely'; },
        }, async ({ ui, adapter, page, conv }) => {
            await waitFor(() => ui.conversation(), 'the conversation');
            assertDeepEqual(adapter.turnIds(page.host.querySelector('[data-index="1"]'), conv), []);
            assertDeepEqual(adapter.turnIds(page.host.querySelector('[data-index="2"]'), conv), ['u2']);
            await settle(50);
            assert(!page.host.querySelector('[data-bb-chat-pinned]'), 'a pin mark went on a row the tree could not vouch for');
        }));

        test('switching branch hovers the fork to draw its arrows, then clicks them', () => onClaude({ pairs: 12, current: 'a2x' }, async ({ ui, page }) => {
            await waitFor(() => ui.conversation(), 'the conversation');
            assert(await ui.goTo('a4x'), 'the switch said it could not');
            assert(page.path.includes('a4x'), 'the page is not showing the edited prompt’s answer');
            assertEqual(page.page.clicks, 2, 'one click at each fork');
        }));

        test('an exceeded limit off the stream holds the queue until a minute past its reset, and names the wait', () => onClaude({ install: false }, async ({ ui, adapter }) => {
            const resetsAt = Date.now() + 2 * 3600 * 1000;
            adapter.usage = async () => ({ session: { utilization: 100, resetsAt }, weekly: { utilization: 40, resetsAt: resetsAt + 5 * 864e5 } });
            try {
                ui.install();
                say({ type: 'exceeded_limit', resetsAt, remaining: 0 });
                ui.limitNow();
                await waitFor(holds, 'the hold');
                assertEqual(holds().holds.claude.until, resetsAt + 60000);
                await waitFor(() => /5-hour session resets at/.test(document.getElementById('bb-chat-limit').textContent), 'the window named');
            } finally {
                say({ type: 'within_limit', resetsAt: null, remaining: null });
            }
        }));

        test('nearly out, the chip offers to hold the rest of the queue', () => onClaude({}, async ({ ui }) => {
            const resetsAt = Date.now() + 3600 * 1000;
            try {
                say({ type: 'approaching_limit', resetsAt, remaining: 2 });
                ui.limitNow();
                const chip = document.getElementById('bb-chat-limit');
                assert(chip && /2 messages left until/.test(chip.textContent), chip && chip.textContent);
                assert(!chip.querySelector('[data-bb-limit="later"]'), 'nothing is falling back, so there is nothing to queue for later');
                chip.querySelector('[data-bb-limit="hold"]').click();
                await waitFor(holds, 'the hold');
                assertEqual(holds().holds.claude.until, resetsAt + 60000);
            } finally {
                say({ type: 'within_limit', resetsAt: null, remaining: null });
            }
        }));

        test('a queued prompt waits for the bridge’s end, where there is no stop button to watch', () => {
            const item = (id, text) => ({ id, site: 'claude', conv: 'c1', chain: 'pc_c', text, model: '',
                notBefore: 0, status: 'waiting', note: '', createdAt: 1, sentAt: 0 });
            return onClaude({
                store: { bbPromptQueue: { items: [item('c1q', 'First'), item('c2q', 'Second')] } },
                settings: { claudeQueueGapSeconds: 1 },
                prepare: (page) => { page.page.answerMs = 1500; },
            }, async ({ page }) => {
                await waitFor(() => page.page.sent.length === 1, 'the first prompt sent', 6000);
                await settle(700);
                assertDeepEqual(page.page.sent, ['First'], 'the second went while the bridge said the answer was still going');
                await waitFor(() => page.page.sent.length === 2, 'the second, after the bridge said the first ended', 8000);
            });
        });
    });
})();
