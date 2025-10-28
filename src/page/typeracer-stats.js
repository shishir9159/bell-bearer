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

    // --------------------------------------------------------- weak spots

    /**
     * A gram, written so a space in it is visible.
     *
     * Half the slow bigrams are a letter followed by a space, and a pair
     * rendered as "t " reads as a rendering fault rather than as a finding.
     * The open-box glyph is what a text editor uses for the same job.
     */
    function gramGlyph(gram) {
        return String(gram).split('').map((ch) => (ch === ' '
            ? '<span class="typer-space" title="space">␣</span>'
            : esc(ch))).join('');
    }

    /**
     * How slow this gram is against your own baseline, as a bar.
     *
     * The bar is the .chess-wdl shape: a track with a filled part, no colour
     * of its own. Anything at or under the baseline fills nothing — the table
     * only holds grams that are slower than it, and a full bar on the best
     * row in a table of worst rows would say the opposite of what it means.
     */
    function ratioBar(row) {
        // Twice the baseline fills the track; past that it is simply full.
        const share = Math.max(0, Math.min(100, (row.ratio - 1) * 100));
        const title = `${row.meanMs}ms against ${row.baseline}ms for anything ending "${row.gram.slice(-1)}"`;
        return `<span class="chess-wdl typer-ratio" title="${att(title)}"><span class="typer-ratio-fill" style="width:${share}%"></span></span>`;
    }

    function gramTable(rows, minSamples, noun) {
        if (!rows.length) {
            return `<p class="stat-sub">Nothing with ${esc(String(minSamples))} readings yet. Type a few more
                    races and the ${esc(noun)} you stall on come out of the noise.</p>`;
        }
        return `
            <table class="stat-table typer-grams">
                <thead><tr>
                    <th>Gram</th><th class="col-num">Mean</th><th class="col-num">WPM</th>
                    <th class="col-num">Seen</th><th class="typer-ratio-col">Against your own</th>
                </tr></thead>
                <tbody>${rows.map((row) => `
                    <tr>
                        <td><span class="typer-gram">${gramGlyph(row.gram)}</span></td>
                        <td class="col-num">${esc(String(row.meanMs))}ms</td>
                        <td class="col-num">${esc(String(row.wpm))}</td>
                        <td class="col-num">${esc(String(row.n))}</td>
                        <td class="typer-ratio-col">${ratioBar(row)}<span class="typer-ratio-num">${esc(row.ratio.toFixed(2))}&times;</span></td>
                    </tr>`).join('')}</tbody>
            </table>`;
    }

    function mistypeTable(rows) {
        if (!rows.length) return '<p class="stat-sub">Nothing mistyped often enough to name. Well done.</p>';
        return `
            <table class="stat-table typer-mistypes">
                <thead><tr>
                    <th>Due</th><th class="col-num">Times</th><th class="col-num">Wrong</th>
                    <th class="col-num">Rate</th><th>You hit</th>
                </tr></thead>
                <tbody>${rows.map((row) => `
                    <tr>
                        <td><span class="typer-gram">${gramGlyph(row.ch)}</span></td>
                        <td class="col-num">${esc(String(row.due))}</td>
                        <td class="col-num">${esc(String(row.wrong))}</td>
                        <td class="col-num">${esc((row.rate * 100).toFixed(1))}%</td>
                        <td>${row.subs.map((sub) =>
                            `<span class="typer-sub"><span class="typer-gram">${gramGlyph(sub.ch)}</span>&times;${esc(String(sub.n))}</span>`).join('')}</td>
                    </tr>`).join('')}</tbody>
            </table>`;
    }

    function costMarkup(state, range, now) {
        const cost = Typer.correctionCost(state.races, { since: sinceOf(range, now) });
        return `
            <div class="stat-figures">
                ${figure('Lost', human(cost.seconds), `${cost.percent}% of the time raced`)}
                ${figure('Actual', cost.wpm, 'words per minute')}
                ${figure('Clean', cost.cleanWpm, 'with the corrections out')}
                ${figure('Difference', cost.delta > 0 ? `+${cost.delta}` : String(cost.delta), 'words per minute')}
            </div>
            <p class="stat-sub">Clean speed is these same keystrokes with the time spent typing something
                wrong — and getting back out of it — taken off the clock. It is not a projection of what you
                could do; it is what this race already was, minus the correcting.</p>`;
    }

    function weakMarkup(state, range, sort, minSamples, now) {
        if (!state.races.length) {
            return `<div class="dashboard-header"><h2>Weak spots</h2></div>` +
                emptyMarkup('Nothing measured yet',
                    'These tables are built from the keystrokes themselves rather than from anything TypeRacer publishes, so they fill up as you race. A dozen quotes is usually enough for the first pairs to come out of the noise.');
        }

        const bigrams = Typer.slowest(state, 'bi', { minSamples });
        const trigrams = Typer.slowest(state, 'tri', { minSamples });

        return `
            <div class="dashboard-header">
                <h2>Weak spots</h2>
                <div class="dashboard-controls">${rangeSeg(range, 'typer-range', 'How far back')}</div>
            </div>
            <div class="stat-panel">
                <h3>Slowest pairs</h3>
                <p class="stat-sub">Ranked by how slow each pair is <em>for you</em> — against your own mean
                    for anything ending in that character — rather than by raw milliseconds, which only ever
                    returns every pair containing a comma. Intervals spanning a correction are left out.</p>
                ${gramTable(bigrams, minSamples, 'pairs')}
            </div>
            <div class="stat-panel">
                <h3>Slowest rolls</h3>
                <p class="stat-sub">Three characters, timed across the second of their two intervals. A roll
                    that is slow when both pairs inside it are fast is a different problem from a slow pair,
                    and a different thing to drill.</p>
                ${gramTable(trigrams, minSamples, 'rolls')}
            </div>
            <div class="stat-panel">
                <h3>Most mistyped</h3>
                <p class="stat-sub">"Most often" is dominated by the letters that are simply everywhere.
                    "Most likely" is the share of the times you met it — the honest one, and the one worth
                    doing something about.</p>
                <div class="dashboard-controls">
                    <div class="range-seg" role="group" aria-label="How the characters are ranked">
                        <button class="range-opt" type="button" data-typer-sort="wrong"
                                aria-pressed="${sort === 'wrong'}">Most often</button>
                        <button class="range-opt" type="button" data-typer-sort="rate"
                                aria-pressed="${sort === 'rate'}">Most likely</button>
                    </div>
                </div>
                ${mistypeTable(Typer.mistyped(state, { by: sort }))}
            </div>
            <div class="stat-panel">
                <h3>Cost of correction</h3>
                ${costMarkup(state, range, now)}
            </div>`;
    }

    // ----------------------------------------------------------- the view

    /**
     * One panel. `kind` is which of the three it draws; they share a store, a
     * reload and a delegated click handler, and differ only in markup.
     */
    function mountPanel(host, kind) {
        let state = Typer.blank();
        let range = RANGES[0].id;
        let sort = 'wrong';
        let minSamples = Settings.DEFAULTS.typerMinSamples;

        function paint() {
            const now = Date.now();
            if (kind === 'races') host.innerHTML = racesMarkup(state, range, now);
            else if (kind === 'weak') host.innerHTML = weakMarkup(state, range, sort, minSamples, now);
        }

        host.addEventListener('click', (event) => {
            const ranged = event.target.closest('[data-typer-range]');
            if (ranged) {
                range = ranged.dataset.typerRange;
                paint();
                return;
            }
            const sorted = event.target.closest('[data-typer-sort]');
            if (sorted) {
                sort = sorted.dataset.typerSort;
                paint();
            }
        });

        async function reload() {
            state = await Typer.load();
            paint();
        }

        /**
         * The noise floor changed in Settings.
         *
         * Read here rather than passed in, because it is one number the panel
         * needs and threading it through mountAll would mean the tables went
         * stale whenever it was edited from another tab.
         */
        async function applySettings() {
            const values = await Settings.get(['typerMinSamples']);
            const want = Math.max(3, Number(values.typerMinSamples) || Settings.DEFAULTS.typerMinSamples);
            if (want === minSamples) return;
            minSamples = want;
            paint();
        }

        return { reload, render: paint, applySettings, rangeId: () => range, sortId: () => sort };
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
        const hosts = [
            ...Array.from(scope.querySelectorAll('[data-typer-races]')).map((host) => [host, 'races']),
            ...Array.from(scope.querySelectorAll('[data-typer-weak]')).map((host) => [host, 'weak']),
        ];
        if (!hosts.length) return;

        const panels = hosts.map(([host, kind]) => {
            const panel = mountPanel(host, kind);
            panel.reload();
            panel.applySettings();
            return panel;
        });

        Settings.watch(Typer.KEYS, () => panels.forEach((panel) => panel.reload()));
        Settings.watch(['typerMinSamples'], () => panels.forEach((panel) => panel.applySettings()));
    }

    BB.TyperStats = {
        mountAll, mountPanel, RANGES, TREND_WINDOW,
        human, sinceOf, placeText, gramGlyph, ratioBar,
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
