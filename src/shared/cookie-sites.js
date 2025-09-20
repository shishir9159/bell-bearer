/**
 * Sites whose cookie banner Bell Bearer accepts without asking.
 *
 * A site lands here when the user clicks the "Always accept here" button
 * src/content/cookie-banner.js adds to its banner; it leaves from the list in
 * Settings → General. Stored as `{ [host]: { decision, savedAt } }` so a later
 * "always decline" can sit beside "accept" without a migration.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    const KEY = Settings.DATA.cookieSites;
    const EXPORT_TYPE = 'bell-bearer-cookie-sites';

    function normalizeHost(hostname) {
        return String(hostname || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    }

    /** The remembered entry covering `hostname` — itself or a parent domain. */
    function match(sites, hostname) {
        const host = normalizeHost(hostname);
        if (!host || !sites) return null;
        for (let at = host; at; ) {
            if (Object.prototype.hasOwnProperty.call(sites, at)) return { host: at, ...sites[at] };
            const dot = at.indexOf('.');
            if (dot < 0) break;
            at = at.slice(dot + 1);
            if (at.indexOf('.') < 0) break; // never match a bare TLD
        }
        return null;
    }

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

    function buildExport(sites, now = Date.now()) {
        return { type: EXPORT_TYPE, version: 1, exportedAt: new Date(now).toISOString(), sites: sites || {} };
    }

    function validateImport(data) {
        return !!data && data.type === EXPORT_TYPE && !!data.sites &&
            typeof data.sites === 'object' && !Array.isArray(data.sites);
    }

    /** Imported entries are added; a host already remembered keeps its own entry. */
    function mergeImported(current, incoming) {
        const out = { ...(current || {}) };
        let added = 0;
        for (const [rawHost, entry] of Object.entries(incoming || {})) {
            const host = normalizeHost(rawHost);
            if (!host || out[host] || !entry || typeof entry !== 'object') continue;
            out[host] = { decision: entry.decision === 'decline' ? 'decline' : 'accept', savedAt: Number(entry.savedAt) || 0 };
            added++;
        }
        return { sites: out, added };
    }

    const CookieSites = {
        KEY, EXPORT_TYPE, normalizeHost, match, load, save, remember, forget, list,
        buildExport, validateImport, mergeImported,
    };

    root.BB = root.BB || {};
    root.BB.CookieSites = CookieSites;
    if (typeof module !== 'undefined' && module.exports) module.exports = CookieSites;
})(typeof globalThis !== 'undefined' ? globalThis : this);
