/**
 * Channel feeds: resolve a channel URL to its UC… id and read its public RSS.
 *
 * Lives in shared/ because both the on-page "Latest by topic" overlay and the
 * dashboard's "Refresh" need it — the dashboard button previously just showed
 * an alert telling the user to go and look at YouTube themselves.
 *
 * Three things here exist for the sake of a large pouch. With a hundred
 * channels filed, the naive version — Promise.all over every channel, memory
 * caches only, one answer at the end — opened three hundred sockets at once,
 * went back to the network for everything after every browser restart, and
 * showed nothing at all until the slowest feed came back.
 *
 *   - `mapLimit` holds the number of feeds in flight to MAX_PARALLEL.
 *   - The parsed feeds are written to storage, so a restart starts warm.
 *   - `fetchLatestForChannels` takes an `onProgress` callback and calls it as
 *     each channel lands, so a surface can draw the first row while the rest
 *     are still arriving, and `peekLatestForChannels` answers from cache alone
 *     for the frame before any of that starts.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const YouTube = ns.YouTube || req('./youtube.js');

    const CACHE_KEY = Settings.DATA.channelIdCache;
    const FEED_CACHE_KEY = Settings.DATA.feedCache;
    const LEGACY_CACHE_KEY = 'bbChannelIdCache';
    const CHANNEL_FEED_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
    const PLAYLIST_FEED_URL = 'https://www.youtube.com/feeds/videos.xml?playlist_id=';

    /**
     * How many feeds to have in flight at once.
     *
     * Chrome caps connections per host at six, so asking for more than that
     * does not fetch anything sooner — it only queues inside the network stack
     * where nothing can report progress, and on a slow connection it starves
     * the page the overlay is sitting on top of.
     */
    const MAX_PARALLEL = 6;

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

    /**
     * How long a feed is worth keeping on disk at all. Past this it is dropped
     * on the way in rather than shown: a week-old snapshot presented as "the
     * latest" is worse than an empty grid that fills in a second later.
     */
    const DISK_KEEP_MS = 24 * 60 * 60 * 1000;

    /** At most this many feeds on disk, newest kept. See writeFeedCache. */
    const DISK_MAX_ENTRIES = 400;

    const feedCache = new Map(); // cache key -> { at, videos }

    const channelKey = (id) => 'c:' + id;
    const playlistKey = (id) => 'p:' + id;

    /**
     * Pull the stored feeds into memory, once.
     *
     * Everything that reads the cache awaits this first, so the very first
     * pouch open after a browser restart answers from disk in a frame or two
     * instead of refetching every channel the user has ever filed.
     */
    let hydration = null;

    function hydrate() {
        if (!hydration) {
            hydration = (async () => {
                try {
                    const stored = (await chrome.storage.local.get([FEED_CACHE_KEY]))[FEED_CACHE_KEY];
                    if (!stored || typeof stored !== 'object') return;

                    const cutoff = Date.now() - DISK_KEEP_MS;
                    for (const key of Object.keys(stored)) {
                        const entry = stored[key];
                        if (!entry || !Array.isArray(entry.videos) || !(entry.at > cutoff)) continue;
                        if (!feedCache.has(key)) feedCache.set(key, entry);
                    }
                } catch (_) { /* the cache is an optimisation, not a requirement */ }
            })();
        }
        return hydration;
    }

    /**
     * Write the cache back, coalesced.
     *
     * Refreshing a hundred channels lands a hundred times in a few seconds, and
     * each write serialises the whole map; without the timer that is a hundred
     * serialisations of a growing object on the storage thread.
     */
    let writeTimer = null;

    function scheduleFeedWrite() {
        if (writeTimer) return;
        writeTimer = setTimeout(() => {
            writeTimer = null;
            writeFeedCache();
        }, 2000);
    }

    async function writeFeedCache() {
        const entries = Array.from(feedCache.entries())
            .sort((a, b) => b[1].at - a[1].at)
            .slice(0, DISK_MAX_ENTRIES);

        const out = {};
        for (const [key, entry] of entries) out[key] = entry;

        try {
            await chrome.storage.local.set({ [FEED_CACHE_KEY]: out });
        } catch (_) { /* context gone, or quota — neither is worth reporting */ }
    }

    /**
     * Run `worker` over `items`, at most MAX_PARALLEL at a time, resolving to
     * the results in the order the items were given.
     *
     * Workers share one moving index rather than being sliced into batches:
     * batching would make every batch as slow as its slowest feed, which is
     * exactly the stall this is here to avoid.
     */
    async function mapLimit(items, limit, worker) {
        const list = Array.from(items || []);
        const results = new Array(list.length);
        let next = 0;

        const run = async () => {
            while (next < list.length) {
                const index = next++;
                results[index] = await worker(list[index], index);
            }
        };

        const runners = [];
        for (let i = 0; i < Math.min(limit, list.length); i++) runners.push(run());
        await Promise.all(runners);
        return results;
    }

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

        // A subscribed channel arrives with its UC id already known; there is
        // no page to fetch for it at all.
        if (channel && /^UC[\w-]{20,}$/.test(channel.id || '')) return channel.id;

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
                scheduleIdWrite();
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
     * The id map is written the same coalesced way as the feed cache, and for
     * the same reason: resolving fifty handles at once wrote the whole map
     * fifty times.
     */
    let idWriteTimer = null;

    function scheduleIdWrite() {
        if (idWriteTimer) return;
        idWriteTimer = setTimeout(async () => {
            idWriteTimer = null;
            try {
                await chrome.storage.local.set({ [CACHE_KEY]: await idCache() });
            } catch (_) { /* cache is an optimisation, not a requirement */ }
        }, 1500);
    }

    /**
     * Fetch and parse one feed URL into the cache under `key`. Empty array on
     * any failure, and a failure is never cached: the next call should retry.
     */
    async function fetchFeed(key, url, limit, fresh) {
        await hydrate();

        const hit = feedCache.get(key);
        if (!fresh && hit && Date.now() - hit.at < FEED_TTL_MS) return hit.videos.slice(0, limit);

        try {
            const response = await fetch(url, { credentials: 'omit' });
            if (!response.ok) return hit ? hit.videos.slice(0, limit) : [];

            const videos = parseFeed(await response.text());
            feedCache.set(key, { at: Date.now(), videos });
            scheduleFeedWrite();
            return videos.slice(0, limit);
        } catch (_) {
            return hit ? hit.videos.slice(0, limit) : [];
        }
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
        return fetchFeed(channelKey(channelId), CHANNEL_FEED_URL + encodeURIComponent(channelId), limit, fresh);
    }

    /** The same, for a playlist's own feed — what shared/playlists.js follows. */
    async function fetchPlaylistVideos(playlistId, limit = 30, { fresh = false } = {}) {
        if (!playlistId) return [];
        return fetchFeed(playlistKey(playlistId), PLAYLIST_FEED_URL + encodeURIComponent(playlistId), limit, fresh);
    }

    /** Drop everything cached in memory. Used by the tests. */
    function forget() {
        feedCache.clear();
        inflight.clear();
        idCachePromise = null;
        hydration = null;
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
                    // A playlist feed carries the uploader, which the pouch's
                    // playlist section shows in place of a channel name.
                    author: text(entry, 'name'),
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.published - a.published);
    }

    /** Stamp a channel's own videos with who they came from. */
    function tag(videos, channel) {
        return videos.map((video) => ({
            ...video,
            channelId: channel.id,
            channelName: channel.name,
        }));
    }

    /**
     * Whatever is already cached for `channels`, however old, without touching
     * the network. This is what a surface draws in its first frame; the real
     * fetch then replaces it.
     */
    async function peekLatestForChannels(channels, perChannel = 1) {
        const [, ids] = await Promise.all([hydrate(), idCache()]);

        const out = [];
        for (const channel of channels || []) {
            // Only what is already known: the canonical id in the URL, the id
            // a subscribed channel arrives with, or one resolved on an earlier
            // run. A handle never seen before is left for the real fetch.
            const id = YouTube.extractCanonicalChannelId(channel.url || '') ||
                (/^UC[\w-]{20,}$/.test(channel.id || '') ? channel.id : null) ||
                ids[channel.url];
            const hit = id && feedCache.get(channelKey(id));
            if (hit) out.push(...tag(hit.videos.slice(0, perChannel), channel));
        }
        return out.sort((a, b) => b.published - a.published);
    }

    /**
     * Latest uploads across `channels`, newest first. Each channel contributes
     * at most `perChannel` videos; failures are skipped rather than fatal.
     *
     * `fresh` bypasses the feed cache for callers that mean "go and look now".
     * `onProgress(videos, done, total)` is called as each channel lands, with
     * that channel's videos — a caller with a hundred channels can render the
     * first of them a second in rather than waiting for the hundredth.
     */
    async function fetchLatestForChannels(channels, perChannel = 1, { fresh = false, onProgress } = {}) {
        const list = Array.from(channels || []);
        let done = 0;

        const results = await mapLimit(list, MAX_PARALLEL, async (channel) => {
            let videos = [];
            try {
                const id = await resolveChannelId(channel);
                if (id) videos = tag(await fetchLatestVideos(id, perChannel, { fresh }), channel);
            } catch (_) {
                videos = [];
            }

            done += 1;
            if (onProgress) {
                try {
                    onProgress(videos, done, list.length);
                } catch (error) {
                    console.error('Bell Bearer: feed progress handler failed', error);
                }
            }
            return videos;
        });

        return results.flat().sort((a, b) => b.published - a.published);
    }

    /**
     * Resolve and cache `channels` in the background, without anyone waiting.
     *
     * The drawer entry is on the page from the moment YouTube's own nav is, so
     * by the time it is clicked the feeds should already be in hand. Failures
     * are swallowed: nothing is on screen to report them to.
     */
    function warm(channels, perChannel = 15) {
        const list = Array.from(channels || []);
        if (list.length === 0) return Promise.resolve([]);
        return fetchLatestForChannels(list, perChannel).catch(() => []);
    }

    const Feed = {
        resolveChannelId, fetchLatestVideos, fetchPlaylistVideos,
        fetchLatestForChannels, peekLatestForChannels, warm,
        parseFeed, ownChannelId, forget, mapLimit,
        FEED_TTL_MS, MAX_PARALLEL,
    };

    root.BB = root.BB || {};
    root.BB.Feed = Feed;
    if (typeof module !== 'undefined' && module.exports) module.exports = Feed;
})(typeof globalThis !== 'undefined' ? globalThis : this);
