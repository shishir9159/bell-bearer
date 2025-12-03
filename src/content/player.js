/**
 * Playback control: speed, skipping, seeking, and the temporary speed boost.
 *
 * Three things used to make speed "buggy sometimes", and all three are handled
 * here:
 *
 *  1. The site fights back. YouTube resets playbackRate to its own remembered
 *     value whenever the player loads a new source (a new video, or an ad), and
 *     Netflix/Reddit reset it outright. The old fix was a setInterval every
 *     500ms re-asserting the rate, which burned a timer on every page of every
 *     site and still lost races against the reset.
 *  2. Changes made through the site's own speed menu were treated as noise, so
 *     the extension would silently pull the rate back.
 *  3. Nothing distinguished "the page reset us" from "the user changed it".
 *
 * The rule now: a rate change we did not make is the user's new intent, UNLESS
 * it lands in the short window after the media source changed — that window is
 * the page resetting us, and we re-assert once. No polling; capture-phase media
 * listeners on `document` see every <video> on the page, including ones created
 * later, so there is nothing to re-attach when the player is rebuilt.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Speed = ns.Speed || req('../shared/speed.js');

    /** How long after a source change a rate change counts as the page resetting us. */
    const REAPPLY_WINDOW_MS = 4000;

    /** Cap re-assertions per source change so we never loop against a hostile player. */
    const MAX_REAPPLIES = 4;

    const BOOST_RATE = 3;

    /** How long a rate we wrote may take to come back as its ratechange. */
    const OWN_RATE_MS = 1000;

    function createPlayer({ getVideoElement, notify, shouldRemember = () => true }) {
        /** The rate the user asked for, or null while they have not asked. */
        let desiredRate = null;

        /**
         * Rates we wrote, each until its ratechange comes back. This was an
         * `applying` flag set around the write, but ratechange is a queued
         * event: the flag was already cleared when it ran, so every write of
         * ours read as the user's — and a boost at 3x was adopted as their
         * chosen speed. Matching the value is what tells our event apart.
         */
        let written = [];

        /**
         * { step } while a watch party owns the rate. The party nudges it to
         * keep in sync, which must never become the rate remembered here, and
         * a speed step is a change for the whole room rather than this player.
         */
        let held = null;

        let sourceChangedAt = 0;
        let reapplies = 0;

        /** { previousRate, timer } while a temporary boost is running. */
        let boost = null;

        // --- reading -------------------------------------------------------

        function currentRate() {
            const video = getVideoElement();
            return video ? video.playbackRate : Speed.DEFAULT_RATE;
        }

        function currentTime() {
            const video = getVideoElement();
            return video ? video.currentTime : 0;
        }

        // --- writing -------------------------------------------------------

        /**
         * Apply `rate` and remember it as the user's intent.
         * Returns the rate the element actually accepted, or null with no video.
         */
        function setRate(rate, { announce = true, remember = true } = {}) {
            const video = getVideoElement();
            if (!video) return null;

            const target = Speed.clamp(rate);
            // A plain assignment is all that is needed. Never redefine the
            // property: replacing the native setter with a value makes reads
            // return the new number while the video keeps its old rate, which
            // is the "speed changed but nothing sounds different" failure.
            video.playbackRate = target;
            written.push({ rate: video.playbackRate, until: Date.now() + OWN_RATE_MS });

            if (remember) desiredRate = video.playbackRate;
            if (announce) notify(`Playback speed: ${Speed.format(video.playbackRate)}`, 'info');
            return video.playbackRate;
        }

        /**
         * Step one rung up (+1), down (-1), or back to 1x (0).
         * Reads the live playbackRate rather than a cached value, so a change
         * made through the site's own menu is the starting point.
         */
        function stepSpeed(direction) {
            const video = getVideoElement();
            if (!video) return null;

            cancelBoost({ restore: false }); // an explicit change wins over the boost
            if (held && held.step) return held.step(direction);
            return setRate(Speed.step(video.playbackRate, direction));
        }

        const faster = () => stepSpeed(1);
        const slower = () => stepSpeed(-1);
        const resetSpeed = () => stepSpeed(0);

        // --- temporary boost -----------------------------------------------

        /**
         * Run at BOOST_RATE for `seconds`, then go back.
         *
         * Re-triggering during a boost extends it without losing the original
         * rate; changing speed another way cancels it, so the restore can never
         * overwrite a choice the user made in the meantime.
         */
        function boostSpeed(seconds) {
            const video = getVideoElement();
            if (!video) return null;

            const previousRate = boost ? boost.previousRate : (desiredRate ?? video.playbackRate);
            if (boost) clearTimeout(boost.timer);

            // remember:false — the boost is not the user's standing preference,
            // so a source reset during it restores what they actually chose.
            setRate(BOOST_RATE, { announce: false, remember: false });
            notify(`Speed boost: ${Speed.format(BOOST_RATE)} for ${seconds}s`, 'info');

            boost = {
                previousRate,
                timer: setTimeout(() => {
                    boost = null;
                    if (!getVideoElement()) return;
                    setRate(previousRate, { announce: false });
                    notify(`Speed restored to ${Speed.format(previousRate)}`, 'info');
                }, seconds * 1000),
            };
            return BOOST_RATE;
        }

        function cancelBoost({ restore = true } = {}) {
            if (!boost) return;
            const { previousRate, timer } = boost;
            clearTimeout(timer);
            boost = null;
            if (restore) setRate(previousRate, { announce: false });
        }

        // --- seeking -------------------------------------------------------

        function seekTo(time) {
            const video = getVideoElement();
            if (!video) return false;
            video.currentTime = Math.max(0, Number(time) || 0);
            const played = video.play();
            if (played && typeof played.catch === 'function') played.catch(() => { /* autoplay blocked */ });
            return true;
        }

        function skip(seconds) {
            const video = getVideoElement();
            if (!video) return false;

            // duration is NaN until metadata loads, and Infinity on a live
            // stream; Math.min against either would poison currentTime.
            const limit = Number.isFinite(video.duration) ? video.duration : Infinity;
            const target = Math.min(Math.max(0, video.currentTime + seconds), limit);
            video.currentTime = target;

            const label = seconds >= 0 ? 'forward' : 'backward';
            notify(`Skipped ${label} ${Math.abs(seconds)}s`, 'info');
            return true;
        }

        // --- keeping the rate stuck ----------------------------------------

        function onSourceChanged(event) {
            if (event.target !== getVideoElement()) return;
            sourceChangedAt = Date.now();
            reapplies = 0;
        }

        /**
         * Re-assert the remembered rate once the new source is ready. YouTube
         * resets playbackRate as part of loading, so writing before that has no
         * effect — this runs on `loadeddata`, after the reset has happened.
         */
        function onSourceReady(event) {
            if (held || desiredRate === null || !shouldRemember()) return;
            const video = getVideoElement();
            if (event.target !== video) return;
            if (Speed.sameRate(video.playbackRate, desiredRate)) return;
            setRate(desiredRate, { announce: false });
        }

        /**
         * Whether this ratechange is one of our own writes arriving. A match
         * is not used up: the handler reads the element's rate as it is now,
         * so two writes in a row (a boost straight after a step) deliver two
         * events that both read the second rate.
         */
        function ownRate(rate) {
            const now = Date.now();
            written = written.filter((one) => one.until > now);
            return written.some((one) => Speed.sameRate(one.rate, rate));
        }

        function onRateChange(event) {
            const video = getVideoElement();
            if (event.target !== video) return;
            if (ownRate(video.playbackRate) || held || desiredRate === null) return;
            if (Speed.sameRate(video.playbackRate, desiredRate)) return;

            const withinReset = Date.now() - sourceChangedAt < REAPPLY_WINDOW_MS;
            if (withinReset && shouldRemember() && reapplies < MAX_REAPPLIES) {
                // The page reset us while loading — put it back.
                reapplies++;
                setRate(desiredRate, { announce: false });
                return;
            }

            // Anything else is the user driving the site's own speed control.
            // Adopt it, so our next step continues from where they left off.
            desiredRate = video.playbackRate;
        }

        /**
         * Capture-phase listeners on `document` catch media events from every
         * <video> on the page, present and future — media events do not bubble,
         * but they still travel down the capture path. That is what replaces
         * both the 1s "is there a video yet" poll and the 500ms rate-enforcement
         * interval the old code ran on every site.
         */
        function attach() {
            const options = { capture: true, passive: true };
            document.addEventListener('loadstart', onSourceChanged, options);
            document.addEventListener('emptied', onSourceChanged, options);
            document.addEventListener('loadeddata', onSourceReady, options);
            document.addEventListener('ratechange', onRateChange, options);
        }

        function detach() {
            const options = { capture: true };
            document.removeEventListener('loadstart', onSourceChanged, options);
            document.removeEventListener('emptied', onSourceChanged, options);
            document.removeEventListener('loadeddata', onSourceReady, options);
            document.removeEventListener('ratechange', onRateChange, options);
            cancelBoost({ restore: false });
        }

        /**
         * Hand the rate to a watch party, or take it back. `step(direction)`
         * receives the speed keys while it is held.
         */
        function holdRate(on, { step = null } = {}) {
            held = on ? { step } : null;
        }

        return {
            attach, detach,
            currentRate, currentTime,
            setRate, faster, slower, resetSpeed,
            boostSpeed, cancelBoost,
            seekTo, skip,
            holdRate,
            isRateHeld: () => !!held,
            /** Test/debug view of the remembered rate. */
            get desiredRate() { return desiredRate; },
            set desiredRate(rate) { desiredRate = rate === null ? null : Speed.clamp(rate); },
        };
    }

    const Player = { createPlayer, BOOST_RATE, REAPPLY_WINDOW_MS, MAX_REAPPLIES };

    root.BB = root.BB || {};
    root.BB.Player = Player;
    if (typeof module !== 'undefined' && module.exports) module.exports = Player;
})(typeof globalThis !== 'undefined' ? globalThis : this);
