/**
 * Today against the daily limit, for a site that has one.
 *
 * Two places show the same thing: the site's own Time tab in the dashboard,
 * and the foot of its settings panel, where it is the answer to "what does
 * this number mean in practice". Both are `[data-time-limit-view="<site>"]`,
 * and both are drawn from here so there is one copy of the arithmetic's
 * phrasing.
 *
 * What the limit *is* is not shown or set here any more — that is the list in
 * Settings → General, which any host can join. This says what today has gone
 * on and where that leaves you, and points at the list when there is no row.
 *
 * It follows both stores rather than reading them once: the page being counted
 * is usually in another tab, banking its seconds every fifteen, and a figure
 * that only moved on reload would read as broken.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Settings, TimeLimits, LimitSites, Dom } = BB;

    const esc = (text) => Dom.escapeHtml(text);

    function bodyHtml(site, status, limit) {
        const spent = TimeLimits.human(status.spent);

        if (!status.on) {
            return `
                <div class="limit-figure">
                    <span class="limit-value">${esc(spent)}</span>
                    <span class="limit-note">on ${esc(site.host)} today${status.spent ? '' : ' — nothing yet'}</span>
                </div>
                <p class="stat-sub">No limit on ${esc(site.host)}, so nothing is being counted from
                   here on. Add one under Settings &rarr; General and the tally starts.</p>`;
        }

        // A window has no budget to be a fraction of, so there is no bar to
        // draw: what matters is whether the hours are open, and when they are
        // next not. Drawing a bar against an arbitrary denominator here was
        // the obvious thing and it said nothing true.
        if (status.mode === 'window') {
            return `
                <div class="limit-figure">
                    <span class="limit-value">${esc(spent)}</span>
                    <span class="limit-note">on ${esc(site.host)} today</span>
                </div>
                <p class="stat-sub">${status.open
                    ? `Open until ${esc(LimitSites.clockText(limit.to))}.`
                    : `Covered until ${esc(LimitSites.clockText(limit.from))}.`}
                   ${esc(site.host)} is yours ${esc(LimitSites.clockText(limit.from))} to
                   ${esc(LimitSites.clockText(limit.to))}.${snoozeHtml(status)}</p>`;
        }

        const share = Math.min(100, Math.round((status.spent / status.allowed) * 100));
        const left = status.blocked
            ? `Spent. ${esc(site.host)} is covered until midnight.`
            : `${esc(TimeLimits.human(status.remaining))} left of ${esc(TimeLimits.human(status.allowed))} — the tally goes at midnight.`;

        return `
            <div class="limit-figure">
                <span class="limit-value">${esc(spent)}</span>
                <span class="limit-note">of ${esc(TimeLimits.human(status.allowed))} today</span>
            </div>
            <div class="limit-bar${status.blocked ? ' is-spent' : ''}">
                <span style="width:${share}%"></span>
            </div>
            <p class="stat-sub">${left}${snoozeHtml(status)}</p>`;
    }

    /** Said plainly, because a snooze count you cannot see is not a check. */
    function snoozeHtml(status) {
        if (!status.snoozes) return '';
        const n = status.snoozes;
        return ` Snoozed ${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`} today.`;
    }

    async function render(hosts) {
        const [state, sites] = await Promise.all([TimeLimits.load(), LimitSites.load()]);
        for (const host of hosts) {
            const site = TimeLimits.get(host.dataset.timeLimitView);
            if (!site) continue;
            const limit = LimitSites.entryFor(sites, site.host);
            // The figure sits in a wrapper of its own rather than the class
            // going on the host: on the dashboard the host is a `.site-panel`,
            // which is display:none until its site is the one open, and a
            // second class on it setting display:flex won that tie on source
            // order — so both sites' panels were drawn at once, whichever
            // card you opened.
            const body = bodyHtml(site, TimeLimits.statusFor(state, limit, site.host), limit);
            host.innerHTML = `<div class="limit-panel">${body}</div>`;
        }
    }

    /** Draw every `[data-time-limit-view]` under `scope`, and keep it current. */
    function mountAll(scope = document) {
        const hosts = Array.from(scope.querySelectorAll('[data-time-limit-view]'));
        if (!hosts.length) return;

        const draw = () => render(hosts);
        draw();

        Settings.watch([TimeLimits.KEY, LimitSites.KEY], draw);
    }

    BB.TimeLimitView = { mountAll, render, bodyHtml };
})(typeof globalThis !== 'undefined' ? globalThis : this);
