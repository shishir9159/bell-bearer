/**
 * Synthesised sound: one AudioContext, a frozen table of voices, and a
 * `play()` cheap enough to call from inside a keydown handler.
 *
 * Nothing here loads a file, so there is no `web_accessible_resources` entry
 * and nothing to wait for before the first keystroke can click. The shape is
 * the low-clock beep from src/content/chess.js — an oscillator through a gain
 * envelope — and with it the two rules that code learned the hard way:
 *
 *   - **Chrome refuses to start Web Audio outside a user gesture** ("The
 *     AudioContext was not allowed to start"), so unlock() is called from the
 *     first pointerdown or keydown and is a no-op after. play() returns early
 *     whenever the context is not `running`, so a page that never got a
 *     gesture is silent rather than broken.
 *   - **Gain is not capped at 1** the way an `<audio>` element's volume is,
 *     so a volume setting above 100 really is louder.
 *
 * play() sits on the keystroke path of src/content/typeracer-ui.js, which is
 * a typing test: it reads no layout, allocates two nodes and returns, and it
 * throws nothing. A context that went away mid-race costs the sound, never
 * the keystroke.
 */
(function (root) {
    'use strict';

    /**
     * What each voice sounds like. `freq` is where it starts, `then` where it
     * slides to over the decay — which is what makes the three chimes read as
     * events rather than as another key.
     *
     * The gains differ per voice rather than being normalised: a sawtooth at
     * the same gain as a sine is roughly twice as loud, and the point of the
     * table is that picking a voice does not also mean re-picking the volume.
     */
    const VOICES = Object.freeze({
        click: Object.freeze({ type: 'square',   freq: 620,  decay: 0.035, gain: 0.16 }),
        thock: Object.freeze({ type: 'triangle', freq: 180,  decay: 0.070, gain: 0.30 }),
        blip:  Object.freeze({ type: 'sine',     freq: 1040, decay: 0.030, gain: 0.12 }),
        error: Object.freeze({ type: 'sawtooth', freq: 160,  decay: 0.090, gain: 0.22 }),
        word:  Object.freeze({ type: 'sine',     freq: 780,  decay: 0.050, gain: 0.10 }),
        start: Object.freeze({ type: 'sine',     freq: 440,  decay: 0.180, gain: 0.20, then: 660 }),
        done:  Object.freeze({ type: 'sine',     freq: 660,  decay: 0.220, gain: 0.22, then: 880 }),
        best:  Object.freeze({ type: 'sine',     freq: 660,  decay: 0.180, gain: 0.24, then: 990 }),
        // The chess low-clock tone, which was the original of all of this —
        // see src/content/chess.js. Two separate beeps rather than a slide,
        // which is what `gap` means: at low volume a slide is easy to miss and
        // two notes are not, and that sound is the whole point of the setting.
        low:   Object.freeze({ type: 'sine',     freq: 880,  decay: 0.140, gain: 0.30, then: 1180, gap: 0.18 }),
    });

    /** What the settings `<select>` is built from, so adding a voice is one edit. */
    const VOICE_IDS = Object.freeze(Object.keys(VOICES));

    /** The voices offered as the sound a key makes — the rest are events. */
    const KEY_VOICE_IDS = Object.freeze(['click', 'thock', 'blip']);

    /**
     * An exponential ramp cannot reach zero, so this is the floor it starts
     * from and returns to. Low enough to be silence, above zero so the ramp
     * is legal.
     */
    const SILENT = 0.0001;

    let ctx = null;

    /** Whether this page has Web Audio at all. Firefox and Chrome both do. */
    function available() {
        return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    }

    /**
     * Create or resume the context — only ever from inside a user gesture.
     *
     * Safe to call on every keystroke: once the context is running this is
     * one comparison. Everything is swallowed, because a page that refuses
     * Web Audio is a page that should be quiet, not a page that throws out of
     * a keydown handler.
     */
    function unlock() {
        if (ctx && ctx.state === 'running') return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            if (!ctx) ctx = new Ctx();
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        } catch (_) { /* no Web Audio on this page */ }
    }

    /**
     * Play one voice. Returns nothing and throws nothing.
     *
     * `volume` is a percent, and above 100 it really is louder. `detune` is
     * in cents, and is how a run of letters is kept from sounding like a
     * metronome — the caller pitches by position. It is set on the node
     * rather than folded into the frequency so the arithmetic happens on the
     * audio thread rather than here.
     */
    function play(id, { volume = 100, detune = 0 } = {}) {
        const voice = VOICES[id];
        // Not yet unlocked by a gesture, muted, or a voice that does not
        // exist: stay quiet rather than make the browser warn.
        if (!voice || !(volume > 0) || !ctx || ctx.state !== 'running') return;

        try {
            const at = ctx.currentTime;
            // Ramped rather than switched: a square edge on the envelope is a
            // click of its own, and a click at 150% volume is unpleasant.
            const peak = Math.max(SILENT, voice.gain * (volume / 100));

            const note = (start, freq, slideTo) => {
                const oscillator = ctx.createOscillator();
                const gain = ctx.createGain();

                oscillator.type = voice.type;
                oscillator.frequency.setValueAtTime(freq, start);
                if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + voice.decay);
                if (detune) oscillator.detune.setValueAtTime(detune, start);

                gain.gain.setValueAtTime(SILENT, start);
                gain.gain.exponentialRampToValueAtTime(peak, start + 0.006);
                gain.gain.exponentialRampToValueAtTime(SILENT, start + voice.decay);

                oscillator.connect(gain).connect(ctx.destination);
                oscillator.start(start);
                // Stopped a little past the envelope, so the node is collected
                // rather than left running silently for the life of the page.
                oscillator.stop(start + voice.decay + 0.02);
            };

            // `then` alone is a slide; `then` with a `gap` is a second note
            // that far behind the first. Two notes carry at a low volume in a
            // way a slide does not, which is why the distinction exists.
            if (voice.gap) {
                note(at, voice.freq);
                note(at + voice.gap, voice.then);
            } else {
                note(at, voice.freq, voice.then);
            }
        } catch (_) { /* the context went away; nothing to play through */ }
    }

    /** 'running' once a gesture has opened it, else whatever it is. For the specs. */
    const state = () => (ctx ? ctx.state : 'none');

    const Sfx = { VOICES, VOICE_IDS, KEY_VOICE_IDS, available, unlock, play, state };

    root.BB = root.BB || {};
    root.BB.Sfx = Sfx;
    if (typeof module !== 'undefined' && module.exports) module.exports = Sfx;
})(typeof globalThis !== 'undefined' ? globalThis : this);
