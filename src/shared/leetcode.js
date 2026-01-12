/**
 * The LeetCode practice log: one record per problem, and one bucket per day.
 *
 * Two stores rather than one, because they answer different questions and age
 * differently. A problem is kept for as long as you care about the problem —
 * its note and its review schedule are the point of the whole feature and
 * nothing expires them. A day bucket is three numbers for a square on a heat
 * map, and four hundred of those is a year of map plus the slack to scroll it;
 * older ones are dropped on the way in and again on the way out, the way
 * shared/activity.js does it.
 *
 * Keyed by slug, which is the only stable name a problem has. Titles are
 * edited, the difficulty is re-rated, tags come and go — all three are
 * LeetCode's and are refreshed from the page on every visit. The note, the
 * attempts and the schedule are the user's and survive every refresh. That is
 * the same rule XPouch.filePerson follows, and for the same reason.
 *
 * Everything above the "storage" line is pure and covered by
 * tests/node-check.js; nothing there reads a clock it was not given.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Time = ns.Time || req('./time.js');
    const Fsrs = ns.Fsrs || req('./fsrs.js');
    const Store = ns.Store || req('./store.js');

    const { leetProblems: PROBLEMS_KEY, leetDays: DAYS_KEY } = Settings.DATA;

    /**
     * How many attempts a problem keeps, newest first. Enough to see the shape
     * of a session — the failures that led to an accept, and the accept — and
     * short enough that a problem hammered fifty times in an afternoon cannot
     * grow a record that has to be paged through.
     */
    const ATTEMPT_CAP = 20;

    /** The longest verdict status or runtime kept: "Time Limit Exceeded" is the longest LeetCode says. */
    const VERDICT_MAX = 40;

    /** A year of heat map, plus enough slack to scroll to its left edge. */
    const KEEP_DAYS = 400;

    const DAY_MS = 864e5;

    const DIFFICULTIES = Object.freeze(['Easy', 'Medium', 'Hard']);

    /** The three things a day bucket counts, and what each means on the map. */
    const METRICS = Object.freeze([
        Object.freeze({ id: 'submitted', label: 'Submissions', noun: 'submission' }),
        Object.freeze({ id: 'solved', label: 'Solved', noun: 'solved' }),
        Object.freeze({ id: 'seconds', label: 'Time', noun: 'second' }),
    ]);

    /**
     * 'YYYY-MM-DD' in **local** time, the one every daily store shares — see
     * Time.dayKey. A UTC day files an evening's practice east of Greenwich
     * under tomorrow, so the square that lights up is not the one the user
     * was sitting at the keyboard on.
     */
    const dayKey = (ms = Date.now()) => Time.dayKey(ms);

    const blank = () => ({ problems: {}, days: {} });

    const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const asArray = (value) => (Array.isArray(value) ? value : []);
    const text = (value) => String(value == null ? '' : value).trim();
    const count = (value) => Math.max(0, Math.round(Number(value)) || 0);

    /** LeetCode's own three, or '' — the same rule the chess move lists follow. */
    const cleanDifficulty = (value) => (DIFFICULTIES.includes(text(value)) ? text(value) : '');

    /**
     * A problem record, with anything the page got wrong filtered out. Every
     * field of it is interpolated into markup somewhere, so nothing is trusted
     * as stored — a store written by an older version, or hand-edited, must
     * not be able to hand back a tag that is an object.
     */
    function cleanProblem(record) {
        const problem = asObject(record);
        return {
            slug: text(problem.slug),
            title: text(problem.title),
            difficulty: cleanDifficulty(problem.difficulty),
            tags: asArray(problem.tags).map(text).filter(Boolean).slice(0, 12),
            url: text(problem.url),
            note: text(problem.note),
            seenAt: count(problem.seenAt),
            solvedAt: count(problem.solvedAt),
            attempts: asArray(problem.attempts).slice(0, ATTEMPT_CAP).map((attempt) => ({
                at: count(attempt && attempt.at),
                status: text(attempt && attempt.status),
                seconds: count(attempt && attempt.seconds),
                runtime: text(attempt && attempt.runtime),
            })),
            fsrs: asObject(problem.fsrs).stability ? problem.fsrs : null,
        };
    }

    /** Every problem, cleaned, keyed by slug. */
    function problemsOf(state) {
        const out = {};
        for (const [slug, record] of Object.entries(asObject(state && state.problems))) {
            const problem = cleanProblem({ ...record, slug: record && record.slug ? record.slug : slug });
            if (problem.slug) out[problem.slug] = problem;
        }
        return out;
    }

    /** Day buckets older than KEEP_DAYS are gone, not archived. */
    const prune = (days, now = Date.now()) => Time.keepDays(days, KEEP_DAYS, (bucket) => ({
        submitted: count(bucket.submitted),
        solved: count(bucket.solved),
        seconds: count(bucket.seconds),
    }), now);

    // --------------------------------------------------------- pure edits

    /**
     * Upsert what the page is showing. Keeps the note, the schedule and the
     * attempts; refreshes only what LeetCode owns.
     *
     * A field the reader could not find is not written over a field that is
     * already there — a problem page that has not finished laying out reports
     * no difficulty, and that must not wipe the one read on the last visit.
     */
    function seeIn(state, page, now = Date.now()) {
        const slug = text(page && page.slug);
        if (!slug) return state;

        const problems = problemsOf(state);
        const before = problems[slug] || cleanProblem({ slug });
        const tags = asArray(page && page.tags).map(text).filter(Boolean);

        problems[slug] = {
            ...before,
            slug,
            title: text(page.title) || before.title,
            difficulty: cleanDifficulty(page.difficulty) || before.difficulty,
            tags: tags.length ? tags.slice(0, 12) : before.tags,
            url: text(page.url) || before.url,
            seenAt: now,
        };
        return { ...state, problems };
    }

    /**
     * Record one submission verdict, and credit the day it landed on.
     *
     * The day is the attempt's own day, not today's — a submission that lands
     * either side of midnight belongs to the square it happened on, and the
     * tests pin that by passing an `at` rather than sleeping to it.
     */
    function addAttempt(state, { slug, status, seconds = 0, runtime = '', at = Date.now() } = {}) {
        const key = text(slug);
        if (!key) return state;

        const when = count(at) || Date.now();
        const accepted = text(status) === 'Accepted';
        const spent = count(seconds);
        // Both arrive from the page's own world, which anything on the page
        // can dispatch into. LeetCode's are a few words; nothing longer is
        // worth keeping twenty times over per problem.
        const said = text(status).slice(0, VERDICT_MAX);
        const took = text(runtime).slice(0, VERDICT_MAX);

        const problems = problemsOf(state);
        const before = problems[key] || cleanProblem({ slug: key, seenAt: when });
        problems[key] = {
            ...before,
            seenAt: before.seenAt || when,
            solvedAt: accepted ? when : before.solvedAt,
            attempts: [
                { at: when, status: said, seconds: spent, runtime: took },
                ...before.attempts,
            ].slice(0, ATTEMPT_CAP),
        };

        const days = prune(state && state.days, when);
        const bucket = days[dayKey(when)] || { submitted: 0, solved: 0, seconds: 0 };
        days[dayKey(when)] = {
            submitted: bucket.submitted + 1,
            solved: bucket.solved + (accepted ? 1 : 0),
            seconds: bucket.seconds + spent,
        };

        return { ...state, problems, days };
    }

    /**
     * How many failed submissions have gone in since `since`.
     *
     * The input to Fsrs.suggestGrade, and the reason the caller has to read
     * the problem before recording the accept: `since` is the *previous*
     * solvedAt, which recording the accept overwrites. Zero — never solved
     * before — counts every failure the record still holds.
     */
    function failuresSince(problem, since = 0) {
        const floor = count(since);
        return cleanProblem(problem).attempts
            .filter((attempt) => attempt.at > floor && attempt.status !== 'Accepted')
            .length;
    }

    /** The seconds spent on the attempt that solved it, for the grade card. */
    function lastAttempt(problem) {
        return cleanProblem(problem).attempts[0] || null;
    }

    /**
     * The three rails, in the order the panel draws them.
     *
     * A problem lands in exactly one: due if its schedule has come round, else
     * to-solve if it has never been accepted, else solved. Checked in that
     * order, so a solved problem that has come round again is offered for
     * review rather than filed away as done.
     */
    function lists(state, now = Date.now()) {
        const all = Object.values(problemsOf(state));
        const due = [];
        const toSolve = [];
        const solved = [];

        for (const problem of all) {
            if (problem.fsrs && count(problem.fsrs.due) && problem.fsrs.due <= now) due.push(problem);
            else if (!problem.solvedAt) toSolve.push(problem);
            else solved.push(problem);
        }

        due.sort((a, b) => a.fsrs.due - b.fsrs.due);
        toSolve.sort((a, b) => b.seenAt - a.seenAt);
        solved.sort((a, b) => nextDue(b) - nextDue(a));
        return { due, toSolve, solved };
    }

    /** When a solved problem comes round again, or 0 if it was never graded. */
    function nextDue(problem) {
        return (problem && problem.fsrs && count(problem.fsrs.due)) || 0;
    }

    /**
     * The day buckets shaped for BB.HeatMap.render.
     *
     * `value` is whichever of the three the map is currently colouring by, and
     * the other three fields ride along so a square's tooltip can name all of
     * them whichever one is picked. Pruned on the way out as well as on the
     * way in, so a store written before a long break cannot draw a square
     * outside the map's own window.
     */
    function heatDays(state, metric = 'submitted', now = Date.now()) {
        const which = METRICS.some((m) => m.id === metric) ? metric : 'submitted';
        const out = {};
        for (const [key, bucket] of Object.entries(prune(state && state.days, now))) {
            out[key] = { ...bucket, value: bucket[which] };
        }
        return out;
    }

    /** Days practised in a row, ending today or yesterday. */
    const streak = (state, now = Date.now()) =>
        Time.runOfDays(prune(state && state.days, now), (bucket) => bucket.submitted, now);

    // ------------------------------------------------------------ storage

    /**
     * `update(mutate, now)` prunes the days back from `now`. One step at a
     * time matters here: two tabs submitting at once is how people compare
     * two approaches to one problem.
     */
    const { load, update } = Store.create({
        keys: [PROBLEMS_KEY, DAYS_KEY],
        read: (stored) => ({ problems: asObject(stored[PROBLEMS_KEY]), days: asObject(stored[DAYS_KEY]) }),
        clean: (next, now = Date.now()) => ({ problems: problemsOf(next), days: prune(next.days, now) }),
        write: (state) => ({ [PROBLEMS_KEY]: state.problems, [DAYS_KEY]: state.days }),
        blank,
        name: 'the LeetCode log',
    });

    const see = (page, now = Date.now()) => update((state) => seeIn(state, page, now), now);

    const recordAttempt = (attempt) =>
        update((state) => addAttempt(state, attempt), count(attempt && attempt.at) || Date.now());

    async function setNote(slug, note) {
        const key = text(slug);
        if (!key) return null;
        return update((state) => {
            const problems = problemsOf(state);
            if (!problems[key]) return state;
            problems[key] = { ...problems[key], note: text(note) };
            return { ...state, problems };
        });
    }

    async function remove(slug) {
        const key = text(slug);
        if (!key) return null;
        return update((state) => {
            const problems = problemsOf(state);
            delete problems[key];
            return { ...state, problems };
        });
    }

    /**
     * Put a problem in the queue now, whatever its schedule said.
     *
     * What "add this to the list" means from the popup. A problem never
     * tracked is simply recorded — it lands under "to solve" by being unsolved
     * — and one already solved has its due date pulled to now, which is the
     * only honest way to say "I want to see this again" without inventing a
     * grade for it. A problem already in the queue is left exactly as it is.
     */
    async function queueNow({ slug, title = '', url = '' }, now = Date.now()) {
        const key = text(slug);
        if (!key) return null;
        return update((state) => {
            const problems = problemsOf(state);
            const problem = problems[key];

            if (!problem) {
                return seeIn(state, { slug: key, title, url }, now);
            }
            // Never accepted: it is already waiting under "to solve", and
            // dragging a due date onto it would move it to the wrong rail.
            if (!problem.solvedAt) return state;

            problems[key] = {
                ...problem,
                title: text(title) || problem.title,
                fsrs: problem.fsrs
                    ? { ...problem.fsrs, due: now }
                    // Solved but never graded, so there is no card to pull
                    // forward. It goes in with no schedule, and grading it
                    // after the next accept starts one properly.
                    : null,
                solvedAt: problem.fsrs ? problem.solvedAt : 0,
            };
            return { ...state, problems };
        }, now);
    }

    /** Is this problem one of the ones the queue is currently offering? */
    function inQueue(state, slug, now = Date.now()) {
        const key = text(slug);
        if (!key) return false;
        const { due, toSolve } = lists(state, now);
        return [...due, ...toSolve].some((problem) => problem.slug === key);
    }

    /**
     * Write a grade against a problem, scheduling it by how long it has been
     * since the last one. A re-grade from the dashboard comes through here
     * too, which is why the elapsed days are measured from `fsrs.reviewedAt`
     * rather than from the attempt.
     */
    async function gradeProblem(slug, grade, { retention = 0.9, maxInterval = 365, now = Date.now() } = {}) {
        const key = text(slug);
        if (!key) return null;
        return update((state) => {
            const problems = problemsOf(state);
            const problem = problems[key];
            if (!problem) return state;

            const card = problem.fsrs;
            const elapsed = card && card.reviewedAt ? Math.max(0, (now - card.reviewedAt) / DAY_MS) : 0;
            problems[key] = { ...problem, fsrs: Fsrs.review(card, grade, elapsed, { retention, maxInterval, now }) };
            return { ...state, problems };
        }, now);
    }

    const Leet = {
        ATTEMPT_CAP, KEEP_DAYS, DIFFICULTIES, METRICS, DAY_MS,
        dayKey, blank, prune, problemsOf, cleanProblem,
        seeIn, addAttempt, failuresSince, lastAttempt, lists, nextDue, heatDays, streak, inQueue,
        load, update, see, recordAttempt, setNote, remove, gradeProblem, queueNow,
        KEYS: [PROBLEMS_KEY, DAYS_KEY],
    };

    root.BB = root.BB || {};
    root.BB.Leet = Leet;
    if (typeof module !== 'undefined' && module.exports) module.exports = Leet;
})(typeof globalThis !== 'undefined' ? globalThis : this);
