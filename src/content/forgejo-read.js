/**
 * Codeberg, and any Forgejo or Gitea: every selector, and every request, in
 * one file — the Forgejo adapter, answering the list
 * src/content/github-read.js answers.
 *
 * Several spellings each, newest first, never collapsed to one: those below
 * lead with what codeberg.org drew in October 2026. Forgejo's status icons
 * name a colour and an octicon (`octicon-x-circle-fill text red`) and their
 * tooltips a translated word, so the classes are what is read.
 *
 * The two kinds of page differ out of sight. An Actions run is a Vue view
 * that polls its run for as long as it is open, and went on doing so — once
 * a minute, as Chrome allows — in a tab hidden for ten minutes. A pull
 * request's checks are drawn on the server and never move until the page is
 * loaded again, hidden or not; so while a watch is on, the page is fetched
 * once a minute, as a reload would, and read the same way.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Selectors = ns.Selectors || req('../shared/selectors.js');
    const CiWatch = ns.CiWatch || req('../shared/ci-watch.js');

    const SELECTORS = Object.freeze({
        /** A run's own state: the icon before its title. */
        runIcon: ['.action-info-summary-title svg', '.action-view-header svg'],
        runJob: ['.job-brief-list .job-brief-item', '.job-brief-item'],
        jobIcon: ['.job-brief-item-left svg', 'svg'],
        jobName: ['.job-brief-name', '.job-brief-item-left'],
        runTitle: ['.action-info-summary-title-text', '.action-view-header h2'],
        runSlot: ['.action-info-summary-actions', '.action-info-summary'],
        /**
         * A pull request's commit statuses, one row each, an icon and the
         * check's name. The merge box's first: the page as fetched carries
         * the same list again, in the popup of the commit it belongs to.
         */
        checkRow: ['.merge .commit-status-panel .commit-status-item', '.commit-status-panel .commit-status-item', '.commit-status-list .commit-status-item'],
        checkIcon: ['svg.commit-status', 'svg'],
        checkName: ['.status-context'],
        pullTitle: ['#issue-title-display h1', '.issue-title-header h1', '#issue-title'],
        pullSlot: ['#issue-title-display .button-row', '.issue-title-header .button-row', '.commit-status-panel .commit-status-header'],
    });

    const { find, findAll } = Selectors.table(SELECTORS);

    const text = (element) => (element ? element.textContent.replace(/\s+/g, ' ').trim() : '');

    /** An icon's classes, then the tooltip around it, for CiWatch.stateOf to read. */
    function stateOfIcon(svg) {
        if (!svg) return null;
        const holder = svg.closest('[data-tooltip-content]');
        return CiWatch.stateOf(svg.getAttribute('class')) || (holder ? CiWatch.stateOf(holder.getAttribute('data-tooltip-content')) : null);
    }

    /** A check's name is the text before its description: "testing / coverage (pull_request)", not "… Blocked by required conditions". */
    function checkName(row) {
        const context = find('checkName', row);
        if (!context) return '';
        const own = [...context.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(' ');
        return own.replace(/\s+/g, ' ').trim() || text(context);
    }

    function readRun(doc) {
        const state = stateOfIcon(find('runIcon', doc));
        const jobs = findAll('runJob', doc).map((item) => ({ name: text(find('jobName', item)), state: stateOfIcon(find('jobIcon', item)) }));
        return state || jobs.length ? { state, jobs } : null;
    }

    function readChecks(doc) {
        const jobs = findAll('checkRow', doc).map((row) => ({ name: checkName(row), state: stateOfIcon(find('checkIcon', row)) }));
        return jobs.length ? { state: null, jobs } : null;
    }

    function read(doc, page) {
        if (!page) return null;
        return page.kind === 'run' ? readRun(doc) : readChecks(doc);
    }

    /** A pull request's page, fetched as a reload would and read as drawn. A run keeps itself current. */
    async function fetchChecks(page, { fetchImpl = root.fetch, parse = (html) => new DOMParser().parseFromString(html, 'text/html') } = {}) {
        if (!page || page.kind !== 'pull') return null;
        try {
            const response = await fetchImpl(`/${page.repo}/pulls/${page.number}`, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
            if (!response.ok) return null;
            return readChecks(parse(await response.text()));
        } catch (_) {
            return null;
        }
    }

    function label(doc, page) {
        const title = text(find(page && page.kind === 'run' ? 'runTitle' : 'pullTitle', doc));
        return title || String(doc.title || '').split(' - ')[0].trim();
    }

    function slot(doc, page) {
        if (!page) return null;
        return find(page.kind === 'run' ? 'runSlot' : 'pullSlot', doc);
    }

    const adapter = {
        site: 'forgejo',
        ci: {
            read,
            fetch: fetchChecks,
            label,
            slot,
            /** Fomantic's button, which Forgejo and Gitea pages both style. */
            buttonClass: 'ui small basic button',
        },
    };

    const ForgejoRead = { SELECTORS, adapter, readRun, readChecks, fetchChecks, checkName };

    root.BB = root.BB || {};
    root.BB.ForgejoRead = ForgejoRead;
    if (typeof module !== 'undefined' && module.exports) module.exports = ForgejoRead;
})(typeof globalThis !== 'undefined' ? globalThis : this);
