/**
 * chess.com, from inside the page's own JavaScript world.
 *
 * Two things live here, and both for the same reason: the board is a
 * <wc-chess-board> that keeps its state in JavaScript on the element —
 * `board.game` — which a content script's isolated world cannot see. The
 * manifest loads this file with `"world": "MAIN"` on chess.com only; it has no
 * access to chrome.* and works entirely off DOM events from
 * src/content/chess.js.
 *
 *   clear-arrows  `markings.removeAllWhere({ types: ['arrow'] })` drops the
 *                 drawn arrows and leaves square highlights alone.
 *
 *   moves         The moves played, in algebraic notation. The content script
 *                 normally reads these out of the move list in the sidebar,
 *                 which is cheaper and survives chess.com renaming its
 *                 internals — but focus mode takes the whole sidebar away, and
 *                 with it every move node, so moves were never spoken with
 *                 focus mode on. The board still knows them.
 *
 * The answer goes back as a `bb:chess:moves` event. DOM dispatch is
 * synchronous and both worlds listen on the same document, so the content
 * script has its answer by the time its own dispatchEvent returns — no
 * polling, no shared global, nothing left on the page.
 *
 * Which call gives the move list has changed more than once, so several are
 * tried and the first that yields notation wins. The content script checks
 * that what comes back parses as moves before speaking any of it.
 */
(function () {
    'use strict';

    if (window.__bbChessPage) return;
    window.__bbChessPage = true;

    const REQUEST = 'bb:chess';
    const MOVES = 'bb:chess:moves';

    function boards() {
        return document.getElementsByTagName('wc-chess-board');
    }

    /** A move node, whatever shape this build of the board hands back. */
    function sanOf(node) {
        if (typeof node === 'string') return node;
        if (!node || typeof node !== 'object') return null;
        for (const key of ['san', 'move', 'notation', 'lan']) {
            if (typeof node[key] === 'string' && node[key]) return node[key];
        }
        return null;
    }

    function sansFrom(game) {
        if (!game) return null;
        const ways = [
            () => game.getNodes(),
            () => game.getHistory(),
            () => game.getLine(),
            () => game.getMoveList(),
            () => game.moveList,
            () => game.plugins && game.plugins.moveList,
        ];
        for (const way of ways) {
            let list;
            try { list = way(); } catch (_) { continue; }
            if (!Array.isArray(list) || !list.length) continue;
            const sans = list.map(sanOf).filter(Boolean);
            if (sans.length) return sans;
        }
        return null;
    }

    function answerWithMoves() {
        let sans = null;
        for (const board of boards()) {
            try { sans = sansFrom(board.game); } catch (_) { sans = null; }
            if (sans) break;
        }
        document.dispatchEvent(new CustomEvent(MOVES, { detail: JSON.stringify(sans || []) }));
    }

    function clearArrows() {
        for (const board of boards()) {
            try { board.game.markings.removeAllWhere({ types: ['arrow'] }); } catch (_) { /* not ready, or an older board build */ }
        }
    }

    document.addEventListener(REQUEST, (event) => {
        let message;
        try { message = JSON.parse(event.detail); } catch (_) { return; }
        if (!message) return;
        if (message.type === 'clear-arrows') clearArrows();
        else if (message.type === 'moves') answerWithMoves();
    });
})();
