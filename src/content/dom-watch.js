/**
 * One throttled MutationObserver for the whole content script.
 *
 * The old code ran two independent `{ childList: true, subtree: true }`
 * observers on document.body — one for the guide drawer, one for the subscribe
 * button — plus four setIntervals (1s, 1s, 2s, 2s). On a YouTube watch page,
 * which mutates constantly as the comment and recommendation lists stream in,
 * that meant thousands of callbacks a second, each doing its own
 * querySelector.
 *
 * Tasks registered here are instead coalesced into at most one run per animation
 * frame — or less often, for a task that asks — and a task that reports it is
 * done is dropped. YouTube's own
 * `yt-navigate-finish` event re-arms everything on SPA navigation, so the
 * fallback poll exists only for the case where that event never fires.
 */
(function (root) {
    'use strict';

    /** Backstop for anything the observer and navigation events both miss. */
    const FALLBACK_POLL_MS = 3000;

    function createWatcher() {
        /** name -> { run, every, last } */
        const tasks = new Map();
        let frame = 0;
        let observer = null;
        let pollTimer = 0;
        /** A pass owed to a task that was skipped for running too recently. */
        let owedTimer = 0;
        let owedAt = 0;

        function owe(ms) {
            const at = Date.now() + ms;
            if (owedTimer && owedAt <= at) return;
            clearTimeout(owedTimer);
            owedAt = at;
            owedTimer = setTimeout(() => {
                owedTimer = 0;
                schedule();
            }, ms);
        }

        function runTasks() {
            frame = 0;
            const now = Date.now();
            let wait = Infinity;
            for (const [name, task] of tasks) {
                // A task that asked for `every` is skipped until that long has
                // passed — but owed a pass then, or a mutation it skipped
                // would wait for the next one, or for the three-second poll.
                if (task.every) {
                    const due = task.last + task.every - now;
                    if (due > 0) {
                        wait = Math.min(wait, due);
                        continue;
                    }
                    task.last = now;
                }
                let done = false;
                try {
                    done = task.run() === true;
                } catch (error) {
                    console.error(`Bell Bearer: watcher task "${name}" failed`, error);
                    done = true; // a task that throws is not worth retrying every frame
                }
                if (done) tasks.delete(name);
            }
            if (tasks.size === 0) stop();
            else if (wait !== Infinity) owe(wait);
        }

        function schedule() {
            if (frame || tasks.size === 0) return;
            frame = requestAnimationFrame(runTasks);
        }

        function start() {
            if (observer || !document.body) return;
            observer = new MutationObserver(schedule);
            observer.observe(document.body, { childList: true, subtree: true });
            pollTimer = setInterval(schedule, FALLBACK_POLL_MS);
        }

        function stop() {
            if (observer) { observer.disconnect(); observer = null; }
            if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
            if (frame) { cancelAnimationFrame(frame); frame = 0; }
            if (owedTimer) { clearTimeout(owedTimer); owedTimer = 0; }
        }

        /**
         * Register `run` under `name`, replacing any task with that name.
         * `run` returns true when it is finished and should not run again.
         *
         * `every` is the least time between two runs, in ms. The default is
         * every frame the page mutated in, which on the chat sites and X is
         * nearly all of them: a notice or a strip that is a quarter of a
         * second late is not seen to be, and a task that walks every turn of
         * a thread on each frame of a streaming answer is.
         */
        function add(name, run, { every = 0 } = {}) {
            tasks.set(name, { run, every, last: 0 });
            start();
            schedule();
        }

        function remove(name) {
            tasks.delete(name);
            if (tasks.size === 0) stop();
        }

        /** Whether `name` is still registered — false once it reported done. */
        function has(name) {
            return tasks.has(name);
        }

        return { add, remove, has, schedule, stop };
    }

    const DomWatch = { createWatcher, FALLBACK_POLL_MS };

    root.BB = root.BB || {};
    root.BB.DomWatch = DomWatch;
    if (typeof module !== 'undefined' && module.exports) module.exports = DomWatch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
