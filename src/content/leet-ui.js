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
    const Time = ns.Time || req('../shared/time.js');
    const Fsrs = ns.Fsrs || req('../shared/fsrs.js');
    const Leet = ns.Leet || req('../shared/leetcode.js');
    const Keybindings = ns.Keybindings || req('../shared/keybindings.js');
    const LeetRead = ns.LeetRead || req('./leet-read.js');
    const LeetPanel = ns.LeetPanel || req('./leet-panel.js');
    const LeetTemplates = ns.LeetTemplates || req('../shared/leet-templates.js');
    const PouchButton = ns.PouchButton || req('../shared/pouch-button.js');
    const Theme = ns.Theme || req('./theme.js');
    const Bridge = ns.Bridge || req('./bridge.js');

    const VERDICT = 'bb:leet:verdict';
    const REQUEST = 'bb:leet';
    const CODE = 'bb:leet:code';
    const CARD_ID = 'bb-leet-grade';
    const NAV_ID = 'bb-leet-nav';
    const PILL_ID = 'bb-leet-pill';
    const SUGGEST_ID = 'bb-leet-suggest';

    /**
     * Ask the page world what the editor is showing — synchronously, which
     * src/content/bridge.js explains. The fallback shape is returned when
     * leet-page.js is not there at all: every page outside leetcode.com, and
     * leetcode.com itself for the moment between the two scripts loading.
     */
    function askPage() {
        return Bridge.ask(REQUEST, { type: 'read' }, CODE) || { lang: '', selection: '', value: '' };
    }

    /** Put text in at the cursor, over in the page's world. */
    const tellPage = (message) => Bridge.tell(REQUEST, message);

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
    function createLeetUi({ watcher, notify, getSettings = () => Settings.DEFAULTS, openDashboard, goTo }) {
        const on = (key) => getSettings()[key] === true;

        const panel = LeetPanel.createLeetPanel({
            notify,
            openDashboard: openDashboard || (() => {
                try {
                    chrome.runtime.sendMessage({ action: 'openDashboard', hash: '#site/leetcode' });
                } catch (_) { /* the extension reloaded out from under this page */ }
            }),
            // LeetCode is a single-page app, but unlike X it has no router we
            // can reach from outside — its problem links are ordinary <a>s
            // that its own code intercepts, so clicking one on the page is the
            // way in and a plain assign() is the honest fallback.
            goTo: goTo || ((url) => {
                const path = String(url).replace(/^https:\/\/(?:www\.)?leetcode\.com/i, '');
                const link = path && document.querySelector(`a[href="${CSS.escape(path)}"]`);
                if (link) link.click();
                else location.assign(url);
            }),
            appearance: () => Theme.appearance(),
            dress: (element, look) => Theme.dress(element, look),
            insertTemplate: (body) => tellPage({ type: 'insert', text: body }),
            currentLang: () => askPage().lang,
        });

        /** The one open panel, or null. */
        let open = null;

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
        async function onVerdict(verdict) {
            // The slug becomes a key in storage, and anything on the page can
            // dispatch this event: only the shape leet-page.js's slugOf reads
            // out of a problem URL is taken.
            if (!verdict || !/^[A-Za-z0-9-]{1,120}$/.test(String(verdict.slug || ''))) return;

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
            // Not during a mock interview. Grading is a conversation about
            // how it went, and it belongs after the clock has stopped rather
            // than over the top of one that is still running.
            if (mock.on) return;
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
        const human = (seconds) => Time.duration(seconds, 'clock');

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
            // LeetCode re-renders the description pane as you scroll it and
            // when you switch tabs, so anything mock mode is hiding has to be
            // re-marked as it comes back.
            if (mock.on) markHidden();
            return false;
        }

        // ---------------------------------------------- mock interview mode

        /**
         * Mock interview mode: the problem, the editor, a countdown, and
         * nothing else.
         *
         * What it takes away is what an interview does not give you — the
         * difficulty rating, the topic tags, the hints, the similar
         * questions and the way through to somebody else's solution. Knowing
         * a problem is tagged "binary search" is most of the work, which is
         * exactly the help that makes practice not resemble the thing it is
         * practice for.
         *
         * Hidden by CSS off a class on <html>, never by removing anything.
         * Two reasons, and both matter: LeetCode re-renders these panes on
         * its own schedule, so a node deleted now is back in a moment; and
         * leaving is supposed to put the page back exactly as it was, which
         * is one class removal rather than a reconstruction of markup we do
         * not own. The marks left on individual elements are inert on their
         * own — content.css only acts on them while <html> carries the class.
         */
        const MOCK_CLASS = 'bb-leet-mock';
        const MOCK_MARK = 'data-bb-leet-hidden';
        const CHIP_ID = 'bb-leet-chip';

        const mock = { on: false, slug: '', endsAt: 0, timer: 0 };

        const mockMinutes = () => {
            const minutes = Number(getSettings().leetMockMinutes);
            return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 35;
        };

        /** Mark everything mock mode hides, so content.css can act on it. */
        function markHidden() {
            for (const element of LeetRead.hideTargets()) {
                if (element && element.setAttribute) element.setAttribute(MOCK_MARK, '1');
            }
        }

        function startMock(slug) {
            if (!slug) return;
            mock.on = true;
            mock.slug = slug;
            mock.endsAt = Date.now() + mockMinutes() * 60000;

            document.documentElement.classList.add(MOCK_CLASS);
            markHidden();
            // The pill is help too, and it is ours.
            injectNotePill();
            closeGradeCard();

            if (mock.timer) clearInterval(mock.timer);
            mock.timer = setInterval(onMockTick, 1000);
            drawChip();
        }

        /**
         * Leave, putting the page back exactly as it was.
         *
         * The marks are taken off as well as the class. Leaving them would
         * work — they do nothing without the class — but a page left
         * sprinkled with our attributes is a page we did not really give
         * back, and the next mock run re-marks in a single pass anyway.
         */
        function stopMock({ expired = false } = {}) {
            const wasOn = mock.on;
            mock.on = false;
            mock.slug = '';
            mock.endsAt = 0;
            if (mock.timer) { clearInterval(mock.timer); mock.timer = 0; }

            document.documentElement.classList.remove(MOCK_CLASS);
            document.querySelectorAll(`[${MOCK_MARK}]`).forEach((element) => {
                element.removeAttribute(MOCK_MARK);
            });
            const chip = document.getElementById(CHIP_ID);
            if (chip) chip.remove();

            if (wasOn) injectNotePill();
            if (expired) notify(`Time — that was ${mockMinutes()} minutes`, 'warning');
        }

        function onMockTick() {
            if (!mock.on) return;
            // Navigating away from the problem ends the interview. Carrying a
            // countdown onto a different problem would be timing the wrong one.
            if (LeetRead.slugOf() !== mock.slug) return stopMock();
            if (Date.now() >= mock.endsAt) return stopMock({ expired: true });
            drawChip();
        }

        /** The countdown, as mm:ss. */
        function drawChip() {
            if (!mock.on || !document.body) return;
            let chip = document.getElementById(CHIP_ID);
            if (!chip) {
                chip = document.createElement('div');
                chip.id = CHIP_ID;
                chip.className = 'bb-leet-chip';
                chip.innerHTML = '<span class="bb-leet-chip-time"></span>' +
                    '<button type="button" class="bb-leet-chip-x" title="End the mock interview">End</button>';
                chip.querySelector('.bb-leet-chip-x').addEventListener('click', () => stopMock());
                document.body.appendChild(chip);
                Theme.appearance().then((look) => {
                    if (chip.isConnected) Theme.dress(chip, look);
                });
            }

            const left = Math.max(0, Math.round((mock.endsAt - Date.now()) / 1000));
            chip.querySelector('.bb-leet-chip-time').textContent =
                `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
            // The last two minutes are the ones you need to notice.
            chip.classList.toggle('is-low', left <= 120);
        }

        /** Ctrl+Alt+M, and the setting that starts every problem this way. */
        function toggleMock() {
            if (mock.on) stopMock();
            else startMock(LeetRead.slugOf());
        }

        // ------------------------------------------------- template hotkey

        /**
         * The suggester: a small list over the editor, filtered as you type,
         * that drops a template in at the cursor.
         *
         * It has a keydown listener of its own rather than going through
         * src/content/shortcuts.js, and that is not an oversight. Monaco's
         * input is a <textarea>, so Shortcuts.isTypingTarget matches it and
         * swallows every keystroke there — by design, and rightly, because
         * every other shortcut in the extension would otherwise fire while
         * you were typing code. This one has to fire *inside* the editor,
         * which is the one place that guard is built to cover, so it cannot
         * go through it. Capture phase, because Monaco stops a great deal of
         * what happens inside it from reaching the document at all.
         */
        let suggest = null;

        function closeSuggest() {
            if (!suggest) return;
            suggest.element.remove();
            document.removeEventListener('keydown', onSuggestKey, true);
            suggest = null;
        }

        function openSuggest() {
            closeSuggest();
            if (!document.body) return;

            const page = askPage();
            const host = document.createElement('div');
            host.id = SUGGEST_ID;
            host.className = 'bb-leet-suggest';
            host.setAttribute('role', 'dialog');
            host.setAttribute('aria-label', 'Insert a code template');
            host.innerHTML = `
                <input type="text" class="bb-leet-suggest-q" placeholder="Filter templates…"
                       aria-label="Filter templates" spellcheck="false">
                <div class="bb-leet-suggest-list" role="listbox"></div>
                <div class="bb-leet-suggest-foot"></div>`;

            document.body.appendChild(host);
            Dom.holdFocus(host);
            Theme.appearance().then((look) => {
                if (host.isConnected) Theme.dress(host, look);
            });

            suggest = {
                element: host,
                lang: page.lang,
                selection: page.selection,
                rows: [],
                index: 0,
                templates: [],
            };

            const query = host.querySelector('.bb-leet-suggest-q');
            query.addEventListener('input', () => drawSuggest());
            host.querySelector('.bb-leet-suggest-list').addEventListener('click', (event) => {
                const row = event.target.closest('[data-bb-pick]');
                if (row) pickSuggest(Number(row.dataset.bbPick));
            });
            document.addEventListener('keydown', onSuggestKey, true);

            LeetTemplates.load().then((templates) => {
                if (!suggest) return;
                suggest.templates = templates;
                drawSuggest();
            });
            drawSuggest();
            query.focus();
        }

        /**
         * The rows on offer: the templates for this language, and — when
         * there is a selection in the editor — saving that selection as a new
         * one, which is how the list gets filled in the first place.
         */
        function suggestRows() {
            const text = suggest.element.querySelector('.bb-leet-suggest-q').value;
            const rows = LeetTemplates.search(suggest.templates, suggest.lang, text)
                .map((template) => ({ kind: 'insert', template }));
            if (suggest.selection) rows.unshift({ kind: 'save' });
            return rows;
        }

        function drawSuggest() {
            if (!suggest) return;
            suggest.rows = suggestRows();
            suggest.index = Math.min(suggest.index, Math.max(0, suggest.rows.length - 1));

            const list = suggest.element.querySelector('.bb-leet-suggest-list');
            list.innerHTML = suggest.rows.length
                ? suggest.rows.map((row, index) => {
                    const on = index === suggest.index ? ' is-on' : '';
                    if (row.kind === 'save') {
                        return `<button type="button" class="bb-leet-suggest-row is-save${on}" data-bb-pick="${index}" role="option">
                            <span class="bb-leet-suggest-name">Save the selection as a template…</span>
                        </button>`;
                    }
                    return `<button type="button" class="bb-leet-suggest-row${on}" data-bb-pick="${index}" role="option">
                        <span class="bb-leet-suggest-name">${Dom.escapeHtml(row.template.name)}</span>
                        <span class="bb-leet-suggest-lang">${Dom.escapeHtml(LeetTemplates.labelFor(row.template.lang))}</span>
                    </button>`;
                }).join('')
                : '<p class="bb-leet-suggest-none">No templates for this language yet. Select some code and press this again to save one.</p>';

            const known = suggest.lang ? LeetTemplates.labelFor(suggest.lang) : 'every language';
            suggest.element.querySelector('.bb-leet-suggest-foot').textContent =
                `↑↓ to choose · Enter to insert · showing ${known}`;
        }

        function onSuggestKey(event) {
            if (!suggest) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeSuggest();
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopPropagation();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                const n = suggest.rows.length;
                if (n) suggest.index = (suggest.index + step + n) % n;
                drawSuggest();
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                pickSuggest(suggest.index);
            }
        }

        async function pickSuggest(index) {
            if (!suggest) return;
            const row = suggest.rows[index];
            if (!row) return;

            if (row.kind === 'save') {
                const selection = suggest.selection;
                const lang = suggest.lang;
                const name = suggest.element.querySelector('.bb-leet-suggest-q').value.trim();
                closeSuggest();
                // The filter box doubles as the name field: whatever was typed
                // while looking for a template that turned out not to exist is
                // exactly what that template should be called.
                if (!name) {
                    notify('Type a name in the box first, then save the selection', 'warning');
                    return;
                }
                await LeetTemplates.create({ name, lang, body: selection });
                notify(`Saved “${name}” as a ${LeetTemplates.labelFor(lang)} template`, 'success');
                return;
            }

            const { template } = row;
            closeSuggest();
            tellPage({ type: 'insert', text: template.body });
            LeetTemplates.touch(template.id);
        }

        /**
         * The capture-phase keydown that opens it. See openSuggest for why
         * this is not registered through src/content/shortcuts.js.
         */
        function onHotkey(event) {
            const fire = (id) => {
                const binding = Keybindings.resolve(getSettings().shortcuts, id);
                return binding && binding.enabled && Keybindings.matches(event, binding.combo, binding.kind);
            };

            if (fire('leet-templates')) {
                event.preventDefault();
                event.stopPropagation();
                if (suggest) closeSuggest();
                else openSuggest();
                return;
            }
            if (fire('leet-mock')) {
                event.preventDefault();
                event.stopPropagation();
                toggleMock();
            }
        }

        // -------------------------------------------------------- nav row

        /**
         * A Pouch row in LeetCode's top navigation.
         *
         * Always present, the way X's is — the pouch itself is not one of the
         * switchable surfaces, only what it reaches into the page to add is.
         *
         * Never reports itself done, and for X's reason: LeetCode rebuilds
         * that bar on its own schedule, not only on a navigation, so a task
         * that retired after placing the row once would leave it gone for the
         * rest of the session. getElementById keeps that cheap — it only
         * finds the row while the row is still in the document, so the
         * rebuild that took it away is also what puts it back.
         */
        function injectNavEntry() {
            const nav = LeetRead.navSlot();
            if (!nav) return false;
            if (document.getElementById(NAV_ID)) return false;

            const entry = document.createElement('button');
            entry.id = NAV_ID;
            entry.type = 'button';
            entry.className = 'bb-leet-nav';
            entry.title = 'Bell Bearer — your pouch';
            entry.innerHTML = `${PouchButton.ICON}<span class="bb-leet-nav-text">Pouch</span>`;
            entry.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openPouch();
            });

            // At the end of the bar, beside LeetCode's own account cluster,
            // rather than among the Explore / Problems / Contest links — those
            // are LeetCode's sections and ours is not one of them.
            nav.appendChild(entry);
            return false;
        }

        /** Shift+P, and the nav row. Toggles, so a second press closes it. */
        function openPouch(options) {
            if (open && open.alive) {
                open.close();
                open = null;
                return null;
            }
            open = panel.open(options);
            return open;
        }

        // ------------------------------------------------------- note pill

        /**
         * A pill beside the problem's title that opens the pouch on this
         * problem, with the caret already in its note.
         *
         * Off until asked for, like the X surfaces and for the same reason:
         * it is the extension putting something into somebody else's heading,
         * which is not a default to assume for anyone. The pouch itself is
         * always reachable from the nav row.
         *
         * The pill carries the note it is standing for rather than a bare
         * icon, because the note's whole job is to be read on the way past —
         * "did I already work this one out" is the question you have when you
         * land on a problem, and answering it should not cost a click.
         */
        function injectNotePill() {
            // Mock mode takes the pill away too: your own note on a problem
            // is help, and the point of the mode is to sit the problem
            // without any.
            if (!on('leetNoteButton') || mock.on) {
                const placed = document.getElementById(PILL_ID);
                if (placed) placed.remove();
                return false;
            }

            const slug = LeetRead.slugOf();
            const slot = slug && LeetRead.titleSlot();
            if (!slot) return false;

            const existing = document.getElementById(PILL_ID);
            // A pill left over from the previous problem is worse than none:
            // it would open the pouch on something you are no longer reading.
            if (existing && existing.dataset.bbSlug === slug) return false;
            if (existing) existing.remove();

            const pill = document.createElement('button');
            pill.id = PILL_ID;
            pill.type = 'button';
            pill.className = 'bb-leet-pill';
            pill.dataset.bbSlug = slug;
            pill.textContent = 'Note';
            pill.title = 'Open your note on this problem';
            pill.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (open && open.alive) { open.close(); open = null; }
                openPouch({ focus: slug });
            });
            slot.appendChild(pill);

            // The note itself, read behind the pill so placing it never waits
            // on storage. A problem with no note keeps the bare word.
            Leet.load().then((state) => {
                const problem = Leet.problemsOf(state)[slug];
                if (!pill.isConnected || !problem || !problem.note) return;
                pill.textContent = problem.note;
                pill.classList.add('has-note');
            });
            return false;
        }

        // ---------------------------------------------------------- wiring

        let unlistenVerdict = null;

        function install() {
            unlistenVerdict = Bridge.listen(VERDICT, onVerdict);
            document.addEventListener('visibilitychange', onVisibility);
            window.addEventListener('focus', onVisibility);
            window.addEventListener('blur', onVisibility);

            document.addEventListener('keydown', onHotkey, true);

            watcher.add('leet-clock', tick);
            watcher.add('leet-nav', injectNavEntry);
            watcher.add('leet-pill', injectNotePill);

            // A write from anywhere — this page, another tab, the dashboard —
            // repaints whatever of ours is on screen.
            Settings.watch([...Leet.KEYS, ...LeetTemplates.KEYS], () => {
                if (open && open.alive) open.refresh();
            });

            onNavigate();
        }

        /**
         * Undo install().
         *
         * Nothing in the extension calls this — a content script lives as long
         * as its page does — but the specs build a fresh UI per test against
         * one long-lived document, and four listeners on `document` that
         * outlive the object that registered them means the third test is
         * being answered by the first test's UI as well as its own.
         */
        function uninstall() {
            if (unlistenVerdict) unlistenVerdict();
            unlistenVerdict = null;
            document.removeEventListener('visibilitychange', onVisibility);
            document.removeEventListener('keydown', onHotkey, true);
            window.removeEventListener('focus', onVisibility);
            window.removeEventListener('blur', onVisibility);

            watcher.remove('leet-clock');
            watcher.remove('leet-nav');
            watcher.remove('leet-pill');
            watcher.remove('leet-start');

            closeGradeCard();
            closeSuggest();
            if (mock.on) stopMock();
            if (open && open.alive) { open.close(); open = null; }
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
                if (mock.on) stopMock();
                return;
            }
            if (!clock || clock.slug !== slug) {
                // A new problem ends the interview on the old one, and starts
                // one here if every problem is meant to open that way.
                if (mock.on) stopMock();
                if (on('leetMockMode')) startMock(slug);
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
            closeSuggest();

            // Switching mock mode off in the dashboard has to give the page
            // back on the spot — the whole contract of this function. Switching
            // it on starts one here, so the setting behaves the same way
            // whether it was changed before or after the problem was opened.
            if (!on('leetMockMode') && mock.on) stopMock();
            else if (on('leetMockMode') && !mock.on) startMock(LeetRead.slugOf());

            // Turning the pill off is the half that needs code; turning it on
            // is just letting the injector run again, which the schedule does.
            injectNotePill();
            watcher.schedule();
        }

        return {
            install, uninstall, onNavigate, openPouch, refreshSurfaces, panel,
            injectNavEntry, injectNotePill,
            elapsedSeconds, human, inDays,
            // For the specs, which drive these rather than waiting on a real
            // submission to come back from LeetCode.
            clockFor: () => clock,
            openGradeCard, closeGradeCard, previewIntervals,
            openSuggest, closeSuggest, askPage,
            startMock, stopMock, toggleMock, isMock: () => mock.on,
        };
    }

    const LeetUi = { createLeetUi, RESET_SLACK, VERDICT };

    root.BB = root.BB || {};
    root.BB.LeetUi = LeetUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = LeetUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
