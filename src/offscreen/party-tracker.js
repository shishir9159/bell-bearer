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
    const PartyHost = ns.PartyHost || req('./party-host.js');

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
    /** How long a joiner looks for the host before saying nobody is there. */
    const JOIN_MS = 30000;
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

    // ---------------------------------------------------------- rendezvous

    /** What every announce carries; the torrent fields are there because trackers expect them. */
    const ANNOUNCE = Object.freeze({ uploaded: 0, downloaded: 0, left: 0 });

    /**
     * The host in the swarm: every sealed offer that opens under our key is
     * answered, and the peer it makes is handed to `admit` once bound. An
     * offer is answered once however often its joiner announces it again.
     */
    function hostSwarm({ secret, urls, admit, iceServers, RTC, gatherMs, WebSocket }) {
        const answered = new Set();
        let swarm = null;
        let closed = false;

        async function hear(msg, reply) {
            if (!msg.offer || answered.has(msg.offer_id)) return;
            const bytes = await unseal(keys.key, msg.offer.sdp);
            const offer = bytes && PartyCode.unpack(bytes);
            if (!offer || offer.kind !== 'offer' || answered.has(msg.offer_id)) return;
            answered.add(msg.offer_id);
            const made = await PartyRtc.makeAnswer(offer.desc, { iceServers, RTC, gatherMs });
            if (!made) return;
            if (closed) return made.peer.pc.close();
            const sdp = await seal(keys.key, PartyCode.pack('answer', { tag: offer.tag, desc: made.desc }));
            reply({ to_peer_id: msg.peer_id, offer_id: msg.offer_id, answer: { type: 'answer', sdp } });
            const bound = await PartyRtc.bind(made.peer, { secret, hostFp: made.desc.fingerprint, guestFp: offer.desc.fingerprint });
            if (bound && !closed) admit(made.peer);
            else made.peer.pc.close();
        }

        let keys = null;
        const ready = keysFor(secret).then((derived) => {
            keys = derived;
            if (!closed) swarm = createSwarm({ urls, topic: keys.topic, WebSocket, hear, announce: () => ({ ...ANNOUNCE, numwant: 0 }) });
        });
        return {
            ready,
            up: () => (swarm ? swarm.up() : 0),
            close() {
                closed = true;
                if (swarm) swarm.close();
            },
        };
    }

    /**
     * A joiner looking for the host: OFFERS sealed offers, announced to every
     * tracker and again every RENEW_MS, until an answer to one of them opens
     * and binds. `done` resolves {peer}, or {error}: 'tracker' when no
     * tracker ever answered (the codes are the way in then), 'no-host' when
     * they did and nobody took an offer up.
     */
    function joinSwarm({ secret, urls, iceServers, RTC, gatherMs, WebSocket, timeoutMs = JOIN_MS }) {
        let finish = () => {};
        let cancelled = false;
        let cancelSwarm = () => {};
        const done = new Promise((resolve) => { finish = resolve; });

        (async () => {
            const keys = await keysFor(secret);
            const offers = await Promise.all(Array.from({ length: OFFERS }, async () => {
                const { peer, desc } = await PartyRtc.makeOffer({ iceServers, RTC, gatherMs });
                const tag = PartyCode.randomBytes(PartyCode.TAG_BYTES);
                const sdp = await seal(keys.key, PartyCode.pack('offer', { tag, desc }));
                return { id: binary(PartyCode.randomBytes(HASH_BYTES)), peer, desc, tag, sdp, taken: false };
            }));
            let settled = false;
            const swarm = createSwarm({
                urls, topic: keys.topic, WebSocket,
                announce: () => ({ ...ANNOUNCE, numwant: OFFERS, offers: offers.map((one) => ({ offer_id: one.id, offer: { type: 'offer', sdp: one.sdp } })) }),
                async hear(msg) {
                    const mine = msg.answer && offers.find((one) => one.id === msg.offer_id);
                    if (!mine || mine.taken || settled) return;
                    const bytes = await unseal(keys.key, msg.answer.sdp);
                    const answer = bytes && PartyCode.unpack(bytes);
                    if (!answer || answer.kind !== 'answer' || !PartyCode.sameBytes(answer.tag, mine.tag) || mine.taken) return;
                    mine.taken = true;
                    if (!(await PartyRtc.takeAnswer(mine.peer, mine.desc, answer.desc))) return;
                    const bound = await PartyRtc.bind(mine.peer, { secret, hostFp: answer.desc.fingerprint, guestFp: mine.desc.fingerprint });
                    if (bound) settle({ peer: mine.peer });
                    else mine.peer.pc.close();
                },
            });
            const renew = setInterval(() => swarm.announce(), RENEW_MS);
            const timer = setTimeout(() => settle({ error: swarm.up() ? 'no-host' : 'tracker' }), timeoutMs);
            function settle(result) {
                if (settled) return;
                settled = true;
                clearInterval(renew);
                clearTimeout(timer);
                // Connected, or given up: out of the swarm, so the offers
                // stop going to the host and nobody answers them again.
                swarm.close();
                for (const one of offers) if (one.peer !== result.peer) one.peer.pc.close();
                if (cancelled && result.peer) result.peer.pc.close();
                finish(cancelled ? { error: 'closed' } : result);
            }
            if (cancelled) settle({ error: 'closed' });
            else cancelSwarm = () => settle({ error: 'closed' });
        })().catch(() => finish({ error: 'tracker' }));

        return {
            done,
            cancel() {
                cancelled = true;
                cancelSwarm();
            },
        };
    }

    // ---------------------------------------------------------- transports

    /**
     * The session's `tracker` transport. With no code this browser hosts: a
     * code party's host (party-host.js), whose guests arrive through the
     * swarm rather than by pasted reply, and whose invite is the tracker
     * code. With one it joins the room the code names.
     */
    function createTransport(options = {}) {
        const urls = trackerUrls(options.trackers);
        const net = { urls, iceServers: options.iceServers || PartyHost.DEFAULT_ICE, RTC: options.RTC, gatherMs: options.gatherMs, WebSocket: options.WebSocket };
        if (options.code) {
            const secret = readCode(options.code);
            if (!secret) return null;
            let joining = null;
            let cancelled = false;
            return PartyHost.guestOf({
                connect() {
                    if (cancelled) return { error: 'closed' };
                    joining = joinSwarm({ secret, ...net });
                    return joining.done;
                },
                cancel() {
                    cancelled = true;
                    if (joining) joining.cancel();
                },
                invite: () => options.code.trim(),
            });
        }
        const { code, secret } = newCode();
        const host = PartyHost.createHost(options);
        const swarm = hostSwarm({ secret, admit: host.admit, ...net });
        return {
            open: host.open,
            invite: () => code,
            guests: host.guests,
            /** How many trackers are answering: none means nobody can find this party, and codes are the way in. */
            trackers: swarm.up,
            close() {
                swarm.close();
                host.close();
            },
        };
    }

    const PartyTracker = {
        PREFIX, SECRET_BYTES, OFFERS, DEFAULT_TRACKERS, INTERVAL_MIN_S, INTERVAL_MAX_S, RENEW_MS, RETRY_MS, JOIN_MS, LABELS,
        newCode, readCode, trackerUrls, keysFor, seal, unseal, createSwarm, hostSwarm, joinSwarm, createTransport,
    };

    root.BB = root.BB || {};
    root.BB.PartyTracker = PartyTracker;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyTracker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
