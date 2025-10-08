/**
 * A mock of the subset of the `chrome.*` extension API that bell-bearer uses,
 * good enough to load background.js / content.js unmodified and drive real
 * event sequences against them.
 *
 * Extension code registers its listeners once at load, so the mock is
 * installed before the scripts are loaded and then `reset()` between tests to
 * clear state without re-registering.
 */
(function () {
    'use strict';

    const listeners = {
        runtimeInstalled: [], runtimeStartup: [], runtimeMessage: [],
        command: [], actionClicked: [],
        tabsActivated: [], tabsCreated: [], tabsRemoved: [], tabsUpdated: [],
        storageChanged: [], windowsFocusChanged: [], tabGroupsUpdated: [],
        contextMenuClicked: [],
    };

    const state = {
        tabs: [],
        localStore: {},
        sessionStore: {},
        moveCalls: [],
        fetchCalls: [],
        menus: [],
        messages: [],
        // Set to true to make the mocked fetch reject (simulates sowon being down).
        failFetch: false,
        // Forced error for the next tabs.move call, e.g. Chrome's transient
        // "Tabs cannot be edited right now" rejection.
        moveErrorsRemaining: 0,
    };

    const soon = (fn) => setTimeout(fn, 0);
    function pick(keys, store) {
        const out = {};
        if (keys === null || keys === undefined) return Object.assign({}, store);
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
        });
        return out;
    }
    const evt = (arr) => ({ addListener: (f) => arr.push(f) });

    const chrome = {
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
                get: (k, cb) => soon(() => cb(pick(k, state.localStore))),
                set: (o, cb) => {
                    const changes = {};
                    Object.keys(o).forEach((k) => {
                        changes[k] = { oldValue: state.localStore[k], newValue: o[k] };
                    });
                    Object.assign(state.localStore, o);
                    listeners.storageChanged.forEach((f) => f(changes, 'local'));
                    if (cb) soon(cb);
                },
            },
            session: {
                get: (k, cb) => soon(() => cb(pick(k, state.sessionStore))),
                set: (o, cb) => { Object.assign(state.sessionStore, o); if (cb) soon(cb); },
            },
            onChanged: evt(listeners.storageChanged),
        },
        tabs: {
            onActivated: evt(listeners.tabsActivated),
            onCreated: evt(listeners.tabsCreated),
            onRemoved: evt(listeners.tabsRemoved),
            onUpdated: evt(listeners.tabsUpdated),
            get: (id, cb) => soon(() => {
                const t = state.tabs.find((x) => x.id === id);
                chrome.runtime.lastError = t ? undefined : { message: 'No tab with id: ' + id };
                cb(t);
                chrome.runtime.lastError = undefined;
            }),
            query: (q, cb) => soon(() => cb(state.tabs.filter((t) =>
                (q.windowId === undefined || t.windowId === q.windowId) &&
                (q.active === undefined || t.active === q.active) &&
                (q.currentWindow === undefined || true) &&
                (q.lastFocusedWindow === undefined || true)))),
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
            sendMessage: (id, msg, cb) => {
                state.messages.push({ tabId: id, message: msg });
                if (cb) soon(() => cb({ ok: true }));
            },
            create: (props, cb) => { if (cb) soon(() => cb({ id: 999 })); },
            update: (id, props, cb) => { if (cb) soon(() => cb({})); },
        },
        windows: {
            onFocusChanged: evt(listeners.windowsFocusChanged),
            update: (id, props, cb) => { if (cb) soon(() => cb({})); },
        },
        // Left undefined by default; tests that need tab groups set it.
        tabGroups: undefined,
        scripting: { executeScript: (o, cb) => { if (cb) soon(() => cb([{ result: 1 }])); } },
    };

    // Mocked fetch used by the sowon reporting path.
    function mockFetch(url, opts) {
        state.fetchCalls.push({ url, opts });
        if (state.failFetch) return Promise.reject(new Error('connection refused'));
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
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
            state.failFetch = !!opts.failFetch;
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

        /** Lets queued async callbacks (storage, tabs.get, retries) run. */
        settle: (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 250 : ms)),
    };
})();
