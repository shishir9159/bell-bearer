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

    /** In-process copy, so a render does not go to storage per card. */
    let cache = null;

    async function load() {
        if (cache) return cache;
        try {
            const stored = await chrome.storage.local.get([KEY]);
            const map = stored[KEY];
            cache = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
        } catch (_) {
            cache = {};
        }
        return cache;
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
     * Mark one or more videos watched. Resolves to the map, already updated in
     * the in-process copy so the caller can re-render without waiting.
     */
    async function mark(videoIds) {
        const ids = (Array.isArray(videoIds) ? videoIds : [videoIds]).filter(Boolean);
        if (ids.length === 0) return load();

        const map = await load();
        const now = Date.now();
        let changed = false;
        for (const id of ids) {
            if (map[id]) continue;
            map[id] = now;
            changed = true;
        }
        if (!changed) return map;

        cache = prune(map);
        const snapshot = cache;
        const write = () => chrome.storage.local.set({ [KEY]: snapshot });
        writeChain = writeChain.then(write, write).catch((error) => {
            console.error('Bell Bearer: could not record watched videos', error);
        });
        return cache;
    }

    async function clear() {
        cache = {};
        try {
            await chrome.storage.local.set({ [KEY]: {} });
        } catch (_) { /* context gone */ }
    }

    const Watched = { KEY, LIMIT, load, mark, clear, prune };

    root.BB = root.BB || {};
    root.BB.Watched = Watched;
    if (typeof module !== 'undefined' && module.exports) module.exports = Watched;
})(typeof globalThis !== 'undefined' ? globalThis : this);
