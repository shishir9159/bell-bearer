/**
 * vimeo.com, for src/content/video-download.js: where a clip's streams are
 * and which of them to save.
 *
 * Found the way the page itself finds them (October 2026):
 *   1. the clip's id, from the address, and the signature vimeo.com writes
 *      into the page's head for a viewer who is not signed in,
 *      <meta name="video-signature-<id>">;
 *   2. a token from vimeo.com/_next/viewer, the page's own;
 *   3. api.vimeo.com/videos/<id>?anon_signature=…&fields=config_url, which
 *      answers with the player's config address, signed. An unsigned one is
 *      refused (403), whoever asks;
 *   4. the config, whose request.files.dash names, per CDN, a JSON playlist:
 *      each stream with its init segment inline, in base64, and its segments'
 *      addresses, relative to the playlist's own.
 * yt-dlp reaches the same config through the same API (yt_dlp/extractor/
 * vimeo.py, _call_videos_api).
 *
 * Many clips are encrypted now — Widevine, PlayReady and FairPlay, named by
 * request.drm in the config and /drm/ in the playlist's path. Those are
 * refused here, as yt-dlp refuses them: the bytes would be unplayable, and
 * decrypting them is circumventing the encryption, which this extension
 * does not do.
 */
(function (root) {
    'use strict';

    const DRM_REFUSAL = 'This Vimeo video is DRM-protected, so it cannot be saved. If its owner allows downloads, ' +
        'Vimeo\'s own Download button under the video has it.';

    /** avc1 plays everywhere; AV1 and HEVC need more of a player. */
    const RANK = { avc1: 0, av01: 1, hvc1: 2, hev1: 2 };

    /**
     * The clip an address shows — vimeo.com/<id>, an unlisted
     * vimeo.com/<id>/<hash>, and the same under /channels/…, /groups/…/videos/
     * and /showcase/…/video/ — or null.
     */
    function clipOf(href) {
        let at = null;
        try { at = new URL(href); } catch (_) { return null; }
        if (at.hostname.replace(/^www\./, '') !== 'vimeo.com') return null;
        const parts = at.pathname.split('/').filter(Boolean);
        const after = parts.findIndex((part) => part === 'video' || part === 'videos');
        const index = after > -1 && /^\d+$/.test(parts[after + 1] || '') ? after + 1
            : parts[0] === 'channels' ? (/^\d+$/.test(parts[2] || '') ? 2 : -1)
                : (/^\d+$/.test(parts[0] || '') ? 0 : -1);
        if (index < 0) return null;
        const hash = /^[0-9a-f]{6,}$/.test(parts[index + 1] || '') ? parts[index + 1] : '';
        return { id: parts[index], hash };
    }

    const onVideo = (win) => !!clipOf(win.location.href);

    /** The player's config, signed, as the page asks for it. */
    async function fetchConfig(clip, { doc, fetchImpl, signal }) {
        const meta = doc.querySelector(`meta[name="video-signature-${clip.id}"]`);
        const viewer = await fetchImpl('/_next/viewer', { credentials: 'include', headers: { Accept: 'application/json' }, signal });
        const token = viewer.ok ? (await viewer.json()).jwt : '';
        if (!token) throw new Error('Vimeo did not answer — reload the page and try again');
        const query = new URLSearchParams({ fields: 'config_url' });
        if (meta && meta.content) query.set('anon_signature', meta.content);
        const api = await fetchImpl(`https://api.vimeo.com/videos/${clip.id}${clip.hash ? `:${clip.hash}` : ''}?${query}`, {
            headers: { Authorization: `jwt ${token}`, Accept: 'application/vnd.vimeo.*+json;version=3.4.10' }, signal,
        });
        const found = api.ok ? await api.json() : null;
        if (!found || !found.config_url) throw new Error(`Vimeo would not say where this video's streams are (${api.status})`);
        const config = await fetchImpl(found.config_url, { credentials: 'include', signal });
        if (!config.ok) throw new Error(`Vimeo refused the player's config (${config.status})`);
        return config.json();
    }

    /** What the config offers: the title, whether it is encrypted, and the default CDN's playlist. */
    function readConfig(config) {
        const request = (config && config.request) || {};
        const dash = request.files && request.files.dash;
        const cdn = dash && dash.cdns && (dash.cdns[dash.default_cdn] || Object.values(dash.cdns)[0]);
        const playlist = cdn ? cdn.url || cdn.avc_url || '' : '';
        return {
            title: (config && config.video && config.video.title) || '',
            drm: !!request.drm || /\/drm\//.test(playlist),
            // The JSON one: an .mpd beside it says the same in XML.
            playlist: playlist.replace(/\/playlist\.mpd(?=[?#]|$)/, '/playlist.json'),
        };
    }

    /** A base64 init segment as bytes. */
    const unbase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

    /**
     * The JSON playlist as renditions to choose from. Each segment's address
     * is relative to the stream's base, the stream's to the playlist's, and
     * that one to the playlist's own address.
     */
    function readPlaylist(playlist, url) {
        const base = new URL(playlist.base_url || '', url);
        const stream = (one) => {
            const at = new URL(one.base_url || '', base);
            return {
                head: unbase64(one.init_segment || ''),
                urls: (one.segments || []).map((segment) => new URL(segment.url, at).href),
                seconds: Number(one.duration) || 0,
                bitrate: one.bitrate || 0,
                codecs: String(one.codecs || ''),
            };
        };
        const video = (playlist.video || []).filter((one) => /^video\/mp4/.test(one.mime_type) && String(one.codecs).slice(0, 4) in RANK)
            .map((one) => ({
                ...stream(one), width: one.width, height: one.height, p: Math.min(one.width, one.height),
                label: `${Math.min(one.width, one.height)}p`, fps: Math.round(one.framerate || 0), rank: RANK[String(one.codecs).slice(0, 4)],
            }));
        // AAC first, as the codec every player has; Opus in MP4 after it.
        const audio = (playlist.audio || []).filter((one) => /^audio\/mp4/.test(one.mime_type)).map(stream)
            .sort((a, b) => (b.codecs.startsWith('mp4a') - a.codecs.startsWith('mp4a')) || b.bitrate - a.bitrate);
        return { video, audio };
    }

    async function plan({ want, win, doc, fetchImpl, signal }) {
        const clip = clipOf(win.location.href);
        if (!clip) throw new Error('Open a Vimeo video first');
        const config = readConfig(await fetchConfig(clip, { doc, fetchImpl, signal }));
        if (config.drm) throw new Error(DRM_REFUSAL);
        if (!config.playlist) throw new Error('Vimeo listed no streams for this video');
        const response = await fetchImpl(config.playlist, { credentials: 'omit', signal });
        if (!response.ok) throw new Error(`Vimeo refused the list of streams (${response.status})`);
        const { video: videos, audio } = readPlaylist(await response.json(), config.playlist);
        const { pick, fileName } = root.BB.VideoDownload;
        const video = pick(videos, want);
        if (!video) throw new Error('Vimeo offered no MP4 streams for this video');
        const streams = [video, ...audio.slice(0, 1)].map(({ head, urls, seconds }) => ({ head, urls, seconds }));
        return { label: video.label, fileName: fileName(config.title, video.label), streams };
    }

    const adapter = { site: 'vimeo', onVideo, plan };

    const VimeoDownload = { DRM_REFUSAL, clipOf, readConfig, readPlaylist, adapter };

    root.BB = root.BB || {};
    root.BB.VimeoDownload = VimeoDownload;
    if (typeof module !== 'undefined' && module.exports) module.exports = VimeoDownload;
})(typeof globalThis !== 'undefined' ? globalThis : this);
