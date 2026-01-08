/**
 * Talking to the page's own JavaScript world, from a content script.
 *
 * chess.com's board, LeetCode's editor, Claude's completion stream and
 * Netflix's player all live in the page's world, which a content script's
 * isolated world cannot see. Each has a `*-page.js` loaded with
 * `"world": "MAIN"` to do the work, and the two sides talk over DOM events on
 * the document they share. Two things hold for every one of them:
 *
 *  - The detail is a JSON string. An object made in one world arrives in the
 *    other as null.
 *  - DOM dispatch is synchronous and runs the other world's listener inline,
 *    so an answer sent back during it is in hand by the time our own
 *    dispatchEvent returns — no polling, no promise, nothing left on the page.
 *
 * The page-world scripts keep their own few lines rather than load this: in
 * that world `BB` would be a name on the page's own global, which the page
 * may well use for something of its own.
 */
(function (root) {
    'use strict';

    /** What an event carries, or null when its detail is not JSON. */
    function read(event) {
        try { return JSON.parse(event.detail); } catch (_) { return null; }
    }

    /** Send a message across. False when the dispatch threw: the page is going away. */
    function tell(name, message) {
        try {
            document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(message) }));
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Ask, and have the answer: what came back on `reply` during the
     * dispatch, or null when nothing did — the page script is not in this
     * page, or has not loaded yet.
     */
    function ask(name, message, reply) {
        let answer = null;
        const take = (event) => { answer = read(event); };
        document.addEventListener(reply, take);
        try {
            tell(name, message);
        } finally {
            document.removeEventListener(reply, take);
        }
        return answer;
    }

    /** Hear every message on `name`, null for one that is not JSON. Returns the unlisten. */
    function listen(name, handler) {
        const onEvent = (event) => handler(read(event));
        document.addEventListener(name, onEvent);
        return () => document.removeEventListener(name, onEvent);
    }

    const Bridge = { read, tell, ask, listen };

    root.BB = root.BB || {};
    root.BB.Bridge = Bridge;
    if (typeof module !== 'undefined' && module.exports) module.exports = Bridge;
})(typeof globalThis !== 'undefined' ? globalThis : this);
