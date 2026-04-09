/**
 * The TypeRacer surfaces that need a DOM: reading a race panel, real
 * `beforeinput` events through the capture listener on `document`, the caret
 * over the quote, and the skins. The arithmetic is in node-check.js.
 *
 * `isRacePage` is answered directly (this page is never typeracer.com) and
 * `performance.now` is driven by hand. Sound is not stubbed: nothing here is a
 * user gesture, so Sfx.play must be silent rather than throw, as on a page
 * nobody has clicked.
 */
(function () {
    'use strict';

    const TyperUi = () => window.BB.TyperUi;
    const TyperRead = () => window.BB.TyperRead;
    const Typer = () => window.BB.Typer;
    const Sfx = () => window.BB.Sfx;

    const NO_WATCHER = { add() {}, remove() {}, has: () => false, schedule() {}, stop() {} };
    const HOST_ID = 'bb-typer-test';
    const caret = () => document.querySelector(`.${TyperUi().CARET_CLASS}`);
    const caretOn = () => document.documentElement.classList.contains(TyperUi().CARET_ON);

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
        document.querySelectorAll(`[${TyperUi().ANCHOR_ATTR}]`).forEach((node) => node.removeAttribute(TyperUi().ANCHOR_ATTR));
    }

    /**
     * A race built from the site's own `inputPanel` furniture, not its GWT
     * class names. `typed` is how much of the quote is marked typed, which
     * is all that tells the caret where you are.
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

    /** Mark `count` characters as typed, the way the site would. */
    function markTyped(count) {
        const panel = document.querySelector('.inputPanelText');
        panel.children[0].textContent = QUOTE.slice(0, count);
        panel.children[1].textContent = QUOTE.slice(count);
    }

    /** Put a results table on the page, which is what ends a race. */
    function showResults(text) {
        const table = document.createElement('table');
        table.className = 'raceResults';
        table.innerHTML = `<tr><td>${text}</td></tr><tr><td><a href="/text?id=3810721">see this text</a></td></tr>`;
        document.getElementById(HOST_ID).appendChild(table);
    }

    /**
     * A UI over that page, installed and synced, with the clock in hand.
     * Through install(), because the capture listener is what is under test.
     */
    function makeUi({ settings = {} } = {}) {
        const values = Object.assign({}, window.BB.Settings.DEFAULTS, settings);
        const realIsRacePage = TyperRead().isRacePage;
        const realNow = performance.now;
        let clock = 1000;
        performance.now = () => clock;
        TyperRead().isRacePage = () => true;

        const ui = TyperUi().createTyperUi({ watcher: NO_WATCHER, notify() {}, getSettings: () => values });
        ui.install();
        ui.sync();
        const input = document.querySelector('input.txtInput');

        /** One real InputEvent per character; a `<` is one backspace. */
        const type = (text, { step = 200 } = {}) => {
            for (const ch of text) {
                clock += step;
                input.dispatchEvent(ch === '<'
                    ? new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true })
                    : new InputEvent('beforeinput', { inputType: 'insertText', data: ch, bubbles: true, cancelable: true }));
            }
        };

        return {
            ui,
            values,
            type,
            // uninstall() matters: the three listeners on document would otherwise answer every later spec.
            restore: () => {
                ui.uninstall();
                TyperRead().isRacePage = realIsRacePage;
                performance.now = realNow;
            },
        };
    }

    /** A fresh store, a race page and a UI over it for `run`, put back however it ends. */
    async function onRace({ typed = 0, settings, store } = {}, run) {
        MockChrome.reset({ localStore: store });
        racePage({ typed });
        const page = makeUi({ settings });
        try {
            return await run(page);
        } finally {
            page.restore();
            teardown();
        }
    }

    suite('typeracer — reading the page', () => {
        test('reads the quote out of TypeRacer-shaped markup, and no quote out of a short string', () => {
            racePage();
            assertEqual(TyperRead().quoteText(), QUOTE);
            document.querySelector('.inputPanelText').textContent = 'Waiting…';
            assertEqual(TyperRead().quoteText(), null);
            teardown();
        });

        test('the box to listen on is the one you can type in', () => {
            racePage();
            const input = document.querySelector('input.txtInput');
            assert(TyperRead().inputBox() === input, 'the live box was passed over');
            // Between races the site disables the box; listening there reports a race that never started.
            input.readOnly = true;
            assertEqual(TyperRead().inputBox(), null);
            teardown();
        });

        test('the scoreboard is read, and the quote id with it', () => {
            racePage({ results: 'You finished 2nd out of 5! Speed: 84 WPM Accuracy: 97.4%' });
            assertDeepEqual(TyperRead().readResult(), { wpm: 84, accuracy: 97.4, place: 2, of: 5 });
            assertEqual(TyperRead().quoteId(), '3810721');
            teardown();
        });
    });

    suite('typeracer — typing a race', () => {
        test('a real beforeinput on the page lands in the stream', () => onRace({}, ({ ui, type }) => {
            type('The quick');
            const race = ui.currentRace();
            assert(race, 'no race was started by the quote appearing');
            assertEqual(race.depth, 9);
            assertEqual(race.events.map((one) => one.ch).join(''), 'The quick');
            assert(race.events.every((one) => one.ok), 'a correct run reported a mistake');
        }));

        test('a backspace arrives as its own event and steps the position back', () => onRace({}, ({ ui, type }) => {
            type('Tx<h');
            const race = ui.currentRace();
            assertEqual(race.depth, 2);
            assertEqual(race.events.filter((one) => one.del).length, 1);
            assertEqual(race.events[3].expected, 'h', 'the retype was compared against the wrong position');
        }));

        test('a race is recorded when the results panel turns up', () => onRace({}, async ({ ui, type }) => {
            type(QUOTE.slice(0, 30));
            showResults('Speed: 84 WPM Accuracy: 97.4%');
            ui.sync();
            await waitFor(async () => (await Typer().load()).races.length === 1, 'the race to be written');
            const [race] = (await Typer().load()).races;
            assertDeepEqual([race.wpm, race.accuracy, race.chars, race.quoteId], [84, 97.4, 30, '3810721']);
            assertEqual(ui.currentRace(), null, 'the stream was not let go of');
        }));

        test('nothing is recorded while tracking is off', () => onRace({ settings: { typerTrack: false } }, async ({ ui, type }) => {
            type(QUOTE.slice(0, 30));
            showResults('Speed: 84 WPM Accuracy: 97.4%');
            ui.sync();
            assertEqual((await Typer().load()).races.length, 0);
        }));

        test('the tables are built from the keystrokes, not from the scoreboard', () => onRace({}, async ({ ui, type }) => {
            // At a steady 200ms every pair is one reading, and none is anything TypeRacer publishes.
            type('The quick brown fox');
            showResults('Speed: 84 WPM Accuracy: 100%');
            ui.sync();
            await waitFor(async () => Object.keys((await Typer().load()).grams.bi).length > 0, 'the n-gram table to be written');
            const { grams } = await Typer().load();
            assertEqual(grams.bi.th.n, 1, 'the pair "Th" was not folded down to "th"');
            assertEqual(grams.bi.th.ms, 200);
            assert(grams.tri.the, 'no trigram was credited at all');
        }));
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
