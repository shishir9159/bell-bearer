/**
 * The LeetCode workspace on the dashboard: the review queue, the practice
 * heat map, and the notes.
 *
 * Three panels off one store, drawn the way src/page/chess-stats.js draws the
 * chess ones — the Activity view's classes (stat-figure, stat-panel,
 * range-seg, stat-table) so the pages read as one, with a few leet-*
 * additions for what Activity has no use for.
 *
 * Each panel renders wholesale into innerHTML and binds its listeners once on
 * the container, dispatching by delegation. The comment at the head of
 * dashboard.js says why: a per-render listener meant one "remove" click ran
 * three deletes after three renders.
 *
 * Everything interpolated is either LeetCode's text or the user's own note,
 * so it all goes through escapeHtml and the one URL through safeUrlAttr.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Settings, Leet, Fsrs, Dom, Ui, SiteIcons } = BB;

    const esc = Dom.escapeHtml;
    const att = Dom.escapeAttr;

    const ICONS = {
        trash: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7v13h12V7"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>',
    };

    /**
     * The heat map's three metrics, and the level steps each is banded by.
     *
     * The steps have to differ: two submissions is a quiet day and two
     * seconds is nothing at all, so one set of bounds cannot colour both. A
     * shared scale was the first thing tried and it made the Time map a
     * single flat block of the darkest level.
     */
    const METRICS = Object.freeze({
        submitted: {
            label: 'Submissions',
            steps: [2, 5, 10],
            legend: ['Nothing', '1–2', '3–5', '6–10', 'Over 10'],
            say: (day) => `${day.submitted} submission${day.submitted === 1 ? '' : 's'}`,
        },
        solved: {
            label: 'Solved',
            steps: [1, 3, 6],
            legend: ['Nothing', '1', '2–3', '4–6', 'Over 6'],
            say: (day) => `${day.solved} solved`,
        },
        seconds: {
            label: 'Time',
            steps: [15 * 60, 45 * 60, 90 * 60],
            legend: ['Nothing', 'Up to 15m', '15m – 45m', '45m – 1h 30m', 'Over 1h 30m'],
            say: (day) => human(day.seconds),
        },
    });

    /** "1h 05m" / "12m" / "45s" — the same shape the chess views write. */
    function human(seconds) {
        const s = Math.max(0, Math.round(seconds || 0));
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m`;
        return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
    }

    function figure(label, value, note) {
        return `
            <div class="stat-figure">
                <span class="stat-label">${esc(label)}</span>
                <span class="stat-value">${esc(String(value))}</span>
                <span class="stat-note">${esc(note)}</span>
            </div>`;
    }

    const DAY_MS = 864e5;
    const dayLabel = (ms) => new Date(ms).toLocaleDateString(undefined,
        { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

    /** When a problem is next wanted, in words. */
    function dueText(problem, now) {
        const due = Leet.nextDue(problem);
        if (!due) return 'not graded';
        const days = Math.round((due - now) / DAY_MS);
        if (days < -1) return `${Math.abs(days)} days overdue`;
        if (days <= 0) return 'today';
        if (days === 1) return 'tomorrow';
        if (days < 31) return `in ${days} days`;
        const months = Math.round(days / 30);
        if (months < 12) return `in ${months} month${months === 1 ? '' : 's'}`;
        return `in ${Math.round(days / 365)} year${Math.round(days / 365) === 1 ? '' : 's'}`;
    }

    /**
     * The middle of the times taken, not the mean.
     *
     * One problem sat with for two hours while the tab was open in the
     * background drags a mean somewhere nobody's practice actually is — and
     * that is exactly the shape the wall-clock fallback produces when it
     * mis-measures. The median shrugs it off.
     */
    function medianSeconds(problems) {
        const times = problems
            .map((problem) => (Leet.lastAttempt(problem) || {}).seconds || 0)
            .filter((seconds) => seconds > 0)
            .sort((a, b) => a - b);
        if (!times.length) return 0;
        const middle = Math.floor(times.length / 2);
        return times.length % 2 ? times[middle] : Math.round((times[middle - 1] + times[middle]) / 2);
    }

    /** A difficulty pill in LeetCode's own three colours. */
    const diffPill = (difficulty) => (difficulty
        ? `<span class="leet-diff is-${att(difficulty.toLowerCase())}">${esc(difficulty)}</span>`
        : '');

    function problemLink(problem) {
        const url = problem.url || `https://leetcode.com/problems/${problem.slug}/`;
        return `<a class="page-title" href="${Dom.safeUrlAttr(url)}" target="_blank" rel="noopener noreferrer">${esc(problem.title || problem.slug)}</a>`;
    }

    function emptyMarkup(title, message) {
        return `
            <div class="empty-state">
                <div class="empty-icon">${SiteIcons ? SiteIcons.svg('leetcode', { size: 40 }) : '🧩'}</div>
                <h3 class="bb-proper">${esc(title)}</h3>
                ${message ? `<p>${esc(message)}</p>` : ''}
            </div>`;
    }

    // ------------------------------------------------------------ the view

    /**
     * One panel. `kind` is which of the three it draws; they share a store, a
     * reload and a delegated click handler, and differ only in markup.
     */
    function mountPanel(host, kind) {
        let state = Leet.blank();
        let metric = 'submitted';

        function paint() {
            const now = Date.now();
            const lists = Leet.lists(state, now);
            // Redrawing wholesale would snap a scrolled heat map back to its
            // start — the same guard chess-stats.js keeps around its repaint.
            const scroller = host.querySelector('.hm-scroll');
            const scrolled = scroller ? scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft : 0;

            if (kind === 'review') host.innerHTML = reviewMarkup(lists, now);
            else if (kind === 'heat') host.innerHTML = heatMarkup(lists, now);
            else host.innerHTML = notesMarkup(now);

            const heat = host.querySelector('.hm-scroll');
            if (heat) heat.scrollLeft = heat.scrollWidth - heat.clientWidth - scrolled;
        }

        // -------------------------------------------------------- review

        function reviewMarkup(lists, now) {
            const problems = Object.values(Leet.problemsOf(state));
            if (!problems.length) {
                return `<div class="dashboard-header"><h2>Review</h2></div>` +
                    emptyMarkup('Nothing tracked yet',
                        'Open a problem on LeetCode and it appears here. Grade it after an accepted submission and it comes back when it is worth doing again.');
            }

            const solved = problems.filter((problem) => problem.solvedAt).length;
            const dueToday = lists.due.length;
            const upcoming = lists.solved
                .filter((problem) => Leet.nextDue(problem))
                .sort((a, b) => Leet.nextDue(a) - Leet.nextDue(b))
                .slice(0, 12);
            const median = medianSeconds(problems);

            return `
                <div class="dashboard-header"><h2>Review</h2></div>
                <div class="stat-figures">
                    ${figure('Solved', solved, `of ${problems.length} tracked`)}
                    ${figure('Due', dueToday, dueToday === 1 ? 'problem to revisit' : 'problems to revisit')}
                    ${figure('Streak', Leet.streak(state, now), 'days running')}
                    ${figure('Median time', median ? human(median) : '—', 'per solved problem')}
                </div>
                <div class="stat-panel">
                    <h3>Due now</h3>
                    <p class="stat-sub">Soonest first. Re-grade to move one along without solving it again.</p>
                    ${queueTable(lists.due, now, true)}
                </div>
                <div class="stat-panel">
                    <h3>To solve</h3>
                    <p class="stat-sub">Opened but never accepted.</p>
                    ${lists.toSolve.length
                        ? queueTable(lists.toSolve.slice(0, 20), now, false)
                        : '<p class="stat-sub">Nothing outstanding.</p>'}
                </div>
                <div class="stat-panel">
                    <h3>Coming up</h3>
                    <p class="stat-sub">Graded and scheduled, soonest first.</p>
                    ${upcoming.length
                        ? queueTable(upcoming, now, true)
                        : '<p class="stat-sub">Nothing scheduled — grade a solved problem to put it in the queue.</p>'}
                </div>`;
        }

        function queueTable(rows, now, gradable) {
            if (!rows.length) return '<p class="stat-sub">Nothing due. Well done.</p>';
            return `
                <table class="stat-table leet-queue">
                    <thead><tr>
                        <th>Problem</th><th class="col-diff">Difficulty</th><th class="col-day">Due</th>
                        <th>Note</th>${gradable ? '<th class="col-grade">Re-grade</th>' : ''}
                        <th class="col-forget"><span class="visually-hidden">Remove</span></th>
                    </tr></thead>
                    <tbody>${rows.map((problem) => `
                        <tr>
                            <td>${problemLink(problem)}</td>
                            <td class="col-diff">${diffPill(problem.difficulty)}</td>
                            <td class="col-day">${esc(dueText(problem, now))}</td>
                            <td class="leet-note-cell">
                                <button type="button" class="leet-note-btn${problem.note ? '' : ' is-empty'}"
                                        data-leet-note="${att(problem.slug)}">${problem.note ? esc(problem.note) : '+ note'}</button>
                            </td>
                            ${gradable ? `<td class="col-grade">${gradeButtons(problem)}</td>` : ''}
                            <td class="col-forget">
                                <button type="button" class="leet-forget" data-leet-forget="${att(problem.slug)}"
                                        title="Remove this problem from the list"
                                        aria-label="Remove ${att(problem.title || problem.slug)} from the list">${ICONS.trash}</button>
                            </td>
                        </tr>`).join('')}</tbody>
                </table>`;
        }

        /**
         * Four small buttons per row rather than a dropdown.
         *
         * Re-grading is the correction you make when the schedule is wrong —
         * "this came back after a month and I had no idea" — and it wants to
         * be one click from the row you are looking at, not two clicks and a
         * menu.
         */
        function gradeButtons(problem) {
            return `<span class="leet-grades">${Fsrs.GRADES.map((grade) => `
                <button type="button" class="leet-grade" data-leet-grade="${grade.id}"
                        data-leet-slug="${att(problem.slug)}"
                        title="Re-grade as ${esc(grade.label.toLowerCase())}">${esc(grade.label[0])}</button>`).join('')}</span>`;
        }

        // ---------------------------------------------------------- heat

        function heatMarkup(lists, now) {
            const spec = METRICS[metric];
            const days = Leet.heatDays(state, metric, now);
            const entries = Object.values(days);
            const practised = entries.filter((day) => day.submitted).length;
            const totals = entries.reduce((sum, day) => ({
                submitted: sum.submitted + day.submitted,
                solved: sum.solved + day.solved,
                seconds: sum.seconds + day.seconds,
            }), { submitted: 0, solved: 0, seconds: 0 });

            return `
                <div class="dashboard-header">
                    <h2>Practice</h2>
                    <div class="dashboard-controls">
                        <div class="range-seg" role="group" aria-label="What the map shows">
                            ${Object.entries(METRICS).map(([id, entry]) => `
                                <button class="range-opt" type="button" data-leet-metric="${att(id)}"
                                        aria-pressed="${id === metric}">${esc(entry.label)}</button>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="stat-figures">
                    ${figure('Days practised', practised, 'in the last year')}
                    ${figure('Submissions', totals.submitted, `${totals.solved} accepted`)}
                    ${figure('Time', human(totals.seconds), 'timed on problems')}
                    ${figure('Streak', Leet.streak(state, now), 'days running')}
                </div>
                <div class="stat-panel">
                    <h3>${esc(spec.label)}</h3>
                    <p class="stat-sub">One square a day, in your own time zone. Only what Bell Bearer
                       watched is here — solving something before you installed it is not.</p>
                    ${BB.HeatMap.render({
                        days,
                        end: now,
                        steps: spec.steps,
                        legend: spec.legend,
                        describe: (day, date) => (day && day.submitted
                            ? `${dayLabel(date)} — ${spec.say(day)}`
                            : `${dayLabel(date)} — nothing`),
                    })}
                </div>`;
        }

        // --------------------------------------------------------- notes

        function notesMarkup(now) {
            const rows = Object.values(Leet.problemsOf(state))
                .filter((problem) => problem.note)
                .sort((a, b) => b.seenAt - a.seenAt);

            if (!rows.length) {
                return `<div class="dashboard-header"><h2>Notes</h2></div>` +
                    emptyMarkup('No notes yet',
                        'Write one from the pouch on leetcode.com, or from the Review tab here. Three lines about the trick is usually enough.');
            }

            return `
                <div class="dashboard-header"><h2>Notes</h2></div>
                <p class="stat-sub leet-notes-hint">${rows.length} note${rows.length === 1 ? '' : 's'}. Click one to edit it.</p>
                <div class="leet-notes">${rows.map((problem) => `
                    <div class="leet-note-card">
                        <div class="leet-note-head">
                            ${problemLink(problem)}
                            ${diffPill(problem.difficulty)}
                            <span class="page-host">${esc(dueText(problem, now))}</span>
                            <button type="button" class="leet-note-del" data-leet-forget="${att(problem.slug)}"
                                    title="Forget this problem" aria-label="Forget this problem">&times;</button>
                        </div>
                        <button type="button" class="leet-note-body" data-leet-note="${att(problem.slug)}">${esc(problem.note)}</button>
                    </div>`).join('')}</div>`;
        }

        // -------------------------------------------------------- editing

        /**
         * A note is several lines, so it is a modal with a textarea rather
         * than Ui.promptDialog — that one is a single-line input, and a note
         * typed into it loses its line breaks the first time it is re-opened.
         */
        async function editNote(slug) {
            const problem = Leet.problemsOf(state)[slug];
            if (!problem) return;

            const modal = Ui.openModal(`
                <h3>${esc(problem.title || slug)}</h3>
                <label class="modal-label" for="leet-note-input">What was the trick?</label>
                <textarea id="leet-note-input" class="modal-input leet-note-input" rows="5"
                          placeholder="The insight, the edge case, the thing you forgot last time">${esc(problem.note)}</textarea>
                <div class="import-modal-buttons">
                    <button id="leet-note-save" class="btn-primary">Save</button>
                    <button class="import-modal-close">Cancel</button>
                </div>`);

            const input = modal.element.querySelector('#leet-note-input');
            modal.element.querySelector('#leet-note-save').addEventListener('click', async () => {
                const note = input.value;
                modal.close();
                await Leet.setNote(slug, note);
                await reload();
            });
            input.focus();
            input.select();
        }

        /**
         * Forget a problem entirely — the record, the note and the schedule.
         *
         * Asked about first, because there is nothing to undo it with: the
         * attempts are ours alone, and LeetCode has no copy of the note.
         */
        async function forget(slug) {
            const problem = Leet.problemsOf(state)[slug];
            if (!problem) return;
            const ok = await Ui.confirmDialog({
                title: 'Forget this problem?',
                message: `The note on "${problem.title || slug}", its attempts and its review schedule are deleted. Your submissions on LeetCode are untouched.`,
                confirmLabel: 'Forget it',
                danger: true,
            });
            if (!ok) return;
            await Leet.remove(slug);
            await reload();
        }

        async function regrade(slug, grade) {
            const { leetRetention, leetMaxInterval } = await Settings.get(['leetRetention', 'leetMaxInterval']);
            await Leet.gradeProblem(slug, grade, {
                retention: Fsrs.clamp(Number(leetRetention) / 100, 0.7, 0.97),
                maxInterval: Number(leetMaxInterval) || 365,
                now: Date.now(),
            });
            await reload();
        }

        // ---------------------------------------------------------- wiring

        host.addEventListener('click', (event) => {
            const metricButton = event.target.closest('[data-leet-metric]');
            if (metricButton) {
                metric = metricButton.dataset.leetMetric;
                paint();
                return;
            }
            const note = event.target.closest('[data-leet-note]');
            if (note) return void editNote(note.dataset.leetNote);

            const forgetButton = event.target.closest('[data-leet-forget]');
            if (forgetButton) return void forget(forgetButton.dataset.leetForget);

            const grade = event.target.closest('[data-leet-grade]');
            if (grade) regrade(grade.dataset.leetSlug, Number(grade.dataset.leetGrade));
        });

        async function reload() {
            state = await Leet.load();
            paint();
        }

        return { reload, render: paint };
    }

    /**
     * Draw every LeetCode panel under `scope` and keep it current.
     *
     * Following the store matters here as much as it does for the X pouch:
     * the panel on leetcode.com writes to the same keys from another tab, so
     * a dashboard that only read on load would show a queue that is minutes
     * out of date while the user is actively grading into it.
     */
    function mountAll(scope = document) {
        const hosts = [
            ...Array.from(scope.querySelectorAll('[data-leet-review]')).map((host) => [host, 'review']),
            ...Array.from(scope.querySelectorAll('[data-leet-stats]')).map((host) => [host, 'heat']),
            ...Array.from(scope.querySelectorAll('[data-leet-notes]')).map((host) => [host, 'notes']),
        ];
        if (!hosts.length) return;

        const panels = hosts.map(([host, kind]) => {
            const panel = mountPanel(host, kind);
            panel.reload();
            return panel;
        });

        Settings.watch(Leet.KEYS, () => panels.forEach((panel) => panel.reload()));
    }

    BB.LeetStats = { mountAll, mountPanel, METRICS, medianSeconds, dueText, human };
})(typeof globalThis !== 'undefined' ? globalThis : this);
