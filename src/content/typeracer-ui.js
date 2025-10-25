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
    const Typer = ns.Typer || req('../shared/typeracer.js');
    const TyperRead = ns.TyperRead || req('./typeracer-read.js');

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
            race.events.push({ ch, expected, at, ok: ch === expected });
            race.depth++;
            if (!race.startedAt) race.startedAt = at;
            race.lastAt = at;
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

        // ---------------------------------------------------- the race

        function startRace(quote) {
            race = { quote, events: [], depth: 0, startedAt: 0, lastAt: 0 };
            lastQuote = quote;
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
            Typer.record(record, done.events);
            return record;
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
            if (quote && quote !== lastQuote) startRace(quote);
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
                listening = true;
            }
            watcher.add('typer-race', sync);
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
                listening = false;
            }
            watcher.remove('typer-race');
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
            watcher.schedule();
        }

        /** A setting changed in the dashboard; both directions, on this page. */
        function refreshSurfaces() {
            if (!on('typerTrack')) race = null;
            watcher.schedule();
        }

        return {
            install, uninstall, onNavigate, refreshSurfaces, sync,
            // For the specs, which drive a race rather than waiting on one.
            currentRace: () => race,
            startRace, finishRace,
        };
    }

    const TyperUi = { createTyperUi, QUOTE_SAMPLE_MS, MIN_RACE_CHARS, MAX_EVENTS, deletedCount };

    root.BB = root.BB || {};
    root.BB.TyperUi = TyperUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = TyperUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
