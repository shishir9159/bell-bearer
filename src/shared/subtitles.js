/**
 * A subtitle file as cues: WebVTT read into a list of `{ start, end, parts }`
 * — seconds, and the cue's text as runs, `{ text, italic }`, with '\n'
 * between lines.
 *
 * Read with regular expressions rather than DOMParser. The format is written
 * by machine, Netflix's always the same way, and a parser here can be tested
 * in Node.
 *
 * Two things in Netflix's files are not text to show:
 *  - ruby, the reading over a Japanese word. Kept, it reads as the word and
 *    then its reading run together; the reading is dropped and the word kept.
 *  - the direction marks (&lrm; &rlm;) WebVTT carries for Arabic and Hebrew,
 *    which are kept — they are what puts the punctuation on the right side.
 */
(function (root) {
    'use strict';

    const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '‎', rlm: '‏' };

    function decode(text) {
        return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
            if (name[0] === '#') {
                const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
                return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
            }
            return ENTITIES[name.toLowerCase()] ?? whole;
        });
    }

    /** Runs with neighbours of the same style joined, and the empty ones gone. */
    function tidy(parts) {
        const out = [];
        for (const part of parts) {
            if (!part.text) continue;
            const last = out[out.length - 1];
            if (last && last.italic === part.italic) last.text += part.text;
            else out.push({ text: part.text, italic: part.italic });
        }
        // Spaces at a line's edges, and space or breaks at the cue's, are
        // the file's layout, not the cue's.
        for (const part of out) part.text = part.text.replace(/[ \t]*\n[ \t]*/g, '\n');
        if (out.length) {
            out[0].text = out[0].text.replace(/^\s+/, '');
            out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '');
        }
        return out.filter((part) => part.text);
    }

    const textOf = (parts) => parts.map((part) => part.text).join('');

    // ------------------------------------------------------------- WebVTT

    /** `01:02:03.456` or `02:03.456` in seconds, or NaN. */
    function vttTime(stamp) {
        const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(String(stamp).trim());
        if (!match) return NaN;
        const [, h, m, s, ms] = match;
        return (Number(h || 0) * 3600) + (Number(m) * 60) + Number(s) + (Number(ms.padEnd(3, '0')) / 1000);
    }

    /** One cue's lines into runs: <i> is italic, <rt> is dropped, every other tag is unwrapped. */
    function vttParts(lines) {
        const parts = [];
        let italic = 0;
        const body = lines.join('\n').replace(/<rt>[\s\S]*?<\/rt>/gi, '').replace(/<rp>[\s\S]*?<\/rp>/gi, '');
        for (const piece of body.split(/(<[^>]*>)/)) {
            if (!piece) continue;
            if (piece[0] === '<') {
                if (/^<i[\s.>]/i.test(piece)) italic++;
                else if (/^<\/i>/i.test(piece)) italic = Math.max(0, italic - 1);
                continue;
            }
            parts.push({ text: decode(piece), italic: italic > 0 });
        }
        return tidy(parts);
    }

    function parseVtt(source) {
        const cues = [];
        const blocks = String(source).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
        for (const block of blocks) {
            const lines = block.split('\n');
            const at = lines.findIndex((line) => line.includes('-->'));
            if (at < 0) continue;
            const [from, rest = ''] = lines[at].split('-->');
            const start = vttTime(from);
            const end = vttTime(rest.trim().split(/\s+/)[0]);
            if (!(end > start)) continue;
            const parts = vttParts(lines.slice(at + 1));
            if (parts.length) cues.push({ start, end, parts });
        }
        return sorted(cues);
    }

    // -------------------------------------------------------------- shared

    const sorted = (cues) => cues.sort((a, b) => a.start - b.start || a.end - b.end);

    /** A file as cues, told apart by what it starts with: WebVTT, or none. */
    function parse(source) {
        const text = String(source || '').replace(/^﻿/, '').trimStart();
        if (text.startsWith('WEBVTT')) return parseVtt(text);
        return [];
    }

    /**
     * The cues showing at `time`, in file order. Cues may overlap — two
     * speakers at once are two cues — so it is every cue that has started and
     * not ended, found from the last to start by a binary search.
     */
    function cuesAt(cues, time) {
        let low = 0;
        let high = cues.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (cues[mid].start <= time) low = mid + 1;
            else high = mid;
        }
        const out = [];
        // The longest a cue in a real file runs is well under a minute; a
        // walk back further than this is past anything still on screen.
        for (let i = low - 1; i >= 0 && time - cues[i].start < 60; i--) {
            if (cues[i].end > time) out.unshift(cues[i]);
        }
        return out;
    }

    /**
     * When what `cuesAt` answers next changes after `time`: the next start or
     * the soonest end among those showing. Infinity after the last cue.
     */
    function nextChange(cues, time) {
        let next = Infinity;
        for (const cue of cuesAt(cues, time)) next = Math.min(next, cue.end);
        let low = 0;
        let high = cues.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (cues[mid].start <= time) low = mid + 1;
            else high = mid;
        }
        return low < cues.length ? Math.min(next, cues[low].start) : next;
    }

    const Subtitles = { parse, parseVtt, vttTime, cuesAt, nextChange, textOf, decode };

    root.BB = root.BB || {};
    root.BB.Subtitles = Subtitles;
    if (typeof module !== 'undefined' && module.exports) module.exports = Subtitles;
})(typeof globalThis !== 'undefined' ? globalThis : this);
