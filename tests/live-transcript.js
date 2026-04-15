/**
 * transcript.js against YouTube itself. It needs the network and the
 * extension's host permissions, so it is in neither suite: open
 * chrome-extension://<id>/tests/live-transcript.html, and `?v=<id>` for
 * another video.
 */
(function () {
    'use strict';

    const { YouTubeTranscriptApi, FetchedTranscript, FetchedTranscriptSnippet, TranscriptInfo } = window.BB.TranscriptApi;
    const VIDEO = new URLSearchParams(location.search).get('v') || 'dQw4w9WgXcQ';
    const api = new YouTubeTranscriptApi();
    let fetched = null;
    const transcript = () => (fetched = fetched || api.fetch(VIDEO));

    suite(`live transcripts — ${VIDEO}, from youtube`, () => {
        test('the video has a transcript, tagged with its id and language', async () => {
            const got = await transcript();
            assert(got instanceof FetchedTranscript, 'not a FetchedTranscript');
            assert(got.length > 0, 'no snippets');
            assertEqual(got.videoId, VIDEO);
            assert(got.languageCode, 'no language code');
        });

        test('its tracks are listed, each with a language and an address', async () => {
            const list = await api.listTranscripts(VIDEO);
            assert(Array.isArray(list) && list.length > 0, 'no tracks');
            list.forEach((track, i) => {
                assert(track instanceof TranscriptInfo, `track ${i} is not a TranscriptInfo`);
                assert(track.languageCode && track.baseUrl, `track ${i} has no language or address`);
            });
        });

        test('its text, its times and its snippets read as they should', async () => {
            const got = await transcript();
            assert(got.getText().length > 0, 'no text');
            assert(got.getFormattedText().length > 0, 'no formatted text');
            assertEqual(got.formatTime(125.5), '02:05');
            assert(got.getSnippetAtTime(got.snippets[0].start + 0.1), 'no snippet at the first one\'s time');
            assertEqual([...got].length, got.length, 'the iterator');
            const [first] = got.snippets;
            assert(first instanceof FetchedTranscriptSnippet, 'not a FetchedTranscriptSnippet');
            assert(typeof first.text === 'string' && first.start >= 0 && first.duration > 0, JSON.stringify(first));
        });

        test('a language list is taken in order of preference', async () => {
            assert(await api.fetch(VIDEO, { languages: ['en'] }), 'no English');
            assert(await api.fetch(VIDEO, { languages: ['de', 'en', 'fr'] }), 'none of three');
        });

        test('a video that does not exist is an error with a message', async () => {
            let error = null;
            try {
                await api.fetch('invalid_video_id_12345');
            } catch (caught) {
                error = caught;
            }
            assert(error && error.message, 'no error, or one with nothing to say');
        });
    });
})();
