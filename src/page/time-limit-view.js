/**
 * Today against the daily limit, for x.com and reddit.com.
 *
 * Two places show the same thing: the site's own card on the dashboard, and
 * the foot of its settings panel, where it is the answer to "what does this
 * number mean in practice". Both are `[data-time-limit-view="<site>"]`, and
 * both are drawn from here so there is one copy of the arithmetic's phrasing.
 *
 * It follows the store rather than reading it once: the page being counted is
 * usually in another tab, banking its seconds every fifteen, and a figure
 * that only moved on reload would read as broken.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Settings, TimeLimits, Dom } = BB;

    const esc = (text) => Dom.escapeHtml(text);

    function bodyHtml(site, status) {
        const spent = TimeLimits.human(status.spent);
        const resets = new Date(TimeLimits.resetsAt())
            .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

        if (!status.on) {
            return `
                <div class="limit-figure">
                    <span class="limit-value">${esc(spent)}</span>
                    <span class="limit-note">on ${esc(site.host)} today${status.spent ? '' : ' — nothing yet'}</span>
                </div>
                <p class="stat-sub">No limit set, so nothing is being counted from here on.
                   Turn one on in this site's settings and the tally starts.</p>`;
        }

        const share = Math.min(100, Math.round((status.spent / status.allowed) * 100));
        const left = status.blocked
            ? `Spent. ${esc(site.host)} is covered until ${esc(resets)}.`
            : `${esc(TimeLimits.human(status.remaining))} left of ${esc(TimeLimits.human(status.allowed))} — the tally goes at ${esc(resets)}.`;

        return `
            <div class="limit-figure">
                <span class="limit-value">${esc(spent)}</span>
                <span class="limit-note">of ${esc(TimeLimits.human(status.allowed))} today</span>
            </div>
            <div class="limit-bar${status.blocked ? ' is-spent' : ''}">
                <span style="width:${share}%"></span>
            </div>
            <p class="stat-sub">${left}</p>`;
    }

    async function render(hosts) {
        const [state, settings] = await Promise.all([TimeLimits.load(), Settings.get()]);
        for (const host of hosts) {
            const site = TimeLimits.get(host.dataset.timeLimitView);
            if (!site) continue;
            host.classList.add('limit-panel');
            host.innerHTML = bodyHtml(site, TimeLimits.statusFor(state, settings, site.id));
        }
    }

    /** Draw every `[data-time-limit-view]` under `scope`, and keep it current. */
    function mountAll(scope = document) {
        const hosts = Array.from(scope.querySelectorAll('[data-time-limit-view]'));
        if (!hosts.length) return;

        const draw = () => render(hosts);
        draw();

        const keys = [TimeLimits.KEY];
        for (const site of TimeLimits.list()) keys.push(site.onKey, site.minutesKey);
        Settings.watch(keys, draw);
    }

    BB.TimeLimitView = { mountAll, render, bodyHtml };
})(typeof globalThis !== 'undefined' ? globalThis : this);
