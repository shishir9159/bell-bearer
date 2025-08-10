/**
 * Invite and reply codes against the browser's own WebRTC. The node suite
 * checks the codes and the binding on a fake peer connection; only a real
 * one shows that a description rebuilt from a code is one the browser will
 * connect with. Both ends are in this page, so only host candidates matter
 * and no STUN server is asked.
 */

suite('party webrtc: codes open a real connection', () => {
    const { PartyRtc, PartyCode } = window.BB;
    const room = new Uint8Array(6);

    test('an invite and its reply connect, bind, and carry messages both ways', async () => {
        const invite = await PartyRtc.createInvite({ room, iceServers: [] });
        const guest = await PartyRtc.acceptInvite(invite.code, { iceServers: [] });
        try {
            assert(invite.code.length < 200 && guest.reply.length < 200, `${invite.code.length} and ${guest.reply.length} characters`);
            const [hostPeer, guestPeer] = await Promise.all([invite.answer(PartyCode.readReply(guest.reply)), guest.bound]);
            assert(hostPeer && guestPeer, 'both ends bound');

            const heard = { host: [], guest: [] };
            const hostLink = PartyRtc.peerLink(hostPeer, { deliver: (msg) => heard.host.push(msg) });
            const guestLink = PartyRtc.peerLink(guestPeer, { deliver: (msg) => heard.guest.push(msg) });
            guestLink.send({ t: 'hello', v: 1, name: 'Ben' });
            guestLink.send({ t: 'ping', c: 1, seq: 0 });
            hostLink.send({ t: 'welcome', you: 'm2' });
            assert(await partyUntil(() => heard.host.length === 2 && heard.guest.length === 1), JSON.stringify(heard));
            assertDeepEqual(heard.host.map((msg) => msg.t).sort(), ['hello', 'ping']);
            assertEqual(heard.guest[0].you, 'm2');
        } finally {
            invite.close();
            guest.close();
        }
    });

    test('a link hears its peer hang up', async () => {
        const invite = await PartyRtc.createInvite({ room, iceServers: [] });
        const guest = await PartyRtc.acceptInvite(invite.code, { iceServers: [] });
        try {
            const [hostPeer] = await Promise.all([invite.answer(PartyCode.readReply(guest.reply)), guest.bound]);
            let down = false;
            PartyRtc.peerLink(hostPeer, { deliver: () => {}, onDown: () => { down = true; } });
            guest.close();
            assert(await partyUntil(() => down, 8000), `still ${hostPeer.pc.connectionState}`);
        } finally {
            invite.close();
        }
    });
});
