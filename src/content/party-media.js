/**
 * The watch party's hands on the page's player: what the user does to it goes
 * out as an intent, and the room's vector comes back in and is played.
 *
 * The hard part is telling those two apart. Our own `pause()` fires the same
 * `pause` event the user's click does, and media events are queued — by the
 * time the event runs, a flag set around the write has long been cleared.
 * So every write records what it expects to hear back, and an event that
 * lands on an expectation is ours; anything else is the user.
 *
 * After sending an intent, incoming vectors are kept but not played until the
 * authority answers that intent (Syncplay's `ignoringOnTheFly`): a heartbeat
 * carrying the room from before our pause must not un-pause us a moment later.
 *
 * The port speaks the wire protocol's own messages (`welcome`, `state`,
 * `reject`, …), forwarded by the party session. A `ping` on it is answered by
 * the session itself, in room time, so one clock covers both hops.
 *
 * Injected by the party loader, never listed in a manifest.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyClock = ns.PartyClock || req('../shared/party-clock.js');
    const PartyState = ns.PartyState || req('../shared/party-state.js');

    /** How long a write of ours may take to come back as its event. */
    const EXPECT_MS = 1500;
    /** A seek lands on a keyframe, near the time asked for rather than on it. */
    const SEEK_SLACK_S = 0.5;
    const RATE_SLACK = 0.001;
    /** Scrubbing fires a seek per frame dragged; only where it stops is sent. */
    const SEEK_DEBOUNCE_MS = 300;
    /** An intent the authority never answers stops holding the room back after this. */
    const PENDING_MS = 3000;
    const CLOCK_PING_MS = 60000;

    function createLedger() {
        let waiting = [];
        const same = (kind, a, b) => (kind === 'seek' ? Math.abs(a - b) <= SEEK_SLACK_S
            : kind === 'rate' ? Math.abs(a - b) < RATE_SLACK : true);
        return {
            expect(kind, value, now) {
                waiting.push({ kind, value, until: now + EXPECT_MS });
            },
            /** True, once, if this event is the echo of a write of ours. */
            consume(kind, value, now) {
                waiting = waiting.filter((one) => one.until > now);
                const at = waiting.findIndex((one) => one.kind === kind && same(kind, one.value, value));
                if (at < 0) return false;
                waiting.splice(at, 1);
                return true;
            },
            clear() { waiting = []; },
        };
    }

    const noop = () => {};
    const quietly = (promise) => { if (promise && typeof promise.catch === 'function') promise.catch(noop); };

    /** Playing a plain <video>: YouTube, and anything else that takes a currentTime write. */
    const VIDEO_CONTROLS = Object.freeze({
        play: (video) => quietly(video.play()),
        pause: (video) => video.pause(),
        seek: (video, to) => { video.currentTime = to; },
    });

    function createPartyMedia({
        getVideo, send,
        clock = PartyClock.createClock(),
        now = PartyClock.localNow,
        onStatus = noop,
    }) {
        const ledger = createLedger();
        const controls = VIDEO_CONTROLS;
        const stats = { intents: 0 };

        let attached = false;
        let me = null;
        let room = null;
        let cseq = 0;
        /** { id, timer } while an intent of ours is unanswered. */
        let pending = null;
        let snapNext = false;
        let solo = false;
        let seekTimer = null;
        let startTimer = null;
        let pingTimer = null;
        let status = 'joining';

        const setStatus = (next, detail) => {
            if (next === status && !detail) return;
            status = next;
            onStatus(next, detail);
        };
        const mine = (event) => attached && !!event && event.target === getVideo();

        // --- writing ---------------------------------------------------

        function write(kind, value) {
            const video = getVideo();
            if (!video) return;
            const t = now();
            if (kind === 'play' || kind === 'pause') {
                if (video.paused === (kind === 'pause')) return;
                ledger.expect(kind, null, t);
                controls[kind](video);
            } else if (kind === 'rate') {
                if (Math.abs(video.playbackRate - value) < RATE_SLACK) return;
                ledger.expect('rate', value, t);
                video.playbackRate = value;
            }
        }

        function sendIntent(op, extra = {}) {
            const video = getVideo();
            if (!video || !room || solo) return;
            const id = ++cseq;
            if (pending) clearTimeout(pending.timer);
            pending = { id, timer: setTimeout(settle, PENDING_MS) };
            stats.intents++;
            send({ t: 'intent', id, base: room.seq, op, pos: video.currentTime, at: Math.round(clock.toRoom(now())), ...extra });
        }

        /** The authority answered (or never will): play whatever the room now is. */
        function settle() {
            if (!pending) return;
            clearTimeout(pending.timer);
            pending = null;
            follow();
        }

        // --- playing the room ------------------------------------------

        function follow() {
            const video = getVideo();
            if (!room || !video || solo || pending) return;
            clearTimeout(startTimer);
            const roomNow = clock.toRoom(now());
            write('rate', room.rate);
            if (room.paused || room.hold) {
                write('pause');
            } else if (PartyState.scheduled(room, roomNow)) {
                // A release on a shared start time: everyone waits for the
                // same room instant rather than for their message to land.
                write('pause');
                startTimer = setTimeout(() => write('play'), room.at - roomNow);
            } else {
                write('play');
            }
            setStatus('synced');
        }

        function onState(msg) {
            const { t, ack, ...state } = msg;
            const ours = !!pending && !!ack && ack.id === pending.id && (!me || ack.member === me);
            if (room && (state.seq < room.seq || (state.seq === room.seq && !snapNext && !ours))) return;
            room = state;
            snapNext = false;
            if (ours) settle();
            else follow();
        }

        // --- listening to the page ------------------------------------

        function onPlayOrPause(event) {
            if (!mine(event) || ledger.consume(event.type, null, now())) return;
            sendIntent(event.type);
        }

        function onSeeked(event) {
            if (!mine(event) || ledger.consume('seek', event.target.currentTime, now())) return;
            clearTimeout(seekTimer);
            seekTimer = setTimeout(() => {
                seekTimer = null;
                sendIntent('seek');
            }, SEEK_DEBOUNCE_MS);
        }

        function onRateChange(event) {
            if (!mine(event)) return;
            const rate = event.target.playbackRate;
            if (ledger.consume('rate', rate, now()) || !room) return;
            sendIntent('rate', { rate });
        }

        // --- the port ---------------------------------------------------

        function ping() {
            send({ t: 'ping', c: now(), seq: room ? room.seq : 0 });
        }

        function receive(msg) {
            if (!attached || !msg || typeof msg.t !== 'string') return;
            switch (msg.t) {
                case 'welcome':
                    me = msg.you;
                    room = null;
                    if (pending) clearTimeout(pending.timer);
                    pending = null;
                    onState({ ...msg.room.state });
                    break;
                case 'state': onState(msg); break;
                case 'reject':
                    if (!pending || msg.id !== pending.id) break;
                    // The state that follows may be the one we already have:
                    // it is still what to snap back to.
                    snapNext = true;
                    clearTimeout(pending.timer);
                    pending = null;
                    setStatus('rejected', msg.why);
                    break;
                case 'pong': clock.add(msg, now()); break;
                case 'detach': detach(); break;
                default: break;
            }
        }

        const LISTENERS = [
            ['play', onPlayOrPause], ['pause', onPlayOrPause], ['seeked', onSeeked], ['ratechange', onRateChange],
        ];

        function attach() {
            if (attached) return;
            attached = true;
            for (const [type, fn] of LISTENERS) document.addEventListener(type, fn, { capture: true, passive: true });
            ping();
            pingTimer = setInterval(ping, CLOCK_PING_MS);
        }

        function detach() {
            if (!attached) return;
            attached = false;
            for (const [type, fn] of LISTENERS) document.removeEventListener(type, fn, { capture: true });
            for (const timer of [seekTimer, startTimer, pending && pending.timer]) clearTimeout(timer);
            clearInterval(pingTimer);
            pending = null;
            seekTimer = null;
            setStatus('left');
        }

        /** Step out of the room's playback, or back in — which snaps to it. */
        function setSolo(on) {
            solo = !!on;
            send({ t: 'solo', solo });
            if (!solo) follow();
        }

        return {
            attach, detach, receive, setSolo,
            status: () => status,
            room: () => room,
            stats: () => ({ ...stats }),
        };
    }

    const PartyMedia = { createPartyMedia, createLedger, VIDEO_CONTROLS, EXPECT_MS, SEEK_DEBOUNCE_MS, PENDING_MS };

    root.BB = root.BB || {};
    root.BB.PartyMedia = PartyMedia;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyMedia;
})(typeof globalThis !== 'undefined' ? globalThis : this);
