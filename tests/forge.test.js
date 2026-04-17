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

    function makeWatch({ adapter = fakeAdapter(), worker = fakeWorker(), url = RUN_URL, on = true, own = false } = {}) {
        const settings = { githubCiWatch: on, githubCiWatchOwn: own };
        const notes = [];
        const win = { location: { href: url } };
        const watcher = nowWatcher();
        const ui = BB().CiWatchContent.createCiWatch({
            adapter, watcher, notify: (text, type) => notes.push([text, type]),
            getSettings: () => settings, ask: worker.ask, win,
        });
        const button = () => document.getElementById(BB().CiWatchContent.BUTTON_ID);
        return { ui, worker, settings, notes, win, button, watcher };
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
            assertEqual(button().firstElementChild.getAttribute('class'), 'bb-ci-watch-icon', 'the bell comes before the word');
            settings.githubCiWatch = false;
            ui.refreshSurfaces();
            assertEqual(button(), null);
            teardown();
        });

        test('a forge that names its own parts gets the bell and the word inside them, filled in and in its own look while watching', async () => {
            stage(runPage('running'));
            const parts = { content: 'Button-content', visual: 'Button-visual Button-leadingVisual', label: 'Button-label' };
            const { ui, button } = makeWatch({ adapter: fakeAdapter({ parts, watchingClass: 'Button Button--primary' }) });
            ui.install();
            const bell = () => button().querySelector('.Button-content > .Button-leadingVisual > svg.bb-ci-watch-icon');
            assert(bell(), 'no bell in the leading visual');
            assertEqual(button().querySelector('.Button-content > .Button-label').textContent, 'Watch');
            const idle = bell().innerHTML;
            button().click();
            await waitFor(() => button().textContent === 'Watching', 'the button to say so');
            assert(bell() && bell().innerHTML !== idle, 'the bell is the filled one');
            assertEqual(button().className, 'Button Button--primary bb-ci-watch bb-ci-watching');
            button().click();
            await waitFor(() => button().textContent === 'Watch', 'the stop');
            assertEqual(button().className, 'Button bb-ci-watch');
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

    const PULL_URL = 'https://github.com/a/b/pull/5';

    suite('forge ci watch: your own pull request', () => {
        test('one whose checks are running is watched with no click, says so, and a stop is not undone by the next redraw', async () => {
            stage(runPage('running', [['test', 'running']]));
            const { ui, worker, notes, button, watcher } = makeWatch({ adapter: fakeAdapter({ mine: () => true }), url: PULL_URL, own: true });
            ui.install();
            await waitFor(() => ui.isWatching(), 'the watch to start by itself');
            const [start] = worker.said('ciWatchStart');
            assertDeepEqual([start.watch.key, start.watch.noun, start.watch.auto], ['github:a/b:pull:5', 'Checks', true]);
            assertEqual(button().textContent, 'Watching');
            assertDeepEqual(notes, [['Watching your pull request — a notification comes when its checks finish', 'info']]);
            button().click();
            await waitFor(() => worker.said('ciWatchStop').length, 'the stop');
            watcher.schedule();
            await settle(10);
            assertEqual(worker.said('ciWatchStart').length, 1);
            assert(!ui.isWatching());
            teardown();
        });

        test('one whose checks finished long ago is left alone without a word, even with the merge box not drawn yet', async () => {
            stage('<div class="actions"></div>');
            let fetched = 0;
            const adapter = fakeAdapter({ mine: () => true, fetch: async () => { fetched++; return { state: null, jobs: [{ name: 'test', state: 'passed' }] }; } });
            const { ui, worker, notes } = makeWatch({ adapter, url: PULL_URL, own: true });
            ui.install();
            await waitFor(() => fetched, 'the checks to be asked for');
            await settle(10);
            assertEqual(worker.said('ciWatchStart').length, 0);
            assertDeepEqual(notes, []);
            teardown();
        });

        test('someone else\'s, a run, or with the switch off, is not watched; a header not drawn yet is asked again', async () => {
            let whose = false;
            const adapter = fakeAdapter({ mine: () => whose });
            for (const [url, own] of [[PULL_URL, true], [RUN_URL, true]]) {
                stage(runPage('running'));
                whose = url === RUN_URL;
                const { ui, worker } = makeWatch({ adapter, url, own });
                ui.install();
                await settle(10);
                assertEqual(worker.said('ciWatchStart').length, 0, url);
            }
            stage(runPage('running'));
            whose = true;
            const off = makeWatch({ adapter, url: PULL_URL, own: false });
            off.ui.install();
            await settle(10);
            assertEqual(off.worker.said('ciWatchStart').length, 0, 'the switch is off');

            stage(runPage('running'));
            whose = null;
            const later = makeWatch({ adapter, url: PULL_URL, own: true });
            later.ui.install();
            await settle(10);
            assertEqual(later.worker.said('ciWatchStart').length, 0, 'nothing to go by yet');
            whose = true;
            later.watcher.schedule();
            await waitFor(() => later.ui.isWatching(), 'the watch once the header says');
            teardown();
        });

        test('a tab that was already watching picks that watch up rather than starting another', async () => {
            stage(runPage('running'));
            const stored = { key: 'github:a/b:pull:5', noun: 'Checks', label: 'A run', repo: 'a/b', known: [], since: Date.now() };
            const { ui, worker } = makeWatch({ adapter: fakeAdapter({ mine: () => true }), worker: fakeWorker(stored), url: PULL_URL, own: true });
            ui.install();
            await waitFor(() => ui.isWatching(), 'the watch picked up');
            await settle(10);
            assertEqual(worker.said('ciWatchStart').length, 0);
            teardown();
        });

        test('one that has seen no checks at all gives up quietly once the wait for them is over', async () => {
            stage('<div class="actions"></div>');
            const { OWN_GRACE_MS } = BB().CiWatchContent;
            const stored = { key: 'github:a/b:pull:5', noun: 'Checks', label: 'A run', repo: 'a/b', known: [], auto: true, since: Date.now() - OWN_GRACE_MS - 1000 };
            const adapter = fakeAdapter({ mine: () => true, fetch: async () => null });
            const { ui, worker, watcher } = makeWatch({ adapter, worker: fakeWorker(stored), url: PULL_URL, own: true });
            ui.install();
            await waitFor(() => worker.said('ciWatchStop').length, 'the quiet stop');
            assertEqual(worker.said('ciWatchDone').length, 0);
            assert(!ui.isWatching());
            watcher.schedule();
            await settle(10);
            assertEqual(worker.said('ciWatchStart').length, 0, 'started over by the next redraw');

            stage('<div class="actions"></div>');
            const young = makeWatch({ adapter, worker: fakeWorker({ ...stored, since: Date.now() }), url: PULL_URL, own: true });
            young.ui.install();
            await waitFor(() => young.ui.isWatching(), 'the watch picked up');
            await young.ui.poll();
            assert(young.ui.isWatching(), 'still waiting for its checks');
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

        test('a pull request is yours while its header names you as who wants to merge it, and it is not closed or merged', async () => {
            // The header as github.com drew it in October 2026; merged, the
            // first link is whoever merged it.
            const header = (status, word, who, login = 'Octo') => `${login === null ? '' : `<meta name="user-login" content="${login}">`}
                <div class="prc-PageHeader-PageHeader-YLwBQ"><div class="prc-PageHeader-Description-w-ejP d-flex flex-column">
                    <div class="d-flex gap-2"><span class="prc-StateLabel-StateLabel-Iawzp" data-component="StateLabel" data-status="${status}">${word}</span></div>
                    <div class="fgColor-muted d-flex"><a class="text-bold prc-Link-Link-9ZwDx" data-hovercard-type="user" href="/${who}">${who}</a>
                        <div class="d-flex">wants to merge 4 commits into <a href="/a/b/tree/main">main</a></div></div>
                </div></div>`;
            const { mine } = BB().GithubRead.adapter.ci;
            const said = [];
            for (const args of [['pullOpened', 'Open', 'octo'], ['draft', 'Draft', 'octo'], ['pullClosed', 'Closed', 'octo'],
                ['pullMerged', 'Merged', 'octo'], ['pullOpened', 'Open', 'someone'], ['pullOpened', 'Open', 'octo', ''], ['pullOpened', 'Open', 'octo', null]]) {
                stage(header(...args));
                said.push(mine(document, PULL));
            }
            assertDeepEqual(said, [true, true, false, false, false, false, false]);
            stage('<meta name="user-login" content="octo">');
            assertEqual(mine(document, PULL), null, 'the header is not drawn yet');
            stage(header('pullOpened', 'Open', 'octo'));
            assertEqual(mine(document, RUN), false, 'a run is nobody\'s pull request');
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
            assertEqual(await GithubRead.fetchChecks(RUN, { fetchImpl: answer(200, checks) }), null, 'a run is not a pull request');
            assertEqual(calls.length, 0);
        });

        test('a run is read again from the two partials its page refreshes itself from, since the page can stop', async () => {
            // Seen live: a watched run's page still drew "running" ten
            // minutes after a fresh load of it said the run had passed.
            const { GithubRead } = BB();
            const whole = document.createElement('div');
            whole.innerHTML = githubRun(['completed successfully: ', 'octicon octicon-check-circle-fill color-fg-success']);
            const parts = {
                '/microsoft/vscode/actions/runs/1/header_partial': whole.querySelector('page-header').outerHTML,
                '/microsoft/vscode/actions/runs/1/graph_partial': whole.querySelector('.visual-graph').outerHTML,
            };
            const asked = [];
            const fetchImpl = async (url, options) => {
                asked.push([url, options.headers['X-Requested-With']]);
                return { ok: url in parts, text: async () => parts[url] };
            };
            const read = await GithubRead.adapter.ci.fetch(RUN, { fetchImpl });
            assertEqual(read.state, 'passed');
            assertDeepEqual(read.jobs.map((job) => job.name), ['Compile & Hygiene', 'Linux / Electron-Smoke', 'Windows / Electron']);
            assertDeepEqual(asked.map(([url]) => url).sort(), Object.keys(parts).sort());
            assert(asked.every(([, how]) => how === 'XMLHttpRequest'), 'asked as the page asks');
            delete parts['/microsoft/vscode/actions/runs/1/graph_partial'];
            assertDeepEqual((await GithubRead.adapter.ci.fetch(RUN, { fetchImpl })).jobs, [], 'the header alone still says how the run stands');
            assertEqual(await GithubRead.adapter.ci.fetch(RUN, { fetchImpl: async () => ({ ok: false, text: async () => '' }) }), null);
        });
    });

    // ------------------------------------------------------------ gitlab

    /** gitlab.com's status icon: the state is in the svg's test id; the words are translated. */
    const gitlabIcon = (status, variant, tag = 'span') => `<${tag} class="ci-icon gl-inline-flex ci-icon-variant-${variant}" data-testid="ci-icon">
        <span class="ci-icon-gl-icon-wrapper"><svg data-testid="status_${status}_borderless-icon" class="gl-icon s16"></svg></span>
        <span class="gl-sr-only">Status: ${status}</span></${tag}>`;
    const gitlabJob = (name, status, variant) => `<div data-testid="ci-job-item"><a data-testid="ci-job-item-content">
        ${gitlabIcon(status, variant)}<div data-testid="job-name-row">${name}</div></a></div>`;
    const gitlabPipeline = (status, variant) => `
        <div data-testid="pipeline-header">
            <header class="gl-flex"><div class="gl-flex gl-w-full gl-flex-wrap">
                <h1 class="gl-heading-1" data-testid="page-heading">#2840224658</h1>
                <div class="page-heading-actions gl-flex" data-testid="page-heading-actions"></div>
            </div></header>
            <div data-testid="pipeline-created-status">${gitlabIcon(status, variant, 'a')}</div>
        </div>
        <div class="pipeline-graph">${gitlabJob('workload', 'failed', 'danger')}${gitlabJob('unit tests', 'success', 'success')}${gitlabJob('lint', 'warning', 'warning')}</div>`;
    const gitlabMerge = `
        <div class="detail-page-header gl-flex">
            <h1 class="title gl-heading-1" data-testid="title-content">[19.2] Push deb packages to Pulp</h1>
            <div class="js-issuable-actions"><button type="button" class="btn btn-md btn-default">Code</button></div>
        </div>
        <div class="mr-state-widget"><div data-testid="pipeline-container"><div class="mr-widget-section">
            ${gitlabIcon('running', 'info', 'a')}
            <button data-testid="pipeline-mini-graph-dropdown-toggle">${gitlabIcon('success', 'success')}</button>
        </div></div></div>`;
    const PIPELINE = { site: 'gitlab', kind: 'run', repo: 'gitlab-org/ci/gitlab-runner', number: '2840224658' };
    const MERGE = { site: 'gitlab', kind: 'pull', repo: 'gitlab-org/ci/gitlab-runner', number: '7353' };

    /** GitLab's API, as a table of address → answer. */
    function gitlabApi(table) {
        const asked = [];
        const fetchImpl = async (url) => {
            asked.push(url);
            const body = table[url];
            return { ok: body !== undefined, json: async () => body };
        };
        return { asked, fetchImpl };
    }
    const API = '/api/v4/projects/gitlab-org%2Fci%2Fgitlab-runner';

    suite('forge ci watch: gitlab', () => {
        test('a pipeline reads as its header icon says, with the jobs its graph draws', async () => {
            const host = stage(gitlabPipeline('running', 'info'));
            const { ci } = BB().GitlabRead.adapter;
            const read = ci.read(document, PIPELINE);
            assertEqual(read.state, 'running');
            assertDeepEqual(read.jobs, [{ name: 'workload', state: 'failed' }, { name: 'unit tests', state: 'passed' }, { name: 'lint', state: 'passed' }],
                'a job allowed to fail is drawn as a warning, and is no failure');
            assertEqual(ci.slot(document, PIPELINE), host.querySelector('[data-testid="page-heading-actions"]'));
            teardown();
        });

        test('a merge request reads its latest pipeline\'s icon, not a stage\'s, and takes the button among its header\'s actions', async () => {
            const host = stage(gitlabMerge);
            const { ci } = BB().GitlabRead.adapter;
            assertDeepEqual(ci.read(document, MERGE), { state: 'running', jobs: [] });
            assertEqual(ci.slot(document, MERGE), host.querySelector('.js-issuable-actions'));
            assertEqual(ci.label(document, MERGE), '[19.2] Push deb packages to Pulp');
            teardown();
        });

        test('out of sight, the API: the pipeline, and those of its failed jobs that were not allowed to fail', async () => {
            const { GitlabRead } = BB();
            const { asked, fetchImpl } = gitlabApi({
                [`${API}/pipelines/2840224658`]: { id: 2840224658, status: 'failed' },
                [`${API}/pipelines/2840224658/jobs?scope[]=failed&per_page=100`]: [
                    { name: 'workload', status: 'failed', allow_failure: false },
                    { name: 'flaky', status: 'failed', allow_failure: true },
                ],
            });
            const read = await GitlabRead.fetchPipeline(PIPELINE, { fetchImpl });
            assertDeepEqual(read, { state: 'failed', jobs: [{ name: 'workload', state: 'failed' }] });
            assertEqual(asked.length, 2);
        });

        test('a merge request\'s pipeline is whichever is its latest at each look', async () => {
            const { GitlabRead } = BB();
            const { asked, fetchImpl } = gitlabApi({
                [`${API}/merge_requests/7353`]: { iid: 7353, head_pipeline: { id: 99, status: 'success' } },
                [`${API}/pipelines/99/jobs?scope[]=failed&per_page=100`]: [],
            });
            assertDeepEqual(await GitlabRead.fetchPipeline(MERGE, { fetchImpl }), { state: 'passed', jobs: [] });
            assertDeepEqual(asked, [`${API}/merge_requests/7353`, `${API}/pipelines/99/jobs?scope[]=failed&per_page=100`]);
        });

        test('an API that refuses, or has no pipeline to give, is not believed', async () => {
            const { GitlabRead } = BB();
            assertEqual(await GitlabRead.fetchPipeline(PIPELINE, gitlabApi({})), null, 'not found');
            assertEqual(await GitlabRead.fetchPipeline(MERGE, gitlabApi({ [`${API}/merge_requests/7353`]: { head_pipeline: null } })), null, 'none yet');
            assertEqual(await GitlabRead.fetchPipeline(PIPELINE, { fetchImpl: async () => { throw new TypeError('offline'); } }), null);
        });
    });

    // ----------------------------------------------------------- forgejo

    /** codeberg.org's status icon: an octicon and a colour, and a tooltip in the reader's language. */
    const forgejoIcon = (word, cls) => `<span class="tw-flex tw-items-center" data-tooltip-content="${word}"><svg class="svg ${cls}"></svg></span>`;
    const forgejoJob = (name, word, cls) => `<a class="job-brief-item" href="/forgejo/forgejo/actions/runs/205222/jobs/0">
        <div class="job-brief-item-left">${forgejoIcon(word, cls)}<span class="job-brief-name tw-mx-2 gt-ellipsis">${name}</span></div>
        <span class="job-brief-item-right"><span class="step-summary-duration">5m2s</span></span></a>`;
    const forgejoRun = `
        <div id="repo-action-view" data-locale-status-running="Läuft">
            <div class="action-view-header"><div class="action-info-summary">
                <div class="action-info-summary-title">${forgejoIcon('Läuft', 'octicon-meter text yellow job-status-rotate')}
                    <h2 class="action-info-summary-title-text">Update renovate Docker tag to v44.141.0</h2></div>
                <div class="action-info-summary-actions"></div>
            </div></div>
            <div class="action-view-left"><div class="job-brief-list">
                ${forgejoJob('backend-checks', 'Erfolg', 'octicon-check-circle-fill text green')}
                ${forgejoJob('test-unit', 'Fehlgeschlagen', 'octicon-x-circle-fill text red')}
                ${forgejoJob('test-e2e', 'Läuft', 'octicon-meter text yellow job-status-rotate')}
            </div></div>
        </div>`;
    const forgejoStatus = (name, cls, said) => `<div class="commit-status-item"><svg class="commit-status icon text ${cls}"></svg>
        <div class="status-context gt-ellipsis">${name} <span class="text light-2">${said}</span></div>
        <div class="ui status-details"><span><a href="/forgejo/forgejo/actions/runs/1/jobs/0">Details</a></span></div></div>`;
    const forgejoPull = `
        <div class="issue-title-header"><div id="issue-title-display" class="issue-title">
            <h1 class="tw-break-anywhere">Fix commit status reporting <span class="index">#14738</span></h1><div class="button-row"></div>
        </div></div>
        <div class="singular-commit"><div class="commit-status-panel">${forgejoStatus('testing / test-unit (pull_request)', 'green svg octicon-check', 'Successful')}</div></div>
        <div class="ui timeline"><div class="timeline-item comment merge box"><div class="content"><div class="ui attached segment">
            <div class="commit-status-panel"><div class="ui top attached header commit-status-header">Some checks failed <a>Hide checks</a></div>
                <div class="commit-status-list">
                    ${forgejoStatus('testing / test-unit (pull_request)', 'red svg octicon-x', 'Failing after 4m')}
                    ${forgejoStatus('testing / coverage (pull_request)', 'yellow svg octicon-dot-fill', 'Blocked by required conditions')}
                    ${forgejoStatus('lint (pull_request)', 'green svg octicon-check', 'Successful in 1m')}
                    ${forgejoStatus('pr-checklist / warn-user (pull_request_target)', 'grey svg octicon-skip', 'Has been skipped')}
                </div></div>
        </div></div></div></div>`;
    const FORGEJO_RUN = { site: 'forgejo', kind: 'run', repo: 'forgejo/forgejo', number: '205222' };
    const FORGEJO_PULL = { site: 'forgejo', kind: 'pull', repo: 'forgejo/forgejo', number: '14738' };

    suite('forge ci watch: forgejo', () => {
        test('a run reads its icons\' classes, whatever language their tooltips are in', async () => {
            const host = stage(forgejoRun);
            const { ForgejoRead, CiWatch } = BB();
            const read = ForgejoRead.adapter.ci.read(document, FORGEJO_RUN);
            assertDeepEqual(CiWatch.summarize(read), { state: 'running', failed: ['test-unit'], left: 1 });
            assertEqual(ForgejoRead.adapter.ci.label(document, FORGEJO_RUN), 'Update renovate Docker tag to v44.141.0');
            assertEqual(ForgejoRead.adapter.ci.slot(document, FORGEJO_RUN), host.querySelector('.action-info-summary-actions'));
            teardown();
        });

        test('a pull request reads the merge box\'s statuses, each named without what it says of itself', async () => {
            const host = stage(forgejoPull);
            const { ForgejoRead, CiWatch } = BB();
            const read = ForgejoRead.adapter.ci.read(document, FORGEJO_PULL);
            assertDeepEqual(read.jobs.map((job) => [job.name, job.state]), [
                ['testing / test-unit (pull_request)', 'failed'],
                ['testing / coverage (pull_request)', 'queued'],
                ['lint (pull_request)', 'passed'],
                ['pr-checklist / warn-user (pull_request_target)', 'skipped'],
            ], 'not the commit popup\'s copy');
            assertDeepEqual(CiWatch.summarize(read), { state: 'running', failed: ['testing / test-unit (pull_request)'], left: 1 });
            assertEqual(ForgejoRead.adapter.ci.slot(document, FORGEJO_PULL), host.querySelector('.button-row'));
            assertEqual(ForgejoRead.adapter.ci.label(document, FORGEJO_PULL), 'Fix commit status reporting #14738');
            teardown();
        });

        test('out of sight, a pull request is fetched as a reload would and read the same way; a run is left to its own polling', async () => {
            const { ForgejoRead } = BB();
            const asked = [];
            const page = (status, html) => async (url) => { asked.push(url); return { ok: status === 200, text: async () => html }; };
            const read = await ForgejoRead.fetchChecks(FORGEJO_PULL, { fetchImpl: page(200, forgejoPull) });
            assertEqual(asked[0], '/forgejo/forgejo/pulls/14738');
            assertEqual(read.jobs.length, 4);
            assertEqual(await ForgejoRead.fetchChecks(FORGEJO_PULL, { fetchImpl: page(503, 'busy') }), null);
            assertEqual(await ForgejoRead.fetchChecks(FORGEJO_PULL, { fetchImpl: page(200, '<p>no checks here</p>') }), null);
            asked.length = 0;
            assertEqual(await ForgejoRead.fetchChecks(FORGEJO_RUN, { fetchImpl: page(200, forgejoPull) }), null);
            assertEqual(asked.length, 0);
        });
    });

    // ------------------------------------------------------- folder download

    /** Just enough of a zip reader for a stored archive: each entry's name and text. */
    function unzip(bytes) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const end = bytes.length - 22;
        let at = view.getUint32(end + 16, true);
        const out = {};
        for (let i = view.getUint16(end + 10, true); i > 0; i--) {
            const size = view.getUint32(at + 24, true);
            const nameLength = view.getUint16(at + 28, true);
            const local = view.getUint32(at + 42, true);
            const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
            const start = local + 30 + view.getUint16(local + 26, true);
            out[name] = new TextDecoder().decode(bytes.subarray(start, start + size));
            at += 46 + nameLength;
        }
        return out;
    }

    const OID = 'c0ffee'.padEnd(40, '0');
    const FOLDER_URL = '/a/b/tree/feature/x/src/lib';
    const folderRow = `<div class="react-code-view-header-element--wide"><div class="d-flex gap-2">
        <div><button type="button">Add file</button></div><button type="button" data-testid="tree-overflow-menu-anchor"></button>
        </div></div>`;
    const treeJson = (path, items = []) => ({ payload: { codeViewTreeRoute: { path, refInfo: { name: 'feature/x', currentOid: OID }, tree: { items } } } });

    /** github.com as the folder download sees it: a URL in, JSON or bytes out, and every URL written down. */
    function fakeGithub(routes) {
        const asked = [];
        const fetchImpl = async (url) => {
            asked.push(url);
            const answer = routes[url];
            if (answer === undefined) return { ok: false, status: 404, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) };
            return {
                ok: true,
                status: 200,
                json: async () => answer,
                arrayBuffer: async () => new TextEncoder().encode(String(answer)).buffer,
            };
        };
        return { fetchImpl, asked };
    }

    function makeFolder({ routes = {}, path = FOLDER_URL, on = true } = {}) {
        const settings = { githubFolderDownload: on };
        const notes = [];
        const saved = [];
        const github = fakeGithub(routes);
        const win = { location: { pathname: path } };
        const ui = BB().FolderDownload.createFolderDownload({
            adapter: BB().GithubRead.adapter, watcher: nowWatcher(), notify: (text, type) => notes.push([text, type]),
            getSettings: () => settings, fetchImpl: github.fetchImpl, win,
            save: async (name, blob) => saved.push({ name, type: blob.type, files: unzip(new Uint8Array(await blob.arrayBuffer())) }),
        });
        const button = () => document.getElementById(BB().FolderDownload.BUTTON_ID);
        return { ui, settings, notes, saved, github, win, button };
    }

    const lib = {
        [FOLDER_URL]: treeJson('src/lib'),
        [`/a/b/tree-list/${OID}`]: { paths: ['README.md', 'src/lib/a.js', 'src/lib/deep/b.txt', 'src/libx/not-this.js'] },
        [`/a/b/raw/${OID}/src/lib/a.js`]: 'export const a = 1;',
        [`/a/b/raw/${OID}/src/lib/deep/b.txt`]: 'bé',
    };

    suite('forge folder download', () => {
        test('it goes first in the folder\'s own row while its switch is on, and not on a file or once the switch is off', async () => {
            const host = stage(folderRow);
            const { ui, settings, button, win } = makeFolder();
            ui.install();
            assertEqual(host.querySelector('.d-flex').firstElementChild, button());
            assertEqual(button().textContent, 'Download folder');
            assertEqual(button().className, 'Button Button--secondary Button--medium bb-folder-download');
            settings.githubFolderDownload = false;
            ui.refreshSurfaces();
            assertEqual(button(), null);
            settings.githubFolderDownload = true;
            win.location.pathname = '/a/b/blob/feature/x/src/lib/a.js';
            ui.onNavigate();
            assertEqual(button(), null, 'a file is not a folder');
            teardown();
        });

        test('a click zips the files under the folder, at the commit the page is on, named from the folder', async () => {
            stage(folderRow);
            const { ui, button, saved, notes, github } = makeFolder({ routes: lib });
            ui.install();
            button().click();
            await waitFor(() => saved.length, 'the zip to be saved');
            assertEqual(saved[0].name, 'lib.zip');
            assertEqual(saved[0].type, 'application/zip');
            assertDeepEqual(saved[0].files, { 'lib/a.js': 'export const a = 1;', 'lib/deep/b.txt': 'bé' });
            assertDeepEqual(notes.pop(), ['Saved lib.zip — 2 files', 'success']);
            assert(!github.asked.some((url) => /libx/.test(url)), 'a sibling that shares the name\'s start was fetched');
            await waitFor(() => !button().disabled, 'the button to come back');
            assertEqual(button().textContent, 'Download folder');
            teardown();
        });

        test('when the file finder says nothing of the folder, its folders are walked one by one', async () => {
            stage(folderRow);
            const routes = {
                [FOLDER_URL]: treeJson('src/lib', [{ path: 'src/lib/deep', contentType: 'directory' }, { path: 'src/lib/a.js', contentType: 'file' },
                    { path: 'src/lib/vendor', contentType: 'submodule' }]),
                [`/a/b/tree/${OID}/src/lib/deep`]: treeJson('src/lib/deep', [{ path: 'src/lib/deep/b.txt', contentType: 'file' }]),
                [`/a/b/raw/${OID}/src/lib/a.js`]: 'a',
                [`/a/b/raw/${OID}/src/lib/deep/b.txt`]: 'b',
            };
            const { ui, button, saved } = makeFolder({ routes });
            ui.install();
            button().click();
            await waitFor(() => saved.length, 'the zip to be saved');
            assertDeepEqual(Object.keys(saved[0].files), ['lib/deep/b.txt', 'lib/a.js']);
            teardown();
        });

        test('a file that will not come saves nothing and says which', async () => {
            stage(folderRow);
            const routes = { ...lib };
            delete routes[`/a/b/raw/${OID}/src/lib/deep/b.txt`];
            const { ui, button, saved, notes } = makeFolder({ routes });
            ui.install();
            button().click();
            await waitFor(() => notes.length, 'the failure to be told');
            assertDeepEqual(notes[0], ['Could not fetch src/lib/deep/b.txt (404)', 'error']);
            assertEqual(saved.length, 0);
            await waitFor(() => !button().disabled, 'the button to come back');
            teardown();
        });
    });

    // ------------------------------------------------------- topic search

    /** A topic page's column as github.com drew /topics/cloud-native in October 2026, cut to one card. */
    const topicColumn = `<div class="topic p-responsive container-lg"><div class="d-md-flex gutter-md"><div class="col-md-8 col-lg-9" data-hpc>
        <h2 class="h3 color-fg-muted">Here are 3,859 public repositories matching this topic...</h2>
        <div class="d-sm-flex"><details class="details-reset details-overlay select-menu"><summary>Language: All</summary></details>
            <details class="details-reset details-overlay select-menu"><summary>Sort: Most stars</summary></details></div>
        <article class="border rounded color-shadow-small color-bg-subtle tmp-my-4"><h3>ClickHouse / ClickHouse</h3></article>
        <form class="ajax-pagination-form js-ajax-pagination"><button type="submit">Load more…</button></form>
        </div></div></div>`;

    const repo = (n) => ({ full_name: `owner${n}/repo-${n}`, description: `Repo <${n}>`, stargazers_count: 12345, forks_count: 1,
        language: 'Go', topics: ['go', 'kubernetes'], pushed_at: '2026-10-17T10:00:00Z' });

    /** The API as the search sees it: each search's `q` and page written down, and a hundred repositories while there are more. */
    function fakeApi({ total = 150 } = {}) {
        const asked = [];
        const fetchImpl = async (url) => {
            const params = new URL(url).searchParams;
            const page = Number(params.get('page'));
            asked.push([params.get('q'), page, params.get('sort')]);
            const count = Math.max(0, Math.min(100, total - (page - 1) * 100));
            const items = Array.from({ length: count }, (_, i) => repo((page - 1) * 100 + i + 1));
            return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ total_count: total, items }) };
        };
        return { fetchImpl, asked };
    }

    function makeTopics({ on = true, stored = null, total } = {}) {
        const settings = { githubTopicSearch: on };
        const api = fakeApi({ total });
        const saved = [];
        const store = { load: async () => stored, save: (kept) => saved.push(kept) };
        const win = { location: { pathname: '/topics/cloud-native' } };
        const ui = BB().TopicSearch.createTopicSearch({
            adapter: BB().GithubRead.adapter, watcher: nowWatcher(), getSettings: () => settings, fetchImpl: api.fetchImpl, store, win,
        });
        const box = () => document.getElementById(BB().TopicSearch.BOX_ID);
        const $ = (selector) => box().querySelector(selector);
        const type = (text) => {
            $('.bb-topic-input').value = text;
            $('.bb-topic-form').dispatchEvent(new Event('submit', { cancelable: true }));
        };
        return { ui, settings, api, saved, win, box, $, type };
    }

    suite('github topic search', () => {
        test('it goes under the page\'s own menus, with the page\'s topic in it, while its switch is on', async () => {
            const host = stage(topicColumn);
            const { ui, settings, box, $ } = makeTopics();
            ui.install();
            assertEqual(host.querySelector('.d-sm-flex').nextElementSibling, box());
            assertEqual($('.topic-tag').textContent, 'cloud-native');
            settings.githubTopicSearch = false;
            ui.refreshSurfaces();
            assertEqual(box(), null);
            teardown();
        });

        test('a search with more topics and a filter takes the page\'s list over, and Clear gives it back', async () => {
            const host = stage(topicColumn);
            const { ui, api, $, type } = makeTopics();
            ui.install();
            type('kubernetes Go pushed:>2026-06-01');
            await waitFor(() => $('.bb-topic-list').children.length, 'the cards');
            assertDeepEqual(api.asked, [['topic:cloud-native topic:kubernetes topic:go pushed:>2026-06-01', 1, 'stars']]);
            assertEqual($('.bb-topic-said').textContent, 'Here are 150 public repositories matching cloud-native, kubernetes and go, with pushed:>2026-06-01');
            assertEqual($('.bb-topic-list').children.length, 100);
            assertEqual($('article h3 a.text-bold').getAttribute('href'), '/owner1/repo-1');
            assertEqual($('article p').textContent, 'Repo <1>', 'a description is text, not markup');
            const column = host.querySelector('[data-hpc]');
            assert(column.classList.contains(BB().TopicSearch.SEARCHING), 'the page\'s own list is still shown');

            $('.bb-topic-more').click();
            await waitFor(() => $('.bb-topic-list').children.length === 150, 'the second page');
            assertEqual($('.bb-topic-more').hidden, true, 'there is no third');

            $('.bb-topic-clear').click();
            assert(!column.classList.contains(BB().TopicSearch.SEARCHING));
            assertEqual($('.bb-topic-results').hidden, true);
            assertEqual($('.bb-topic-terms').children.length, 0);
            teardown();
        });

        test('a removed topic searches again, and once the box is empty the page\'s own list is back', async () => {
            const host = stage(topicColumn);
            const { ui, api, $, type } = makeTopics();
            ui.install();
            type('helm stars:>500');
            await waitFor(() => api.asked.length === 1, 'the search');
            assertEqual(api.asked[0][0], 'topic:cloud-native topic:helm stars:>500');
            $('.bb-topic-remove[data-index="0"]').click();
            await waitFor(() => api.asked.length === 2, 'the search again');
            assertEqual(api.asked[1][0], 'topic:cloud-native stars:>500');
            $('.bb-topic-remove[data-index="0"]').click();
            assert(!host.querySelector('[data-hpc]').classList.contains(BB().TopicSearch.SEARCHING));
            assertEqual(api.asked.length, 2, 'an empty box is no search');
            teardown();
        });

        test('the filters and sort searched with are kept, put back in the box on the next page, and not searched', async () => {
            stage(topicColumn);
            const first = makeTopics();
            first.ui.install();
            first.$('.bb-topic-sort').value = 'updated';
            first.type('helm stars:>500');
            await waitFor(() => first.api.asked.length === 1, 'the search');
            assertDeepEqual(first.saved, [{ filters: ['stars:>500'], sort: 'updated' }], 'the topics are the page\'s own');

            stage(topicColumn);
            const next = makeTopics({ stored: first.saved[0] });
            next.ui.install();
            await waitFor(() => next.$('.bb-topic-terms').children.length, 'the kept filter');
            assertEqual(next.$('.bb-topic-filter').textContent, 'stars:>500');
            assertEqual(next.$('.bb-topic-sort').value, 'updated');
            assertEqual(next.api.asked.length, 0, 'a visit spent a search');
            next.$('.bb-topic-clear').click();
            assertDeepEqual(next.saved, [{ filters: [], sort: 'updated' }], 'cleared, and forgotten');
            teardown();
        });
    });
})();
