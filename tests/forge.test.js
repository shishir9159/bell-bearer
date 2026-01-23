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

    // ------------------------------------------------------------ github

    /** github.com's run page, October 2026: the header, then the job graph, then the sidebar listing the jobs again. */
    const graphJob = (path, label, cls, duration) => `
        <streaming-graph-job class="js-socket-channel WorkflowJob position-relative">
            <a class="WorkflowJob-title d-flex flex-items-center" href="/microsoft/vscode/actions/runs/1/job/${path.length}">
                <div class="width-full"><div class="d-flex flex-auto flex-items-center">
                    <div><svg aria-label="${label}" class="${cls}"></svg></div>
                    ${path.map((part) => `<span class="css-truncate css-truncate-overflow">${part}</span>`).join('<span>/</span>')}
                </div><div class="flex-self-baseline text-small color-fg-muted">${duration}</div></div>
            </a>
        </streaming-graph-job>`;
    const githubRun = (head) => `
        <page-header class="PageHeader">
            <div class="PageHeader-titleBar">
                <div class="PageHeader-titleWrap">
                    <span class="PageHeader-leadingVisual actions-workflow-runs-status">
                        <span class="hide-sm hide-md"><svg aria-label="${head[0]}" class="${head[1]}"></svg></span>
                        <span class="hide-lg hide-xl"><svg aria-label="${head[0]}" class="${head[1]}"></svg></span>
                    </span>
                    <h1 class="PageHeader-title"><span><span class="markdown-title">chore: bump the sdk</span> <span class="color-fg-muted">#69717</span></span></h1>
                </div>
                <span class="PageHeader-actions"><div class="d-none d-md-flex"><button type="button" class="Button Button--iconOnly">…</button></div></span>
            </div>
        </page-header>
        <div class="visual-graph"><div class="WorkflowCard">
            ${graphJob(['Compile &amp; Hygiene'], 'completed successfully: ', 'octicon octicon-check-circle-fill color-fg-success', '5m 40s')}
            ${graphJob(['Linux', 'Electron-Smoke'], 'failed: ', 'octicon octicon-x-circle-fill color-fg-danger', '15m 49s')}
            ${graphJob(['Windows', 'Electron'], 'currently running: ', 'anim-rotate', '')}
        </div></div>
        <ul><li><a class="prc-ActionList-ActionListContent" href="/microsoft/vscode/actions/runs/1/job/9"><svg class="octicon octicon-check-circle-fill"></svg>Compile &amp; Hygiene</a></li></ul>`;
    const RUNNING = ['currently running: ', 'anim-rotate'];
    const FAILED = ['failed: ', 'octicon octicon-x-circle-fill color-fg-danger'];

    /** A pull request's React merge box: a list per state, each named by a heading only a screen reader sees. */
    const checkList = (id, heading, rows) => `
        <div class="ListView-module__container"><h3 class="sr-only" id="${id}">${heading}</h3>
            <ul aria-labelledby="${id}">${rows.map((name) => `
                <li aria-label="${name} started 7m ago"><div class="Title-module__container"><h4 class="Title-module__heading">${name}</h4></div></li>`).join('')}
            </ul></div>`;
    const githubPull = (lists = true) => `
        <div class="prc-PageHeader-PageHeader-YLwBQ">
            <h1><span class="markdown-title">chore: bump the sdk</span></h1>
            <div class="prc-PageHeader-Actions-wawWm"><div class="d-flex gap-2"><button type="button">Code</button></div></div>
        </div>
        <section aria-label="Checks">
            <div class="MergeBoxSectionHeader-module__wrapper"><div class="flex-1">
                <h3>Checks awaiting conflict resolution</h3><p class="fgColor-muted mb-0">2 failing, 1 in progress, 1 successful checks</p>
            </div></div>
            ${lists ? checkList('r1', 'failing checks', ['Code OSS / Compile &amp; Hygiene (pull_request)', 'Code OSS / Linux / Electron (pull_request)'])
                + checkList('r2', 'in progress checks', ['VS Code PR Check'])
                + checkList('r3', 'successful checks', ['chat-lib tests (ubuntu-latest)']) : ''}
        </section>`;
    const PULL = { site: 'github', kind: 'pull', repo: 'microsoft/vscode', number: '340202' };
    const RUN = { site: 'github', kind: 'run', repo: 'microsoft/vscode', number: '1' };

    suite('forge ci watch: github', () => {
        test('a run reads as its header icon says, and each job of the graph once, named without its time', async () => {
            stage(githubRun(RUNNING));
            const { GithubRead, CiWatch } = BB();
            const read = GithubRead.adapter.ci.read(document, RUN);
            assertEqual(read.state, 'running');
            assertDeepEqual(read.jobs, [
                { name: 'Compile & Hygiene', state: 'passed' },
                { name: 'Linux / Electron-Smoke', state: 'failed' },
                { name: 'Windows / Electron', state: 'running' },
            ]);
            assertDeepEqual(CiWatch.summarize(read), { state: 'running', failed: ['Linux / Electron-Smoke'], left: 1 });
            teardown();
        });

        test('a finished run reads finished, is named by its title, and takes the button before its menu', async () => {
            const host = stage(githubRun(FAILED));
            const { ci } = BB().GithubRead.adapter;
            assertEqual(ci.read(document, RUN).state, 'failed');
            assertEqual(ci.label(document, RUN), 'chore: bump the sdk');
            assertEqual(ci.slot(document, RUN), host.querySelector('.PageHeader-actions'));
            teardown();
        });

        test('a pull request\'s checks read by the list each is in, whatever the heading above says', async () => {
            const host = stage(githubPull());
            const { GithubRead, CiWatch } = BB();
            const summary = CiWatch.summarize(GithubRead.adapter.ci.read(document, PULL));
            assertDeepEqual(summary, { state: 'running', failed: ['Code OSS / Compile & Hygiene (pull_request)', 'Code OSS / Linux / Electron (pull_request)'], left: 1 });
            assertEqual(GithubRead.adapter.ci.slot(document, PULL), host.querySelector('.d-flex.gap-2'));
            assertEqual(GithubRead.adapter.ci.label(document, PULL), 'chore: bump the sdk');
            teardown();
        });

        test('with its list folded away, the counts under the heading still say what failed', async () => {
            stage(githubPull(false));
            const { GithubRead, CiWatch } = BB();
            const read = GithubRead.adapter.ci.read(document, PULL);
            assertDeepEqual(read.jobs.map((job) => job.state), ['failed', 'failed', 'running', 'passed']);
            assertDeepEqual(CiWatch.summarize(read), { state: 'running', failed: [], left: 1 }, 'no names to give');
            assertDeepEqual(GithubRead.countedJobs('2 failing, 1 pending, and 33 successful checks').length, 36);
            teardown();
        });

        test('the old merge box: one list, an icon on each row', async () => {
            stage(`<div class="merge-status-list">
                <div class="merge-status-item"><svg class="octicon octicon-x color-fg-danger"></svg><strong>build</strong></div>
                <div class="merge-status-item"><svg class="octicon octicon-check color-fg-success"></svg><strong>lint</strong></div>
            </div>`);
            const read = BB().GithubRead.adapter.ci.read(document, PULL);
            assertDeepEqual(read.jobs, [{ name: 'build', state: 'failed' }, { name: 'lint', state: 'passed' }]);
            teardown();
        });

        test('out of sight, a pull request\'s checks are asked for as the merge box asks, and an odd answer is not believed', async () => {
            const { GithubRead } = BB();
            const calls = [];
            const answer = (status, body) => async (url, options) => {
                calls.push([url, options]);
                return { ok: status === 200, json: async () => body };
            };
            const checks = { statusChecks: [{ displayName: 'build', state: 'FAILURE' }, { displayName: 'lint', state: 'IN_PROGRESS' }], statusRollup: {} };
            const read = await GithubRead.fetchChecks(PULL, { fetchImpl: answer(200, checks) });
            assertDeepEqual(read, { state: null, jobs: [{ name: 'build', state: 'failed' }, { name: 'lint', state: 'running' }] });
            assertEqual(calls[0][0], '/microsoft/vscode/pull/340202/page_data/status_checks');
            assertEqual(calls[0][1].headers['GitHub-Verified-Fetch'], 'true');
            assertEqual(await GithubRead.fetchChecks(PULL, { fetchImpl: answer(406, checks) }), null, 'refused');
            assertEqual(await GithubRead.fetchChecks(PULL, { fetchImpl: answer(200, { checks: [] }) }), null, 'another shape');
            assertEqual(await GithubRead.fetchChecks(PULL, { fetchImpl: async () => { throw new TypeError('offline'); } }), null, 'offline');
            calls.length = 0;
            assertEqual(await GithubRead.fetchChecks(RUN, { fetchImpl: answer(200, checks) }), null, 'a run keeps itself current');
            assertEqual(calls.length, 0);
        });
    });
})();
