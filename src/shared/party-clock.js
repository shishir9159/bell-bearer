/**
 * The watch party's shared clock: how far this machine's clock sits from the
 * room's, measured the way NTP does it.
 *
 * Every playback state a party carries says *when* it was true (`at`, in room
 * time), so a message that arrives late still predicts the right position. That
 * only works if everyone agrees what time it is — and wall clocks on two
 * laptops routinely disagree by a second or more, which would put the whole
 * room a second apart while every message was delivered perfectly.
 *
 * One exchange is ping {c} → pong {c, s, s2} → received at t3:
 *
 *     offset = ((s - c) + (s2 - t3)) / 2      room time minus ours
 *     rtt    = (t3 - c) - (s2 - s)            wire time, not the other end's
 *
 * The offset is exact when the two legs take equally long, and wrong by half
 * their difference when they do not. The legs are most nearly equal when the
 * round trip is shortest — a queue on one leg is what makes a trip long — so
 * the offset is taken from the fastest sample in the window rather than an
 * average. An average folds every congested sample's asymmetry into the answer.
 *
 * Slow samples are not thrown away, though. They still roll through the
 * window, so a path that has genuinely become slower (a VPN switched on, a move
 * to a phone's hotspot) is adopted within WINDOW pings instead of every new
 * sample being rejected against a minimum the network can no longer reach.
 */
(function (root) {
    'use strict';

    /** Samples kept; the offset is read off the fastest of them. */
    const WINDOW = 8;

    /** Pings sent back to back on connect, so the first estimate is not one sample. */
    const BURST = 6;
    const BURST_GAP_MS = 150;

    /**
     * The steady cadence. The ping is also the heartbeat and carries the
     * state's sequence number, so it is what heals a lost update — which is
     * why it keeps going while paused, only slower.
     */
    const PING_PLAYING_MS = 5000;
    const PING_PAUSED_MS = 15000;

    /** Weight of the old value in the displayed round-trip average (Syncplay's 0.85). */
    const RTT_WEIGHT = 0.85;

    /**
     * Milliseconds since the epoch, from the monotonic clock. Date.now() can
     * step backwards when the OS corrects the time, and a step in the middle of
     * an exchange would read as a negative round trip.
     */
    function localNow() {
        const perf = root.performance;
        if (perf && typeof perf.now === 'function' && Number.isFinite(perf.timeOrigin)) {
            return perf.timeOrigin + perf.now();
        }
        return Date.now();
    }

    /** One exchange as { offset, rtt }, or null if the numbers cannot be one. */
    function sample(pong, t3) {
        const c = Number(pong && pong.c);
        const s = Number(pong && pong.s);
        const s2 = Number(pong && pong.s2 !== undefined ? pong.s2 : pong && pong.s);
        const end = Number(t3);
        if (![c, s, s2, end].every(Number.isFinite)) return null;
        if (s2 < s || end < c) return null;

        const rtt = (end - c) - (s2 - s);
        // A negative trip means the far end claims to have held the message
        // longer than it was away — one of the clocks moved mid-exchange.
        if (rtt < 0) return null;
        return { offset: ((s - c) + (s2 - end)) / 2, rtt };
    }

    function createClock() {
        let samples = [];
        let rttAverage = null;

        function fastest() {
            let best = null;
            for (const one of samples) {
                if (!best || one.rtt < best.rtt) best = one;
            }
            return best;
        }

        /** Room time minus local time; 0 until the first sample. */
        function offset() {
            const best = fastest();
            return best ? best.offset : 0;
        }

        return {
            /** Take a pong received at local time `t3`. False if it was not usable. */
            add(pong, t3 = localNow()) {
                const one = sample(pong, t3);
                if (!one) return false;
                samples.push(one);
                if (samples.length > WINDOW) samples = samples.slice(-WINDOW);
                rttAverage = rttAverage === null ? one.rtt : RTT_WEIGHT * rttAverage + (1 - RTT_WEIGHT) * one.rtt;
                return true;
            },
            ready: () => samples.length > 0,
            offset,
            minRtt() {
                const best = fastest();
                return best ? best.rtt : null;
            },
            /** The smoothed round trip, for display and for the release lead. */
            rtt: () => rttAverage,
            toRoom: (local = localNow()) => local + offset(),
            toLocal: (roomTime) => roomTime - offset(),
            reset() {
                samples = [];
                rttAverage = null;
            },
        };
    }

    /** How long until the next heartbeat ping. */
    function pingDelay({ paused = false } = {}) {
        return paused ? PING_PAUSED_MS : PING_PLAYING_MS;
    }

    const PartyClock = {
        WINDOW, BURST, BURST_GAP_MS, PING_PLAYING_MS, PING_PAUSED_MS, RTT_WEIGHT,
        localNow, sample, createClock, pingDelay,
    };

    root.BB = root.BB || {};
    root.BB.PartyClock = PartyClock;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyClock;
})(typeof globalThis !== 'undefined' ? globalThis : this);
