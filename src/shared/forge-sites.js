/**
 * The git forges Bell Bearer works with — GitHub, GitLab and Codeberg — as one
 * registry, in the shape src/shared/chat-sites.js gives the chat sites and for
 * its reason: a feature does the same thing on every forge, so a forge's name,
 * its settings keys and how its addresses read are looked up here, and the
 * three cannot drift apart feature by feature.
 *
 * Codeberg runs Forgejo, so its entry is Forgejo's, named for its host. The
 * paths it reads are Forgejo's and Gitea's alike, so another instance of
 * either is one more host here rather than one more forge.
 *
 * Nothing about a forge's markup lives here: that is its adapter,
 * src/content/github-read.js and the two beside it. This file is pure and
 * small enough that the service worker loads it too.
 */
(function (root) {
    'use strict';

    /** A path's segments, without the empty ones a leading or doubled slash leaves. */
    const segments = (pathname) => String(pathname || '').split(/[?#]/)[0].split('/').filter(Boolean);

    const isNumber = (value) => /^\d+$/.test(value || '');

    /**
     * GitHub and Forgejo keep a repo at /owner/repo and everything about it
     * after that. A run is /owner/repo/actions/runs/<n> whatever follows it —
     * a job, an attempt — because all of those are the one run.
     */
    function ownerRepoPage(pathname, pullWord) {
        const [owner, repo, area, sub, n] = segments(pathname);
        if (!owner || !repo) return null;
        const at = `${owner}/${repo}`;
        if (area === 'actions' && sub === 'runs' && isNumber(n)) return { kind: 'run', repo: at, number: n };
        if (area === pullWord && isNumber(sub)) return { kind: 'pull', repo: at, number: sub };
        return null;
    }

    /**
     * GitLab nests groups, and a project can sit four of them deep, so a
     * project is everything before the `/-/` that starts its own pages.
     * "owner/repo" is never assumed for GitLab anywhere.
     */
    function gitlabPage(pathname) {
        const all = segments(pathname);
        const dash = all.indexOf('-');
        // A project is at least a namespace and a name.
        if (dash < 2) return null;
        const [area, n] = all.slice(dash + 1);
        if (!isNumber(n)) return null;
        const repo = all.slice(0, dash).join('/');
        if (area === 'pipelines') return { kind: 'run', repo, number: n };
        if (area === 'merge_requests') return { kind: 'pull', repo, number: n };
        return null;
    }

    const SITES = Object.freeze({
        github: Object.freeze({
            id: 'github',
            name: 'GitHub',
            prefix: 'github',
            hosts: Object.freeze(['github.com']),
            tabPatterns: Object.freeze(['*://github.com/*']),
            /** What a notification calls each kind of page: an Actions run, a pull request's checks. */
            nouns: Object.freeze({ run: 'Run', pull: 'Checks' }),
            /** What the Watch button goes on, as Settings says it. */
            watches: 'Actions runs and pull requests',
            pageOf: (pathname) => ownerRepoPage(pathname, 'pull'),
        }),
        gitlab: Object.freeze({
            id: 'gitlab',
            name: 'GitLab',
            prefix: 'gitlab',
            hosts: Object.freeze(['gitlab.com']),
            tabPatterns: Object.freeze(['*://gitlab.com/*']),
            // A merge request's checks are its pipeline, and GitLab calls them that.
            nouns: Object.freeze({ run: 'Pipeline', pull: 'Pipeline' }),
            watches: 'pipelines and merge requests',
            pageOf: gitlabPage,
        }),
        forgejo: Object.freeze({
            id: 'forgejo',
            name: 'Codeberg',
            prefix: 'forgejo',
            hosts: Object.freeze(['codeberg.org']),
            tabPatterns: Object.freeze(['*://codeberg.org/*']),
            nouns: Object.freeze({ run: 'Run', pull: 'Checks' }),
            watches: 'Forgejo Actions runs and pull requests',
            pageOf: (pathname) => ownerRepoPage(pathname, 'pulls'),
        }),
    });

    function get(id) {
        return SITES[id] || null;
    }

    function list() {
        return Object.values(SITES);
    }

    /** Which forge a host is, or null; `www.` is the same host. */
    function siteOfHost(host) {
        const bare = String(host || '').toLowerCase().replace(/^www\./, '');
        return list().find((site) => site.hosts.includes(bare)) || null;
    }

    /**
     * What a URL shows — `{ site, kind, repo, number, key }` — or null for
     * any page that is not a run or a pull request. `key` names the run or
     * the pull request whatever tab of it is open, so a watch started on the
     * summary is the same watch on one of its jobs.
     */
    function pageOfUrl(url) {
        let at = null;
        try { at = new URL(String(url)); } catch (_) { return null; }
        const site = siteOfHost(at.hostname);
        const page = site && site.pageOf(at.pathname);
        if (!page) return null;
        return { site: site.id, ...page, key: `${site.id}:${page.repo}:${page.kind}:${page.number}` };
    }

    /**
     * Whole-forge setting keys, one builder each, as chat-sites.js has them:
     *   ('gitlab', 'ciWatch') → 'gitlabCiWatch'
     */
    const SITE_KEYS = Object.freeze({
        ciWatch: (p) => `${p}CiWatch`,
    });

    function siteKey(siteId, kind) {
        const site = get(siteId);
        const build = SITE_KEYS[kind];
        if (!site || !build) return null;
        return build(site.prefix);
    }

    /** Every setting key every forge owns. Asserted against DEFAULTS. */
    function allKeys() {
        return list().flatMap((site) => Object.values(SITE_KEYS).map((build) => build(site.prefix)));
    }

    const ForgeSites = { SITES, SITE_KEYS, get, list, siteOfHost, pageOfUrl, siteKey, allKeys };

    root.BB = root.BB || {};
    root.BB.ForgeSites = ForgeSites;
    if (typeof module !== 'undefined' && module.exports) module.exports = ForgeSites;
})(typeof globalThis !== 'undefined' ? globalThis : this);
