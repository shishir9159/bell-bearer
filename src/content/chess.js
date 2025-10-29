/**
 * chess.com and Lichess, from the content script's side: the clear-arrows
 * shortcut (chess.com), the opponent clock warning, the low-clock tone, and
 * moves read aloud.
 *
 * The chess.com board itself is only reachable from the page's world, which is
 * src/content/chess-page.js. This half owns what that one cannot touch — the
 * user's shortcut settings and the typing guard — and passes the request
 * across as a `bb:chess` DOM event whose detail is JSON (an object detail does
 * not survive the trip between worlds in every browser).
 *
 * The clocks and the move list are plain text in both sites' pages, so the
 * warning and the speech need no bridge: one poll reads them twice a second,
 * and only while something that needs it is turned on for this site. What each
 * setting is called and where a time control starts come from
 * src/shared/chess-sites.js.
 *
 * Three things here used to be wrong and are worth naming, because the shape of
 * the file follows from them:
 *
 *   - Everything hung off the clocks. A game with no clock — Coach, a bot, an
 *     analysis board — produced no state at all, so moves were never spoken on
 *     any of them. Moves are now read whether or not the page has a clock, and
 *     an untimed game speaks whenever any speech setting is on.
 *   - The move list was counted, not read. Any selector that happened to match
 *     rows rather than plies, or a list the site redrew, put the count out and
 *     took the speech with it. What is read now is the notation itself, and a
 *     selector whose matches do not look like chess moves is passed over for
 *     the next one — so the site can rename its classes without silencing this.
 *   - The move list was the only place moves were looked for. chess.com's
 *     focus mode hides the sidebar it lives in, so that mode was silent too.
 *     The board object knows the moves regardless; it is asked when the DOM
 *     has nothing, over the same bridge as the arrows.
 *
 * Speech goes through chrome.tts in the background worker — a content script
 * cannot call it — with the page's own speechSynthesis where there is no
 * chrome.tts (Firefox).
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ChessSites = (root.BB && root.BB.ChessSites) || req('../shared/chess-sites.js');
    const Sfx = (root.BB && root.BB.Sfx) || req('../shared/sfx.js');

    const EVENT = 'bb:chess';

    const POLL_MS = 500;
    /** However the gap wobbles around the line, one warning per this long at most. */
    const REPEAT_MS = 15000;
    /** The low-clock tone, likewise, so a clock at the line does not stutter. */
    const LOW_REPEAT_MS = 8000;
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
     * Algebraic notation, and nothing else. This is the test a move-list
     * selector has to pass before its matches are believed: a list of row
     * containers or move numbers does not look like this, and is passed over.
     */
    const SAN = /^(?:O-O-O|O-O|0-0-0|0-0|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBN])?)[+#]?[!?]{0,2}$/;

    function isMoveText(text) {
        return SAN.test(String(text || '').trim());
    }

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

    /**
     * The moves played since `before`, given the list as it reads now.
     *
     * A move list is not append-only: it is redrawn on a takeback, truncated
     * while a long game scrolls, and replaced wholesale when a new game starts
     * on the same page. Only a list that still begins with the one already
     * seen has genuinely grown; anything else is a resync, and speaking it
     * would read the whole game out at once.
     */
    function newMoves(before, after) {
        if (after.length < before.length) return null;
        for (let i = 0; i < before.length; i++) {
            if (after[i] !== before[i]) return null;
        }
        return after.slice(before.length);
    }

    // ---------------------------------------------------------- page reading

    /**
     * Where each site keeps its clocks, its moves and the name of the time
     * control being played. On chess.com a flipped board can seat you on top,
     * so yours is found by username; Lichess always seats the player at the
     * bottom.
     *
     * Several spellings are listed per slot on purpose. Both sites rename
     * their classes freely, and the older spellings cost nothing to keep: the
     * first selector that matches wins, and for the move list, the first whose
     * matches actually read as chess moves.
     */
    const PAGES = {
        chess: {
            top: '.clock-component.clock-top, .clock-top, [class*="clock-top"]',
            bottom: '.clock-component.clock-bottom, .clock-bottom, [class*="clock-bottom"]',
            time: '.clock-time-monospace, [class*="clock-time"], [role="timer"]',
            moves: [
                'wc-simple-move-list .node',
                'wc-vertical-move-list .node',
                '.main-line-ply',
                '.move-list .node',
                '[class*="move-list"] .node',
                '.node-highlight-content',
            ],
            username: '.user-username-component, .cc-user-username-component, [data-test-element="user-tagline-username"]',
            control: [
                '.game-info-time-control',
                '[data-cy="time-control"]',
                '.live-game-buttons-time-control',
                '.game-over-header-component',
            ],
        },
        lichess: {
            top: '.rclock-top',
            bottom: '.rclock-bottom',
            time: '.time',
            // kwdb in current Lichess, u8t in older builds.
            moves: ['l4x kwdb', 'l4x u8t', 'rm6 kwdb', '.moves kwdb'],
            control: ['.game__meta .setup', '.game__meta__infos .setup', '.mchat__tabs .setup'],
        },
    };

    function clockSeconds(element, timeSelector) {
        if (!element) return null;
        const text = element.querySelector(timeSelector) || element;
        return parseClock(text.textContent);
    }

    /** Both clocks, as { mine, theirs } in seconds, or null when the page has none. */
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
     *
     * The spaces inside a move are closed up rather than split on. chess.com
     * writes a piece move as the icon and then a space before the square —
     * `<span data-figurine="Q"></span> g4` — so splitting on whitespace and
     * taking the first token, which is what this used to do, reduced every
     * piece move on the site to its bare letter: "Qg4" came out as "Q". Any
     * text this glues together that is not a move is thrown out by the
     * notation test in readMoves, so closing the gaps is the safe direction.
     */
    function moveText(node) {
        let out = '';
        node.childNodes.forEach((child) => {
            if (child.nodeType === 3) out += child.textContent;
            else if (child.nodeType === 1) out += child.getAttribute('data-figurine') || moveText(child);
        });
        return out.replace(/\s+/g, '').replace(/^\d+\.+/, '');
    }

    /**
     * The moves on the board, in notation, from the first of the site's
     * layouts that yields something that reads like a game.
     *
     * "Reads like a game" is the whole trick: a selector matching row
     * containers or move numbers yields text that is not algebraic notation,
     * and is skipped rather than counted. A little leniency is allowed for the
     * odd annotation glyph in the list, hence most rather than all.
     */
    function readMoves(doc, site) {
        const page = PAGES[site];
        for (const selector of page ? page.moves : []) {
            const nodes = Array.from(doc.querySelectorAll(selector));
            if (!nodes.length) continue;
            const texts = nodes.map(moveText).filter(Boolean);
            const moves = texts.filter(isMoveText);
            if (moves.length && moves.length >= texts.length * 0.8) return moves;
        }
        return [];
    }

    /**
     * The moves the board itself knows, asked of src/content/chess-page.js.
     *
     * chess.com's focus mode takes the sidebar away, and the move list with
     * it, so there is nothing in the DOM left to read and moves went unspoken
     * for anyone who plays that way. The board still has them; it just lives
     * in the page's own world, so the question goes over a DOM event.
     *
     * The dispatch is synchronous and the page world answers during it, so the
     * reply is already in hand when dispatchEvent returns. Whatever comes back
     * is filtered to things that actually read as notation before use.
     */
    let boardReply = null;

    function onBoardMoves(event) {
        try { boardReply = JSON.parse(event.detail); } catch (_) { boardReply = null; }
    }

    function readBoardMoves() {
        boardReply = null;
        try {
            document.dispatchEvent(new CustomEvent(EVENT, { detail: JSON.stringify({ type: 'moves' }) }));
        } catch (_) {
            return [];
        }
        return Array.isArray(boardReply) ? boardReply.filter(isMoveText) : [];
    }

    /**
     * The moves on the board, from the sidebar if it is there and from the
     * board object if it is not. The DOM comes first on purpose: it needs no
     * bridge and does not care what chess.com calls its internals this month.
     */
    function currentMoves(site) {
        const listed = readMoves(document, site);
        if (listed.length || site !== 'chess') return listed;
        return readBoardMoves();
    }

    /**
     * The time control the page says it is, as a bucket, or null when it does
     * not say. Preferred over the clocks: a page opened part-way through a
     * game shows clocks that have already run down, and a 10-minute game with
     * twenty seconds left is not bullet.
     */
    function readControl(doc, site) {
        const page = PAGES[site];
        for (const selector of (page && page.control) || []) {
            const node = doc.querySelector(selector);
            const found = node && ChessSites.classFromLabel(site, node.textContent);
            if (found) return found;
        }
        return null;
    }

    // ----------------------------------------------------------------- sound

    /**
     * The low-clock tone.
     *
     * Chess.com plays its own sound here and gives no way to change how loud
     * it is, so this is a tone of our own that the volume setting actually
     * reaches — two short beeps through the page's Web Audio, which needs no
     * file and so no web-accessible resource. Above 100% it really is louder:
     * gain is not capped at 1 the way an <audio> element's volume is.
     *
     * Both of those rules now live in src/shared/sfx.js, which started as a
     * copy of what was here and is shared with TypeRacer. The tone itself is
     * unchanged: the `low` voice is the same two notes, the same 880 and
     * 1180, the same 180ms apart.
     *
     * The context is still only ever opened from a gesture — Chrome refuses
     * Web Audio a page did not start in answer to a click or a key, and this
     * tone is played from the poll timer, which is never one.
     */
    function beep(volume) {
        // lowVolumeFor is a fraction of full, clamped to [0, 2]; Sfx speaks in
        // percent. The multiply is the whole difference, and keeping the clamp
        // here means the settings' own bound is still the one that applies.
        Sfx.play('low', { volume: volume * 100 });
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

        // One game's worth of state; forgotten when the page moves on to
        // another game. `start` is the clock both sides began with, which is
        // only knowable while the board is still empty — so it is taken then
        // and, once moves are on it, left alone.
        let game = null;
        let timer = null;

        const newGame = (clocks) => ({
            url: location.href,
            start: clocks ? Math.max(clocks.mine, clocks.theirs) : null,
            last: clocks,
            armed: true,
            warnedAt: 0,
            lowArmed: true,
            lowAt: 0,
            // The moves already on the page are not news: only what is played
            // from here on is spoken.
            moves: currentMoves(site),
        });

        /**
         * Which of the three controls this game is, or null when nothing on
         * the page says — an untimed game, which has a setting of its own.
         */
        function timeClass() {
            return readControl(document, site) || ChessSites.classify(site, game.start);
        }

        function speakNewMoves(settings, moves) {
            const fresh = newMoves(game.moves, moves);
            game.moves = moves;
            if (!fresh || !fresh.length || fresh.length > MAX_SPOKEN_AT_ONCE) return;
            if (!ChessSites.speaksFor(settings, site, timeClass())) return;
            fresh.forEach((san) => speak(spokenMove(san)));
        }

        function warnAboutClock(settings, clocks) {
            const threshold = ChessSites.thresholdFor(settings, site, timeClass());
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

        function warnAboutLowClock(settings, clocks) {
            const threshold = ChessSites.lowTimeFor(settings, site, timeClass());
            if (threshold == null) return;

            if (clocks.mine > threshold) {
                game.lowArmed = true;
                return;
            }
            const now = Date.now();
            if (!game.lowArmed || now - game.lowAt < LOW_REPEAT_MS) return;
            game.lowArmed = false;
            game.lowAt = now;
            beep(ChessSites.lowVolumeFor(settings, site));
        }

        /**
         * A new game on the same page — a rematch, or the next pairing from
         * the lobby. Both clocks reading the same and higher than last time is
         * one; so is a move list that no longer starts the way it did, which
         * is what catches a new game at a different time control.
         */
        function isNewGame(clocks, moves) {
            if (clocks && game.last &&
                clocks.mine === clocks.theirs &&
                clocks.mine > game.last.mine && clocks.theirs > game.last.theirs) return true;
            return moves.length < game.moves.length && moves.length <= 1;
        }

        function poll() {
            const settings = getSettings();
            const clocks = readClocks(document, site, settings[ChessSites.get(site).usernameKey]);
            const moves = currentMoves(site);

            if (!game || game.url !== location.href || isNewGame(clocks, moves)) {
                game = newGame(clocks);
                return;
            }

            // The starting clock is only honest while the board is still
            // empty; after that the clocks have run and say nothing about
            // which control this is.
            if (clocks && game.moves.length <= 1) {
                game.start = Math.max(game.start || 0, clocks.mine, clocks.theirs);
            }

            // Before the clock checks: the mating move stops both clocks, and
            // it should still be read out.
            speakNewMoves(settings, moves);

            if (!clocks) return;

            // A clock that has not moved since the last look is a game that is
            // over (or not yet begun): nothing to warn about.
            const ticking = !game.last || clocks.mine !== game.last.mine || clocks.theirs !== game.last.theirs;
            game.last = clocks;
            if (!ticking) return;
            warnAboutClock(settings, clocks);
            warnAboutLowClock(settings, clocks);
        }

        /** Poll only while something that needs it is on; called again whenever settings change. */
        function sync() {
            const settings = getSettings();
            const on = ChessSites.anyWarningOn(settings, site) ||
                ChessSites.anySpeechOn(settings, site) ||
                ChessSites.anyLowTimeOn(settings, site);
            if (on && !timer) {
                timer = setInterval(poll, POLL_MS);
            } else if (!on && timer) {
                clearInterval(timer);
                timer = null;
                game = null;
            }
        }

        /** Unlock the tone on a gesture — but only for someone who wants the tone. */
        function onGesture() {
            if (ChessSites.anyLowTimeOn(getSettings(), site)) Sfx.unlock();
        }

        function install() {
            if (site === 'chess') {
                document.addEventListener('keydown', onKeyDown, true);
                document.addEventListener('bb:chess:moves', onBoardMoves);
            }
            document.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
            document.addEventListener('keydown', onGesture, { capture: true, passive: true });
            sync();

            // What the poller can see, for the page console. Both sites move
            // their class names about, and this is how you find out which
            // selector stopped matching without reading this file.
            root.__bellBearerChess = {
                site,
                get clocks() { return readClocks(document, site, getSettings()[ChessSites.get(site).usernameKey]); },
                get moves() { return currentMoves(site); },
                get domMoves() { return readMoves(document, site); },
                get boardMoves() { return site === 'chess' ? readBoardMoves() : []; },
                get control() { return readControl(document, site); },
                get timeClass() { return game ? timeClass() : null; },
                get game() { return game; },
                get polling() { return !!timer; },
            };
        }

        /**
         * The control being played right now, for anything that has to know
         * what a bare "Rematch" would start. Read from the page even when the
         * poller is off, so a user who wants only the daily limits still gets
         * their rematch button matched to the right control.
         */
        function currentClass() {
            return readControl(document, site) ||
                (game ? ChessSites.classify(site, game.start) : null) ||
                ChessSites.classify(site, startingSeconds(document, site, getSettings()));
        }

        return { install, sync, currentClass };
    }

    /** The larger clock on the page, as a starting time — a last resort. */
    function startingSeconds(doc, site, settings) {
        const clocks = readClocks(doc, site, settings[ChessSites.get(site).usernameKey]);
        return clocks ? Math.max(clocks.mine, clocks.theirs) : null;
    }

    const ChessContent = {
        createChess, EVENT, PAGES, currentMoves,
        parseClock, spokenMove, moveText, isMoveText, newMoves,
        readClocks, readMoves, readControl,
    };

    root.BB = root.BB || {};
    root.BB.ChessContent = ChessContent;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChessContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
