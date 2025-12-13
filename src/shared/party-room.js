/**
 * The party's authority: who is in the room, who may drive it, and the one
 * playback vector everybody follows.
 *
 * Exactly one of these exists per party. In a peer-to-peer party it runs in
 * the host's offscreen document and the guests reach it over data channels;
 * in a server party the Zig/Go server is the authority and implements the
 * same rules, which the README's "Watch party protocol" states and
 * tests/party-vectors.json pins down. Keeping both honest is why this is
 * transport-free and clock-free: it is handed messages and the time, and it
 * answers through `send(memberId, message)`. It never sets a timer — the
 * owner calls tick() — so a vector replays identically here and against a
 * live server.
 *
 * Members send intents, never vectors. The authority decides whether an
 * intent stands (valid, permitted, not colliding with a change its sender had
 * not seen) and broadcasts the vector that results, acknowledging the intent
 * to everyone so the sender can stop ignoring the room's state (Syncplay's
 * ignoringOnTheFly: the member that acted does not let an older state, still
 * in flight, undo what it just did).
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyState = ns.PartyState || req('./party-state.js');

    const VERSION = 1;
    const MAX_MEMBERS = 16;
    const INTENTS_PER_S = 5;
    const NAME_MAX = 32;
    const CONTROLS = Object.freeze(['everyone', 'host']);
    const ROLES = Object.freeze(['host', 'cohost', 'guest']);

    /**
     * Liveness, off the pings every member sends at least every fifteen
     * seconds. Away is shown and costs nothing; removal is what ends the
     * resume grace — a member back within the minute keeps their id and role.
     * A host gone quiet for as long as it takes to be marked away is replaced
     * then, not a minute later: a room nobody can drive in host control is a
     * room stuck on whatever was last pressed.
     */
    const AWAY_MS = 15000;
    const REMOVE_MS = 60000;

    /**
     * Waiting for a member whose player is buffering. The room holds at the
     * position it had reached, and releases with a start time a little in the
     * future so every player begins on the same frame rather than each as
     * the message happens to reach it.
     *
     * The limits are what keep one slow connection from ruining the evening:
     * the wait is capped, a member who has held the room three times in two
     * minutes stops holding it and catches up by seeking instead, ads never
     * hold it (a two-minute ad break on one account is not everybody's), and
     * past six people nobody waits for anyone.
     */
    const HOLD_TIMEOUT_MS = 8000;
    const HOLD_MAX_MEMBERS = 6;
    const FLAP_HOLDS = 3;
    const FLAP_WINDOW_MS = 120000;
    const LAG_MS = 300000;
    const EXCLUDE_MS = 120000;
    const LEAD_PAD_MS = 150;
    const LEAD_MIN_MS = 250;
    const LEAD_MAX_MS = 1000;
    const WHYS = Object.freeze(['buffering', 'loading', 'ad']);

    function mintRandom(prefix) {
        const bytes = new Uint8Array(8);
        const crypto = root.crypto;
        if (crypto && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
        else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
        return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || 'Guest';

    /**
     * `state` starts the room where another left off — a peer-to-peer
     * party whose host went, carried on by the next in line — with its seq,
     * so the members' newest-seq-wins rule still holds across the change.
     */
    function createRoom({ id, policy = {}, send, mint = mintRandom, state: from = null }) {
        const members = new Map();
        let joined = 0;
        let state = from ? { ...PartyState.blank(), ...from, hold: null } : PartyState.blank();
        /** The last accepted change, for the conflict rule. */
        let last = null;
        const rules = {
            control: CONTROLS.includes(policy.control) ? policy.control : 'everyone',
            wait: policy.wait !== false,
            locked: false,
        };

        const inOrder = () => [...members.values()].sort((a, b) => a.order - b.order);
        const view = (m) => ({
            id: m.id, name: m.name, role: m.role, ready: m.ready, why: m.why,
            solo: m.solo, away: m.away, rtt: m.rtt, lagging: m.lagging,
        });
        const roster = () => inOrder().map(view);
        const stateMessage = (extra) => ({ t: 'state', ...state, ...extra });
        const isHost = (m) => m.role === 'host';
        const canControl = (m) => rules.control === 'everyone' || m.role !== 'guest';

        function broadcast(message) {
            for (const m of members.values()) send(m.id, message);
        }
        const announceMembers = () => broadcast({ t: 'members', list: roster() });

        function welcome(m, now) {
            send(m.id, {
                t: 'welcome', v: VERSION, you: m.id, resume: m.resume,
                room: { id, policy: { ...rules }, members: roster(), state: { ...state } },
                now,
            });
        }

        /**
         * A member arriving, or coming back with the resume token its welcome
         * carried. Authentication is the caller's: the server checks the room
         * secret, a P2P host checks the channel binding, then calls this.
         * Returns { member } or { error }.
         */
        function join({ name, resume } = {}, now) {
            if (resume) {
                const back = [...members.values()].find((m) => m.resume === resume);
                if (!back) return { error: 'expired' };
                back.away = false;
                back.lastSeen = now;
                welcome(back, now);
                announceMembers();
                return { member: back.id };
            }
            if (rules.locked) return { error: 'locked' };
            if (members.size >= MAX_MEMBERS) return { error: 'full' };

            const m = {
                id: mint('m'), resume: mint('r'), name: cleanName(name),
                role: members.size === 0 ? 'host' : 'guest', order: joined++,
                lastSeen: now, away: false, ready: true, why: null, solo: false,
                rtt: null, lagging: false, laggingUntil: 0, holdTimes: [], intents: [],
            };
            members.set(m.id, m);
            welcome(m, now);
            announceMembers();
            return { member: m.id };
        }

        /** The next host: the first co-host still here, else whoever came first. */
        function promote() {
            const here = inOrder().filter((m) => !m.away);
            const next = here.find((m) => m.role === 'cohost') || here[0];
            if (next) next.role = 'host';
        }

        function remove(m, now) {
            if (!members.delete(m.id)) return;
            if (isHost(m)) promote();
            unwait(m, now);
            announceMembers();
        }

        // ------------------------------------------------------------ holds

        const here = () => inOrder().filter((one) => !one.away);

        /** Whether this member's buffering is worth the room waiting for. */
        function holdsRoom(m, now) {
            return rules.wait && !state.paused && !m.ready && m.why !== 'ad' && !m.solo && !m.away &&
                now >= m.laggingUntil && here().length <= HOLD_MAX_MEMBERS;
        }

        /**
         * A change the room makes itself. Its seq moves on so everyone
         * applies it, and the conflict rule's record moves with it — a member
         * who saw the hold is not colliding with anything by acting on it.
         */
        function change(next) {
            state = { ...next, seq: state.seq + 1 };
            if (last) last = { ...last, seq: state.seq };
            broadcast(stateMessage());
        }

        function wait(m, now) {
            m.holdTimes = m.holdTimes.filter((at) => now - at < FLAP_WINDOW_MS).concat(now);
            if (m.holdTimes.length >= FLAP_HOLDS) {
                m.holdTimes = [];
                m.laggingUntil = now + LAG_MS;
                m.lagging = true;
                unwait(m, now);
                return;
            }
            if (state.hold) {
                if (!state.hold.waiting.includes(m.id)) change({ ...state, hold: { ...state.hold, waiting: [...state.hold.waiting, m.id] } });
                return;
            }
            change({ ...state, pos: PartyState.expected(state, now), at: now, hold: { waiting: [m.id], since: now } });
        }

        function unwait(m, now) {
            if (!state.hold || !state.hold.waiting.includes(m.id)) return;
            const waiting = state.hold.waiting.filter((one) => one !== m.id);
            if (waiting.length) change({ ...state, hold: { ...state.hold, waiting } });
            else release(now);
        }

        /** Everyone ready: go, a little in the future, together. */
        function release(now) {
            const rtts = here().map((one) => one.rtt).filter(Number.isFinite);
            const lead = Math.min(LEAD_MAX_MS, Math.max(LEAD_MIN_MS, (rtts.length ? Math.max(...rtts) : 0) / 2 + LEAD_PAD_MS));
            change({ ...state, at: now + lead, hold: null });
        }

        function ready(m, msg, now) {
            const isReady = msg.ready !== false;
            const why = isReady ? null : (WHYS.includes(msg.why) ? msg.why : 'buffering');
            if (m.ready === isReady && m.why === why) return;
            m.ready = isReady;
            m.why = why;
            if (isReady) unwait(m, now);
            else if (holdsRoom(m, now)) wait(m, now);
            announceMembers();
        }

        function intent(m, msg, now) {
            const reject = (why) => {
                send(m.id, { t: 'reject', id: Number.isInteger(msg.id) ? msg.id : null, why });
                send(m.id, stateMessage());
            };
            const it = PartyState.validateIntent(msg, now);
            if (!it) return reject('invalid');
            if (!canControl(m) || m.solo) return reject('policy');

            m.intents = m.intents.filter((at) => now - at < 1000);
            if (m.intents.length >= INTENTS_PER_S) return reject('rate-limit');
            m.intents.push(now);

            if (PartyState.conflicts(last, m.id, it.base, now)) return reject('conflict');

            state = PartyState.apply(state, it, m.id);
            last = { seq: state.seq, by: m.id, changedAt: now };
            // Pressing play while somebody is still loading the video starts
            // the room held on them, rather than leaving them to catch up on
            // a film that began without them.
            const loading = it.op === 'play' ? here().filter((one) => holdsRoom(one, now)).map((one) => one.id) : [];
            if (loading.length) state = { ...state, hold: { waiting: loading, since: now } };
            broadcast(stateMessage({ ack: { member: m.id, id: it.id } }));
        }

        function handle(from, msg, now) {
            const m = members.get(from);
            if (!m || !msg || typeof msg.t !== 'string') return;
            m.lastSeen = now;
            if (m.away) {
                m.away = false;
                announceMembers();
            }
            const target = members.get(msg.member);

            switch (msg.t) {
                case 'ping': {
                    const rtt = Number(msg.rtt);
                    if (Number.isFinite(rtt) && rtt >= 0) m.rtt = Math.round(rtt);
                    send(m.id, { t: 'pong', c: msg.c, s: now, s2: now, seq: state.seq });
                    if (msg.seq !== state.seq) send(m.id, stateMessage());
                    break;
                }
                case 'intent':
                    intent(m, msg, now);
                    break;
                case 'request':
                    if (!PartyState.OPS.includes(msg.op)) break;
                    for (const one of members.values()) {
                        if (one.role !== 'guest' && one !== m) send(one.id, { t: 'request', from: m.id, op: msg.op });
                    }
                    break;
                case 'policy':
                    if (!isHost(m)) break;
                    if (CONTROLS.includes(msg.control)) rules.control = msg.control;
                    if (typeof msg.wait === 'boolean') rules.wait = msg.wait;
                    if (typeof msg.locked === 'boolean') rules.locked = msg.locked;
                    broadcast({ t: 'policy', ...rules });
                    break;
                case 'role':
                    if (!isHost(m) || !target || target === m || !ROLES.includes(msg.role)) break;
                    // Handing the room over leaves the old host a co-host, not
                    // a guest: they were driving a moment ago.
                    if (msg.role === 'host') m.role = 'cohost';
                    target.role = msg.role;
                    announceMembers();
                    break;
                case 'kick':
                    if (!isHost(m) || !target || target === m) break;
                    send(target.id, { t: 'error', code: 'kicked' });
                    remove(target, now);
                    break;
                case 'ready':
                    ready(m, msg, now);
                    break;
                case 'solo':
                    m.solo = msg.solo === true;
                    if (m.solo) unwait(m, now);
                    announceMembers();
                    break;
                case 'bye':
                    remove(m, now);
                    break;
                default:
                    break;
            }
        }

        return {
            join,
            handle,
            leave(memberId, now) {
                const m = members.get(memberId);
                if (m) remove(m, now);
            },
            /** Timeouts; the owner calls this about once a second. */
            tick(now) {
                let changed = false;
                for (const m of inOrder()) {
                    const quiet = now - m.lastSeen;
                    if (quiet >= REMOVE_MS) {
                        members.delete(m.id);
                        if (isHost(m)) promote();
                        unwait(m, now);
                        changed = true;
                    } else if (quiet >= AWAY_MS && !m.away) {
                        m.away = true;
                        unwait(m, now);
                        changed = true;
                    }
                    if (m.lagging && now >= m.laggingUntil) {
                        m.lagging = false;
                        changed = true;
                    }
                }
                // Past the cap the stragglers are let go, and kept from
                // holding the room again for a while: they catch up instead.
                if (state.hold && now - state.hold.since >= HOLD_TIMEOUT_MS) {
                    for (const waiter of state.hold.waiting) {
                        const m = members.get(waiter);
                        if (!m) continue;
                        m.laggingUntil = now + EXCLUDE_MS;
                        m.lagging = true;
                    }
                    release(now);
                    changed = true;
                }
                const host = [...members.values()].find(isHost);
                // Handed over only to someone who is actually here; with the
                // whole room quiet the host keeps it. Back again, the old host
                // is a co-host, so host control still lets them drive.
                if (host && host.away && inOrder().some((m) => !m.away)) {
                    host.role = 'cohost';
                    promote();
                    changed = true;
                }
                if (changed) announceMembers();
            },
            state: () => ({ ...state }),
            members: roster,
            policy: () => ({ ...rules }),
        };
    }

    const PartyRoom = {
        VERSION, MAX_MEMBERS, INTENTS_PER_S, AWAY_MS, REMOVE_MS, CONTROLS, ROLES,
        HOLD_TIMEOUT_MS, HOLD_MAX_MEMBERS, FLAP_HOLDS, LAG_MS, EXCLUDE_MS, LEAD_PAD_MS, LEAD_MIN_MS, LEAD_MAX_MS, WHYS,
        createRoom, mintRandom,
    };

    root.BB = root.BB || {};
    root.BB.PartyRoom = PartyRoom;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyRoom;
})(typeof globalThis !== 'undefined' ? globalThis : this);
