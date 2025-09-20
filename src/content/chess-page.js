/**
 * chess.com, from inside the page's own JavaScript world: clears drawn arrows.
 *
 * The board is a <wc-chess-board> drawn to a canvas, so its arrows exist only
 * in the board's own API on the element — `board.game` — which is visible from
 * the page's world, not a content script's isolated one. The manifest loads
 * this file with `"world": "MAIN"` on chess.com only; it has no access to
 * chrome.* and acts on a DOM event from src/content/chess.js.
 *
 * `markings.removeAllWhere({ types: ['arrow'] })` removes the arrows and
 * leaves square highlights alone.
 */
(function () {
    'use strict';

    if (window.__bbChessPage) return;
    window.__bbChessPage = true;

    document.addEventListener('bb:chess', (event) => {
        let message;
        try { message = JSON.parse(event.detail); } catch (_) { return; }
        if (!message || message.type !== 'clear-arrows') return;

        for (const board of document.getElementsByTagName('wc-chess-board')) {
            try { board.game.markings.removeAllWhere({ types: ['arrow'] }); } catch (_) { /* not ready, or an older board build */ }
        }
    });
})();
