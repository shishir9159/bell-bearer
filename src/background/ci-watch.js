/**
 * The CI watch's worker half: which tab watches what, and the notification.
 *
 * The page does the reading — it has the run, live, and reading it there
 * costs nothing — and says when the run is over. What it cannot do is raise
 * a desktop notification, or outlive itself: a watched tab may be reloaded,
 * or discarded by the browser to save memory and loaded again when next
 * looked at. So the worker keeps the watches, by tab, and a page that loads
 * on a run its tab was watching picks the watch back up.
 *
 * A watch is a tab's until its run ends or the tab closes. The tab may wander
 * off to a job's log and come back; the watch waits for it rather than
 * ending behind the user's back.
 *
 * Kept in storage.session, because a watch is tied to a tab id and tab ids
 * do not outlive the browser. Listeners are registered at top level,
 * synchronously, because the worker is torn down and started again constantly.
 */
(function (root) {
    'use strict';

    const { Router } = root.BB;

    const KEY = 'bbCiWatches';
    /** A notification's id is this, the tab, and a stamp: a click needs nothing else to find its tab. */
    const PREFIX = 'bb-ci:';
    const ICON = 'icons/icon128.png';

    function createWorker(api) {
        // Firefox before 115 has no session area; the watches then last as
        // long as the browser's local storage does, and a dead tab's are
        // swept the first time anything is asked.
        const area = () => api.storage.session || api.storage.local;

        async function all() {
            try { return (await area().get(KEY))[KEY] || {}; } catch (_) { return {}; }
        }

        /** Read, change and write as one step; two tabs' messages arrive together. */
        let chain = Promise.resolve();
        function change(step) {
            const run = async () => {
                const watches = await all();
                const answer = step(watches);
                try { await area().set({ [KEY]: watches }); } catch (_) { /* the watch lives as long as this worker */ }
                return answer;
            };
            chain = chain.then(run, run);
            return chain;
        }

        const tabOf = (sender) => (sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null);

        /** The watch the sender's tab has on `key`, or null. */
        async function get(message, sender) {
            const tab = tabOf(sender);
            const watch = tab === null ? null : (await all())[tab];
            return watch && watch.key === message.key ? watch : null;
        }

        /**
         * A watched tab is kept from being discarded. Memory Saver unloads a
         * tab left alone for a while, and with it the page doing the reading,
         * so the watch could not end until the tab was looked at again. This
         * costs nothing while the tab sits there: nothing runs to keep it
         * awake, the browser just passes it over. True when this made it so,
         * and so is the one to undo it; a tab kept already is left as it was.
         */
        async function hold(tabId) {
            try {
                if ((await api.tabs.get(tabId)).autoDiscardable === false) return false;
                await api.tabs.update(tabId, { autoDiscardable: false });
                return true;
            } catch (_) {
                return false; // Firefox before 115, or the tab is gone
            }
        }

        async function release(watch, tabId) {
            if (!watch || !watch.held) return;
            try { await api.tabs.update(tabId, { autoDiscardable: true }); } catch (_) { /* closed since */ }
        }

        async function start(message, sender) {
            const tab = tabOf(sender);
            const watch = message && message.watch;
            if (tab === null || !watch || !watch.key) return { ok: false };
            const held = await hold(tab);
            return change((watches) => {
                // `known` are the failures on screen as it started, which do
                // not end it; a reload must not forget them and end it at once.
                const known = Array.isArray(watch.known) ? watch.known.slice(0, 100).map(String) : [];
                // A watch that replaces this tab's last one finds the tab
                // held already — by that one, which is the hold to undo.
                const keep = held || !!(watches[tab] && watches[tab].held);
                // `auto` is a watch started without a click, which gives up
                // quietly on a repo that runs no checks, after a reload too.
                watches[tab] = { key: String(watch.key), noun: String(watch.noun || 'Run'), label: String(watch.label || ''),
                    repo: String(watch.repo || ''), known, since: Date.now(), ...(watch.auto === true ? { auto: true } : {}),
                    ...(keep ? { held: true } : {}) };
                return { ok: true };
            });
        }

        /** This tab's watch on `key`, taken out of the store; null when it has none. */
        function take(tab, key) {
            return change((watches) => {
                const watch = tab !== null && watches[tab];
                if (!watch || watch.key !== key) return null;
                delete watches[tab];
                return watch;
            });
        }

        async function stop(message, sender) {
            const tab = tabOf(sender);
            const watch = await take(tab, message.key);
            await release(watch, tab);
            return { ok: !!watch };
        }

        /**
         * The run is over: forget the watch and say so. The page words the
         * notice (src/shared/ci-watch.js#message), since it is the one that
         * read the run; the worker only checks it is a watch it knows.
         */
        async function done(message, sender) {
            const tab = tabOf(sender);
            const watch = await take(tab, message.key);
            if (!watch) return { ok: false };
            await release(watch, tab);
            try {
                await api.notifications.create(`${PREFIX}${tab}:${Date.now()}`, {
                    type: 'basic',
                    iconUrl: api.runtime.getURL(ICON),
                    title: String(message.title || '').slice(0, 200),
                    message: String(message.message || '').slice(0, 500),
                });
            } catch (_) { /* notifications are off for the browser; the page has its own word */ }
            return { ok: true };
        }

        /** A click brings the watched tab forward, in its window. */
        async function clicked(id) {
            const match = new RegExp(`^${PREFIX}(\\d+):`).exec(String(id));
            if (!match) return false;
            try { await api.notifications.clear(id); } catch (_) { /* gone already */ }
            try {
                const tab = await api.tabs.get(Number(match[1]));
                await api.tabs.update(tab.id, { active: true });
                await api.windows.update(tab.windowId, { focused: true });
                return true;
            } catch (_) {
                return false; // the tab was closed since
            }
        }

        function closed(tabId) {
            return change((watches) => { delete watches[tabId]; });
        }

        return { all, get, start, stop, done, clicked, closed };
    }

    const api = root.chrome;
    let worker = null;
    if (api && api.notifications && api.tabs && api.storage) {
        worker = createWorker(api);
        Router.on('ciWatchGet', worker.get);
        Router.on('ciWatchStart', worker.start);
        Router.on('ciWatchStop', worker.stop);
        Router.on('ciWatchDone', worker.done);
        api.notifications.onClicked.addListener(worker.clicked);
        api.tabs.onRemoved.addListener(worker.closed);
    }

    const CiWatchWorker = { KEY, PREFIX, createWorker, worker };

    root.BB.CiWatchWorker = CiWatchWorker;
    if (typeof module !== 'undefined' && module.exports) module.exports = CiWatchWorker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
