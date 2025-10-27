/**
 * Everything Bell Bearer puts into typeracer.com, and the keystroke stream it
 * measures a race from.
 *
 * Reading the page is not here — that is src/content/typeracer-read.js, which
 * holds every selector. There is no page-world half at all, and the header of
 * that file says why.
 *
 * **This is a typing test, so the keystroke path is the whole design.** The
 * two handlers below run in the capture phase on `document` and do exactly one
 * thing: push a small object onto an array held in a closure. No storage, no
 * `getBoundingClientRect`, no DOM writes, no `querySelector`, nothing that can
 * force a layout — the rule `installWatchedTracking` in src/content/main.js
 * was fixed to follow in "fixed the layout read on every youtube timeupdate",
 * and the one place in this extension where breaking it would be felt as
 * *lag in somebody's typing* rather than as a dropped frame.
 *
 * Everything that costs something — reading the quote, finding the results
 * panel, folding the stream into the store — happens on the shared observer's
 * animation frame or once at the end of the race, never on a key.
 *
 * `performance.now()` throughout, never `Date.now()`: it is monotonic and does
 * not jump when the system clock syncs in the middle of a race. Only the
 * race's own timestamp, which is a calendar date, comes from `Date.now()`.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('../shared/settings.js');
    const Typer = ns.Typer || req('../shared/typeracer.js');
    const TyperRead = ns.TyperRead || req('./typeracer-read.js');
    const Keybindings = ns.Keybindings || req('../shared/keybindings.js');
    const Theme = ns.Theme || req('./theme.js');
    const Sfx = ns.Sfx || req('../shared/sfx.js');

    /**
     * How far a key sound is pitched either side of its voice, in cents.
     *
     * By position in the quote, `(index % 7 - 3) * 12`, so a run of letters
     * does not come out as a metronome. Seven because it is coprime with
     * anything you would type in a rhythm, and twelve cents because more than
     * that stops sounding like one keyboard.
     */
    const DETUNE_STEPS = 7;
    const DETUNE_CENTS = 12;

    /** The caret shapes, in the order the hotkey cycles them. */
    const SHAPES = Object.freeze(['site', 'bar', 'block', 'underline', 'outline']);

    const CARET_CLASS = 'bb-typer-caret';
    /** On <html> while we draw, so content.css can stand the site's own down. */
    const CARET_ON = 'bb-typer-caret-on';
    /** On the element holding the next character, which is what that rule aims at. */
    const ANCHOR_ATTR = 'data-bb-typer-anchor';

    /**
     * Two misses in a row and the caret gives up for the rest of the page.
     *
     * One miss is the moment between races when the quote has gone; two in a
     * row is the markup having moved under us. Drawing anyway would put a
     * marker somewhere in the middle of the words you are reading, and it is
     * a kind of wrong the user cannot switch off without going to look for
     * the setting.
     */
    const CARET_MISSES = 2;

    /**
     * How often the quote is re-read while a race is already running.
     *
     * Not every frame. TypeRacer moves its own highlight as you type, so the
     * shared observer fires continuously through a race, and `textContent` on
     * the quote panel concatenates three hundred characters every time it is
     * asked. Four reads a second is enough to notice that the quote has been
     * swapped for a new one, and costs nothing next to sixty.
     */
    const QUOTE_SAMPLE_MS = 250;

    /**
     * Fewer committed characters than this is a false start — a click in the
     * box, a stray letter before the countdown — not a race worth a row.
     */
    const MIN_RACE_CHARS = 10;

    /**
     * The stream cannot grow past this.
     *
     * A quote is about three hundred characters and the worst imaginable race
     * is a few times that. This is not a tuning knob; it is the bound that
     * stops a page which has started firing `beforeinput` at us in a loop from
     * turning one tab into a memory leak.
     */
    const MAX_EVENTS = 4000;

    /**
     * How many characters one `beforeinput` took away.
     *
     * Reading `selectionStart` and `value` off an input is a property read,
     * not a layout read, so it is safe here. A selection being replaced
     * deletes all of it; a word delete is measured off the text rather than
     * guessed at, because guessing 1 would leave the position count wrong for
     * the rest of the race and silently spoil every interval after it.
     */
    function deletedCount(target, inputType) {
        if (!target || target.selectionStart == null) return 1;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        if (end > start) return end - start;
        if (inputType === 'deleteWordBackward') {
            // The whitespace before the caret goes, then the word before
            // that — the order a browser does it in, and the reason this is
            // two replaces rather than one pattern: a single `\s*\S*$` eats
            // the space on the far side of the word as well, and reports one
            // character too many for "the quick".
            const before = String(target.value || '').slice(0, start);
            const after = before.replace(/\s+$/, '').replace(/\S+$/, '');
            return Math.max(1, before.length - after.length);
        }
        return 1;
    }

    function createTyperUi({ watcher, notify, getSettings }) {
        /** The race in progress, or null between them. */
        let race = null;
        /** When the quote was last read, on the observer's clock. */
        let sampledAt = 0;
        /** The quote the last race was typed from, so the same one is not restarted. */
        let lastQuote = '';

        const on = (key) => getSettings()[key] === true;

        /**
         * The caret's own state, kept as plain fields rather than read out of
         * the settings each time. `caretMode` is what scheduleCaret() tests on
         * every committed character, and a settings lookup plus an array
         * membership test per keystroke is exactly the sort of thing this file
         * exists not to do.
         */
        let caretMode = 'site';
        let caretNode = null;
        let caretFrame = 0;
        let caretMisses = 0;
        let caretGaveUp = false;
        let anchored = null;

        /**
         * And the same for the sound, for the same reason. `soundOn` folds in
         * the volume: at zero the whole path below is skipped rather than
         * played silently, so the common case — which is off, since the
         * setting starts off — costs one comparison per keystroke.
         */
        let soundOn = false;
        let soundVoice = 'click';
        let soundVolume = 0;
        let errorSoundOn = true;

        // ------------------------------------------------------ the keys

        /**
         * One committed character.
         *
         * `expected` is the character at our own position in the quote, not
         * one read back off the input: TypeRacer empties the box after every
         * word, so the box's length stops being the position in the quote as
         * soon as the first space goes in.
         */
        function commit(ch, at) {
            const expected = race.quote.charAt(race.depth);
            const ok = ch === expected;
            race.events.push({ ch, expected, at, ok });
            if (soundOn) keySound(ch, ok, race.depth);
            race.depth++;
            if (!race.startedAt) race.startedAt = at;
            race.lastAt = at;
            scheduleCaret();
        }

        /**
         * The sound one key makes. Reached only when `soundOn`, and then it is
         * two comparisons and a call that allocates two audio nodes — no
         * layout, no storage, nothing that can block.
         */
        function keySound(ch, ok, index) {
            // A wrong key is the one thing worth interrupting for, so it takes
            // the error voice ahead of the word one even on a space. With that
            // voice switched off it still clicks like any other key: the
            // setting means "do not tell me differently", not "go quiet".
            if (!ok && errorSoundOn) {
                Sfx.play('error', { volume: soundVolume });
                return;
            }
            if (ch === ' ') {
                Sfx.play('word', { volume: soundVolume });
                return;
            }
            Sfx.play(soundVoice, {
                volume: soundVolume,
                detune: (index % DETUNE_STEPS - Math.floor(DETUNE_STEPS / 2)) * DETUNE_CENTS,
            });
        }

        /**
         * Open the audio context, from inside a gesture and only then.
         *
         * Chrome refuses to start Web Audio that a page did not start in
         * answer to a click or a key, and the first keystroke of a race is
         * both. Sfx.unlock() is a comparison once the context is running, so
         * this costs nothing after the first one.
         */
        function onGesture() {
            if (soundOn) Sfx.unlock();
        }

        function onBeforeInput(event) {
            if (!race || race.events.length >= MAX_EVENTS) return;
            const at = performance.now();
            const type = event.inputType;

            if (type === 'insertText' || type === 'insertCompositionText' || type === 'insertFromPaste') {
                const data = event.data;
                if (!data) return;
                // A paste or an IME commit arrives as one event carrying
                // several characters. They all share a timestamp, which makes
                // every interval between them zero — and zero is below
                // FLOOR_MS, so the store drops them rather than recording a
                // burst of impossibly fast typing.
                for (let i = 0; i < data.length; i++) commit(data[i], at);
                return;
            }

            if (type === 'deleteContentBackward' || type === 'deleteWordBackward' ||
                type === 'deleteByCut' || type === 'deleteContentForward') {
                let gone = deletedCount(event.target, type);
                while (gone-- > 0 && race.depth > 0) {
                    race.events.push({ del: true, at });
                    race.depth--;
                }
            }
        }

        // ---------------------------------------------------- the caret

        /**
         * Ask for one redraw, at most once per frame.
         *
         * Called from inside the keystroke handler, so it is a comparison and
         * — when a caret is actually being drawn — one requestAnimationFrame.
         * With the setting on 'site', which is the default, it is the
         * comparison alone and nothing else in this section ever runs.
         */
        function scheduleCaret() {
            if (caretFrame || caretGaveUp || caretMode === 'site') return;
            caretFrame = requestAnimationFrame(drawCaret);
        }

        /**
         * The box of the next character, not of the element holding it.
         *
         * caretAnchor() hands back the run of text that has not been typed
         * yet, which on TypeRacer is most of the quote — its own rect is a
         * block three lines tall. A Range over the first character of it is
         * the actual glyph, which is the only thing a caret can sensibly sit
         * against, and it costs one range rather than measuring text
         * ourselves against a font we do not know.
         */
        function glyphRect(anchor) {
            const node = anchor.firstChild;
            if (node && node.nodeType === 3 && node.data && node.data.length) {
                try {
                    const range = document.createRange();
                    range.setStart(node, 0);
                    range.setEnd(node, 1);
                    const rect = range.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) return rect;
                } catch (_) { /* the node went away between the frames */ }
            }
            const box = anchor.getBoundingClientRect();
            return box.height > 0 ? box : null;
        }

        function caretElement() {
            if (caretNode && caretNode.isConnected) return caretNode;
            caretNode = document.createElement('span');
            // Dressed for the default skin from the first frame. Theme.appearance
            // is a storage read and so a promise, and a caret drawn before it
            // resolves would have no --bb-accent to take its colour from — one
            // frame of an invisible caret at the start of every race.
            caretNode.className = `${CARET_CLASS} bb-themed`;
            caretNode.setAttribute('aria-hidden', 'true');
            document.body.appendChild(caretNode);
            // The skin and the light/dark of the page underneath, so the
            // caret is in the same ink as everything else we draw.
            Theme.appearance().then((look) => {
                if (caretNode) Theme.dress(caretNode, look);
            }).catch(() => {});
            dressCaret();
            return caretNode;
        }

        /** The shape, the glide and the blink, all of which are CSS. */
        function dressCaret() {
            if (!caretNode) return;
            caretNode.dataset.bbCaret = caretMode;
            // A 70ms transition is the whole "smooth caret" feature: one CSS
            // property, and no animation loop of our own to keep running.
            caretNode.classList.toggle('is-smooth', on('typerCaretSmooth'));
            caretNode.classList.toggle('is-blink', on('typerCaretBlink'));
        }

        function markAnchor(anchor) {
            if (anchored === anchor) return;
            if (anchored) anchored.removeAttribute(ANCHOR_ATTR);
            anchored = anchor;
            if (anchor) anchor.setAttribute(ANCHOR_ATTR, '');
        }

        function drawCaret() {
            caretFrame = 0;
            if (caretMode === 'site' || caretGaveUp) return teardownCaret();

            const anchor = TyperRead.caretAnchor();
            if (!anchor) {
                if (++caretMisses >= CARET_MISSES) {
                    caretGaveUp = true;
                    teardownCaret();
                    // Once, on purpose. A message per keystroke would be a
                    // second bug on top of the first.
                    console.debug('Bell Bearer: cannot tell where you are in the quote; leaving TypeRacer’s own caret');
                }
                return;
            }
            caretMisses = 0;

            const rect = glyphRect(anchor);
            if (!rect) return;

            const node = caretElement();
            markAnchor(anchor);
            document.documentElement.classList.add(CARET_ON);
            node.style.width = `${rect.width}px`;
            node.style.height = `${rect.height}px`;
            // Fixed positioning and a transform: the rect is in viewport
            // coordinates, so there is nothing to convert and nothing to
            // listen to. A scroll leaves the caret behind until the next
            // keystroke, which is a tenth of a second away while anyone is
            // actually racing — cheaper than a scroll listener that fires
            // through every one of them.
            node.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
        }

        /** Take the caret, the mark and the class back off. */
        function teardownCaret() {
            if (caretFrame) { cancelAnimationFrame(caretFrame); caretFrame = 0; }
            if (caretNode) { caretNode.remove(); caretNode = null; }
            markAnchor(null);
            document.documentElement.classList.remove(CARET_ON);
        }

        /** The hotkey: 'site', then each shape, then round again. */
        function cycleCaret() {
            const next = SHAPES[(SHAPES.indexOf(caretMode) + 1) % SHAPES.length];
            Settings.set({ typerCaret: next });
            // Applied here as well as through the settings watcher, so the
            // key feels immediate rather than waiting on a storage round trip.
            applyCaret(next);
            notify(next === 'site' ? 'Caret: TypeRacer’s own' : `Caret: ${next}`, 'success');
        }

        /**
         * Take the caret settings, in both directions.
         *
         * Switching it off has to give the page back on the spot — that is the
         * whole contract of refreshSurfaces(), and the rule twitter-ui.js set.
         */
        function applyCaret(mode) {
            const want = SHAPES.includes(mode) ? mode : 'site';
            if (want !== caretMode) {
                caretMode = want;
                // A shape the user just asked for deserves another try even
                // if the last one gave up.
                caretGaveUp = false;
                caretMisses = 0;
            }
            if (caretMode === 'site') return teardownCaret();
            dressCaret();
            scheduleCaret();
        }

        /** The settings the hot path reads, taken once rather than per key. */
        function applySound() {
            const values = getSettings();
            const volume = Math.max(0, Math.min(150, Number(values.typerSoundVolume) || 0));
            soundVolume = volume;
            soundOn = values.typerSound === true && volume > 0;
            soundVoice = Sfx.KEY_VOICE_IDS.includes(values.typerSoundVoice) ? values.typerSoundVoice : 'click';
            errorSoundOn = values.typerErrorSound === true;
        }

        function onHotkey(event) {
            onGesture();
            const binding = Keybindings.resolve(getSettings().shortcuts, 'typer-caret');
            if (!binding || !binding.enabled) return;
            if (!Keybindings.matches(event, binding.combo, binding.kind)) return;
            event.preventDefault();
            event.stopPropagation();
            cycleCaret();
        }

        // ---------------------------------------------------- the race

        function startRace(quote) {
            race = { quote, events: [], depth: 0, startedAt: 0, lastAt: 0 };
            lastQuote = quote;
            if (soundOn) Sfx.play('start', { volume: soundVolume });
        }

        /**
         * The race is over. Read the scoreboard once, fold the stream into the
         * store, and let the stream go.
         *
         * This is the only place the page is read on behalf of a race, and the
         * only place anything is written to storage — both at a moment when
         * nobody is typing.
         */
        function finishRace() {
            const done = race;
            race = null;
            if (!done || done.depth < MIN_RACE_CHARS) return null;

            const result = TyperRead.readResult();
            const seconds = done.lastAt > done.startedAt ? (done.lastAt - done.startedAt) / 1000 : 0;

            const record = {
                at: Date.now(),
                wpm: result.wpm,
                accuracy: result.accuracy,
                place: result.place,
                of: result.of,
                seconds,
                chars: done.depth,
                quoteId: TyperRead.quoteId(),
            };
            const written = Typer.record(record, done.events);
            if (soundOn) endSound(written);
            return record;
        }

        /**
         * The chime at the end, and whether it is the one for a personal best.
         *
         * Asked of the store rather than kept in a field here: the log is
         * written from every tab, so a best measured against what this page
         * happened to see would congratulate you for beating yourself on a
         * race you had already beaten in another window. The first race ever
         * takes the ordinary chime — there is nothing yet to have beaten.
         */
        function endSound(written) {
            const chime = (state) => {
                const races = (state && state.races) || [];
                const before = races.slice(1);
                const best = before.length && races[0].wpm > Math.max(...before.map((one) => one.wpm));
                Sfx.play(best ? 'best' : 'done', { volume: soundVolume });
            };
            // Played on the spot when the state is already in hand — which is
            // what the specs hand it, and what a store that answered from
            // memory would. A write that has to go to storage first is a
            // promise, and a chime a frame late is still the right chime.
            if (written && typeof written.then === 'function') {
                written.then(chime).catch(() => Sfx.play('done', { volume: soundVolume }));
            } else {
                chime(written);
            }
        }

        /**
         * One pass of the shared observer.
         *
         * Between races this looks for a quote. During one it looks for the
         * results panel, and only glances at the quote every QUOTE_SAMPLE_MS —
         * see the constant for why that is not every frame.
         */
        function sync() {
            if (!on('typerTrack') || !TyperRead.isRacePage()) {
                if (race) race = null;
                return false;
            }

            if (race) {
                if (TyperRead.find('results')) {
                    finishRace();
                    // The quote is gone, so there is nothing to point at.
                    teardownCaret();
                    return false;
                }
                const now = performance.now();
                if (now - sampledAt < QUOTE_SAMPLE_MS) return false;
                sampledAt = now;
                const quote = TyperRead.quoteText();
                // A different quote under a running race is the next race
                // having started without a scoreboard in between. What was
                // typed so far belongs to the old one.
                if (quote && quote !== race.quote) {
                    finishRace();
                    startRace(quote);
                }
                return false;
            }

            const quote = TyperRead.quoteText();
            if (quote && quote !== lastQuote) {
                startRace(quote);
                // A fresh quote is a fresh chance for the caret: the markup
                // that could not be read a moment ago was the gap between
                // races, not a rename.
                caretMisses = 0;
                scheduleCaret();
            }
            return false;
        }

        // --------------------------------------------------------- wiring

        let listening = false;

        function install() {
            if (!listening) {
                // Capture, so the stream is complete whatever TypeRacer's own
                // handlers do with the event afterwards; passive, because
                // nothing here ever cancels one.
                document.addEventListener('beforeinput', onBeforeInput, { capture: true, passive: true });
                document.addEventListener('keydown', onHotkey, true);
                document.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
                listening = true;
            }
            watcher.add('typer-race', sync);
            applyCaret(getSettings().typerCaret);
            applySound();
        }

        /**
         * Undo install().
         *
         * Nothing in the extension calls this — a content script lives as long
         * as its page does — but the specs build a fresh UI per test against
         * one long-lived document, and a capture listener that outlives the
         * object which registered it means the second test's keystrokes are
         * answered by the first test's UI as well as its own.
         */
        function uninstall() {
            if (listening) {
                document.removeEventListener('beforeinput', onBeforeInput, { capture: true });
                document.removeEventListener('keydown', onHotkey, true);
                document.removeEventListener('pointerdown', onGesture, { capture: true });
                listening = false;
            }
            watcher.remove('typer-race');
            teardownCaret();
            race = null;
        }

        /**
         * TypeRacer navigated. It is a single-page app and announces nothing,
         * so this is called from main.js off the shared observer.
         *
         * Leaving the pit abandons whatever was being typed rather than
         * banking it: a race you navigated away from mid-quote has no honest
         * finishing time.
         */
        function onNavigate() {
            race = null;
            lastQuote = '';
            sampledAt = 0;
            teardownCaret();
            caretMisses = 0;
            watcher.schedule();
        }

        /** A setting changed in the dashboard; both directions, on this page. */
        function refreshSurfaces() {
            if (!on('typerTrack')) race = null;
            applyCaret(getSettings().typerCaret);
            applySound();
            watcher.schedule();
        }

        return {
            install, uninstall, onNavigate, refreshSurfaces, sync,
            // For the specs, which drive a race rather than waiting on one.
            currentRace: () => race,
            startRace, finishRace,
            cycleCaret, drawCaret, applyCaret, glyphRect,
            applySound, keySound, endSound,
            caretMode: () => caretMode,
            caretElement: () => caretNode,
            caretGaveUp: () => caretGaveUp,
        };
    }

    const TyperUi = {
        createTyperUi, QUOTE_SAMPLE_MS, MIN_RACE_CHARS, MAX_EVENTS, CARET_MISSES,
        SHAPES, CARET_CLASS, CARET_ON, ANCHOR_ATTR, deletedCount,
    };

    root.BB = root.BB || {};
    root.BB.TyperUi = TyperUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = TyperUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
