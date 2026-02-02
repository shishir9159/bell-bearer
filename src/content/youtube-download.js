/**
 * youtube.com, for src/content/video-download.js: where a video's streams
 * are, and what each of them is. Everything that will break when YouTube
 * changes is in this file; `node tools/yt-check.js` says which part broke,
 * and its header how each has been mended before.
 *
 * Not from the page's own player. Its player response has had no stream
 * addresses since YouTube moved the web player to SABR — one POST stream
 * that only its own player speaks — and the addresses it used to have were
 * scrambled by the page's JavaScript. So the streams are asked for the way
 * yt-dlp asks: as another of YouTube's own apps, through InnerTube's player
 * endpoint on youtube.com. CLIENT below is yt-dlp's `visionos` entry
 * (yt_dlp/extractor/youtube/_base.py, INNERTUBE_CLIENTS), its default since
 * August 2026: its answers carry plain addresses, need no PO token, and
 * carry no `n` challenge for a JavaScript engine to solve.
 *
 * The request goes without cookies. Not every app takes a signed-in session,
 * and one that does not answers "Sign in" rather than with the streams. The
 * page's visitor id goes with it instead: without one, YouTube asks this IP
 * to prove it is not a bot.
 */
(function (root) {
    'use strict';

    /** yt-dlp's `visionos` client, field for field. When it stops answering, compare it with theirs first. */
    const CLIENT = Object.freeze({
        id: 101,
        context: Object.freeze({
            clientName: 'VISIONOS',
            clientVersion: '1.02',
            deviceMake: 'Apple',
            deviceModel: 'RealityDevice17,1',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
            osName: 'visionOS',
            osVersion: '26.5.23O471',
        }),
    });

    const PLAYER_URL = '/youtubei/v1/player?prettyPrint=false';

    /** The player request for `videoId`, as `fetch` takes it. */
    function playerRequest(videoId, visitorData) {
        const client = { ...CLIENT.context, hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0, ...(visitorData ? { visitorData } : {}) };
        return {
            url: PLAYER_URL,
            init: {
                method: 'POST',
                credentials: 'omit',
                headers: {
                    'Content-Type': 'application/json',
                    'X-YouTube-Client-Name': String(CLIENT.id),
                    'X-YouTube-Client-Version': CLIENT.context.clientVersion,
                    ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
                },
                body: JSON.stringify({
                    context: { client },
                    videoId,
                    playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
                    contentCheckOk: true,
                    racyCheckOk: true,
                }),
            },
        };
    }

    /** avc1 first: it plays everywhere. av01 is YouTube's only MP4 above 1080p, and is smaller. */
    const RANK = { avc1: 0, av01: 1 };
    const codecOf = (mime) => (/codecs="([a-z0-9]+)/i.exec(mime || '') || [])[1] || '';

    /**
     * The player's answer as renditions to choose from: MP4 only, since
     * that is what can be merged, and only those with a plain address and a
     * known length. An address behind `signatureCipher` would need the
     * page's scrambling code run; a stream with DRM could not be played.
     */
    function readPlayer(answer) {
        const status = (answer && answer.playabilityStatus) || {};
        const details = (answer && answer.videoDetails) || {};
        if (status.status !== 'OK') return { ok: false, reason: status.reason || status.status || 'YouTube gave no answer' };
        if (details.isLive) return { ok: false, reason: 'a live stream has no end to save' };
        const formats = ((answer.streamingData && answer.streamingData.adaptiveFormats) || [])
            .filter((one) => one.url && Number(one.contentLength) > 0 && !one.drmFamilies);
        const video = formats.filter((one) => /^video\/mp4/.test(one.mimeType) && codecOf(one.mimeType) in RANK).map((one) => ({
            url: one.url, size: Number(one.contentLength), width: one.width, height: one.height, fps: one.fps || 0,
            p: parseInt(one.qualityLabel, 10) || Math.min(one.width, one.height), label: one.qualityLabel || `${one.height}p`,
            rank: RANK[codecOf(one.mimeType)], bitrate: one.bitrate || 0,
        }));
        // The original sound, not a dubbed track, and not the "stable
        // volume" copy YouTube keeps of each (isDrc).
        const audio = formats.filter((one) => /^audio\/mp4/.test(one.mimeType) && !one.isDrc && (!one.audioTrack || one.audioTrack.audioIsDefault))
            .map((one) => ({ url: one.url, size: Number(one.contentLength), bitrate: one.bitrate || 0 }))
            .sort((a, b) => b.bitrate - a.bitrate);
        return { ok: true, title: details.title || '', video, audio };
    }

    /** The visitor id the page was given, from the ytcfg it sets in an inline script. */
    function visitorData(doc) {
        for (const script of doc.scripts || []) {
            const found = /"VISITOR_DATA":"([^"]+)"/.exec(script.textContent || '');
            if (found) return found[1];
        }
        return '';
    }

    /**
     * The quality the player was last told to keep: YouTube writes the
     * choice from its gear menu to localStorage as yt-player-quality,
     * `{ data: '{"quality":1080,…}' }`.
     */
    function storedQuality(win) {
        try {
            const outer = JSON.parse(win.localStorage.getItem('yt-player-quality'));
            return Number(JSON.parse(outer.data).quality) || 0;
        } catch (_) {
            return 0;
        }
    }

    /** A watch page, or a short: a video to save. */
    const onVideo = (win, videoId) => !!videoId && /^\/(watch|shorts\/|live\/)/.test(win.location.pathname);

    /** What the video is offered as, for VideoDownload.choose. */
    async function offer({ videoId, doc, fetchImpl, signal }) {
        const { url, init } = playerRequest(videoId, visitorData(doc));
        const response = await fetchImpl(url, { ...init, signal });
        if (!response.ok) throw new Error(`YouTube refused to list the streams (${response.status})`);
        const player = readPlayer(await response.json());
        if (!player.ok) throw new Error(`YouTube would not give the streams: ${player.reason}`);
        return player;
    }

    const adapter = { site: 'youtube', name: 'YouTube', onVideo, storedQuality, offer };

    const YoutubeDownload = { CLIENT, playerRequest, readPlayer, visitorData, storedQuality, adapter };

    root.BB = root.BB || {};
    root.BB.YoutubeDownload = YoutubeDownload;
    if (typeof module !== 'undefined' && module.exports) module.exports = YoutubeDownload;
})(typeof globalThis !== 'undefined' ? globalThis : this);
