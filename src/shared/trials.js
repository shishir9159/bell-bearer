/**
 * Trials: a named piece of work, and the tab group that holds it.
 *
 * The browser already has the right container for "these twelve tabs are one
 * task" — a tab group — but nothing names the task, keeps it across a restart,
 * or lets you put one task in front and the rest away. A trial is that missing
 * half: a name, a colour, and whichever tab group is currently standing in for
 * it.
 *
 * `groupId` is deliberately treated as disposable. Chrome hands out group ids
 * per session, and a group the user closes takes its id with it, so the id
 * here is a cache — src/background/trials.js re-makes the group when it has
 * gone and writes the new id back. Nothing in this file assumes the group on
 * record still exists.
 *
 * Pure, and covered by tests/node-check.js; everything that actually touches
 * chrome.tabGroups lives in the background module.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    /** The colours Chrome's own tab groups come in; no others are accepted. */
    const COLORS = Object.freeze([
        'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey',
    ]);

    const MAX_NAME = 60;

    function cleanName(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    }

    function newId() {
        return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    }

    /**
     * The colour to give the next trial: the first one no trial is using, so
     * a fresh set is all different, falling back to the next in rotation once
     * every colour is spoken for.
     */
    function nextColor(list) {
        const taken = new Set((list || []).map((trial) => trial.color));
        const free = COLORS.find((color) => !taken.has(color));
        return free || COLORS[(list || []).length % COLORS.length];
    }

    /** Every list operation returns a new array; none edit in place. */
    function create(list, name, now = Date.now()) {
        const trials = (list || []).slice();
        const trial = {
            id: newId(),
            name: cleanName(name) || 'Untitled trial',
            color: nextColor(trials),
            groupId: null,
            createdAt: now,
            focusedAt: 0,
        };
        trials.push(trial);
        return trials;
    }

    function update(list, id, changes) {
        return (list || []).map((trial) => (trial.id === id ? { ...trial, ...changes } : trial));
    }

    function rename(list, id, name) {
        const clean = cleanName(name);
        // An empty rename is a no-op rather than a trial with no name at all.
        return clean ? update(list, id, { name: clean }) : (list || []).slice();
    }

    function recolor(list, id, color) {
        return COLORS.includes(color) ? update(list, id, { color }) : (list || []).slice();
    }

    function remove(list, id) {
        return (list || []).filter((trial) => trial.id !== id);
    }

    /** Note which tab group is standing in for this trial right now. */
    function setGroup(list, id, groupId) {
        return update(list, id, { groupId: groupId == null ? null : Number(groupId) });
    }

    /** Forget a group id wherever it appears — the group has gone. */
    function forgetGroup(list, groupId) {
        return (list || []).map((trial) => (
            trial.groupId === groupId ? { ...trial, groupId: null } : trial
        ));
    }

    function touch(list, id, now = Date.now()) {
        return update(list, id, { focusedAt: now });
    }

    function byId(list, id) {
        return (list || []).find((trial) => trial.id === id) || null;
    }

    function byGroup(list, groupId) {
        if (groupId == null) return null;
        return (list || []).find((trial) => trial.groupId === groupId) || null;
    }

    /** Move a trial to `index`, so the dashboard can order them by hand. */
    function reorder(list, id, index) {
        const trials = (list || []).slice();
        const from = trials.findIndex((trial) => trial.id === id);
        if (from < 0) return trials;
        const to = Math.max(0, Math.min(trials.length - 1, index));
        trials.splice(to, 0, trials.splice(from, 1)[0]);
        return trials;
    }

    /** Most recently focused first; never-focused trials keep their own order. */
    function byRecent(list) {
        return (list || []).slice().sort((a, b) => (b.focusedAt || 0) - (a.focusedAt || 0));
    }

    // ------------------------------------------------------------- storage

    const KEY = Settings.DATA.trials;

    /** Drop anything that is not a trial, so one bad write cannot break the view. */
    function sanitize(stored) {
        if (!Array.isArray(stored)) return [];
        return stored
            .filter((trial) => trial && typeof trial.id === 'string')
            .map((trial) => ({
                id: trial.id,
                name: cleanName(trial.name) || 'Untitled trial',
                color: COLORS.includes(trial.color) ? trial.color : 'grey',
                groupId: Number.isInteger(trial.groupId) ? trial.groupId : null,
                createdAt: Number(trial.createdAt) || 0,
                focusedAt: Number(trial.focusedAt) || 0,
            }));
    }

    async function load() {
        try {
            const stored = await chrome.storage.local.get([KEY]);
            return sanitize(stored[KEY]);
        } catch (_) {
            return [];
        }
    }

    async function save(list) {
        return Settings.set({ [KEY]: sanitize(list) });
    }

    /** Read, apply `change(list)`, write; returns what was written. */
    async function update_(change) {
        const next = sanitize(change(await load()));
        await save(next);
        return next;
    }

    const Trials = {
        KEY, COLORS, MAX_NAME,
        cleanName, nextColor, create, rename, recolor, remove,
        setGroup, forgetGroup, touch, byId, byGroup, reorder, byRecent, sanitize,
        load, save, update: update_,
    };

    root.BB = root.BB || {};
    root.BB.Trials = Trials;
    if (typeof module !== 'undefined' && module.exports) module.exports = Trials;
})(typeof globalThis !== 'undefined' ? globalThis : this);
