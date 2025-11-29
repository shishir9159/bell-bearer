/**
 * Keeping one player on the room's position once the room is agreed on.
 *
 * The drift is `actual − expected`: positive is ahead of the room. What to do
 * about it depends on how big it is, and the thresholds are Syncplay's, which
 * has spent a decade finding out what people notice:
 *
 *     ≤ deadband     nothing. Players report currentTime in coarse steps and
 *                    chasing that noise is audible.
 *     ≤ seekOver     nudge the rate a few percent until it is gone. Nobody
 *                    hears 4%; everybody hears a seek, and on Netflix every
 *                    seek is a rebuffer.
 *     > seekOver     seek — to where the room will be once the seek is done,
 *                    which is the part naive sync gets wrong: a seek to where
 *                    the room *is* lands behind it by however long the seek took.
 *
 * How long a seek takes is measured, not assumed, so a member on a slow link
 * learns to aim further ahead. A member who needs seek after seek is not
 * helped by more of them — each one is another rebuffer — so three in a minute
 * widens that member's thresholds for a while and they are corrected more
 * gently instead.
 *
 * The controller only decides. It never touches a player, so the adapter can
 * be a <video>, Netflix's own API, or a test.
 */
(function (root) {
    'use strict';

    const PROFILES = Object.freeze({
        // A player that takes a rate change quietly: YouTube, any plain <video>.
        nudge: Object.freeze({ deadband: 0.10, settle: 0.05, seekOver: 1.5, maxNudge: 0.08, horizon: 4 }),
        // Netflix once it has been seen putting the rate back. Every correction
        // is a seek and every seek rebuffers, so the bar for one is higher.
        seekOnly: Object.freeze({ deadband: 0.4, settle: 0.4, seekOver: 1.0, maxNudge: 0, horizon: 4 }),
    });

    /** At most one decision a second; timeupdate arrives about four times as often. */
    const EVAL_MS = 1000;

    const SEEK_COOLDOWN_MS = 5000;
    /** Held off after a seek completes, while the player settles. */
    const SEEK_FREEZE_MS = 1000;
    /** A seek that never reports back stops blocking after this. */
    const SEEK_TIMEOUT_MS = 8000;

    /** First guess at a seek's cost: Syncplay's fast-forward extra. Then measured. */
    const SEEK_LATENCY_START = 0.25;
    const SEEK_LATENCY_WEIGHT = 0.7;
    const SEEK_LATENCY_MAX = 3;

    const STRUGGLE_SEEKS = 3;
    const STRUGGLE_WINDOW_MS = 60000;
    const STRUGGLE_MS = 300000;
    const STRUGGLE_SCALE = 2;

    /** Behind with less than this buffered: a forward seek would land in the hole. */
    const LOW_BUFFER_S = 2;

    /** A nudge within this of the one already written is not written again. */
    const RATE_STEP = 0.005;

    const NONE = Object.freeze({ kind: 'none' });

    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

    function createDrift({ profile = 'nudge' } = {}) {
        let p = PROFILES[profile] || PROFILES.nudge;

        let nudging = false;
        /** The rate we wrote, or null while the player runs at the room's. */
        let applied = null;
        let lastEval = -Infinity;
        let lastSeekAt = -Infinity;
        let seekPendingAt = null;
        let frozenUntil = -Infinity;
        let seekLatency = SEEK_LATENCY_START;
        let seekTimes = [];
        let struggleUntil = -Infinity;

        function nudge(d, rate, force = false) {
            const pull = force ? -Math.sign(d) * p.maxNudge : -clamp(d / p.horizon, -p.maxNudge, p.maxNudge);
            const target = Math.round(rate * (1 + pull) * 1000) / 1000;
            nudging = true;
            if (applied !== null && Math.abs(target - applied) < RATE_STEP) return NONE;
            applied = target;
            return { kind: 'rate', rate: target };
        }

        function release(rate) {
            nudging = false;
            if (applied === null) return NONE;
            applied = null;
            return { kind: 'rate', rate };
        }

        function seek(to, rate, now, { counts }) {
            const restore = applied !== null;
            nudging = false;
            applied = null;
            lastSeekAt = now;
            seekPendingAt = now;
            if (counts) {
                seekTimes = seekTimes.filter((at) => now - at < STRUGGLE_WINDOW_MS).concat(now);
                if (seekTimes.length >= STRUGGLE_SEEKS) {
                    struggleUntil = now + STRUGGLE_MS;
                    seekTimes = [];
                }
            }
            const action = { kind: 'seek', to: Math.max(0, to) };
            if (restore) action.rate = rate;
            return action;
        }

        /**
         * What to do now. `rate` is the room's; `bufferedAhead` is seconds
         * buffered past the playhead, when the adapter can tell.
         */
        function decide({ actual, expected, rate = 1, paused = false, now, bufferedAhead = Infinity }) {
            if (seekPendingAt !== null) {
                if (now - seekPendingAt < SEEK_TIMEOUT_MS) return NONE;
                seekPendingAt = null;
            }
            if (now < frozenUntil || now - lastEval < EVAL_MS) return NONE;
            lastEval = now;

            const d = actual - expected;
            const size = Math.abs(d);
            const scale = now < struggleUntil ? STRUGGLE_SCALE : 1;

            // Paused, the one-way latency of a remote pause is an overshoot to
            // take back, and a seek on a paused player costs nothing to hear.
            if (paused) {
                if (size > p.deadband) return seek(expected, rate, now, { counts: false });
                return release(rate);
            }

            if (size > p.seekOver * scale) {
                const intoTheHole = d < 0 && bufferedAhead < LOW_BUFFER_S;
                if (p.maxNudge > 0 && intoTheHole && size < p.seekOver * scale * 2) return nudge(d, rate, true);
                if (now - lastSeekAt < SEEK_COOLDOWN_MS) return p.maxNudge > 0 ? nudge(d, rate, true) : NONE;
                return seek(expected + seekLatency * rate, rate, now, { counts: true });
            }
            if (nudging && size < p.settle) return release(rate);
            if (p.maxNudge > 0 && (nudging || size > p.deadband * scale)) return nudge(d, rate);
            return NONE;
        }

        return {
            decide,
            /** The seek finished (`seeked` paused, `playing` otherwise), `tookMs` after it was asked for. */
            seekDone(now, tookMs) {
                seekPendingAt = null;
                frozenUntil = now + SEEK_FREEZE_MS;
                const took = Number(tookMs) / 1000;
                if (Number.isFinite(took) && took >= 0) {
                    seekLatency = clamp(SEEK_LATENCY_WEIGHT * seekLatency + (1 - SEEK_LATENCY_WEIGHT) * took, 0, SEEK_LATENCY_MAX);
                }
            },
            /** The room moved (a new vector): start the next decision fresh. */
            reset() {
                nudging = false;
                applied = null;
                lastEval = -Infinity;
            },
            /** Netflix was seen reverting the rate. */
            setProfile(name) {
                if (PROFILES[name]) p = PROFILES[name];
            },
            profile: () => Object.keys(PROFILES).find((name) => PROFILES[name] === p),
            seekLatency: () => seekLatency,
            struggling: (now) => now < struggleUntil,
            nudging: () => nudging,
        };
    }

    const PartyDrift = {
        PROFILES, EVAL_MS, SEEK_COOLDOWN_MS, SEEK_FREEZE_MS, SEEK_TIMEOUT_MS, SEEK_LATENCY_START,
        STRUGGLE_SEEKS, STRUGGLE_MS, LOW_BUFFER_S,
        createDrift,
    };

    root.BB = root.BB || {};
    root.BB.PartyDrift = PartyDrift;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyDrift;
})(typeof globalThis !== 'undefined' ? globalThis : this);
