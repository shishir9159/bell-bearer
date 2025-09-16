/**
 * Channel feeds: resolve a channel URL to its UC… id and read its public RSS.
 *
 * Lives in shared/ because both the on-page "Latest by topic" overlay and the
 * dashboard's "Refresh" need it — the dashboard button previously just showed
 * an alert telling the user to go and look at YouTube themselves.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const YouTube = ns.YouTube || req('./youtube.js');

    const CACHE_KEY = Settings.DATA.channelIdCache;
    const LEGACY_CACHE_KEY = 'bbChannelIdCache';
    const FEED_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

    /**
     * The channel's *own* UC id, out of a megabyte of channel-page HTML.
     *
     * This used to take the first `"channelId":"UC…"` in the document. That is
     * not the page's channel. It is the id of *some* channel the page mentions,
     * and a channel page mentions a dozen — the recommended-channels rail alone
     * accounts for most of them. On youtube.com/@veritasium the first match is a
     * different channel entirely, so a handle filed in the pouch resolved to a
     * stranger's feed and the pouch filled with videos from channels nobody had
     * put there. The wrong answer was then cached, so it stayed wrong.
     *
     * Each pattern below names the page's own channel and nothing else: the
     * canonical link, the itemprop metadata, and channelMetadataRenderer's
     * externalId. First hit wins.
     */
    const OWN_ID_PATTERNS = [
        /<link[^>]+rel="canonical"[^>]+\/channel\/(UC[\w-]{20,})/,
        /<meta[^>]+itemprop="(?:identifier|channelId)"[^>]+content="(UC[\w-]{20,})"/,
        /"externalId":"(UC[\w-]{20,})"/,
    ];

    function ownChannelId(html) {
        for (const pattern of OWN_ID_PATTERNS) {
            const match = String(html || '').match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    /** In-flight and completed lookups, so N cards for one channel fetch once. */
    const inflight = new Map();

    /**
     * The stored handle-to-UC-id map, read once and then shared.
     *
     * Every resolution used to read the whole map for itself and write back a
     * fresh copy of it. Ten channels resolving at once therefore made ten reads
     * of the same object and ten writes that each overwrote the last, so nine of
     * the ten ids just resolved were lost and had to be looked up again on the
     * next run. One promise, one object, mutated in place.
     */
    let idCachePromise = null;

    function idCache() {
        if (!idCachePromise) {
            idCachePromise = (async () => {
                try {
                    // Drop the v1 map on the way past. Its entries are not
                    // stale, they are wrong, and nothing reads that key now.
                    chrome.storage.local.remove(LEGACY_CACHE_KEY);
                    return (await chrome.storage.local.get([CACHE_KEY]))[CACHE_KEY] || {};
                } catch (_) {
                    return {}; // context invalidated — every lookup falls through to the network
                }
            })();
        }
        return idCachePromise;
    }

    /**
     * Parsed feeds, so reopening the pouch a minute after closing it does not
     * refetch and reparse every channel. Ten minutes: YouTube's RSS is not
     * minute-fresh anyway, and an explicit Refresh passes `fresh` to skip it.
     */
    const FEED_TTL_MS = 10 * 60 * 1000;
    const feedCache = new Map(); // channelId -> { at, videos }

    /**
     * Resolve a channel to the UC… id its RSS feed is keyed by.
     *
     * A /channel/UC… URL carries the id already. Anything else (/@handle, /c/,
     * /user/) needs the channel page fetched once; the answer is cached in
     * storage because that page is a megabyte of HTML.
     */
    async function resolveChannelId(channel) {
        const url = (channel && channel.url) || '';
        if (!url) return null;

        const direct = YouTube.extractCanonicalChannelId(url);
        if (direct) return direct;

        if (inflight.has(url)) return inflight.get(url);

        const lookup = (async () => {
            const cache = await idCache();
            if (cache[url]) return cache[url];

            try {
                const response = await fetch(url, { credentials: 'omit' });
                if (!response.ok) return null;
                const id = ownChannelId(await response.text());
                if (!id) return null;

                cache[url] = id;
                try {
                    await chrome.storage.local.set({ [CACHE_KEY]: cache });
                } catch (_) { /* cache is an optimisation, not a requirement */ }
                return id;
            } catch (_) {
                return null;
            }
        })();

        inflight.set(url, lookup);
        // Keep successes cached in memory; retry failures on the next call.
        lookup.then((id) => { if (!id) inflight.delete(url); }, () => inflight.delete(url));
        return lookup;
    }

    /**
     * Recent uploads for a UC… id, newest first. Empty array on any failure.
     *
     * The full feed is cached and sliced per call, so asking for 1 and then 15
     * of the same channel costs one fetch. `fresh` skips the cache, which is
     * what the dashboard's Refresh button means.
     */
    async function fetchLatestVideos(channelId, limit = 15, { fresh = false } = {}) {
        if (!channelId) return [];

        const hit = feedCache.get(channelId);
        if (!fresh && hit && Date.now() - hit.at < FEED_TTL_MS) return hit.videos.slice(0, limit);

        try {
            const response = await fetch(FEED_URL + encodeURIComponent(channelId), { credentials: 'omit' });
            if (!response.ok) return [];
            const videos = parseFeed(await response.text());
            feedCache.set(channelId, { at: Date.now(), videos });
            return videos.slice(0, limit);
        } catch (_) {
            // A failed fetch is not cached: the next call should try again.
            return [];
        }
    }

    /** Drop everything cached in memory. Used by the tests. */
    function forget() {
        feedCache.clear();
        inflight.clear();
        idCachePromise = null;
    }

    /** Parse a YouTube channel RSS document into video records. */
    function parseFeed(xml) {
        if (typeof DOMParser === 'undefined') return [];
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        if (doc.querySelector('parsererror')) return [];

        const text = (entry, tag) => {
            const el = entry.getElementsByTagName(tag)[0];
            return el ? (el.textContent || '').trim() : '';
        };

        return Array.from(doc.getElementsByTagName('entry'))
            .map((entry) => {
                const id = text(entry, 'yt:videoId');
                if (!id) return null;
                const publishedText = text(entry, 'published');
                const thumbEl = entry.getElementsByTagName('media:thumbnail')[0];
                return {
                    id,
                    title: text(entry, 'title') || `Video ${id}`,
                    url: YouTube.watchUrl(id, 0),
                    thumb: (thumbEl && thumbEl.getAttribute('url')) || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
                    published: publishedText ? new Date(publishedText).getTime() : 0,
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.published - a.published);
    }

    /**
     * Latest uploads across `channels`, newest first. Each channel contributes
     * at most `perChannel` videos; failures are skipped rather than fatal.
     * `fresh` bypasses the feed cache for callers that mean "go and look now".
     */
    async function fetchLatestForChannels(channels, perChannel = 1, { fresh = false } = {}) {
        const results = await Promise.all((channels || []).map(async (channel) => {
            const id = await resolveChannelId(channel);
            if (!id) return [];
            const videos = await fetchLatestVideos(id, perChannel, { fresh });
            return videos.map((video) => ({
                ...video,
                channelId: channel.id,
                channelName: channel.name,
            }));
        }));
        return results.flat().sort((a, b) => b.published - a.published);
    }

    const Feed = {
        resolveChannelId, fetchLatestVideos, fetchLatestForChannels,
        parseFeed, ownChannelId, forget, FEED_TTL_MS,
    };

    root.BB = root.BB || {};
    root.BB.Feed = Feed;
    if (typeof module !== 'undefined' && module.exports) module.exports = Feed;
})(typeof globalThis !== 'undefined' ? globalThis : this);
