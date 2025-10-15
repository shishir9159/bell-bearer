/**
 * FSRS-5 — when a problem is worth doing again.
 *
 * A card is two numbers. Stability is how many days until the chance of
 * recalling it falls to 90%; difficulty is 1-10 and governs how much a review
 * moves the stability. Nothing about the scheduling is invented: the weights
 * below are the algorithm's published defaults and every formula is the one
 * the spec gives. What this file adds is suggestGrade, which is ours — the
 * four grades ask how the attempt went, and a log that timed the attempt and
 * counted the failed submissions knows enough to answer before asking.
 *
 * Nineteen weights, not seventeen. The two published sets are not
 * interchangeable and the difficulty formula is what tells them apart: FSRS-5
 * is exponential in the grade, FSRS-4.5 linear. Fed 4.5's numbers, the
 * exponential form returns -5.5 for Good and -33.9 for Easy, so every clean
 * review would clamp to difficulty 1 and the scheduler would flatten into
 * "everything is trivial". W below is 5's set, which is the one that formula
 * belongs to; if it is ever retuned, both have to move together.
 *
 * Pure: no storage, no clock of its own, no chrome.*. `now` and `elapsedDays`
 * are always passed in, which is what lets tests/node-check.js run a year of
 * reviews without sleeping through one.
 */
(function (root) {
    'use strict';

    /** FSRS-5's published defaults, in the spec's own order. */
    const W = Object.freeze([0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345,
        1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698,
        0.2315, 2.9898, 0.51655, 0.6621]);

    /**
     * The forgetting curve's shape, and the constant that makes R(S, S) come
     * out at exactly 0.9 — that is, that makes "stability" mean "days until
     * 90%". FACTOR is 19/81; it is derived rather than written down so the two
     * cannot drift apart if DECAY is ever retuned.
     */
    const DECAY = -0.5;
    const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

    const GRADES = Object.freeze([
        Object.freeze({ id: 1, label: 'Again' }),
        Object.freeze({ id: 2, label: 'Hard' }),
        Object.freeze({ id: 3, label: 'Good' }),
        Object.freeze({ id: 4, label: 'Easy' }),
    ]);

    /** Stability may not fall below this, or a lapsed card is never seen again. */
    const MIN_STABILITY = 0.1;
    const MIN_DIFFICULTY = 1;
    const MAX_DIFFICULTY = 10;

    const DAY_MS = 864e5;

    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

    /** 1-4, whatever was handed in. A stray grade must not poison the card. */
    function cleanGrade(grade) {
        const g = Math.round(Number(grade));
        return Number.isFinite(g) ? clamp(g, 1, 4) : 3;
    }

    /** The card a never-seen problem becomes after its first review. */
    function initial(grade) {
        const g = cleanGrade(grade);
        return {
            stability: Math.max(MIN_STABILITY, W[g - 1]),
            difficulty: clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, MIN_DIFFICULTY, MAX_DIFFICULTY),
        };
    }

    /** The chance of recalling it now, 0-1. 1.0 on the day it was reviewed. */
    function retrievability(stability, elapsedDays) {
        const S = Math.max(MIN_STABILITY, Number(stability) || MIN_STABILITY);
        const t = Math.max(0, Number(elapsedDays) || 0);
        return Math.pow(1 + (FACTOR * t) / S, DECAY);
    }

    /**
     * How many days to leave it, for a target retention. The inverse of
     * retrievability, rounded to whole days — a schedule in fractions of a day
     * is a schedule nobody can act on.
     */
    function intervalFor(stability, retention = 0.9, maxInterval = 36500) {
        const S = Math.max(MIN_STABILITY, Number(stability) || MIN_STABILITY);
        const target = clamp(Number(retention) || 0.9, 0.5, 0.995);
        const days = (S / FACTOR) * (Math.pow(target, 1 / DECAY) - 1);
        return clamp(Math.round(days), 1, Math.max(1, Math.round(maxInterval)));
    }

    /**
     * Difficulty after a review: nudged by how the grade compares to Good,
     * damped towards the top of the range, then pulled back towards what an
     * Easy first review would have set.
     *
     * The damping is FSRS-5's, and it is why a card at 9.5 barely moves while
     * one at 3 moves freely — difficulty is meant to be hard to raise and hard
     * to lower near the ends. The mean reversion on top of it is what stops a
     * run of Hards ratcheting a card to 10 and leaving it there for ever.
     */
    function nextDifficulty(difficulty, grade) {
        const D = clamp(Number(difficulty) || W[4], MIN_DIFFICULTY, MAX_DIFFICULTY);
        const delta = -W[6] * (grade - 3);
        const damped = D + delta * ((10 - D) / 9);
        const reverted = W[7] * initial(4).difficulty + (1 - W[7]) * damped;
        return clamp(reverted, MIN_DIFFICULTY, MAX_DIFFICULTY);
    }

    /** Stability after a successful review — Hard, Good or Easy. */
    function stabilityAfterRecall(stability, difficulty, r, grade) {
        const S = Math.max(MIN_STABILITY, stability);
        const hard = grade === 2 ? W[15] : 1;
        const easy = grade === 4 ? W[16] : 1;
        const growth = Math.exp(W[8]) * (11 - difficulty) * Math.pow(S, -W[9]) *
            (Math.exp(W[10] * (1 - r)) - 1) * hard * easy;
        return Math.max(MIN_STABILITY, S * (1 + growth));
    }

    /**
     * Stability after a lapse. Notably not "S times something less than one":
     * the spec's lapse branch is a curve of its own, and a card forgotten
     * after a long gap keeps more stability than one forgotten after a short
     * one. Capped at where it already was, because a lapse is not a promotion.
     */
    function stabilityAfterLapse(stability, difficulty, r) {
        const S = Math.max(MIN_STABILITY, stability);
        const lapsed = W[11] * Math.pow(difficulty, -W[12]) *
            (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
        return clamp(lapsed, MIN_STABILITY, S);
    }

    /**
     * Stability after a review on the same day as the last one.
     *
     * FSRS-5's short-term branch, and it earns its place here rather than
     * being dropped as an edge case: the dashboard can re-grade a problem, and
     * a re-grade is nearly always same-day. Through the long-term formula that
     * is a no-op — elapsed is 0, so R is 1, so the growth term is exactly zero
     * and the correction the user just made changes nothing at all.
     */
    function stabilityShortTerm(stability, grade) {
        const S = Math.max(MIN_STABILITY, stability);
        return Math.max(MIN_STABILITY, S * Math.exp(W[17] * (grade - 3 + W[18])));
    }

    /**
     * Review `card` with `grade`, `elapsedDays` after it was last seen.
     *
     * A null card — a problem never graded before — takes the initial values
     * rather than being treated as a lapse. `reps` and `lapses` are carried
     * for the dashboard, which is the only thing that reads them.
     */
    function review(card, grade, elapsedDays, { retention = 0.9, maxInterval = 36500, now = Date.now() } = {}) {
        const g = cleanGrade(grade);
        const elapsed = Math.max(0, Number(elapsedDays) || 0);
        const previous = card && Number.isFinite(card.stability) ? card : null;

        let stability;
        let difficulty;
        if (!previous) {
            ({ stability, difficulty } = initial(g));
        } else {
            const r = retrievability(previous.stability, elapsed);
            difficulty = nextDifficulty(previous.difficulty, g);
            if (elapsed < 1) stability = stabilityShortTerm(previous.stability, g);
            else if (g === 1) stability = stabilityAfterLapse(previous.stability, difficulty, r);
            else stability = stabilityAfterRecall(previous.stability, difficulty, r, g);
        }

        const interval = intervalFor(stability, retention, maxInterval);
        return {
            stability,
            difficulty,
            interval,
            due: now + interval * DAY_MS,
            reviewedAt: now,
            reps: ((previous && previous.reps) || 0) + 1,
            lapses: ((previous && previous.lapses) || 0) + (g === 1 ? 1 : 0),
            grade: g,
        };
    }

    /**
     * How long a problem of each difficulty is meant to take. These are the
     * numbers the interview guides give rather than anything measured here,
     * and they exist to give suggestGrade a scale: twenty minutes is a good
     * Medium and a poor Easy, and a grade card that ignored that would be
     * asking the user to do arithmetic it could have done for them.
     */
    const BUDGETS = Object.freeze({ Easy: 15 * 60, Medium: 30 * 60, Hard: 45 * 60 });
    const DEFAULT_BUDGET = BUDGETS.Medium;

    function budgetFor(difficulty) {
        return BUDGETS[String(difficulty || '')] || DEFAULT_BUDGET;
    }

    /**
     * Which of the four grades the attempt looks like, as the grade card's
     * pre-selection. A suggestion, never a decision — the user clicks.
     *
     * Failures outrank the clock in both directions: three wrong submissions
     * is Again however fast they came, because the problem was brute-forced
     * rather than solved, and a single failure caps the answer at Hard however
     * quick the accepted one was.
     */
    function suggestGrade({ seconds = 0, failures = 0, difficulty = '' } = {}) {
        const budget = budgetFor(difficulty);
        const spent = Math.max(0, Number(seconds) || 0);
        const wrong = Math.max(0, Math.round(Number(failures)) || 0);

        if (wrong >= 3 || spent > budget * 2) return 1;
        if (wrong > 0 || spent > budget) return 2;
        if (spent > 0 && spent <= budget / 2) return 4;
        return 3;
    }

    const Fsrs = {
        W, DECAY, FACTOR, GRADES, BUDGETS, MIN_STABILITY, DAY_MS,
        initial, retrievability, intervalFor, review, suggestGrade, budgetFor,
        nextDifficulty, clamp,
    };

    root.BB = root.BB || {};
    root.BB.Fsrs = Fsrs;
    if (typeof module !== 'undefined' && module.exports) module.exports = Fsrs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
