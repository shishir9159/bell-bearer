/**
 * claude.ai, from inside the page's own JavaScript world.
 *
 * Why this exists, when src/content/chatgpt-read.js has no counterpart: the
 * completion stream. Claude's answer arrives as server-sent events on the
 * page's own `fetch`, and two things in it are worth more than anything the
 * DOM says. `message_limit` carries the exact time a limit resets — an epoch,
 * where the page's banner is a time of day to be parsed. And the stream's end
 * is a clean end-of-answer that works in a background tab, where the page
 * runs no animation frames and its own rendering may lag far behind. The
 * queue runner waits on that, and falls back to the DOM only when this is
 * silent. Only the page's world can see its fetch; a content script's
 * isolated world cannot.
 *
 * **It never changes a request or a response.** It reads a clone, after the
 * page has its own, so the page's reader is untouched; everything it does is
 * inside a try, and a stream it cannot read is simply not reported on. A chat
 * that stopped answering because the extension was listening would be a far
 * worse bug than a missed event.
 *
 * Loaded by the manifest with `"world": "MAIN"` on claude.ai only, at
 * document_start: a wrapper put on `fetch` after the page's code has taken
 * its own reference to it would never see a request. It has no chrome.*,
 * and talks to src/content/claude-read.js entirely over DOM events.
 */
(function () {
    'use strict';

    if (window.__bbClaudePage) return;
    window.__bbClaudePage = true;

    const STREAM = 'bb:claude:stream';
    const LIMIT = 'bb:claude:limit';
    const COMPLETION = /\/chat_conversations\/([0-9a-f-]{36})\/(?:completion|retry_completion)(?:[?#]|$)/i;

    function send(name, detail) {
        try {
            document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
        } catch (_) { /* the page is going away */ }
    }

    /** Seconds or milliseconds or ISO, as milliseconds; null for nothing. */
    function ms(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
        const parsed = Date.parse(String(value || ''));
        return Number.isFinite(parsed) ? parsed : null;
    }

    /** A limit as the stream or a 429 describes it, or null. */
    function readLimit(limit) {
        if (!limit || typeof limit !== 'object' || !limit.type) return null;
        return {
            type: String(limit.type),
            resetsAt: ms(limit.resetsAt || limit.resets_at),
            remaining: Number.isFinite(limit.remaining) ? limit.remaining : null,
        };
    }

    /** A 429's body names its limit inside an error message that is itself JSON. */
    function limitOf429(body) {
        const error = body && body.error;
        if (!error) return null;
        try { return readLimit(JSON.parse(error.message)); } catch (_) { return readLimit(error); }
    }

    function onEvent(chunk, conv, state) {
        const data = chunk.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
        if (!data) return;
        let body;
        try { body = JSON.parse(data); } catch (_) { return; }
        if (body.type === 'message_limit') {
            const limit = readLimit(body.message_limit);
            if (limit) send(LIMIT, limit);
        } else if (body.type === 'message_stop' || body.type === 'error') {
            state.ended = true;
            send(STREAM, body.type === 'error' ? { phase: 'end', conv, error: 'stream' } : { phase: 'end', conv });
        }
    }

    async function watch(conv, response) {
        const state = { ended: false };
        try {
            if (!response.ok) {
                const body = await response.clone().json().catch(() => null);
                const limit = response.status === 429 ? limitOf429(body) : null;
                if (limit) send(LIMIT, limit);
                send(STREAM, { phase: 'end', conv, error: response.status });
                return;
            }
            const reader = response.clone().body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
                let at;
                while ((at = buffer.indexOf('\n\n')) >= 0) {
                    onEvent(buffer.slice(0, at), conv, state);
                    buffer = buffer.slice(at + 2);
                }
            }
            if (buffer.trim()) onEvent(buffer, conv, state);
        } catch (_) {
            // A dropped stream still ends the answer, as far as a waiting
            // queue is concerned.
        }
        if (!state.ended) send(STREAM, { phase: 'end', conv });
    }

    const realFetch = window.fetch;
    window.fetch = function (...args) {
        const promise = realFetch.apply(this, args);
        try {
            const input = args[0];
            const match = COMPLETION.exec(String((input && input.url) || input || ''));
            if (match) {
                send(STREAM, { phase: 'start', conv: match[1] });
                promise.then((response) => watch(match[1], response))
                    .catch(() => send(STREAM, { phase: 'end', conv: match[1], error: 'network' }));
            }
        } catch (_) { /* never let listening break sending */ }
        return promise;
    };
})();
