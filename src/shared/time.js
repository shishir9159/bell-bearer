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

    /** Milliseconds in each unit, largest first, for relativeTime below. */
    const AGES = [
        ['year', 31536e6],
        ['month', 2592e6],
        ['week', 6048e5],
        ['day', 864e5],
        ['hour', 36e5],
        ['minute', 6e4],
    ];

    /**
     * A publish timestamp as "3 days ago", the way the video cards label them.
     *
     * Rounds down, so something posted 13 days ago reads "1 week ago" rather
     * than "2 weeks ago" — a card should never claim a video is older than it
     * is. Anything under a minute, and anything dated in the future (clock skew
     * between a feed and this machine is ordinary), reads "just now".
     *
     * A missing date returns '' rather than a duration. Feed.parseFeed stores
     * 0 when an entry carries no published date, and treating that as a real
     * instant dated every such video to the epoch — "56 years ago" on a card
     * for a video posted last week.
     */
    function relativeTime(timestamp, now = Date.now()) {
        const at = Number(timestamp);
        if (!at || !Number.isFinite(at)) return '';

        const elapsed = now - at;
        if (!Number.isFinite(elapsed) || elapsed < 6e4) return 'just now';

        for (const [unit, size] of AGES) {
            const count = Math.floor(elapsed / size);
            if (count >= 1) return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
        }
        return 'just now';
    }

    const Time = { formatTime, parseTimestamp, relativeTime };

    root.BB = root.BB || {};
    root.BB.Time = Time;
    if (typeof module !== 'undefined' && module.exports) module.exports = Time;
})(typeof globalThis !== 'undefined' ? globalThis : this);
