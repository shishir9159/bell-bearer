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
 * That holds within one context only; another tab has a chain of its own. So
 * a step writes only the keys it changed: a store kept under several keys
 * used to write all of them back on every change, and with them whatever
 * another tab had just moved in a key this one never touched.
 */
(function (root) {
    'use strict';

    /** Each key's value as JSON, to tell afterwards which ones a step changed. */
    const snapshot = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));

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

        async function load() {
            try {
                return await read(await chrome.storage.local.get(keys));
            } catch (_) {
                // The extension reloading invalidates every content script's
                // context; an empty store draws, a rejection takes the page down.
                return blank();
            }
        }

        /** Run `step` after every step queued before it, whether that one landed or not. */
        function queue(step, onError) {
            chain = chain.then(step, step).catch(onError);
            return chain;
        }

        /**
         * Read, change and write back as one step; resolves to the new state.
         * `mutate` may change the state in place or return a new one, which
         * is why what was read is put down before it runs.
         */
        function update(mutate, ...context) {
            return queue(async () => {
                const state = await load();
                const before = snapshot(toStorage(state));
                const next = clean((await mutate(state)) || state, ...context);
                const values = toStorage(next);
                for (const key of Object.keys(values)) {
                    if (JSON.stringify(values[key]) === before[key]) delete values[key];
                }
                if (Object.keys(values).length) await chrome.storage.local.set(values);
                return next;
            }, (error) => {
                console.error(`Bell Bearer: could not update ${name}`, error);
                return failed();
            });
        }

        /** Write `state` as it is, in its turn — for clearing, and for importing. */
        function save(state) {
            return queue(() => chrome.storage.local.set(toStorage(state)), (error) => {
                console.error(`Bell Bearer: could not save ${name}`, error);
            });
        }

        return { keys, load, update, save, queue };
    }

    const Store = { create };

    root.BB = root.BB || {};
    root.BB.Store = Store;
    if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
