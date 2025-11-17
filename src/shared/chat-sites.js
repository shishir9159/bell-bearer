/**
 * The chat sites Bell Bearer works with, as one registry — the shape
 * src/shared/chess-sites.js gives the two chess sites, and for its reason:
 * everything the panel, the queue, the exports and the dashboard do is the
 * same on every chat site, so a site's name, its settings keys and how its
 * URLs read are looked up here rather than spelled out at each call site, and
 * the sites cannot drift apart feature by feature.
 *
 * What is *not* here is anything about a site's markup or its API. That is
 * the site's adapter (src/content/chatgpt-read.js), which the chat core is
 * handed and never names. This file is pure and small enough that the service
 * worker loads it too, to find a chat's tab and open one.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);

    const SITES = Object.freeze({
        chatgpt: Object.freeze({
            id: 'chatgpt',
            name: 'ChatGPT',
            host: 'chatgpt.com',
            prefix: 'chatgpt',
            // The export's "## ChatGPT" — the site's own name for the other
            // side of the conversation.
            speaker: 'ChatGPT',
            tabPatterns: Object.freeze(['*://chatgpt.com/*', '*://chat.openai.com/*']),
            /**
             * `/c/<id>`, and the same after a custom GPT's or a project's
             * prefix: `/g/g-abc/c/<id>`, `/g/g-p-abc-name/c/<id>`. All of
             * them are the one conversation.
             */
            convIdOf: (pathname) => {
                const match = /(?:^|\/)c\/([A-Za-z0-9-]{8,})(?:[/?#]|$)/.exec(String(pathname || ''));
                return match ? match[1] : null;
            },
            /** The empty page a new chat starts on: the home page, a GPT's, a project's. */
            isNewChat: (pathname) => /^\/(?:g\/[^/]+(?:\/project)?\/?)?$/.test(String(pathname || '')),
            chatUrl: (id, { model } = {}) => (id
                ? `https://chatgpt.com/c/${encodeURIComponent(id)}`
                : `https://chatgpt.com/${model ? `?model=${encodeURIComponent(model)}` : ''}`),
        }),
    });

    function get(id) {
        return SITES[id] || null;
    }

    function list() {
        return Object.values(SITES);
    }

    /**
     * Whole-site setting keys, one builder each, so the second site's set is
     * the same list with a different prefix rather than six more names typed
     * out by hand:
     *   ('chatgpt', 'queueGap') → 'chatgptQueueGapSeconds'
     */
    const SITE_KEYS = Object.freeze({
        composerTools: (p) => `${p}ComposerTools`,
        limitSuggest: (p) => `${p}LimitSuggest`,
        queueGap: (p) => `${p}QueueGapSeconds`,
        queueOpenTab: (p) => `${p}QueueOpenTab`,
        exportDollars: (p) => `${p}ExportDollars`,
        exportThinking: (p) => `${p}ExportThinking`,
    });

    function siteKey(siteId, kind) {
        const site = get(siteId);
        const build = SITE_KEYS[kind];
        if (!site || !build) return null;
        return build(site.prefix);
    }

    /** Every setting key every chat site owns. Asserted against DEFAULTS. */
    function allKeys() {
        const out = [];
        for (const site of list()) {
            for (const kind of Object.keys(SITE_KEYS)) out.push(SITE_KEYS[kind](site.prefix));
        }
        return out;
    }

    /** Which chat site a URL is on, or null — for the worker, which has no page to ask. */
    function siteOfUrl(url) {
        let host = '';
        try { host = new URL(String(url)).hostname.replace(/^www\./, ''); } catch (_) { return null; }
        return list().find((site) => site.tabPatterns.some((pattern) =>
            host === pattern.replace(/^\*:\/\//, '').replace(/\/\*$/, ''))) || null;
    }

    /** The conversation a tab's URL is showing, or null for a new chat or another page. */
    function convIdOfUrl(siteId, url) {
        const site = get(siteId);
        if (!site) return null;
        try { return site.convIdOf(new URL(String(url)).pathname); } catch (_) { return null; }
    }

    // ------------------------------------------------------ limit notices

    /**
     * What each site says when a limit is reached, several spellings each,
     * newest first — the same rule as the selector tables, because the
     * wording changes as often as the markup does.
     *
     *   model    which model ran out, when the site names one
     *   blocked  nothing can be sent at all until the reset. Without one of
     *            these the notice is a fallback: the site carries on, with a
     *            smaller model, until the time it names
     */
    const LIMITS = Object.freeze({
        chatgpt: Object.freeze({
            // A model's name can have a dot in it (GPT-4.5), so the sentence
            // ends at a dot followed by a space, not at the first dot.
            model: [/hit the \w+ plan limit for (.+?)\.(?:\s|$)/i, /limit for ([\w.-]+(?:[ -][\w.]+)?)\b/i],
            blocked: [/reached (?:our|your|the) (?:usage |message )?limit/i, /you've hit your limit/i, /too many requests/i],
        }),
    });

    /** Lazily, as chess-sites.js looks up its readers: prompt-queue.js loads after this. */
    const queue = () => (root.BB && root.BB.PromptQueue) || req('./prompt-queue.js');

    /**
     * A limit notice's text, read: { model, until, blocked }, or null for
     * text that is not a limit notice. `until` is null when no time could be
     * read, which is said as such rather than guessed.
     */
    function readLimit(siteId, text, now = Date.now()) {
        const rules = LIMITS[siteId];
        const said = String(text || '').replace(/\s+/g, ' ').trim();
        if (!rules || !/limit|too many requests/i.test(said)) return null;
        const first = (patterns) => {
            for (const pattern of patterns) {
                const match = pattern.exec(said);
                if (match) return match[1] ? match[1].trim() : match[0];
            }
            return null;
        };
        // From the first word that introduces a time, so a number in the
        // model's name is never read as one.
        const when = /\b(?:resets?|until|after|in|at|tomorrow|available again)\b[\s\S]*$/i.exec(said);
        return {
            model: first(rules.model) || '',
            until: queue().parseReset(when ? when[0] : '', now),
            blocked: !!first(rules.blocked),
        };
    }

    const ChatSites = { SITES, SITE_KEYS, LIMITS, get, list, siteKey, allKeys, siteOfUrl, convIdOfUrl, readLimit };

    root.BB = root.BB || {};
    root.BB.ChatSites = ChatSites;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatSites;
})(typeof globalThis !== 'undefined' ? globalThis : this);
