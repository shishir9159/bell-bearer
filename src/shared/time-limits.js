/**
 * How long has been spent today on each site held to a daily limit, and how
 * long a block has been snoozed for.
 *
 * The tally is seconds of *focused* time — the tab on screen, in the window
 * the machine's focus is in — and it is kept for the day it was spent on and
 * no longer. A state left over from yesterday is not merged or aged out, it
 * is discarded whole by forDay() the first time today reads it, so nothing
 * here ever amounts to a record of what was browsed when.
 *
 * Keyed by host, not by a site id. The limit used to be two settings apiece on
 * the two sites that had a panel to put them in; it is now a list any host can
 * join, kept by shared/limit-sites.js, and this store had to stop enumerating
 * the sites it knew about to follow. SITES below is all that is left of that:
 * two names, so a card and a tab can say "Twitter" rather than "x.com", and
 * nothing at all about whether either has a limit.
 *
 * Nothing is counted for a host with no limit, which is every host until one
 * is added.
 *
 * Who counts: src/content/time-limit.js, on the page itself, because the page
 * is the only thing that knows whether it is the one being looked at. The
 * activity store's approach — an alarm in the worker sampling the focused tab
 * — would have needed a second alarm running all day for a feature that is
 * usually off, and could not tell a visible tab from one behind another
 * window.
 *
 * Everything above the "storage" line is pure and covered by
 * tests/node-check.js.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const LimitSites = ns.LimitSites || req('./limit-sites.js');

    const KEY = Settings.DATA.timeLimits;

    /** How long the button on the sheet stands a block down for. */
    const SNOOZE_MS = 10 * 60 * 1000;

    /**
     * The two sites Bell Bearer has a workspace for, so a card and a Time tab
     * can name one properly. `id` is what src/content/site.js#detectSite
     * returns; `host` is how the limit list spells the same site.
     *
     * Emphatically not "the sites a limit can be set on" any more — that is
     * whatever is in the list.
     */
    const SITES = Object.freeze([
        Object.freeze({ id: 'twitter', name: 'Twitter', host: 'x.com' }),
        Object.freeze({ id: 'reddit', name: 'Reddit', host: 'reddit.com' }),
    ]);

    const byId = Object.freeze(Object.fromEntries(SITES.map((site) => [site.id, site])));

    const get = (id) => byId[id] || null;
    const list = () => SITES.slice();
    const ids = () => SITES.map((site) => site.id);

    /** 'YYYY-MM-DD' in local time — a limit runs to local midnight. */
    function dayKey(ms = Date.now()) {
        const date = new Date(ms);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    const blank = (now = Date.now()) => ({ day: dayKey(now), seconds: {}, snoozed: {} });

    /**
     * `state` as it applies to `now`. Anything from another day is gone, not
     * archived — the whole store is one day deep by design. Never mutates
     * what it was given.
     *
     * An expired snooze is kept rather than dropped, with its `until` left in
     * the past. The count is why: the sheet says which snooze of the day this
     * is, and clearing the row the moment it lapsed would reset that to
     * "first" every ten minutes.
     */
    function forDay(state, now = Date.now()) {
        const today = dayKey(now);
        if (!state || state.day !== today) return blank(now);

        const seconds = {};
        for (const [host, value] of Object.entries(state.seconds || {})) {
            const at = LimitSites.normalizeHost(host);
            const spent = Number(value);
            if (at && Number.isFinite(spent) && spent > 0) seconds[at] = Math.round(spent);
        }

        const snoozed = {};
        for (const [host, row] of Object.entries(state.snoozed || {})) {
            const at = LimitSites.normalizeHost(host);
            const until = Number(row && row.until);
            if (!at || !Number.isFinite(until) || until <= 0) continue;
            snoozed[at] = { until, count: Math.max(1, Math.round(Number(row.count)) || 1) };
        }

        return { day: today, seconds, snoozed };
    }

    /**
     * `state` with `seconds` more spent on `host`.
     *
     * A single credit is capped at MAX_CREDIT. The page adds the gap since
     * its last tick, and a machine waking from sleep, or a tab restored from
     * the back/forward cache, reports a gap of hours for time nobody spent
     * looking at anything.
     */
    const MAX_CREDIT = 120;

    function add(state, host, seconds, now = Date.now()) {
        const next = forDay(state, now);
        const at = LimitSites.normalizeHost(host);
        if (!at) return next;
        const credit = Math.min(MAX_CREDIT, Math.max(0, Math.round(seconds) || 0));
        next.seconds[at] = (next.seconds[at] || 0) + credit;
        return next;
    }

    /** Today's tally for a host, in seconds, whatever day the state is from. */
    const spentOn = (state, host, now = Date.now()) =>
        forDay(state, now).seconds[LimitSites.normalizeHost(host)] || 0;

    /**
     * `state` with the block on `host` stood down for ten minutes.
     *
     * The count goes up every time, and nothing here refuses. A limit you
     * cannot get past is a limit you turn off for good the first time it is
     * wrong, so the sheet has a way through it — and what keeps that honest is
     * being told it is the fourth time today, not being stopped.
     */
    function snooze(state, host, now = Date.now(), ms = SNOOZE_MS) {
        const next = forDay(state, now);
        const at = LimitSites.normalizeHost(host);
        if (!at) return next;
        const before = next.snoozed[at];
        next.snoozed[at] = {
            until: now + Math.max(0, Math.round(ms) || 0),
            count: (before ? before.count : 0) + 1,
        };
        return next;
    }

    /** How many times today a block on `host` has been snoozed. */
    const snoozesOn = (state, host, now = Date.now()) => {
        const row = forDay(state, now).snoozed[LimitSites.normalizeHost(host)];
        return row ? row.count : 0;
    };

    /**
     * Where a host stands right now, given the limit list row covering it.
     *
     * `mode` is 'none' when there is no limit, 'budget' for minutes a day and
     * 'window' for a pair of clock times. `blocked` is the only field the page
     * acts on; the rest is for saying why.
     *
     * A snooze suppresses `blocked` and nothing else — the tally keeps
     * running, so the ten minutes are spent out of the same day's allowance
     * rather than granted on top of it.
     *
     * `allowed` is null for a window, which has no budget to be a fraction of,
     * and for no limit at all. A budget of zero minutes reads as no limit
     * rather than as blocked from the first second: nobody sets a limit of
     * nothing on purpose, and one that bites the moment it is added looks like
     * a bug. That reading lives in LimitSites.modeOf, so the list and the page
     * cannot disagree about it.
     */
    function statusFor(state, entry, host, now = Date.now()) {
        const day = forDay(state, now);
        const at = LimitSites.normalizeHost(host);
        const spent = day.seconds[at] || 0;
        const row = day.snoozed[at];
        const snoozedUntil = row && row.until > now ? row.until : 0;
        const snoozes = row ? row.count : 0;
        const mode = LimitSites.modeOf(entry);

        const rest = { spent, snoozedUntil, snoozes, mode, host: at };
        if (mode === 'none') {
            return { ...rest, on: false, allowed: null, remaining: null, blocked: false, open: true };
        }

        if (mode === 'window') {
            const open = LimitSites.windowOpen(entry, now);
            return {
                ...rest,
                on: true,
                allowed: null,
                remaining: null,
                open,
                blocked: !open && !snoozedUntil,
            };
        }

        const allowed = LimitSites.allowanceOf(entry);
        return {
            ...rest,
            on: true,
            allowed,
            remaining: Math.max(0, allowed - spent),
            open: spent < allowed,
            blocked: spent >= allowed && !snoozedUntil,
        };
    }

    /** 3720 → "1h 2m". Minutes under an hour; seconds under a minute. */
    function human(seconds) {
        const total = Math.max(0, Math.round(seconds) || 0);
        if (total < 60) return `${total}s`;
        const hours = Math.floor(total / 3600);
        const minutes = Math.round((total % 3600) / 60);
        if (!hours) return `${minutes}m`;
        return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    // ----------------------------------------------------------- storage

    async function load() {
        try {
            const stored = await chrome.storage.local.get([KEY]);
            return forDay(stored && stored[KEY]);
        } catch (_) {
            return blank();
        }
    }

    async function save(state) {
        try {
            await chrome.storage.local.set({ [KEY]: state });
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Read, change, write. Two tabs of the same site can both be counting on
     * a machine with two windows open, so the change is applied to what is in
     * storage now rather than to a copy read earlier.
     */
    async function update(change) {
        const next = change(await load());
        await save(next);
        return next;
    }

    const TimeLimits = {
        KEY, SITES, MAX_CREDIT, SNOOZE_MS,
        get, list, ids, dayKey, blank, forDay, add, spentOn, snooze, snoozesOn,
        statusFor, human,
        load, save, update,
    };

    root.BB = root.BB || {};
    root.BB.TimeLimits = TimeLimits;
    if (typeof module !== 'undefined' && module.exports) module.exports = TimeLimits;
})(typeof globalThis !== 'undefined' ? globalThis : this);
