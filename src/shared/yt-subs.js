/**
 * The account's own YouTube subscriptions.
 *
 * The pouch is a curated thing — a few channels filed under a topic — but
 * "show me everything I subscribe to" is the obvious question to ask of the
 * same surface, and no extension API answers it. What there is is
 * youtube.com/feed/channels, which lists them for a signed-in session; this
 * reads that page once and caches the answer.
 *
 * Only the channel id, name and URL are taken. The result is fed straight back
 * into shared/feed.js, which knows how to turn a UC… id into an RSS feed, so a
 * subscribed channel and a pouch channel go down the same path from here on.
 *
 * Two things are worth knowing about the fetch:
 *   - It must carry cookies (`credentials: 'include'`), or YouTube serves the
 *     signed-out page and the list comes back empty.
 *   - It is a megabyte of HTML for a list of names, so the answer is cached in
 *     storage for TTL_MS and the network is not touched again until it lapses.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    const KEY = Settings.DATA.subscribed;
    const PAGE_URL = 'https://www.youtube.com/feed/channels';

    /** Six hours. Subscribing to a channel is not done every minute. */
    const TTL_MS = 6 * 60 * 60 * 1000;

    /** The renderers YouTube uses for one channel in the subscriptions grid. */
    const CHANNEL_RENDERERS = ['channelRenderer', 'gridChannelRenderer'];

    /** One in-flight read at a time: the sheet and the dashboard may both ask. */
    let inflight = null;

    /**
     * Pull `ytInitialData` out of the page.
     *
     * A regex for the whole object does not work — the JSON contains braces
     * inside strings, and the document carries several other assignments — so
     * this finds the start and counts braces, skipping over string literals
     * and their escapes. It is the only way to get a self-terminating answer
     * without a JS parser.
     */
    function extractInitialData(html) {
        const text = String(html || '');
        const start = text.indexOf('ytInitialData');
        if (start === -1) return null;

        const open = text.indexOf('{', start);
        if (open === -1) return null;

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = open; i < text.length; i++) {
            const ch = text[i];

            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }

            if (ch === '"') inString = true;
            else if (ch === '{') depth++;
            else if (ch === '}' && --depth === 0) {
                try {
                    return JSON.parse(text.slice(open, i + 1));
                } catch (_) {
                    return null;
                }
            }
        }
        return null;
    }

    /** YouTube writes text as either `{simpleText}` or `{runs:[{text}]}`. */
    function readText(node) {
        if (!node) return '';
        if (typeof node === 'string') return node;
        if (typeof node.simpleText === 'string') return node.simpleText;
        if (Array.isArray(node.runs)) return node.runs.map((run) => run.text || '').join('');
        return '';
    }

    function canonicalUrl(renderer, channelId) {
        const path = renderer.canonicalBaseUrl ||
            (renderer.navigationEndpoint &&
                renderer.navigationEndpoint.browseEndpoint &&
                renderer.navigationEndpoint.browseEndpoint.canonicalBaseUrl);
        if (path) {
            try {
                return new URL(path, 'https://www.youtube.com').href;
            } catch (_) { /* fall through to the /channel/ form */ }
        }
        return 'https://www.youtube.com/channel/' + channelId;
    }

    /**
     * Walk the parsed response for channel renderers.
     *
     * Recursion over the tree rather than a regex over the text: the page
     * mentions a dozen channel ids that are not subscriptions (the viewer's own
     * account in the masthead, anything recommended in a shelf), and only the
     * renderers named above are rows in the subscription grid.
     */
    function collectChannels(data) {
        const found = new Map();

        const visit = (node) => {
            if (!node || typeof node !== 'object') return;

            if (Array.isArray(node)) {
                node.forEach(visit);
                return;
            }

            for (const key of Object.keys(node)) {
                const value = node[key];
                if (CHANNEL_RENDERERS.indexOf(key) !== -1 && value && typeof value === 'object' &&
                    typeof value.channelId === 'string' && /^UC[\w-]{20,}$/.test(value.channelId) &&
                    !found.has(value.channelId)) {
                    found.set(value.channelId, {
                        id: value.channelId,
                        name: readText(value.title) || 'Unknown Channel',
                        url: canonicalUrl(value, value.channelId),
                    });
                }
                visit(value);
            }
        };

        visit(data);
        return Array.from(found.values());
    }

    /** Parse a fetched /feed/channels document. Exported for the tests. */
    function parseSubscriptionsPage(html) {
        const data = extractInitialData(html);
        return data ? collectChannels(data) : [];
    }

    async function readCache() {
        try {
            const stored = await chrome.storage.local.get([KEY]);
            const entry = stored[KEY];
            if (!entry || !Array.isArray(entry.channels)) return null;
            return entry;
        } catch (_) {
            return null;
        }
    }

    /** A lapsed cache still beats nothing when the fetch could not be made. */
    async function staleOrEmpty() {
        const cached = await readCache();
        return cached ? cached.channels : [];
    }

    /**
     * Every channel the account subscribes to, as pouch-shaped records.
     *
     * `fresh` skips the cache. An empty result is deliberately not cached —
     * signed out, or a page shape we no longer recognise — so the next call
     * tries again rather than reporting "no subscriptions" for six hours.
     */
    async function list({ fresh = false } = {}) {
        if (!fresh) {
            const cached = await readCache();
            if (cached && Date.now() - cached.at < TTL_MS) return cached.channels;
        }

        if (inflight) return inflight;

        inflight = (async () => {
            try {
                const response = await fetch(PAGE_URL, { credentials: 'include' });
                if (!response.ok) return await staleOrEmpty();

                const channels = parseSubscriptionsPage(await response.text());
                if (channels.length === 0) return await staleOrEmpty();

                try {
                    await chrome.storage.local.set({ [KEY]: { at: Date.now(), channels } });
                } catch (_) { /* the cache is an optimisation */ }
                return channels;
            } catch (_) {
                return await staleOrEmpty();
            } finally {
                inflight = null;
            }
        })();

        return inflight;
    }

    /** How many are known without going to the network. */
    async function cachedCount() {
        const cached = await readCache();
        return cached ? cached.channels.length : 0;
    }

    const YtSubs = {
        KEY, TTL_MS, PAGE_URL,
        list, cachedCount, parseSubscriptionsPage, extractInitialData, readText,
    };

    root.BB = root.BB || {};
    root.BB.YtSubs = YtSubs;
    if (typeof module !== 'undefined' && module.exports) module.exports = YtSubs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
