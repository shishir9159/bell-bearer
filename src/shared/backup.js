/**
 * One file with everything Bell Bearer keeps: settings (shortcuts included),
 * checkpoints, topics and channels, remembered cookie sites, activity.
 *
 * Caches are left out — they are rebuilt from the network on their own and
 * would only make the file large and stale.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    const TYPE = 'bell-bearer-backup';

    const EXCLUDED = new Set([
        Settings.DATA.channelIdCache,
        Settings.DATA.feedCache,
        Settings.DATA.chessCache,
        Settings.DATA.lichessCache,
        'bbChannelIdCache',
        'bb_activity_last',
    ]);

    function build(store, now = Date.now()) {
        const data = {};
        for (const [key, value] of Object.entries(store || {})) {
            if (!EXCLUDED.has(key)) data[key] = value;
        }
        return { type: TYPE, version: 1, exportedAt: new Date(now).toISOString(), data };
    }

    function validate(file) {
        return !!file && file.type === TYPE && !!file.data && typeof file.data === 'object' && !Array.isArray(file.data);
    }

    /** What a backup would write: its data without anything excluded. */
    function entries(file) {
        return build(file.data).data;
    }

    async function exportAll(now = Date.now()) {
        return build(await chrome.storage.local.get(null), now);
    }

    async function importAll(file) {
        const data = entries(file);
        await chrome.storage.local.set(data);
        return Object.keys(data).length;
    }

    const Backup = { TYPE, EXCLUDED, build, validate, entries, exportAll, importAll };

    root.BB = root.BB || {};
    root.BB.Backup = Backup;
    if (typeof module !== 'undefined' && module.exports) module.exports = Backup;
})(typeof globalThis !== 'undefined' ? globalThis : this);
