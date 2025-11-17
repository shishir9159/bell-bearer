/**
 * Prompts waiting to be sent: queued behind the answer being written, or
 * scheduled for later — for when a usage limit resets, say.
 *
 *   bbPromptQueue: {
 *     items:  [{ id: 'pq_…', site, conv: '<id>' | null, chain: 'pc_…', text, model,
 *                notBefore, status: 'waiting' | 'sending' | 'sent' | 'held' | 'failed',
 *                note, createdAt, sentAt }],
 *     holds:  { chatgpt: { until, reason } },
 *     leases: { 'chatgpt:<conv>': { by: '<page id>', until } },
 *     paused: { 'chatgpt:<conv>': true },
 *   }
 *
 * It lives in storage for the reason the roster job does: the thing doing the
 * work — a tab — comes and goes, and a prompt scheduled for three hours from
 * now has to outlive the tab it was written in. The worker keeps one alarm at
 * nextWake() and opens a tab if there is none; any tab on the chat sends.
 *
 * A chat's queue is in order. The first waiting item is the one to send, and
 * one scheduled for later holds back the ones behind it — they were written
 * to follow it.
 *
 * A prompt queued on the new-chat page has no conversation yet. Its whole
 * chain — "ask these five in a new chat" — carries one `chain` id, and when
 * the first is sent and the page's address gains the new chat's id, bind()
 * writes that id onto the rest, so the five stay one chat.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    const KEY = Settings.DATA.promptQueue;
    /** How long a page may hold a chat's queue before another may take it over. */
    const LEASE_MS = 120000;
    /**
     * A scheduled prompt whose time passed this long ago — the browser was
     * shut — is held for a yes rather than sent into a morning it was not
     * written for.
     */
    const STALE_MS = 12 * 60 * 60 * 1000;
    /** Sent and failed items are kept this long, so the strip can say what happened. */
    const KEEP_DONE_MS = 24 * 60 * 60 * 1000;
    const TEXT_CAP = 20000;

    const STATUSES = Object.freeze(['waiting', 'sending', 'sent', 'held', 'failed']);

    let writeChain = Promise.resolve();
    let idCounter = 0;
    const newId = (prefix) => {
        idCounter = (idCounter + 1) % 1000;
        return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
    };

    const blank = () => ({ items: [], holds: {}, leases: {}, paused: {} });
    const num = (value) => Math.max(0, Number(value) || 0);
    const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

    function cleanItem(item) {
        return {
            id: String(item.id || newId('pq')),
            site: String(item.site || ''),
            conv: item.conv ? String(item.conv) : null,
            chain: String(item.chain || newId('pc')),
            text: String(item.text || '').slice(0, TEXT_CAP),
            model: String(item.model || ''),
            notBefore: num(item.notBefore),
            status: STATUSES.includes(item.status) ? item.status : 'waiting',
            note: String(item.note || ''),
            createdAt: num(item.createdAt),
            sentAt: num(item.sentAt),
        };
    }

    function clean(state, now = Date.now()) {
        const raw = obj(state);
        return {
            items: (Array.isArray(raw.items) ? raw.items : []).map(cleanItem)
                .filter((item) => item.site && item.text.trim())
                // What is finished is kept a day, then let go.
                .filter((item) => !['sent', 'failed'].includes(item.status) || now - (item.sentAt || item.createdAt) < KEEP_DONE_MS),
            holds: obj(raw.holds),
            leases: obj(raw.leases),
            paused: obj(raw.paused),
        };
    }

    async function load() {
        try {
            const stored = await chrome.storage.local.get([KEY]);
            return clean(stored[KEY]);
        } catch (_) {
            return blank();
        }
    }

    async function update(mutate) {
        const run = async () => {
            const state = await load();
            const next = clean((await mutate(state)) || state);
            await chrome.storage.local.set({ [KEY]: next });
            return next;
        };
        writeChain = writeChain.then(run, run).catch((error) => {
            console.error('Bell Bearer: could not update the prompt queue', error);
            return blank();
        });
        return writeChain;
    }

    // ------------------------------------------------------------ reading

    /** The lease and pause key for a chat; a new chat is its chain. */
    const chatKey = (site, conv, chain) => `${site}:${conv || `new:${chain}`}`;
    const keyOf = (item) => chatKey(item.site, item.conv, item.chain);

    /** One chat's items, in queue order. A new-chat page's are every unbound chain on the site. */
    const itemsFor = (state, site, conv) => state.items.filter((item) => item.site === site && (item.conv || null) === (conv || null));

    const held = (state, site, now) => num(obj(state.holds[site]).until) > now;

    /**
     * The item to send now in this chat, or null: the first one waiting,
     * if it is due, the site is not on hold and the chat is not paused.
     */
    function next(state, site, conv, now = Date.now()) {
        if (held(state, site, now)) return null;
        const head = itemsFor(state, site, conv).find((item) => item.status === 'waiting');
        if (!head || head.notBefore > now || state.paused[keyOf(head)]) return null;
        return head;
    }

    /** The one time the worker has to wake: the earliest future schedule or hold end. */
    function nextWake(state, now = Date.now()) {
        const times = state.items.filter((item) => item.status === 'waiting' && item.notBefore > now).map((item) => item.notBefore);
        for (const [site, hold] of Object.entries(state.holds)) {
            const until = num(obj(hold).until);
            if (until > now && state.items.some((item) => item.site === site && item.status === 'waiting')) times.push(until);
        }
        return times.length ? Math.min(...times) : null;
    }

    /** Scheduled items whose time has come — what the worker wakes a tab for. */
    const due = (state, now = Date.now()) => state.items.filter((item) =>
        item.status === 'waiting' && item.notBefore > 0 && item.notBefore <= now && !held(state, item.site, now));

    // ------------------------------------------------------------ writing

    function add(state, { site, conv = null, chain, text, model = '', notBefore = 0, now = Date.now() }) {
        const item = cleanItem({ site, conv, chain: chain || newId('pc'), text, model, notBefore, createdAt: now });
        return { state: { ...state, items: [...state.items, item] }, item };
    }

    const patch = (state, id, changes) => ({
        ...state, items: state.items.map((item) => (item.id === id ? cleanItem({ ...item, ...changes }) : item)),
    });

    const remove = (state, id) => ({ ...state, items: state.items.filter((item) => item.id !== id) });

    /** Move `id` in front of `beforeId`, or to the end of its chat's queue. */
    function move(state, id, beforeId) {
        const items = state.items.slice();
        const from = items.findIndex((item) => item.id === id);
        if (from < 0 || id === beforeId) return state;
        const [moving] = items.splice(from, 1);
        const to = beforeId ? items.findIndex((item) => item.id === beforeId) : items.length;
        items.splice(to < 0 ? items.length : to, 0, moving);
        return { ...state, items };
    }

    /** A new chat got its id: the rest of its chain follows it there. */
    const bind = (state, chain, conv) => ({
        ...state, items: state.items.map((item) => (item.chain === chain && !item.conv ? { ...item, conv } : item)),
    });

    const hold = (state, site, until, reason = '') => ({ ...state, holds: { ...state.holds, [site]: { until: num(until), reason } } });
    const unhold = (state, site) => {
        const holds = { ...state.holds };
        delete holds[site];
        return { ...state, holds };
    };

    const pause = (state, key, on = true) => {
        const paused = { ...state.paused };
        if (on) paused[key] = true; else delete paused[key];
        return { ...state, paused };
    };

    /** Scheduled items that went stale while nobody was there to send them, held with a note. */
    function holdStale(state, now = Date.now()) {
        return {
            ...state,
            items: state.items.map((item) => (item.status === 'waiting' && item.notBefore > 0 && now - item.notBefore > STALE_MS
                ? { ...item, status: 'held', note: 'Its time passed while the browser was shut — send it anyway?' }
                : item)),
        };
    }

    // ------------------------------------------------------------- leases

    /** The roster's lease (src/shared/roster.js), per chat rather than per job. */
    function canClaim(state, key, pageId, now = Date.now()) {
        const lease = obj(state.leases[key]);
        return !lease.by || lease.by === pageId || num(lease.until) <= now;
    }

    const claim = (state, key, pageId, now = Date.now()) =>
        ({ ...state, leases: { ...state.leases, [key]: { by: pageId, until: now + LEASE_MS } } });

    function release(state, key, pageId) {
        const lease = obj(state.leases[key]);
        if (lease.by && lease.by !== pageId) return state;
        const leases = { ...state.leases };
        delete leases[key];
        return { ...state, leases };
    }

    const PromptQueue = {
        KEY, KEYS: [KEY], LEASE_MS, STALE_MS, KEEP_DONE_MS, STATUSES,
        blank, clean, load, update, newId, chatKey, keyOf, itemsFor, next, nextWake, due,
        add, patch, remove, move, bind, hold, unhold, pause, holdStale, canClaim, claim, release,
    };

    root.BB = root.BB || {};
    root.BB.PromptQueue = PromptQueue;
    if (typeof module !== 'undefined' && module.exports) module.exports = PromptQueue;
})(typeof globalThis !== 'undefined' ? globalThis : this);
