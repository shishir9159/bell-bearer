/**
 * Saving the video on the page as one .mp4, at the quality it is playing at.
 * The site is the adapter's business — src/content/youtube-download.js and
 * the Vimeo one beside it say where the streams are and which is which;
 * this file fetches them, merges them with src/shared/mp4-mux.js and hands
 * the file over. Nothing here names a site.
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

    const { Mp4Mux, Dom } = root.BB;

    /**
     * A stream is fetched in pieces of this much, as yt-dlp does: googlevideo
     * throttles one long response to about the speed of playback, and pieces
     * are not throttled at all.
     */
    const CHUNK = 10 << 20;
    /** Pieces in flight per stream. */
    const PARALLEL = 3;
    const TRIES = 3;
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

    /** [start, end] byte ranges, both ends included, covering `size`. */
    function chunks(size, chunk = CHUNK) {
        const out = [];
        for (let start = 0; start < size; start += chunk) out.push([start, Math.min(start + chunk, size) - 1]);
        return out;
    }

    /** A title as a file name Windows, macOS and Linux all take, with the quality after it. */
    function fileName(title, label, ext = 'mp4') {
        const clean = String(title || 'video').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
            .replace(/[. ]+$/, '').slice(0, 150) || 'video';
        return `${clean}${label ? ` (${label})` : ''}.${ext}`;
    }

    const blobSource = (blob) => ({ size: blob.size, read: async (at, length) => new Uint8Array(await blob.slice(at, at + length).arrayBuffer()) });

    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

    /**
     * One request, tried again on a dropped connection or a busy server. A
     * refusal (403, 404) is not tried again: the address has expired or was
     * never good, and asking twice more only looks worse.
     */
    async function fetchBlob(url, { fetchImpl, signal, expect, retryMs = 1000 }) {
        let lastError = null;
        for (let attempt = 0; attempt < TRIES; attempt++) {
            if (attempt) await sleep(retryMs * attempt);
            if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
            let response;
            try {
                response = await fetchImpl(url, { credentials: 'omit', signal });
            } catch (error) {
                if (error && error.name === 'AbortError') throw error;
                lastError = new Error('The connection dropped');
                continue;
            }
            if (response.status === 429 || response.status >= 500) {
                lastError = new Error(`The server is busy (${response.status})`);
                continue;
            }
            if (!response.ok) throw new Error(`The stream was refused (${response.status}) — reload the page and try again`);
            const blob = await response.blob();
            if (expect != null && blob.size !== expect) {
                lastError = new Error('A piece of the stream came back short');
                continue;
            }
            return blob;
        }
        throw lastError;
    }

    /** `worker` over `items`, `limit` at a time, in order; the first failure ends it. */
    async function mapLimit(items, limit, worker) {
        const results = new Array(items.length);
        let next = 0;
        let failed = null;
        const run = async () => {
            while (next < items.length && !failed) {
                const index = next++;
                try { results[index] = await worker(items[index], index); } catch (error) { failed = failed || error; }
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
        if (failed) throw failed;
        return results;
    }

    /**
     * A stream as one Blob. Either `{ url, size, rangeParam }` — one file,
     * fetched in pieces named in its query, as googlevideo takes them — or
     * `{ urls }`, a list of segments to fetch whole, init segment first.
     * `onPiece(bytes)` hears of each piece as it lands.
     */
    async function fetchStream(stream, { fetchImpl, signal, onPiece = () => {}, chunk = CHUNK, retryMs }) {
        if (stream.urls) {
            const blobs = await mapLimit(stream.urls, PARALLEL + 1, async (url) => {
                const blob = await fetchBlob(url, { fetchImpl, signal, retryMs });
                onPiece(blob.size);
                return blob;
            });
            return new Blob(blobs);
        }
        const join = stream.url.includes('?') ? '&' : '?';
        const blobs = await mapLimit(chunks(stream.size, chunk), PARALLEL, async ([start, end]) => {
            const blob = await fetchBlob(`${stream.url}${join}${stream.rangeParam || 'range'}=${start}-${end}`,
                { fetchImpl, signal, expect: end - start + 1, retryMs });
            onPiece(blob.size);
            return blob;
        });
        return new Blob(blobs);
    }

    function createDownloader({ adapter, notify, getVideoElement, getVideoId = () => null, enabled = () => true,
        fetchImpl = root.fetch, save = Dom.download, win = root, doc = root.document }) {
        let busy = false;
        let percent = 0;
        let controller = null;

        const want = () => wanted(getVideoElement(), adapter.storedQuality ? adapter.storedQuality(win) : 0);

        /** What the popup offers, read without a request: null where there is nothing to save. */
        function info() {
            if (!enabled() || !adapter.onVideo(win, getVideoId())) return { ok: false };
            const target = want();
            return { ok: true, busy, percent, label: target ? `${target.p}p` : '' };
        }

        async function run() {
            controller = new AbortController();
            const { signal } = controller;
            notify('Finding the video\'s streams…', 'info', SHOWN_MS);
            const plan = await adapter.plan({ videoId: getVideoId(), want: want(), win, doc, fetchImpl, signal });
            if (plan.note) notify(plan.note, 'info', 4000);

            // Progress by bytes when every size is known, by pieces when not.
            const total = plan.streams.reduce((sum, stream) => sum + (stream.size || 0), 0);
            const pieces = plan.streams.reduce((sum, stream) => sum + (stream.urls ? stream.urls.length : chunks(stream.size).length), 0);
            let bytes = 0;
            let landed = 0;
            const onPiece = (size) => {
                bytes += size;
                landed += 1;
                const now = Math.floor(100 * (plan.streams.every((stream) => stream.size) ? bytes / total : landed / pieces));
                if (now === percent) return;
                percent = now;
                notify(`Downloading ${plan.label} — ${percent}%`, 'info', SHOWN_MS);
            };
            const blobs = await Promise.all(plan.streams.map((stream) => fetchStream(stream, { fetchImpl, signal, onPiece })));

            let file = blobs[0];
            if (!plan.whole) {
                notify('Putting the picture and the sound together…', 'info', SHOWN_MS);
                const merged = await Mp4Mux.merge(blobs.map(blobSource));
                file = new Blob(merged.parts.map((part) => (part instanceof Uint8Array ? part : blobs[part.source].slice(part.at, part.at + part.size))));
            }
            save(plan.fileName, file, 'video/mp4');
            notify(`Saved ${plan.fileName}`, 'success', 6000);
        }

        /** Start a download, unless one is going; resolves when it has ended either way. */
        async function start() {
            if (busy || !info().ok) return;
            busy = true;
            percent = 0;
            try {
                await run();
            } catch (error) {
                const cancelled = error && error.name === 'AbortError';
                notify(cancelled ? 'Download cancelled' : (error && error.message) || 'The download failed', cancelled ? 'info' : 'error', 8000);
            } finally {
                busy = false;
                controller = null;
            }
        }

        function cancel() {
            if (controller) controller.abort();
        }

        return { info, start, cancel };
    }

    const VideoDownload = { CHUNK, wanted, pick, chunks, fileName, fetchBlob, fetchStream, mapLimit, createDownloader };

    root.BB = root.BB || {};
    root.BB.VideoDownload = VideoDownload;
    if (typeof module !== 'undefined' && module.exports) module.exports = VideoDownload;
})(typeof globalThis !== 'undefined' ? globalThis : this);
