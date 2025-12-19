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

    function toBase64Url(text) {
        const bytes = new TextEncoder().encode(text);
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function fromBase64Url(text) {
        const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
        return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
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
        const held = new Map();
        let lines = [];

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
                    deliver(msg);
                    for (const t of HELD) if (held.has(t)) transmit(held.get(t));
                    for (const line of lines) transmit(line);
                    held.clear();
                    lines = [];
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
                    deliver(msg);
            }
        }

        function close() {
            closed = true;
            clearTimeout(retryTimer);
            retryTimer = null;
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
                            transmit(msg);
                        } else if (HELD.includes(msg.t)) {
                            held.set(msg.t, msg);
                        } else if (msg.t === 'chat') {
                            lines = holdLine(lines, msg);
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
        serverUrl, inviteCode, readInvite, holdLine, createTransport,
    };

    root.BB = root.BB || {};
    root.BB.PartyWs = PartyWs;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyWs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
