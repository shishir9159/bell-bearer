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

    /**
     * The same age as "6h", "3d", "1w" — the compact stamp X puts on a post.
     *
     * The X pouch stores when a post was made rather than the string X was
     * showing at the time, because a stored "6h" is wrong by tomorrow. This is
     * how that number is put back into the shape the design draws.
     *
     * Rounds down, like relativeTime and for the same reason, and answers ''
     * for a missing date rather than dating it to the epoch.
     */
    const SHORT_AGES = [
        ['y', 31536e6],
        ['w', 6048e5],
        ['d', 864e5],
        ['h', 36e5],
        ['m', 6e4],
    ];

    function shortAge(timestamp, now = Date.now()) {
        const at = Number(timestamp);
        if (!at || !Number.isFinite(at)) return '';

        const elapsed = now - at;
        if (!Number.isFinite(elapsed) || elapsed < 6e4) return 'now';

        for (const [unit, size] of SHORT_AGES) {
            const count = Math.floor(elapsed / size);
            if (count >= 1) return `${count}${unit}`;
        }
        return 'now';
    }

    /**
     * 'YYYY-MM-DD' for the **local** day `ms` falls on, or the day `back` days
     * before it. Every daily feature buckets by the day the user was sitting
     * at the keyboard on: `toISOString().slice(0, 10)` is UTC, which files an
     * evening east of Greenwich under tomorrow.
     *
     * `back` walks the calendar rather than subtracting 24 hours, which on a
     * daylight-saving day lands an hour off and can name the same day twice.
     */
    function dayKey(ms = Date.now(), back = 0) {
        const at = new Date(ms);
        const day = back ? new Date(at.getFullYear(), at.getMonth(), at.getDate() - back, 12) : at;
        const pad = (n) => String(n).padStart(2, '0');
        return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    }

    const Time = { formatTime, parseTimestamp, relativeTime, shortAge, dayKey };

    root.BB = root.BB || {};
    root.BB.Time = Time;
    if (typeof module !== 'undefined' && module.exports) module.exports = Time;
})(typeof globalThis !== 'undefined' ? globalThis : this);
