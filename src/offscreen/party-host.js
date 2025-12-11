/**
 * A peer-to-peer party: the host's browser is the party server.
 *
 * The room runs here, in the host's offscreen document, behind a loopback
 * (party-loopback.js). The host's own session is one link on it, and each
 * guest's data channel is another: whatever a guest says arrives on its
 * channel and goes into the room as that guest's, and whatever the room says
 * to the guest goes back down the channel. So the room cannot tell a guest
 * from the host, and the guest's session cannot tell this from a server —
 * it is the same wire protocol end to end.
 *
 * The loopback trusts whoever opens a link, so a guest only gets one once
 * its channel is bound to an invite (party-rtc.js): the reply was signed with
 * that invite's secret, and the channel proved it again.
 *
 * Each invite is one guest. Its peer connection holds the ports the code
 * names, so an invite nobody answers is closed after INVITE_MS rather than
 * kept open all evening.
 *
 * The guest's side is here too: it answers the invite and says hello on the
 * channel, and from then on is an ordinary member of a room it cannot see.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyCode = ns.PartyCode || req('../shared/party-code.js');
    const PartyLoopback = ns.PartyLoopback || req('./party-loopback.js');
    const PartyRtc = ns.PartyRtc || req('./party-rtc.js');

    /** For a start that names none; the worker passes the settings'. Two providers, so one being down is not the party's problem. */
    const DEFAULT_ICE = Object.freeze([{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]);

    function createHost({
        policy, now, iceServers = DEFAULT_ICE, RTC, gatherMs, inviteMs = PartyRtc.INVITE_MS,
    } = {}) {
        const loop = PartyLoopback.createLoopback({ policy, now });
        const room = PartyCode.randomBytes(PartyCode.ROOM_BYTES);
        /** Invites not yet answered, newest last. */
        const pending = [];
        const guests = new Set();
        /** What the last invite's gathering said about our NAT; see PartyRtc.natOf. */
        let nat = null;
        let closed = false;
        const view = (invite) => ({ code: invite.code, expires: invite.expires, addresses: PartyCode.describe(invite.desc), nat: invite.nat });

        function forget(invite) {
            const at = pending.indexOf(invite);
            if (at >= 0) pending.splice(at, 1);
            clearTimeout(invite.timer);
        }

        /** A bound peer becomes one more member's link on the room. */
        function admit(peer) {
            // The room says nothing to a link before its hello, so the guest
            // link it sends to is there by the time it does; the other way
            // round, the peer's first words (drained as the link is made)
            // would reach a member link that did not exist yet.
            let guest = null;
            const member = loop.open((msg) => guest.send(msg));
            guest = PartyRtc.peerLink(peer, {
                deliver: (msg) => member.send(msg),
                // Gone without a bye: the member stays, away by silence.
                onDown: () => {
                    member.close();
                    guests.delete(guest);
                },
            });
            guests.add(guest);
        }

        return {
            /** The host's own link. */
            open: (deliver) => loop.open(deliver),

            /**
             * A new invite for one more guest: {code, expires, addresses, nat}.
             * A 'symmetric' or 'blocked' nat is the one to warn about before
             * the code is sent: without a TURN server, or a party server,
             * the guest will most likely never get through.
             */
            async createInvite() {
                if (closed) return null;
                const invite = await PartyRtc.createInvite({ room, iceServers, RTC, gatherMs });
                if (closed) {
                    invite.close();
                    return null;
                }
                invite.nat = PartyRtc.natOf(invite.desc, iceServers);
                nat = invite.nat;
                invite.timer = setTimeout(() => {
                    forget(invite);
                    invite.close();
                }, inviteMs);
                pending.push(invite);
                return view(invite);
            },

            /**
             * A guest's reply, pasted in by the host. Resolves {ok} once the
             * guest's channel is bound and in the room, or {ok:false, error}:
             * `code` for something that is not a reply, `unknown` for a reply
             * to no invite still open here, `refused` for one that did not
             * verify or never connected.
             */
            async accept(code) {
                const reply = PartyCode.readReply(code);
                if (!reply) return { ok: false, error: 'code' };
                const invite = pending.find((one) => one.fits(reply));
                if (!invite) return { ok: false, error: 'unknown' };
                const peer = await invite.answer(reply);
                if (!peer) return { ok: false, error: 'refused' };
                forget(invite);
                if (closed) {
                    peer.pc.close();
                    return { ok: false, error: 'closed' };
                }
                admit(peer);
                return { ok: true };
            },

            pending: () => pending.map(view),
            nat: () => nat,
            guests: () => guests.size,

            close() {
                closed = true;
                for (const invite of [...pending]) {
                    forget(invite);
                    invite.close();
                }
                for (const guest of [...guests]) guest.close();
                loop.close();
            },
        };
    }

    /**
     * A guest's side of a code party. The invite is answered at once, and
     * the reply is what the user sends back to the host (`invite()`, as a
     * server party's code is). Until the host pastes it in there is no
     * authority to be welcomed by, so the session is told it is waiting — a
     * start that held out for the welcome would never hand the user the
     * reply the welcome depends on.
     */
    function createGuest({ code, iceServers = DEFAULT_ICE, RTC, gatherMs } = {}) {
        if (!PartyCode.readInvite(code)) return null;
        let deliver = () => {};
        let accepted = null;
        let link = null;
        let asked = false;
        let closed = false;

        async function answer(create) {
            try {
                accepted = await PartyRtc.acceptInvite(code, { iceServers, RTC, gatherMs });
            } catch (_) {
                accepted = null;
            }
            if (closed) return accepted && accepted.close();
            if (!accepted) return deliver({ t: 'error', code: 'invite' });
            deliver({ t: 'link', up: false, waiting: true });
            const peer = await accepted.bound;
            if (closed) return null;
            if (!peer) return deliver({ t: 'error', code: 'expired' });
            link = PartyRtc.peerLink(peer, {
                deliver: (msg) => deliver(msg),
                // There is no way back to a host that has gone without a new
                // invite, so the party ends here and the video plays on solo.
                onDown: () => { if (!closed) deliver({ t: 'error', code: 'host-left' }); },
            });
            link.send({ t: 'hello', v: create.v, name: create.name });
            return null;
        }

        function close() {
            closed = true;
            if (link) link.close();
            else if (accepted) accepted.close();
        }

        return {
            invite: () => (accepted ? accepted.reply : null),
            nat: () => (accepted ? PartyRtc.natOf(accepted.desc, iceServers) : null),
            open(receive) {
                deliver = receive;
                return {
                    send(msg) {
                        if (!msg || typeof msg.t !== 'string' || closed) return;
                        if (msg.t === 'create') {
                            if (asked) return;
                            asked = true;
                            answer(msg);
                        } else if (link) {
                            link.send(msg);
                        }
                    },
                    close,
                };
            },
            close,
        };
    }

    /** The session's `codes` transport: an invite to answer makes a guest, none makes a host. */
    const createTransport = (options = {}) => (options.code ? createGuest(options) : createHost(options));

    const PartyHost = { DEFAULT_ICE, createHost, createGuest, createTransport };

    root.BB = root.BB || {};
    root.BB.PartyHost = PartyHost;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyHost;
})(typeof globalThis !== 'undefined' ? globalThis : this);
