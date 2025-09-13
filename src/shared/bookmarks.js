/**
 * The bookmark store: load, save, merge, import and export.
 *
 * popup.js and dashboard.js each carried their own copy of this logic (merge,
 * validate, parse, export — around two hundred duplicated lines), which is how
 * they drifted apart: the popup de-duplicated on import while the content
 * script appended blindly. One implementation now backs all three surfaces.
 *
 * Shape on disk, under `youtubeBookmarks`:
 *   [{ id, title, url, bookmarks: [{ time, start?, end?, timestamp, note,
 *                                    title?, subtitle? }] }]
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
        writeChain = writeChain.then(run, run).catch((error) => {
            console.error('Bell Bearer: could not update bookmarks', error);
            return [];
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

    /**
     * Add checkpoints to a video, creating its entry when new.
     *
     * De-duplicates against every existing checkpoint rather than only the
     * neighbouring one: the old adjacent-pair filter left duplicates behind
     * whenever a re-import interleaved times.
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
        const seen = new Set(entry.bookmarks.map(bookmarkTime));
        let added = 0;
        for (const bookmark of list) {
            const at = bookmarkTime(bookmark);
            if (seen.has(at)) continue;
            seen.add(at);
            entry.bookmarks.push(bookmark);
            added++;
        }
        entry.bookmarks.sort(byTime);
        return { videos: next, added };
    }

    /** Remove one checkpoint, and the video entry when it was the last one. */
    function removeBookmark(videos, videoId, bookmarkIndex) {
        const index = videos.findIndex((v) => v.id === videoId);
        if (index === -1) return videos;

        const video = videos[index];
        if (bookmarkIndex < 0 || bookmarkIndex >= video.bookmarks.length) return videos;

        const bookmarks = video.bookmarks.filter((_, i) => i !== bookmarkIndex);
        const next = videos.slice();
        if (bookmarks.length === 0) next.splice(index, 1);
        else next[index] = { ...video, bookmarks };
        return next;
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
        normalizeVideos, bookmarkTime, addBookmarks, removeBookmark,
        buildExport, validateImport, mergeImported, parseTimestampLinks,
    };

    root.BB = root.BB || {};
    root.BB.Bookmarks = Bookmarks;
    if (typeof module !== 'undefined' && module.exports) module.exports = Bookmarks;
})(typeof globalThis !== 'undefined' ? globalThis : this);
