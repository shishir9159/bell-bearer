/** YouTube URL parsing shared by the content script, popup and dashboard. */
(function (root) {
    'use strict';

    const Time = (root.BB && root.BB.Time) ||
        (typeof require === 'function' ? require('./time.js') : null);

    /**
     * Video id from any YouTube URL: /watch?v=, youtu.be/, /shorts/, /embed/,
     * /live/.
     *
     * Parses the URL rather than running /[?&]v=([^&]+)/ over the raw string —
     * that regex also matched a `v=` buried in a redirect target, so a link like
     * `youtube.com/redirect?q=...%3Fv%3DXXXX` was read as video XXXX.
     */
    function extractVideoId(url) {
        if (!url) return null;
        try {
            const parsed = new URL(url, 'https://www.youtube.com');
            const host = parsed.hostname.replace(/^www\./, '');

            if (host === 'youtu.be') return parsed.pathname.slice(1).split('/')[0] || null;
            if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;

            const path = parsed.pathname;
            const embedded = path.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
            if (embedded) return embedded[1];

            return parsed.searchParams.get('v') || null;
        } catch (_) {
            return null;
        }
    }

    function isYouTubeUrl(url) {
        if (!url) return false;
        try {
            const host = new URL(url).hostname.replace(/^www\./, '');
            return host === 'youtu.be' || /(^|\.)youtube(-nocookie)?\.com$/.test(host);
        } catch (_) {
            return false;
        }
    }

    /**
     * Canonical watch URL, with a `t=` when `seconds` is past the start, and
     * inside `playlist` — a place in one, as playlistPlace reads it — when
     * it is given one.
     */
    function watchUrl(videoId, seconds, playlist) {
        let url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
        if (playlist && playlist.list) {
            url += `&list=${encodeURIComponent(playlist.list)}`;
            if (playlist.index) url += `&index=${playlist.index}`;
        }
        const at = Math.floor(Number(seconds) || 0);
        return at > 0 ? `${url}&t=${at}s` : url;
    }

    /**
     * Parse one pasted timestamp link into { videoId, time }, or null when the
     * line is not a YouTube URL.
     */
    function parseTimestampLink(url) {
        const text = String(url || '').trim();
        if (!text) return null;

        const videoId = extractVideoId(text);
        if (!videoId) return null;

        let time = 0;
        try {
            const parsed = new URL(text, 'https://www.youtube.com');
            // youtu.be puts the offset in the fragment as often as in the query.
            const raw = parsed.searchParams.get('t') ||
                parsed.searchParams.get('start') ||
                (parsed.hash.match(/(?:^#|&)t=([^&]+)/) || [])[1];
            time = Time.parseTimestamp(raw);
        } catch (_) {
            time = 0;
        }

        return { videoId, time, title: null };
    }

    /** Channel key used to de-duplicate the pouch: "@name", "/channel/UC…", … */
    function extractChannelId(url) {
        if (!url) return null;
        try {
            const path = new URL(url, 'https://www.youtube.com').pathname;
            if (path.startsWith('/@')) return path.slice(1);
            if (/^\/(channel|c|user)\//.test(path)) return path;
            return path || null;
        } catch (_) {
            return null;
        }
    }

    /** The UC… id an RSS feed needs, when the URL already carries one. */
    function extractCanonicalChannelId(url) {
        const match = String(url || '').match(/\/channel\/(UC[\w-]{20,})/);
        return match ? match[1] : null;
    }

    /**
     * The playlist a URL names, or null.
     *
     * Only real playlists come back. YouTube puts a `list=` on a watch URL for
     * autoplay mixes too, and those ids (RD…, UL…, TL…) are generated per
     * viewer and have no feed — following one would be following nothing.
     */
    function extractPlaylistId(url) {
        if (!url) return null;
        try {
            const parsed = new URL(url, 'https://www.youtube.com');
            const id = parsed.searchParams.get('list');
            if (!id) return null;
            return /^(RD|UL|TL|LL|WL)/.test(id) ? null : id;
        } catch (_) {
            return null;
        }
    }

    /**
     * Where in a playlist a watch URL is playing — `{ list, index }` — or
     * null when it is in none. A real playlist, as above, and for a link's
     * sake here: `list=WL` or a mix's id opens whatever the person following
     * the link has under it, not what was being watched. `index` is the
     * video's place in the list, and '' when the URL does not say.
     */
    function playlistPlace(url) {
        const list = extractPlaylistId(url);
        if (!list) return null;
        const index = new URL(url, 'https://www.youtube.com').searchParams.get('index') || '';
        return { list, index: /^\d+$/.test(index) ? index : '' };
    }

    /** Canonical URL for a playlist page. */
    function playlistUrl(playlistId) {
        return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
    }

    const YouTube = {
        extractVideoId, isYouTubeUrl, watchUrl, parseTimestampLink,
        extractChannelId, extractCanonicalChannelId,
        extractPlaylistId, playlistPlace, playlistUrl,
    };

    root.BB = root.BB || {};
    root.BB.YouTube = YouTube;
    if (typeof module !== 'undefined' && module.exports) module.exports = YouTube;
})(typeof globalThis !== 'undefined' ? globalThis : this);
