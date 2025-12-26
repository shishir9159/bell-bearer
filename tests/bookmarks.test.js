/**
 * Specs for the bookmark store's pure logic: de-duplication, merging and
 * timestamp-link parsing. The storage-backed functions need a live
 * chrome.storage and are exercised by hand.
 */

const B = window.BB.Bookmarks;
const Y = window.BB.YouTube;

const VIDEO = { id: 'vid1', title: 'A video', url: 'https://www.youtube.com/watch?v=vid1' };

suite('bookmarks: adding checkpoints', () => {
    test('creates the video entry on the first checkpoint', () => {
        const { videos, added } = B.addBookmarks([], VIDEO, [{ time: 30 }]);
        assertEqual(added, 1);
        assertEqual(videos.length, 1);
        assertEqual(videos[0].id, 'vid1');
    });

    test('keeps checkpoints sorted by time however they arrive', () => {
        const { videos } = B.addBookmarks([], VIDEO, [{ time: 90 }, { time: 10 }, { time: 45 }]);
        assertDeepEqual(videos[0].bookmarks.map((b) => b.time), [10, 45, 90]);
    });

    test('drops a checkpoint at a time already saved', () => {
        // The old filter only compared each checkpoint with its neighbour, so an
        // interleaved re-import left duplicates behind.
        const first = B.addBookmarks([], VIDEO, [{ time: 10 }, { time: 30 }]);
        const second = B.addBookmarks(first.videos, VIDEO, [{ time: 20 }, { time: 10 }, { time: 30 }]);

        assertEqual(second.added, 1, 'only the new time should be added');
        assertDeepEqual(second.videos[0].bookmarks.map((b) => b.time), [10, 20, 30]);
    });

    test('does not mutate the list it was given', () => {
        const before = B.addBookmarks([], VIDEO, [{ time: 10 }]).videos;
        const snapshot = JSON.stringify(before);
        B.addBookmarks(before, VIDEO, [{ time: 20 }]);
        assertEqual(JSON.stringify(before), snapshot);
    });

    test('a range checkpoint is filed by its start time', () => {
        const { videos } = B.addBookmarks([], VIDEO, [{ start: 12, end: 30 }]);
        assertEqual(B.bookmarkTime(videos[0].bookmarks[0]), 12);
    });
});

suite('bookmarks: removing', () => {
    test('drops the video entry when its last checkpoint goes', () => {
        const { videos } = B.addBookmarks([], VIDEO, [{ time: 10 }]);
        assertDeepEqual(B.removeBookmarkById(videos, 'vid1', B.bookmarkKey(videos[0].bookmarks[0])), []);
    });

    test('an unknown key or video is a no-op', () => {
        const { videos } = B.addBookmarks([], VIDEO, [{ time: 10 }]);
        assertEqual(B.removeBookmarkById(videos, 'vid1', 'cp_nothing')[0].bookmarks.length, 1);
        assertEqual(B.removeBookmarkById(videos, 'nope', B.bookmarkKey(videos[0].bookmarks[0])).length, 1);
    });
});

suite('bookmarks: import', () => {
    test('rejects anything that is not an export file', () => {
        assert(!B.validateImport(null));
        assert(!B.validateImport({ videos: [] }));
        assert(!B.validateImport({ version: '1.0', exportDate: 'x' }));
        assert(B.validateImport({ version: '1.0', exportDate: 'x', videos: [] }));
    });

    test('merging counts new videos and new checkpoints separately', () => {
        const existing = B.addBookmarks([], VIDEO, [{ time: 10 }]).videos;
        const result = B.mergeImported(existing, [
            { id: 'vid1', title: 'A video', bookmarks: [{ time: 10 }, { time: 20 }] },
            { id: 'vid2', title: 'Another', bookmarks: [{ time: 5 }] },
        ]);

        assertEqual(result.addedVideos, 1);
        assertEqual(result.updatedVideos, 1);
        assertEqual(result.addedBookmarks, 2);
    });

    test('re-importing the same file adds nothing', () => {
        const existing = B.addBookmarks([], VIDEO, [{ time: 10 }, { time: 20 }]).videos;
        const payload = [{ id: 'vid1', title: 'A video', bookmarks: [{ time: 10 }, { time: 20 }] }];

        const result = B.mergeImported(existing, payload);
        assertEqual(result.addedBookmarks, 0);
        assertEqual(result.type, 'warning');
    });

    test('malformed entries are skipped, not fatal', () => {
        const result = B.mergeImported([], [
            null,
            { title: 'no id', bookmarks: [] },
            { id: 'ok', title: 'Fine', bookmarks: [{ time: 1 }] },
        ]);
        assertEqual(result.addedVideos, 1);
    });
});

suite('bookmarks: timestamp links', () => {
    test('collects several links for one video into a single entry', () => {
        const videos = B.parseTimestampLinks([
            'https://www.youtube.com/watch?v=abc&t=30s',
            'https://www.youtube.com/watch?v=abc&t=90s',
        ].join('\n'));

        assertEqual(videos.length, 1);
        assertDeepEqual(videos[0].bookmarks.map((b) => b.time), [30, 90]);
    });

    test('the same instant written two ways is one checkpoint', () => {
        const videos = B.parseTimestampLinks([
            'https://youtu.be/abc?t=1m',
            'https://www.youtube.com/watch?v=abc&t=60',
        ].join('\n'));
        assertEqual(videos[0].bookmarks.length, 1);
    });

    test('ignores lines that are not YouTube links', () => {
        const videos = B.parseTimestampLinks('not a link\nhttps://example.com/watch?v=abc\n');
        assertDeepEqual(videos, []);
    });
});

suite('youtube: url parsing', () => {
    test('reads the id from every watch-page shape', () => {
        assertEqual(Y.extractVideoId('https://www.youtube.com/watch?v=abc123'), 'abc123');
        assertEqual(Y.extractVideoId('https://youtu.be/abc123?t=9'), 'abc123');
        assertEqual(Y.extractVideoId('https://www.youtube.com/shorts/abc123'), 'abc123');
        assertEqual(Y.extractVideoId('https://www.youtube.com/embed/abc123'), 'abc123');
    });

    test('does not mistake a v= inside a redirect target for the video', () => {
        // The old /[?&]v=([^&]+)/ regex matched anywhere in the raw URL string.
        assertEqual(Y.extractVideoId('https://www.youtube.com/redirect?q=http%3A%2F%2Fe.com%2F%3Fv%3DEVIL'), null);
    });

    test('rejects look-alike hosts', () => {
        assertEqual(Y.extractVideoId('https://notyoutube.com/watch?v=abc'), null);
        assertEqual(Y.extractVideoId('https://example.com/watch?v=abc'), null);
    });

    test('only adds a t= when the offset is past the start', () => {
        assertEqual(Y.watchUrl('abc', 0), 'https://www.youtube.com/watch?v=abc');
        assertEqual(Y.watchUrl('abc', 95), 'https://www.youtube.com/watch?v=abc&t=95s');
    });
});

suite('dom: escaping', () => {
    const D = window.BB.Dom;

    test('escapes text that would otherwise become markup', () => {
        assertEqual(D.escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
        assertEqual(D.escapeHtml('a "b" \'c\''), 'a &quot;b&quot; &#39;c&#39;');
    });

    test('a javascript: URL never survives to an href', () => {
        // Channel URLs are typed by hand in the dashboard, so this would
        // otherwise be a one-click self-XSS.
        assertEqual(D.safeUrl('javascript:alert(1)'), '#');
        assertEqual(D.safeUrl('data:text/html,<script>'), '#');
        assertEqual(D.safeUrl('https://example.com/a'), 'https://example.com/a');
    });
});
