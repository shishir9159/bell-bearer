/**
 * Playback-rate model — the single source of truth for every speed control in
 * the extension (keyboard shortcuts, popup buttons, dashboard buttons).
 *
 * Before this module each surface had its own idea of a "step": the keyboard
 * walked a ladder, while the popup and dashboard added a flat +/- 0.5. Pressing
 * ">" and then the popup's "+" therefore produced rates that were not on any
 * ladder, and the next ">" would jump over a step to get back onto one. That is
 * the "speed up and down is buggy sometimes" report. Everything now steps
 * through STEPS, so the sequence is the same no matter which control is used.
 */
(function (root) {
    'use strict';

    /** Rates the UI steps through, ascending. */
    const STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 3.5, 4, 5];

    /** HTMLMediaElement plays silently outside roughly this range; clamp to it. */
    const MIN_RATE = 0.0625;
    const MAX_RATE = 16;

    /** Rates within this distance are "the same rate" (float noise, 0.1+0.2). */
    const EPSILON = 1e-3;

    const DEFAULT_RATE = 1;

    function clamp(rate) {
        const n = Number(rate);
        if (!Number.isFinite(n)) return DEFAULT_RATE;
        return Math.min(MAX_RATE, Math.max(MIN_RATE, n));
    }

    /**
     * The next step strictly above `rate`.
     *
     * Deliberately NOT "index of the nearest step, plus one": at 2.4 the nearest
     * step is 2.5, so that formula returned 3 and skipped 2.5 entirely. Asking
     * for the first step above the current rate always lands on the next rung
     * however far off-ladder the current rate is.
     */
    function nextStep(rate) {
        const current = clamp(rate);
        for (const step of STEPS) {
            if (step > current + EPSILON) return step;
        }
        return STEPS[STEPS.length - 1];
    }

    /** The next step strictly below `rate`. Mirror of nextStep(). */
    function prevStep(rate) {
        const current = clamp(rate);
        for (let i = STEPS.length - 1; i >= 0; i--) {
            if (STEPS[i] < current - EPSILON) return STEPS[i];
        }
        return STEPS[0];
    }

    /** Step `direction` rungs: +1 faster, -1 slower, 0 back to 1x. */
    function step(rate, direction) {
        if (direction > 0) return nextStep(rate);
        if (direction < 0) return prevStep(rate);
        return DEFAULT_RATE;
    }

    function sameRate(a, b) {
        return Math.abs(Number(a) - Number(b)) < EPSILON;
    }

    /** "1.25x" — trims the float noise a raw playbackRate can carry. */
    function format(rate) {
        return `${Math.round(clamp(rate) * 100) / 100}x`;
    }

    const Speed = { STEPS, MIN_RATE, MAX_RATE, DEFAULT_RATE, EPSILON, clamp, nextStep, prevStep, step, sameRate, format };

    root.BB = root.BB || {};
    root.BB.Speed = Speed;
    if (typeof module !== 'undefined' && module.exports) module.exports = Speed;
})(typeof globalThis !== 'undefined' ? globalThis : this);
