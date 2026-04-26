/**
 * The `chrome.*` APIs bell-bearer uses, enough to load the sources unmodified.
 * Installed before them, as they register their listeners at load; `reset()`
 * clears state between tests and leaves the listeners.
 */
(function () {
    'use strict';

    const listeners = {
        runtimeInstalled: [], runtimeStartup: [], runtimeMessage: [],
        command: [], actionClicked: [],
        tabsActivated: [], tabsCreated: [], tabsRemoved: [], tabsUpdated: [],
        storageChanged: [], windowsFocusChanged: [], tabGroupsUpdated: [],
        contextMenuClicked: [], alarm: [],
    };

    const state = {
        tabs: [],
        localStore: {},
        sessionStore: {},
        moveCalls: [],
        fetchCalls: [],
        menus: [],
        messages: [],
        alarms: {},
        created: [],
        // Set to true to make the mocked fetch reject (simulates sowon being down).
        failFetch: false,
        // Forced error for the next tabs.move call, e.g. Chrome's transient
        // "Tabs cannot be edited right now" rejection.
        moveErrorsRemaining: 0,
    };

    // A macrotask, as a real chrome.* callback is. A microtask is faster in a
    // hidden tab but runs ahead of the code's own timers, which reorders
    // sowon's back-off and turns its regression test green whatever the code does.
    const soon = (fn) => setTimeout(fn, 0);
    function pick(keys, store) {
        const out = {};
        if (keys === null || keys === undefined) return Object.assign({}, store);
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
        });
        return out;
    }
    // removeListener too: without it every UI a spec tears down stays
    // subscribed to storage, answering the changes later tests make.
    const evt = (arr) => ({
        addListener: (f) => arr.push(f),
        removeListener: (f) => {
            const at = arr.indexOf(f);
            if (at >= 0) arr.splice(at, 1);
        },
    });

    /**
     * Chrome MV3 (and Firefox) give every callback API a promise form when the
     * callback is omitted, and the shared modules use it throughout. `dual`
     * wraps a callback-style implementation so the mock offers both.
     */
    function dual(impl) {
        return function (...args) {
            const last = args[args.length - 1];
            if (typeof last === 'function') return impl.apply(this, args);
            return new Promise((resolve, reject) => {
                impl.apply(this, [...args, (result) => {
                    const error = chrome.runtime.lastError;
                    if (error) reject(new Error(error.message));
                    else resolve(result);
                }]);
            });
        };
    }

    /** A match pattern, as tabs.query takes one: `*://chatgpt.com/*`. */
    function matchesUrl(url, patterns) {
        return [].concat(patterns).some((pattern) => {
            const [, scheme, host, path] = /^(\*|[a-z]+):\/\/([^/]*)(\/.*)$/.exec(pattern) || [];
            if (!scheme) return false;
            const glob = (text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
            const re = new RegExp(`^${scheme === '*' ? 'https?' : scheme}://${glob(host)}${glob(path)}$`);
            return re.test(String(url || ''));
        });
    }

    const chrome = {
        alarms: {
            create: (name, info) => { state.alarms[name] = Object.assign({ name }, info); },
            clear: dual((name, cb) => {
                const had = !!state.alarms[name];
                delete state.alarms[name];
                soon(() => cb(had));
            }),
            get: dual((name, cb) => soon(() => cb(state.alarms[name]))),
            onAlarm: evt(listeners.alarm),
        },
        runtime: {
            onInstalled: evt(listeners.runtimeInstalled),
            onStartup: evt(listeners.runtimeStartup),
            onMessage: evt(listeners.runtimeMessage),
            lastError: undefined,
            getURL: (p) => 'chrome-extension://mock/' + p,
            id: 'mock-extension-id',
        },
        contextMenus: {
            create: (props, cb) => { state.menus.push(props); if (cb) soon(cb); },
            removeAll: (cb) => { state.menus = []; if (cb) soon(cb); },
            remove: (id, cb) => {
                state.menus = state.menus.filter((m) => m.id !== id);
                if (cb) soon(cb);
            },
            onClicked: evt(listeners.contextMenuClicked),
        },
        commands: { onCommand: evt(listeners.command) },
        action: { onClicked: evt(listeners.actionClicked) },
        storage: {
            local: {
                get: dual((k, cb) => soon(() => cb(pick(k, state.localStore)))),
                set: dual((o, cb) => {
                    const changes = {};
                    Object.keys(o).forEach((k) => {
                        changes[k] = { oldValue: state.localStore[k], newValue: o[k] };
                    });
                    Object.assign(state.localStore, o);
                    listeners.storageChanged.forEach((f) => f(changes, 'local'));
                    soon(cb);
                }),
                remove: dual((keys, cb) => {
                    const changes = {};
                    [].concat(keys).forEach((k) => {
                        if (!Object.prototype.hasOwnProperty.call(state.localStore, k)) return;
                        changes[k] = { oldValue: state.localStore[k] };
                        delete state.localStore[k];
                    });
                    if (Object.keys(changes).length) listeners.storageChanged.forEach((f) => f(changes, 'local'));
                    soon(cb);
                }),
            },
            session: {
                get: dual((k, cb) => soon(() => cb(pick(k, state.sessionStore)))),
                set: dual((o, cb) => { Object.assign(state.sessionStore, o); soon(cb); }),
            },
            onChanged: evt(listeners.storageChanged),
        },
        tabs: {
            onActivated: evt(listeners.tabsActivated),
            onCreated: evt(listeners.tabsCreated),
            onRemoved: evt(listeners.tabsRemoved),
            onUpdated: evt(listeners.tabsUpdated),
            get: dual((id, cb) => soon(() => {
                const t = state.tabs.find((x) => x.id === id);
                chrome.runtime.lastError = t ? undefined : { message: 'No tab with id: ' + id };
                cb(t);
                chrome.runtime.lastError = undefined;
            })),
            query: dual((q, cb) => soon(() => cb(state.tabs.filter((t) =>
                (q.url === undefined || matchesUrl(t.url, q.url)) &&
                (q.windowId === undefined || t.windowId === q.windowId) &&
                (q.active === undefined || t.active === q.active) &&
                (q.currentWindow === undefined || true) &&
                (q.lastFocusedWindow === undefined || true))))),
            move: (id, props, cb) => {
                state.moveCalls.push({ id, index: props.index });
                if (state.moveErrorsRemaining > 0) {
                    state.moveErrorsRemaining--;
                    return soon(() => {
                        chrome.runtime.lastError = { message: 'Tabs cannot be edited right now (user may be dragging a tab)' };
                        if (cb) cb();
                        chrome.runtime.lastError = undefined;
                    });
                }
                const t = state.tabs.find((x) => x.id === id);
                if (t) {
                    state.tabs = state.tabs.filter((x) => x.id !== id);
                    state.tabs.splice(props.index, 0, t);
                    state.tabs.forEach((x, i) => { x.index = i; });
                }
                soon(() => { chrome.runtime.lastError = undefined; if (cb) cb(); });
            },
            sendMessage: dual((id, msg, cb) => {
                state.messages.push({ tabId: id, message: msg });
                soon(() => cb({ ok: true }));
            }),
            create: dual((props, cb) => { state.created.push(props); soon(() => cb({ id: 999 })); }),
            update: dual((id, props, cb) => soon(() => cb({}))),
        },
        windows: {
            onFocusChanged: evt(listeners.windowsFocusChanged),
            update: dual((id, props, cb) => soon(() => cb({}))),
        },
        // Left undefined by default; tests that need tab groups set it.
        tabGroups: undefined,
        scripting: { executeScript: dual((o, cb) => soon(() => cb([{ result: 1 }]))) },
    };

    // Mocked fetch used by the sowon reporting path.
    function mockFetch(url, opts) {
        state.fetchCalls.push({ url, opts });
        if (state.failFetch) return Promise.reject(new Error('connection refused'));
        // An HTTP status other than 200, for a server that answers with an error.
        const status = state.fetchStatus || 200;
        return Promise.resolve({ ok: status < 300, status, text: () => Promise.resolve('') });
    }

    window.chrome = chrome;
    window.fetch = mockFetch;

    window.MockChrome = {
        chrome,
        listeners,
        state,

        /** Clears per-test state. Listeners stay registered. */
        reset(opts) {
            opts = opts || {};
            state.tabs = opts.tabs || [];
            state.localStore = opts.localStore || {};
            state.sessionStore = opts.sessionStore || {};
            state.moveCalls = [];
            state.fetchCalls = [];
            state.menus = [];
            state.messages = [];
            state.alarms = {};
            state.created = [];
            state.failFetch = !!opts.failFetch;
            state.fetchStatus = opts.fetchStatus || 0;
            state.moveErrorsRemaining = opts.moveErrorsRemaining || 0;
            chrome.tabGroups = opts.tabGroups;
        },

        fire: {
            activated: (tabId, windowId) => listeners.tabsActivated.forEach((f) => f({ tabId, windowId })),
            created: (tab) => listeners.tabsCreated.forEach((f) => f(tab)),
            removed: (tabId, info) => listeners.tabsRemoved.forEach((f) => f(tabId, info)),
            updated: (tabId, change, tab) => listeners.tabsUpdated.forEach((f) => f(tabId, change, tab)),
            windowFocus: (windowId) => listeners.windowsFocusChanged.forEach((f) => f(windowId)),
            installed: () => listeners.runtimeInstalled.forEach((f) => f({ reason: 'install' })),
            startup: () => listeners.runtimeStartup.forEach((f) => f()),
            menuClicked: (info, tab) => listeners.contextMenuClicked.forEach((f) => f(info, tab)),
            alarm: (name) => listeners.alarm.forEach((f) => f({ name })),
        },

        menuIds: () => state.menus.map((m) => m.id),

        /** Appends a new tab at the end and makes it active, like Ctrl+T. */
        openNewTab(id, overrides) {
            const t = Object.assign({
                id,
                index: state.tabs.length,
                windowId: 100,
                active: true,
                url: '',
                pendingUrl: 'chrome://newtab/',
                pinned: false,
                title: 'New Tab',
            }, overrides || {});
            state.tabs.forEach((x) => { x.active = false; });
            state.tabs.push(t);
            return t;
        },

        tabOrder: () => state.tabs.map((t) => t.id),
        indexOf: (id) => {
            const t = state.tabs.find((x) => x.id === id);
            return t ? t.index : -1;
        },

        /**
         * Lets queued callbacks run: longer in a hidden tab, which throttles
         * the timers they wait on. An explicit `ms` is never scaled — a test
         * that passes one is timing something.
         */
        settle: (ms) => new Promise((r) =>
            setTimeout(r, ms === undefined ? (document.hidden ? 4000 : 250) : ms)),
    };
})();
