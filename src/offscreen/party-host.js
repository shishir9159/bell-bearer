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
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyCode = ns.PartyCode || req('../shared/party-code.js');
    const PartyLoopback = ns.PartyLoopback || req('./party-loopback.js');
    const PartyRtc = ns.PartyRtc || req('./party-rtc.js');

    /** Until the settings carry their own: two providers, so one being down is not the party's problem. */
    const DEFAULT_ICE = Object.freeze([{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]);

    function createHost({
        policy, now, iceServers = DEFAULT_ICE, RTC, gatherMs, inviteMs = PartyRtc.INVITE_MS,
    } = {}) {
        const loop = PartyLoopback.createLoopback({ policy, now });
        const room = PartyCode.randomBytes(PartyCode.ROOM_BYTES);
        /** Invites not yet answered, newest last. */
        const pending = [];
        const guests = new Set();
        let closed = false;

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

            /** A new invite for one more guest: {code, expires, addresses}. */
            async createInvite() {
                if (closed) return null;
                const invite = await PartyRtc.createInvite({ room, iceServers, RTC, gatherMs });
                if (closed) {
                    invite.close();
                    return null;
                }
                invite.timer = setTimeout(() => {
                    forget(invite);
                    invite.close();
                }, inviteMs);
                pending.push(invite);
                return { code: invite.code, expires: invite.expires, addresses: PartyCode.describe(invite.desc) };
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

            pending: () => pending.map((one) => ({ code: one.code, expires: one.expires, addresses: PartyCode.describe(one.desc) })),
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

    const PartyHost = { DEFAULT_ICE, createHost };

    root.BB = root.BB || {};
    root.BB.PartyHost = PartyHost;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyHost;
})(typeof globalThis !== 'undefined' ? globalThis : this);
