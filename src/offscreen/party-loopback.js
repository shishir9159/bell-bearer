/**
 * The party's authority, reached without a network: the room itself, in this
 * document, behind the same link a WebSocket or a data channel will offer.
 *
 * A link carries the wire protocol's own messages both ways. The first thing
 * sent on one is `create` or `hello`, which joins the room; everything after
 * it is handed to the room as that member's. So the session above it cannot
 * tell this from a server, and a peer-to-peer host later opens one link here
 * for itself and one per guest's data channel — the room does not care where
 * its members are.
 *
 * Nothing is authenticated here. There is no secret to check in a room nobody
 * else can reach; a transport that lets guests in checks them before it opens
 * their link.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyClock = ns.PartyClock || req('../shared/party-clock.js');
    const PartyRoom = ns.PartyRoom || req('../shared/party-room.js');

    /** How often the room's timeouts run: away, removal, a hold that has waited long enough. */
    const TICK_MS = 1000;

    function createLoopback({ policy = {}, now = PartyClock.localNow, mint } = {}) {
        const links = new Map();
        /**
         * The room welcomes a member from inside join(), before join() has
         * returned the id that welcome is for. What it sends in that moment
         * is caught here and handed over once the id is known.
         */
        let caught = null;
        const room = PartyRoom.createRoom({
            id: PartyRoom.mintRandom('p'), policy, mint,
            send(id, msg) {
                const deliver = links.get(id);
                if (deliver) deliver(msg);
                else if (caught) caught.push({ id, msg });
            },
        });
        const ticker = setInterval(() => room.tick(now()), TICK_MS);

        function join(hello, deliver) {
            caught = [];
            const result = room.join({ name: hello.name, resume: hello.resume }, now());
            const early = caught;
            caught = null;
            if (result.error) {
                deliver({ t: 'error', code: result.error });
                return null;
            }
            links.set(result.member, deliver);
            for (const one of early) if (one.id === result.member) deliver(one.msg);
            return result.member;
        }

        return {
            room,
            /** A link for one member; `deliver` receives what the room sends it. */
            open(deliver) {
                let member = null;
                return {
                    send(msg) {
                        if (!msg || typeof msg.t !== 'string') return;
                        if (member === null) {
                            if (msg.t === 'create' || msg.t === 'hello') member = join(msg, deliver);
                            return;
                        }
                        const from = member;
                        if (msg.t === 'bye') {
                            links.delete(from);
                            member = null;
                        }
                        room.handle(from, msg, now());
                    },
                    /**
                     * Hung up without a bye. The member stays in the room and
                     * goes away by silence, so a `hello` with its resume token
                     * within the minute gets it back.
                     */
                    close() {
                        if (member !== null) links.delete(member);
                        member = null;
                    },
                };
            },
            close() {
                clearInterval(ticker);
                links.clear();
            },
        };
    }

    const PartyLoopback = { TICK_MS, createLoopback };

    root.BB = root.BB || {};
    root.BB.PartyLoopback = PartyLoopback;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyLoopback;
})(typeof globalThis !== 'undefined' ? globalThis : this);
