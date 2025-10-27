/**
 * The TypeRacer workspace on the dashboard: the races, the weak spots, and
 * the practice map.
 *
 * Three panels off one store, drawn the way src/page/leet-stats.js draws the
 * LeetCode ones — the Activity view's class vocabulary (stat-figure,
 * stat-panel, range-seg, stat-table) so the pages read as one, with a few
 * typer-* additions for what Activity has no use for.
 *
 * Each panel renders wholesale into innerHTML and binds its listeners once on
 * the container, dispatching by delegation. The comment at the head of
 * dashboard.js says why: a per-render listener meant one click ran three
 * deletes after three renders.
 *
 * Everything interpolated goes through escapeHtml or escapeAttr. Most of it is
 * arithmetic, but a gram is a pair of characters the user typed and a quote id
 * is the site's, and neither is trusted on the way out any more than on the
 * way in.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Settings, Typer, Dom, Spark, SiteIcons } = BB;

    const esc = Dom.escapeHtml;
    const att = Dom.escapeAttr;

    const DAY_MS = 864e5;

    /**
     * The ranges every panel shares.
     *
     * Seven days first rather than "all": the question a typing log is opened
     * to answer is about this week, and a mean over two years of races cannot
     * answer it.
     */
    const RANGES = Object.freeze([
        Object.freeze({ id: '7', label: '7 days', days: 7 }),
        Object.freeze({ id: '30', label: '30 days', days: 30 }),
        Object.freeze({ id: 'all', label: 'All', days: 0 }),
    ]);

    /** How many races the trend line averages over. */
    const TREND_WINDOW = 10;

    const sinceOf = (rangeId, now) => {
        const range = RANGES.find((one) => one.id === rangeId) || RANGES[0];
        return range.days ? now - range.days * DAY_MS : 0;
    };

    /** "1h 05m" / "12m" / "45s" — the shape every view in this repo writes. */
    function human(seconds) {
        const s = Math.max(0, Math.round(seconds || 0));
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m`;
        return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
    }

    const dayLabel = (ms) => new Date(ms).toLocaleDateString(undefined,
        { day: 'numeric', month: 'short', year: 'numeric' });

    const timeLabel = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    function figure(label, value, note) {
        return `
            <div class="stat-figure">
                <span class="stat-label">${esc(label)}</span>
                <span class="stat-value">${esc(String(value))}</span>
                <span class="stat-note">${esc(note)}</span>
            </div>`;
    }

    function rangeSeg(current, attribute, label) {
        return `
            <div class="range-seg" role="group" aria-label="${att(label)}">
                ${RANGES.map((range) => `
                    <button class="range-opt" type="button" data-${att(attribute)}="${att(range.id)}"
                            aria-pressed="${range.id === current}">${esc(range.label)}</button>`).join('')}
            </div>`;
    }

    function emptyMarkup(title, message) {
        return `
            <div class="empty-state">
                <div class="empty-icon">${SiteIcons ? SiteIcons.svg('typeracer', { size: 40 }) : '⌨'}</div>
                <h3 class="bb-proper">${esc(title)}</h3>
                ${message ? `<p>${esc(message)}</p>` : ''}
            </div>`;
    }

    /** A finishing position, or nothing at all for a solo run. */
    const placeText = (race) => (race.place && race.of ? `${race.place} of ${race.of}` : '—');

    // -------------------------------------------------------------- races

    function racesMarkup(state, range, now) {
        const summary = Typer.summarize(state.races, { since: sinceOf(range, now) });
        if (!summary.count) {
            const ever = state.races.length;
            return `<div class="dashboard-header"><h2>Races</h2></div>` +
                (ever
                    ? `<div class="dashboard-header"><div class="dashboard-controls">${rangeSeg(range, 'typer-range', 'How far back')}</div></div>
                       <p class="stat-sub">No races in this range. There are ${ever} further back.</p>`
                    : emptyMarkup('No races yet',
                        'Type a race on typeracer.com and it appears here. Bell Bearer measures the keystrokes themselves, so the tables fill up from the first quote — there is nothing to sign in to and nothing to import.'));
        }

        const today = state.races.filter((race) => Typer.dayKey(race.at) === Typer.dayKey(now)).length;
        // Oldest first for the chart: a line over time reads left to right,
        // and summarize hands them back newest first for the table.
        const points = summary.races.slice().reverse().map((race) => ({ x: race.at, y: race.wpm, race }));

        return `
            <div class="dashboard-header">
                <h2>Races</h2>
                <div class="dashboard-controls">${rangeSeg(range, 'typer-range', 'How far back')}</div>
            </div>
            <div class="stat-figures">
                ${figure('Best', summary.best, 'words per minute')}
                ${figure('Last 10', summary.meanLast10, `${summary.mean} over the range`)}
                ${figure('Accuracy', `${summary.accuracy}%`, 'characters right first time')}
                ${figure('Races', summary.count, today === 1 ? '1 of them today' : `${today} of them today`)}
            </div>
            <div class="stat-panel">
                <h3>Speed over time</h3>
                <p class="stat-sub">A point per race, spaced by when it happened rather than evenly — a week
                    away from the keyboard shows as a week. The dashed line is the mean of the last
                    ${TREND_WINDOW}, which is the run rather than the jitter.</p>
                ${Spark.line({
                    points,
                    trend: Spark.trend(points, TREND_WINDOW),
                    height: 180,
                    title: 'Words per minute over time',
                    label: (value) => String(Math.round(value)),
                    describe: (point) => `${dayLabel(point.x)} — ${point.race.wpm} wpm, ${point.race.accuracy}% accurate`,
                })}
            </div>
            <div class="stat-panel">
                <h3>Recent races</h3>
                <p class="stat-sub">Newest first. "Lost" is the time inside the race spent typing something
                    wrong and getting back out of it.</p>
                ${recentTable(summary.races.slice(0, 25))}
            </div>`;
    }

    function recentTable(races) {
        return `
            <table class="stat-table typer-races">
                <thead><tr>
                    <th>When</th><th class="col-num">WPM</th><th class="col-num">Accuracy</th>
                    <th class="col-num">Place</th><th class="col-num">Lost</th>
                </tr></thead>
                <tbody>${races.map((race) => `
                    <tr>
                        <td>${esc(dayLabel(race.at))} <span class="page-host">${esc(timeLabel(race.at))}</span></td>
                        <td class="col-num">${esc(String(race.wpm))}</td>
                        <td class="col-num">${esc(String(race.accuracy))}%</td>
                        <td class="col-num">${esc(placeText(race))}</td>
                        <td class="col-num">${race.correctionMs
                            ? `${esc((race.correctionMs / 1000).toFixed(1))}s`
                            : '—'}</td>
                    </tr>`).join('')}</tbody>
            </table>`;
    }

    // ----------------------------------------------------------- the view

    /**
     * One panel. `kind` is which of the three it draws; they share a store, a
     * reload and a delegated click handler, and differ only in markup.
     */
    function mountPanel(host, kind) {
        let state = Typer.blank();
        let range = RANGES[0].id;

        function paint() {
            const now = Date.now();
            if (kind === 'races') host.innerHTML = racesMarkup(state, range, now);
        }

        host.addEventListener('click', (event) => {
            const button = event.target.closest('[data-typer-range]');
            if (button) {
                range = button.dataset.typerRange;
                paint();
            }
        });

        async function reload() {
            state = await Typer.load();
            paint();
        }

        return { reload, render: paint, rangeId: () => range };
    }

    /**
     * Draw every TypeRacer panel under `scope` and keep it current.
     *
     * Following the store matters as much as it does for the LeetCode panels:
     * a race finishing in another tab writes to these keys, and a dashboard
     * left open beside the pit would otherwise be a screenshot of whenever it
     * was opened.
     */
    function mountAll(scope = document) {
        const hosts = Array.from(scope.querySelectorAll('[data-typer-races]')).map((host) => [host, 'races']);
        if (!hosts.length) return;

        const panels = hosts.map(([host, kind]) => {
            const panel = mountPanel(host, kind);
            panel.reload();
            return panel;
        });

        Settings.watch(Typer.KEYS, () => panels.forEach((panel) => panel.reload()));
    }

    BB.TyperStats = { mountAll, mountPanel, RANGES, TREND_WINDOW, human, sinceOf, placeText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
