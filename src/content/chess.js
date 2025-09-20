/**
 * chess.com, from the content script's side: settings in, one shortcut out.
 *
 * The board itself is only reachable from the page's world, which is
 * src/content/chess-page.js. This half owns what that one cannot touch —
 * chrome.storage and the keyboard guard — and passes the result across as a
 * `bb:chess` DOM event whose detail is JSON (an object detail does not survive
 * the trip between worlds in every browser).
 */
(function (root) {
    'use strict';

    const EVENT = 'bb:chess';
    const HINT_ALPHA = 0.62;

    function createChess({ Palette, Shortcuts, notify, getSettings }) {
        function send(message) {
            document.dispatchEvent(new CustomEvent(EVENT, { detail: JSON.stringify(message) }));
        }

        function pushSettings() {
            const { chessLegalMoveColor } = getSettings();
            send({
                type: 'settings',
                hintColor: Palette.isHex(chessLegalMoveColor) ? Palette.rgba(chessLegalMoveColor, HINT_ALPHA) : '',
            });
        }

        function onKeyDown(event) {
            if (!getSettings().chessClearArrowsShortcut) return;
            if (event.code !== 'KeyC' || event.repeat) return;
            if (!Shortcuts.modifiers(event, { alt: true })) return;
            if (Shortcuts.isTypingTarget(event)) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            send({ type: 'clear-arrows' });
            notify('Arrows cleared', 'info');
        }

        function install() {
            // Whichever of the two scripts loads second, the page side ends up
            // with the settings: it announces itself, and this answers.
            document.addEventListener(`${EVENT}:ready`, pushSettings);
            document.addEventListener('keydown', onKeyDown, true);
            pushSettings();
        }

        return { install, pushSettings };
    }

    const Chess = { createChess, EVENT };

    root.BB = root.BB || {};
    root.BB.ChessContent = Chess;
    if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
})(typeof globalThis !== 'undefined' ? globalThis : this);
