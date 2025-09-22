/**
 * The chess sites Bell Bearer works with — chess.com and Lichess — as one
 * registry. The dashboard, the popup, the settings page and the content script
 * all read a site's name, its settings keys and its time-control boundaries
 * from here, so the two sites cannot drift apart feature by feature.
 *
 * Pure, and loaded by the content script too, which never fetches games: the
 * game readers (src/shared/chess.js, src/shared/lichess.js) are looked up only
 * when a view asks for games.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);

    const CLASSES = Object.freeze(['bullet', 'blitz', 'rapid']);

    const SITES = Object.freeze({
        chess: Object.freeze({
            id: 'chess',
            name: 'Chess.com',
            host: 'chess.com',
            usernameKey: 'chessUsername',
            prefix: 'chess',
            shortcutScope: 'chess',
            // Starting clock, in seconds, below which a game is bullet / blitz.
            limits: Object.freeze({ bullet: 180, blitz: 600 }),
            reader: () => (root.BB && root.BB.Chess) || req('./chess.js'),
        }),
        lichess: Object.freeze({
            id: 'lichess',
            name: 'Lichess',
            host: 'lichess.org',
            usernameKey: 'lichessUsername',
            prefix: 'lichess',
            shortcutScope: null,
            // Lichess puts blitz under 8 minutes; its classical counts as rapid here.
            limits: Object.freeze({ bullet: 180, blitz: 480 }),
            reader: () => (root.BB && root.BB.Lichess) || req('./lichess.js'),
        }),
    });

    function get(id) {
        return SITES[id] || null;
    }

    function list() {
        return Object.values(SITES);
    }

    function cleanUsername(value) {
        return String(value || '').trim().replace(/^@/, '').toLowerCase();
    }

    const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

    /**
     * A per-site, per-time-control setting key:
     * ('lichess', 'warn', 'blitz') → 'lichessWarnBlitz',
     * 'warnSeconds' → 'lichessWarnBlitzSeconds', 'speak' → 'lichessSpeakBlitz'.
     */
    function settingKey(siteId, kind, timeClass) {
        const site = get(siteId);
        if (!site) return null;
        if (kind === 'warnSeconds') return `${site.prefix}Warn${cap(timeClass)}Seconds`;
        return `${site.prefix}${cap(kind)}${cap(timeClass)}`;
    }

    /**
     * The time control, from what the clocks started at. The increment is not
     * on the page, so the starting time alone decides — 2|1 is still bullet.
     */
    function classify(siteId, startSeconds) {
        const site = get(siteId);
        if (!site || !(startSeconds > 0)) return null;
        if (startSeconds < site.limits.bullet) return 'bullet';
        if (startSeconds < site.limits.blitz) return 'blitz';
        return 'rapid';
    }

    /** The warning threshold in seconds, or null when that warning is off. */
    function thresholdFor(settings, siteId, timeClass) {
        if (!settings || !CLASSES.includes(timeClass)) return null;
        if (settings[settingKey(siteId, 'warn', timeClass)] !== true) return null;
        const seconds = Number(settings[settingKey(siteId, 'warnSeconds', timeClass)]);
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    }

    function speaksFor(settings, siteId, timeClass) {
        return !!settings && CLASSES.includes(timeClass) && settings[settingKey(siteId, 'speak', timeClass)] === true;
    }

    function anyWarningOn(settings, siteId) {
        return CLASSES.some((name) => thresholdFor(settings, siteId, name) != null);
    }

    function anySpeechOn(settings, siteId) {
        return CLASSES.some((name) => speaksFor(settings, siteId, name));
    }

    const ChessSites = {
        CLASSES, get, list, cleanUsername, settingKey, classify,
        thresholdFor, speaksFor, anyWarningOn, anySpeechOn,
    };

    root.BB = root.BB || {};
    root.BB.ChessSites = ChessSites;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChessSites;
})(typeof globalThis !== 'undefined' ? globalThis : this);
