/**
 * LeetCode's own submission calendar, read from its public GraphQL endpoint.
 *
 * The practice log this extension keeps can only count what it watched: it
 * knows nothing about the year before it was installed, or about submissions
 * made on another machine. LeetCode knows all of it, and will tell anyone who
 * asks for a username — no sign-in, no token, no key. So the heat map's
 * "Submissions" metric comes from here when a username is set, and the log
 * stays the source for the two things this endpoint cannot answer.
 *
 * What it gives back is one number per day: how many submissions were made.
 * Not how many passed, and not how long any of them took — those are only in
 * the local log, which is why the other two metrics still read from there and
 * say so rather than quietly showing a different year's worth of data.
 *
 * The day keys are UTC midnights, and they are formatted as UTC here on
 * purpose. The local store buckets by *local* day, so the two disagree by a
 * few hours' worth of submissions either side of midnight — and of the two
 * possible wrong answers, "the same squares LeetCode's own profile draws" is
 * the one a person can check. See dayKeyUtc.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    const ENDPOINT = 'https://leetcode.com/graphql';
    const KEY = Settings.DATA.leetCalendar;

    /**
     * How long a fetched calendar is good for. Long enough that opening the
     * dashboard repeatedly is one request, short enough that a problem solved
     * this morning shows up this afternoon.
     */
    const TTL_MS = 30 * 60 * 1000;

    /** LeetCode rejects a request that sits too long; so do we. */
    const TIMEOUT_MS = 12000;

    const QUERY = `query userProfileCalendar($username: String!, $year: Int) {
  matchedUser(username: $username) {
    userCalendar(year: $year) {
      activeYears
      streak
      totalActiveDays
      submissionCalendar
    }
  }
}`;

    /** A username as LeetCode spells it: its own alphabet, nothing else. */
    function cleanUsername(value) {
        return String(value == null ? '' : value).trim().replace(/^@/, '').slice(0, 40);
    }

    /**
     * 'YYYY-MM-DD' from a unix timestamp, in UTC.
     *
     * Deliberately not the local formatting shared/leetcode.js uses. These
     * timestamps are LeetCode's own day boundaries; re-reading them in the
     * viewer's time zone would slide every square by a day for anyone far
     * enough east or west, and disagree with the calendar on their profile
     * page. See the file comment.
     */
    function dayKeyUtc(seconds) {
        return new Date(Number(seconds) * 1000).toISOString().slice(0, 10);
    }

    /** An error worth showing a person, rather than a stack. */
    function fail(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    /**
     * Ask LeetCode for a username's calendar.
     *
     * `credentials: 'omit'` is the point of the whole feature: this is public
     * data, so the request carries no cookies, tells LeetCode nothing about
     * who is asking, and works for a username that is not the signed-in one.
     * It also means a signed-out browser gets the same answer.
     */
    async function fetchCalendar(username, { year, fetcher = fetch } = {}) {
        const user = cleanUsername(username);
        if (!user) throw fail('no-username', 'No LeetCode username is set');

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : 0;

        let body;
        try {
            const response = await fetcher(ENDPOINT, {
                method: 'POST',
                credentials: 'omit',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ query: QUERY, variables: year ? { username: user, year } : { username: user } }),
                signal: controller ? controller.signal : undefined,
            });
            if (!response.ok) throw fail('http', `LeetCode answered ${response.status}`);
            body = await response.json();
        } catch (error) {
            if (error && error.code) throw error;
            throw fail('network', 'Could not reach LeetCode');
        } finally {
            if (timer) clearTimeout(timer);
        }

        const matched = body && body.data && body.data.matchedUser;
        if (!matched) throw fail('not-found', `No LeetCode user called "${user}"`);

        const calendar = matched.userCalendar || {};
        return { user, ...parseCalendar(calendar) };
    }

    /**
     * The calendar as the heat map wants it.
     *
     * `submissionCalendar` arrives as a JSON *string* rather than an object,
     * which is LeetCode's choice and not a mistake to be tidied away — it is
     * parsed here, and a day whose count is not a number is dropped rather
     * than drawn as NaN.
     */
    function parseCalendar(calendar) {
        let raw = {};
        try {
            raw = JSON.parse(calendar.submissionCalendar || '{}') || {};
        } catch (_) {
            raw = {};
        }

        const days = {};
        let total = 0;
        for (const [seconds, count] of Object.entries(raw)) {
            const n = Math.max(0, Math.round(Number(count)) || 0);
            if (!n || !Number.isFinite(Number(seconds))) continue;
            const key = dayKeyUtc(seconds);
            days[key] = (days[key] || 0) + n;
            total += n;
        }

        return {
            days,
            total,
            streak: Math.max(0, Math.round(Number(calendar.streak)) || 0),
            activeDays: Math.max(0, Math.round(Number(calendar.totalActiveDays)) || 0),
            activeYears: Array.isArray(calendar.activeYears) ? calendar.activeYears.slice() : [],
        };
    }

    // ------------------------------------------------------------ storage

    async function readCache() {
        try {
            const stored = await chrome.storage.local.get([KEY]);
            return (stored && stored[KEY]) || null;
        } catch (_) {
            return null;
        }
    }

    async function writeCache(value) {
        try {
            await chrome.storage.local.set({ [KEY]: value });
        } catch (_) { /* a full or torn-down storage is not worth failing over */ }
    }

    const isFresh = (cache, user, now) =>
        !!cache && cache.user === user && now - (cache.fetchedAt || 0) < TTL_MS;

    /**
     * The calendar for `username`, from the cache when it is recent enough.
     *
     * `force` is the Refresh button. A cache for a *different* username is
     * never served, which is what stops changing the name in Settings showing
     * the previous person's year until the TTL runs out.
     */
    async function calendar(username, { force = false, now = Date.now(), fetcher } = {}) {
        const user = cleanUsername(username);
        if (!user) throw fail('no-username', 'No LeetCode username is set');

        const cache = await readCache();
        if (!force && isFresh(cache, user, now)) return { ...cache, cached: true };

        try {
            const fresh = await fetchCalendar(user, { fetcher });
            const record = { ...fresh, fetchedAt: now };
            await writeCache(record);
            return { ...record, cached: false };
        } catch (error) {
            // A stale calendar beats an empty one: the year did not change
            // because the network did. The caller is told it is stale so it
            // can say so.
            if (cache && cache.user === user) return { ...cache, cached: true, stale: true, error };
            throw error;
        }
    }

    const LeetApi = {
        ENDPOINT, QUERY, KEY, TTL_MS,
        cleanUsername, dayKeyUtc, parseCalendar, fetchCalendar, calendar,
    };

    root.BB = root.BB || {};
    root.BB.LeetApi = LeetApi;
    if (typeof module !== 'undefined' && module.exports) module.exports = LeetApi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
