/**
 * The watch party's chat, the rules every end of it shares: what a line may
 * say and how often a member may say one.
 *
 * The authority (party-room.js, and the Zig/Go server that follows the same
 * README) applies them to everything it is sent, and the page applies them
 * again before it sends, so a line the room would drop is kept in the box
 * instead of vanishing.
 */
(function (root) {
    'use strict';

    /** Longest line, in code points: counted in UTF-16 units, a cut could land inside an emoji. */
    const MAX_CHARS = 500;
    /** Lines the authority keeps, and replays after a welcome to whoever missed them. */
    const HISTORY = 50;

    /**
     * A member may send BURST lines in any WINDOW_MS. It is not the intents'
     * five a second: a line has no reject to come back with, and chat that
     * spent the intents' budget would have the next pause refused and
     * snapped back, which is the one thing a party must never do.
     */
    const BURST = 5;
    const WINDOW_MS = 5000;

    /**
     * Control characters that are not whitespace, and the byte-order mark,
     * which is: none of them is anything a person typed, and a raw NUL or an
     * escape sequence in a line is something a server should not have to
     * carry on to everyone.
     */
    const HIDDEN = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f﻿]/g;

    /** A line as the room carries it: one line of plain text, or '' for nothing to say. */
    function clean(text, max = MAX_CHARS) {
        if (typeof text !== 'string') return '';
        const flat = text.replace(HIDDEN, '').replace(/\s+/g, ' ').trim();
        const points = Array.from(flat);
        return points.length > max ? points.slice(0, max).join('').trim() : flat;
    }

    /** Whether one more line now keeps within the budget, given when the last ones went. Returns the times to keep. */
    function allow(sent, now) {
        const recent = sent.filter((at) => now - at < WINDOW_MS);
        return { ok: recent.length < BURST, recent };
    }

    const PartyChat = { MAX_CHARS, HISTORY, BURST, WINDOW_MS, clean, allow };

    root.BB = root.BB || {};
    root.BB.PartyChat = PartyChat;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyChat;
})(typeof globalThis !== 'undefined' ? globalThis : this);
