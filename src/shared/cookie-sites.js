/**
 * Sites whose cookie banner Bell Bearer accepts without asking.
 *
 * A site lands here when the user clicks "Always accept" or "Always reject" on
 * a banner (src/content/cookie-banner.js); it leaves from the list in
 * Settings → General. Stored as `{ [host]: { decision, savedAt } }`, the
 * decision being 'accept' or 'decline'.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Hosts = ns.Hosts || req('./hosts.js');

    const KEY = Settings.DATA.cookieSites;

    const normalizeHost = Hosts.normalize;

    /** The remembered entry covering `hostname` — itself or a parent domain. */
    const match = (sites, hostname) => Hosts.lookup(sites, hostname);

    async function load() {
        try {
            const stored = await chrome.storage.local.get([KEY]);
            const sites = stored && stored[KEY];
            return sites && typeof sites === 'object' && !Array.isArray(sites) ? sites : {};
        } catch (_) {
            return {};
        }
    }

    function save(sites) {
        return Settings.set({ [KEY]: sites });
    }

    async function remember(hostname, decision = 'accept', now = Date.now()) {
        const host = normalizeHost(hostname);
        const sites = await load();
        if (!host) return sites;
        sites[host] = { decision, savedAt: now };
        await save(sites);
        return sites;
    }

    async function forget(hostname) {
        const host = normalizeHost(hostname);
        const sites = await load();
        delete sites[host];
        await save(sites);
        return sites;
    }

    /** Newest first, for the settings list. */
    function list(sites) {
        return Object.entries(sites || {})
            .map(([host, entry]) => ({ host, ...entry }))
            .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    }

    const CookieSites = { KEY, normalizeHost, match, load, save, remember, forget, list };

    root.BB = root.BB || {};
    root.BB.CookieSites = CookieSites;
    if (typeof module !== 'undefined' && module.exports) module.exports = CookieSites;
})(typeof globalThis !== 'undefined' ? globalThis : this);
