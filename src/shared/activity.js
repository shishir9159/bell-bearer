/**
 * Activity store — what the Activity view reads.
 *
 * Off unless `trackActivity` is on. Nothing is recorded, and nothing is kept,
 * while the setting is off. Everything stays in chrome.storage.local on this
 * machine; no network, no history API, no per-URL log beyond the single
 * longest page of each day.
 *
 * Shape:
 *   bb_activity = {
 *     "2026-08-30": {
 *       total: 15120,                        // seconds of focused time
 *       hours: [0,0,…],                      // 24 buckets, seconds
 *       hosts: { "github.com": 6480, … },    // seconds per site
 *       top:   { title, host, seconds }      // longest single page that day
 *     }, …
 *   }
 *
 * Wiring in background.js: call `BB.Activity.tick(tab)` on a short alarm with
 * the focused tab, and `BB.Activity.blur()` when the window loses focus. The
 * store does the bucketing.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});

    const KEY = 'bb_activity';
    const LAST_KEY = 'bb_activity_last';
    const SETTING = 'trackActivity';
    const KEEP_DAYS = 60;
    const IDLE_GAP_MS = 90 * 1000;

    const DAY_MS = 864e5;

    /**
     * The previous reading, `{ at, host, title }`, or null for "nothing was
     * focused". `undefined` means it has not been read back yet in this
     * process.
     *
     * It has to outlive the process. An MV3 service worker is torn down a few
     * seconds after it goes idle, which is most of the gap between two alarms:
     * held in a plain variable, the marker was gone by the time the next tick
     * ran, so every tick was the first tick, `if (!previous) return` fired
     * every time, and the store stayed empty however long the browser was
     * open. It is persisted below, with this variable kept as a write-through
     * copy so a worker that is still alive pays nothing to read it back.
     */
    let cached;

    const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
    const blankDay = () => ({ total: 0, hours: new Array(24).fill(0), hosts: {}, top: null });

    function hostOf(url) {
        try {
            const host = new URL(url).hostname.replace(/^www\./, '');
            return /^https?:/.test(url) ? host : null;
        } catch (error) {
            return null;
        }
    }

    const read = () => new Promise((done) => chrome.storage.local.get([KEY], (o) => done(o[KEY] || {})));
    const write = (data) => new Promise((done) => chrome.storage.local.set({ [KEY]: data }, done));

    /**
     * Where the marker lives: storage.session where it exists, because it is
     * memory-backed and dies with the browser — exactly the lifetime a note
     * about what was focused a moment ago wants, and no disk write per tick.
     * storage.local is the fallback for anywhere session is missing.
     */
    function scratch() {
        try {
            return (chrome.storage && chrome.storage.session) || chrome.storage.local;
        } catch (_) {
            return null;
        }
    }

    function readLast() {
        if (cached !== undefined) return Promise.resolve(cached);
        const area = scratch();
        if (!area) return Promise.resolve((cached = null));
        return new Promise((done) => {
            try {
                area.get([LAST_KEY], (out) => done((cached = (out && out[LAST_KEY]) || null)));
            } catch (_) {
                done((cached = null));
            }
        });
    }

    /**
     * "Nothing focused" is stored as null rather than removed: neither storage
     * area is guaranteed to expose remove(), and a stored null reads back the
     * same as a missing key.
     */
    function writeLast(value) {
        cached = value || null;
        const area = scratch();
        if (!area) return Promise.resolve();
        return new Promise((done) => {
            try {
                area.set({ [LAST_KEY]: cached }, () => done());
            } catch (_) {
                done();
            }
        });
    }

    async function enabled() {
        if (BB.Settings && BB.Settings.get) return !!(await BB.Settings.get([SETTING]))[SETTING];
        return new Promise((done) => chrome.storage.local.get([SETTING], (o) => done(!!o[SETTING])));
    }

    function prune(data) {
        const cutoff = dayKey(Date.now() - KEEP_DAYS * DAY_MS);
        Object.keys(data).forEach((day) => { if (day < cutoff) delete data[day]; });
        return data;
    }

    /**
     * Credit the gap since the previous tick to whatever was focused then —
     * measuring elapsed time rather than counting ticks keeps the total honest
     * when the worker is suspended between alarms.
     *
     * `now` is a seam for the tests: the store's whole job is arithmetic on
     * elapsed time, and a test that has to sleep through that time in real
     * seconds is both slow and flaky. Callers in the extension never pass it.
     */
    async function tick(tab, now = Date.now()) {
        if (!(await enabled())) return;

        const previous = await readLast();
        const host = tab && hostOf(tab.url || '');
        await writeLast(host ? { at: now, host, title: tab.title || host } : null);

        if (!previous) return;
        const seconds = Math.round((now - previous.at) / 1000);
        if (seconds <= 0 || now - previous.at > IDLE_GAP_MS) return;

        const data = prune(await read());
        const key = dayKey(previous.at);
        const day = (data[key] = data[key] || blankDay());

        day.total += seconds;
        day.hours[new Date(previous.at).getHours()] += seconds;
        day.hosts[previous.host] = (day.hosts[previous.host] || 0) + seconds;

        const running = (day.top && day.top.title === previous.title ? day.top.seconds : 0) + seconds;
        if (!day.top || running > day.top.seconds) {
            day.top = { title: previous.title, host: previous.host, seconds: running };
        }

        await write(data);
    }

    /**
     * Stop the clock. The in-memory copy is cleared synchronously, so a caller
     * that does not await this still cannot have the next tick credit time to
     * a window that has lost focus.
     */
    function blur() { return writeLast(null); }

    async function clear() {
        await write({});
        await writeLast(null);
    }

    /**
     * Fold `days` days of the store, ending `offset` days before today, into
     * one summary. It takes the store rather than reading it, so a caller that
     * wants two windows pays for one read.
     */
    function summarize(data, days, offset = 0) {
        const keys = [];
        for (let i = 0; i < days; i++) keys.push(dayKey(Date.now() - (offset + i) * DAY_MS));

        const hosts = {};
        const hours = new Array(24).fill(0);
        const daily = [];
        let total = 0;
        let counted = 0;

        for (const key of keys) {
            const day = data[key];
            if (!day) continue;
            counted += 1;
            total += day.total;
            for (let hour = 0; hour < 24; hour++) hours[hour] += day.hours[hour] || 0;
            for (const host of Object.keys(day.hosts)) {
                hosts[host] = (hosts[host] || 0) + day.hosts[host];
            }
            if (day.top) daily.push({ day: key, ...day.top });
        }

        const ranked = Object.entries(hosts)
            .map(([host, seconds]) => ({ host, seconds }))
            .sort((a, b) => b.seconds - a.seconds);

        return {
            total,
            sites: ranked.length,
            hosts: ranked,
            hours,
            peakHour: hours.indexOf(Math.max(...hours)),
            daily: daily.sort((a, b) => (a.day < b.day ? 1 : -1)),
            longest: daily.reduce((best, entry) => (!best || entry.seconds > best.seconds ? entry : best), null),
            days: counted,
        };
    }

    /** `days` = 1 for today, 7 and 30 for the ranges the view offers. */
    async function summary(days) {
        return summarize(await read(), days);
    }

    /**
     * The window on screen, and the total of the one before it, from a single
     * read. The view's "vs the period before" line used to cost a second full
     * read of the store for what is one subtraction.
     */
    async function report(days) {
        const data = await read();
        return {
            now: summarize(data, days),
            previousTotal: summarize(data, days, days).total,
        };
    }

    /** 3720 → "1h 2m". Minutes only under an hour; seconds only under a minute. */
    function human(seconds) {
        if (!seconds) return '0m';
        if (seconds < 60) return `${seconds}s`;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.round((seconds % 3600) / 60);
        if (!hours) return `${minutes}m`;
        return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    const Activity = { KEY, LAST_KEY, SETTING, tick, blur, clear, summary, report, summarize, human, hostOf };

    BB.Activity = Activity;
    if (typeof module !== 'undefined' && module.exports) module.exports = Activity;
})(typeof globalThis !== 'undefined' ? globalThis : this);
