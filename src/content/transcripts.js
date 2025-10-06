/**
 * Transcript lookup for checkpoints.
 *
 * Wraps YouTubeTranscriptApi with the bookkeeping the content script needs:
 * one in-flight fetch per video, a small cache so returning to a video does not
 * refetch, and a memo of videos known to have no captions so we stop asking.
 */
(function (root) {
    'use strict';

    /** Transcripts are large; keep only the few most recently used. */
    const MAX_CACHED = 3;

    function createTranscripts({ getPreferredLanguage, notify }) {
        const api = typeof YouTubeTranscriptApi !== 'undefined' ? new YouTubeTranscriptApi() : null;

        /** videoId -> FetchedTranscript (insertion-ordered, oldest first). */
        const cache = new Map();
        /** videoId -> Promise, so concurrent callers share one network fetch. */
        const inflight = new Map();
        /** Videos with no captions at all — a normal state, not an error. */
        const unavailable = new Set();

        function remember(videoId, transcript) {
            cache.set(videoId, transcript);
            while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
        }

        /**
         * Fetch (or reuse) the transcript for `videoId`. Resolves to null when
         * the video has no captions — checkpoints still work, they just carry
         * no subtitle text.
         */
        function fetch(videoId) {
            if (!api || !videoId || unavailable.has(videoId)) return Promise.resolve(null);
            if (cache.has(videoId)) return Promise.resolve(cache.get(videoId));
            if (inflight.has(videoId)) return inflight.get(videoId);

            const preferred = getPreferredLanguage();
            const request = api.fetch(videoId, { languages: [preferred, 'en'] })
                .then((transcript) => {
                    remember(videoId, transcript);
                    warnOnLanguageMismatch(transcript, preferred);
                    return transcript;
                })
                .catch((error) => {
                    if (error && error.expected) {
                        // No captions / not playable — remember so we stop asking.
                        unavailable.add(videoId);
                    } else {
                        // A transcript is a bonus on a checkpoint and every
                        // other part of the feature carries on without one, so
                        // a failed fetch is a note for whoever is debugging,
                        // not something to raise in the page's console.
                        console.debug('Bell Bearer: could not fetch transcript', error && error.message);
                    }
                    return null;
                })
                .finally(() => inflight.delete(videoId));

            inflight.set(videoId, request);
            return request;
        }

        function warnOnLanguageMismatch(transcript, preferred) {
            const code = transcript && transcript.languageCode;
            if (!code || code.startsWith(preferred)) return;
            notify(`Subtitles are in ${transcript.language}, not your preferred language`, 'warning');
        }

        /** Prefetch without caring about the result — used on video change. */
        function prefetch(videoId) {
            fetch(videoId).catch(() => { /* already handled */ });
        }

        /**
         * The transcript text spoken between `start` and `end`, or null.
         * Falls back to the snippet in progress at `start` when the span is
         * shorter than a single subtitle line.
         */
        async function textInRange(videoId, start, end) {
            const transcript = await fetch(videoId);
            if (!transcript) return null;

            const snippets = transcript.getSnippetsInRange(start, end);
            if (snippets && snippets.length > 0) {
                return snippets.map((snippet) => snippet.text).join(' ').trim() || null;
            }

            const nearest = transcript.getSnippetAtOrBefore(start);
            return nearest ? nearest.text : null;
        }

        function forget(videoId) {
            cache.delete(videoId);
            inflight.delete(videoId);
        }

        return { fetch, prefetch, textInRange, forget, get available() { return !!api; } };
    }

    const Transcripts = { createTranscripts, MAX_CACHED };

    root.BB = root.BB || {};
    root.BB.Transcripts = Transcripts;
    if (typeof module !== 'undefined' && module.exports) module.exports = Transcripts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
