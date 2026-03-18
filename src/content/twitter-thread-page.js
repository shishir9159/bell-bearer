/**
 * x.com, from inside the page's own JavaScript world: the conversation X
 * has already sent this page, kept for the text reader.
 *
 * Why the reader does not read the DOM, as every clipper does: X draws only
 * part of a conversation — a list it fills in as you scroll and empties
 * behind you — and plays its videos from a MediaSource `blob:` address that
 * no other element can play. So a thread read off the page stops wherever X
 * stopped drawing, and its videos are lost. The conversation itself arrives
 * whole, as X's own TweetDetail response: every post's full text, its
 * photos, and its video's mp4 files on video.twimg.com.
 *
 * **It sends nothing, and changes nothing.** It wraps the page's XHR and
 * fetch only to look at what comes back for those two queries: it reads a
 * clone, after the page has its own, keeps the text of the last few, and
 * hands them over when the reader asks. It never parses anything while you
 * browse, never asks X for a thing, and a response it cannot read is simply
 * not kept.
 *
 * Loaded with `"world": "MAIN"` on x.com at document_start: a wrapper put on
 * after X has taken its own reference to XHR or fetch would never see a
 * request. It has no chrome.*, and talks to src/content/x-thread-read.js
 * over DOM events.
 */
(function () {
    'use strict';

    if (window.__bbXThreadPage) return;
    window.__bbXThreadPage = true;

    const ASK = 'bb:x:thread';
    const ANSWER = 'bb:x:thread:ok';
    /** The two queries a post's own page answers with its conversation. */
    const WANTED = /\/i\/api\/graphql\/[^/?]+\/(?:TweetDetail|TweetResultByRestId)(?:[?#]|$)/;
    /** The newest few, and no more than this many characters of them in all. */
    const KEEP = 12;
    const MAX_CHARS = 6e6;

    const kept = [];

    function keep(url, text) {
        if (typeof text !== 'string' || !text) return;
        kept.push({ url: String(url), text });
        let total = kept.reduce((sum, one) => sum + one.text.length, 0);
        while (kept.length > KEEP || (total > MAX_CHARS && kept.length > 1)) total -= kept.shift().text.length;
    }

    const wanted = (url) => {
        try { return WANTED.test(String(url)); } catch (_) { return false; }
    };

    // XHR: the address is known at open(), the answer at load. Kept in a
    // WeakMap rather than on the request, where the page could see it.
    const asked = new WeakMap();
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        // A request object opened again, for anything else, is forgotten.
        try {
            if (wanted(url)) asked.set(this, String(url));
            else asked.delete(this);
        } catch (_) { /* never in the page's way */ }
        return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        try {
            const url = asked.get(this);
            if (url) {
                this.addEventListener('load', () => {
                    try {
                        if (this.status !== 200) return;
                        if (this.responseType === '' || this.responseType === 'text') keep(url, this.responseText);
                        else if (this.responseType === 'json' && this.response) keep(url, JSON.stringify(this.response));
                    } catch (_) { /* a response we cannot read is not kept */ }
                });
            }
        } catch (_) { /* never in the page's way */ }
        return send.apply(this, arguments);
    };

    const fetched = window.fetch;
    if (typeof fetched === 'function') {
        window.fetch = function (input) {
            const result = fetched.apply(this, arguments);
            try {
                const url = typeof input === 'string' ? input : input && input.url;
                if (wanted(url)) {
                    result.then((response) => {
                        if (response && response.ok) response.clone().text().then((text) => keep(url, text), () => {});
                    }, () => {});
                }
            } catch (_) { /* never in the page's way */ }
            return result;
        };
    }

    // Asked and answered inside one dispatch: see src/content/bridge.js.
    document.addEventListener(ASK, () => {
        try {
            document.dispatchEvent(new CustomEvent(ANSWER, { detail: JSON.stringify(kept) }));
        } catch (_) { /* the page is going away */ }
    });
})();
