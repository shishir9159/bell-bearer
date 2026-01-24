/**
 * gitlab.com: every selector, and every request, in one file — the GitLab
 * adapter, answering the list src/content/github-read.js answers.
 *
 * Several spellings each, newest first, never collapsed to one: those below
 * lead with what gitlab.com drew in October 2026, a Vue page whose hooks are
 * `data-testid`s, and a status icon whose state is in its svg's test id
 * (`status_failed_borderless-icon`) rather than in words, which are
 * translated.
 *
 * GitLab's pages stop polling while they are out of sight — its pipeline
 * graph and a merge request's widget both pause on a hidden tab — so the
 * page alone would only tell a watch that its run ended once someone looked.
 * The run is read from GitLab's documented REST API as well, which takes the
 * page's own session for a request from the page's own origin: the pipeline,
 * or a merge request's latest one, and its failed jobs. Two small requests a
 * minute, and only while a watch is on.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Selectors = ns.Selectors || req('../shared/selectors.js');
    const CiWatch = ns.CiWatch || req('../shared/ci-watch.js');

    const SELECTORS = Object.freeze({
        /** A pipeline's own state, in its header. */
        pipelineIcon: ['[data-testid="pipeline-header"] [data-testid="ci-icon"]', '.ci-header-container [data-testid="ci-icon"]',
            '.ci-header-container .ci-status'],
        /** Each job drawn in the pipeline's graph; a parallel group's are behind its dropdown, and the API has them. */
        pipelineJob: ['[data-testid="ci-job-item"]', '.ci-job-component'],
        jobName: ['[data-testid="job-name-row"]', '.ci-job-name-component', '.ci-status-text'],
        pipelineSlot: ['[data-testid="pipeline-header"] [data-testid="page-heading-actions"]', '[data-testid="page-heading-actions"]',
            '.page-heading-actions'],
        /** A merge request's latest pipeline, in the widget under its description. */
        mergeIcon: ['[data-testid="pipeline-container"] [data-testid="ci-icon"]', '.mr-widget-pipeline [data-testid="ci-icon"]',
            '.mr-widget-pipeline .ci-status-icon'],
        mergeTitle: ['[data-testid="title-content"]', '.detail-page-header .title', 'h1.title'],
        mergeSlot: ['.detail-page-header .js-issuable-actions', '.detail-page-header-actions', '.detail-page-header'],
    });

    const { find, findAll } = Selectors.table(SELECTORS);

    const text = (element) => (element ? element.textContent.replace(/\s+/g, ' ').trim() : '');

    /** The svg's test id carries the state; the icon's class names its colour, and its text a translation of it. */
    function stateOfIcon(icon) {
        if (!icon) return null;
        const svg = icon.querySelector('svg');
        const said = [svg && svg.getAttribute('data-testid'), icon.getAttribute('class'), icon.getAttribute('aria-label')].filter(Boolean).join(' ');
        return CiWatch.stateOf(said);
    }

    function read(doc, page) {
        if (!page) return null;
        if (page.kind === 'pull') {
            const state = stateOfIcon(find('mergeIcon', doc));
            return state ? { state, jobs: [] } : null;
        }
        const state = stateOfIcon(find('pipelineIcon', doc));
        const jobs = findAll('pipelineJob', doc).map((item) => ({
            name: text(find('jobName', item)),
            state: stateOfIcon(item.querySelector('[data-testid="ci-icon"], .ci-status-icon') || item),
        }));
        return state || jobs.length ? { state, jobs } : null;
    }

    async function getJson(url, fetchImpl) {
        const response = await fetchImpl(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        return response.ok ? response.json() : null;
    }

    /**
     * The pipeline as GitLab's API has it, and the jobs in it that failed
     * and were not allowed to. A merge request's is whichever pipeline is
     * its latest at each look, so a push mid-watch is followed.
     */
    async function fetchPipeline(page, { fetchImpl = root.fetch } = {}) {
        if (!page) return null;
        const project = `/api/v4/projects/${encodeURIComponent(page.repo)}`;
        try {
            let pipeline = null;
            if (page.kind === 'pull') {
                const merge = await getJson(`${project}/merge_requests/${page.number}`, fetchImpl);
                pipeline = merge && merge.head_pipeline;
            } else {
                pipeline = await getJson(`${project}/pipelines/${page.number}`, fetchImpl);
            }
            if (!pipeline || !pipeline.id || !pipeline.status) return null;
            const failed = await getJson(`${project}/pipelines/${pipeline.id}/jobs?scope[]=failed&per_page=100`, fetchImpl);
            const jobs = (Array.isArray(failed) ? failed : [])
                .filter((job) => job && !job.allow_failure)
                .map((job) => ({ name: String(job.name || ''), state: 'failed' }));
            return { state: CiWatch.stateOf(pipeline.status), jobs };
        } catch (_) {
            return null;
        }
    }

    function label(doc, page) {
        const title = page && page.kind === 'pull' ? text(find('mergeTitle', doc)) : '';
        return title || String(doc.title || '').split(' · ')[0].trim();
    }

    function slot(doc, page) {
        if (!page) return null;
        return find(page.kind === 'pull' ? 'mergeSlot' : 'pipelineSlot', doc);
    }

    const adapter = {
        site: 'gitlab',
        ci: {
            read,
            fetch: fetchPipeline,
            label,
            slot,
            /** GitLab UI's own button, which every gitlab.com page carries the styles for. */
            buttonClass: 'btn btn-default btn-md gl-button',
        },
    };

    const GitlabRead = { SELECTORS, adapter, fetchPipeline, stateOfIcon };

    root.BB = root.BB || {};
    root.BB.GitlabRead = GitlabRead;
    if (typeof module !== 'undefined' && module.exports) module.exports = GitlabRead;
})(typeof globalThis !== 'undefined' ? globalThis : this);
