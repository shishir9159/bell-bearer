/**
 * The watch party's chat, the rules every end of it shares: what a line may
 * say and how often a member may say one.
 *
 * The authority (party-room.js, and the Zig/Go server that follows the same
 * README) applies them to everything it is sent, and the page applies them
 * again before it sends, so a line the room would drop is kept in the box
 * instead of vanishing.
 *
 * And the member's side: the log a member keeps, which is the room's lines
 * and the notes made here about who came, went or is being waited for. The
 * notes are never sent; every member makes its own from what the room says.
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

    /** Lines a member keeps: the room's fifty, and room for the notes made between them. */
    const KEEP = 100;
    /** Ids remembered past the lines themselves, so a line pushed out of the log is not taken back in as new when a resume replays it. */
    const IDS_KEPT = 1000;

    /** A line off the wire, checked like everything a peer sends, or null. */
    function fromWire(msg) {
        if (!msg || typeof msg.id !== 'string' || !msg.id) return null;
        const text = clean(msg.text);
        if (!text) return null;
        return {
            id: msg.id, from: typeof msg.from === 'string' ? msg.from : null,
            name: clean(msg.name, 32) || 'Someone', at: Number.isFinite(msg.at) ? msg.at : 0, text,
        };
    }

    /**
     * Lines in the order they came, each once. The room replays its history
     * after every welcome — a resume, a new host — and what a member already
     * has must not come round again.
     */
    function createLog(max = KEEP) {
        const lines = [];
        const ids = new Set();
        return {
            /** True if the line was new, and is now kept. */
            add(line) {
                if (!line || ids.has(line.id)) return false;
                ids.add(line.id);
                if (ids.size > IDS_KEPT) ids.delete(ids.values().next().value);
                lines.push(line);
                if (lines.length > max) lines.shift();
                return true;
            },
            lines: () => lines.slice(),
        };
    }

    /**
     * What changed among the other members, as notes: who came, who went, who
     * stepped out to watch solo or back in, and who hosts now. Never about
     * yourself — you know what you did.
     */
    function memberNotes(before, after, you) {
        const was = new Map((before || []).map((m) => [m.id, m]));
        const now = new Set((after || []).map((m) => m.id));
        const notes = [];
        for (const m of after || []) {
            if (m.id === you) continue;
            const old = was.get(m.id);
            if (!old) notes.push(`${m.name} joined`);
            else if (!old.solo && m.solo) notes.push(`${m.name} stepped out to watch solo`);
            else if (old.solo && !m.solo) notes.push(`${m.name} rejoined`);
            if (old && old.role !== 'host' && m.role === 'host') notes.push(`${m.name} is the host now`);
        }
        for (const m of before || []) if (m.id !== you && !now.has(m.id)) notes.push(`${m.name} left`);
        return notes;
    }

    /** "Waiting for Sam…" when a hold starts on someone, or takes in someone more; null otherwise. */
    function waitNote(before, after, members, you) {
        const was = (before && before.hold && before.hold.waiting) || [];
        const fresh = ((after && after.hold && after.hold.waiting) || []).filter((id) => !was.includes(id) && id !== you);
        if (!fresh.length) return null;
        const names = fresh.map((id) => ((members || []).find((m) => m.id === id) || {}).name || 'someone');
        return names.length === 1 ? `Waiting for ${names[0]}…` : `Waiting for ${names[0]} and ${names.length - 1} more…`;
    }

    const PartyChat = {
        MAX_CHARS, HISTORY, BURST, WINDOW_MS, KEEP,
        clean, allow, fromWire, createLog, memberNotes, waitNote,
    };

    root.BB = root.BB || {};
    root.BB.PartyChat = PartyChat;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyChat;
})(typeof globalThis !== 'undefined' ? globalThis : this);
