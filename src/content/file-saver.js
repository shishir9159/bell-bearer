/**
 * Saving a file the tab has built — a video, from src/content/video-download.js
 * — the way the settings ask: through the browser's downloads
 * (src/background/downloads.js), the only way to ask where it goes or to
 * name a folder, or by a link's click into Downloads when neither is asked
 * for. A link's `download` name turns "/" into "_", and it has no Save As of
 * its own.
 *
 * The file's blob: address is this tab's, and the browser reads it from
 * here, so it is kept until the worker says the save has ended (`ended`) —
 * with Save As, whenever a place has been picked.
 */
(function (root) {
    'use strict';

    const { Dom } = root.BB;

    /**
     * `name` under `folder`, as the browser's downloads take a path: relative
     * to Downloads, "/" between folders. Nothing in the setting may lead out
     * of Downloads — a "..", a drive, a leading slash — and nothing Windows
     * refuses in a name survives, since the browser turns the whole download
     * down over one bad character rather than mend it.
     */
    function savePath(folder, name) {
        const parts = String(folder || '').split(/[\\/]+/)
            .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim().replace(/[. ]+$/, ''))
            .filter((part) => part && part !== '..');
        return [...parts, name].join('/');
    }

    /** `save` resolves to true when saved, and false when Save As was turned down. */
    function createSaver({ options, send, link = Dom.download, urls = root.URL }) {
        const pending = new Map();

        async function save(name, blob, type) {
            const { ask, folder } = options();
            const path = savePath(folder, name);
            if (!ask && !path.includes('/')) {
                link(name, blob, type);
                return true;
            }
            // Typed: the browser saves an untyped blob as text, "….mp4" as
            // "….txt", as it did the merged video once. Wrapping copies nothing.
            const url = urls.createObjectURL(blob.type || !type ? blob : new Blob([blob], { type }));
            const ended = new Promise((resolve, reject) => pending.set(url, { resolve, reject }));
            let answer = null;
            try {
                answer = await send({ action: 'saveDownload', url, filename: path, ask });
            } catch (_) { /* no worker to hand it to: the extension was reloaded under this tab */ }
            if (answer && answer.ok) return ended;
            pending.delete(url);
            urls.revokeObjectURL(url);
            // Firefox turns the request itself down when Save As is closed,
            // where Chrome starts a download and interrupts it.
            if (answer && /cancel/i.test(answer.error || '')) return false;
            // A browser that cannot read this tab's blob still gets the file, into Downloads.
            link(name, blob, type);
            return true;
        }

        /** The worker's word that the save of `url` has ended, as `state` with `error`. */
        function ended({ url, state, error }) {
            const waiting = pending.get(url);
            if (!waiting) return;
            pending.delete(url);
            urls.revokeObjectURL(url);
            if (state === 'complete') waiting.resolve(true);
            else if (error === 'USER_CANCELED') waiting.resolve(false);
            else waiting.reject(new Error(`The browser could not save it (${error || state})`));
        }

        return { save, ended };
    }

    const FileSaver = { savePath, createSaver };

    root.BB = root.BB || {};
    root.BB.FileSaver = FileSaver;
    if (typeof module !== 'undefined' && module.exports) module.exports = FileSaver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
