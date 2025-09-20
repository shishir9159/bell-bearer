/**
 * Settings → General: the sites whose cookie banner is accepted for you.
 *
 * A dropdown rather than a list laid out on the page, because the list only
 * grows and is rarely read: closed it is one line saying how many sites there
 * are; open, each site has a remove button. Export and import sit beside it
 * so the list travels between browsers the way checkpoints do.
 */
(function (root) {
    'use strict';

    const ns = root.BB || {};
    const { CookieSites, Settings, Dom, Ui } = ns;

    function mount(container) {
        if (!container) return;

        container.innerHTML = `
            <div class="bb-dropdown" id="cookieSitesDropdown">
                <button type="button" class="bb-dropdown-trigger" aria-haspopup="true" aria-expanded="false">
                    <span class="bb-dropdown-label">Remembered sites</span>
                    <span class="bb-dropdown-count">0</span>
                    <span class="bb-dropdown-caret" aria-hidden="true"></span>
                </button>
                <div class="bb-dropdown-menu" role="menu" hidden></div>
            </div>
            <button type="button" class="btn-secondary" data-cookie-action="export">Export</button>
            <button type="button" class="btn-secondary" data-cookie-action="import">Import</button>
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
                        <span class="bb-dropdown-meta">${row.savedAt ? Dom.escapeHtml(new Date(row.savedAt).toLocaleDateString()) : ''}</span>
                        <button type="button" class="bb-dropdown-remove" data-host="${Dom.escapeAttr(row.host)}"
                                title="Forget ${Dom.escapeAttr(row.host)}" aria-label="Forget ${Dom.escapeAttr(row.host)}">&times;</button>
                    </div>`).join('')
                : '<div class="bb-dropdown-empty">No sites yet. Click "Always accept here" on a cookie popup to add one.</div>';
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

        container.addEventListener('click', (event) => {
            const action = event.target.closest('[data-cookie-action]');
            if (!action) return;
            if (action.dataset.cookieAction === 'export') {
                const rows = CookieSites.list(sites);
                if (!rows.length) {
                    Ui.toast('No remembered sites to export', 'warning');
                    return;
                }
                const stamp = new Date().toISOString().split('T')[0];
                Ui.downloadJson(`bell-bearer-cookie-sites-${stamp}.json`, CookieSites.buildExport(sites));
                Ui.toast(`Exported ${rows.length} site${rows.length === 1 ? '' : 's'}`, 'info');
            } else {
                fileInput.click();
            }
        });

        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            try {
                const data = JSON.parse(await Ui.readFileAsText(file));
                if (!CookieSites.validateImport(data)) {
                    Ui.toast('That is not a Bell Bearer cookie-sites export', 'error');
                    return;
                }
                const result = CookieSites.mergeImported(await CookieSites.load(), data.sites);
                await CookieSites.save(result.sites);
                sites = result.sites;
                render();
                Ui.toast(result.added ? `Imported ${result.added} site${result.added === 1 ? '' : 's'}` : 'Every site in that file is already remembered', 'info');
            } catch (_) {
                Ui.toast('Could not read that file — check it is valid JSON', 'error');
            }
        });

        CookieSites.load().then((loaded) => { sites = loaded; render(); });
        Settings.watch([CookieSites.KEY], () => {
            CookieSites.load().then((loaded) => { sites = loaded; render(); });
        });
    }

    root.BB = root.BB || {};
    root.BB.CookieSitesPanel = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
