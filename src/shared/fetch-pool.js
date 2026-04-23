/**
 * Fetching the many files one download is made of: a few at a time, each
 * tried again when the connection drops or the server is busy. A video's
 * pieces (src/content/video-download.js) and a folder's files
 * (src/content/folder-download.js) both come through here. Each had a copy
 * of the pool before, and only the video's tried a file a second time — one
 * dropped connection threw away a whole folder.
 */
(function (root) {
    'use strict';

    const TRIES = 3;
    /**
     * How long a file may go without a byte arriving before the attempt is
     * dropped and tried again. A connection that stalls without closing
     * never ends on its own, and the download sat at its last percent for good.
     */
    const STALL_MS = 30000;

    const cancelled = () => new DOMException('Cancelled', 'AbortError');

    /** A wait that a cancel cuts short. */
    const sleep = (ms, signal) => new Promise((done) => {
        const timer = setTimeout(done, ms);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); done(); }, { once: true });
    });

    /** `promise`, or a rejection as soon as `signal` aborts — for a stand-in fetch that does not hear it. */
    const unless = (promise, signal) => new Promise((resolve, reject) => {
        if (signal.aborted) { reject(cancelled()); return; }
        signal.addEventListener('abort', () => reject(cancelled()), { once: true });
        promise.then(resolve, reject);
    });

    /**
     * The body, read a piece at a time where the response streams, so that
     * every piece that lands tells `alive` the connection still is.
     */
    async function readBody(response, as, alive, signal) {
        if (!response.body || typeof response.body.getReader !== 'function') return unless(Promise.resolve(response[as]()), signal);
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        for (;;) {
            const { done, value } = await unless(reader.read(), signal);
            if (done) break;
            chunks.push(value);
            size += value.byteLength;
            alive();
        }
        if (as === 'blob') return new Blob(chunks);
        const out = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
            out.set(chunk, at);
            at += chunk.byteLength;
        }
        return out.buffer;
    }

    /**
     * `worker` over `items`, `limit` at a time, results in order. The first
     * failure ends it: nothing more is started, and it is what rejects. A
     * download missing a piece it says nothing about is worse than none.
     */
    async function mapLimit(items, limit, worker) {
        const results = new Array(items.length);
        let next = 0;
        let failed = null;
        const run = async () => {
            while (next < items.length && !failed) {
                const index = next++;
                try {
                    results[index] = await worker(items[index], index);
                } catch (error) {
                    failed = failed || error;
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
        if (failed) throw failed;
        return results;
    }

    /**
     * One file's body: a Blob, or with `as: 'arrayBuffer'` its bytes. Tried
     * again on a dropped connection — before the answer or partway through
     * its body, which used to be thrown at once, on the first try — on a
     * connection with nothing arriving for `stallMs`, a busy server (429,
     * 5xx) or a body that is not the `expect`ed size. A refusal (403, 404) is
     * not tried again: the address has expired or was never good, and asking
     * twice more only looks worse. `refused(status)` words it for whoever
     * asked. A cancel through `signal` ends it at once, waits included.
     */
    async function fetchBody(url, { fetchImpl, signal, init = { credentials: 'omit' }, as = 'blob', expect, retryMs = 1000,
        stallMs = STALL_MS, refused = (status) => `Refused (${status})` }) {
        let lastError = null;
        for (let attempt = 0; attempt < TRIES; attempt++) {
            if (attempt) await sleep(retryMs * attempt, signal);
            if (signal && signal.aborted) throw cancelled();
            // Each attempt can be dropped on its own, for a stall, as well as
            // by the caller's cancel.
            const own = new AbortController();
            const cancel = () => own.abort();
            if (signal) signal.addEventListener('abort', cancel, { once: true });
            let stalled = false;
            let timer = 0;
            const alive = () => {
                clearTimeout(timer);
                timer = setTimeout(() => { stalled = true; own.abort(); }, stallMs);
            };
            const dropped = () => {
                if (signal && signal.aborted) throw cancelled();
                lastError = new Error(stalled ? 'The connection stalled' : 'The connection dropped');
            };
            try {
                alive();
                let response;
                try {
                    response = await unless(Promise.resolve(fetchImpl(url, { ...init, signal: own.signal })), own.signal);
                } catch (_) {
                    dropped();
                    continue;
                }
                if (response.status === 429 || response.status >= 500) {
                    lastError = new Error(`The server is busy (${response.status})`);
                    continue;
                }
                if (!response.ok) throw new Error(refused(response.status));
                let body;
                try {
                    body = await readBody(response, as, alive, own.signal);
                } catch (_) {
                    dropped();
                    continue;
                }
                if (expect != null && (as === 'blob' ? body.size : body.byteLength) !== expect) {
                    lastError = new Error('A piece came back short');
                    continue;
                }
                return body;
            } finally {
                clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', cancel);
            }
        }
        throw lastError;
    }

    const FetchPool = { TRIES, STALL_MS, mapLimit, fetchBody };

    root.BB = root.BB || {};
    root.BB.FetchPool = FetchPool;
    if (typeof module !== 'undefined' && module.exports) module.exports = FetchPool;
})(typeof globalThis !== 'undefined' ? globalThis : this);
