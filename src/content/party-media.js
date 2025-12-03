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
 * Injected by the party loader, never listed in a manifest, and it boots
 * itself: see the foot of this file.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyClock = ns.PartyClock || req('../shared/party-clock.js');
    const PartyState = ns.PartyState || req('../shared/party-state.js');
    const PartyDrift = ns.PartyDrift || req('../shared/party-drift.js');
    const PartySites = ns.PartySites || req('../shared/party-sites.js');
    const Speed = ns.Speed || req('../shared/speed.js');

    /** How long a write of ours may take to come back as its event. */
    const EXPECT_MS = 1500;
    /** A seek lands on a keyframe, near the time asked for rather than on it. */
    const SEEK_SLACK_S = 0.5;
    const RATE_SLACK = 0.001;
    /** Scrubbing fires a seek per frame dragged; only where it stops is sent. */
    const SEEK_DEBOUNCE_MS = 300;
    /** An intent the authority never answers stops holding the room back after this. */
    const PENDING_MS = 3000;
    /** A rate change this soon after a new source is the page resetting it, not the user. */
    const SOURCE_RESET_MS = 4000;
    const CLOCK_PING_MS = 60000;

    function createLedger() {
        let waiting = [];
        const same = (kind, a, b) => (kind === 'seek' ? Math.abs(a - b) <= SEEK_SLACK_S
            : kind === 'rate' ? Math.abs(a - b) < RATE_SLACK : true);
        return {
            expect(kind, value, now) {
                waiting.push({ kind, value, until: now + EXPECT_MS });
            },
            /**
             * True if this event is the echo of a write of ours. A play or a
             * pause matches once — a second one is the user's. A rate is not
             * used up: its handler reads the element's rate as it is by then,
             * so two quick writes send two events that both read the last.
             */
            consume(kind, value, now) {
                waiting = waiting.filter((one) => one.until > now);
                const at = waiting.findIndex((one) => one.kind === kind && same(kind, one.value, value));
                if (at < 0) return false;
                if (kind !== 'rate') waiting.splice(at, 1);
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
        seek: (video, to) => {
            video.currentTime = to;
            return true;
        },
    });

    /**
     * One synchronous round trip to src/content/netflix-page.js, in the page's
     * world. Null when nothing answered: the bridge is not in this page.
     */
    function askPage(message) {
        let answer = null;
        const take = (event) => {
            try { answer = JSON.parse(event.detail); } catch (_) { answer = null; }
        };
        document.addEventListener('bb:party:ok', take);
        try {
            document.dispatchEvent(new CustomEvent('bb:party', { detail: JSON.stringify(message) }));
        } finally {
            document.removeEventListener('bb:party:ok', take);
        }
        return answer;
    }

    /**
     * Netflix: its own player API, falling back to the <video> for play and
     * pause. Never for a seek — Netflix answers a currentTime write with error
     * M7375 — so a seek with no API to go through is not made at all.
     */
    function createApiControls(ask = askPage) {
        const done = (answer) => !!(answer && answer.ok);
        return {
            play: (video) => { if (!done(ask({ type: 'play' }))) quietly(video.play()); },
            pause: (video) => { if (!done(ask({ type: 'pause' }))) video.pause(); },
            seek: (video, to) => done(ask({ type: 'seek', ms: Math.round(to * 1000) })),
        };
    }

    function createPartyMedia({
        site, getVideo, send,
        player = null,
        notify = noop,
        clock = PartyClock.createClock(),
        now = PartyClock.localNow,
        mediaNow = () => PartySites.mediaOf(root.location.href),
        followMedia = () => true,
        go = (url) => root.location.assign(url),
        onStatus = noop,
    }) {
        const profile = PartySites.get(site);
        const drift = PartyDrift.createDrift({ profile: 'nudge' });
        const ledger = createLedger();
        const controls = profile.seek === 'api' ? createApiControls() : VIDEO_CONTROLS;
        const stats = { intents: 0, seeks: 0, nudges: 0 };

        let attached = false;
        let me = null;
        let room = null;
        let cseq = 0;
        /** { id, timer } while an intent of ours is unanswered. */
        let pending = null;
        let snapNext = false;
        let solo = false;
        let loading = false;
        let sourceAt = -Infinity;
        let seekTimer = null;
        let seekAskedAt = null;
        let awaitPlaying = false;
        let startTimer = null;
        let pingTimer = null;
        let status = 'joining';
        let canSeek = true;
        /** The last rate nudge written, while a player that may revert it is on probation. */
        let lastNudge = null;

        const setStatus = (next, detail) => {
            if (next === status && !detail) return;
            status = next;
            onStatus(next, detail);
        };
        const mine = (event) => attached && !!event && event.target === getVideo();
        const onRoomMedia = () => !room || !room.media || PartySites.sameMedia(room.media, mediaNow());

        // --- writing ---------------------------------------------------

        function write(kind, value) {
            const video = getVideo();
            if (!video) return;
            const t = now();
            if (kind === 'play' || kind === 'pause') {
                if (video.paused === (kind === 'pause')) return;
                ledger.expect(kind, null, t);
                controls[kind](video);
            } else if (kind === 'seek') {
                ledger.expect('seek', value, t);
                seekAskedAt = t;
                stats.seeks++;
                if (controls.seek(video, value)) return;
                ledger.clear();
                if (canSeek) onStatus('no-seek');
                canSeek = false;
            } else if (kind === 'rate') {
                if (Math.abs(video.playbackRate - value) < RATE_SLACK) return;
                ledger.expect('rate', value, t);
                video.playbackRate = value;
            }
        }

        function sendIntent(op, extra = {}) {
            const video = getVideo();
            if (!video || !room || solo) return;
            if (op !== 'media' && !onRoomMedia()) return;
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

        let roomMediaChanged = false;

        function follow() {
            const video = getVideo();
            if (!room || !video || loading || solo || pending) return;
            if (!onRoomMedia()) {
                const url = roomMediaChanged && followMedia() && PartySites.urlFor(room.media);
                roomMediaChanged = false;
                setStatus('elsewhere');
                if (url) go(url);
                return;
            }
            roomMediaChanged = false;
            drift.reset();
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
            correct();
        }

        function bufferedAhead(video) {
            const ranges = video.buffered;
            for (let i = 0; ranges && i < ranges.length; i++) {
                if (ranges.start(i) <= video.currentTime && video.currentTime <= ranges.end(i)) {
                    return ranges.end(i) - video.currentTime;
                }
            }
            return 0;
        }

        /** One drift decision, applied. Runs on timeupdate and whenever the room moves. */
        function correct() {
            const video = getVideo();
            if (!room || !video || loading || solo || pending || seekTimer || !onRoomMedia()) return;
            const t = now();
            const action = drift.decide({
                actual: video.currentTime,
                expected: PartyState.expected(room, clock.toRoom(t)),
                rate: room.rate, paused: video.paused, now: t,
                bufferedAhead: video.readyState ? bufferedAhead(video) : Infinity,
            });
            if (action.kind === 'rate') {
                stats.nudges++;
                if (profile.rate === 'probe') lastNudge = { rate: action.rate, at: t };
                write('rate', action.rate);
            } else if (action.kind === 'seek') {
                if (action.rate) write('rate', action.rate);
                write('seek', action.to);
            }
        }

        function onState(msg) {
            const { t, ack, ...state } = msg;
            const ours = !!pending && !!ack && ack.id === pending.id && (!me || ack.member === me);
            if (room && (state.seq < room.seq || (state.seq === room.seq && !snapNext && !ours))) return;
            roomMediaChanged = roomMediaChanged || !room || !PartySites.sameMedia(room.media, state.media);
            room = state;
            snapNext = false;
            if (ours) settle();
            else follow();
        }

        // --- listening to the page ------------------------------------

        function onPlayOrPause(event) {
            if (!mine(event) || ledger.consume(event.type, null, now()) || loading) return;
            sendIntent(event.type);
        }

        function onSeeked(event) {
            if (!mine(event)) return;
            const video = event.target;
            const t = now();
            if (ledger.consume('seek', video.currentTime, t)) {
                // Paused, the seek is done when it lands; playing, when the
                // frames start again — which is the cost the drift learns.
                if (video.paused || video.readyState >= 3) drift.seekDone(t, t - seekAskedAt);
                else awaitPlaying = true;
                return;
            }
            if (loading) return;
            clearTimeout(seekTimer);
            seekTimer = setTimeout(() => {
                seekTimer = null;
                sendIntent('seek');
            }, SEEK_DEBOUNCE_MS);
        }

        function onPlaying(event) {
            if (!mine(event) || !awaitPlaying) return;
            awaitPlaying = false;
            const t = now();
            drift.seekDone(t, t - seekAskedAt);
        }

        function onRateChange(event) {
            if (!mine(event)) return;
            const rate = event.target.playbackRate;
            const t = now();
            if (ledger.consume('rate', rate, t) || !room || loading) return;
            if (lastNudge && t - lastNudge.at < profile.probeMs && Math.abs(rate - room.rate) < RATE_SLACK) {
                // The player put the room's rate back over our nudge. It will
                // keep doing that, so this member is kept in sync by seeks.
                // Events still queued behind this one read the same rate back
                // and are the same revert, not the user choosing it.
                lastNudge = null;
                ledger.expect('rate', room.rate, t);
                drift.setProfile('seekOnly');
                drift.reset();
                return;
            }
            if (t - sourceAt < SOURCE_RESET_MS) {
                // The page put its own remembered rate back while loading.
                drift.reset();
                write('rate', room.rate);
                return;
            }
            sendIntent('rate', { rate });
        }

        function onSourceChanged(event) {
            if (!mine(event)) return;
            loading = true;
            sourceAt = now();
            ledger.clear();
        }

        function onSourceReady(event) {
            if (!mine(event) || !loading) return;
            loading = false;
            const media = mediaNow();
            // Somebody here moved the room to another video (or the next
            // episode started on its own): that is a change for everyone.
            if (room && media && !onRoomMedia()) sendIntent('media', { media, paused: event.target.paused });
            else follow();
        }

        function onTimeUpdate(event) {
            if (mine(event)) correct();
        }

        /**
         * The speed keys, while the party holds the rate: a step is from the
         * room's rate, not from wherever a nudge has the player this second,
         * and it is the room's to change.
         */
        function stepRoomRate(direction) {
            if (!room) return null;
            const rate = Speed.step(room.rate, direction);
            drift.reset();
            write('rate', rate);
            sendIntent('rate', { rate });
            notify(`Party speed: ${Speed.format(rate)}`, 'info');
            return rate;
        }

        function onNavigated() {
            if (!onRoomMedia()) setStatus('elsewhere');
        }

        // --- the port ---------------------------------------------------

        function ping() {
            send({ t: 'ping', c: now(), seq: room ? room.seq : 0 });
        }

        function receive(msg) {
            if (!attached || !msg || typeof msg.t !== 'string') return;
            switch (msg.t) {
                case 'welcome': {
                    me = msg.you;
                    room = null;
                    if (pending) clearTimeout(pending.timer);
                    pending = null;
                    onState({ ...msg.room.state });
                    const media = mediaNow();
                    if (!room.media && media) sendIntent('media', { media, paused: !!(getVideo() || {}).paused });
                    break;
                }
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
            ['play', onPlayOrPause], ['pause', onPlayOrPause], ['seeked', onSeeked], ['playing', onPlaying],
            ['ratechange', onRateChange], ['timeupdate', onTimeUpdate],
            ['loadstart', onSourceChanged], ['emptied', onSourceChanged], ['loadeddata', onSourceReady],
        ];

        function attach() {
            if (attached) return;
            attached = true;
            for (const [type, fn] of LISTENERS) document.addEventListener(type, fn, { capture: true, passive: true });
            if (profile.navigated) document.addEventListener(profile.navigated, onNavigated);
            if (player) player.holdRate(true, { step: stepRoomRate });
            ping();
            pingTimer = setInterval(ping, CLOCK_PING_MS);
        }

        function detach() {
            if (!attached) return;
            attached = false;
            for (const [type, fn] of LISTENERS) document.removeEventListener(type, fn, { capture: true });
            if (profile.navigated) document.removeEventListener(profile.navigated, onNavigated);
            for (const timer of [seekTimer, startTimer, pending && pending.timer]) clearTimeout(timer);
            clearInterval(pingTimer);
            pending = null;
            seekTimer = null;
            // Hand the rate back as the room had it, not mid-nudge.
            if (room && drift.nudging()) write('rate', room.rate);
            if (player) player.holdRate(false);
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
            canSeek: () => canSeek,
            room: () => room,
            stats: () => ({ ...stats, seekLatency: drift.seekLatency(), profile: drift.profile() }),
        };
    }

    /**
     * Boot. Runs when the loader injects this file into a party tab, where the
     * page's own content script has already put its player on
     * `__bellBearer`. The test page has none, so nothing boots there.
     */
    function boot() {
        const bb = root.__bellBearer;
        const api = root.chrome;
        if (!bb || !bb.player || root.__bbPartyMedia || !api || !api.runtime || !ns.Site) return;
        const site = PartySites.siteOf(root.location.href);
        if (!site) return;

        let port;
        try {
            port = api.runtime.connect({ name: 'bb:party' });
        } catch (_) {
            return; // the extension reloaded under this page
        }
        const media = createPartyMedia({
            site,
            getVideo: ns.Site.createPlayerLocator(site),
            player: bb.player,
            notify: ns.Notify ? (message, type) => ns.Notify.show(message, type) : noop,
            send: (msg) => { try { port.postMessage(msg); } catch (_) { media.detach(); } },
        });
        root.__bbPartyMedia = media;
        bb.party = media;
        port.onMessage.addListener(media.receive);
        port.onDisconnect.addListener(() => {
            void api.runtime.lastError;
            media.detach();
            root.__bbPartyMedia = null;
        });
        media.attach();
    }

    const PartyMedia = { createPartyMedia, createLedger, createApiControls, askPage, VIDEO_CONTROLS, EXPECT_MS, SEEK_DEBOUNCE_MS, PENDING_MS };

    root.BB = root.BB || {};
    root.BB.PartyMedia = PartyMedia;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyMedia;

    if (typeof document !== 'undefined') boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
