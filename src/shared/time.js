/** Time formatting/parsing shared by the content script, popup and dashboard. */
(function (root) {
    'use strict';

    /** Seconds -> "M:SS", or "H:MM:SS" past an hour. */
    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        const pad = (n) => n.toString().padStart(2, '0');
        return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
    }

    /**
     * Parse a YouTube `t=` value into seconds. Accepts both the compound form
     * ("1h2m3s", "90s") and a bare second count ("90").
     */
    function parseTimestamp(value) {
        if (value == null) return 0;
        const text = String(value).trim();
        if (!text) return 0;

        if (/^\d+(\.\d+)?$/.test(text)) return Math.floor(parseFloat(text));

        const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
        if (!match || !match.slice(1).some(Boolean)) return 0;
        return (parseInt(match[1] || 0, 10) * 3600) +
            (parseInt(match[2] || 0, 10) * 60) +
            parseInt(match[3] || 0, 10);
    }

    const Time = { formatTime, parseTimestamp };

    root.BB = root.BB || {};
    root.BB.Time = Time;
    if (typeof module !== 'undefined' && module.exports) module.exports = Time;
})(typeof globalThis !== 'undefined' ? globalThis : this);
