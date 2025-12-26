/**
 * The bookmark store: load, save, merge, import and export.
 *
 * popup.js and dashboard.js each carried their own copy of this logic (merge,
 * validate, parse, export — around two hundred duplicated lines), which is how
 * they drifted apart: the popup de-duplicated on import while the content
 * script appended blindly. One implementation now backs all three surfaces.
 *
 * Shape on disk, under `youtubeBookmarks`:
 *   [{ id, title, url, bookmarks: [{ id?, time, start?, end?, timestamp, note,
 *                                    title?, subtitle? }] }]
 *
 * A checkpoint's own `id` is newer than the store. Everything written before
 * it has none, and nothing is rewritten to give it one — see sameCheckpoint
 * for how the two generations live side by side.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const YouTube = ns.YouTube || req('./youtube.js');

    const KEY = Settings.DATA.bookmarks;
    const EXPORT_VERSION = '1.0';

    /**
     * Writes are serialized through this chain.
     *
     * Every writer used to do read-modify-write against chrome.storage with no
     * coordination, so a checkpoint saved while the dashboard was also saving
     * lost whichever write finished first. Chaining onto the previous write
     * keeps read-modify-write pairs atomic with respect to each other.
     */
    let writeChain = Promise.resolve();

    async function load() {
        try {
            const result = await chrome.storage.local.get([KEY]);
            return normalizeVideos(result[KEY]);
        } catch (_) {
            return [];
        }
    }

    async function save(videos) {
        const write = () => chrome.storage.local.set({ [KEY]: videos });
        writeChain = writeChain.then(write, write).catch((error) => {
            console.error('Bell Bearer: could not save bookmarks', error);
        });
        return writeChain;
    }

    /** Read, transform and write back as one atomic step. */
    async function update(mutate) {
        const run = async () => {
            const videos = await load();
            const next = (await mutate(videos)) || videos;
            await chrome.storage.local.set({ [KEY]: next });
            return next;
        };
        // A failed write answers with what is stored rather than an empty
        // list: the popup and the dashboard draw what this resolves to, and
        // [] drew every checkpoint as gone when none had been touched.
        writeChain = writeChain.then(run, run).catch((error) => {
            console.error('Bell Bearer: could not update bookmarks', error);
            return load();
        });
        return writeChain;
    }

    /** Drop anything that does not match the on-disk shape. */
    function normalizeVideos(raw) {
        if (!Array.isArray(raw)) return [];
        return raw
            .filter((video) => video && video.id && Array.isArray(video.bookmarks))
            .map((video) => ({
                ...video,
                title: video.title || `Video ${video.id}`,
                url: video.url || YouTube.watchUrl(video.id, 0),
                bookmarks: video.bookmarks.filter(isBookmark).sort(byTime),
            }));
    }

    function isBookmark(bookmark) {
        return !!bookmark && (typeof bookmark.time === 'number' || typeof bookmark.start === 'number');
    }

    /** A checkpoint's position: `time` for a point, `start` for a range. */
    function bookmarkTime(bookmark) {
        return typeof bookmark.time === 'number' ? bookmark.time : bookmark.start;
    }

    function byTime(a, b) {
        return bookmarkTime(a) - bookmarkTime(b);
    }

    let idCounter = 0;

    /**
     * A fresh checkpoint id — the same shape x-pouch.js mints. The counter
     * is what keeps two made in the same millisecond apart, which a
     * highlight made and then extended genuinely can be.
     */
    function newId() {
        idCounter = (idCounter + 1) % 1296;
        return `cp_${Date.now().toString(36)}${idCounter.toString(36).padStart(2, '0')}`;
    }

    /**
     * Whether two records are the same checkpoint.
     *
     * This used to be "starts in the same whole second", and a second
     * checkpoint beginning in that second was silently dropped. Holding
     * Ctrl+B that was rare; highlighting transcript lines one after another
     * it is constant. So an id decides whenever both sides have one.
     *
     * The fallbacks are the compatibility, and there is no migration behind
     * them. Two records without ids still compare by time, exactly as they
     * always have, so re-importing an old export adds nothing. A record with
     * an id against one without has to match the whole span, not just where
     * it starts — a new highlight must not vanish because an old checkpoint
     * happens to begin in the same second. Please do not "simplify" this
     * back to a set of times.
     */
    function sameCheckpoint(a, b) {
        if (a.id && b.id) return a.id === b.id;
        if (!a.id && !b.id) return bookmarkTime(a) === bookmarkTime(b);
        return bookmarkTime(a) === bookmarkTime(b) && a.start === b.start && a.end === b.end;
    }

    /**
     * A handle on one checkpoint that survives the list being re-sorted: its
     * id, or for a record from before ids, the fields that never change after
     * it is made. The note and title are edited, so they are not part of it.
     */
    function bookmarkKey(bookmark) {
        if (!bookmark) return '';
        if (bookmark.id) return String(bookmark.id);
        return `t:${bookmarkTime(bookmark)}:${bookmark.start}:${bookmark.end}:${bookmark.timestamp}`;
    }

    /**
     * Add checkpoints to a video, creating its entry when new.
     *
     * De-duplicates against every existing checkpoint rather than only the
     * neighbouring one: the old adjacent-pair filter left duplicates behind
     * whenever a re-import interleaved times. What counts as a duplicate is
     * sameCheckpoint's call.
     */
    function addBookmarks(videos, video, newBookmarks) {
        const list = Array.isArray(newBookmarks) ? newBookmarks.filter(isBookmark) : [];
        if (list.length === 0) return { videos, added: 0 };

        const next = videos.slice();
        let index = next.findIndex((v) => v.id === video.id);
        if (index === -1) {
            next.push({ id: video.id, title: video.title, url: video.url, bookmarks: [] });
            index = next.length - 1;
        } else {
            next[index] = { ...next[index], bookmarks: next[index].bookmarks.slice() };
            if (video.title) next[index].title = video.title;
        }

        const entry = next[index];
        let added = 0;
        for (const bookmark of list) {
            if (entry.bookmarks.some((existing) => sameCheckpoint(existing, bookmark))) continue;
            entry.bookmarks.push(bookmark);
            added++;
        }
        entry.bookmarks.sort(byTime);
        return { videos: next, added };
    }

    /**
     * Remove one checkpoint by its bookmarkKey, and the video entry when it
     * was the last one. There is no by-index version any more: the popup and
     * the dashboard had one, and an index into a list loaded a minute ago is
     * not a handle on anything once another tab has saved a checkpoint.
     */
    function removeBookmarkById(videos, videoId, key) {
        const index = videos.findIndex((v) => v.id === videoId);
        if (index === -1 || !key) return videos;
        const bookmarks = videos[index].bookmarks.filter((bookmark) => bookmarkKey(bookmark) !== key);
        if (bookmarks.length === videos[index].bookmarks.length) return videos;
        return withBookmarks(videos, index, bookmarks);
    }

    /** Change fields on one checkpoint, found by its bookmarkKey. */
    function editBookmark(videos, videoId, key, patch) {
        const index = videos.findIndex((v) => v.id === videoId);
        if (index === -1 || !key) return videos;
        let changed = false;
        const bookmarks = videos[index].bookmarks.map((bookmark) => {
            if (bookmarkKey(bookmark) !== key) return bookmark;
            changed = true;
            return { ...bookmark, ...patch };
        });
        return changed ? withBookmarks(videos, index, bookmarks) : videos;
    }

    /** `videos` with one entry's list replaced, and the entry gone when it is empty. */
    function withBookmarks(videos, index, bookmarks) {
        const next = videos.slice();
        if (bookmarks.length === 0) next.splice(index, 1);
        else next[index] = { ...videos[index], bookmarks };
        return next;
    }

    /**
     * When a video's most recent checkpoint was saved.
     *
     * Checkpoints written by early versions have no `timestamp` at all, which
     * is why the sort below falls back to the video's position in the store:
     * that order is append order, so it is the same answer for anything the
     * clock cannot date.
     */
    function lastSaved(video) {
        let latest = 0;
        for (const bookmark of video.bookmarks) {
            const at = typeof bookmark.timestamp === 'number' ? bookmark.timestamp : 0;
            if (at > latest) latest = at;
        }
        return latest;
    }

    /**
     * The orders the popup and the dashboard offer, in the order they are
     * offered. `recent` is the default on both: the store is in append order,
     * so without a sort the list opens on the oldest thing in it — which is
     * the one video you are least likely to be still working through.
     */
    const SORTS = Object.freeze([
        { id: 'recent', label: 'Newest first' },
        { id: 'oldest', label: 'Oldest first' },
        { id: 'title', label: 'Title A–Z' },
        { id: 'most', label: 'Most checkpoints' },
    ]);

    /** A copy of `videos` in `order`. Never sorts the caller's array in place. */
    function sortVideos(videos, order) {
        const position = new Map(videos.map((video, index) => [video.id, index]));
        const newest = (a, b) => (lastSaved(b) - lastSaved(a)) ||
            (position.get(b.id) - position.get(a.id));

        const next = videos.slice();
        switch (order) {
            case 'oldest':
                return next.sort((a, b) => -newest(a, b));
            case 'title':
                return next.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
            case 'most':
                return next.sort((a, b) => (b.bookmarks.length - a.bookmarks.length) || newest(a, b));
            case 'recent':
            default:
                return next.sort(newest);
        }
    }

    function buildExport(videos) {
        return {
            version: EXPORT_VERSION,
            exportDate: new Date().toISOString(),
            totalVideos: videos.length,
            totalBookmarks: videos.reduce((sum, video) => sum + video.bookmarks.length, 0),
            videos,
        };
    }

    function validateImport(data) {
        return !!data && typeof data === 'object' && Array.isArray(data.videos) &&
            !!data.version && !!data.exportDate;
    }

    /**
     * Merge imported videos into `videos`, skipping checkpoints already present
     * at the same time. Returns the new list plus counts for the status message.
     */
    function mergeImported(videos, importedVideos) {
        if (!Array.isArray(importedVideos) || importedVideos.length === 0) {
            return {
                videos, addedVideos: 0, updatedVideos: 0, addedBookmarks: 0,
                message: 'No valid videos found in the import file', type: 'error',
            };
        }

        let next = videos;
        let addedVideos = 0;
        let updatedVideos = 0;
        let addedBookmarks = 0;

        for (const imported of importedVideos) {
            if (!imported || !imported.id || !Array.isArray(imported.bookmarks)) continue;

            const isNew = !next.some((v) => v.id === imported.id);
            const result = addBookmarks(next, {
                id: imported.id,
                title: imported.title || `Video ${imported.id}`,
                url: imported.url || YouTube.watchUrl(imported.id, 0),
            }, imported.bookmarks);

            next = result.videos;
            if (result.added === 0 && !isNew) continue;
            addedBookmarks += result.added;
            if (isNew) addedVideos++; else updatedVideos++;
        }

        if (addedVideos === 0 && updatedVideos === 0) {
            return {
                videos: next, addedVideos, updatedVideos, addedBookmarks,
                message: 'No new checkpoints to import', type: 'warning',
            };
        }

        const plural = (n) => (n === 1 ? '' : 's');
        return {
            videos: next, addedVideos, updatedVideos, addedBookmarks,
            message: `Imported ${addedBookmarks} checkpoint${plural(addedBookmarks)} across ` +
                `${addedVideos} new and ${updatedVideos} existing video${plural(updatedVideos)}`,
            type: 'info',
        };
    }

    /** Turn pasted timestamp links into importable video entries. */
    function parseTimestampLinks(text) {
        const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const byVideo = new Map();

        for (const line of lines) {
            const parsed = YouTube.parseTimestampLink(line);
            if (!parsed) continue;

            if (!byVideo.has(parsed.videoId)) {
                byVideo.set(parsed.videoId, {
                    id: parsed.videoId,
                    title: `Video ${parsed.videoId}`,
                    url: YouTube.watchUrl(parsed.videoId, 0),
                    bookmarks: [],
                });
            }
            const video = byVideo.get(parsed.videoId);
            if (video.bookmarks.some((b) => b.time === parsed.time)) continue;
            video.bookmarks.push({
                time: parsed.time,
                timestamp: Date.now(),
                note: 'Imported from timestamp link',
            });
        }

        return Array.from(byVideo.values());
    }

    const Bookmarks = {
        KEY, EXPORT_VERSION,
        load, save, update,
        normalizeVideos, bookmarkTime, addBookmarks,
        newId, sameCheckpoint, bookmarkKey, removeBookmarkById, editBookmark,
        lastSaved, sortVideos, SORTS,
        buildExport, validateImport, mergeImported, parseTimestampLinks,
    };

    root.BB = root.BB || {};
    root.BB.Bookmarks = Bookmarks;
    if (typeof module !== 'undefined' && module.exports) module.exports = Bookmarks;
})(typeof globalThis !== 'undefined' ? globalThis : this);
