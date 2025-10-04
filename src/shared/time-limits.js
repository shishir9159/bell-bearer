/**
 * A daily time limit for the two sites that eat an afternoon without anyone
 * deciding to spend one: x.com and reddit.com.
 *
 * The tally is seconds of *focused* time — the tab on screen, in the window
 * the machine's focus is in — and it is kept for the day it was spent on and
 * no longer. A state left over from yesterday is not merged or aged out, it
 * is discarded whole by forDay() the first time today reads it, so nothing
 * here ever amounts to a record of what was browsed when.
 *
 * Nothing is counted while a site's limit is switched off, which is the
 * default for both.
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

    const KEY = Settings.DATA.timeLimits;

    /**
     * The sites a limit can be set on. `id` is what
     * src/content/site.js#detectSite returns, so the page, the dashboard card
     * and the settings panel all name a site the same way.
     */
    const SITES = Object.freeze([
        Object.freeze({
            id: 'twitter', name: 'X', host: 'x.com',
            onKey: 'twitterDailyLimit', minutesKey: 'twitterLimitMinutes',
        }),
        Object.freeze({
            id: 'reddit', name: 'Reddit', host: 'reddit.com',
            onKey: 'redditDailyLimit', minutesKey: 'redditLimitMinutes',
        }),
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

    function zeroes() {
        const out = {};
        for (const site of SITES) out[site.id] = 0;
        return out;
    }

    const blank = (now = Date.now()) => ({ day: dayKey(now), seconds: zeroes() });

    /**
     * `state` as it applies to `now`. Anything from another day is gone, not
     * archived — the whole store is one day deep by design. Never mutates
     * what it was given.
     */
    function forDay(state, now = Date.now()) {
        const today = dayKey(now);
        if (!state || state.day !== today) return blank(now);
        const seconds = zeroes();
        for (const site of SITES) {
            const value = Number(state.seconds && state.seconds[site.id]);
            seconds[site.id] = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
        }
        return { day: today, seconds };
    }

    /**
     * `state` with `seconds` more spent on `siteId`.
     *
     * A single credit is capped at MAX_CREDIT. The page adds the gap since
     * its last tick, and a machine waking from sleep, or a tab restored from
     * the back/forward cache, reports a gap of hours for time nobody spent
     * looking at anything.
     */
    const MAX_CREDIT = 120;

    function add(state, siteId, seconds, now = Date.now()) {
        const next = forDay(state, now);
        if (!byId[siteId]) return next;
        const credit = Math.min(MAX_CREDIT, Math.max(0, Math.round(seconds) || 0));
        next.seconds[siteId] += credit;
        return next;
    }

    /** Today's tally for a site, in seconds, whatever day the state is from. */
    const spentOn = (state, siteId, now = Date.now()) => forDay(state, now).seconds[siteId] || 0;

    /**
     * Where a site stands right now.
     *
     * `allowed` is null when there is no limit — either the switch is off or
     * the minutes are zero, which reads as "no limit" rather than "blocked
     * immediately"; nobody sets a limit of nothing on purpose, and a limit
     * that blocks a site the moment it is enabled looks like a bug.
     */
    function statusFor(state, settings, siteId, now = Date.now()) {
        const site = byId[siteId];
        if (!site) return { on: false, spent: 0, allowed: null, remaining: null, blocked: false };

        const spent = spentOn(state, siteId, now);
        const minutes = Number(settings && settings[site.minutesKey]);
        const on = !!(settings && settings[site.onKey]) && Number.isFinite(minutes) && minutes > 0;
        if (!on) return { on: false, spent, allowed: null, remaining: null, blocked: false };

        const allowed = Math.round(minutes * 60);
        return {
            on: true,
            spent,
            allowed,
            remaining: Math.max(0, allowed - spent),
            blocked: spent >= allowed,
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
        KEY, SITES, MAX_CREDIT,
        get, list, ids, dayKey, blank, forDay, add, spentOn, statusFor, human,
        load, save, update,
    };

    root.BB = root.BB || {};
    root.BB.TimeLimits = TimeLimits;
    if (typeof module !== 'undefined' && module.exports) module.exports = TimeLimits;
})(typeof globalThis !== 'undefined' ? globalThis : this);
