/**
 * One store in chrome.storage.local: read with a fallback, and changed in
 * read-modify-write steps that run one at a time.
 *
 * Every store used to carry this by hand — its own chain, its own catch, its
 * own copy of the comment saying why. The why: every writer used to do
 * read-modify-write with no coordination, so a checkpoint saved while the
 * dashboard was also saving lost whichever write finished first. Chaining
 * each step onto the last keeps them atomic with respect to each other.
 *
 * A chain holds within one context only; another tab has a chain of its own,
 * and two tabs adding a checkpoint at once still lost one of them. So a step
 * also holds a lock on its keys, kept by the worker for every page of the
 * extension (src/background/store-locks.js) and asked for over a port, which
 * lets go of it by itself when the page holding it goes away. Where no worker
 * answers — the extension reloaded under the page — the step goes ahead
 * without one, as it always did.
 *
 * And a step writes only the keys it changed: a store kept under several
 * keys used to write all of them back on every change, and with them whatever
 * another tab had just moved in a key this one never touched.
 */
(function (root) {
    'use strict';

    /** The port a page asks the worker for a lock on. */
    const LOCK_PORT = 'bb:store-lock';
    /**
     * How long a lock is waited for before the step goes ahead without one.
     * A worker that never answers — one from before the lock existed, still
     * running a moment after an update — must not hang every write a page makes.
     */
    const LOCK_WAIT_MS = 5000;

    /**
     * A lock on `names` across the extension; resolves to the function that
     * lets go of it. The worker holds the locks themselves, and is asked
     * directly from inside it; anywhere else, over a port.
     */
    function acquire(names) {
        const here = root.BB && root.BB.StoreLocks && root.BB.StoreLocks.here;
        if (here) return here.acquire(names);
        let port;
        try {
            if (!chrome.runtime || !chrome.runtime.id || typeof chrome.runtime.connect !== 'function') return Promise.resolve(() => {});
            port = chrome.runtime.connect({ name: LOCK_PORT });
        } catch (_) {
            return Promise.resolve(() => {});
        }
        return new Promise((resolve) => {
            let done = false;
            const release = () => {
                try { port.disconnect(); } catch (_) { /* already gone */ }
            };
            const go = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(release);
            };
            const timer = setTimeout(go, LOCK_WAIT_MS);
            port.onMessage.addListener((msg) => { if (msg && msg.granted) go(); });
            // The worker went away before answering: nobody holds anything now.
            port.onDisconnect.addListener(() => {
                try { void chrome.runtime.lastError; } catch (_) { /* context gone */ }
                go();
            });
            try { port.postMessage({ names }); } catch (_) { go(); }
        });
    }

    /** Run `fn` holding a lock on `names` — for a writer that is not a store. */
    async function lock(names, fn) {
        const release = await acquire(names);
        try {
            return await fn();
        } finally {
            release();
        }
    }

    /** Each key's value as JSON, to tell afterwards which ones a step changed. */
    const snapshot = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));

    /**
     * Whether a failure is only the extension having gone from under this
     * script: reloaded or updated while the page stayed open. Every chrome.*
     * call throws from then on, and the store falls back as it does for any
     * failure — but it used to say so as an error, and a page left open
     * across a reload put one in the extension's error list every time its
     * clock banked a tick or its queue took a look, for as long as it stayed
     * open. Anything else is a real failure and is still reported.
     */
    function orphaned(error) {
        if (/extension context invalidated/i.test(String((error && error.message) || error))) return true;
        try {
            return !!chrome.runtime && !chrome.runtime.id;
        } catch (_) {
            return true;
        }
    }

    /**
     * @param {object} spec
     * @param {string[]} spec.keys     what is read
     * @param {Function} spec.read     the stored values → the state, or a promise of it
     * @param {Function} spec.blank    the state when storage cannot be read
     * @param {string}   spec.name     for the console: "could not update <name>"
     * @param {Function} [spec.write]  the state → the values to store; the one key's, by default
     * @param {Function} [spec.clean]  a changed state → what is written; given update()'s
     *                                 further arguments
     * @param {Function} [spec.failed] what a failed update resolves to; blank() by default
     */
    function create({ keys, read, blank, name, write, clean = (state) => state, failed = blank }) {
        const toStorage = write || ((state) => ({ [keys[0]]: state }));
        let chain = Promise.resolve();

        /** The state as stored; throws when storage does. */
        async function fresh() {
            return read(await chrome.storage.local.get(keys));
        }

        /**
         * Every load is a read of its own. Sharing one read among loads asked
         * for together was tried, and a load asked for on a change joined a
         * read sent before the change, and drew the old values for good.
         */
        async function load() {
            try {
                return await fresh();
            } catch (_) {
                // The extension reloading invalidates every content script's
                // context; an empty store draws, a rejection takes the page down.
                return blank();
            }
        }

        /**
         * Run `step` after every step queued before it, whether that one
         * landed or not, holding the lock on this store's keys while it runs.
         */
        function queue(step, onError) {
            const locked = () => lock(keys, step);
            chain = chain.then(locked, locked).catch(onError);
            return chain;
        }

        /**
         * Read, change and write back as one step; resolves to `{ ok, state }`
         * — the new state, or on a failure whatever `failed` gives. `mutate`
         * may change the state in place or return a new one, which is why
         * what was read is put down before it runs.
         *
         * Read with fresh(), never load(): a failed read used to come back as
         * blank(), and the step wrote that, changed, over everything stored —
         * one checkpoint added to an empty list, saved over all the others.
         *
         * `ok` is for whoever says "saved": update() alone resolves to a state
         * on a failure too, and a checkpoint that never reached storage was
         * announced as created — and its note let go of — all the same.
         */
        function commit(mutate, ...context) {
            return queue(async () => {
                const state = await fresh();
                const before = snapshot(toStorage(state));
                const next = clean((await mutate(state)) || state, ...context);
                const values = toStorage(next);
                for (const key of Object.keys(values)) {
                    if (JSON.stringify(values[key]) === before[key]) delete values[key];
                }
                if (Object.keys(values).length) await chrome.storage.local.set(values);
                return { ok: true, state: next };
            }, async (error) => {
                if (!orphaned(error)) console.error(`Bell Bearer: could not update ${name}`, error);
                return { ok: false, state: await failed(), error };
            });
        }

        /** commit(), for a caller that only draws what comes back. */
        const update = (mutate, ...context) => commit(mutate, ...context).then((result) => result.state);

        /** Write `state` as it is, in its turn — for clearing, and for importing. Resolves to whether it landed. */
        function save(state) {
            return queue(async () => {
                await chrome.storage.local.set(toStorage(state));
                return true;
            }, (error) => {
                if (!orphaned(error)) console.error(`Bell Bearer: could not save ${name}`, error);
                return false;
            });
        }

        return { keys, load, commit, update, save, queue };
    }

    const Store = { LOCK_PORT, LOCK_WAIT_MS, create, lock };

    root.BB = root.BB || {};
    root.BB.Store = Store;
    if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
