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

    function createLoopback({ policy = {}, now = PartyClock.localNow, mint, state, chat } = {}) {
        const links = new Map();
        /**
         * The room welcomes a member from inside join(), before join() has
         * returned the id that welcome is for. Everything it sends in that
         * moment is caught here and handed on once the id is known — all of
         * it, not only what has no link yet: a member resuming while its old
         * link is still registered used to have its welcome sent down the old
         * link, to a guest whose data channel was already gone.
         */
        let caught = null;
        const room = PartyRoom.createRoom({
            id: PartyRoom.mintRandom('p'), policy, mint, state, chat,
            send(id, msg) {
                if (caught) return caught.push({ id, msg });
                const link = links.get(id);
                if (link) link.deliver(msg);
            },
        });
        const ticker = setInterval(() => room.tick(now()), TICK_MS);

        function join(hello, entry) {
            caught = [];
            const result = room.join({ name: hello.name, resume: hello.resume }, now());
            const early = caught;
            caught = null;
            if (result.error) {
                entry.deliver({ t: 'error', code: result.error });
                return null;
            }
            // Resumed from another link: the newest one is the member now.
            const old = links.get(result.member);
            if (old && old !== entry) old.member = null;
            links.set(result.member, entry);
            for (const one of early) {
                const link = links.get(one.id);
                if (link) link.deliver(one.msg);
            }
            return result.member;
        }

        return {
            room,
            /** A link for one member; `deliver` receives what the room sends it. */
            open(deliver) {
                const entry = { deliver, member: null, joined: false };
                return {
                    send(msg) {
                        if (!msg || typeof msg.t !== 'string') return;
                        if (!entry.joined) {
                            if (msg.t !== 'create' && msg.t !== 'hello') return;
                            entry.member = join(msg, entry);
                            entry.joined = entry.member !== null;
                            return;
                        }
                        // Taken over by a resume on another link, or gone: nobody.
                        const from = entry.member;
                        if (from === null) return;
                        if (msg.t === 'bye') {
                            links.delete(from);
                            entry.member = null;
                        }
                        room.handle(from, msg, now());
                    },
                    /**
                     * Hung up without a bye. The member stays in the room and
                     * goes away by silence, so a `hello` with its resume token
                     * within the minute gets it back.
                     */
                    close() {
                        if (entry.member !== null && links.get(entry.member) === entry) links.delete(entry.member);
                        entry.member = null;
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
