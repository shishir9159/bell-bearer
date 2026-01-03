/**
 * How many games you have played today, per site and per time control, and
 * how many more the popup has let through.
 *
 * The counts come from each site's public API — the same reads the dashboard
 * already makes — so games played on a phone or in another browser count too.
 * That is the whole point of a daily limit: it is a limit on the day, not on
 * this copy of Chrome. src/background/chess-limits.js does the reading and
 * writes what it found here; the content script and the popup only read.
 *
 * A grant is the override: the popup's button adds one more game to each
 * limited control, and grants are forgotten at local midnight along with the
 * counts, so yesterday's indulgence never carries over.
 *
 * Everything above the "storage" line is pure and covered by
 * tests/node-check.js.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Time = ns.Time || req('./time.js');
    const ChessSites = ns.ChessSites || req('./chess-sites.js');

    const CLASSES = ChessSites.CLASSES;

    /** 'YYYY-MM-DD' in local time — the day a limit runs to midnight of. */
    const dayKey = (ms = Date.now()) => Time.dayKey(ms);

    function zeroes() {
        const out = {};
        for (const name of CLASSES) out[name] = 0;
        return out;
    }

    function blankSite() {
        return { counts: zeroes(), grants: zeroes(), checkedAt: 0 };
    }

    function blank(now = Date.now()) {
        const sites = {};
        for (const site of ChessSites.list()) sites[site.id] = blankSite();
        return { day: dayKey(now), sites };
    }

    /**
     * `state` as it applies to `now` — a state left over from an earlier day
     * is blank, counts and grants both. Never mutates what it was given.
     */
    function forDay(state, now = Date.now()) {
        const today = dayKey(now);
        if (!state || state.day !== today) return blank(now);
        const sites = {};
        for (const site of ChessSites.list()) {
            const stored = state.sites && state.sites[site.id];
            sites[site.id] = {
                counts: { ...zeroes(), ...(stored && stored.counts) },
                grants: { ...zeroes(), ...(stored && stored.grants) },
                checkedAt: (stored && Number(stored.checkedAt)) || 0,
            };
        }
        return { day: today, sites };
    }

    /**
     * Games from a site reader, bucketed by time control, counting only those
     * that ended today. Speeds that are not one sitting — chess.com's daily,
     * Lichess's correspondence — fall outside every bucket and are ignored.
     */
    function countToday(games, now = Date.now()) {
        const today = dayKey(now);
        const out = zeroes();
        for (const game of games || []) {
            if (!game || !game.end || dayKey(game.end) !== today) continue;
            const name = ChessSites.bucket(game.timeClass);
            if (name) out[name]++;
        }
        return out;
    }

    /** `state` with a site's counts replaced by a fresh reading. */
    function withCounts(state, siteId, counts, now = Date.now()) {
        const next = forDay(state, now);
        if (!next.sites[siteId]) return next;
        next.sites[siteId] = {
            ...next.sites[siteId],
            counts: { ...zeroes(), ...counts },
            checkedAt: now,
        };
        return next;
    }

    /**
     * `state` with one more game allowed in every limited control on `siteId`.
     * That is what the popup's override does: not "lift the limit", but "one
     * more each", so the block comes back after the next game.
     */
    function withOneMore(state, siteId, settings, now = Date.now()) {
        const next = forDay(state, now);
        const site = next.sites[siteId];
        if (!site) return next;
        const grants = { ...site.grants };
        for (const name of CLASSES) {
            if (ChessSites.limitFor(settings, siteId, name) != null) grants[name]++;
        }
        next.sites[siteId] = { ...site, grants };
        return next;
    }

    /**
     * What each time control on a site stands at right now:
     * `{ limit, count, grant, allowed, remaining, blocked }` per class, where
     * `limit` is null when the control is not limited. `allowed` folds in the
     * grants, so it is what the next game is actually measured against.
     */
    function statusFor(state, settings, siteId, now = Date.now()) {
        const site = forDay(state, now).sites[siteId] || blankSite();
        const classes = {};
        let anyBlocked = false;
        let anyLimited = false;

        for (const name of CLASSES) {
            const limit = ChessSites.limitFor(settings, siteId, name);
            const count = site.counts[name] || 0;
            const grant = site.grants[name] || 0;
            const allowed = limit == null ? null : limit + grant;
            const blocked = allowed != null && count >= allowed;
            if (limit != null) anyLimited = true;
            if (blocked) anyBlocked = true;
            classes[name] = {
                limit,
                count,
                grant,
                allowed,
                remaining: allowed == null ? null : Math.max(0, allowed - count),
                blocked,
            };
        }

        return {
            site: siteId,
            classes,
            anyLimited,
            anyBlocked,
            blocked: CLASSES.filter((name) => classes[name].blocked),
            checkedAt: site.checkedAt,
        };
    }

    /** True when this game may not be started. Unbucketed speeds never block. */
    function isBlocked(status, timeClass) {
        const name = ChessSites.bucket(timeClass) || timeClass;
        return !!(status && status.classes[name] && status.classes[name].blocked);
    }

    // ------------------------------------------------------------- storage

    async function load(now = Date.now()) {
        try {
            const stored = await chrome.storage.local.get([Settings.DATA.chessLimits]);
            return forDay(stored[Settings.DATA.chessLimits], now);
        } catch (_) {
            return blank(now);
        }
    }

    async function save(state) {
        return Settings.set({ [Settings.DATA.chessLimits]: state });
    }

    /** Read, apply `change(state)`, write. Returns the state that was written. */
    async function update(change, now = Date.now()) {
        const next = change(await load(now));
        await save(next);
        return next;
    }

    const ChessLimits = {
        KEY: Settings.DATA.chessLimits,
        dayKey, zeroes, blank, forDay, countToday,
        withCounts, withOneMore, statusFor, isBlocked,
        load, save, update,
    };

    root.BB = root.BB || {};
    root.BB.ChessLimits = ChessLimits;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChessLimits;
})(typeof globalThis !== 'undefined' ? globalThis : this);
