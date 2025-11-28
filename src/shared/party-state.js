/**
 * A watch party's playback, as one vector rather than a stream of events.
 *
 *     { seq, media: { site, id }, paused, pos, rate, at, by, hold }
 *
 * "Alice pressed play" forwarded as an event is only right if it arrives, and
 * arrives once, and in order, and to someone whose player was where Alice's
 * was. A vector that says "playing from 612.4s at 1x since room time T" is
 * right whenever it arrives: a late joiner reads it and is done, a duplicate
 * changes nothing, and a stale one loses to a higher `seq`. Latency stops being
 * an error and becomes a delay, because the position is extrapolated from `at`
 * rather than read off the moment the message landed.
 *
 * The authority (party-room.js, and the Zig/Go server that implements the
 * same rules) is the only thing that writes a vector. Members send intents —
 * what they did and where they were — and this module holds the two rules that
 * turn an intent into the next vector: whether it is valid at all, and whether
 * it collides with somebody else's change that it never saw.
 */
(function (root) {
    'use strict';

    const OPS = Object.freeze(['play', 'pause', 'seek', 'rate', 'media']);

    /** A day of video; anything past it is a broken player, not a long film. */
    const MAX_POS = 86400;

    /** The speed ladder's own ends — see shared/speed.js. */
    const MIN_RATE = 0.25;
    const MAX_RATE = 5;

    /**
     * How far an intent's own timestamp is believed. A member whose clock
     * estimate is off (the first ping has not come back yet) must not be able
     * to backdate a seek by a minute, or schedule one into next week.
     */
    const AT_PAST_MS = 3000;
    const AT_FUTURE_MS = 500;

    /**
     * Two changes this close together, from two people, where the second was
     * made without having seen the first, are a collision: both clicked pause
     * and play at once. The first one wins and the second person snaps to it.
     * Past this window a stale `base` is a person acting deliberately on what
     * they could see, and is let through.
     */
    const CONFLICT_MS = 1500;

    /** What a site's media id may look like. A peer never sends us a URL. */
    const MEDIA_ID = Object.freeze({
        youtube: /^[A-Za-z0-9_-]{11}$/,
        netflix: /^\d{1,12}$/,
    });

    function blank() {
        return { seq: 0, media: null, paused: true, pos: 0, rate: 1, at: 0, by: null, hold: null };
    }

    /**
     * Where the video should be at room time `now`. A future `at` is a
     * scheduled start — the hold releasing everyone on the same frame — and
     * until then the answer is the position it will start from.
     */
    function expected(state, now) {
        if (!state) return 0;
        if (state.paused || state.hold || !(now > state.at)) return state.pos;
        return state.pos + ((now - state.at) / 1000) * state.rate;
    }

    /** Playing, but not yet: a release whose start is still ahead. */
    function scheduled(state, now) {
        return !!state && !state.paused && !state.hold && state.at > now;
    }

    function validMedia(media) {
        if (!media || typeof media !== 'object') return null;
        const site = String(media.site || '');
        const id = String(media.id || '');
        return MEDIA_ID[site] && MEDIA_ID[site].test(id) ? { site, id } : null;
    }

    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    const isCount = (n) => Number.isInteger(n) && n >= 0;

    /**
     * An intent off the wire, checked and normalised, or null. Everything a
     * peer sends is untrusted — in a party of friends that mostly guards
     * against a player that reports NaN, but it is the same check the server
     * makes against strangers.
     */
    function validateIntent(msg, now) {
        if (!msg || typeof msg !== 'object' || !OPS.includes(msg.op)) return null;
        if (!isCount(msg.id) || !isCount(msg.base)) return null;

        const pos = Number(msg.pos);
        if (!Number.isFinite(pos)) return null;

        const out = { id: msg.id, base: msg.base, op: msg.op, pos: clamp(pos, 0, MAX_POS) };

        const at = Number(msg.at);
        out.at = Number.isFinite(at) ? clamp(at, now - AT_PAST_MS, now + AT_FUTURE_MS) : now;

        if (msg.op === 'rate') {
            const rate = Number(msg.rate);
            if (!Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE) return null;
            out.rate = rate;
        }
        if (msg.op === 'media') {
            out.media = validMedia(msg.media);
            if (!out.media) return null;
            // A new video starts paused unless the member was already playing
            // it — the host's autoplay into the next episode.
            out.paused = msg.paused !== false;
        }
        return out;
    }

    /**
     * Does an intent built on `base` collide with the last change?
     * `last` is { seq, by, changedAt } — changedAt in room time, when the
     * authority accepted it.
     */
    function conflicts(last, memberId, base, now) {
        if (!last || base === last.seq) return false;
        if (last.by === memberId) return false;
        return now - last.changedAt < CONFLICT_MS;
    }

    /**
     * The vector after an accepted intent. Every op carries where the member
     * was and when, so each one rebases the extrapolation rather than
     * trusting the old `pos`/`at` pair to still describe the room.
     *
     * An explicit play, pause, seek or change of video clears a hold: somebody
     * acting on the room outranks waiting for somebody's buffer. A change of
     * rate does not — it says nothing about whether to wait.
     */
    function apply(state, intent, memberId) {
        const next = { ...state, seq: state.seq + 1, by: memberId, pos: intent.pos, at: intent.at };
        switch (intent.op) {
            case 'play': next.paused = false; break;
            case 'pause': next.paused = true; break;
            case 'rate': next.rate = intent.rate; break;
            case 'media': next.media = intent.media; next.paused = intent.paused; break;
            default: break;
        }
        if (intent.op !== 'rate') next.hold = null;
        return next;
    }

    const PartyState = {
        OPS, MAX_POS, MIN_RATE, MAX_RATE, AT_PAST_MS, AT_FUTURE_MS, CONFLICT_MS, MEDIA_ID,
        blank, expected, scheduled, validMedia, validateIntent, conflicts, apply,
    };

    root.BB = root.BB || {};
    root.BB.PartyState = PartyState;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyState;
})(typeof globalThis !== 'undefined' ? globalThis : this);
