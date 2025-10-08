/**
 * Specs for transcript.js: the TranscriptError classification that decides
 * whether a failure is a normal state of the video (no captions) or a real
 * error worth warning about, plus the TimeIndex binary search.
 */

suite('transcript: error classification', () => {
    test('missing captions is an EXPECTED condition, not a failure', () => {
        const e = new TranscriptError(TranscriptError.NO_CAPTIONS, 'No captions available for this video', true);
        assertEqual(e.code, 'NO_CAPTIONS');
        assertEqual(e.expected, true, 'callers must be able to degrade silently');
        assert(e instanceof Error, 'must still be a real Error');
        assertEqual(e.name, 'TranscriptError');
    });

    test('unplayable and no-matching-language are also expected', () => {
        assertEqual(new TranscriptError(TranscriptError.NOT_PLAYABLE, 'x', true).expected, true);
        assertEqual(new TranscriptError(TranscriptError.NO_LANGUAGE, 'x', true).expected, true);
    });

    test('network and IP-block failures are NOT expected', () => {
        assertEqual(new TranscriptError(TranscriptError.IP_BLOCKED, 'blocked').expected, false);
        assertEqual(new TranscriptError(TranscriptError.FETCH_FAILED, 'http 500').expected, false);
    });

    test('expected defaults to false so new throws are loud by default', () => {
        assertEqual(new TranscriptError('SOMETHING_NEW', 'x').expected, false);
    });

    test('error codes are distinct', () => {
        const codes = [
            TranscriptError.NO_CAPTIONS, TranscriptError.NOT_PLAYABLE,
            TranscriptError.NO_LANGUAGE, TranscriptError.IP_BLOCKED,
            TranscriptError.FETCH_FAILED,
        ];
        assertEqual(new Set(codes).size, codes.length, 'codes must be unique');
        codes.forEach((c) => assert(typeof c === 'string' && c.length > 0));
    });
});

suite('transcript: TimeIndex lookup', () => {
    function snippets() {
        return [
            new FetchedTranscriptSnippet('first', 0, 5),
            new FetchedTranscriptSnippet('second', 5, 5),
            new FetchedTranscriptSnippet('third', 10, 5),
            new FetchedTranscriptSnippet('fourth', 20, 5), // gap 15-20
        ];
    }

    test('finds the snippet covering a timestamp', () => {
        const idx = new TimeIndex(snippets());
        assertEqual(idx.getSnippetAtTime(0).text, 'first');
        assertEqual(idx.getSnippetAtTime(7).text, 'second');
        assertEqual(idx.getSnippetAtTime(12.5).text, 'third');
    });

    test('returns nothing inside a gap or before the start', () => {
        const idx = new TimeIndex(snippets());
        assert(!idx.getSnippetAtTime(17), 'gap between 15 and 20 has no snippet');
        assert(!idx.getSnippetAtTime(-1), 'before the first snippet');
    });

    test('getSnippetAtOrBefore falls back to the preceding snippet', () => {
        const idx = new TimeIndex(snippets());
        assertEqual(idx.getSnippetAtOrBefore(17).text, 'third', 'nearest preceding');
        assertEqual(idx.getSnippetAtOrBefore(100).text, 'fourth', 'past the end');
    });

    test('range query returns the snippets that overlap it', () => {
        const idx = new TimeIndex(snippets());
        const got = idx.getSnippetsInRange(4, 12).map((s) => s.text);
        assert(got.indexOf('second') !== -1, 'expected the middle snippet, got ' + JSON.stringify(got));
    });

    test('sorts out-of-order input', () => {
        const idx = new TimeIndex([
            new FetchedTranscriptSnippet('later', 10, 5),
            new FetchedTranscriptSnippet('earlier', 0, 5),
        ]);
        assertEqual(idx.getSnippetAtTime(1).text, 'earlier');
        assertEqual(idx.getSnippetAtTime(11).text, 'later');
    });

    test('empty transcript never throws', () => {
        const idx = new TimeIndex([]);
        assert(!idx.getSnippetAtTime(0));
        assert(!idx.getSnippetAtOrBefore(0));
    });
});
