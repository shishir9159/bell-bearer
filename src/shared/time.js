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

    /**
     * Seconds as a length of time, in one of the three shapes the views draw:
     *
     *   'clock'  "42s"  "2m 05s"  "1h 02m"   a clock: chess, a LeetCode attempt
     *   'short'  "42s"  "12m"     "1h 05m"   a stats line, where seconds past
     *                                         the first minute are noise
     *   'loose'  "42s"  "12m"     "1h 2m"    time spent on a site, rounded to
     *                                         the minute, "1h" when it is even
     *
     * There were seven of these, in three shapes, and the rounding copies said
     * "60m" for 3570 seconds and "1h 60m" for 7170: a rounded-up minute is
     * carried into the hour now.
     */
    function duration(seconds, style = 'clock') {
        const s = Math.max(0, Math.round(Number(seconds) || 0));
        if (s < 60) return `${s}s`;
        const pad = (n) => String(n).padStart(2, '0');
        if (style === 'loose') {
            const total = Math.round(s / 60);
            const hours = Math.floor(total / 60);
            const minutes = total % 60;
            if (!hours) return `${minutes}m`;
            return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
        }
        const m = Math.floor(s / 60);
        if (m < 60) return style === 'short' ? `${m}m` : `${m}m ${pad(s % 60)}s`;
        return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
    }

    const isDayKey = (key) => /^\d{4}-\d{2}-\d{2}$/.test(key);

    /**
     * The day buckets of a daily store — `{ "2026-07-15": { … } }` — younger
     * than `keep` days, today counting as one, each passed through `clean`.
     * Gone rather than archived. The LeetCode and TypeRacer stores each had
     * this and runOfDays below, walking back by subtracting a day's worth of
     * milliseconds, which on a daylight-saving day named one date twice.
     */
    function keepDays(days, keep, clean, now = Date.now()) {
        const oldest = dayKey(now, keep - 1);
        const out = {};
        const source = days && typeof days === 'object' && !Array.isArray(days) ? days : {};
        for (const [key, bucket] of Object.entries(source)) {
            if (isDayKey(key) && key >= oldest) out[key] = clean(bucket || {});
        }
        return out;
    }

    /**
     * How many days in a row `counts(bucket)` held, ending today or, while
     * today has nothing yet, yesterday — it is only the afternoon.
     */
    function runOfDays(days, counts, now = Date.now()) {
        let run = 0;
        for (let back = 0; ; back++) {
            const bucket = days[dayKey(now, back)];
            if (!bucket || !counts(bucket)) {
                if (back === 0) continue;
                return run;
            }
            run++;
        }
    }

    const Time = { formatTime, parseTimestamp, relativeTime, shortAge, dayKey, duration, keepDays, runOfDays };

    root.BB = root.BB || {};
    root.BB.Time = Time;
    if (typeof module !== 'undefined' && module.exports) module.exports = Time;
})(typeof globalThis !== 'undefined' ? globalThis : this);
