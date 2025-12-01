/**
 * The gate the watch party goes through: none of its code is in the manifest.
 *
 * The party is a lot of code — the clock, the state vector, the drift
 * controller, the media adapter, and on Netflix a page-world bridge — and on
 * any given evening nearly nobody is in one. Listed as content scripts it
 * would be parsed on every YouTube and Netflix page for the sake of the one
 * that is in a party. So it is injected instead, into the one tab a party is
 * started or joined from, at that moment, and again only when that same tab
 * loads a new document. A tab that has never been in a party never sees a
 * byte of it.
 *
 * What it costs outside a party is this file in the worker: two listeners
 * that compare a tab id with an empty slot.
 *
 * Injected files land in the extension's isolated world — the same one the
 * manifest's content scripts run in — so they find `BB` and the page's
 * player there already. The page-world files are Netflix's player bridge,
 * which the isolated world cannot reach.
 */
(function (root) {
    'use strict';

    /** Injected into the party's tab, in this order, isolated world. */
    const CONTENT_FILES = Object.freeze([
        'src/shared/party-clock.js',
        'src/shared/party-state.js',
        'src/shared/party-drift.js',
    ]);

    /** Injected into the page's own world, per site. */
    const PAGE_FILES = Object.freeze({
        youtube: Object.freeze([]),
        netflix: Object.freeze([]),
    });

    /** Where the bound tab is remembered; the worker itself does not survive the evening. */
    const KEY = 'bbPartyTab';

    function siteOf(url) {
        let host = '';
        try { host = new URL(url).hostname; } catch (_) { return null; }
        if (/(^|\.)youtube\.com$/.test(host)) return 'youtube';
        if (/(^|\.)netflix\.com$/.test(host)) return 'netflix';
        return null;
    }

    function createLoader(api) {
        /** { tabId, site } while a party is bound to a tab; undefined until read. */
        let bound;

        async function current() {
            if (bound !== undefined) return bound;
            try {
                bound = (await api.storage.session.get(KEY))[KEY] || null;
            } catch (_) {
                bound = null;
            }
            return bound;
        }

        async function inject(tabId, site) {
            try {
                await api.scripting.executeScript({ target: { tabId }, files: [...CONTENT_FILES] });
                const page = PAGE_FILES[site] || [];
                if (page.length) {
                    await api.scripting.executeScript({ target: { tabId }, files: [...page], world: 'MAIN' });
                }
                return true;
            } catch (_) {
                return false; // the tab closed, or it is on a page we may not script
            }
        }

        /** Start or join: bind the party to this tab and bring its code in. */
        async function bind(tabId, url) {
            const site = siteOf(url);
            if (!site) return false;
            bound = { tabId, site };
            try { await api.storage.session.set({ [KEY]: bound }); } catch (_) { /* memory still has it */ }
            return inject(tabId, site);
        }

        async function unbind() {
            bound = null;
            try { await api.storage.session.remove(KEY); } catch (_) { /* nothing to forget */ }
        }

        /**
         * A new document in the bound tab starts without the party's code, so
         * it is injected again — unless the tab has wandered off to a site the
         * party does not play on, which gets nothing.
         */
        async function onUpdated(tabId, changeInfo, tab) {
            if (!changeInfo || changeInfo.status !== 'complete') return false;
            const now = await current();
            if (!now || now.tabId !== tabId) return false;
            const site = siteOf((tab && tab.url) || '');
            if (!site) return false;
            return inject(tabId, site);
        }

        async function onRemoved(tabId) {
            const now = await current();
            if (now && now.tabId === tabId) await unbind();
        }

        return { bind, unbind, inject, onUpdated, onRemoved, current };
    }

    const PartyLoader = { CONTENT_FILES, PAGE_FILES, KEY, siteOf, createLoader };

    // The worker registers its listeners at top level, synchronously, or a
    // restarted worker misses the event that woke it.
    const api = root.chrome;
    if (api && api.scripting && api.tabs && api.tabs.onUpdated && api.storage && api.storage.session) {
        const loader = createLoader(api);
        api.tabs.onUpdated.addListener(loader.onUpdated);
        api.tabs.onRemoved.addListener(loader.onRemoved);
        PartyLoader.loader = loader;
    }

    root.BB = root.BB || {};
    root.BB.PartyLoader = PartyLoader;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyLoader;
})(typeof globalThis !== 'undefined' ? globalThis : this);
