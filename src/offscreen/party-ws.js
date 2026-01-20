/**
 * The party's authority over a WebSocket: a hosted party server, or the
 * host's own copy of it on their PC (`ws://ip:port`). Both speak the README's
 * "Watch party protocol", so this is one transport with an address.
 *
 * It offers the session the same link the loopback does. The session opens
 * with `create`; this turns that into whatever the server needs to hear —
 * `create` when we are starting the room, `hello` with the room and secret
 * when we were handed an invite, `hello` with our resume token when we are
 * coming back — so the session never learns there was a network in between.
 *
 * Coming back is most of what this file does. A laptop lid, a Wi-Fi hop or a
 * server restart drops the socket, and the party should not notice more than
 * a "reconnecting" on the chip:
 *
 * - The socket is retried with exponential backoff and full jitter, so a
 *   server that restarts is not met by every member at the same instant.
 * - The retry says `hello` with the resume token from the last welcome, and
 *   the room gives back the same member id and role within its grace. Past
 *   the grace we join again as someone new, which beats ending the party.
 * - While down, only the latest of each thing we would have said is kept.
 *   An intent goes with the `base` it was made on, so the room's conflict
 *   rule decides whether it still applies: a pause made offline ten minutes
 *   ago cannot drag everyone back. Pings are dropped; they are stale at once.
 * - A socket that goes quiet is treated as dropped. The session pings at
 *   least every 7.5 s and every ping is answered, so silence past SILENT_MS
 *   is a dead path the browser has not noticed yet, not a quiet room.
 *
 * The one failure that is not retried is the first: an address that never
 * answered is a typo or a server that is down, and the user should hear so
 * rather than watch a spinner.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyChat = ns.PartyChat || req('../shared/party-chat.js');
    const PartyCode = ns.PartyCode || req('../shared/party-code.js');

    /** Invite codes for a server party: this, then base64url of {url, room, secret}. */
    const PREFIX = 'bbp1s.';
    const VERSION = 1;
    const MAX_FRAME = 8192;
    const BACKOFF_MIN_MS = 500;
    const BACKOFF_MAX_MS = 15000;
    /** How long the first connection may take before the address is called unreachable. */
    const CONNECT_MS = 10000;
    const SILENT_MS = 20000;
    /** What is kept while the socket is down, latest of each. Sent in this order on the way back. */
    const HELD = Object.freeze(['ready', 'solo', 'intent']);

    /**
     * Chat is not "latest of each": every line typed during a reconnect was
     * meant, and dropping it left the user watching their words vanish. As
     * many are kept as the room takes at once; more than that, sent together
     * on the way back, it would drop anyway.
     */
    const holdLine = (lines, msg) => [...lines, msg].slice(-PartyChat.BURST);

    /** How long the chat said again waits for the room's history, if the members announcement never comes. */
    const HISTORY_WAIT_MS = 2000;

    /**
     * What a transport keeps so that nothing said is lost to a drop.
     *
     * Said while the way to the room is down: the latest of each HELD kind,
     * and the last few chat lines, sent on the way back.
     *
     * Said while it still looked up is kept too. A socket whose path has died
     * is not noticed for up to SILENT_MS, and everything sent in that time
     * went into it and was gone: a solo pressed then never reached the room,
     * even for a member that came back as itself. So what was sent is kept
     * until the room shows it arrived, and the welcome on the way back is
     * checked against it:
     *
     * - ready and solo: the welcome's roster says what the room has for us,
     *   and whatever differs from what we last said is said again.
     * - an intent, until it is acknowledged or rejected: sent again only if
     *   the room has not moved since it was made, so one that did land, or
     *   that somebody else's change overtook, cannot drag the room back.
     * - chat, until it comes back as our own line: said again only once the
     *   room's history is in (the members announcement follows it), less any
     *   line of ours the history already has.
     */
    function createHoldBuffer({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        const held = new Map();
        let lines = [];
        /** ready and solo: the latest said, sent or held. */
        const said = {};
        /** Said again by a welcome, so the session's own saying of it right after is not a second copy. */
        let resent = {};
        let intent = null;
        let unechoed = [];
        /** Every member id the room has given us: a line in the history may be from any of them. */
        const mine = new Set();
        /** { send, lines, timer } while chat waits for the history. */
        let due = null;

        function without(list, line) {
            const at = list.findIndex((one) => PartyChat.clean(one.text) === line.text);
            return at < 0 ? list : [...list.slice(0, at), ...list.slice(at + 1)];
        }
        function sayDue() {
            if (!due) return;
            const { send, timer } = due;
            const out = due.lines.slice(-PartyChat.BURST);
            clearTimer(timer);
            due = null;
            for (const line of out) {
                send(line);
                unechoed = holdLine(unechoed, line);
            }
        }

        return {
            /** Keep `msg` while the way is down, if it is worth keeping across a drop; anything else is let go. */
            hold(msg) {
                if (msg.t === 'ready' || msg.t === 'solo') said[msg.t] = msg;
                if (HELD.includes(msg.t)) held.set(msg.t, msg);
                else if (msg.t === 'chat') lines = holdLine(lines, msg);
            },
            /** `msg` is going out on a way that looks up. False if it is a copy of what the welcome just said again. */
            sent(msg) {
                if (msg.t === 'ready' || msg.t === 'solo') {
                    const copy = resent[msg.t] && JSON.stringify(resent[msg.t]) === JSON.stringify(msg);
                    said[msg.t] = msg;
                    if (copy) return false;
                } else if (msg.t === 'intent') {
                    intent = msg;
                } else if (msg.t === 'chat') {
                    unechoed = holdLine(unechoed, msg);
                }
                return true;
            },
            /** What the room said: whether it shows that something sent arrived. */
            heard(msg) {
                if (msg.t === 'state' && intent && msg.ack && mine.has(msg.ack.member) && msg.ack.id === intent.id) intent = null;
                else if (msg.t === 'reject' && intent && msg.id === intent.id) intent = null;
                else if (msg.t === 'chat' && mine.has(msg.from)) {
                    unechoed = without(unechoed, msg);
                    if (due) due.lines = without(due.lines, msg);
                } else if (msg.t === 'members') sayDue();
            },
            /** Welcomed back: say again whatever the room is missing, and what was held. */
            welcome(msg, send) {
                mine.add(msg.you);
                const room = msg.room || {};
                const me = (room.members || []).find((m) => m.id === msg.you) || {};
                resent = {};
                const ready = said.ready;
                if (ready && (me.ready !== (ready.ready !== false) || (ready.ready === false && me.why !== ready.why))) {
                    send(ready);
                    resent.ready = ready;
                }
                const solo = said.solo;
                if (solo && (me.solo === true) !== (solo.solo === true)) {
                    send(solo);
                    resent.solo = solo;
                }
                const next = held.get('intent') || (intent && room.state && room.state.seq === intent.base ? intent : null);
                intent = null;
                if (next) {
                    send(next);
                    intent = next;
                }
                held.clear();
                // Lines that went out may be in the history that follows; only
                // with none of those can the held ones go at once.
                const went = [...(due ? due.lines : []), ...unechoed];
                const waiting = [...went, ...lines];
                if (due) clearTimer(due.timer);
                due = null;
                unechoed = [];
                lines = [];
                if (waiting.length) {
                    due = { send, lines: waiting, timer: setTimer(sayDue, HISTORY_WAIT_MS) };
                    if (!went.length) sayDue();
                }
            },
            /** The welcome has been handed on: a copy said after this is meant. */
            settled() { resent = {}; },
            close() {
                if (due) clearTimer(due.timer);
                due = null;
            },
        };
    }

    // A text through the codes' own base64url, rather than a second copy of
    // the alphabet here.
    const toBase64Url = (text) => PartyCode.toBase64Url(new TextEncoder().encode(text));

    function fromBase64Url(text) {
        const bytes = PartyCode.fromBase64Url(text);
        if (!bytes) throw new Error('not base64url');
        return new TextDecoder().decode(bytes);
    }

    /** A ws:// or wss:// address, normalised, or null. */
    function serverUrl(text) {
        try {
            const url = new URL(String(text || '').trim());
            return url.protocol === 'ws:' || url.protocol === 'wss:' ? url.href : null;
        } catch (_) {
            return null;
        }
    }

    const inviteCode = ({ url, room, secret }) => PREFIX + toBase64Url(JSON.stringify({ url, room, secret }));

    /** {url, room, secret} from a code, or null. The address is checked like one typed in. */
    function readInvite(code) {
        const text = String(code || '').trim();
        if (!text.startsWith(PREFIX)) return null;
        try {
            const { url, room, secret } = JSON.parse(fromBase64Url(text.slice(PREFIX.length)));
            const address = serverUrl(url);
            if (!address || typeof room !== 'string' || !room || typeof secret !== 'string' || !secret) return null;
            return { url: address, room, secret };
        } catch (_) {
            return null;
        }
    }

    /**
     * A transport for PartySession: `url` to start a room on that server, or
     * `code` to join the one it names. Null if neither is usable.
     */
    function createTransport({ url, code, WebSocket: Socket = root.WebSocket, random = Math.random } = {}) {
        const invite = code ? readInvite(code) : null;
        const address = invite ? invite.url : serverUrl(url);
        if (!address || !Socket) return null;

        let room = invite ? invite.room : null;
        let secret = invite ? invite.secret : null;
        let resume = null;
        let create = null;
        let deliver = () => {};
        let socket = null;
        /** A welcome has come on the current socket: what we send goes out rather than being held. */
        let up = false;
        /** A welcome has ever come: a drop from here on is retried, not reported. */
        let joined = false;
        let closed = false;
        let attempt = 0;
        let retryTimer = null;
        let quietTimer = null;
        const holding = createHoldBuffer();

        function transmit(msg) {
            const text = JSON.stringify(msg);
            if (socket && text.length <= MAX_FRAME) socket.send(text);
        }

        function greeting() {
            if (resume) return { t: 'hello', v: VERSION, room, resume };
            if (room) return { t: 'hello', v: VERSION, room, secret, name: create.name };
            return create;
        }

        function listen() {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(drop, joined ? SILENT_MS : CONNECT_MS);
        }

        function hangUp() {
            const was = socket;
            socket = null;
            up = false;
            clearTimeout(quietTimer);
            if (!was) return;
            // A socket whose path died may take minutes to report closing;
            // nothing it says after this is heard.
            was.onopen = was.onmessage = was.onclose = was.onerror = null;
            try { was.close(1000); } catch (_) { /* never opened */ }
        }

        function connect() {
            retryTimer = null;
            if (closed) return;
            let ws;
            try {
                ws = new Socket(address);
            } catch (_) {
                drop();
                return;
            }
            socket = ws;
            ws.onopen = () => transmit(greeting());
            ws.onmessage = (event) => receive(event.data);
            ws.onclose = drop;
            ws.onerror = drop;
            listen();
        }

        function drop() {
            const wasUp = up;
            hangUp();
            if (closed || retryTimer) return;
            if (!joined) {
                closed = true;
                deliver({ t: 'error', code: 'unreachable' });
                return;
            }
            if (wasUp) deliver({ t: 'link', up: false });
            const wait = Math.round(random() * Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt));
            attempt++;
            retryTimer = setTimeout(connect, wait);
        }

        function receive(data) {
            listen();
            let msg;
            try { msg = JSON.parse(data); } catch (_) { return; }
            if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
            switch (msg.t) {
                case 'created':
                    // Kept for the invite and for joining again past the
                    // grace; the session has no use for the secret.
                    room = msg.room;
                    secret = msg.secret;
                    return;
                case 'welcome':
                    resume = msg.resume;
                    joined = true;
                    up = true;
                    attempt = 0;
                    // What the room is missing goes before the session hears
                    // it is back, so the session saying the same is a copy.
                    holding.welcome(msg, transmit);
                    deliver(msg);
                    holding.settled();
                    return;
                case 'error':
                    if (msg.code === 'expired' && resume && secret) {
                        resume = null;
                        hangUp();
                        connect();
                        return;
                    }
                    closed = true;
                    hangUp();
                    deliver(msg);
                    return;
                default:
                    holding.heard(msg);
                    deliver(msg);
            }
        }

        function close() {
            closed = true;
            clearTimeout(retryTimer);
            retryTimer = null;
            holding.close();
            hangUp();
        }

        return {
            invite: () => (room && secret ? inviteCode({ url: address, room, secret }) : null),
            open(receiveFn) {
                deliver = receiveFn;
                return {
                    send(msg) {
                        if (!msg || typeof msg.t !== 'string' || closed) return;
                        if (msg.t === 'create') {
                            if (create) return;
                            create = { ...msg, v: VERSION };
                            connect();
                        } else if (up) {
                            if (holding.sent(msg)) transmit(msg);
                        } else {
                            holding.hold(msg);
                        }
                    },
                    close,
                };
            },
            close,
        };
    }

    const PartyWs = {
        PREFIX, VERSION, MAX_FRAME, BACKOFF_MIN_MS, BACKOFF_MAX_MS, CONNECT_MS, SILENT_MS, HELD,
        HISTORY_WAIT_MS, serverUrl, inviteCode, readInvite, holdLine, createHoldBuffer, createTransport,
    };

    root.BB = root.BB || {};
    root.BB.PartyWs = PartyWs;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyWs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
