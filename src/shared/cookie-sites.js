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
    const Store = ns.Store || req('./store.js');
    const Hosts = ns.Hosts || req('./hosts.js');

    const KEY = Settings.DATA.cookieSites;

    const normalizeHost = Hosts.normalize;

    /** The remembered entry covering `hostname` — itself or a parent domain. */
    const match = (sites, hostname) => Hosts.lookup(sites, hostname);

    /**
     * Through the store, whose steps hold a lock across tabs: a banner
     * answered on one site while the list in Settings forgot another used to
     * read the list, change it and write it back each on its own, and
     * whichever wrote last took the other's change with it.
     */
    const store = Store.create({
        keys: [KEY],
        name: 'the remembered cookie sites',
        read: (stored) => {
            const sites = stored[KEY];
            return sites && typeof sites === 'object' && !Array.isArray(sites) ? { ...sites } : {};
        },
        blank: () => ({}),
        // The list as it is stored, for a panel to draw, rather than none.
        failed: () => store.load(),
    });

    const { load } = store;
    const save = (sites) => store.save(sites);

    function remember(hostname, decision = 'accept', now = Date.now()) {
        const host = normalizeHost(hostname);
        if (!host) return load();
        return store.update((sites) => ({ ...sites, [host]: { decision, savedAt: now } }));
    }

    function forget(hostname) {
        const host = normalizeHost(hostname);
        return store.update((sites) => {
            delete sites[host];
        });
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
