/**
 * A chatgpt.com-shaped page for the chat specs, and the helpers every one of
 * them uses — shared by tests/chat.test.js and tests/chat-queue.test.js.
 *
 * The page is built to chatgpt.com's markup as it was read off the live site:
 * <section data-turn> turns carrying data-message-id, a thread that scrolls
 * inside [data-scroll-root], a ProseMirror composer that turns a paste into
 * paragraphs, a send button that is only there while the box has text. It is
 * virtualised on purpose — only the turns near the viewport are in the
 * document, the way claude.ai's are and ChatGPT's are starting to be — and a
 * turn under a fork carries the site's `< k/n >`, whose arrows really do swap
 * the branch shown. The conversation itself comes from a stub fetch, so
 * nothing here talks to a network.
 */
(function () {
    'use strict';

    const BB = () => window.BB;
    const NO_WATCHER = { add() {}, remove() {}, has: () => false, schedule() {}, stop() {} };
    const HOST_ID = 'bb-chat-test';
    const TURN_PX = 220;

    const settle = (ms = 0) => new Promise((done) => setTimeout(done, ms));

    /**
     * Wait until `predicate` holds. The limit stretches in a hidden tab, as
     * the harness's own does: the mock defers every chrome.* callback through
     * a timer, and a hidden tab runs those a second apart at best, so a queue
     * that sends three prompts through a dozen storage writes legitimately
     * needs minutes there and seconds on screen.
     */
    async function waitFor(predicate, what, ms = 3000) {
        ms *= document.hidden ? 20 : 1;
        const started = Date.now();
        for (;;) {
            let held = false;
            try { held = !!(await predicate()); } catch (_) { held = false; }
            if (held) return;
            if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
            await settle(10);
        }
    }

    /**
     * A conversation of `pairs` prompts and answers. Every third answer has
     * two headings. It is a tree twice over: the answer to prompt 2 was
     * regenerated (a2, a2x), and prompt 4 was edited (u4, u4x) — the page
     * shows the first of each.
     */
    function conversation(pairs = 12) {
        const nodes = { root: { role: 'root', parent: null, children: ['u1'] } };
        let parent = 'root';
        for (let i = 1; i <= pairs; i++) {
            const u = `u${i}`;
            const a = `a${i}`;
            nodes[parent].children = nodes[parent].children.includes(u) ? nodes[parent].children : [...nodes[parent].children, u];
            nodes[u] = { role: 'user', parent, children: [a], text: `Prompt number ${i}`, at: i * 10 };
            const text = i % 3 === 0 ? `## Part ${i}A\nBody.\n\n## Part ${i}B\nMore.` : `Answer number ${i}.`;
            nodes[a] = { role: 'assistant', parent: u, children: [], text, at: i * 10 + 1, ids: [a, `${a}-final`] };
            parent = a;
        }
        nodes.u2.children = ['a2', 'a2x'];
        nodes.a2x = { role: 'assistant', parent: 'u2', children: [], text: 'The regenerated answer.', at: 1 };
        if (pairs >= 4) {
            nodes.a3.children = ['u4', 'u4x'];
            nodes.u4x = { role: 'user', parent: 'a3', children: ['a4x'], text: 'The edited prompt', at: 2 };
            nodes.a4x = { role: 'assistant', parent: 'u4x', children: [], text: 'The answer to the edit.', at: 3 };
        }
        return BB().ChatTree.build({
            site: 'chatgpt', id: 'c1', title: 'A long chat', root: 'root', current: `a${pairs}`, nodes,
        });
    }

    /**
     * A chatgpt.com-shaped page for `conv`, mounting only the turns within a
     * screen of the viewport, as a virtualised thread does. A turn under a
     * fork carries the site's `< k/n >`, and its arrows really do swap the
     * branch the page shows — to the newest leaf under the sibling, which is
     * what the sites do.
     */
    function stagePage(conv) {
        teardown();
        const Tree = BB().ChatTree;
        const page = { leaf: conv.current, clicks: 0, sent: [], answerMs: 150, answering: 0 };
        const shown = () => Tree.pathTo(conv, page.leaf);

        const host = document.createElement('div');
        host.id = HOST_ID;
        host.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:520px;background:#fff;color:#000;z-index:1;';
        host.innerHTML = `
            <header id="page-header" style="height:48px">
                <div id="conversation-header-actions"><button data-testid="share-chat-button">Share</button></div>
            </header>
            <div data-scroll-root style="position:relative;height:360px;overflow-y:auto">
                <div class="bb-test-thread" style="position:relative"></div>
            </div>
            <form data-type="unified-composer">
                <button type="button" data-testid="composer-plus-btn">+</button>
                <div id="prompt-textarea" class="ProseMirror" contenteditable="true"><p><br></p></div>
            </form>`;
        document.body.appendChild(host);

        const scroller = host.querySelector('[data-scroll-root]');
        const thread = host.querySelector('.bb-test-thread');
        // ProseMirror as chatgpt.com's behaves: a paste becomes a paragraph
        // per line, and the send button is only there while there is text.
        const composer = host.querySelector('#prompt-textarea');
        const form = host.querySelector('form');
        const syncSend = () => {
            const has = !!composer.textContent.trim();
            const button = form.querySelector('[data-testid="send-button"]');
            if (has && !button) form.insertAdjacentHTML('beforeend', '<button type="button" data-testid="send-button">Send</button>');
            if (!has && button) button.remove();
        };
        composer.addEventListener('paste', (event) => {
            event.preventDefault();
            if (!composer.textContent.trim()) composer.innerHTML = '';
            event.clipboardData.getData('text/plain').split('\n').forEach((line) => {
                const p = document.createElement('p');
                p.textContent = line;
                composer.appendChild(p);
            });
            syncSend();
        });
        composer.addEventListener('input', syncSend);
        // Send: the prompt leaves the box, and an answer "streams" behind a
        // stop button for `page.answerMs`. The stop button ends it early.
        const endAnswer = () => {
            clearTimeout(page.answering);
            const stop = form.querySelector('[data-testid="stop-button"]');
            if (stop) stop.remove();
        };
        form.addEventListener('click', (event) => {
            if (event.target.closest('[data-testid="stop-button"]')) { endAnswer(); return; }
            if (!event.target.closest('[data-testid="send-button"]')) return;
            page.sent.push(Array.from(composer.querySelectorAll('p'), (p) => p.textContent).join('\n'));
            composer.innerHTML = '<p><br></p>';
            syncSend();
            form.insertAdjacentHTML('beforeend', '<button type="button" data-testid="stop-button">Stop</button>');
            page.answering = setTimeout(endAnswer, page.answerMs);
        });
        const arrows = (id) => {
            const { index, count } = Tree.siblingIndex(conv, id);
            if (count < 2) return '';
            return `<div class="bb-test-nav"><button aria-label="Previous response" data-test-step="-1">‹</button>
                    <div class="tabular-nums">${index}/${count}</div>
                    <button aria-label="Next response" data-test-step="1">›</button></div>`;
        };
        const mount = () => {
            const path = shown();
            thread.style.height = `${path.length * TURN_PX}px`;
            const from = Math.floor(scroller.scrollTop / TURN_PX) - 2;
            const to = Math.ceil((scroller.scrollTop + scroller.clientHeight) / TURN_PX) + 2;
            thread.innerHTML = path.map((id, index) => {
                if (index < from || index > to) return '';
                const turn = conv.nodes[id];
                const raw = turn.ids[turn.ids.length - 1];
                const body = turn.text.split('\n').map((line) => {
                    const heading = /^## (.+)$/.exec(line);
                    return heading ? `<h2>${heading[1]}</h2>` : `<p>${line}</p>`;
                }).join('');
                return `<section data-testid="conversation-turn-${index + 1}" data-turn="${turn.role}" data-turn-id="${turn.ids[0]}"
                                 style="position:absolute;left:0;right:0;top:${index * TURN_PX}px;height:${TURN_PX - 20}px;overflow:hidden">
                            <div data-message-id="${raw}" data-message-author-role="${turn.role}">${body}</div>${arrows(id)}
                        </section>`;
            }).join('');
        };
        thread.addEventListener('click', (event) => {
            const button = event.target.closest('[data-test-step]');
            if (!button) return;
            const id = button.closest('section').dataset.turnId;
            const siblings = conv.nodes[conv.nodes[id].parent].children;
            const next = siblings[siblings.indexOf(id) + Number(button.dataset.testStep)];
            if (!next) return;
            page.clicks++;
            page.leaf = Tree.leafUnder(conv, next);
            // The site re-renders after its own request comes back, not on
            // the click — so the old element is still there for a moment.
            setTimeout(mount, 30);
        });
        // A scroll event is dispatched as part of rendering, and a hidden tab
        // does not render — so a virtualiser that only listened for it would
        // never mount anything while the suite runs behind another window.
        // The page is also polled, which a real one would not need.
        let seen = -1;
        const poll = setInterval(() => {
            if (!host.isConnected) { clearInterval(poll); return; }
            if (scroller.scrollTop !== seen) { seen = scroller.scrollTop; mount(); }
        }, 20);
        scroller.addEventListener('scroll', mount);
        mount();
        return { host, scroller, thread, mount, page, get path() { return shown(); } };
    }

    function teardown() {
        [HOST_ID, 'bb-chat-panel', 'bb-chat-scrim', 'bb-chat-toggle', 'bb-chat-pulse'].forEach((id) => {
            const element = document.getElementById(id);
            if (element) element.remove();
        });
    }

    /** The real chatgpt.com adapter, with the network and the address bar stubbed. */
    function makeUi(conv, { settings = {}, convId = 'c1' } = {}) {
        const values = Object.assign({}, BB().Settings.DEFAULTS, settings);
        const notes = [];
        const adapter = Object.assign({}, BB().ChatgptRead.adapter, {
            convIdOf: () => convId,
            isNewChat: () => !convId,
            fetchConversation: async () => conv,
        });
        const ui = BB().ChatUi.createChatUi({
            adapter,
            watcher: NO_WATCHER,
            notify: (message, type) => notes.push({ message, type }),
            getSettings: () => values,
        });
        return { ui, adapter, notes, values, restore: () => { ui.uninstall(); teardown(); } };
    }

    window.ChatStage = { BB, NO_WATCHER, HOST_ID, TURN_PX, settle, waitFor, conversation, stagePage, teardown, makeUi };
})();
