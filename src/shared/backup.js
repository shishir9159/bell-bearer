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

    /**
     * The activity store's keys. They are activity.js's, which is not loaded
     * where a backup is made; node-check holds the two to the same names.
     * `legacy` is the single value activity was kept in before it was split
     * by day — an older file still carries it, and activity splits it on read.
     */
    const ACTIVITY = Object.freeze({ legacy: 'bb_activity', days: 'bb_activity_days', dayPrefix: 'bb_activity:', last: 'bb_activity_last' });

    const EXCLUDED = new Set([
        ...Settings.CACHES,
        ...Settings.TRANSIENT,
        'bbChannelIdCache', // the first id cache, abandoned rather than migrated — see Settings.DATA
        ACTIVITY.last,
    ]);
    const EXCLUDED_PREFIXES = Object.freeze([...Settings.CACHE_PREFIXES]);

    const excluded = (key) => EXCLUDED.has(key) || EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix));

    /**
     * Whether a key is one Bell Bearer writes. Only those are restored: a file
     * is just JSON, and it used to be able to put anything at all in storage.
     */
    const KNOWN = new Set([...Settings.KEYS, ...Object.values(Settings.DATA), ACTIVITY.legacy, ACTIVITY.days]);
    const known = (key) => KNOWN.has(key) || key.startsWith(ACTIVITY.dayPrefix);

    function build(store, now = Date.now()) {
        const data = {};
        for (const [key, value] of Object.entries(store || {})) {
            if (!excluded(key)) data[key] = value;
        }
        return { type: TYPE, version: 1, exportedAt: new Date(now).toISOString(), data };
    }

    function validate(file) {
        return !!file && file.type === TYPE && !!file.data && typeof file.data === 'object' && !Array.isArray(file.data);
    }

    /** What a backup would write: its known keys, without anything excluded. */
    function entries(file) {
        const data = build(file.data).data;
        for (const key of Object.keys(data)) if (!known(key)) delete data[key];
        return data;
    }

    async function exportAll(now = Date.now()) {
        return build(await chrome.storage.local.get(null), now);
    }

    async function importAll(file) {
        const data = entries(file);
        await chrome.storage.local.set(data);
        return Object.keys(data).length;
    }

    const Backup = { TYPE, ACTIVITY, EXCLUDED, EXCLUDED_PREFIXES, build, validate, entries, exportAll, importAll, known };

    root.BB = root.BB || {};
    root.BB.Backup = Backup;
    if (typeof module !== 'undefined' && module.exports) module.exports = Backup;
})(typeof globalThis !== 'undefined' ? globalThis : this);
