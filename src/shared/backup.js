/**
 * One file with everything Bell Bearer keeps: settings (shortcuts included),
 * checkpoints, topics and channels, remembered cookie sites, activity.
 *
 * What is left out is said in the schema — Settings.CACHES, CACHE_PREFIXES
 * and TRANSIENT — beside the keys themselves. This file used to keep its own
 * list, which missed every cache added after it and exported a roster job in
 * flight.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    const TYPE = 'bell-bearer-backup';
    /** The newest file this reads. Every export so far has been version 1. */
    const VERSION = 1;

    const EXCLUDED = new Set([
        ...Settings.CACHES,
        ...Settings.TRANSIENT,
        'bbChannelIdCache', // the first id cache, abandoned rather than migrated — see Settings.DATA
    ]);
    const EXCLUDED_PREFIXES = Object.freeze([...Settings.CACHE_PREFIXES]);

    const excluded = (key) => EXCLUDED.has(key) || EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix));

    /**
     * Whether a key is one Bell Bearer writes. Only those are restored: a file
     * is just JSON, and it used to be able to put anything at all in storage.
     */
    const KNOWN = new Set([...Settings.KEYS, ...Object.values(Settings.DATA)]);
    const known = (key) => KNOWN.has(key) || key.startsWith(Settings.DATA.activityDay);

    const LIST = 'list';
    const MAP = 'map';
    const kindOf = (value) => (Array.isArray(value) ? LIST : value && typeof value === 'object' ? MAP : typeof value);

    /**
     * What each data key holds at the top, a list or a map; a setting holds
     * what its default does. Each store makes what it can of what is inside
     * — they all read defensively — but a file was taken whole when the top
     * was wrong as well: `sitesOff` as a string went into storage as one, and
     * every page that asked which sites were off read it as a list.
     */
    const D = Settings.DATA;
    const DATA_SHAPES = Object.freeze({
        [D.bookmarks]: LIST, [D.topics]: LIST, [D.channels]: LIST, [D.newVideos]: LIST, [D.watched]: MAP,
        [D.pinned]: LIST, [D.playlists]: LIST, [D.cookieSites]: MAP, [D.rosters]: MAP, [D.limitSites]: MAP,
        [D.chessLimits]: MAP, [D.trials]: MAP, [D.timeLimits]: MAP,
        [D.xPeopleTopics]: LIST, [D.xPostTopics]: LIST, [D.xPeople]: LIST, [D.xPosts]: LIST,
        [D.leetProblems]: MAP, [D.leetDays]: MAP, [D.leetTemplates]: LIST,
        [D.typerRaces]: LIST, [D.typerGrams]: MAP, [D.typerDays]: MAP,
        [D.chatPins]: MAP, [D.promptTemplates]: LIST, [D.promptQueue]: MAP, [D.topicSearch]: MAP,
        [D.activityDays]: LIST, [D.activityLegacy]: MAP,
    });

    function shapeOf(key) {
        if (key in Settings.DEFAULTS) return kindOf(Settings.DEFAULTS[key]);
        if (key.startsWith(D.activityDay)) return MAP;
        return DATA_SHAPES[key] || null;
    }

    /** Whether `value` is the kind of thing Bell Bearer keeps under `key`. */
    function fits(key, value) {
        const shape = shapeOf(key);
        if (shape === 'number') return typeof value === 'number' && Number.isFinite(value);
        return kindOf(value) === shape;
    }

    function build(store, now = Date.now()) {
        const data = {};
        for (const [key, value] of Object.entries(store || {})) {
            if (!excluded(key)) data[key] = value;
        }
        return { type: TYPE, version: VERSION, exportedAt: new Date(now).toISOString(), data };
    }

    /** A data key stored as null holds nothing, and is left out rather than refused. */
    const empty = (key, value) => value === null && !(key in Settings.DEFAULTS);

    /**
     * Why `file` cannot be imported, as a sentence for the toast, or null
     * when it can. Checked whole before anything is written, so a file wrong
     * in one key changes nothing: it used to be enough for the type to match,
     * and version 999 was imported as gladly as 1.
     */
    function problem(file) {
        if (!file || typeof file !== 'object' || file.type !== TYPE || kindOf(file.data) !== MAP) return 'That is not a Bell Bearer export';
        if (!Number.isInteger(file.version) || file.version < 1) return 'That export does not say which version of Bell Bearer made it';
        if (file.version > VERSION) return 'That export is from a newer Bell Bearer — update this one, then import it';
        for (const [key, value] of Object.entries(file.data)) {
            if (excluded(key) || !known(key) || empty(key, value)) continue;
            if (!fits(key, value)) return `That export’s “${key}” is not what Bell Bearer keeps there — nothing was imported`;
        }
        return null;
    }

    const validate = (file) => problem(file) === null;

    /** A prompt waiting in a restored queue: what it says instead of going. */
    const RESTORED_NOTE = 'Restored from a backup — send it when you are ready';

    /**
     * Values that mean something on the machine that wrote them, made safe to
     * restore. The prompt queue came back as it was exported: the leases of
     * pages long closed, sites' holds, and every waiting prompt still
     * waiting — so importing with a chat open sent them into it, at once.
     * They come back held, for a press of Send each, and nothing holds them.
     */
    const RESTORE = Object.freeze({
        [D.promptQueue]: (queue) => ({
            ...queue,
            items: (Array.isArray(queue.items) ? queue.items : []).map((item) => (item && (item.status === 'waiting' || item.status === 'sending')
                ? { ...item, status: 'held', note: RESTORED_NOTE } : item)),
            leases: {},
            holds: {},
        }),
    });

    /** What a backup would write: its known keys, without anything excluded. */
    function entries(file) {
        const data = build(file.data).data;
        for (const [key, value] of Object.entries(data)) {
            if (!known(key) || empty(key, value)) delete data[key];
            else if (RESTORE[key]) data[key] = RESTORE[key](value);
        }
        return data;
    }

    async function exportAll(now = Date.now()) {
        return build(await chrome.storage.local.get(null), now);
    }

    async function importAll(file) {
        const why = problem(file);
        if (why) throw new Error(why);
        const data = entries(file);
        await chrome.storage.local.set(data);
        return Object.keys(data).length;
    }

    const Backup = { TYPE, VERSION, RESTORED_NOTE, EXCLUDED, EXCLUDED_PREFIXES, DATA_SHAPES, build, problem, validate, entries, exportAll, importAll, known, fits };

    root.BB = root.BB || {};
    root.BB.Backup = Backup;
    if (typeof module !== 'undefined' && module.exports) module.exports = Backup;
})(typeof globalThis !== 'undefined' ? globalThis : this);
