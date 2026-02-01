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

    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

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
     * again on a dropped connection, a busy server (429, 5xx) or a body that
     * is not the `expect`ed size. A refusal (403, 404) is not tried again:
     * the address has expired or was never good, and asking twice more only
     * looks worse. `refused(status)` words it for whoever asked.
     */
    async function fetchBody(url, { fetchImpl, signal, init = { credentials: 'omit' }, as = 'blob', expect, retryMs = 1000,
        refused = (status) => `Refused (${status})` }) {
        let lastError = null;
        for (let attempt = 0; attempt < TRIES; attempt++) {
            if (attempt) await sleep(retryMs * attempt);
            if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
            let response;
            try {
                response = await fetchImpl(url, { ...init, signal });
            } catch (error) {
                if (error && error.name === 'AbortError') throw error;
                lastError = new Error('The connection dropped');
                continue;
            }
            if (response.status === 429 || response.status >= 500) {
                lastError = new Error(`The server is busy (${response.status})`);
                continue;
            }
            if (!response.ok) throw new Error(refused(response.status));
            const body = await response[as]();
            if (expect != null && (as === 'blob' ? body.size : body.byteLength) !== expect) {
                lastError = new Error('A piece came back short');
                continue;
            }
            return body;
        }
        throw lastError;
    }

    const FetchPool = { TRIES, mapLimit, fetchBody };

    root.BB = root.BB || {};
    root.BB.FetchPool = FetchPool;
    if (typeof module !== 'undefined' && module.exports) module.exports = FetchPool;
})(typeof globalThis !== 'undefined' ? globalThis : this);
