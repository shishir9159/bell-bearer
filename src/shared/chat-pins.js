/**
 * Pinned turns: the one answer in a two-hundred-turn debugging chat that
 * actually fixed it, marked so it can be found again.
 *
 * Keyed by site and conversation, and a pin by the *turn id* — never by its
 * position. A position is renumbered by every edit above it; the id is what
 * the site itself calls that turn, and it does not change.
 *
 *   bbChatPins: {
 *     'chatgpt:<conversation id>': {
 *       title, url, updatedAt,
 *       pins: [{ node: '<turn id>', label: '', excerpt: 'first 140 characters', at }]
 *     }
 *   }
 *
 * The chat's title and address are kept beside its pins so the dashboard can
 * list and open them without the site's session, which it does not have.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Store = ns.Store || req('./store.js');

    const KEY = Settings.DATA.chatPins;
    const EXCERPT = 140;
    const LABEL_CAP = 80;

    const chatKey = (site, conv) => `${site}:${conv}`;
    const text = (value) => String(value == null ? '' : value);

    /**
     * What a pin shows of its turn: the first words, with the Markdown
     * furniture taken off and fenced code dropped — a pin reading "```python"
     * says nothing about what was pinned.
     */
    function excerptOf(markdown) {
        const prose = text(markdown)
            .replace(/(`{3,}|~{3,})[\s\S]*?(\1|$)/g, ' ')
            .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
            .replace(/[*_`]+/g, '')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();
        return prose.length > EXCERPT ? `${prose.slice(0, EXCERPT - 1).trimEnd()}…` : prose;
    }

    function cleanPin(pin) {
        return {
            node: text(pin && pin.node),
            label: text(pin && pin.label).trim().slice(0, LABEL_CAP),
            excerpt: text(pin && pin.excerpt).slice(0, EXCERPT),
            at: Number(pin && pin.at) || 0,
        };
    }

    function clean(state) {
        const out = {};
        for (const [key, chat] of Object.entries(state && typeof state === 'object' ? state : {})) {
            const pins = (Array.isArray(chat && chat.pins) ? chat.pins : []).map(cleanPin).filter((pin) => pin.node);
            if (!pins.length || !/^[a-z]+:.+/.test(key)) continue;
            out[key] = { title: text(chat.title), url: text(chat.url), updatedAt: Number(chat.updatedAt) || 0, pins };
        }
        return out;
    }

    const { load, update } = Store.create({
        keys: [KEY],
        read: (stored) => clean(stored[KEY]),
        clean,
        blank: () => ({}),
        name: 'the chat pins',
    });

    /** The pins of one chat, oldest first — the order they were made in. */
    function forConv(state, site, conv) {
        const chat = state && state[chatKey(site, conv)];
        return chat ? chat.pins.slice() : [];
    }

    const isPinned = (state, site, conv, node) => forConv(state, site, conv).some((pin) => pin.node === node);

    /** Pin a turn, or refresh its chat's title and address if it already is. */
    function pin({ site, conv, node, title = '', url = '', excerpt = '', now = Date.now() }) {
        return update((state) => {
            const key = chatKey(site, conv);
            const chat = state[key] || { title: '', url: '', updatedAt: 0, pins: [] };
            const pins = chat.pins.some((one) => one.node === node)
                ? chat.pins
                : [...chat.pins, cleanPin({ node, excerpt: excerptOf(excerpt), at: now })];
            return { ...state, [key]: { title: title || chat.title, url: url || chat.url, updatedAt: now, pins } };
        });
    }

    function unpin({ site, conv, node }) {
        return update((state) => {
            const key = chatKey(site, conv);
            if (!state[key]) return state;
            return { ...state, [key]: { ...state[key], pins: state[key].pins.filter((one) => one.node !== node) } };
        });
    }

    function relabel({ site, conv, node, label }) {
        return update((state) => {
            const key = chatKey(site, conv);
            if (!state[key]) return state;
            const pins = state[key].pins.map((one) => (one.node === node ? { ...one, label: text(label) } : one));
            return { ...state, [key]: { ...state[key], pins } };
        });
    }

    /** Every pin on a site, newest first, each with the chat it belongs to — the dashboard's list. */
    function all(state, site) {
        const out = [];
        for (const [key, chat] of Object.entries(state || {})) {
            const at = key.indexOf(':');
            if (site && key.slice(0, at) !== site) continue;
            for (const one of chat.pins) {
                out.push({ ...one, site: key.slice(0, at), conv: key.slice(at + 1), title: chat.title, url: chat.url });
            }
        }
        return out.sort((a, b) => b.at - a.at);
    }

    const ChatPins = {
        KEY, KEYS: [KEY], EXCERPT, chatKey, excerptOf, clean, load, update,
        forConv, isPinned, pin, unpin, relabel, all,
    };

    root.BB = root.BB || {};
    root.BB.ChatPins = ChatPins;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatPins;
})(typeof globalThis !== 'undefined' ? globalThis : this);
