/**
 * chess.com game statistics, read from the public API:
 *
 *     https://api.chess.com/pub/player/<username>/games/<YYYY>/<MM>
 *
 * One archive per calendar month (UTC), each game carrying its time class,
 * both players' result codes and a PGN whose moves are annotated with the
 * clock left after each one — `{[%clk 0:02:59.9]}`. The time each side spent
 * is inferred from those annotations: what a side started with, plus every
 * increment it was paid, minus what was left after its last move.
 *
 * Everything above the "network" line is pure and covered by
 * tests/node-check.js; the dashboard and the popup only render its output.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    const API = 'https://api.chess.com/pub/player';
    const CLASSES = Object.freeze(['bullet', 'blitz', 'rapid']);
    const CLASS_LABEL = Object.freeze({ bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily' });
    const RANGES = Object.freeze({ today: 'Today', week: 'Last 7 days', month: 'Last 30 days' });

    const DRAW_CODES = new Set([
        'agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient',
    ]);

    const DAY_MS = 24 * 60 * 60 * 1000;

    // ------------------------------------------------------------- parsing

    /** "180+2" → { base: 180, increment: 2 }; "1/86400" is a daily game. */
    function parseTimeControl(value) {
        const text = String(value || '');
        const daily = /^1\/(\d+)$/.exec(text);
        if (daily) return { base: Number(daily[1]), increment: 0, daily: true };
        const live = /^(\d+)(?:\+(\d+))?$/.exec(text);
        if (!live) return null;
        return { base: Number(live[1]), increment: Number(live[2] || 0), daily: false };
    }

    const CLOCK = /(\d+)(\.{1,3})\s*[^\s{]+\s*\{[^}]*\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\][^}]*\}/g;

    /** Seconds left after each move, per side, in move order. */
    function parseClocks(pgn) {
        const out = { white: [], black: [] };
        if (!pgn) return out;
        CLOCK.lastIndex = 0;
        let match;
        while ((match = CLOCK.exec(pgn))) {
            const seconds = Number(match[3]) * 3600 + Number(match[4]) * 60 + Number(match[5]);
            (match[2] === '.' ? out.white : out.black).push(seconds);
        }
        return out;
    }

    function parseHeaders(pgn) {
        const headers = {};
        const re = /^\[(\w+)\s+"([^"]*)"\]/gm;
        let match;
        while ((match = re.exec(pgn || ''))) headers[match[1]] = match[2];
        return headers;
    }

    function utcMs(date, time) {
        const d = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date || '');
        const t = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(time || '');
        if (!d || !t) return null;
        return Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]);
    }

    /** Wall-clock length of the game from its PGN headers, in seconds, or null. */
    function durationOf(headers) {
        const start = utcMs(headers.UTCDate || headers.Date, headers.StartTime || headers.UTCTime);
        const end = utcMs(headers.EndDate, headers.EndTime);
        if (start == null || end == null || end < start) return null;
        return Math.round((end - start) / 1000);
    }

    /** Seconds each side spent on its own clock, or null where the PGN has no clocks. */
    function timeUsed(game) {
        const control = parseTimeControl(game && game.time_control);
        const clocks = parseClocks(game && game.pgn);
        const side = (list) => {
            if (!control || control.daily || list.length === 0) return null;
            const used = control.base + control.increment * list.length - list[list.length - 1];
            return Math.max(0, Math.round(used * 10) / 10);
        };
        return { white: side(clocks.white), black: side(clocks.black), moves: Math.max(clocks.white.length, clocks.black.length) };
    }

    function resultOf(code) {
        if (code === 'win') return 'win';
        if (DRAW_CODES.has(code)) return 'draw';
        return 'loss';
    }

    /**
     * One game from `username`'s side of the board, small enough to cache —
     * the PGN is read here and dropped. Null when they did not play in it.
     */
    function normalize(game, username) {
        if (!game || !game.white || !game.black) return null;
        const me = String(username || '').toLowerCase();
        const color = String(game.white.username || '').toLowerCase() === me ? 'white'
            : String(game.black.username || '').toLowerCase() === me ? 'black' : null;
        if (!color) return null;

        const other = color === 'white' ? 'black' : 'white';
        const used = timeUsed(game);
        const headers = parseHeaders(game.pgn);

        return {
            url: game.url || '',
            end: Number(game.end_time) * 1000,
            timeClass: game.time_class || 'unknown',
            timeControl: game.time_control || '',
            rated: !!game.rated,
            color,
            result: resultOf(game[color].result),
            how: game[color].result === 'win' ? game[other].result : game[color].result,
            rating: game[color].rating || null,
            opponent: game[other].username || '',
            opponentRating: game[other].rating || null,
            myTime: used[color],
            oppTime: used[other],
            moves: used.moves,
            duration: durationOf(headers),
        };
    }

    // ------------------------------------------------------------ summaries

    /** When a range starts: local midnight for today, rolling windows otherwise. */
    function rangeStart(range, now = Date.now()) {
        if (range === 'week') return now - 7 * DAY_MS;
        if (range === 'month') return now - 30 * DAY_MS;
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        return midnight.getTime();
    }

    function emptyClass() {
        return { games: 0, win: 0, loss: 0, draw: 0, myTime: 0, oppTime: 0, timed: 0 };
    }

    /** Win rate over decided games, 0-100, or null with nothing decided. */
    function winRate(row) {
        const decided = row.win + row.loss;
        return decided ? Math.round((row.win / decided) * 100) : null;
    }

    /** Wins per loss, or null when there are no losses to divide by. */
    function winLossRatio(row) {
        return row.loss ? Math.round((row.win / row.loss) * 100) / 100 : null;
    }

    function summarize(games, { since = 0, until = Infinity } = {}) {
        const inRange = (games || [])
            .filter((game) => game.end >= since && game.end <= until)
            .sort((a, b) => b.end - a.end);

        const byClass = {};
        CLASSES.forEach((name) => { byClass[name] = emptyClass(); });
        const total = emptyClass();

        for (const game of inRange) {
            const rows = byClass[game.timeClass] ? [byClass[game.timeClass], total] : [total];
            for (const row of rows) {
                row.games++;
                row[game.result]++;
                if (game.myTime != null && game.oppTime != null) {
                    row.timed++;
                    row.myTime += game.myTime;
                    row.oppTime += game.oppTime;
                }
            }
        }

        return { games: inRange, count: inRange.length, byClass, total };
    }

    /** Game counts for every range at once — the three headline figures. */
    function counts(games, now = Date.now()) {
        const out = {};
        for (const range of Object.keys(RANGES)) {
            const since = rangeStart(range, now);
            out[range] = (games || []).filter((game) => game.end >= since && game.end <= now).length;
        }
        return out;
    }

    function human(seconds) {
        const s = Math.max(0, Math.round(Number(seconds) || 0));
        if (s < 60) return `${s}s`;
        if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
        return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
    }

    function formatControl(value) {
        const control = parseTimeControl(value);
        if (!control) return String(value || '');
        if (control.daily) return `${Math.round(control.base / 86400)} day`;
        if (control.base < 60) return control.increment ? `${control.base}s | ${control.increment}` : `${control.base}s`;
        const minutes = Math.round((control.base / 60) * 10) / 10;
        return control.increment ? `${minutes} | ${control.increment}` : `${minutes} min`;
    }

    // -------------------------------------------------------------- network

    /** 'YYYY/MM' for each UTC month touched by [now - days, now], oldest first. */
    function archiveMonths(now = Date.now(), days = 30) {
        const start = new Date(now - days * DAY_MS);
        const end = new Date(now);
        const out = [];
        let y = start.getUTCFullYear();
        let m = start.getUTCMonth();
        while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth())) {
            out.push(`${y}/${String(m + 1).padStart(2, '0')}`);
            m++;
            if (m === 12) { m = 0; y++; }
        }
        return out;
    }

    function cleanUsername(value) {
        return String(value || '').trim().replace(/^@/, '').toLowerCase();
    }

    /** A month whose archive can still grow is re-read after this long. */
    const LIVE_TTL_MS = 3 * 60 * 1000;

    function isClosed(month, fetchedAt) {
        const [y, m] = month.split('/').map(Number);
        // Fetched a day after the month ended: nothing more will be filed in it.
        return fetchedAt >= Date.UTC(y, m, 1) + DAY_MS;
    }

    async function readCache() {
        try {
            const stored = await chrome.storage.local.get([Settings.DATA.chessCache]);
            return stored[Settings.DATA.chessCache] || null;
        } catch (_) {
            return null;
        }
    }

    class ChessApiError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }

    /**
     * Every game `username` finished in the last `days` days, normalized,
     * newest first. Throws ChessApiError('not-found' | 'network').
     */
    async function fetchGames(username, { now = Date.now(), days = 30, force = false, fetchImpl } = {}) {
        const user = cleanUsername(username);
        if (!user) throw new ChessApiError('no-user', 'No chess.com username set');
        const doFetch = fetchImpl || ((url) => fetch(url));

        const cached = await readCache();
        const archives = cached && cached.user === user ? { ...cached.archives } : {};
        const months = archiveMonths(now, days);

        for (const month of months) {
            const entry = archives[month];
            const fresh = entry && !force && (isClosed(month, entry.fetchedAt) || now - entry.fetchedAt < LIVE_TTL_MS);
            if (fresh) continue;

            let response;
            try {
                response = await doFetch(`${API}/${encodeURIComponent(user)}/games/${month}`);
            } catch (_) {
                throw new ChessApiError('network', 'Could not reach chess.com');
            }
            if (response.status === 404) throw new ChessApiError('not-found', `No chess.com player called "${user}"`);
            if (!response.ok) throw new ChessApiError('network', `chess.com answered ${response.status}`);

            const body = await response.json();
            archives[month] = {
                fetchedAt: now,
                games: (body.games || []).map((game) => normalize(game, user)).filter(Boolean),
            };
        }

        // Only the months still in the window are worth their storage.
        const kept = {};
        months.forEach((month) => { if (archives[month]) kept[month] = archives[month]; });
        await Settings.set({ [Settings.DATA.chessCache]: { user, archives: kept } });

        const since = now - days * DAY_MS;
        return months
            .flatMap((month) => kept[month].games)
            .filter((game) => game.end >= since)
            .sort((a, b) => b.end - a.end);
    }

    const Chess = {
        CLASSES, CLASS_LABEL, RANGES, ChessApiError,
        parseTimeControl, parseClocks, parseHeaders, durationOf, timeUsed, resultOf, normalize,
        rangeStart, summarize, counts, winRate, winLossRatio, human, formatControl,
        archiveMonths, cleanUsername, fetchGames,
    };

    root.BB = root.BB || {};
    root.BB.Chess = Chess;
    if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
})(typeof globalThis !== 'undefined' ? globalThis : this);
