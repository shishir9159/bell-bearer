/**
 * Saving a file a tab has built — a video, from src/content/video-download.js
 * — through the browser's downloads: the only way an extension can put a
 * file in a folder inside Downloads, or open Save As for it.
 *
 * The file stays the tab's. Its blob: address belongs to the page, and the
 * browser reads it from there (a blob made in a content script saves this
 * way — tried in Chrome 154), so the tab must keep the address until the
 * save has ended. With Save As that is whenever a place is picked, and the
 * worker may be stopped and started again in between: each save in flight
 * is kept in storage.session, and the tab is told `downloadSaved` when it
 * ends. Listeners are registered at top level, synchronously, for the same
 * reason.
 */
(function (root) {
    'use strict';

    const { Router } = root.BB;

    const KEY = 'bbSaving';
    const OVER = ['complete', 'interrupted'];

    function createWorker(api) {
        const area = () => api.storage.session || api.storage.local;

        async function all() {
            try { return (await area().get(KEY))[KEY] || {}; } catch (_) { return {}; }
        }

        /** Read, change and write as one step: a save's end can land while it is still being kept. */
        let chain = Promise.resolve();
        function change(step) {
            const run = async () => {
                const saving = await all();
                const answer = step(saving);
                try { await area().set({ [KEY]: saving }); } catch (_) { /* kept as long as this worker */ }
                return answer;
            };
            chain = chain.then(run, run);
            return chain;
        }

        /** Tell the tab its save of `id` is over, once, whichever of the two paths below sees it first. */
        async function finish(id, item) {
            const save = await change((saving) => {
                const found = saving[id];
                delete saving[id];
                return found;
            });
            if (!save) return;
            try {
                await api.tabs.sendMessage(save.tabId, { action: 'downloadSaved', url: save.url, state: item.state, error: item.error || '' });
            } catch (_) { /* the tab is gone, and its blob with it */ }
        }

        async function save(message, sender) {
            const tabId = sender && sender.tab && sender.tab.id;
            if (!Number.isInteger(tabId) || !/^blob:/.test(String(message.url))) return { ok: false, error: 'Nothing to save' };
            const id = await api.downloads.download({
                url: message.url,
                filename: message.filename,
                // Left out rather than false when not asked for, so the
                // browser's own "ask where to save each file" still counts.
                ...(message.ask ? { saveAs: true } : {}),
            });
            if (!Number.isInteger(id)) return { ok: false, error: 'The browser did not start the download' };
            await change((saving) => { saving[id] = { tabId, url: message.url }; });
            // A small file can be done before it was kept, and its change
            // heard by nobody; so ask once now as well.
            const [item] = await api.downloads.search({ id });
            if (item && OVER.includes(item.state)) await finish(id, item);
            return { ok: true, id };
        }

        function changed(delta) {
            if (!delta || !delta.state || !OVER.includes(delta.state.current)) return;
            api.downloads.search({ id: delta.id }).then(([item]) => finish(delta.id, item || { state: delta.state.current }), () => {});
        }

        return { all, save, changed };
    }

    const api = root.chrome;
    let worker = null;
    if (api && api.downloads && api.tabs && api.storage) {
        worker = createWorker(api);
        Router.on('saveDownload', worker.save);
        api.downloads.onChanged.addListener(worker.changed);
    }

    const DownloadsWorker = { KEY, createWorker, worker };

    root.BB.DownloadsWorker = DownloadsWorker;
    if (typeof module !== 'undefined' && module.exports) module.exports = DownloadsWorker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
