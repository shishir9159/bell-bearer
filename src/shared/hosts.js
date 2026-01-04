/**
 * Hosts: out of a URL, into the one form a list is keyed by, and looked up
 * in a list that covers a site's subdomains.
 *
 * The remembered cookie sites and the time-limited sites each had their own
 * normalizer and the same walk up the domain, and three parts of the worker
 * had their own three lines for a tab's host.
 */
(function (root) {
    'use strict';

    /**
     * A host as a list stores it: lower case, no www, no trailing dot. A whole
     * URL is accepted and reduced — pasting the address bar in is the obvious
     * way to name a site.
     */
    function normalize(hostname) {
        return String(hostname || '')
            .trim()
            .toLowerCase()
            .replace(/^[a-z+]+:\/\//, '')
            .replace(/[/?#].*$/, '')
            .replace(/^www\./, '')
            .replace(/\.$/, '');
    }

    /**
     * The entry in `map` covering `hostname` — itself or a parent domain — as
     * `{ host, ...entry }`, or null. It stops short of a bare TLD: an entry
     * for "com" would answer for the web.
     */
    function lookup(map, hostname) {
        const host = normalize(hostname);
        if (!host || !map) return null;
        for (let at = host; at;) {
            if (Object.prototype.hasOwnProperty.call(map, at)) return { host: at, ...map[at] };
            const dot = at.indexOf('.');
            if (dot < 0) break;
            at = at.slice(dot + 1);
            if (at.indexOf('.') < 0) break;
        }
        return null;
    }

    /** A URL's host without the www, or '' for anything that is not a URL with one (chrome://newtab and the like). */
    function of(url) {
        try {
            return new URL(String(url || '')).hostname.replace(/^www\./, '');
        } catch (_) {
            return '';
        }
    }

    const Hosts = { normalize, lookup, of };

    root.BB = root.BB || {};
    root.BB.Hosts = Hosts;
    if (typeof module !== 'undefined' && module.exports) module.exports = Hosts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
