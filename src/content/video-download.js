/**
 * Saving the video on the page as one .mp4, at the quality it is playing at
 * — or every video of a list, where the adapter can read one (`list`).
 * The site is the adapter's business — src/content/youtube-download.js and
 * the Vimeo one beside it say what a video is offered as; this file chooses
 * from that, fetches it, merges it with src/shared/mp4-mux.js and hands the
 * file over. Nothing here names a site.
 *
 * It all happens in the video's own tab, for three reasons. The streams'
 * hosts answer that tab's origin and no other (googlevideo.com sends
 * Access-Control-Allow-Origin: https://www.youtube.com). A worker is torn
 * down after thirty idle seconds, and an hour of video takes minutes. And
 * the popup that starts it closes the moment it loses focus.
 *
 * "The quality it is playing at" is the size of the picture the <video> is
 * drawing, matched to a rendition of exactly that size. The player's own
 * setting is the fallback, for a video whose first frame is not in yet.
 */
(function (root) {
    'use strict';

    const { FetchPool, Mp4Mux, Dom } = root.BB;

    /**
     * A stream is fetched in pieces of this much, as yt-dlp does: googlevideo
     * throttles one long response to about the speed of playback, and pieces
     * are not throttled at all.
     */
    const CHUNK = 10 << 20;
    /**
     * Pieces in flight for each stream, all of them in one pool; one more
     * for a list of segments, each of which is a few seconds and so spends
     * more of its time waiting for an answer than being sent.
     */
    const PARALLEL = 3;
    /** How long a progress toast stays up between two updates. */
    const SHOWN_MS = 120 * 1000;

    /** A rendition's line count, the way the players name them: 1080 for 1920×1080, and for 1080×1920. */
    const lines = (width, height) => Math.min(width, height);

    /**
     * What to match: the picture the player is drawing, else the quality the
     * player was told to keep (`p`), else nothing — the best up to 1080p.
     */
    function wanted(video, storedP) {
        const width = video ? video.videoWidth : 0;
        const height = video ? video.videoHeight : 0;
        if (width && height) return { width, height, p: lines(width, height) };
        return storedP > 0 ? { p: storedP } : null;
    }

    /**
     * The rendition to save, from `{ width, height, p, fps, rank, bitrate }`s
     * (`rank` is the adapter's codec preference, lower first): the exact
     * size wanted, else the same line count, else the nearest below, else
     * the nearest above. Among equals the higher frame rate, then the
     * adapter's codec, then the higher bitrate.
     */
    function pick(renditions, want) {
        const list = (renditions || []).filter(Boolean);
        if (!list.length) return null;
        const best = (some) => some.slice().sort((a, b) => (b.fps || 0) - (a.fps || 0) || (a.rank || 0) - (b.rank || 0) ||
            (b.bitrate || 0) - (a.bitrate || 0))[0];
        const p = want ? want.p : 1080;
        const exact = want && want.width ? list.filter((one) => one.width === want.width && one.height === want.height) : [];
        if (exact.length) return best(exact);
        const below = list.filter((one) => one.p <= p);
        if (below.length) {
            const top = Math.max(...below.map((one) => one.p));
            return best(below.filter((one) => one.p === top));
        }
        const bottom = Math.min(...list.map((one) => one.p));
        return best(list.filter((one) => one.p === bottom));
    }

    /**
     * What to save of what a site offers — `{ title, video, audio, silent }`:
     * renditions as `pick` takes them, each one its own stream, and the
     * sound best first — as a plan: the rendition, the best sound beside it,
     * the file's name, and a word when the quality wanted is not to be had.
     * No sound is an error unless the site says the video has none.
     */
    function choose({ title, video: renditions, audio = [], silent = false }, want, site) {
        const video = pick(renditions, want);
        if (!video || !(audio.length || silent)) throw new Error(`${site} offered no MP4 streams for this video`);
        // The size drawn is matched first: a film cropped to 1920×800, which
        // YouTube calls 1080p, is what an 800-line picture asked for.
        const exact = !!want && want.width === video.width && want.height === video.height;
        return {
            label: video.label,
            fileName: fileName(title, video.label),
            note: want && !exact && video.p !== want.p ? `${want.p}p is not offered as MP4 here — saving ${video.label}` : '',
            streams: [video, ...audio.slice(0, 1)],
        };
    }

    /** [start, end] byte ranges, both ends included, covering `size`. */
    function chunks(size, chunk = CHUNK) {
        const out = [];
        for (let start = 0; start < size; start += chunk) out.push([start, Math.min(start + chunk, size) - 1]);
        return out;
    }

    /** A title as a name Windows, macOS and Linux all take, for a file or a folder. */
    const cleanName = (title, fallback) => String(title || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/[. ]+$/, '').slice(0, 150) || fallback;

    /** A title as a file name, with the quality after it. */
    function fileName(title, label, ext = 'mp4') {
        return `${cleanName(title, 'video')}${label ? ` (${label})` : ''}.${ext}`;
    }

    const blobSource = (blob) => ({ size: blob.size, read: async (at, length) => new Uint8Array(await blob.slice(at, at + length).arrayBuffer()) });

    /**
     * A stream's pieces. `{ url, size, rangeParam }` is one file, fetched in
     * ranges named in its query, as googlevideo takes them; `{ urls }` is a
     * list of segments, each fetched whole.
     */
    function piecesOf(stream, chunk = CHUNK) {
        if (stream.urls) return stream.urls.map((url) => ({ url }));
        const join = stream.url.includes('?') ? '&' : '?';
        return chunks(stream.size, chunk).map(([start, end]) => ({
            url: `${stream.url}${join}${stream.rangeParam || 'range'}=${start}-${end}`, expect: end - start + 1,
        }));
    }

    /**
     * Each stream as one Blob — after its `head` where it has one, an init
     * segment already in hand (Vimeo sends it inline, in base64) — every
     * piece of every stream through one pool. A pool per stream left the
     * video on three connections from the moment the sound was in, which is
     * most of a download: on a 90 Mbit/s line that took a tenth longer
     * (October 2026). `onPiece(bytes, pieces)` hears of each piece as it
     * lands, and how many there are in all.
     */
    async function fetchStreams(streams, { fetchImpl, signal, onPiece = () => {}, chunk = CHUNK, retryMs }) {
        const pieces = streams.flatMap((stream, index) => piecesOf(stream, chunk).map((piece) => ({ ...piece, index })));
        const limit = streams.reduce((sum, stream) => sum + (stream.urls ? PARALLEL + 1 : PARALLEL), 0);
        const refused = (status) => `The stream was refused (${status}) — reload the page and try again`;
        const blobs = await FetchPool.mapLimit(pieces, limit, async ({ url, expect }) => {
            const blob = await FetchPool.fetchBody(url, { fetchImpl, signal, expect, retryMs, refused });
            onPiece(blob.size, pieces.length);
            return blob;
        });
        return streams.map((stream, index) => {
            const own = blobs.filter((_, at) => pieces[at].index === index);
            return new Blob(stream.head ? [stream.head, ...own] : own);
        });
    }

    /**
     * The streams as one file, its mdats sliced from the streams rather than
     * copied. A stream on its own is put through the merge as well: its
     * headers may leave its length out, as Vimeo's do, and the merge writes
     * in the one it is given.
     */
    async function assemble(blobs, streams) {
        const merged = await Mp4Mux.merge(blobs.map((blob, index) => ({ ...blobSource(blob), seconds: streams[index].seconds })));
        const parts = merged.parts.map((part) => (part instanceof Uint8Array ? part : blobs[part.source].slice(part.at, part.at + part.size)));
        return new Blob(parts, { type: 'video/mp4' });
    }

    /**
     * `onChange(state())` hears each turn a download takes — begun, a
     * percent further, the next video of a list, ended — for a button on
     * the page to follow; the popup asks `info` instead.
     */
    function createDownloader({ adapter, notify, getVideoElement, getVideoId = () => null, enabled = () => true,
        fetchImpl = root.fetch, save = Dom.download, win = root, doc = root.document, onChange = () => {} }) {
        let busy = false;
        let percent = 0;
        /** Where a list's download is, `{ at, of }` from 1, and null for one video. */
        let place = null;
        let controller = null;

        const stored = () => (adapter.storedQuality ? adapter.storedQuality(win) : 0);
        const want = () => wanted(getVideoElement(), stored());
        const state = () => ({ busy, percent, place });

        /** What the popup offers, read without a request: null where there is nothing to save. */
        function info() {
            if (!enabled() || !adapter.onVideo(win, getVideoId())) return { ok: false };
            const target = want();
            return { ok: true, busy, percent, label: target ? `${target.p}p` : '' };
        }

        /**
         * Fetch, merge and hand over the video `videoId`, at `target`. `head`
         * goes before each progress line, and `path` before the file's name;
         * `only` is what the save is told over the settings. Answers what
         * the save did — false is a Save As closed — and the file's name.
         */
        async function saveOne(videoId, target, signal, { head = '', path = '', only } = {}) {
            const offer = await adapter.offer({ videoId, win, doc, fetchImpl, signal });
            const plan = choose(offer, target, adapter.name);
            if (plan.note && !head) notify(plan.note, 'info', 4000);

            // Progress by bytes when every size is known, by pieces when not.
            const total = plan.streams.every((stream) => stream.size) ? plan.streams.reduce((sum, stream) => sum + stream.size, 0) : 0;
            let bytes = 0;
            let landed = 0;
            percent = 0;
            const onPiece = (size, pieces) => {
                bytes += size;
                landed += 1;
                const now = Math.floor(100 * (total ? bytes / total : landed / pieces));
                if (now === percent) return;
                percent = now;
                notify(`${head}Downloading ${plan.label} — ${percent}%`, 'info', SHOWN_MS);
                onChange(state());
            };
            const blobs = await fetchStreams(plan.streams, { fetchImpl, signal, onPiece });
            notify(`${head}Putting the picture and the sound together…`, 'info', SHOWN_MS);
            const file = await assemble(blobs, plan.streams);
            percent = 100;
            return { saved: await save(path + plan.fileName, file, 'video/mp4', only), name: plan.fileName };
        }

        async function run(signal) {
            notify('Finding the video\'s streams…', 'info', SHOWN_MS);
            const { saved, name } = await saveOne(getVideoId(), want(), signal);
            if (saved === false) notify('Not saved', 'info', 4000);
            else notify(`Saved ${name}`, 'success', 6000);
        }

        /**
         * Every video of the list `listId`, one after another, into a folder
         * named after it, each numbered by its place. At the quality the
         * player was told to keep, there being no picture on a list's page to
         * match, else the best up to 1080p. Never Save As video by video. One
         * that cannot be saved — private, removed — is passed over and named
         * at the end; cancelling stops the one going and the rest.
         */
        async function runList(listId, signal) {
            notify('Reading the playlist…', 'info', SHOWN_MS);
            const { title, videos } = await adapter.list({ listId, win, doc, fetchImpl, signal });
            if (!videos.length) throw new Error('The playlist has no videos to save');
            const folder = cleanName(title, listId);
            const target = wanted(null, stored());
            const digits = String(videos.length).length;
            const missed = [];
            let saved = 0;
            for (const [index, video] of videos.entries()) {
                place = { at: index + 1, of: videos.length };
                onChange(state());
                const head = `${index + 1} of ${videos.length} · `;
                notify(`${head}Finding the video's streams…`, 'info', SHOWN_MS);
                try {
                    const path = `${folder}/${String(index + 1).padStart(digits, '0')} - `;
                    if ((await saveOne(video.id, target, signal, { head, path, only: { ask: false } })).saved !== false) saved += 1;
                } catch (error) {
                    if (signal.aborted) throw error;
                    missed.push(video.title || video.id);
                }
            }
            if (!missed.length) return notify(`Saved ${saved} videos to ${folder}`, 'success', 8000);
            const named = missed.slice(0, 3).join(', ') + (missed.length > 3 ? ` and ${missed.length - 3} more` : '');
            notify(`Saved ${saved} of ${videos.length} to ${folder} — not ${named}`, 'warning', 12000);
        }

        /** Run `work(signal)` as the one download going; resolves when it has ended either way. */
        async function begin(work) {
            busy = true;
            percent = 0;
            const own = new AbortController();
            controller = own;
            onChange(state());
            try {
                await work(own.signal);
            } catch (error) {
                const cancelled = own.signal.aborted || (error && error.name === 'AbortError');
                notify(cancelled ? 'Download cancelled' : (error && error.message) || 'The download failed', cancelled ? 'info' : 'error', 8000);
            } finally {
                busy = false;
                place = null;
                controller = null;
                onChange(state());
            }
        }

        /** Start a download of the video on the page, unless one is going. */
        async function start() {
            if (busy || !info().ok) return;
            await begin(run);
        }

        /** Start a download of the list `listId`, on a site that has lists, unless one is going. */
        async function startList(listId) {
            if (busy || !enabled() || !adapter.list || !listId) return;
            await begin((signal) => runList(listId, signal));
        }

        function cancel() {
            if (controller) controller.abort();
        }

        return { info, state, start, startList, cancel };
    }

    const VideoDownload = { CHUNK, wanted, pick, choose, chunks, fileName, piecesOf, fetchStreams, assemble, createDownloader };

    root.BB = root.BB || {};
    root.BB.VideoDownload = VideoDownload;
    if (typeof module !== 'undefined' && module.exports) module.exports = VideoDownload;
})(typeof globalThis !== 'undefined' ? globalThis : this);
