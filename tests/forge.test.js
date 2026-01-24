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
})();
