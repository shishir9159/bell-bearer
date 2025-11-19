/**
 * The queue runner: sends a chat's queued prompts one at a time, through the
 * page's own composer and send button.
 *
 * It sends only when all of these hold — nothing is streaming, the composer
 * is empty (someone typing wins), the site is not on hold, the chat is not
 * paused, and this page holds the chat's lease. Then:
 *
 *   1. type the prompt in and press send; the item is 'sending'
 *   2. wait for the answer to start — the stop button, or the box emptying
 *      as the prompt turn appears. Nothing in fifteen seconds is a failure
 *   3. wait for it to end, then the site's gap setting; the item is 'sent'
 *   4. the next one
 *
 * It stops at the first thing it does not understand, the roster's rule
 * (src/content/roster.js): no composer, a send button that never enables, the
 * sign-in page, an item a closed tab left half-sent. It never presses
 * Regenerate or Continue. And if you press the site's own stop in the middle
 * of an answer, the chat's queue pauses rather than carrying on — you just
 * intervened, and the next prompt was probably written for the answer you
 * cut off.
 *
 * **Why this has no DomWatch task.** DomWatch batches on requestAnimationFrame,
 * and a background tab runs no animation frames — which is exactly where a
 * scheduled prompt is sent. The runner waits on a MutationObserver of its own,
 * which a background tab still delivers, backed by timeouts. Do not move it
 * onto the watcher for tidiness.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const ChatSites = ns.ChatSites || req('../shared/chat-sites.js');
    const PromptQueue = ns.PromptQueue || req('../shared/prompt-queue.js');
    const Composer = ns.Composer || req('./composer.js');

    const START_MS = 15000;
    /** The longest an answer is waited for. A reasoning model can think for a long while. */
    const ANSWER_MS = 20 * 60 * 1000;
    const RENEW_MS = 45000;

    /**
     * Resolve with `check()` once it is truthy, or null after `ms`. Watched by
     * a MutationObserver — delivered in a background tab, unlike animation
     * frames — and polled as a backstop for changes no mutation announces.
     */
    function waitFor(check, ms, { every = 500 } = {}) {
        return new Promise((resolve) => {
            const first = check();
            if (first) { resolve(first); return; }
            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                observer.disconnect();
                clearTimeout(timeout);
                clearInterval(poll);
                resolve(value);
            };
            const look = () => { const value = check(); if (value) finish(value); };
            const observer = new MutationObserver(look);
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
            const poll = setInterval(look, every);
            const timeout = setTimeout(() => finish(null), ms);
        });
    }

    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

    /**
     * @param {object} deps
     * @param {object} deps.adapter   the site's
     * @param {string} deps.pageId    this page, for the lease
     * @param {() => object} deps.getSettings
     */
    function createRunner({ adapter, pageId, notify, getSettings, now = () => Date.now(), timings = {}, trusted = (event) => event.isTrusted }) {
        const site = adapter.site;
        const startMs = timings.startMs || START_MS;
        let busy = false;
        let again = false;
        let userStopped = false;

        const gapMs = () => {
            const seconds = Number(getSettings()[ChatSites.siteKey(site, 'queueGap')]);
            return Math.max(1, Number.isFinite(seconds) ? seconds : 3) * 1000;
        };

        /**
         * A press of the site's own stop button while we are waiting on an
         * answer. Trusted events only: our own clicks are not the reader
         * changing their mind.
         */
        function onClick(event) {
            if (!trusted(event)) return;
            const stop = adapter.stopButton();
            if (stop && (event.target === stop || stop.contains(event.target))) userStopped = true;
        }

        const write = (mutate) => PromptQueue.update(mutate);

        async function fail(item, key, note) {
            await write((state) => PromptQueue.release(
                PromptQueue.pause(PromptQueue.patch(state, item.id, { status: 'failed', note, sentAt: now() }), key), key, pageId));
            notify(`Queue paused: ${note}`, 'warning');
            return false;
        }

        /** Send the next item, if there is one to send here and now. Resolves true if it sent one. */
        async function once() {
            if (!running || !adapter.onChatPage()) return false;
            const conv = adapter.convIdOf();
            if (!conv && !adapter.isNewChat()) return false;

            let state = await PromptQueue.load();
            if (!running) return false;
            const stale = PromptQueue.holdStale(state, now());
            if (JSON.stringify(stale.items) !== JSON.stringify(state.items)) state = await write((s) => PromptQueue.holdStale(s, now()));

            // A prompt a closed tab left half-sent: it may or may not have
            // gone. That is not something to guess about, so the chat stops.
            for (const item of PromptQueue.itemsFor(state, site, conv)) {
                const key = PromptQueue.keyOf(item);
                if (item.status === 'sending' && PromptQueue.canClaim(state, key, pageId, now()) && !busyWith(item)) {
                    return fail(item, key, 'a page closed while this was being sent — check the chat, then resume');
                }
            }

            const item = PromptQueue.next(state, site, conv, now());
            if (!item) return false;
            const key = PromptQueue.keyOf(item);
            if (!PromptQueue.canClaim(state, key, pageId, now())) return false;
            if (adapter.signedOut()) return fail(item, key, 'the site is asking you to sign in');
            if (adapter.isStreaming()) return false;
            const box = adapter.composer();
            if (!box) return fail(item, key, 'there is no prompt box on this page');
            if (!Composer.isEmpty(box)) return false;

            current = item.id;
            await write((s) => PromptQueue.patch(PromptQueue.claim(s, key, pageId, now()), item.id, { status: 'sending', note: '' }));
            const renew = setInterval(() => write((s) => PromptQueue.claim(s, key, pageId, now())), RENEW_MS);
            try {
                if (!(await Composer.insert(box, item.text, { copy: async () => false }))) return fail(item, key, 'the prompt box would not take the text');
                const send = await waitFor(() => {
                    const button = adapter.sendButton();
                    return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
                }, 5000, { every: 100 });
                if (!send || !Composer.submit(send)) return fail(item, key, 'the send button never became available');

                const turns = adapter.turnElements().length;
                const started = await waitFor(() => adapter.isStreaming() ||
                    (Composer.isEmpty(adapter.composer()) && adapter.turnElements().length > turns), startMs, { every: 200 });
                if (!started) return fail(item, key, 'nothing started within fifteen seconds of sending');

                // A new chat gets its id once the first answer starts; the
                // rest of the chain follows it there.
                if (!item.conv) {
                    const id = await waitFor(() => adapter.convIdOf(), 10000);
                    if (id) await write((s) => PromptQueue.bind(s, item.chain, id));
                }

                userStopped = false;
                const ended = await waitFor(() => !adapter.isStreaming(), ANSWER_MS);
                if (!ended) return fail(item, key, 'the answer did not finish');
                await sleep(gapMs());

                const stopped = userStopped;
                // A limit reached by this very prompt. The page's own watcher
                // would hold the queue too, but it runs on animation frames
                // and this may be a background tab, which has none.
                const notice = adapter.limitNotice && adapter.limitNotice();
                const limit = notice ? ChatSites.readLimit(site, notice, now()) : null;
                const blocked = !!(limit && limit.blocked);
                await write((s) => {
                    let out = PromptQueue.patch(s, item.id, { status: 'sent', sentAt: now() });
                    if (stopped) out = PromptQueue.pause(out, PromptQueue.keyOf({ ...item, conv: adapter.convIdOf() || item.conv }));
                    if (blocked) out = PromptQueue.hold(out, site, (limit.until || now() + 15 * 60000) + 60000, 'usage limit');
                    return PromptQueue.release(out, key, pageId);
                });
                if (stopped) notify('Queue paused — you stopped that answer. Resume it from the queue when you are ready.', 'info');
                if (blocked) notify('A usage limit was reached — the queue waits for it to reset', 'warning');
                return !stopped && !blocked;
            } finally {
                clearInterval(renew);
                current = null;
            }
        }

        /** The item this page is in the middle of sending, if any. */
        let current = null;
        const busyWith = (item) => current === item.id;

        /**
         * Run until there is nothing left to send here. Called on every cue —
         * a queue change, a navigation, the worker's wake — and safe to call
         * as often as that: a call while sending just asks for another pass.
         */
        async function tick() {
            if (!running) return;
            if (busy) { again = true; return; }
            busy = true;
            try {
                do {
                    again = false;
                    while (running && await once()) { /* the next one */ }
                } while (again && running);
            } catch (error) {
                console.error('Bell Bearer: the prompt queue stopped', error);
            } finally {
                busy = false;
            }
        }

        let unwatch = null;
        let fallback = 0;
        /**
         * Stopped means stopped: a pass already under way finishes the item
         * it is sending and then does not go on to the next one. Without
         * this a runner torn down mid-queue kept sending — which a spec
         * building a fresh page per test found, fighting its successor for
         * the composer.
         */
        let running = false;

        function start() {
            running = true;
            document.addEventListener('click', onClick, true);
            unwatch = ns.Settings ? ns.Settings.watch([PromptQueue.KEY], () => tick()) : null;
            // A backstop for a cue that was missed; throttled to a minute in
            // a background tab, which is as often as it needs to be.
            fallback = setInterval(() => tick(), 30000);
            tick();
        }

        function stop() {
            running = false;
            document.removeEventListener('click', onClick, true);
            if (unwatch) unwatch();
            clearInterval(fallback);
        }

        return { start, stop, tick, once, isBusy: () => busy };
    }

    const ChatRunner = { createRunner, waitFor, START_MS, ANSWER_MS };

    root.BB = root.BB || {};
    root.BB.ChatRunner = ChatRunner;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatRunner;
})(typeof globalThis !== 'undefined' ? globalThis : this);
