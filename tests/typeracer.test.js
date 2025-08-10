/**
 * The TypeRacer surfaces, for the parts only a real DOM can answer: reading a
 * race panel built the way the site builds one, a stream of genuine
 * `beforeinput` events arriving through a capture listener on `document`, the
 * caret going up over the quote and coming back off again, and every skin
 * actually reaching what we inject.
 *
 * The arithmetic — folding the keystrokes, the n-gram tables, the correction
 * windows, the drill — is pure and lives in tests/node-check.js, which runs in
 * a second. What is here is everything that needs elements.
 *
 * Two things are stubbed and neither is the thing under test. `location` on
 * this page is the spec runner's, never typeracer.com, so isRacePage is
 * answered directly. And `performance.now` is driven by hand: a typing test
 * measured against a clock some spec slept through would be a test of how
 * fast this machine is.
 *
 * Sound is not stubbed at all, on purpose. Nothing in a test run is a user
 * gesture, so the audio context never starts, and Sfx.play has to be silent
 * rather than throw — which is the same shape as a page the user never
 * clicked on, and worth asserting rather than mocking away.
 *
 * Wrapped, because this file shares the global scope with the other specs.
 */
(function () {
    'use strict';

    const TyperUi = () => window.BB.TyperUi;
    const TyperRead = () => window.BB.TyperRead;
    const Typer = () => window.BB.Typer;
    const Sfx = () => window.BB.Sfx;

    const NO_WATCHER = { add() {}, remove() {}, has: () => false, schedule() {}, stop() {} };

    const HOST_ID = 'bb-typer-test';

    /** Long enough to be a quote, and with a comma in it to fold. */
    const QUOTE = 'The quick brown fox jumps over the lazy dog, again and again.';

    async function waitFor(predicate, what, ms = 3000) {
        const started = Date.now();
        for (;;) {
            let held = false;
            try { held = !!(await predicate()); } catch (_) { held = false; }
            if (held) return;
            if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
            await new Promise((done) => setTimeout(done, 5));
        }
    }

    function teardown() {
        const host = document.getElementById(HOST_ID);
        if (host) host.remove();
        document.querySelectorAll(`.${TyperUi().CARET_CLASS}`).forEach((node) => node.remove());
        document.documentElement.classList.remove(TyperUi().CARET_ON);
        document.querySelectorAll(`[${TyperUi().ANCHOR_ATTR}]`).forEach((node) => {
            node.removeAttribute(TyperUi().ANCHOR_ATTR);
        });
    }

    /**
     * A stand-in race, built out of the hooks typeracer-read.js keys off —
     * the site's own `inputPanel` furniture rather than the generated GWT
     * class names that move with every deploy.
     *
     * `typed` is how much of the quote the site has marked as already typed,
     * which is the only thing telling the caret where you are.
     */
    function racePage({ typed = 0, results = null } = {}) {
        teardown();
        const host = document.createElement('div');
        host.id = HOST_ID;
        host.innerHTML = `
            <table class="inputPanel">
                <tr>
                    <td>
                        <div class="inputPanelText">
                            <span class="txtHighlight">${typed ? QUOTE.slice(0, typed) : ''}</span><span
                                  class="txtUnhighlight">${QUOTE.slice(typed)}</span>
                        </div>
                    </td>
                    <td><input class="txtInput" type="text" style="width:220px"></td>
                </tr>
            </table>
            ${results ? `<table class="raceResults"><tr><td>${results}</td></tr>
                <tr><td><a href="/text?id=3810721">see this text</a></td></tr></table>` : ''}`;
        document.body.appendChild(host);
        return host;
    }

    /** Mark another `count` characters as typed, the way the site would. */
    function markTyped(count) {
        const panel = document.querySelector('.inputPanelText');
        panel.children[0].textContent = QUOTE.slice(0, count);
        panel.children[1].textContent = QUOTE.slice(count);
    }

    /** Put a results table on the page, which is what ends a race. */
    function showResults(text) {
        const host = document.getElementById(HOST_ID);
        const table = document.createElement('table');
        table.className = 'raceResults';
        table.innerHTML = `<tr><td>${text}</td></tr>
            <tr><td><a href="/text?id=3810721">see this text</a></td></tr>`;
        host.appendChild(table);
    }

    /**
     * A UI wired to that page, with the clock in our own hands.
     *
     * install() rather than reaching past it: the capture listener on
     * `document` is the thing being exercised, and calling the handler
     * directly would test a function nobody registers.
     */
    function makeUi({ settings = {}, racePage: isRace = true } = {}) {
        const values = Object.assign({}, window.BB.Settings.DEFAULTS, settings);
        const realIsRacePage = TyperRead().isRacePage;
        const realNow = performance.now;
        let clock = 1000;
        performance.now = () => clock;
        TyperRead().isRacePage = () => isRace;

        const notes = [];
        const ui = TyperUi().createTyperUi({
            watcher: NO_WATCHER,
            notify: (message, type) => notes.push({ message, type }),
            getSettings: () => values,
        });
        ui.install();

        const input = document.querySelector('input.txtInput');

        /** One real InputEvent per character; a `<` is one backspace. */
        const type = (text, { step = 200 } = {}) => {
            for (const ch of text) {
                clock += step;
                const event = ch === '<'
                    ? new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true })
                    : new InputEvent('beforeinput', { inputType: 'insertText', data: ch, bubbles: true, cancelable: true });
                input.dispatchEvent(event);
            }
        };

        return {
            ui,
            notes,
            values,
            type,
            input,
            tick: (ms) => { clock += ms; },
            /**
             * Put the document back. uninstall() is the half that matters:
             * install() puts three listeners on `document`, and without
             * taking them off the third spec in this file would be answered
             * by the first spec's UI as well as its own.
             */
            restore: () => {
                ui.uninstall();
                TyperRead().isRacePage = realIsRacePage;
                performance.now = realNow;
            },
        };
    }

    // ----------------------------------------------------- reading a page

    suite('typeracer — reading the page', () => {
        test('reads the quote out of TypeRacer-shaped markup', () => {
            racePage();
            assertEqual(TyperRead().quoteText(), QUOTE);
            teardown();
        });

        test('the box to listen on is the one you can type in', () => {
            racePage();
            const input = document.querySelector('input.txtInput');
            assert(TyperRead().inputBox() === input, 'the live box was passed over');

            // Between races the site leaves the box in the page and disables
            // it; a listener on that would report a race that never started.
            input.readOnly = true;
            assertEqual(TyperRead().inputBox(), null);
            teardown();
        });

        test('a panel with no quote in it reports nothing', () => {
            racePage();
            document.querySelector('.inputPanelText').textContent = 'Waiting…';
            assertEqual(TyperRead().quoteText(), null, 'a short string was believed to be a quote');
            teardown();
        });

        test('the scoreboard is read, and the quote id with it', () => {
            racePage({ results: 'You finished 2nd out of 5! Speed: 84 WPM Accuracy: 97.4%' });
            assertDeepEqual(TyperRead().readResult(), { wpm: 84, accuracy: 97.4, place: 2, of: 5 });
            assertEqual(TyperRead().quoteId(), '3810721');
            teardown();
        });
    });

    // ------------------------------------------------------- typing a race

    suite('typeracer — typing a race', () => {
        test('a real beforeinput on the page lands in the stream', () => {
            racePage();
            const page = makeUi();
            page.ui.sync();
            page.type('The quick');

            const race = page.ui.currentRace();
            assert(race, 'no race was started by the quote appearing');
            assertEqual(race.depth, 9);
            assertEqual(race.events.map((one) => one.ch).join(''), 'The quick');
            assert(race.events.every((one) => one.ok), 'a correct run reported a mistake');

            page.restore();
            teardown();
        });

        test('a backspace arrives as its own event and steps the position back', () => {
            racePage();
            const page = makeUi();
            page.ui.sync();
            page.type('Tx<h');

            const race = page.ui.currentRace();
            assertEqual(race.depth, 2);
            assertEqual(race.events.filter((one) => one.del).length, 1);
            assertEqual(race.events[3].expected, 'h', 'the retype was compared against the wrong position');

            page.restore();
            teardown();
        });

        test('a race is recorded when the results panel turns up', async () => {
            MockChrome.reset({ localStore: {} });
            racePage();
            const page = makeUi();
            page.ui.sync();
            page.type(QUOTE.slice(0, 30));
            showResults('Speed: 84 WPM Accuracy: 97.4%');
            page.ui.sync();

            await waitFor(async () => (await Typer().load()).races.length === 1, 'the race to be written');
            const [race] = (await Typer().load()).races;
            assertEqual(race.wpm, 84, 'the number the user just saw on screen');
            assertEqual(race.accuracy, 97.4);
            assertEqual(race.chars, 30);
            assertEqual(race.quoteId, '3810721');
            assertEqual(page.ui.currentRace(), null, 'the stream was not let go of');

            page.restore();
            teardown();
        });

        test('nothing is recorded while tracking is off', async () => {
            MockChrome.reset({ localStore: {} });
            racePage();
            const page = makeUi({ settings: { typerTrack: false } });
            page.ui.sync();
            page.type(QUOTE.slice(0, 30));
            showResults('Speed: 84 WPM Accuracy: 97.4%');
            page.ui.sync();

            assertEqual((await Typer().load()).races.length, 0);
            page.restore();
            teardown();
        });

        test('the tables are built from the keystrokes, not from the scoreboard', async () => {
            MockChrome.reset({ localStore: {} });
            racePage();
            const page = makeUi();
            page.ui.sync();
            // "The quick" at a steady 200ms: every pair inside it is one
            // reading, and none of them is anything TypeRacer publishes.
            page.type('The quick brown fox');
            showResults('Speed: 84 WPM Accuracy: 100%');
            page.ui.sync();

            await waitFor(async () => Object.keys((await Typer().load()).grams.bi).length > 0,
                'the n-gram table to be written');
            const { grams } = await Typer().load();
            assertEqual(grams.bi.th.n, 1, 'the pair "Th" was not folded down to "th"');
            assertEqual(grams.bi.th.ms, 200);
            assert(grams.tri.the, 'no trigram was credited at all');

            page.restore();
            teardown();
        });
    });

    // ---------------------------------------------------------- the caret

    suite('typeracer — the typing caret', () => {
        test('the default draws nothing and leaves the page alone', () => {
            racePage({ typed: 10 });
            const page = makeUi();
            page.ui.sync();
            page.ui.drawCaret();

            assertEqual(page.ui.caretMode(), 'site');
            assertEqual(document.querySelector(`.${TyperUi().CARET_CLASS}`), null);
            assert(!document.documentElement.classList.contains(TyperUi().CARET_ON),
                'the page was marked for a caret that was never drawn');

            page.restore();
            teardown();
        });

        test('a shape goes up over the quote and stands the site’s own down', () => {
            racePage({ typed: 10 });
            const page = makeUi({ settings: { typerCaret: 'bar' } });
            page.ui.sync();
            page.ui.drawCaret();

            const caret = document.querySelector(`.${TyperUi().CARET_CLASS}`);
            assert(caret, 'nothing was drawn');
            assertEqual(caret.dataset.bbCaret, 'bar');
            assert(/translate\(/.test(caret.style.transform), `not placed: "${caret.style.transform}"`);
            assert(parseFloat(caret.style.height) > 0, 'the caret has no height');
            assert(document.documentElement.classList.contains(TyperUi().CARET_ON),
                'TypeRacer’s own marking is still up beside ours');
            assert(document.querySelector('.txtUnhighlight').hasAttribute(TyperUi().ANCHOR_ATTR),
                'the element holding the next character was not marked');

            page.restore();
            teardown();
        });

        test('the caret moves with the quote rather than staying put', () => {
            racePage({ typed: 4 });
            const page = makeUi({ settings: { typerCaret: 'block' } });
            page.ui.sync();
            page.ui.drawCaret();
            const first = document.querySelector(`.${TyperUi().CARET_CLASS}`).style.transform;

            markTyped(30);
            page.ui.drawCaret();
            const second = document.querySelector(`.${TyperUi().CARET_CLASS}`).style.transform;
            assert(first !== second, `the caret stayed at ${first} across thirty characters`);

            page.restore();
            teardown();
        });

        test('turning it off gives the page back exactly as it was', () => {
            racePage({ typed: 10 });
            const page = makeUi({ settings: { typerCaret: 'outline' } });
            page.ui.sync();
            page.ui.drawCaret();
            assert(document.querySelector(`.${TyperUi().CARET_CLASS}`), 'nothing was drawn to begin with');

            page.values.typerCaret = 'site';
            page.ui.refreshSurfaces();

            assertEqual(document.querySelector(`.${TyperUi().CARET_CLASS}`), null, 'the caret was left up');
            assert(!document.documentElement.classList.contains(TyperUi().CARET_ON), 'the class was left on');
            assertEqual(document.querySelector(`[${TyperUi().ANCHOR_ATTR}]`), null, 'the mark was left on the quote');
            // Nothing was removed from the page, so the quote is untouched.
            assertEqual(document.querySelector('.inputPanelText').textContent.replace(/\s+/g, ' ').trim(), QUOTE);

            page.restore();
            teardown();
        });

        test('a quote that cannot be read draws no caret rather than a wrong one', () => {
            racePage({ typed: 10 });
            const page = makeUi({ settings: { typerCaret: 'bar' } });
            page.ui.sync();
            page.ui.drawCaret();
            assert(document.querySelector(`.${TyperUi().CARET_CLASS}`), 'nothing was drawn to begin with');

            // The site renamed its panel out from under us.
            document.querySelector('.inputPanelText').className = 'somethingElse';
            page.ui.drawCaret();
            assert(!page.ui.caretGaveUp(), 'one miss is the gap between races');
            page.ui.drawCaret();
            assert(page.ui.caretGaveUp(), 'it kept guessing');
            assertEqual(document.querySelector(`.${TyperUi().CARET_CLASS}`), null);
            assert(!document.documentElement.classList.contains(TyperUi().CARET_ON), 'the page was not given back');

            page.restore();
            teardown();
        });

        test('uninstalling takes the caret and the class with it', () => {
            racePage({ typed: 10 });
            const page = makeUi({ settings: { typerCaret: 'underline' } });
            page.ui.sync();
            page.ui.drawCaret();
            assert(document.querySelector(`.${TyperUi().CARET_CLASS}`), 'nothing was drawn');

            page.restore();
            assertEqual(document.querySelector(`.${TyperUi().CARET_CLASS}`), null);
            assert(!document.documentElement.classList.contains(TyperUi().CARET_ON));
            teardown();
        });
    });

    // ----------------------------------------------------------- the skins

    suite('typeracer — every skin reaches the caret', () => {
        for (const skin of ['default', 'riso', 'medieval', 'deco']) {
            test(`the caret is dressed for ${skin}`, async () => {
                MockChrome.reset({ localStore: { skin } });
                racePage({ typed: 10 });
                const page = makeUi({ settings: { typerCaret: 'block' } });
                page.ui.sync();
                page.ui.drawCaret();

                await waitFor(() => {
                    const drawn = document.querySelector(`.${TyperUi().CARET_CLASS}`);
                    return drawn && drawn.dataset.bbSkin;
                }, 'the caret to be dressed');

                const caret = document.querySelector(`.${TyperUi().CARET_CLASS}`);
                assert(caret.classList.contains('bb-themed'),
                    'undressed, so none of the --bb-* tokens resolve and it draws as nothing at all');
                assertEqual(caret.dataset.bbSkin, skin);
                assert(caret.dataset.bbTheme === 'light' || caret.dataset.bbTheme === 'dark',
                    `the light/dark half was not set: ${caret.dataset.bbTheme}`);

                page.restore();
                teardown();
            });
        }
    });

    // ----------------------------------------------------------- the sound

    suite('typeracer — the sound stays out of the way', () => {
        test('a page that never got a gesture is silent rather than broken', () => {
            // Nothing in a test run is a user gesture, so the context never
            // starts — the same shape as a page the user has not clicked on.
            // play() has to return, not throw: it sits inside a keydown
            // handler on a typing test.
            Sfx().unlock();
            for (const id of Sfx().VOICE_IDS) Sfx().play(id, { volume: 100 });
            Sfx().play('click', { volume: 150, detune: -36 });
            Sfx().play('nonesuch');
            assert(true, 'reaching here is the assertion');
        });

        test('typing with sound on costs the page nothing it can notice', () => {
            racePage();
            const page = makeUi({ settings: { typerSound: true, typerSoundVolume: 80 } });
            page.ui.sync();
            // The real handler, the real Sfx, and no context behind it.
            page.type('The quick brown fox');
            assertEqual(page.ui.currentRace().depth, 19, 'the sound path swallowed a keystroke');

            page.restore();
            teardown();
        });
    });
})();
