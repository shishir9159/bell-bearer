/**
 * The sites a watch party plays on, as one registry — what a media id looks
 * like on each, how to get back to it, and what its player will put up with.
 *
 * The two players differ in ways the sync engine has to know about, and
 * spreading those differences through the adapter as `if (site === ...)` is
 * how one site's fix quietly breaks the other's:
 *
 *   seek   YouTube's <video> takes a currentTime write. Netflix's does not —
 *          writing it throws error M7375 and kills playback — so a seek there
 *          goes through the player's own API, from the page's world.
 *   rate   YouTube keeps a nudged playbackRate. Netflix has been seen putting
 *          it back, so it is probed: a rate reverted within `probeMs` sends
 *          that member's drift controller to seek-only for the session.
 *   ads    YouTube marks an ad on the player element. Ads differ per member,
 *          so one never holds the room.
 *
 * A peer never sends a URL. It sends `{ site, id }`, and the URL to follow it
 * with is built here from an id that has already passed the same pattern the
 * authority checks it against.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyState = ns.PartyState || req('./party-state.js');
    const YouTube = ns.YouTube || req('./youtube.js');

    const SITES = Object.freeze({
        youtube: Object.freeze({
            id: 'youtube',
            name: 'YouTube',
            host: /(^|\.)youtube\.com$/,
            idFrom: (url) => YouTube.extractVideoId(url),
            urlFor: (id) => YouTube.watchUrl(id),
            seek: 'video',
            rate: 'nudge',
            probeMs: 0,
            ad: '#movie_player.ad-showing',
            // A watch page to watch page move keeps the document, so the
            // injected code survives it and hears about it from this.
            navigated: 'yt-navigate-finish',
        }),
        netflix: Object.freeze({
            id: 'netflix',
            name: 'Netflix',
            host: /(^|\.)netflix\.com$/,
            idFrom(url) {
                try {
                    const found = new URL(url).pathname.match(/^\/watch\/(\d+)/);
                    return found ? found[1] : null;
                } catch (_) {
                    return null;
                }
            },
            urlFor: (id) => `https://www.netflix.com/watch/${id}`,
            seek: 'api',
            rate: 'probe',
            probeMs: 1000,
            ad: null,
            navigated: null,
        }),
    });

    function get(id) {
        return SITES[id] || null;
    }

    function list() {
        return Object.values(SITES);
    }

    /** Which party site a URL is on, or null. */
    function siteOf(url) {
        let host = '';
        try { host = new URL(url).hostname; } catch (_) { return null; }
        const found = list().find((site) => site.host.test(host));
        return found ? found.id : null;
    }

    /** The `{ site, id }` a URL is playing, already valid for the wire, or null. */
    function mediaOf(url) {
        const site = get(siteOf(url));
        if (!site) return null;
        return PartyState.validMedia({ site: site.id, id: site.idFrom(url) });
    }

    /** Where to go to watch `media`, built locally — or null for anything that does not validate. */
    function urlFor(media) {
        const valid = PartyState.validMedia(media);
        return valid ? get(valid.site).urlFor(valid.id) : null;
    }

    const sameMedia = (a, b) => !!a && !!b && a.site === b.site && a.id === b.id;

    const PartySites = { SITES, get, list, siteOf, mediaOf, urlFor, sameMedia };

    root.BB = root.BB || {};
    root.BB.PartySites = PartySites;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartySites;
})(typeof globalThis !== 'undefined' ? globalThis : this);
