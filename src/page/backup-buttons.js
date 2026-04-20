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

            const made = new Date(backup.exportedAt);
            const mode = await Ui.choiceDialog({
                title: 'Import this export?',
                message: `It was exported ${Number.isNaN(made.getTime()) ? 'at an unknown time' : made.toLocaleString()}. `
                    + 'Your setup as it is now is saved to a file first, which imports it back if this was a mistake.',
                choices: [
                    { value: 'replace', label: 'Replace everything', hint: 'Settings and data become the file’s; what it does not have is cleared.' },
                    { value: 'merge', label: 'Merge into what is here', hint: 'What the file has replaces yours; everything else stays.' },
                ],
                confirmLabel: 'Import',
            });
            if (!mode) return;

            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            try {
                Ui.downloadJson(`bell-bearer-before-import-${stamp}.json`, await Backup.exportAll());
                await Backup.importAll(backup, { mode });
            } catch (error) {
                Ui.toast(`Nothing was imported — ${(error && error.message) || 'storage refused it'}`, 'error');
                return;
            }
            Ui.toast(mode === 'replace' ? 'Imported — your setup is now the file’s' : 'Imported — merged into your setup', 'info');
        });
    }

    root.BB = root.BB || {};
    root.BB.BackupButtons = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
