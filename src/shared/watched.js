/**
 * Which videos have already been watched.
 *
 * The pouch exists to show what is new, so a video the user has already seen is
 * noise in it. YouTube's own watch history is not readable from an extension
 * without the account API, so this keeps its own small note: a video is marked
 * when it is opened from the pouch, and again when the content script has seen
 * it actually play for a while on a watch page.
 *
 * Shape on disk, under `bbWatchedVideos`:
 *   { "<videoId>": <ms since epoch>, … }
 *
 * A flat map rather than a list: the pouch asks "is this one watched" once per
 * card, and with a few hundred channels in the pouch that is thousands of
 * lookups per render.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    const KEY = Settings.DATA.watched;

    /**
     * How many ids to keep. A feed only ever reaches back a few hundred videos
     * per channel, so forgetting the oldest marks costs nothing; letting the
     * map grow forever would eventually make every read of it expensive.
     */
    const LIMIT = 4000;

    let writeChain = Promise.resolve();

    /**
     * In-process copy, so a render does not go to storage per card. Dropped
     * whenever the key changes, from any tab: it used to live as long as the
     * page, so a second YouTube tab kept marking against the map it read at
     * load and wrote over whatever the first had added since.
     */
    let cache = null;
    let unwatch = null;

    /** Throws when storage does: mark() must not take a failed read for an empty map and write that back. */
    async function read() {
        const map = (await chrome.storage.local.get([KEY]))[KEY];
        return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    }

    /** A copy: the pouch sheet writes its own marks into what it is handed. */
    async function load() {
        if (!unwatch) unwatch = Settings.watch([KEY], () => { cache = null; });
        if (!cache) {
            try { cache = await read(); } catch (_) { return {}; }
        }
        return { ...cache };
    }

    /** Drop the oldest marks once the map is over LIMIT. */
    function prune(map) {
        const ids = Object.keys(map);
        if (ids.length <= LIMIT) return map;

        ids.sort((a, b) => map[b] - map[a]);
        const kept = {};
        for (let i = 0; i < LIMIT; i++) kept[ids[i]] = map[ids[i]];
        return kept;
    }

    /**
     * Mark one or more videos watched. Resolves to the map once it is written.
     *
     * Read from storage, not from the cache, and written in the same step.
     * The cache is also what load() used to hand the pouch sheet, which sets
     * its own mark in it before calling this — so a mark made from the sheet
     * found its id already there and was never written at all.
     */
    async function mark(videoIds) {
        const ids = (Array.isArray(videoIds) ? videoIds : [videoIds]).filter(Boolean);
        if (ids.length === 0) return load();

        const run = async () => {
            const map = await read();
            const now = Date.now();
            let changed = false;
            for (const id of ids) {
                if (map[id]) continue;
                map[id] = now;
                changed = true;
            }
            const next = changed ? prune(map) : map;
            if (changed) await chrome.storage.local.set({ [KEY]: next });
            cache = next;
            return { ...next };
        };
        writeChain = writeChain.then(run, run).catch((error) => {
            console.error('Bell Bearer: could not record watched videos', error);
            return {};
        });
        return writeChain;
    }

    async function clear() {
        const run = async () => {
            cache = {};
            try {
                await chrome.storage.local.set({ [KEY]: {} });
            } catch (_) { /* context gone */ }
        };
        writeChain = writeChain.then(run, run);
        return writeChain;
    }

    const Watched = { KEY, LIMIT, load, mark, clear, prune };

    root.BB = root.BB || {};
    root.BB.Watched = Watched;
    if (typeof module !== 'undefined' && module.exports) module.exports = Watched;
})(typeof globalThis !== 'undefined' ? globalThis : this);
