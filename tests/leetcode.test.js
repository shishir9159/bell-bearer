/**
 * The LeetCode surfaces, for the parts only a real DOM can answer: a verdict
 * arriving from the page world, the grade card it opens, the pouch panel's
 * rail, mock mode hiding and un-hiding LeetCode's own furniture, and that
 * every skin actually reaches what we inject.
 *
 * The scheduling, the store and the template ordering are pure and live in
 * tests/node-check.js, which runs in a second. What is here is everything
 * that needs elements.
 *
 * Like the X specs, these call the injectors straight off the factory rather
 * than through install(): the watcher only runs its tasks on an animation
 * frame, and a backgrounded tab may not get one for seconds.
 *
 * Wrapped, because this file shares the global scope with the other specs.
 */
(function () {
    'use strict';

    const LeetUi = () => window.BB.LeetUi;
    const LeetRead = () => window.BB.LeetRead;
    const Leet = () => window.BB.Leet;
    const Fsrs = () => window.BB.Fsrs;
    const LeetTemplates = () => window.BB.LeetTemplates;

    const NO_WATCHER = { add() {}, remove() {}, has: () => false, schedule() {}, stop() {} };

    const HOST_ID = 'bb-leet-test';

    /** Let the mocked chrome.* callbacks, which defer through a timer, land. */
    const settle = () => new Promise((done) => setTimeout(done, 0));

    /**
     * Wait until `predicate` holds.
     *
     * Not a fixed number of settles. Recording a verdict is a read, a
     * serialised read-modify-write and a render, and the mock defers every
     * chrome.* callback through a macrotask — so "how many turns is that" is
     * an implementation detail that changed the moment the store grew a write
     * chain. Counting turns made these tests pass for the wrong reason and
     * then fail in a different order; waiting for the thing itself does not.
     */
    async function waitFor(predicate, what, ms = 3000) {
        const started = Date.now();
        for (;;) {
            let held = false;
            // Awaited, so an async predicate is not merely "a promise, which
            // is truthy" — which is exactly how this was wrong the first time.
            try { held = !!(await predicate()); } catch (_) { held = false; }
            if (held) return;
            if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
            await new Promise((done) => setTimeout(done, 5));
        }
    }

    /** The problem as the store now has it, or null. */
    async function stored(slug) {
        return Leet().problemsOf(await Leet().load())[slug] || null;
    }

    /** Send a verdict and wait until it is on record. */
    async function recordVerdict(detail, expectedAttempts) {
        sendVerdict(detail);
        await waitFor(async () => {
            const problem = await stored(detail.slug);
            return problem && problem.attempts.length >= expectedAttempts;
        }, `attempt ${expectedAttempts} on ${detail.slug}`);
        // The predicate above is async, so waitFor resolves on the turn the
        // read came back; the grade card is opened on the turn after it.
        await settle();
    }

    function teardown() {
        const host = document.getElementById(HOST_ID);
        if (host) host.remove();
        ['bb-leet-overlay', 'bb-leet-grade', 'bb-leet-suggest', 'bb-leet-chip', 'bb-leet-nav', 'bb-leet-pill']
            .forEach((id) => {
                const element = document.getElementById(id);
                if (element) element.remove();
            });
        document.documentElement.classList.remove('bb-leet-mock');
        document.querySelectorAll('[data-bb-leet-hidden]').forEach((element) => {
            element.removeAttribute('data-bb-leet-hidden');
        });
    }

    /**
     * A stand-in problem page, built out of the hooks leet-read.js keys off —
     * LeetCode's own `data-track-load` and its semantic hrefs, rather than the
     * generated class names that change with every deploy.
     */
    function problemPage() {
        teardown();
        const host = document.createElement('div');
        host.id = HOST_ID;
        host.innerHTML = `
            <nav id="leetcode-navbar">
                <a href="/problemset/all/">Problems</a>
                <a href="/contest/">Contest</a>
            </nav>
            <div data-track-load="description_content">
                <a href="/problems/two-sum/" class="text-title-large">1. Two Sum</a>
                <div class="text-difficulty-medium">Medium</div>
                <a href="/tag/array/">Array</a>
                <a href="/tag/hash-table/">Hash Table</a>
            </div>
            <div data-track-load="similar_question">Similar questions</div>
            <div data-track-load="hints">Hints</div>
            <div id="solutions_tab">Solutions</div>
            <button data-e2e-locator="console-timer"><span>00:00</span></button>`;
        document.body.appendChild(host);
        return host;
    }

    /**
     * A UI wired to a fake page. `path` is what LeetRead reads the slug from —
     * the spec page is served from file:// or :5601, so location itself can
     * never be a LeetCode URL and slugOf is stubbed instead.
     */
    function makeUi({ path = '/problems/two-sum/', settings = {} } = {}) {
        const values = Object.assign({}, window.BB.Settings.DEFAULTS, settings);
        const realSlugOf = LeetRead().slugOf;
        LeetRead().slugOf = (given) => realSlugOf(given === undefined ? path : given);

        const notes = [];
        const ui = LeetUi().createLeetUi({
            watcher: NO_WATCHER,
            notify: (message, type) => notes.push({ message, type }),
            getSettings: () => values,
        });
        return {
            ui,
            notes,
            values,
            /**
             * Put the document back. uninstall() is the half that matters:
             * install() puts four listeners on `document`, and without taking
             * them off again the third test in this file would be answered by
             * the first test's UI as well as its own.
             */
            restore: () => {
                ui.uninstall();
                LeetRead().slugOf = realSlugOf;
            },
        };
    }

    /** What leet-page.js would have dispatched after a submission came back. */
    function sendVerdict(detail) {
        document.dispatchEvent(new CustomEvent('bb:leet:verdict', { detail: JSON.stringify(detail) }));
    }

    // ------------------------------------------------------ reading a page

    suite('leetcode — reading the page', () => {
        test('reads the problem out of LeetCode-shaped markup', () => {
            problemPage();
            const read = LeetRead();
            assertEqual(read.readTitle(), 'Two Sum', 'the leading number is not part of the name');
            assertEqual(read.readDifficulty(), 'Medium');
            assertDeepEqual(read.readTags(), ['Array', 'Hash Table']);
            teardown();
        });

        test('a difficulty that is not one of the three is dropped', () => {
            problemPage();
            document.querySelector('.text-difficulty-medium').textContent = 'Spicy';
            assertEqual(LeetRead().readDifficulty(), '',
                'an unrecognised word must not be filed as a difficulty');
            teardown();
        });

        test('reads the stopwatch, and says nothing when it cannot', () => {
            problemPage();
            const read = LeetRead();
            assertEqual(read.timerSeconds(), 0, '00:00 is a reading, not a failure');
            document.querySelector('[data-e2e-locator="console-timer"] span').textContent = '12:30';
            assertEqual(read.timerSeconds(), 750);
            document.querySelector('[data-e2e-locator="console-timer"]').remove();
            assertEqual(read.timerSeconds(), null, 'no widget is null, not zero');
            teardown();
        });

        test('hideTargets finds everything mock mode takes away', () => {
            problemPage();
            const targets = LeetRead().hideTargets();
            assert(targets.length >= 5, `expected the pill, tags, similar, hints and solutions; got ${targets.length}`);
            assert(targets.some((el) => el.className === 'text-difficulty-medium'), 'the difficulty is still on show');
            assert(targets.some((el) => el.id === 'solutions_tab'), 'the solutions tab is still on show');
            teardown();
        });
    });

    // ----------------------------------------------------------- the nav row

    suite('leetcode — the nav row', () => {
        test('the Pouch row goes into LeetCode’s own bar', () => {
            problemPage();
            const { ui, restore } = makeUi();
            ui.injectNavEntry();

            const row = document.getElementById('bb-leet-nav');
            assert(row, 'no Pouch row was placed');
            assertEqual(row.closest('nav').id, 'leetcode-navbar', 'it did not land in the nav');
            assert(row.textContent.includes('Pouch'), 'the row is unlabelled');
            restore();
            teardown();
        });

        test('placing it twice does not make two', () => {
            problemPage();
            const { ui, restore } = makeUi();
            ui.injectNavEntry();
            ui.injectNavEntry();
            assertEqual(document.querySelectorAll('#bb-leet-nav').length, 1);
            restore();
            teardown();
        });

        test('a nav LeetCode rebuilt gets the row back', () => {
            // injectNavEntry never retires, because LeetCode rebuilds that bar
            // on its own schedule. Losing the row for the rest of the session
            // is the failure this guards.
            problemPage();
            const { ui, restore } = makeUi();
            ui.injectNavEntry();
            document.getElementById('bb-leet-nav').remove();
            ui.injectNavEntry();
            assert(document.getElementById('bb-leet-nav'), 'the row did not come back');
            restore();
            teardown();
        });
    });

    // ---------------------------------------------------------- the verdict

    suite('leetcode — a submission coming back', () => {
        test('a wrong answer is recorded and says nothing', async () => {
            MockChrome.reset();
            problemPage();
            const { ui, notes, restore } = makeUi();
            ui.install();

            await recordVerdict({ slug: 'two-sum', status: 'Wrong Answer', runtime: '', lang: 'python3' }, 1);

            const problem = await stored('two-sum');
            assert(problem, 'the attempt was not recorded at all');
            assertEqual(problem.attempts.length, 1);
            assertEqual(problem.attempts[0].status, 'Wrong Answer');
            assertEqual(problem.solvedAt, 0, 'a wrong answer is not a solve');
            assertEqual(notes.length, 0, 'the page already told them; a toast is noise');
            assert(!document.getElementById('bb-leet-grade'), 'nothing to grade yet');

            restore();
            teardown();
        });

        test('an accept opens the grade card with the suggestion marked', async () => {
            MockChrome.reset();
            problemPage();
            const { ui, restore } = makeUi();
            ui.install();

            // Two wrong answers, then a right one: two failures on a Medium is
            // Hard by Fsrs.suggestGrade, whatever the clock says. One at a
            // time, because each verdict reads the record before it writes —
            // overlapping them would have both read the same "before".
            await recordVerdict({ slug: 'two-sum', status: 'Wrong Answer' }, 1);
            await recordVerdict({ slug: 'two-sum', status: 'Runtime Error' }, 2);
            await recordVerdict({ slug: 'two-sum', status: 'Accepted', runtime: '52 ms' }, 3);
            await waitFor(() => document.getElementById('bb-leet-grade'), 'the grade card');

            const card = document.getElementById('bb-leet-grade');
            assert(card, 'no grade card appeared');

            const buttons = Array.from(card.querySelectorAll('[data-bb-grade]'));
            assertEqual(buttons.length, 4, 'all four grades are offered');
            const marked = buttons.filter((b) => b.classList.contains('is-suggested'));
            assertEqual(marked.length, 1, 'exactly one is pre-selected');
            assertEqual(marked[0].dataset.bbGrade, '2', 'two failures on a Medium is Hard');
            assertEqual(marked[0].getAttribute('aria-pressed'), 'true');

            // And each one says what it would cost.
            for (const button of buttons) {
                assert(button.textContent.trim().length > 4,
                    'a grade button with no consequence written on it is four words with no meaning');
            }

            restore();
            teardown();
        });

        test('picking a grade writes the schedule', async () => {
            MockChrome.reset();
            problemPage();
            const { ui, restore } = makeUi();
            ui.install();

            await recordVerdict({ slug: 'two-sum', status: 'Accepted', runtime: '52 ms' }, 1);
            await waitFor(() => document.getElementById('bb-leet-grade'), 'the grade card');

            document.querySelector('#bb-leet-grade [data-bb-grade="3"]').click();
            await waitFor(async () => (await stored('two-sum')).fsrs, 'the schedule to be written');

            const problem = await stored('two-sum');
            assert(problem.fsrs, 'nothing was scheduled');
            assertEqual(problem.fsrs.grade, 3);
            assert(problem.fsrs.due > Date.now(), 'it is due in the past');
            assert(!document.getElementById('bb-leet-grade'), 'the card stayed up after answering');

            restore();
            teardown();
        });

        test('dismissing leaves the problem ungraded rather than taking the suggestion', async () => {
            // A schedule written on the user's behalf is a wrong date they
            // never agreed to and would have to go and find to fix.
            MockChrome.reset();
            problemPage();
            const { ui, restore } = makeUi();
            ui.install();

            await recordVerdict({ slug: 'two-sum', status: 'Accepted' }, 1);
            await waitFor(() => document.getElementById('bb-leet-grade'), 'the grade card');

            document.querySelector('#bb-leet-grade [data-bb-leet-close]').click();
            await settle();

            const problem = await stored('two-sum');
            assertEqual(problem.fsrs, null, 'dismissing scheduled it anyway');
            assert(problem.solvedAt > 0, 'but the solve itself is still on record');

            restore();
            teardown();
        });

        test('the grade card stays away when the setting is off', async () => {
            MockChrome.reset();
            problemPage();
            const { ui, notes, restore } = makeUi({ settings: { leetGradePrompt: false } });
            ui.install();

            // Wait for the toast, which is the positive signal that the whole
            // chain has run — then the absence of a card means something.
            await recordVerdict({ slug: 'two-sum', status: 'Accepted' }, 1);
            await waitFor(() => notes.some((n) => /Accepted/.test(n.message)), 'the accepted toast');

            assert(!document.getElementById('bb-leet-grade'), 'the card appeared with the prompt off');

            restore();
            teardown();
        });
    });

    // ------------------------------------------------------------ the panel

    suite('leetcode — the pouch panel', () => {
        /** A log with one problem in each of the three states. */
        function seededStore() {
            const now = Date.now();
            return {
                bbLeetProblems: {
                    'due-one': {
                        slug: 'due-one', title: 'Due One', difficulty: 'Easy', tags: [], url: '',
                        note: 'sliding window', seenAt: now, solvedAt: now - 864e5,
                        attempts: [{ at: now - 864e5, status: 'Accepted', seconds: 300, runtime: '' }],
                        fsrs: { stability: 3, difficulty: 5, due: now - 864e5, reviewedAt: now - 2 * 864e5, reps: 1, lapses: 0 },
                    },
                    'not-solved': {
                        slug: 'not-solved', title: 'Not Solved', difficulty: 'Hard', tags: [], url: '',
                        note: '', seenAt: now, solvedAt: 0,
                        attempts: [{ at: now, status: 'Wrong Answer', seconds: 900, runtime: '' }],
                        fsrs: null,
                    },
                    done: {
                        slug: 'done', title: 'Done', difficulty: 'Medium', tags: [], url: '',
                        note: '', seenAt: now, solvedAt: now,
                        attempts: [{ at: now, status: 'Accepted', seconds: 120, runtime: '' }],
                        fsrs: { stability: 30, difficulty: 5, due: now + 30 * 864e5, reviewedAt: now, reps: 2, lapses: 0 },
                    },
                },
                bbLeetDays: {},
            };
        }

        test('the rail counts each list', async () => {
            MockChrome.reset({ localStore: seededStore() });
            problemPage();
            const { ui, restore } = makeUi();

            ui.openPouch();
            await waitFor(() => document.querySelector("#bb-leet-overlay .bb-leet-rail-row"),
                "the panel to hydrate");

            const rows = Array.from(document.querySelectorAll('#bb-leet-overlay .bb-leet-rail-row'));
            const counts = {};
            rows.forEach((row) => { counts[row.dataset.bbView] = row.querySelector('.bb-leet-rail-n').textContent; });

            assertEqual(counts.due, '1', 'one problem has come round');
            assertEqual(counts.toSolve, '1', 'one was opened and never accepted');
            assertEqual(counts.solved, '1', 'one is solved and not yet due');

            restore();
            teardown();
        });

        test('it opens on Due, and shows the note and when it is wanted', async () => {
            MockChrome.reset({ localStore: seededStore() });
            problemPage();
            const { ui, restore } = makeUi();

            ui.openPouch();
            await waitFor(() => document.querySelector("#bb-leet-overlay .bb-leet-rail-row"),
                "the panel to hydrate");

            const pane = document.querySelector('#bb-leet-overlay .bb-leet-pane');
            assert(pane.textContent.includes('Due One'), 'the due problem is not listed');
            assert(pane.textContent.includes('sliding window'), 'its note is not shown');
            assert(/overdue|due today/.test(pane.textContent), `no due date on the row: ${pane.textContent}`);

            restore();
            teardown();
        });

        test('editing a note here writes it to the store', async () => {
            MockChrome.reset({ localStore: seededStore() });
            problemPage();
            const { ui, restore } = makeUi();

            ui.openPouch();
            await waitFor(() => document.querySelector("#bb-leet-overlay .bb-leet-rail-row"),
                "the panel to hydrate");

            document.querySelector('#bb-leet-overlay [data-bb-note="due-one"]').click();
            const input = document.querySelector('#bb-leet-overlay .bb-leet-note-input');
            assert(input, 'clicking the note did not open a field');
            input.value = 'two pointers, sorted input only';
            document.querySelector('#bb-leet-overlay [data-bb-note-save]').click();
            await waitFor(async () => (await stored('due-one')).note === 'two pointers, sorted input only',
                'the note to be written');

            const problem = await stored('due-one');
            assertEqual(problem.note, 'two pointers, sorted input only');

            restore();
            teardown();
        });

        test('the templates rail offers this language first', async () => {
            const store = seededStore();
            store.bbLeetTemplates = [
                { id: 'lt_a', name: 'vector tricks', lang: 'cpp', body: '', createdAt: 1, usedAt: 0, uses: 0 },
                { id: 'lt_b', name: 'bisect', lang: 'python3', body: 'lo, hi = 0, n', createdAt: 2, usedAt: 0, uses: 0 },
                { id: 'lt_c', name: 'header', lang: '', body: '# notes', createdAt: 3, usedAt: 0, uses: 0 },
            ];
            MockChrome.reset({ localStore: store });
            problemPage();
            const { ui, restore } = makeUi();

            // Stand in for the page world, which is not loaded in the suite.
            const onRead = (event) => {
                if (JSON.parse(event.detail).type !== 'read') return;
                document.dispatchEvent(new CustomEvent('bb:leet:code', {
                    detail: JSON.stringify({ lang: 'python', selection: '', value: '' }),
                }));
            };
            document.addEventListener('bb:leet', onRead);

            ui.openPouch();
            await waitFor(() => document.querySelector("#bb-leet-overlay .bb-leet-rail-row"),
                "the panel to hydrate");

            document.querySelector('#bb-leet-overlay [data-bb-view="__templates__"]').click();
            const names = Array.from(document.querySelectorAll('#bb-leet-overlay .bb-leet-tpl-name'))
                .map((el) => el.textContent);
            // Monaco says "python"; LeetCode calls it python3, and a C++
            // template must not be offered into a Python buffer.
            assertDeepEqual(names, ['bisect', 'header']);

            document.removeEventListener('bb:leet', onRead);
            restore();
            teardown();
        });
    });

    // ------------------------------------------------------- mock interview

    suite('leetcode — mock interview mode', () => {
        test('it hides the difficulty and the tags, and puts them back on exit', () => {
            problemPage();
            const { ui, restore } = makeUi();
            const pill = document.querySelector('.text-difficulty-medium');
            const tag = document.querySelector('a[href="/tag/array/"]');

            ui.startMock('two-sum');
            assert(document.documentElement.classList.contains('bb-leet-mock'), '<html> was not marked');
            assert(pill.hasAttribute('data-bb-leet-hidden'), 'the difficulty is still on show');
            assert(tag.hasAttribute('data-bb-leet-hidden'), 'the tags are still on show');
            assert(document.getElementById('bb-leet-chip'), 'no countdown was drawn');

            ui.stopMock();
            assert(!document.documentElement.classList.contains('bb-leet-mock'), 'the class was left behind');
            assert(!pill.hasAttribute('data-bb-leet-hidden'), 'the difficulty was not given back');
            assert(!tag.hasAttribute('data-bb-leet-hidden'), 'the tags were not given back');
            assert(!document.getElementById('bb-leet-chip'), 'the countdown was left behind');

            restore();
            teardown();
        });

        test('leaving puts the page back exactly as it was', () => {
            // Nothing is removed and nothing is added to LeetCode's own nodes
            // beyond the mark, so the markup has to come back byte-identical.
            problemPage();
            const { ui, restore } = makeUi();
            const before = document.getElementById(HOST_ID).innerHTML;

            ui.startMock('two-sum');
            ui.stopMock();

            assertEqual(document.getElementById(HOST_ID).innerHTML, before,
                'the page was not handed back the way it was found');
            restore();
            teardown();
        });

        test('the countdown runs on the setting’s own minutes', () => {
            problemPage();
            const { ui, restore } = makeUi({ settings: { leetMockMinutes: 45 } });
            ui.startMock('two-sum');

            const shown = document.querySelector('#bb-leet-chip .bb-leet-chip-time').textContent;
            assert(/^4[45]:\d\d$/.test(shown), `expected about 45 minutes, got ${shown}`);

            ui.stopMock();
            restore();
            teardown();
        });

        test('the grade card is suppressed while the clock is running', async () => {
            MockChrome.reset();
            problemPage();
            const { ui, restore } = makeUi();
            ui.install();
            ui.startMock('two-sum');

            // The attempt is still recorded — the interview is not a rehearsal
            // — and waiting for it is what makes the absence below mean
            // something rather than being a race we happened to win.
            await recordVerdict({ slug: 'two-sum', status: 'Accepted' }, 1);

            assert(!document.getElementById('bb-leet-grade'),
                'grading belongs after the clock stops, not over the top of it');
            const problem = await stored('two-sum');
            assertEqual(problem.attempts.length, 1);

            ui.stopMock();
            restore();
            teardown();
        });

        test('the note pill goes away with it and comes back after', async () => {
            MockChrome.reset();
            problemPage();
            const { ui, restore } = makeUi({ settings: { leetNoteButton: true } });

            ui.injectNotePill();
            await waitFor(() => document.getElementById('bb-leet-pill'), 'the pill to be placed');

            ui.startMock('two-sum');
            assert(!document.getElementById('bb-leet-pill'), 'your own note is help too');

            ui.stopMock();
            await waitFor(() => document.getElementById('bb-leet-pill'), 'the pill to come back');

            restore();
            teardown();
        });
    });

    // -------------------------------------------------------------- dressing

    suite('leetcode — dressing the surfaces', () => {
        const SKINS = ['default', 'riso', 'medieval', 'deco'];

        for (const skin of SKINS) {
            test(`the panel is dressed for the ${skin} skin`, async () => {
                MockChrome.reset({ localStore: { skin } });
                problemPage();
                const { ui, restore } = makeUi();

                ui.openPouch();
                await waitFor(() => {
                    const drawn = document.getElementById("bb-leet-overlay");
                    return drawn && drawn.dataset.bbSkin;
                }, "the panel to be dressed");

                const overlay = document.getElementById('bb-leet-overlay');
                assert(overlay, 'no panel opened');
                assert(overlay.classList.contains('bb-themed'),
                    'undressed, so none of the --bb-* tokens resolve and it draws as a white slab');
                assertEqual(overlay.dataset.bbSkin, skin);
                assert(overlay.dataset.bbTheme === 'light' || overlay.dataset.bbTheme === 'dark',
                    `the light/dark half was not set: ${overlay.dataset.bbTheme}`);

                restore();
                teardown();
            });
        }

        test('the grade card is dressed too', async () => {
            MockChrome.reset({ localStore: { skin: 'riso' } });
            problemPage();
            const { ui, restore } = makeUi();
            ui.install();

            await recordVerdict({ slug: 'two-sum', status: 'Accepted' }, 1);
            await waitFor(() => {
                const drawn = document.getElementById('bb-leet-grade');
                // The dressing is read from storage behind the card, so the
                // card existing is not yet the card being dressed.
                return drawn && drawn.dataset.bbSkin;
            }, 'the grade card to be dressed');

            const card = document.getElementById('bb-leet-grade');
            assert(card.classList.contains('bb-themed'), 'the card would draw unthemed');
            assertEqual(card.dataset.bbSkin, 'riso');

            restore();
            teardown();
        });
    });

    // -------------------------------------------------------- the popup

    suite('leetcode — the popup queue', () => {
        const LeetPopup = () => window.BB.LeetPopup;

        function popupHost() {
            teardown();
            const host = document.createElement('div');
            host.id = HOST_ID;
            document.body.appendChild(host);
            return host;
        }

        function makePopup({ slug = '', title = '' } = {}) {
            const opened = [];
            const view = LeetPopup().createView({
                body: popupHost(),
                currentSlug: () => slug,
                currentTitle: () => title,
                onOpen: (url) => opened.push(url),
                onDashboard: () => opened.push('dashboard'),
            });
            return { view, opened, host: document.getElementById(HOST_ID) };
        }

        const problem = (slug, over) => Object.assign({
            slug, title: slug, difficulty: 'Medium', tags: [], url: '',
            note: '', seenAt: Date.now(), solvedAt: 0, attempts: [], fsrs: null,
        }, over);

        test('lists what to do next, due before unsolved', async () => {
            const now = Date.now();
            MockChrome.reset({ localStore: { bbLeetProblems: {
                fresh: problem('fresh'),
                overdue: problem('overdue', {
                    solvedAt: now - 9 * 864e5,
                    fsrs: { stability: 3, difficulty: 5, due: now - 864e5, reviewedAt: now - 4 * 864e5, reps: 1, lapses: 0 },
                }),
            } } });

            const { view, host } = makePopup();
            await view.render();

            const names = Array.from(host.querySelectorAll('.leet-pop-name')).map((el) => el.textContent);
            assertDeepEqual(names, ['overdue', 'fresh'],
                'a half-forgotten problem is worth more than a fresh one');
            assert(host.textContent.includes('overdue'), 'it does not say how late it is');
        });

        test('says so plainly when there is nothing waiting', async () => {
            const now = Date.now();
            MockChrome.reset({ localStore: { bbLeetProblems: {
                done: problem('done', {
                    solvedAt: now,
                    fsrs: { stability: 30, difficulty: 5, due: now + 30 * 864e5, reviewedAt: now, reps: 2, lapses: 0 },
                }),
            } } });

            const { view, host } = makePopup();
            await view.render();

            assert(host.textContent.includes('Everything is complete'), `got: ${host.textContent}`);
            assert(host.textContent.includes('1 problem tracked'), 'it does not say what it knows about');
            assert(!host.querySelector('.leet-pop-row'), 'it listed something anyway');
        });

        test('an empty log says where problems come from', async () => {
            MockChrome.reset({ localStore: {} });
            const { view, host } = makePopup();
            await view.render();
            assert(host.textContent.includes('Everything is complete'));
            assert(/Open a problem on LeetCode/.test(host.textContent),
                'a first-run popup that says only "complete" is a dead end');
        });

        test('offers to add the problem in the tab when it is not on the list', async () => {
            const now = Date.now();
            MockChrome.reset({ localStore: { bbLeetProblems: {
                done: problem('done', {
                    solvedAt: now,
                    fsrs: { stability: 30, difficulty: 5, due: now + 30 * 864e5, reviewedAt: now, reps: 2, lapses: 0 },
                }),
            } } });

            const { view, host } = makePopup({ slug: 'done', title: 'Done' });
            await view.render();

            const add = host.querySelector('[data-leet-add]');
            assert(add, 'no way to put the problem in front of you onto the list');
            assertEqual(add.dataset.leetAdd, 'done');

            add.click();
            await waitFor(async () => {
                const state = await Leet().load();
                return Leet().inQueue(state, 'done', Date.now());
            }, 'the problem to join the queue');

            await view.render();
            assert(host.querySelector('.leet-pop-row'), 'it did not appear in the list afterwards');
            assert(!host.querySelector('[data-leet-add]'), 'it is still offering to add it');
        });

        test('a problem never seen before can be added straight from the popup', async () => {
            // The case that matters most: the content script did not load, so
            // nothing filed it — and the popup is where you would go to find
            // out why nothing is happening.
            MockChrome.reset({ localStore: {} });
            const { view, host } = makePopup({ slug: 'two-sum', title: 'Two Sum' });
            await view.render();

            const add = host.querySelector('[data-leet-add]');
            assert(add, 'nothing offered');
            assert(add.textContent.includes('Two Sum'), 'the button does not name what it would add');

            add.click();
            await waitFor(async () => (await stored('two-sum')), 'the problem to be recorded');

            const saved = await stored('two-sum');
            assertEqual(saved.title, 'Two Sum');
            assertEqual(saved.solvedAt, 0, 'adding it is not solving it');
        });

        test('a problem already on the list is not offered again', async () => {
            MockChrome.reset({ localStore: { bbLeetProblems: { fresh: problem('fresh') } } });
            const { view, host } = makePopup({ slug: 'fresh', title: 'Fresh' });
            await view.render();

            assert(!host.querySelector('[data-leet-add]'), 'it offered to add something already there');
            assert(host.textContent.includes('already on the list'));
        });

        test('off a problem page there is nothing to add', async () => {
            MockChrome.reset({ localStore: {} });
            const { view, host } = makePopup({ slug: '' });
            await view.render();
            assert(!host.querySelector('[data-leet-add]'), 'it offered to add a page that is not a problem');
        });

        test('a long queue is capped, with a way through to the rest', async () => {
            const problems = {};
            for (let i = 0; i < LeetPopup().LIMIT + 4; i++) problems[`p${i}`] = problem(`p${i}`);
            MockChrome.reset({ localStore: { bbLeetProblems: problems } });

            const { view, host, opened } = makePopup();
            await view.render();

            assertEqual(host.querySelectorAll('.leet-pop-row').length, LeetPopup().LIMIT);
            const more = host.querySelector('[data-leet-dashboard]');
            assert(more, 'no way through to the rest');
            assert(more.textContent.includes('4 more'), `got: ${more.textContent}`);
            more.click();
            assertDeepEqual(opened, ['dashboard']);
        });

        test('a row opens that problem', async () => {
            MockChrome.reset({ localStore: { bbLeetProblems: { fresh: problem('fresh') } } });
            const { view, host, opened } = makePopup();
            await view.render();

            host.querySelector('.leet-pop-row').click();
            assertDeepEqual(opened, ['https://leetcode.com/problems/fresh/']);
        });
    });

    // ------------------------------------------- managing templates on the dashboard

    suite('leetcode — managing templates', () => {
        const View = () => window.BB.LeetTemplatesView;

        function panelHost() {
            teardown();
            const host = document.createElement('div');
            host.id = HOST_ID;
            host.setAttribute('data-leet-templates', '');
            document.body.appendChild(host);
            return host;
        }

        test('lists every template with its language and size', async () => {
            MockChrome.reset({ localStore: { bbLeetTemplates: [
                { id: 'lt_a', name: 'bisect', lang: 'python3', body: 'lo = 0\nhi = n', createdAt: 1, usedAt: 0, uses: 3 },
                { id: 'lt_b', name: 'header', lang: '', body: '', createdAt: 2, usedAt: 0, uses: 0 },
            ] } });

            const host = panelHost();
            const panel = View().mountPanel(host);
            await panel.reload();

            const titles = Array.from(host.querySelectorAll('.leet-tpl-title')).map((el) => el.textContent);
            assertDeepEqual(titles, ['bisect', 'header'], 'array order is display order');

            const subs = Array.from(host.querySelectorAll('.leet-tpl-sub')).map((el) => el.textContent);
            assert(subs[0].includes('Python3') && subs[0].includes('2 lines'), `got: ${subs[0]}`);
            assert(subs[0].includes('used 3'), 'it does not say how often it is reached for');
            assert(subs[1].includes('Any language') && subs[1].includes('empty'), `got: ${subs[1]}`);
            teardown();
        });

        test('an empty library says where templates come from', async () => {
            MockChrome.reset({ localStore: { bbLeetTemplates: [] } });
            const host = panelHost();
            await View().mountPanel(host).reload();

            assert(/No templates yet/.test(host.textContent));
            assert(/Ctrl/.test(host.textContent), 'it does not mention the shortcut that makes one');
            teardown();
        });

        test('a new template is written to the store', async () => {
            MockChrome.reset({ localStore: { bbLeetTemplates: [] } });
            const host = panelHost();
            const panel = View().mountPanel(host);
            await panel.reload();

            host.querySelector('[data-leet-tpl-new]').click();
            host.querySelector('.leet-tpl-name-input').value = 'union find';
            host.querySelector('.leet-tpl-lang-input').value = 'cpp';
            host.querySelector('.leet-tpl-body-input').value = 'int find(int x) {\n    return p[x];\n}';
            host.querySelector('[data-leet-tpl-save]').click();

            await waitFor(async () => (await LeetTemplates().load()).length === 1, 'the template to be saved');
            const [saved] = await LeetTemplates().load();
            assertEqual(saved.name, 'union find');
            assertEqual(saved.lang, 'cpp');
            assert(saved.body.includes('    return p[x];'), 'the indentation was trimmed away');
            teardown();
        });

        test('editing one keeps everything it was not asked to change', async () => {
            MockChrome.reset({ localStore: { bbLeetTemplates: [
                { id: 'lt_a', name: 'bisect', lang: 'python3', body: 'old', createdAt: 1, usedAt: 55, uses: 7 },
            ] } });
            const host = panelHost();
            const panel = View().mountPanel(host);
            await panel.reload();

            host.querySelector('[data-leet-tpl-edit]').click();
            host.querySelector('.leet-tpl-body-input').value = 'new body';
            host.querySelector('[data-leet-tpl-save]').click();

            await waitFor(async () => (await LeetTemplates().load())[0].body === 'new body', 'the edit to land');
            const [saved] = await LeetTemplates().load();
            assertEqual(saved.name, 'bisect', 'the name was lost');
            assertEqual(saved.uses, 7, 'the usage count was reset');
            teardown();
        });

        test('a template with no name is refused rather than saved blank', async () => {
            MockChrome.reset({ localStore: { bbLeetTemplates: [] } });
            const host = panelHost();
            await View().mountPanel(host).reload();

            host.querySelector('[data-leet-tpl-new]').click();
            host.querySelector('.leet-tpl-body-input').value = 'something';
            host.querySelector('[data-leet-tpl-save]').click();
            await settle();
            await settle();

            assertEqual((await LeetTemplates().load()).length, 0, 'a nameless template got in');
            teardown();
        });

        test('reordering is a splice and nothing else', async () => {
            MockChrome.reset({ localStore: { bbLeetTemplates: [
                { id: 'lt_a', name: 'first', lang: '', body: '', createdAt: 1, usedAt: 0, uses: 0 },
                { id: 'lt_b', name: 'second', lang: '', body: '', createdAt: 2, usedAt: 0, uses: 0 },
            ] } });
            const host = panelHost();
            const panel = View().mountPanel(host);
            await panel.reload();

            const items = host.querySelectorAll('[data-leet-tpl-id]');
            items[1].dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
            items[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));

            await waitFor(async () => (await LeetTemplates().load())[0].name === 'second', 'the reorder');
            const order = (await LeetTemplates().load()).map((t) => t.name);
            assertDeepEqual(order, ['second', 'first']);
            teardown();
        });
    });

    // ------------------------------------------------------------- Shift+P

    suite('leetcode — Shift+P', () => {
        /**
         * Wire the keyboard the way src/content/main.js does, including the
         * two gates that decide whether the key is ours: the `pouchShortcut`
         * setting, and there being a pouch on this site to open.
         */
        function withKeyboard(settings, run) {
            const made = makeUi({ settings });
            const uninstall = window.BB.Shortcuts.install({
                hasVideo: () => false,
                skip() {}, faster() {}, slower() {}, resetSpeed() {}, boostSpeed() {},
                startRecording() {}, stopRecording() {}, toggleSegment() {},
                openSkim() {}, openHints() {},
                openPouch: () => made.ui.openPouch(),
                canOpenPouch: () => !!made.ui,
                featureOn: (key) => made.values[key] === true,
            }, {
                canRecord: () => false,
                getShortcut: (id) => window.BB.Keybindings.resolve(made.values.shortcuts, id),
                paused: () => false,
            });

            const press = () => window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'P', code: 'KeyP', shiftKey: true, bubbles: true, cancelable: true,
            }));

            return Promise.resolve(run({ press, made })).finally(() => {
                uninstall();
                made.restore();
            });
        }

        test('opens the pouch when the shortcut is switched on', async () => {
            MockChrome.reset();
            problemPage();
            await withKeyboard({ pouchShortcut: true }, async ({ press }) => {
                press();
                await waitFor(() => document.getElementById('bb-leet-overlay'),
                    'the pouch to open on Shift+P');
                assert(document.getElementById('bb-leet-overlay'), 'Shift+P opened nothing');
            });
            teardown();
        });

        test('does nothing at all until it is switched on', async () => {
            // Off by default, like Skim and the link hints: a bare-Shift letter
            // is a large claim to make on somebody's keyboard unasked. The key
            // has to go back to the page untouched, not be swallowed.
            MockChrome.reset();
            problemPage();
            await withKeyboard({ pouchShortcut: false }, async ({ press }) => {
                let defaultPrevented = false;
                const watch = (event) => { defaultPrevented = event.defaultPrevented; };
                window.addEventListener('keydown', watch);
                press();
                window.removeEventListener('keydown', watch);

                await settle();
                assert(!document.getElementById('bb-leet-overlay'), 'it opened with the setting off');
                assert(!defaultPrevented, 'the key was swallowed instead of left to the page');
            });
            teardown();
        });

        test('a second press closes it again', async () => {
            MockChrome.reset();
            problemPage();
            await withKeyboard({ pouchShortcut: true }, async ({ press }) => {
                press();
                await waitFor(() => document.getElementById('bb-leet-overlay'), 'the pouch to open');
                press();
                await settle();
                assert(!document.getElementById('bb-leet-overlay'), 'the second press did not close it');
            });
            teardown();
        });
    });

    // ------------------------------------------------------- the page bridge

    suite('leetcode — the page-world bridge', () => {
        test('the language is read back synchronously', () => {
            // DOM dispatch runs the other world's listener inline, which is
            // what lets currentLang() be a plain function call rather than a
            // promise the panel would have to render around.
            const onRead = (event) => {
                if (JSON.parse(event.detail).type !== 'read') return;
                document.dispatchEvent(new CustomEvent('bb:leet:code', {
                    detail: JSON.stringify({ lang: 'cpp', selection: 'int x;', value: 'int x;' }),
                }));
            };
            document.addEventListener('bb:leet', onRead);

            const { ui, restore } = makeUi();
            const answer = ui.askPage();
            assertEqual(answer.lang, 'cpp');
            assertEqual(answer.selection, 'int x;');

            document.removeEventListener('bb:leet', onRead);
            restore();
        });

        test('with no page world there, it answers blanks rather than hanging', () => {
            const { ui, restore } = makeUi();
            const answer = ui.askPage();
            assertDeepEqual(answer, { lang: '', selection: '', value: '' });
            restore();
        });

        test('the suggester offers to save what is selected', async () => {
            MockChrome.reset({ localStore: { bbLeetTemplates: [] } });
            const onRead = (event) => {
                if (JSON.parse(event.detail).type !== 'read') return;
                document.dispatchEvent(new CustomEvent('bb:leet:code', {
                    detail: JSON.stringify({ lang: 'python', selection: 'lo, hi = 0, n', value: '' }),
                }));
            };
            document.addEventListener('bb:leet', onRead);

            problemPage();
            const { ui, restore } = makeUi();
            ui.openSuggest();
            await waitFor(() => document.querySelector('#bb-leet-suggest .is-save'),
                'the save-the-selection row');

            const saveRow = document.querySelector('#bb-leet-suggest .is-save');
            assert(saveRow, 'nothing offered to save the selection');

            // The filter box doubles as the name field.
            document.querySelector('.bb-leet-suggest-q').value = 'bisect';
            saveRow.click();
            await waitFor(async () => (await LeetTemplates().load()).length === 1,
                'the template to be saved');

            const saved = await LeetTemplates().load();
            assertEqual(saved.length, 1, 'the selection was not saved');
            assertEqual(saved[0].name, 'bisect');
            assertEqual(saved[0].lang, 'python3', 'monaco’s "python" files as LeetCode’s python3');
            assertEqual(saved[0].body, 'lo, hi = 0, n');

            document.removeEventListener('bb:leet', onRead);
            restore();
            teardown();
        });
    });
})();
