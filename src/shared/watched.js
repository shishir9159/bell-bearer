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
 *
 * No copy of the map is kept between reads. One used to be, dropped on every
 * change from any tab, but the map is only read when the pouch sheet opens —
 * the cards are checked against the map handed over then — so it cost every
 * YouTube tab a storage listener for a read it seldom saved.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Store = ns.Store || req('./store.js');

    const KEY = Settings.DATA.watched;

    /**
     * How many ids to keep. A feed only ever reaches back a few hundred videos
     * per channel, so forgetting the oldest marks costs nothing; letting the
     * map grow forever would eventually make every read of it expensive.
     */
    const LIMIT = 4000;

    /**
     * A failed read is never taken for an empty map and written back over the
     * marks: Store.update reads without a fallback for exactly that reason.
     */
    const store = Store.create({
        keys: [KEY],
        name: 'watched videos',
        // A copy: the pouch sheet writes its own marks into what it is handed.
        read: (stored) => {
            const map = stored[KEY];
            return (map && typeof map === 'object' && !Array.isArray(map)) ? { ...map } : {};
        },
        blank: () => ({}),
    });

    const { load } = store;

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
     * Checked against storage as the step reads it, not against anything
     * load() handed out. The pouch sheet sets its own mark in the map it was
     * given before calling this, so a mark checked against that copy found its
     * id already there and was never written at all.
     */
    function mark(videoIds) {
        const ids = (Array.isArray(videoIds) ? videoIds : [videoIds]).filter(Boolean);
        if (ids.length === 0) return load();

        return store.update((map) => {
            const now = Date.now();
            const fresh = ids.filter((id) => !map[id]);
            if (fresh.length === 0) return map;
            for (const id of fresh) map[id] = now;
            return prune(map);
        });
    }

    const clear = () => store.save({});

    const Watched = { KEY, LIMIT, load, mark, clear, prune };

    root.BB = root.BB || {};
    root.BB.Watched = Watched;
    if (typeof module !== 'undefined' && module.exports) module.exports = Watched;
})(typeof globalThis !== 'undefined' ? globalThis : this);
