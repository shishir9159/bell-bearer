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
 * frame, and a task that reports it is done is dropped. YouTube's own
 * `yt-navigate-finish` event re-arms everything on SPA navigation, so the
 * fallback poll exists only for the case where that event never fires.
 */
(function (root) {
    'use strict';

    /** Backstop for anything the observer and navigation events both miss. */
    const FALLBACK_POLL_MS = 3000;

    function createWatcher() {
        /** name -> { run, done } */
        const tasks = new Map();
        let frame = 0;
        let observer = null;
        let pollTimer = 0;

        function runTasks() {
            frame = 0;
            for (const [name, task] of tasks) {
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
        }

        /**
         * Register `run` under `name`, replacing any task with that name.
         * `run` returns true when it is finished and should not run again.
         */
        function add(name, run) {
            tasks.set(name, { run });
            start();
            schedule();
        }

        function remove(name) {
            tasks.delete(name);
            if (tasks.size === 0) stop();
        }

        /** Re-arm a finished task, e.g. after an SPA navigation replaced the DOM. */
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
