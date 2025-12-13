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
    const PartyState = ns.PartyState || req('../shared/party-state.js');
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
    /** A stalled connection is left this long to heal itself before ICE is restarted. */
    const DISCONNECT_MS = 5000;
    /** How long a restart waits for the host's answer before meeting it again from scratch. */
    const RESTART_MS = 15000;
    /** What a guest keeps while its way to the host is down, latest of each (PartyWs.HELD). */
    const HELD = Object.freeze(['ready', 'solo', 'intent']);
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
    const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

    /** A sealed blob that opens under our key as the kind expected (and the tag, if one is), unpacked; else null. */
    async function opened(key, sealed, kind, tag) {
        const bytes = await unseal(key, sealed);
        const out = bytes && PartyCode.unpack(bytes);
        if (!out || out.kind !== kind || (tag && !PartyCode.sameBytes(out.tag, tag))) return null;
        return out;
    }

    /**
     * The host in the swarm: every sealed offer that opens under our key is
     * answered, and the peer it makes is handed to `admit` once bound. An
     * offer is answered once however often its joiner announces it again.
     *
     * An offer under a tag this host already admitted is that guest
     * restarting ICE, and is answered on the peer it has rather than a new
     * one: the channels, and the member on them, carry on.
     */
    function hostSwarm({ secret, urls, admit, iceServers, RTC, gatherMs, WebSocket }) {
        const answered = new Set();
        const admitted = new Map();
        let swarm = null;
        let closed = false;
        let keys = null;

        const answerWith = async (msg, reply, tag, desc) => reply({
            to_peer_id: msg.peer_id, offer_id: msg.offer_id,
            answer: { type: 'answer', sdp: await seal(keys.key, PartyCode.pack('answer', { tag, desc })) },
        });

        async function restart(guest, offer, msg, reply) {
            // The same restart comes as several offers, for the tracker to
            // hand one to us among whoever else is waiting: answer the first.
            if (guest.ufrag === offer.desc.ufrag || ['closed', 'failed'].includes(guest.peer.pc.connectionState)) return;
            guest.ufrag = offer.desc.ufrag;
            try {
                await guest.peer.pc.setRemoteDescription({ type: 'offer', sdp: PartyCode.buildSdp(offer.desc, { type: 'offer', mid: guest.desc.mid }) });
                guest.desc = await PartyRtc.describeLocal(guest.peer.pc, gatherMs);
            } catch (_) {
                return;
            }
            await answerWith(msg, reply, offer.tag, guest.desc);
        }

        async function hear(msg, reply) {
            if (!msg.offer || answered.has(msg.offer_id)) return;
            const offer = await opened(keys.key, msg.offer.sdp, 'offer');
            if (!offer || answered.has(msg.offer_id)) return;
            answered.add(msg.offer_id);
            const known = admitted.get(hex(offer.tag));
            if (known) return restart(known, offer, msg, reply);
            const made = await PartyRtc.makeAnswer(offer.desc, { iceServers, RTC, gatherMs });
            if (!made) return;
            if (closed) return made.peer.pc.close();
            await answerWith(msg, reply, offer.tag, made.desc);
            const bound = await PartyRtc.bind(made.peer, { secret, hostFp: made.desc.fingerprint, guestFp: offer.desc.fingerprint });
            if (!bound || closed) return made.peer.pc.close();
            admitted.set(hex(offer.tag), { peer: made.peer, desc: made.desc, ufrag: offer.desc.ufrag });
            admit(made.peer);
        }

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
     * Announce sealed offers, and again every RENEW_MS for a host that
     * arrives after them, until `take` makes something of an answer to one
     * or `timeoutMs` passes. Resolves take's result, or {error}: 'tracker'
     * when no tracker ever answered, 'no-host' when they did and nobody took
     * an offer up, 'closed' when cancelled.
     */
    function announceOffers({ urls, topic, WebSocket, offers, timeoutMs, take, renewMs = RENEW_MS }) {
        let settle = () => {};
        const done = new Promise((resolve) => {
            let settled = false;
            const swarm = createSwarm({
                urls, topic, WebSocket,
                announce: () => ({ ...ANNOUNCE, numwant: offers.length, offers: offers.map((one) => ({ offer_id: one.id, offer: { type: 'offer', sdp: one.sdp } })) }),
                async hear(msg) {
                    const mine = msg.answer && offers.find((one) => one.id === msg.offer_id);
                    if (!mine || mine.taken || settled) return;
                    mine.taken = true;
                    const result = await take(mine, msg.answer.sdp);
                    if (result) settle(result);
                },
            });
            const renew = setInterval(() => swarm.announce(), renewMs);
            const timer = setTimeout(() => settle({ error: swarm.up() ? 'no-host' : 'tracker' }), timeoutMs);
            settle = (result) => {
                if (settled) return;
                settled = true;
                clearInterval(renew);
                clearTimeout(timer);
                // Connected, or given up: out of the swarm, so the offers
                // stop going to the host and nobody answers them again.
                swarm.close();
                resolve(result);
            };
        });
        return { done, cancel: () => settle({ error: 'closed' }) };
    }

    /** Something async that announces offers, as {done, cancel}; `run(cancelled, track)` hands its announcer to `track`. */
    function cancellable(run, failed) {
        let inner = null;
        let cancelled = false;
        const done = run(() => cancelled, (announcing) => { inner = announcing; }).catch(() => failed);
        return {
            done,
            cancel() {
                cancelled = true;
                if (inner) inner.cancel();
            },
        };
    }

    /**
     * A joiner looking for the host: OFFERS sealed offers, each its own peer,
     * until an answer to one of them opens and binds. `done` resolves
     * {peer, desc, tag} — the tag is what a later ICE restart is known by —
     * or announceOffers' {error}.
     */
    function joinSwarm({ secret, urls, iceServers, RTC, gatherMs, WebSocket, renewMs, timeoutMs = JOIN_MS }) {
        return cancellable(async (cancelled, track) => {
            const keys = await keysFor(secret);
            const offers = await Promise.all(Array.from({ length: OFFERS }, async () => {
                const { peer, desc } = await PartyRtc.makeOffer({ iceServers, RTC, gatherMs });
                const tag = PartyCode.randomBytes(PartyCode.TAG_BYTES);
                const sdp = await seal(keys.key, PartyCode.pack('offer', { tag, desc }));
                return { id: binary(PartyCode.randomBytes(HASH_BYTES)), peer, desc, tag, sdp, taken: false };
            }));
            const announcing = cancelled() ? null : announceOffers({
                urls, topic: keys.topic, WebSocket, offers, timeoutMs, renewMs,
                async take(mine, sealed) {
                    const answer = await opened(keys.key, sealed, 'answer', mine.tag);
                    if (!answer || !(await PartyRtc.takeAnswer(mine.peer, mine.desc, answer.desc))) return null;
                    if (await PartyRtc.bind(mine.peer, { secret, hostFp: answer.desc.fingerprint, guestFp: mine.desc.fingerprint })) {
                        return { peer: mine.peer, desc: mine.desc, tag: mine.tag };
                    }
                    mine.peer.pc.close();
                    return null;
                },
            });
            track(announcing);
            const result = announcing ? await announcing.done : { error: 'closed' };
            for (const one of offers) if (one.peer !== result.peer) one.peer.pc.close();
            if (cancelled() && result.peer) {
                result.peer.pc.close();
                return { error: 'closed' };
            }
            return result;
        }, { error: 'tracker' });
    }

    /**
     * ICE restart for a joiner whose connection stalled: a fresh offer on the
     * same peer, under the tag it first connected with, through the tracker.
     * `done` resolves true once the host's answer is applied.
     */
    function restartSwarm({ secret, urls, peer, tag, gatherMs, WebSocket, renewMs, timeoutMs = RESTART_MS }) {
        return cancellable(async (cancelled, track) => {
            const keys = await keysFor(secret);
            peer.pc.restartIce();
            const desc = await PartyRtc.describeLocal(peer.pc, gatherMs);
            const sdp = await seal(keys.key, PartyCode.pack('offer', { tag, desc }));
            const offers = Array.from({ length: OFFERS }, () => ({ id: binary(PartyCode.randomBytes(HASH_BYTES)), sdp, taken: false }));
            const announcing = cancelled() ? null : announceOffers({
                urls, topic: keys.topic, WebSocket, offers, timeoutMs, renewMs,
                async take(mine, sealed) {
                    const answer = await opened(keys.key, sealed, 'answer', tag);
                    return answer && (await PartyRtc.takeAnswer(peer, desc, answer.desc)) ? { ok: true } : null;
                },
            });
            track(announcing);
            return !!announcing && !!(await announcing.done).ok;
        }, false);
    }

    // ---------------------------------------------------------- transports

    /**
     * A tracker party's guest. Unlike a code party's it has a way back when
     * its connection goes, because the tracker is still there to meet in:
     *
     * - 'disconnected' often heals by itself (consent freshness); past
     *   DISCONNECT_MS it is restarted through the tracker, keeping the peer,
     *   the channels and the member.
     * - 'failed', or a restart nobody answered, meets the host again from
     *   scratch and resumes the member with the token its welcome carried.
     *   While that happens only the latest of each thing said is kept, as
     *   over a WebSocket (party-ws.js).
     * - Nobody answering at all means the host is gone. The member next in
     *   line takes the room over, as it stood, under the same code (see
     *   takeOver); the others find them in the swarm and join as new members.
     */
    function createGuest({ secret, code, net, host: hostOptions, roomNow, joinMs = JOIN_MS, stallMs = DISCONNECT_MS }) {
        let deliver = () => {};
        let hello = null;
        let link = null;
        let conn = null;
        let pending = null;
        let hosting = null;
        let stall = null;
        let up = false;
        let closed = false;
        const seen = { you: null, owner: null, resume: null, members: [], state: null, policy: null };
        const held = new Map();

        function hear(msg) {
            switch (msg.t) {
                case 'welcome':
                    Object.assign(seen, { you: msg.you, resume: msg.resume, members: msg.room.members, state: msg.room.state, policy: msg.room.policy });
                    // Whose browser the room is in: whoever made it, first in
                    // the roster. Not the host role, which can be handed on.
                    seen.owner = msg.room.members.length ? msg.room.members[0].id : null;
                    up = true;
                    deliver(msg);
                    for (const t of HELD) if (held.has(t)) link.send(held.get(t));
                    held.clear();
                    return;
                case 'members': seen.members = msg.list; break;
                case 'policy': seen.policy = { control: msg.control, wait: msg.wait, locked: msg.locked }; break;
                case 'state': {
                    const { t, ack, ...state } = msg;
                    if (!seen.state || state.seq >= seen.state.seq) seen.state = state;
                    break;
                }
                case 'error':
                    // A room that does not know our token — we were gone past
                    // the grace, or it is a new host's — is joined as someone
                    // new rather than the party ended.
                    if (msg.code === 'expired' && seen.resume) {
                        seen.resume = null;
                        greet();
                        return;
                    }
                    break;
                default: break;
            }
            deliver(msg);
        }

        function greet() {
            link.send(seen.resume ? { t: 'hello', v: hello.v, resume: seen.resume } : { t: 'hello', v: hello.v, name: hello.name });
        }

        function attach(result) {
            conn = result;
            link = PartyRtc.peerLink(result.peer, { deliver: hear, onDown: lost, onState });
            greet();
        }

        function onState(state) {
            clearTimeout(stall);
            if (state === 'disconnected') stall = setTimeout(restart, stallMs);
        }

        async function restart() {
            if (closed || pending || !conn) return;
            pending = restartSwarm({ secret, ...net, peer: conn.peer, tag: conn.tag });
            const ok = await pending.done;
            pending = null;
            // Restarted, the link never went. Otherwise it is let go, and lost() takes over.
            if (!ok && !closed && link) link.close();
        }

        async function meet(timeoutMs) {
            pending = joinSwarm({ secret, ...net, timeoutMs });
            const result = await pending.done;
            pending = null;
            if (closed && result.peer) result.peer.pc.close();
            return closed ? { error: 'closed' } : result;
        }

        async function lost() {
            clearTimeout(stall);
            if (closed) return;
            link = null;
            conn = null;
            if (up) {
                up = false;
                deliver({ t: 'link', up: false });
            }
            // Whoever is next in line waits less before deciding the host is
            // gone, and everyone else longer, so they find the new one.
            const next = successor() === seen.you;
            const result = await meet(next ? joinMs / 2 : joinMs * 2);
            if (result.peer) return attach(result);
            if (result.error === 'closed') return null;
            if (result.error === 'no-host' && next) return takeOver();
            return deliver({ t: 'error', code: 'host-left' });
        }

        /**
         * Who carries the room on: whoever the room had made host by the
         * time it went (the owner's bye promotes someone), else its rule for
         * a host gone quiet — the first co-host, else the earliest joiner.
         * The owner is left out by id, so a guest that heard the last roster
         * and one that did not still pick the same member.
         */
        function successor() {
            const here = seen.members.filter((m) => m.id !== seen.owner && !m.away);
            const next = here.find((m) => m.role === 'host') || here.find((m) => m.role === 'cohost') || here[0];
            return next ? next.id : null;
        }

        /**
         * The host is gone and this member is next: host the room here, under
         * the same code, from the state it last had. The vector is re-based
         * on this browser's clock — the old room's `at` was the old host's —
         * so what was playing carries on from where it had got to.
         */
        function takeOver() {
            const state = seen.state && { ...seen.state, pos: PartyState.expected(seen.state, roomNow()), at: Date.now(), hold: null };
            const room = PartyHost.createHost({ ...hostOptions, policy: seen.policy || hostOptions.policy, state });
            hosting = { room, swarm: hostSwarm({ secret, admit: room.admit, ...net }) };
            seen.resume = null;
            link = room.open(hear);
            greet();
        }

        function close() {
            closed = true;
            clearTimeout(stall);
            if (pending) pending.cancel();
            if (link) link.close();
            if (hosting) {
                hosting.swarm.close();
                hosting.room.close();
            }
        }

        return {
            invite: () => code,
            trackers: () => (hosting ? hosting.swarm.up() : undefined),
            open(receive) {
                deliver = receive;
                return {
                    send(msg) {
                        if (!msg || typeof msg.t !== 'string' || closed) return;
                        if (msg.t === 'create') {
                            if (hello) return;
                            hello = msg;
                            meet(joinMs).then((result) => {
                                if (result.peer) attach(result);
                                else if (result.error !== 'closed') deliver({ t: 'error', code: result.error });
                            });
                        } else if (up && link) {
                            link.send(msg);
                        } else if (HELD.includes(msg.t)) {
                            held.set(msg.t, msg);
                        }
                    },
                    close,
                };
            },
            close,
        };
    }

    /**
     * The session's `tracker` transport. With no code this browser hosts: a
     * code party's host (party-host.js), whose guests arrive through the
     * swarm rather than by pasted reply, and whose invite is the tracker
     * code. With one it joins the room the code names.
     */
    function createTransport(options = {}) {
        const urls = trackerUrls(options.trackers);
        const net = {
            urls, iceServers: options.iceServers || PartyHost.DEFAULT_ICE,
            RTC: options.RTC, gatherMs: options.gatherMs, WebSocket: options.WebSocket, renewMs: options.renewMs,
        };
        if (options.code) {
            const secret = readCode(options.code);
            if (!secret) return null;
            return createGuest({
                secret, code: options.code.trim(), net, host: options, joinMs: options.joinMs, stallMs: options.stallMs,
                roomNow: options.roomNow || Date.now,
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
        PREFIX, SECRET_BYTES, OFFERS, DEFAULT_TRACKERS, INTERVAL_MIN_S, INTERVAL_MAX_S, RENEW_MS, RETRY_MS, JOIN_MS,
        RESTART_MS, DISCONNECT_MS, HELD, LABELS,
        newCode, readCode, trackerUrls, keysFor, seal, unseal, createSwarm, hostSwarm, joinSwarm, restartSwarm, createTransport,
    };

    root.BB = root.BB || {};
    root.BB.PartyTracker = PartyTracker;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyTracker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
