/**
 * chess.com, from the content script's side: the clear-arrows shortcut and the
 * opponent clock warning.
 *
 * The board itself is only reachable from the page's world, which is
 * src/content/chess-page.js. This half owns what that one cannot touch — the
 * user's shortcut settings and the typing guard — and passes the request
 * across as a `bb:chess` DOM event whose detail is JSON (an object detail does
 * not survive the trip between worlds in every browser).
 *
 * The clocks are plain text in the page, so the warning needs no bridge: it
 * reads both clocks twice a second while one is running, and only while a
 * warning is turned on for some time control.
 */
(function (root) {
    'use strict';

    const EVENT = 'bb:chess';

    const POLL_MS = 500;
    /** However the gap wobbles around the line, one warning per this long at most. */
    const REPEAT_MS = 15000;

    const WARN_KEYS = {
        bullet: ['chessWarnBullet', 'chessWarnBulletSeconds'],
        blitz: ['chessWarnBlitz', 'chessWarnBlitzSeconds'],
        rapid: ['chessWarnRapid', 'chessWarnRapidSeconds'],
    };

    // ------------------------------------------------------------ pure parts

    /** "1:05" / "0:09.8" / "1:02:03" → seconds, or null. */
    function parseClock(text) {
        const match = /(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?/.exec(String(text || ''));
        if (!match) return null;
        const [, a, b, c, fraction] = match;
        const whole = c != null ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
        return whole + (fraction ? Number(`0.${fraction}`) : 0);
    }

    /**
     * The time control, from what the clocks started at. chess.com calls under
     * 3 minutes bullet and under 10 blitz; the increment is not on the page, so
     * the starting time alone decides — 2|1 is still bullet, 3|2 still blitz.
     */
    function classify(startSeconds) {
        if (!(startSeconds > 0)) return null;
        if (startSeconds < 180) return 'bullet';
        if (startSeconds < 600) return 'blitz';
        return 'rapid';
    }

    /** The threshold in seconds for `timeClass`, or null when its warning is off. */
    function thresholdFor(settings, timeClass) {
        const keys = WARN_KEYS[timeClass];
        if (!keys || !settings || settings[keys[0]] !== true) return null;
        const seconds = Number(settings[keys[1]]);
        return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    }

    function anyWarningOn(settings) {
        return Object.keys(WARN_KEYS).some((name) => thresholdFor(settings, name) != null);
    }

    function human(seconds) {
        const s = Math.round(seconds);
        return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
    }

    // ---------------------------------------------------------- page reading

    const USERNAME = '.user-username-component, .cc-user-username-component, [data-test-element="user-tagline-username"]';

    function clockSeconds(element) {
        if (!element) return null;
        const text = element.querySelector('.clock-time-monospace, [role="timer"]') || element;
        return parseClock(text.textContent);
    }

    /**
     * Both clocks, as { mine, theirs } in seconds, or null off a game. Yours is
     * the one beside your username when it can be found — a flipped board puts
     * it on top — and otherwise the bottom one, where chess.com seats you.
     */
    function readClocks(doc, username) {
        const top = doc.querySelector('.clock-component.clock-top, .clock-top');
        const bottom = doc.querySelector('.clock-component.clock-bottom, .clock-bottom');
        const topSeconds = clockSeconds(top);
        const bottomSeconds = clockSeconds(bottom);
        if (topSeconds == null || bottomSeconds == null) return null;

        let mineOnTop = false;
        const me = String(username || '').trim().replace(/^@/, '').toLowerCase();
        const topPlayer = doc.getElementById('board-layout-player-top');
        if (me && topPlayer) {
            mineOnTop = Array.from(topPlayer.querySelectorAll(USERNAME))
                .some((node) => node.textContent.trim().toLowerCase() === me);
        }
        return mineOnTop
            ? { mine: topSeconds, theirs: bottomSeconds }
            : { mine: bottomSeconds, theirs: topSeconds };
    }

    // ----------------------------------------------------------------- wiring

    function createChess({ Keybindings, Shortcuts, notify, getShortcut, getSettings }) {
        function onKeyDown(event) {
            const shortcut = getShortcut('chess-clear-arrows');
            if (!shortcut || !shortcut.enabled || event.repeat) return;
            if (!Keybindings.matches(event, shortcut.combo, shortcut.kind)) return;
            if (Shortcuts.isTypingTarget(event)) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            document.dispatchEvent(new CustomEvent(EVENT, { detail: JSON.stringify({ type: 'clear-arrows' }) }));
            notify('Arrows cleared', 'info');
        }

        // One game's worth of clock state; forgotten when the clocks go away
        // or the page moves on to another game.
        let game = null;
        let timer = null;

        function poll() {
            const settings = getSettings();
            const clocks = readClocks(document, settings.chessUsername);
            if (!clocks || !game || game.url !== location.href) {
                game = clocks ? { url: location.href, start: Math.max(clocks.mine, clocks.theirs), last: clocks, armed: true, warnedAt: 0 } : null;
                return;
            }

            // Both clocks back up to the same full time is a new game on the
            // same page (a rematch): start over from its starting time.
            if (clocks.mine === clocks.theirs && clocks.mine > game.last.mine && clocks.theirs > game.last.theirs) {
                game = { url: location.href, start: clocks.mine, last: clocks, armed: true, warnedAt: 0 };
                return;
            }

            // A clock that has not moved since the last look is a game that is
            // over (or not yet begun): nothing to warn about.
            const ticking = clocks.mine !== game.last.mine || clocks.theirs !== game.last.theirs;
            game.last = clocks;
            if (!ticking) return;

            const threshold = thresholdFor(settings, classify(game.start));
            if (threshold == null) return;

            const lead = clocks.theirs - clocks.mine;
            if (lead <= threshold) {
                game.armed = true;
                return;
            }
            const now = Date.now();
            if (!game.armed || now - game.warnedAt < REPEAT_MS) return;
            game.armed = false;
            game.warnedAt = now;
            notify(`Opponent is ${human(lead)} ahead on the clock`, 'warning');
        }

        /** Poll only while some warning is on; called again whenever settings change. */
        function syncClockWarning() {
            const on = anyWarningOn(getSettings());
            if (on && !timer) {
                timer = setInterval(poll, POLL_MS);
            } else if (!on && timer) {
                clearInterval(timer);
                timer = null;
                game = null;
            }
        }

        function install() {
            document.addEventListener('keydown', onKeyDown, true);
            syncClockWarning();
        }

        return { install, syncClockWarning };
    }

    const Chess = { createChess, EVENT, parseClock, classify, thresholdFor, anyWarningOn, readClocks };

    root.BB = root.BB || {};
    root.BB.ChessContent = Chess;
    if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
})(typeof globalThis !== 'undefined' ? globalThis : this);
