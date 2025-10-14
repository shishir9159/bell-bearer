/**
 * Sites held to a daily limit, and what each limit is.
 *
 * This is the list Settings → General keeps, the same shape of thing as the
 * remembered cookie sites beside it: `{ [host]: { minutes, from, to, savedAt } }`.
 * A row carries one of two kinds of limit and never both —
 *
 *   a budget: `minutes`, how long the site gets in a day;
 *   a window: `from` and `to`, "HH:MM" each, the hours the site may be used
 *             between — outside them it is covered.
 *
 * The limit used to be two settings per site, spelled out in the schema and
 * wired to a toggle in that site's own panel, which meant only the two sites
 * somebody had written a panel for could have one. The list is why x.com and
 * reddit.com are no longer special: they are two rows in it, added by default
 * for nobody, and any host can be another.
 *
 * A window is an *allowance*, not a curfew: `7:00`–`9:00` means the site is
 * yours between seven and nine and covered the rest of the day. That is the
 * reading that matches the budget beside it — both answer "how much of this
 * am I giving myself" — and the panel says so in as many words, because the
 * opposite reading is just as sensible a thing to want and the difference
 * matters rather a lot at 9:01.
 *
 * Everything above the "storage" line is pure and covered by
 * tests/node-check.js.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    const KEY = Settings.DATA.limitSites;

    /** The keys the limit was two settings per site under, before the list. */
    const LEGACY = Object.freeze([
        Object.freeze({ host: 'x.com', onKey: 'twitterDailyLimit', minutesKey: 'twitterLimitMinutes' }),
        Object.freeze({ host: 'reddit.com', onKey: 'redditDailyLimit', minutesKey: 'redditLimitMinutes' }),
    ]);

    const MAX_MINUTES = 1440;

    function normalizeHost(hostname) {
        return String(hostname || '')
            .trim()
            .toLowerCase()
            // Pasting the address bar in is the obvious way to name a site,
            // so a whole URL is accepted and reduced rather than rejected.
            .replace(/^[a-z+]+:\/\//, '')
            .replace(/[/?#].*$/, '')
            .replace(/^www\./, '')
            .replace(/\.$/, '');
    }

    /** A host worth storing: two labels at least, and nothing exotic in them. */
    const isHost = (host) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host);

    /**
     * "7am", "7:30 pm", "19:00", "7" → minutes since midnight. null when it
     * is not a time at all.
     *
     * Deliberately generous about how it is written. The list is somewhere you
     * type "7am" because that is how you say it, and a field that only takes
     * "07:00" is a field that rejects what everybody types first.
     */
    function parseClock(text) {
        const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(String(text || ''));
        if (!match) return null;

        let hours = Number(match[1]);
        const minutes = match[2] === undefined ? 0 : Number(match[2]);
        const half = match[3] && match[3].toLowerCase();
        if (minutes > 59) return null;

        if (half) {
            if (hours < 1 || hours > 12) return null;
            hours = (hours % 12) + (half === 'pm' ? 12 : 0);
        } else if (hours > 23) {
            return null;
        }
        return hours * 60 + minutes;
    }

    /** Minutes since midnight → "HH:MM", which is how a window is stored. */
    function clockKey(mins) {
        const at = ((Math.round(mins) % 1440) + 1440) % 1440;
        return `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`;
    }

    /** "19:30" → "7:30 pm". Stored in 24 hours, read back in 12. */
    function clockText(value) {
        const mins = typeof value === 'number' ? value : parseClock(value);
        if (mins === null) return '';
        const hours = Math.floor(mins / 60);
        const half = hours < 12 ? 'am' : 'pm';
        const shown = hours % 12 === 0 ? 12 : hours % 12;
        return `${shown}:${String(mins % 60).padStart(2, '0')} ${half}`;
    }

    /**
     * Which kind of limit a row carries: 'budget', 'window' or 'none'.
     *
     * A budget of zero minutes is 'none' rather than "blocked from the first
     * second", the same reading the old two-setting version took: nobody sets
     * a limit of nothing on purpose, and a limit that bites the moment it is
     * added looks like a bug.
     */
    function modeOf(entry) {
        if (!entry) return 'none';
        const minutes = Number(entry.minutes);
        if (Number.isFinite(minutes) && minutes > 0) return 'budget';
        if (parseClock(entry.from) !== null && parseClock(entry.to) !== null) return 'window';
        return 'none';
    }

    /** The budget in seconds, or null when this row is not a budget. */
    function allowanceOf(entry) {
        if (modeOf(entry) !== 'budget') return null;
        return Math.round(Math.min(MAX_MINUTES, Number(entry.minutes)) * 60);
    }

    /**
     * Is `now` inside the hours this row allows?
     *
     * True when the row is not a window at all, so a caller can ask without
     * checking the mode first — "nothing is stopping you" is the right answer
     * for a budget.
     *
     * `from` after `to` is a window that runs over midnight (22:00–02:00),
     * not an empty one. Reading it as empty would block the site all day,
     * which is the sort of bug nobody reports because they assume they typed
     * it wrong.
     */
    function windowOpen(entry, now = Date.now()) {
        if (modeOf(entry) !== 'window') return true;
        const from = parseClock(entry.from);
        const to = parseClock(entry.to);
        if (from === to) return true; // a zero-length window is not a limit

        const date = new Date(now);
        const at = date.getHours() * 60 + date.getMinutes();
        return from < to ? (at >= from && at < to) : (at >= from || at < to);
    }

    /** One line saying what a row allows, for the list and for the sheet. */
    function describe(entry) {
        switch (modeOf(entry)) {
            case 'budget': {
                const minutes = Math.round(Math.min(MAX_MINUTES, Number(entry.minutes)));
                if (minutes < 60) return `${minutes} minutes a day`;
                const hours = Math.floor(minutes / 60);
                const rest = minutes % 60;
                return rest ? `${hours}h ${rest}m a day` : `${hours}h a day`;
            }
            case 'window':
                return `only ${clockText(entry.from)} to ${clockText(entry.to)}`;
            default:
                return 'no limit';
        }
    }

    /**
     * The row covering `hostname` — itself or a parent domain.
     *
     * Same walk up the domain as the cookie list, and stopping short of a bare
     * TLD for the same reason: a row for "com" would answer for the web.
     */
    function entryFor(sites, hostname) {
        const host = normalizeHost(hostname);
        if (!host || !sites) return null;
        for (let at = host; at;) {
            if (Object.prototype.hasOwnProperty.call(sites, at)) return { host: at, ...sites[at] };
            const dot = at.indexOf('.');
            if (dot < 0) break;
            at = at.slice(dot + 1);
            if (at.indexOf('.') < 0) break;
        }
        return null;
    }

    /**
     * A row from what the panel's fields hold, or null when they do not
     * describe a limit. The caller shows the error; this only decides.
     */
    function rowFrom({ host, minutes, from, to }, now = Date.now()) {
        const at = normalizeHost(host);
        if (!isHost(at)) return null;

        const asMinutes = Number(minutes);
        if (Number.isFinite(asMinutes) && asMinutes > 0) {
            return { host: at, entry: { minutes: Math.min(MAX_MINUTES, Math.round(asMinutes)), savedAt: now } };
        }

        const start = parseClock(from);
        const end = parseClock(to);
        if (start === null || end === null || start === end) return null;
        return { host: at, entry: { from: clockKey(start), to: clockKey(end), savedAt: now } };
    }

    /** By host, so the list does not reshuffle itself as rows are edited. */
    function list(sites) {
        return Object.entries(sites || {})
            .map(([host, entry]) => ({ host, ...entry }))
            .sort((a, b) => a.host.localeCompare(b.host));
    }

    /** Every host with a limit, for the page that has to know whether it is one. */
    const hosts = (sites) => Object.keys(sites || {});

    // ----------------------------------------------------------- storage

    /**
     * The list, seeding it once from the two settings that used to hold a
     * limit per site.
     *
     * The seed runs only while the store has never been written — an empty
     * object counts as written — so it cannot resurrect a row somebody has
     * deliberately deleted. Without it, anyone already holding themselves to
     * thirty minutes of x.com would have found the limit quietly gone.
     */
    async function load() {
        try {
            const wanted = [KEY];
            for (const old of LEGACY) wanted.push(old.onKey, old.minutesKey);
            const stored = await chrome.storage.local.get(wanted);

            const sites = stored[KEY];
            if (sites && typeof sites === 'object' && !Array.isArray(sites)) return sites;

            const seeded = {};
            for (const old of LEGACY) {
                const minutes = Number(stored[old.minutesKey]);
                if (stored[old.onKey] === true && Number.isFinite(minutes) && minutes > 0) {
                    seeded[old.host] = { minutes: Math.round(minutes), savedAt: Date.now() };
                }
            }
            if (Object.keys(seeded).length) await save(seeded);
            return seeded;
        } catch (_) {
            // The extension reloading invalidates every content script's
            // context. No limits is the safe answer: a page covered by a
            // sheet it can no longer take down again would be unusable.
            return {};
        }
    }

    const save = (sites) => Settings.set({ [KEY]: sites });

    /** Add a row, or replace the one that host already has. */
    async function remember(fields, now = Date.now()) {
        const row = rowFrom(fields, now);
        if (!row) return null;
        const sites = await load();
        sites[row.host] = row.entry;
        await save(sites);
        return sites;
    }

    async function forget(hostname) {
        const host = normalizeHost(hostname);
        const sites = await load();
        delete sites[host];
        await save(sites);
        return sites;
    }

    const LimitSites = {
        KEY, LEGACY, MAX_MINUTES,
        normalizeHost, isHost, parseClock, clockKey, clockText,
        modeOf, allowanceOf, windowOpen, describe, entryFor, rowFrom, list, hosts,
        load, save, remember, forget,
    };

    root.BB = root.BB || {};
    root.BB.LimitSites = LimitSites;
    if (typeof module !== 'undefined' && module.exports) module.exports = LimitSites;
})(typeof globalThis !== 'undefined' ? globalThis : this);
