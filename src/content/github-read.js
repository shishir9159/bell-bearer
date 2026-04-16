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
 *
 * A folder download, once it is clicked, keeps to the same rule: the
 * folder's own JSON, the file finder's `tree-list` of the commit, and each
 * file's `/raw/` copy, every one a request the page itself makes.
 *
 * The topic search is the one exception, and goes to the API on purpose: no
 * page of github.com asks for several topics at once but its own search,
 * whose JSON is shaped for its React app and would go with your session.
 * api.github.com's search is documented and is asked signed out, so your
 * account is never part of it — at the price of ten searches a minute.
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

        /**
         * A folder's own row of buttons — Go to file, Add file, its "…" —
         * found by the menu at its end. The header is drawn twice, a wide
         * and a narrow copy, one of them hidden; the wide one first.
         */
        folderSlot: ['.react-code-view-header-element--wide div:has(> [data-testid="tree-overflow-menu-anchor"])',
            'div:has(> [data-testid="tree-overflow-menu-anchor"])', '.file-navigation .d-flex'],

        /**
         * A topic page's column of repositories, which the search takes over,
         * and the row of its Language and Sort menus that the search goes
         * under; the heading above that row where the row is not found.
         */
        topicColumn: ['.topic [data-hpc]', '.topic .col-md-8', '.topic .col-lg-9'],
        topicFilters: [':scope > .d-sm-flex:has(details.select-menu)', ':scope > div:has(> details.select-menu)'],
        topicHeading: [':scope > h2'],
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

    // ------------------------------------------------------------ folders

    const JSON_HEADERS = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

    /**
     * /owner/repo/tree/<ref>/<path> is a folder. Where the ref ends and the
     * path begins is the page's to say — a branch may have slashes in it —
     * so this only says that it is one.
     */
    function folderAt(pathname) {
        const [owner, repo, area, ...rest] = String(pathname || '').split(/[?#]/)[0].split('/').filter(Boolean);
        return owner && repo && area === 'tree' && rest.length ? { repo: `${owner}/${repo}`, url: `/${owner}/${repo}/tree/${rest.join('/')}` } : null;
    }

    /**
     * The commit a folder is at and its path in the repo, as the page asks
     * for them when it moves to a folder: its own address, as JSON. Read
     * there rather than off the page's embedded data, which is the first
     * page's and goes stale on every move after it.
     */
    async function readFolder(folder, { fetchImpl = root.fetch } = {}) {
        try {
            const response = await fetchImpl(folder.url, { credentials: 'same-origin', headers: JSON_HEADERS });
            if (!response.ok) return null;
            const data = await response.json();
            const route = data && data.payload && data.payload.codeViewTreeRoute;
            const oid = route && route.refInfo && route.refInfo.currentOid;
            if (!/^[0-9a-f]{40}$/.test(oid || '') || typeof route.path !== 'string') return null;
            return { oid, path: route.path, items: (route.tree && route.tree.items) || [] };
        } catch (_) {
            return null;
        }
    }

    /**
     * Every file under the folder, as paths from the repo's root. The file
     * finder's own list comes first — the whole repo at that commit, in one
     * request — and each folder's JSON, one by one, only when that says
     * nothing about this one.
     */
    async function listFolder(folder, at, { fetchImpl = root.fetch } = {}) {
        const prefix = `${at.path}/`;
        try {
            const response = await fetchImpl(`/${folder.repo}/tree-list/${at.oid}`, { credentials: 'same-origin', headers: JSON_HEADERS });
            const data = response.ok ? await response.json() : null;
            const inside = (data && Array.isArray(data.paths) ? data.paths : []).filter((path) => path.startsWith(prefix));
            if (inside.length) return inside;
        } catch (_) { /* walked below */ }

        const files = [];
        const walk = async (items) => {
            for (const item of items) {
                if (item.contentType === 'directory') {
                    const below = await readFolder({ url: `/${folder.repo}/tree/${at.oid}/${encodePath(item.path)}` }, { fetchImpl });
                    if (!below) throw new Error(`Could not read ${item.path}`);
                    await walk(below.items);
                } else if (item.contentType !== 'submodule') {
                    files.push(item.path);
                }
            }
        };
        await walk(at.items);
        return files;
    }

    const encodePath = (path) => String(path).split('/').map(encodeURIComponent).join('/');

    /**
     * The file's raw copy at the commit, from github.com itself. It redirects
     * to raw.githubusercontent.com — with a token on the way for a private
     * repo, which the CDN would refuse without — and that answers any origin.
     */
    const rawUrl = (folder, at, path) => `/${folder.repo}/raw/${at.oid}/${encodePath(path)}`;

    // ------------------------------------------------------------- topics

    const SEARCH_URL = 'https://api.github.com/search/repositories';
    /** The most the search hands back per request, and in all: past 1,000 it answers 422. */
    const PER_PAGE = 100;
    const MAX_RESULTS = 1000;

    /**
     * A topic as GitHub spells one: lower case, words joined by hyphens, at
     * most 50 characters. "Cloud Native" and "topic:cloud-native" are both
     * typed for cloud-native; anything left empty is no topic.
     */
    function topicName(typed) {
        return String(typed || '').trim().toLowerCase().replace(/^topic:/, '')
            .replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    }

    /** /topics/<name> is a topic's page; /topics itself, and anything under a topic, is not. */
    function topicAt(pathname) {
        const [area, name, more] = String(pathname || '').split(/[?#]/)[0].split('/').filter(Boolean);
        if (area !== 'topics' || !name || more) return null;
        try { return topicName(decodeURIComponent(name)) || null; } catch (_) { return null; }
    }

    /**
     * One word typed into the search box: a topic — `helm`, `topic:helm` —
     * or any other of the search's qualifiers, `stars:>500` or
     * `pushed:>2026-06-01`, kept as typed but for the qualifier's case.
     * Null for what is neither.
     */
    function topicTerm(typed) {
        const word = String(typed || '').trim();
        const qualifier = /^(-?[a-z][a-z_-]*):(\S+)$/i.exec(word);
        if (qualifier && qualifier[1].toLowerCase() !== 'topic') return { filter: `${qualifier[1].toLowerCase()}:${qualifier[2]}` };
        // A filter not finished — "stars:" — is not the topic "stars".
        if (/:/.test(word.replace(/^topic:/i, ''))) return null;
        const topic = topicName(word);
        return topic ? { topic } : null;
    }

    /** The search's `q`: every topic, which all have to be on a repository, then every filter. */
    function topicQuery({ topics = [], filters = [] } = {}) {
        const named = [...new Set(topics.map(topicName).filter(Boolean))].map((topic) => `topic:${topic}`);
        return [...named, ...new Set(filters)].join(' ');
    }

    /** The search's address; a blank `sort` is GitHub's best match. */
    function topicSearchUrl(search, page = 1) {
        const params = new URLSearchParams({ q: topicQuery(search), per_page: String(PER_PAGE), page: String(page) });
        if (search.sort) {
            params.set('sort', search.sort);
            params.set('order', 'desc');
        }
        return `${SEARCH_URL}?${params}`;
    }

    /** A repository as a topic page's card needs it, from the search's item. */
    const repoOf = (item) => ({
        repo: String(item.full_name || ''),
        description: String(item.description || ''),
        stars: Number(item.stargazers_count) || 0,
        forks: Number(item.forks_count) || 0,
        language: String(item.language || ''),
        topics: Array.isArray(item.topics) ? item.topics.map(String) : [],
        pushed: String(item.pushed_at || ''),
        archived: item.archived === true,
    });

    /**
     * One page of the search: `{ total, repos, more }`, or `{ error }` worded
     * for the page. Asked without credentials, so the search is never made
     * as you; GitHub then allows ten a minute from this address, and says
     * when the next one is, which is passed on.
     */
    async function searchTopics(search, page = 1, { fetchImpl = root.fetch, now = Date.now() } = {}) {
        let response = null;
        try {
            response = await fetchImpl(topicSearchUrl(search, page), { credentials: 'omit', headers: { Accept: 'application/vnd.github+json' } });
        } catch (_) {
            return { error: 'GitHub\'s search could not be reached' };
        }
        const header = (name) => (response.headers && response.headers.get(name)) || '';
        // A 403 is also GitHub refusing the request for some other reason,
        // with a message of its own; only one that says the minute is used
        // up, or asks for a wait, is the limit.
        const limited = response.status === 429 || (response.status === 403 && (header('x-ratelimit-remaining') === '0' || header('retry-after')));
        if (limited) {
            const reset = Number(header('x-ratelimit-reset')) * 1000;
            const wait = Number(header('retry-after')) || (reset > now ? Math.ceil((reset - now) / 1000) : 60);
            return { error: `GitHub allows ten searches a minute without signing in — try again in ${wait}s`, wait };
        }
        let data = null;
        try { data = await response.json(); } catch (_) { /* answered below */ }
        if (!response.ok || !data || !Array.isArray(data.items)) {
            return { error: (data && data.message) || `GitHub's search answered ${response.status}` };
        }
        const total = Number(data.total_count) || 0;
        const repos = data.items.map(repoOf);
        return { total, repos, more: repos.length === PER_PAGE && page * PER_PAGE < Math.min(total, MAX_RESULTS) };
    }

    const adapter = {
        site: 'github',
        ci: {
            read,
            fetch: fetchState,
            label,
            slot,
            /**
             * Primer's own button, which every github.com page carries the
             * styles for. Medium, as both its neighbours are: the small one
             * stood 28px high in 12px type beside a pull request's Code.
             */
            buttonClass: 'Button Button--secondary Button--medium',
        },
        folder: {
            at: folderAt,
            read: readFolder,
            list: listFolder,
            rawUrl,
            slot: (doc) => find('folderSlot', doc),
            buttonClass: 'Button Button--secondary Button--medium',
        },
        topics: {
            at: topicAt,
            term: topicTerm,
            query: topicQuery,
            search: searchTopics,
            column: (doc) => find('topicColumn', doc),
            /** What the search bar goes after: the page's Language and Sort row, or its heading. */
            anchor: (column) => find('topicFilters', column) || find('topicHeading', column),
            MAX_RESULTS,
        },
    };

    const GithubRead = {
        SELECTORS, adapter, readRun, readChecks, countedJobs, fetchChecks, fetchRun, jobName, folderAt, readFolder, listFolder,
        topicName, topicAt, topicTerm, topicQuery, topicSearchUrl, searchTopics,
    };

    root.BB = root.BB || {};
    root.BB.GithubRead = GithubRead;
    if (typeof module !== 'undefined' && module.exports) module.exports = GithubRead;
})(typeof globalThis !== 'undefined' ? globalThis : this);
