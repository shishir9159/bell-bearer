/**
 * The dashboard header's Export / Import — the one place a whole setup is
 * saved to a file and restored from one.
 *
 * They carry every setting and all saved data (src/shared/backup.js), so a
 * setup moves between browsers in one file. They used to be repeated beside
 * the remembered cookie sites and above the saved videos.
 */
(function (root) {
    'use strict';

    const ns = root.BB || {};
    const { Ui, Backup } = ns;

    function mount({ exportButton, importButton }) {
        if (!exportButton || !importButton) return;

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.hidden = true;
        document.body.appendChild(fileInput);

        exportButton.addEventListener('click', async () => {
            const file = await Backup.exportAll();
            const stamp = new Date().toISOString().split('T')[0];
            Ui.downloadJson(`bell-bearer-backup-${stamp}.json`, file);
            Ui.toast('Exported all settings and data', 'info');
        });

        importButton.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            fileInput.value = '';
            if (!file) return;

            let backup;
            try {
                backup = JSON.parse(await Ui.readFileAsText(file));
            } catch (_) {
                Ui.toast('Could not read that file — check it is valid JSON', 'error');
                return;
            }
            const problem = Backup.problem(backup);
            if (problem) {
                Ui.toast(problem, 'error');
                return;
            }

            const confirmed = await Ui.confirmDialog({
                title: 'Import this export?',
                message: `Settings, shortcuts, checkpoints, topics and remembered cookie sites are replaced by the ones in the file (exported ${new Date(backup.exportedAt).toLocaleString()}).`,
                confirmLabel: 'Import',
            });
            if (!confirmed) return;

            await Backup.importAll(backup);
            Ui.toast('Imported — settings and data restored', 'info');
        });
    }

    root.BB = root.BB || {};
    root.BB.BackupButtons = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
