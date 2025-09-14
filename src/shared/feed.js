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
    const FEED_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

    /** In-flight and completed lookups, so N cards for one channel fetch once. */
    const inflight = new Map();

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
            let cache = {};
            try {
                cache = (await chrome.storage.local.get([CACHE_KEY]))[CACHE_KEY] || {};
            } catch (_) { /* context invalidated — fall through to the network */ }
            if (cache[url]) return cache[url];

            try {
                const response = await fetch(url, { credentials: 'omit' });
                if (!response.ok) return null;
                const html = await response.text();
                const match = html.match(/"channelId":"(UC[\w-]{20,})"/) ||
                    html.match(/\/channel\/(UC[\w-]{20,})/);
                if (!match) return null;

                try {
                    await chrome.storage.local.set({ [CACHE_KEY]: { ...cache, [url]: match[1] } });
                } catch (_) { /* cache is an optimisation, not a requirement */ }
                return match[1];
            } catch (_) {
                return null;
            }
        })();

        inflight.set(url, lookup);
        // Keep successes cached in memory; retry failures on the next call.
        lookup.then((id) => { if (!id) inflight.delete(url); }, () => inflight.delete(url));
        return lookup;
    }

    /** Recent uploads for a UC… id, newest first. Empty array on any failure. */
    async function fetchLatestVideos(channelId, limit = 15) {
        if (!channelId) return [];
        try {
            const response = await fetch(FEED_URL + encodeURIComponent(channelId), { credentials: 'omit' });
            if (!response.ok) return [];
            return parseFeed(await response.text()).slice(0, limit);
        } catch (_) {
            return [];
        }
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
     */
    async function fetchLatestForChannels(channels, perChannel = 1) {
        const results = await Promise.all((channels || []).map(async (channel) => {
            const id = await resolveChannelId(channel);
            if (!id) return [];
            const videos = await fetchLatestVideos(id, perChannel);
            return videos.map((video) => ({
                ...video,
                channelId: channel.id,
                channelName: channel.name,
            }));
        }));
        return results.flat().sort((a, b) => b.published - a.published);
    }

    const Feed = { resolveChannelId, fetchLatestVideos, fetchLatestForChannels, parseFeed };

    root.BB = root.BB || {};
    root.BB.Feed = Feed;
    if (typeof module !== 'undefined' && module.exports) module.exports = Feed;
})(typeof globalThis !== 'undefined' ? globalThis : this);
