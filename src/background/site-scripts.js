/**
 * The content scripts of every site Bell Bearer has code of its own for,
 * registered by the worker instead of listed in the manifest.
 *
 * The manifest keeps one entry, the generic one every other page gets: the
 * core list, then main.js, stepping aside (exclude_matches) for each site
 * below. A site's entry is that same core list, its own files, then main.js
 * — and since a manifest entry cannot be switched off, a site's lives here,
 * where the worker can leave it out: a site in the `sitesOff` setting loads
 * none of its own files, not even to find out that it should do nothing.
 *
 * Registered scripts persist across browser restarts in Chrome and Firefox
 * both, so this only has to run when the extension is installed or updated,
 * when a site is switched, or on a browser start in case one was lost.
 */
(function (root) {
    'use strict';

    const MAIN = 'src/content/main.js';
    const PREFIX = 'bb-';

    /**
     * Each site's own files, in load order, and the match patterns of each
     * site the entry serves. A file that more than one site needs is listed
     * in each of their entries: an entry is all one page loads.
     */
    const ENTRIES = Object.freeze([
        {
            id: 'youtube',
            sites: { youtube: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://youtu.be/*'] },
            css: ['content-reader.css'],
            js: [
                'src/shared/transcript.js',
                'src/shared/bookmarks.js',
                'src/shared/pins.js',
                'src/shared/watched.js',
                'src/shared/subscriptions.js',
                'src/shared/feed.js',
                'src/shared/yt-subs.js',
                'src/shared/playlists.js',
                'src/shared/pouch-button.js',
                'src/shared/fetch-pool.js',
                'src/shared/mp4-mux.js',
                'src/content/transcripts.js',
                'src/content/checkpoints.js',
                'src/content/pouch-sheet.js',
                'src/content/youtube-ui.js',
                'src/shared/corners.js',
                'src/content/reader-transcript.js',
                'src/content/reader-layout.js',
                'src/content/reader-highlights.js',
                'src/content/reader.js',
                'src/content/file-saver.js',
                'src/content/video-download.js',
                'src/content/youtube-download.js',
            ],
        },
        {
            id: 'twitter',
            sites: { twitter: ['*://*.x.com/*', '*://*.twitter.com/*'] },
            css: ['content-x.css'],
            js: [
                'src/shared/selectors.js',
                'src/shared/roster.js',
                'src/shared/x-pouch.js',
                'src/shared/pouch-button.js',
                'src/content/roster-bar.js',
                'src/content/roster.js',
                'src/content/twitter-page.js',
                'src/content/twitter-panel.js',
                'src/content/twitter-ui.js',
                'src/content/twitter-ads.js',
            ],
        },
        {
            id: 'reddit',
            sites: { reddit: ['*://*.reddit.com/*'] },
            js: [
                'src/shared/selectors.js',
                'src/shared/roster.js',
                'src/content/roster-bar.js',
                'src/content/roster.js',
            ],
        },
        {
            id: 'chess',
            sites: { chess: ['*://*.chess.com/*'], lichess: ['*://*.lichess.org/*'] },
            js: [
                'src/shared/sfx.js',
                'src/shared/chess-sites.js',
                'src/shared/chess-limits.js',
                'src/content/bridge.js',
                'src/content/chess.js',
                'src/content/chess-limits.js',
            ],
        },
        {
            id: 'leetcode',
            sites: { leetcode: ['*://*.leetcode.com/*'] },
            css: ['content-leetcode.css'],
            js: [
                'src/shared/selectors.js',
                'src/shared/fsrs.js',
                'src/shared/leetcode.js',
                'src/shared/leet-templates.js',
                'src/shared/pouch-button.js',
                'src/content/leet-read.js',
                'src/content/leet-panel.js',
                'src/content/bridge.js',
                'src/content/leet-ui.js',
            ],
        },
        {
            id: 'typeracer',
            sites: { typeracer: ['*://*.typeracer.com/*'] },
            css: ['content-typeracer.css'],
            js: [
                'src/shared/selectors.js',
                'src/shared/sfx.js',
                'src/shared/typeracer.js',
                'src/content/typeracer-read.js',
                'src/content/typeracer-ui.js',
            ],
        },
        {
            id: 'chat',
            sites: { chatgpt: ['*://*.chatgpt.com/*', '*://*.chat.openai.com/*'], claude: ['*://*.claude.ai/*'] },
            css: ['content-chat.css'],
            js: [
                'src/shared/selectors.js',
                'src/shared/chat-sites.js',
                'src/shared/chat-tree.js',
                'src/shared/chatgpt-format.js',
                'src/shared/claude-format.js',
                'src/shared/chat-diff.js',
                'src/shared/chat-export.js',
                'src/shared/zip.js',
                'src/shared/chat-pins.js',
                'src/shared/prompt-templates.js',
                'src/content/composer.js',
                'src/shared/prompt-queue.js',
                'src/content/chat-dom.js',
                'src/content/bridge.js',
                'src/content/chatgpt-read.js',
                'src/content/claude-read.js',
                'src/content/chat-nav.js',
                'src/content/chat-tree-view.js',
                'src/content/chat-compare.js',
                'src/content/chat-panel.js',
                'src/content/chat-library.js',
                'src/content/chat-picker.js',
                'src/content/chat-runner.js',
                'src/content/chat-queue-view.js',
                'src/content/chat-ui.js',
            ],
        },
        {
            id: 'forge',
            sites: { github: ['*://github.com/*'], gitlab: ['*://gitlab.com/*'], forgejo: ['*://codeberg.org/*'] },
            css: ['content-forge.css'],
            js: [
                'src/shared/selectors.js',
                'src/shared/zip.js',
                'src/shared/fetch-pool.js',
                'src/shared/forge-sites.js',
                'src/shared/ci-watch.js',
                'src/content/github-read.js',
                'src/content/gitlab-read.js',
                'src/content/forgejo-read.js',
                'src/content/ci-watch.js',
                'src/content/folder-download.js',
                'src/content/topic-search.js',
            ],
        },
        {
            id: 'vimeo',
            sites: { vimeo: ['*://vimeo.com/*', '*://www.vimeo.com/*'] },
            js: [
                'src/shared/fetch-pool.js',
                'src/shared/mp4-mux.js',
                'src/content/file-saver.js',
                'src/content/video-download.js',
                'src/content/vimeo-download.js',
            ],
        },
        {
            id: 'netflix',
            sites: { netflix: ['*://*.netflix.com/*'] },
            css: ['content-netflix.css'],
            js: [
                'src/shared/subtitles.js',
                'src/content/bridge.js',
                'src/content/netflix-ui.js',
                'src/content/netflix-subs-view.js',
                'src/content/netflix-subs.js',
            ],
        },
        {
            // The text reader is this site's own: in its entry, rather than
            // brought in when asked for as on every other page, so an
            // article opens in the reader at once.
            id: 'wikipedia',
            sites: { wikipedia: ['*://*.wikipedia.org/*'] },
            js: [
                'src/shared/selectors.js',
                'src/shared/text-anchor.js',
                'src/content/article-clean.js',
                'src/content/article-highlights.js',
                'src/content/article-reader.js',
                'src/content/wiki-read.js',
            ],
        },
    ]);

    /**
     * What has to run in the page's own world, by the site it is for: the
     * chess.com board, LeetCode's and claude.ai's fetch, and Netflix's player
     * exist only there. claude.ai's goes in before the page can take its
     * fetch, and Netflix's subtitle reader before the player's first manifest.
     */
    const PAGE = Object.freeze([
        { id: 'chess-page', site: 'chess', matches: ['*://*.chess.com/*'], js: ['src/content/chess-page.js'] },
        { id: 'leet-page', site: 'leetcode', matches: ['*://*.leetcode.com/*'], js: ['src/content/leet-page.js'] },
        { id: 'claude-page', site: 'claude', matches: ['*://claude.ai/*'], js: ['src/content/claude-page.js'], runAt: 'document_start' },
        { id: 'netflix-page', site: 'netflix', matches: ['*://*.netflix.com/*'], js: ['src/content/netflix-page.js'] },
        { id: 'netflix-subs-page', site: 'netflix', matches: ['*://*.netflix.com/*'], js: ['src/content/netflix-subs-page.js'], runAt: 'document_start' },
    ]);

    /** The manifest's entry for every other page: its scripts are the core list, then main.js. */
    const genericOf = (manifest) => manifest.content_scripts.find((entry) => entry.matches.includes('<all_urls>'));

    /**
     * Everything to register, in scripting.registerContentScripts' shape,
     * built on `generic`, the manifest's own entry, for every site but those
     * in `off`. An entry serving two sites keeps the one still on.
     */
    function scripts(generic, off = []) {
        const on = (site) => !off.includes(site);
        const core = generic.js.filter((file) => file !== MAIN);
        const out = [];
        const plain = [];
        for (const entry of ENTRIES) {
            const sites = Object.entries(entry.sites);
            sites.filter(([site]) => !on(site)).forEach(([, matches]) => plain.push(...matches));
            const matches = sites.filter(([site]) => on(site)).flatMap(([, patterns]) => patterns);
            if (!matches.length) continue;
            out.push({
                id: PREFIX + entry.id,
                matches,
                js: [...core, ...entry.js, MAIN],
                css: [...(generic.css || []), ...(entry.css || [])],
            });
        }
        for (const page of PAGE.filter((one) => on(one.site))) {
            const script = { id: PREFIX + page.id, matches: page.matches, js: page.js, world: 'MAIN' };
            if (page.runAt) script.runAt = page.runAt;
            out.push(script);
        }
        // A site switched off is any other page, and gets what every other
        // page does. The generic entry steps aside for its hosts in the
        // manifest, where that cannot be undone, so it is registered here.
        if (plain.length) out.push({ id: `${PREFIX}plain`, matches: plain, js: [...generic.js], css: [...(generic.css || [])] });
        return out;
    }

    /**
     * What a registration does, with the API's defaults filled in, to tell
     * whether one has changed. Patterns are a set: Chrome hands them back
     * sorted, and compared in order every script looked changed on every
     * start. Files are not: they load in the order given.
     */
    const shape = (one) => JSON.stringify([[...one.matches].sort(), [...(one.excludeMatches || [])].sort(),
        one.js || [], one.css || [], one.world || 'ISOLATED', one.runAt || 'document_idle']);

    /**
     * Bring what is registered in line with `want`: drop ours that are no
     * longer wanted, update what changed, add what is new. One call per
     * script, so one the browser refuses — a Firefox that predates the MAIN
     * world, say — does not take every other site down with it. Answers
     * what was refused, and why.
     */
    async function apply(scripting, want) {
        const have = new Map((await scripting.getRegisteredContentScripts())
            .filter((one) => one.id.startsWith(PREFIX))
            .map((one) => [one.id, one]));
        const gone = [...have.keys()].filter((id) => !want.some((one) => one.id === id));
        if (gone.length) await scripting.unregisterContentScripts({ ids: gone });
        const refused = [];
        for (const one of want) {
            try {
                if (!have.has(one.id)) await scripting.registerContentScripts([one]);
                else if (shape(have.get(one.id)) !== shape(one)) await scripting.updateContentScripts([one]);
            } catch (error) {
                refused.push({ id: one.id, error });
            }
        }
        return refused;
    }

    function install(api) {
        const { Router, Settings } = root.BB || {};
        if (!Router || !Settings || !api || !api.scripting || !api.scripting.getRegisteredContentScripts) return;
        const wanted = async () => {
            const { sitesOff } = await Settings.get(['sitesOff']);
            return scripts(genericOf(api.runtime.getManifest()), Array.isArray(sitesOff) ? sitesOff : []);
        };
        // One at a time: two overlapping runs would both see a script
        // missing, and the second registration of it would fail.
        let queue = Promise.resolve();
        const sync = () => {
            queue = queue
                .then(wanted)
                .then((want) => apply(api.scripting, want))
                .then((refused) => refused.forEach(({ id, error }) => console.error(`Bell Bearer: ${id} could not be registered`, error)))
                .catch((error) => console.error('Bell Bearer: the site scripts were not registered', error));
            return queue;
        };
        Router.started(sync);
        // A tab already open keeps what it loaded with; the switch reaches
        // a site's pages as they are next loaded.
        Settings.watch(['sitesOff'], sync);
    }

    install(root.chrome);

    const SiteScripts = { ENTRIES, PAGE, MAIN, genericOf, scripts, apply };

    root.BB = root.BB || {};
    root.BB.SiteScripts = SiteScripts;
    if (typeof module !== 'undefined' && module.exports) module.exports = SiteScripts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
