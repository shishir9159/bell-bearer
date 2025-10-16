/**
 * Everything Bell Bearer injects into leetcode.com, and the clock it keeps
 * while a problem is open.
 *
 * Reading the page is not here — that is src/content/leet-read.js, which holds
 * every selector. Talking to Monaco and watching LeetCode's own network calls
 * is not here either — that is src/content/leet-page.js, in the page's own
 * world, which this file only hears from over DOM events.
 *
 * The timer is the part worth reading. We do not draw a count-up of our own:
 * LeetCode has a stopwatch in its toolbar, and two clocks on one screen that
 * disagree by a few seconds is worse than either. So the control is clicked
 * once when a problem opens, and from then on the elapsed time is *read* off
 * its display. That has a consequence — the user can reset it, and a reading
 * that has gone backwards is exactly what a reset looks like — so the elapsed
 * time is the sum of segments rather than the latest reading, and the running
 * segment is closed and a new one started whenever the number drops. Pausing
 * therefore costs nothing, which is the behaviour you want from a stopwatch
 * you are allowed to pause.
 *
 * When the widget cannot be found or read at all, the fallback is the shape
 * src/content/time-limit.js uses: bank the wall-clock gaps, and only those
 * spent with the tab on screen and the window focused. Never by counting
 * ticks — a throttled background tab fires those at a tenth of the rate and
 * would report ten minutes of work as one.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('../shared/settings.js');
    const Dom = ns.Dom || req('../shared/dom.js');
    const Fsrs = ns.Fsrs || req('../shared/fsrs.js');
    const Leet = ns.Leet || req('../shared/leetcode.js');
    const LeetRead = ns.LeetRead || req('./leet-read.js');
    const Theme = ns.Theme || req('./theme.js');

    const VERDICT = 'bb:leet:verdict';
    const CARD_ID = 'bb-leet-grade';

    /**
     * A reading this far below the last one is a reset rather than a wobble.
     * LeetCode's display is whole seconds and our reads are not aligned to
     * its ticks, so a straight `reading < peak` would close a segment every
     * time the two drifted past each other.
     */
    const RESET_SLACK = 2;

    /**
     * `getSettings` reads the content script's settings mirror, and defaults
     * to the schema's own defaults — so a caller that passes none gets the
     * extension at rest rather than a quietly different set to keep in step.
     */
    function createLeetUi({ watcher, notify, getSettings = () => Settings.DEFAULTS }) {
        const on = (key) => getSettings()[key] === true;

        /** The problem the clock is running on, and how it is being kept. */
        let clock = null;

        // ---------------------------------------------------------- clock

        function newClock(slug) {
            return {
                slug,
                /** Segments already closed, in seconds. */
                banked: 0,
                /** The running segment's latest reading, in seconds. */
                peak: 0,
                /** True once LeetCode's own widget has answered even once. */
                widget: false,
                /** Wall-clock fallback: when the current gap started, or 0. */
                since: 0,
                started: false,
            };
        }

        const watching = () => document.visibilityState === 'visible' && document.hasFocus();

        /**
         * Start the clock for `slug`, clicking LeetCode's stopwatch if the
         * setting asks for it.
         *
         * The click is attempted once per problem and not retried: a control
         * that is already running would be *stopped* by a second click, and
         * there is no way to tell the two states apart from outside. Failing
         * to start it is not a failure — the reader will pick up whatever it
         * reads, and the wall clock covers the case where it reads nothing.
         */
        function startClock(slug) {
            clock = newClock(slug);
            clock.since = watching() ? Date.now() : 0;
            if (!on('leetStartTimer')) return;

            const button = LeetRead.timerButton();
            if (!button) return;
            try {
                button.click();
                clock.started = true;
            } catch (_) { /* LeetCode's own control; it may not be ready */ }
        }

        /**
         * Close the running wall-clock gap into `banked`. Called whenever the
         * tab stops being watched, and before anything reads the total.
         */
        function bankWallClock() {
            if (!clock || clock.widget) return;
            const now = Date.now();
            const spent = clock.since ? Math.round((now - clock.since) / 1000) : 0;
            clock.since = watching() ? now : 0;
            if (spent > 0) clock.banked += spent;
        }

        /**
         * Take a reading off LeetCode's stopwatch, if it has one to give.
         *
         * Runs on the shared watcher rather than a timer of its own, which
         * means it runs as often as the page mutates and at worst every few
         * seconds. That rate does not have to be accurate: what is stored is
         * the widget's own number, not a count of how many times we looked.
         */
        function readWidget() {
            if (!clock) return;
            const reading = LeetRead.timerSeconds();
            if (reading === null) return;

            if (!clock.widget) {
                // The widget has answered for the first time. Whatever the
                // wall clock banked up to now was covering for it and is
                // thrown away rather than added — the widget has been running
                // that whole time too, and keeping both would double it.
                clock.widget = true;
                clock.banked = 0;
                clock.since = 0;
            }

            // A reading well below the last one is the user having reset the
            // stopwatch. The segment that was running is closed at its peak
            // and a new one starts, so a reset loses nothing.
            if (reading < clock.peak - RESET_SLACK) {
                clock.banked += clock.peak;
                clock.peak = reading;
                return;
            }
            clock.peak = Math.max(clock.peak, reading);
        }

        /** How long this problem has been worked on, in whole seconds. */
        function elapsedSeconds() {
            if (!clock) return 0;
            if (clock.widget) return Math.round(clock.banked + clock.peak);
            const running = clock.since ? (Date.now() - clock.since) / 1000 : 0;
            return Math.round(clock.banked + running);
        }

        /**
         * The tab stopped or started being looked at.
         *
         * Only the wall-clock path cares: LeetCode's own stopwatch keeps
         * running behind a hidden tab, and it is right to — you can think
         * about a problem while reading something else. The fallback cannot
         * tell thinking from having walked away, so it counts only what it
         * can see.
         */
        function onVisibility() {
            bankWallClock();
        }

        // -------------------------------------------------------- verdicts

        /**
         * A submission came back. Record it against the problem, with the
         * seconds the clock has for it.
         *
         * The problem is read *before* the attempt is recorded, because
         * recording an accept overwrites `solvedAt` — and the previous
         * `solvedAt` is what says which of the failures on record belong to
         * this session. See Leet.failuresSince.
         */
        async function onVerdict(event) {
            let verdict;
            try { verdict = JSON.parse(event.detail); } catch (_) { return; }
            if (!verdict || !verdict.slug) return;

            bankWallClock();
            // A verdict for a problem the clock is not on is still recorded —
            // it happened — but with no time against it, because we have no
            // honest number for it. A zero reads as "not timed" downstream.
            const seconds = clock && clock.slug === verdict.slug ? elapsedSeconds() : 0;

            const before = await Leet.load();
            const problem = Leet.problemsOf(before)[verdict.slug] || null;
            const solvedBefore = problem ? problem.solvedAt : 0;

            const state = await Leet.recordAttempt({
                slug: verdict.slug,
                status: verdict.status,
                seconds,
                runtime: verdict.runtime,
                at: Date.now(),
            });

            const accepted = verdict.status === 'Accepted';
            const after = Leet.problemsOf(state)[verdict.slug] || null;
            const failures = after ? Leet.failuresSince(after, solvedBefore) : 0;

            afterVerdict({ verdict, accepted, seconds, failures, problem: after });
        }

        /**
         * What happens once an attempt is on record.
         *
         * A rejected submission says nothing: the page has already told you,
         * in more detail than a toast could, and a notification per wrong
         * answer on a problem you are iterating over is noise. An accept
         * either opens the grade card or, when that is switched off, says so
         * once and gets out of the way.
         */
        function afterVerdict({ accepted, seconds, failures, problem }) {
            if (!accepted) return;
            if (on('leetGradePrompt') && problem) {
                openGradeCard({ problem, seconds, failures });
                return;
            }
            const spent = seconds ? ` in ${human(seconds)}` : '';
            const tries = failures ? ` after ${failures} wrong ${failures === 1 ? 'try' : 'tries'}` : '';
            notify(`Accepted${spent}${tries}`, 'success');
        }

        // ------------------------------------------------------ grade card

        const retention = () => {
            const percent = Number(getSettings().leetRetention);
            return Number.isFinite(percent) ? Fsrs.clamp(percent / 100, 0.7, 0.97) : 0.9;
        };

        const maxInterval = () => {
            const days = Number(getSettings().leetMaxInterval);
            return Number.isFinite(days) && days > 0 ? Math.round(days) : 365;
        };

        /** "tomorrow" / "in 6 days" / "in 3 months" — how a schedule reads. */
        function inDays(days) {
            if (days <= 1) return 'tomorrow';
            if (days < 31) return `in ${days} days`;
            const months = Math.round(days / 30);
            if (months < 12) return `in ${months} month${months === 1 ? '' : 's'}`;
            const years = Math.round(days / 365);
            return `in ${years} year${years === 1 ? '' : 's'}`;
        }

        /**
         * What each of the four grades would schedule, worked out before any
         * of them is picked.
         *
         * The point of showing it is that the four buttons are otherwise four
         * words with no consequence attached — "Hard" and "Good" mean nothing
         * until you can see that one brings the problem back on Thursday and
         * the other in three weeks.
         */
        function previewIntervals(problem, now) {
            const card = problem.fsrs;
            const elapsed = card && card.reviewedAt ? Math.max(0, (now - card.reviewedAt) / Leet.DAY_MS) : 0;
            const options = { retention: retention(), maxInterval: maxInterval(), now };
            return Fsrs.GRADES.map((grade) => ({
                ...grade,
                days: Fsrs.review(card, grade.id, elapsed, options).interval,
            }));
        }

        function closeGradeCard() {
            const card = document.getElementById(CARD_ID);
            if (card) card.remove();
            document.removeEventListener('keydown', onGradeKey, true);
        }

        function onGradeKey(event) {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            closeGradeCard();
        }

        /**
         * Ask how it went, with the answer already picked.
         *
         * Dismissing is a real answer and leaves the problem ungraded rather
         * than quietly taking the suggestion: an unscheduled problem shows up
         * under "Solved" and can be graded from the dashboard later, whereas a
         * schedule written on the user's behalf is a wrong date they never
         * agreed to and would have to find to fix.
         */
        function openGradeCard({ problem, seconds, failures }) {
            closeGradeCard();
            if (!document.body) return;

            const now = Date.now();
            const suggested = Fsrs.suggestGrade({ seconds, failures, difficulty: problem.difficulty });
            const options = previewIntervals(problem, now);

            const card = document.createElement('div');
            card.id = CARD_ID;
            card.className = 'bb-leet-card';
            card.setAttribute('role', 'dialog');
            card.setAttribute('aria-label', 'How did that go?');

            const spent = seconds ? human(seconds) : 'not timed';
            const tries = failures
                ? `${failures} wrong ${failures === 1 ? 'try' : 'tries'}`
                : 'first try';

            card.innerHTML = `
                <div class="bb-leet-card-head">
                    <span class="bb-leet-card-title">How did that go?</span>
                    <button type="button" class="bb-leet-card-x" data-bb-leet-close="1"
                            title="Leave it ungraded" aria-label="Leave it ungraded">
                        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
                             stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12"></path><path d="M18 6 6 18"></path></svg>
                    </button>
                </div>
                <p class="bb-leet-card-sub">${Dom.escapeHtml(problem.title || problem.slug)} · ${Dom.escapeHtml(spent)} · ${Dom.escapeHtml(tries)}</p>
                <div class="bb-leet-grades" role="group" aria-label="How did that go?">
                    ${options.map((option) => `
                        <button type="button" class="bb-leet-grade${option.id === suggested ? ' is-suggested' : ''}"
                                data-bb-grade="${option.id}" aria-pressed="${option.id === suggested}">
                            <span class="bb-leet-grade-name">${Dom.escapeHtml(option.label)}</span>
                            <span class="bb-leet-grade-when">${Dom.escapeHtml(inDays(option.days))}</span>
                        </button>`).join('')}
                </div>
                <p class="bb-leet-card-foot">Suggested from the clock and the failed tries. Dismiss to leave it ungraded.</p>`;

            document.body.appendChild(card);
            Dom.holdFocus(card);
            document.addEventListener('keydown', onGradeKey, true);

            // Read after it is on the page, so a skin change between problems
            // is picked up; the theme half is synchronous off the page itself.
            Theme.appearance().then((look) => {
                if (card.isConnected) Theme.dress(card, look);
            });

            card.addEventListener('click', (event) => {
                if (event.target.closest('[data-bb-leet-close]')) return closeGradeCard();

                const button = event.target.closest('[data-bb-grade]');
                if (!button) return;
                const grade = Number(button.dataset.bbGrade);
                const chosen = options.find((option) => option.id === grade);
                closeGradeCard();
                Leet.gradeProblem(problem.slug, grade, {
                    retention: retention(), maxInterval: maxInterval(), now: Date.now(),
                });
                notify(`Graded ${chosen.label.toLowerCase()} — back ${inDays(chosen.days)}`, 'success');
            });
        }

        /** "6m 30s" — the same shape src/shared/chess.js writes. */
        function human(seconds) {
            const s = Math.max(0, Math.round(seconds));
            if (s < 60) return `${s}s`;
            const m = Math.floor(s / 60);
            if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
            return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
        }

        // --------------------------------------------------------- the page

        /**
         * File what the page is showing. Runs on every navigation into a
         * problem, so the log knows about a problem the moment it is opened
         * rather than only once something is submitted — which is what makes
         * "seen but never solved" a list that can exist at all.
         */
        function seeProblem() {
            const page = LeetRead.readProblem();
            if (!page) return;
            Leet.see(page);
        }

        /**
         * The watcher task. Never reports itself done: LeetCode rebuilds its
         * toolbar on its own schedule — switching between the description and
         * the editor pane does it — so a task that retired after one good
         * reading would leave the clock frozen for the rest of the session.
         */
        function tick() {
            readWidget();
            return false;
        }

        // ---------------------------------------------------------- wiring

        function install() {
            document.addEventListener(VERDICT, onVerdict);
            document.addEventListener('visibilitychange', onVisibility);
            window.addEventListener('focus', onVisibility);
            window.addEventListener('blur', onVisibility);

            watcher.add('leet-clock', tick);
            onNavigate();
        }

        /**
         * LeetCode navigated. It is a single-page app and announces nothing,
         * so this is called from main.js off the shared observer.
         *
         * A different problem is a different clock — carrying the old one over
         * would file the time spent on the last problem against this one.
         * Landing on the same problem again (LeetCode pushes /description/ and
         * /solutions/ onto the path as you switch panes) keeps the clock that
         * is already running.
         */
        function onNavigate() {
            const slug = LeetRead.slugOf();
            if (!slug) {
                bankWallClock();
                clock = null;
                return;
            }
            if (!clock || clock.slug !== slug) {
                // The toolbar is not up yet on the frame the URL changes, so
                // the click is deferred to the watcher's next pass.
                startClock(slug);
                watcher.add('leet-start', () => {
                    if (!clock || clock.slug !== slug) return true;
                    if (clock.started || !on('leetStartTimer')) return true;
                    const button = LeetRead.timerButton();
                    if (!button) return false;
                    try { button.click(); } catch (_) { /* not ready */ }
                    clock.started = true;
                    return true;
                });
            }
            seeProblem();
        }

        /**
         * A setting changed in the dashboard.
         *
         * Both directions, on the page that is already open — a switch that
         * only takes effect on the next reload reads as a switch that did
         * nothing. Turning something off is the half that needs code; turning
         * it on is just letting the injectors run again.
         */
        function refreshSurfaces() {
            if (!on('leetGradePrompt')) closeGradeCard();
            watcher.schedule();
        }

        return {
            install, onNavigate, refreshSurfaces,
            elapsedSeconds, human, inDays,
            // For the specs, which drive these rather than waiting on a real
            // submission to come back from LeetCode.
            clockFor: () => clock,
            openGradeCard, closeGradeCard, previewIntervals,
        };
    }

    const LeetUi = { createLeetUi, RESET_SLACK, VERDICT };

    root.BB = root.BB || {};
    root.BB.LeetUi = LeetUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = LeetUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
