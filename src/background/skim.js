/**
 * The browser side of Skim.
 *
 * The launcher is a content script, and a content script can see the page it
 * is on and nothing else — not the other tabs, not the history, and none of
 * the things in the action list. So it asks here, and everything that needs
 * a privileged API happens in this file.
 *
 * Three messages:
 *   skimSearch   { query }        → { tabs, history }
 *   skimRun      { id }           → { ok, note }        one row of Skim.ACTIONS
 *   skimOpenLink { url }          → { ok }              a link hint's target
 *
 * The action ids come from src/shared/skim.js; the test suite asserts that
 * every one of them is named somewhere below, so adding a row there without
 * a branch here fails the build rather than silently doing nothing.
 */
(function () {
    'use strict';

    const Skim = globalThis.BB && globalThis.BB.Skim;

    /** How many of each kind a query comes back with. */
    const LIMIT = 12;

    const sender = (respond) => (value) => {
        try { respond(value); } catch (_) { /* the page went away mid-flight */ }
    };

    /** The tab the launcher is drawn in — every action below acts on it. */
    function activeTab() {
        return new Promise((done) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                void chrome.runtime.lastError;
                done((tabs && tabs[0]) || null);
            });
        });
    }

    function openTabs(query) {
        return new Promise((done) => {
            chrome.tabs.query({}, (tabs) => {
                void chrome.runtime.lastError;
                const rows = (tabs || []).map((tab) => ({
                    id: tab.id, title: tab.title || tab.url || '', sub: hostOf(tab.url),
                }));
                done(Skim.filterRows(rows, query).slice(0, LIMIT));
            });
        });
    }

    /**
     * Recent history for the query. `chrome.history` is a permission and an
     * API Firefox also has, but either could be missing — an absent history
     * is an empty group, not a failed search.
     */
    function history(query) {
        return new Promise((done) => {
            if (!chrome.history || !chrome.history.search) return done([]);
            try {
                chrome.history.search({ text: query, maxResults: LIMIT * 3 }, (items) => {
                    void chrome.runtime.lastError;
                    const rows = (items || [])
                        .filter((item) => item.url)
                        .map((item) => ({ url: item.url, title: item.title || item.url, sub: hostOf(item.url) }));
                    done(rows.slice(0, LIMIT));
                });
            } catch (_) {
                done([]);
            }
        });
    }

    const hostOf = (url) => globalThis.BB.Hosts.of(url);

    const reload = (tab, bypassCache) => chrome.tabs.reload(tab.id, { bypassCache });

    const openPage = (url, tab) => chrome.tabs.create({ url, index: tab ? tab.index + 1 : undefined });

    /** Run one action of Skim.ACTIONS. Resolves to the line the toast shows. */
    async function run(id) {
        const tab = await activeTab();
        if (!tab) return { ok: false, note: 'no tab to act on' };

        switch (id) {
            case 'new-tab':
                await chrome.tabs.create({ index: tab.index + 1 });
                return { ok: true, note: 'New tab' };
            case 'duplicate-tab':
                await chrome.tabs.duplicate(tab.id);
                return { ok: true, note: 'Duplicated this tab' };
            case 'close-tab':
                await chrome.tabs.remove(tab.id);
                return { ok: true, note: '' };
            case 'close-others': {
                const others = await chrome.tabs.query({ currentWindow: true, pinned: false });
                const ids = others.filter((other) => other.id !== tab.id).map((other) => other.id);
                if (ids.length) await chrome.tabs.remove(ids);
                return { ok: true, note: `Closed ${ids.length} tab${ids.length === 1 ? '' : 's'}` };
            }
            case 'reload':
                await reload(tab, false);
                return { ok: true, note: 'Reloading' };
            case 'hard-reload':
                await reload(tab, true);
                return { ok: true, note: 'Reloading, ignoring the cache' };
            case 'pin-tab':
                await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
                return { ok: true, note: tab.pinned ? 'Unpinned' : 'Pinned' };
            case 'mute-tab':
                await chrome.tabs.update(tab.id, { muted: !(tab.mutedInfo && tab.mutedInfo.muted) });
                return { ok: true, note: tab.mutedInfo && tab.mutedInfo.muted ? 'Unmuted' : 'Muted' };
            case 'detach-tab':
                await chrome.windows.create({ tabId: tab.id });
                return { ok: true, note: 'Moved to its own window' };
            case 'reopen-tab': {
                // Firefox for Android has no sessions API, and a session with
                // nothing closed in it has nothing to restore.
                if (!chrome.sessions || !chrome.sessions.restore) return { ok: false, note: 'nothing to reopen' };
                await chrome.sessions.restore();
                return { ok: true, note: 'Reopened' };
            }
            case 'copy-markdown':
                // The clipboard belongs to the page, not the worker, so this
                // one goes back to the content script that asked for it.
                chrome.tabs.sendMessage(tab.id, { action: 'copyMarkdownLink' }, () => {
                    void chrome.runtime.lastError;
                });
                return { ok: true, note: '' };
            case 'open-dashboard':
                await openPage(chrome.runtime.getURL('dashboard.html'), tab);
                return { ok: true, note: 'Opened the dashboard' };
            case 'open-history':
                await openPage('chrome://history', tab);
                return { ok: true, note: '' };
            case 'open-downloads':
                await openPage('chrome://downloads', tab);
                return { ok: true, note: '' };
            case 'open-extensions':
                await openPage('chrome://extensions', tab);
                return { ok: true, note: '' };
            default:
                return { ok: false, note: 'unknown action' };
        }
    }

    chrome.runtime.onMessage.addListener((message, from, respond) => {
        const reply = sender(respond);
        switch (message && message.action) {
            case 'skimSearch':
                Promise.all([openTabs(message.query), history(message.query)])
                    .then(([tabs, pages]) => reply({ tabs, history: pages }))
                    .catch(() => reply({ tabs: [], history: [] }));
                return true;

            case 'skimFocusTab':
                chrome.tabs.update(message.tabId, { active: true }, (tab) => {
                    void chrome.runtime.lastError;
                    if (tab) chrome.windows.update(tab.windowId, { focused: true });
                    reply({ ok: !!tab });
                });
                return true;

            case 'skimRun':
                run(message.id).then(reply).catch(() => reply({ ok: false, note: 'that did not work' }));
                return true;

            // A link hint opens beside the page it was picked on rather than
            // at the end of the strip, so the two stay next to each other.
            case 'skimOpenLink':
                activeTab().then((tab) => {
                    chrome.tabs.create({
                        url: message.url,
                        index: tab ? tab.index + 1 : undefined,
                        active: message.focus !== false,
                    }, () => {
                        void chrome.runtime.lastError;
                        reply({ ok: true });
                    });
                });
                return true;

            default:
                return false;
        }
    });
})();
