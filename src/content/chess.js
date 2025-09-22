/**
 * chess.com and Lichess, from the content script's side: the clear-arrows
 * shortcut (chess.com), the opponent clock warning, and moves read aloud.
 *
 * The chess.com board itself is only reachable from the page's world, which is
 * src/content/chess-page.js. This half owns what that one cannot touch — the
 * user's shortcut settings and the typing guard — and passes the request
 * across as a `bb:chess` DOM event whose detail is JSON (an object detail does
 * not survive the trip between worlds in every browser).
 *
 * The clocks and the move list are plain text in both sites' pages, so the
 * warning and the speech need no bridge: one poll reads them twice a second,
 * and only while a warning or speech is turned on for this site. What each
 * setting is called and where a time control starts come from
 * src/shared/chess-sites.js.
 *
 * Speech goes through chrome.tts in the background worker — a content script
 * cannot call it — with the page's own speechSynthesis where there is no
 * chrome.tts (Firefox).
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ChessSites = (root.BB && root.BB.ChessSites) || req('../shared/chess-sites.js');

    const EVENT = 'bb:chess';

    const POLL_MS = 500;
    /** However the gap wobbles around the line, one warning per this long at most. */
    const REPEAT_MS = 15000;
    /** More new moves than this at once is a move list being drawn, not played. */
    const MAX_SPOKEN_AT_ONCE = 2;

    // ------------------------------------------------------------ pure parts

    /** "1:05" / "0:09.8" / "1:02:03" → seconds, or null. */
    function parseClock(text) {
        const match = /(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?/.exec(String(text || ''));
        if (!match) return null;
        const [, a, b, c, fraction] = match;
        const whole = c != null ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
        return whole + (fraction ? Number(`0.${fraction}`) : 0);
    }

    function human(seconds) {
        const s = Math.round(seconds);
        return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
    }

    const PIECES = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight' };
    const FIGURINES = { '♔': 'K', '♚': 'K', '♕': 'Q', '♛': 'Q', '♖': 'R', '♜': 'R', '♗': 'B', '♝': 'B', '♘': 'N', '♞': 'N', '♙': '', '♟': '' };

    /**
     * A move in algebraic notation as words a voice reads cleanly:
     * "Nxe5+" → "Knight takes E 5, check". Squares are spelled apart, since
     * "a4" read as a word comes out as "uh four".
     */
    function spokenMove(san) {
        let text = String(san || '').replace(/[♔-♟]/g, (glyph) => FIGURINES[glyph]).replace(/[!?]+$/, '').trim();
        const suffix = /#$/.test(text) ? ', checkmate' : /\+$/.test(text) ? ', check' : '';
        text = text.replace(/[+#]+$/, '');

        if (/^(O-O-O|0-0-0)$/.test(text)) return `Castles queenside${suffix}`;
        if (/^(O-O|0-0)$/.test(text)) return `Castles kingside${suffix}`;

        const match = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h])([1-8])(?:=?([QRBN]))?$/.exec(text);
        if (!match) return text ? `${text}${suffix}` : '';
        const [, piece, file, rank, takes, toFile, toRank, promotion] = match;
        const words = [];
        if (piece) words.push(PIECES[piece]);
        if (file || rank) words.push([file && file.toUpperCase(), rank].filter(Boolean).join(' '));
        if (takes) words.push('takes');
        words.push(`${toFile.toUpperCase()} ${toRank}`);
        if (promotion) words.push(`promotes to ${PIECES[promotion]}`);
        return words.join(' ') + suffix;
    }

    // ---------------------------------------------------------- page reading

    /**
     * Where each site keeps its clocks and moves. On chess.com a flipped
     * board can seat you on top, so yours is found by username; Lichess
     * always seats the player at the bottom.
     */
    const PAGES = {
        chess: {
            top: '.clock-component.clock-top, .clock-top',
            bottom: '.clock-component.clock-bottom, .clock-bottom',
            time: '.clock-time-monospace, [role="timer"]',
            moves: ['.main-line-ply', 'wc-simple-move-list .node', '.move-list .node'],
            username: '.user-username-component, .cc-user-username-component, [data-test-element="user-tagline-username"]',
        },
        lichess: {
            top: '.rclock-top',
            bottom: '.rclock-bottom',
            time: '.time',
            // kwdb in current Lichess, u8t in older builds.
            moves: ['l4x kwdb', 'l4x u8t'],
        },
    };

    function clockSeconds(element, timeSelector) {
        if (!element) return null;
        const text = element.querySelector(timeSelector) || element;
        return parseClock(text.textContent);
    }

    /** Both clocks, as { mine, theirs } in seconds, or null off a game. */
    function readClocks(doc, site, username) {
        const page = PAGES[site];
        if (!page) return null;
        const topSeconds = clockSeconds(doc.querySelector(page.top), page.time);
        const bottomSeconds = clockSeconds(doc.querySelector(page.bottom), page.time);
        if (topSeconds == null || bottomSeconds == null) return null;

        let mineOnTop = false;
        const me = ChessSites.cleanUsername(username);
        const topPlayer = page.username && doc.getElementById('board-layout-player-top');
        if (me && topPlayer) {
            mineOnTop = Array.from(topPlayer.querySelectorAll(page.username))
                .some((node) => node.textContent.trim().toLowerCase() === me);
        }
        return mineOnTop
            ? { mine: topSeconds, theirs: bottomSeconds }
            : { mine: bottomSeconds, theirs: topSeconds };
    }

    /**
     * A move node's notation. chess.com draws the piece as an icon carrying
     * `data-figurine` beside the text, so the letter is put back from that.
     */
    function moveText(node) {
        let out = '';
        node.childNodes.forEach((child) => {
            if (child.nodeType === 3) out += child.textContent;
            else if (child.nodeType === 1) out += child.getAttribute('data-figurine') || moveText(child);
        });
        return out.trim().split(/\s+/)[0] || '';
    }

    /** The move nodes, from the first of the site's move-list layouts present. */
    function readMoves(doc, site) {
        const page = PAGES[site];
        for (const selector of page ? page.moves : []) {
            const nodes = doc.querySelectorAll(selector);
            if (nodes.length) return Array.from(nodes);
        }
        return [];
    }

    // ----------------------------------------------------------------- speech

    function speakInPage(text) {
        if (typeof speechSynthesis === 'undefined') return;
        speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }

    function speak(text) {
        if (!text) return;
        try {
            chrome.runtime.sendMessage({ action: 'speak', text }, (response) => {
                if (chrome.runtime.lastError || !response || !response.ok) speakInPage(text);
            });
        } catch (_) {
            speakInPage(text);
        }
    }

    // ----------------------------------------------------------------- wiring

    function createChess({ site, Keybindings, Shortcuts, notify, getShortcut, getSettings }) {
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

        // One game's worth of state; forgotten when the clocks go away or the
        // page moves on to another game.
        let game = null;
        let timer = null;

        const newGame = (clocks, start) => ({
            url: location.href,
            start,
            last: clocks,
            armed: true,
            warnedAt: 0,
            // The moves already on the page are not news: only what is played
            // from here on is spoken.
            moves: readMoves(document, site).length,
        });

        function speakNewMoves(settings) {
            const nodes = readMoves(document, site);
            if (nodes.length < game.moves) {
                // A takeback, or the list was redrawn: start counting again.
                game.moves = nodes.length;
                return;
            }
            const fresh = nodes.slice(game.moves);
            game.moves = nodes.length;
            if (!fresh.length || fresh.length > MAX_SPOKEN_AT_ONCE) return;
            if (!ChessSites.speaksFor(settings, site, ChessSites.classify(site, game.start))) return;
            fresh.forEach((node) => speak(spokenMove(moveText(node))));
        }

        function warnAboutClock(settings, clocks) {
            const threshold = ChessSites.thresholdFor(settings, site, ChessSites.classify(site, game.start));
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

        function poll() {
            const settings = getSettings();
            const clocks = readClocks(document, site, settings[ChessSites.get(site).usernameKey]);
            if (!clocks || !game || game.url !== location.href) {
                game = clocks ? newGame(clocks, Math.max(clocks.mine, clocks.theirs)) : null;
                return;
            }

            // Both clocks back up to the same full time is a new game on the
            // same page (a rematch): start over from its starting time.
            if (clocks.mine === clocks.theirs && clocks.mine > game.last.mine && clocks.theirs > game.last.theirs) {
                game = newGame(clocks, clocks.mine);
                return;
            }

            // Before the clock check: the mating move stops both clocks.
            speakNewMoves(settings);

            // A clock that has not moved since the last look is a game that is
            // over (or not yet begun): nothing to warn about.
            const ticking = clocks.mine !== game.last.mine || clocks.theirs !== game.last.theirs;
            game.last = clocks;
            if (ticking) warnAboutClock(settings, clocks);
        }

        /** Poll only while a warning or speech is on; called again whenever settings change. */
        function sync() {
            const settings = getSettings();
            const on = ChessSites.anyWarningOn(settings, site) || ChessSites.anySpeechOn(settings, site);
            if (on && !timer) {
                timer = setInterval(poll, POLL_MS);
            } else if (!on && timer) {
                clearInterval(timer);
                timer = null;
                game = null;
            }
        }

        function install() {
            if (site === 'chess') document.addEventListener('keydown', onKeyDown, true);
            sync();
        }

        return { install, sync };
    }

    const ChessContent = { createChess, EVENT, parseClock, spokenMove, moveText, readClocks, readMoves };

    root.BB = root.BB || {};
    root.BB.ChessContent = ChessContent;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChessContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
