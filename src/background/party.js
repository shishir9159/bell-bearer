/**
 * Starting and leaving a watch party, from the worker's side: open the
 * document the party lives in, bind the party to a tab, and close it all
 * again.
 *
 * The session (src/offscreen/party-session.js) cannot live in the worker.
 * A service worker is stopped after thirty seconds without an event, and a
 * party is an evening with long stretches where nothing happens; the room,
 * and later a WebSocket or a peer connection, would die with it. An offscreen
 * document lives until it is closed, so the party goes there, and the tab's
 * port reaches it directly — the worker only opens it and closes it.
 *
 * It exists only while a party is on. Leaving closes it, and so does the
 * party's tab closing — after half a minute, in case that was a slip and the
 * party is started again from another tab.
 */
(function (root) {
    'use strict';

    const { Settings, PartyLoader } = root.BB;

    const DOC = 'offscreen.html';
    /** PartySession.TARGET, which the worker does not load; the test suite holds them together. */
    const SESSION = 'bb:party-session';
    const LINGER_ALARM = 'bb-party-linger';
    const LINGER_MIN = 0.5;
    /** Firefox unloads an idle background page after thirty seconds. */
    const KEEPALIVE_MS = 20000;
    const ACTIONS = Object.freeze(['partyStart', 'partyJoin', 'partyInvite', 'partyLeave', 'partyStatus', 'partyEnded', 'partyControl', 'partyPopup']);
    /** PartySession's host controls and revoking an invite: all the popup's, passed on as they are. */
    const CONTROL_OPS = Object.freeze(['policy', 'role', 'kick', 'revoke']);
    /**
     * Why the last party ended, when the authority ended it: the popup is
     * usually closed at that moment, so it reads this the next time it opens,
     * and clears it once shown.
     */
    const ENDED_KEY = 'bbPartyEnded';
    /** PartyCode.PREFIX.reply: a guest's answer to our invite, pasted in on the host's side. */
    const REPLY = 'bbp1r.';
    /** The codes that join a party, by prefix, and the transport each needs. */
    const JOINS = Object.freeze({ 'bbp1s.': 'server', 'bbp1i.': 'codes', 'bbp1t.': 'tracker' });

    /** Which of the session's transports a start asks for, or null for a code that is none of ours. */
    function modeOf(how) {
        if (how.code) return JOINS[how.code.slice(0, 6)] || null;
        if (how.codes) return 'codes';
        if (how.tracker) return 'tracker';
        if (how.server !== undefined) return 'server';
        return 'loopback';
    }

    /** Chrome: the session in an offscreen document, reached by message. */
    function offscreenHost(api) {
        const url = api.runtime.getURL(DOC);
        let opening = null;
        const exists = async () => (await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length > 0;
        return {
            exists,
            open() {
                // Only one offscreen document is allowed. Two starts close
                // together would both see none and both create one, and the
                // second create throws — so the second waits on the first.
                opening = opening || (async () => {
                    if (await exists()) return;
                    await api.offscreen.createDocument({
                        url: DOC, reasons: ['WEB_RTC'],
                        justification: 'Keeps a watch party connected while one is on.',
                    });
                })().finally(() => { opening = null; });
                return opening;
            },
            async close() {
                if (await exists()) await api.offscreen.closeDocument();
            },
            ask: (msg) => api.runtime.sendMessage({ ...msg, to: SESSION }),
        };
    }

    /**
     * Firefox: no offscreen documents, but the background is a page already
     * and stays one while a party is on. The session is loaded into it the
     * first time a party starts — offscreen.html's own script list, read from
     * the file so the two browsers cannot load different sessions — and is
     * called directly: a page's runtime.sendMessage never reaches itself.
     *
     * The page is still unloaded after thirty seconds with no event, so the
     * session asks the tab to ping it every KEEPALIVE_MS; a port message is
     * an event.
     */
    function pageHost(api, {
        doc = root.document,
        fetchText = async (url) => (await fetch(url)).text(),
        onEnd,
    } = {}) {
        let loading = null;
        const session = () => root.__bbPartySession || null;

        async function load() {
            const html = await fetchText(api.runtime.getURL(DOC));
            for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
                await new Promise((resolve, reject) => {
                    const script = doc.createElement('script');
                    script.src = api.runtime.getURL(src);
                    script.onload = resolve;
                    script.onerror = () => reject(new Error(`${src} did not load`));
                    (doc.head || doc.documentElement).appendChild(script);
                });
            }
            root.BB.PartySession.boot(api, { keepAliveMs: KEEPALIVE_MS, onEnd });
        }

        return {
            exists: async () => !!session() && session().status().active,
            open() {
                loading = loading || load().catch((error) => {
                    loading = null;
                    throw error;
                });
                return loading;
            },
            // Parsed scripts cannot be unloaded. With the party over the
            // session holds nothing and runs nothing, and the page may go.
            close: async () => {},
            ask: (msg) => session().control(msg),
        };
    }

    function createParty({ api, loader, host }) {
        async function leave() {
            await api.alarms.clear(LINGER_ALARM);
            if (host && (await host.exists())) {
                try { await host.ask({ op: 'leave' }); } catch (_) { /* the document went first */ }
                await host.close();
            }
            await loader.unbind();
            return { ok: true };
        }

        /**
         * `how` is empty for a party in this browser alone, `{server}` to
         * start a room on a party server (the setting's when it names none),
         * `{codes}` or `{tracker}` to host one peer to peer, or `{code}` to
         * join the room an invite names.
         */
        async function start(tabId, url, how = {}) {
            if (!host) return { ok: false, error: 'unsupported' };
            if (!PartyLoader.siteOf(url)) return { ok: false, error: 'site' };
            const mode = modeOf(how);
            if (!mode) return { ok: false, error: 'code' };
            const s = await Settings.get(['partyName', 'partyControl', 'partyWaitForAll', 'partyServerUrl', 'partyIceServers', 'partyTurn', 'partyTrackers']);
            await host.open();
            const answer = await host.ask({
                op: 'start', mode, name: s.partyName,
                url: how.server || s.partyServerUrl, code: how.code,
                ice: { stun: s.partyIceServers, turn: s.partyTurn }, trackers: s.partyTrackers,
                policy: { control: s.partyControl, wait: s.partyWaitForAll },
            });
            if (!answer || !answer.ok) {
                await leave();
                return answer || { ok: false };
            }
            await api.alarms.clear(LINGER_ALARM);
            // Only now, with the session listening: the injected code's first
            // act is to connect, and a port nobody answers means "no party".
            if (!(await loader.bind(tabId, url))) {
                await leave();
                return { ok: false, error: 'inject' };
            }
            return answer;
        }

        async function status() {
            if (!host || !(await host.exists())) return { ok: true, status: { active: false } };
            return host.ask({ op: 'status' });
        }

        /** The session's own ops on a party already on: a new invite, or a guest's reply to one. */
        async function ask(msg) {
            if (!host || !(await host.exists())) return { ok: false, error: 'inactive' };
            return host.ask(msg);
        }

        /** The authority ended the party: keep why, for the popup, then tidy up as for a leave. */
        async function ended(code) {
            try { await api.storage.session.set({ [ENDED_KEY]: { code: String(code || ''), at: Date.now() } }); } catch (_) { /* the popup just will not say why */ }
            return leave();
        }

        return {
            start, leave, status, ended,
            invite: () => ask({ op: 'invite' }),
            accept: (code) => ask({ op: 'accept', code }),
            /** {op, …fields} for one of CONTROL_OPS. */
            control: (msg) => ask(msg),
            onTabClosed: () => api.alarms.create(LINGER_ALARM, { delayInMinutes: LINGER_MIN }),
            /** Half a minute on: started again from another tab, the party stays; otherwise it is over. */
            async onAlarm(alarm) {
                if (!alarm || alarm.name !== LINGER_ALARM || (await loader.current())) return false;
                await leave();
                return true;
            },
        };
    }

    async function handle(api, party, message, sender) {
        switch (message.action) {
            case 'partyJoin':
                // Pasting a reply is the host letting a guest in, not joining anything.
                if (String(message.code || '').trim().startsWith(REPLY)) return party.accept(String(message.code).trim());
            // falls through
            case 'partyStart': {
                // From the page's own content script, or from the popup, which has no tab.
                const tab = (sender && sender.tab) || (await api.tabs.query({ active: true, lastFocusedWindow: true }))[0];
                const how = message.action === 'partyJoin' ? { code: String(message.code || '').trim() }
                    : message.mode === 'codes' || message.mode === 'tracker' ? { [message.mode]: true }
                        : message.server !== undefined ? { server: String(message.server || '') } : {};
                return tab ? party.start(tab.id, tab.url || '', how) : { ok: false, error: 'tab' };
            }
            case 'partyInvite': return party.invite();
            case 'partyLeave': return party.leave();
            // The session's own word that the authority ended the party (a
            // kick, a room the server no longer has). The tab was let go with
            // it; what is left is the document and the gate. A page cannot
            // end the party this way.
            case 'partyEnded': return sender && sender.tab ? { ok: false } : party.ended(message.code);
            // The chip's "Get a new invite": the popup is where invites are pasted.
            case 'partyPopup':
                try {
                    await api.action.openPopup();
                    return { ok: true };
                } catch (_) {
                    return { ok: false, error: 'popup' };
                }
            case 'partyControl': {
                if (!CONTROL_OPS.includes(message.op)) return { ok: false, error: 'op' };
                const { action, ...msg } = message;
                return party.control(msg);
            }
            default: return party.status();
        }
    }

    const PartyWorker = { DOC, SESSION, LINGER_ALARM, LINGER_MIN, KEEPALIVE_MS, ACTIONS, CONTROL_OPS, ENDED_KEY, REPLY, JOINS, modeOf, offscreenHost, pageHost, createParty, handle };

    const api = root.chrome;
    if (api && api.runtime && api.runtime.onMessage && api.alarms && PartyLoader.loader) {
        // A service worker has no document; Firefox's background page does.
        const host = api.offscreen && api.runtime.getContexts ? offscreenHost(api)
            // The session shares this page, so it is told directly: a page's
            // runtime.sendMessage never reaches itself.
            : root.document ? pageHost(api, { onEnd: (code) => party.ended(code) }) : null;
        const party = createParty({ api, loader: PartyLoader.loader, host });
        PartyLoader.loader.onClosed(party.onTabClosed);
        api.alarms.onAlarm.addListener(party.onAlarm);
        api.runtime.onMessage.addListener((message, sender, respond) => {
            if (!message || !ACTIONS.includes(message.action)) return false;
            handle(api, party, message, sender).then(respond, () => respond({ ok: false }));
            return true;
        });
        PartyWorker.party = party;
    }

    root.BB.PartyWorker = PartyWorker;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyWorker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
