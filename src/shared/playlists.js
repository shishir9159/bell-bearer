/**
 * Playlists followed for new entries.
 *
 * A channel in the pouch answers "what has this person published"; a followed
 * playlist answers "what has been *added* to this list", which is a different
 * question and often the more useful one — a course, a label's releases, a
 * friend's running mix. YouTube has no notification for it at all.
 *
 * The trick is what counts as new. A playlist's feed is just its current
 * contents, so the ids present at the moment it is followed are recorded as
 * already seen; anything that appears later is new until the user opens it or
 * clears the section. That is why `seen` is part of the record rather than
 * something derived.
 *
 * Shape on disk, under `bbPlaylists`:
 *   [{ id, title, url, addedAt, checkedAt, seen: [videoId, …] }]
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    const KEY = Settings.DATA.playlists;

    /**
     * How many ids to remember per playlist. A playlist RSS feed returns at
     * most a page of entries, so anything beyond a few hundred can never come
     * back round as a false "new" — and an unbounded list on a playlist with
     * ten thousand videos is a quarter-megabyte of storage per row.
     */
    const SEEN_LIMIT = 400;

    let writeChain = Promise.resolve();

    async function load() {
        try {
            const stored = await chrome.storage.local.get([KEY]);
            const list = stored[KEY];
            if (!Array.isArray(list)) return [];
            return list
                .filter((entry) => entry && typeof entry.id === 'string')
                .map((entry) => ({
                    ...entry,
                    title: entry.title || 'Playlist',
                    seen: Array.isArray(entry.seen) ? entry.seen : [],
                }));
        } catch (_) {
            return [];
        }
    }

    /** Read-modify-write as one atomic step, as the other stores do. */
    async function update(mutate) {
        const run = async () => {
            const list = await load();
            const next = (await mutate(list)) || list;
            await chrome.storage.local.set({ [KEY]: next });
            return next;
        };
        writeChain = writeChain.then(run, run).catch((error) => {
            console.error('Bell Bearer: could not update playlists', error);
            return [];
        });
        return writeChain;
    }

    const has = (list, playlistId) => (list || []).some((entry) => entry.id === playlistId);

    /**
     * Follow a playlist. `videoIds` is what it holds right now — recorded as
     * already seen, so following does not immediately report every entry as new.
     * Following one already followed just refreshes its title.
     */
    async function add({ id, title, url, videoIds }) {
        if (!id) return null;

        const record = {
            id,
            title: String(title || '').trim() || 'Playlist',
            url: url || playlistUrl(id),
            addedAt: Date.now(),
            checkedAt: Date.now(),
            seen: (videoIds || []).slice(0, SEEN_LIMIT),
        };

        await update((list) => {
            const index = list.findIndex((entry) => entry.id === id);
            if (index === -1) return [...list, record];

            const next = list.slice();
            next[index] = { ...next[index], title: record.title, url: record.url };
            return next;
        });
        return id;
    }

    async function remove(playlistId) {
        await update((list) => list.filter((entry) => entry.id !== playlistId));
    }

    /** Fold ids into a playlist's seen list, newest kept. */
    async function markSeen(playlistId, videoIds) {
        const ids = (Array.isArray(videoIds) ? videoIds : [videoIds]).filter(Boolean);
        if (ids.length === 0) return;

        await update((list) => list.map((entry) => {
            if (entry.id !== playlistId) return entry;
            const seen = [...ids, ...entry.seen.filter((id) => ids.indexOf(id) === -1)];
            return { ...entry, checkedAt: Date.now(), seen: seen.slice(0, SEEN_LIMIT) };
        }));
    }

    /** Mark every playlist's current new entries as seen. */
    async function markAllSeen(entries) {
        const byPlaylist = new Map();
        for (const entry of entries || []) {
            if (!byPlaylist.has(entry.playlistId)) byPlaylist.set(entry.playlistId, []);
            byPlaylist.get(entry.playlistId).push(entry.id);
        }
        for (const [playlistId, ids] of byPlaylist) await markSeen(playlistId, ids);
    }

    function playlistUrl(playlistId) {
        return 'https://www.youtube.com/playlist?list=' + encodeURIComponent(playlistId);
    }

    /**
     * Entries added to `playlists` since they were last looked at, newest first.
     *
     * Takes the Feed module rather than importing it, because this file is
     * loaded by the popup and the dashboard as well as the content script and
     * only one of those has a reason to hit the network.
     */
    async function newEntries(playlists, Feed, { fresh = false, limit = 30 } = {}) {
        const lists = playlists || [];
        if (lists.length === 0) return [];

        const read = async (playlist) => {
            const videos = await Feed.fetchPlaylistVideos(playlist.id, SEEN_LIMIT, { fresh });
            const seen = new Set(playlist.seen);
            return videos
                .filter((video) => !seen.has(video.id))
                .map((video) => ({
                    ...video,
                    playlistId: playlist.id,
                    playlistTitle: playlist.title,
                }));
        };

        // Through the feed module's own limiter where there is one, for the
        // reason it exists: someone following forty playlists should not open
        // forty sockets at once any more than someone with forty channels.
        const perPlaylist = Feed.mapLimit
            ? await Feed.mapLimit(lists, Feed.MAX_PARALLEL || 6, read)
            : await Promise.all(lists.map(read));

        return perPlaylist
            .flat()
            .sort((a, b) => b.published - a.published)
            .slice(0, limit);
    }

    const Playlists = {
        KEY, SEEN_LIMIT,
        load, update, has, add, remove, markSeen, markAllSeen, newEntries, playlistUrl,
    };

    root.BB = root.BB || {};
    root.BB.Playlists = Playlists;
    if (typeof module !== 'undefined' && module.exports) module.exports = Playlists;
})(typeof globalThis !== 'undefined' ? globalThis : this);
