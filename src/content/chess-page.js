/**
 * chess.com, from inside the page's own JavaScript world.
 *
 * The board is a <wc-chess-board> drawn to a canvas, so neither its arrows nor
 * its legal-move dots exist as DOM a stylesheet could reach. What does exist
 * is the board's own API on the element — `board.game` — and that is only
 * visible from the page's world, not a content script's isolated one. The
 * manifest loads this file with `"world": "MAIN"` on chess.com only; it has
 * no access to chrome.* and takes its orders from src/content/chess.js through
 * a DOM event carrying JSON.
 *
 *  - clear-arrows: `game.markings.removeAllWhere({ types: ['arrow'] })`, which
 *    removes drawn arrows and leaves square highlights alone.
 *  - legal-move color: the renderer's addMoveHints / addCaptureHints are
 *    wrapped. With a color set, the hints are drawn as a layer of dots over the
 *    canvas instead; removeHints takes them away again. With none set, the
 *    originals run untouched.
 */
(function () {
    'use strict';

    if (window.__bbChessPage) return;
    window.__bbChessPage = true;

    const EVENT = 'bb:chess';
    const FILES = 'abcdefgh';

    let hintColor = '';

    function boards() {
        return Array.from(document.getElementsByTagName('wc-chess-board')).filter((board) => board.game);
    }

    function clearArrows() {
        for (const board of boards()) {
            try { board.game.markings.removeAllWhere({ types: ['arrow'] }); } catch (_) { /* older board build */ }
        }
    }

    /** Square centre in the board element's CSS pixels. */
    function centre(board, square) {
        const file = FILES.indexOf(square[0]);
        const rank = Number(square[1]) - 1;
        const size = board.clientWidth / 8;
        let flipped = false;
        try { flipped = !!board.game.getOptions().flipped; } catch (_) { /* default orientation */ }
        const col = flipped ? 7 - file : file;
        const row = flipped ? rank : 7 - rank;
        return { x: (col + 0.5) * size, y: (row + 0.5) * size, size };
    }

    function layerFor(board) {
        if (board.__bbHintLayer && board.__bbHintLayer.isConnected) return board.__bbHintLayer;
        const layer = document.createElement('div');
        layer.className = 'bb-chess-hints';
        layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;';
        board.appendChild(layer);
        board.__bbHintLayer = layer;
        board.__bbHintDots = new Map();
        return layer;
    }

    function drawHints(board, squares, capture) {
        const layer = layerFor(board);
        for (const square of squares || []) {
            if (typeof square !== 'string' || square.length !== 2) continue;
            const existing = board.__bbHintDots.get(square);
            if (existing) existing.remove();

            const { x, y, size } = centre(board, square);
            const dot = document.createElement('div');
            const diameter = capture ? size * 0.92 : size * 0.32;
            dot.style.cssText = [
                'position:absolute', 'border-radius:50%', 'box-sizing:border-box',
                `left:${x - diameter / 2}px`, `top:${y - diameter / 2}px`,
                `width:${diameter}px`, `height:${diameter}px`,
                capture ? `border:${size * 0.09}px solid ${hintColor}` : `background:${hintColor}`,
            ].join(';');
            layer.appendChild(dot);
            board.__bbHintDots.set(square, dot);
        }
    }

    function removeDots(board, squares) {
        if (!board.__bbHintDots) return;
        const list = squares && squares.length ? squares : [];
        for (const square of list) {
            const dot = board.__bbHintDots.get(square);
            if (dot) dot.remove();
            board.__bbHintDots.delete(square);
        }
    }

    function clearDots(board) {
        if (!board.__bbHintDots) return;
        board.__bbHintDots.forEach((dot) => dot.remove());
        board.__bbHintDots.clear();
    }

    function patch(board) {
        let renderer;
        try { renderer = board.game.getRenderer(); } catch (_) { return; }
        if (!renderer || renderer.__bbPatched) return;
        renderer.__bbPatched = true;

        const { addMoveHints, addCaptureHints, removeHints } = renderer;

        // The squares chess.com's renderer drew itself. Its removeHints looks
        // each square up in what it drew and throws on one it did not — which
        // is every square drawn here instead — so it is only ever handed its own.
        const native = new Set();

        const wrapAdd = (original, capture) => function (squares, ...rest) {
            if (!hintColor) {
                (squares || []).forEach((square) => native.add(square));
                return original.call(this, squares, ...rest);
            }
            drawHints(board, squares, capture);
            return undefined;
        };

        if (typeof addMoveHints === 'function') renderer.addMoveHints = wrapAdd(addMoveHints, false);
        if (typeof addCaptureHints === 'function') renderer.addCaptureHints = wrapAdd(addCaptureHints, true);
        if (typeof removeHints === 'function') {
            renderer.removeHints = function (squares, ...rest) {
                const list = Array.isArray(squares) ? squares : [];
                removeDots(board, list);
                if (list.length === 0) return removeHints.call(this, squares, ...rest);

                const theirs = list.filter((square) => native.has(square));
                if (theirs.length === 0) return undefined;
                theirs.forEach((square) => native.delete(square));
                return removeHints.call(this, theirs, ...rest);
            };
        }

        // Belt and braces: a move or a jump through the move list always ends
        // a selection, whichever path the board takes to say so.
        try {
            ['Move', 'MoveBackward', 'MoveForward', 'Load', 'CreateGame'].forEach((type) => {
                board.game.on(type, () => clearDots(board));
            });
        } catch (_) { /* no event API on this build */ }
    }

    let queued = false;
    function patchAll() {
        queued = false;
        boards().forEach(patch);
    }

    function queuePatch() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(patchAll);
    }

    document.addEventListener(EVENT, (event) => {
        let message;
        try { message = JSON.parse(event.detail); } catch (_) { return; }
        if (!message) return;

        if (message.type === 'clear-arrows') {
            clearArrows();
        } else if (message.type === 'settings') {
            hintColor = typeof message.hintColor === 'string' ? message.hintColor : '';
            if (!hintColor) boards().forEach(clearDots);
            patchAll();
        }
    });

    // chess.com swaps boards (and a board its renderer) without reloading.
    // Patching is at most once a frame, and a no-op on a renderer already
    // done, so watching the whole document stays cheap.
    new MutationObserver(queuePatch).observe(document.documentElement, { childList: true, subtree: true });

    queuePatch();
    document.dispatchEvent(new CustomEvent(EVENT + ':ready'));
})();
