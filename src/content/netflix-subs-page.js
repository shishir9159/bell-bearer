/**
 * Netflix's subtitle tracks, read from inside the page's own world, so that
 * more than one can be shown at once.
 *
 * Netflix's player draws one subtitle at a time, and nothing it exposes hands
 * over the files. What it does do is parse a manifest for each title it
 * plays — the title's tracks, and where each subtitle track's file is — with
 * the page's own JSON.parse. So JSON.parse is wrapped: every value goes back
 * exactly as it came, and one carrying a `timedtexttracks` list is read on the
 * way past. Nothing Netflix sends or receives is changed.
 *
 * This runs at document_start, ahead of the player's first manifest. Tracks
 * are kept per title, told to the isolated world as they arrive
 * (`bb:netflix:tracks`), and handed over again when it asks
 * (`bb:netflix:subs`, answered on `bb:netflix:subs:ok` inside the same
 * dispatch) — it loads at document_idle, often after the manifest.
 */
(function () {
    'use strict';

    if (window.__bbNetflixSubs) return;
    window.__bbNetflixSubs = true;

    const ANNOUNCE = 'bb:netflix:tracks';
    const REQUEST = 'bb:netflix:subs';
    const ANSWER = 'bb:netflix:subs:ok';

    /**
     * The text formats a track may come in, best first. Image subtitles —
     * Netflix's own for some scripts — are pictures of text and passed over.
     */
    const FORMATS = ['webvtt-lssdh-ios8', 'imsc1.1', 'dfxp-ls-sdh', 'simplesdh'];

    /** Titles kept: hover previews parse manifests too, a few a minute on the browse page. */
    const KEEP = 8;
    const titles = new Map();

    /** A downloadable's address, in either spelling Netflix has used: `urls: [{ url }]` or `downloadUrls: { cdn: url }`. */
    function addressOf(file) {
        if (!file || file.isImage) return null;
        const listed = Array.isArray(file.urls) ? file.urls.map((one) => one && one.url) : [];
        const mapped = file.downloadUrls && typeof file.downloadUrls === 'object' ? Object.values(file.downloadUrls) : [];
        return [...listed, ...mapped].find((url) => typeof url === 'string' && /^https:\/\//.test(url)) || null;
    }

    function trackOf(track) {
        if (!track || track.isNoneTrack || typeof track.language !== 'string') return null;
        const files = track.ttDownloadables || {};
        const format = FORMATS.find((name) => addressOf(files[name])) || null;
        return {
            id: String(track.new_track_id || track.id || `${track.language}:${track.rawTrackType}`),
            language: track.language,
            name: typeof track.languageDescription === 'string' ? track.languageDescription : track.language,
            kind: track.rawTrackType === 'closedcaptions' ? 'closedcaptions' : 'subtitles',
            forced: !!track.isForcedNarrative,
            format,
            url: format ? addressOf(files[format]) : null,
        };
    }

    function read(value) {
        if (!value || typeof value !== 'object') return;
        const manifest = value.result && typeof value.result === 'object' ? value.result : value;
        if (!Array.isArray(manifest.timedtexttracks) || manifest.movieId == null) return;
        const movieId = String(manifest.movieId);
        const tracks = manifest.timedtexttracks.map(trackOf).filter(Boolean);
        titles.delete(movieId);
        titles.set(movieId, tracks);
        while (titles.size > KEEP) titles.delete(titles.keys().next().value);
        tell(ANNOUNCE, { movieId, tracks });
    }

    function tell(name, body) {
        document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(body) }));
    }

    const parse = JSON.parse;
    // A plain function, not an arrow: JSON.parse is called as a method, and
    // `this` and a reviver both go through untouched.
    JSON.parse = function parseAndLook() {
        const value = parse.apply(this, arguments);
        try { read(value); } catch (_) { /* never Netflix's problem */ }
        return value;
    };

    document.addEventListener(REQUEST, (event) => {
        let message;
        try { message = parse(event.detail); } catch (_) { return; }
        if (!message || message.type !== 'tracks') return;
        const movieId = String(message.movieId);
        tell(ANSWER, { movieId, tracks: titles.get(movieId) || null });
    });
})();
