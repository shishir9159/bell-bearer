/**
 * github.com: every selector, and every request, in one file — the GitHub
 * adapter, answering the list src/content/gitlab-read.js and
 * src/content/forgejo-read.js answer too.
 *
 * The selectors follow the rule every site's table here follows: several
 * spellings each, newest first, and never collapse a list to one current
 * selector. Those below lead with what github.com drew in October 2026: an
 * Actions run's header and job graph rendered on the server and kept live
 * over its socket, and a pull request's merge box drawn by React.
 *
 * Neither page can be trusted to keep itself current, which is the whole of
 * what `fetch` is for. A pull request's checks stop in a hidden tab: they sat
 * at "10 in progress" while the run itself was down to six. A run page
 * usually goes on — jobs were seen finishing in a tab hidden for minutes —
 * but a watched one, on screen, also stopped for good, still "running" ten
 * minutes after a fresh load of it said the run had passed, and nothing
 * ended the watch. So about once a minute the watch asks for what the page
 * itself asks for when it updates: a run's `header_partial` and
 * `graph_partial`, and a pull request's `page_data/status_checks`, with the
 * page's own session. No other request is made, and none to GitHub's API,
 * which would count against sixty an hour.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Selectors = ns.Selectors || req('../shared/selectors.js');
    const CiWatch = ns.CiWatch || req('../shared/ci-watch.js');

    const SELECTORS = Object.freeze({
        /** An Actions run's own state: the icon before its title. Drawn twice, one per screen width. */
        runIcon: ['.actions-workflow-runs-status svg[aria-label]', '.PageHeader-leadingVisual svg[aria-label]'],
        /**
         * Each of a run's jobs, in the graph. The sidebar lists them again,
         * with no label on a finished job's icon, so it comes last.
         */
        runJob: ['streaming-graph-job a.WorkflowJob-title', 'streaming-graph-job a[href*="/job/"]', '.WorkflowJob a[href*="/job/"]',
            'a[href*="/actions/runs/"][href*="/job/"]'],
        runTitle: ['h1.PageHeader-title .markdown-title', 'h1.PageHeader-title'],
        runSlot: ['.PageHeader-actions', '.PageHeader-titleBar'],

        /**
         * A pull request's checks, one list per state, each named by a
         * heading only a screen reader sees: "failing checks", "in progress
         * checks". The old merge box drew one list, an icon per row.
         */
        checkList: ['section[aria-label="Checks"] ul[aria-labelledby]', '.merge-status-list'],
        checkRow: ['li[aria-label]', '.merge-status-item'],
        checkName: ['h4', 'strong'],
        /** "2 failing, 1 in progress, 33 successful checks": all there is while the list is folded away. */
        checkCounts: ['section[aria-label="Checks"] h3 + p', 'section[aria-label="Checks"] p', '.branch-action-item .status-meta'],
        pullTitle: ['[data-component="PH_Title"] .markdown-title', 'h1 .markdown-title', 'bdi.js-issue-title', '.js-issue-title'],
        pullSlot: ['[class*="PageHeader-Actions"] .d-flex.gap-2', '[class*="PageHeader-Actions"]', '.gh-header-actions'],
    });

    const { find, findAll } = Selectors.table(SELECTORS);

    const text = (element) => (element ? element.textContent.replace(/\s+/g, ' ').trim() : '');

    /** Everything an icon says about its state, for CiWatch.stateOf to read. */
    const signal = (element) => (element
        ? ['aria-label', 'class', 'data-testid', 'title'].map((name) => element.getAttribute(name) || '').join(' ')
        : '');

    /** A job's name without its duration: "Linux / Electron-Smoke", not "Linux/Electron-Smoke15m 49s". */
    function jobName(link) {
        const parts = [...link.querySelectorAll('.css-truncate')].map(text).filter(Boolean);
        if (parts.length) return parts.join(' / ');
        const copy = link.cloneNode(true);
        copy.querySelectorAll('svg, .text-small, .sr-only, relative-time').forEach((node) => node.remove());
        return text(copy);
    }

    function readRun(doc) {
        const icon = find('runIcon', doc);
        const state = icon ? CiWatch.stateOf(signal(icon)) : null;
        const jobs = findAll('runJob', doc).map((link) => ({ name: jobName(link), state: CiWatch.stateOf(signal(link.querySelector('svg'))) }));
        return state || jobs.length ? { state, jobs } : null;
    }

    /** "2 failing, 1 in progress" as two failed and one running job, unnamed. */
    function countedJobs(said) {
        const jobs = [];
        for (const [, count, words] of String(said || '').matchAll(/(\d+)\s+([a-z][a-z ]*?)(?=,|\s+checks?\b|$)/gi)) {
            const state = CiWatch.stateOf(words);
            for (let i = 0; state && i < Math.min(Number(count), 500); i++) jobs.push({ name: '', state });
        }
        return jobs;
    }

    function readChecks(doc) {
        const jobs = [];
        for (const list of findAll('checkList', doc)) {
            const id = list.getAttribute('aria-labelledby');
            const heading = id ? doc.getElementById(id) : null;
            const listState = heading ? CiWatch.stateOf(text(heading)) : null;
            for (const row of findAll('checkRow', list)) {
                const state = listState || CiWatch.stateOf(signal(row.querySelector('svg')));
                jobs.push({ name: text(find('checkName', row)) || row.getAttribute('aria-label') || '', state });
            }
        }
        if (!jobs.length) jobs.push(...countedJobs(text(find('checkCounts', doc))));
        return jobs.length ? { state: null, jobs } : null;
    }

    /** What the page draws of the run or the checks; null when it draws neither yet. */
    function read(doc, page) {
        if (!page) return null;
        return page.kind === 'run' ? readRun(doc) : readChecks(doc);
    }

    /**
     * The checks as the merge box itself fetches them. Null for any answer
     * not in the shape it was seen in: the page is read instead.
     */
    async function fetchChecks(page, { fetchImpl = root.fetch } = {}) {
        if (!page || page.kind !== 'pull') return null;
        try {
            const response = await fetchImpl(`/${page.repo}/pull/${page.number}/page_data/status_checks`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Verified-Fetch': 'true' },
            });
            if (!response.ok) return null;
            const data = await response.json();
            const checks = data && Array.isArray(data.statusChecks) ? data.statusChecks : null;
            if (!checks || !checks.length) return null;
            return { state: null, jobs: checks.map((check) => ({ name: String(check.displayName || ''), state: CiWatch.stateOf(check.state) })) };
        } catch (_) {
            return null;
        }
    }

    /**
     * A run as its page refreshes itself: the header, which has the run's
     * icon, and the graph, which has its jobs — 36 KB between them, where
     * the whole page is over 200.
     */
    async function fetchRun(page, { fetchImpl = root.fetch, parse = (html) => new DOMParser().parseFromString(html, 'text/html') } = {}) {
        if (!page || page.kind !== 'run') return null;
        const base = `/${page.repo}/actions/runs/${page.number}`;
        try {
            const parts = await Promise.all(['header_partial', 'graph_partial'].map(async (part) => {
                const response = await fetchImpl(`${base}/${part}`, {
                    credentials: 'same-origin',
                    headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' },
                });
                return response.ok ? response.text() : '';
            }));
            return readRun(parse(parts.join('\n')));
        } catch (_) {
            return null;
        }
    }

    const fetchState = (page, options) => (page && page.kind === 'run' ? fetchRun(page, options) : fetchChecks(page, options));

    function label(doc, page) {
        const title = text(find(page && page.kind === 'run' ? 'runTitle' : 'pullTitle', doc));
        return title || String(doc.title || '').split(' · ')[0].trim();
    }

    function slot(doc, page) {
        if (!page) return null;
        return find(page.kind === 'run' ? 'runSlot' : 'pullSlot', doc);
    }

    const adapter = {
        site: 'github',
        ci: {
            read,
            fetch: fetchState,
            label,
            slot,
            /** Primer's own button, which every github.com page carries the styles for. */
            buttonClass: 'Button Button--secondary Button--small',
        },
    };

    const GithubRead = { SELECTORS, adapter, readRun, readChecks, countedJobs, fetchChecks, fetchRun, jobName };

    root.BB = root.BB || {};
    root.BB.GithubRead = GithubRead;
    if (typeof module !== 'undefined' && module.exports) module.exports = GithubRead;
})(typeof globalThis !== 'undefined' ? globalThis : this);
