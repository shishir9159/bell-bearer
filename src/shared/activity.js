/**
 * Activity store — what the Activity view reads.
 *
 * Off unless `trackActivity` is on. Nothing is recorded, and nothing is kept,
 * while the setting is off. Everything stays in chrome.storage.local on this
 * machine; no network, no history API, no per-URL log beyond the single
 * longest page of each day.
 *
 * Shape, one key per local day:
 *   bb_activity:2026-08-30 = {
 *     total: 15120,                        // seconds of focused time
 *     hours: [0,0,…],                      // 24 buckets, seconds
 *     hosts: { "github.com": 6480, … },    // seconds per site
 *     top:   { title, host, seconds }      // longest single page that day
 *   }
 *   bb_activity_days = ["2026-08-29", "2026-08-30", …]
 *
 * `top` is dropped after seven days; the rest of a day survives for sixty.
 *
 * Wiring in background.js: call `BB.Activity.tick(tab)` on a short alarm with
 * the focused tab, and `BB.Activity.blur()` when the window loses focus. The
 * store does the bucketing.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const Time = BB.Time || req('./time.js');
    const Settings = BB.Settings || req('./settings.js');

    /**
     * One key per day, and a list of which days there are.
     *
     * The store was one value holding every day, and a tick every thirty
     * seconds read all sixty days and wrote all sixty back — out to every open
     * tab's storage.onChanged each time — to add a few seconds to one of them.
     * Now a tick writes the day it is adding to, and the list only when a new
     * day starts, which is also when the old days are pruned.
     *
     * KEY is the old single value. It is only read to be split, which is also
     * how a backup exported before the split comes back in.
     */
    const {
        activityLegacy: KEY, activityDay: DAY_PREFIX, activityDays: DAYS_KEY, activityLast: LAST_KEY,
    } = Settings.DATA;
    const SETTING = 'trackActivity';
    const KEEP_DAYS = 60;
    /**
     * `top` is the only thing in the store that names a page rather than a
     * host, so it is the only thing kept on a short leash: a week, today
     * included. The totals, hosts and hour buckets are aggregates and keep
     * the 60 days. Enforced on the way in (prune) and again on the way out
     * (summarize), so a store written by an older version cannot hand back a
     * page title from a month ago.
     */
    const TOP_KEEP_DAYS = 7;
    const IDLE_GAP_MS = 90 * 1000;

    /**
     * The previous reading, `{ at, host, title, page, visit }`, or null for
     * "nothing was focused" — `page` the address it was on, and `visit` the
     * seconds already counted on it without a break. `undefined` means it has
     * not been read back yet in this process. The address is held only here,
     * with the reading, and never written into a day.
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

    /**
     * The local day. It was the UTC one, while the hour buckets inside a day
     * were local: east of Greenwich an evening was filed under tomorrow, with
     * its hours at the top of that day's chart, and "today" turned over at the
     * wrong hour. Days recorded under UTC keys are left to age out.
     */
    const dayKey = (ms, back = 0) => Time.dayKey(ms, back);
    const blankDay = () => ({ total: 0, hours: new Array(24).fill(0), hosts: {}, top: null });

    /** A page is its address without the fragment: a jump to a heading is the same page. */
    const pageOf = (url) => String(url || '').split('#')[0];

    function hostOf(url) {
        try {
            const host = new URL(url).hostname.replace(/^www\./, '');
            return /^https?:/.test(url) ? host : null;
        } catch (error) {
            return null;
        }
    }

    const dayStore = (day) => DAY_PREFIX + day;
    const isDay = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day);

    const get = (keys) => new Promise((done) => chrome.storage.local.get(keys, (o) => done(o || {})));
    const set = (values) => new Promise((done) => chrome.storage.local.set(values, done));
    const remove = (keys) => new Promise((done) => chrome.storage.local.remove(keys, done));

    /** The old single value split into days. A day already stored on its own is newer, and kept. */
    async function split(old, days) {
        const had = await get(Object.keys(old).filter(isDay).map(dayStore));
        const writes = {};
        for (const [day, record] of Object.entries(old)) {
            if (isDay(day) && record && !had[dayStore(day)]) writes[dayStore(day)] = record;
        }
        const index = [...new Set([...days, ...Object.keys(old).filter(isDay)])].sort();
        await set({ ...writes, [DAYS_KEY]: index });
        await remove([KEY]);
        return index;
    }

    /** Which days are stored, oldest first. */
    async function index() {
        const stored = await get([KEY, DAYS_KEY]);
        const days = Array.isArray(stored[DAYS_KEY]) ? stored[DAYS_KEY].filter(isDay) : [];
        const old = stored[KEY];
        return old && typeof old === 'object' && !Array.isArray(old) ? split(old, days) : days;
    }

    /** Every stored day, as the one map summarize() folds: `{ "2026-08-30": { … } }`. */
    async function read() {
        const days = await index();
        if (!days.length) return {};
        const stored = await get(days.map(dayStore));
        const out = {};
        for (const day of days) if (stored[dayStore(day)]) out[day] = stored[dayStore(day)];
        return out;
    }

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

    const enabled = async () => !!(await Settings.get([SETTING]))[SETTING];

    /** The oldest day still allowed to name a page, today counting as one. */
    const topCutoff = (now = Date.now()) => dayKey(now, TOP_KEEP_DAYS - 1);

    /**
     * What a new day's first tick writes besides the day itself, and which
     * days it removes: the ones past KEEP_DAYS go, and a day past the week
     * loses the page it named. Once a day rather than on every tick — nothing
     * ages between two ticks of the same day.
     */
    async function prune(days, today, now = Date.now()) {
        const cutoff = dayKey(now, KEEP_DAYS);
        const keepTop = topCutoff(now);
        const kept = days.filter((day) => day >= cutoff);
        const writes = { [DAYS_KEY]: [...new Set([...kept, today])].sort() };

        const titled = kept.filter((day) => day < keepTop);
        const stored = titled.length ? await get(titled.map(dayStore)) : {};
        for (const day of titled) {
            const record = stored[dayStore(day)];
            if (record && record.top) writes[dayStore(day)] = { ...record, top: null };
        }
        return { writes, gone: days.filter((day) => day < cutoff).map(dayStore) };
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
        const page = host ? pageOf(tab.url) : null;
        const seconds = previous ? Math.round((now - previous.at) / 1000) : 0;
        const counted = seconds > 0 && now - previous.at <= IDLE_GAP_MS;
        /**
         * The visit to the page before this reading, this gap included. It
         * runs on while the same page stays in front, and starts again on
         * any other page or after a gap that was not counted.
         */
        const visit = counted ? (previous.visit || 0) + seconds : 0;
        const going = counted && page && previous.page === page ? visit : 0;
        await writeLast(host ? { at: now, host, title: tab.title || host, page, visit: going } : null);

        if (!previous || !counted) return;

        const key = dayKey(previous.at);
        const days = await index();
        const day = (await get([dayStore(key)]))[dayStore(key)] || blankDay();

        day.total += seconds;
        day.hours[new Date(previous.at).getHours()] += seconds;
        day.hosts[previous.host] = (day.hosts[previous.host] || 0) + seconds;

        // The visit, not the day's leader plus this gap. That carried on only
        // for whichever page led already, so a page reached second never
        // added up: B at ninety seconds lost to A at sixty, a tick at a time.
        // And two pages that share a title are two visits.
        if (!day.top || visit > day.top.seconds) {
            day.top = { title: previous.title, host: previous.host, seconds: visit };
        }

        const { writes, gone } = days.includes(key) ? { writes: {}, gone: [] } : await prune(days, key, now);
        await set({ ...writes, [dayStore(key)]: day });
        if (gone.length) await remove(gone);
    }

    /**
     * Stop the clock. The in-memory copy is cleared synchronously, so a caller
     * that does not await this still cannot have the next tick credit time to
     * a window that has lost focus.
     */
    function blur() { return writeLast(null); }

    async function clear() {
        const days = await index();
        await remove([KEY, DAYS_KEY, ...days.map(dayStore)]);
        await writeLast(null);
    }

    /**
     * Fold `days` days of the store, ending `offset` days before today, into
     * one summary. It takes the store rather than reading it, so a caller that
     * wants two windows pays for one read.
     */
    function summarize(data, days, offset = 0) {
        const keys = [];
        for (let i = 0; i < days; i++) keys.push(dayKey(Date.now(), offset + i));
        const keepTop = topCutoff();

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
            if (day.top && key >= keepTop) daily.push({ day: key, ...day.top });
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
     * The window on screen, the total of the one before it, and the last
     * seven days, from a single read. The view's "vs the period before" line
     * used to cost a second full read of the store for what is one
     * subtraction.
     *
     * `week` is there because the per-day page is kept for a week whatever
     * range the view is showing — so that panel is the same seven days under
     * Today as it is under Last 30 days, rather than one row or a promise the
     * store cannot keep.
     */
    async function report(days) {
        const data = await read();
        return {
            now: summarize(data, days),
            previousTotal: summarize(data, days, days).total,
            week: summarize(data, TOP_KEEP_DAYS),
        };
    }

    /** 3720 → "1h 2m" — Time.duration's loose shape, and "0m" for nothing at all. */
    const human = (seconds) => (seconds ? Time.duration(seconds, 'loose') : '0m');

    const Activity = {
        KEY, DAY_PREFIX, DAYS_KEY, LAST_KEY, SETTING, KEEP_DAYS, TOP_KEEP_DAYS,
        tick, blur, clear, read, summary, report, summarize, human, hostOf, dayStore,
    };

    BB.Activity = Activity;
    if (typeof module !== 'undefined' && module.exports) module.exports = Activity;
})(typeof globalThis !== 'undefined' ? globalThis : this);
