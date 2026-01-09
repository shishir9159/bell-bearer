/**
 * Pinned checkpoint cards.
 *
 * The dashboard's sort order is a user choice, but a handful of videos are the
 * ones being worked through right now and should not slide down the list every
 * time a newer checkpoint is saved. A pin lifts a card above the sort without
 * changing it, which is why this is a separate list of ids rather than a flag
 * on the video: the bookmark store is exported and imported, and a pin is a
 * view preference on this machine, not part of the data.
 *
 * Order matters — the list is newest-pin-first, so the most recently pinned
 * card sits at the very top.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Store = ns.Store || req('./store.js');

    const KEY = Settings.DATA.pinned;

    const store = Store.create({
        keys: [KEY],
        read: (stored) => (Array.isArray(stored[KEY]) ? stored[KEY].filter((id) => typeof id === 'string') : []),
        blank: () => [],
        name: 'pins',
    });

    const { load, save } = store;

    /** Pin if unpinned, unpin if pinned. Resolves to the new list. */
    function toggle(videoId) {
        return store.update((ids) => (ids.includes(videoId)
            ? ids.filter((id) => id !== videoId)
            : [videoId, ...ids]));
    }

    /**
     * Order `videos` with the pinned ones first, in pin order, and everything
     * else left as `rest` gave it. Taking the already-sorted list keeps the
     * sort and the pinning independent of each other.
     */
    function hoist(videos, pinnedIds) {
        if (!pinnedIds || pinnedIds.length === 0) return videos;

        const rank = new Map(pinnedIds.map((id, index) => [id, index]));
        const pinned = [];
        const rest = [];
        for (const video of videos) {
            if (rank.has(video.id)) pinned.push(video);
            else rest.push(video);
        }
        pinned.sort((a, b) => rank.get(a.id) - rank.get(b.id));
        return pinned.concat(rest);
    }

    const Pins = { KEY, load, save, toggle, hoist };

    root.BB = root.BB || {};
    root.BB.Pins = Pins;
    if (typeof module !== 'undefined' && module.exports) module.exports = Pins;
})(typeof globalThis !== 'undefined' ? globalThis : this);
