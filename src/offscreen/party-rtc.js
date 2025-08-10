/**
 * A party member reached over WebRTC: the connection an invite code opens,
 * and the link the room's messages travel on once it is open.
 *
 * Signaling is whatever carried the codes — a chat message (manual codes) or
 * a tracker (party-tracker.js) — so this never trickles: it waits for ICE
 * gathering to finish, or GATHER_MS, and puts every address into the one
 * description the code is made from. The data channels are negotiated (fixed
 * ids on both sides) so nothing has to be announced in-band before they open.
 *
 * Two channels, because pings and everything else want opposite things:
 *
 * - `ctl` is reliable and ordered, for intents, state and membership.
 * - `tick` is unordered with no retransmits, for pings. A ping that is late
 *   is useless, and one retransmitted inflates the RTT it measures and holds
 *   up the ordered channel behind it.
 *
 * Before either carries the room, the two ends bind the channel to the codes:
 * each sends a nonce and proves the invite's secret over the other's nonce and
 * both DTLS fingerprints. The reply's MAC already shows the guest read the
 * invite; this shows that the browser at the other end of the encrypted
 * session is the one that holds those codes, and not something that spliced
 * itself in with certificates of its own.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyCode = ns.PartyCode || req('../shared/party-code.js');

    const CTL = Object.freeze({ negotiated: true, id: 0, ordered: true });
    const TICK = Object.freeze({ negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    const GATHER_MS = 2500;
    /** How long an invite waits for its reply. Its ports are only held that long. */
    const INVITE_MS = 10 * 60 * 1000;
    /**
     * The expiry in an invite is the host's clock and the check is the
     * guest's, on another machine; a minute of slack keeps a clock that is a
     * little off from refusing an invite that is still being held open.
     */
    const SKEW_MS = 60 * 1000;
    /** From the answer being set to the channel open and bound. */
    const CONNECT_MS = 20000;
    const MAX_FRAME = 8192;
    const BIND_LABEL = new TextEncoder().encode('bb-party/bind');
    /** Carried on `tick`; everything else goes on `ctl`. */
    const TICKS = Object.freeze(['ping', 'pong']);

    /**
     * RTCIceServers from the settings' two strings: STUN addresses, and TURN
     * ones written turn:user:pass@host:port. An ICE url cannot carry a user,
     * so the credentials are taken out of it; anything else is dropped.
     */
    function iceServers({ stun = '', turn = '' } = {}) {
        const words = (text) => String(text || '').split(/\s+/).filter(Boolean);
        const stuns = words(stun).filter((url) => /^stuns?:[^\s@]+$/.test(url));
        const turns = words(turn).map((url) => url.match(/^(turns?):(?:([^:@]+):([^@]+)@)?([^@]+)$/)).filter(Boolean)
            .map(([, scheme, username, credential, rest]) => ({ urls: `${scheme}:${rest}`, ...(username ? { username, credential } : {}) }));
        return [...(stuns.length ? [{ urls: stuns }] : []), ...turns];
    }

    /**
     * What our own gathered description says about the NAT in front of us.
     * Each STUN server reports the public address and port it saw us from;
     * a NAT that gives every destination a port of its own (symmetric) shows
     * one address with two ports, and a peer cannot punch through to a port
     * it never learns. Chrome drops a candidate that repeats one it has, so
     * a well-behaved NAT shows one port however many servers were asked.
     *
     * 'symmetric', 'consistent', 'blocked' (no server answered: UDP is
     * filtered, and only a TURN relay over TCP will do), or 'unknown' with
     * fewer than two STUN servers to compare.
     */
    function natOf(desc, servers = []) {
        const stuns = servers.flatMap((one) => [].concat(one.urls)).filter((url) => /^stuns?:/.test(url)).length;
        const ports = new Map();
        for (const c of desc.candidates) {
            if (c.type === 'srflx') ports.set(c.address, new Set([...(ports.get(c.address) || []), c.port]));
        }
        if (!ports.size) return stuns ? 'blocked' : 'unknown';
        if ([...ports.values()].some((set) => set.size > 1)) return 'symmetric';
        return stuns >= 2 ? 'consistent' : 'unknown';
    }

    function openPeer({ iceServers = [], RTC = root.RTCPeerConnection } = {}) {
        const pc = new RTC({ iceServers });
        return { pc, ctl: pc.createDataChannel('ctl', CTL), tick: pc.createDataChannel('tick', TICK) };
    }

    /** Resolves once ICE has gathered, or after `ms`, whichever is first. */
    function gather(pc, ms = GATHER_MS) {
        return new Promise((resolve) => {
            if (pc.iceGatheringState === 'complete') return resolve();
            const timer = setTimeout(done, ms);
            function done() {
                clearTimeout(timer);
                pc.removeEventListener('icegatheringstatechange', check);
                resolve();
            }
            function check() { if (pc.iceGatheringState === 'complete') done(); }
            pc.addEventListener('icegatheringstatechange', check);
        });
    }

    /** Our own description, set as the browser made it, gathered, and reduced to what a code carries. */
    async function describeLocal(pc, ms) {
        await pc.setLocalDescription();
        await gather(pc, ms);
        const desc = PartyCode.parseSdp(pc.localDescription.sdp);
        if (!desc) throw new Error('no usable local description');
        return desc;
    }

    const concat = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part]));

    /** Resolves true once `ctl` is open and both ends have proven the secret; false on anything else. */
    function bind(peer, { secret, hostFp, guestFp, timeoutMs = CONNECT_MS }) {
        const { pc, ctl } = peer;
        return new Promise((resolve) => {
            const mine = PartyCode.randomBytes(16);
            const proof = (nonce) => PartyCode.hmac(secret, concat(BIND_LABEL, nonce, hostFp, guestFp));
            let sentProof = false;
            let theirsOk = false;
            let settled = false;
            const timer = setTimeout(() => finish(false), timeoutMs);

            function finish(ok) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                // The other end may speak the moment it is bound, before
                // whoever awaits this has put a link on the channel.
                peer.early = [];
                ctl.onmessage = peer.tick.onmessage = ok ? (event) => peer.early.push(event) : null;
                pc.removeEventListener('connectionstatechange', watch);
                resolve(ok);
            }
            function watch() { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') finish(false); }
            const say = (msg) => { try { ctl.send(JSON.stringify(msg)); } catch (_) { finish(false); } };
            function open() { say({ t: 'bind', n: PartyCode.toBase64Url(mine) }); }

            ctl.onmessage = async (event) => {
                let msg;
                try { msg = JSON.parse(event.data); } catch (_) { return finish(false); }
                if (msg && msg.t === 'bind' && !sentProof) {
                    const nonce = PartyCode.fromBase64Url(String(msg.n || ''));
                    if (!nonce || nonce.length !== 16) return finish(false);
                    sentProof = true;
                    say({ t: 'proof', m: PartyCode.toBase64Url(await proof(nonce)) });
                } else if (msg && msg.t === 'proof' && !theirsOk) {
                    const theirs = PartyCode.fromBase64Url(String(msg.m || ''));
                    if (!theirs || !PartyCode.sameBytes(theirs, await proof(mine))) return finish(false);
                    theirsOk = true;
                } else {
                    return finish(false);
                }
                if (sentProof && theirsOk) finish(true);
            };
            pc.addEventListener('connectionstatechange', watch);
            if (ctl.readyState === 'open') open();
            else ctl.onopen = open;
        });
    }

    // The three steps of one exchange, whatever carries the descriptions:
    // an invite code and its reply, or sealed blobs through a tracker.

    /** A new peer and its offer, gathered and reduced. */
    async function makeOffer({ iceServers, RTC, gatherMs } = {}) {
        const peer = openPeer({ iceServers, RTC });
        try {
            return { peer, desc: await describeLocal(peer.pc, gatherMs) };
        } catch (error) {
            peer.pc.close();
            throw error;
        }
    }

    /** A new peer answering someone's offer, or null if the browser will not take it. */
    async function makeAnswer(remote, { iceServers, RTC, gatherMs } = {}) {
        const peer = openPeer({ iceServers, RTC });
        try {
            await peer.pc.setRemoteDescription({ type: 'offer', sdp: PartyCode.buildSdp(remote, { type: 'offer' }) });
            return { peer, desc: await describeLocal(peer.pc, gatherMs) };
        } catch (_) {
            peer.pc.close();
            return null;
        }
    }

    /** Our offer's answer, applied; false (and the peer closed) if the browser will not take it. */
    async function takeAnswer(peer, local, remote) {
        try {
            await peer.pc.setRemoteDescription({ type: 'answer', sdp: PartyCode.buildSdp(remote, { type: 'answer', mid: local.mid }) });
            return true;
        } catch (_) {
            peer.pc.close();
            return false;
        }
    }

    /**
     * The host's side of one guest: an offer, gathered, as a code. `answer`
     * takes that guest's reply, decoded, and resolves with the bound peer, or
     * null for a reply to another invite, a forged one, or a connection that
     * never came up.
     */
    async function createInvite({ room, iceServers, RTC, gatherMs, now = Date.now } = {}) {
        const { peer, desc } = await makeOffer({ iceServers, RTC, gatherMs });
        const tag = PartyCode.randomBytes(PartyCode.TAG_BYTES);
        const secret = PartyCode.randomBytes(PartyCode.SECRET_BYTES);
        let used = false;
        const expires = now() + INVITE_MS;
        return {
            code: PartyCode.inviteCode({ tag, desc, room, secret, expires }),
            tag, desc, expires,
            /** Whether this reply is for this invite. The MAC is checked by answer(). */
            fits: (reply) => PartyCode.sameBytes(reply.tag, tag),
            async answer(reply) {
                if (used || !PartyCode.sameBytes(reply.tag, tag) || !(await PartyCode.verifyReply(reply, secret))) return null;
                used = true;
                if (!(await takeAnswer(peer, desc, reply.desc))) return null;
                if (await bind(peer, { secret, hostFp: desc.fingerprint, guestFp: reply.desc.fingerprint })) return peer;
                peer.pc.close();
                return null;
            },
            close: () => peer.pc.close(),
        };
    }

    /**
     * The guest's side: take the invite, answer it, and hand back the reply
     * code for the user to send. `bound` resolves with the peer once the host
     * has applied the reply, or null. Null straight away for a code that is
     * not an invite, or {expired} for one the host has already let go of.
     */
    async function acceptInvite(code, { iceServers, RTC, gatherMs, now = Date.now } = {}) {
        const invite = PartyCode.readInvite(code);
        if (!invite) return null;
        const left = invite.expires + SKEW_MS - now();
        if (left <= 0) return { expired: true };
        const answered = await makeAnswer(invite.desc, { iceServers, RTC, gatherMs });
        if (!answered) return null;
        const { peer, desc } = answered;
        const reply = await PartyCode.replyCode({ tag: invite.tag, desc }, invite.secret);
        const bound = bind(peer, { secret: invite.secret, hostFp: invite.desc.fingerprint, guestFp: desc.fingerprint, timeoutMs: Math.min(left, INVITE_MS + SKEW_MS) })
            .then((ok) => {
                if (ok) return peer;
                peer.pc.close();
                return null;
            });
        return { reply, room: invite.room, expires: invite.expires, desc, peer, bound, close: () => peer.pc.close() };
    }

    /**
     * A bound peer as a link: wire messages in and out, as JSON. `onDown`
     * hears once that the connection is gone for good — failed, closed, or
     * its control channel shut — and `onState` every connection state
     * before that, for a transport that can restart ICE on 'disconnected'.
     */
    function peerLink(peer, { deliver, onDown = () => {}, onState = () => {} }) {
        const { pc, ctl, tick } = peer;
        let down = false;

        function receive(event) {
            let msg;
            try { msg = JSON.parse(event.data); } catch (_) { return; }
            if (msg && typeof msg === 'object' && typeof msg.t === 'string') deliver(msg);
        }
        function gone() {
            if (down) return;
            down = true;
            ctl.onmessage = tick.onmessage = ctl.onclose = null;
            pc.removeEventListener('connectionstatechange', watch);
            onDown();
        }
        function watch() {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') gone();
            else onState(pc.connectionState);
        }

        ctl.onmessage = receive;
        tick.onmessage = receive;
        for (const event of peer.early || []) receive(event);
        peer.early = [];
        ctl.onclose = gone;
        pc.addEventListener('connectionstatechange', watch);

        return {
            send(msg) {
                if (down || !msg || typeof msg.t !== 'string') return;
                const text = JSON.stringify(msg);
                if (text.length > MAX_FRAME) return;
                const channel = TICKS.includes(msg.t) && tick.readyState === 'open' ? tick : ctl;
                try { channel.send(text); } catch (_) { /* closing; onclose follows */ }
            },
            close() {
                gone();
                pc.close();
            },
            state: () => pc.connectionState,
        };
    }

    const PartyRtc = {
        CTL, TICK, GATHER_MS, INVITE_MS, SKEW_MS, CONNECT_MS, MAX_FRAME, TICKS,
        iceServers, natOf, openPeer, gather, describeLocal, bind,
        makeOffer, makeAnswer, takeAnswer, createInvite, acceptInvite, peerLink,
    };

    root.BB = root.BB || {};
    root.BB.PartyRtc = PartyRtc;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyRtc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
