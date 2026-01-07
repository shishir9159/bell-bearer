/**
 * Keeps today's game counts current, so the daily limits have something to
 * measure against.
 *
 * The counts have to come from somewhere the content script cannot reach: a
 * page on chess.com may not read Lichess's API, and neither site's page can be
 * trusted to still be open when a game finishes elsewhere. So the worker does
 * the reading — it has the host permissions and it outlives every tab — and
 * writes what it found through src/shared/chess-limits.js. Everything else in
 * the extension only reads that.
 *
 * The readers cache for three minutes of their own accord, and that is exactly
 * the cadence wanted here, so the alarm runs at their period and never forces:
 * forcing would re-download a whole month of chess.com's archive every three
 * minutes for as long as the browser is open. A content script that has just
 * loaded on a chess page asks for a read directly, throttled so that opening
 * ten tabs is still one request.
 */
(function (root) {
    'use strict';

    const { Settings, ChessSites, ChessLimits, Router } = root.BB;

    const ALARM = 'bb-chess-limits';
    const PERIOD_MINUTES = 3;
    /** A tab asking for a read is answered from this recent a one instead. */
    const ON_DEMAND_TTL_MS = 60 * 1000;

    let running = null;

    /** The sites whose limits are on and which have a username to read. */
    async function activeSites() {
        const settings = await Settings.get();
        return ChessSites.list().filter((site) => (
            ChessSites.anyLimitOn(settings, site.id) &&
            ChessSites.cleanUsername(settings[site.usernameKey])
        )).map((site) => ({ site, username: settings[site.usernameKey] }));
    }

    /**
     * Read today's games for every limited site and store the counts. A site
     * whose read fails keeps the counts it had: a flaky network must not read
     * as "no games played", which would quietly lift the limit.
     */
    async function refresh({ force = false, now = Date.now() } = {}) {
        const wanted = await activeSites();
        if (!wanted.length) return null;

        for (const { site, username } of wanted) {
            try {
                // Two days, not one: "today" is local and the readers window
                // in UTC, so a single day can miss this morning's games.
                const games = await site.reader().fetchGames(username, { days: 2, force });
                const counts = ChessLimits.countToday(games, now);
                await ChessLimits.update((state) => ChessLimits.withCounts(state, site.id, counts, now), now);
            } catch (error) {
                console.warn(`Bell Bearer: could not read today's ${site.name} games`, error && error.message);
            }
        }
        return true;
    }

    /** One read at a time; callers arriving mid-read wait for that one. */
    function refreshOnce(options) {
        if (!running) {
            running = refresh(options).finally(() => { running = null; });
        }
        return running;
    }

    async function refreshIfStale(now = Date.now()) {
        const state = await ChessLimits.load(now);
        const freshest = Object.values(state.sites || {})
            .reduce((newest, site) => Math.max(newest, (site && site.checkedAt) || 0), 0);
        if (now - freshest < ON_DEMAND_TTL_MS) return false;
        await refreshOnce({ now });
        return true;
    }

    /** The alarm only exists while some site is actually limited. */
    async function syncAlarm() {
        const wanted = (await activeSites()).length > 0;
        const existing = await chrome.alarms.get(ALARM);
        if (wanted && !existing) {
            chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES, delayInMinutes: 0 });
        } else if (!wanted && existing) {
            chrome.alarms.clear(ALARM);
        }
    }

    Router.alarm(ALARM, () => { refreshOnce(); });

    // A limit turned on, or the player renamed: re-read rather than leave the
    // old counts standing against the new rule.
    Settings.watch(ChessSites.allKeys(), () => {
        syncAlarm().then(() => refreshOnce());
    });

    Router.on('chessLimitsRefresh', () => refreshIfStale()
        .then((read) => ({ ok: true, read }))
        .catch(() => ({ ok: false })));

    Router.started(() => { syncAlarm(); });
    syncAlarm();

    root.BB.ChessLimitsWorker = { refresh, refreshOnce, refreshIfStale, syncAlarm, ALARM };
})(typeof globalThis !== 'undefined' ? globalThis : this);
