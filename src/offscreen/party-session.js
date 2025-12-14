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
 * wire protocol's own messages: the loopback (party-loopback.js), the room in
 * this same document, a party server over a WebSocket (party-ws.js), or the
 * room this browser hosts for guests on data channels (party-host.js), who
 * found it by code or through a tracker (party-tracker.js).
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyClock = ns.PartyClock || req('../shared/party-clock.js');
    const PartyRoom = ns.PartyRoom || req('../shared/party-room.js');
    const PartyLoopback = ns.PartyLoopback || req('./party-loopback.js');
    const PartyWs = ns.PartyWs || req('./party-ws.js');
    const PartyRtc = ns.PartyRtc || req('./party-rtc.js');
    const PartyHost = ns.PartyHost || req('./party-host.js');
    const PartyTracker = ns.PartyTracker || req('./party-tracker.js');

    const PORT = 'bb:party';
    /** Runtime messages with this `to` are the session's. Only the worker sends them. */
    const TARGET = 'bb:party-session';
    /**
     * The clock's paused cadence is fifteen seconds, and so is the room's
     * away threshold: a heartbeat on the dot, a few milliseconds late, marked
     * this member away on every other beat — and a host marked away hands the
     * room over. So the heartbeat never waits more than half the threshold.
     */
    const HEARTBEAT_MAX_MS = PartyRoom.AWAY_MS / 2;
    /** What the tab may say to the room. Leaving, kicking and policy come from the UI, through the worker. */
    const FROM_TAB = Object.freeze(['intent', 'ready', 'solo', 'request']);
    /**
     * The host's controls, as the worker passes them on from the popup. Only
     * the named fields go to the room; which member may use them is the
     * authority's to decide, and a guest's are dropped there.
     */
    const HOST_OPS = Object.freeze({
        policy: ({ control, wait, locked }) => ({ t: 'policy', control, wait, locked }),
        role: ({ member, role }) => ({ t: 'role', member, role }),
        kick: ({ member }) => ({ t: 'kick', member }),
    });

    const TRANSPORTS = Object.freeze({
        loopback: PartyLoopback.createLoopback, server: PartyWs.createTransport, codes: PartyHost.createTransport,
        tracker: PartyTracker.createTransport,
    });

    /** `onEnd(code)` hears of a party the authority ended; one this browser left, or never got into, it does not. */
    function createSession({ transports = TRANSPORTS, now = PartyClock.localNow, keepAliveMs = 0, onEnd = null } = {}) {
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
                        me: msg.you, resume: msg.resume, roomId: msg.room.id, up: true,
                        policy: msg.room.policy, members: msg.room.members, state: msg.room.state,
                    });
                    party.joined();
                    // Welcomed after the start returned: a guest the host let in.
                    if (party.started) beat();
                    break;
                // The transport's own word that the authority is out of reach
                // for now; the next welcome is it back. `waiting` is one that
                // cannot be reached until the user does something — hands a
                // code over — so the start returns rather than wait on them.
                case 'link':
                    party.up = msg.up !== false;
                    if (msg.waiting) party.joined();
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
                // With no sample of the authority's clock yet, room time is
                // only our own; a pong made from it would be kept by the tab's
                // clock as its best sample, at the smallest RTT there is.
                if (clock.rtt() === null) return;
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
            // Where the session lives in a page that unloads when idle, the tab's
            // pings are what keep it: see PartyWorker.pageHost.
            if (keepAliveMs) post({ t: 'keepalive', ms: keepAliveMs });
        }

        function beat() {
            if (party.beating) return;
            party.beating = true;
            heartbeat(PartyClock.BURST - 1);
        }

        function heartbeat(burst) {
            if (!party) return;
            const rtt = clock.rtt();
            party.link.send({ t: 'ping', c: now(), seq: party.state ? party.state.seq : 0, rtt: rtt === null ? undefined : Math.round(rtt) });
            const delay = burst > 0 ? PartyClock.BURST_GAP_MS
                : Math.min(HEARTBEAT_MAX_MS, PartyClock.pingDelay({ paused: !party.state || party.state.paused }));
            party.pingTimer = setTimeout(() => heartbeat(burst - 1), delay);
        }

        /** `url` starts a room on that server and `code` joins the one it names; the loopback needs neither. */
        /** `ice` is the settings' {stun, turn} strings, and `trackers` theirs, for a peer-to-peer party. */
        async function start({ mode = 'loopback', name, policy, url, code, ice, trackers } = {}) {
            // Already in one: the worker is moving the party to another tab.
            if (party) return { ok: true, status: status() };
            const make = transports[mode];
            if (!make) return { ok: false, error: 'mode' };
            const transport = make({
                policy, now, url, code, trackers,
                iceServers: ice ? PartyRtc.iceServers(ice) : undefined,
                // A transport that may have to host the room itself needs to know where it had got to.
                roomNow: () => clock.toRoom(now()),
            });
            if (!transport) return { ok: false, error: 'address' };
            const mine = { mode, transport, link: null, me: null, roomId: null, resume: null, state: null, members: [], policy: null, ready: true, solo: false, up: false, pingTimer: null, beating: false, started: false };
            // A loopback welcomes inside the send below; a socket, some time later.
            const joined = new Promise((resolve) => { mine.joined = resolve; });
            party = mine;
            clock.reset();
            party.link = transport.open(fromAuthority);
            party.link.send({ t: 'create', v: PartyRoom.VERSION, name, policy });
            await joined;
            if (party !== mine) return { ok: false, error: endedWith };
            party.started = true;
            if (party.me) beat();
            return { ok: true, status: status() };
        }

        function end(code) {
            if (!party) return;
            const { transport, link, pingTimer, joined, started } = party;
            party = null;
            joined();
            clearTimeout(pingTimer);
            link.close();
            transport.close();
            letGo(true);
            endedWith = code || null;
            // A start that failed is answered as one; only a party that was on needs telling about.
            if (code && started && onEnd) onEnd(code);
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
                policy: party.policy, state: party.state, rtt: clock.rtt(), tab: !!port, up: party.up,
                invite: party.transport.invite ? party.transport.invite() : null,
                invites: party.transport.pending ? party.transport.pending() : undefined,
                nat: party.transport.nat ? party.transport.nat() : undefined,
                trackers: party.transport.trackers ? party.transport.trackers() : undefined,
            };
        }

        async function control(msg) {
            switch (msg && msg.op) {
                case 'start': return start(msg);
                case 'leave':
                    leave();
                    return { ok: true };
                case 'status': return { ok: true, status: status() };
                // A peer-to-peer host's invites: one per guest, made on demand.
                case 'invite': {
                    if (!party || !party.transport.createInvite) return { ok: false, error: 'mode' };
                    const invite = await party.transport.createInvite();
                    return invite ? { ok: true, invite } : { ok: false, error: 'invite' };
                }
                case 'accept':
                    if (!party || !party.transport.accept) return { ok: false, error: 'mode' };
                    return party.transport.accept(String(msg.code || ''));
                case 'revoke':
                    if (!party || !party.transport.revoke) return { ok: false, error: 'mode' };
                    return { ok: party.transport.revoke(String(msg.code || '')) };
                case 'policy':
                case 'role':
                case 'kick':
                    if (!party) return { ok: false, error: 'inactive' };
                    party.link.send(HOST_OPS[msg.op](msg));
                    return { ok: true };
                default: return { ok: false, error: 'op' };
            }
        }

        return { connect, control, status };
    }

    /** Listen for the party tab's port and the worker's messages. Returns the session. */
    function boot(api = root.chrome, options = {}) {
        if (root.__bbPartySession) return root.__bbPartySession;
        if (!api || !api.runtime || !api.runtime.onConnect) return null;
        const session = createSession({
            onEnd(code) {
                try { api.runtime.sendMessage({ action: 'partyEnded', code }).catch(() => {}); } catch (_) { /* the extension was reloaded: nobody left to tell */ }
            },
            ...options,
        });
        api.runtime.onConnect.addListener(session.connect);
        api.runtime.onMessage.addListener((msg, sender, respond) => {
            if (!msg || msg.to !== TARGET) return false;
            session.control(msg).then(respond, () => respond({ ok: false }));
            return true;
        });
        root.__bbPartySession = session;
        return session;
    }

    const PartySession = { PORT, TARGET, HEARTBEAT_MAX_MS, FROM_TAB, HOST_OPS, TRANSPORTS, createSession, boot };

    root.BB = root.BB || {};
    root.BB.PartySession = PartySession;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartySession;

    // offscreen.html has nothing else to start it, and an extension page may
    // not carry an inline script. Anywhere else, whoever loads this boots it.
    if (root.location && /\/offscreen\.html$/.test(root.location.pathname)) boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
