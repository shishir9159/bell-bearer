/**
 * The CI watch on a forge's page: the Watch button, and the reading that
 * goes on in a tab out of sight — through a stand-in adapter first, so the
 * core is tested without any forge's markup, and then through each forge's
 * own, against markup copied from the live pages.
 *
 * Wrapped, because this file shares the global scope with the other specs.
 */
(function () {
    'use strict';

    const BB = () => window.BB;
    const HOST_ID = 'bb-forge-test';
    const settle = (ms = 0) => new Promise((done) => setTimeout(done, ms));

    async function waitFor(predicate, what, ms = 4000) {
        const until = Date.now() + ms;
        while (!predicate()) {
            if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
            await settle(20);
        }
    }

    function teardown() {
        const host = document.getElementById(HOST_ID);
        if (host) host.remove();
        const button = document.getElementById(BB().CiWatchContent.BUTTON_ID);
        if (button) button.remove();
    }

    function stage(html) {
        teardown();
        const host = document.createElement('div');
        host.id = HOST_ID;
        host.innerHTML = html;
        document.body.appendChild(host);
        return host;
    }

    /** Runs a task at once and again on asking; a hidden tab runs no frames for the real one. */
    function nowWatcher() {
        const tasks = new Map();
        return {
            add: (name, run) => { tasks.set(name, run); run(); },
            remove: (name) => tasks.delete(name),
            schedule: () => tasks.forEach((run) => run()),
        };
    }

    /** A worker that answers as the real one does, and writes down what it was asked. */
    function fakeWorker(stored = null) {
        let watch = stored;
        const asked = [];
        async function ask(message) {
            asked.push(message);
            switch (message.action) {
                case 'ciWatchGet': return watch && watch.key === message.key ? watch : null;
                case 'ciWatchStart': watch = message.watch; return { ok: true };
                default: watch = null; return { ok: true };
            }
        }
        return { ask, asked, said: (action) => asked.filter((one) => one.action === action) };
    }

    /** A forge whose run is one element with its state in a data attribute, and its jobs beside it. */
    function fakeAdapter(more = {}) {
        const { CiWatch } = BB();
        const scope = () => document.getElementById(HOST_ID);
        return {
            site: 'github',
            ci: {
                read: () => {
                    const run = scope() && scope().querySelector('[data-run]');
                    if (!run) return null;
                    const jobs = [...scope().querySelectorAll('[data-job]')].map((job) => ({ name: job.textContent, state: CiWatch.stateOf(job.dataset.job) }));
                    return { state: CiWatch.stateOf(run.dataset.run), jobs };
                },
                label: () => 'A run',
                slot: () => scope() && scope().querySelector('.actions'),
                buttonClass: 'Button',
                ...more,
            },
        };
    }

    const RUN_URL = 'https://github.com/a/b/actions/runs/1';
    const runPage = (run, jobs = []) => `<div class="actions"><button type="button">Re-run</button></div>
        <span data-run="${run}"></span>${jobs.map(([name, state]) => `<span data-job="${state}">${name}</span>`).join('')}`;

    function makeWatch({ adapter = fakeAdapter(), worker = fakeWorker(), url = RUN_URL, on = true } = {}) {
        const settings = { githubCiWatch: on };
        const notes = [];
        const win = { location: { href: url } };
        const ui = BB().CiWatchContent.createCiWatch({
            adapter, watcher: nowWatcher(), notify: (text, type) => notes.push([text, type]),
            getSettings: () => settings, ask: worker.ask, win,
        });
        const button = () => document.getElementById(BB().CiWatchContent.BUTTON_ID);
        return { ui, worker, settings, notes, win, button };
    }

    suite('forge ci watch: the button', () => {
        test('it goes first among the page\'s own actions while the switch is on, and nowhere once it is off', async () => {
            const host = stage(runPage('running'));
            const { ui, settings, button } = makeWatch();
            ui.install();
            assert(button(), 'no button');
            assertEqual(host.querySelector('.actions').firstElementChild, button());
            assertEqual(button().textContent, 'Watch');
            assertEqual(button().className, 'Button bb-ci-watch');
            settings.githubCiWatch = false;
            ui.refreshSurfaces();
            assertEqual(button(), null);
            teardown();
        });

        test('a page that is neither a run nor a pull request gets none', async () => {
            stage(runPage('running'));
            const { ui, button } = makeWatch({ url: 'https://github.com/a/b/issues/3' });
            ui.install();
            assertEqual(button(), null);
            teardown();
        });
    });

    suite('forge ci watch: watching', () => {
        test('a click starts a watch with the worker, and the run drawn finished ends it', async () => {
            const host = stage(runPage('running', [['lint', 'passed'], ['test', 'running']]));
            const { ui, worker, button } = makeWatch();
            ui.install();
            button().click();
            await waitFor(() => button().textContent === 'Watching', 'the button to say so');
            assertDeepEqual(worker.said('ciWatchStart')[0].watch,
                { key: 'github:a/b:run:1', noun: 'Run', label: 'A run', repo: 'a/b', known: [] });
            // Replaced, as a forge redraws: an attribute no forge uses is not watched.
            host.querySelector('[data-run]').outerHTML = '<span data-run="success"></span>';
            await waitFor(() => worker.said('ciWatchDone').length, 'the end to be reported');
            const [done] = worker.said('ciWatchDone');
            assertDeepEqual([done.key, done.title, done.message], ['github:a/b:run:1', 'Run passed — a/b', 'A run']);
            assertEqual(button().textContent, 'Watch');
            assert(!ui.isWatching());
            teardown();
        });

        test('a failure on screen as it starts is not news; the next one ends it while the run goes on', async () => {
            const host = stage(runPage('running', [['lint', 'failed'], ['test', 'running'], ['build', 'running']]));
            const { ui, worker, button } = makeWatch();
            ui.install();
            button().click();
            await waitFor(() => worker.said('ciWatchStart').length, 'the start');
            assertDeepEqual(worker.said('ciWatchStart')[0].watch.known, ['lint']);
            ui.check();
            assertEqual(worker.said('ciWatchDone').length, 0, 'ended by what was already there');
            host.querySelectorAll('[data-job]')[1].outerHTML = '<span data-job="failed">test</span>';
            await waitFor(() => worker.said('ciWatchDone').length, 'the new failure');
            assertEqual(worker.said('ciWatchDone')[0].message, 'A run\nFailed: lint, test (1 still running)');
            teardown();
        });

        test('a run already over is not watched, and says how it ended', async () => {
            stage(runPage('failed', [['lint', 'failed']]));
            const { ui, worker, notes, button } = makeWatch();
            ui.install();
            button().click();
            await settle(10);
            assertEqual(worker.said('ciWatchStart').length, 0);
            assertDeepEqual(notes, [['Run already failed', 'info']]);
            teardown();
        });

        test('stopping tells the worker, and nothing is read after', async () => {
            const host = stage(runPage('running'));
            const { ui, worker, button } = makeWatch();
            ui.install();
            button().click();
            await waitFor(() => ui.isWatching(), 'the watch');
            button().click();
            await waitFor(() => worker.said('ciWatchStop').length, 'the stop');
            assertEqual(worker.said('ciWatchStop')[0].key, 'github:a/b:run:1');
            host.querySelector('[data-run]').outerHTML = '<span data-run="success"></span>';
            await settle(BB().CiWatchContent.SETTLE_MS + 100);
            assertEqual(worker.said('ciWatchDone').length, 0);
            teardown();
        });

        test('a reloaded tab picks its watch up again, and asks the adapter\'s request at once', async () => {
            stage(runPage('running'));
            const stored = { key: 'github:a/b:run:1', noun: 'Run', label: 'A run', repo: 'a/b', known: [] };
            let fetched = 0;
            const adapter = fakeAdapter({ fetch: async () => { fetched++; return { state: 'cancelled', jobs: [] }; } });
            const { ui, worker } = makeWatch({ adapter, worker: fakeWorker(stored) });
            ui.install();
            await waitFor(() => worker.said('ciWatchDone').length, 'the fetched end');
            assertEqual(fetched, 1);
            assertEqual(worker.said('ciWatchDone')[0].title, 'Run cancelled — a/b');
            teardown();
        });

        test('leaving the run stops the reading here, and leaves the watch with the worker', async () => {
            stage(runPage('running'));
            const { ui, worker, win, button } = makeWatch();
            ui.install();
            button().click();
            await waitFor(() => ui.isWatching(), 'the watch');
            win.location.href = 'https://github.com/a/b/actions/runs/1/job/9';
            ui.onNavigate();
            assert(ui.isWatching(), 'a job of the same run is the same run');
            win.location.href = 'https://github.com/a/b/actions';
            ui.onNavigate();
            assert(!ui.isWatching());
            assertEqual(worker.said('ciWatchStop').length, 0);
            teardown();
        });
    });
})();
