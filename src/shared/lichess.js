/**
 * Lichess games, read from the public export API:
 *
 *     https://lichess.org/api/games/user/<username>?since=<ms>&until=<ms>
 *
 * The answer is NDJSON, one game per line, streamed at roughly twenty games a
 * second — a year of bullet is minutes, not a request. So the cache is saved as
 * the stream goes and always covers one unbroken stretch of time, [from,
 * through] by game creation:
 *
 *   - newer games are read oldest first from `through`, which moves forward;
 *   - older games are read newest first down from `from`, which moves back.
 *
 * Either read can stop halfway — the popup closed, the connection dropped —
 * and the next one carries on from the edge it reached. The popup's 30 days
 * come back quickly the first time, and the dashboard's year is filled in
 * behind them.
 *
 * Games come out in the same shape as src/shared/chess.js#normalize, so every
 * summary in that file reads both sites.
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
    /** Bumped when a cached game's shape changes; an older cache is read again. */
    const CACHE_VERSION = 2;

    class LichessApiError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }

    const cleanUsername = Chess.cleanUsername;

    /**
     * Seconds each side spent, from the clock left after every ply
     * (centiseconds, white first), or nulls without clocks.
     */
    function timeUsed(clock, clocks) {
        const out = { white: null, black: null };
        if (!clock || !Array.isArray(clocks) || !clocks.length) return out;
        for (const [side, offset] of [['white', 0], ['black', 1]]) {
            const mine = clocks.filter((_, index) => index % 2 === offset);
            if (!mine.length) continue;
            const used = clock.initial + clock.increment * mine.length - mine[mine.length - 1] / 100;
            out[side] = Math.max(0, Math.round(used * 10) / 10);
        }
        return out;
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
        const used = timeUsed(game.clock, game.clocks);
        const plies = game.moves ? String(game.moves).split(' ').filter(Boolean).length : 0;

        return {
            site: 'lichess',
            url: game.id ? `https://lichess.org/${game.id}` : '',
            start,
            end,
            timeClass: game.speed || game.perf || 'unknown',
            timeControl: game.clock ? `${game.clock.initial}+${game.clock.increment}` : '',
            rated: !!game.rated,
            color,
            result,
            // 'outoftime' is Lichess's flag; its 'timeout' is an opponent who
            // left the game, which is not a flag and must not count as one.
            how: game.status === 'outoftime' ? 'timeout' : `lichess-${game.status || 'unknown'}`,
            rating: game.players[color].rating || null,
            opponent: opponent.name || '',
            opponentRating: game.players[other].rating || null,
            myTime: used[color],
            oppTime: used[other],
            moves: Math.ceil(plies / 2),
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
     * Every game `username` finished in the last `days` days, newest first.
     * `onProgress(games)` is called while a long read streams.
     * Throws LichessApiError('no-user' | 'not-found' | 'rate-limited' | 'network').
     */
    async function fetchGames(username, { now = Date.now(), days = 30, force = false, fetchImpl, onProgress } = {}) {
        const user = cleanUsername(username);
        if (!user) throw new LichessApiError('no-user', 'No Lichess username set');
        const doFetch = fetchImpl || ((url, init) => fetch(url, init));

        const keepFrom = now - Math.max(days, Chess.HISTORY_DAYS) * Chess.DAY_MS;
        const wantFrom = now - days * Chess.DAY_MS;
        const cached = await readCache();
        const reused = !!cached && cached.user === user && cached.version === CACHE_VERSION;
        const state = reused
            ? { ...cached, games: (cached.games || []).filter((game) => game.start >= keepFrom) }
            : { version: CACHE_VERSION, user, from: now + 1, through: 0, fetchedAt: 0, games: [] };
        state.from = Math.max(state.from, keepFrom);

        const wanted = () => state.games
            .filter((game) => game.end >= wantFrom)
            .sort((a, b) => b.end - a.end);
        const save = () => Settings.set({ [Settings.DATA.lichessCache]: state });

        const recent = state.fetchedAt && now - state.fetchedAt < LIVE_TTL_MS;
        if (!force && recent && state.from <= wantFrom) return wanted();

        const known = new Set(state.games.map((game) => game.url));
        const edges = `${state.from}/${state.through}/${state.games.length}`;

        /** One export request; `onGame` moves the edge of the stretch it reads. */
        async function read(query, onGame) {
            const url = `${API}/${encodeURIComponent(user)}?${query}&perfType=${PERFS}` +
                '&moves=true&clocks=true&tags=false&evals=false&opening=false&finished=true';
            let response;
            try {
                response = await doFetch(url, { headers: { Accept: 'application/x-ndjson' } });
            } catch (_) {
                throw new LichessApiError('network', 'Could not reach Lichess');
            }
            if (response.status === 404) throw new LichessApiError('not-found', `No Lichess player called "${user}"`);
            if (response.status === 429) throw new LichessApiError('rate-limited', 'Lichess asked to slow down — try again in a minute');
            if (!response.ok) throw new LichessApiError('network', `Lichess answered ${response.status}`);

            let sinceSave = 0;
            try {
                await eachGame(response, async (raw) => {
                    const created = Number(raw.createdAt);
                    if (created) onGame(created);
                    const game = normalize(raw, user);
                    if (game && !known.has(game.url)) {
                        known.add(game.url);
                        state.games.push(game);
                    }
                    if (++sinceSave >= SAVE_EVERY) {
                        sinceSave = 0;
                        await save();
                        if (onProgress) onProgress(wanted());
                    }
                });
            } catch (_) {
                // Whatever arrived is kept; the next read resumes after it.
                await save();
                throw new LichessApiError('network', 'The Lichess download was interrupted');
            }
        }

        // Newer games first, oldest to newest: a stop halfway leaves no gap.
        if (state.through && (force || !recent)) {
            await read(`since=${state.through + 1}&sort=dateAsc`, (created) => {
                state.through = Math.max(state.through, created);
            });
        }

        // Then back in time, newest to oldest, as far as this read wants.
        if (state.from > wantFrom) {
            const until = Math.min(state.from - 1, now);
            await read(`since=${wantFrom}&until=${until}&sort=dateDesc`, (created) => {
                state.from = Math.min(state.from, created);
                state.through = Math.max(state.through, created);
            });
            state.from = wantFrom;
            // A first read that found nothing still covered up to `until`.
            if (!state.through) state.through = until;
        }

        state.fetchedAt = now;
        // The worker's alarm resumes the read every three minutes while a
        // limit is on, and nearly every time nothing has been played since.
        // Saving then wrote the whole year back — and out to every open tab —
        // to record fetchedAt, which only spares the next read one small,
        // empty request. So the year is written when it has changed.
        if (!reused || `${state.from}/${state.through}/${state.games.length}` !== edges) await save();
        return wanted();
    }

    const Lichess = { LichessApiError, cleanUsername, timeUsed, normalize, parseNdjson, fetchGames };

    root.BB = root.BB || {};
    root.BB.Lichess = Lichess;
    if (typeof module !== 'undefined' && module.exports) module.exports = Lichess;
})(typeof globalThis !== 'undefined' ? globalThis : this);
