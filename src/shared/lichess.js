/**
 * Lichess games, read from the public export API:
 *
 *     https://lichess.org/api/games/user/<username>?since=<ms>&sort=dateAsc
 *
 * The answer is NDJSON, one game per line, streamed at roughly twenty games a
 * second — a year of bullet is minutes, not a request. So the read is oldest
 * first and the cache is saved as it goes: the next read resumes after the
 * newest game already kept (`through`), whether the last one finished or the
 * dashboard was closed halfway.
 *
 * Games come out in the same shape as src/shared/chess.js#normalize, as far
 * as Lichess has the fields, so Chess.flagStats and Chess.dailyTime read both.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Chess = ns.Chess || req('./chess.js');

    const API = 'https://lichess.org/api/games/user';
    const PERFS = 'ultraBullet,bullet,blitz,rapid,classical';
    const LIVE_TTL_MS = 3 * 60 * 1000;
    const SAVE_EVERY = 250;

    class LichessApiError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }

    function cleanUsername(value) {
        return String(value || '').trim().replace(/^@/, '').toLowerCase();
    }

    /** One exported game from `username`'s side, or null when they did not play in it. */
    function normalize(game, username) {
        if (!game || !game.players) return null;
        const me = cleanUsername(username);
        const idOf = (side) => {
            const user = game.players[side] && game.players[side].user;
            return user ? String(user.id || user.name || '').toLowerCase() : '';
        };
        const color = idOf('white') === me ? 'white' : idOf('black') === me ? 'black' : null;
        if (!color) return null;

        const other = color === 'white' ? 'black' : 'white';
        const result = !game.winner ? 'draw' : game.winner === color ? 'win' : 'loss';
        const start = Number(game.createdAt) || null;
        const end = Number(game.lastMoveAt) || start;
        const opponent = game.players[other].user || {};

        return {
            site: 'lichess',
            url: game.id ? `https://lichess.org/${game.id}` : '',
            start,
            end,
            timeClass: game.speed || game.perf || 'unknown',
            rated: !!game.rated,
            color,
            result,
            // 'outoftime' is Lichess's flag; its 'timeout' is an opponent who
            // left the game, which is not a flag and must not count as one.
            how: game.status === 'outoftime' ? 'timeout' : `lichess-${game.status || 'unknown'}`,
            opponent: opponent.name || '',
            opponentRating: game.players[other].rating || null,
            duration: start && end && end >= start ? Math.round((end - start) / 1000) : null,
        };
    }

    /** Split NDJSON into objects, skipping blank and broken lines. */
    function parseNdjson(text) {
        const out = [];
        for (const line of String(text || '').split('\n')) {
            if (!line.trim()) continue;
            try { out.push(JSON.parse(line)); } catch (_) { /* a partial line */ }
        }
        return out;
    }

    async function readCache() {
        try {
            const stored = await chrome.storage.local.get([Settings.DATA.lichessCache]);
            return stored[Settings.DATA.lichessCache] || null;
        } catch (_) {
            return null;
        }
    }

    /** Each game object in the response as it arrives, streamed when the body allows. */
    async function eachGame(response, onGame) {
        const body = response.body;
        if (!body || typeof body.getReader !== 'function') {
            for (const game of parseNdjson(await response.text())) await onGame(game);
            return;
        }
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
            const { done, value } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = done ? '' : lines.pop();
            for (const game of parseNdjson(lines.join('\n'))) await onGame(game);
            if (done) return;
        }
    }

    /**
     * Every game `username` finished in the last Chess.HISTORY_DAYS days,
     * newest first. `onProgress(games)` is called while a long read streams.
     * Throws LichessApiError('no-user' | 'not-found' | 'rate-limited' | 'network').
     */
    async function fetchGames(username, { now = Date.now(), force = false, fetchImpl, onProgress } = {}) {
        const user = cleanUsername(username);
        if (!user) throw new LichessApiError('no-user', 'No Lichess username set');
        const doFetch = fetchImpl || ((url, init) => fetch(url, init));

        const horizon = now - Chess.HISTORY_DAYS * Chess.DAY_MS;
        const cached = await readCache();
        const state = cached && cached.user === user
            ? { user, through: cached.through || 0, fetchedAt: cached.fetchedAt || 0, games: cached.games || [] }
            : { user, through: 0, fetchedAt: 0, games: [] };
        state.games = state.games.filter((game) => game.end >= horizon);

        const newestFirst = () => state.games.slice().sort((a, b) => b.end - a.end);
        const save = () => Settings.set({ [Settings.DATA.lichessCache]: state });

        if (!force && state.fetchedAt && now - state.fetchedAt < LIVE_TTL_MS) return newestFirst();

        const since = Math.max(horizon, state.through + 1);
        const url = `${API}/${encodeURIComponent(user)}?since=${since}&perfType=${PERFS}` +
            '&sort=dateAsc&moves=false&tags=false&clocks=false&evals=false&opening=false&finished=true';

        let response;
        try {
            response = await doFetch(url, { headers: { Accept: 'application/x-ndjson' } });
        } catch (_) {
            throw new LichessApiError('network', 'Could not reach Lichess');
        }
        if (response.status === 404) throw new LichessApiError('not-found', `No Lichess player called "${user}"`);
        if (response.status === 429) throw new LichessApiError('rate-limited', 'Lichess asked to slow down — try again in a minute');
        if (!response.ok) throw new LichessApiError('network', `Lichess answered ${response.status}`);

        const known = new Set(state.games.map((game) => game.url));
        let sinceSave = 0;
        try {
            await eachGame(response, async (raw) => {
                if (raw.createdAt) state.through = Math.max(state.through, Number(raw.createdAt));
                const game = normalize(raw, user);
                if (game && !known.has(game.url)) {
                    known.add(game.url);
                    state.games.push(game);
                }
                if (++sinceSave >= SAVE_EVERY) {
                    sinceSave = 0;
                    await save();
                    if (onProgress) onProgress(newestFirst());
                }
            });
        } catch (_) {
            // Whatever arrived is kept; the next read resumes after it.
            await save();
            throw new LichessApiError('network', 'The Lichess download was interrupted');
        }

        state.fetchedAt = now;
        await save();
        return newestFirst();
    }

    const Lichess = { LichessApiError, cleanUsername, normalize, parseNdjson, fetchGames };

    root.BB = root.BB || {};
    root.BB.Lichess = Lichess;
    if (typeof module !== 'undefined' && module.exports) module.exports = Lichess;
})(typeof globalThis !== 'undefined' ? globalThis : this);
