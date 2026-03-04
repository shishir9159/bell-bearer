/**
 * The LeetCode panel in the toolbar popup: what to do next, and a way to put
 * the problem you are looking at into that queue.
 *
 * The popup answers one question — "what should I open now" — so it is the
 * queue and nothing else. No heat map, no notes, no grading: those are
 * decisions you make while looking at the whole log, which is the dashboard's
 * job, and a popup that tried to be a small dashboard would be worse at both.
 *
 * Due comes before to-solve, because a problem you have already solved once
 * and half-forgotten is worth more than a fresh one — that is the entire
 * premise of scheduling them.
 *
 * Built the way src/page/chess-stats.js builds its compact view: a factory
 * taking the element to draw into, rendering wholesale, and dispatching
 * clicks by delegation from the container.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Leet, Dom, Icons } = BB;

    const esc = Dom.escapeHtml;
    const att = Dom.escapeAttr;

    /** How many rows the popup shows before it stops being a popup. */
    const LIMIT = 8;

    const DAY_MS = 864e5;

    /** When a problem is wanted, in the fewest words that are still true. */
    function whenText(problem, now) {
        const due = Leet.nextDue(problem);
        if (!due) return problem.solvedAt ? 'solved' : 'not solved yet';
        const days = Math.round((due - now) / DAY_MS);
        if (days < -1) return `${Math.abs(days)} days overdue`;
        if (days <= 0) return 'due today';
        if (days === 1) return 'due tomorrow';
        return `in ${days} days`;
    }

    const problemUrl = (problem) =>
        problem.url || `https://leetcode.com/problems/${problem.slug}/`;

    /**
     * @param {object} options
     * @param {HTMLElement} options.body where the panel draws
     * @param {() => string} options.currentSlug the problem in the active tab, or ''
     * @param {() => string} options.currentTitle its title, for a problem we have never seen
     * @param {(url: string) => void} options.onOpen
     * @param {() => void} options.onDashboard
     */
    function createView({ body, currentSlug, currentTitle, onOpen, onDashboard }) {
        let state = Leet.blank();

        function paint() {
            if (!body) return;
            const now = Date.now();
            const { due, toSolve } = Leet.lists(state, now);
            const queue = [...due, ...toSolve];
            const slug = currentSlug();

            body.innerHTML = `
                ${queue.length ? listHtml(queue, now) : doneHtml()}
                ${addHtml(slug, now)}`;
        }

        function listHtml(queue, now) {
            const shown = queue.slice(0, LIMIT);
            const rest = queue.length - shown.length;
            return `
                <div class="leet-pop-heading">
                    <span>Next up</span>
                    <span class="leet-pop-count">${queue.length}</span>
                </div>
                <div class="leet-pop-rows">${shown.map((problem) => `
                    <button type="button" class="leet-pop-row" data-leet-open="${att(problemUrl(problem))}">
                        <span class="leet-pop-name">${esc(problem.title || problem.slug)}</span>
                        <span class="leet-pop-meta">
                            ${problem.difficulty ? `<span class="leet-diff is-${att(problem.difficulty.toLowerCase())}">${esc(problem.difficulty)}</span>` : ''}
                            <span class="leet-pop-when">${esc(whenText(problem, now))}</span>
                        </span>
                    </button>`).join('')}</div>
                ${rest > 0 ? `<button type="button" class="leet-pop-more" data-leet-dashboard="1">and ${rest} more${Icons.svg('arrow-right', { size: 13 })}</button>` : ''}`;
        }

        /**
         * Nothing waiting. Said plainly and without a chart — the point of
         * opening the popup was to be told what to do, and "everything is
         * complete" is a complete answer.
         */
        function doneHtml() {
            const tracked = Object.keys(Leet.problemsOf(state)).length;
            return `
                <div class="leet-pop-done">
                    <p class="leet-pop-done-title">Everything is complete.</p>
                    <p class="leet-pop-done-sub">${tracked
                        ? `Nothing is due out of ${tracked} problem${tracked === 1 ? '' : 's'} tracked.`
                        : 'Open a problem on LeetCode and it starts being tracked.'}</p>
                </div>`;
        }

        /**
         * The problem in the active tab, when it is not one of the ones being
         * offered. Three cases reach here and the wording tells them apart:
         * never seen, solved and not yet due, or simply not a problem page at
         * all — in which case there is nothing to add and no button.
         */
        function addHtml(slug, now) {
            if (!slug) return '';
            if (Leet.inQueue(state, slug, now)) {
                return '<p class="leet-pop-here">This one is already on the list.</p>';
            }
            const problem = Leet.problemsOf(state)[slug];
            const name = (problem && problem.title) || currentTitle() || slug;
            const why = problem
                ? `Solved${Leet.nextDue(problem) ? `, ${whenText(problem, now)}` : ''}.`
                : 'Not tracked yet.';
            return `
                <div class="leet-pop-add">
                    <p class="leet-pop-add-why">${esc(why)}</p>
                    <button type="button" class="btn-primary leet-pop-add-btn" data-leet-add="${att(slug)}">
                        Add “${esc(name)}” to the list
                    </button>
                </div>`;
        }

        if (body) {
            body.addEventListener('click', async (event) => {
                const open = event.target.closest('[data-leet-open]');
                if (open) return onOpen(open.dataset.leetOpen);

                if (event.target.closest('[data-leet-dashboard]')) return onDashboard();

                const add = event.target.closest('[data-leet-add]');
                if (!add) return;
                add.disabled = true;
                await Leet.queueNow({
                    slug: add.dataset.leetAdd,
                    title: currentTitle(),
                    url: `https://leetcode.com/problems/${add.dataset.leetAdd}/`,
                });
                await render();
            });
        }

        async function render() {
            state = await Leet.load();
            paint();
        }

        return { render, paint };
    }

    BB.LeetPopup = { createView, whenText, LIMIT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
