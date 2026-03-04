/**
 * A chess site's games view — chess.com or Lichess — for the dashboard (full)
 * and the popup (compact).
 *
 * Both sites go through one view: src/shared/chess-sites.js names the site and
 * its reader, and both readers hand back games in the same shape, so every
 * figure, panel and table below is drawn the same way for either.
 *
 * The markup reuses the Activity view's classes (stat-figure, stat-panel,
 * range-seg, stat-table) so the two read as one page, with a few chess-*
 * additions for what Activity has no use for — the win/draw/loss bar and the
 * result pills.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Chess, ChessSites, Settings, Dom, SiteIcons, Icons } = BB;

    const esc = Dom.escapeHtml;

    function dayLabel(ms, now = Date.now()) {
        const date = new Date(ms);
        const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        if (date.toDateString() === new Date(now).toDateString()) return time;
        return `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}, ${time}`;
    }

    function ratioText(row) {
        const rate = Chess.winRate(row);
        const ratio = Chess.winLossRatio(row);
        const parts = [`${row.win}W ${row.loss}L ${row.draw}D`];
        if (rate != null) parts.push(`${rate}%`);
        if (ratio != null) parts.push(`W/L ${ratio.toFixed(2)}`);
        else if (row.win) parts.push('no losses');
        return parts.join(' · ');
    }

    /** Wins, draws, losses as one bar; an empty track when nothing was played. */
    function wdlBar(row) {
        if (!row.games) return '<span class="chess-wdl is-empty"></span>';
        const pct = (n) => (n / row.games) * 100;
        return `<span class="chess-wdl" title="${esc(ratioText(row))}">
            <span class="chess-wdl-win" style="width:${pct(row.win)}%"></span><span
                  class="chess-wdl-draw" style="width:${pct(row.draw)}%"></span><span
                  class="chess-wdl-loss" style="width:${pct(row.loss)}%"></span>
        </span>`;
    }

    function classRows(summary) {
        return `<ul class="chess-class-list">${Chess.CLASSES.map((name) => {
            const row = summary.byClass[name];
            return `
                <li class="chess-class-row">
                    <span class="chess-class-name">${Chess.CLASS_LABEL[name]}</span>
                    ${wdlBar(row)}
                    <span class="chess-class-score">${row.games ? esc(ratioText(row)) : '—'}</span>
                </li>`;
        }).join('')}</ul>`;
    }

    function avg(total, n) {
        return n ? Chess.human(total / n) : '—';
    }

    function resultPill(game) {
        const label = game.result === 'win' ? 'Won' : game.result === 'loss' ? 'Lost' : 'Draw';
        return `<span class="chess-result is-${game.result}" title="${esc(game.how || '')}">${label}</span>`;
    }

    function recentTable(summary, limit) {
        if (!summary.games.length) return '<p class="stat-sub">No games in this range.</p>';
        return `<table class="stat-table chess-recent-table">
            <thead><tr><th class="col-day">When</th><th>Opponent</th><th>Control</th><th>Result</th><th class="col-num">You</th><th class="col-num">Them</th></tr></thead>
            <tbody>${summary.games.slice(0, limit).map((game) => `
                <tr>
                    <td class="col-day">${esc(dayLabel(game.end))}</td>
                    <td>
                        <a class="page-title chess-opponent" href="${Dom.safeUrlAttr(game.url)}" target="_blank" rel="noopener noreferrer">${esc(game.opponent)}</a>
                        <span class="page-host">${game.opponentRating ? `${game.opponentRating} · ` : ''}played ${game.color}</span>
                    </td>
                    <td>${esc(Chess.CLASS_LABEL[game.timeClass] || game.timeClass)} <span class="page-host">${esc(Chess.formatControl(game.timeControl))}</span></td>
                    <td>${resultPill(game)}</td>
                    <td class="col-num">${game.myTime != null ? Chess.human(game.myTime) : '—'}</td>
                    <td class="col-num">${game.oppTime != null ? Chess.human(game.oppTime) : '—'}</td>
                </tr>`).join('')}</tbody>
        </table>`;
    }

    function figure(label, value, note) {
        return `
            <div class="stat-figure">
                <span class="stat-label">${label}</span>
                <span class="stat-value">${value}</span>
                <span class="stat-note">${note}</span>
            </div>`;
    }

    function clockFigure(summary) {
        const { total } = summary;
        return figure(
            'Time on the clock',
            total.timed ? Chess.human(total.myTime + total.oppTime) : '—',
            total.timed ? `you ${Chess.human(total.myTime)} · opponents ${Chess.human(total.oppTime)}` : 'no clocked games',
        );
    }

    // ------------------------------------------------------ time management

    /**
     * Games won on the opponent's clock from the left of the bar, games lost
     * on your own from the right, out of the last FLAG_WINDOW played.
     */
    function flagRows(stats) {
        return `<ul class="chess-class-list">${Chess.CLASSES.map((name) => {
            const row = stats[name];
            const label = Chess.CLASS_LABEL[name];
            if (!row.games) {
                return `
                    <li class="chess-class-row">
                        <span class="chess-class-name">${label}</span>
                        <span class="chess-wdl is-empty"></span>
                        <span class="chess-class-score">—</span>
                    </li>`;
            }
            const pct = (n) => (n / row.games) * 100;
            const title = `Last ${row.games} ${label.toLowerCase()} game${row.games === 1 ? '' : 's'}: won ${row.won} by flagging, lost ${row.lost} on time`;
            return `
                <li class="chess-class-row">
                    <span class="chess-class-name">${label}</span>
                    <span class="chess-wdl" title="${esc(title)}">
                        <span class="chess-wdl-win" style="width:${pct(row.won)}%"></span><span
                              class="chess-wdl-rest"></span><span
                              class="chess-wdl-loss" style="width:${pct(row.lost)}%"></span>
                    </span>
                    <span class="chess-class-score">${row.won} won · ${row.lost} lost of ${row.games}</span>
                </li>`;
        }).join('')}</ul>`;
    }

    function timeManagementPanel({ games, history, historyLoading }) {
        const partial = !history && historyLoading ? ' Reading older games…' : '';
        return `
            <div class="stat-panel">
                <h3>Time management</h3>
                <p class="stat-sub">Your last ${Chess.FLAG_WINDOW} games of each time control: won on the opponent's clock, lost on yours.${partial}</p>
                ${flagRows(Chess.flagStats(history || games))}
                <div class="chess-legend"><span class="is-win">Won on time</span><span class="is-loss">Lost on time</span></div>
            </div>`;
    }

    // --------------------------------------------------------------- heat map

    const HEAT_STEPS = [15 * 60, 45 * 60, 90 * 60];
    const HEAT_LEGEND = ['No games', 'Up to 15m', '15m – 45m', '45m – 1h 30m', 'Over 1h 30m'];

    function heatPanel({ source, history, historyError, historyLoading, now }) {
        let body;
        let sub;
        if (history) {
            const days = {};
            let total = 0;
            let played = 0;
            let busiest = null;
            for (const [key, day] of Object.entries(Chess.dailyTime(history))) {
                days[key] = { value: day.seconds, seconds: day.seconds, games: day.games };
                total += day.seconds;
                played++;
                if (!busiest || day.seconds > busiest.seconds) busiest = { key, ...day };
            }
            sub = played
                ? `${Chess.human(total)} across ${played} day${played === 1 ? '' : 's'} on ${esc(source.name)} this past year · busiest ${esc(busiest.key)}, ${Chess.human(busiest.seconds)}`
                : `No games on ${esc(source.name)} this past year.`;
            if (historyLoading) sub += ' · reading older games…';
            body = BB.HeatMap.render({
                days,
                end: now,
                steps: HEAT_STEPS,
                legend: HEAT_LEGEND,
                describe: (day, date) => {
                    const when = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
                    return day ? `${when} — ${Chess.human(day.seconds)} · ${day.games} game${day.games === 1 ? '' : 's'}` : `${when} — no games`;
                },
            });
        } else if (historyError) {
            sub = esc(historyError.message);
            body = '<button type="button" class="btn-secondary" data-chess-action="history-retry">Try again</button>';
        } else {
            sub = `Reading a year of ${esc(source.name)} games — the first time takes a while, after that only new games are read.`;
            body = '<div class="hm-placeholder"></div>';
        }
        return `
            <div class="stat-panel chess-heat">
                <h3>Time at the board</h3>
                <p class="stat-sub">${sub}</p>
                ${body}
            </div>`;
    }

    function fullMarkup(state) {
        const { username, games, range, now, loading } = state;
        const summary = Chess.summarize(games, { since: Chess.rangeStart(range, now), until: now });
        const count = Chess.counts(games, now);
        const label = Chess.RANGES[range].toLowerCase();

        return `
            <div class="stat-figures">
                ${figure('Today', count.today, `game${count.today === 1 ? '' : 's'} as ${esc(username)}`)}
                ${figure('Last 7 days', count.week, `${Math.round((count.week / 7) * 10) / 10} a day`)}
                ${figure('Last 30 days', count.month, `${Math.round((count.month / 30) * 10) / 10} a day`)}
                ${clockFigure(summary)}
            </div>
            <div class="stat-grid">
                <div class="stat-panel">
                    <h3>Win / loss by time control</h3>
                    <p class="stat-sub">Wins, losses and draws, ${label}. The rate counts decided games only.</p>
                    ${classRows(summary)}
                    <div class="chess-legend"><span class="is-win">Win</span><span class="is-draw">Draw</span><span class="is-loss">Loss</span></div>
                </div>
                ${timeManagementPanel(state)}
            </div>
            ${heatPanel(state)}
            <div class="stat-panel">
                <h3>Games</h3>
                <p class="stat-sub">${summary.count} game${summary.count === 1 ? '' : 's'} ${label}, newest first.${loading ? ' Still reading…' : ''}</p>
                ${recentTable(summary, 25)}
            </div>`;
    }

    function compactMarkup({ username, games, range, now }) {
        const summary = Chess.summarize(games, { since: Chess.rangeStart(range, now), until: now });
        const count = Chess.counts(games, now);
        const { total } = summary;

        return `
            <div class="chess-pop-figures">
                ${[['today', 'Today'], ['week', '7 days'], ['month', '30 days']].map(([id, name]) => `
                    <button type="button" class="chess-pop-figure" data-range="${id}" aria-pressed="${id === range}">
                        <span class="chess-pop-value">${count[id]}</span>
                        <span class="chess-pop-label">${name}</span>
                    </button>`).join('')}
            </div>
            <div class="chess-pop-section">
                <div class="chess-pop-heading">
                    <span>Win / loss · ${esc(Chess.RANGES[range].toLowerCase())}</span>
                    <span class="chess-pop-user">${esc(username)}</span>
                </div>
                ${classRows(summary)}
            </div>
            <div class="chess-pop-section chess-pop-clock">
                <div class="chess-pop-heading"><span>Time on the clock</span></div>
                <div class="chess-pop-clock-row">
                    <span><strong>${total.timed ? Chess.human(total.myTime) : '—'}</strong> you</span>
                    <span><strong>${total.timed ? Chess.human(total.oppTime) : '—'}</strong> opponents</span>
                    <span><strong>${total.timed ? avg(total.myTime, total.timed) : '—'}</strong> per game</span>
                </div>
            </div>
            <div class="chess-pop-section chess-pop-recent">
                <div class="chess-pop-heading">
                    <span>Recent · ${summary.count}</span>
                    <span class="chess-pop-legend"><span class="is-win">Won</span><span class="is-loss">Lost</span><span class="is-draw">Draw</span></span>
                </div>
                ${summary.games.length
                    ? `<div class="chess-pills">${summary.games.map(gamePill).join('')}</div>`
                    : '<p class="chess-pop-none">No games in this range.</p>'}
            </div>`;
    }

    /** One game as a pill: its time control, colored by how it ended. */
    function gamePill(game) {
        const result = game.result === 'win' ? 'Won' : game.result === 'loss' ? 'Lost' : 'Draw';
        return `<a class="chess-pill is-${game.result}" href="${Dom.safeUrlAttr(game.url)}" target="_blank" rel="noopener noreferrer"
                   title="${esc(`${result} · ${Chess.formatControl(game.timeControl)} · ${dayLabel(game.end)}`)}">${esc(Chess.CLASS_LABEL[game.timeClass] || game.timeClass)}</a>`;
    }

    /**
     * Keep only the pills that fit the box, with a "…" standing in for the
     * rest — the popup does not scroll, so what does not fit is cut, and the
     * "…" says so rather than a scrollbar.
     */
    function fitPills(list) {
        if (!list || list.scrollHeight <= list.clientHeight) return;
        const pills = Array.from(list.children);
        const limit = list.clientHeight;
        const fits = (element) => element.offsetTop + element.offsetHeight <= limit;

        let keep = pills.findIndex((pill) => !fits(pill));
        pills.slice(keep).forEach((pill) => pill.remove());

        const more = document.createElement('span');
        more.className = 'chess-pill is-more';
        more.textContent = '…';
        list.appendChild(more);
        while (!fits(more) && list.children.length > 1) {
            more.previousElementSibling.remove();
            keep--;
        }
        more.title = `${pills.length - keep} more`;
    }

    function emptyMarkup({ site, title, message, action, actionId }) {
        return `
            <div class="empty-state chess-empty">
                <div class="empty-icon chess-empty-icon">${SiteIcons ? SiteIcons.svg(site, { size: 40 }) : Icons.svg('horse')}</div>
                <h3 class="bb-proper">${title}</h3>
                ${message ? `<p>${message}</p>` : ''}
                ${action ? `<button class="btn-primary chess-empty-action" type="button" data-chess-action="${actionId}">${action}</button>` : ''}
            </div>`;
    }

    /**
     * @param {object} options
     * @param {string} [options.site] a src/shared/chess-sites.js id
     * @param {HTMLElement} options.body where the view draws
     * @param {HTMLElement} [options.rangeSeg] a .range-seg of data-range buttons
     * @param {HTMLElement} [options.refreshButton]
     * @param {boolean} [options.compact] the popup's layout
     * @param {() => void} options.onSetUsername what "Add username" does here
     */
    function createView({ site = 'chess', body, rangeSeg, refreshButton, compact = false, onSetUsername }) {
        const source = ChessSites.get(site);
        let username = '';
        let games = null;
        let error = null;
        let loading = false;
        let range = 'today';
        let loadedFor = '';

        // Dashboard only: a year of games for the heat map and the flagging
        // figures, read after the 30-day view has drawn so it never waits on it.
        let history = null;
        let historyError = null;
        let historyLoading = false;

        function paint() {
            if (!body) return;

            if (!username) {
                body.innerHTML = emptyMarkup({
                    site,
                    title: `No ${esc(source.name)} username is set`,
                    message: compact ? '' : `Add the username whose games to read. It goes in Settings → ${esc(source.name)}.`,
                    action: 'Add username',
                    actionId: 'set-username',
                });
                return;
            }
            if (error && !games) {
                body.innerHTML = emptyMarkup({
                    site,
                    title: esc(error.message),
                    message: error.code === 'not-found' ? `Check the spelling in Settings → ${esc(source.name)}.` : '',
                    action: error.code === 'not-found' ? 'Fix username' : 'Try again',
                    actionId: error.code === 'not-found' ? 'set-username' : 'retry',
                });
                return;
            }
            if (!games) {
                body.innerHTML = `<div class="stats-off chess-loading">Reading games for ${esc(username)}…</div>`;
                return;
            }

            const state = { source, username, games, range, loading, now: Date.now(), history, historyError, historyLoading };
            // Redrawing wholesale would snap a scrolled heat map back to its start.
            const scroller = body.querySelector('.hm-scroll');
            const scrolled = scroller ? scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft : 0;
            body.innerHTML = compact ? compactMarkup(state) : fullMarkup(state);
            if (compact) fitPills(body.querySelector('.chess-pills'));
            const heat = body.querySelector('.hm-scroll');
            if (heat) heat.scrollLeft = heat.scrollWidth - heat.clientWidth - scrolled;
        }

        async function loadHistory() {
            if (compact || !username || historyLoading) return;
            historyLoading = true;
            historyError = null;
            // Both reads write the same cache; one at a time.
            if (refreshButton) refreshButton.disabled = true;
            const wanted = username;
            paint();
            try {
                // Not forced: the load before this one just read the newest games.
                const result = await source.reader().fetchGames(wanted, {
                    days: Chess.HISTORY_DAYS,
                    onProgress: (partial) => {
                        if (wanted !== username) return;
                        history = partial;
                        paint();
                    },
                });
                if (wanted === username) history = result;
            } catch (caught) {
                if (wanted === username) historyError = caught;
            } finally {
                historyLoading = false;
                if (refreshButton && !loading) refreshButton.disabled = false;
                paint();
                // The player changed mid-read; that load was turned away, so run it now.
                if (wanted !== username) load(false);
            }
        }

        async function load(force) {
            if (!username || loading || historyLoading) return;
            loading = true;
            error = null;
            if (refreshButton) refreshButton.disabled = true;
            if (!games || loadedFor !== username) {
                games = null;
                paint();
            }
            const wanted = username;
            try {
                const result = await source.reader().fetchGames(wanted, {
                    force,
                    onProgress: (partial) => {
                        if (wanted !== username) return;
                        games = partial;
                        paint();
                    },
                });
                if (wanted === username) {
                    games = result;
                    loadedFor = wanted;
                }
            } catch (caught) {
                if (wanted === username) {
                    error = caught;
                    games = null;
                }
            } finally {
                loading = false;
                if (refreshButton) refreshButton.disabled = false;
                paint();
            }
            if (wanted !== username) load(false);
            else if (games && !compact) loadHistory();
        }

        function setRange(next) {
            if (!Chess.RANGES[next]) return;
            range = next;
            if (rangeSeg) {
                rangeSeg.querySelectorAll('.range-opt').forEach((option) => {
                    option.setAttribute('aria-pressed', String(option.dataset.range === range));
                });
            }
            paint();
        }

        if (rangeSeg) {
            rangeSeg.addEventListener('click', (event) => {
                const option = event.target.closest('.range-opt');
                if (option) setRange(option.dataset.range);
            });
        }
        if (refreshButton) refreshButton.addEventListener('click', () => load(true));

        if (body) {
            body.addEventListener('click', (event) => {
                const figureButton = event.target.closest('.chess-pop-figure');
                if (figureButton) {
                    setRange(figureButton.dataset.range);
                    return;
                }
                const action = event.target.closest('[data-chess-action]');
                if (!action) return;
                if (action.dataset.chessAction === 'set-username' && onSetUsername) onSetUsername();
                else if (action.dataset.chessAction === 'retry') load(true);
                else if (action.dataset.chessAction === 'history-retry') loadHistory();
            });
        }

        /** Range and refresh mean nothing until there is a player to read. */
        function showControls() {
            if (rangeSeg) rangeSeg.hidden = !username;
            if (refreshButton) refreshButton.hidden = !username;
        }

        const applyUsername = (value) => {
            const next = ChessSites.cleanUsername(value);
            if (next === username) return false;
            username = next;
            games = null;
            error = null;
            history = null;
            historyError = null;
            return true;
        };

        /** Draw, reading games only when the username changed or none are loaded. */
        async function render() {
            const stored = await Settings.get([source.usernameKey]);
            if (!username) applyUsername(stored[source.usernameKey]);
            showControls();
            if (username && !games && !error) load(false);
            else paint();
        }

        Settings.watch([source.usernameKey], (changed) => {
            if (applyUsername(changed[source.usernameKey])) {
                showControls();
                paint();
                load(false);
            }
        });

        return { render, refresh: () => load(true), setRange };
    }

    /**
     * A site's whole Games panel on the dashboard — its header, range and
     * refresh controls, and the view under them — drawn into `panel`.
     */
    function mountPanel(panel, { site, onSetUsername }) {
        panel.innerHTML = `
            <div class="dashboard-header">
                <h2>Games</h2>
                <div class="dashboard-controls">
                    <div class="range-seg" role="group" aria-label="Range">
                        ${Object.entries(Chess.RANGES).map(([id, name], index) => `
                            <button class="range-opt" type="button" data-range="${id}" aria-pressed="${index === 0}">${name}</button>`).join('')}
                    </div>
                    <button class="btn-secondary" type="button" data-chess-refresh>Refresh</button>
                </div>
            </div>
            <div class="chess-stats-body"></div>`;
        return createView({
            site,
            body: panel.querySelector('.chess-stats-body'),
            rangeSeg: panel.querySelector('.range-seg'),
            refreshButton: panel.querySelector('[data-chess-refresh]'),
            onSetUsername,
        });
    }

    BB.ChessStats = { createView, mountPanel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
