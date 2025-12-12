/**
 * A peer-to-peer party that meets through public WebTorrent trackers, so
 * the whole invite is one short code: `bbp1t.` and a secret.
 *
 * A WebTorrent tracker is a rendezvous that already exists and costs nobody
 * anything. Peers announce a 20-byte `info_hash` over a WebSocket; one that
 * announces with `offers` has them handed to others announcing the same hash,
 * and an answer sent `to_peer_id` is handed back. We use none of the torrent
 * part — only that relay — and put nothing readable into it:
 *
 * - The hash is HKDF(secret, 'bb-party/topic'), so only code holders find
 *   the swarm, and the tracker never sees the secret.
 * - Every description is sealed with AES-GCM under HKDF(secret,
 *   'bb-party/seal'). What the tracker sees is who connected and when.
 *   Anything that does not open under our key is a stranger's and ignored.
 *
 * The joiner offers and the host answers. The host stays in the swarm by
 * re-announcing with no offers; a joiner announces OFFERS sealed offers, the
 * tracker hands them to peers in the swarm — the host and anyone else still
 * waiting — and the host answers one. Offers reaching another joiner are
 * ignored, and a joiner leaves the swarm once connected, so the swarm stays
 * the host plus whoever is on the way in, and one of five reaches the host.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyCode = ns.PartyCode || req('../shared/party-code.js');
    const PartyRtc = ns.PartyRtc || req('./party-rtc.js');

    const PREFIX = 'bbp1t.';
    const SECRET_BYTES = 16;
    const HASH_BYTES = 20;
    const OFFERS = 5;
    const DEFAULT_TRACKERS = Object.freeze(['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev']);
    /** How often the host re-announces, whatever a tracker asks for. */
    const INTERVAL_MIN_S = 30;
    const INTERVAL_MAX_S = 120;
    /** A joiner's offers are announced again this often, for a host that arrived after them. */
    const RENEW_MS = 10000;
    const RETRY_MS = 5000;
    const LABELS = Object.freeze({ topic: 'bb-party/topic', seal: 'bb-party/seal' });

    const binary = (bytes) => String.fromCharCode(...bytes);

    function newCode() {
        const secret = PartyCode.randomBytes(SECRET_BYTES);
        return { code: PREFIX + PartyCode.toBase64Url(secret), secret };
    }

    /** The secret in a tracker code, or null. */
    function readCode(code) {
        const text = String(code || '').trim();
        if (!text.startsWith(PREFIX)) return null;
        const secret = PartyCode.fromBase64Url(text.slice(PREFIX.length));
        return secret && secret.length === SECRET_BYTES ? secret : null;
    }

    /** ws(s):// addresses from the setting's text, or the defaults if it names none. */
    function trackerUrls(text) {
        const urls = String(text || '').split(/\s+/).filter((url) => /^wss?:\/\/\S+$/.test(url));
        return urls.length ? urls : [...DEFAULT_TRACKERS];
    }

    /** The swarm's hash, as the tracker wants it, and the key its blobs are sealed with. */
    async function keysFor(secret) {
        const subtle = root.crypto.subtle;
        const base = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits', 'deriveKey']);
        const params = (label) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(label) });
        const topic = new Uint8Array(await subtle.deriveBits(params(LABELS.topic), base, HASH_BYTES * 8));
        const key = await subtle.deriveKey(params(LABELS.seal), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        return { topic: binary(topic), key };
    }

    async function seal(key, bytes) {
        const iv = PartyCode.randomBytes(12);
        const sealed = new Uint8Array(await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
        return PartyCode.toBase64Url(Uint8Array.from([...iv, ...sealed]));
    }

    /** The bytes inside, or null for a blob that is not ours (or not anything). */
    async function unseal(key, text) {
        const bytes = PartyCode.fromBase64Url(String(text || ''));
        if (!bytes || bytes.length < 13) return null;
        try {
            return new Uint8Array(await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
        } catch (_) {
            return null;
        }
    }

    /**
     * Sockets to every tracker, each announcing the same hash. `announce()`
     * builds what to say each time (the host's is bare, a joiner's carries
     * offers), and `hear(msg, reply)` gets every message for our hash with a
     * way to answer on the tracker it came from. A tracker that drops is
     * tried again; `up()` counts the ones answering now.
     */
    function createSwarm({ urls, topic, announce, hear, WebSocket: Socket = root.WebSocket }) {
        const peerId = binary(PartyCode.randomBytes(HASH_BYTES));
        const sockets = new Map();
        let closed = false;

        function say(ws, msg) {
            try { ws.send(JSON.stringify({ info_hash: topic, peer_id: peerId, ...msg })); } catch (_) { /* reconnecting */ }
        }

        function open(url) {
            if (closed) return;
            let ws;
            try { ws = new Socket(url); } catch (_) { return; }
            const entry = { ws, live: false, timer: null };
            sockets.set(url, entry);
            ws.onopen = () => say(ws, { action: 'announce', ...announce(), event: 'started' });
            ws.onmessage = (event) => {
                let msg;
                try { msg = JSON.parse(event.data); } catch (_) { return; }
                if (!msg || msg.action !== 'announce' || msg.info_hash !== topic) return;
                entry.live = true;
                if (msg.interval) {
                    const seconds = Math.min(INTERVAL_MAX_S, Math.max(INTERVAL_MIN_S, Number(msg.interval) || 0));
                    clearInterval(entry.timer);
                    entry.timer = setInterval(() => say(ws, { action: 'announce', ...announce() }), seconds * 1000);
                }
                if (msg.peer_id !== peerId && (msg.offer || msg.answer)) hear(msg, (answer) => say(ws, { action: 'announce', ...answer }));
            };
            ws.onclose = ws.onerror = () => {
                clearInterval(entry.timer);
                ws.onclose = ws.onerror = ws.onmessage = null;
                if (sockets.get(url) !== entry || closed) return;
                sockets.delete(url);
                setTimeout(() => open(url), RETRY_MS);
            };
        }

        /** Say it again now, to every tracker: new offers, or leaving. */
        function announceAll(extra = {}) {
            for (const { ws } of sockets.values()) if (ws.readyState === 1) say(ws, { action: 'announce', ...announce(), ...extra });
        }

        urls.forEach(open);
        return {
            peerId,
            announce: announceAll,
            up: () => [...sockets.values()].filter((one) => one.live).length,
            close() {
                if (closed) return;
                announceAll({ event: 'stopped', offers: undefined });
                closed = true;
                for (const { ws, timer } of sockets.values()) {
                    clearInterval(timer);
                    ws.onclose = ws.onerror = ws.onmessage = null;
                    try { ws.close(); } catch (_) { /* never opened */ }
                }
                sockets.clear();
            },
        };
    }

    const PartyTracker = {
        PREFIX, SECRET_BYTES, OFFERS, DEFAULT_TRACKERS, INTERVAL_MIN_S, INTERVAL_MAX_S, RENEW_MS, RETRY_MS, LABELS,
        newCode, readCode, trackerUrls, keysFor, seal, unseal, createSwarm,
    };

    root.BB = root.BB || {};
    root.BB.PartyTracker = PartyTracker;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyTracker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
