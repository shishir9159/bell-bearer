/**
 * The content scripts of every site Bell Bearer has code of its own for,
 * registered by the worker instead of listed in the manifest.
 *
 * The manifest keeps one entry, the generic one every other page gets: the
 * core list, then main.js, stepping aside (exclude_matches) for each site
 * below. A site's entry is that same core list, its own files, then main.js
 * — and since a manifest entry cannot be switched off, a site's lives here,
 * where the worker can leave it out.
 *
 * Registered scripts persist across browser restarts in Chrome and Firefox
 * both, so this only has to run when the extension is installed or updated,
 * or on a browser start in case a registration was lost.
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
            css: ['content-youtube.css'],
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
                'src/content/reader-transcript.js',
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
    ]);

    /**
     * What has to run in the page's own world, by the site it is for: the
     * chess.com board and LeetCode's and claude.ai's fetch exist only there.
     * claude.ai's goes in before the page can take its fetch.
     */
    const PAGE = Object.freeze([
        { id: 'chess-page', site: 'chess', matches: ['*://*.chess.com/*'], js: ['src/content/chess-page.js'] },
        { id: 'leet-page', site: 'leetcode', matches: ['*://*.leetcode.com/*'], js: ['src/content/leet-page.js'] },
        { id: 'claude-page', site: 'claude', matches: ['*://claude.ai/*'], js: ['src/content/claude-page.js'], runAt: 'document_start' },
    ]);

    /** The manifest's entry for every other page: its scripts are the core list, then main.js. */
    const genericOf = (manifest) => manifest.content_scripts.find((entry) => entry.matches.includes('<all_urls>'));

    /**
     * Everything to register, in scripting.registerContentScripts' shape,
     * built on `generic`, the manifest's own entry.
     */
    function scripts(generic) {
        const core = generic.js.filter((file) => file !== MAIN);
        const out = ENTRIES.map((entry) => ({
            id: PREFIX + entry.id,
            matches: Object.values(entry.sites).flat(),
            js: [...core, ...entry.js, MAIN],
            css: [...(generic.css || []), ...(entry.css || [])],
        }));
        for (const page of PAGE) {
            const script = { id: PREFIX + page.id, matches: page.matches, js: page.js, world: 'MAIN' };
            if (page.runAt) script.runAt = page.runAt;
            out.push(script);
        }
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
        const { Router } = root.BB || {};
        if (!Router || !api || !api.scripting || !api.scripting.getRegisteredContentScripts) return;
        // One at a time: two overlapping runs would both see a script
        // missing, and the second registration of it would fail.
        let queue = Promise.resolve();
        const sync = () => {
            queue = queue
                .then(() => apply(api.scripting, scripts(genericOf(api.runtime.getManifest()))))
                .then((refused) => refused.forEach(({ id, error }) => console.error(`Bell Bearer: ${id} could not be registered`, error)))
                .catch((error) => console.error('Bell Bearer: the site scripts were not registered', error));
            return queue;
        };
        Router.started(sync);
    }

    install(root.chrome);

    const SiteScripts = { ENTRIES, PAGE, MAIN, genericOf, scripts, apply };

    root.BB = root.BB || {};
    root.BB.SiteScripts = SiteScripts;
    if (typeof module !== 'undefined' && module.exports) module.exports = SiteScripts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
