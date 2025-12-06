/**
 * The party's member: the one place that talks to the authority, and the one
 * the party tab's media adapter talks to.
 *
 * It lives in the offscreen document (Chrome) or the background page
 * (Firefox) rather than in the tab, because the tab is the part that goes
 * away — a reload, an episode that navigates, the user closing it by mistake
 * — and the room should not see a member leave and come back every time it
 * does. So the member is this session, and the tab is a port onto it: a new
 * port is handed the room as it stands, and whichever port connected last is
 * the one the party plays in.
 *
 * Two hops, one clock. The tab's `ping` is answered here, in room time, from
 * this session's own estimate of the authority's clock, and this session pings
 * the authority itself — so the tab's PartyClock measures straight through to
 * the room without either hop knowing about the other.
 *
 * The authority is reached through a transport, which only has to carry the
 * wire protocol's own messages. The first is the loopback (party-loopback.js):
 * the room in this same document, so the whole media path works with no
 * network at all.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyClock = ns.PartyClock || req('../shared/party-clock.js');
    const PartyRoom = ns.PartyRoom || req('../shared/party-room.js');
    const PartyLoopback = ns.PartyLoopback || req('./party-loopback.js');

    const PORT = 'bb:party';
    /**
     * The clock's paused cadence is fifteen seconds, and so is the room's
     * away threshold: a heartbeat on the dot, a few milliseconds late, marked
     * this member away on every other beat — and a host marked away hands the
     * room over. So the heartbeat never waits more than half the threshold.
     */
    const HEARTBEAT_MAX_MS = PartyRoom.AWAY_MS / 2;
    /** What the tab may say to the room. Leaving, kicking and policy come from the UI, through the worker. */
    const FROM_TAB = Object.freeze(['intent', 'ready', 'solo', 'request']);

    function createSession({ transports = { loopback: PartyLoopback.createLoopback }, now = PartyClock.localNow } = {}) {
        const clock = PartyClock.createClock();
        /** Everything about the party we are in, or null. */
        let party = null;
        let port = null;
        /** Why the last party ended: the authority's error code, or null for leaving. */
        let endedWith = null;

        function post(msg) {
            if (!port) return;
            try { port.postMessage(msg); } catch (_) { letGo(false); }
        }

        /**
         * The tab goes: it reloaded, navigated, closed, or another tab took
         * the party over. Left as it last said, a tab that was buffering
         * would hold the room until the hold timed out, and one that was
         * solo would stay out of step — but the next document starts ready
         * and in the room, so the member does too.
         */
        function letGo(tell) {
            const old = port;
            port = null;
            if (!old) return;
            if (tell) {
                try {
                    old.postMessage({ t: 'detach' });
                    old.disconnect();
                } catch (_) { /* already gone */ }
            }
            if (!party) return;
            if (!party.ready) {
                party.ready = true;
                party.link.send({ t: 'ready', ready: true });
            }
            if (party.solo) {
                party.solo = false;
                party.link.send({ t: 'solo', solo: false });
            }
        }

        const welcomeFor = () => ({
            t: 'welcome', v: PartyRoom.VERSION, you: party.me, now: clock.toRoom(now()),
            room: { id: party.roomId, policy: party.policy, members: party.members, state: party.state },
        });

        function fromAuthority(msg) {
            if (!party || !msg || typeof msg.t !== 'string') return;
            switch (msg.t) {
                case 'welcome':
                    Object.assign(party, {
                        me: msg.you, resume: msg.resume, roomId: msg.room.id,
                        policy: msg.room.policy, members: msg.room.members, state: msg.room.state,
                    });
                    break;
                case 'state': {
                    if (party.state && msg.seq < party.state.seq) return;
                    const { t, ack, ...state } = msg;
                    party.state = state;
                    break;
                }
                case 'members': party.members = msg.list; break;
                case 'policy': party.policy = { control: msg.control, wait: msg.wait, locked: msg.locked }; break;
                case 'pong':
                    // Our own hop to the authority. The tab's pong is made below.
                    clock.add(msg, now());
                    return;
                case 'error':
                    post(msg);
                    end(msg.code);
                    return;
                default: break;
            }
            post(msg);
        }

        function fromTab(from, msg) {
            if (from !== port || !party || !msg || typeof msg.t !== 'string') return;
            if (msg.t === 'ping') {
                const s = clock.toRoom(now());
                post({ t: 'pong', c: msg.c, s, s2: s });
                if (party.state && msg.seq !== party.state.seq) post({ t: 'state', ...party.state });
                return;
            }
            if (!FROM_TAB.includes(msg.t)) return;
            if (msg.t === 'ready') party.ready = msg.ready !== false;
            if (msg.t === 'solo') party.solo = msg.solo === true;
            party.link.send(msg);
        }

        function connect(incoming) {
            if (!incoming || incoming.name !== PORT) return;
            // Not in a party: the tab's adapter detaches when its port does.
            if (!party) {
                incoming.disconnect();
                return;
            }
            letGo(true);
            port = incoming;
            incoming.onMessage.addListener((msg) => fromTab(incoming, msg));
            incoming.onDisconnect.addListener(() => { if (port === incoming) letGo(false); });
            if (party.me) post(welcomeFor());
        }

        function heartbeat(burst) {
            if (!party) return;
            const rtt = clock.rtt();
            party.link.send({ t: 'ping', c: now(), seq: party.state ? party.state.seq : 0, rtt: rtt === null ? undefined : Math.round(rtt) });
            const delay = burst > 0 ? PartyClock.BURST_GAP_MS
                : Math.min(HEARTBEAT_MAX_MS, PartyClock.pingDelay({ paused: !party.state || party.state.paused }));
            party.pingTimer = setTimeout(() => heartbeat(burst - 1), delay);
        }

        function start({ mode = 'loopback', name, policy } = {}) {
            // Already in one: the worker is moving the party to another tab.
            if (party) return { ok: true, status: status() };
            const make = transports[mode];
            if (!make) return { ok: false, error: 'mode' };
            const transport = make({ policy, now });
            party = { mode, transport, link: null, me: null, roomId: null, resume: null, state: null, members: [], policy: null, ready: true, solo: false, pingTimer: null };
            clock.reset();
            party.link = transport.open(fromAuthority);
            party.link.send({ t: 'create', v: PartyRoom.VERSION, name, policy });
            // Refused on the spot (a loopback answers inside that send).
            if (!party) return { ok: false, error: endedWith };
            heartbeat(PartyClock.BURST - 1);
            return { ok: true, status: status() };
        }

        function end(code) {
            if (!party) return;
            const { transport, link, pingTimer } = party;
            party = null;
            clearTimeout(pingTimer);
            link.close();
            transport.close();
            letGo(true);
            endedWith = code || null;
        }

        function leave() {
            if (!party) return;
            party.link.send({ t: 'bye' });
            end(null);
        }

        function status() {
            if (!party) return { active: false };
            return {
                active: true, mode: party.mode, you: party.me, room: party.roomId, members: party.members,
                policy: party.policy, state: party.state, rtt: clock.rtt(), tab: !!port,
            };
        }

        async function control(msg) {
            switch (msg && msg.op) {
                case 'start': return start(msg);
                case 'leave':
                    leave();
                    return { ok: true };
                case 'status': return { ok: true, status: status() };
                default: return { ok: false, error: 'op' };
            }
        }

        return { connect, control, status };
    }

    const PartySession = { PORT, HEARTBEAT_MAX_MS, FROM_TAB, createSession };

    root.BB = root.BB || {};
    root.BB.PartySession = PartySession;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartySession;
})(typeof globalThis !== 'undefined' ? globalThis : this);
