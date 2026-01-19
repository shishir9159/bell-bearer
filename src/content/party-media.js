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
    const Bridge = ns.Bridge || req('./bridge.js');

    /** How long a write of ours may take to come back as its event. */
    const EXPECT_MS = 1500;
    /** A seek lands on a keyframe, near the time asked for rather than on it. */
    const SEEK_SLACK_S = 0.5;
    const RATE_SLACK = 0.001;
    /** Scrubbing fires a seek per frame dragged; only where it stops is sent. */
    const SEEK_DEBOUNCE_MS = 300;
    /** An intent the authority never answers stops holding the room back after this. */
    const PENDING_MS = 3000;
    /**
     * Speed changes this close together are one change: a speed slider, or a
     * key held down, fires a ratechange per step, and an intent per step would
     * run into the authority's five-a-second limit and snap the rate back.
     */
    const RATE_DEBOUNCE_MS = 250;
    /** A rate change this soon after a new source is the page resetting it, not the user. */
    const SOURCE_RESET_MS = 4000;
    const CLOCK_PING_MS = 60000;
    /** Asked again this often while the session has no room time to answer with yet. */
    const CLOCK_RETRY_MS = 1000;
    /** A stall shorter than this is the player's ordinary hiccup, not worth holding a room over. */
    const STALL_MS = 800;
    /** How often the session hears how far off we are, for the popup's "Synced ±40 ms". */
    const DRIFT_REPORT_MS = 5000;

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
            /** Whether an event would match, without spending the match. */
            has(kind, value, now) {
                return waiting.some((one) => one.until > now && one.kind === kind && same(kind, one.value, value));
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
    const askPage = (message) => Bridge.ask('bb:party', message, 'bb:party:ok');

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
        onRoom = noop,
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
        /** YouTube is playing this member an ad: nothing here is the room's business until it ends. */
        let ad = false;
        /** Why the room has been told we are not ready, or null. */
        let notReady = null;
        let stallTimer = null;
        let sourceAt = -Infinity;
        let seekTimer = null;
        let seekAskedAt = null;
        let awaitPlaying = false;
        let startTimer = null;
        let pingTimer = null;
        let burstTimer = null;
        let status = 'joining';
        let canSeek = true;
        /** The last rate nudge written, while a player that may revert it is on probation. */
        let lastNudge = null;
        /** { rate, timer } while a speed change of the user's waits to be sent. */
        let rateQueued = null;
        /** Seconds ahead of the room (behind when negative) at the last check, or null before one. */
        let lastDrift = null;
        let driftSentAt = -Infinity;

        const setStatus = (next, detail) => {
            if (next === status && !detail) return;
            status = next;
            onStatus(next, detail);
        };
        const mine = (event) => attached && !!event && event.target === getVideo();
        const suspended = () => loading || ad;
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
                if (!Number.isFinite(value) || Math.abs(video.playbackRate - value) < RATE_SLACK) return;
                ledger.expect('rate', value, t);
                // Outside the range a browser plays at, the assignment throws.
                try { video.playbackRate = value; } catch (_) { /* left where it was */ }
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
            if (!room || !video || suspended() || solo || pending) return;
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
            // A speed change of the user's still waiting to go out is not undone by
            // a vector that has not heard of it yet.
            if (!rateQueued) write('rate', room.rate);
            if (room.paused || room.hold) {
                write('pause');
            } else if (clock.ready() && PartyState.scheduled(room, roomNow)) {
                // A release on a shared start time: everyone waits for the
                // same room instant rather than for their message to land.
                write('pause');
                startTimer = setTimeout(() => write('play'), room.at - roomNow);
            } else {
                write('play');
            }
            if (room.hold) setStatus('waiting', room.hold.waiting);
            else setStatus('synced');
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
            if (!room || !video || suspended() || solo || pending || seekTimer || rateQueued || !onRoomMedia()) return;
            // Before the first pong, room time is only our own clock. The
            // welcome lands before that pong does, and with the room's clock
            // a second or two off ours a player in step was seeked out of it
            // on every join and every reload.
            if (!clock.ready()) return;
            const t = now();
            const expected = PartyState.expected(room, clock.toRoom(t));
            lastDrift = video.currentTime - expected;
            if (t - driftSentAt >= DRIFT_REPORT_MS) {
                driftSentAt = t;
                send({ t: 'drift', ms: Math.round(lastDrift * 1000) });
            }
            const action = drift.decide({
                actual: video.currentTime,
                expected,
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
            // Whatever the room says, the player is only ever given a rate the
            // room could have accepted. Anything else — a server bug, a
            // hand-made message — keeps the rate the room last had.
            state.rate = PartyState.validRate(state.rate) ?? (room ? room.rate : 1);
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
            if (!mine(event) || ledger.consume(event.type, null, now()) || suspended()) return;
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
            if (!suspended()) userSeeked();
        }

        /**
         * A seek of the user's starts the debounce at `seeking`, not at
         * `seeked`. The browser fires a timeupdate between the two, and with
         * nothing marking the seek as the user's yet, the drift saw a player
         * far from the room and seeked it straight back mid-scrub.
         */
        function onSeeking(event) {
            if (!mine(event) || suspended() || ledger.has('seek', event.target.currentTime, now())) return;
            userSeeked();
        }

        function userSeeked() {
            clearTimeout(seekTimer);
            seekTimer = setTimeout(() => {
                seekTimer = null;
                sendIntent('seek');
            }, SEEK_DEBOUNCE_MS);
        }

        function onPlaying(event) {
            if (!mine(event)) return;
            checkAd();
            if (!ad) report(null);
            if (!awaitPlaying) return;
            awaitPlaying = false;
            const t = now();
            drift.seekDone(t, t - seekAskedAt);
        }

        // --- readiness --------------------------------------------------

        /** Tell the room we are ready (`why` null) or why not — once per change. */
        function report(why) {
            clearTimeout(stallTimer);
            stallTimer = null;
            if (why === notReady) return;
            notReady = why;
            send(why ? { t: 'ready', ready: false, why } : { t: 'ready', ready: true });
        }

        function stall(why) {
            if (solo || notReady || stallTimer) return;
            stallTimer = setTimeout(() => report(why), STALL_MS);
        }

        /**
         * Buffering is not pausing. `waiting` on a player that is still meant
         * to be playing is a stall, and a stall says "not ready" — which may
         * hold the room — rather than pausing everyone.
         */
        function onWaiting(event) {
            if (!mine(event) || event.target.paused || ad) return;
            stall('buffering');
        }

        function onCanPlay(event) {
            if (mine(event) && !suspended()) report(null);
        }

        /**
         * Ads differ per member, so one never holds the room: while it plays,
         * this member's events are not intents and it is not corrected, and
         * when it ends it catches up with wherever the room got to.
         */
        function checkAd() {
            const showing = !!profile.ad && !!document.querySelector(profile.ad);
            if (showing === ad) return;
            ad = showing;
            if (ad) {
                drift.reset();
                report('ad');
            } else {
                report(null);
                follow();
            }
        }

        function onRateChange(event) {
            if (!mine(event)) return;
            const rate = event.target.playbackRate;
            const t = now();
            if (ledger.consume('rate', rate, t) || !room || suspended()) return;
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
            if (PartyState.validRate(rate) === null) {
                // The site's own custom speed, or another extension, went
                // past what the room takes. The authority would only reject
                // it, so the room's rate goes back on here and the user is told.
                write('rate', room.rate);
                notify(`Party speed stays between ${Speed.format(PartyState.MIN_RATE)} and ${Speed.format(PartyState.MAX_RATE)}`, 'warning');
                return;
            }
            queueRate(rate);
        }

        /** Send the speed the user settles on, once they stop changing it. */
        function queueRate(rate) {
            if (rateQueued) clearTimeout(rateQueued.timer);
            rateQueued = {
                rate,
                timer: setTimeout(() => {
                    const settled = rateQueued.rate;
                    rateQueued = null;
                    sendIntent('rate', { rate: settled });
                }, RATE_DEBOUNCE_MS),
            };
        }

        function onSourceChanged(event) {
            if (!mine(event)) return;
            loading = true;
            sourceAt = now();
            ledger.clear();
            checkAd();
            if (!ad) stall('loading');
        }

        function onSourceReady(event) {
            if (!mine(event) || !loading) return;
            loading = false;
            checkAd();
            if (ad) return;
            report(null);
            const media = mediaNow();
            // Somebody here moved the room to another video (or the next
            // episode started on its own): that is a change for everyone.
            if (room && media && !onRoomMedia()) sendIntent('media', { media, paused: event.target.paused });
            else follow();
        }

        function onTimeUpdate(event) {
            if (!mine(event)) return;
            checkAd();
            correct();
        }

        /**
         * The speed keys, while the party holds the rate: a step is from the
         * room's rate, not from wherever a nudge has the player this second,
         * and it is the room's to change.
         */
        function stepRoomRate(direction) {
            if (!room) return null;
            // From a step still waiting to be sent, so two quick presses are two rungs.
            const rate = PartyState.validRate(Speed.step(rateQueued ? rateQueued.rate : room.rate, direction));
            if (rate === null) return null;
            drift.reset();
            write('rate', rate);
            queueRate(rate);
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

        /**
         * A few pings back to back, so the first offset is not one sample,
         * then one a second until any is answered: the session answers none
         * until it has heard the authority's clock itself.
         */
        function burst(left = PartyClock.BURST) {
            clearTimeout(burstTimer);
            burstTimer = null;
            if (!attached) return;
            ping();
            if (left > 1) burstTimer = setTimeout(() => burst(left - 1), PartyClock.BURST_GAP_MS);
            else if (!clock.ready()) burstTimer = setTimeout(() => burst(1), CLOCK_RETRY_MS);
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
                case 'pong': {
                    const first = !clock.ready();
                    clock.add(msg, now());
                    // The room as it stood was played without its clock: now with it.
                    if (first && clock.ready()) follow();
                    break;
                }
                case 'keepalive': {
                    // The session is in a background page that is unloaded
                    // after thirty idle seconds (Firefox), and our ping is the
                    // event that keeps it. A clock sample more often is free.
                    const ms = Number(msg.ms);
                    if (!(ms >= 1000)) break;
                    clearInterval(pingTimer);
                    pingTimer = setInterval(ping, Math.min(CLOCK_PING_MS, ms));
                    break;
                }
                case 'detach': detach(); break;
                default: break;
            }
            // The rest of what the room says (who is in it, who asks for a
            // pause, the link dropping, how it ended) is the chip's to show.
            if (msg.t !== 'pong' && msg.t !== 'keepalive') onRoom(msg);
        }

        const LISTENERS = [
            ['play', onPlayOrPause], ['pause', onPlayOrPause], ['seeking', onSeeking], ['seeked', onSeeked],
            ['playing', onPlaying],
            ['ratechange', onRateChange], ['timeupdate', onTimeUpdate],
            ['loadstart', onSourceChanged], ['emptied', onSourceChanged], ['loadeddata', onSourceReady],
            ['waiting', onWaiting], ['canplay', onCanPlay],
        ];

        function attach() {
            if (attached) return;
            attached = true;
            for (const [type, fn] of LISTENERS) document.addEventListener(type, fn, { capture: true, passive: true });
            if (profile.navigated) document.addEventListener(profile.navigated, onNavigated);
            if (player) player.holdRate(true, { step: stepRoomRate });
            burst();
            pingTimer = setInterval(ping, CLOCK_PING_MS);
        }

        function detach() {
            if (!attached) return;
            attached = false;
            for (const [type, fn] of LISTENERS) document.removeEventListener(type, fn, { capture: true });
            if (profile.navigated) document.removeEventListener(profile.navigated, onNavigated);
            for (const timer of [seekTimer, startTimer, stallTimer, burstTimer, rateQueued && rateQueued.timer, pending && pending.timer]) clearTimeout(timer);
            rateQueued = null;
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

        /** Back to the video the room is on, from wherever the user wandered. */
        function goToRoomMedia() {
            const url = room && room.media && PartySites.urlFor(room.media);
            if (url) go(url);
        }

        return {
            attach, detach, receive, setSolo, goToRoomMedia,
            /** Ask the hosts for what host control will not let us do ourselves. */
            request: (op) => send({ t: 'request', op }),
            solo: () => solo,
            drift: () => lastDrift,
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
        // Follow the room to its next video unless the setting says not to;
        // read once, and the room is followed until it has answered.
        let follows = true;
        if (ns.Settings) ns.Settings.get(['partyFollowMedia']).then((s) => { follows = s.partyFollowMedia !== false; }, noop);
        const getVideo = ns.Site.createPlayerLocator(site);
        const post = (msg) => { try { port.postMessage(msg); } catch (_) { media.detach(); } };
        let chip = null;
        const chat = ns.PartyChatPanel
            ? ns.PartyChatPanel.createChatPanel({ site, getVideo, api, send: post, onChange: () => { if (chip) chip.refresh(); } })
            : null;
        chip = ns.PartyChip ? ns.PartyChip.createChip({ site, getVideo, api, chat }) : null;
        const media = createPartyMedia({
            site,
            getVideo,
            player: bb.player,
            notify: ns.Notify ? (message, type) => ns.Notify.show(message, type) : noop,
            send: post,
            followMedia: () => follows,
            onStatus(next, detail) {
                if (chip) chip.status(next, detail);
                // The conversation goes with the party; the chip may stay to say how it ended.
                if (next === 'left' && chat) chat.remove();
            },
            onRoom(msg) {
                if (chip) chip.room(msg);
                if (chat) chat.room(msg);
            },
        });
        if (chip) chip.bind(media);
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

    const PartyMedia = {
        createPartyMedia, createLedger, createApiControls, askPage, VIDEO_CONTROLS,
        EXPECT_MS, SEEK_DEBOUNCE_MS, RATE_DEBOUNCE_MS, PENDING_MS, STALL_MS, DRIFT_REPORT_MS, DRIFT_EVAL_MS: PartyDrift.EVAL_MS,
    };

    root.BB = root.BB || {};
    root.BB.PartyMedia = PartyMedia;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyMedia;

    if (typeof document !== 'undefined') boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
