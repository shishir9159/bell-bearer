/**
 * chess.com, from the content script's side: the clear-arrows shortcut.
 *
 * The board itself is only reachable from the page's world, which is
 * src/content/chess-page.js. This half owns what that one cannot touch — the
 * user's shortcut settings and the typing guard — and passes the request
 * across as a `bb:chess` DOM event whose detail is JSON (an object detail does
 * not survive the trip between worlds in every browser).
 */
(function (root) {
    'use strict';

    const EVENT = 'bb:chess';

    function createChess({ Keybindings, Shortcuts, notify, getShortcut }) {
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

        function install() {
            document.addEventListener('keydown', onKeyDown, true);
        }

        return { install };
    }

    const Chess = { createChess, EVENT };

    root.BB = root.BB || {};
    root.BB.ChessContent = Chess;
    if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
})(typeof globalThis !== 'undefined' ? globalThis : this);
