/**
 * The Activity view.
 *
 * Reads BB.Activity only — it never touches the bookmark store.
 *
 * The tab used to be hidden whenever `trackActivity` was off, which is the
 * default. That made a whole view of the extension invisible until you found
 * the one checkbox that summoned it, and the checkbox is the only place the
 * view is ever mentioned. The tab is always there now; with tracking off it
 * says so, and offers to turn it on.
 */
(function () {
    'use strict';

    const BB = (window.BB = window.BB || {});
    const RANGES = { today: 1, week: 7, month: 30 };

    /**
     * The window currently on screen. Module-scope rather than a local in
     * install(), because dashboard.js re-renders this view every time the tab
     * is selected — with it local, coming back to Activity silently reset the
     * range to Today while the segmented control still read "Last 30 days".
     */
    let range = 'today';
    const LABEL = { today: 'today', week: 'the last 7 days', month: 'the last 30 days' };

    /** Whether `trackActivity` is on. Kept in step by install()'s watcher. */
    let tracking = false;

    const esc = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const clock = (hour) => `${String(hour).padStart(2, '0')}:00`;

    function dayName(key) {
        const date = new Date(`${key}T12:00:00`);
        const today = new Date().toISOString().slice(0, 10);
        if (key === today) return 'Today';
        return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
    }

    function figures(now, before, range) {
        const human = BB.Activity.human;
        const delta = before == null ? null : now.total - before.total;
        const trend = delta == null || !before.total
            ? ''
            : `${delta >= 0 ? '+' : '−'}${human(Math.abs(delta))} vs the ${range === 'today' ? 'day' : 'period'} before`;

        const perDay = now.days > 1 ? `${human(Math.round(now.total / now.days))} a day` : 'so far';
        const longest = now.longest ? human(now.longest.seconds) : '—';

        return [
            ['Time on screen', human(now.total), trend || perDay],
            ['Sites', String(now.sites), now.hosts[0] ? `${esc(now.hosts[0].host)} leads` : 'nothing yet'],
            ['Longest single page', longest, now.longest ? esc(now.longest.host) : '—'],
            ['Busiest hour', now.total ? clock(now.peakHour) : '—', now.total ? human(now.hours[now.peakHour]) : '—'],
        ].map(([label, value, note]) => `
            <div class="stat-figure">
                <span class="stat-label">${label}</span>
                <span class="stat-value">${value}</span>
                <span class="stat-note">${note}</span>
            </div>`).join('');
    }

    function sites(summary) {
        if (!summary.hosts.length) return '<p class="stat-sub">Nothing recorded in this range.</p>';
        const top = summary.hosts.slice(0, 8);
        const max = top[0].seconds || 1;
        return `<ul class="site-list">${top.map((entry) => `
            <li class="site-row">
                <span class="site-name">${esc(entry.host)}</span>
                <span class="site-bar"><span style="width:${Math.max(2, Math.round((entry.seconds / max) * 100))}%"></span></span>
                <span class="site-time">${BB.Activity.human(entry.seconds)}</span>
            </li>`).join('')}</ul>`;
    }

    function pages(summary) {
        if (!summary.daily.length) return '<p class="stat-sub">Nothing recorded in this range.</p>';
        return `<table class="stat-table">
            <thead><tr><th class="col-day">Day</th><th>Page</th><th class="col-time">Time</th></tr></thead>
            <tbody>${summary.daily.slice(0, 7).map((entry) => `
                <tr>
                    <td class="col-day">${dayName(entry.day)}</td>
                    <td>
                        <span class="page-title">${esc(entry.title)}</span>
                        <span class="page-host">${esc(entry.host)}</span>
                    </td>
                    <td class="col-time">${BB.Activity.human(entry.seconds)}</td>
                </tr>`).join('')}</tbody>
        </table>`;
    }

    function hours(summary) {
        const max = Math.max(...summary.hours) || 1;
        const bars = summary.hours.map((seconds, hour) => {
            const height = Math.round((seconds / max) * 100);
            const cls = !seconds ? 'hour-bar empty' : hour === summary.peakHour ? 'hour-bar peak' : 'hour-bar';
            return `<div class="${cls}" style="height:${Math.max(2, height)}%" title="${clock(hour)} — ${BB.Activity.human(seconds)}"></div>`;
        }).join('');

        return `<div class="hour-strip">${bars}</div>
            <div class="hour-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>`;
    }

    /**
     * What the view says when there is nothing to say — no store to read,
     * because nothing is being recorded. The button is the same switch as the
     * one in Settings, so the feature can be turned on from the page that
     * explains it rather than only from a checkbox three views away.
     */
    function invitation() {
        return `
            <div class="empty-state">
                <h3>Activity tracking is off</h3>
                <p>
                    Turn it on and this page fills in: time per site, per hour and
                    per day, and the single page you stayed on longest each day.
                    <br><br>
                    It is recorded on this machine only. Nothing is sent anywhere,
                    no browsing history is read, and readings older than 60 days
                    are dropped.
                </p>
                <button class="btn-primary" id="statsEnable" type="button">Turn on tracking</button>
            </div>`;
    }

    async function render(next) {
        if (next) range = next;

        const body = document.getElementById('statsBody');
        if (!body) return;

        if (!tracking) {
            body.innerHTML = invitation();
            return;
        }

        const days = RANGES[range] || 1;
        // One read of the store covers both windows: the current one and the
        // total of the one before it, which is all the trend line needs.
        const { now, previousTotal } = await BB.Activity.report(days);
        const previous = { total: previousTotal };

        body.innerHTML = `
            <div class="stat-figures">${figures(now, previous, range)}</div>
            <div class="stat-grid">
                <div class="stat-panel">
                    <h3>Where it went</h3>
                    <p class="stat-sub">Focused time per site, ${LABEL[range]}.</p>
                    ${sites(now)}
                </div>
                <div class="stat-panel">
                    <h3>Longest page each day</h3>
                    <p class="stat-sub">The single page you stayed on longest, day by day.</p>
                    ${pages(now)}
                </div>
            </div>
            <div class="stat-panel">
                <h3>By hour</h3>
                <p class="stat-sub">When the time went, summed across ${LABEL[range]}.</p>
                ${hours(now)}
            </div>`;
    }

    async function install() {
        const tab = document.getElementById('statsTab');
        const view = document.getElementById('statsView');
        if (!tab || !view || !BB.Activity) return;

        const seg = document.getElementById('statsRange');

        // One delegated listener rather than one per render: the body is
        // replaced wholesale every time, so a listener bound to the button
        // inside it would have to be re-bound every time with it.
        view.addEventListener('click', (event) => {
            if (!event.target.closest('#statsEnable')) return;
            if (BB.Settings) BB.Settings.set({ [BB.Activity.SETTING]: true });
        });

        seg.addEventListener('click', (event) => {
            const option = event.target.closest('.range-opt');
            if (!option) return;
            seg.querySelectorAll('.range-opt').forEach((o) => o.setAttribute('aria-pressed', String(o === option)));
            render(option.dataset.range);
        });

        /**
         * Follow the setting live rather than reading it once, so flipping the
         * toggle — here or in Settings, in this tab or another one — swaps the
         * view between the figures and the invitation straight away instead of
         * on the next reload.
         *
         * The range control belongs to the figures, so it goes with them.
         */
        const sync = (on) => {
            tracking = on;
            seg.hidden = !on;
            render(range);
        };

        const setting = BB.Activity.SETTING;
        sync(BB.Settings ? !!(await BB.Settings.get([setting]))[setting] : false);
        if (BB.Settings && BB.Settings.watch) {
            BB.Settings.watch([setting], (changed) => sync(!!changed[setting]));
        }
    }

    BB.Stats = { install, render };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install, { once: true });
    } else {
        install();
    }
})();
