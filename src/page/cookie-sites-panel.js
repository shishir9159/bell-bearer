/**
 * Settings → General: the sites whose cookie banner is answered for you.
 *
 * A dropdown rather than a list laid out on the page, because the list only
 * grows and is rarely read: closed it is one line saying how many sites there
 * are; open, each site shows its answer and has a remove button.
 */
(function (root) {
    'use strict';

    const ns = root.BB || {};
    const { CookieSites, Settings, Dom, Ui } = ns;

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
            </div>`;

        const dropdown = container.querySelector('.bb-dropdown');
        const trigger = dropdown.querySelector('.bb-dropdown-trigger');
        const menu = dropdown.querySelector('.bb-dropdown-menu');
        const count = dropdown.querySelector('.bb-dropdown-count');

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

        const reload = () => CookieSites.load().then((loaded) => { sites = loaded; render(); });
        reload();
        Settings.watch([CookieSites.KEY], reload);
    }

    root.BB = root.BB || {};
    root.BB.CookieSitesPanel = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
