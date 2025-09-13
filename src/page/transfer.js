/**
 * Import and export, shared by the popup and the dashboard.
 *
 * Both pages had a full copy of this — the file dialog, the paste-links dialog,
 * the validation, the merge, the result message — and the copies had drifted:
 * the dashboard reported results through blocking alert()s and skipped the
 * "no new checkpoints" case.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Bookmarks = ns.Bookmarks || req('../shared/bookmarks.js');
    const Ui = ns.Ui || req('./ui.js');

    /**
     * @param {object} options
     * @param {() => object[]} options.getVideos current list
     * @param {(videos: object[]) => Promise<void>} options.setVideos persist + re-render
     * @param {(message: string, type: string) => void} options.notify
     * @param {string} options.fileInputId hidden <input type="file">
     */
    function createTransfer({ getVideos, setVideos, notify, fileInputId }) {

        function exportBookmarks() {
            const videos = getVideos();
            if (videos.length === 0) {
                notify('No checkpoints to export', 'warning');
                return;
            }
            const data = Bookmarks.buildExport(videos);
            const stamp = new Date().toISOString().split('T')[0];
            Ui.downloadJson(`bell-bearer-checkpoints-${stamp}.json`, data);
            notify(`Exported ${data.totalBookmarks} checkpoints from ${data.totalVideos} videos`, 'info');
        }

        function showImportOptions() {
            const modal = Ui.openModal(`
                <h3>Choose import method</h3>
                <div class="import-options">
                    <button class="import-option-btn" data-import="file">Import from JSON file</button>
                    <button class="import-option-btn" data-import="links">Import from YouTube timestamp links</button>
                </div>
                <button class="import-modal-close">Cancel</button>`);

            modal.element.querySelectorAll('.import-option-btn').forEach((button) => {
                button.addEventListener('click', () => {
                    modal.close();
                    if (button.dataset.import === 'file') openFilePicker();
                    else showTimestampLinkDialog();
                });
            });
        }

        function openFilePicker() {
            const input = document.getElementById(fileInputId);
            if (input) input.click();
        }

        function showTimestampLinkDialog() {
            const modal = Ui.openModal(`
                <h3>Import from YouTube timestamp links</h3>
                <p class="modal-message">
                    Paste YouTube URLs with timestamps, one per line.<br>
                    Example: https://www.youtube.com/watch?v=VIDEO_ID&amp;t=120s
                </p>
                <textarea id="bb-timestamp-links" class="modal-textarea" rows="8"
                          placeholder="https://www.youtube.com/watch?v=VIDEO_ID&amp;t=120s"></textarea>
                <div class="import-modal-buttons">
                    <button id="bb-import-links" class="btn-primary">Import</button>
                    <button class="import-modal-close">Cancel</button>
                </div>`);

            const textarea = modal.element.querySelector('#bb-timestamp-links');
            modal.element.querySelector('#bb-import-links').addEventListener('click', async () => {
                const text = textarea.value;
                modal.close();
                await importTimestampLinks(text);
            });
            textarea.focus();
        }

        async function importTimestampLinks(text) {
            const imported = Bookmarks.parseTimestampLinks(text);
            if (imported.length === 0) {
                notify('No valid YouTube timestamp links found', 'error');
                return;
            }
            await merge(imported);
        }

        /** Wired to the hidden file input's change event. */
        async function handleFile(file) {
            const input = document.getElementById(fileInputId);
            if (!file) return;

            try {
                const data = JSON.parse(await Ui.readFileAsText(file));
                if (!Bookmarks.validateImport(data)) {
                    notify('That is not a Bell Bearer export file', 'error');
                    return;
                }
                await merge(data.videos);
            } catch (error) {
                console.error('Bell Bearer: import failed', error);
                notify('Could not read that file — check it is valid JSON', 'error');
            } finally {
                // Reset so re-picking the same file fires `change` again.
                if (input) input.value = '';
            }
        }

        async function merge(importedVideos) {
            const result = Bookmarks.mergeImported(getVideos(), importedVideos);
            if (result.addedBookmarks > 0 || result.addedVideos > 0) {
                await setVideos(result.videos);
            }
            notify(result.message, result.type);
        }

        /** Attach the file input listener; returns a teardown function. */
        function install() {
            const input = document.getElementById(fileInputId);
            if (!input) return () => {};
            const onChange = (event) => handleFile(event.target.files[0]);
            input.addEventListener('change', onChange);
            return () => input.removeEventListener('change', onChange);
        }

        return { install, exportBookmarks, showImportOptions, handleFile, importTimestampLinks };
    }

    const Transfer = { createTransfer };

    root.BB = root.BB || {};
    root.BB.Transfer = Transfer;
    if (typeof module !== 'undefined' && module.exports) module.exports = Transfer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
