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
 * Wiring in background.js: call `BB.Activity.tick(tab)` on a short alarm
 * (15s is plenty) with the focused tab, and `BB.Activity.blur()` when the
 * window loses focus. The store does the bucketing.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});

    const KEY = 'bb_activity';
    const SETTING = 'trackActivity';
    const KEEP_DAYS = 60;
    const IDLE_GAP_MS = 90 * 1000;

    let last = null; // { at, host, title }

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

    async function enabled() {
        if (BB.Settings && BB.Settings.get) return !!(await BB.Settings.get([SETTING]))[SETTING];
        return new Promise((done) => chrome.storage.sync.get([SETTING], (o) => done(!!o[SETTING])));
    }

    function prune(data) {
        const cutoff = dayKey(Date.now() - KEEP_DAYS * 864e5);
        Object.keys(data).forEach((day) => { if (day < cutoff) delete data[day]; });
        return data;
    }

    /**
     * Credit the gap since the previous tick to whatever was focused then —
     * measuring elapsed time rather than counting ticks keeps the total honest
     * when the worker is suspended between alarms.
     */
    async function tick(tab) {
        if (!(await enabled())) return;

        const now = Date.now();
        const previous = last;
        const host = tab && hostOf(tab.url || '');
        last = host ? { at: now, host, title: tab.title || host } : null;

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

    function blur() { last = null; }

    async function clear() { await write({}); last = null; }

    /** `days` = 1 for today, 7 and 30 for the ranges the view offers. */
    async function summary(days) {
        const data = await read();
        const keys = [];
        for (let i = 0; i < days; i++) keys.push(dayKey(Date.now() - i * 864e5));

        const hosts = {};
        const hours = new Array(24).fill(0);
        const daily = [];
        let total = 0;

        keys.forEach((key) => {
            const day = data[key];
            if (!day) return;
            total += day.total;
            day.hours.forEach((seconds, hour) => { hours[hour] += seconds; });
            Object.entries(day.hosts).forEach(([host, seconds]) => {
                hosts[host] = (hosts[host] || 0) + seconds;
            });
            if (day.top) daily.push({ day: key, ...day.top });
        });

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
            days: keys.filter((key) => data[key]).length,
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

    BB.Activity = { KEY, SETTING, tick, blur, clear, summary, human, hostOf };
})(typeof window !== 'undefined' ? window : self);
