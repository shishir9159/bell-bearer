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

    const { FetchPool, Mp4Mux, Dom } = root.BB;

    /**
     * A stream is fetched in pieces of this much, as yt-dlp does: googlevideo
     * throttles one long response to about the speed of playback, and pieces
     * are not throttled at all.
     */
    const CHUNK = 10 << 20;
    /** Pieces in flight per stream. */
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

    /**
     * A stream as one Blob. Either `{ url, size, rangeParam }` — one file,
     * fetched in pieces named in its query, as googlevideo takes them — or
     * `{ urls, head }`, a list of segments to fetch whole, after `head`, an
     * init segment already in hand (Vimeo sends it inline, in base64).
     * `onPiece(bytes)` hears of each piece as it lands.
     */
    async function fetchStream(stream, { fetchImpl, signal, onPiece = () => {}, chunk = CHUNK, retryMs }) {
        const refused = (status) => `The stream was refused (${status}) — reload the page and try again`;
        if (stream.urls) {
            const blobs = await FetchPool.mapLimit(stream.urls, PARALLEL + 1, async (url) => {
                const blob = await FetchPool.fetchBody(url, { fetchImpl, signal, retryMs, refused });
                onPiece(blob.size);
                return blob;
            });
            return new Blob(stream.head ? [stream.head, ...blobs] : blobs);
        }
        const join = stream.url.includes('?') ? '&' : '?';
        const blobs = await FetchPool.mapLimit(chunks(stream.size, chunk), PARALLEL, async ([start, end]) => {
            const blob = await FetchPool.fetchBody(`${stream.url}${join}${stream.rangeParam || 'range'}=${start}-${end}`,
                { fetchImpl, signal, expect: end - start + 1, retryMs, refused });
            onPiece(blob.size);
            return blob;
        });
        return new Blob(blobs);
    }

    /**
     * `name` under `folder`, as the browser's downloads take a path: relative
     * to Downloads, "/" between folders. Nothing in the setting may lead out
     * of Downloads — a "..", a drive, a leading slash — and nothing Windows
     * refuses in a name survives, since the browser turns the whole download
     * down over one bad character rather than mend it.
     */
    function savePath(folder, name) {
        const parts = String(folder || '').split(/[\\/]+/)
            .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim().replace(/[. ]+$/, ''))
            .filter((part) => part && part !== '..');
        return [...parts, name].join('/');
    }

    /**
     * Saving a finished file the way the settings ask: through the browser's
     * downloads (src/background/downloads.js), the only way to ask where it
     * goes or to name a folder, or by a link's click into Downloads when
     * neither is asked for. A link's `download` name turns "/" into "_", and
     * it has no Save As of its own.
     *
     * The file's blob: address is this tab's, and the browser reads it from
     * here, so it is kept until the worker says the save has ended
     * (`ended`) — with Save As, whenever a place has been picked. `save`
     * resolves to true when saved and false when Save As was turned down.
     */
    function createSaver({ options, send, link = Dom.download, urls = root.URL }) {
        const pending = new Map();

        async function save(name, blob, type) {
            const { ask, folder } = options();
            const path = savePath(folder, name);
            if (!ask && !path.includes('/')) {
                link(name, blob, type);
                return true;
            }
            // Typed, or the browser takes the merged file, which has none, for
            // text, and saves "….mp4" as "….txt". Wrapping copies nothing.
            const url = urls.createObjectURL(blob.type || !type ? blob : new Blob([blob], { type }));
            const ended = new Promise((resolve, reject) => pending.set(url, { resolve, reject }));
            let answer = null;
            try {
                answer = await send({ action: 'saveDownload', url, filename: path, ask });
            } catch (_) { /* no worker to hand it to: the extension was reloaded under this tab */ }
            if (answer && answer.ok) return ended;
            pending.delete(url);
            urls.revokeObjectURL(url);
            // Firefox turns the request itself down when Save As is closed,
            // where Chrome starts a download and interrupts it.
            if (answer && /cancel/i.test(answer.error || '')) return false;
            // A browser that cannot read this tab's blob still gets the file, into Downloads.
            link(name, blob, type);
            return true;
        }

        /** The worker's word that the save of `url` has ended, as `state` with `error`. */
        function ended({ url, state, error }) {
            const waiting = pending.get(url);
            if (!waiting) return;
            pending.delete(url);
            urls.revokeObjectURL(url);
            if (state === 'complete') waiting.resolve(true);
            else if (error === 'USER_CANCELED') waiting.resolve(false);
            else waiting.reject(new Error(`The browser could not save it (${error || state})`));
        }

        return { save, ended };
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
                const merged = await Mp4Mux.merge(blobs.map((blob, index) => ({ ...blobSource(blob), seconds: plan.streams[index].seconds })));
                file = new Blob(merged.parts.map((part) => (part instanceof Uint8Array ? part : blobs[part.source].slice(part.at, part.at + part.size))));
            }
            percent = 100;
            const saved = await save(plan.fileName, file, 'video/mp4');
            if (saved === false) notify('Not saved', 'info', 4000);
            else notify(`Saved ${plan.fileName}`, 'success', 6000);
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

    const VideoDownload = { CHUNK, wanted, pick, chunks, fileName, fetchStream, savePath, createSaver, createDownloader };

    root.BB = root.BB || {};
    root.BB.VideoDownload = VideoDownload;
    if (typeof module !== 'undefined' && module.exports) module.exports = VideoDownload;
})(typeof globalThis !== 'undefined' ? globalThis : this);
