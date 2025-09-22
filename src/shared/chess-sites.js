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

    /**
     * Every speed either site reports, folded into the three buckets above.
     * chess.com's 'daily' and Lichess's 'correspondence' are deliberately
     * absent: a game played over days is not one sitting, so it is neither
     * warned about nor counted against a daily limit.
     */
    const BUCKETS = Object.freeze({
        ultrabullet: 'bullet',
        bullet: 'bullet',
        blitz: 'blitz',
        rapid: 'rapid',
        classical: 'rapid',
    });

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
     * A game's bucket from whatever speed name its site gave it —
     * 'ultraBullet' → 'bullet', 'classical' → 'rapid'. Null for the speeds
     * that are not one sitting at the board, and for anything unrecognised.
     */
    function bucket(timeClass) {
        return BUCKETS[String(timeClass || '').toLowerCase()] || null;
    }

    // -------------------------------------------------------- setting keys

    /**
     * Per-time-control setting keys, one builder each, so a new per-control
     * setting is added here rather than spelled out at the call sites:
     *   ('lichess', 'warn', 'blitz')        → 'lichessWarnBlitz'
     *   ('lichess', 'warnSeconds', 'blitz') → 'lichessWarnBlitzSeconds'
     *   ('chess',   'limit', 'bullet')      → 'chessLimitBullet'
     */
    const CLASS_KEYS = Object.freeze({
        warn: (p, c) => `${p}Warn${c}`,
        warnSeconds: (p, c) => `${p}Warn${c}Seconds`,
        speak: (p, c) => `${p}Speak${c}`,
        lowSeconds: (p, c) => `${p}LowTime${c}Seconds`,
        limit: (p, c) => `${p}Limit${c}`,
    });

    /** Whole-site setting keys, the same way. */
    const SITE_KEYS = Object.freeze({
        username: (p) => `${p}Username`,
        speakUntimed: (p) => `${p}SpeakUntimed`,
        lowTime: (p) => `${p}LowTime`,
        lowVolume: (p) => `${p}LowTimeVolume`,
        muteSiteLow: (p) => `${p}MuteSiteLowTime`,
        limitsOn: (p) => `${p}DailyLimits`,
    });

    function settingKey(siteId, kind, timeClass) {
        const site = get(siteId);
        const build = CLASS_KEYS[kind];
        if (!site || !build || !timeClass) return null;
        return build(site.prefix, cap(timeClass));
    }

    function siteKey(siteId, kind) {
        const site = get(siteId);
        const build = SITE_KEYS[kind];
        if (!site || !build) return null;
        return build(site.prefix);
    }

    /** Every setting key both sites own — what a view has to read to draw them. */
    function allKeys() {
        const out = [];
        for (const site of list()) {
            for (const kind of Object.keys(SITE_KEYS)) out.push(SITE_KEYS[kind](site.prefix));
            for (const kind of Object.keys(CLASS_KEYS)) {
                for (const name of CLASSES) out.push(CLASS_KEYS[kind](site.prefix, cap(name)));
            }
        }
        return out;
    }

    // ------------------------------------------------------ classification

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

    /**
     * The starting clock, in seconds, a time-control label names, or null.
     * Both sites' buttons and headers write the same few shapes:
     * "10 min", "3 | 2" (chess.com), "3+2" and "30 sec" (Lichess),
     * "1/2 min" for the half-minute pools.
     */
    function secondsFromLabel(text) {
        const value = String(text || '').replace(/\s+/g, ' ').trim();
        if (!value) return null;

        // "3 | 2" and "3+2" — minutes, then the increment, which is ignored.
        const paired = /(\d+(?:\.\d+)?)\s*(?:\||\+)\s*\d+/.exec(value);
        if (paired) return Math.round(Number(paired[1]) * 60);

        // "1/2 min" — the only fraction either site pairs at.
        const half = /(\d+)\s*\/\s*(\d+)\s*min/i.exec(value);
        if (half && Number(half[2])) return Math.round((Number(half[1]) / Number(half[2])) * 60);

        const minutes = /(\d+(?:\.\d+)?)\s*min/i.exec(value);
        if (minutes) return Math.round(Number(minutes[1]) * 60);

        const seconds = /(\d+)\s*sec/i.exec(value);
        if (seconds) return Number(seconds[1]);

        return null;
    }

    /**
     * The bucket a time-control label belongs to. Falls back to the speed
     * names the sites print beside their pools ("Blitz", "UltraBullet"), so a
     * button saying only "Bullet" is still placed.
     */
    function classFromLabel(siteId, text) {
        const seconds = secondsFromLabel(text);
        if (seconds != null) return classify(siteId, seconds);
        const named = /\b(ultra ?bullet|bullet|blitz|rapid|classical)\b/i.exec(String(text || ''));
        return named ? bucket(named[1].replace(/\s+/g, '')) : null;
    }

    // ------------------------------------------------------ setting readers

    /** The opponent-clock warning threshold in seconds, or null when it is off. */
    function thresholdFor(settings, siteId, timeClass) {
        if (!settings || !CLASSES.includes(timeClass)) return null;
        if (settings[settingKey(siteId, 'warn', timeClass)] !== true) return null;
        const seconds = Number(settings[settingKey(siteId, 'warnSeconds', timeClass)]);
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    }

    /**
     * Where your own clock counts as low, in seconds, or null when the
     * low-time warning is off for this site. Unlike the opponent warning this
     * is one switch for the site, with a threshold per time control.
     */
    function lowTimeFor(settings, siteId, timeClass) {
        if (!settings || !CLASSES.includes(timeClass)) return null;
        if (settings[siteKey(siteId, 'lowTime')] !== true) return null;
        const seconds = Number(settings[settingKey(siteId, 'lowSeconds', timeClass)]);
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    }

    /** 0–2, the gain the low-time tone is played at. */
    function lowVolumeFor(settings, siteId) {
        const percent = Number(settings && settings[siteKey(siteId, 'lowVolume')]);
        if (!Number.isFinite(percent)) return 0.6;
        return Math.min(2, Math.max(0, percent / 100));
    }

    function mutesSiteLowTime(settings, siteId) {
        return !!settings && settings[siteKey(siteId, 'muteSiteLow')] === true;
    }

    /**
     * Whether moves are read aloud. `timeClass` is null in a game with no
     * clock at all — Coach, a bot, an analysis board. No time control
     * describes such a game, so it speaks whenever any speech is on: someone
     * who ticked Blitz and opened Coach expects to hear the moves, and when
     * this waited on a separate "Untimed" box, off by default, they heard
     * nothing. That box still works alone, for speech only in untimed games.
     */
    function speaksFor(settings, siteId, timeClass) {
        if (!settings) return false;
        if (timeClass == null) {
            return settings[siteKey(siteId, 'speakUntimed')] === true ||
                CLASSES.some((name) => speaksFor(settings, siteId, name));
        }
        return CLASSES.includes(timeClass) && settings[settingKey(siteId, 'speak', timeClass)] === true;
    }

    function anyWarningOn(settings, siteId) {
        return CLASSES.some((name) => thresholdFor(settings, siteId, name) != null);
    }

    function anySpeechOn(settings, siteId) {
        return speaksFor(settings, siteId, null) || CLASSES.some((name) => speaksFor(settings, siteId, name));
    }

    function anyLowTimeOn(settings, siteId) {
        return CLASSES.some((name) => lowTimeFor(settings, siteId, name) != null);
    }

    // -------------------------------------------------------- daily limits

    /**
     * How many games of `timeClass` this site allows today, or null for no
     * limit. Zero is a limit of none, so it is kept apart from "not set".
     */
    function limitFor(settings, siteId, timeClass) {
        if (!settings || !CLASSES.includes(timeClass)) return null;
        if (settings[siteKey(siteId, 'limitsOn')] !== true) return null;
        // Zero is a real limit here — "none of these today" — so a missing or
        // emptied field must not reach Number(), which would turn null and ''
        // into a zero and block the control outright.
        const raw = settings[settingKey(siteId, 'limit', timeClass)];
        if (raw === null || raw === undefined || raw === '') return null;
        const games = Number(raw);
        return Number.isFinite(games) && games >= 0 ? Math.floor(games) : null;
    }

    function anyLimitOn(settings, siteId) {
        return CLASSES.some((name) => limitFor(settings, siteId, name) != null);
    }

    const ChessSites = {
        CLASSES, BUCKETS, get, list, cleanUsername, bucket,
        settingKey, siteKey, allKeys,
        classify, secondsFromLabel, classFromLabel,
        thresholdFor, lowTimeFor, lowVolumeFor, mutesSiteLowTime, speaksFor,
        anyWarningOn, anySpeechOn, anyLowTimeOn,
        limitFor, anyLimitOn,
    };

    root.BB = root.BB || {};
    root.BB.ChessSites = ChessSites;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChessSites;
})(typeof globalThis !== 'undefined' ? globalThis : this);
