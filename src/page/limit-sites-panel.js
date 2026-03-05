/**
 * Settings → General: the sites you are holding yourself to a limit on.
 *
 * The same dropdown as the cookie list above it, with a small form at the top
 * of the menu because this list is one you add to by hand — a cookie site gets
 * remembered by clicking a button on the banner, and there is no equivalent
 * gesture for "thirty minutes of this a day".
 *
 * Two kinds of limit, one field each, and whichever is filled in is the one
 * that is saved. That is deliberately not a radio and two panes: the fields
 * describe themselves ("minutes", "from", "to"), and a chooser above two boxes
 * would be a third control for a decision the boxes already make.
 *
 * A window is an allowance, and the hint says so in as many words. "7am to
 * 9am" could just as reasonably mean the two hours the site is *blocked*, and
 * the difference between those two readings matters rather a lot at 9:01.
 */
(function (root) {
    'use strict';

    const ns = root.BB || {};
    const { LimitSites, Settings, Dom, Ui, Icons } = ns;

    const esc = (text) => Dom.escapeHtml(text);
    const att = (text) => Dom.escapeAttr(text);

    function mount(container) {
        if (!container) return;

        container.innerHTML = `
            <div class="bb-dropdown">
                <button type="button" class="bb-dropdown-trigger" aria-haspopup="true" aria-expanded="false">
                    <span class="bb-dropdown-label">Hold me to a daily limit on</span>
                    <span class="bb-dropdown-count">0</span>
                    <span class="bb-dropdown-caret" aria-hidden="true"></span>
                </button>
                <div class="bb-dropdown-menu" role="menu" hidden>
                    <form class="limit-add" novalidate>
                        <input type="text" class="text-control limit-host" placeholder="reddit.com"
                               aria-label="Site" autocomplete="off" spellcheck="false">
                        <span class="limit-add-either">
                            <input type="number" class="text-control limit-minutes" placeholder="30"
                                   min="0" max="1440" step="5" inputmode="numeric" aria-label="Minutes a day">
                            <span class="limit-unit">min a day</span>
                            <span class="limit-or">or</span>
                            <input type="text" class="text-control limit-from" placeholder="7am"
                                   aria-label="From" autocomplete="off">
                            <span class="limit-unit">to</span>
                            <input type="text" class="text-control limit-to" placeholder="9am"
                                   aria-label="To" autocomplete="off">
                        </span>
                        <button type="submit" class="btn-primary limit-save">Add</button>
                    </form>
                    <p class="limit-hint">A number of minutes is a budget for the day. A pair of times is
                       an allowance too — the site is yours between them and covered the rest of the day.
                       Either way the tally is today's only, and past the limit the site is covered by a
                       sheet you can snooze for ten minutes at a time.</p>
                    <div class="limit-rows"></div>
                </div>
            </div>`;

        const dropdown = container.querySelector('.bb-dropdown');
        const trigger = dropdown.querySelector('.bb-dropdown-trigger');
        const menu = dropdown.querySelector('.bb-dropdown-menu');
        const count = dropdown.querySelector('.bb-dropdown-count');
        const rows = dropdown.querySelector('.limit-rows');
        const form = dropdown.querySelector('.limit-add');

        let sites = {};

        function render() {
            const list = LimitSites.list(sites);
            count.textContent = String(list.length);
            rows.innerHTML = list.length
                ? list.map((row) => `
                    <div class="bb-dropdown-item" role="menuitem">
                        <span class="bb-dropdown-host">${esc(row.host)}</span>
                        <span class="limit-what">${esc(LimitSites.describe(row))}</span>
                        <button type="button" class="bb-dropdown-remove" data-host="${att(row.host)}"
                                title="Stop holding ${att(row.host)} to a limit"
                                aria-label="Remove the limit on ${att(row.host)}">${Icons.svg('x', { size: 13 })}</button>
                    </div>`).join('')
                : '<div class="bb-dropdown-empty">No limits yet. Name a site above and say how long it gets.</div>';
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

        /**
         * `novalidate` on the form, and the complaint said out loud instead.
         *
         * The fields cannot describe the rule between them — one of minutes or
         * a pair of times, not neither — in anything the browser's own
         * validation understands, and a `required` on all four would demand
         * both halves of a choice.
         */
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const fields = {
                host: form.querySelector('.limit-host').value,
                minutes: form.querySelector('.limit-minutes').value,
                from: form.querySelector('.limit-from').value,
                to: form.querySelector('.limit-to').value,
            };

            const row = LimitSites.rowFrom(fields);
            if (!row) {
                Ui.toast(LimitSites.isHost(LimitSites.normalizeHost(fields.host))
                    ? 'Give it either a number of minutes or a pair of times'
                    : 'That does not look like a site — try reddit.com', 'warning');
                return;
            }

            const replacing = Object.prototype.hasOwnProperty.call(sites, row.host);
            sites = await LimitSites.remember(fields);
            render();
            form.reset();
            form.querySelector('.limit-host').focus();
            Ui.toast(`${row.host} — ${LimitSites.describe(row.entry)}${replacing ? ' (replaced)' : ''}`, 'success');
        });

        rows.addEventListener('click', async (event) => {
            const remove = event.target.closest('.bb-dropdown-remove');
            if (!remove) return;
            sites = await LimitSites.forget(remove.dataset.host);
            render();
            Ui.toast(`${remove.dataset.host} is no longer held to a limit`, 'info');
        });

        const reload = () => LimitSites.load().then((loaded) => { sites = loaded; render(); });
        reload();
        Settings.watch([LimitSites.KEY], reload);
    }

    root.BB = root.BB || {};
    root.BB.LimitSitesPanel = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
