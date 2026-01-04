/**
 * Trials: the three tab groups you are working in, and the rest standing by.
 *
 * The browser already names and colours a tab group, so this file does not
 * keep a parallel list of tasks. What Chrome does not keep is which groups are
 * *in play* and which are parked, how long each has gone untouched, and whether
 * one of them is locked for a stretch of time. That is all this module holds:
 * a small record per group id, and the pure rules the desk runs on.
 *
 * Three groups run at a time — SLOT_LIMIT. Opening a fourth parks whichever
 * has gone untouched longest, which is the point: the desk stays the size of a
 * desk. A locked group is never the one parked.
 *
 * Group ids are handed out per session, so a record whose group has gone is
 * dead weight; `sanitize` takes the live ids and drops the rest. Nothing here
 * touches chrome.tabGroups — src/background/trials.js does that.
 *
 * Pure, and covered by tests/node-check.js.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Hosts = ns.Hosts || req('./hosts.js');

    /** How many groups run at once. A fourth one parks one of these. */
    const SLOT_LIMIT = 3;

    /** The stretches a group can be locked for, in minutes. */
    const LOCK_PRESETS = Object.freeze([25, 50, 90]);

    const MAX_NAME = 60;

    function cleanName(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    }

    // ------------------------------------------------------- tab identity

    /** The host, without the www, or '' for anything that is not a real URL. */
    const domainOf = (url) => Hosts.of(url);

    /**
     * The one letter that stands for a tab in the strip. Taken from the
     * registrable-ish part of the host rather than the subdomain, so
     * mail.google.com and drive.google.com both come out as G.
     */
    function mono(url) {
        const domain = domainOf(url);
        if (!domain) return '·';
        const parts = domain.split('.').filter(Boolean);
        const name = parts.length > 2 ? parts[parts.length - 2] : parts[0];
        const letter = (String(name).match(/[a-z0-9]/i) || [''])[0];
        return letter ? letter.toUpperCase() : '·';
    }

    /**
     * A colour for that letter, steady per domain so a site keeps the same
     * badge all day. A hue off a cheap string hash, held mid-dark so it reads
     * on both a light and a dark surface.
     */
    function tint(url) {
        const domain = domainOf(url);
        if (!domain) return 'currentColor';
        let hash = 0;
        for (let i = 0; i < domain.length; i += 1) hash = (hash * 31 + domain.charCodeAt(i)) % 360;
        return `hsl(${hash} 58% 42%)`;
    }

    // ------------------------------------------------------------- records

    /** The record for one group, with everything missing filled in. */
    function recordFor(state, groupId) {
        const row = (state || {})[String(groupId)] || {};
        return {
            usedAt: Number(row.usedAt) || 0,
            lockUntil: Number(row.lockUntil) || 0,
            lockSpan: Number(row.lockSpan) || 0,
        };
    }

    function write(state, groupId, changes) {
        return { ...(state || {}), [String(groupId)]: { ...recordFor(state, groupId), ...changes } };
    }

    /** This group was just worked in, so it is last in line to be parked. */
    function touch(state, groupId, now = Date.now()) {
        return write(state, groupId, { usedAt: now });
    }

    function lock(state, groupId, minutes, now = Date.now()) {
        const span = Math.max(0, Number(minutes) || 0) * 60000;
        return write(state, groupId, { lockUntil: span ? now + span : 0, lockSpan: span });
    }

    function unlock(state, groupId) {
        return write(state, groupId, { lockUntil: 0, lockSpan: 0 });
    }

    function forget(state, groupId) {
        const next = { ...(state || {}) };
        delete next[String(groupId)];
        return next;
    }

    function isLocked(state, groupId, now = Date.now()) {
        return recordFor(state, groupId).lockUntil > now;
    }

    /** The one group holding the desk, or null. Only an open group can hold it. */
    function lockedId(state, openIds, now = Date.now()) {
        const held = (openIds || []).find((groupId) => isLocked(state, groupId, now));
        return held == null ? null : held;
    }

    /** Whole minutes left on a lock, rounded up, so one second left reads 1 min. */
    function minutesLeft(state, groupId, now = Date.now()) {
        const { lockUntil } = recordFor(state, groupId);
        return lockUntil > now ? Math.ceil((lockUntil - now) / 60000) : 0;
    }

    /**
     * Which of the open groups to park to free `n` slots: longest untouched
     * first. A locked group goes to the back of the queue, so it is only ever
     * parked when there is nothing else left to park.
     */
    function parkVictims(state, openIds, n, now = Date.now()) {
        if (n <= 0) return [];
        const byAge = (a, b) => recordFor(state, a).usedAt - recordFor(state, b).usedAt;
        const ids = (openIds || []).slice();
        const free = ids.filter((id) => !isLocked(state, id, now)).sort(byAge);
        const held = ids.filter((id) => isLocked(state, id, now)).sort(byAge);
        return free.concat(held).slice(0, n);
    }

    /** How long ago in words, for a parked group's card. */
    function usedLabel(usedAt, now = Date.now()) {
        if (!usedAt) return 'not yet used';
        const ms = now - Number(usedAt);
        if (ms < 90000) return 'just now';
        if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
        if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
        if (ms < 172800000) return 'yesterday';
        if (ms < 604800000) return `${Math.floor(ms / 86400000)}d ago`;
        return 'last week';
    }

    // ------------------------------------------------------------- storage

    const KEY = Settings.DATA.trials;

    /**
     * Keep only records for groups that still exist. Pass the live ids; with
     * no list at all nothing is dropped, because "no groups" and "did not
     * look" are not the same thing.
     */
    function sanitize(stored, liveIds) {
        const out = {};
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
        const live = liveIds ? new Set(liveIds.map(String)) : null;
        for (const key of Object.keys(stored)) {
            if (!/^-?\d+$/.test(key)) continue;
            if (live && !live.has(key)) continue;
            out[key] = recordFor(stored, key);
        }
        return out;
    }

    async function load(liveIds) {
        try {
            const stored = await chrome.storage.local.get([KEY]);
            return sanitize(stored[KEY], liveIds);
        } catch (_) {
            return {};
        }
    }

    async function save(state) {
        return Settings.set({ [KEY]: sanitize(state) });
    }

    /** Read, apply `change(state)`, write; returns what was written. */
    async function update_(change) {
        const next = sanitize(change(await load()));
        await save(next);
        return next;
    }

    const Trials = {
        KEY, SLOT_LIMIT, LOCK_PRESETS, MAX_NAME,
        cleanName, domainOf, mono, tint,
        recordFor, touch, lock, unlock, forget, isLocked, lockedId, minutesLeft,
        parkVictims, usedLabel, sanitize,
        load, save, update: update_,
    };

    root.BB = root.BB || {};
    root.BB.Trials = Trials;
    if (typeof module !== 'undefined' && module.exports) module.exports = Trials;
})(typeof globalThis !== 'undefined' ? globalThis : this);
