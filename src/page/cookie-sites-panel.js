/**
 * Settings → General: the sites whose cookie banner is answered for you, and
 * the global Export / Import beside them.
 *
 * A dropdown rather than a list laid out on the page, because the list only
 * grows and is rarely read: closed it is one line saying how many sites there
 * are; open, each site shows its answer and has a remove button.
 *
 * Export and Import are not cookie-only: they carry every setting and all
 * saved data (src/shared/backup.js), so a whole setup moves between browsers
 * in one file.
 */
(function (root) {
    'use strict';

    const ns = root.BB || {};
    const { CookieSites, Settings, Dom, Ui, Backup } = ns;

    function mount(container) {
        if (!container) return;

        container.innerHTML = `
            <div class="bb-dropdown">
                <button type="button" class="bb-dropdown-trigger" aria-haspopup="true" aria-expanded="false">
                    <span class="bb-dropdown-label">Remembered sites</span>
                    <span class="bb-dropdown-count">0</span>
                    <span class="bb-dropdown-caret" aria-hidden="true"></span>
                </button>
                <div class="bb-dropdown-menu" role="menu" hidden></div>
            </div>
            <button type="button" class="btn-secondary" data-backup="export" title="Export every Bell Bearer setting and all saved data to one file">Export</button>
            <button type="button" class="btn-secondary" data-backup="import" title="Import settings and data from a Bell Bearer export">Import</button>
            <input type="file" accept=".json" hidden>`;

        const dropdown = container.querySelector('.bb-dropdown');
        const trigger = dropdown.querySelector('.bb-dropdown-trigger');
        const menu = dropdown.querySelector('.bb-dropdown-menu');
        const count = dropdown.querySelector('.bb-dropdown-count');
        const fileInput = container.querySelector('input[type="file"]');

        let sites = {};

        function render() {
            const rows = CookieSites.list(sites);
            count.textContent = String(rows.length);
            menu.innerHTML = rows.length
                ? rows.map((row) => `
                    <div class="bb-dropdown-item" role="menuitem">
                        <span class="bb-dropdown-host">${Dom.escapeHtml(row.host)}</span>
                        <span class="bb-decision is-${row.decision === 'decline' ? 'decline' : 'accept'}">${row.decision === 'decline' ? 'Rejected' : 'Accepted'}</span>
                        <button type="button" class="bb-dropdown-remove" data-host="${Dom.escapeAttr(row.host)}"
                                title="Forget ${Dom.escapeAttr(row.host)}" aria-label="Forget ${Dom.escapeAttr(row.host)}">&times;</button>
                    </div>`).join('')
                : '<div class="bb-dropdown-empty">No sites yet. Click "Always accept" or "Always reject" on a cookie popup to add one.</div>';
        }

        function setOpen(open) {
            menu.hidden = !open;
            trigger.setAttribute('aria-expanded', String(open));
            dropdown.classList.toggle('is-open', open);
        }

        trigger.addEventListener('click', () => setOpen(menu.hidden));
        document.addEventListener('click', (event) => {
            if (!dropdown.contains(event.target)) setOpen(false);
        });
        dropdown.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !menu.hidden) {
                event.stopPropagation();
                setOpen(false);
                trigger.focus();
            }
        });

        menu.addEventListener('click', async (event) => {
            const remove = event.target.closest('.bb-dropdown-remove');
            if (!remove) return;
            sites = await CookieSites.forget(remove.dataset.host);
            render();
            Ui.toast(`${remove.dataset.host} will ask about cookies again`, 'info');
        });

        container.addEventListener('click', async (event) => {
            const action = event.target.closest('[data-backup]');
            if (!action) return;
            if (action.dataset.backup === 'import') {
                fileInput.click();
                return;
            }
            const file = await Backup.exportAll();
            const stamp = new Date().toISOString().split('T')[0];
            Ui.downloadJson(`bell-bearer-backup-${stamp}.json`, file);
            Ui.toast('Exported all settings and data', 'info');
        });

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
            if (!Backup.validate(backup)) {
                Ui.toast('That is not a Bell Bearer export', 'error');
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

        const reload = () => CookieSites.load().then((loaded) => { sites = loaded; render(); });
        reload();
        Settings.watch([CookieSites.KEY], reload);
    }

    root.BB = root.BB || {};
    root.BB.CookieSitesPanel = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
