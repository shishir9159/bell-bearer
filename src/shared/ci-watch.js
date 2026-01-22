/**
 * Whether a CI run has finished, and how, decided the same way on every forge.
 *
 * Each forge spells a job's state its own way, and spells it again in its
 * markup and in its data: GitHub's icons say "failed: " in an aria-label and
 * its page data says FAILURE; GitLab's test ids say status_failed_borderless
 * and its API says failed; Forgejo draws octicon-x-circle-fill in red and
 * names the colour rather than the state. An adapter hands over whatever its
 * forge draws, as a string, and this reads any of them as one of a handful of
 * states — so "done, and how" is written once, not three times.
 *
 * Pure, so the node checks run it, and words the notification as well.
 */
(function (root) {
    'use strict';

    /**
     * The first state whose spelling matches wins, so the order is the
     * ruling: a failure is looked for before anything else, because a failed
     * job can be drawn in a list of checks, and "check" means passed.
     * Colours are matched as whole words — "required" is not red.
     */
    const SPELLINGS = Object.freeze([
        ['failed', /fail|error|timed.?out|x-circle|octicon-x(?![\w-])|danger|\bred\b/i],
        ['cancelled', /cancel|octicon-stop/i],
        ['running', /running|in.?progress|anim-?rotate|job-status-rotate|octicon-meter|spinner/i],
        ['queued', /queued|pending|waiting|created|preparing|scheduled|requested|expected|blocked|octicon-clock|dot-fill/i],
        ['manual', /manual|action.?required/i],
        ['skipped', /skip|stale/i],
        ['passed', /success|passed|neutral|warning|exclamation|octicon-check|\bgreen\b/i],
    ]);

    /** What a run can end as; queued and running have not ended. */
    const FINISHED = Object.freeze(['passed', 'failed', 'cancelled', 'skipped', 'manual']);
    const finished = (state) => FINISHED.includes(state);

    /** Any forge's spelling of a state, as one of SPELLINGS' names; null for none of them. */
    function stateOf(signal) {
        const said = String(signal || '');
        if (!said.trim()) return null;
        const hit = SPELLINGS.find(([, pattern]) => pattern.test(said));
        return hit ? hit[0] : null;
    }

    /** A run's state from its jobs', for a pull request's checks, which have none of their own. */
    function fromJobs(jobs) {
        if (!jobs.length) return null;
        if (jobs.some((job) => !finished(job.state))) return 'running';
        for (const state of ['failed', 'cancelled', 'manual']) {
            if (jobs.some((job) => job.state === state)) return state;
        }
        return jobs.every((job) => job.state === 'skipped') ? 'skipped' : 'passed';
    }

    /**
     * What an adapter read — `{ state, jobs: [{ name, state }] }`, the run's
     * own state where the forge draws one — as what the watch acts on:
     *   state   the run's, or worked out from its jobs
     *   failed  the names of the jobs that failed, each once, as drawn
     *   left    how many jobs have not finished
     * Null when the page showed nothing to read.
     */
    function summarize(reading) {
        if (!reading) return null;
        const jobs = (reading.jobs || []).filter((job) => job && job.state);
        const state = reading.state || fromJobs(jobs);
        if (!state) return null;
        const failed = [...new Set(jobs.filter((job) => job.state === 'failed').map((job) => String(job.name || '').trim()).filter(Boolean))];
        return { state, failed, left: jobs.filter((job) => !finished(job.state)).length };
    }

    /**
     * How the watch ends, or null while it goes on. A failed job ends it
     * before the run does: a run that is not set to stop on the first
     * failure can go on for half an hour after it, and its failure is what
     * the wait was for.
     */
    function outcome(summary) {
        if (!summary) return null;
        if (finished(summary.state)) return summary.state;
        return summary.failed.length ? 'failed' : null;
    }

    const WORDS = Object.freeze({
        passed: 'passed',
        failed: 'failed',
        cancelled: 'cancelled',
        skipped: 'skipped',
        manual: 'stopped at a manual job',
    });

    /** Three names and a count: a notification shows four lines at most. */
    function names(list) {
        if (list.length <= 3) return list.join(', ');
        return `${list.slice(0, 3).join(', ')} and ${list.length - 3} more`;
    }

    /**
     * The notification: `{ title, message }`.
     *   watch  { noun, label, repo }: "Checks", the pull request's title, its repo
     */
    function message(watch, summary, ended) {
        const title = `${watch.noun} ${WORDS[ended] || ended} — ${watch.repo}`;
        const lines = [watch.label];
        if (summary && summary.failed.length) {
            const left = summary.left && !finished(summary.state) ? ` (${summary.left} still running)` : '';
            lines.push(`Failed: ${names(summary.failed)}${left}`);
        }
        return { title, message: lines.filter(Boolean).join('\n') };
    }

    const CiWatch = { SPELLINGS, FINISHED, finished, stateOf, summarize, outcome, message };

    root.BB = root.BB || {};
    root.BB.CiWatch = CiWatch;
    if (typeof module !== 'undefined' && module.exports) module.exports = CiWatch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
