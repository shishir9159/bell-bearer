/**
 * Bringing the text reader to a tab, the moment it is asked for.
 *
 * The reader is not in the core list every page loads — node-check keeps
 * reader code out of it — and on nearly every page nobody opens it. So it is
 * injected when it is: the key, the popup's Reading mode or the right-click
 * menu asks the worker, which brings the reader's files into the tab's
 * isolated world and then tells the tab to open it, as PartyLoader brings a
 * party in. A page that has it already (Wikipedia, whose entry lists it, or
 * one where it was opened before) is only told.
 *
 * A tab whose content scripts died with an extension reload has no core
 * either, and the reader stands on it; so a tab found without the core is
 * given the whole of it first, main.js included, and comes back to life as
 * a page of no site of ours.
 */
(function (root) {
    'use strict';

    /** What every text reader is made of, after the core list. */
    const BASE_FILES = Object.freeze([
        'src/shared/text-anchor.js',
        'src/content/article-clean.js',
        'src/content/article-highlights.js',
        'src/content/article-reader.js',
    ]);

    /** And what reads the page, by where it is: X's thread, and the extractor for anywhere no adapter knows. */
    const SITE_FILES = Object.freeze({
        twitter: Object.freeze(['src/content/bridge.js', 'src/shared/x-thread.js', 'src/content/x-thread-read.js']),
        other: Object.freeze(['src/content/article-extract.js']),
    });

    /** Pages the reader never opens on: YouTube has its own, beside the video. */
    function siteOf(url) {
        let at;
        try { at = new URL(url); } catch (_) { return null; }
        if (!/^https?:$/.test(at.protocol)) return null;
        if (/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(at.hostname)) return 'youtube';
        if (/(^|\.)(x|twitter)\.com$/.test(at.hostname)) return 'twitter';
        return 'other';
    }

    function createLoader(api) {
        /** What the tab has already: the core, and the reader. */
        async function probe(tabId) {
            const [answer] = await api.scripting.executeScript({
                target: { tabId },
                func: () => ({
                    core: !!(globalThis.BB && globalThis.BB.Settings && globalThis.__bellBearerInstalled),
                    reader: !!(globalThis.BB && globalThis.BB.ArticleReader),
                }),
            });
            return (answer && answer.result) || { core: false, reader: false };
        }

        function tell(tabId, message) {
            return new Promise((done) => {
                try {
                    api.tabs.sendMessage(tabId, message, (answer) => {
                        void api.runtime.lastError;
                        done(answer || null);
                    });
                } catch (_) {
                    done(null);
                }
            });
        }

        /**
         * Open the reader in `tabId` — or close it, it being a toggle — on
         * `url`. Answers `{ ok, reason }`: `reason` is why not, for the popup
         * to say ('youtube' is the video reader's, asked for instead).
         */
        async function open(tabId, url, { op = 'toggle' } = {}) {
            const site = siteOf(url);
            if (!site) return { ok: false, reason: 'unscriptable' };
            if (site === 'youtube') {
                const answer = await tell(tabId, { action: 'openReader' });
                return { ok: !!(answer && answer.ok), reason: 'youtube' };
            }
            try {
                const has = await probe(tabId);
                if (!has.core) {
                    const generic = api.runtime.getManifest().content_scripts.find((entry) => entry.matches.includes('<all_urls>'));
                    await api.scripting.executeScript({ target: { tabId }, files: [...generic.js] });
                }
                if (!has.reader) {
                    await api.scripting.executeScript({ target: { tabId }, files: [...BASE_FILES, ...(SITE_FILES[site] || SITE_FILES.other)] });
                }
            } catch (_) {
                // The Web Store, the PDF viewer, a chrome:// page: nothing of
                // an extension's may run there.
                return { ok: false, reason: 'unscriptable' };
            }
            const answer = await tell(tabId, { action: 'textReader', op });
            return { ok: !!(answer && answer.ok), reason: answer ? answer.reason || '' : 'unanswered' };
        }

        return { open, probe };
    }

    const ReaderLoader = { BASE_FILES, SITE_FILES, siteOf, createLoader };

    // Registered at top level, as a worker's listeners must be.
    const api = root.chrome;
    const Router = root.BB && root.BB.Router;
    if (api && api.scripting && api.tabs && Router) {
        const loader = createLoader(api);
        // From the page (the key, on a page without the reader yet), the popup and the menu.
        Router.on('openTextReader', (message, sender) => {
            const tab = sender && sender.tab;
            const tabId = Number.isInteger(message.tabId) ? message.tabId : tab && tab.id;
            const url = message.url || (tab && tab.url) || '';
            if (!Number.isInteger(tabId)) return { ok: false, reason: 'no-tab' };
            return loader.open(tabId, url, { op: message.op || 'toggle' });
        });
        ReaderLoader.loader = loader;
    }

    root.BB = root.BB || {};
    root.BB.ReaderLoader = ReaderLoader;
    if (typeof module !== 'undefined' && module.exports) module.exports = ReaderLoader;
})(typeof globalThis !== 'undefined' ? globalThis : this);
