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

    /** Canonical watch URL, with a `t=` when `seconds` is past the start. */
    function watchUrl(videoId, seconds) {
        const base = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
        const at = Math.floor(Number(seconds) || 0);
        return at > 0 ? `${base}&t=${at}s` : base;
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

    const YouTube = {
        extractVideoId, isYouTubeUrl, watchUrl, parseTimestampLink,
        extractChannelId, extractCanonicalChannelId,
    };

    root.BB = root.BB || {};
    root.BB.YouTube = YouTube;
    if (typeof module !== 'undefined' && module.exports) module.exports = YouTube;
})(typeof globalThis !== 'undefined' ? globalThis : this);
