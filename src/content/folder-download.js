/**
 * A folder on a forge, saved as a .zip: a Download folder button beside the
 * folder's own, and the zipping, done here in the tab. The forge is the
 * adapter's business (src/content/github-read.js answers `folder`); nothing
 * here names one.
 *
 * Built locally from each file's raw copy, with src/shared/zip.js, rather
 * than through one of the third-party sites that zip a GitHub folder for
 * you: those see every private repo they are pointed at.
 */
(function (root) {
    'use strict';

    const { ForgeSites, FetchPool, Zip, Dom } = root.BB;

    const BUTTON_ID = 'bb-folder-download';
    /** Files fetched at once: enough to hide each one's latency, few enough not to look like a scraper. */
    const PARALLEL = 6;
    /**
     * Past this the folder is a checkout's job, not a zip's: the archive is
     * built in memory, and stored without compression, so it is as big as
     * the files are.
     */
    const MAX_FILES = 2000;

    /** "src/shared/zip.js" under "src/shared" as "shared/zip.js": the zip opens to the folder itself. */
    function entryName(folderPath, path) {
        const folder = String(folderPath).split('/').pop();
        return `${folder}/${String(path).slice(String(folderPath).length + 1)}`;
    }

    function createFolderDownload({ adapter, watcher, notify, getSettings, fetchImpl = root.fetch, save = Dom.download, win = root, doc = root.document }) {
        const site = adapter.site;
        let busy = false;

        const enabled = () => getSettings()[ForgeSites.siteKey(site, 'folderDownload')] === true;
        const folder = () => adapter.folder.at(win.location.pathname);

        function render(said) {
            const button = doc.getElementById(BUTTON_ID);
            if (!button) return;
            button.textContent = said || 'Download folder';
            button.disabled = busy;
            button.title = busy ? 'Zipping this folder' : 'Save this folder, and everything in it, as a .zip';
        }

        async function download() {
            const here = folder();
            if (busy || !here) return;
            busy = true;
            render('Listing…');
            try {
                const at = await adapter.folder.read(here, { fetchImpl });
                if (!at || !at.path) throw new Error('Could not read this folder — reload the page and try again');
                const paths = await adapter.folder.list(here, at, { fetchImpl });
                if (!paths.length) throw new Error('There are no files in this folder');
                if (paths.length > MAX_FILES) throw new Error(`${paths.length} files is more than a zip built in the browser should hold — clone it instead`);

                let done = 0;
                const files = await FetchPool.mapLimit(paths, PARALLEL, async (path) => {
                    const data = new Uint8Array(await FetchPool.fetchBody(adapter.folder.rawUrl(here, at, path), {
                        fetchImpl, init: { credentials: 'same-origin' }, as: 'arrayBuffer', refused: (status) => `Could not fetch ${path} (${status})`,
                    }));
                    render(`Zipping ${++done}/${paths.length}`);
                    return { name: entryName(at.path, path), data };
                });
                const name = `${at.path.split('/').pop()}.zip`;
                save(name, Zip.build(files), 'application/zip');
                notify(`Saved ${name} — ${files.length} file${files.length === 1 ? '' : 's'}`, 'success');
            } catch (error) {
                notify(error && error.message ? error.message : 'Could not download this folder', 'error', 6000);
            } finally {
                busy = false;
                render();
            }
        }

        /** Put in and kept in on the page's own redraws, as the Watch button is. */
        function place() {
            const placed = doc.getElementById(BUTTON_ID);
            const slot = enabled() && folder() ? adapter.folder.slot(doc) : null;
            if (!slot) {
                if (placed && !(enabled() && folder())) placed.remove();
                return false;
            }
            if (placed) {
                if (placed.parentElement !== slot) slot.prepend(placed);
                return false;
            }
            const button = doc.createElement('button');
            button.type = 'button';
            button.id = BUTTON_ID;
            button.className = `${adapter.folder.buttonClass || ''} bb-folder-download`.trim();
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                download();
            });
            slot.prepend(button);
            render();
            return false;
        }

        function onNavigate() {
            watcher.add('folder-download-button', place);
        }

        return { install: onNavigate, onNavigate, refreshSurfaces: onNavigate, download };
    }

    const FolderDownload = { BUTTON_ID, MAX_FILES, entryName, createFolderDownload };

    root.BB.FolderDownload = FolderDownload;
    if (typeof module !== 'undefined' && module.exports) module.exports = FolderDownload;
})(typeof globalThis !== 'undefined' ? globalThis : this);
