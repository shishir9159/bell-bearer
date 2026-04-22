/**
 * The pure-logic suite, in seconds; index.html is for what needs a DOM.
 *
 *     node tests/node-check.js
 *     node tests/node-check.js party    only the sections with "party" in their name
 */
'use strict';

let passed = 0;
let failed = 0;

// Only checks outside the area are skipped; everything between them runs. A
// check leaning on an earlier section's leftovers fails only in an area run,
// which is why the whole run is the gate.
const AREA = (process.argv[2] || '').toLowerCase();
let inArea = !AREA;
let skipped = 0;

function section(name) {
    inArea = !AREA || name.toLowerCase().includes(AREA);
    if (inArea) console.log(`\n# ${name}`);
}

function check(name, fn) {
    if (!inArea) {
        skipped++;
        return;
    }
    try {
        fn();
        passed++;
    } catch (error) {
        failed++;
        console.log(`  FAIL  ${name}\n        ${error.message}`);
    }
}

async function checkAsync(name, fn) {
    if (!inArea) {
        skipped++;
        return;
    }
    try {
        await fn();
        passed++;
    } catch (error) {
        failed++;
        console.log(`  FAIL  ${name}\n        ${error.message}`);
    }
}

function eq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'expected truthy');
}

// A curve's shape, not its values: FSRS's constants are somebody else's, and
// what has to hold is that a more stable card waits longer.
function assertRising(values, msg) {
    for (let i = 1; i < values.length; i++) {
        assert(values[i] > values[i - 1], `${msg}: not rising at ${i} — ${values.join(', ')}`);
    }
}

function assertFalling(values, msg) {
    for (let i = 1; i < values.length; i++) {
        assert(values[i] < values[i - 1], `${msg}: not falling at ${i} — ${values.join(', ')}`);
    }
}

// --------------------------------------------------------------- speed

const Speed = require('../src/shared/speed.js');

section('speed ladder');
check('stepping walks the ladder in order, and down retraces up', () => {
    const walk = (rate, step) => Array.from({ length: 5 }, () => (rate = step(rate)));
    eq(walk(1, Speed.nextStep), [1.25, 1.5, 1.75, 2, 2.25]);
    eq(walk(2.25, Speed.prevStep), [2, 1.75, 1.5, 1.25, 1]);
    for (const start of Speed.STEPS.slice(1, -1)) eq(Speed.prevStep(Speed.nextStep(start)), start, `from ${start}`);
});
check('an off-ladder rate steps to the next rung either way, never past it', () => {
    // The old "nearest index + 1" turned 2.4 into 3 and skipped 2.5 entirely.
    eq([2.4, 1.1, 0.3].map((rate) => Speed.nextStep(rate)), [2.5, 1.25, 0.5]);
    eq([2.4, 2.6, 1.4, 4.9].map((rate) => Speed.prevStep(rate)), [2.25, 2.5, 1.25, 4]);
});
check('float noise is not a different rate', () => {
    // A rate a hair off a rung fell through the exact-match search.
    eq(Speed.nextStep(1.7500000000000002), 2);
    assert(Speed.sameRate(1.7500000000000002, 1.75));
    eq([Speed.format(1.7500000000000002), Speed.format(2)], ['1.75x', '2x']);
});
check('stepping stops at the ends rather than wrapping, and direction 0 is 1x', () => {
    eq([Speed.nextStep(5), Speed.prevStep(0.25)], [5, 0.25]);
    eq([Speed.step(1, 1), Speed.step(1.25, -1), Speed.step(2.5, 0)], [1.25, 1, 1]);
});
check('clamps to what a media element will play, and a non-number to 1x', () => {
    eq([99, 0, -4].map((rate) => Speed.clamp(rate)), [Speed.MAX_RATE, Speed.MIN_RATE, Speed.MIN_RATE]);
    eq(['fast', undefined, NaN].map((rate) => Speed.clamp(rate)), [1, 1, 1]);
});

// ----------------------------------------------------------------- dom

const Dom = require('../src/shared/dom.js');
// On BB before anything that draws a glyph as it loads.
require('../src/shared/icons.js');

section('escaping and URL safety');
check('escapes markup in text, quotes included', () => {
    eq(Dom.escapeHtml('<b>&"x"'), '&lt;b&gt;&amp;&quot;x&quot;');
    eq(Dom.escapeHtml("'c'"), '&#39;c&#39;');
});
check('javascript: URLs are neutralised, and http(s) ones pass through', () => {
    // Channel URLs are typed by hand in the dashboard: a one-click self-XSS otherwise.
    eq(Dom.safeUrl('javascript:alert(1)'), '#');
    eq(Dom.safeUrl('data:text/html,<script>'), '#');
    eq(Dom.safeUrl('https://youtube.com/watch?v=x'), 'https://youtube.com/watch?v=x');
});

// ------------------------------------------------------------- youtube

const YouTube = require('../src/shared/youtube.js');

section('youtube URLs');
check('reads the id from every watch form', () => {
    eq(YouTube.extractVideoId('https://www.youtube.com/watch?v=abcdefghijk'), 'abcdefghijk');
    eq(YouTube.extractVideoId('https://youtu.be/abcdefghijk'), 'abcdefghijk');
    eq(YouTube.extractVideoId('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
    eq(YouTube.extractVideoId('https://www.youtube.com/embed/abcdefghijk'), 'abcdefghijk');
});
check('a v= inside a redirect target is not the video id', () => {
    // The old regex matched the first v= anywhere in the string.
    const url = 'https://www.youtube.com/redirect?q=https%3A%2F%2Fex.com%2F%3Fv%3Dnope';
    eq(YouTube.extractVideoId(url), null);
});
check('non-watch pages and look-alike hosts have no id', () => {
    eq(YouTube.extractVideoId('https://www.youtube.com/feed/subscriptions'), null);
    eq(YouTube.extractVideoId('https://notyoutube.com/watch?v=abc'), null);
    eq(YouTube.extractVideoId('https://example.com/watch?v=abc'), null);
});

const PageInfo = require('../src/content/page-info.js');

section('youtube channel pages');
check('a channel page is recognised in all four spellings', () => {
    eq(PageInfo.channelPagePath('/@mathwithming'), '/@mathwithming');
    eq(PageInfo.channelPagePath('/channel/UCabcdefghijklmnopqrstuv'), '/channel/UCabcdefghijklmnopqrstuv');
    eq(PageInfo.channelPagePath('/c/mathwithming'), '/c/mathwithming');
    eq(PageInfo.channelPagePath('/user/mathwithming'), '/user/mathwithming');
});
check('every tab of a channel answers with the same root', () => {
    // Otherwise the same channel files twice — once from /videos and once
    // from the home tab — and the tick never comes back on either.
    eq(PageInfo.channelPagePath('/@mathwithming/videos'), '/@mathwithming');
    eq(PageInfo.channelPagePath('/@mathwithming/streams?view=0'), '/@mathwithming');
    eq(PageInfo.channelPagePath('/@mathwithming/'), '/@mathwithming');
});
check('a watch page is not a channel page', () => {
    eq(PageInfo.channelPagePath('/watch'), '');
    eq(PageInfo.channelPagePath('/feed/subscriptions'), '');
    eq(PageInfo.channelPagePath('/playlist'), '');
    eq(PageInfo.channelPagePath('/'), '');
});

// ----------------------------------------------------------- bookmarks

const Bookmarks = require('../src/shared/bookmarks.js');

section('checkpoints');
check('a first checkpoint makes the video entry, sorted by start, and the list given is left alone', () => {
    const video = { id: 'v', title: 'V', url: 'u' };
    const first = Bookmarks.addBookmarks([], video, [{ time: 90 }, { start: 12, end: 30 }, { time: 45 }]);
    eq([first.added, first.videos.length, first.videos[0].id], [3, 1, 'v']);
    eq(first.videos[0].bookmarks.map((b) => Bookmarks.bookmarkTime(b)), [12, 45, 90]);
    const snapshot = JSON.stringify(first.videos);
    Bookmarks.addBookmarks(first.videos, video, [{ time: 20 }]);
    eq(JSON.stringify(first.videos), snapshot);
});
check('adding dedupes against every existing time, not just the last', () => {
    const videos = [{ id: 'v', title: 'V', url: 'u', bookmarks: [
        { time: 10 }, { time: 30 }, { time: 20 } ] }];
    const out = Bookmarks.addBookmarks(videos, { id: 'v', title: 'V', url: 'u' }, [{ time: 30 }]);
    eq(out.added, 0, 'a duplicate of a non-adjacent time is still a duplicate');
    eq(out.videos[0].bookmarks.length, 3);
});
check('a genuinely new time is added, and the list stays sorted', () => {
    const videos = [{ id: 'v', title: 'V', url: 'u', bookmarks: [{ time: 30 }, { time: 10 }] }];
    const out = Bookmarks.addBookmarks(videos, { id: 'v', title: 'V', url: 'u' }, [{ time: 20 }]);
    eq(out.added, 1);
    eq(out.videos[0].bookmarks.map((b) => b.time), [10, 20, 30]);
});
check('a checkpoint at t=0 is kept', () => {
    const out = Bookmarks.addBookmarks([], { id: 'v', title: 'V', url: 'u' }, [{ time: 0 }]);
    eq(out.added, 1);
    eq(out.videos[0].bookmarks.length, 1);
});
check('two checkpoints starting in the same second both survive', () => {
    // The regression test for the collision: de-duplicating by whole second
    // silently dropped the second of two highlights made close together.
    const video = { id: 'v', title: 'V', url: 'u' };
    let out = Bookmarks.addBookmarks([], video, [{ id: 'a', time: 62, start: 62.1, end: 64 }]);
    out = Bookmarks.addBookmarks(out.videos, video, [{ id: 'b', time: 62, start: 62.7, end: 66 }]);
    eq(out.added, 1);
    eq(out.videos[0].bookmarks.map((b) => b.id), ['a', 'b']);
});
check('the same id twice is one checkpoint', () => {
    const video = { id: 'v', title: 'V', url: 'u' };
    const first = Bookmarks.addBookmarks([], video, [{ id: 'a', time: 5 }]);
    const again = Bookmarks.addBookmarks(first.videos, video, [{ id: 'a', time: 90, note: 'edited elsewhere' }]);
    eq(again.added, 0, 're-importing an export added its own checkpoints a second time');
});
check('records from before ids still de-duplicate by time', () => {
    const videos = [{ id: 'v', title: 'V', url: 'u', bookmarks: [{ time: 30, start: 30, end: 34 }] }];
    const out = Bookmarks.addBookmarks(videos, { id: 'v' }, [{ time: 30, start: 30, end: 40 }]);
    eq(out.added, 0, 'two id-less records in the same second are one, as they always were');
});
check('a new checkpoint is not swallowed by an old one in the same second', () => {
    const videos = [{ id: 'v', title: 'V', url: 'u', bookmarks: [{ time: 30, start: 30, end: 34 }] }];
    eq(Bookmarks.addBookmarks(videos, { id: 'v' }, [{ id: 'n', time: 30, start: 30, end: 38 }]).added, 1);
    eq(Bookmarks.addBookmarks(videos, { id: 'v' }, [{ id: 'n', time: 30, start: 30, end: 34 }]).added, 0,
        'but the very same span is the same checkpoint');
});
check('removing by id takes the right one when three share a second', () => {
    const videos = [{ id: 'v', title: 'V', url: 'u', bookmarks: [
        { id: 'a', time: 7 }, { id: 'b', time: 7 }, { id: 'c', time: 7 } ] }];
    eq(Bookmarks.removeBookmarkById(videos, 'v', 'b')[0].bookmarks.map((b) => b.id), ['a', 'c']);
    eq(Bookmarks.removeBookmarkById(videos, 'v', 'zz'), videos, 'an unknown id changes nothing');
    eq(Bookmarks.removeBookmarkById(videos, 'nope', 'b')[0].bookmarks.length, 3, 'nor an unknown video');
});
check('an import must look like an export; a merge counts videos and checkpoints apart, and skips a bad entry', () => {
    eq([null, { videos: [] }, { version: '1.0', exportDate: 'x' }, { version: '1.0', exportDate: 'x', videos: [] }]
        .map((file) => !!Bookmarks.validateImport(file)), [false, false, false, true]);
    const video = { id: 'v', title: 'V', url: 'u' };
    const merged = Bookmarks.mergeImported(Bookmarks.addBookmarks([], video, [{ time: 10 }]).videos, [
        { id: 'v', title: 'V', bookmarks: [{ time: 10 }, { time: 20 }] },
        { id: 'w', title: 'W', bookmarks: [{ time: 5 }] },
        null,
        { title: 'no id', bookmarks: [] },
    ]);
    eq([merged.addedVideos, merged.updatedVideos, merged.addedBookmarks], [1, 1, 2]);
    const both = Bookmarks.addBookmarks([], video, [{ time: 10 }, { time: 20 }]).videos;
    const again = Bookmarks.mergeImported(both, [{ id: 'v', title: 'V', bookmarks: [{ time: 10 }, { time: 20 }] }]);
    eq([again.addedBookmarks, again.type], [0, 'warning'], 'the same file twice');
});
check('a record from before ids can still be edited and removed', () => {
    const old = { time: 12, start: 12, end: 15, timestamp: 1700000000000, note: 'n' };
    const videos = [{ id: 'v', title: 'V', url: 'u', bookmarks: [old, { id: 'x', time: 12 }] }];
    const key = Bookmarks.bookmarkKey(old);
    const edited = Bookmarks.editBookmark(videos, 'v', key, { note: 'changed' });
    eq(edited[0].bookmarks[0].note, 'changed');
    eq(Bookmarks.bookmarkKey(edited[0].bookmarks[0]), key, 'editing the note moved the handle');
    eq(Bookmarks.removeBookmarkById(edited, 'v', key)[0].bookmarks.map((b) => b.id), ['x']);
});
check('every store mints its ids in one shape: kind, time, a two-digit counter', () => {
    // Five of the six copies wrote the counter unpadded, so where the time
    // ended and the counter began was a guess.
    const Ids = require('../src/shared/ids.js');
    assert(/^xp_[0-9a-z]{8,}[0-9a-z]{2}$/.test(Ids.next('xp')), Ids.next('xp'));
    assert(/^cp_[0-9a-z]{10,}$/.test(Bookmarks.newId()), 'checkpoints keep their prefix');
});
check('ids are unique across a tight loop', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(Bookmarks.newId());
    eq(ids.size, 1000);
});
check('removing the last checkpoint drops the video entry', () => {
    const videos = [{ id: 'v', title: 'V', url: 'u', bookmarks: [{ id: 'a', time: 5 }] }];
    eq(Bookmarks.removeBookmarkById(videos, 'v', 'a').length, 0);
});
check('a merge swaps several checkpoints for one in a single write, and its undo swaps them back', () => {
    const before = [{ id: 'v', title: 'V', url: 'u', bookmarks: [
        { id: 'a', time: 5, start: 5, end: 6 }, { id: 'b', time: 7, start: 7, end: 8 }, { id: 'c', time: 30 }] }];
    const joined = { id: 'a', time: 5, start: 5, end: 8, note: 'one passage' };
    const merged = Bookmarks.replaceBookmarks(before, { id: 'v' }, ['a', 'b'], [joined]);
    eq(merged[0].bookmarks.map((b) => [b.id, b.end]), [['a', 8], ['c', undefined]]);
    eq(before[0].bookmarks.length, 3, 'the list it was given was changed in place');
    const undone = Bookmarks.replaceBookmarks(merged, { id: 'v' }, ['a'], before[0].bookmarks.slice(0, 2));
    eq(undone[0].bookmarks.map((b) => b.id), ['a', 'b', 'c']);
    eq(Bookmarks.replaceBookmarks(merged, { id: 'v' }, ['a', 'c'], []).length, 0, 'an emptied video stayed');
    const fresh = Bookmarks.replaceBookmarks([], { id: 'w', title: 'W', url: 'uw' }, [], [{ id: 'n', time: 1 }]);
    eq([fresh[0].id, fresh[0].title, fresh[0].bookmarks.length], ['w', 'W', 1]);
    eq(Bookmarks.replaceBookmarks([], { id: 'w' }, ['x'], []), [], 'nothing to swap made an entry');
    eq(Bookmarks.replaceBookmarks(merged, { id: 'v' }, [], [{ id: 'c', time: 30 }])[0].bookmarks.length, 2,
        'a record already there was added twice');
});
check('the popup and the dashboard edit checkpoints by key, through the store, never by index', () => {
    // Both used to change the list they had loaded, by index, and save the
    // whole of it back — erasing a checkpoint a YouTube tab saved meanwhile.
    for (const file of ['popup.js', 'dashboard.js']) {
        const source = require('fs').readFileSync(`${__dirname}/../${file}`, 'utf8');
        assert(!/bookmarkIndex|data-bookmark-index/.test(source), `${file} still addresses a checkpoint by index`);
        assert(/Bookmarks\.commit\(\(videos\) => Bookmarks\.removeBookmarkById\(/.test(source), `${file} deletes around commit`);
        eq((source.match(/Bookmarks\.save\(/g) || []).length, file === 'dashboard.js' ? 1 : 0, `${file}: save is for clearing all only`);
    }
});
check('timestamp links parse out of pasted text, one per line', () => {
    const found = Bookmarks.parseTimestampLinks(
        'https://youtu.be/abcdefghijk?t=90' + String.fromCharCode(10) +
        'https://www.youtube.com/watch?v=abcdefghijk&t=2m30s');
    eq(found.length, 1, 'both links are the same video, so one entry');
    eq(found[0].bookmarks.map((b) => b.time), [90, 150]);
    const twoWays = Bookmarks.parseTimestampLinks('https://youtu.be/abc?t=1m\nhttps://www.youtube.com/watch?v=abc&t=60');
    eq(twoWays[0].bookmarks.length, 1, 'one instant written two ways');
    eq(Bookmarks.parseTimestampLinks('not a link\nhttps://example.com/watch?v=abc\n'), []);
});

// ------------------------------------------------------ reader transcript

globalThis.BB = globalThis.BB || {};
globalThis.BB.Dom = globalThis.BB.Dom || require('../src/shared/dom.js');
const ReaderTranscript = require('../src/content/reader-transcript.js');
const { FetchedTranscript } = require('../src/shared/transcript.js');

/** Snippets in the shape transcript.js hands over. */
const SNIPPETS = [
    { text: 'first  line', start: 0, duration: 2.5 },
    { text: '', start: 2.5, duration: 0.5 },
    { text: 'second <line>', start: 3, duration: 2 },
    { text: 'third line', start: 6, duration: 3 },
];

section('reader — the transcript column');
check('blank snippets are left out and the text is tidied', () => {
    const entries = ReaderTranscript.entriesOf({ snippets: SNIPPETS });
    eq(entries.map((e) => e.text), ['first line', 'second <line>', 'third line']);
    eq(entries[2], { start: 6, end: 9, text: 'third line' });
    eq(ReaderTranscript.entriesOf(null), []);
});
check('the word playing is the last one started, pauses included', () => {
    const model = ReaderTranscript.build(ReaderTranscript.entriesOf({ snippets: SNIPPETS }));
    eq(ReaderTranscript.wordAt(model, -1), -1);
    eq(ReaderTranscript.wordAt(model, 0), 0);
    eq(model.words[ReaderTranscript.wordAt(model, 5.5)].t, '<line>', 'a pause in speech lost the word');
    eq(model.words[ReaderTranscript.wordAt(model, 6)].t, 'third');
    eq(ReaderTranscript.wordAt(model, 6), ReaderTranscript.wordAt(model, 6), 'unstable at one time');
});
check('at a line boundary it agrees with the transcript’s own lookup', () => {
    const snippets = SNIPPETS.filter((one) => one.text);
    const transcript = new FetchedTranscript({ snippets, videoId: 'v', language: 'en', languageCode: 'en' });
    const model = ReaderTranscript.build(ReaderTranscript.entriesOf(transcript));
    for (const t of [0, 3, 6]) {
        const word = model.words[ReaderTranscript.wordAt(model, t)];
        eq(transcript.getSnippetAtTime(t).text.replace(/\s+/g, ' ').startsWith(word.t), true, `at ${t}`);
    }
});

section('reader — paragraphs and words');

/** A talk in lines the way a caption track has them, with a full stop now and then. */
function talkEntries() {
    const lines = [
        'So here is the idea.', 'Solve each part once,', 'write the answer down,', 'and look it up.',
        'That is memoization.', 'The other way', 'is to fill a table', 'from the bottom up.',
        'Both are linear', 'for Fibonacci.', 'Now the hard part', 'is the subproblem.',
    ];
    return lines.map((text, i) => ({ start: i * 4, end: i * 4 + 3.5, text }));
}

check('lines are gathered into paragraphs at a sentence end once one has run long enough', () => {
    const model = ReaderTranscript.build(talkEntries());
    // The line before 16s ends a sentence, and by 16s the first paragraph has run 15.
    eq(model.paras.map((p) => p.start), [0, 16, 32]);
    eq(ReaderTranscript.textOf(model, model.paras[1].from, model.paras[1].to),
        'That is memoization. The other way is to fill a table from the bottom up.');
    eq(model.paras.every((p, i) => !i || p.from === model.paras[i - 1].to + 1), true, 'a word fell between two paragraphs');
});
check('a track with no full stops still breaks, and a chapter starts a paragraph', () => {
    const plain = Array.from({ length: 30 }, (_, i) => ({ start: i * 3, end: i * 3 + 3, text: 'and so on we go' }));
    const model = ReaderTranscript.build(plain);
    assert(model.paras.length >= 2, 'one paragraph for ninety seconds');
    assert(model.paras.every((p) => model.words[p.to].time - p.start <= ReaderTranscript.PARA_MAX + 3), 'a paragraph ran on');
    const chaptered = ReaderTranscript.build(talkEntries(), { chapters: [{ start: 0 }, { start: 4 }] });
    eq(chaptered.paras.map((p) => p.start).slice(0, 2), [0, 4], 'the chapter at 4s did not open a paragraph');
    // 8s is mid-sentence: the paragraph waits for the sentence to end at 16s
    // rather than opening on "write the answer down,".
    const waited = ReaderTranscript.build(talkEntries(), { chapters: [{ start: 8 }] });
    eq(waited.paras.map((p) => p.start).slice(0, 2), [0, 16]);
    const unstopped = ReaderTranscript.build(plain, { chapters: [{ start: 10 }] });
    eq(unstopped.paras[1].start, 18, 'with no stop in sight it waits only CHAPTER_SLACK');
});
check('sentences end at their stop, and an unpunctuated one at a line once it runs long', () => {
    const model = ReaderTranscript.build(talkEntries());
    eq(ReaderTranscript.textOf(model, model.sentences[1].from, model.sentences[1].to),
        'Solve each part once, write the answer down, and look it up.');
    const plain = Array.from({ length: 12 }, (_, i) => ({ start: i * 3, end: i * 3 + 3, text: 'one two three four five six seven' }));
    const long = ReaderTranscript.build(plain);
    assert(long.sentences.every((x) => x.to - x.from + 1 <= ReaderTranscript.SENTENCE_HARD), 'a sentence too long for the band');
    assert(long.sentences.length > 1, 'an unpunctuated track was one sentence');
});
check('words are spread over their line by length, and each ends where the next begins', () => {
    const model = ReaderTranscript.build([{ start: 10, end: 14, text: 'a bb' }]);
    // "bb" starts two characters into four: halfway through the line.
    eq(model.words.map((w) => w.time), [10, 12]);
    eq(model.words.map((w) => w.end), [12, 14], 'the last word did not end with its line');
    eq(ReaderTranscript.wordAt(model, 9), -1);
    eq(ReaderTranscript.wordAt(model, 10.5), 0);
    eq(ReaderTranscript.wordAt(model, 13), 1);
});
check('a highlight saved from some words maps back onto exactly those words', () => {
    const model = ReaderTranscript.build(talkEntries());
    for (const [from, to] of [[0, 0], [3, 9], [10, 11], [5, model.words.length - 1]]) {
        eq(ReaderTranscript.rangeOf(model, ReaderTranscript.spanOf(model, from, to)), { from, to }, `${from}-${to}`);
    }
});
check('an older checkpoint covers what was said while it ran', () => {
    const model = ReaderTranscript.build(talkEntries());
    // Ctrl+B held from 4.6s to 12.2s, floored to the second as it was saved.
    const held = ReaderTranscript.rangeOf(model, { time: 4, start: 4, end: 12 });
    eq(ReaderTranscript.textOf(model, held.from, held.to), 'Solve each part once, write the answer down,');
    const point = ReaderTranscript.rangeOf(model, { time: 9 });
    eq(ReaderTranscript.textOf(model, point.from, point.to), 'write the answer down,', 'a point covers its line');
    eq(ReaderTranscript.rangeOf(model, { start: 200, end: 210 }), null, 'past the end of the talk');
    eq(ReaderTranscript.rangeOf(model, { note: 'no time' }), null);
    const tiny = ReaderTranscript.rangeOf(model, { start: 4.1, end: 4.2 });
    eq(tiny.from, tiny.to, 'a span between two words is the word it began in');
});
check('a range folds in every highlight it touches, and only those', () => {
    const marks = [{ id: 'a', from: 2, to: 4, note: 'first' }, { id: 'b', from: 6, to: 7, note: '' },
        { id: 'c', from: 12, to: 14, note: 'third' }];
    eq(ReaderTranscript.merge(marks, { from: 9, to: 10 }), { from: 9, to: 10, note: '', keep: null, absorbed: [], merged: false });
    // 5 sits between a and b: touching both, so all three become one.
    eq(ReaderTranscript.merge(marks, { from: 5, to: 5 }), { from: 2, to: 7, note: 'first', keep: 'a', absorbed: ['b'], merged: true });
    eq(ReaderTranscript.merge(marks, { from: 8, to: 11 }).absorbed, ['c'], 'a word apart on either side is touching');
    const trimmed = ReaderTranscript.merge(marks, { from: 13, to: 14 }, 'c');
    eq([trimmed.from, trimmed.to, trimmed.keep, trimmed.note, trimmed.merged], [13, 14, 'c', 'third', false], 'a trim grew back');
});
check('a note Bell Bearer wrote is not shown as the user’s', () => {
    eq(ReaderTranscript.ownNote('Checkpoint 1:02 - 1:15'), '');
    eq(ReaderTranscript.ownNote('Segment: 0:10 - 0:20'), '');
    eq(ReaderTranscript.ownNote('  Name the subproblem first. '), 'Name the subproblem first.');
    eq(ReaderTranscript.ownNote(undefined), '');
});
check('the paragraphs are escaped, and a space carries the word before it', () => {
    const model = ReaderTranscript.build([{ start: 0, end: 2, text: 'say <b>hi</b>' }]);
    const html = ReaderTranscript.paragraphsHtml(model);
    assert(html.includes('&lt;b&gt;hi&lt;/b&gt;'), 'a caption could inject markup');
    assert(html.includes('<span class="rd-sp" data-w="0"> </span>'), 'the space lost its word');
    assert(/data-t="0"/.test(html) && html.includes('0:00'), 'no time in the gutter');
});
section('reader — the pen');

const ReaderHighlights = require('../src/content/reader-highlights.js');

check('a highlight is named by its span, and a point by its one time', () => {
    eq(ReaderHighlights.spanLabel({ start: 62.4, end: 75 }), '1:02–1:15');
    eq(ReaderHighlights.spanLabel({ time: 90 }), '1:30');
    eq(ReaderHighlights.spanLabel({ time: 90, start: 90, end: 90 }), '1:30', 'a span of nothing is a point');
});
check('a highlight’s title is its opening words, cut at sixty', () => {
    eq(ReaderHighlights.autoTitle('short'), 'short');
    const long = 'x'.repeat(80);
    eq(ReaderHighlights.autoTitle(long), `${'x'.repeat(59)}…`);
    eq(ReaderHighlights.autoTitle(long).length, 60);
});
check('the pen is drawn in the skin’s ink, and both cursors fall back to the browser’s', () => {
    const { pen, eraser } = ReaderHighlights.cursors('#ff48b0');
    assert(decodeURIComponent(pen).includes('#ff48b0'), 'the pen is not in the ink');
    assert(/\) 8 20, text$/.test(pen) && /\) 8 20, default$/.test(eraser), 'no fallback cursor');
    eq([pen.match(/"/g).length, eraser.match(/"/g).length], [2, 2], 'a quote inside the svg would end the url');
});

section('reader — the five layouts');

const ReaderLayout = require('../src/content/reader-layout.js');

check('at 1280 by 760 each layout puts the player and the transcript where the design does', () => {
    const at = (layout, state) => ReaderLayout.geometry(layout, 1280, 760, state);
    eq(at('dock').video, { left: 16, top: 54, width: 797, height: 448 });
    eq(at('dock').panel, { left: 829, top: 54, width: 435, height: 690 });
    eq(at('dock').under.top, 518, 'the title and chapters are not under the video');
    eq(at('float').panel, { left: 887, top: 70, width: 371, height: 598 });
    eq(at('glass').panel.left, 973);
    eq(at('glass').bar, { left: 973, top: 0, width: 307, height: 52 }, 'glass keeps its tools over the column');
    eq(at('band').video, { left: 166, top: 54, width: 949, height: 534 });
    eq(at('band').panel, { left: 166, top: 600, width: 949, height: 144 });
    eq(at('band', { bandOpen: true }).panel.height, 456, 'the band does not open to two thirds');
    eq(at('focus').video, { left: 748, top: 451, width: 510, height: 287 });
    eq(at('focus').panel, { left: 20, top: 48, width: 692, height: 712 });
    eq(['dock', 'float', 'glass', 'band', 'focus'].map((id) => at(id).tabs), [true, true, false, false, false]);
    eq(at('glass').barTitle, false);
});
check('at any size the player is 16:9 and every piece is on the screen', () => {
    for (const [W, H] of [[800, 500], [1280, 760], [1440, 900], [1920, 1080], [2560, 1300]]) {
        for (const id of ReaderLayout.LAYOUT_IDS) {
            const g = ReaderLayout.geometry(id, W, H);
            const where = `${id} at ${W}x${H}`;
            assert(Math.abs(g.video.width / g.video.height - 16 / 9) < 0.02, `${where}: the player is not 16:9`);
            for (const piece of [g.video, g.panel, g.under, g.side].filter(Boolean)) {
                assert(piece.left >= 0 && piece.top >= 0 && piece.left + piece.width <= W && piece.top + piece.height <= H,
                    `${where}: ${JSON.stringify(piece)} is off the screen`);
            }
        }
    }
});
check('a docked video and its column stand clear of the bar, and level with each other', () => {
    // Both started on the bar's last pixel, where a skin rules the bar off.
    for (const [W, H] of [[800, 500], [1280, 760], [1920, 1080]]) {
        const g = ReaderLayout.geometry('dock', W, H);
        eq([g.video.top, g.panel.top], [ReaderLayout.BAR + ReaderLayout.BAR_GAP, ReaderLayout.BAR + ReaderLayout.BAR_GAP]);
        eq(g.panel.top + g.panel.height, H - 16, 'the gap came off the foot of the column, not its top');
    }
    assert(ReaderLayout.BAR_GAP > 0 && ReaderLayout.BAR_GAP <= 8, 'a breath, not a band');
});
check('focus gives its pinned player two fifths of the reader, beside the transcript', () => {
    // It had a third, and what was on the screen was too small to follow.
    for (const [W, H] of [[1280, 760], [1440, 900], [1920, 1080]]) {
        const g = ReaderLayout.geometry('focus', W, H);
        assert(g.video.width / W >= 0.39, `${W}: the player is ${g.video.width} wide`);
        assert(g.panel.left >= 0 && g.panel.left + g.panel.width < g.video.left, `${W}: the transcript runs under the player`);
        eq([g.side.left, g.side.width], [g.video.left, g.video.width], 'the highlights and the player are not one column');
    }
});
check('the float card and the glass column have no gutter: their times sit between paragraphs', () => {
    eq(ReaderLayout.LAYOUT_IDS.map((id) => ReaderLayout.geometry(id, 1280, 760).type.gutter > 0),
        [true, false, false, true, true]);
});
check('a card or a pinned player dragged past the edge stops at it', () => {
    const far = { dx: 5000, dy: -5000 };
    const card = ReaderLayout.geometry('float', 1280, 760, { card: far }).panel;
    eq([card.left + card.width, card.top], [1280, ReaderLayout.BAR]);
    const pinned = ReaderLayout.geometry('focus', 1280, 760, { vcard: { dx: -5000, dy: 5000 } }).video;
    eq([pinned.left, pinned.top + pinned.height], [0, 760]);
});
check('an old layout opens in the one nearest it, and an unknown one in dock', () => {
    eq(['split', 'stacked', 'theatre', 'focus', 'band', 'nope', undefined].map(ReaderLayout.layoutOf),
        ['dock', 'band', 'glass', 'focus', 'band', 'dock', 'dock']);
});
check('the typography settings scale each layout’s type, and the measure narrows focus', () => {
    const plain = ReaderLayout.geometry('focus', 1600, 900);
    const set = ReaderLayout.geometry('focus', 1600, 900, { scale: 18 / 16, leadScale: 1.8 / 1.6, measure: 30 });
    eq([plain.type.size, plain.type.lead], [19, 1.72]);
    eq([set.type.size, set.type.lead], [21.4, 1.94]);
    assert(set.panel.width < plain.panel.width, 'a shorter line did not narrow the column');
    eq(ReaderLayout.geometry('dock', 1280, 760, { scale: 0.75 }).type.size, 12);
});

section('transcripts');
{
    const { TranscriptError, TimeIndex, FetchedTranscriptSnippet } = require('../src/shared/transcript.js');

    check('no captions, an unplayable video or no matching language is expected; anything else is loud', () => {
        const e = new TranscriptError(TranscriptError.NO_CAPTIONS, 'No captions available for this video', true);
        eq([e.code, e.expected, e.name, e instanceof Error], ['NO_CAPTIONS', true, 'TranscriptError', true]);
        eq(new TranscriptError(TranscriptError.NOT_PLAYABLE, 'x', true).expected, true);
        eq(new TranscriptError(TranscriptError.NO_LANGUAGE, 'x', true).expected, true);
        eq(new TranscriptError(TranscriptError.IP_BLOCKED, 'blocked').expected, false);
        eq(new TranscriptError(TranscriptError.FETCH_FAILED, 'http 500').expected, false);
        eq(new TranscriptError('SOMETHING_NEW', 'x').expected, false, 'unexpected by default');
        const codes = ['NO_CAPTIONS', 'NOT_PLAYABLE', 'NO_LANGUAGE', 'IP_BLOCKED', 'FETCH_FAILED'].map((name) => TranscriptError[name]);
        eq(new Set(codes).size, codes.length);
        assert(codes.every((code) => typeof code === 'string' && code), 'a code is empty');
    });
    check('the time index finds the snippet at a time, or the one before, sorting what it is given', () => {
        const idx = new TimeIndex([
            new FetchedTranscriptSnippet('third', 10, 5),
            new FetchedTranscriptSnippet('first', 0, 5),
            new FetchedTranscriptSnippet('second', 5, 5),
            new FetchedTranscriptSnippet('fourth', 20, 5),
        ]);
        eq([0, 7, 12.5].map((t) => idx.getSnippetAtTime(t).text), ['first', 'second', 'third']);
        eq([idx.getSnippetAtTime(17), idx.getSnippetAtTime(-1)].map(Boolean), [false, false], 'in the gap, before the start');
        eq([idx.getSnippetAtOrBefore(17).text, idx.getSnippetAtOrBefore(100).text], ['third', 'fourth']);
        assert(idx.getSnippetsInRange(4, 12).some((s) => s.text === 'second'), 'the range missed what overlaps it');
        const empty = new TimeIndex([]);
        eq([empty.getSnippetAtTime(0), empty.getSnippetAtOrBefore(0)].map(Boolean), [false, false]);
    });
}
checkAsync('a transcript asked for by language is its own fetch, and tracks are listed once', async () => {
    const asked = [];
    let listed = 0;
    const real = globalThis.BB.TranscriptApi;
    globalThis.BB.TranscriptApi = { YouTubeTranscriptApi: class {
        fetch(id, { languages }) {
            asked.push(languages.join(','));
            return Promise.resolve({ videoId: id, languageCode: languages[0], language: languages[0], snippets: [] });
        }
        listTranscripts() {
            listed++;
            return Promise.resolve([
                { languageCode: 'en', language: 'English' },
                { languageCode: 'en', language: 'English', isGenerated: true },
                { languageCode: 'de', language: 'German', isGenerated: true },
            ]);
        }
    } };
    try {
        const Transcripts = require('../src/content/transcripts.js');
        const wrapper = Transcripts.createTranscripts({ getPreferredLanguage: () => 'en', notify() {} });
        const plain = await wrapper.fetch('v');
        const german = await wrapper.fetch('v', { language: 'de' });
        assert(plain !== german, 'the German track replaced the default one');
        await wrapper.fetch('v', { language: 'de' });
        eq(asked, ['en,en', 'de'], 'a cached language was fetched again');

        eq(await wrapper.list('v'), [
            { code: 'en', label: 'English' },
            { code: 'de', label: 'German (auto-generated)' },
        ], 'one entry per language, the way fetch picks it');
        await wrapper.list('v');
        eq(listed, 1);
    } finally {
        globalThis.BB.TranscriptApi = real;
    }
});
// Both of these swap the global fetch, so the second waits for the first.
const keyFromPage = checkAsync('the transcript api key is read off the page it runs in, not fetched in a second copy of it', async () => {
    // Every YouTube tab fetched a whole watch page — about a megabyte — to
    // read one string its own document already carried.
    const { YouTubeTranscriptApi } = require('../src/shared/transcript.js');
    const api = new YouTubeTranscriptApi();
    const page = { scripts: [
        { src: 'https://www.youtube.com/s/player/base.js', textContent: '' },
        { src: '', textContent: 'var ytInitialData = {}' },
        { src: '', textContent: 'ytcfg.set({"CLIENT_CANARY_STATE":"none","INNERTUBE_API_KEY":"AIzaTest_-1"});' },
    ] };
    eq([api._keyFromPage(page), api._keyFromPage({ scripts: [] }), api._keyFromPage(null)], ['AIzaTest_-1', null, null]);

    const saved = { document: globalThis.document, fetch: globalThis.fetch, key: YouTubeTranscriptApi._apiKey };
    let fetched = 0;
    globalThis.fetch = async () => { fetched++; return { ok: true, text: async () => '"INNERTUBE_API_KEY":"AIzaFetched"' }; };
    try {
        globalThis.document = page;
        YouTubeTranscriptApi._apiKey = null;
        eq([await api._getInnertubeApiKey('v'), fetched], ['AIzaTest_-1', 0]);
        globalThis.document = { scripts: [] };
        YouTubeTranscriptApi._apiKey = null;
        eq([await api._getInnertubeApiKey('v'), fetched], ['AIzaFetched', 1], 'anywhere else it is still fetched');
    } finally {
        Object.assign(globalThis, { document: saved.document, fetch: saved.fetch });
        YouTubeTranscriptApi._apiKey = saved.key;
    }
});
keyFromPage.then(() => checkAsync('a translated transcript is labelled with what was fetched, and an untranslatable one is refused', async () => {
    // A track YouTube cannot translate came back in its own language under
    // the target's label, so a second subtitle line repeated the first.
    const { YouTubeTranscriptApi, TranscriptError } = require('../src/shared/transcript.js');
    const api = new YouTubeTranscriptApi();
    const urls = [];
    const saved = globalThis.fetch;
    globalThis.fetch = async (url) => { urls.push(url); return { ok: true, text: async () => '<text start="1" dur="2">hola</text>' }; };
    const track = (languageCode, isTranslatable, translationLanguages) => ({
        languageCode, language: languageCode, baseUrl: `https://yt/${languageCode}?v=1`, isTranslatable, translationLanguages,
    });
    const rejection = (promise) => promise.then(() => null, (error) => [error.code, error.expected]);
    try {
        api.listTranscripts = async () => [track('en', false, [])];
        eq(await rejection(api.fetch('v', { translateTo: 'es' })), [TranscriptError.NO_LANGUAGE, true]);
        eq(urls, [], 'the untranslated track was fetched anyway');

        api.listTranscripts = async () => [track('en', true, [{ languageCode: 'es', language: 'Spanish' }])];
        const translated = await api.fetch('v', { translateTo: 'es' });
        eq([translated.language, translated.languageCode, urls.pop()], ['Spanish', 'es', 'https://yt/en?v=1&tlang=es']);
        eq(await rejection(api.fetch('v', { translateTo: 'de' })), [TranscriptError.NO_LANGUAGE, true], 'a language it does not offer');

        api.listTranscripts = async () => [track('es', false, [])];
        const own = await api.fetch('v', { languages: ['es'], translateTo: 'es' });
        eq([own.languageCode, urls.pop()], ['es', 'https://yt/es?v=1'], 'already in the language asked for');
    } finally {
        globalThis.fetch = saved;
    }
}));
section('copying out as markdown');
check('checkpoints copy out as a timestamped markdown list', () => {
    globalThis.BB.YouTube = globalThis.BB.YouTube || require('../src/shared/youtube.js');
    const Markdown = require('../src/content/markdown.js');
    const Time = require('../src/shared/time.js');
    const text = Markdown.checkpointList({ id: 'abcdefghijk', title: 'A [talk]' }, [
        { time: 62, start: 62.4, end: 75, subtitle: 'the  point', note: 'worth rewatching' },
        { time: 90, start: 90, end: 95, subtitle: 'later', note: 'Checkpoint 1:30 - 1:35' },
    ], Time.formatTime);
    eq(text.split('\n'), [
        '## [A \\[talk\\]](https://www.youtube.com/watch?v=abcdefghijk)',
        '',
        '- [1:02–1:15](https://www.youtube.com/watch?v=abcdefghijk&t=62s) the point',
        '  - worth rewatching',
        '- [1:30–1:35](https://www.youtube.com/watch?v=abcdefghijk&t=90s) later',
    ], 'the generated "Checkpoint 1:30" note only repeats the time beside it');
    eq(Markdown.checkpointList({ id: 'abcdefghijk', title: 'T' }, [{ time: 5 }], Time.formatTime).split('\n')[2],
        '- [0:05](https://www.youtube.com/watch?v=abcdefghijk&t=5s)', 'a point in time is one time');
});
check('a link\'s address cannot end the link early, and a balanced pair is left as it is', () => {
    const Markdown = require('../src/content/markdown.js');
    eq(Markdown.escapeUrl('https://en.wikipedia.org/wiki/Foo_(bar)'), 'https://en.wikipedia.org/wiki/Foo_(bar)');
    eq(Markdown.escapeUrl('https://example.com/a)b'), 'https://example.com/a%29b');
    eq(Markdown.escapeUrl('https://example.com/(a'), 'https://example.com/%28a');
    eq(Markdown.escapeUrl('https://example.com/)('), 'https://example.com/%29%28', 'closed before it opened');
    eq(Markdown.escapeUrl('file:///C:/my notes.txt'), 'file:///C:/my%20notes.txt');
});

// ------------------------------------------------------- text anchors

const TextAnchor = require('../src/shared/text-anchor.js');

section('text reader — a highlight in the article\'s text');

const ARTICLE = 'The cache forgets. It forgets the oldest\n  entry first, and the oldest entry is rarely the one you want.';
check('a stroke let go inside a word takes the word, and none of the space around it', () => {
    const at = ARTICLE.indexOf('orgets.');
    eq(TextAnchor.snap(ARTICLE, at, at + 3), { start: at - 1, end: at + 6 });
    const span = TextAnchor.snap(ARTICLE, ARTICLE.indexOf(' It') - 1, ARTICLE.indexOf('oldest') + 2);
    eq(ARTICLE.slice(span.start, span.end), '. It forgets the oldest');
    const gap = ARTICLE.indexOf('\n');
    eq(TextAnchor.snap(ARTICLE, gap, gap + 3), null, 'a stroke over nothing but space is no highlight');
    eq(TextAnchor.snap("we don't know", 4, 6), { start: 3, end: 8 }, 'an apostrophe inside a word is the word');
    eq(TextAnchor.snap('naïve café', 1, 2), { start: 0, end: 5 }, 'any script\'s letters are a word\'s');
});
check('highlights that touch, overlap or stand a space apart become one, their notes kept', () => {
    const text = 'one two three four five six';
    const a = { id: 'a', start: 0, end: 3, note: 'first' };
    const c = { id: 'c', start: 19, end: 23, note: '' };
    const { marks, made } = TextAnchor.merge([a, c], { id: 'b', start: 4, end: 13, note: 'second' }, text);
    eq(marks.map((m) => [m.start, m.end]), [[0, 13], [19, 23]]);
    eq([made.exact, made.note], ['one two three', 'first\n\nsecond']);
    eq(TextAnchor.merge(marks, { id: 'd', start: 14, end: 18 }, text).marks.length, 1, 'a word between two highlights joins them');
    eq(TextAnchor.merge([c], { id: 'e', start: 0, end: 3 }, text).marks.map((m) => m.id), ['e', 'c'], 'kept in the order they read');
    const paras = 'end of one\nstart of two';
    eq(TextAnchor.merge([{ id: 'p', start: 7, end: 10 }], { id: 'q', start: 11, end: 16 }, paras).marks.length, 2,
        'the last words of a paragraph and the first of the next are two passages');
});
check('a highlight is found again where its words went, and is gone where they did', () => {
    const mark = { start: 4, end: 7, exact: 'two' };
    eq(TextAnchor.locate('one two three', mark), { start: 4, end: 7 });
    eq(TextAnchor.locate('zero one two three', mark), { start: 9, end: 12 }, 'text came in before it');
    eq(TextAnchor.locate('two one two', { start: 8, end: 11, exact: 'two' }), { start: 8, end: 11 });
    eq(TextAnchor.locate('two one xxx two', { start: 9, end: 12, exact: 'two' }), { start: 12, end: 15 }, 'the nearer of two');
    eq(TextAnchor.locate('one three', mark), null, 'drawn over the wrong words');
});
check('a link to a passage names it so a browser can find it, and says which where it occurs twice', () => {
    const text = 'Cache lines are 64 bytes. A cache-friendly loop, for one, walks memory in order.';
    const at = text.indexOf('cache-friendly');
    eq(TextAnchor.fragment(text, at, at + 'cache-friendly loop, for one'.length), '#:~:text=cache%2Dfriendly%20loop%2C%20for%20one',
        'its own hyphen and comma read as the syntax');
    const long = 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12';
    eq(TextAnchor.fragment(long, 0, long.length), '#:~:text=w1%20w2%20w3%20w4%20w5,w8%20w9%20w10%20w11%20w12');
    const twice = 'the end. And the end of it.';
    eq(TextAnchor.fragment(twice, 13, 20), '#:~:text=the%20end.%20And-,the%20end,-of%20it.');
    eq(TextAnchor.fragment('  ', 0, 2), '');
});

// ------------------------------------------------------------ x threads

const XThread = require('../src/shared/x-thread.js');

section('x threads — the conversation x sent, read as the author\'s thread');

/** A post as X's GraphQL answers with one: the new shape of user unless `oldUser`. */
function xPost({ id, by = 'ada', text = `post ${id}`, replyTo = null, replyToHandle = '', conversation = '100', note = null,
    entities = {}, range = null, media = null, replies = 0, oldUser = false, wrap = false }) {
    const user = oldUser
        ? { __typename: 'User', rest_id: `u-${by}`, legacy: { screen_name: by, name: by.toUpperCase(), profile_image_url_https: 'https://pbs.twimg.com/a.jpg' } }
        : { __typename: 'User', rest_id: `u-${by}`, core: { screen_name: by, name: by.toUpperCase() }, legacy: {} };
    const post = {
        __typename: 'Tweet',
        rest_id: id,
        core: { user_results: { result: user } },
        legacy: {
            full_text: text, created_at: 'Wed Oct 01 10:00:00 +0000 2025', conversation_id_str: conversation, lang: 'en',
            in_reply_to_status_id_str: replyTo, in_reply_to_screen_name: replyToHandle, reply_count: replies,
            entities, display_text_range: range || [0, Array.from(text).length],
            ...(media ? { extended_entities: { media } } : {}),
        },
        ...(note ? { note_tweet: { note_tweet_results: { result: { text: note, entity_set: {} } } } } : {}),
    };
    return wrap ? { __typename: 'TweetWithVisibilityResults', tweet: post } : post;
}

const xItem = (result) => ({ itemContent: { itemType: 'TimelineTweet', tweet_results: { result } } });
const xCursor = (cursorType) => ({ itemContent: { itemType: 'TimelineTimelineCursor', cursorType } });
/** A TweetDetail response: the focal entry, then a module per chain, as X lays a conversation out. */
function xDetail(entries) {
    return { data: { threaded_conversation_with_injections_v2: { instructions: [{ type: 'TimelineAddEntries', entries: entries.map((entry, i) => (Array.isArray(entry)
        ? { entryId: `conversationthread-${i}`, content: { entryType: 'TimelineTimelineModule', items: entry.map((item, j) => ({ entryId: `item-${j}`, item })) } }
        : { entryId: `tweet-${i}`, content: { entryType: 'TimelineTimelineItem', ...entry } })) }] } } };
}

check('a post\'s text: the long one whole, its reply mentions and media link left out, its links where they go', () => {
    eq(XThread.normalize(xPost({ id: '1', text: 'short', note: 'the whole long text' })).segments, [{ type: 'text', text: 'the whole long text' }],
        'a long post was cut at 280 characters');
    const reply = XThread.normalize(xPost({ id: '2', text: '@bob @cy fair point https://t.co/m', range: [9, 19],
        entities: { user_mentions: [{ screen_name: 'bob', indices: [0, 4] }, { screen_name: 'cy', indices: [5, 8] }] } }));
    eq(reply.segments, [{ type: 'text', text: 'fair point' }]);
    // The emoji is two UTF-16 units and one code point: sliced as a string,
    // the link came out a character early and took the space before it.
    const text = '😀 see https://t.co/x &amp; more';
    const post = XThread.normalize(xPost({ id: '3', text, entities: { urls: [{ url: 'https://t.co/x', expanded_url: 'https://example.com/a', display_url: 'example.com/a', indices: [6, 20] }] } }));
    eq(post.segments, [{ type: 'text', text: '😀 see ' }, { type: 'link', text: 'example.com/a', href: 'https://example.com/a' }, { type: 'text', text: ' & more' }]);
    eq([post.author.handle, XThread.normalize(xPost({ id: '4', oldUser: true })).author.handle], ['ada', 'ada'], 'one of the two shapes of a user');
});

check('a post\'s media: photos large, a video\'s mp4 no wider than a column needs, and nothing from anywhere else', () => {
    const [photo, video, gif, stray] = XThread.mediaOf({ extended_entities: { media: [
        { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/A.jpg', ext_alt_text: 'a cat', original_info: { width: 800, height: 600 } },
        { type: 'video', media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/B.jpg', video_info: { variants: [
            { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/ext_tw_video/1/pu/pl/B.m3u8' },
            { content_type: 'video/mp4', bitrate: 256000, url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/480x270/a.mp4' },
            { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/b.mp4' },
            { content_type: 'video/mp4', bitrate: 10368000, url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1920x1080/c.mp4' }] } },
        { type: 'animated_gif', media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/C.jpg', video_info: { variants: [
            { content_type: 'video/mp4', bitrate: 0, url: 'https://video.twimg.com/tweet_video/C.mp4' }] } },
        { type: 'photo', media_url_https: 'https://evil.example/D.jpg' },
    ] } });
    eq([photo.type, photo.url, photo.alt], ['photo', 'https://pbs.twimg.com/media/A.jpg?name=large', 'a cat']);
    eq([video.type, video.url, video.poster], ['video', 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/b.mp4', 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/B.jpg']);
    eq([gif.type, gif.url], ['gif', 'https://video.twimg.com/tweet_video/C.mp4']);
    eq(stray, undefined, 'a picture from another host was kept');
});

check('the thread is the author\'s own chain, from its first post, wherever the page was opened on it', () => {
    const response = xDetail([
        xItem(xPost({ id: '100', by: 'bob', text: 'a question' })),
        [xItem(xPost({ id: '101', replyTo: '100', replyToHandle: 'bob', text: 'first' }))],
        [xItem(xPost({ id: '102', replyTo: '101', text: 'second', wrap: true })), xItem(xPost({ id: '103', by: 'cy', replyTo: '102', text: 'interjection' }))],
        [xItem(xPost({ id: '104', replyTo: '102', text: 'third' })), xItem(xPost({ id: '105', replyTo: '103', text: 'an answer to cy' }))],
        [xItem({ __typename: 'TweetTombstone', tombstone: { text: { text: 'This post is unavailable.' } } })],
    ]);
    const { posts, heldAfter } = XThread.parse(response);
    const read = XThread.unroll(posts, '102', { heldAfter });
    eq(read.thread.map((post) => post.id), ['101', '102', '104'], 'the chain broke at somebody else\'s reply');
    eq(read.context && read.context.id, '100', 'what the first post answers');
    eq(read.others.map(({ post, answers }) => [post.id, answers && answers.id]), [['105', '103']]);
    eq([read.author.handle, read.incomplete], ['ada', false]);
    eq(XThread.unroll(posts, '999'), null, 'a post not in the conversation');
});

check('a thread is said to be cut short where x held the rest back, or where its last post\'s replies never came', () => {
    const held = XThread.parse(xDetail([
        xItem(xPost({ id: '201', text: 'one' })),
        [xItem(xPost({ id: '202', replyTo: '201', text: 'two' })), xCursor('ShowMoreThreads')],
        [xItem(xPost({ id: '203', by: 'cy', replyTo: '201' })), xCursor('ShowMore')],
    ]));
    eq(held.heldAfter, ['202', '203']);
    eq(XThread.unroll(held.posts, '201', held).incomplete, true);
    const quiet = XThread.parse(xDetail([xItem(xPost({ id: '301', replies: 4 }))]));
    eq(XThread.unroll(quiet.posts, '301', quiet).incomplete, true, 'four replies, none of them sent');
    const lone = XThread.parse({ data: { tweetResult: { result: xPost({ id: '401', note: 'all of it' }) } } });
    eq(XThread.unroll(lone.posts, '401', lone).thread[0].segments[0].text, 'all of it', 'TweetResultByRestId');
    const joined = XThread.fromResponses([JSON.stringify(xDetail([xItem(xPost({ id: '501', text: 'cut…' }))])), 'not json',
        JSON.stringify({ data: { tweetResult: { result: xPost({ id: '501', text: 'cut…', note: 'cut, but whole here' }) } } })]);
    eq(XThread.unroll(joined.posts, '501', joined).thread[0].segments[0].text, 'cut, but whole here', 'the fuller copy of one post');
});

// ---------------------------------------------------------------- time

const Time = require('../src/shared/time.js');
const now = Date.parse('2026-08-30T12:00:00Z');
const ago = (ms) => Time.relativeTime(now - ms, now);

section('relative time');
check('rounds down, so a card never ages a video past what it is', () => {
    eq([59 * 1000, 6 * 864e5, 13 * 864e5].map(ago), ['just now', '6 days ago', '1 week ago']);
});
check('singular and plural', () => {
    eq([6e4, 2 * 6e4, 36e5, 864e5, 3 * 864e5, 31536e6].map(ago),
        ['1 minute ago', '2 minutes ago', '1 hour ago', '1 day ago', '3 days ago', '1 year ago']);
});
check('a future date is not a negative age, and a missing one gets no label', () => {
    // Clock skew against YouTube's feed is ordinary; a feed entry with no date is stored as 0.
    eq(Time.relativeTime(now + 5e6, now), 'just now');
    eq([0, undefined, null].map((at) => Time.relativeTime(at, now)), ['', '', '']);
});
check('formatTime still works', () => {
    eq(Time.formatTime(65), '1:05');
    eq(Time.formatTime(3725), '1:02:05');
});

// ---------------------------------------------------------------- fsrs

const Fsrs = require('../src/shared/fsrs.js');

section('fsrs — the forgetting curve');
check('retrievability is 1 on the day and falls from there', () => {
    eq(Fsrs.retrievability(10, 0), 1);
    assertFalling([1, 5, 20, 90].map((days) => Fsrs.retrievability(10, days)), 'elapsed days');
});
check('stability means "days until 90%"', () => {
    // The whole point of FACTOR: R(S, S) is 0.9 exactly, for any S. If this
    // fails, DECAY and FACTOR have drifted apart.
    for (const S of [0.5, 3.173, 40, 900]) {
        eq(Math.round(Fsrs.retrievability(S, S) * 1e6) / 1e6, 0.9, `S=${S}`);
    }
});
check('intervalFor rises with stability and falls as retention is raised', () => {
    assertRising([1, 3, 10, 60, 300].map((S) => Fsrs.intervalFor(S, 0.9)), 'stability');
    assertFalling([0.7, 0.8, 0.9, 0.97].map((r) => Fsrs.intervalFor(300, r)), 'retention');
});
check('intervalFor is clamped to whole days inside the cap', () => {
    eq(Fsrs.intervalFor(0.01, 0.9), 1, 'never under a day');
    eq(Fsrs.intervalFor(1e6, 0.9, 365), 365, 'never over the cap');
});

section('fsrs — reviewing');
check('a first Good matches the published numbers', () => {
    const card = Fsrs.review(null, 3, 0, { retention: 0.9, now: 0 });
    // S_0(Good) is w[2] by definition, and at 90% retention the interval is
    // that many days — the identity checked above, read the other way round.
    eq(card.stability, Fsrs.W[2]);
    eq(card.interval, 3);
    eq(card.due, 3 * Fsrs.DAY_MS);
    eq(card.reps, 1);
    eq(card.lapses, 0);
});
check('each grade starts a card where its own weight says', () => {
    eq([1, 2, 3, 4].map((g) => Fsrs.review(null, g, 0, { now: 0 }).stability), Fsrs.W.slice(0, 4));
});
/** A card taken through five clean Good reviews — S in the hundreds of days. */
function matured() {
    let card = Fsrs.review(null, 3, 0, { now: 0 });
    for (let i = 0; i < 4; i++) card = Fsrs.review(card, 3, card.interval, { now: 0 });
    return card;
}

check('Again after a long gap lapses without falling through the floor', () => {
    const card = matured();
    const lapsed = Fsrs.review(card, 1, card.interval, { now: 0 });
    assert(lapsed.stability < card.stability, 'a lapse has to cost stability');
    assert(lapsed.stability >= Fsrs.MIN_STABILITY, 'but never all of it');
    assert(lapsed.difficulty > card.difficulty, 'and the problem is now harder');
    eq(lapsed.lapses, 1);
});
check('a lapse never raises stability, however long the gap', () => {
    // On a young card the lapse curve computes a *higher* stability than it
    // has; the cap keeps that from reading as a reward for forgetting.
    const young = Fsrs.review(null, 3, 0, { now: 0 });
    eq(Fsrs.review(young, 1, 120, { now: 0 }).stability, young.stability);
});
check('a lapse keeps more of a long gap than of a short one', () => {
    // Forgetting what you last saw a year ago says less about the card than
    // forgetting what you saw on Tuesday.
    const card = matured();
    const soon = Fsrs.review(card, 1, 2, { now: 0 }).stability;
    const late = Fsrs.review(card, 1, 600, { now: 0 }).stability;
    assert(late > soon, `expected the later lapse to keep more, got ${late} <= ${soon}`);
});
check('a same-day re-grade actually moves the card', () => {
    // Through the long-term formula this is a no-op — elapsed 0 means R is 1
    // means the growth term is exactly zero — so the dashboard's re-grade
    // would silently do nothing. FSRS-5's short-term branch is what saves it.
    const card = Fsrs.review(null, 3, 0, { now: 0 });
    assert(Fsrs.review(card, 4, 0, { now: 0 }).stability > card.stability, 'Easy should lengthen it');
    assert(Fsrs.review(card, 1, 0, { now: 0 }).stability < card.stability, 'Again should shorten it');
});
check('difficulty stays in [1, 10] across a hundred alternating grades', () => {
    let card = Fsrs.review(null, 3, 0, { now: 0 });
    for (let i = 0; i < 100; i++) {
        card = Fsrs.review(card, i % 2 ? 1 : 4, 7, { now: 0 });
        assert(card.difficulty >= 1 && card.difficulty <= 10, `drifted to ${card.difficulty}`);
        assert(card.stability >= Fsrs.MIN_STABILITY, `stability fell to ${card.stability}`);
    }
});
check('a stray grade is clamped rather than poisoning the card', () => {
    eq(Fsrs.review(null, 9, 0, { now: 0 }).grade, 4);
    eq(Fsrs.review(null, 0, 0, { now: 0 }).grade, 1);
    eq(Fsrs.review(null, undefined, 0, { now: 0 }).grade, 3);
});

section('fsrs — suggesting a grade');
check('a 45-minute Medium with two failures is Hard, not Good', () => {
    eq(Fsrs.suggestGrade({ seconds: 45 * 60, failures: 2, difficulty: 'Medium' }), 2);
});
check('a six-minute Easy with a clean run is Easy', () => {
    eq(Fsrs.suggestGrade({ seconds: 6 * 60, failures: 0, difficulty: 'Easy' }), 4);
});
check('three failures is Again whatever the clock said', () => {
    eq(Fsrs.suggestGrade({ seconds: 30, failures: 3, difficulty: 'Easy' }), 1);
    eq(Fsrs.suggestGrade({ seconds: 90 * 60, failures: 3, difficulty: 'Hard' }), 1);
});
check('one failure caps it at Hard however fast the accepted one was', () => {
    eq(Fsrs.suggestGrade({ seconds: 60, failures: 1, difficulty: 'Hard' }), 2);
});
check('over twice the budget is Again even with a clean run', () => {
    eq(Fsrs.suggestGrade({ seconds: 61 * 60, failures: 0, difficulty: 'Medium' }), 1);
});
check('an unknown difficulty is budgeted as a Medium', () => {
    eq(Fsrs.budgetFor(''), Fsrs.BUDGETS.Medium);
    eq(Fsrs.budgetFor('Impossible'), Fsrs.BUDGETS.Medium);
});
check('a clean run inside the budget but over half of it is Good', () => {
    eq(Fsrs.suggestGrade({ seconds: 20 * 60, failures: 0, difficulty: 'Medium' }), 3);
});

// ------------------------------------------------------------- leetcode

const Leet = require('../src/shared/leetcode.js');

// Today at two, not a fixed date: the store prunes past KEEP_DAYS on write.
// Set with setHours, so a tester either side of UTC lights the same square.
const L0 = new Date().setHours(14, 0, 0, 0);
const days = (n) => n * Leet.DAY_MS;

const problemPage = {
    slug: 'two-sum',
    title: 'Two Sum',
    difficulty: 'Easy',
    tags: ['Array', 'Hash Table'],
    url: 'https://leetcode.com/problems/two-sum/',
};

section('leetcode — seeing a problem');
check('the first sighting records what the page says', () => {
    const state = Leet.seeIn(Leet.blank(), problemPage, L0);
    const problem = state.problems['two-sum'];
    eq(problem.title, 'Two Sum');
    eq(problem.difficulty, 'Easy');
    eq(problem.tags, ['Array', 'Hash Table']);
    eq(problem.seenAt, L0);
    eq(problem.note, '');
    eq(problem.fsrs, null);
});
check('seeing it again keeps the note and the schedule', () => {
    let state = Leet.seeIn(Leet.blank(), problemPage, L0);
    state.problems['two-sum'].note = 'two pointers, sorted input only';
    state.problems['two-sum'].fsrs = { stability: 9, difficulty: 5, due: L0 + days(9) };

    state = Leet.seeIn(state, { ...problemPage, title: 'Two Sum II' }, L0 + days(1));
    const problem = state.problems['two-sum'];
    eq(problem.note, 'two pointers, sorted input only', 'the note is the user’s');
    eq(problem.fsrs.stability, 9, 'and so is the schedule');
    eq(problem.title, 'Two Sum II', 'the title is LeetCode’s and is refreshed');
    eq(problem.seenAt, L0 + days(1));
});
check('a field the reader could not find does not wipe the stored one', () => {
    let state = Leet.seeIn(Leet.blank(), problemPage, L0);
    state = Leet.seeIn(state, { slug: 'two-sum' }, L0 + days(1));
    eq(state.problems['two-sum'].difficulty, 'Easy');
    eq(state.problems['two-sum'].tags, ['Array', 'Hash Table']);
});
check('a difficulty that is not one of the three is dropped', () => {
    const state = Leet.seeIn(Leet.blank(), { ...problemPage, difficulty: 'Medium-ish' }, L0);
    eq(state.problems['two-sum'].difficulty, '');
});
check('a page with no slug is not a problem page', () => {
    eq(Leet.seeIn(Leet.blank(), { title: 'Problems' }, L0).problems, {});
});

section('leetcode — attempts and day buckets');
check('an attempt buckets into the local day it happened on', () => {
    const state = Leet.addAttempt(Leet.blank(), {
        slug: 'two-sum', status: 'Wrong Answer', seconds: 300, at: L0,
    });
    eq(state.days[Leet.dayKey(L0)], { submitted: 1, solved: 0, seconds: 300 });
    eq(state.problems['two-sum'].solvedAt, 0);
});
check('an accept counts as solved and sets solvedAt', () => {
    let state = Leet.addAttempt(Leet.blank(), { slug: 'two-sum', status: 'Wrong Answer', seconds: 200, at: L0 });
    state = Leet.addAttempt(state, { slug: 'two-sum', status: 'Accepted', seconds: 420, runtime: '52 ms', at: L0 + 60000 });
    eq(state.days[Leet.dayKey(L0)], { submitted: 2, solved: 1, seconds: 620 });
    eq(state.problems['two-sum'].solvedAt, L0 + 60000);
    eq(state.problems['two-sum'].attempts[0].runtime, '52 ms', 'newest first');
});
check('a verdict\'s status and runtime are kept to a few words, whatever the page sent', () => {
    const state = Leet.addAttempt(Leet.blank(), { slug: 'two-sum', status: 'x'.repeat(5000), runtime: '9'.repeat(5000), at: L0 });
    const [attempt] = state.problems['two-sum'].attempts;
    eq([attempt.status.length, attempt.runtime.length], [40, 40]);
    eq(Leet.addAttempt(Leet.blank(), { slug: 'a', status: 'Time Limit Exceeded', at: L0 }).problems.a.attempts[0].status, 'Time Limit Exceeded');
});
check('a submission either side of midnight lands on its own square', () => {
    const lastNight = new Date(L0).setHours(23, 50, 0, 0);
    let state = Leet.addAttempt(Leet.blank(), { slug: 'a', status: 'Accepted', seconds: 60, at: lastNight });
    state = Leet.addAttempt(state, { slug: 'a', status: 'Accepted', seconds: 60, at: lastNight + days(1) });
    eq(Object.keys(state.days).length, 2);
    eq(state.days[Leet.dayKey(lastNight)].submitted, 1);
    eq(state.days[Leet.dayKey(lastNight + days(1))].submitted, 1);
});
check('attempts are capped and the oldest fall off', () => {
    let state = Leet.blank();
    for (let i = 0; i < Leet.ATTEMPT_CAP + 6; i++) {
        state = Leet.addAttempt(state, { slug: 'two-sum', status: 'Wrong Answer', at: L0 + i * 1000 });
    }
    const { attempts } = state.problems['two-sum'];
    eq(attempts.length, Leet.ATTEMPT_CAP);
    eq(attempts[0].at, L0 + (Leet.ATTEMPT_CAP + 5) * 1000, 'the newest is kept');
});
check('an attempt on a problem never seen still records it', () => {
    const state = Leet.addAttempt(Leet.blank(), { slug: 'ghost', status: 'Accepted', at: L0 });
    eq(state.problems.ghost.seenAt, L0);
});

section('leetcode — pruning');
check('prune drops day 401 and keeps day 400', () => {
    const state = {
        problems: {},
        days: {
            [Leet.dayKey(L0 - days(Leet.KEEP_DAYS - 1))]: { submitted: 1, solved: 1, seconds: 10 },
            [Leet.dayKey(L0 - days(Leet.KEEP_DAYS))]: { submitted: 9, solved: 9, seconds: 90 },
        },
    };
    const kept = Leet.prune(state.days, L0);
    eq(Object.keys(kept), [Leet.dayKey(L0 - days(Leet.KEEP_DAYS - 1))]);
});
check('prune throws away a key that is not a date', () => {
    eq(Leet.prune({ yesterday: { submitted: 3 } }, L0), {});
});

section('leetcode — the three rails');
check('lists splits due, to-solve and solved', () => {
    let state = Leet.blank();
    state = Leet.seeIn(state, { slug: 'due-now' }, L0);
    state = Leet.seeIn(state, { slug: 'never-solved' }, L0);
    state = Leet.seeIn(state, { slug: 'done' }, L0);
    state = Leet.addAttempt(state, { slug: 'due-now', status: 'Accepted', at: L0 });
    state = Leet.addAttempt(state, { slug: 'done', status: 'Accepted', at: L0 });
    state = Leet.addAttempt(state, { slug: 'never-solved', status: 'Wrong Answer', at: L0 });
    state.problems['due-now'].fsrs = { stability: 3, difficulty: 5, due: L0 - days(1) };
    state.problems.done.fsrs = { stability: 30, difficulty: 5, due: L0 + days(30) };

    const { due, toSolve, solved } = Leet.lists(state, L0);
    eq(due.map((p) => p.slug), ['due-now']);
    eq(toSolve.map((p) => p.slug), ['never-solved']);
    eq(solved.map((p) => p.slug), ['done']);
});
check('a solved problem that has come round again is due, not solved', () => {
    let state = Leet.addAttempt(Leet.blank(), { slug: 'x', status: 'Accepted', at: L0 });
    state.problems.x.fsrs = { stability: 3, difficulty: 5, due: L0 - 1 };
    eq(Leet.lists(state, L0).solved.length, 0);
    eq(Leet.lists(state, L0).due.length, 1);
});
check('due comes back soonest first', () => {
    let state = Leet.blank();
    for (const [slug, when] of [['c', 3], ['a', 1], ['b', 2]]) {
        state = Leet.addAttempt(state, { slug, status: 'Accepted', at: L0 });
        state.problems[slug].fsrs = { stability: 3, difficulty: 5, due: L0 - days(when) };
    }
    eq(Leet.lists(state, L0).due.map((p) => p.slug), ['c', 'b', 'a']);
});

section('leetcode — grading inputs');
check('failuresSince counts only what came after the last accept', () => {
    let state = Leet.blank();
    state = Leet.addAttempt(state, { slug: 's', status: 'Wrong Answer', at: L0 });
    state = Leet.addAttempt(state, { slug: 's', status: 'Accepted', at: L0 + 1000 });
    const solvedBefore = state.problems.s.solvedAt;

    state = Leet.addAttempt(state, { slug: 's', status: 'Wrong Answer', at: L0 + 2000 });
    state = Leet.addAttempt(state, { slug: 's', status: 'Runtime Error', at: L0 + 3000 });
    state = Leet.addAttempt(state, { slug: 's', status: 'Accepted', at: L0 + 4000 });

    eq(Leet.failuresSince(state.problems.s, solvedBefore), 2, 'this session only');
    eq(Leet.failuresSince(state.problems.s, 0), 3, 'every failure on record');
});
check('the grade a session suggests follows from its own numbers', () => {
    let state = Leet.seeIn(Leet.blank(), problemPage, L0);
    state = Leet.addAttempt(state, { slug: 'two-sum', status: 'Wrong Answer', at: L0 });
    state = Leet.addAttempt(state, { slug: 'two-sum', status: 'Accepted', seconds: 6 * 60, at: L0 + 1000 });
    const problem = state.problems['two-sum'];
    eq(Fsrs.suggestGrade({
        seconds: Leet.lastAttempt(problem).seconds,
        failures: Leet.failuresSince(problem, 0),
        difficulty: problem.difficulty,
    }), 2, 'quick, but it took two goes');
});

section('leetcode — putting something back in the queue');
check('inQueue is exactly what the due and to-solve rails hold', () => {
    let state = Leet.seeIn(Leet.blank(), { slug: 'fresh' }, L0);
    eq(Leet.inQueue(state, 'fresh', L0), true, 'seen and unsolved is waiting');

    state = Leet.addAttempt(state, { slug: 'fresh', status: 'Accepted', at: L0 });
    state.problems.fresh.fsrs = { stability: 30, difficulty: 5, due: L0 + days(30) };
    eq(Leet.inQueue(state, 'fresh', L0), false, 'solved and not yet due is not');

    eq(Leet.inQueue(state, 'never-heard-of-it', L0), false);
    eq(Leet.inQueue(state, '', L0), false);
});
check('a solved problem is pulled forward rather than given a grade', () => {
    // Inventing a grade would write a stability nobody earned. Moving the due
    // date says "I want to see this again" and nothing more.
    let state = Leet.addAttempt(Leet.blank(), { slug: 'x', status: 'Accepted', at: L0 });
    state.problems.x.fsrs = { stability: 30, difficulty: 5, due: L0 + days(30), reps: 2, lapses: 0 };

    const problems = Leet.problemsOf(state);
    problems.x = { ...problems.x, fsrs: { ...problems.x.fsrs, due: L0 } };
    const after = { ...state, problems };

    eq(Leet.inQueue(after, 'x', L0), true);
    eq(after.problems.x.fsrs.stability, 30, 'the schedule it earned is untouched');
});
check('a problem already waiting is left exactly where it is', () => {
    // queueNow on an unsolved problem must not drag a due date onto it, or it
    // moves from "to solve" to "due" and the two rails stop meaning anything.
    const state = Leet.seeIn(Leet.blank(), { slug: 'fresh' }, L0);
    eq(Leet.lists(state, L0).toSolve.map((p) => p.slug), ['fresh']);
    eq(Leet.lists(state, L0).due.length, 0);
});

section('leetcode — the heat map');
check('heatDays colours by the metric it is asked for', () => {
    let state = Leet.addAttempt(Leet.blank(), { slug: 'a', status: 'Accepted', seconds: 600, at: L0 });
    state = Leet.addAttempt(state, { slug: 'a', status: 'Wrong Answer', seconds: 90, at: L0 });
    const key = Leet.dayKey(L0);
    eq(Leet.heatDays(state, 'submitted', L0)[key].value, 2);
    eq(Leet.heatDays(state, 'solved', L0)[key].value, 1);
    eq(Leet.heatDays(state, 'seconds', L0)[key].value, 690);
    eq(Leet.heatDays(state, 'nonsense', L0)[key].value, 2, 'an unknown metric falls back to submissions');
});
check('a square carries all three numbers whichever one it is coloured by', () => {
    const state = Leet.addAttempt(Leet.blank(), { slug: 'a', status: 'Accepted', seconds: 600, at: L0 });
    eq(Leet.heatDays(state, 'solved', L0)[Leet.dayKey(L0)],
        { submitted: 1, solved: 1, seconds: 600, value: 1 });
});
check('the heat map levels fall on the steps the panel uses', () => {
    // heat-map.js is a page module: it hangs itself off BB and exports
    // nothing, so it is required for the side effect and read off the global.
    require('../src/page/heat-map.js');
    const { HeatMap } = globalThis.BB;
    const steps = [2, 5, 10];
    eq([0, 1, 2, 3, 5, 6, 10, 11].map((n) => HeatMap.levelOf(n, steps)), [0, 1, 1, 2, 2, 3, 3, 4]);
});
check('the heat map escapes through Dom, quotes included', () => {
    // Each had its own escaper, and none of them escaped a single quote.
    require('../src/page/heat-map.js');
    const map = globalThis.BB.HeatMap.render({
        days: {}, end: L0, steps: [1, 2, 3], legend: ['<b>it\'s</b>'], describe: () => 'Jo\'s "day"',
    });
    assert(map.includes('&lt;b&gt;it&#39;s&lt;/b&gt;') && map.includes('Jo&#39;s &quot;day&quot;'), 'heat map');
    assert(!/<b>|it's/.test(map), 'raw text got through');
});
check('a streak counts back from today and stops at the first gap', () => {
    let state = Leet.blank();
    for (const back of [0, 1, 2, 4]) {
        state = Leet.addAttempt(state, { slug: 'a', status: 'Accepted', at: L0 - days(back) });
    }
    eq(Leet.streak(state, L0), 3);
});
check('a day not practised yet does not break yesterday’s streak', () => {
    let state = Leet.blank();
    for (const back of [1, 2, 3]) {
        state = Leet.addAttempt(state, { slug: 'a', status: 'Accepted', at: L0 - days(back) });
    }
    eq(Leet.streak(state, L0), 3);
});

// -------------------------------------------------- reading leetcode.com

const LeetRead = require('../src/content/leet-read.js');

section('leetcode — reading the address bar');
check('a problem page gives up its slug', () => {
    eq(LeetRead.slugOf('/problems/two-sum/'), 'two-sum');
    eq(LeetRead.slugOf('/problems/two-sum'), 'two-sum', 'with no trailing slash');
    eq(LeetRead.slugOf('/problems/longest-substring-without-repeating-characters/description/'),
        'longest-substring-without-repeating-characters');
    eq(LeetRead.slugOf('/problems/two-sum/submissions/1234/'), 'two-sum', 'after a submission');
    eq(LeetRead.slugOf('/problems/two-sum/?envType=daily'), 'two-sum', 'with a query string');
});
check('everything else on the site is not a problem page', () => {
    eq(LeetRead.slugOf('/problemset/all/'), null);
    eq(LeetRead.slugOf('/contest/weekly-425/'), null);
    eq(LeetRead.slugOf('/'), null);
    eq(LeetRead.slugOf('/problems/'), null, 'the list is not a problem');
    eq(LeetRead.onProblem('/problems/two-sum/'), true);
    eq(LeetRead.onProblem('/problemset/all/'), false);
});

section('leetcode — reading the stopwatch');
check('both shapes of clock parse', () => {
    eq(LeetRead.parseClock('05:30'), 330);
    eq(LeetRead.parseClock('1:02:05'), 3725, 'an hour in');
    eq(LeetRead.parseClock('00:00'), 0);
});
check('a reading that is not a clock is passed over, not read as zero', () => {
    // A zero and a "could not read it" have to stay distinguishable: the
    // first means the timer was just reset, the second means the selector
    // has stopped matching, and the fallback clock turns on for one of them.
    eq(LeetRead.parseClock('Start'), null);
    eq(LeetRead.parseClock(''), null);
    eq(LeetRead.parseClock(null), null);
});

// ---------------------------------------------------- the leetcode clock

const LeetUi = require('../src/content/leet-ui.js');

/**
 * Drive the clock without a browser. `reads` is the sequence LeetCode's
 * stopwatch shows; null is "no widget", the branch the wall clock covers.
 */
function withStubbedPage(path, run) {
    const saved = {
        document: global.document, window: global.window,
        location: global.location, reader: globalThis.BB.LeetRead.timerSeconds,
        see: globalThis.BB.Leet.see,
    };
    global.document = { visibilityState: 'visible', hasFocus: () => true, addEventListener() {} };
    global.window = { addEventListener() {} };
    global.location = { pathname: path };
    // Filing the problem is storage's business and has its own tests.
    globalThis.BB.Leet.see = () => Promise.resolve(null);

    const tasks = new Map();
    const watcher = {
        add: (name, fn) => tasks.set(name, fn),
        remove: (name) => tasks.delete(name),
        schedule() {}, has: (name) => tasks.has(name),
    };
    const ui = LeetUi.createLeetUi({ watcher, notify: () => {}, getSettings: () => globalThis.BB.Settings.DEFAULTS });
    // install() is what registers the watcher task the stub drives below, and
    // it lands on the first problem on its own way in.
    ui.install();

    /** Show the widget one reading, then let the watcher task run. */
    const show = (seconds) => {
        globalThis.BB.LeetRead.timerSeconds = () => seconds;
        tasks.get('leet-clock')();
    };

    try {
        return run({ ui, show, watcher, tasks });
    } finally {
        Object.assign(global, { document: saved.document, window: saved.window, location: saved.location });
        globalThis.BB.LeetRead.timerSeconds = saved.reader;
        globalThis.BB.Leet.see = saved.see;
    }
}

section('leetcode — the clock');
check('elapsed is whatever LeetCode’s own stopwatch reads', () => {
    withStubbedPage('/problems/two-sum/', ({ ui, show }) => {
        ui.onNavigate();
        show(30);
        eq(ui.elapsedSeconds(), 30);
        show(125);
        eq(ui.elapsedSeconds(), 125);
    });
});
check('a reset closes the segment rather than losing it', () => {
    withStubbedPage('/problems/two-sum/', ({ ui, show }) => {
        ui.onNavigate();
        show(300);
        show(4);   // the user pressed reset
        eq(ui.elapsedSeconds(), 304, 'the first five minutes still count');
        show(60);
        eq(ui.elapsedSeconds(), 360);
    });
});
check('a pause costs nothing', () => {
    // Pausing shows the same number for a while and then carries on. Nothing
    // about that should bank a segment or lose one.
    withStubbedPage('/problems/two-sum/', ({ ui, show }) => {
        ui.onNavigate();
        show(90); show(90); show(90);
        eq(ui.elapsedSeconds(), 90);
        show(91);
        eq(ui.elapsedSeconds(), 91);
    });
});
check('a reading a shade below the last is drift, not a reset', () => {
    // Our reads are not aligned to LeetCode's ticks, so the two drift past
    // each other by a second. Treating that as a reset would double the time
    // every few seconds.
    withStubbedPage('/problems/two-sum/', ({ ui, show }) => {
        ui.onNavigate();
        show(120);
        show(119);
        eq(ui.elapsedSeconds(), 120);
    });
});
check('a different problem starts a new clock', () => {
    withStubbedPage('/problems/two-sum/', ({ ui, show }) => {
        ui.onNavigate();
        show(600);
        eq(ui.elapsedSeconds(), 600);

        global.location.pathname = '/problems/add-two-numbers/';
        ui.onNavigate();
        show(5);
        eq(ui.elapsedSeconds(), 5, 'the last problem’s ten minutes are not this one’s');
    });
});
check('switching panes on the same problem keeps the clock running', () => {
    withStubbedPage('/problems/two-sum/', ({ ui, show }) => {
        ui.onNavigate();
        show(600);
        global.location.pathname = '/problems/two-sum/solutions/';
        ui.onNavigate();
        show(610);
        eq(ui.elapsedSeconds(), 610);
    });
});
check('leaving the problem pages stops the clock', () => {
    withStubbedPage('/problems/two-sum/', ({ ui, show }) => {
        ui.onNavigate();
        show(600);
        global.location.pathname = '/problemset/all/';
        ui.onNavigate();
        eq(ui.elapsedSeconds(), 0);
    });
});
check('with no widget to read, nothing is invented', () => {
    withStubbedPage('/problems/two-sum/', ({ ui, show }) => {
        ui.onNavigate();
        show(null);
        show(null);
        // The wall-clock fallback banks real gaps, and no real time has
        // passed here — so the answer is zero rather than one per look.
        eq(ui.elapsedSeconds(), 0, 'ticks are not seconds');
    });
});
check('the widget taking over does not stack on the wall clock', () => {
    withStubbedPage('/problems/two-sum/', ({ ui, show }) => {
        ui.onNavigate();
        show(null);
        show(240);
        eq(ui.elapsedSeconds(), 240, 'the widget was running for that time too');
    });
});
// ------------------------------------------------------ leetcode templates

const LeetTemplates = require('../src/shared/leet-templates.js');

/** Templates as stored, without going near storage. */
const tpl = (name, lang, body = '', usedAt = 0) =>
    LeetTemplates.clean({ id: `lt_${name}`, name, lang, body, usedAt });

section('leetcode — template languages');
check('monaco’s names are mapped onto LeetCode’s', () => {
    eq(LeetTemplates.normalize('python'), 'python3', 'monaco has one Python mode');
    eq(LeetTemplates.normalize('go'), 'golang');
    eq(LeetTemplates.normalize('CPP'), 'cpp', 'case does not matter');
    eq(LeetTemplates.normalize('cpp'), 'cpp');
});
check('a language nobody recognises files as "any"', () => {
    eq(LeetTemplates.normalize('brainfuck'), '');
    eq(LeetTemplates.normalize(''), '');
    eq(LeetTemplates.normalize(undefined), '');
    eq(LeetTemplates.labelFor(''), 'Any language');
    eq(LeetTemplates.labelFor('golang'), 'Go');
});

section('leetcode — offering templates');
check('forLang puts this language first and the language-free ones after', () => {
    const state = [tpl('anything', ''), tpl('bisect', 'python3'), tpl('vector', 'cpp')];
    eq(LeetTemplates.forLang(state, 'python3').map((t) => t.name), ['bisect', 'anything']);
    eq(LeetTemplates.forLang(state, 'cpp').map((t) => t.name), ['vector', 'anything']);
});
check('another language’s templates are not offered at all', () => {
    const state = [tpl('vector', 'cpp')];
    eq(LeetTemplates.forLang(state, 'python3').map((t) => t.name), []);
});
check('with no language to go on, everything is offered', () => {
    // The page world could not tell us what the editor is in. Offering
    // nothing would be worse than offering too much.
    const state = [tpl('bisect', 'python3'), tpl('vector', 'cpp')];
    eq(LeetTemplates.forLang(state, '').length, 2);
});
check('the one reached for most recently leads', () => {
    const state = [tpl('old', 'python3', '', 1000), tpl('recent', 'python3', '', 9000)];
    eq(LeetTemplates.forLang(state, 'python3').map((t) => t.name), ['recent', 'old']);
});
check('a list nobody has used yet keeps the order it was arranged in', () => {
    const state = [tpl('first', 'python3'), tpl('second', 'python3')];
    eq(LeetTemplates.forLang(state, 'python3').map((t) => t.name), ['first', 'second']);
});
check('search matches the name and the body', () => {
    const state = [
        tpl('binary search', 'python3', 'while lo < hi:'),
        tpl('union find', 'python3', 'def find(x):'),
    ];
    eq(LeetTemplates.search(state, 'python3', 'binary').map((t) => t.name), ['binary search']);
    eq(LeetTemplates.search(state, 'python3', 'lo < hi').map((t) => t.name), ['binary search'],
        'found by what is in it');
    eq(LeetTemplates.search(state, 'python3', 'FIND').map((t) => t.name), ['union find'], 'case-insensitive');
    eq(LeetTemplates.search(state, 'python3', '').length, 2, 'an empty filter narrows nothing');
});

section('leetcode — what a template may hold');
check('a template with no name is not a template', () => {
    eq(LeetTemplates.templatesOf([{ name: '   ', body: 'x' }]), []);
});
check('a body keeps its indentation', () => {
    // Trimming a template is trimming the thing that makes it paste cleanly.
    eq(LeetTemplates.clean({ name: 'x', body: '    return 1\n' }).body, '    return 1\n');
});
check('a whole solution pasted in as a template is capped', () => {
    const huge = LeetTemplates.clean({ name: 'x', body: 'y'.repeat(20000) });
    eq(huge.body.length, LeetTemplates.BODY_CAP);
});
check('a stored record that is nonsense does not take the list down', () => {
    const rows = LeetTemplates.templatesOf(['not an object', null, { name: 'ok', lang: 42, uses: 'many' }]);
    eq(rows.length, 1);
    eq(rows[0].lang, '');
    eq(rows[0].uses, 0);
});

// ------------------------------------------- leetcode's own submission calendar

const LeetApi = require('../src/shared/leet-api.js');

/** A reply shaped the way LeetCode's GraphQL endpoint actually answers. */
function calendarReply(map, extra = {}) {
    return {
        submissionCalendar: JSON.stringify(map),
        streak: 8,
        totalActiveDays: Object.keys(map).length,
        activeYears: [2025, 2026],
        ...extra,
    };
}

/** A unix seconds value for a UTC midnight. */
const utcMidnight = (iso) => Date.parse(`${iso}T00:00:00.000Z`) / 1000;

section('leetcode — reading the submission calendar');
check('the calendar comes back as one count per day', () => {
    const parsed = LeetApi.parseCalendar(calendarReply({
        [utcMidnight('2026-09-10')]: 4,
        [utcMidnight('2026-09-02')]: 5,
    }));
    // Ordered oldest first: the incoming keys are unix seconds, which JS
    // treats as integer keys and hands back in ascending order.
    eq(parsed.days, { '2026-09-02': 5, '2026-09-10': 4 });
    eq(parsed.total, 9);
    eq(parsed.streak, 8);
    eq(parsed.activeDays, 2);
});
check('the day keys are UTC, the way LeetCode itself draws them', () => {
    // Read back in local time, a midnight lands a day off either side of
    // Greenwich; LeetCode's own profile page is what a person can check.
    eq(LeetApi.dayKeyUtc(utcMidnight('2026-01-01')), '2026-01-01');
    eq(LeetApi.dayKeyUtc(utcMidnight('2026-12-31')), '2026-12-31');
});
check('a submissionCalendar that is not JSON does not take the map down', () => {
    // It arrives as a string rather than an object, so it is the one field
    // that can arrive malformed without the response itself being invalid.
    eq(LeetApi.parseCalendar({ submissionCalendar: 'not json' }).days, {});
    eq(LeetApi.parseCalendar({}).days, {});
    eq(LeetApi.parseCalendar({ submissionCalendar: '{}' }).total, 0);
});
check('a day with a nonsense count is dropped rather than drawn as NaN', () => {
    const parsed = LeetApi.parseCalendar(calendarReply({
        [utcMidnight('2026-09-10')]: 'lots',
        [utcMidnight('2026-09-11')]: 3,
    }));
    eq(parsed.days, { '2026-09-11': 3 });
    eq(parsed.total, 3);
});
check('a username is cleaned the way LeetCode spells one', () => {
    eq(LeetApi.cleanUsername('  Shishir43 '), 'Shishir43');
    eq(LeetApi.cleanUsername('@Shishir43'), 'Shishir43');
    eq(LeetApi.cleanUsername(''), '');
    eq(LeetApi.cleanUsername(null), '');
});

section('leetcode — asking LeetCode for it');
checkAsync('the request is public: no cookies, just a username', async () => {
    let sent = null;
    const fetcher = async (url, options) => {
        sent = { url, options };
        return { ok: true, json: async () => ({ data: { matchedUser: { userCalendar: calendarReply({ [utcMidnight('2026-09-10')]: 2 }) } } }) };
    };
    const out = await LeetApi.fetchCalendar('Shishir43', { fetcher });

    eq(sent.url, LeetApi.ENDPOINT);
    eq(sent.options.credentials, 'omit', 'the request must not carry the user’s session');
    eq(JSON.parse(sent.options.body).variables, { username: 'Shishir43' });
    eq(out.days, { '2026-09-10': 2 });
    eq(out.user, 'Shishir43');
});
checkAsync('a username nobody has is said so, not drawn as an empty year', async () => {
    const fetcher = async () => ({ ok: true, json: async () => ({ data: { matchedUser: null } }) });
    let code = null;
    try { await LeetApi.fetchCalendar('nobody-at-all', { fetcher }); } catch (error) { code = error.code; }
    eq(code, 'not-found');
});
checkAsync('an unreachable LeetCode is an error, not an empty calendar', async () => {
    const fetcher = async () => { throw new Error('offline'); };
    let code = null;
    try { await LeetApi.fetchCalendar('Shishir43', { fetcher }); } catch (error) { code = error.code; }
    eq(code, 'network');
});
checkAsync('an empty username never reaches the network', async () => {
    let called = false;
    const fetcher = async () => { called = true; };
    let code = null;
    try { await LeetApi.fetchCalendar('  ', { fetcher }); } catch (error) { code = error.code; }
    eq(code, 'no-username');
    eq(called, false);
});

section('leetcode — the pouch panel');
const LeetPanel = require('../src/content/leet-panel.js');

check('the rail is the three lists Leet.lists hands back', () => {
    // The row's sentinel id is the key on the lists object, so picking a row
    // is a lookup rather than a switch. If these ever diverge, every rail row
    // draws an empty pane.
    const lists = Leet.lists(Leet.blank(), L0);
    for (const view of LeetPanel.VIEWS) {
        assert(Array.isArray(lists[view.id]), `no list answers to "${view.id}"`);
        assert(view.label && view.empty, `${view.id} has nothing to say when empty`);
    }
});
check('a due date reads as how late or how far off it is', () => {
    const at = (due) => LeetPanel.dueText({ fsrs: { due } }, L0);
    eq(at(L0 - days(5)), '5 days overdue');
    eq(at(L0), 'due today');
    eq(at(L0 + days(1)), 'due tomorrow');
    eq(at(L0 + days(6)), 'in 6 days');
    eq(at(L0 + days(90)), 'in 3 months');
    eq(at(L0 + days(365)), 'in 1 year');
});
check('a problem nobody has graded says so rather than showing a date', () => {
    eq(LeetPanel.dueText({ fsrs: null }, L0), 'not graded yet');
    eq(LeetPanel.dueText({}, L0), 'not graded yet');
});
check('a rail row escapes what it is given', () => {
    const row = LeetPanel.railRow('<img src=x>', '<b>Due</b>', 3, true);
    assert(!row.includes('<img'), 'an id went into an attribute unescaped');
    assert(!row.includes('<b>'), 'a label went into the markup unescaped');
    assert(row.includes('aria-pressed="true"'), 'the selected row is not marked');
});

section('leetcode — what the grade card offers');
check('the four grades are offered with what each would schedule', () => {
    withStubbedPage('/problems/two-sum/', ({ ui }) => {
        const fresh = { slug: 'two-sum', difficulty: 'Medium', fsrs: null };
        const options = ui.previewIntervals(fresh, Date.now());
        eq(options.map((o) => o.label), ['Again', 'Hard', 'Good', 'Easy']);
        // Not strictly sooner (on a first review Again and Hard both round to
        // tomorrow), but never inverted, or the buttons lie about themselves.
        const schedule = options.map((o) => o.days);
        for (let i = 1; i < schedule.length; i++) {
            assert(schedule[i] >= schedule[i - 1], `grade: inverted at ${i} — ${schedule.join(', ')}`);
        }
        assert(schedule[3] > schedule[0], 'Easy has to buy more than Again');
    });
});
check('the schedule is capped by the longest gap the settings allow', () => {
    withStubbedPage('/problems/two-sum/', ({ ui }) => {
        const mature = { slug: 'x', difficulty: 'Easy', fsrs: { stability: 5000, difficulty: 3, reviewedAt: 0, reps: 9, lapses: 0 } };
        for (const option of ui.previewIntervals(mature, Date.now())) {
            assert(option.days <= globalThis.BB.Settings.DEFAULTS.leetMaxInterval,
                `${option.label} scheduled ${option.days} days out`);
        }
    });
});
check('a schedule is written in words rather than a date', () => {
    withStubbedPage('/problems/two-sum/', ({ ui }) => {
        eq(ui.inDays(1), 'tomorrow');
        eq(ui.inDays(6), 'in 6 days');
        eq(ui.inDays(30), 'in 30 days');
        eq(ui.inDays(60), 'in 2 months');
        eq(ui.inDays(365), 'in 1 year');
    });
});

check('human() reads as a stopwatch at every scale', () => {
    withStubbedPage('/problems/two-sum/', ({ ui }) => {
        eq(ui.human(45), '45s');
        eq(ui.human(90), '1m 30s');
        eq(ui.human(600), '10m 00s');
        eq(ui.human(3725), '1h 02m');
    });
});

// ------------------------------------------------- the leetcode dashboard

require('../src/page/leet-stats.js');
const LeetStats = globalThis.BB.LeetStats;

section('leetcode — the settings panel');
check('every leetcode setting has a control carrying its key as an id', () => {
    // settings-form.js binds a control to a setting by id alone, so a setting
    // with no element can never be changed, and nothing says so.
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    const Settings = globalThis.BB.Settings;
    const controls = new Set([...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));

    const leetKeys = Settings.KEYS.filter((key) => /^leet/.test(key));
    assert(leetKeys.length, 'no leetcode settings at all');
    for (const key of leetKeys) assert(controls.has(key), `${key} has no control bound to it`);
});
check('the number fields cannot be set outside what the code accepts', () => {
    // The clamps in leet-ui.js and leet-stats.js are the real guard, but a
    // field that lets you type 400% retention and then quietly ignores it is
    // a field that lies about what it does.
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    const attrs = (id) => (new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html) || [''])[0];
    const retention = attrs('leetRetention');
    assert(/min="70"/.test(retention) && /max="97"/.test(retention), `retention is unbounded: ${retention}`);
    assert(/type="number"/.test(attrs('leetMaxInterval')), 'the interval cap is not a number field');
    assert(/min="1"/.test(attrs('leetMockMinutes')), 'a zero-minute mock interview is offerable');
});
check('a leetcode panel exists for every dashboard tab', () => {
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    for (const id of ['leetReviewPanel', 'leetHeatPanel', 'leetNotesPanel', 'leetcodeSettingsPanel']) {
        assert(html.includes(`id="${id}"`), `${id} is referenced but not in the page`);
    }
    assert(/data-site-settings="leetcode"/.test(html), 'the settings launcher has no leetcode card to open');
});

section('leetcode — the dashboard panels');
check('each heat metric is banded on its own scale', () => {
    // One set of bounds cannot colour both counts and seconds: two
    // submissions is a quiet day and two seconds is nothing at all. Sharing
    // a scale made the Time map one flat block of the darkest level.
    const scales = Object.values(LeetStats.METRICS).map((m) => m.steps.join(','));
    eq(new Set(scales).size, scales.length, 'two metrics are sharing a scale');
    for (const [id, spec] of Object.entries(LeetStats.METRICS)) {
        assertRising(spec.steps, `${id} steps`);
        eq(spec.legend.length, 5, `${id} needs a word per level, zero included`);
    }
});
check('the heat metrics are the ones the store can answer', () => {
    eq(Object.keys(LeetStats.METRICS).sort(), Leet.METRICS.map((m) => m.id).sort());
});
check('the median shrugs off one runaway reading', () => {
    // A problem left open in a background tab for two hours is exactly what
    // the wall-clock fallback mis-measures, and a mean would move to it.
    const attempt = (seconds) => ({ attempts: [{ at: L0, status: 'Accepted', seconds, runtime: '' }] });
    const sane = [attempt(300), attempt(600), attempt(900)];
    eq(LeetStats.medianSeconds(sane), 600);
    eq(LeetStats.medianSeconds([...sane, attempt(7200)]), 750, 'not the 2250 a mean would give');
});
check('problems never timed are left out of the median rather than counted as nought', () => {
    const attempt = (seconds) => ({ attempts: [{ at: L0, status: 'Accepted', seconds, runtime: '' }] });
    eq(LeetStats.medianSeconds([attempt(0), attempt(600), attempt(0)]), 600);
    eq(LeetStats.medianSeconds([]), 0);
    eq(LeetStats.medianSeconds([attempt(0)]), 0, 'nothing timed is not a median of zero');
});
check('the dashboard writes durations the way the panel does', () => {
    eq(LeetStats.human(45), '45s');
    eq(LeetStats.human(900), '15m');
    eq(LeetStats.human(3900), '1h 05m');
});

// ----------------------------------------------------------- typeracer

const Typer = require('../src/shared/typeracer.js');

/**
 * A keystroke stream: `typed` is what went in, a `<` one backspace. Every gap
 * is `step` unless the character is preceded by `{ms}`.
 */
function stream(quote, typed, { start = 1000, step = 200 } = {}) {
    const events = [];
    const buffer = [];
    let at = start;
    let i = 0;
    while (i < typed.length) {
        let gap = step;
        if (typed[i] === '{') {
            const close = typed.indexOf('}', i);
            gap = Number(typed.slice(i + 1, close));
            i = close + 1;
        }
        at += gap;
        const ch = typed[i++];
        if (ch === '<') {
            buffer.pop();
            events.push({ del: true, at });
            continue;
        }
        const expected = quote[buffer.length] || '';
        events.push({ ch, expected, at, ok: ch === expected });
        buffer.push(ch);
    }
    return events;
}

const gramsOf = (quote, typed, options) => Typer.gramsFrom(stream(quote, typed, options));
const msOf = (table, gram) => (table[gram] ? table[gram].ms : null);

// Half past eleven at night, today. The day bucket is keyed in local time,
// and a hard-coded date would stop being recorded once the suite is run more
// than KEEP_DAYS after it was written.
const R0 = new Date().setHours(23, 30, 0, 0);

section('typeracer — folding a character');
check('case folds, because the shift is already its own interval', () => {
    eq(Typer.foldChar('A'), 'a');
    eq(Typer.foldChar('a'), 'a');
    eq(Typer.foldGram(['T', 'h']), 'th');
});
check('every digit is one key, and everything unreachable is another', () => {
    eq(Typer.foldChar('7'), '#');
    eq(Typer.foldChar('0'), '#');
    // An accented letter is somebody else's keyboard. Folding it to itself
    // would fill the table with pairs you never meet twice.
    eq(Typer.foldChar('é'), '?');
    eq(Typer.foldChar('€'), '?');
});
check('the punctuation you actually type survives', () => {
    for (const ch of [' ', "'", ',', '.', '-']) eq(Typer.foldChar(ch), ch);
    // A quote is typeset with curly marks and long dashes; the keyboard has
    // neither, so they fold onto the key that was actually pressed.
    eq(Typer.foldChar('’'), "'");
    eq(Typer.foldChar('—'), '-');
});

section('typeracer — reading the keystrokes');
check('a clean run credits each pair once and the roll once', () => {
    const grams = gramsOf('the', 'the');
    eq(Object.keys(grams.bi).sort(), ['he', 'th']);
    eq(Object.keys(grams.tri), ['the']);
    eq(grams.tri.the.ms, 200, 'the roll is its second interval, not its span');
    eq(grams.totalN, 2);
    eq(grams.errors, 0);
});
check('an interval spanning a backspace is credited to nothing', () => {
    // Typing "the" as t, x, backspace, h, e. Both intervals touching the
    // retyped position measure how long the fix took, not how fast the pair
    // is, so neither belongs in a table about speed.
    const grams = gramsOf('the', 'tx<he');
    // The miss itself is filed as a slip on "th", with no reading beside it.
    const read = (table) => Object.keys(table).filter((gram) => table[gram].n > 0);
    eq(read(grams.bi), []);
    eq(read(grams.tri), []);
    eq(grams.bi.th.err, 1);
    eq(grams.errors, 1);
});
check('a stare and a key repeat are both dropped', () => {
    const grams = gramsOf('theirs', 'th{4000}e{3}i{200}r{200}s');
    eq(Object.keys(grams.bi).sort(), ['ir', 'rs', 'th']);
    eq(Object.keys(grams.tri), ['irs'], 'a roll needs both of its intervals');
});
check('dropping a reading does not shift the ones around it', () => {
    // Every interval is the difference of two absolute timestamps rather
    // than a step in a chain, which is the whole reason dropping is safe.
    const clean = gramsOf('theirs', 'th{200}e{200}i{200}r{200}s');
    const gappy = gramsOf('theirs', 'th{4000}e{3}i{200}r{200}s');
    eq(msOf(gappy.bi, 'th'), msOf(clean.bi, 'th'));
    eq(msOf(gappy.bi, 'rs'), msOf(clean.bi, 'rs'));
});
check('a mistype is filed against the character that was due', () => {
    const grams = gramsOf('the', 'tge');
    eq(grams.chars.h.due, 1);
    eq(grams.chars.h.wrong, 1);
    eq(grams.chars.h.subs.g, 1, 'what was hit instead is the interesting half');
    eq(grams.chars.t.wrong, 0);
});
check('a character typed twice was due twice', () => {
    // Otherwise the error rate for a key you fumble and fix is 1/1, and
    // every such key sits at the top of the table for ever.
    const grams = gramsOf('the', 'tg<he');
    eq(grams.chars.h.due, 2);
    eq(grams.chars.h.wrong, 1);
});

section('typeracer — slips');
check('a first-try miss after a clean key is a slip on the pair and the roll being typed', () => {
    // "thx<e": going for "e" after a clean "th", "x" was hit.
    const { bi, tri } = gramsOf('the quick', 'thx<e');
    eq(bi.he.err, 1, 'the pair going for e');
    eq(tri.the.err, 1, 'the roll going for e');
    eq((bi.th && bi.th.err) || 0, 0, 'the clean pair before it was blamed');
});
check('the retype that fixed it is not a second slip, and a run of misses is one', () => {
    const { bi } = gramsOf('the quick', 'txx<<he');
    eq(bi.th.err, 1, 'going for h');
    eq((bi.he && bi.he.err) || 0, 0, 'the second miss of the run was filed against the pair after');
});
check('slips are keyed by what was due, folded like everything else', () => {
    const { bi } = gramsOf('The quick', 'Tx<he');
    eq(bi.th.err, 1);
});
check('a clean race has no slips at all', () => {
    const { bi, tri } = gramsOf('the quick', 'the quick');
    eq(Object.values(bi).concat(Object.values(tri)).reduce((sum, e) => sum + e.err, 0), 0);
});
check('slips merge like every other sum, and rank by count then rate', () => {
    let grams = Typer.blankGrams();
    for (let i = 0; i < 3; i++) grams = Typer.mergeGrams(grams, gramsOf('the quick', 'thx<e quick'));
    const state = { races: [], days: {}, grams };
    const [top] = Typer.slips(state, 'bi');
    eq(top.gram, 'he');
    eq(top.err, 3);
    eq(top.rate, 1, 'three slips and no clean readings is every attempt');
    eq(Typer.slips(state, 'bi', { minSlips: 4 }), [], 'under the floor a gram is not named');
});
check('a pair you always slip on is not evicted for having no clean readings', () => {
    const grams = Typer.blankGrams();
    for (let i = 0; i < Typer.GRAM_CAP + 10; i++) grams.bi[`x${i}`] = { n: 1, ms: 100, err: 0 };
    grams.bi.zq = { n: 0, ms: 0, err: Typer.KEEP_N };
    assert(Typer.pruneGrams(grams).bi.zq, 'the slips table lost the pair it exists for');
});
check('the slowest-pairs rows carry their slips for the table', () => {
    const grams = Typer.blankGrams();
    grams.bi.th = { n: 10, ms: 2400, err: 4 };
    eq(Typer.slowest({ grams }, 'bi', { minSamples: 1 })[0].err, 4);
});

section('typeracer — merging and evicting');
check('merging is commutative, because it is all sums', () => {
    const a = gramsOf('the', 'the');
    const b = gramsOf('then', 'then');
    const ab = Typer.mergeGrams(Typer.mergeGrams(Typer.blankGrams(), a), b);
    const ba = Typer.mergeGrams(Typer.mergeGrams(Typer.blankGrams(), b), a);
    eq(ab.bi, ba.bi);
    eq(ab.totalMs, ba.totalMs);
    eq(ab.bi.th.n, 2, 'the pair both quotes hold is counted twice');
});
check('a sum is stored rather than a mean', () => {
    const once = Typer.mergeGrams(Typer.blankGrams(), gramsOf('the', 'th{100}e'));
    const twice = Typer.mergeGrams(once, gramsOf('the', 'th{300}e'));
    eq(twice.bi.he.n, 2);
    eq(twice.bi.he.ms, 400, 'means do not merge; sums do');
});
check('eviction takes the rarest first and never a gram you know', () => {
    const grams = Typer.blankGrams();
    for (let i = 0; i < Typer.GRAM_CAP + 100; i++) {
        grams.bi[`x${i}`] = { n: i < 100 ? Typer.KEEP_N : 1, ms: 100, err: 0 };
    }
    const pruned = Typer.pruneGrams(grams);
    eq(Object.keys(pruned.bi).length, Typer.GRAM_CAP);
    for (let i = 0; i < 100; i++) assert(pruned.bi[`x${i}`], `x${i} was evicted at KEEP_N`);
});
check('a table of nothing but known grams stays over the cap', () => {
    // The cap is there to keep one-offs out, not to throw away the answer.
    const grams = Typer.blankGrams();
    for (let i = 0; i < Typer.GRAM_CAP + 50; i++) grams.bi[`x${i}`] = { n: Typer.KEEP_N, ms: 100, err: 0 };
    eq(Object.keys(Typer.pruneGrams(grams).bi).length, Typer.GRAM_CAP + 50);
});
check('the cap holds after a thousand races of novel grams', () => {
    let state = Typer.blank();
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    for (let race = 0; race < 1000; race++) {
        // A different quote every time, so nothing ever reaches KEEP_N and
        // the table is under maximum pressure to grow.
        let quote = '';
        for (let i = 0; i < 40; i++) quote += letters[(race * 7 + i * 11) % 26];
        state = Typer.recordRace(state, { at: R0, seconds: 30 }, stream(quote, quote), R0);
    }
    assert(Object.keys(state.grams.bi).length <= Typer.GRAM_CAP, 'the bigram table ran away');
    assert(Object.keys(state.grams.tri).length <= Typer.GRAM_CAP_TRI, 'the trigram table ran away');
});

section('typeracer — the race log');
check('a race lands on the local day it was typed on', () => {
    // toISOString() would file this one under tomorrow east of Greenwich —
    // the square that lights up would not be the one you were sitting at.
    const state = Typer.recordRace(Typer.blank(), { at: R0, wpm: 80, accuracy: 97, seconds: 30, chars: 200 }, [], R0);
    const local = new Date(R0);
    const key = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    eq(Object.keys(state.days), [key]);
    eq(state.days[key], { races: 1, seconds: 30, best: 80 });
});
check('the day keeps the best of its races, not the last', () => {
    let state = Typer.recordRace(Typer.blank(), { at: R0, wpm: 90, seconds: 30 }, [], R0);
    state = Typer.recordRace(state, { at: R0, wpm: 70, seconds: 30 }, [], R0);
    eq(state.days[Typer.dayKey(R0)], { races: 2, seconds: 60, best: 90 });
});
check('the page is believed when it parses and measured when it does not', () => {
    const told = Typer.recordRace(Typer.blank(), { at: R0, wpm: 84.4, accuracy: 96.5, seconds: 30, chars: 200 }, [], R0);
    eq(told.races[0].wpm, 84.4, 'the number the user just saw on screen');

    // 200 characters in 30 seconds is 80 wpm by the five-character word.
    const measured = Typer.recordRace(Typer.blank(), { at: R0, seconds: 30, chars: 200 }, [], R0);
    eq(measured.races[0].wpm, 80);
});
check('accuracy is computed from the stream when the panel says nothing', () => {
    const state = Typer.recordRace(Typer.blank(), { at: R0, seconds: 10 }, stream('the', 'tge'), R0);
    eq(state.races[0].errors, 1);
    eq(state.races[0].accuracy, 66.7);
});
check('the log is newest first and capped', () => {
    let state = Typer.blank();
    for (let i = 0; i < Typer.RACE_CAP + 20; i++) {
        state = Typer.recordRace(state, { at: R0 + i, wpm: i, seconds: 1 }, [], R0);
    }
    eq(state.races.length, Typer.RACE_CAP);
    eq(state.races[0].wpm, Typer.RACE_CAP + 19, 'newest first');
});
check('day buckets older than the map are dropped rather than aged', () => {
    const old = R0 - (Typer.KEEP_DAYS + 5) * Typer.DAY_MS;
    const days = { [Typer.dayKey(old)]: { races: 3, seconds: 90, best: 60 }, [Typer.dayKey(R0)]: { races: 1, seconds: 30, best: 70 } };
    eq(Object.keys(Typer.prune(days, R0)), [Typer.dayKey(R0)]);
});
check('a stored race written by an older version cannot hand back nonsense', () => {
    // Every field is interpolated into markup somewhere, so nothing is
    // trusted as stored — the rule shared/leetcode.js follows.
    const race = Typer.cleanRace({ at: '12', wpm: -5, accuracy: 300, seconds: 'x', quoteId: { nope: 1 }, chars: 4.6 });
    eq(race, {
        at: 12, wpm: 0, accuracy: 100, seconds: 0, chars: 5, errors: 0,
        correctionMs: 0, cleanWpm: 0, quoteId: '[object Object]', place: 0, of: 0,
    });
});

// ------------------------------------------------ reading typeracer.com

const TyperRead = require('../src/content/typeracer-read.js');

/**
 * A TypeRacer-shaped page: `bySelector` maps a spelling in TyperRead.SELECTORS
 * to what it finds. The validation is under test here; whether a spelling is
 * still current is the browser suite's question.
 */
function stubPage(bySelector) {
    const pick = (selector) => bySelector[selector] || null;
    return {
        querySelector: (selector) => {
            const hit = pick(selector);
            return Array.isArray(hit) ? (hit[0] || null) : hit;
        },
        querySelectorAll: (selector) => {
            const hit = pick(selector);
            if (!hit) return [];
            return Array.isArray(hit) ? hit : [hit];
        },
    };
}

/** One element, on screen and the size of a line of text. */
const stubNode = (textContent, extra = {}) => ({
    textContent,
    isConnected: true,
    children: [],
    firstElementChild: null,
    getAttribute: (name) => (extra.attrs || {})[name] || null,
    getBoundingClientRect: () => ({ width: extra.hidden ? 0 : 200, height: extra.hidden ? 0 : 18 }),
    ...extra,
});

section('typeracer — reading the address bar');
check('the pit and a race are race pages, and the rest of the site is not', () => {
    eq(TyperRead.isRacePage('/'), true, 'the front door is the pit');
    eq(TyperRead.isRacePage('/pit/'), true);
    eq(TyperRead.isRacePage('/race'), true);
    eq(TyperRead.isRacePage('/play'), true);
    eq(TyperRead.isRacePage('/pit/profile'), true, 'still under the pit');
    eq(TyperRead.isRacePage('/texts'), false);
    eq(TyperRead.isRacePage('/forum/thread'), false);
});

section('typeracer — reading the quote');
check('a quote is believed only once it is long enough to be one', () => {
    const long = 'The quick brown fox jumps over the lazy dog and keeps going.';
    eq(TyperRead.quoteText(stubPage({ '.inputPanelText': stubNode(long) })), long);
    // A selector that has started matching a chat bubble reports nothing,
    // the same way a chess move list that does not parse is passed over.
    eq(TyperRead.quoteText(stubPage({ '.inputPanelText': stubNode('Loading…') })), null);
    eq(TyperRead.quoteText(stubPage({})), null);
});
check('the panel’s line wrapping does not end up in the quote', () => {
    const wrapped = stubNode('  The quick brown\n  fox jumps over   the lazy dog.  ');
    eq(TyperRead.quoteText(stubPage({ '.inputPanelText': wrapped })),
        'The quick brown fox jumps over the lazy dog.');
});
check('a later spelling is used when the first no longer matches', () => {
    const long = 'The quick brown fox jumps over the lazy dog and keeps going.';
    eq(TyperRead.quoteText(stubPage({ '.raceQuote': stubNode(long) })), long);
});

section('typeracer — the box you type in');
check('a read-only box between races is not the one to listen on', () => {
    const live = stubNode('', { tagName: 'INPUT' });
    const spent = stubNode('', { tagName: 'INPUT', readOnly: true });
    eq(TyperRead.inputBox(stubPage({ 'input.txtInput': spent })), null);
    assert(TyperRead.inputBox(stubPage({ 'input.txtInput': live })) === live, 'the live box was passed over');
});
check('a box with no box is not on screen', () => {
    const hidden = stubNode('', { tagName: 'INPUT', hidden: true });
    eq(TyperRead.inputBox(stubPage({ 'input.txtInput': hidden })), null);
});
check('something that is not a field cannot be the field', () => {
    const div = stubNode('', { tagName: 'DIV' });
    eq(TyperRead.inputBox(stubPage({ 'input.txtInput': div })), null);
});

section('typeracer — the results panel');
const resultsOf = (text) => TyperRead.readResult(stubPage({ 'table.raceResults': stubNode(text) }));

check('speed, accuracy and finishing place are read off the scoreboard', () => {
    const result = resultsOf('You finished 2nd out of 5! Speed: 84 WPM Accuracy: 97.4%');
    eq(result.wpm, 84);
    eq(result.accuracy, 97.4);
    eq(result.place, 2);
    eq(result.of, 5);
});
check('a solo run has a speed and no placing', () => {
    const result = resultsOf('Speed: 71 WPM Accuracy: 95%');
    eq(result.wpm, 71);
    eq(result.place, null);
    eq(result.of, null);
});
check('a field that does not parse is null rather than nought', () => {
    // A zero is a value: it would go into the mean the dashboard draws and
    // stay there. Nothing read has to stay distinguishable from nothing done.
    eq(resultsOf('Race complete!'), { wpm: null, accuracy: null, place: null, of: null });
    eq(TyperRead.readResult(stubPage({})), { wpm: null, accuracy: null, place: null, of: null });
});
check('a reading outside what a race can be is dropped', () => {
    // 4000 WPM is a renamed table whose digits happen to sit next to the
    // letters "wpm", not somebody typing.
    eq(resultsOf('Speed: 4000 WPM Accuracy: 99%').wpm, null);
    eq(resultsOf('Speed: 0 WPM').wpm, null);
    eq(resultsOf('Speed: 60 WPM Accuracy: 140%').accuracy, null);
});
check('the quote’s own id is taken from the link beside the result', () => {
    const link = stubNode('see this text', { attrs: { href: '/text?id=3810721' } });
    eq(TyperRead.quoteId(stubPage({ 'a[href*="/text?id="]': link })), '3810721');
    eq(TyperRead.quoteId(stubPage({})), '', 'a race with no link is not an error');
});

section('typeracer — where the caret belongs');
check('nothing typed yet puts the caret on the front of the quote', () => {
    const first = stubNode('The');
    const panel = stubNode('The quick brown fox', { firstElementChild: first, children: [first] });
    assert(TyperRead.caretAnchor(stubPage({ '.inputPanelText': panel })) === first, 'not the first piece');
});
check('the caret is the first piece the site has not marked as typed', () => {
    const done = stubNode('The quick ');
    const next = stubNode('brown fox');
    const panel = stubNode('The quick brown fox', { firstElementChild: done, children: [done, next] });
    const page = stubPage({ '.inputPanelText': panel, '.inputPanelText span.txtHighlight': done });
    assert(TyperRead.caretAnchor(page) === next, 'the caret stayed on what was already typed');
});
check('a quote that cannot be read draws no caret at all', () => {
    // Degrade, never guess. A caret in the wrong place over the word you are
    // reading is worse than none, and worse in a way you cannot switch off
    // without going to find the setting.
    eq(TyperRead.caretAnchor(stubPage({})), null);
    const bare = stubNode('The quick brown fox');
    eq(TyperRead.caretAnchor(stubPage({ '.inputPanelText': bare })), null, 'no pieces to point at');
});
check('a finished quote has nothing left to point at', () => {
    const done = stubNode('The quick brown fox');
    const panel = stubNode('The quick brown fox', { firstElementChild: done, children: [done] });
    eq(TyperRead.caretAnchor(stubPage({ '.inputPanelText': panel, '.inputPanelText span.txtHighlight': done })), null);
});

// ------------------------------------------------ typing on typeracer.com

const TyperUi = require('../src/content/typeracer-ui.js');

/**
 * Drive a race without a browser: the capture listener, the clock and the
 * page's readers are stubbed, and `record` is intercepted, as what is written
 * is under test. `clock` moves by hand, or a test would time this machine.
 */
function withTyperPage(run, { settings = {}, quote = '' } = {}) {
    const BB = globalThis.BB;
    const saved = {
        document: global.document,
        performance: global.performance,
        location: global.location,
        raf: global.requestAnimationFrame,
        caf: global.cancelAnimationFrame,
        record: BB.Typer.record,
        readResult: BB.TyperRead.readResult,
        quoteId: BB.TyperRead.quoteId,
        quoteText: BB.TyperRead.quoteText,
        find: BB.TyperRead.find,
    };

    const handlers = {};
    global.document = {
        addEventListener: (type, fn) => { handlers[type] = fn; },
        removeEventListener: (type) => { delete handlers[type]; },
        // The caret draws nothing on its default, but its teardown is
        // unconditional, and would fail on a page with no <html>.
        documentElement: { classList: { add() {}, remove() {}, contains: () => false, toggle() {} } },
    };
    global.location = { pathname: '/' };
    // Frames are collected rather than run: what these tests are about is what
    // the keystroke handler does, and a caret redraw is a page away.
    const frames = [];
    global.requestAnimationFrame = (fn) => frames.push(fn);
    global.cancelAnimationFrame = () => {};

    let clock = 1000;
    global.performance = { now: () => clock };

    const page = { quote, results: null, quoteId: '' };
    BB.TyperRead.quoteText = () => page.quote || null;
    BB.TyperRead.find = (names) => (names === 'results' ? page.results : null);
    BB.TyperRead.readResult = () => page.results || { wpm: null, accuracy: null, place: null, of: null };
    BB.TyperRead.quoteId = () => page.quoteId;

    const written = [];
    BB.Typer.record = (race, events) => {
        written.push({ race, events });
        return Promise.resolve(null);
    };

    const tasks = new Map();
    const watcher = {
        add: (name, fn) => tasks.set(name, fn),
        remove: (name) => tasks.delete(name),
        schedule() {}, has: (name) => tasks.has(name),
    };

    const ui = TyperUi.createTyperUi({
        watcher,
        notify: () => {},
        getSettings: () => ({ ...BB.Settings.DEFAULTS, ...settings }),
    });
    ui.install();

    /** Type `text`, one `beforeinput` per character, `step` ms apart; `<` is a backspace. */
    const box = makeBox();
    const type = (text, { step = 200, into = box } = {}) => {
        for (const ch of text) {
            clock += step;
            into.selectionStart = into.selectionEnd = 1;
            if (ch === '<') {
                into.value = 'x';
                handlers.beforeinput({ inputType: 'deleteContentBackward', data: null, target: into });
            } else {
                into.value = ch;
                handlers.beforeinput({ inputType: 'insertText', data: ch, target: into });
            }
        }
    };

    const pass = () => tasks.get('typer-race')();

    try {
        return run({ ui, page, type, pass, written, watcher, handlers, box, wait: (ms) => { clock += ms; } });
    } finally {
        ui.uninstall();
        Object.assign(global, {
            document: saved.document, performance: saved.performance, location: saved.location,
            requestAnimationFrame: saved.raf, cancelAnimationFrame: saved.caf,
        });
        BB.Typer.record = saved.record;
        BB.TyperRead.readResult = saved.readResult;
        BB.TyperRead.quoteId = saved.quoteId;
        BB.TyperRead.quoteText = saved.quoteText;
        BB.TyperRead.find = saved.find;
    }
}

/** A stand-in text box: what it is, what it holds, and which spellings it matches. */
function makeBox(selector = 'input.txtInput') {
    return {
        nodeType: 1, tagName: 'INPUT', readOnly: false, disabled: false,
        value: '', selectionStart: 0, selectionEnd: 0,
        matches: (spelling) => spelling === selector,
    };
}

section('typeracer — counting what a delete took away');
check('a plain backspace is one character', () => {
    eq(TyperUi.deletedCount({ value: 'the', selectionStart: 3, selectionEnd: 3 }, 'deleteContentBackward'), 1);
});
check('a selection being replaced takes all of it', () => {
    eq(TyperUi.deletedCount({ value: 'the quick', selectionStart: 4, selectionEnd: 9 }, 'deleteContentBackward'), 5);
});
check('a word delete is measured off the text rather than guessed at', () => {
    // Guessing 1 would leave our position in the quote wrong for the rest of
    // the race, and every interval after it silently spoiled.
    eq(TyperUi.deletedCount({ value: 'the quick', selectionStart: 9, selectionEnd: 9 }, 'deleteWordBackward'), 5);
    eq(TyperUi.deletedCount({ value: 'the', selectionStart: 3, selectionEnd: 3 }, 'deleteWordBackward'), 3);
});
check('a forward delete at the end of the box takes nothing', () => {
    eq(TyperUi.deletedCount({ value: 'the', selectionStart: 3, selectionEnd: 3 }, 'deleteContentForward'), 0);
    eq(TyperUi.deletedCount({ value: 'the', selectionStart: 1, selectionEnd: 1 }, 'deleteContentForward'), 1);
});
check('an input that cannot say is treated as one character', () => {
    eq(TyperUi.deletedCount(null, 'deleteContentBackward'), 1);
    eq(TyperUi.deletedCount({ value: 'x' }, 'deleteContentBackward'), 1);
});

section('typeracer — measuring a race');
check('a new quote starts a race and the keys go into it', () => {
    withTyperPage(({ ui, pass, type }) => {
        pass();
        type('the');
        const race = ui.currentRace();
        eq(race.events.map((e) => e.ch), ['t', 'h', 'e']);
        eq(race.events.every((e) => e.ok), true);
        eq(race.depth, 3);
    }, { quote: 'the quick brown fox jumps over it' });
});
check('the expected character is our own position, not the box’s', () => {
    // TypeRacer empties the box after every word, so its length stops being
    // the position in the quote the moment the first space goes in.
    withTyperPage(({ ui, pass, type }) => {
        pass();
        type('the quick');
        const race = ui.currentRace();
        eq(race.events.map((e) => e.expected).join(''), 'the quick');
        eq(race.events.some((e) => !e.ok), false);
    }, { quote: 'the quick brown fox jumps over it' });
});
check('a wrong key is recorded against what was due', () => {
    withTyperPage(({ ui, pass, type }) => {
        pass();
        type('tge');
        const [, wrong] = ui.currentRace().events;
        eq(wrong.ch, 'g');
        eq(wrong.expected, 'h');
        eq(wrong.ok, false);
    }, { quote: 'the quick brown fox jumps over it' });
});
check('a backspace steps the position back and is recorded as one', () => {
    withTyperPage(({ ui, pass, type }) => {
        pass();
        type('tg<h');
        const race = ui.currentRace();
        eq(race.depth, 2);
        eq(race.events.map((e) => (e.del ? '<' : e.ch)).join(''), 'tg<h');
        eq(race.events[3].expected, 'h', 'the retype is compared against the same position');
    }, { quote: 'the quick brown fox jumps over it' });
});
check('keys typed into another box on the page are not part of the race', () => {
    // The listener is on document, so TypeRacer's chat is heard too. Those
    // keys used to push the position on and mark the rest of the quote wrong.
    withTyperPage(({ ui, pass, type }) => {
        pass();
        type('the');
        type('gg', { into: makeBox('.chatInput') });
        type(' qu');
        const race = ui.currentRace();
        eq(race.depth, 6);
        eq(race.events.every((e) => e.ok), true, 'the chat keys were counted as mistakes');
    }, { quote: 'the quick brown fox jumps over it' });
});
check('the race box is the first one a key lands in, and only that one', () => {
    withTyperPage(({ ui, pass, type }) => {
        pass();
        const first = makeBox();
        const second = makeBox();
        type('th', { into: first });
        type('xx', { into: second });
        eq(ui.currentRace().depth, 2, 'a second matching box mid-race was taken as the race box');
    }, { quote: 'the quick brown fox jumps over it' });
});
check('deleting past the start of the quote is not recorded', () => {
    withTyperPage(({ ui, pass, type }) => {
        pass();
        type('t<<<');
        eq(ui.currentRace().depth, 0);
        eq(ui.currentRace().events.filter((e) => e.del).length, 1, 'only the one that had something to take');
    }, { quote: 'the quick brown fox jumps over it' });
});

section('typeracer — ending a race');
check('the results panel appearing files the race', () => {
    withTyperPage(({ page, pass, type, written }) => {
        pass();
        type('the quick brown fox');
        page.results = { wpm: 84, accuracy: 97, place: 2, of: 5 };
        page.quoteId = '3810721';
        pass();

        eq(written.length, 1);
        const { race } = written[0];
        eq(race.wpm, 84);
        eq(race.accuracy, 97);
        eq(race.place, 2);
        eq(race.of, 5);
        eq(race.chars, 19);
        eq(race.quoteId, '3810721');
        // 19 characters at 200ms each, measured from the first to the last.
        eq(race.seconds, 3.6);
    }, { quote: 'the quick brown fox jumps over it' });
});
check('a quote typed to the end is a finished race, scoreboard or not', () => {
    const quote = 'the quick brown fox jumps';
    withTyperPage(({ ui, pass, type, written, wait }) => {
        pass();
        type(quote);
        pass();
        eq(written.length, 0, 'the scoreboard is still worth a moment’s wait');
        wait(TyperUi.RESULT_WAIT_MS);
        pass();
        eq(written.length, 1, 'a race with no results panel was left open');
        eq(written[0].race.chars, quote.length);
        eq(written[0].race.wpm, null, 'a speed was invented rather than left to the store');
        eq(ui.currentRace(), null);
    }, { quote });
});
check('a quote ending on a wrong character is not finished until it is fixed', () => {
    const quote = 'the quick brown fox jumps';
    withTyperPage(({ ui, pass, type, written, wait }) => {
        pass();
        type(`${quote.slice(0, -1)}x`);
        wait(TyperUi.RESULT_WAIT_MS);
        pass();
        eq(written.length, 0, 'a box still holding a mistake was taken as the finish');
        type('<s');
        wait(TyperUi.RESULT_WAIT_MS);
        pass();
        eq(written.length, 1);
        eq(ui.currentRace(), null);
    }, { quote });
});
check('the last race’s scoreboard neither ends this one nor is filed with it', () => {
    // It used to end the new race on the first pass, too short to bank, and
    // the whole race went with it.
    withTyperPage(({ page, pass, type, written, wait }) => {
        page.results = { wpm: 61, accuracy: 90, place: 3, of: 4 };
        page.quoteId = '111';
        pass();
        type('the quick brown fox jumps');
        pass();
        eq(written.length, 0, 'a stale panel ended the race');
        wait(TyperUi.RESULT_WAIT_MS);
        pass();
        eq(written.length, 1);
        eq(written[0].race.wpm, null, 'the old race’s speed was filed against this one');
        eq(written[0].race.quoteId, '', 'and its quote id');
    }, { quote: 'the quick brown fox jumps' });
});
check('a false start is not a race', () => {
    withTyperPage(({ page, pass, type, written }) => {
        pass();
        type('the');
        page.results = { wpm: 84, accuracy: 97, place: null, of: null };
        pass();
        eq(written.length, 0);
    }, { quote: 'the quick brown fox jumps over it' });
});
check('a new quote under a running race banks the old one', () => {
    withTyperPage(({ page, pass, type, written, wait }) => {
        pass();
        type('the quick brown fox');
        page.quote = 'every good boy deserves favour and so on';
        wait(TyperUi.QUOTE_SAMPLE_MS + 1);
        pass();
        eq(written.length, 1, 'the first race was dropped rather than banked');
        eq(written[0].race.chars, 19, 'what was typed belongs to the quote it was typed against');
    }, { quote: 'the quick brown fox jumps over it' });
});
check('the quote is not re-read on every pass of the observer', () => {
    // TypeRacer moves its own highlight as you type, so the shared observer
    // fires continuously through a race; textContent on the quote panel
    // concatenates three hundred characters every time it is asked.
    withTyperPage(({ pass, type, wait }) => {
        pass();
        type('the quick');
        pass();

        let reads = 0;
        const real = globalThis.BB.TyperRead.quoteText;
        globalThis.BB.TyperRead.quoteText = () => { reads++; return real(); };
        for (let i = 0; i < 60; i++) pass();
        eq(reads, 0, 'a frame inside the sample window re-read the quote');

        wait(TyperUi.QUOTE_SAMPLE_MS + 1);
        pass();
        globalThis.BB.TyperRead.quoteText = real;
        eq(reads, 1, 'and the window never reopens');
    }, { quote: 'the quick brown fox jumps over it' });
});
check('tracking turned off stops the race already in progress', () => {
    withTyperPage(({ ui, page, pass, type, written }) => {
        pass();
        type('the quick brown fox');
        ui.refreshSurfaces();
        page.results = { wpm: 84, accuracy: 97, place: null, of: null };
        pass();
        eq(written.length, 0);
        eq(ui.currentRace(), null);
    }, { quote: 'the quick brown fox jumps over it', settings: { typerTrack: false } });
});
check('leaving the pit abandons the race rather than banking it', () => {
    // A race you navigated away from mid-quote has no honest finishing time.
    withTyperPage(({ ui, pass, type, written }) => {
        pass();
        type('the quick brown fox');
        ui.onNavigate();
        eq(ui.currentRace(), null);
        eq(written.length, 0);
    }, { quote: 'the quick brown fox jumps over it' });
});
check('a page of the site with no race on it gets no race', () => {
    withTyperPage(({ ui, pass }) => {
        global.location.pathname = '/texts';
        pass();
        eq(ui.currentRace(), null);
    }, { quote: 'the quick brown fox jumps over it' });
});

section('typeracer — what correcting cost');
check('the window is the span from the wrong key to the restored prefix', () => {
    // t, h, x, q, u, three backspaces, then the right letters: the clock runs
    // from the x to the backspace that removes it, when the box is right again.
    const at = (ms) => ms;
    const events = [
        { ch: 't', expected: 't', at: at(0), ok: true },
        { ch: 'h', expected: 'h', at: at(200), ok: true },
        { ch: 'x', expected: 'e', at: at(400), ok: false },
        { ch: ' ', expected: ' ', at: at(600), ok: true },
        { ch: 'q', expected: 'q', at: at(800), ok: true },
        { del: true, at: at(1000) },
        { del: true, at: at(1150) },
        { del: true, at: at(1300) },
        { ch: 'e', expected: 'e', at: at(1500), ok: true },
    ];
    eq(Typer.gramsFrom(events).correctionMs, 900, 'from the x at 400 to the last backspace at 1300');
});
check('a race typed clean bills nothing', () => {
    eq(gramsOf('the quick', 'the quick').correctionMs, 0);
});
check('two separate mistakes are two windows, not one span', () => {
    // A span from the first mistake to the last would bill every clean
    // keystroke in between as correction.
    const events = [
        { ch: 'x', expected: 't', at: 0, ok: false },
        { del: true, at: 100 },
        { ch: 't', expected: 't', at: 200, ok: true },
        { ch: 'h', expected: 'h', at: 400, ok: true },
        { ch: 'e', expected: 'e', at: 600, ok: true },
        { ch: 'z', expected: ' ', at: 800, ok: false },
        { del: true, at: 950 },
    ];
    eq(Typer.gramsFrom(events).correctionMs, 250, '100 for the first, 150 for the second');
});
check('a race abandoned in an error state is billed to its last key', () => {
    // Leaving it out would make the race you gave up on halfway through a
    // word look like the cleanest one in the log.
    const events = [
        { ch: 't', expected: 't', at: 0, ok: true },
        { ch: 'x', expected: 'h', at: 200, ok: false },
        { ch: 'y', expected: 'e', at: 700, ok: false },
    ];
    eq(Typer.gramsFrom(events).correctionMs, 500);
});
check('correcting one mistake does not close the window on another', () => {
    const events = [
        { ch: 'x', expected: 't', at: 0, ok: false },
        { ch: 'y', expected: 'h', at: 100, ok: false },
        { del: true, at: 200 },
        { ch: 'h', expected: 'h', at: 300, ok: true },
        { del: true, at: 400 },
        { del: true, at: 500 },
        { ch: 't', expected: 't', at: 600, ok: true },
    ];
    // The box still held the wrong `x` at 200 and at 400; it is only clean
    // once the second backspace at 500 takes that one off too.
    eq(Typer.gramsFrom(events).correctionMs, 500);
});

section('typeracer — clean speed');
check('clean speed is the same race with the error windows taken out', () => {
    // 60 seconds, 6 of them spent correcting: the same characters in 54
    // seconds is 60/54 of the speed.
    eq(Typer.cleanWpmOf(90, 60, 6000), 100);
    eq(Typer.cleanWpmOf(90, 60, 0), 90, 'a clean race is its own clean speed');
});
check('clean speed is above the race’s own whenever anything was corrected', () => {
    const state = Typer.recordRace(Typer.blank(), { at: R0, seconds: 10 }, stream('the quick', 'thx q<<<e quick'), R0);
    const race = state.races[0];
    assert(race.correctionMs > 0, 'nothing was billed');
    assert(race.cleanWpm > race.wpm, `${race.cleanWpm} is not above ${race.wpm}`);
});
check('a race with nothing to correct has one speed under two names', () => {
    const state = Typer.recordRace(Typer.blank(), { at: R0, seconds: 10 }, stream('the quick', 'the quick'), R0);
    eq(state.races[0].correctionMs, 0);
    eq(state.races[0].cleanWpm, state.races[0].wpm);
});
check('a race that was nothing but correcting reports its own speed', () => {
    // Rather than an infinity, or a division by what is left of nothing.
    eq(Typer.cleanWpmOf(40, 5, 5000), 40);
    eq(Typer.cleanWpmOf(40, 0, 0), 40);
});

section('typeracer — the cost over a range');
const costRace = (at, wpm, cleanWpm, seconds, correctionMs) =>
    ({ at, wpm, cleanWpm, seconds, correctionMs, accuracy: 95, chars: 200 });

check('the cost is the seconds lost and the speed they cost', () => {
    const cost = Typer.correctionCost([
        costRace(R0, 80, 88, 30, 3000),
        costRace(R0 - 1000, 70, 77, 30, 3000),
    ]);
    eq(cost.races, 2);
    eq(cost.seconds, 6);
    eq(cost.wpm, 75);
    eq(cost.cleanWpm, 82.5);
    eq(cost.delta, 7.5);
    eq(cost.percent, 10, 'six seconds out of sixty');
});
check('a range leaves out what is outside it', () => {
    const cost = Typer.correctionCost([
        costRace(R0, 80, 88, 30, 3000),
        costRace(R0 - 10 * Typer.DAY_MS, 40, 60, 30, 9000),
    ], { since: R0 - Typer.DAY_MS });
    eq(cost.races, 1);
    eq(cost.wpm, 80);
});
check('no races in the range is nought rather than a division by none', () => {
    eq(Typer.correctionCost([], { since: R0 }), { races: 0, seconds: 0, wpm: 0, cleanWpm: 0, delta: 0, percent: 0 });
});
check('a race stored before clean speed existed falls back to its own', () => {
    // The store is older than this figure; a missing cleanWpm must read as
    // "no correction measured", not as a race typed at nought.
    const cost = Typer.correctionCost([{ at: R0, wpm: 80, seconds: 30 }]);
    eq(cost.cleanWpm, 80);
    eq(cost.delta, 0);
});

section('typeracer — the typing caret');
check('the caret cycles through every shape and back to the site’s own', () => {
    const seen = [];
    let mode = 'site';
    for (let i = 0; i < TyperUi.SHAPES.length + 1; i++) {
        mode = TyperUi.SHAPES[(TyperUi.SHAPES.indexOf(mode) + 1) % TyperUi.SHAPES.length];
        seen.push(mode);
    }
    eq(seen, ['bar', 'block', 'underline', 'outline', 'site', 'bar']);
    eq(TyperUi.SHAPES[0], 'site', 'the setting’s default has to be the first rung');
    eq(globalThis.BB.Settings.DEFAULTS.typerCaret, 'site');
});
check('the caret shapes and the setting cannot drift apart', () => {
    // The settings <select> is built from this list, and a shape the panel
    // can offer but the page cannot draw would fail silently.
    const html = require('fs').readFileSync(`${__dirname}/../content-typeracer.css`, 'utf8');
    for (const shape of TyperUi.SHAPES) {
        if (shape === 'site') continue;
        assert(html.includes(`[data-bb-caret="${shape}"]`), `${shape} has no rule to draw it`);
    }
});
check('the caret is drawn from the skin’s tokens rather than a colour', () => {
    // So it follows a skin or a day/night change without being redrawn, the
    // rule every surface this extension injects follows.
    const css = require('fs').readFileSync(`${__dirname}/../content-typeracer.css`, 'utf8');
    const block = css.slice(css.indexOf('.bb-typer-caret {'));
    const hard = block.match(/:\s*#[0-9a-f]{3,8}\b/gi) || [];
    eq(hard, [], `a colour was baked into the caret: ${hard.join(', ')}`);
    assert(/\.bb-typer-caret\[data-bb-caret="bar"\][^}]*var\(--bb-accent\)/.test(block), 'the bar is not the accent');
});
check('the caret hotkey is modified enough to survive a race', () => {
    const Keybindings = require('../src/shared/keybindings.js');
    eq(Keybindings.SCOPES.typeracer, 'TypeRacer');
    eq(Keybindings.list({}, 'typeracer').map((b) => b.id), ['typer-caret']);
    const [binding] = Keybindings.list({}, 'typeracer');
    // It fires with the caret inside the box you are racing in, where a bare
    // letter is a letter you meant to type.
    assert(binding.combo.ctrl && binding.combo.alt, 'a racer would trigger this by typing');
    eq(Keybindings.conflicts({}, binding.id, binding.combo), []);
});

/** A quote panel whose untyped remainder is one text node, like the site's. */
function withCaretPage(run, { settings = {}, anchor = 'the quick brown fox' } = {}) {
    const BB = globalThis.BB;
    const saved = { caretAnchor: BB.TyperRead.caretAnchor, appearance: BB.Theme.appearance };

    const html = { classes: new Set(), classList: null };
    html.classList = {
        add: (name) => html.classes.add(name),
        remove: (name) => html.classes.delete(name),
        contains: (name) => html.classes.has(name),
        toggle: (name, want) => (want ? html.classes.add(name) : html.classes.delete(name)),
    };

    const made = [];
    const element = () => {
        const node = {
            style: {}, dataset: {}, isConnected: true, attributes: {},
            classList: { toggle() {}, add() {}, remove() {} },
            setAttribute(name, value) { this.attributes[name] = value; },
            removeAttribute(name) { delete this.attributes[name]; },
            remove() { this.isConnected = false; },
        };
        made.push(node);
        return node;
    };

    const page = { anchor: null };
    const setAnchor = (text) => {
        page.anchor = text == null ? null : {
            firstChild: { nodeType: 3, data: text },
            attributes: {},
            setAttribute(name, value) { this.attributes[name] = value; },
            removeAttribute(name) { delete this.attributes[name]; },
            getBoundingClientRect: () => ({ left: 40, top: 120, width: 300, height: 22 }),
        };
    };
    setAnchor(anchor);

    const frames = [];
    const savedGlobals = {
        document: global.document, window: global.window, location: global.location,
        raf: global.requestAnimationFrame, caf: global.cancelAnimationFrame,
        performance: global.performance,
    };

    global.document = {
        documentElement: html,
        body: { appendChild() {} },
        createElement: () => element(),
        createRange: () => ({
            setStart() {}, setEnd() {},
            getBoundingClientRect: () => ({ left: 40, top: 120, width: 9, height: 22 }),
        }),
        addEventListener() {}, removeEventListener() {},
    };
    global.location = { pathname: '/' };
    global.performance = { now: () => 1000 };
    global.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
    global.cancelAnimationFrame = () => {};

    BB.TyperRead.caretAnchor = () => page.anchor;
    BB.Theme.appearance = () => Promise.resolve({ theme: 'light', skin: 'default' });

    const tasks = new Map();
    const watcher = { add: (n, f) => tasks.set(n, f), remove: (n) => tasks.delete(n), schedule() {}, has: (n) => tasks.has(n) };
    const ui = TyperUi.createTyperUi({
        watcher, notify: () => {},
        getSettings: () => ({ ...BB.Settings.DEFAULTS, ...settings }),
    });
    ui.install();

    const flush = () => { const queued = frames.splice(0); queued.forEach((fn) => fn()); };

    try {
        return run({ ui, html, flush, frames, setAnchor, made, anchorNode: () => page.anchor });
    } finally {
        ui.uninstall();
        Object.assign(global, {
            document: savedGlobals.document, window: savedGlobals.window, location: savedGlobals.location,
            requestAnimationFrame: savedGlobals.raf, cancelAnimationFrame: savedGlobals.caf,
            performance: savedGlobals.performance,
        });
        BB.TyperRead.caretAnchor = saved.caretAnchor;
        BB.Theme.appearance = saved.appearance;
    }
}

check('the default setting draws nothing and asks for no frames', () => {
    // 'site' is the default, so on an ordinary visit this whole section is
    // one comparison per keystroke and nothing else.
    withCaretPage(({ ui, frames, html }) => {
        eq(ui.caretMode(), 'site');
        eq(frames.length, 0);
        eq(ui.caretElement(), null);
        eq(html.classes.has(TyperUi.CARET_ON), false);
    });
});
check('a shape puts a caret over the next character', () => {
    withCaretPage(({ ui, flush, html }) => {
        flush();
        const caret = ui.caretElement();
        assert(caret, 'nothing was drawn');
        // The glyph box, not the block of untyped text the anchor spans.
        eq(caret.style.width, '9px');
        eq(caret.style.height, '22px');
        eq(caret.style.transform, 'translate(40px, 120px)');
        eq(caret.dataset.bbCaret, 'bar');
        eq(html.classes.has(TyperUi.CARET_ON), true, 'the site’s own caret is still up');
    }, { settings: { typerCaret: 'bar' } });
});
check('the element holding the next character is marked, never rewritten', () => {
    // Nothing is removed from TypeRacer's markup: a class on <html> plus a
    // mark on that one element is the whole mechanism, so leaving is one
    // class removal rather than a reconstruction of somebody else's page.
    withCaretPage(({ ui, flush, anchorNode, html }) => {
        flush();
        eq(Object.keys(anchorNode().attributes), [TyperUi.ANCHOR_ATTR]);
        eq(html.classes.has(TyperUi.CARET_ON), true);

        ui.applyCaret('site');
        eq(Object.keys(anchorNode().attributes), [], 'the mark was left on the page');
    }, { settings: { typerCaret: 'block' } });
});
check('the caret follows the quote rather than staying on one piece', () => {
    withCaretPage(({ ui, flush, setAnchor, anchorNode }) => {
        flush();
        const first = anchorNode();
        setAnchor('brown fox');
        ui.drawCaret();
        assert(anchorNode() !== first, 'the page did not move on');
        eq(Object.keys(first.attributes), [], 'the piece already typed kept the mark');
        eq(Object.keys(anchorNode().attributes), [TyperUi.ANCHOR_ATTR]);
    }, { settings: { typerCaret: 'bar' } });
});
check('one frame is asked for however many keys land in it', () => {
    withCaretPage(({ ui, frames }) => {
        frames.length = 0;
        ui.applyCaret('bar');
        const first = frames.length;
        ui.applyCaret('bar');
        ui.applyCaret('bar');
        eq(frames.length, first, 'a second frame was queued before the first ran');
    }, { settings: { typerCaret: 'bar' } });
});
check('two misses in a row and the caret leaves the page alone', () => {
    // A caret in the wrong place over the word you are reading is worse than
    // none, and worse in a way you cannot switch off without going to look.
    withCaretPage(({ ui, flush, setAnchor, html }) => {
        flush();
        assert(ui.caretElement(), 'nothing was drawn to begin with');

        setAnchor(null);
        ui.applyCaret('bar');
        ui.drawCaret();
        eq(ui.caretGaveUp(), false, 'one miss is the gap between races');
        ui.drawCaret();
        eq(ui.caretGaveUp(), true);
        eq(ui.caretElement(), null);
        eq(html.classes.has(TyperUi.CARET_ON), false, 'the page was not given back');
    }, { settings: { typerCaret: 'bar' } });
});
check('turning the caret off gives the page back on the spot', () => {
    withCaretPage(({ ui, flush, html }) => {
        flush();
        assert(ui.caretElement(), 'nothing was drawn');
        ui.applyCaret('site');
        eq(ui.caretElement(), null);
        eq(html.classes.has(TyperUi.CARET_ON), false);
    }, { settings: { typerCaret: 'outline' } });
});
check('uninstalling takes the caret and the class with it', () => {
    let after = null;
    withCaretPage(({ ui, flush, html }) => {
        flush();
        assert(html.classes.has(TyperUi.CARET_ON), 'the class never went on');
        after = html;
        void ui;
    }, { settings: { typerCaret: 'block' } });
    eq(after.classes.has(TyperUi.CARET_ON), false, 'uninstall left the page marked');
});

// ------------------------------------------------------ typing sounds

const Sfx = require('../src/shared/sfx.js');

section('the sound module');
check('a page with no Web Audio is quiet rather than broken', () => {
    // Node has no AudioContext, which is the same shape as a browser that
    // refuses one. Nothing here may throw: play() sits inside a keydown
    // handler on a typing test.
    eq(Sfx.available(), false);
    eq(Sfx.state(), 'none');
    Sfx.unlock();
    Sfx.play('click');
    Sfx.play('click', { volume: 150, detune: -36 });
    Sfx.play('nonesuch');
    eq(Sfx.state(), 'none', 'a context was opened without a gesture');
});
check('every voice is playable and says how to play it', () => {
    for (const id of Sfx.VOICE_IDS) {
        const voice = Sfx.VOICES[id];
        assert(['sine', 'square', 'triangle', 'sawtooth'].includes(voice.type), `${id} has no waveform`);
        assert(voice.freq > 20 && voice.freq < 8000, `${id} is outside hearing`);
        assert(voice.decay > 0 && voice.decay < 0.5, `${id} rings for ${voice.decay}s`);
        assert(voice.gain > 0 && voice.gain <= 1, `${id} has no level`);
    }
});
check('the key voices are a subset of the voices', () => {
    // The settings <select> is built from KEY_VOICE_IDS, so one that is not
    // in the table would be a silent choice the user could pick.
    for (const id of Sfx.KEY_VOICE_IDS) assert(Sfx.VOICES[id], `${id} is offered but not defined`);
    assert(Sfx.KEY_VOICE_IDS.includes(globalThis.BB.Settings.DEFAULTS.typerSoundVoice),
        'the default voice is not one of the ones offered');
});
check('a key sound is short enough to be over before the next key', () => {
    // 120 words a minute is ten characters a second. A key voice that rings
    // for longer than that overlaps itself into a drone.
    for (const id of Sfx.KEY_VOICE_IDS) {
        assert(Sfx.VOICES[id].decay <= 0.1, `${id} rings for ${Sfx.VOICES[id].decay}s`);
    }
});
check('the three chimes slide rather than sitting on one note', () => {
    // What makes them read as events rather than as another key.
    for (const id of ['start', 'done', 'best']) {
        assert(Sfx.VOICES[id].then, `${id} does not move`);
    }
    assert(Sfx.VOICES.best.then > Sfx.VOICES.done.then, 'a personal best has to land higher than an ordinary finish');
});

section('typeracer — the sound of typing');

/** What was played, without an AudioContext anywhere near it. */
function withSoundPage(run, settings) {
    const played = [];
    const real = globalThis.BB.Sfx.play;
    globalThis.BB.Sfx.play = (id, options) => played.push({ id, ...options });
    try {
        return withTyperPage((tools) => run({ ...tools, played }), {
            settings, quote: 'the quick brown fox jumps over it',
        });
    } finally {
        globalThis.BB.Sfx.play = real;
    }
}

check('nothing is played while the setting is off', () => {
    withSoundPage(({ pass, type, played }) => {
        pass();
        type('the quick');
        eq(played, []);
    }, { typerSound: false });
});
check('a volume of nought is silence rather than a silent sound', () => {
    // The whole path is skipped, so the common case costs one comparison.
    withSoundPage(({ pass, type, played }) => {
        pass();
        type('the quick');
        eq(played, []);
    }, { typerSound: true, typerSoundVolume: 0 });
});
check('each letter takes the chosen voice, pitched by where it is', () => {
    withSoundPage(({ pass, type, played }) => {
        pass();
        type('the');
        eq(played.map((one) => one.id), ['start', 'thock', 'thock', 'thock']);
        const detunes = played.slice(1).map((one) => one.detune);
        eq(new Set(detunes).size, 3, 'three letters in a row came out on one note');
        eq(detunes, [-36, -24, -12]);
    }, { typerSound: true, typerSoundVolume: 60, typerSoundVoice: 'thock' });
});
check('a space is the end of a word rather than another letter', () => {
    withSoundPage(({ pass, type, played }) => {
        pass();
        type('the ');
        eq(played[played.length - 1].id, 'word');
    }, { typerSound: true, typerSoundVolume: 60 });
});
check('a wrong key interrupts, even on a space', () => {
    withSoundPage(({ pass, type, played }) => {
        pass();
        type('thx');
        eq(played[played.length - 1].id, 'error');
    }, { typerSound: true, typerSoundVolume: 60 });
});
check('the error sound can be turned off without turning the rest off', () => {
    withSoundPage(({ pass, type, played }) => {
        pass();
        type('thx');
        eq(played.map((one) => one.id), ['start', 'click', 'click', 'click']);
    }, { typerSound: true, typerSoundVolume: 60, typerErrorSound: false });
});
check('the volume is carried through and may go above a hundred', () => {
    withSoundPage(({ pass, type, played }) => {
        pass();
        type('t');
        eq(played[1].volume, 150, 'gain is not capped at 1 the way an <audio> volume is');
    }, { typerSound: true, typerSoundVolume: 150 });
});
check('a volume past what the slider allows is brought back to it', () => {
    withSoundPage(({ pass, type, played }) => {
        pass();
        type('t');
        eq(played[1].volume, 150);
    }, { typerSound: true, typerSoundVolume: 9000 });
});
check('a voice the table does not hold falls back rather than going quiet', () => {
    withSoundPage(({ pass, type, played }) => {
        pass();
        type('t');
        eq(played[1].id, 'click');
    }, { typerSound: true, typerSoundVolume: 60, typerSoundVoice: 'trumpet' });
});
check('the chime at the end says whether it beat anything', () => {
    withSoundPage(({ ui, page, pass, type, played }) => {
        pass();
        type('the quick brown fox');
        page.results = { wpm: 84, accuracy: 97, place: null, of: null };
        // The store is asked rather than a field kept here: the log is
        // written from every tab, so a best measured against what this page
        // saw would congratulate you for a race you had already beaten.
        ui.endSound({ races: [{ wpm: 84 }, { wpm: 70 }, { wpm: 62 }] });
        eq(played[played.length - 1].id, 'best');
        ui.endSound({ races: [{ wpm: 60 }, { wpm: 70 }] });
        eq(played[played.length - 1].id, 'done');
        ui.endSound({ races: [{ wpm: 60 }] });
        eq(played[played.length - 1].id, 'done', 'the first race ever has nothing to have beaten');
    }, { typerSound: true, typerSoundVolume: 60 });
});

// ------------------------------------------------------- the line chart

const Spark = require('../src/page/spark.js');

/** Every "M12.3 45" and "L12.3 45" in a path, as pairs of numbers. */
function pointsIn(svg, className) {
    const path = new RegExp(`class="${className}" d="([^"]+)"`).exec(svg);
    if (!path) return [];
    return [...path[1].matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

section('the line chart');
check('an empty series draws nothing rather than an empty chart', () => {
    // A 640-pixel box of nothing above the panel's own "no races yet" reads
    // as a chart that has broken.
    eq(Spark.line({ points: [] }), '');
    eq(Spark.line({}), '');
    eq(Spark.line({ points: [{ x: 'soon', y: null }] }), '', 'nothing plottable is nothing');
});
check('one point is still a chart', () => {
    const svg = Spark.line({ points: [{ x: 1000, y: 80 }] });
    assert(svg.includes('<svg'), 'drew nothing at all');
    eq(pointsIn(svg, 'spark-line').length, 1);
});
check('x is scaled by time, not by index', () => {
    // Three races: two on one day and the third a fortnight later. Spacing
    // them evenly is the obvious shape and it is wrong — it draws a break in
    // practice as one flat step.
    const day = 864e5;
    const svg = Spark.line({ points: [
        { x: 0, y: 70 },
        { x: day, y: 75 },
        { x: 15 * day, y: 80 },
    ], width: 640 });
    const [a, b, c] = pointsIn(svg, 'spark-line').map(([x]) => x);
    const first = b - a;
    const second = c - b;
    assert(second > first * 10, `a fortnight (${second}px) was drawn like a day (${first}px)`);
});
check('the series is drawn oldest first however it arrives', () => {
    const svg = Spark.line({ points: [{ x: 300, y: 1 }, { x: 100, y: 2 }, { x: 200, y: 3 }] });
    const xs = pointsIn(svg, 'spark-line').map(([x]) => x);
    eq(xs.slice().sort((p, q) => p - q), xs, 'the line doubles back on itself');
});
check('a run of identical scores is a flat line, not a line at nought', () => {
    const svg = Spark.line({ points: [{ x: 1, y: 80 }, { x: 2, y: 80 }, { x: 3, y: 80 }], height: 160 });
    const ys = pointsIn(svg, 'spark-line').map(([, y]) => y);
    eq(new Set(ys).size, 1, 'a flat series is not flat');
    assert(ys[0] > 40 && ys[0] < 120, `drawn at ${ys[0]}, which is the frame rather than the middle`);
});
check('every race on one day is spaced out rather than stacked', () => {
    // The one case where "by value" has nothing to say, because the span is
    // zero and dividing by it is not an answer.
    const svg = Spark.line({ points: [{ x: 5, y: 70 }, { x: 5, y: 80 }, { x: 5, y: 75 }] });
    const xs = pointsIn(svg, 'spark-line').map(([x]) => x);
    eq(new Set(xs).size, 3);
});
check('nothing about the chart is a colour', () => {
    // The line takes --accent and the band --accent-soft from dashboard.css,
    // so a skin change is followed without redrawing a thing.
    const svg = Spark.line({
        points: [{ x: 1, y: 70 }, { x: 2, y: 80 }],
        band: [{ x: 1, lo: 60, hi: 80 }, { x: 2, lo: 70, hi: 90 }],
        trend: [{ x: 1, y: 70 }, { x: 2, y: 75 }],
        describe: (row) => `${row.y} wpm`,
    });
    eq(svg.match(/#[0-9a-f]{3,8}\b/gi), null);
    eq(/\b(?:fill|stroke)="(?!none)[^"]/.test(svg), false, 'a paint was written into the markup');
});
check('a band and a trend are drawn behind the line, not instead of it', () => {
    const svg = Spark.line({
        points: [{ x: 1, y: 70 }, { x: 2, y: 80 }],
        band: [{ x: 1, lo: 60, hi: 80 }, { x: 2, lo: 70, hi: 90 }],
        trend: [{ x: 1, y: 70 }, { x: 2, y: 75 }],
    });
    assert(svg.indexOf('spark-band') < svg.indexOf('spark-line'), 'the band is over the line');
    assert(svg.indexOf('spark-trend') < svg.indexOf('spark-line'), 'the trend is over the line');
});
check('a tooltip is escaped like everything else this extension writes', () => {
    const svg = Spark.line({ points: [{ x: 1, y: 70 }], describe: () => '<script>&"' });
    assert(svg.includes('&lt;script&gt;&amp;&quot;'), svg);
});

section('the line chart — the run rather than the jitter');
check('the average is trailing, so the last point is the run as it stands', () => {
    // A centred window cannot produce a value for the points at the end,
    // which are the only ones anybody looks at on a chart of how they are
    // doing.
    const points = [10, 20, 30, 40].map((y, i) => ({ x: i, y }));
    eq(Spark.trend(points, 2).map((row) => row.y), [10, 15, 25, 35]);
});
check('the window fills up rather than starting empty', () => {
    const points = [60, 80].map((y, i) => ({ x: i, y }));
    eq(Spark.trend(points, 10).map((row) => row.y), [60, 70], 'the first points are their own average');
});
check('a trend of nothing is nothing', () => {
    eq(Spark.trend([], 5), []);
    eq(Spark.trend(null, 5), []);
});
check('a window of nought does not divide by it', () => {
    eq(Spark.trend([{ x: 1, y: 50 }, { x: 2, y: 70 }], 0).map((row) => row.y), [50, 70]);
});

section('typeracer — the headline figures');
const raceAt = (at, wpm, accuracy = 96, seconds = 30) => ({ at, wpm, accuracy, seconds, chars: 200 });

check('best and the mean of the last ten are both reported', () => {
    // A mean over everything moves too slowly to answer "am I getting
    // faster", and a best on its own is one good afternoon in March.
    const races = [];
    for (let i = 0; i < 20; i++) races.push(raceAt(R0 - i * 1000, i < 10 ? 90 : 50));
    const summary = Typer.summarize(races);
    eq(summary.count, 20);
    eq(summary.best, 90);
    eq(summary.mean, 70);
    eq(summary.meanLast10, 90, 'the last ten are the newest ten, not the first ten stored');
});
check('a range leaves out what is outside it', () => {
    const summary = Typer.summarize([
        raceAt(R0, 90),
        raceAt(R0 - 10 * Typer.DAY_MS, 40),
    ], { since: R0 - Typer.DAY_MS });
    eq(summary.count, 1);
    eq(summary.best, 90);
});
check('an empty range is nought rather than a division by none', () => {
    eq(Typer.summarize([], { since: R0 }),
        { races: [], count: 0, best: 0, mean: 0, meanLast10: 0, accuracy: 0, seconds: 0 });
});
check('the races come back newest first, whatever order they were stored in', () => {
    const summary = Typer.summarize([raceAt(R0 - 5000, 60), raceAt(R0, 80), raceAt(R0 - 1000, 70)]);
    eq(summary.races.map((race) => race.wpm), [80, 70, 60]);
});

section('typeracer — the races panel');

require('../src/page/typeracer-stats.js');
const TyperStats = globalThis.BB.TyperStats;

check('the ranges start at the week rather than at everything', () => {
    // The question a typing log is opened to ask is about this week, and a
    // mean over two years of races cannot answer it.
    eq(TyperStats.RANGES.map((range) => range.id), ['7', '30', 'all']);
    eq(TyperStats.RANGES[0].days, 7);
    eq(TyperStats.sinceOf('all', R0), 0, '"all" is not a window at all');
    eq(TyperStats.sinceOf('30', R0), R0 - 30 * Typer.DAY_MS);
    eq(TyperStats.sinceOf('nonesuch', R0), R0 - 7 * Typer.DAY_MS, 'a range that is not one falls back');
});
check('a solo run has no finishing position to report', () => {
    eq(TyperStats.placeText({ place: 2, of: 5 }), '2 of 5');
    eq(TyperStats.placeText({ place: 0, of: 0 }), '—', 'not "0 of 0"');
});
check('the dashboard writes durations the way the other views do', () => {
    eq(TyperStats.human(45), '45s');
    eq(TyperStats.human(600), '10m');
    eq(TyperStats.human(3900), '1h 05m');
    eq(TyperStats.human(0), '0s');
});
check('a typeracer panel exists for every dashboard tab it draws', () => {
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    assert(/<script src="src\/shared\/typeracer\.js">/.test(html), 'the store is not loaded on the dashboard');
    assert(/<script src="src\/page\/typeracer-stats\.js">/.test(html), 'the panels are not loaded');
    // Load order is manual here — there is no bundler — so a module that
    // destructures another off BB has to come after it or it gets undefined.
    const tagAt = (src) => html.indexOf(`<script src="${src}">`);
    assert(tagAt('src/page/spark.js') < tagAt('src/page/typeracer-stats.js'),
        'the panel is loaded before the chart it draws with');
    assert(tagAt('src/shared/typeracer.js') < tagAt('src/page/typeracer-stats.js'),
        'the panel is loaded before the store it reads');
});

section('typeracer — the slowest grams');

/** A grams table built by hand, so the ranking can be asked exact questions. */
function gramsWith(bi, chars = {}, { totalN = 100, totalMs = 20000 } = {}) {
    const state = { races: [], days: {}, grams: Typer.blankGrams() };
    state.grams.bi = bi;
    state.grams.chars = chars;
    state.grams.totalN = totalN;
    state.grams.totalMs = totalMs;
    return state;
}

check('a gram with too few readings is noise rather than a finding', () => {
    const state = gramsWith({
        th: { n: 3, ms: 1500, err: 0 },
        he: { n: 20, ms: 6000, err: 0 },
    });
    eq(Typer.slowest(state, 'bi', { minSamples: 8 }).map((row) => row.gram), ['he']);
    eq(Typer.slowest(state, 'bi', { minSamples: 3 }).map((row) => row.gram).sort(), ['he', 'th']);
});
check('ranking is against your own baseline, not by raw milliseconds', () => {
    // Reaching for a comma is slower than reaching for "e" for everybody and
    // always will be. Ranking by mean returns every gram containing one,
    // which is true and useless.
    const state = gramsWith({
        // 400ms, but every gram ending in a comma takes about 400ms.
        'e,': { n: 30, ms: 12000, err: 0 },
        // 260ms, where anything ending in "h" normally takes 150.
        th: { n: 30, ms: 7800, err: 0 },
    }, {
        ',': { due: 30, wrong: 0, subs: {}, n: 60, ms: 24000 },
        h: { due: 30, wrong: 0, subs: {}, n: 60, ms: 9000 },
    });
    const rows = Typer.slowest(state, 'bi', { minSamples: 8 });
    eq(rows.map((row) => row.gram), ['th', 'e,'], 'the comma came first, so it was ranked by mean');
    eq(rows[0].ratio, 1.73);
    eq(rows[1].ratio, 1, 'a comma at comma speed is not a weak spot');
});
check('a character with too little of its own falls back to the whole race', () => {
    const state = gramsWith(
        { zq: { n: 10, ms: 4000, err: 0 } },
        { q: { due: 10, wrong: 0, subs: {}, n: 2, ms: 800 } },
        { totalN: 100, totalMs: 20000 },
    );
    const [row] = Typer.slowest(state, 'bi', { minSamples: 8 });
    eq(row.baseline, 200, 'two readings is not a baseline; the race mean is');
    eq(row.ratio, 2);
});
check('a gram reports the speed it implies as well as its mean', () => {
    // A word is five characters, so a 240ms interval is 50 words a minute.
    const state = gramsWith({ th: { n: 10, ms: 2400, err: 0 } });
    const [row] = Typer.slowest(state, 'bi', { minSamples: 8 });
    eq(row.meanMs, 240);
    eq(row.wpm, 50);
    eq(Typer.wpmFor(0), 0, 'and nothing does not divide by nothing');
});
check('the trigram table is asked for separately from the bigram one', () => {
    const state = gramsWith({ th: { n: 10, ms: 2400, err: 0 } });
    state.grams.tri = { the: { n: 10, ms: 3000, err: 0 } };
    eq(Typer.slowest(state, 'bi', { minSamples: 8 }).map((row) => row.gram), ['th']);
    eq(Typer.slowest(state, 'tri', { minSamples: 8 }).map((row) => row.gram), ['the']);
});
check('the order does not reshuffle between two draws of the same data', () => {
    const state = gramsWith({
        ab: { n: 10, ms: 2000, err: 0 },
        cd: { n: 10, ms: 2000, err: 0 },
        ef: { n: 10, ms: 2000, err: 0 },
    });
    const once = Typer.slowest(state, 'bi', { minSamples: 8 }).map((row) => row.gram);
    eq(Typer.slowest(state, 'bi', { minSamples: 8 }).map((row) => row.gram), once);
    eq(once, ['ab', 'cd', 'ef'], 'ties fall back to something stable');
});
check('an empty store is an empty table rather than a crash', () => {
    eq(Typer.slowest(Typer.blank(), 'bi', {}), []);
    eq(Typer.slowest(null, 'tri', {}), []);
});

section('typeracer — the characters you get wrong');
const charsWith = (chars) => gramsWith({}, chars);

check('most often and most likely are two different tables', () => {
    // `e` is mistyped most in absolute terms simply because `e` is
    // everywhere; the rate is the honest number.
    const state = charsWith({
        e: { due: 1000, wrong: 10, subs: { r: 8, w: 2 }, n: 0, ms: 0 },
        q: { due: 12, wrong: 8, subs: { w: 6, a: 2 }, n: 0, ms: 0 },
    });
    eq(Typer.mistyped(state, { by: 'wrong' }).map((row) => row.ch), ['e', 'q']);
    eq(Typer.mistyped(state, { by: 'rate' }).map((row) => row.ch), ['q', 'e']);
});
check('the rate is wrong over due', () => {
    const state = charsWith({ q: { due: 12, wrong: 8, subs: { w: 8 }, n: 0, ms: 0 } });
    eq(Typer.mistyped(state, {})[0].rate, 0.667);
});
check('a character met once and fumbled is not a hundred percent of anything', () => {
    const state = charsWith({
        z: { due: 1, wrong: 1, subs: { x: 1 }, n: 0, ms: 0 },
        q: { due: 12, wrong: 8, subs: { w: 8 }, n: 0, ms: 0 },
    });
    eq(Typer.mistyped(state, { by: 'rate' }).map((row) => row.ch), ['q'], 'the one-off topped the table');
    eq(Typer.mistyped(state, { by: 'wrong' }).map((row) => row.ch), ['q', 'z'], 'but it is still a mistype');
});
check('what you hit instead is the interesting half', () => {
    const state = charsWith({ e: { due: 100, wrong: 20, subs: { r: 12, w: 5, d: 3 }, n: 0, ms: 0 } });
    const [row] = Typer.mistyped(state, {});
    eq(row.topSub, 'r');
    eq(row.subs, [{ ch: 'r', n: 12 }, { ch: 'w', n: 5 }, { ch: 'd', n: 3 }]);
});
check('a character never got wrong is not in a table of mistakes', () => {
    const state = charsWith({ e: { due: 500, wrong: 0, subs: {}, n: 400, ms: 60000 } });
    eq(Typer.mistyped(state, {}), []);
});

section('typeracer — the weak spot panel');
check('a space in a gram is shown rather than left to look like a fault', () => {
    // Half the slow pairs are a letter followed by a space.
    assert(TyperStats.gramGlyph('t ').includes('␣'), TyperStats.gramGlyph('t '));
    eq(TyperStats.gramGlyph('th'), 'th');
});
check('a gram is escaped like everything else this extension writes', () => {
    eq(TyperStats.gramGlyph('<&'), '&lt;&amp;');
});
check('the bar fills by how far past your own baseline the gram is', () => {
    const bar = (ratio) => /width:([\d.]+)%/.exec(TyperStats.ratioBar({ ratio, meanMs: 1, baseline: 1, gram: 'th' }))[1];
    eq(bar(1), '0', 'a gram at your own baseline is not a weak spot');
    eq(bar(1.5), '50');
    eq(bar(3), '100', 'and past twice as slow it is simply full');
    eq(bar(0.5), '0', 'never below empty');
});
check('the noise floor is a setting the panel can be told about', () => {
    const Settings = globalThis.BB.Settings;
    eq(Settings.DEFAULTS.typerMinSamples, Typer.MIN_SAMPLES, 'the store and the setting disagree');
    assert(Settings.DEFAULTS.typerMinSamples >= 3, 'below three there is no mean worth the name');
});

section('typeracer — the practice map');
check('the map is shaped for the heat map, whichever metric is picked', () => {
    let state = Typer.recordRace(Typer.blank(), { at: R0, wpm: 80, seconds: 30 }, [], R0);
    state = Typer.recordRace(state, { at: R0, wpm: 95, seconds: 45 }, [], R0);
    const key = Typer.dayKey(R0);

    eq(Typer.heatDays(state, 'races', R0)[key].value, 2);
    eq(Typer.heatDays(state, 'wpm', R0)[key].value, 95, 'the best of the day, not the last');
    eq(Typer.heatDays(state, 'seconds', R0)[key].value, 75);
    // The other fields ride along, so a square's tooltip can name all three
    // whichever one is being coloured by.
    eq(Typer.heatDays(state, 'wpm', R0)[key].races, 2);
});
check('a metric that is not one falls back rather than colouring by nothing', () => {
    const state = Typer.recordRace(Typer.blank(), { at: R0, wpm: 80, seconds: 30 }, [], R0);
    eq(Typer.heatDays(state, 'nonesuch', R0)[Typer.dayKey(R0)].value, 1);
});
check('a day outside the map cannot draw a square on it', () => {
    const old = Typer.dayKey(R0 - (Typer.KEEP_DAYS + 5) * Typer.DAY_MS);
    const state = { races: [], days: { [old]: { races: 3, seconds: 90, best: 60 } } };
    eq(Object.keys(Typer.heatDays(state, 'races', R0)), []);
});
check('each metric is banded on a scale of its own', () => {
    // Two races is a quiet day and two seconds is nothing at all; one set of
    // bounds cannot colour both. Best WPM is not a count at all.
    const scales = Object.values(TyperStats.HEAT).map((spec) => spec.steps.join(','));
    eq(new Set(scales).size, scales.length, 'two metrics are sharing a scale');
    for (const [id, spec] of Object.entries(TyperStats.HEAT)) {
        assertRising(spec.steps, `${id} steps`);
        eq(spec.legend.length, 5, `${id} needs a word per level, zero included`);
    }
});
check('the map metrics are the ones the store can answer', () => {
    eq(Object.keys(TyperStats.HEAT).sort(), Typer.METRICS.map((one) => one.id).sort());
});

section('typeracer — the streak');
check('a run of days is counted back from today', () => {
    let state = Typer.blank();
    for (const back of [0, 1, 2]) {
        state = Typer.recordRace(state, { at: R0 - back * Typer.DAY_MS, wpm: 70, seconds: 30 }, [], R0);
    }
    eq(Typer.streak(state, R0), 3);
});
check('today with nothing in it yet is only the afternoon', () => {
    let state = Typer.blank();
    for (const back of [1, 2]) {
        state = Typer.recordRace(state, { at: R0 - back * Typer.DAY_MS, wpm: 70, seconds: 30 }, [], R0);
    }
    eq(Typer.streak(state, R0), 2, 'not racing yet today broke the streak');
});
check('a day missed in the middle ends the run', () => {
    let state = Typer.blank();
    for (const back of [0, 2, 3]) {
        state = Typer.recordRace(state, { at: R0 - back * Typer.DAY_MS, wpm: 70, seconds: 30 }, [], R0);
    }
    eq(Typer.streak(state, R0), 1);
});
check('never having raced is a streak of nought', () => {
    eq(Typer.streak(Typer.blank(), R0), 0);
});

section('typeracer — the drill');
const drillState = (pairs) => gramsWith(Object.fromEntries(
    pairs.map((gram, i) => [gram, { n: 20, ms: 20 * (600 - i * 10), err: 0 }])));

check('the drill is built out of the pairs you are worst at', () => {
    const text = Typer.drill(drillState(['th', 'nk', 'rl']), { grams: 3, length: 60 });
    for (const gram of ['th', 'nk', 'rl']) assert(text.includes(gram), `${gram} is not in "${text}"`);
});
check('a pair is padded into something that can be typed as a word', () => {
    // Drilling a bare pair over and over trains it in an isolation it is
    // never typed in.
    eq(Typer.drillChunk('th', 0), 'athith');
    assert(!/\bth\b/.test(Typer.drill(drillState(['th']), { grams: 1, length: 40 })), 'the bare pair was drilled');
});
check('a pair with a space or a comma in it is not made into a word', () => {
    // A chunk built around a comma is not a word; it is line noise.
    const state = drillState(['t ', 'e,', 'th']);
    const text = Typer.drill(state, { grams: 3, length: 60 });
    assert(text.length > 0, 'nothing was drilled at all');
    assert(!text.includes(','), text);
    eq(text.split(' ').every((chunk) => /^[a-z]+$/.test(chunk)), true, text);
});
check('the drill is long enough to be one and stops there', () => {
    const text = Typer.drill(drillState(['th', 'nk', 'rl']), { grams: 3, length: 120 });
    assert(text.length >= 120, `only ${text.length} characters`);
    assert(text.length < 200, `${text.length} characters is a paragraph`);
});
check('the same store gives the same drill twice', () => {
    // A drill you can compare with yesterday's is worth more than a
    // different one every time, and Math.random() cannot be tested.
    const state = drillState(['th', 'nk', 'rl']);
    eq(Typer.drill(state, { grams: 3, length: 80 }), Typer.drill(state, { grams: 3, length: 80 }));
});
check('the chunks do not come back in the same loop every time round', () => {
    const text = Typer.drill(drillState(['th', 'nk', 'rl']), { grams: 3, length: 200 });
    const chunks = text.split(' ');
    const first = chunks.slice(0, 3).join(' ');
    assert(chunks.slice(3, 6).join(' ') !== first, `the order repeats: ${text}`);
});
check('nothing measured yet is no drill rather than an empty one', () => {
    eq(Typer.drill(Typer.blank(), {}), '');
    eq(Typer.drill(drillState(['t ', 'e,']), { grams: 2 }), '', 'punctuation alone is nothing to drill');
});

section('typeracer — the settings panel');
check('every reader setting has a control carrying its key as an id, where its reader is set', () => {
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    const keys = globalThis.BB.Settings.KEYS.filter((key) => /^reader/.test(key));
    assert(keys.length, 'no reader settings at all');
    // A panel runs from its marker to the next settings section or the scripts.
    const controlsIn = (marker) => {
        const from = html.indexOf(marker);
        assert(from > 0, `no ${marker}`);
        const next = html.indexOf('class="settings-section"', from);
        const panel = html.slice(from, next === -1 ? html.indexOf('<script', from) : next);
        return new Set([...panel.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));
    };
    // The video reader's own under YouTube; the rest, the shared type
    // included, under Settings › Reader.
    const VIDEO = ['readerLayout', 'readerFollow', 'readerHideChrome'];
    const youtube = controlsIn('id="youtubeSettingsPanel"');
    const reader = controlsIn('data-plate="Reader"');
    for (const key of keys) {
        const [where, name] = VIDEO.includes(key) ? [youtube, 'the YouTube panel'] : [reader, 'Settings › Reader'];
        assert(where.has(key), `${key} has no control in ${name}`);
    }
});
check('the text reader clamps the shared type to the same ranges, and follows every setting it reads', () => {
    const Reader = require('../src/content/reader.js');
    const ArticleReader = require('../src/content/article-reader.js');
    for (const [key, { min, max }] of Object.entries(Reader.TYPE)) eq(ArticleReader.TYPE[key], { min, max }, key);
    eq(ArticleReader.typeOf(globalThis.BB.Settings.DEFAULTS), { size: 18, lead: 1.6, measure: 704 });
    eq(ArticleReader.typeOf({ readerFontSize: 99, readerLineHeight: 'x', readerLineWidth: 10 }), { size: 26, lead: 1.6, measure: 480 });
    const main = require('fs').readFileSync(`${__dirname}/../src/content/main.js`, 'utf8');
    const list = /TEXT_READER_SURFACES = \[([^\]]*)\]/.exec(main)[1];
    for (const key of [...Object.keys(ArticleReader.TYPE), 'readerTheme', 'readerWarmth', 'readerFont', 'readerDimImages', 'readerHighlight', 'skin']) {
        assert(list.includes(`'${key}'`), `${key} only reaches an open text reader after a reload`);
    }
    for (const value of ['serif', 'sans']) assert(ArticleReader.FONTS[value], `${value} is offered with no face behind it`);
    assert(/Hosts\.lookup\(listed, location\.hostname\)/.test(main), 'a listed site is matched by its exact host alone, not its subdomains');
    assert(/op === 'auto'\) text\.open\(\{ auto: true \}\)/.test(main), 'a page opened by the list would say it has nothing to read');
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    const offered = [.../<select id="readerFont">([\s\S]*?)<\/select>/.exec(html)[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
    eq(offered, ['skin', ...Object.keys(ArticleReader.FONTS)]);
});
check('the reader layout list offers exactly the layouts the reader draws', () => {
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    const select = /<select id="readerLayout">([\s\S]*?)<\/select>/.exec(html)[1];
    const offered = [...select.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
    eq(offered, require('../src/content/reader-layout.js').LAYOUT_IDS.slice());
    eq(globalThis.BB.Settings.DEFAULTS.readerLayout, 'dock');
});
check('the reader type is clamped to the ranges its controls offer, and the defaults change nothing', () => {
    const Reader = require('../src/content/reader.js');
    eq(Reader.typeScale(globalThis.BB.Settings.DEFAULTS), { scale: 1, leadScale: 1, measure: 44 },
        'the defaults would move the design’s own type');
    const clamped = Reader.typeScale({ readerFontSize: 90, readerLineHeight: 0.5, readerLineWidth: 'x' });
    eq([clamped.scale, clamped.leadScale.toFixed(4), clamped.measure], [1.5, '0.7500', 44]);

    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    for (const [key, { min, max }] of Object.entries(Reader.TYPE)) {
        const control = (new RegExp(`<input[^>]*id="${key}"[^>]*>`).exec(html) || [''])[0];
        assert(control.includes(`min="${min}"`) && control.includes(`max="${max}"`),
            `${key} offers a range the reader does not draw: ${control}`);
    }
});
check('an open reader hears about every setting that changes how it looks', () => {
    const main = require('fs').readFileSync(`${__dirname}/../src/content/main.js`, 'utf8');
    const list = /READER_SURFACES = \[([^\]]*)\]/.exec(main)[1];
    for (const key of Object.keys(require('../src/content/reader.js').TYPE)) {
        assert(list.includes(`'${key}'`), `${key} only takes effect after a reload`);
    }
});
check('the popup’s reader button reaches something that opens the reader', () => {
    const fs = require('fs');
    const html = fs.readFileSync(`${__dirname}/../popup.html`, 'utf8');
    const popup = fs.readFileSync(`${__dirname}/../popup.js`, 'utf8');
    const main = fs.readFileSync(`${__dirname}/../src/content/main.js`, 'utf8');
    assert(html.includes('id="openReaderBtn"'), 'no button');
    assert(popup.includes("on('openReaderBtn'"), 'the button is not wired');
    assert(/action: 'openReader'/.test(fs.readFileSync(`${__dirname}/../src/page/tab-actions.js`, 'utf8')),
        'the popup does not ask the page');
    assert(main.includes("case 'openReader':"), 'the page does not answer');
});
check('every typeracer setting has a control carrying its key as an id', () => {
    // This is the whole binding. src/page/settings-form.js matches a control
    // to a setting by id and nothing else, so a setting with no element is a
    // setting that can never be changed, and it fails silently.
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    const Settings = globalThis.BB.Settings;
    const controls = new Set([...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));

    const keys = Settings.KEYS.filter((key) => /^typer/.test(key));
    assert(keys.length, 'no typeracer settings at all');
    for (const key of keys) assert(controls.has(key), `${key} has no control bound to it`);
});
check('the number fields cannot be set outside what the code accepts', () => {
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    const attrs = (id) => (new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html) || [''])[0];

    const samples = attrs('typerMinSamples');
    assert(/type="number"/.test(samples) && /min="3"/.test(samples),
        `a noise floor below three is offerable: ${samples}`);

    // Above 100 really is louder — Web Audio gain is not capped the way an
    // <audio> element's volume is — so the slider goes there on purpose.
    const volume = attrs('typerSoundVolume');
    assert(/type="range"/.test(volume), 'the volume is not a slider');
    assert(/min="0"/.test(volume) && /max="150"/.test(volume), `the volume is unbounded: ${volume}`);
});
check('the caret list offers exactly the shapes the page can draw', () => {
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    const select = /<select id="typerCaret">([\s\S]*?)<\/select>/.exec(html)[1];
    const offered = [...select.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
    eq(offered, TyperUi.SHAPES.slice(), 'the panel and the page disagree about the shapes');
});
check('the voice list is built from the sound module rather than the page', () => {
    // Adding a voice would otherwise be two edits with no way to notice you
    // had only made one.
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    assert(/<select id="typerSoundVoice"><\/select>/.test(html), 'the options are spelled out in the page');
    assert(/<script src="src\/shared\/sfx\.js">/.test(html), 'the dashboard cannot reach the voices');

    const dashboard = require('fs').readFileSync(`${__dirname}/../dashboard.js`, 'utf8');
    // A <select> with no options cannot be given a value, so it has to be
    // filled before the form is bound.
    assert(dashboard.indexOf('TyperStats.mountSettings') < dashboard.indexOf('SettingsForm.bindAll'),
        'the voice list is filled after the form is bound to it');
});
check('the settings launcher has a typeracer card to open', () => {
    const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
    assert(/data-site-settings="typeracer"/.test(html), 'no panel for the card to show');
    assert(html.includes('id="typeracerSettingsPanel"'), 'the panel has no id');
});
check('the surfaces main.js repaints cover every typeracer setting that changes one', () => {
    // A setting the content script never hears about is a switch that only
    // works after a reload, which reads as a switch that did nothing.
    const main = require('fs').readFileSync(`${__dirname}/../src/content/main.js`, 'utf8');
    const listed = /const TYPER_SURFACES = \[([\s\S]*?)\];/.exec(main)[1];
    const Settings = globalThis.BB.Settings;
    for (const key of Settings.KEYS.filter((one) => /^typer/.test(one))) {
        if (key === 'typerMinSamples') continue; // the dashboard's own, never the page's
        assert(listed.includes(`'${key}'`), `${key} never reaches the page it governs`);
    }
});

section('the lists that have to move together');

const readRepo = (name) => require('fs').readFileSync(`${__dirname}/../${name}`, 'utf8');
const SiteScripts = require('../src/background/site-scripts.js');

/** Every content-script entry a page can get: the manifest's, then each site's the worker registers. */
function contentScripts(name = 'manifest.json') {
    const doc = JSON.parse(readRepo(name));
    const registered = SiteScripts.scripts(SiteScripts.genericOf(doc)).map(({ matches, js, css, world, runAt }) =>
        ({ matches, js, css, world, run_at: runAt }));
    return [...doc.content_scripts, ...registered];
}

check('the two manifests load exactly the same content scripts', () => {
    // They are byte-identical today and the point is to keep them so: a
    // module added to one and not the other fails in that browser only, at
    // load, with "undefined is not an object".
    const chrome = JSON.parse(readRepo('manifest.json')).content_scripts;
    const firefox = JSON.parse(readRepo('manifest.firefox.json')).content_scripts;
    eq(firefox, chrome);
});
/** Whether a manifest match pattern takes `url`: as much of the grammar as the manifests use. */
function patternTakes(pattern, url) {
    const at = new URL(url);
    if (pattern === '<all_urls>') return /^(https?|file|ftp|wss?):$/.test(at.protocol);
    const [, scheme, host, path] = /^(\*|https?):\/\/([^/]*)(\/.*)$/.exec(pattern) || [];
    if (!scheme || (scheme === '*' ? !/^https?:$/.test(at.protocol) : at.protocol !== `${scheme}:`)) return false;
    const bare = host.replace(/^\*\./, '');
    const hostOk = host.startsWith('*.') ? at.hostname === bare || at.hostname.endsWith(`.${bare}`) : at.hostname === host;
    const glob = new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return hostOk && glob.test(at.pathname + at.search);
}
const entryTakes = (entry, url) => entry.matches.some((one) => patternTakes(one, url)) &&
    !(entry.exclude_matches || []).some((one) => patternTakes(one, url));
const isolatedEntries = () => contentScripts().filter((entry) => entry.world !== 'MAIN');

check('every page gets exactly one isolated-world entry, and it is the one for its site', () => {
    // Each entry repeats the core list, so a page that matched two would run
    // every core module twice. And a site that matched the generic entry
    // would get no site features at all.
    const Site = require('../src/content/site.js');
    const marks = {
        youtube: 'src/content/youtube-ui.js', twitter: 'src/content/twitter-ui.js', reddit: 'src/content/roster.js',
        chess: 'src/content/chess.js', lichess: 'src/content/chess.js', leetcode: 'src/content/leet-ui.js',
        typeracer: 'src/content/typeracer-ui.js', chatgpt: 'src/content/chat-ui.js', claude: 'src/content/chat-ui.js',
        github: 'src/content/github-read.js', gitlab: 'src/content/gitlab-read.js', forgejo: 'src/content/forgejo-read.js',
        vimeo: 'src/content/vimeo-download.js', netflix: 'src/content/netflix-ui.js', wikipedia: 'src/content/wiki-read.js',
    };
    const entries = isolatedEntries();
    for (const url of [
        'https://www.youtube.com/watch?v=x', 'https://m.youtube.com/', 'https://www.youtube-nocookie.com/embed/x', 'https://youtu.be/x',
        'https://x.com/home', 'https://twitter.com/a', 'https://old.reddit.com/r/x', 'https://www.reddit.com/',
        'https://www.chess.com/play', 'https://lichess.org/abc', 'https://leetcode.com/problems/two-sum/',
        'https://play.typeracer.com/', 'https://data.typeracer.com/pit/profile', 'https://chatgpt.com/c/1',
        'https://chat.openai.com/', 'https://claude.ai/chat/1', 'https://www.netflix.com/watch/1', 'https://example.com/',
        'https://github.com/microsoft/vscode/actions/runs/1', 'https://gist.github.com/a/b',
        'https://gitlab.com/gitlab-org/gitlab-runner/-/pipelines/1', 'https://docs.gitlab.com/ci/', 'https://codeberg.org/forgejo/forgejo/pulls/1',
        'https://docs.codeberg.org/', 'https://vimeo.com/1231817291', 'https://www.vimeo.com/channels/staffpicks/1', 'https://player.vimeo.com/video/1',
        'https://en.wikipedia.org/wiki/Alan_Turing', 'https://de.m.wikipedia.org/wiki/Alan_Turing', 'https://wikipedia.org/',
    ]) {
        const taking = entries.filter((entry) => entryTakes(entry, url));
        eq(taking.length, 1, url);
        const mark = marks[Site.detectSite(new URL(url).hostname)];
        if (mark) assert(taking[0].js.includes(mark), `${url} does not get ${mark}`);
        else eq(taking[0].matches, ['<all_urls>'], `${url} is not a site of ours`);
    }
});
check('each site entry is the core list, then its own files, then main.js', () => {
    const [generic, ...sites] = isolatedEntries();
    const core = generic.js.slice(0, -1);
    eq(generic.js[generic.js.length - 1], 'src/content/main.js');
    for (const entry of sites) {
        eq(entry.js.slice(0, core.length), core, entry.matches[0]);
        eq(entry.js[entry.js.length - 1], 'src/content/main.js', entry.matches[0]);
        const own = entry.js.slice(core.length, -1);
        assert(own.length && own.every((file) => !core.includes(file)), `${entry.matches[0]} lists a core file twice`);
        // The same stylesheets, then at most the site's own, after them.
        eq(entry.css.slice(0, generic.css.length), generic.css, entry.matches[0]);
        assert(entry.css.slice(generic.css.length).every((file) => /^content-[a-z]+\.css$/.test(file)), entry.matches[0]);
    }
    for (const file of isolatedEntries().flatMap((entry) => entry.css)) {
        assert(require('fs').existsSync(`${__dirname}/../${file}`), `${file} is listed but not on disk`);
    }
    eq([...generic.exclude_matches].sort(), sites.flatMap((entry) => entry.matches).sort(),
        'the generic entry steps aside for exactly the sites that have one');
});
check('the manifests list only the generic entry, and the worker registers every site\'s', () => {
    // A manifest entry cannot be switched off, so a site's is not one.
    for (const name of ['manifest.json', 'manifest.firefox.json']) {
        eq(JSON.parse(readRepo(name)).content_scripts.map((entry) => entry.matches), [['<all_urls>']], name);
    }
    const worker = [.../importScripts\(([\s\S]*?)\);/.exec(readRepo('background.js'))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert(worker.indexOf('src/background/site-scripts.js') > worker.indexOf('src/background/router.js'), 'it registers on Router.started');
    const ids = SiteScripts.scripts(SiteScripts.genericOf(JSON.parse(readRepo('manifest.json')))).map((one) => one.id);
    eq(ids.length, new Set(ids).size, 'two scripts under one id');
    assert(ids.every((id) => id.startsWith('bb-')), 'an id the worker would not know as its own');
});
checkAsync('registering brings the browser in line in as few calls as it can, one script at a time', async () => {
    const calls = [];
    const registry = new Map([['someone-else', { id: 'someone-else', matches: ['*://a/*'], js: ['a.js'] }],
        ['bb-gone', { id: 'bb-gone', matches: ['*://b/*'], js: ['b.js'] }]]);
    const scripting = {
        // As Chrome answers: defaults filled in, and the patterns sorted.
        getRegisteredContentScripts: async () => [...registry.values()].map((one) => ({
            runAt: 'document_idle', world: 'ISOLATED', ...one, matches: [...one.matches].sort(),
        })),
        unregisterContentScripts: async ({ ids }) => { calls.push(['unregister', ...ids]); ids.forEach((id) => registry.delete(id)); },
        updateContentScripts: async (list) => { calls.push(['update', ...list.map((one) => one.id)]); list.forEach((one) => registry.set(one.id, one)); },
        registerContentScripts: async (list) => {
            calls.push(['register', ...list.map((one) => one.id)]);
            if (list.some((one) => one.id === 'bb-refused')) throw new Error('no MAIN world here');
            list.forEach((one) => registry.set(one.id, one));
        },
    };
    const want = [
        { id: 'bb-one', matches: ['*://one/*'], js: ['one.js'] },
        { id: 'bb-refused', matches: ['*://two/*'], js: ['two.js'], world: 'MAIN' },
        { id: 'bb-three', matches: ['*://three/*', '*://drei/*'], js: ['three.js'], css: ['three.css'] },
    ];
    const refused = await SiteScripts.apply(scripting, want);
    eq(calls, [['unregister', 'bb-gone'], ['register', 'bb-one'], ['register', 'bb-refused'], ['register', 'bb-three']]);
    eq(refused.map(({ id, error }) => [id, error.message]), [['bb-refused', 'no MAIN world here']]);
    assert(registry.has('someone-else') && registry.has('bb-three'), 'one refusal took the next script down, or a script not ours went');

    calls.length = 0;
    await SiteScripts.apply(scripting, want.filter((one) => one.id !== 'bb-refused'));
    eq(calls, [], 'what was registered already, defaults and all, was registered again');
    await SiteScripts.apply(scripting, [{ ...want[0], matches: ['*://one/*', '*://uno/*'] }, want[2]]);
    eq(calls, [['update', 'bb-one']]);
});
check('a site switched off registers none of its own code, and its pages get what any other page does', () => {
    eq(globalThis.BB.Settings.DEFAULTS.sitesOff, []);
    const [generic] = JSON.parse(readRepo('manifest.json')).content_scripts;
    const off = SiteScripts.scripts(generic, ['youtube', 'chess', 'claude']);
    const byId = Object.fromEntries(off.map((one) => [one.id, one]));
    eq(['bb-youtube', 'bb-chess-page', 'bb-claude-page'].filter((id) => id in byId), [], 'still registered');
    eq(byId['bb-chess'].matches, ['*://*.lichess.org/*'], 'lichess went with chess.com');
    eq(byId['bb-chat'].matches, ['*://*.chatgpt.com/*', '*://*.chat.openai.com/*']);
    eq(byId['bb-plain'].js, generic.js);
    eq(byId['bb-plain'].css, generic.css);
    assert(!('bb-plain' in Object.fromEntries(SiteScripts.scripts(generic).map((one) => [one.id, 1]))), 'a plain entry with every site on');

    // Still exactly one isolated entry for every page, and the plain one for a site that is off.
    const entries = [generic, ...off.filter((one) => one.world !== 'MAIN')];
    for (const [url, js] of [
        ['https://www.youtube.com/watch?v=x', generic.js], ['https://youtu.be/x', generic.js],
        ['https://www.chess.com/play', generic.js], ['https://claude.ai/chat/1', generic.js],
        ['https://lichess.org/abc', byId['bb-chess'].js], ['https://chatgpt.com/c/1', byId['bb-chat'].js],
        ['https://example.com/', generic.js],
    ]) {
        const taking = entries.filter((entry) => entryTakes(entry, url));
        eq(taking.length, 1, url);
        eq(taking[0].js, js, url);
    }
    // A switch named something that is not a site changes nothing.
    eq(SiteScripts.scripts(generic, ['nope']), SiteScripts.scripts(generic));
});
check('main.js knows a site by a module only that site\'s entry loads', () => {
    // Off, a site gets the core list and main.js alone; the host still says
    // youtube, so main.js has to tell from what loaded.
    const { provides } = require('./load-order.js');
    const main = readRepo('src/content/main.js');
    const own = Function(`return ${/const OWN = (\{[\s\S]*?\});/.exec(main)[1]}`)();
    const [generic] = JSON.parse(readRepo('manifest.json')).content_scripts;
    const core = new Set(generic.js.flatMap((file) => [...provides(readRepo(file))]));
    for (const entry of SiteScripts.ENTRIES) {
        const theirs = new Set(entry.js.flatMap((file) => [...provides(readRepo(file))]));
        for (const site of Object.keys(entry.sites)) {
            assert(own[site], `${site} has no module in main.js's OWN`);
            assert(theirs.has(own[site]) && !core.has(own[site]), `${own[site]} does not tell ${site}'s entry from the plain one`);
        }
    }
    assert(/const site = !OWN\[host\] \|\| BB\[OWN\[host\]\] \? host : 'other';/.test(main), 'main.js goes by the host alone');
    assert(/sitesOff\.includes\(this\.site\)\) this\.site = 'other'/.test(readRepo('popup.js')), 'the popup shows a switched-off site\'s tools');
});
check('the page every other entry is built on carries no site\'s own module', () => {
    const [generic] = isolatedEntries();
    for (const file of generic.js) {
        assert(!/youtube-ui|pouch-sheet|reader|twitter|chess|leet|typeracer|chat|roster|checkpoints|transcript|forge|ci-watch|github|gitlab/.test(file), file);
    }
});
check('the skins\' faces are not a content-script stylesheet, and the injected UI adds the same ones', () => {
    // Listed beside content.css, skin-fonts.css's url('fonts/…') resolved
    // against the page: https://x.com/fonts/Cardo-Regular.woff2, a network
    // error, and the system stack on every skinned surface.
    for (const entry of contentScripts()) {
        assert(!(entry.css || []).includes('skin-fonts.css'), (entry.matches || [])[0]);
    }
    const declared = [...readRepo('skin-fonts.css').matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
        family: /font-family:\s*'([^']+)'/.exec(body)[1],
        file: /url\('fonts\/([^']+)'\)/.exec(body)[1],
        weight: /font-weight:\s*([^;]+);/.exec(body)[1].trim(),
        unicodeRange: /unicode-range:\s*([^;]+);/.exec(body)[1].trim(),
    }));
    eq(require('../src/content/theme.js').FACES.map((face) => ({ ...face })), declared);
});
check('chrome is asked for unlimited storage, and firefox is not', () => {
    // Without it Chrome caps storage.local at 10 MB, and a full store's writes
    // quietly do nothing. Firefox has no such cap, and would warn at install.
    eq(JSON.parse(readRepo('manifest.json')).permissions.includes('unlimitedStorage'), true);
    eq(JSON.parse(readRepo('manifest.firefox.json')).permissions.includes('unlimitedStorage'), false);
});
check('typeracer needs no page-world script, and has not grown one', () => {
    // chess.com and LeetCode each need one because the board object and
    // window.fetch only exist in the page's world. Keystrokes are DOM events,
    // which a capture listener in the isolated world sees in full.
    const worlds = contentScripts()
        .filter((entry) => entry.world === 'MAIN');
    for (const entry of worlds) {
        assert(!entry.matches.some((match) => /typeracer/.test(match)),
            `a MAIN-world entry was added for ${entry.matches.join(', ')}`);
    }
});
check('every typeracer source the manifest loads is in the browser suite too', () => {
    const manifest = contentScripts().flatMap((entry) => entry.js);
    const suite = readRepo('tests/index.html');
    for (const src of manifest.filter((one) => /typeracer|sfx/.test(one))) {
        assert(suite.includes(`../${src}`), `${src} is shipped but never loaded by the suite`);
    }
    assert(suite.includes('typeracer.test.js'), 'the spec itself is not loaded');
});
const LoadOrder = require('./load-order.js');

check('every load list has each module after what it takes off BB as it loads', () => {
    // Load order is kept by hand, and getting it wrong fails at load in that
    // surface alone; load-order.js reads what each file needs, over every list.
    const problems = LoadOrder.lintAll();
    assert(!problems.length, `\n        ${problems.join('\n        ')}`);
});
check('the load-order check reads what a file takes at load, and not what it reads later', () => {
    const main = LoadOrder.needs(readRepo('src/content/main.js'));
    assert(['Settings', 'Shortcuts', 'CookieBanner', 'TimeLimitContent'].every((name) => main.has(name)), 'main.js destructures all of these');
    // A site's modules are taken inside that site's block: they are not on every page.
    assert(!['TyperUi', 'ChatUi', 'Watched', 'YouTubeUi'].some((name) => main.has(name)), 'main.js takes a site module as it loads');
    assert(LoadOrder.needs(readRepo('src/content/typeracer-ui.js')).has('Sfx'));
    assert(LoadOrder.needs(readRepo('src/content/chess.js')).has('Sfx'), '(root.BB && root.BB.Sfx) || req(…)');
    assert(LoadOrder.needs(readRepo('src/background/skim.js')).has('Skim'), 'globalThis.BB && globalThis.BB.Skim');
    // chat-sites.js reaches PromptQueue through an arrow, when it is called.
    assert(!LoadOrder.needs(readRepo('src/shared/chat-sites.js')).has('PromptQueue'));
    // chess-stats reads BB.HeatMap when it draws, and the popup never loads the heat map.
    assert(!LoadOrder.needs(readRepo('src/page/chess-stats.js')).has('HeatMap'));
    eq([...LoadOrder.provides(readRepo('src/shared/sfx.js'))], ['Sfx']);
});
check('every view the dashboard opens a site with has its scripts listed, and only there', () => {
    const source = readRepo('dashboard.js');
    const table = (name) => Function(`return ${new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n    \\});`).exec(source)[1]}`)();
    const files = table('VIEW_FILES');
    for (const name of [...Object.values(table('SITE_VIEWS')), ...Object.values(table('SETTINGS_VIEWS'))].flat()) {
        assert(name in files, `${name} is opened but has no scripts listed`);
    }
    const html = readRepo('dashboard.html');
    for (const src of Object.values(files).flat()) assert(!html.includes(`"${src}"`), `${src} loads with the page as well`);
    assert(Object.keys(LoadOrder.lists()).includes('dashboard.html, then dashboard.js#VIEW_FILES.LeetStats'), 'the lists are not linted');
});
check('a packed upload has every file the manifest and the pages name, and none of the specs', () => {
    const Pack = require('../tools/pack.js');
    for (const firefox of [false, true]) {
        eq(Pack.missing({ firefox }), [], firefox ? 'firefox' : 'chrome');
        const names = [...Pack.files({ firefox }).keys()];
        assert(!names.some((name) => name.startsWith('tests/') || name.startsWith('tools/') || name.endsWith('.md')), 'the package carries the dev files');
    }
    eq(Pack.files({ firefox: true }).get('manifest.json'), 'manifest.firefox.json');
});
check('and it does catch a list put the wrong way round', () => {
    const js = JSON.parse(readRepo('manifest.json')).content_scripts[0].js;
    const flipped = [...js].reverse();
    const problems = LoadOrder.lint(flipped);
    assert(problems.some((one) => one.startsWith('src/content/main.js takes Settings')), problems[0]);
    const sources = { 'src/a.js': "    const { B } = root.BB;\n    root.BB.A = 1;", 'src/b.js': '    root.BB.B = 1;' };
    eq(LoadOrder.lint(['src/a.js', 'src/b.js'], sources), ['src/a.js takes B as it loads, but src/b.js is loaded after it']);
    eq(LoadOrder.lint(['src/b.js', 'src/a.js'], sources), []);
    eq(LoadOrder.lint(['src/a.js'], sources), ['src/a.js takes B as it loads, and nothing before it provides one']);
});

section('the icon set, shaken down to what is used');
const IconTool = require('../tools/icons.js');
check('the table holds exactly the Phosphor icons the code names', () => {
    const { missing, unused } = IconTool.audit();
    eq(missing, [], 'named but not in the table — run node tools/icons.js');
    eq(unused, [], 'in the table but named nowhere — run node tools/icons.js');
});
check('a name is read from a literal in a script or a page, and from nothing else', () => {
    const text = `Icons.svg('x') + Icons.svg("push-pin-fill", { size: 12 }) <i data-icon="speedometer"></i> Icons.svg(name)`;
    eq([...IconTool.namesIn(text)], ['x', 'push-pin-fill', 'speedometer']);
});
check('a packed table keeps only what the packed code names', () => {
    const source = readRepo(IconTool.MODULE);
    const { head, tail } = IconTool.parse(source);
    const shaken = IconTool.shake(source, new Set(['x']));
    eq([...IconTool.parse(shaken).glyphs.keys()], ['x']);
    assert(shaken.startsWith(head) && shaken.endsWith(tail), 'the code around the table changed');
    eq(IconTool.shake(source, IconTool.audit().used), source, 'a table already in line is not left as it was');
});
check('nothing else draws an icon of its own', () => {
    // Drawings rather than icons: the sites' brand marks, the charts, the
    // chat's branch map, the keyboard's leader lines, the plates' corners
    // and the frame the reader's cursors are drawn in.
    const DRAWINGS = ['src/shared/icons.js', 'src/shared/site-icons.js', 'src/page/heat-map.js', 'src/page/spark.js',
        'src/content/chat-tree-view.js', 'src/page/keyboard.js', 'src/shared/corners.js', 'src/content/reader-highlights.js'];
    const files = [...require('../tools/pack.js').files().values()].filter((file) => /\.(js|html)$/.test(file));
    eq(files.filter((file) => !DRAWINGS.includes(file) && /<svg\s/.test(readRepo(file))), [], 'drawn by hand instead of with Icons.svg');
});
check('a glyph is drawn in the text colour, and a name the table lacks draws nothing', () => {
    const Icons = require('../src/shared/icons.js');
    const x = Icons.svg('x', { size: 12, cls: 'octicon' });
    assert(x.includes('fill="currentColor"') && x.includes('width="12"') && x.includes('class="octicon"'), x);
    eq(Icons.svg('no-such-icon'), '');
});
check('a filed pouch keeps the list\'s bars, and only its plus turns into a tick', () => {
    // It was a bare `check` in place of the whole list, a different mark.
    const PouchButton = require('../src/shared/pouch-button.js');
    const pathOf = (svg) => /<path d="([^"]+)"/.exec(svg)[1];
    const [plus, tick] = [pathOf(PouchButton.ICON), pathOf(PouchButton.TICK)];
    assert(tick !== plus, 'no plus was found to trade, so a filed thing still offers a "+"');
    const bars = plus.slice(0, plus.indexOf('m88,0'));
    assert(bars && tick.startsWith(bars) && !tick.includes('m88,0'), 'the bars changed, or the plus is still there');
    eq(PouchButton.TICK.replace(tick, ''), PouchButton.ICON.replace(plus, ''), 'drawn at a different size or class');
});

section('the chess low-clock tone, on the sound module');
check('the tone is the same two notes it always was', () => {
    // A refactor, not a redesign: 880 then 1180, 180ms apart, a sine, and a
    // peak of 0.3 of whatever the volume setting asks for.
    const low = Sfx.VOICES.low;
    eq(low.type, 'sine');
    eq(low.freq, 880);
    eq(low.then, 1180);
    eq(low.gap, 0.18);
    eq(low.gain, 0.3);
});
check('a gap means two notes rather than a slide', () => {
    // Two notes carry at a low volume in a way a slide does not, and that
    // sound is the whole point of the setting.
    assert(Sfx.VOICES.low.gap, 'the low tone would now glide');
    for (const id of ['start', 'done', 'best']) {
        assert(!Sfx.VOICES[id].gap, `${id} should slide, not repeat`);
    }
});
check('the low tone is not offered as a key sound', () => {
    // It is a chess alarm. Typing to it would be unbearable.
    assert(!Sfx.KEY_VOICE_IDS.includes('low'), 'the alarm is in the typing list');
    assert(Sfx.VOICE_IDS.includes('low'), 'but it still has to be in the table');
});
check('chess.js no longer keeps an audio context of its own', () => {
    const source = require('fs').readFileSync(`${__dirname}/../src/content/chess.js`, 'utf8');
    assert(!/new Ctx\(\)|createOscillator|AudioContext/.test(source),
        'the old context is still in there beside the shared one');
    assert(/Sfx\.play\('low'/.test(source), 'the tone is not played through the module');
    assert(/Sfx\.unlock\(\)/.test(source), 'the context is opened somewhere other than a gesture');
});

section('typeracer — the caret hotkey');

/** A keydown as the page would send one, with the two fields matching needs. */
const keyPress = (code, { ctrl = false, alt = false, shift = false, meta = false } = {}) => ({
    code, key: code.replace(/^Key/, '').toLowerCase(),
    ctrlKey: ctrl, altKey: alt, shiftKey: shift, metaKey: meta,
    preventDefault() { this.defaulted = true; },
    stopPropagation() {},
});

check('the binding is resolved once rather than on every keystroke', () => {
    // Keybindings.resolve spreads the binding into a fresh object, and this
    // listener sees every key of every race. Resolving in the handler meant
    // an allocation per keystroke on a typing test.
    withTyperPage(({ ui }) => {
        const Keybindings = globalThis.BB.Keybindings;
        const real = Keybindings.resolve;
        let calls = 0;
        Keybindings.resolve = (...args) => { calls++; return real(...args); };
        try {
            for (let i = 0; i < 50; i++) ui.onHotkey(keyPress('KeyT'));
            eq(calls, 0, 'the binding was resolved inside the handler');
        } finally {
            Keybindings.resolve = real;
        }
    }, { quote: 'the quick brown fox jumps over it' });
});
check('the hotkey fires on its own combination and on nothing else', () => {
    withTyperPage(({ ui }) => {
        ui.applyHotkey();

        const plain = keyPress('KeyC');
        ui.onHotkey(plain);
        eq(plain.defaulted, undefined, 'a bare letter was swallowed on a typing test');
        eq(ui.caretMode(), 'site');

        const combo = keyPress('KeyC', { ctrl: true, alt: true });
        ui.onHotkey(combo);
        eq(combo.defaulted, true, 'the key was left to the page');
        eq(ui.caretMode(), 'bar', 'the shape did not move on');
    }, { quote: 'the quick brown fox jumps over it' });
});
check('a rebind reaches the page rather than waiting for the next load', () => {
    // Which is why 'shortcuts' is in main.js's TYPER_SURFACES list: the
    // binding is cached, so something has to go and take it again.
    const main = require('fs').readFileSync(`${__dirname}/../src/content/main.js`, 'utf8');
    const listed = /const TYPER_SURFACES = \[([\s\S]*?)\];/.exec(main)[1];
    assert(listed.includes("'shortcuts'"), 'a rebound caret key would not reach an open tab');

    withTyperPage(({ ui }) => {
        ui.applyHotkey();
        const moved = keyPress('KeyK', { ctrl: true, alt: true });
        ui.onHotkey(moved);
        eq(moved.defaulted, true, 'the rebound key did nothing');
    }, {
        quote: 'the quick brown fox jumps over it',
        settings: { shortcuts: { 'typer-caret': { combo: { ctrl: true, alt: true, code: 'KeyK', key: 'k' } } } },
    });
});
check('a binding turned off is a key the page keeps', () => {
    withTyperPage(({ ui }) => {
        ui.applyHotkey();
        const combo = keyPress('KeyC', { ctrl: true, alt: true });
        ui.onHotkey(combo);
        eq(combo.defaulted, undefined);
        eq(ui.caretMode(), 'site');
    }, {
        quote: 'the quick brown fox jumps over it',
        settings: { shortcuts: { 'typer-caret': { enabled: false } } },
    });
});

// --------------------------------------------------------- party clock

const PartyClock = require('../src/shared/party-clock.js');

/** A pong from a room `skew` ahead of ours, the legs taking `out` and `back`, held `hold` at the far end. */
function pongFrom({ c = 1000, skew = 500, out = 50, back = 50, hold = 10 } = {}) {
    const s = c + out + skew;
    const s2 = s + hold;
    return { pong: { c, s, s2 }, t3: s2 - skew + back };
}

section('party clock');
check('equal legs give the exact offset, and the round trip excludes the hold', () => {
    const { pong, t3 } = pongFrom();
    eq(PartyClock.sample(pong, t3), { offset: 500, rtt: 100 });
});
check('unequal legs are wrong by half their difference, and no more', () => {
    const { pong, t3 } = pongFrom({ out: 20, back: 180, hold: 0 });
    eq(PartyClock.sample(pong, t3), { offset: 420, rtt: 200 });
});
check('a round trip the clocks cannot have made is refused', () => {
    eq(PartyClock.sample({ c: 1000, s: 1500, s2: 1600 }, 1050), null, 'held longer than it was away');
    eq(PartyClock.sample({ c: 'x', s: 1, s2: 2 }, 3), null);
    eq(PartyClock.sample({ c: 1000, s: 1600, s2: 1500 }, 1200), null, 'sent before it arrived');
});
check('the fastest sample sets the offset, whichever order they came in', () => {
    const clock = PartyClock.createClock();
    const slow = pongFrom({ c: 1000, out: 20, back: 180, hold: 0 });
    const fast = pongFrom({ c: 2000 });
    clock.add(fast.pong, fast.t3);
    clock.add(slow.pong, slow.t3);
    eq(clock.offset(), 500);
    eq(clock.minRtt(), 100);
});
check('a path that stays slow is adopted once the fast sample rolls out', () => {
    const clock = PartyClock.createClock();
    const fast = pongFrom({ c: 0 });
    clock.add(fast.pong, fast.t3);
    for (let i = 1; i <= PartyClock.WINDOW; i++) {
        const slow = pongFrom({ c: i * 5000, skew: 700, out: 150, back: 150 });
        clock.add(slow.pong, slow.t3);
    }
    eq(clock.offset(), 700);
    eq(clock.minRtt(), 300);
});
check('REGRESSION: on a tie the newer sample wins, so a moved offset is taken at once', () => {
    // Over the tab's port every round trip ties, and the oldest used to win:
    // a correction in the session reached the tab a whole window late.
    const clock = PartyClock.createClock();
    for (let i = 0; i < PartyClock.WINDOW; i++) clock.add(pongFrom({ c: i * 60000, skew: 0 }).pong, pongFrom({ c: i * 60000, skew: 0 }).t3);
    const moved = pongFrom({ c: 600000, skew: 1500 });
    clock.add(moved.pong, moved.t3);
    eq(clock.offset(), 1500);
});
check('room and local time convert both ways', () => {
    const clock = PartyClock.createClock();
    eq(clock.offset(), 0, 'no sample is no correction');
    const { pong, t3 } = pongFrom({ skew: -250 });
    assert(clock.add(pong, t3));
    eq(clock.toRoom(10000), 9750);
    eq(clock.toLocal(clock.toRoom(10000)), 10000);
});
check('the displayed round trip is smoothed, not the last reading', () => {
    const clock = PartyClock.createClock();
    let one = pongFrom({ c: 0, out: 50, back: 50, hold: 0 });
    clock.add(one.pong, one.t3);
    eq(clock.rtt(), 100);
    one = pongFrom({ c: 5000, out: 100, back: 100, hold: 0 });
    clock.add(one.pong, one.t3);
    eq(Math.round(clock.rtt()), 115);
});
check('the heartbeat slows while paused but never stops', () => {
    assert(PartyClock.pingDelay({ paused: true }) > PartyClock.pingDelay({ paused: false }));
    assert(Number.isFinite(PartyClock.pingDelay({ paused: true })));
});

// --------------------------------------------------------- party state

const PartyState = require('../src/shared/party-state.js');

const playingAt = (over = {}) => ({ ...PartyState.blank(), seq: 4, paused: false, pos: 100, at: 10000, ...over });
const intentOf = (over = {}) => ({ id: 1, base: 4, op: 'pause', pos: 100, at: 10000, ...over });

section('party state');
check('a playing vector extrapolates from when it was true, at its rate', () => {
    eq(PartyState.expected(playingAt(), 12000), 102);
    eq(PartyState.expected(playingAt({ rate: 1.5 }), 12000), 103);
});
check('paused, held, or not started yet, the position stands still', () => {
    eq(PartyState.expected(playingAt({ paused: true }), 60000), 100);
    eq(PartyState.expected(playingAt({ hold: { waiting: ['m1'], since: 10000 } }), 60000), 100);
    eq(PartyState.expected(playingAt({ at: 15000 }), 12000), 100, 'a scheduled start is not negative time');
    assert(PartyState.scheduled(playingAt({ at: 15000 }), 12000));
    assert(!PartyState.scheduled(playingAt(), 12000));
});
check('an intent is normalised, and its timestamp only believed so far', () => {
    eq(PartyState.validateIntent(intentOf({ at: 10200 }), 10000).at, 10200);
    eq(PartyState.validateIntent(intentOf({ at: 99999 }), 10000).at, 10000 + PartyState.AT_FUTURE_MS);
    eq(PartyState.validateIntent(intentOf({ at: 0 }), 10000).at, 10000 - PartyState.AT_PAST_MS);
    eq(PartyState.validateIntent(intentOf({ at: undefined }), 10000).at, 10000);
    eq(PartyState.validateIntent(intentOf({ pos: -3 }), 10000).pos, 0);
});
check('an intent that cannot be one is refused', () => {
    const now = 10000;
    eq(PartyState.validateIntent(intentOf({ op: 'rewind' }), now), null);
    eq(PartyState.validateIntent(intentOf({ pos: NaN }), now), null, 'a player reporting NaN');
    eq(PartyState.validateIntent(intentOf({ id: -1 }), now), null);
    eq(PartyState.validateIntent(intentOf({ op: 'rate', rate: 16 }), now), null);
    eq(PartyState.validateIntent(intentOf({ op: 'rate', rate: 1.25 }), now).rate, 1.25);
    eq(PartyState.validateIntent(intentOf({ op: 'rate', rate: null }), now), null, 'null is not a rate of 0');
    eq(PartyState.validateIntent(intentOf({ op: 'rate', rate: '1.5' }), now).rate, 1.5);
});
check('a peer names a video by id, never by address', () => {
    const media = (m) => PartyState.validateIntent(intentOf({ op: 'media', media: m }), 10000);
    eq(media({ site: 'youtube', id: 'dQw4w9WgXcQ' }).media, { site: 'youtube', id: 'dQw4w9WgXcQ' });
    eq(media({ site: 'netflix', id: '81234567' }).media, { site: 'netflix', id: '81234567' });
    eq(media({ site: 'youtube', id: 'https://evil.example/' }), null);
    eq(media({ site: 'vimeo', id: '123' }), null);
    eq(media({ site: 'netflix', id: '81234567' }).paused, true, 'a new video starts paused');
});
check('two clicks at once: the second, blind to the first, collides', () => {
    const last = { seq: 5, by: 'ana', changedAt: 10000 };
    assert(PartyState.conflicts(last, 'ben', 4, 10400));
    assert(!PartyState.conflicts(last, 'ben', 5, 10400), 'Ben had seen it');
    assert(!PartyState.conflicts(last, 'ana', 4, 10400), 'nobody collides with themselves');
    assert(!PartyState.conflicts(last, 'ben', 4, 10000 + PartyState.CONFLICT_MS), 'a late act is a deliberate one');
});
check('an accepted intent rebases the vector on where its member was', () => {
    const next = PartyState.apply(playingAt(), PartyState.validateIntent(intentOf({ pos: 101.5, at: 11500 }), 11600), 'ben');
    eq([next.seq, next.paused, next.pos, next.at, next.by], [5, true, 101.5, 11500, 'ben']);
    const faster = PartyState.apply(playingAt(), PartyState.validateIntent(intentOf({ op: 'rate', rate: 1.5, pos: 102 }), 12000), 'ana');
    eq([faster.rate, faster.paused, faster.pos], [1.5, false, 102]);
});
check('acting on the room clears a hold, changing its speed does not', () => {
    const held = playingAt({ hold: { waiting: ['cat'], since: 10000 } });
    eq(PartyState.apply(held, PartyState.validateIntent(intentOf(), 10000), 'ana').hold, null);
    const rated = PartyState.apply(held, PartyState.validateIntent(intentOf({ op: 'rate', rate: 2 }), 10000), 'ana');
    eq(rated.hold, { waiting: ['cat'], since: 10000 });
});

check('a room rate is a finite number the room could have accepted, or nothing', () => {
    eq([0.25, 1, '2', 5].map(PartyState.validRate), [0.25, 1, 2, 5]);
    eq([0.1, 5.5, 16, -1, NaN, Infinity, null, undefined, '', 'fast', {}].map(PartyState.validRate),
        [null, null, null, null, null, null, null, null, null, null, null]);
});

// --------------------------------------------------------- party drift

const PartyDrift = require('../src/shared/party-drift.js');

/** A drift controller and a clock that moves a second per decision. */
function driftAt(profile) {
    const drift = PartyDrift.createDrift({ profile });
    let now = 100000;
    return {
        drift,
        at: () => now,
        decide(d, over = {}) {
            now += PartyDrift.EVAL_MS;
            return drift.decide({ actual: 50 + d, expected: 50, now, ...over });
        },
        wait(ms) { now += ms; },
    };
}

section('party drift');
check('inside the deadband nothing is touched', () => {
    eq(driftAt().decide(0.05), { kind: 'none' });
    eq(driftAt().decide(-0.09), { kind: 'none' });
});
check('ahead slows down and behind speeds up, by no more than the cap', () => {
    eq(driftAt().decide(0.5), { kind: 'rate', rate: 0.92 });
    eq(driftAt().decide(-0.2), { kind: 'rate', rate: 1.05 });
    eq(driftAt().decide(-0.2, { rate: 2 }), { kind: 'rate', rate: 2.1 }, 'relative to the room rate');
});
check('one decision a second, however often timeupdate asks', () => {
    const t = driftAt();
    eq(t.decide(0.5).kind, 'rate');
    eq(t.drift.decide({ actual: 50.5, expected: 50, now: t.at() + 200 }), { kind: 'none' });
});
check('a nudge holds until the drift is nearly gone, then hands the rate back', () => {
    const t = driftAt();
    eq(t.decide(0.3).kind, 'rate');
    eq(t.decide(0.08).kind, 'rate', 'below the deadband but not settled');
    eq(t.decide(0.03), { kind: 'rate', rate: 1 });
    eq(t.decide(0.03), { kind: 'none' }, 'handed back once');
});
check('a nudge is not rewritten for a change nobody could hear', () => {
    const t = driftAt();
    eq(t.decide(-0.4), { kind: 'rate', rate: 1.08 });
    eq(t.decide(-0.39), { kind: 'none' });
});
check('a big drift seeks to where the room will be once the seek is done', () => {
    const t = driftAt();
    eq(t.decide(2), { kind: 'seek', to: 50 + PartyDrift.SEEK_LATENCY_START });
    eq(t.decide(3), { kind: 'none' }, 'nothing while the seek is out');
    t.drift.seekDone(t.at() + 500, 1000);
    eq(Math.round(t.drift.seekLatency() * 1000), 475);
    eq(t.decide(0.5), { kind: 'none' }, 'held off while the player settles');
    t.wait(PartyDrift.SEEK_FREEZE_MS);
    eq(t.decide(0.5).kind, 'rate');
});
check('a seek out of a nudge puts the room rate back with it', () => {
    const t = driftAt();
    t.decide(0.5);
    eq(t.decide(2, { rate: 1 }), { kind: 'seek', to: 50.25, rate: 1 });
});
check('a second big drift inside the cooldown is nudged, not seeked', () => {
    const t = driftAt();
    t.decide(2);
    t.drift.seekDone(t.at(), 200);
    t.wait(PartyDrift.SEEK_FREEZE_MS);
    eq(t.decide(2), { kind: 'rate', rate: 0.92 });
});
check('behind with nothing buffered, it runs to catch up rather than jump into the hole', () => {
    eq(driftAt().decide(-2, { bufferedAhead: 0.5 }), { kind: 'rate', rate: 1.08 });
    eq(driftAt().decide(-2, { bufferedAhead: 30 }).kind, 'seek');
});
check('three seeks in a minute and the thresholds widen for a while', () => {
    const t = driftAt();
    for (let i = 0; i < PartyDrift.STRUGGLE_SEEKS; i++) {
        t.decide(2);
        t.drift.seekDone(t.at(), 300);
        t.wait(PartyDrift.SEEK_COOLDOWN_MS);
    }
    assert(t.drift.struggling(t.at()));
    eq(t.decide(2).kind, 'rate', 'what was a seek is a nudge now');
    t.wait(PartyDrift.STRUGGLE_MS);
    assert(!t.drift.struggling(t.at()));
});
check('paused, an overshoot is taken back exactly, with no lead', () => {
    eq(driftAt().decide(0.3, { paused: true }), { kind: 'seek', to: 50 });
    eq(driftAt().decide(0.05, { paused: true }), { kind: 'none' });
});
check('a player that will not hold a rate is only ever seeked, and less eagerly', () => {
    const t = driftAt('seekOnly');
    eq(t.decide(0.8), { kind: 'none' });
    eq(t.decide(1.2).kind, 'seek');
    const switched = driftAt();
    switched.drift.setProfile('seekOnly');
    eq(switched.drift.profile(), 'seekOnly');
    eq(switched.decide(0.5), { kind: 'none' });
});

// ---------------------------------------------------------- party room

const PartyRoom = require('../src/shared/party-room.js');

/** A room with ids minted in order and every message it sends kept. */
function roomOf(policy = {}) {
    const sent = [];
    let n = 0;
    const room = PartyRoom.createRoom({
        id: 'room1', policy,
        send: (to, msg) => sent.push({ to, msg }),
        mint: (prefix) => `${prefix}${++n}`,
    });
    return {
        room,
        sent,
        join: (name, now = 0) => room.join({ name }, now).member,
        /** What `to` has been sent of type `t`, oldest first. */
        got: (to, t) => sent.filter((one) => one.to === to && one.msg.t === t).map((one) => one.msg),
        clear: () => { sent.length = 0; },
    };
}

const play = (over = {}) => ({ t: 'intent', id: 1, base: 0, op: 'play', pos: 10, at: 1000, ...over });

section('party room');
check('the first in is the host, and everyone hears who else is here', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    const ben = r.join('  Ben  ');
    const welcome = r.got(ben, 'welcome')[0];
    eq([welcome.v, welcome.you, welcome.room.id], [PartyRoom.VERSION, ben, 'room1']);
    eq(r.got(ana, 'members').pop().list.map((m) => [m.name, m.role]), [['Ana', 'host'], ['Ben', 'guest']]);
});
check('an accepted intent reaches everyone, acknowledged to its sender', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    r.room.handle(ben, play(), 1000);
    const seen = r.got(ana, 'state').pop();
    eq([seen.seq, seen.paused, seen.pos, seen.by], [1, false, 10, ben]);
    eq(r.got(ben, 'state').pop().ack, { member: ben, id: 1 });
});
check('a refused intent is said to its sender alone, with the state to snap back to', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    r.clear();
    r.room.handle(ben, play({ pos: NaN }), 1000);
    eq(r.got(ben, 'reject'), [{ t: 'reject', id: 1, why: 'invalid' }]);
    eq(r.got(ben, 'state').length, 1);
    eq(r.got(ana, 'state').length, 0);
});
check('in host control only the host and co-hosts drive', () => {
    const r = roomOf({ control: 'host' });
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    r.room.handle(ben, play(), 1000);
    eq(r.got(ben, 'reject').pop().why, 'policy');
    r.room.handle(ana, { t: 'role', member: ben, role: 'cohost' }, 1100);
    r.room.handle(ben, play({ id: 2 }), 1200);
    eq(r.room.state().by, ben);
});
check('two clicks at once: the first stands and the second is refused', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    r.room.handle(ana, play({ op: 'pause' }), 1000);
    r.room.handle(ben, play({ at: 1100 }), 1100);
    eq(r.got(ben, 'reject').pop().why, 'conflict');
    eq(r.room.state().paused, true);
    r.room.handle(ben, play({ id: 2, at: 3000 }), 3000);
    eq(r.room.state().paused, false, 'the same stale view, acted on later, is let through');
});
check('a member hammering the room is slowed down', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    for (let i = 1; i <= PartyRoom.INTENTS_PER_S + 1; i++) {
        r.room.handle(ana, play({ id: i, base: i - 1, op: 'seek', at: 1000 + i }), 1000 + i);
    }
    eq(r.got(ana, 'reject').pop().why, 'rate-limit');
    eq(r.room.state().seq, PartyRoom.INTENTS_PER_S);
});
check('a ping is answered, and a member behind on the state is sent it', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    r.room.handle(ana, play(), 1000);
    r.clear();
    r.room.handle(ana, { t: 'ping', c: 5, seq: 1, rtt: 80 }, 2000);
    eq(r.got(ana, 'pong'), [{ t: 'pong', c: 5, s: 2000, s2: 2000, seq: 1 }]);
    eq(r.got(ana, 'state').length, 0);
    r.room.handle(ana, { t: 'ping', c: 6, seq: 0 }, 3000);
    eq(r.got(ana, 'state').length, 1);
    eq(r.room.members()[0].rtt, 80);
});
check('a guest asking to pause is heard by the hosts, not by the other guests', () => {
    const r = roomOf({ control: 'host' });
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    const cat = r.join('Cat');
    r.room.handle(ben, { t: 'request', op: 'pause' }, 1000);
    eq(r.got(ana, 'request'), [{ t: 'request', from: ben, op: 'pause' }]);
    eq(r.got(cat, 'request'), []);
});
check('only the host sets the rules, hands over, or shows someone out', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    r.room.handle(ben, { t: 'policy', control: 'host' }, 1000);
    eq(r.room.policy().control, 'everyone');
    r.room.handle(ana, { t: 'policy', control: 'host', locked: true }, 1000);
    eq(r.room.policy(), { control: 'host', wait: true, locked: true });
    eq(r.room.join({ name: 'Dee' }, 1000), { error: 'locked' });
    r.room.handle(ana, { t: 'role', member: ben, role: 'host' }, 1100);
    eq(r.room.members().map((m) => m.role), ['cohost', 'host']);
    r.room.handle(ben, { t: 'kick', member: ana }, 1200);
    eq(r.got(ana, 'error'), [{ t: 'error', code: 'kicked' }]);
    eq(r.room.members().map((m) => m.name), ['Ben']);
});
check('a member comes back as themselves with the token from their welcome', () => {
    const r = roomOf();
    r.join('Ana');
    const ben = r.join('Ben');
    const token = r.got(ben, 'welcome')[0].resume;
    eq(r.room.join({ resume: token }, 5000), { member: ben });
    eq(r.room.join({ resume: 'r-unknown' }, 5000), { error: 'expired' });
});
check('the host leaving hands the room to the first co-host, else the earliest', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    r.join('Ben');
    const cat = r.join('Cat');
    r.room.handle(ana, { t: 'role', member: cat, role: 'cohost' }, 100);
    r.room.handle(ana, { t: 'bye' }, 200);
    eq(r.room.members().map((m) => [m.name, m.role]), [['Ben', 'guest'], ['Cat', 'host']]);
});
check('a member gone quiet is shown away, and back on their next word', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    r.room.handle(ana, { t: 'ping', c: 0, seq: 0 }, PartyRoom.AWAY_MS);
    r.room.tick(PartyRoom.AWAY_MS);
    eq(r.room.members().map((m) => m.away), [false, true]);
    r.room.handle(ben, { t: 'ping', c: 0, seq: 0 }, PartyRoom.AWAY_MS + 100);
    eq(r.got(ana, 'members').pop().list.map((m) => m.away), [false, false]);
});
check('a minute of silence ends the grace: gone, and the token with them', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    const token = r.got(ben, 'welcome')[0].resume;
    r.room.handle(ana, { t: 'ping', c: 0, seq: 0 }, PartyRoom.REMOVE_MS);
    r.room.tick(PartyRoom.REMOVE_MS);
    eq(r.room.members().map((m) => m.name), ['Ana']);
    eq(r.room.join({ resume: token }, PartyRoom.REMOVE_MS), { error: 'expired' });
});
check('a host gone quiet hands over at once, and comes back a co-host', () => {
    const r = roomOf({ control: 'host' });
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    r.room.handle(ben, { t: 'ping', c: 0, seq: 0 }, PartyRoom.AWAY_MS);
    r.room.tick(PartyRoom.AWAY_MS);
    eq(r.room.members().map((m) => m.role), ['cohost', 'host']);
    r.room.handle(ana, play({ at: PartyRoom.AWAY_MS + 50 }), PartyRoom.AWAY_MS + 50);
    eq(r.room.state().by, ana, 'still allowed to drive');
});
check('with the whole room quiet the host keeps it', () => {
    const r = roomOf();
    r.join('Ana');
    r.join('Ben');
    r.room.tick(PartyRoom.AWAY_MS);
    eq(r.room.members().map((m) => [m.role, m.away]), [['host', true], ['guest', true]]);
});
check('a solo member watches alone and cannot drive', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    r.room.handle(ana, { t: 'solo', solo: true }, 100);
    r.room.handle(ana, play(), 1000);
    eq(r.got(ana, 'reject').pop().why, 'policy');
    eq(r.room.members()[0].solo, true);
});

// ---------------------------------------------------------- party holds

/** Ana and Ben (and `extra` more), playing from 10s at t=1000. */
function playingRoom(policy = {}, extra = 0) {
    const r = roomOf(policy);
    const ids = ['Ana', 'Ben', ...Array.from({ length: extra }, (_, i) => `M${i}`)].map((name) => r.join(name));
    r.room.handle(ids[0], play(), 1000);
    return { ...r, ana: ids[0], ben: ids[1], ids };
}
const stall = (why = 'buffering') => ({ t: 'ready', ready: false, why });

section('party holds');
check('a member buffering holds the room where it had got to', () => {
    const r = playingRoom();
    r.room.handle(r.ben, stall(), 3000);
    const held = r.room.state();
    eq([held.paused, held.pos, held.at, held.hold], [false, 12, 3000, { waiting: [r.ben], since: 3000 }]);
    eq(PartyState.expected(held, 9000), 12, 'the position stands still while held');
});
check('everyone ready, the room goes again together, a little ahead', () => {
    const r = playingRoom();
    r.room.handle(r.ana, { t: 'ping', c: 0, seq: 0, rtt: 400 }, 2000);
    r.room.handle(r.ben, stall(), 3000);
    r.room.handle(r.ana, stall(), 3100);
    eq(r.room.state().hold.waiting, [r.ben, r.ana]);
    r.room.handle(r.ben, { t: 'ready', ready: true }, 4000);
    r.room.handle(r.ana, { t: 'ready', ready: true }, 5000);
    const going = r.room.state();
    eq([going.hold, going.pos, going.at], [null, 12, 5000 + 200 + PartyRoom.LEAD_PAD_MS]);
    assert(PartyState.scheduled(going, 5100));
});
check('an ad, a paused room, or a room that said not to wait holds nothing', () => {
    const ad = playingRoom();
    ad.room.handle(ad.ben, stall('ad'), 3000);
    eq(ad.room.state().hold, null);
    eq(ad.room.members()[1].why, 'ad');
    const paused = playingRoom();
    paused.room.handle(paused.ana, play({ id: 2, base: 1, op: 'pause', at: 2000 }), 2000);
    paused.room.handle(paused.ben, stall(), 3000);
    eq(paused.room.state().hold, null);
    const off = playingRoom({ wait: false });
    off.room.handle(off.ben, stall(), 3000);
    eq(off.room.state().hold, null);
});
check('past six people nobody waits for anyone', () => {
    const r = playingRoom({}, PartyRoom.HOLD_MAX_MEMBERS - 1);
    r.room.handle(r.ben, stall(), 3000);
    eq(r.room.state().hold, null);
});
check('the wait is capped, and the straggler catches up rather than holding again', () => {
    const r = playingRoom();
    r.room.handle(r.ben, stall(), 3000);
    r.room.handle(r.ana, { t: 'ping', c: 0, seq: 3 }, 3000 + PartyRoom.HOLD_TIMEOUT_MS);
    r.room.tick(3000 + PartyRoom.HOLD_TIMEOUT_MS);
    eq(r.room.state().hold, null);
    eq(r.room.members()[1].lagging, true);
    r.room.handle(r.ben, { t: 'ready', ready: true }, 12000);
    r.room.handle(r.ben, stall(), 13000);
    eq(r.room.state().hold, null, 'still excluded');
    for (const id of [r.ana, r.ben]) r.room.handle(id, { t: 'ping', c: 0, seq: 4 }, 3000 + PartyRoom.HOLD_TIMEOUT_MS + PartyRoom.EXCLUDE_MS);
    r.room.tick(3000 + PartyRoom.HOLD_TIMEOUT_MS + PartyRoom.EXCLUDE_MS);
    eq(r.room.members()[1].lagging, false);
});
check('a member who keeps holding the room stops holding it', () => {
    const r = playingRoom();
    for (let i = 0; i < PartyRoom.FLAP_HOLDS; i++) {
        r.room.handle(r.ben, stall(), 3000 + i * 10000);
        r.room.handle(r.ben, { t: 'ready', ready: true }, 4000 + i * 10000);
    }
    eq(r.room.members()[1].lagging, true);
    eq(r.room.state().hold, null);
});
check('somebody pausing during a hold wins, and can act on the held state', () => {
    const r = playingRoom();
    r.room.handle(r.ben, stall(), 3000);
    const seen = r.room.state().seq;
    r.room.handle(r.ana, play({ id: 2, base: seen, op: 'pause', pos: 12, at: 3200 }), 3200);
    eq([r.room.state().paused, r.room.state().hold], [true, null]);
    eq(r.got(r.ana, 'reject'), []);
});
check('play pressed while someone is still loading starts the room held on them', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    r.room.handle(ben, stall('loading'), 500);
    r.room.handle(ana, play(), 1000);
    eq([r.room.state().paused, r.room.state().hold], [false, { waiting: [ben], since: 1000 }]);
});
check('a member leaving or stepping out is not waited for', () => {
    const r = playingRoom();
    r.room.handle(r.ben, stall(), 3000);
    r.room.handle(r.ben, { t: 'solo', solo: true }, 3500);
    eq(r.room.state().hold, null);
    const gone = playingRoom();
    gone.room.handle(gone.ben, stall(), 3000);
    gone.room.handle(gone.ben, { t: 'bye' }, 3500);
    eq(gone.room.state().hold, null);
});

// ---------------------------------------------------------- party chat

const PartyChat = require('../src/shared/party-chat.js');
const say = (text) => ({ t: 'chat', text });

section('party chat');
check('a line is one line of plain text, cut at a whole character', () => {
    eq(PartyChat.clean('  hi \n\t there\u0000\u001b[31m '), 'hi there[31m');
    eq([PartyChat.clean('   '), PartyChat.clean(42), PartyChat.clean(null)], ['', '', '']);
    const long = `${'a'.repeat(PartyChat.MAX_CHARS - 1)}😀😀`;
    eq(Array.from(PartyChat.clean(long)).length, PartyChat.MAX_CHARS);
    assert(PartyChat.clean(long).endsWith('😀'), 'the emoji is kept whole, not half a surrogate');
});
check('a line reaches everyone, its sender too, named and with an id of its own', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    r.room.handle(ben, say('  the drone shot   is unreal '), 1200);
    const line = { t: 'chat', id: 'c5', from: ben, name: 'Ben', at: 1200, text: 'the drone shot is unreal' };
    eq([r.got(ana, 'chat'), r.got(ben, 'chat')], [[line], [line]]);
    r.room.handle(ben, say(' \n '), 1300);
    r.room.handle(ben, { t: 'chat' }, 1300);
    eq(r.got(ana, 'chat').length, 1, 'nothing to say is not said');
});
check('chat has its own budget: a sixth line in five seconds is dropped, and a pause still goes', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    for (let i = 0; i < 6; i++) r.room.handle(ana, say(`line ${i}`), 1000 + i * 100);
    eq(r.got(ana, 'chat').map((msg) => msg.text), ['line 0', 'line 1', 'line 2', 'line 3', 'line 4']);
    r.room.handle(ana, play({ op: 'pause' }), 1700);
    eq([r.got(ana, 'reject'), r.room.state().paused], [[], true]);
    r.room.handle(ana, say('later'), 1000 + PartyChat.WINDOW_MS);
    eq(r.got(ana, 'chat').pop().text, 'later', 'the window moves on');
});
check('whoever joins or comes back is sent the last lines after the welcome, oldest first', () => {
    const r = roomOf();
    const ana = r.join('Ana');
    const ben = r.join('Ben');
    const resume = r.got(ben, 'welcome')[0].resume;
    for (let i = 0; i < PartyChat.HISTORY + 2; i++) r.room.handle(i % 2 ? ana : ben, say(`line ${i}`), i * 3000);
    r.clear();
    const cy = r.join('Cy', 200000);
    const toCy = r.sent.filter((one) => one.to === cy).map((one) => one.msg);
    eq(toCy[0].t, 'welcome');
    const past = toCy.filter((msg) => msg.t === 'chat');
    eq([past.length, past[0].text, past.pop().text], [PartyChat.HISTORY, 'line 2', `line ${PartyChat.HISTORY + 1}`]);
    assert(toCy.filter((msg) => msg.t === 'chat').every((msg) => msg.past === true), 'marked as history');
    r.clear();
    r.room.join({ resume }, 200500);
    eq(r.got(ben, 'chat').length, PartyChat.HISTORY, 'a resume is replayed the same, for the member to drop what it has');
});
check('a room carried on from another keeps its lines and their ids, and mints new ones', () => {
    const old = [{ id: 'cold1', from: 'm9', name: 'Ana', at: 10, text: 'still here?' }, { id: '', text: 'no id' }, { id: 'cold2', at: 11, text: ' ' }];
    const sent = [];
    const room = PartyRoom.createRoom({ id: 'room2', chat: old, send: (to, msg) => sent.push({ to, msg }) });
    const ben = room.join({ name: 'Ben' }, 0).member;
    room.handle(ben, say('yes'), 100);
    const lines = sent.filter((one) => one.msg.t === 'chat').map((one) => one.msg);
    eq(lines.map((msg) => [msg.id, msg.name, msg.text, msg.past]), [['cold1', 'Ana', 'still here?', true], [lines[1].id, 'Ben', 'yes', undefined]]);
    assert(/^c[0-9a-f]{16}$/.test(lines[1].id), 'a minted id, not a count that could meet an old one');
});
check('a member\'s log keeps each line once, in the order it came, and no more than it may', () => {
    const log = PartyChat.createLog(3);
    const line = (id) => ({ id, text: id });
    eq(['a', 'b', 'a', 'c', 'd'].map((id) => log.add(line(id))), [true, true, false, true, true]);
    eq(log.lines().map((one) => one.id), ['b', 'c', 'd']);
    eq(log.add(line('a')), false, 'pushed out, and still not taken back as new when a resume replays it');
    eq([PartyChat.fromWire({ id: 'c1', text: ' hi ', at: 5 }), PartyChat.fromWire({ id: 'c2', text: '' }), PartyChat.fromWire({ text: 'x' })],
        [{ id: 'c1', from: null, name: 'Someone', at: 5, text: 'hi' }, null, null]);
});
check('the notes say who came, went, stepped out or hosts, and never about yourself', () => {
    const m = (id, name, extra = {}) => ({ id, name, role: 'guest', solo: false, ...extra });
    const before = [m('me', 'Nadia', { role: 'host' }), m('a', 'Ana'), m('r', 'Rafi'), m('s', 'Sam')];
    const after = [m('me', 'Nadia', { solo: true }), m('a', 'Ana', { role: 'host' }), m('r', 'Rafi', { solo: true }), m('b', 'Ben')];
    eq(PartyChat.memberNotes(before, after, 'me'), ['Ana is the host now', 'Rafi stepped out to watch solo', 'Ben joined', 'Sam left']);
    eq(PartyChat.memberNotes(after, before, 'me'), ['Rafi rejoined', 'Sam joined', 'Ben left']);
    const members = [m('me', 'Nadia'), m('s', 'Sam'), m('a', 'Ana')];
    const held = (waiting) => ({ hold: { waiting } });
    eq(PartyChat.waitNote({ hold: null }, held(['s']), members, 'me'), 'Waiting for Sam…');
    eq(PartyChat.waitNote(held(['s']), held(['s', 'me', 'a', 'x']), members, 'me'), 'Waiting for Ana and 1 more…');
    eq([PartyChat.waitNote(held(['s']), held(['s']), members, 'me'), PartyChat.waitNote(null, held(['me']), members, 'me')], [null, null]);
});

// ------------------------------------------------ party protocol vectors

// party-vectors.json against this authority. Servers are held to the same
// file, so these look only at messages sent, never at internals.
const PartyVectors = require('./party-vectors.json');

/** "@a" becomes alias a's member id, wherever it appears in a value. */
function withIds(value, ids) {
    if (typeof value === 'string' && value.startsWith('@')) return ids[value.slice(1)] || value;
    if (Array.isArray(value)) return value.map((one) => withIds(one, ids));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, one]) => [key, withIds(one, ids)]));
    }
    return value;
}

/** Every field `want` names, `got` has the same; arrays have the same length too. */
function matches(got, want) {
    if (Array.isArray(want)) return Array.isArray(got) && got.length === want.length && want.every((one, i) => matches(got[i], one));
    if (want && typeof want === 'object') return !!got && typeof got === 'object' && Object.keys(want).every((key) => matches(got[key], want[key]));
    return got === want;
}

function runVector(vector) {
    const r = roomOf(vector.policy || {});
    const ids = {};
    for (const step of vector.steps) {
        if (step.join) {
            const token = step.resume && (ids[step.resume] ? r.got(ids[step.resume], 'welcome')[0].resume : step.resume);
            const out = r.room.join(token ? { resume: token } : { name: step.name }, step.at);
            // What the server does with a refused join: error, then close.
            if (out.error) r.sent.push({ to: `alias:${step.join}`, msg: { t: 'error', code: out.error } });
            else ids[step.join] = out.member;
        } else if (step.tick) {
            r.room.tick(step.at);
        } else {
            r.room.handle(ids[step.from], withIds(step.msg, ids), step.at);
        }
    }

    const inbox = (alias) => r.sent.filter((one) => one.to === ids[alias] || one.to === `alias:${alias}`).map((one) => one.msg);
    const next = {};
    for (const { to, msg } of vector.expect || []) {
        const want = withIds(msg, ids);
        const got = inbox(to);
        const found = got.findIndex((one, i) => i >= (next[to] || 0) && matches(one, want));
        if (found < 0) throw new Error(`${to} was never sent ${JSON.stringify(want)} (in order)`);
        next[to] = found + 1;
    }
    for (const { to, msg } of vector.absent || []) {
        const want = withIds(msg, ids);
        if (inbox(to).some((one) => matches(one, want))) throw new Error(`${to} was sent ${JSON.stringify(want)}`);
    }
}

section('party protocol vectors');
check('the vector file is the version this suite reads', () => eq(PartyVectors.version, 1));
for (const vector of PartyVectors.cases) {
    check(vector.name, () => runVector(vector));
}

// ---------------------------------------------------------- party sites

const PartySites = require('../src/shared/party-sites.js');

section('party sites');
check('a watch page names its media; anything else names none', () => {
    eq(PartySites.mediaOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s'), { site: 'youtube', id: 'dQw4w9WgXcQ' });
    eq(PartySites.mediaOf('https://www.netflix.com/watch/81234567?trackId=1'), { site: 'netflix', id: '81234567' });
    eq(PartySites.mediaOf('https://www.netflix.com/browse'), null);
    eq(PartySites.mediaOf('https://www.youtube.com/watch?v=short'), null, 'not an id the authority would take');
    eq(PartySites.mediaOf('https://example.com/watch/81234567'), null);
});
check('the way back to a video is built here, never taken from a peer', () => {
    eq(PartySites.urlFor({ site: 'youtube', id: 'dQw4w9WgXcQ' }), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    eq(PartySites.urlFor({ site: 'netflix', id: '81234567' }), 'https://www.netflix.com/watch/81234567');
    eq(PartySites.urlFor({ site: 'netflix', id: '1/../../logout' }), null);
    eq(PartySites.urlFor({ site: 'javascript', id: 'alert(1)' }), null);
});
check('every party site has a media pattern the authority checks, and no more', () => {
    eq(PartySites.list().map((site) => site.id).sort(), Object.keys(PartyState.MEDIA_ID).sort());
});
check('only netflix seeks through its api and probes the rate', () => {
    eq(PartySites.list().map((site) => [site.id, site.seek, site.rate]),
        [['youtube', 'video', 'nudge'], ['netflix', 'api', 'probe']]);
});
check('the loader and the registry agree on which tab is a party site', () => {
    const PartyLoader = require('../src/background/party-loader.js');
    for (const url of ['https://www.youtube.com/', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://www.netflix.com/watch/1', 'https://example.com/', 'not a url']) {
        eq(PartyLoader.siteOf(url), PartySites.siteOf(url), url);
    }
});
check('the loader injects each party module after the ones it reads', () => {
    const files = require('../src/background/party-loader.js').CONTENT_FILES;
    const at = (name) => files.indexOf(`src/shared/${name}.js`);
    assert(at('party-state') >= 0 && at('party-state') < at('party-sites'), 'party-sites reads PartyState');
    const page = (name) => files.indexOf(`src/content/${name}.js`);
    assert(at('party-chat') >= 0 && page('party-chip') < page('party-chat-panel'), 'the chat reads PartyChat and the chip\'s player');
    assert(page('party-chat-panel') < page('party-media'), 'party-media builds the chat as it boots');
});

// ---------------------------------------------------------- party media

const PartyMedia = require('../src/content/party-media.js');

section('party media — the expectation ledger');
check('an event matching a write of ours is ours, once', () => {
    const ledger = PartyMedia.createLedger();
    ledger.expect('pause', null, 1000);
    assert(ledger.consume('pause', null, 1100));
    assert(!ledger.consume('pause', null, 1150), 'a second pause is the user');
});
check('a seek is ours if it lands near where we sent it; a rate only if it is the rate', () => {
    const ledger = PartyMedia.createLedger();
    ledger.expect('seek', 42, 0);
    ledger.expect('rate', 0.95, 0);
    assert(!ledger.consume('seek', 50, 10), 'the user seeking elsewhere meanwhile');
    assert(ledger.consume('seek', 42.3, 10), 'a keyframe away');
    assert(!ledger.consume('rate', 1, 10), 'the page putting its own rate back');
    assert(ledger.consume('rate', 0.95, 10));
});
check('two quick rate writes are both ours, though both events read the second', () => {
    const ledger = PartyMedia.createLedger();
    ledger.expect('rate', 1.5, 0);
    ledger.expect('rate', 1.08, 0);
    assert(ledger.consume('rate', 1.08, 5));
    assert(ledger.consume('rate', 1.08, 6));
});
check('asking whether an event is ours does not spend the match', () => {
    const ledger = PartyMedia.createLedger();
    ledger.expect('seek', 42, 0);
    assert(ledger.has('seek', 42.2, 5), 'seeking');
    assert(ledger.consume('seek', 42.2, 6), 'then seeked');
    assert(!ledger.has('seek', 42.2, 7));
});
check('an expectation that never came back stops matching', () => {
    const ledger = PartyMedia.createLedger();
    ledger.expect('play', null, 0);
    assert(!ledger.consume('play', null, PartyMedia.EXPECT_MS + 1));
});
check('the browser suite loads the party the way the loader injects it', () => {
    const html = require('fs').readFileSync(`${__dirname}/index.html`, 'utf8');
    // The party's own files. One it shares, the page bridge, is loaded
    // earlier for other specs, and load-order.js holds it before its user.
    const files = require('../src/background/party-loader.js').CONTENT_FILES.filter((file) => file.includes('party'));
    const loaded = [...html.matchAll(/src="\.\.\/(src\/[^"]*party[^"]*)"/g)].map((one) => one[1]);
    // What offscreen.html loads comes after these, for its own specs: it is not the tab's.
    eq(loaded.slice(0, files.length), [...files]);
});

// ------------------------------------------------------------ activity

// Just enough chrome.* for the store: a local key/value area, promise form.
const store = {};
global.chrome = {
    storage: {
        local: {
            get: (keys, cb) => {
                const out = {};
                // null is everything, as Chrome has it.
                (keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys]).forEach((k) => {
                    if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
                });
                if (cb) return void cb(out);
                return Promise.resolve(out);
            },
            set: (values, cb) => {
                Object.assign(store, values);
                if (cb) return void cb();
                return Promise.resolve();
            },
            remove: (keys, cb) => {
                (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete store[k]; });
                if (cb) return void cb();
                return Promise.resolve();
            },
        },
    },
};

require('../src/shared/settings.js');
require('../src/shared/activity.js');
const Activity = globalThis.BB.Activity;
const Feed = require('../src/shared/feed.js');

// One o'clock today, not a fixed date: the store prunes past KEEP_DAYS on
// write, and these tests add minutes to it without crossing midnight.
const T0 = new Date().setHours(13, 0, 0, 0);
const secs = (n) => n * 1000;
const tabAt = (url, title) => ({ url, title });

function reset({ on = true } = {}) {
    Object.keys(store).forEach((k) => delete store[k]);
    store.trackActivity = on;
    Activity.blur();
}

const dayRecord = (at = T0) => store[Activity.dayStore(Time.dayKey(at))] || null;

/** The days stored one key each, oldest first. */
const storedDays = () => Object.keys(store)
    .filter((key) => key.startsWith(Activity.DAY_PREFIX)).map((key) => key.slice(Activity.DAY_PREFIX.length)).sort();

(async () => {
    section('activity — recording');

    await checkAsync('records nothing while tracking is off', async () => {
        reset({ on: false });
        await Activity.tick(tabAt('https://github.com/a', 'A'), T0);
        await Activity.tick(tabAt('https://github.com/a', 'A'), T0 + secs(60));
        eq([storedDays(), store[Activity.DAYS_KEY]], [[], undefined]);
    });

    await checkAsync('the first tick records nothing', async () => {
        reset();
        await Activity.tick(tabAt('https://github.com/a', 'A'), T0);
        eq(dayRecord(), null);
    });

    await checkAsync('credits the gap to what was focused first', async () => {
        reset();
        await Activity.tick(tabAt('https://github.com/one', 'One'), T0);
        await Activity.tick(tabAt('https://example.com/two', 'Two'), T0 + secs(30));
        const day = dayRecord();
        eq(day.hosts['github.com'], 30);
        eq(day.hosts['example.com'], undefined, 'the new tab has accrued nothing');
        eq(day.total, 30);
    });

    await checkAsync('elapsed time is measured, not counted in ticks', async () => {
        reset();
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0);
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0 + secs(45));
        eq(dayRecord().total, 45);
    });

    await checkAsync('a gap past the idle threshold is dropped', async () => {
        reset();
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0);
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0 + secs(600));
        eq(dayRecord(), null);
    });

    await checkAsync('blur() stops the clock', async () => {
        reset();
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0);
        Activity.blur();
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0 + secs(30));
        eq(dayRecord(), null);
    });

    await checkAsync('a non-http page clears the marker', async () => {
        reset();
        await Activity.tick(tabAt('https://github.com/a', 'A'), T0);
        await Activity.tick(tabAt('chrome://extensions', 'Extensions'), T0 + secs(10));
        const afterFirst = dayRecord().total;
        await Activity.tick(tabAt('https://github.com/a', 'A'), T0 + secs(70));
        eq(afterFirst, 10);
        eq(dayRecord().total, afterFirst, 'time on chrome:// is credited to nothing');
    });

    await checkAsync('the marker survives the worker being torn down between ticks', async () => {
        reset();
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0);

        // As MV3 does between alarms: the module evaluated afresh, only storage
        // carried over — and, the stub having no storage.session, local's fallback.
        delete require.cache[require.resolve('../src/shared/activity.js')];
        const restarted = require('../src/shared/activity.js');

        await restarted.tick(tabAt('https://a.test/x', 'X'), T0 + secs(30));
        eq(dayRecord().total, 30, 'the gap is credited, not thrown away with the worker');
    });

    await checkAsync('where there is session storage the marker is kept there, not written to disk each tick', async () => {
        const session = {};
        global.chrome.storage.session = {
            get: (keys, cb) => cb(Object.fromEntries(keys.filter((k) => k in session).map((k) => [k, session[k]]))),
            set: (values, cb) => { Object.assign(session, values); cb(); },
        };
        try {
            reset();
            await Activity.tick(tabAt('https://a.test/x', 'X'), T0);
            eq(session[Activity.LAST_KEY].host, 'a.test');
            eq(store[Activity.LAST_KEY], undefined);
        } finally {
            delete global.chrome.storage.session;
        }
    });

    await checkAsync('the longest page accumulates across ticks', async () => {
        reset();
        await Activity.tick(tabAt('https://a.test/x', 'Short page'), T0);
        await Activity.tick(tabAt('https://b.test/y', 'Long page'), T0 + secs(10));
        await Activity.tick(tabAt('https://b.test/y', 'Long page'), T0 + secs(40));
        await Activity.tick(tabAt('https://c.test/z', 'Another'), T0 + secs(70));
        const day = dayRecord();
        eq([day.top.title, day.top.host, day.top.seconds], ['Long page', 'b.test', 60]);
        eq(day.total, 70);
    });
    await checkAsync('a page reached second still wins when its visit runs longer', async () => {
        // Only the day's leader added up: B at ninety seconds lost to A at
        // sixty, because each of B's ticks started from nothing.
        reset();
        const visits = [['https://a.test/', 'A'], ['https://a.test/', 'A'], ['https://b.test/', 'B'], ['https://b.test/', 'B'], ['https://b.test/', 'B'], ['https://c.test/', 'C']];
        for (const [at, [url, title]] of visits.entries()) await Activity.tick(tabAt(url, title), T0 + secs(30 * at));
        eq([dayRecord().top.title, dayRecord().top.seconds], ['B', 90]);
    });
    await checkAsync('two pages with the same title are two visits, and a jump within a page is the same one', async () => {
        reset();
        const visits = [['https://w.test/one', 'Same'], ['https://w.test/one#part-2', 'Same'], ['https://w.test/two', 'Same'], ['https://w.test/two', 'Same'], ['https://x.test/', 'X']];
        for (const [at, [url, title]] of visits.entries()) await Activity.tick(tabAt(url, title), T0 + secs(30 * at));
        eq(dayRecord().top.seconds, 60, 'the two were added together, or the fragment started a new visit');
    });

    await checkAsync('time lands in the hour it happened in', async () => {
        reset();
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0);
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0 + secs(30));
        const day = dayRecord();
        eq(day.hours.length, 24);
        eq(day.hours[new Date(T0).getHours()], 30);
        eq(day.hours.reduce((a, b) => a + b, 0), day.total);
    });

    await checkAsync('a gap across midnight is cut there, each side filed under its own day and hour', async () => {
        // It was filed whole under the day and the hour it started in.
        reset();
        const beforeMidnight = new Date(2026, 6, 15, 23, 59, 50).getTime();
        await Activity.tick(tabAt('https://a.test/x', 'X'), beforeMidnight);
        await Activity.tick(tabAt('https://a.test/x', 'X'), beforeMidnight + secs(30));
        await Activity.tick(tabAt('https://b.test/', 'B'), beforeMidnight + secs(40));
        eq(storedDays(), ['2026-07-15', '2026-07-16']);
        const [before, after] = ['2026-07-15', '2026-07-16'].map((day) => store[Activity.dayStore(day)]);
        eq([before.total, before.hours[23], before.hosts['a.test']], [10, 10, 10]);
        eq([after.total, after.hours[0], after.hosts['a.test']], [30, 30, 30]);
        eq([before.top.seconds, after.top.seconds], [10, 30], 'a visit is the day’s it was spent in');
    });
    await checkAsync('a gap across the hour is cut there too', async () => {
        reset();
        const at = new Date(2026, 6, 15, 9, 59, 45).getTime();
        await Activity.tick(tabAt('https://a.test/x', 'X'), at);
        await Activity.tick(tabAt('https://a.test/x', 'X'), at + secs(45));
        const day = store[Activity.dayStore('2026-07-15')];
        eq([day.hours[9], day.hours[10], day.total], [15, 30, 45]);
    });
    await checkAsync('a blur landing in the middle of a tick is not written over by it', async () => {
        // The tick wrote its reading after the blur had cleared it, and the
        // clock ran on into the next tick.
        reset();
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0);
        await Promise.all([Activity.tick(tabAt('https://a.test/x', 'X'), T0 + secs(30)), Activity.blur()]);
        eq(store[Activity.LAST_KEY], null, 'the tick’s reading was written over the blur');
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0 + secs(60));
        eq(dayRecord().total, 30, 'the half minute after the blur was counted');
    });
    await checkAsync('a clear while a tick is under way leaves nothing behind it', async () => {
        reset();
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0);
        const ticking = Activity.tick(tabAt('https://a.test/x', 'X'), T0 + secs(30));
        await Promise.all([ticking, Activity.clear()]);
        eq([storedDays(), store[Activity.DAYS_KEY]], [[], undefined]);
    });

    await checkAsync('a day is the local one at both ends of it, and its hours agree', async () => {
        // The key was UTC and the hours local: east of Greenwich the first
        // hours of a day were filed under yesterday, west of it the last
        // hours under tomorrow. Either way round fails somewhere off UTC.
        for (const at of [new Date(2026, 6, 15, 0, 10).getTime(), new Date(2026, 6, 15, 23, 50).getTime()]) {
            reset();
            await Activity.tick(tabAt('https://a.test/x', 'X'), at);
            await Activity.tick(tabAt('https://a.test/x', 'X'), at + secs(20));
            eq(storedDays(), ['2026-07-15'], new Date(at).toString());
            eq(store[Activity.dayStore('2026-07-15')].hours[new Date(at).getHours()], 20);
        }
    });
    check('hosts: one normalizer, one walk up the domain, one host of a URL', () => {
    // The cookie list and the limit list each had their own of the first
    // two, and the worker three of the last.
    const Hosts = require('../src/shared/hosts.js');
    eq(['WWW.Example.com.', 'https://www.example.com/a?b', 'example.com'].map(Hosts.normalize), ['example.com', 'example.com', 'example.com']);
    const map = { 'example.com': { v: 1 }, com: { v: 2 } };
    eq([Hosts.lookup(map, 'docs.example.com'), Hosts.lookup(map, 'other.com')], [{ host: 'example.com', v: 1 }, null], 'never a bare TLD');
    eq(['https://www.x.com/home', 'chrome://newtab/', '', undefined].map(Hosts.of), ['x.com', 'newtab', '', '']);
    const [Cookies, Limits] = [require('../src/shared/cookie-sites.js'), require('../src/shared/limit-sites.js')];
    eq([Cookies.normalizeHost === Hosts.normalize, Limits.normalizeHost === Hosts.normalize], [true, true]);
});
check('a selector table takes the first spelling that matches, and steps over one the browser refuses', () => {
    // Six files kept their own copy of these three; some threw on a spelling
    // the browser would not parse, and only two could ask for one drawn.
    const Selectors = require('../src/shared/selectors.js');
    const hidden = { id: 'hidden', getClientRects: () => [] };
    const drawn = { id: 'drawn', getClientRects: () => [{}] };
    const page = {
        '.new': [], ':bad(': null, '.old': [hidden, drawn], '.older': [drawn],
    };
    const ask = (selector) => {
        if (page[selector] === null) throw new SyntaxError(`'${selector}' is not a valid selector`);
        return page[selector] || [];
    };
    const scope = { querySelector: (s) => ask(s)[0] || null, querySelectorAll: (s) => ask(s) };
    const { find, findAll, closest } = Selectors.table({ row: ['.new', ':bad(', '.old', '.older'] });
    eq(find('row', scope).id, 'hidden', 'the first spelling with any match, first match');
    eq(find('row', scope, { visible: true }).id, 'drawn');
    eq(findAll('row', scope).map((one) => one.id), ['hidden', 'drawn'], 'only the first spelling that hits');
    eq([find('nothing', scope), findAll('nothing', scope)], [null, []]);
    const element = { closest: (s) => (s === '.older' ? drawn : ask(s) && null) };
    eq(closest('row', element).id, 'drawn');
});
check('a streak across the night the clocks go forward is not broken by it', () => {
    // A day back was once 24 hours back, and the night the clocks change has
    // 23, so a streak ended for nothing. TZ is put back by name: deleting it
    // does not restore the machine's own zone.
    const zone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = 'America/New_York';
    try {
        const after = new Date(2026, 2, 9, 0, 30).getTime(); // the night after 8 March, which had 23 hours
        const days = { '2026-03-09': { n: 1 }, '2026-03-08': { n: 1 }, '2026-03-07': { n: 1 } };
        eq(Time.runOfDays(days, (bucket) => bucket.n, after), 3);
        eq(Object.keys(Time.keepDays(days, 2, (bucket) => bucket, after)), ['2026-03-09', '2026-03-08'], 'today and one day more');
    } finally {
        process.env.TZ = zone;
    }
});
check('one duration, in the three shapes the views draw', () => {
    const at = (style) => [42, 125, 720, 3725, 3570, 7170].map((s) => Time.duration(s, style));
    eq(at('clock'), ['42s', '2m 05s', '12m 00s', '1h 02m', '59m 30s', '1h 59m']);
    eq(at('short'), ['42s', '2m', '12m', '1h 02m', '59m', '1h 59m']);
    eq(at('loose'), ['42s', '2m', '12m', '1h 2m', '1h', '2h'], 'a rounded-up minute carries into the hour');
    eq([Activity.human(0), Activity.human(3720)], ['0m', '1h 2m'], 'activity keeps its "0m"');
});
check('Time.dayKey names the local day, and walks back by the calendar', () => {
        const justAfterMidnight = new Date(2026, 0, 1, 0, 5).getTime();
        eq([Time.dayKey(justAfterMidnight), Time.dayKey(justAfterMidnight, 1), Time.dayKey(justAfterMidnight, 366)],
            ['2026-01-01', '2025-12-31', '2024-12-31']);
    });

    section('activity — hosts');
    check('www. is stripped', () => {
        eq(Activity.hostOf('https://www.youtube.com/x'), 'youtube.com');
        eq(Activity.hostOf('https://youtube.com/x'), 'youtube.com');
    });
    check('non-http is not a site', () => {
        eq(Activity.hostOf('chrome://extensions'), null);
        eq(Activity.hostOf('about:blank'), null);
        eq(Activity.hostOf(''), null);
        eq(Activity.hostOf('file:///c:/notes.txt'), null);
    });

    section('activity — summary');

    function seed(data, offsetDays, record) {
        const key = Time.dayKey(Date.now(), offsetDays);
        data[key] = Object.assign(
            { total: 0, hours: new Array(24).fill(0), hosts: {}, top: null }, record);
        return data;
    }
    const hoursAt = (hour, seconds) => {
        const hours = new Array(24).fill(0);
        hours[hour] = seconds;
        return hours;
    };

    await checkAsync('sums the requested window only', async () => {
        const data = {};
        seed(data, 0, { total: 100, hosts: { 'a.test': 100 }, hours: hoursAt(9, 100) });
        seed(data, 3, { total: 50, hosts: { 'b.test': 50 }, hours: hoursAt(14, 50) });
        seed(data, 20, { total: 999, hosts: { 'c.test': 999 }, hours: hoursAt(2, 999) });
        reset();
        store[Activity.KEY] = data;

        const week = await Activity.summary(7);
        eq(week.total, 150, 'the 20-day-old day is outside a 7-day window');
        eq(week.sites, 2);
        eq(week.hosts[0].host, 'a.test');
        eq(week.peakHour, 9);
        eq(week.days, 2);

        const month = await Activity.summary(30);
        eq(month.total, 1149);
        eq(month.hosts[0].host, 'c.test');
    });

    await checkAsync('report() answers both windows from one read', async () => {
        const data = {};
        seed(data, 0, { total: 100, hosts: { 'a.test': 100 } });
        seed(data, 8, { total: 40, hosts: { 'b.test': 40 } });
        reset();
        store[Activity.KEY] = data;

        const { now, previousTotal } = await Activity.report(7);
        eq(now.total, 100, 'the last 7 days');
        eq(previousTotal, 40, 'the 7 days before those');
    });

    await checkAsync('the page of the day is only answered for a week back', async () => {
        const data = {};
        seed(data, 2, { total: 60, hosts: { 'a.test': 60 }, top: { title: 'This week', host: 'a.test', seconds: 60 } });
        seed(data, 9, { total: 900, hosts: { 'b.test': 900 }, top: { title: 'Last week', host: 'b.test', seconds: 900 } });
        reset();
        store[Activity.KEY] = data;

        const month = await Activity.summary(30);
        eq(month.total, 960, 'the older day still counts towards the totals');
        eq(month.daily.length, 1, 'but it no longer names a page');
        eq(month.daily[0].title, 'This week');
        eq(month.longest.title, 'This week');
    });

    await checkAsync('report() carries the week the page panel draws', async () => {
        const data = {};
        seed(data, 0, { total: 60, hosts: { 'a.test': 60 }, top: { title: 'Today', host: 'a.test', seconds: 60 } });
        seed(data, 4, { total: 30, hosts: { 'b.test': 30 }, top: { title: 'Midweek', host: 'b.test', seconds: 30 } });
        reset();
        store[Activity.KEY] = data;

        const { now, week } = await Activity.report(1);
        eq(now.days, 1, 'the range on screen is still today');
        eq(week.daily.length, 2, 'the page panel gets the whole week whatever the range');
        eq(week.daily[0].title, 'Today', 'newest day first');
    });

    await checkAsync('a tick drops the page titles that have aged out', async () => {
        const data = {};
        seed(data, 30, { total: 900, hosts: { 'b.test': 900 }, top: { title: 'Ancient', host: 'b.test', seconds: 900 } });
        reset();
        store[Activity.KEY] = data;

        const old = Object.keys(data)[0];
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0);
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0 + secs(30));

        eq(store[Activity.dayStore(old)].top, null, 'the title is gone from storage, not just from the view');
        eq(store[Activity.dayStore(old)].total, 900, 'the day itself is inside the 60-day window and stays');
    });

    await checkAsync('a tick writes the one day it adds to, and the list of days only when a day starts', async () => {
        // Every tick used to write all sixty days back, and every open tab
        // was handed the lot through storage.onChanged.
        const data = {};
        for (const back of [1, 2, 3]) seed(data, back, { total: 60, hosts: { 'b.test': 60 } });
        reset();
        store[Activity.KEY] = data;
        await Activity.summary(7); // the old single value is split on the way

        const writes = [];
        const realSet = global.chrome.storage.local.set;
        global.chrome.storage.local.set = (values, cb) => { writes.push(Object.keys(values).sort()); return realSet(values, cb); };
        try {
            await Activity.tick(tabAt('https://a.test/x', 'X'), T0);
            writes.length = 0;
            await Activity.tick(tabAt('https://a.test/x', 'X'), T0 + secs(30));
            await Activity.tick(tabAt('https://a.test/x', 'X'), T0 + secs(60));
        } finally {
            global.chrome.storage.local.set = realSet;
        }
        const today = Activity.dayStore(Time.dayKey(T0));
        eq(writes.filter((keys) => keys.some((key) => key.startsWith('bb_activity') && key !== Activity.LAST_KEY)),
            [[today, Activity.DAYS_KEY], [today]], 'the day starts, then only the day');
        eq(dayRecord().total, 60);
    });

    await checkAsync('the one-value store of before is split into days, and a day already split is kept', async () => {
        reset();
        const [older, newer] = [Time.dayKey(Date.now(), 3), Time.dayKey(Date.now(), 1)];
        store[Activity.KEY] = {
            [older]: { total: 10, hours: new Array(24).fill(0), hosts: { 'a.test': 10 }, top: null },
            [newer]: { total: 20, hours: new Array(24).fill(0), hosts: { 'a.test': 20 }, top: null },
        };
        store[Activity.dayStore(newer)] = { total: 99, hours: new Array(24).fill(0), hosts: { 'a.test': 99 }, top: null };
        store[Activity.DAYS_KEY] = [newer];
        eq((await Activity.summary(7)).total, 109);
        eq([store[Activity.KEY], storedDays(), store[Activity.DAYS_KEY]], [undefined, [older, newer], [older, newer]]);
    });

    await checkAsync('a new day removes the days that are past keeping', async () => {
        reset();
        const data = {};
        seed(data, Activity.KEEP_DAYS + 5, { total: 5 });
        seed(data, 10, { total: 7 });
        store[Activity.KEY] = data;
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0);
        await Activity.tick(tabAt('https://a.test/x', 'X'), T0 + secs(30));
        eq(storedDays(), [Time.dayKey(Date.now(), 10), Time.dayKey(T0)]);
        eq(store[Activity.DAYS_KEY], storedDays());
        await Activity.clear();
        eq([storedDays(), store[Activity.DAYS_KEY]], [[], undefined]);
    });

    await checkAsync('an empty store summarises to zeroes', async () => {
        reset();
        const summary = await Activity.summary(7);
        eq(summary.total, 0);
        eq(summary.sites, 0);
        eq(summary.days, 0);
        eq(summary.longest, null);
        eq(summary.hosts, []);
    });

    section('activity — formatting');
    check('human() reads the way a person would say it', () => {
        eq([0, 45, 90, 3600, 3720, 7 * 3600 + 1800].map((s) => Activity.human(s)), ['0m', '45s', '2m', '1h', '1h 2m', '7h 30m']);
    });

    section('activity — the heartbeat');
    await checkAsync('a reading with another application in front stops the clock, and one with the browser in front reads its tab', async () => {
        // It read the active tab of the window that had last had focus,
        // which Chrome goes on naming while another program is in front.
        const said = [];
        let alarm = null;
        let win = { focused: false, tabs: [{ active: false, url: 'https://a.test/' }, { active: true, url: 'https://b.test/', title: 'B' }] };
        const chrome = {
            alarms: { get: async () => ({ periodInMinutes: 0.5 }), create() {}, clear: async () => true, onAlarm: { addListener: (fn) => { alarm = fn; } } },
            runtime: {},
            windows: { getLastFocused: async () => win, onFocusChanged: { addListener() {} }, WINDOW_ID_NONE: -1 },
            tabs: { query: async () => win.tabs.filter((tab) => tab.active) },
        };
        const vm = require('vm');
        const sandbox = vm.createContext({ chrome, console, setTimeout, clearTimeout });
        sandbox.self = sandbox.globalThis = sandbox;
        sandbox.BB = {
            Activity: { SETTING: 'trackActivity', tick: async (tab) => said.push(['tick', tab && tab.url]), blur: async () => said.push(['blur']) },
            Settings: { get: async () => ({ trackActivity: true }), watch() {} },
        };
        for (const file of ['src/background/router.js', 'src/background/activity-heartbeat.js']) vm.runInContext(readRepo(file), sandbox, { filename: file });
        const fire = () => { alarm({ name: sandbox.BB.ActivityHeartbeat.ALARM }); return new Promise((done) => setTimeout(done, 10)); };
        await fire();
        win = { ...win, focused: true };
        await fire();
        eq(said, [['blur'], ['tick', 'https://b.test/']]);
    });

    section('feed — whose channel is this page?');

    // A channel page names a dozen channels; the resolver once took the first
    // "channelId" in it, a recommendation's, and filled the pouch with strangers.
    const OWN = 'UCHnyfMqiRRG1u-2MsSQLbXA';
    const OTHER = 'UCin0m13qWv3-051xlWlHamA';

    const channelPage = (own, stranger) =>
        '<html><head>' +
        '<link rel="canonical" href="https://www.youtube.com/channel/' + own + '">' +
        '</head><body>' +
        '{"channelId":"' + stranger + '","title":"Recommended for you"}' +
        '{"channelMetadataRenderer":{"externalId":"' + own + '"}}' +
        '</body></html>';

    check('takes the channel the page is about, not the first one it mentions', () => {
        eq(Feed.ownChannelId(channelPage(OWN, OTHER)), OWN);
    });

    check('falls back to the metadata when there is no canonical link', () => {
        // Consent-wall and signed-out variants of the page have dropped it.
        const noLink = channelPage(OWN, OTHER).replace(/<link[^>]*>/, '');
        eq(Feed.ownChannelId(noLink), OWN);
    });

    check('a page carrying nobody but other channels resolves to nothing', () => {
        // No feed is a better answer than confidently the wrong feed.
        eq(Feed.ownChannelId('<html>{"channelId":"' + OTHER + '"}</html>'), null);
        eq(Feed.ownChannelId(''), null);
        eq(Feed.ownChannelId(null), null);
    });

    section('checkpoint ordering');

    const Pins = require('../src/shared/pins.js');

    /** A video entry whose newest checkpoint was saved at `at`. */
    const vid = (id, title, at, count = 1) => ({
        id,
        title,
        url: 'u',
        bookmarks: Array.from({ length: count }, (_, i) =>
            ({ time: i * 10, timestamp: at - (count - 1 - i) * 1000 })),
    });
    const order = (videos, by) => Bookmarks.sortVideos(videos, by).map((v) => v.id);

    check('a checkpoint’s note is listed after the passage it was written on', () => {
        const row = /function renderBookmarkRow[\s\S]*?\n    }\n/.exec(readRepo('dashboard.js'))[0];
        assert(row.indexOf('bookmark-subtitle">') < row.indexOf('bookmark-note">'), 'the note sits above the passage');
    });
    check('newest first, which is not the order the store keeps', () => {
        // The store appends, so an unsorted list opens on the first video ever
        // saved — which is what the popup was showing.
        eq(order([vid('old', 'Old', 1000), vid('new', 'New', 9000)], 'recent'), ['new', 'old']);
    });
    check('a video is dated by its newest checkpoint, not its first', () => {
        eq(order([vid('a', 'A', 5000, 3), vid('b', 'B', 4000, 1)], 'recent'), ['a', 'b']);
    });
    check('checkpoints saved before timestamps existed keep append order', () => {
        const undated = (id) => ({ id, title: id, bookmarks: [{ time: 0 }] });
        eq(order([undated('first'), undated('second'), undated('third')], 'recent'),
            ['third', 'second', 'first']);
    });
    check('the other three orders', () => {
        const videos = [vid('a', 'Zebra', 1000, 5), vid('b', 'Apple', 9000, 1)];
        eq(order(videos, 'oldest'), ['a', 'b']);
        eq(order(videos, 'title'), ['b', 'a']);
        eq(order(videos, 'most'), ['a', 'b']);
    });
    check('sorting leaves the caller’s array alone', () => {
        const videos = [vid('old', 'Old', 1000), vid('new', 'New', 9000)];
        Bookmarks.sortVideos(videos, 'recent');
        eq(videos.map((v) => v.id), ['old', 'new']);
    });

    section('pinning');
    const hoisted = (videos, pins) => Pins.hoist(videos, pins).map((v) => v.id);
    const three = [vid('a', 'A', 3), vid('b', 'B', 2), vid('c', 'C', 1)];

    check('pinned first, most recently pinned at the very top', () => {
        eq(hoisted(three, ['c', 'b']), ['c', 'b', 'a']);
    });
    check('the unpinned keep whatever order the sort gave them', () => {
        eq(hoisted(three, ['b']), ['b', 'a', 'c']);
        eq(hoisted(three, []), ['a', 'b', 'c']);
    });
    check('a pin on a video since deleted is ignored, not a hole in the list', () => {
        eq(hoisted(three, ['gone', 'a']), ['a', 'b', 'c']);
    });
    await checkAsync('toggling pins, then unpins', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        eq(await Pins.toggle('x'), ['x']);
        eq(await Pins.toggle('y'), ['y', 'x'], 'the newest pin goes to the top');
        eq(await Pins.toggle('x'), ['y']);
    });

    section('store');
    const Store = require('../src/shared/store.js');
    const pair = () => Store.create({
        keys: ['sa', 'sb'],
        read: (stored) => ({ a: stored.sa || [], b: stored.sb || [] }),
        write: (state) => ({ sa: state.a, sb: state.b }),
        blank: () => ({ a: [], b: [] }),
        name: 'the pair',
    });
    await checkAsync('steps run one at a time, each reading what the last wrote', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        const one = pair();
        const slow = (n) => (state) => new Promise((resolve) => setTimeout(() => resolve({ ...state, a: [...state.a, n] }), 5));
        await Promise.all([one.update(slow(1)), one.update(slow(2)), one.update(slow(3))]);
        eq(store.sa, [1, 2, 3]);
    });
    await checkAsync('a step writes the keys it changed and leaves the others to whoever moved them', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        store.sa = ['mine'];
        store.sb = ['theirs'];
        const one = pair();
        // Another tab writes sb while this step is between its read and its write.
        await one.update((state) => {
            store.sb = ['theirs', 'since'];
            return { ...state, a: ['mine', 'more'] };
        });
        eq([store.sa, store.sb], [['mine', 'more'], ['theirs', 'since']]);
    });
    await checkAsync('a state changed in place is still written', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        const one = pair();
        await one.update((state) => { state.a.push('x'); });
        eq(store.sa, ['x']);
    });
    await checkAsync('a failed step answers with the fallback, and the next one still runs', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        const one = pair();
        const error = console.error;
        console.error = () => {};
        try {
            eq(await one.update(() => { throw new Error('no'); }), { a: [], b: [] });
        } finally {
            console.error = error;
        }
        eq(await one.update((state) => ({ ...state, b: [1] })), { a: [], b: [1] });
    });
    await checkAsync('a step whose read failed writes nothing, rather than the blank with its change', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        store.sa = ['kept'];
        const one = pair();
        const realGet = global.chrome.storage.local.get;
        global.chrome.storage.local.get = () => Promise.reject(new Error('Extension context invalidated.'));
        const quiet = console.error;
        console.error = () => {};
        try {
            eq(await one.update((state) => ({ ...state, a: [...state.a, 'new'] })), { a: [], b: [] }, 'the fallback');
            eq(await one.load(), { a: [], b: [] }, 'a plain read still falls back');
        } finally {
            global.chrome.storage.local.get = realGet;
            console.error = quiet;
        }
        eq(store.sa, ['kept']);
        eq(await one.update((state) => ({ ...state, a: [...state.a, 'new'] })), { a: ['kept', 'new'], b: [] }, 'the next step runs');
    });
    await checkAsync('a store whose extension was reloaded falls back without an error; any other failure says so', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        const one = pair();
        const said = [];
        const [realGet, realSet, error] = [global.chrome.storage.local.get, global.chrome.storage.local.set, console.error];
        console.error = (...args) => said.push(String(args[0]));
        try {
            global.chrome.storage.local.get = () => Promise.reject(new Error('Extension context invalidated.'));
            eq(await one.update((state) => state), { a: [], b: [] }, 'the fallback');
            global.chrome.storage.local.set = () => Promise.reject(new Error('Extension context invalidated.'));
            await one.save({ a: [1], b: [] });
            eq(said, [], 'a page left open across a reload is not an error');

            // The runtime losing its id says the same, whatever the message.
            global.chrome.runtime = {};
            global.chrome.storage.local.get = () => Promise.reject(new Error('Cannot read properties of undefined'));
            await one.update((state) => state);
            eq(said, [], 'an orphaned script went on saying so');
            delete global.chrome.runtime;

            global.chrome.storage.local.get = realGet;
            global.chrome.storage.local.set = realSet;
            eq(await one.update(() => { throw new Error('no'); }), { a: [], b: [] });
            eq(said, ['Bell Bearer: could not update the pair'], 'a real failure went unreported');
        } finally {
            Object.assign(global.chrome.storage.local, { get: realGet, set: realSet });
            delete global.chrome.runtime;
            console.error = error;
        }
    });

    await checkAsync('a write that fails says so, where update() alone answers with a state either way', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        const one = pair();
        const [set, error] = [global.chrome.storage.local.set, console.error];
        global.chrome.storage.local.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
        console.error = () => {};
        try {
            const failed = await one.commit((state) => ({ ...state, a: ['lost'] }));
            eq([failed.ok, failed.state], [false, { a: [], b: [] }]);
            eq(await one.save({ a: ['lost'], b: [] }), false);
        } finally {
            Object.assign(global.chrome.storage.local, { set });
            console.error = error;
        }
        eq(await one.commit((state) => ({ ...state, a: ['kept'] })), { ok: true, state: { a: ['kept'], b: [] } });
        eq(await one.save({ a: [], b: [] }), true);
    });
    await checkAsync('a segment the store could not write is not announced as saved', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        const Checkpoints = require('../src/content/checkpoints.js');
        const said = [];
        let at = 10;
        const recorder = Checkpoints.createRecorder({
            player: { currentTime: () => at }, notify: (text, kind) => said.push(kind),
            getVideo: () => ({ id: 'vid00000001', title: 'A talk', url: 'https://youtu.be/vid00000001' }),
            transcripts: { textInRange: async () => 'what was said' },
        });
        const [set, error] = [global.chrome.storage.local.set, console.error];
        global.chrome.storage.local.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
        console.error = () => {};
        try {
            recorder.toggleSegment();
            at = 20;
            recorder.toggleSegment();
            await new Promise((done) => setTimeout(done, 20));
        } finally {
            Object.assign(global.chrome.storage.local, { set });
            console.error = error;
        }
        eq(said, ['info', 'error'], 'a checkpoint that never reached storage was said to be saved');
    });

    const StoreLocks = require('../src/background/store-locks.js');
    /** A runtime port's two ends, each delivering to the other a task later, as Chrome's do. */
    function portPair(name) {
        const end = () => ({ name, heard: [], gone: [], onMessage: {}, onDisconnect: {} });
        const [a, b] = [end(), end()];
        let open = true;
        for (const [from, to] of [[a, b], [b, a]]) {
            from.onMessage.addListener = (fn) => from.heard.push(fn);
            from.onDisconnect.addListener = (fn) => from.gone.push(fn);
            from.postMessage = (msg) => {
                if (!open) throw new Error('Attempting to use a disconnected port object');
                setTimeout(() => to.heard.forEach((fn) => fn(msg)), 0);
            };
            from.disconnect = () => {
                if (!open) return;
                open = false;
                setTimeout(() => to.gone.forEach((fn) => fn()), 0);
            };
        }
        return [a, b];
    }
    const portTurn = () => new Promise((done) => setTimeout(done, 5));
    await checkAsync('two pages changing one store at once both land, each holding the worker’s lock in turn', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        const locks = StoreLocks.createLocks();
        global.chrome.runtime = {
            id: 'bb',
            connect: ({ name }) => {
                const [page, worker] = portPair(name);
                locks.connect(worker);
                return page;
            },
        };
        try {
            // Two tabs: a chain each, so the lock is all that keeps their steps apart.
            const [one, two] = [pair(), pair()];
            const slow = (n) => (state) => new Promise((resolve) => setTimeout(() => resolve({ ...state, a: [...state.a, n] }), 10));
            await Promise.all([one.update(slow(1)), two.update(slow(2))]);
            eq(store.sa.slice().sort(), [1, 2], 'one tab’s change was written over');
            await portTurn();
            eq([locks.holding(), locks.queued()], [[], 0], 'a lock outlived its step');
        } finally {
            delete global.chrome.runtime;
        }
    });
    await checkAsync('a page that goes away lets go of its lock, and one stuck holding it is let go of in the end', async () => {
        let lapse = null;
        const locks = StoreLocks.createLocks({ setTimer: (fn) => { lapse = fn; return 1; }, clearTimer: () => {} });
        const [page, worker] = portPair(Store.LOCK_PORT);
        locks.connect(worker);
        page.postMessage({ names: ['sa'] });
        await portTurn();
        eq(locks.holding(), ['sa']);
        const order = [];
        const next = locks.acquire(['sa', 'sb']).then((go) => { order.push('two keys'); return go; });
        const later = locks.acquire(['sb']).then((go) => { order.push('behind it'); go(); });
        await portTurn();
        eq(order, [], 'a step on sb went ahead of an earlier one waiting on sa and sb');
        page.disconnect();
        (await next)();
        await later;
        eq(order, ['two keys', 'behind it']);

        const stuck = await locks.acquire(['sa']);
        let waited = false;
        const after = locks.acquire(['sa']).then((go) => { waited = true; go(); });
        lapse();
        await after;
        assert(waited, 'a holder that never let go held the key for good');
        stuck();
        eq(locks.holding(), []);
    });

    section('playlist ids');
    check('a real playlist is picked out of either URL form', () => {
        eq(YouTube.extractPlaylistId('https://www.youtube.com/watch?v=abc&list=PLabc123'), 'PLabc123');
        eq(YouTube.extractPlaylistId('https://www.youtube.com/playlist?list=PLabc123'), 'PLabc123');
    });
    check('an autoplay mix is not something anyone can follow', () => {
        // RD/UL/TL ids are generated per viewer and have no RSS feed at all,
        // so offering to follow one would be offering to follow nothing.
        eq(YouTube.extractPlaylistId('https://www.youtube.com/watch?v=a&list=RDabc'), null);
        eq(YouTube.extractPlaylistId('https://www.youtube.com/watch?v=a&list=WL'), null);
        eq(YouTube.extractPlaylistId('https://www.youtube.com/watch?v=a'), null);
    });

    section('feed — fetching a large pouch');
    await checkAsync('never opens more than MAX_PARALLEL at once', async () => {
        let running = 0;
        let peak = 0;
        const out = await Feed.mapLimit(Array.from({ length: 40 }, (_, i) => i),
            Feed.MAX_PARALLEL, async (n) => {
                peak = Math.max(peak, ++running);
                await new Promise((r) => setTimeout(r, 1));
                running--;
                return n;
            });

        if (peak > Feed.MAX_PARALLEL) throw new Error('peaked at ' + peak + ' in flight');
        if (peak < 2) throw new Error('it must still be concurrent, peaked at ' + peak);
        eq(out.slice(0, 4), [0, 1, 2, 3], 'results come back in input order');
    });

    section('reading the account’s own subscriptions');

    const YtSubs = require('../src/shared/yt-subs.js');

    /** A stand-in /feed/channels document, shaped the way YouTube ships one. */
    const subsPage = (channels, alsoMentioned) =>
        '<script>var ytInitialData = ' + JSON.stringify({
            contents: {
                sectionListRenderer: {
                    contents: channels.map((entry) => ({
                        channelRenderer: {
                            channelId: entry.id,
                            title: { simpleText: entry.name },
                            navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: entry.handle } },
                        },
                    })),
                },
            },
            ...(alsoMentioned || {}),
        }) + ';</script>';

    const uc = (ch) => 'UC' + ch.repeat(22);

    check('pulls out every subscribed channel, with its handle URL', () => {
        const found = YtSubs.parseSubscriptionsPage(subsPage([
            { id: uc('a'), name: 'First', handle: '/@first' },
            { id: uc('b'), name: 'Second', handle: '/@second' },
        ]));
        eq(found.length, 2);
        eq(found[0].name, 'First');
        eq(found[0].id, uc('a'));
        eq(found[0].url, 'https://www.youtube.com/@first');
    });

    check('ignores channel ids the page merely mentions', () => {
        // The page names channels it is not listing (the viewer's own, a
        // shelf's), so it walks the grid's renderers rather than regex the page.
        const found = YtSubs.parseSubscriptionsPage(subsPage(
            [{ id: uc('a'), name: 'Subscribed', handle: '/@sub' }],
            {
                masthead: { channelId: uc('z') },
                shelf: { videoRenderer: { channelId: uc('y') } },
            }));
        eq(found.map((c) => c.name), ['Subscribed']);
    });

    check('a title written as runs reads the same as a simpleText one', () => {
        const html = '<script>var ytInitialData = ' + JSON.stringify({
            gridChannelRenderer: {
                channelId: uc('c'),
                title: { runs: [{ text: 'Split ' }, { text: 'Name' }] },
            },
        }) + ';</script>';
        eq(YtSubs.parseSubscriptionsPage(html)[0].name, 'Split Name');
    });

    check('braces inside a channel name do not end the object early', () => {
        // This name closes the JSON if the extractor counts braces without
        // knowing when it is inside a string literal.
        const html = '<script>var ytInitialData = ' + JSON.stringify({
            channelRenderer: { channelId: uc('d'), title: { simpleText: 'The } Channel {' } },
        }) + ';</script>';
        const found = YtSubs.parseSubscriptionsPage(html);
        eq(found.length, 1);
        eq(found[0].name, 'The } Channel {');
    });

    check('a page with nothing readable in it is an empty list, not a crash', () => {
        eq(YtSubs.parseSubscriptionsPage('<html>signed out</html>'), []);
        eq(YtSubs.parseSubscriptionsPage('var ytInitialData = {broken'), []);
        eq(YtSubs.parseSubscriptionsPage(''), []);
    });

    section('following a playlist');

    const Playlists = require('../src/shared/playlists.js');

    /** A Feed stand-in: the playlist holds v1 and v2, newest first. */
    const twoEntries = {
        fetchPlaylistVideos: async () => [
            { id: 'v2', title: 'Two', published: 2 },
            { id: 'v1', title: 'One', published: 1 },
        ],
    };

    await checkAsync('what a playlist already holds is never reported as new', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        await Playlists.add({ id: 'PLone', title: 'Course', videoIds: ['v1', 'v2'] });
        eq(await Playlists.newEntries(await Playlists.load(), twoEntries), [],
            'following a two-hundred-entry playlist must not announce all two hundred');
    });

    await checkAsync('an entry added later is new, and stops being new once seen', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        await Playlists.add({ id: 'PLone', title: 'Course', videoIds: ['v1'] });

        let entries = await Playlists.newEntries(await Playlists.load(), twoEntries);
        eq(entries.map((e) => e.id), ['v2']);
        eq(entries[0].playlistTitle, 'Course');

        await Playlists.markAllSeen(entries);
        eq(await Playlists.newEntries(await Playlists.load(), twoEntries), []);
    });

    await checkAsync('following one already followed renames it rather than duplicating', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        await Playlists.add({ id: 'PLone', title: 'Old name', videoIds: [] });
        await Playlists.add({ id: 'PLone', title: 'New name', videoIds: [] });

        const stored = await Playlists.load();
        eq(stored.length, 1);
        eq(stored[0].title, 'New name');
        eq(Playlists.has(stored, 'PLone'), true);
    });

    // ------------------------------------------------------------ palette

    section('palette');

    const Palette = require('../src/shared/palette.js');

    check('hex colors convert to rgba, short form included', () => {
        eq(Palette.rgba('#1c9bef', 0.5), 'rgba(28, 155, 239, 0.5)');
        eq(Palette.rgba('#fff'), 'rgba(255, 255, 255, 1)');
    });
    check('anything that is not a hex color is refused, not guessed at', () => {
        eq(Palette.isHex('red'), false);
        eq(Palette.isHex('#12345'), false);
        eq(Palette.rgba('javascript:1'), '');
    });
    check('readable text color flips on light and dark swatches', () => {
        eq(Palette.readableOn('#f2b705'), '#000000');
        eq(Palette.readableOn('#212529'), '#ffffff');
    });

    // ------------------------------------------------------- cookie sites

    section('remembered cookie sites');

    const CookieSites = require('../src/shared/cookie-sites.js');
    const clearStore = () => Object.keys(store).forEach((k) => delete store[k]);

    check('a remembered site covers its subdomains, and www is the same site', () => {
        const sites = { 'vulkan.org': { decision: 'accept', savedAt: 1 } };
        eq(CookieSites.match(sites, 'docs.vulkan.org').host, 'vulkan.org');
        eq(CookieSites.match(sites, 'www.vulkan.org').host, 'vulkan.org');
        eq(CookieSites.match(sites, 'notvulkan.org'), null);
    });
    check('a bare top-level domain never matches everything under it', () => {
        eq(CookieSites.match({ org: { decision: 'accept' } }, 'docs.vulkan.org'), null);
    });

    await checkAsync('remember and forget round-trip through storage', async () => {
        clearStore();
        await CookieSites.remember('www.docs.vulkan.org', 'accept', 42);
        eq(await CookieSites.load(), { 'docs.vulkan.org': { decision: 'accept', savedAt: 42 } });
        await CookieSites.forget('docs.vulkan.org');
        eq(await CookieSites.load(), {});
    });
    /** Run `fn` with reads that hand back copies, as Chrome's do; the stand-in above hands back what it holds. */
    async function withCopiedReads(fn) {
        const get = global.chrome.storage.local.get;
        global.chrome.storage.local.get = async (keys) => structuredClone(await get(keys));
        try { return await fn(); } finally { global.chrome.storage.local.get = get; }
    }
    await checkAsync('a site remembered while another is forgotten keeps both changes', () => withCopiedReads(async () => {
        // Each read the list and wrote it back on its own; the later write won.
        clearStore();
        await CookieSites.remember('old.test', 'accept', 1);
        await Promise.all([CookieSites.remember('new.test', 'decline', 2), CookieSites.forget('old.test')]);
        eq(await CookieSites.load(), { 'new.test': { decision: 'decline', savedAt: 2 } });
    }));

    await checkAsync('a page with no answer remembered and both chips off is not watched at all', async () => {
        // The observer used to go up on every page for twenty seconds,
        // because install ran before the settings mirror had been read.
        const CookieBanner = require('../src/content/cookie-banner.js');
        const saved = { document: globalThis.document, MutationObserver: globalThis.MutationObserver };
        let watched = 0;
        globalThis.document = { documentElement: {}, querySelectorAll: () => [] };
        globalThis.MutationObserver = class { observe() { watched++; } disconnect() {} };
        const banners = [];
        const make = (chips, hostname) => {
            const banner = CookieBanner.createCookieBanner({
                CookieSites, notify() {}, showAccept: () => chips, showReject: () => chips, chipsOn: async () => chips, hostname,
            });
            banners.push(banner);
            return banner.install();
        };
        try {
            clearStore();
            await make(false, 'plain.example');
            eq(watched, 0, 'nothing to press and nothing to offer');
            await CookieSites.remember('remembered.example', 'decline', 1);
            await make(false, 'www.remembered.example');
            eq(watched, 1, 'a remembered answer still gets pressed');
            await make(true, 'plain.example');
            eq(watched, 2, 'a chip to offer');
        } finally {
            banners.forEach((banner) => banner.stop());
            Object.assign(globalThis, saved);
        }
    });

    await checkAsync('a site remembered as rejected keeps that answer', async () => {
        clearStore();
        await CookieSites.remember('example.com', 'decline', 7);
        eq(CookieSites.match(await CookieSites.load(), 'shop.example.com').decision, 'decline');
    });

    // ------------------------------------------------------------ backup

    section('export / import');

    const Backup = require('../src/shared/backup.js');

    check('an export carries settings and data, never the caches', () => {
        const file = Backup.build({
            skin: 'deco',
            shortcuts: { 'speed-up': { enabled: false } },
            bbCookieSites: { 'a.com': { decision: 'accept' } },
            bbFeedCache: { huge: true },
            bbChessArchiveCache: { huge: true },
            'bbChessArchive:2026/09': { huge: true },
        }, 0);
        eq(Object.keys(file.data).sort(), ['bbCookieSites', 'shortcuts', 'skin']);
        eq(Backup.validate(file), true);
        eq(Backup.validate({ type: 'bell-bearer-checkpoints', data: {} }), false);
    });

    check('an export leaves out every cache and what is only true here and now, and keeps activity', () => {
        // The list was backup.js's own and had missed the subscriptions and
        // LeetCode caches, and exported a roster job in flight.
        const Settings = require('../src/shared/settings.js');
        const store = { skin: 'deco', bb_activity_last: { at: 1 }, 'bb_activity:2026-07-15': { total: 5 }, bb_activity_days: ['2026-07-15'] };
        for (const key of [...Settings.CACHES, ...Settings.TRANSIENT]) store[key] = { gone: true };
        eq(Object.keys(Backup.build(store, 0).data).sort(), ['bb_activity:2026-07-15', 'bb_activity_days', 'skin']);
        for (const key of [Settings.DATA.subscribed, Settings.DATA.leetCalendar, Settings.DATA.rosterJob, Settings.DATA.chatPanel]) {
            assert(Backup.EXCLUDED.has(key), key);
        }
    });
    await checkAsync('an import restores only keys Bell Bearer writes', async () => {
        clearStore();
        const { written } = await Backup.importAll({ type: Backup.TYPE, version: 1, data: {
            skin: 'riso', youtubeBookmarks: [], bb_activity: { '2026-07-15': { total: 1 } }, 'bb_activity:2026-07-16': { total: 2 },
            somethingElse: 'x', __proto__junk: 1, bbPartyTab: { tabId: 1 },
        } });
        eq(written, 4);
        eq(Object.keys(store).sort(), ['bb_activity', 'bb_activity:2026-07-16', 'skin', 'youtubeBookmarks']);
    });
    check('the activity store\'s keys are named in the schema, like every other store\'s', () => {
        // They were the only data keys kept outside Settings.DATA, so the
        // backup had to keep its own copy of the names.
        const { DATA, TRANSIENT } = require('../src/shared/settings.js');
        eq([Activity.KEY, Activity.DAYS_KEY, Activity.DAY_PREFIX, Activity.LAST_KEY],
            [DATA.activityLegacy, DATA.activityDays, DATA.activityDay, DATA.activityLast]);
        assert(TRANSIENT.includes(DATA.activityLast), 'the last reading is this machine\'s, now');
        assert(Backup.known('bb_activity:2026-07-15') && Backup.known(DATA.activityDays));
    });

    await checkAsync('importing writes the file back, still without caches', async () => {
        clearStore();
        store.skin = 'default';
        await Backup.importAll({ type: Backup.TYPE, version: 1, data: { skin: 'riso', bbFeedCache: { stale: true } } });
        eq(store.skin, 'riso');
        eq(store.bbFeedCache, undefined);
    });

    await checkAsync('a file from a newer version, or with a value of the wrong kind, writes nothing and says why', async () => {
        clearStore();
        store.skin = 'default';
        const file = (data, version = 1) => ({ type: Backup.TYPE, version, exportedAt: '2026-10-01T00:00:00.000Z', data });
        const refused = async (one) => {
            try { await Backup.importAll(one); } catch (error) { return error.message; }
            return null;
        };
        assert(/newer/.test(await refused(file({ skin: 'riso' }, 999))), 'version 999 was imported');
        assert(/version/.test(await refused(file({ skin: 'riso' }, 'one'))), 'a version that is no number');
        assert(/sitesOff/.test(await refused(file({ skin: 'riso', sitesOff: 'youtube' }))), 'a string for the list of sites off');
        for (const data of [{ chessLimitBlitz: 'six' }, { chessLimitBlitz: Infinity }, { trackActivity: 'yes' }, { shortcuts: [] },
            { youtubeBookmarks: {} }, { bbCookieSites: [] }, { 'bb_activity:2026-07-15': 5 }, { bbPromptQueue: 'x' }]) {
            eq(Backup.validate(file(data)), false, JSON.stringify(data));
        }
        eq(store.skin, 'default', 'a refused file changed something');
        eq(Backup.problem(file({ skin: 'riso', youtubeBookmarks: [], bbRosterJob: 'transient, so ignored', unknown: 1, bbTrials: null })), null);
    });
    await checkAsync('replacing leaves the file and nothing else; merging keeps what the file does not have', async () => {
        const file = { type: Backup.TYPE, version: 1, data: { skin: 'riso', youtubeBookmarks: [] } };
        const profile = () => {
            clearStore();
            Object.assign(store, { skin: 'deco', theme: 'dark', bbCookieSites: { 'a.test': { decision: 'accept' } }, 'bb_activity:2026-07-15': { total: 5 }, bbFeedCache: { kept: true } });
        };
        profile();
        eq(await Backup.importAll(file, { mode: 'replace' }), { written: 2, removed: 3 });
        eq(Object.keys(store).sort(), ['bbFeedCache', 'skin', 'youtubeBookmarks'], 'a cache is not the profile’s, and stays');
        profile();
        eq(await Backup.importAll(file, { mode: 'merge' }), { written: 2, removed: 0 });
        eq([store.skin, store.theme, Object.keys(store.bbCookieSites)], ['riso', 'dark', ['a.test']]);
    });
    await checkAsync('an import whose write fails puts back what was there', async () => {
        clearStore();
        Object.assign(store, { skin: 'deco', bbCookieSites: { 'a.test': { decision: 'accept' } } });
        const remove = global.chrome.storage.local.remove;
        // The file's keys go in; taking the rest away fails.
        global.chrome.storage.local.remove = (keys) => (keys.includes('bbCookieSites') ? Promise.reject(new Error('IO error')) : remove(keys));
        let thrown = null;
        try {
            await Backup.importAll({ type: Backup.TYPE, version: 1, data: { skin: 'riso', theme: 'dark' } }, { mode: 'replace' });
        } catch (error) {
            thrown = error.message;
        } finally {
            global.chrome.storage.local.remove = remove;
        }
        eq(thrown, 'IO error');
        eq(store, { skin: 'deco', bbCookieSites: { 'a.test': { decision: 'accept' } } });
    });
    await checkAsync('a restored prompt queue sends nothing until each prompt is sent by hand', async () => {
        clearStore();
        const PromptQueue = require('../src/shared/prompt-queue.js');
        const item = (id, status, extra = {}) => ({ id, site: 'chatgpt', conv: 'c1', chain: 'pc_1', text: id, status, createdAt: Date.now(), ...extra });
        await Backup.importAll({ type: Backup.TYPE, version: 1, data: { bbPromptQueue: {
            items: [item('now', 'waiting'), item('later', 'waiting', { notBefore: Date.now() + 3600e3 }), item('mid', 'sending'), item('done', 'sent', { sentAt: Date.now() })],
            leases: { 'chatgpt:c1': { by: 'a page on another machine', until: Date.now() + 60e3 } },
            holds: { chatgpt: { until: Date.now() + 60e3 } },
            paused: {},
        } } });
        const queue = await PromptQueue.load();
        eq(queue.items.map((one) => one.status), ['held', 'held', 'held', 'sent']);
        eq(queue.items[0].note, Backup.RESTORED_NOTE);
        eq([queue.leases, queue.holds], [{}, {}]);
        eq(PromptQueue.next(queue, 'chatgpt', 'c1', Date.now() + 7200e3), null, 'something would send by itself');
        eq(PromptQueue.due(queue, Date.now() + 7200e3), [], 'the worker would wake a tab for it');
    });
    check('every data key a backup carries has a shape to be checked against', () => {
        const { DATA } = require('../src/shared/settings.js');
        const carried = Object.values(DATA).filter((key) => !Backup.EXCLUDED.has(key) && !Backup.EXCLUDED_PREFIXES.includes(key) && key !== DATA.activityDay);
        eq(carried.filter((key) => !(key in Backup.DATA_SHAPES)), [], 'a new store needs its shape in backup.js');
    });

    // --------------------------------------------------------- shortcuts

    section('keyboard shortcuts');

    const Keybindings = require('../src/shared/keybindings.js');
    const Shortcuts = require('../src/content/shortcuts.js');
    const press = (code, { key = code, ctrl = false, shift = false, alt = false, meta = false, repeat = false } = {}) =>
        ({ code, key, ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta, repeat });
    const claimed = (overrides, event) => Shortcuts.createBindings({}, {
        canRecord: () => true,
        getShortcut: (id) => Keybindings.resolve(overrides, id),
    }).filter((binding) => binding.match(event)).map((binding) => binding.name);

    check('the defaults are what they always were', () => {
        eq(claimed({}, press('KeyB', { ctrl: true, key: 'b' })), ['record-checkpoint']);
        eq(claimed({}, press('Digit5', { alt: true })), ['skip-forward']);
        eq(claimed({}, press('Period', { shift: true, key: '>' })), ['speed-up']);
        eq(claimed({}, press('NumpadAdd', { key: '+' })), ['speed-reset']);
    });

    check('each default combination is claimed by exactly one binding', () => {
        for (const event of [
            press('Digit3', { alt: true }), press('Digit3', { shift: true, key: '#' }), press('Digit3', { ctrl: true, shift: true, key: '#' }),
            press('Period', { shift: true, key: '>' }), press('Comma', { shift: true, key: '<' }), press('Equal', { shift: true, key: '+' }),
            press('KeyB', { ctrl: true, key: 'b' }), press('KeyS', { ctrl: true, shift: true, key: 'S' }),
        ]) {
            eq(claimed({}, event).length, 1, `${event.code} claimed by ${claimed({}, event)}`);
        }
    });

    check('digits: Alt skips forward, Shift back, Ctrl+Shift boosts; the numpad counts and 0 does not', () => {
        eq(claimed({}, press('Digit5', { shift: true, key: '%' })), ['skip-backward']);
        eq(claimed({}, press('Digit4', { ctrl: true, shift: true, key: '$' })), ['speed-boost']);
        eq(claimed({}, press('Numpad7', { alt: true })), ['skip-forward']);
        eq(claimed({}, press('Digit0', { alt: true })), []);
        eq([{ code: 'Digit1' }, { code: 'Numpad9' }, { code: 'Digit0' }, { code: 'KeyA' }, {}].map((event) => Shortcuts.digitOf(event)),
            [1, 9, null, null, null]);
    });

    check('speed keys match by physical key as well as character; Command and auto-repeat are never ours', () => {
        // On layouts where Shift+. is not ">", the code still identifies it.
        eq(claimed({}, press('Period', { shift: true, key: ':' })), ['speed-up']);
        eq(claimed({}, press('Comma', { shift: true, key: '<' })), ['speed-down']);
        eq(claimed({}, press('Period', { shift: true, meta: true, key: '>' })), []);
        eq(claimed({}, press('KeyB', { meta: true, key: 'b' })), []);
        eq(claimed({}, press('KeyB', { ctrl: true, key: 'b', repeat: true })), [], 'a held key restarted a recording');
    });

    check('no two default shortcuts share keys', () => {
        const seen = new Map();
        for (const binding of Keybindings.BINDINGS) {
            const signature = Keybindings.signature(binding.combo, binding.kind);
            eq(seen.get(signature), undefined, `${binding.id} vs ${seen.get(signature)}`);
            seen.set(signature, binding.id);
        }
    });

    check('a shortcut turned off claims nothing', () => {
        eq(claimed({ 'skip-forward': { enabled: false } }, press('Digit5', { alt: true })), []);
    });

    check('a shortcut for a feature that is off is not listed at all', () => {
        const ids = (settings) => Keybindings.list(null, 'general', settings).map((b) => b.id);
        eq(ids({ skimMode: false, linkHints: false }), ['copy-markdown-link', 'copy-page-link', 'reader-mode'],
            'the bare-Shift keys are nobody else\'s until Settings asks for them');
        eq(ids({ skimMode: true, linkHints: false }),
            ['skim-find', 'skim-history', 'skim-actions', 'copy-markdown-link', 'copy-page-link', 'reader-mode']);
        eq(ids({ skimMode: true, linkHints: true }).includes('link-hints'), true);
        eq(ids({ pouchShortcut: true }).includes('open-pouch'), true);
        eq(ids({ pouchShortcut: false }).includes('open-pouch'), false,
            'Shift+P stays a capital P until the pouch shortcut is asked for');
        eq(ids(null).length, 8, 'with no settings to check against, the table is the whole table');
    });

    check('every feature a binding needs is a setting that exists', () => {
        const Settings = require('../src/shared/settings.js');
        for (const binding of Keybindings.BINDINGS) {
            if (!binding.needs) continue;
            eq(binding.needs in Settings.DEFAULTS, true, `${binding.id} needs ${binding.needs}`);
        }
    });

    check('a rebound shortcut answers its new keys and no longer its old ones', () => {
        const overrides = { 'record-checkpoint': { combo: { alt: true, code: 'KeyK', key: 'k' } } };
        eq(claimed(overrides, press('KeyK', { alt: true, key: 'k' })), ['record-checkpoint']);
        eq(claimed(overrides, press('KeyB', { ctrl: true, key: 'b' })), []);
    });

    check('recording a combo: modifiers alone wait, digits need a modifier', () => {
        eq(Keybindings.record(press('ShiftLeft', { key: 'Shift', shift: true }), 'key'), { pending: true });
        eq(Keybindings.record(press('KeyJ', { ctrl: true, key: 'j' }), 'key').combo,
            { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyJ', key: 'j' });
        eq(!!Keybindings.record(press('Digit4'), 'digit').error, true);
        eq(Keybindings.record(press('Digit4', { ctrl: true, alt: true }), 'digit').combo,
            { ctrl: true, alt: true, shift: false, meta: false });
    });

    check('a combo already in use is reported, unless that shortcut is off', () => {
        const combo = { ctrl: true, code: 'KeyB', key: 'b' };
        eq(Keybindings.conflicts({}, 'chess-clear-arrows', combo).map((c) => c.id), ['record-checkpoint']);
        eq(Keybindings.conflicts({ 'record-checkpoint': { enabled: false } }, 'chess-clear-arrows', combo), []);
        // Alt+digit rebinding a letter shortcut onto the number row still clashes with skip-forward.
        eq(Keybindings.conflicts({}, 'chess-clear-arrows', { alt: true, code: 'Digit3', key: '3' }).map((c) => c.id), ['skip-forward']);
    });

    check('labels read the way a keyboard does', () => {
        eq(Keybindings.format({ ctrl: true, shift: true }, 'digit'), 'Ctrl + Shift + 1-9');
        eq(Keybindings.format({ alt: true, code: 'KeyC', key: 'c' }, 'key'), 'Alt + C');
        eq(Keybindings.format({ shift: true, code: 'Period', key: '>', char: true }, 'key'), '>');
        eq(Keybindings.format({ code: 'KeyY', key: 'y' }, 'double'), 'Y Y');
    });

    check('a double tap is one key, matched on each press and never on a held one', () => {
        const binding = Keybindings.resolve({}, 'copy-page-link');
        eq([binding.kind, binding.combo.code], ['double', 'KeyY']);
        eq(claimed({}, press('KeyY', { key: 'y' })), ['copy-page-link']);
        eq(claimed({}, press('KeyY', { key: 'y', repeat: true })), [], 'a held y read as a second press');
        eq(claimed({}, press('KeyY', { key: 'Y', shift: true })), [], 'a capital Y was taken');
        eq(claimed({ 'copy-page-link': { enabled: false } }, press('KeyY', { key: 'y' })), []);
        const counted = Shortcuts.createBindings({}, {}).filter((one) => one.double).map((one) => one.name);
        eq(counted, ['copy-page-link'], 'the dispatcher counts presses for these alone');
    });

    check('a double tap and a single press of the same key cannot both be bound', () => {
        // One press of the key would run the single binding, twice over,
        // before the double ever counted to two.
        const y = { code: 'KeyY', key: 'y' };
        eq(Keybindings.conflicts({}, 'chess-clear-arrows', y).map((c) => c.id), ['copy-page-link']);
        eq(Keybindings.conflicts({}, 'copy-page-link', { alt: true, code: 'KeyC', key: 'c' }).map((c) => c.id),
            ['chess-clear-arrows']);
        eq(Keybindings.record(press('KeyG', { key: 'g' }), 'double').combo,
            { ctrl: false, alt: false, shift: false, meta: false, code: 'KeyG', key: 'g' });
        eq(Keybindings.record(press('ShiftLeft', { key: 'Shift', shift: true }), 'double'), { pending: true });
    });

    // --------------------------------------------------------------- chess

    section('chess.com games');

    const Chess = require('../src/shared/chess.js');

    const PGN = [
        '[Event "Live Chess"]', '[Site "Chess.com"]', '[Date "2026.09.12"]', '[UTCDate "2026.09.12"]',
        '[StartTime "18:34:08"]', '[EndDate "2026.09.12"]', '[EndTime "18:39:05"]', '',
        '1. e4 {[%clk 0:01:00.9]} 1... e5 {[%clk 0:01:00]} 2. Nf3 {[%clk 0:00:55][%timestamp 3]} 2... Nc6 {[%clk 0:00:50.5]} 1-0',
    ].join('\n');

    const game = (overrides = {}) => ({
        url: 'https://www.chess.com/game/live/1',
        time_control: '60+1',
        time_class: 'bullet',
        end_time: 1789238345,
        rated: true,
        pgn: PGN,
        white: { username: 'Me', rating: 1500, result: 'win' },
        black: { username: 'them', rating: 1480, result: 'resigned' },
        ...overrides,
    });

    const chessMonthKeys = () => Object.keys(store).filter((key) => key.startsWith('bbChessArchive:')).sort();

    check('time controls parse, daily games included', () => {
        eq(Chess.parseTimeControl('180+2'), { base: 180, increment: 2, daily: false });
        eq(Chess.parseTimeControl('600'), { base: 600, increment: 0, daily: false });
        eq(Chess.parseTimeControl('1/86400'), { base: 86400, increment: 0, daily: true });
    });

    check('clock annotations are read per side, extra comment tags and all', () => {
        eq(Chess.parseClocks(PGN), { white: [60.9, 55], black: [60, 50.5] });
    });

    check('time used is start plus increments minus what was left', () => {
        // White: 60 + 1*2 - 55 = 7. Black: 60 + 1*2 - 50.5 = 11.5.
        const used = Chess.timeUsed(game());
        eq([used.white, used.black, used.moves], [7, 11.5, 2]);
    });

    check('a game without clocks has no inferred time rather than a wrong one', () => {
        eq(Chess.timeUsed(game({ pgn: '1. e4 e5 1-0' })).white, null);
        eq(Chess.timeUsed(game({ time_control: '1/86400' })).white, null);
    });

    check('normalize reads the game from the player\'s side, case-insensitively', () => {
        const mine = Chess.normalize(game(), 'ME');
        eq([mine.color, mine.result, mine.how, mine.opponent, mine.myTime, mine.oppTime, mine.duration],
            ['white', 'win', 'resigned', 'them', 7, 11.5, 297]);

        const theirs = Chess.normalize(game(), 'them');
        eq([theirs.color, theirs.result, theirs.myTime], ['black', 'loss', 11.5]);
        eq(Chess.normalize(game(), 'stranger'), null);
    });

    check('draw codes are draws; every other non-win is a loss', () => {
        eq(Chess.resultOf('repetition'), 'draw');
        eq(Chess.resultOf('timevsinsufficient'), 'draw');
        eq(Chess.resultOf('timeout'), 'loss');
        eq(Chess.resultOf('abandoned'), 'loss');
    });

    check('summaries split by time class and respect the range', () => {
        const at = (ms, cls, result) => ({ end: ms, timeClass: cls, result, myTime: 10, oppTime: 20 });
        const games = [
            at(1000, 'bullet', 'win'), at(2000, 'bullet', 'loss'), at(3000, 'blitz', 'draw'),
            at(4000, 'rapid', 'win'), at(5000, 'daily', 'win'), at(100, 'blitz', 'win'),
        ];
        const summary = Chess.summarize(games, { since: 500, until: 10000 });
        eq(summary.count, 5);
        eq(summary.games[0].end, 5000, 'newest first');
        eq([summary.byClass.bullet.win, summary.byClass.bullet.loss, summary.byClass.blitz.draw], [1, 1, 1]);
        eq(summary.total.games, 5, 'daily counts toward the total');
        eq([summary.total.myTime, summary.total.oppTime], [50, 100]);
        eq(Chess.winRate(summary.byClass.bullet), 50);
        eq(Chess.winLossRatio({ win: 3, loss: 2 }), 1.5);
        eq(Chess.winLossRatio({ win: 3, loss: 0 }), null);
    });

    check('"today" starts at local midnight; the weeks are rolling', () => {
        const now = new Date(2026, 8, 13, 15, 30).getTime();
        eq(Chess.rangeStart('today', now), new Date(2026, 8, 13).getTime());
        eq(Chess.rangeStart('week', now), now - 7 * 86400000);
    });

    check('a 30-day window across a month boundary reads both archives', () => {
        eq(Chess.archiveMonths(Date.UTC(2026, 8, 13), 30), ['2026/08', '2026/09']);
        eq(Chess.archiveMonths(Date.UTC(2026, 0, 5), 30), ['2025/12', '2026/01']);
        eq(Chess.archiveMonths(Date.UTC(2026, 8, 30), 7), ['2026/09']);
    });

    await checkAsync('games are fetched once per closed month, and the live month re-read later', async () => {
        clearStore();
        const now = Date.UTC(2026, 8, 13, 12);
        const calls = [];
        const fetchImpl = async (url) => {
            calls.push(url.replace(/.*games\//, ''));
            const month = url.endsWith('2026/09') ? 9 : 8;
            const end = Math.floor(Date.UTC(2026, month - 1, month === 9 ? 12 : 30) / 1000);
            return { ok: true, status: 200, json: async () => ({ games: [game({ end_time: end })] }) };
        };

        const first = await Chess.fetchGames('Me', { now, fetchImpl });
        eq(first.length, 2);
        eq(calls, ['2026/08', '2026/09']);

        await Chess.fetchGames('me', { now: now + 60 * 1000, fetchImpl });
        eq(calls.length, 2, 'both months fresh a minute later');

        await Chess.fetchGames('me', { now: now + 10 * 60 * 1000, fetchImpl });
        eq(calls.slice(2), ['2026/09'], 'only the live month is read again');
    });

    await checkAsync('an unknown player is reported as such', async () => {
        clearStore();
        const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
        let code = null;
        try { await Chess.fetchGames('nobody', { fetchImpl }); } catch (error) { code = error.code; }
        eq(code, 'not-found');
    });

    check('time and control labels', () => {
        eq(Chess.human(42), '42s');
        eq(Chess.human(125), '2m 05s');
        eq(Chess.human(3725), '1h 02m');
        eq(Chess.formatControl('180+2'), '3 | 2');
        eq(Chess.formatControl('600'), '10 min');
        eq(Chess.formatControl('30'), '30s');
    });

    await checkAsync('a 30-day read does not prune the heat map\'s older months', async () => {
        clearStore();
        const now = Date.UTC(2026, 8, 13, 12);
        const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ games: [] }) });
        await Chess.fetchGames('me', { now, days: Chess.HISTORY_DAYS, fetchImpl });
        eq(chessMonthKeys().length, 13);
        await Chess.fetchGames('me', { now: now + 10 * 60 * 1000, fetchImpl });
        eq(chessMonthKeys().length, 13, 'popup-sized read must keep the year');
    });

    /** The keys each storage write touched, while `fn` runs. */
    async function chessWrites(fn) {
        const writes = [];
        const realSet = global.chrome.storage.local.set;
        global.chrome.storage.local.set = (values, cb) => {
            writes.push(Object.keys(values).sort());
            return realSet(values, cb);
        };
        try { await fn(); } finally { global.chrome.storage.local.set = realSet; }
        return writes;
    }

    await checkAsync('the live month read again with nothing new in it writes the index alone', async () => {
        // The worker's alarm reads the live month every three minutes while a
        // limit is on, and each read used to write the whole year back.
        clearStore();
        const now = Date.UTC(2026, 8, 13, 12);
        let games = [game({ end_time: Math.floor((now - 3600000) / 1000) })];
        const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ games }) });
        await Chess.fetchGames('me', { now, days: 2, fetchImpl });

        eq(await chessWrites(() => Chess.fetchGames('me', { now: now + 4 * 60000, days: 2, fetchImpl })),
            [['bbChessArchiveCache']], 'nothing new');
        assert(!JSON.stringify(store.bbChessArchiveCache).includes('chess.com/game'), 'the index carries no games');
        games = [...games, game({ end_time: Math.floor(now / 1000), url: 'https://www.chess.com/game/live/2' })];
        eq(await chessWrites(() => Chess.fetchGames('me', { now: now + 8 * 60000, days: 2, fetchImpl })),
            [['bbChessArchive:2026/09', 'bbChessArchiveCache']], 'a game finished');
        eq(await chessWrites(() => Chess.fetchGames('me', { now: now + 9 * 60000, days: 2, fetchImpl })), [], 'fresh: nothing read, nothing written');
    });

    await checkAsync('a month read again after it ended is closed for good, without its games written again', async () => {
        clearStore();
        const lastDay = Date.UTC(2026, 8, 30, 20);
        const calls = [];
        const fetchImpl = async (url) => {
            calls.push(url.slice(-7));
            return { ok: true, status: 200, json: async () => ({ games: url.endsWith('2026/09') ? [game({ end_time: Math.floor(lastDay / 1000) })] : [] }) };
        };
        await Chess.fetchGames('me', { now: lastDay, days: 2, fetchImpl });
        const twoDaysOn = Date.UTC(2026, 9, 2, 1);
        eq(await chessWrites(() => Chess.fetchGames('me', { now: twoDaysOn, days: 3, fetchImpl })),
            [['bbChessArchive:2026/10', 'bbChessArchiveCache']], 'September is unchanged; October is new');
        await Chess.fetchGames('me', { now: twoDaysOn + 10 * 60000, days: 3, fetchImpl });
        eq(calls, ['2026/09', '2026/09', '2026/10', '2026/10'], 'September not read a third time');
    });

    await checkAsync('the one-value cache of before is split into months rather than read again', async () => {
        clearStore();
        const now = Date.UTC(2026, 8, 13, 12);
        const august = Chess.normalize(game({ end_time: Math.floor(Date.UTC(2026, 7, 20) / 1000) }), 'me');
        const september = Chess.normalize(game({ end_time: Math.floor(Date.UTC(2026, 8, 12) / 1000), url: 'https://www.chess.com/game/live/2' }), 'me');
        store.bbChessArchiveCache = { user: 'me', archives: {
            '2026/08': { fetchedAt: Date.UTC(2026, 8, 5), games: [august] },
            '2026/09': { fetchedAt: now - 60000, games: [september] },
        } };
        let calls = 0;
        const games = await Chess.fetchGames('me', { now, fetchImpl: async () => { calls++; return { ok: false, status: 500 }; } });
        eq([calls, games.length], [0, 2]);
        eq([store.bbChessArchiveCache.version, Object.keys(store.bbChessArchiveCache.fetched)], [2, ['2026/08', '2026/09']]);
        eq(chessMonthKeys(), ['bbChessArchive:2026/08', 'bbChessArchive:2026/09']);
    });

    await checkAsync('another player\'s months go when the username changes', async () => {
        clearStore();
        const now = Date.UTC(2026, 8, 13, 12);
        const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ games: [] }) });
        await Chess.fetchGames('me', { now, days: Chess.HISTORY_DAYS, fetchImpl });
        await Chess.fetchGames('you', { now: now + 1000, fetchImpl });
        eq(chessMonthKeys(), ['bbChessArchive:2026/08', 'bbChessArchive:2026/09']);
        eq([store['bbChessArchive:2026/09'].user, store.bbChessArchiveCache.user], ['you', 'you']);
    });

    check('flagging counts only the last 20 games of each time control', () => {
        const at = (end, timeClass, result, how) => ({ end, timeClass, result, how });
        const games = [];
        // 25 bullet games: the 5 oldest are flag wins that must fall outside the window.
        for (let i = 0; i < 5; i++) games.push(at(i, 'bullet', 'win', 'timeout'));
        for (let i = 5; i < 25; i++) games.push(at(i, 'bullet', i % 4 === 0 ? 'loss' : 'win', i % 2 === 0 ? 'timeout' : 'resigned'));
        games.push(at(100, 'blitz', 'win', 'timeout'), at(101, 'blitz', 'loss', 'timeout'),
            at(102, 'blitz', 'draw', 'timevsinsufficient'), at(103, 'rapid', 'loss', 'checkmated'));
        const stats = Chess.flagStats(games);
        // Bullet 5..24: even i are timeouts; of those, i % 4 === 0 are losses (8,12,16,20,24) and the rest wins (6,10,14,18,22).
        eq(stats.bullet, { games: 20, won: 5, lost: 5 });
        eq(stats.blitz, { games: 3, won: 1, lost: 1 }, 'a timeout against insufficient material is a draw, not a flag');
        eq(stats.rapid, { games: 1, won: 0, lost: 0 });
    });

    check('time per day adds each game\'s length and leaves daily games out', () => {
        const noon = new Date(2026, 8, 12, 12).getTime();
        const days = Chess.dailyTime([
            { end: noon, timeClass: 'blitz', duration: 300 },
            { end: noon + 3600000, timeClass: 'bullet', duration: null, myTime: 50, oppTime: 40 },
            { end: noon, timeClass: 'daily', duration: 86400 },
            { end: noon + 86400000, timeClass: 'rapid', duration: 1200 },
        ]);
        eq(days['2026-09-12'], { seconds: 390, games: 2 });
        eq(days['2026-09-13'], { seconds: 1200, games: 1 });
    });

    // ------------------------------------------------------------- lichess

    section('lichess games');

    const Lichess = require('../src/shared/lichess.js');

    const lichessGame = (overrides = {}) => ({
        id: 'abcd1234',
        rated: true,
        speed: 'blitz',
        createdAt: 1000000,
        lastMoveAt: 1300000,
        status: 'outoftime',
        winner: 'white',
        players: {
            white: { user: { name: 'Me', id: 'me' }, rating: 1700 },
            black: { user: { name: 'Them', id: 'them' }, rating: 1690 },
        },
        ...overrides,
    });

    check('a Lichess flag reads as a timeout; an opponent leaving does not', () => {
        const won = Lichess.normalize(lichessGame(), 'ME');
        eq([won.color, won.result, won.how, won.timeClass, won.duration, won.url],
            ['white', 'win', 'timeout', 'blitz', 300, 'https://lichess.org/abcd1234']);
        eq(Lichess.normalize(lichessGame(), 'them').result, 'loss');
        eq(Lichess.normalize(lichessGame({ status: 'timeout' }), 'me').how === 'timeout', false);
        eq(Lichess.normalize(lichessGame({ winner: undefined, status: 'draw' }), 'me').result, 'draw');
        eq(Lichess.normalize(lichessGame(), 'stranger'), null);
    });

    check('Lichess clocks give each side\'s time and the time control', () => {
        const game = Lichess.normalize(lichessGame({
            clock: { initial: 180, increment: 2 },
            clocks: [18000, 18000, 17500, 17000],
            moves: 'e4 e5 Nf3 Nc6',
        }), 'me');
        eq([game.timeControl, game.myTime, game.oppTime, game.moves, game.rating], ['180+2', 9, 14, 2, 1700]);
        eq(Lichess.normalize(lichessGame(), 'me').myTime, null, 'no clocks, no time');
    });

    check('NDJSON lines parse, a torn line is skipped', () => {
        eq(Lichess.parseNdjson('{"a":1}\n\n{"b":2}\n{"c":').length, 2);
    });

    await checkAsync('Lichess reads the newest games first, then resumes at both edges', async () => {
        clearStore();
        const now = Date.UTC(2026, 8, 13, 12);
        const urls = [];
        const created = now - 5 * 86400000;
        const fetchImpl = async (url) => {
            urls.push(new URL(url));
            const body = urls.length === 1
                ? [lichessGame({ id: 'g2', createdAt: created + 100000, lastMoveAt: created + 200000, winner: 'black' }),
                    lichessGame({ id: 'g1', createdAt: created, lastMoveAt: created + 60000 })]
                : [];
            return { ok: true, status: 200, text: async () => body.map((g) => JSON.stringify(g)).join('\n') };
        };

        const first = await Lichess.fetchGames('me', { now, fetchImpl });
        eq(first.map((g) => g.url.slice(-2)), ['g2', 'g1'], 'newest first');
        eq([urls[0].searchParams.get('sort'), urls[0].searchParams.get('since'), urls[0].searchParams.get('until')],
            ['dateDesc', String(now - 30 * 86400000), String(now)], 'a first read walks back from now over 30 days');

        await Lichess.fetchGames('me', { now: now + 60000, fetchImpl });
        eq(urls.length, 1, 'fresh for a few minutes');

        const again = await Lichess.fetchGames('me', { now: now + 10 * 60000, fetchImpl });
        eq([urls[1].searchParams.get('sort'), urls[1].searchParams.get('since')], ['dateAsc', String(created + 100001)]);
        eq(again.length, 2, 'kept games survive an empty resume');

        await Lichess.fetchGames('me', { now: now + 11 * 60000, days: Chess.HISTORY_DAYS, fetchImpl });
        // The empty resume above wrote nothing, its time included, so this
        // one resumes again — one small empty request — before going back.
        eq(urls.slice(2).map((url) => url.searchParams.get('sort')), ['dateAsc', 'dateDesc']);
        eq(urls[3].searchParams.get('until'), String(now - 30 * 86400000 - 1), 'the year continues back from where 30 days stopped');
    });

    await checkAsync('a Lichess resume that found nothing writes nothing', async () => {
        // The alarm resumes every three minutes while a limit is on, and each
        // resume used to write the whole year back to record when it ran.
        clearStore();
        const now = Date.UTC(2026, 8, 13, 12);
        const created = now - 86400000;
        let body = [lichessGame({ id: 'g1', createdAt: created, lastMoveAt: created + 60000 })];
        const fetchImpl = async () => ({ ok: true, status: 200, text: async () => body.map((g) => JSON.stringify(g)).join('\n') });
        await Lichess.fetchGames('me', { now, days: 2, fetchImpl });
        body = [];
        let writes = 0;
        const realSet = global.chrome.storage.local.set;
        global.chrome.storage.local.set = (values, cb) => { writes++; return realSet(values, cb); };
        try {
            eq((await Lichess.fetchGames('me', { now: now + 4 * 60000, days: 2, fetchImpl })).length, 1);
            eq(writes, 0, 'nothing new');
            body = [lichessGame({ id: 'g2', createdAt: now, lastMoveAt: now + 60000 })];
            eq((await Lichess.fetchGames('me', { now: now + 8 * 60000, days: 2, fetchImpl })).length, 2);
            eq(writes, 1, 'a game arrived');
        } finally {
            global.chrome.storage.local.set = realSet;
        }
    });

    await checkAsync('an interrupted Lichess read keeps what arrived and resumes from it', async () => {
        clearStore();
        const now = Date.UTC(2026, 8, 13, 12);
        const created = now - 86400000;
        const urls = [];
        const games = Array.from({ length: 300 }, (_, i) => lichessGame({ id: `x${i}`, createdAt: created - i * 1000, lastMoveAt: created - i * 1000 + 500 }));
        const encoder = new TextEncoder();
        const fetchImpl = async (url) => {
            urls.push(new URL(url));
            if (urls.length > 1) return { ok: true, status: 200, text: async () => '' };
            let sent = false;
            return {
                ok: true,
                status: 200,
                body: {
                    getReader: () => ({
                        read: async () => {
                            if (sent) throw new Error('connection reset');
                            sent = true;
                            return { done: false, value: encoder.encode(games.map((g) => JSON.stringify(g)).join('\n') + '\n') };
                        },
                    }),
                },
            };
        };
        let code = null;
        try { await Lichess.fetchGames('me', { now, fetchImpl }); } catch (error) { code = error.code; }
        eq(code, 'network');
        eq(store.bbLichessGameCache.games.length, 300, 'the games that arrived are saved');

        await Lichess.fetchGames('me', { now: now + 1000, fetchImpl });
        eq(urls[1].searchParams.get('sort'), 'dateAsc', 'newer games first');
        eq(urls[2].searchParams.get('until'), String(created - 299 * 1000 - 1), 'then back from the oldest that arrived');
    });

    await checkAsync('an unknown Lichess player is reported as such', async () => {
        clearStore();
        let code = null;
        try {
            await Lichess.fetchGames('nobody', { fetchImpl: async () => ({ ok: false, status: 404 }) });
        } catch (error) { code = error.code; }
        eq(code, 'not-found');
        eq(Backup.build({ bbLichessGameCache: { games: [] }, lichessUsername: 'me' }, 0).data, { lichessUsername: 'me' });
    });

    // --------------------------------------- in-game: clock warning, speech

    section('chess sites in game: clock warning and spoken moves');

    const ChessSites = require('../src/shared/chess-sites.js');
    const { DEFAULTS: SETTING_DEFAULTS } = require('../src/shared/settings.js');
    const ChessContent = require('../src/content/chess.js');

    check('every per-site setting the registry can name has a default', () => {
        const missing = ChessSites.allKeys().filter((key) => !(key in SETTING_DEFAULTS));
        eq(missing, []);
        eq(ChessSites.settingKey('lichess', 'warnSeconds', 'blitz'), 'lichessWarnBlitzSeconds');
        eq(ChessSites.settingKey('chess', 'limit', 'bullet'), 'chessLimitBullet');
        eq(ChessSites.settingKey('chess', 'lowSeconds', 'rapid'), 'chessLowTimeRapidSeconds');
        eq(ChessSites.siteKey('lichess', 'lowVolume'), 'lichessLowTimeVolume');
        eq(ChessSites.settingKey('chess', 'nonsense', 'bullet'), null);
    });

    check('clock text parses, tenths and hours included', () => {
        eq(ChessContent.parseClock('1:05'), 65);
        eq(ChessContent.parseClock('0:09.8'), 9.8);
        eq(ChessContent.parseClock('01:02:03'), 3723);
        eq(ChessContent.parseClock(''), null);
    });

    check('the starting time picks the time control the way each site does', () => {
        eq([60, 120, 180, 300, 540, 600].map((s) => ChessSites.classify('chess', s)),
            ['bullet', 'bullet', 'blitz', 'blitz', 'blitz', 'rapid']);
        eq([60, 180, 300, 480, 1800].map((s) => ChessSites.classify('lichess', s)),
            ['bullet', 'blitz', 'blitz', 'rapid', 'rapid'], 'Lichess blitz ends at 8 minutes');
    });

    check('a warning or speech applies only to its own site and time control', () => {
        const settings = { chessWarnBullet: true, chessWarnBulletSeconds: 8, chessWarnBlitz: false, chessWarnBlitzSeconds: 30, lichessSpeakRapid: true };
        eq(ChessSites.thresholdFor(settings, 'chess', 'bullet'), 8);
        eq(ChessSites.thresholdFor(settings, 'chess', 'blitz'), null);
        eq(ChessSites.thresholdFor(settings, 'lichess', 'bullet'), null);
        eq(ChessSites.anyWarningOn(settings, 'chess'), true);
        eq(ChessSites.anyWarningOn({ chessWarnRapid: true, chessWarnRapidSeconds: 0 }, 'chess'), false, 'zero seconds is no warning');
        eq([ChessSites.speaksFor(settings, 'lichess', 'rapid'), ChessSites.speaksFor(settings, 'lichess', 'blitz'),
            ChessSites.anySpeechOn(settings, 'chess'), ChessSites.speaksFor(settings, 'lichess', null)], [true, false, false, true]);
    });

    check('moves are spoken as words', () => {
        eq(['e4', 'Nf3', 'exd5', 'Nbd7', 'R1e2', 'Qh4xe1', 'Bxf7+', 'e8=Q#', 'O-O', 'O-O-O+', 'Qd8!?', '♘f3'].map(ChessContent.spokenMove), [
            'E 4', 'Knight F 3', 'E takes D 5', 'Knight B D 7', 'Rook 1 E 2', 'Queen H 4 takes E 1',
            'Bishop takes F 7, check', 'E 8 promotes to Queen, checkmate', 'Castles kingside', 'Castles queenside, check',
            'Queen D 8', 'Knight F 3',
        ]);
        eq(ChessContent.spokenMove(''), '');
    });

    check('a chess.com move node gets its piece letter back from the figurine', () => {
        const text = (value) => ({ nodeType: 3, textContent: value });
        const element = (figurine, children = []) => ({ nodeType: 1, getAttribute: () => figurine, childNodes: children });
        const node = element(null, [element(null, [element('N'), text('xe5+')])]);
        eq(ChessContent.moveText(node), 'Nxe5+');
        eq(ChessContent.moveText(element(null, [text('e8='), element('Q')])), 'e8=Q');

        // chess.com's figurine is an empty icon span before the square, and
        // splitting on the space once read "Qg4" aloud as "Queen".
        const real = element(null, [text(' '), element(null, [element('Q'), text(' g4 ')])]);
        eq(ChessContent.moveText(real), 'Qg4');
        eq(ChessContent.spokenMove(ChessContent.moveText(real)), 'Queen G 4');
        // A move number glued on by the same closing-up is taken off again.
        eq(ChessContent.moveText(element(null, [text('12. '), element(null, [element('R'), text(' xh5 ')])])), 'Rxh5');
    });

    check('only actual notation counts as a move', () => {
        // The gate that lets a move-list selector be believed or passed over:
        // row containers and move numbers must not read as moves.
        eq(['e4', 'Nf3', 'exd5', 'O-O', '0-0-0', 'e8=Q#', 'Qh4xe1', 'Bxf7+', 'Qd8!?']
            .every(ChessContent.isMoveText), true);
        eq(['12.', '1', '', 'White to move', '10:00', 'Rematch', '1-0', 'Zz9']
            .some(ChessContent.isMoveText), false);
    });

    check('only a move list that grew, and grew from where it was, is spoken', () => {
        const from = ['e4', 'e5', 'Nf3'];
        eq(ChessContent.newMoves(from, ['e4', 'e5', 'Nf3', 'Nc6']), ['Nc6']);
        eq(ChessContent.newMoves(from, from), []);
        // A takeback, a redraw and a different game each resync in silence
        // rather than reading the board out from the top.
        eq(ChessContent.newMoves(from, ['e4', 'e5']), null, 'a takeback');
        eq(ChessContent.newMoves(from, ['d4', 'd5', 'c4']), null, 'another game, same length');
        eq(ChessContent.newMoves([], ['e4']), ['e4']);
    });

    check('an untimed game speaks whenever any speech is on', () => {
        // Coach, bots and analysis have no clock; behind a separate "Untimed"
        // box, off by default, a user with Blitz ticked heard nothing there.
        const timed = { chessSpeakBlitz: true };
        eq(ChessSites.speaksFor(timed, 'chess', null), true);
        eq(ChessSites.speaksFor(timed, 'chess', 'bullet'), false);
        // The Untimed box alone speaks in untimed games only.
        const untimedOnly = { chessSpeakUntimed: true };
        eq(ChessSites.speaksFor(untimedOnly, 'chess', null), true);
        eq(ChessSites.speaksFor(untimedOnly, 'chess', 'bullet'), false);
        eq(ChessSites.anySpeechOn(untimedOnly, 'chess'), true);
        eq([ChessSites.speaksFor({}, 'chess', null), ChessSites.anySpeechOn({}, 'chess')], [false, false]);
    });

    check('a time-control label names a bucket, whichever way a site writes it', () => {
        const chess = (text) => ChessSites.classFromLabel('chess', text);
        eq(['1 min', '3 min', '10 min', '30 min'].map(chess), ['bullet', 'blitz', 'rapid', 'rapid']);
        eq(['New 10 min game', '3 | 2', '1 | 1', 'Rapid'].map(chess), ['rapid', 'blitz', 'bullet', 'rapid']);
        eq(['3+2', '30 sec', '1/2 min', 'UltraBullet'].map((t) => ChessSites.classFromLabel('lichess', t)),
            ['blitz', 'bullet', 'bullet', 'bullet']);
        // 5 minutes is blitz on chess.com and blitz on Lichess; 8 splits them.
        eq([chess('8 min'), ChessSites.classFromLabel('lichess', '8 min')], ['blitz', 'rapid']);
        eq(['Rematch', 'New game', '', 'Resign'].map(chess), [null, null, null, null]);
    });

    check('every speed either site reports lands in one of the three buckets', () => {
        eq(['bullet', 'ultraBullet', 'blitz', 'rapid', 'classical'].map(ChessSites.bucket),
            ['bullet', 'bullet', 'blitz', 'rapid', 'rapid']);
        // Played over days, not at a sitting: outside every bucket on purpose.
        eq([ChessSites.bucket('daily'), ChessSites.bucket('correspondence'), ChessSites.bucket('')],
            [null, null, null]);
    });

    check('the low-clock tone is one switch a site, with a line per control', () => {
        const settings = { chessLowTime: true, chessLowTimeBulletSeconds: 10, chessLowTimeBlitzSeconds: 0, chessLowTimeVolume: 150 };
        eq(ChessSites.lowTimeFor(settings, 'chess', 'bullet'), 10);
        eq(ChessSites.lowTimeFor(settings, 'chess', 'blitz'), null, 'zero seconds is no tone');
        eq(ChessSites.lowTimeFor(settings, 'lichess', 'bullet'), null);
        eq(ChessSites.lowTimeFor({ ...settings, chessLowTime: false }, 'chess', 'bullet'), null);
        eq(ChessSites.anyLowTimeOn(settings, 'chess'), true);
        // Percent in, gain out — above 1 really is louder, and it is capped.
        eq([150, 0, 400, undefined].map((v) => ChessSites.lowVolumeFor({ chessLowTimeVolume: v }, 'chess')),
            [1.5, 0, 2, 0.6]);
    });

    // -------------------------------------------------------- daily limits

    section('chess daily limits');

    const ChessLimits = require('../src/shared/chess-limits.js');

    const DAY = new Date(2026, 8, 16, 12, 0, 0).getTime();
    const limitOn = {
        chessDailyLimits: true, chessLimitBullet: 2, chessLimitBlitz: 0, chessLimitRapid: null,
    };

    await checkAsync('the day is the one the caller names, and a failed read writes nothing over the grants', async () => {
        clearStore();
        // DAY is not today: a read that put the state to the real clock's day
        // would blank it before the change was applied.
        await ChessLimits.update((state) => ChessLimits.withOneMore(state, 'chess', limitOn, DAY), DAY);
        await ChessLimits.update((state) => ChessLimits.withCounts(state, 'lichess', { bullet: 4 }, DAY), DAY);
        const day = await ChessLimits.load(DAY);
        eq([day.sites.chess.grants.bullet, day.sites.lichess.counts.bullet], [1, 4]);

        const realGet = global.chrome.storage.local.get;
        global.chrome.storage.local.get = () => Promise.reject(new Error('Extension context invalidated.'));
        const quiet = console.error;
        console.error = () => {};
        let answer;
        try {
            answer = await ChessLimits.update((state) => ChessLimits.withCounts(state, 'lichess', { bullet: 5 }, DAY), DAY);
        } finally {
            global.chrome.storage.local.get = realGet;
            console.error = quiet;
        }
        eq(answer, null);
        eq(store[ChessLimits.KEY].sites.chess.grants.bullet, 1, 'the popup\'s grant outlives the failed read');
    });

    check("today's games are counted per bucket, in local days", () => {
        const games = [
            { end: DAY, timeClass: 'bullet' },
            { end: DAY - 60000, timeClass: 'bullet' },
            { end: DAY, timeClass: 'ultraBullet' },
            { end: DAY, timeClass: 'blitz' },
            { end: DAY, timeClass: 'daily' },
            { end: DAY - 26 * 60 * 60 * 1000, timeClass: 'bullet' },
        ];
        eq(ChessLimits.countToday(games, DAY), { bullet: 3, blitz: 1, rapid: 0 });
        eq(ChessLimits.countToday([], DAY), { bullet: 0, blitz: 0, rapid: 0 });
    });

    check('a tally left over from yesterday is gone, grants and all', () => {
        const yesterday = ChessLimits.withCounts(
            ChessLimits.blank(DAY - 24 * 60 * 60 * 1000), 'chess', { bullet: 9 }, DAY - 24 * 60 * 60 * 1000,
        );
        eq(yesterday.sites.chess.counts.bullet, 9);
        eq(ChessLimits.forDay(yesterday, DAY).sites.chess.counts.bullet, 0);
        eq(ChessLimits.forDay(null, DAY).day, '2026-09-16');
    });

    check('a control is blocked once its count reaches what it is allowed', () => {
        const state = ChessLimits.withCounts(ChessLimits.blank(DAY), 'chess', { bullet: 2 }, DAY);
        const status = ChessLimits.statusFor(state, limitOn, 'chess', DAY);
        eq(status.classes.bullet, { limit: 2, count: 2, grant: 0, allowed: 2, remaining: 0, blocked: true });
        // Zero is a limit of none, not "no limit set".
        eq(status.classes.blitz.blocked, true);
        eq(status.classes.rapid, { limit: null, count: 0, grant: 0, allowed: null, remaining: null, blocked: false });
        eq([status.anyBlocked, status.anyLimited, status.blocked], [true, true, ['bullet', 'blitz']]);
        eq(ChessLimits.isBlocked(status, 'ultraBullet'), true, 'through the bucket, not the site name');
        eq(ChessLimits.isBlocked(status, 'daily'), false);
    });

    check('limits apply only where they are switched on', () => {
        const spent = ChessLimits.withCounts(ChessLimits.blank(DAY), 'chess', { bullet: 99 }, DAY);
        eq(ChessLimits.statusFor(spent, { ...limitOn, chessDailyLimits: false }, 'chess', DAY).anyBlocked, false);
        eq(ChessLimits.statusFor(spent, limitOn, 'lichess', DAY).anyLimited, false);
    });

    check('the override lets exactly one more game through each limited control', () => {
        let state = ChessLimits.withCounts(ChessLimits.blank(DAY), 'chess', { bullet: 2, blitz: 0 }, DAY);
        state = ChessLimits.withOneMore(state, 'chess', limitOn, DAY);

        const after = ChessLimits.statusFor(state, limitOn, 'chess', DAY);
        eq([after.classes.bullet.allowed, after.classes.bullet.blocked], [3, false]);
        eq([after.classes.blitz.allowed, after.classes.blitz.blocked], [1, false]);
        eq(after.classes.rapid.grant, 0, 'a control with no limit is granted nothing');

        // That one game played, and the block is back — the point of a grant
        // rather than a switch.
        const played = ChessLimits.withCounts(state, 'chess', { bullet: 3, blitz: 1 }, DAY);
        eq(ChessLimits.statusFor(played, limitOn, 'chess', DAY).blocked, ['bullet', 'blitz']);
    });

    check('a fresh count does not wipe the grants already given today', () => {
        let state = ChessLimits.withOneMore(ChessLimits.blank(DAY), 'chess', limitOn, DAY);
        state = ChessLimits.withCounts(state, 'chess', { bullet: 1 }, DAY);
        eq(state.sites.chess.grants.bullet, 1);
        eq(state.sites.chess.checkedAt, DAY);
    });

    // -------------------------------------------------------------- trials

    section('trials');

    const Trials = require('../src/shared/trials.js');

    check('a tab is known by one letter and a steady colour', () => {
        eq(Trials.mono('https://mail.google.com/mail/u/0'), 'G', 'the site, not the subdomain');
        eq(Trials.mono('https://arxiv.org/abs/2404.08236'), 'A');
        eq(Trials.mono('about:blank'), '·', 'nothing to go on');
        eq(Trials.domainOf('https://www.youtube.com/watch?v=1'), 'youtube.com');
        eq(Trials.tint('https://github.com/x') === Trials.tint('https://github.com/y'), true);
        eq(Trials.tint('https://github.com') === Trials.tint('https://gitlab.com'), false);
    });

    check('a lock runs down, and only an open group can hold the desk', () => {
        const T = 1000000;
        const state = Trials.lock({}, 7, 25, T);
        eq(Trials.isLocked(state, 7, T + 60000), true);
        eq(Trials.minutesLeft(state, 7, T + 60000), 24);
        eq(Trials.minutesLeft(state, 7, T + 25 * 60000 - 1), 1, 'a second left still reads a minute');
        eq(Trials.isLocked(state, 7, T + 25 * 60000), false, 'it expires on its own');
        eq(Trials.lockedId(state, [1, 7], T + 60000), 7);
        eq(Trials.lockedId(state, [1, 2], T + 60000), null, 'a parked group does not hold it');
        eq(Trials.isLocked(Trials.unlock(state, 7), 7, T + 60000), false);
    });

    check('the group left longest is the one parked', () => {
        let state = Trials.touch({}, 1, 1000);
        state = Trials.touch(state, 2, 3000);
        state = Trials.touch(state, 3, 2000);
        eq(Trials.parkVictims(state, [1, 2, 3], 1, 4000), [1]);
        eq(Trials.parkVictims(state, [1, 2, 3], 2, 4000), [1, 3]);
        eq(Trials.parkVictims(state, [1, 2, 3], 0, 4000), [], 'nothing to free, nothing parked');
        eq(Trials.parkVictims({}, [9], 1, 4000), [9], 'a group never touched is fair game');
    });

    check('a locked group is parked only when nothing else is left', () => {
        const T = 1000000;
        let state = Trials.touch({}, 1, T - 9000);
        state = Trials.touch(state, 2, T - 1000);
        state = Trials.lock(state, 1, 25, T);
        eq(Trials.parkVictims(state, [1, 2], 1, T), [2], 'the newer one goes instead');
        eq(Trials.parkVictims(state, [1, 2], 2, T), [2, 1], 'the lock is last, not exempt');
    });

    check('a record whose group has gone is dropped', () => {
        const state = Trials.touch(Trials.touch({}, 4, 1), 5, 2);
        eq(Object.keys(Trials.sanitize(state, [4])), ['4']);
        eq(Object.keys(Trials.sanitize(state)), ['4', '5'], 'no list means nothing was checked');
        eq(Trials.sanitize({ notanid: { usedAt: 1 } }, null), {});
        eq(Trials.sanitize(null), {});
        eq(Trials.sanitize([1, 2]), {}, 'the old array shape reads as empty');
        eq(Object.keys(Trials.forget(state, 4)), ['5']);
    });

    check('how long ago a group was used reads in words', () => {
        const T = 1000000000;
        eq(Trials.usedLabel(0, T), 'not yet used');
        eq(Trials.usedLabel(T - 10000, T), 'just now');
        eq(Trials.usedLabel(T - 20 * 60000, T), '20m ago');
        eq(Trials.usedLabel(T - 5 * 3600000, T), '5h ago');
        eq(Trials.usedLabel(T - 30 * 3600000, T), 'yesterday');
        eq(Trials.usedLabel(T - 3 * 86400000, T), '3d ago');
        eq(Trials.usedLabel(T - 20 * 86400000, T), 'last week');
    });

    check('a record is read back whole however little was written', () => {
        eq(Trials.recordFor({}, 3), { usedAt: 0, lockUntil: 0, lockSpan: 0 });
        eq(Trials.recordFor({ 3: { usedAt: 'nonsense' } }, 3).usedAt, 0);
        const state = Trials.touch({}, 3, 50);
        eq(Trials.lock(state, 3, 25, 100).usedAt, undefined, 'the state is a map, not a record');
        eq(Trials.lock(state, 3, 25, 100)['3'].usedAt, 50, 'locking keeps what was there');
    });

    section('trials — the desk');

    // tabs.move and tabGroups.move place a tab as if already lifted out, and an
    // off-by-one throws nothing, so the stubs are a strip that reorders itself.
    {
        const NONE = -1;
        let tabs = [];
        let groups = [];
        const store = {};
        const strip = () => tabs.map((t) => `${t.id}${t.groupId === NONE ? '' : `:g${t.groupId}`}`).join(' ');
        const reindex = () => tabs.forEach((tab, i) => { tab.index = i; });
        const on = { addListener() {} };
        const chrome = {
            runtime: { onMessage: on, lastError: null },
            storage: {
                local: {
                    get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])),
                    set: async (values) => Object.assign(store, values),
                },
                onChanged: on,
            },
            windows: { getCurrent: async () => ({ id: 1 }), update: async () => {} },
            tabs: {
                query: async ({ windowId, groupId }) => tabs
                    .filter((t) => (windowId == null || t.windowId === windowId) && (groupId == null || t.groupId === groupId))
                    .map((t) => ({ ...t })),
                group: async ({ tabIds, groupId }) => {
                    const id = groupId == null ? groups.reduce((n, g) => Math.max(n, g.id), 0) + 1 : groupId;
                    if (groupId == null) groups.push({ id, windowId: 1, title: '', color: 'grey', collapsed: false });
                    for (const tabId of tabIds) tabs.find((t) => t.id === tabId).groupId = id;
                    return id;
                },
                ungroup: async (tabIds) => { for (const id of tabIds) tabs.find((t) => t.id === id).groupId = NONE; },
                move: async (tabId, { index }) => {
                    const [tab] = tabs.splice(tabs.findIndex((t) => t.id === tabId), 1);
                    tabs.splice(index, 0, tab);
                    reindex();
                },
                update: async () => {},
                remove: async (tabIds) => { tabs = tabs.filter((t) => !tabIds.includes(t.id)); reindex(); },
                onUpdated: on, onRemoved: on, onActivated: on,
            },
            tabGroups: {
                query: async () => groups.map((g) => ({ ...g })),
                get: async (id) => {
                    const group = groups.find((g) => g.id === id);
                    if (!group) throw new Error('no such group');
                    return { ...group };
                },
                update: async (id, changes) => { Object.assign(groups.find((g) => g.id === id), changes); },
                // The whole group lifts out and goes back in together.
                move: async (id, { index }) => {
                    const rest = tabs.filter((t) => t.groupId !== id);
                    rest.splice(index, 0, ...tabs.filter((t) => t.groupId === id));
                    tabs = rest;
                    reindex();
                },
                onRemoved: on, onUpdated: on,
            },
        };
        const vm = require('vm');
        const sandbox = vm.createContext({ chrome, console, URL, Date, Math, JSON, setTimeout, clearTimeout });
        sandbox.self = sandbox.globalThis = sandbox;
        for (const file of ['src/shared/settings.js', 'src/shared/store.js', 'src/shared/trials.js', 'src/background/router.js', 'src/background/trials.js']) {
            vm.runInContext(readRepo(file), sandbox, { filename: file });
        }
        const Desk = sandbox.BB.TrialsWorker;
        const Kept = sandbox.BB.Trials;

        /** Two groups in play, one parked, two loose tabs; `full` puts all three in play. */
        const seed = (full) => {
            for (const key of Object.keys(store)) delete store[key];
            groups = [
                { id: 10, windowId: 1, title: 'Coursework', color: 'blue', collapsed: false },
                { id: 20, windowId: 1, title: 'Thesis', color: 'cyan', collapsed: false },
                { id: 30, windowId: 1, title: 'Admin', color: 'green', collapsed: !full },
            ];
            tabs = [[1, 10], [2, 10], [3, 20], [4, 20], [5, 30], [6, NONE], [7, NONE]].map(([id, groupId]) => ({
                id, windowId: 1, groupId, url: `https://s${id}.test/`, title: `tab ${id}`, active: false,
            }));
            reindex();
        };
        const used = (...touches) => Kept.update(() => touches.reduce((state, [id, at]) => Kept.touch(state, id, at), {}));
        const openGroups = () => groups.filter((group) => !group.collapsed).map((group) => group.id);

        await checkAsync('two changes to the records made together both land', async () => {
            // A tab moving and a lock being set read the same records, and the later write won.
            seed();
            await Promise.all([Kept.update((state) => Kept.touch(state, 10, 1000)), Kept.update((state) => Kept.lock(state, 20, 25, 1000))]);
            const kept = await Kept.load();
            eq([!!kept[10], Kept.isLocked(kept, 20, 2000)], [true, true]);
        });
        await checkAsync('the desk lists loose tabs, reads a collapsed group as parked, and starts unlocked', async () => {
            seed();
            const snap = (await Desk.snapshot()).desk;
            eq(snap.loose.map((t) => t.id), [6, 7]);
            eq(snap.groups.map((g) => [g.id, g.parked]), [[10, false], [20, false], [30, true]]);
            eq(snap.lockedId, null);
        });
        await checkAsync('a dragged tab lands where it is dropped, in a group or out of every one', async () => {
            seed();
            await Desk.moveTab(6, 10, 0);
            eq(strip(), '6:g10 1:g10 2:g10 3:g20 4:g20 5:g30 7', 'the top of a group');
            await Desk.moveTab(6, 20, 2);
            eq(strip(), '1:g10 2:g10 3:g20 4:g20 6:g20 5:g30 7', 'the end of another');
            await Desk.moveTab(6, null, 0);
            eq(tabs.find((t) => t.id === 6).groupId, NONE, 'back to the left');
            seed();
            await Desk.moveTab(2, 10, 0);
            eq(strip(), '2:g10 1:g10 3:g20 4:g20 5:g30 6 7', 'inside its own group');
        });
        await checkAsync('three groups run at a time, and a fourth parks the one left longest', async () => {
            seed(true);
            await used([10, 1000], [20, 3000], [30, 2000]);
            const made = await Desk.newGroupFrom(7);
            eq(made.ok, true);
            const group = groups.find((g) => g.id === made.groupId);
            eq([group.title, group.color], ['Untitled group', 'yellow']);
            eq(openGroups(), [20, 30, made.groupId]);
            eq(openGroups().length, Kept.SLOT_LIMIT, 'never four');

            seed();
            groups.push({ id: 40, windowId: 1, title: 'Travel', color: 'pink', collapsed: false });
            tabs.push({ id: 8, windowId: 1, groupId: 40, url: 'https://s8.test/', title: 'tab 8', active: false });
            reindex();
            await used([10, 1000], [20, 3000], [40, 2000]);
            await Desk.openGroup(30);
            eq(openGroups(), [20, 30, 40], 'opening a parked group parks the stalest');
        });
        await checkAsync('a locked group holds the desk until it is unlocked', async () => {
            seed();
            await Desk.lockGroup(10, 25);
            eq((await Desk.snapshot()).desk.lockedId, 10);
            eq((await Desk.moveTab(6, 10, 0)).locked, true, 'dropped into');
            eq((await Desk.moveTab(1, null, 0)).locked, true, 'dragged out of');
            eq((await Desk.renameGroup(10, 'nope')).locked, true, 'renamed');
            eq((await Desk.discardGroup(10)).locked, true, 'discarded');
            eq((await Desk.moveGroup(20, 10)).locked, true, 'the desk order');
            eq((await Desk.moveTab(6, 20, 0)).ok, true, 'another group still takes tabs');
            await Desk.lockGroup(10, 0);
            eq((await Desk.renameGroup(10, 'Renamed')).ok, true);
            eq(groups.find((g) => g.id === 10).title, 'Renamed');
        });
        await checkAsync('a dragged group stays whole and takes the place it is dropped on', async () => {
            for (const [moved, onto, want] of [
                [20, 10, '3:g20 4:g20 1:g10 2:g10 5:g30 6 7'],
                [10, 30, '3:g20 4:g20 1:g10 2:g10 5:g30 6 7'],
                [30, 20, '1:g10 2:g10 5:g30 3:g20 4:g20 6 7'],
            ]) {
                seed();
                await Desk.moveGroup(moved, onto);
                eq(strip(), want, `${moved} onto ${onto}`);
            }
        });
        await checkAsync('discarding a group closes its tabs and forgets its record alone', async () => {
            seed();
            await used([10, 1000], [20, 2000]);
            eq((await Desk.discardGroup(10)).ok, true);
            eq(strip(), '3:g20 4:g20 5:g30 6 7');
            eq(Object.keys(store[Kept.KEY] || {}), ['20']);
        });
    }

    // -------------------------------------------------------- framed plate

    section('the framed plate');

    const Corners = require('../src/shared/corners.js');
    const Plate = require('../src/page/plate.js');

    check('each skin gets its own corner set, and the default none', () => {
        eq(Plate.cornerForSkin('default'), 'plain');
        eq(Plate.cornerForSkin('riso'), 'blocks');
        eq(Plate.cornerForSkin('medieval'), 'bracket');
        eq(Plate.cornerForSkin('deco'), 'fan');
        eq(Plate.cornerForSkin('nonesuch'), 'plain', 'an unknown skin is undecorated');
    });

    check('the plain skin draws no corners at all', () => {
        eq(Plate.CORNERS.plain, []);
        eq(Plate.cornersHtml('plain'), '', 'not one empty svg either');
        eq(Plate.cornersHtml('nonesuch'), '');
    });

    check('a decorated skin draws its set into all four corners', () => {
        for (const name of ['blocks', 'bracket', 'fan']) {
            const html = Plate.cornersHtml(name);
            const corners = html.match(/<svg/g) || [];
            const paths = html.match(/<path/g) || [];
            eq(corners.length, 4, `${name} fills four corners`);
            eq(paths.length, Plate.CORNERS[name].length * 4, `${name} repeats its whole set`);
            eq(/viewBox="0 0 56 56"/.test(html), true, `${name} is drawn in a 56 box`);
        }
        // One corner drawn, the other three that same set flipped into place.
        const html = Plate.cornersHtml('blocks');
        eq((html.match(/transform:scale/g) || []).length, 3);
    });

    check('the corner colours come from the skin, never baked in', () => {
        const html = Plate.cornersHtml('bracket');
        eq(/stroke="var\(--accent\)"/.test(html), true);
        eq(/stroke="var\(--gold\)"/.test(html), true);
        eq(/fill="var\(--surface\)"/.test(html), true, 'the lozenge centre is punched out');
        eq(/fill="var\(--border-strong\)"/.test(Plate.cornersHtml('blocks')), true);
        eq(/#[0-9a-f]{3,6}/i.test(html), false, 'no literal colour anywhere');
    });

    check('the plate and the reader draw one set of corners, each in its own inks', () => {
        eq(Plate.CORNERS, Corners.SETS);
        eq(Corners.html('fan', { accent: 'var(--accent)', gold: 'var(--gold)' }, 'bb-plate-corner'), Plate.cornersHtml('fan'));
        const reader = Corners.html('fan', { accent: 'var(--rd-corner-accent)', gold: 'var(--rd-corner-gold)' }, 'rd-corner');
        eq((reader.match(/var\(--rd-corner-(accent|gold)\)/g) || []).length, Corners.SETS.fan.length * 4);
    });

    // -------------------------------------------------- the annotated board

    section('the annotated keyboard');

    const KeyboardWidget = require('../src/page/keyboard.js');

    check('every binding finds the keycap it is actually on', () => {
        const on = (id) => KeyboardWidget.kidOf(Keybindings.resolve(null, id));
        eq(on('skim-find'), 'KeyF');
        eq(on('skim-history'), 'KeyH');
        eq(on('skim-actions'), 'KeyA');
        eq(on('link-hints'), 'KeyL');
        eq(on('copy-markdown-link'), 'KeyL');
        eq(on('copy-page-link'), 'KeyY');
        eq(on('record-checkpoint'), 'KeyB');
        eq(on('chess-clear-arrows'), 'KeyC');
        // Matched by the character its cap prints, since these have no code
        // of their own that survives a layout change.
        eq(on('speed-up'), 'Period', 'the > cap');
        eq(on('speed-down'), 'Comma', 'the < cap');
        eq(on('speed-reset'), 'Equal', 'the + cap');
        // The three digit shortcuts share one label over the whole number row.
        eq(on('skip-forward'), 'digits');
        eq(on('skip-backward'), 'digits');
        eq(on('speed-boost'), 'digits');
    });

    check('a rebound shortcut moves to its new keycap', () => {
        const moved = Keybindings.resolve({ 'skim-find': { combo: { code: 'KeyG', key: 'G' } } }, 'skim-find');
        eq(KeyboardWidget.kidOf(moved), 'KeyG', 'the label follows the binding');
    });

    check('an unbound keystroke has no cap to point at', () => {
        eq(KeyboardWidget.kidOf({ kind: 'key', combo: { code: 'F13' } }), null);
        eq(KeyboardWidget.kidOf({ kind: 'key', combo: {} }), null);
    });

    check('a cap knows which row it is on, which is the lane its label takes', () => {
        eq(KeyboardWidget.rowOf('digits'), 0, 'the number row is annotated from above');
        eq(KeyboardWidget.rowOf('KeyF'), 2, 'the home row from the sides');
        eq(KeyboardWidget.rowOf('KeyB'), 3, 'the lower rows from below');
    });

    check('every scope on the tab strip is one the table knows', () => {
        const scopes = KeyboardWidget.SCOPES.map((item) => item.id);
        eq(scopes, ['general', 'youtube', 'chess', 'lichess']);
        // Lichess borrows the Chess.com bindings, so it is the one tab with
        // no scope of its own in the table.
        eq(scopes.filter((id) => Keybindings.list(null, id).length === 0), ['lichess']);
    });

    // ------------------------------------------------- daily time limits

    section('the list of sites held to a limit');

    const LimitSites = require('../src/shared/limit-sites.js');

    check('a host is reduced to a host, however it was typed', () => {
        eq(LimitSites.normalizeHost('https://www.News.YCombinator.com/item?id=1'), 'news.ycombinator.com');
        eq(LimitSites.normalizeHost('  X.com/  '), 'x.com');
        eq(LimitSites.isHost('x.com'), true);
        eq(LimitSites.isHost('com'), false, 'one label is a TLD, not a site');
        eq(LimitSites.isHost(''), false);
    });

    check('a clock time is read the way it is said', () => {
        // A field that only takes "07:00" is a field that rejects what
        // everybody types first.
        eq(LimitSites.parseClock('7am'), 420);
        eq(LimitSites.parseClock('7 AM'), 420);
        eq(LimitSites.parseClock('7:30 pm'), 1170);
        eq(LimitSites.parseClock('19:00'), 1140);
        eq(LimitSites.parseClock('12am'), 0, 'midnight, not noon');
        eq(LimitSites.parseClock('12pm'), 720, 'noon, not midnight');
        eq(LimitSites.parseClock('25:00'), null);
        eq(LimitSites.parseClock('7:75'), null);
        eq(LimitSites.parseClock('13pm'), null, 'no such hour on a 12-hour clock');
        eq(LimitSites.parseClock('elevenish'), null);
    });

    check('a stored window reads back in twelve hours', () => {
        eq(LimitSites.clockKey(420), '07:00');
        eq(LimitSites.clockText('19:30'), '7:30 pm');
        eq(LimitSites.clockText('00:05'), '12:05 am');
    });

    check('a row is a budget or a window, never neither', () => {
        eq(LimitSites.modeOf({ minutes: 30 }), 'budget');
        eq(LimitSites.modeOf({ from: '07:00', to: '09:00' }), 'window');
        eq(LimitSites.modeOf({ minutes: 0 }), 'none',
            'zero reads as no limit, not as blocked from the first second');
        eq(LimitSites.modeOf({ from: '07:00' }), 'none', 'half a window is not one');
        eq(LimitSites.modeOf(null), 'none');
        eq(LimitSites.allowanceOf({ minutes: 30 }), 1800);
        eq(LimitSites.allowanceOf({ from: '07:00', to: '09:00' }), null);
    });

    check('a window that crosses midnight is a window, not an empty one', () => {
        const at = (clock) => new Date(`2026-03-14T${clock}`).getTime();
        const night = { from: '22:00', to: '02:00' };
        // Read as from <= to this would block the site all day, which is the
        // sort of bug nobody reports because they assume they typed it wrong.
        eq(LimitSites.windowOpen(night, at('23:30')), true);
        eq(LimitSites.windowOpen(night, at('01:30')), true);
        eq(LimitSites.windowOpen(night, at('12:00')), false);

        const morning = { from: '07:00', to: '09:00' };
        eq(LimitSites.windowOpen(morning, at('07:00')), true, 'the start is inside');
        eq(LimitSites.windowOpen(morning, at('09:00')), false, 'the end is not');
        eq(LimitSites.windowOpen({ minutes: 30 }, at('12:00')), true,
            'a budget is not stopping you at any hour');
    });

    check('a row is only made from fields that describe a limit', () => {
        const then = 1000;
        eq(LimitSites.rowFrom({ host: 'x.com', minutes: '45' }, then),
            { host: 'x.com', entry: { minutes: 45, savedAt: then } });
        eq(LimitSites.rowFrom({ host: 'x.com', from: '7am', to: '9am' }, then),
            { host: 'x.com', entry: { from: '07:00', to: '09:00', savedAt: then } });
        // Minutes win, so a half-filled window beside a budget cannot make a
        // row that says one thing and behaves as the other.
        eq(LimitSites.rowFrom({ host: 'x.com', minutes: 20, from: 'nonsense' }, then).entry.minutes, 20);
        eq(LimitSites.rowFrom({ host: 'com', minutes: 20 }, then), null);
        eq(LimitSites.rowFrom({ host: 'x.com' }, then), null, 'no limit at all is not a row');
        eq(LimitSites.rowFrom({ host: 'x.com', from: '7am', to: '7am' }, then), null,
            'a window of no length is not a limit');
    });

    check('a row answers for its subdomains but never for a bare TLD', () => {
        const sites = { 'reddit.com': { minutes: 30 } };
        eq(LimitSites.entryFor(sites, 'old.reddit.com').host, 'reddit.com');
        eq(LimitSites.entryFor(sites, 'www.reddit.com').host, 'reddit.com');
        eq(LimitSites.entryFor(sites, 'x.com'), null);
        eq(LimitSites.entryFor({ com: { minutes: 1 } }, 'x.com'), null,
            'a row for a TLD would answer for the web');
    });

    check('a row says what it allows in one line', () => {
        eq(LimitSites.describe({ minutes: 30 }), '30 minutes a day');
        eq(LimitSites.describe({ minutes: 90 }), '1h 30m a day');
        eq(LimitSites.describe({ minutes: 120 }), '2h a day');
        eq(LimitSites.describe({ from: '07:00', to: '09:00' }), 'only 7:00 am to 9:00 am');
        eq(LimitSites.describe(null), 'no limit');
    });

    check('the keys the list seeds itself from are settings that exist', () => {
        const Settings = require('../src/shared/settings.js');
        for (const old of LimitSites.LEGACY) {
            eq(old.onKey in Settings.DEFAULTS, true, old.onKey);
            eq(old.minutesKey in Settings.DEFAULTS, true, old.minutesKey);
        }
    });

    await checkAsync('the list seeds itself once, and two changes made together both stay', () => withCopiedReads(async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        Object.assign(store, { twitterDailyLimit: true, twitterLimitMinutes: 25 });
        eq(Object.keys(await LimitSites.load()), ['x.com']);
        eq(store[LimitSites.KEY]['x.com'].minutes, 25, 'the seed was not written');
        await Promise.all([LimitSites.remember({ host: 'news.test', minutes: 10 }), LimitSites.forget('x.com')]);
        eq(Object.keys(await LimitSites.load()), ['news.test'], 'one of the two changes was written over');
        await LimitSites.forget('news.test');
        eq(await LimitSites.load(), {}, 'an emptied list seeded itself again');
    }));

    section('what today has gone on, against the limit');

    const TimeLimits = require('../src/shared/time-limits.js');

    const A_DAY = 864e5;
    const noon = new Date('2026-03-14T12:00:00').getTime();

    // A tally straight into the store. add() caps a single credit, which is
    // the right thing for a real one and no way to set up an afternoon.
    const spent = (host, seconds, when = noon) => ({
        day: TimeLimits.dayKey(when),
        seconds: { [host]: seconds },
        snoozed: {},
    });

    check('the two named sites are the ones detectSite already names', () => {
        // Not "the sites a limit can be set on" — that is whatever is in the
        // list. These two are the ones with a workspace, so a card can say
        // "Twitter" rather than "x.com".
        eq(TimeLimits.ids(), ['twitter', 'reddit']);
        eq(TimeLimits.get('twitter').host, 'x.com');
        eq(TimeLimits.get('twitter').name, 'Twitter', 'the site renamed itself; nobody else did');
        eq(TimeLimits.get('youtube'), null);
    });

    check('yesterday is discarded whole, not aged out', () => {
        const yesterday = spent('x.com', 600, noon - A_DAY);
        eq(TimeLimits.forDay(yesterday, noon - A_DAY).seconds['x.com'], 600);
        const today = TimeLimits.forDay(yesterday, noon);
        eq(today.seconds['x.com'], undefined, 'the store is one day deep by design');
        eq(today.day, TimeLimits.dayKey(noon));
    });

    check('time adds up per host, and a single credit is capped', () => {
        let state = TimeLimits.blank(noon);
        state = TimeLimits.add(state, 'reddit.com', 15, noon);
        state = TimeLimits.add(state, 'www.reddit.com', 15, noon);
        eq(state.seconds['reddit.com'], 30, 'www. is the same site');
        // A laptop lid closed for three hours reports one enormous gap; the
        // cap is what stops the night being charged to the morning.
        state = TimeLimits.add(state, 'reddit.com', 3 * 3600, noon);
        eq(state.seconds['reddit.com'], 30 + TimeLimits.MAX_CREDIT);
        eq(TimeLimits.add(state, 'reddit.com', -5, noon).seconds['reddit.com'], 30 + TimeLimits.MAX_CREDIT,
            'a negative gap credits nothing');
    });

    check('a host with no row has no limit at all', () => {
        const state = spent('x.com', 4000);
        const off = TimeLimits.statusFor(state, null, 'x.com', noon);
        eq(off.on, false);
        eq(off.mode, 'none');
        eq(off.blocked, false, 'nothing is blocked by a limit nobody set');
        eq(off.spent, 4000, 'but what was spent is still there to show');

        const zero = TimeLimits.statusFor(state, { minutes: 0 }, 'x.com', noon);
        eq(zero.on, false);
        eq(zero.blocked, false);
    });

    check('the block lands when the day is spent, not before', () => {
        const limit = { minutes: 30 };
        const under = spent('reddit.com', 1700);
        eq(TimeLimits.statusFor(under, limit, 'reddit.com', noon).blocked, false);
        eq(TimeLimits.statusFor(under, limit, 'reddit.com', noon).remaining, 100);

        const over = TimeLimits.add(under, 'reddit.com', 100, noon);
        const status = TimeLimits.statusFor(over, limit, 'reddit.com', noon);
        eq(status.blocked, true);
        eq(status.remaining, 0);
        eq(status.allowed, 1800);
    });

    check('a window blocks by the clock rather than by the tally', () => {
        const limit = { from: '07:00', to: '09:00' };
        const state = spent('x.com', 4000);
        const inside = TimeLimits.statusFor(state, limit, 'x.com', new Date('2026-03-14T08:00').getTime());
        eq(inside.blocked, false, 'four thousand seconds inside the window is fine');
        eq(inside.allowed, null, 'a window has no budget to be a fraction of');

        const outside = TimeLimits.statusFor(state, limit, 'x.com', noon);
        eq(outside.blocked, true);
        eq(outside.mode, 'window');
    });

    check('a snooze stands the block down without stopping the clock', () => {
        const over = spent('reddit.com', 2000);
        const limit = { minutes: 30 };
        eq(TimeLimits.statusFor(over, limit, 'reddit.com', noon).blocked, true);

        const once = TimeLimits.snooze(over, 'reddit.com', noon);
        const status = TimeLimits.statusFor(once, limit, 'reddit.com', noon);
        eq(status.blocked, false);
        eq(status.snoozes, 1);
        eq(status.snoozedUntil, noon + TimeLimits.SNOOZE_MS);
        // The tally kept running, so the ten minutes come out of the same
        // day's allowance rather than being granted on top of it.
        eq(status.spent, 2000);

        const later = noon + TimeLimits.SNOOZE_MS + 1000;
        eq(TimeLimits.statusFor(once, limit, 'reddit.com', later).blocked, true, 'ten minutes, not forever');
        eq(TimeLimits.snoozesOn(once, 'reddit.com', later), 1,
            'a lapsed snooze still counts, or the sheet says "first" every ten minutes');
        eq(TimeLimits.snoozesOn(TimeLimits.snooze(once, 'reddit.com', later), 'reddit.com', later), 2);
    });

    check('a snooze from another day is gone with the tally', () => {
        const yesterday = TimeLimits.snooze(spent('x.com', 10, noon - A_DAY), 'x.com', noon - A_DAY);
        eq(TimeLimits.snoozesOn(yesterday, 'x.com', noon), 0);
    });

    check('a tally from another day cannot block today', () => {
        const yesterday = spent('reddit.com', 9999, noon - A_DAY);
        const status = TimeLimits.statusFor(yesterday, { minutes: 30 }, 'reddit.com', noon);
        eq(status.spent, 0);
        eq(status.blocked, false);
    });

    check('a day is a local day, so a limit runs to local midnight', () => {
        // Not UTC: a limit that reset at 4am because that is when midnight
        // falls in London would be nobody's idea of a daily limit.
        eq(TimeLimits.dayKey(noon), '2026-03-14');
        eq(TimeLimits.dayKey(new Date('2026-03-14T23:59:59').getTime()), '2026-03-14');
        eq(TimeLimits.dayKey(new Date('2026-03-15T00:00:01').getTime()), '2026-03-15');
    });

    check('durations read the way a person would say them', () => {
        eq(TimeLimits.human(0), '0s');
        eq(TimeLimits.human(45), '45s');
        eq(TimeLimits.human(1800), '30m');
        eq(TimeLimits.human(3600), '1h');
        eq(TimeLimits.human(4500), '1h 15m');
    });

    check('a snooze tally reads as a count of times', () => {
        const TimeLimitContent = require('../src/content/time-limit.js');
        eq(TimeLimitContent.times(1), 'once');
        eq(TimeLimitContent.times(2), 'twice');
        eq(TimeLimitContent.times(5), '5 times');
    });

    await checkAsync('two changes a page makes together both land', async () => {
        // A tick and the Snooze button each read, changed and wrote on their
        // own, and whichever wrote second dropped what the other had added.
        clearStore();
        const now = Date.now();
        await Promise.all([
            TimeLimits.update((state) => TimeLimits.add(state, 'x.com', 30, now)),
            TimeLimits.update((state) => TimeLimits.snooze(state, 'x.com', now)),
        ]);
        const state = await TimeLimits.load();
        eq([state.seconds['x.com'], TimeLimits.snoozesOn(state, 'x.com', now)], [30, 1]);
    });

    /** A page of `host` under a 30-minute limit, on a clock the check moves; `looking` is whether it is being looked at. */
    async function limitedPage(host, clock, { appearance = async () => ({}) } = {}) {
        const TimeLimitContent = require('../src/content/time-limit.js');
        await LimitSites.remember({ host, minutes: 30 });
        const view = { looking: true, shown: [] };
        const element = () => ({ dataset: {}, addEventListener() {}, remove() { view.shown = view.shown.filter((one) => one !== this); } });
        const doc = {
            visibilityState: 'visible', hasFocus: () => view.looking, createElement: element, addEventListener() {},
            documentElement: { append: (one) => view.shown.push(one) },
        };
        view.page = TimeLimitContent.createTimeLimit({ site: 'other', host, appearance, now: () => clock.at, doc, win: { addEventListener() {} } });
        await view.page.install();
        view.done = async () => {
            await LimitSites.forget(host);
            await view.page.reload();
        };
        return view;
    }
    const written = () => new Promise((done) => setTimeout(done, 20));

    await checkAsync('a visit shorter than a tick is banked as the page stops being looked at, and once', async () => {
        // Losing focus cleared the mark before anything was banked: ten
        // seconds and then a blur counted for nothing.
        clearStore();
        const clock = { at: Time.startOfDay(Date.now()) + A_DAY / 2 };
        const view = await limitedPage('brief.test', clock);
        try {
            clock.at += 10000;
            view.looking = false;
            view.page.sync(); // blur
            view.page.sync(); // and the visibilitychange after it
            await written();
            eq(TimeLimits.spentOn(await TimeLimits.load(), 'brief.test'), 10);
            view.looking = true;
            view.page.sync();
            clock.at += 8000;
            await view.page.bank(); // pagehide
            eq(TimeLimits.spentOn(await TimeLimits.load(), 'brief.test'), 18, 'a second short visit');
        } finally {
            await view.done();
        }
    });
    await checkAsync('a visit across midnight counts only the part after it', async () => {
        clearStore();
        const clock = { at: Time.startOfDay(Date.now()) + A_DAY - 10000 };
        const view = await limitedPage('late.test', clock);
        try {
            clock.at += 30000;
            await view.page.bank();
            await written();
            eq(store[TimeLimits.KEY], { day: TimeLimits.dayKey(clock.at), seconds: { 'late.test': 20 }, snoozed: {} });
        } finally {
            await view.done();
        }
    });

    await checkAsync('a sheet stood down while its look was still being read is never put up', async () => {
        clearStore();
        const clock = { at: Date.now() };
        store[TimeLimits.KEY] = spent('spent.test', 1800, clock.at);
        let looked = null;
        const view = await limitedPage('spent.test', clock, { appearance: () => new Promise((done) => { looked = done; }) });
        try {
            assert(looked, 'a spent budget did not ask for the sheet');
            await view.page.snooze();
            looked({ theme: 'dark', skin: 'deco' });
            await written();
            eq(view.shown, [], 'the snoozed sheet went up anyway');
        } finally {
            await view.done();
        }
    });

    await checkAsync('a change whose read failed writes nothing, and answers null', async () => {
        clearStore();
        const now = Date.now();
        store[TimeLimits.KEY] = TimeLimits.add(TimeLimits.blank(now), 'x.com', 90, now);
        const realGet = global.chrome.storage.local.get;
        global.chrome.storage.local.get = () => Promise.reject(new Error('Extension context invalidated.'));
        const quiet = console.error;
        console.error = () => {};
        let answer;
        try {
            answer = await TimeLimits.update((state) => TimeLimits.add(state, 'x.com', 30, now));
        } finally {
            global.chrome.storage.local.get = realGet;
            console.error = quiet;
        }
        eq(answer, null, 'the page keeps the state it had');
        eq(store[TimeLimits.KEY].seconds['x.com'], 90, 'today\'s tally is not reset to one credit');
    });

    // ------------------------------------------------------- the roster

    section('a site roster, out to a file and back');

    const Roster = require('../src/shared/roster.js');

    check('a line becomes a bare name however it was written', () => {
        // The file is one a person may well have edited by hand, so the way
        // in is generous; the way out is the site's own alphabet exactly,
        // because the result ends up in a URL that gets navigated to.
        eq(Roster.parseName('@alice', 'twitter'), 'alice');
        eq(Roster.parseName('https://x.com/bob/status/12345', 'twitter'), 'bob');
        eq(Roster.parseName('  carol,  ', 'twitter'), 'carol');
        eq(Roster.parseName('# a comment', 'twitter'), '');
        eq(Roster.parseName('alice # who I met once', 'twitter'), 'alice');
        eq(Roster.parseName('a_handle_far_too_long', 'twitter'), '',
            'X handles are fifteen characters, and this is not one');
        eq(Roster.parseName('someone@example.com', 'twitter'), '', 'an email is not a handle');

        eq(Roster.parseName('r/rust', 'reddit'), 'rust');
        eq(Roster.parseName('/r/Rust/', 'reddit'), 'Rust');
        eq(Roster.parseName('https://old.reddit.com/r/cpp/', 'reddit'), 'cpp');
        eq(Roster.parseName('x', 'reddit'), '', 'too short to be a subreddit');
    });

    check('a file becomes a list in order, without duplicates', () => {
        const names = Roster.parseList('@Alice\n# skip me\n/Alice/\n@bob\n\n@Alice\n', 'twitter');
        // Case is folded for the duplicate check and kept in the name: a list
        // that comes back with everybody lower-cased looks damaged.
        eq(names, ['Alice', 'bob']);
    });

    check('the file written out can be read back in', () => {
        const names = ['rust', 'cpp', 'Emacs'];
        const text = Roster.toText('reddit', names, 0);
        eq(Roster.parseList(text, 'reddit'), names, 'a round trip changes nothing');
        eq(text.split('\n')[0].startsWith('#'), true, 'and the header is a comment');
    });

    check('the pace is per site, and Twitter gets the slower one', () => {
        // Reddit rate-limits an account and says so; Twitter suspends one and
        // does not. The two deserve different amounts of caution.
        const x = Roster.siteOf('twitter').pace;
        const reddit = Roster.siteOf('reddit').pace;
        eq(x.cap < reddit.cap, true);
        eq(x.minMs > reddit.minMs, true);
    });

    check('a delay lands inside the site range and is never the same twice', () => {
        const { minMs, maxMs } = Roster.siteOf('twitter').pace;
        eq(Roster.nextDelay('twitter', () => 0), minMs);
        eq(Roster.nextDelay('twitter', () => 1), maxMs);
        // Jittered rather than fixed, and not only out of politeness: a click
        // exactly every forty seconds for an hour is a signature.
        eq(Roster.nextDelay('twitter', () => 0.5), Math.round((minMs + maxMs) / 2));
    });

    check('a plan says how many days it is before anything starts', () => {
        const plan = Roster.plan('twitter', new Array(412).fill('x'));
        eq(plan.total, 412);
        eq(plan.cap, 40);
        eq(plan.days, 11, 'nobody should find out on day three that it is eleven');
        eq(Roster.plan('twitter', []).total, 0);
    });

    check('a job with something left to do is not started over', () => {
        const job = Roster.newJob({ site: 'twitter', action: 'apply', names: ['a', 'b'] });
        eq(Roster.isOpen(job), true);
        eq(Roster.isOpen({ ...job, status: 'paused' }), true, 'stopped on something is not finished');
        eq(Roster.isRunning({ ...job, status: 'paused' }), false, 'though it is not running either');
        eq(Roster.isOpen({ ...job, status: 'waiting' }), true);
        eq(Roster.isOpen({ ...job, status: 'done' }), false);
        eq(Roster.isOpen(null), false);
    });

    check('the plan is said as one sentence, on the page that will run it', () => {
        eq(Roster.spanText(60000 * 27), '27 minutes');
        eq(Roster.spanText(60000 * 150), '2h 30m');
        eq(Roster.spanText(60000 * 120), '2 hours');
        eq(Roster.spanText(1000), '1 minutes', 'never "0 minutes" for something that takes any time at all');

        const said = Roster.planText('twitter', ['alice', 'Bob', 'carol'], ['bob']);
        eq(said.startsWith('3 accounts, 2 not in your last read. You press Follow on each'), true, said);
        eq(said.includes('25–55 seconds later, up to 40 a day'), true, said);
        eq(said.includes('1 day in all'), true, said);
        eq(Roster.planText('reddit', ['rust']).startsWith('1 subreddit. You press Join'), true,
            'nothing read yet is nothing to compare against');
        eq(Roster.planText('reddit', []), '');
    });

    check('a job belongs to the tab that was asked to run it', () => {
        const job = Roster.newJob({ site: 'twitter', action: 'apply', names: ['a', 'b'], tabId: 41, now: noon });
        eq(job.tabId, 41);
        eq(Roster.newJob({ site: 'twitter', action: 'read' }).tabId, null, 'and one nobody was asked for is nobody\'s');
        eq('leaseBy' in job || 'kickedAt' in job, false, 'the tab stands in for the lease and the kick');
    });

    check('where a job sent its tab is written down, for a while', () => {
        const job = Roster.newJob({ site: 'reddit', action: 'read', tabId: 41, now: noon });
        eq(Roster.wasSent(job, noon), false, 'it has sent it nowhere yet');

        const sent = Roster.heading(job, '/Subreddits/Mine/', noon);
        eq(sent.headingTo, '/subreddits/mine/', 'a path is compared in one case');
        eq(Roster.wasSent(sent, noon + 5000), true, 'a page loading now was sent here, or somewhere else instead');
        eq(Roster.wasSent(sent, noon + Roster.SENT_MS + 1), false,
            'later, the tab being elsewhere is the user\'s doing and not the site\'s');
        eq(Roster.wasSent(Roster.arrived(sent), noon + 5000), false, 'and it has arrived');
    });

    check('the cap is a cap per day, because the job outlives the day', () => {
        const noonJob = { ...Roster.newJob({ site: 'twitter', action: 'apply', names: ['a'], now: noon }), today: 40 };
        eq(Roster.atCap(noonJob, noon), true);
        // Tomorrow it carries on rather than being finished at forty.
        eq(Roster.atCap(noonJob, noon + A_DAY), false);
        eq(Roster.forDay(noonJob, noon + A_DAY).today, 0);
    });

    check('progress and the current name walk the list together', () => {
        const job = Roster.newJob({ site: 'reddit', action: 'apply', names: ['rust', 'cpp', 'go'] });
        eq(Roster.currentName(job), 'rust');
        eq(Roster.progress(job), 0);
        eq(Roster.progress({ ...job, at: 3 }), 100);
        eq(Roster.currentName({ ...job, at: 3 }), '', 'past the end is done, not a crash');
        eq(Roster.progress(Roster.newJob({ site: 'reddit', action: 'read' })), 0,
            'a read job has no total to be a fraction of');
    });

    check('a handle is read off an href, and a site page is not a handle', () => {
        const RosterContent = require('../src/content/roster.js');
        eq(RosterContent.handleFromHref('/alice'), 'alice');
        eq(RosterContent.handleFromHref('https://x.com/bob/following'), 'bob');
        eq(RosterContent.handleFromHref('/home'), '', "X's own pages sit at a one-segment path too");
        eq(RosterContent.subFromHref('https://old.reddit.com/r/rust/'), 'rust');
        eq(RosterContent.subFromHref('/user/someone'), '');
    });

    await checkAsync('a job is not cleared by a read that failed', async () => {
        // The failed read came back as no job, a step handed no job hands back
        // none, and that was written over a job with days still to run.
        clearStore();
        const job = Roster.newJob({ site: 'reddit', action: 'apply', names: ['rust', 'golang'] });
        store[Roster.JOB_KEY] = job;
        const realGet = global.chrome.storage.local.get;
        global.chrome.storage.local.get = () => Promise.reject(new Error('Extension context invalidated.'));
        const quiet = console.error;
        console.error = () => {};
        let next;
        try {
            next = await Roster.updateJob((current) => (current && current.site === 'reddit' ? Roster.release(current) : current));
        } finally {
            global.chrome.storage.local.get = realGet;
            console.error = quiet;
        }
        eq(next, null, 'the page stops rather than presses on');
        eq(store[Roster.JOB_KEY], job);
    });

    await checkAsync('a page the job is not for writes nothing back, and a job can still be cleared', async () => {
        clearStore();
        store[Roster.JOB_KEY] = Roster.newJob({ site: 'reddit', action: 'read' });
        const realSet = global.chrome.storage.local.set;
        let writes = 0;
        global.chrome.storage.local.set = (...args) => { writes++; return realSet(...args); };
        try {
            const job = await Roster.updateJob((current) => (current && current.site === 'twitter' ? Roster.release(current) : current));
            eq([job.site, writes], ['reddit', 0], 'handed back unchanged, so not written over the reddit page\'s step');
            eq(await Roster.updateJob(() => null), null);
            eq([store[Roster.JOB_KEY], writes], [null, 1]);
        } finally {
            global.chrome.storage.local.set = realSet;
        }
    });

    await checkAsync('a roster read is kept per site, beside the other site\'s', async () => {
        clearStore();
        await Roster.saveRoster('twitter', ['ana'], 5);
        await Roster.saveRoster('reddit', ['rust'], 6);
        eq(await Roster.loadRosters(), { twitter: { names: ['ana'], readAt: 5 }, reddit: { names: ['rust'], readAt: 6 } });
    });

    // ------------------------------------------------------------- skim

    section('skim — where the match lands');

    const Skim = require('../src/shared/skim.js');

    // A 900px window with a 260px launcher centred in it: the launcher runs
    // from 320 to 580, so a match belongs at 620 — GAP below it.
    const window900 = { viewport: 900, scrollMax: 4000, height: 260 };

    check('the match is placed just under the launcher, not down the page', () => {
        eq(Skim.landing('center', 900, 260), 620);
        const out = Skim.plan({ ...window900, scrollTop: 0, target: 1620 });
        eq(out.pos, 'center', 'the launcher does not move for an ordinary match');
        eq(out.scrollTop, 1000, 'the page comes to the match, 620px down the window');
        eq(out.moved, true);
    });

    check('a match already under the launcher does not move the page', () => {
        const out = Skim.plan({ ...window900, scrollTop: 1000, target: 1622 });
        eq(out.scrollTop, 1000);
        eq(out.moved, false, 'moving the page under someone already looking at it is the worst case');
        eq(out.note, 'already in place');
    });

    check('at the end of the page the launcher rises instead', () => {
        const out = Skim.plan({ ...window900, scrollTop: 3900, target: 4800 });
        eq(out.pos, 'top', 'there is no scroll left to spend');
        eq(out.scrollTop, 4000, 'and the page stops at its own end');
    });

    check('at the top of the page the launcher drops off a match it covers', () => {
        const out = Skim.plan({ ...window900, scrollTop: 0, target: 300, size: 20 });
        eq(out.pos, 'bottom');
        eq(out.scrollTop, 0, 'a page that cannot scroll up is not asked to');
    });

    check('a match already readable moves nothing, above the launcher or below it', () => {
        const above = Skim.plan({ ...window900, scrollTop: 0, target: 120, size: 20 });
        eq([above.pos, above.moved], ['center', false], 'the launcher hopped off a match it was not covering');
        const below = Skim.plan({ ...window900, scrollTop: 1000, target: 1800, size: 20 });
        eq(below.moved, false, 'arrowing to the next match on screen lurched the page');
        const foot = Skim.plan({ ...window900, scrollTop: 1000, target: 1000 + 900 - Skim.FOOT + 1, size: 0 });
        eq(foot.moved, true, 'a match against the window\'s foot is brought up');
    });

    check('a match the page draws over is placed, though it is on screen', () => {
        const out = Skim.plan({ ...window900, scrollTop: 1000, target: 1030, size: 20, covered: true });
        eq([out.pos, out.scrollTop], ['center', 410], 'a sticky header over the match was taken as read');
    });

    check('a launcher at an edge stays there while the page can bring matches to it', () => {
        const out = Skim.plan({ ...window900, scrollTop: 3000, target: 2000, size: 20, pos: 'top' });
        eq(out.pos, 'top', 'back to the centre for one match, and out again for the next');
        eq(out.scrollTop, 2000 - Skim.landing('top', 900, 260));
        const stuck = Skim.plan({ ...window900, scrollTop: 0, target: 100, size: 20, pos: 'top' });
        eq(stuck.pos, 'bottom', 'kept at the top over a match it covers, with no scroll to move it');
    });

    check('a far match is glided to over the last stretch only, in a third of a second or so', () => {
        const near = Skim.glide(0, 600, 900);
        eq(near, { start: 0, ms: 350 }, 'a near match glides the whole way');
        const far = Skim.glide(0, 5000, 900);
        eq(far.start, 5000 - 360, 'the page went most of the way at once');
        const back = Skim.glide(5000, 0, 900);
        eq(back.start, 360, 'and the same going up');
        eq(Skim.glide(0, 20, 900).ms, 200, 'a short hop is still seen to move');
        eq(Skim.glide(0, 1100, 900).ms, 380, 'and a long glide is capped');
    });

    section('skim — the hit colours');

    const rgbOf = (hex) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), a: 1 });
    const inkOn = (hex) => Skim.HIT_INKS[Skim.hitInk(rgbOf(hex))].ink;

    check('a match is marked in an ink that stands out on what it sits on, not the skin\'s', () => {
        eq(inkOn('#ffffff'), '#c8102e', 'a white page');
        eq(inkOn('#0f0f0f'), '#ffd60a', 'a dark page');
        eq(inkOn('#1e1e1e'), '#ffd60a', 'a code block');
        eq(inkOn('#c62828'), '#ffd60a', 'red on a red banner vanished');
        eq(inkOn('#5a4a00'), '#00c8ff', 'yellow on an olive band reads as part of it');
        eq(inkOn('#808080'), '#141414', 'a mid grey none of the colours stands out on');
        for (const hex of ['#ffffff', '#0f0f0f', '#fff3b0', '#c62828', '#1a73e8', '#808080', '#ff9800', '#ecdcb8', '#36393f']) {
            const ink = rgbOf(inkOn(hex));
            assert(Skim.contrast(ink, rgbOf(hex)) >= 3, `under 3:1 on ${hex}`);
        }
    });

    check('the colour behind a match is read through translucent layers', () => {
        eq(Skim.parseColor('rgba(0, 0, 0, 0)'), { r: 0, g: 0, b: 0, a: 0 });
        eq(Skim.parseColor('rgb(10 20 30 / 50%)'), { r: 10, g: 20, b: 30, a: 0.5 });
        eq(Skim.parseColor('oklch(0.5 0.1 20)'), null, 'left for the page to convert');
        eq(Skim.over({ r: 0, g: 0, b: 0, a: 0.5 }, rgbOf('#ffffff')), { r: 128, g: 128, b: 128, a: 1 });
        eq(Skim.over(null, rgbOf('#ffffff')), rgbOf('#ffffff'), 'a clear element is what is under it');
    });

    check('every ink has its highlight in content.css, and no skin colours the hits', () => {
        const css = readRepo('content.css');
        Skim.HIT_INKS.forEach((_, i) => {
            assert(css.includes(`::highlight(bb-skim-hit-${i}) { background-color: var(--bb-skim-ink-${i}); }`), `no highlight for ink ${i}`);
        });
        assert(!/data-bb-skim-skin/.test(css + readRepo('src/content/skim.js')), 'the hits still follow the skin');
    });

    check('a match in a sticky panel moves the launcher, never the page', () => {
        const high = Skim.plan({ ...window900, scrollTop: 500, target: 560, pinned: true });
        eq(high.pos, 'bottom', 'the match is near the top, so the launcher goes low');
        eq(high.scrollTop, 500, 'scrolling cannot move a sticky panel');
        const low = Skim.plan({ ...window900, scrollTop: 500, target: 1300, pinned: true });
        eq(low.pos, 'top');
    });

    section('skim — the list');

    check('hint labels are one character until the alphabet runs out', () => {
        eq(Skim.hintLabels(3, 'fjd'), ['f', 'j', 'd']);
        eq(Skim.hintLabels(4, 'fjd'), ['ff', 'jf', 'df', 'fj'],
            'the first character is spread, so one keystroke clears most of the board');
        eq(Skim.hintLabels(0, 'fjd'), []);
        eq(Skim.hintLabels(2, '123'), ['f', 'j'], 'a set with no letters in it falls back');
    });

    check('two characters begin the match, one does nothing', () => {
        const rows = [{ title: 'Latency budgets', sub: 'notes.example' }, { title: 'Inbox', sub: 'mail.example' }];
        eq(Skim.filterRows(rows, 'l').length, 0);
        eq(Skim.filterRows(rows, 'la').map((r) => r.title), ['Latency budgets']);
        eq(Skim.filterRows(rows, 'example').length, 2, 'the subtitle counts too');
    });

    check('a snippet carries the line either side of the match', () => {
        const out = Skim.snippet('the quick brown fox', 4, 5, 4);
        eq(out.mid, 'quick');
        eq(out.pre, 'the ');
        eq(out.post, ' bro…');
    });

    check('the picked source leads and the rest still follow', () => {
        const groups = Skim.SOURCES.map((source) => ({ source }));
        eq(Skim.orderGroups(groups, 'history').map((g) => g.source),
            ['history', 'page', 'tabs', 'actions']);
        eq(Skim.nextSource('actions'), 'page', 'cycling wraps');
    });

    check('every action the list offers is one the worker can run', () => {
        const worker = require('fs').readFileSync(`${__dirname}/../src/background/skim.js`, 'utf8');
        for (const action of Skim.ACTIONS) {
            eq(worker.includes(`'${action.id}'`), true, `${action.id} has no branch in the worker`);
        }
    });

    // ----------------------------------------------------- the pouch grid

    check('the pouch grid draws a screenful of cards and offers the rest', () => {
        // With Subscriptions on, All can be thousands of cards, and each was
        // rebuilt on every redraw while the feeds came in.
        const PouchSheet = require('../src/content/pouch-sheet.js');
        const step = PouchSheet.CARDS_STEP;
        const list = Array.from({ length: step * 2 + 7 }, (_, i) => ({ id: `v${i}` }));
        const card = (video) => `<a data-video-id="${video.id}"></a>`;
        const cards = (html) => (html.match(/data-video-id/g) || []).length;

        const first = PouchSheet.cardsHtml(list, step, card);
        eq(cards(first), step);
        assert(first.includes(`Show ${step} more of ${step + 7}`), first.slice(-120));
        const last = PouchSheet.cardsHtml(list, step * 3, card);
        eq([cards(last), last.includes('data-bb-more')], [list.length, false], 'all of it, and nothing more to offer');
        assert(PouchSheet.cardsHtml(list, step * 2, card).includes('Show 7 more of 7'));
    });

    // ------------------------------------------------------ the skin faces

    await checkAsync('the faces are added once, at the extension\'s own address, and only for a skin that has them', async () => {
        const Theme = require('../src/content/theme.js');
        const saved = { document: globalThis.document, FontFace: globalThis.FontFace, chrome: globalThis.chrome, getComputedStyle: globalThis.getComputedStyle };
        const added = [];
        let skin = 'default';
        globalThis.document = { fonts: { add: (face) => added.push(face) }, documentElement: { hasAttribute: () => false } };
        globalThis.getComputedStyle = () => ({ colorScheme: 'light', getPropertyValue: () => '' });
        globalThis.FontFace = class { constructor(family, src, descriptors) { Object.assign(this, { family, src, descriptors }); } };
        globalThis.chrome = {
            runtime: { getURL: (path) => `chrome-extension://abc/${path}` },
            storage: { local: { get: async () => ({ skin }) } },
        };
        try {
            await Theme.appearance();
            eq(added.length, 0, 'the default skin uses the system stack');
            skin = 'medieval';
            await Theme.appearance();
            Theme.dress({ classList: { add() {} }, dataset: {} }, { theme: 'dark', skin: 'deco' });
            eq(added.length, Theme.FACES.length, 'every face, once');
            eq(added[0].src, 'url("chrome-extension://abc/fonts/Cardo-Regular.woff2") format("woff2")');
            eq(added[0].descriptors.display, 'swap');
        } finally {
            Object.assign(globalThis, saved);
        }
    });

    // ---------------------------------------------------------- DomWatch

    section('the shared DOM watcher');

    await checkAsync('a task that asks for an interval runs at most that often, and is owed the pass it skipped', async () => {
        // X and the chat sites mutate nearly every frame. The owed pass matters:
        // without it a mutation inside the interval waited for the next, or the 3s poll.
        const DomWatch = require('../src/content/dom-watch.js');
        const saved = ['requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'document'].map((name) => [name, globalThis[name]]);
        let mutate = null;
        globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 1);
        globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
        globalThis.MutationObserver = class { constructor(fn) { mutate = fn; } observe() {} disconnect() {} };
        globalThis.document = { body: {} };
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const watcher = DomWatch.createWatcher();
        try {
            const runs = { slow: [], fast: 0 };
            const t0 = Date.now();
            watcher.add('slow', () => { runs.slow.push(Date.now() - t0); return false; }, { every: 150 });
            watcher.add('fast', () => { runs.fast++; return false; });
            await wait(20);
            for (let i = 0; i < 5; i++) { mutate(); await wait(10); }
            eq(runs.slow.length, 1, 'mutations inside the interval ran it again');
            assert(runs.fast >= 5, `the untimed task ran ${runs.fast} times for 5 mutations`);
            await wait(250);
            eq(runs.slow.length, 2, 'the skipped mutations were owed one pass, with nothing else to trigger it');
            assert(runs.slow[1] >= 140, `the owed pass came ${runs.slow[1]}ms after the first`);
        } finally {
            watcher.stop();
            for (const [name, value] of saved) globalThis[name] = value;
        }
    });

    // ------------------------------------------------------- watched marks

    section('watched marks');

    /** A fresh copy of the module, as a second tab would have. */
    const watchedInTab = () => {
        delete require.cache[require.resolve('../src/shared/watched.js')];
        return require('../src/shared/watched.js');
    };

    await checkAsync('two tabs marking videos watched both keep their marks', async () => {
        // Each tab cached the map it read at load and wrote that back with its
        // own mark added, so whichever wrote last erased the other's.
        clearStore();
        const [one, two] = [watchedInTab(), watchedInTab()];
        await one.load();
        await two.load();
        await one.mark('a');
        await two.mark('b');
        eq(Object.keys(store.bbWatchedVideos).sort(), ['a', 'b']);
        eq(Object.keys(await two.mark('c')).sort(), ['a', 'b', 'c'], 'and resolves to what was written');
    });

    await checkAsync('a mark the pouch sheet set in what load() handed it is still written', async () => {
        clearStore();
        const Watched = watchedInTab();
        const seen = await Watched.load();
        seen.v1 = Date.now(); // what the sheet does before it calls mark()
        await Watched.mark('v1');
        eq(Object.keys(store.bbWatchedVideos || {}), ['v1']);
    });

    await checkAsync('a read that failed is not taken for an empty map and written over the marks', async () => {
        clearStore();
        store.bbWatchedVideos = { old: 1 };
        const Watched = watchedInTab();
        const realGet = global.chrome.storage.local.get;
        global.chrome.storage.local.get = () => Promise.reject(new Error('Extension context invalidated.'));
        const quiet = console.error;
        console.error = () => {};
        try {
            await Watched.mark('new');
        } finally {
            global.chrome.storage.local.get = realGet;
            console.error = quiet;
        }
        eq(store.bbWatchedVideos, { old: 1 });
    });

    await checkAsync('a checkpoint edit whose write failed answers with what is stored, not an empty list', async () => {
        // The popup and the dashboard draw what update() resolves to.
        clearStore();
        const video = { id: 'v', title: 'V', url: 'u', bookmarks: [{ id: 'a', time: 5 }, { id: 'b', time: 9 }] };
        store[Bookmarks.KEY] = [video];
        const realSet = global.chrome.storage.local.set;
        global.chrome.storage.local.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
        const quiet = console.error;
        console.error = () => {};
        let drawn;
        try {
            drawn = await Bookmarks.update((videos) => Bookmarks.removeBookmarkById(videos, 'v', 'a'));
        } finally {
            global.chrome.storage.local.set = realSet;
            console.error = quiet;
        }
        eq(drawn[0].bookmarks.map((b) => b.id), ['a', 'b']);
    });

    // ------------------------------------------------------------ X pouch

    section('the X pouch — two independent lists');

    const XPouch = require('../src/shared/x-pouch.js');

    /** Wipe the store and seed one topic per side. */
    async function seedPouch() {
        Object.keys(store).forEach((k) => delete store[k]);
        return {
            people: await XPouch.createTopic('people', 'CUDA'),
            posts: await XPouch.createTopic('posts', 'CUDA'),
        };
    }

    await checkAsync('a people topic and a post topic of the same name are two topics', async () => {
        const ids = await seedPouch();
        eq(ids.people !== ids.posts, true, 'same name, different lists, different ids');

        const state = await XPouch.load();
        eq(state.peopleTopics.length, 1);
        eq(state.postTopics.length, 1);

        // Renaming one must not touch the other: this is the rule the whole
        // module is shaped around, and the easiest one to break by reaching
        // for "the topics".
        await XPouch.renameTopic('people', ids.people, 'Kernels');
        const after = await XPouch.load();
        eq(after.peopleTopics[0].name, 'Kernels');
        eq(after.postTopics[0].name, 'CUDA');
    });

    await checkAsync('a topic name already taken on that side is reused, not duplicated', async () => {
        const ids = await seedPouch();
        eq(await XPouch.createTopic('people', 'cuda'), ids.people, 'case-insensitive');
        eq((await XPouch.load()).peopleTopics.length, 1);
    });

    await checkAsync('a topic whose write failed is not handed back as made, on either pouch', async () => {
        // The id used to be minted before the write and returned whatever
        // the write did, so X filed a post under a topic that never existed.
        await seedPouch();
        const Subscriptions = require('../src/shared/subscriptions.js');
        const realSet = global.chrome.storage.local.set;
        global.chrome.storage.local.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
        const quiet = console.error;
        console.error = () => {};
        try {
            eq(await XPouch.createTopic('posts', 'Kernels'), null, 'X');
            eq(await Subscriptions.createTopic('Kernels'), null, 'YouTube');
        } finally {
            global.chrome.storage.local.set = realSet;
            console.error = quiet;
        }
        assert(await XPouch.createTopic('posts', 'Kernels'), 'and a write that lands still says yes');
        const again = await Subscriptions.createTopic('Kernels');
        eq(await Subscriptions.createTopic('kernels'), again, 'an existing name is still an answer');
    });

    await checkAsync('a person belongs to exactly one topic, and re-filing moves them', async () => {
        const ids = await seedPouch();
        const second = await XPouch.createTopic('people', 'Diffusion');

        await XPouch.filePerson({ handle: '@isorokin', name: 'Ilya Sorokin', avatar: '', topic: ids.people });
        await XPouch.filePerson({ handle: '@isorokin', name: 'Ilya Sorokin', avatar: '', topic: second });

        const state = await XPouch.load();
        eq(state.people.length, 1, 'filing again is a move, not a second row');
        eq(state.people[0].topic, second);
    });

    await checkAsync('a re-file keeps the note and refreshes the name and avatar', async () => {
        const ids = await seedPouch();
        const second = await XPouch.createTopic('people', 'Diffusion');

        await XPouch.filePerson({ handle: '@weitan', name: 'Wei Tan', avatar: 'a.jpg', topic: ids.people });
        const person = (await XPouch.load()).people[0];
        await XPouch.setNote(person.id, 'distills papers daily');

        // The note is the user's and must survive; the name and the picture
        // are X's and may have changed since.
        await XPouch.filePerson({ handle: '@weitan', name: 'Wei T.', avatar: 'b.jpg', topic: second });
        const after = (await XPouch.load()).people[0];
        eq(after.note, 'distills papers daily');
        eq(after.name, 'Wei T.');
        eq(after.avatar, 'b.jpg');
        eq(after.id, person.id, 'the same row, not a replacement');
    });

    await checkAsync('a post is keyed by its status id, so the same post files once', async () => {
        const ids = await seedPouch();
        const post = { statusId: '1770', handle: '@lenaf', name: 'Lena', text: 'one', url: '', postedAt: 5 };

        await XPouch.filePost({ ...post, topic: ids.posts });
        // The same post met again in a thread, with the text X shows there.
        await XPouch.filePost({ ...post, text: 'one (edited)', topic: ids.posts });

        const state = await XPouch.load();
        eq(state.posts.length, 1);
        eq(state.posts[0].text, 'one (edited)');
    });

    await checkAsync('deleting a topic takes everything in it and nothing else', async () => {
        const ids = await seedPouch();
        const keep = await XPouch.createTopic('people', 'Hardware');

        await XPouch.filePerson({ handle: '@a', name: 'A', topic: ids.people });
        await XPouch.filePerson({ handle: '@b', name: 'B', topic: keep });
        await XPouch.filePost({ statusId: '1', handle: '@a', text: 'x', topic: ids.posts });

        await XPouch.deleteTopic('people', ids.people);

        const state = await XPouch.load();
        eq(state.people.map((p) => p.handle), ['@b'], 'its rows go with it');
        eq(state.peopleTopics.length, 1);
        eq(state.postTopics.length, 1, 'the other side is untouched');
        eq(state.posts.length, 1);
    });

    await checkAsync('array order is the display order, and a move is a splice', async () => {
        Object.keys(store).forEach((k) => delete store[k]);
        const a = await XPouch.createTopic('posts', 'A');
        const b = await XPouch.createTopic('posts', 'B');
        const c = await XPouch.createTopic('posts', 'C');

        const names = async () => (await XPouch.load()).postTopics.map((t) => t.name);
        eq(await names(), ['A', 'B', 'C']);

        await XPouch.moveTopic('posts', c, a);   // C dropped onto A
        eq(await names(), ['C', 'A', 'B']);

        await XPouch.moveTopic('posts', c, c);   // onto itself: nothing moves
        eq(await names(), ['C', 'A', 'B']);
        void b;
    });

    await checkAsync('a topic id from the wrong side files nothing anywhere', async () => {
        const ids = await seedPouch();
        // Nothing throws: a post filed under a people topic id just shows in no
        // card. Different prefixes keep the two id spaces from meeting.
        eq(ids.people.startsWith('xpt_'), true);
        eq(ids.posts.startsWith('xst_'), true);
    });

    check('the monogram falls back through name, then handle', () => {
        eq(XPouch.monogram('Wei Tan', '@weitan'), 'WT');
        eq(XPouch.monogram('Cher', '@cher'), 'CH', 'one word gives two letters, not one');
        eq(XPouch.monogram('', '@isorokin'), 'IS');
    });

    section('the X pouch — reading x.com');

    const TwitterPage = require('../src/content/twitter-page.js');

    check('a handle is read off a profile link, and only off a real one', () => {
        eq(TwitterPage.handleFromHref('/weitan'), '@weitan');
        eq(TwitterPage.handleFromHref('/weitan/status/1770'), '@weitan');
        eq(TwitterPage.handleFromHref('https://x.com/weitan'), '@weitan');
        // X's own pages sit at one-segment paths that look exactly like
        // handles; filing "@home" as a person is the bug this prevents.
        eq(TwitterPage.handleFromHref('/home'), '');
        eq(TwitterPage.handleFromHref('/i/bookmarks'), '');
        eq(TwitterPage.handleFromHref('/settings'), '');
        eq(TwitterPage.handleFromHref(''), '');
    });

    check('a count is written short, the way X writes one, and never rounded up', () => {
        eq(TwitterPage.shortCount(25, 'en'), '25');
        eq(TwitterPage.shortCount(999, 'en'), '999');
        eq(TwitterPage.shortCount(1299, 'en'), '1.2K');
        eq(TwitterPage.shortCount(12345, 'en'), '12K');
        eq(TwitterPage.shortCount(1580000, 'en'), '1.5M');
        eq(TwitterPage.shortCount(7, 'not a locale!'), '7', 'a page with a broken lang still gets its number');
    });

    check('the X surfaces are settings, and all of them are off', () => {
        const { DEFAULTS } = require('../src/shared/settings.js');
        // Each reaches into a page somebody else designed, so none is on by
        // default; and a typo in a key is a toggle that silently does nothing.
        const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
        for (const key of ['twitterHideBookmark', 'twitterPouchPeople', 'twitterPouchPosts', 'twitterHideCounts']) {
            assert(html.includes(`id="${key}"`), `${key} has a control`);
            eq(key in DEFAULTS, true, key);
            eq(DEFAULTS[key], false, key);
        }
    });

    check('an avatar URL is upgraded a size and anything else is left alone', () => {
        const base = 'https://pbs.twimg.com/profile_images/1/abc';
        eq(TwitterPage.avatarUrl({ src: `${base}_normal.jpg` }), `${base}_bigger.jpg`);
        eq(TwitterPage.avatarUrl({ src: `${base}_400x400.png` }), `${base}_400x400.png`);
        // Never anything but the CDN: this string is written into an <img src>
        // on the dashboard and in the panel.
        eq(TwitterPage.avatarUrl({ src: 'https://evil.example/profile_images/x_normal.jpg' }), '');
        eq(TwitterPage.avatarUrl(null), '');
    });

    section('short ages');

    check('a post age reads the way X writes it', () => {
        const now = Date.parse('2026-09-21T12:00:00Z');
        const ago = (ms) => Time.shortAge(now - ms, now);
        eq(ago(30 * 1000), 'now');
        eq(ago(6 * 36e5), '6h');
        eq(ago(2 * 864e5), '2d');
        eq(ago(9 * 864e5), '1w', 'rounds down, so nothing ever reads older than it is');
        eq(Time.shortAge(0), '', 'a missing date is not the epoch');
    });

    // ------------------------------------------------ opening the dashboard

    section('opening the dashboard at a site');

    await checkAsync('the worker hears each kind of event once, and hands it to whoever registered for it', async () => {
        // Six parts each added a runtime.onMessage listener, in three
        // conventions, and four an onAlarm listener filtering by name.
        const added = { message: [], alarm: [], start: 0 };
        const saved = { chrome: global.chrome, Router: globalThis.BB.Router };
        global.chrome = {
            runtime: {
                onMessage: { addListener: (f) => added.message.push(f) },
                onStartup: { addListener: () => { added.start++; } },
                onInstalled: { addListener: () => { added.start++; } },
            },
            alarms: { onAlarm: { addListener: (f) => added.alarm.push(f) } },
        };
        try {
            delete require.cache[require.resolve('../src/background/router.js')];
            const Router = require('../src/background/router.js');
            eq([added.message.length, added.alarm.length, added.start], [1, 1, 2]);
            const fired = [];
            Router.on('echo', (message) => ({ ok: true, said: message.text }));
            Router.on('boom', () => { throw new Error('no'); });
            Router.alarm('tick', (alarm) => fired.push(alarm.name));
            const ask = (message) => new Promise((done) => {
                const open = added.message[0](message, {}, done);
                if (!open) done('not ours');
            });
            eq(await ask({ action: 'echo', text: 'hi' }), { ok: true, said: 'hi' });
            eq(await ask({ action: 'boom' }), { ok: false, error: 'no' });
            eq(await ask({ action: 'someone-else' }), 'not ours', 'an action nobody registered is left for another listener');
            added.alarm[0]({ name: 'tick' });
            added.alarm[0]({ name: 'tock' });
            eq(fired, ['tick']);
        } finally {
            global.chrome = saved.chrome;
            globalThis.BB.Router = saved.Router;
        }
    });

    await checkAsync('only a hash of our own shape survives into the URL', async () => {
        // The hash comes from a content script, a page we do not own, so
        // anything but `#<word>/<word>` is dropped (not rejected: the caller
        // still lands on the dashboard).
        const opened = [];
        let onMessage = null;
        const saved = global.chrome;
        global.chrome = {
            runtime: {
                getURL: (p) => 'x/' + p,
                onMessage: { addListener: (f) => { onMessage = f; } },
                onInstalled: { addListener() {} },
                onStartup: { addListener() {} },
            },
            tabs: { create: (o) => opened.push(o.url), query: (q, cb) => cb && cb([]), sendMessage() {} },
            storage: { local: { get: (k, cb) => cb && cb({}) }, onChanged: { addListener() {} } },
            contextMenus: { create() {}, removeAll: (cb) => cb && cb(), onClicked: { addListener() {} } },
            commands: { onCommand: { addListener() {} } },
            tts: { speak() {} },
        };

        // A router of its own over this chrome: the worker's one listener,
        // which commands.js registers its actions with.
        const savedRouter = globalThis.BB.Router;
        try {
            for (const file of ['../src/background/router.js', '../src/background/commands.js']) {
                delete require.cache[require.resolve(file)];
                require(file);
            }
            const send = (hash) => new Promise((done) => onMessage({ action: 'openDashboard', hash }, {}, done));
            for (const hash of ['#site/twitter', '#settings/chess', 'javascript:alert(1)', '#../../evil', undefined]) await send(hash);
        } finally {
            global.chrome = saved;
            globalThis.BB.Router = savedRouter;
        }

        eq(opened, [
            'x/dashboard.html#site/twitter',
            'x/dashboard.html#settings/chess',
            'x/dashboard.html',
            'x/dashboard.html',
            'x/dashboard.html',
        ]);
    });

    // ------------------------------------------------------- site detection

    section('site detection');

    const Site = require('../src/content/site.js');

    check('chess.com and Lichess are sites of their own', () => {
        eq(Site.detectSite('www.chess.com'), 'chess');
        eq(Site.detectSite('chess.com'), 'chess');
        eq(Site.detectSite('notchess.com'), 'other');
        eq(Site.detectSite('lichess.org'), 'lichess');
        eq(Site.detectSite('en.lichess.org'), 'lichess');
        eq(Site.detectSite('notlichess.org'), 'other');
    });
    check('chatgpt is a site of its own, under both of its names', () => {
        eq(Site.detectSite('chatgpt.com'), 'chatgpt');
        eq(Site.detectSite('chat.openai.com'), 'chatgpt');
        eq(Site.detectSite('openai.com'), 'other', 'the company site has no chat on it');
        eq(Site.detectSite('notchatgpt.com'), 'other');
    });
    check('a chat site is wired through its adapter, and shift+p opens its panel', () => {
        const main = readRepo('src/content/main.js');
        assert(/CHAT_ADAPTERS = \{ chatgpt: /.test(main), 'chatgpt has no adapter in main.js');
        assert(/claude: \(\) => BB\.ClaudeRead\.adapter/.test(main), 'claude has no adapter in main.js');
        const js = contentScripts().find((entry) => entry.js.includes('src/content/claude-read.js')).js;
        assert(js.indexOf('src/content/claude-read.js') > -1 && js.indexOf('src/content/claude-read.js') < js.indexOf('src/content/main.js'),
            'main.js would get undefined for ClaudeRead at load');
        assert(/return youtubeUi \|\| twitterUi \|\| leetUi \|\| chatUi;/.test(main), 'Shift+P would not reach the chat panel');
    });

    check('wikipedia is a site of its own in every language, and its own reading carries the reader', () => {
        for (const host of ['en.wikipedia.org', 'de.m.wikipedia.org', 'www.wikipedia.org', 'wikipedia.org']) eq(Site.detectSite(host), 'wikipedia', host);
        eq(Site.detectSite('wikipedia.org.example.com'), 'other');
        eq(Site.detectSite('en.wikiversity.org'), 'other', 'a sister project is not the encyclopedia');
        const entry = SiteScripts.ENTRIES.find((one) => one.id === 'wikipedia');
        assert(entry.js.includes('src/content/article-reader.js'), 'the reader would have to be brought in on every article');
        assert(/site === 'wikipedia' && WikiRead \? \{ \.\.\.WikiRead\.adapter, enhance: BB\.WikiUi/.test(readRepo('src/content/main.js')), 'the extractor reads Wikipedia');
        const WikiRead = require('../src/content/wiki-read.js');
        eq(WikiRead.keyOf('https://en.m.wikipedia.org/wiki/Alan%20Turing#Death'), WikiRead.keyOf('https://en.wikipedia.org/wiki/Alan_Turing'),
            'the mobile site and the desktop one are one article');
        eq(WikiRead.keyOf('https://de.wikipedia.org/w/index.php?title=Alan_Turing&oldid=1'), 'wikipedia:de:Alan_Turing');
    });

    check('a wikipedia citation names the exact revision read, as markdown and as wikipedia\'s own bibtex', () => {
        const WikiUi = require('../src/content/wiki-ui.js');
        const article = { title: 'Alan Turing', url: 'https://en.wikipedia.org/wiki/Alan_Turing', meta: { revision: 1380709724 } };
        const url = WikiUi.revisionUrl(article);
        eq(url, 'https://en.wikipedia.org/w/index.php?title=Alan_Turing&oldid=1380709724');
        eq(WikiUi.markdownCite(article, url), `[Alan Turing — Wikipedia](${url})`);
        eq(WikiUi.markdownCite({ title: 'Brackets [in] a title' }, 'u'), '[Brackets \\[in\\] a title — Wikipedia](u)');
        eq(WikiUi.revisionUrl({ ...article, meta: {} }), article.url, 'a page that did not say its revision is cited by its address');
        eq(WikiUi.bibtexCite(article, url, new Date(2026, 9, 18)), [
            '@misc{wiki:Alan_Turing,', '  author = "{Wikipedia contributors}",',
            '  title = "Alan Turing --- {Wikipedia}{,} The Free Encyclopedia",', '  year = "2026",',
            `  url = "${url}",`, '  note = "[Online; accessed 18-October-2026]"', '}',
        ].join('\n'));
        assert(/BB\.WikiUi\.openAsked\(/.test(readRepo('src/content/main.js')), 'another language\'s article opens on the page, not in the reader');
    });

    check('leetcode.com is a site of its own', () => {
        eq(Site.detectSite('leetcode.com'), 'leetcode');
        eq(Site.detectSite('www.leetcode.com'), 'leetcode');
        // LeetCode's China site is a different account and a different
        // problem set; it is not this one.
        eq(Site.detectSite('leetcode.cn'), 'other');
        eq(Site.detectSite('notleetcode.com'), 'other');
    });

    // --------------------------------------------------- the site registry

    section('the site registry');

    const SiteIcons = require('../src/shared/site-icons.js');

    check('every site in the order has a card to draw', () => {
        for (const site of SiteIcons.list()) {
            assert(site && site.id, 'an id in ORDER with no entry in SITES');
            assert(site.name && site.description, `${site.id} is missing its plate`);
            // A path from Simple Icons, or a mark of several colours whole, as an svg.
            assert(/^[Mm]/.test(site.path) || /^data:image\/svg\+xml,/.test(site.image), `${site.id} has no mark`);
        }
    });
    check('typeracer is one site, whichever subdomain a race is on', () => {
        // play.typeracer.com races, data.typeracer.com keeps the site's own
        // stats, and typeracer.com is the front door. All three are the site.
        eq(Site.detectSite('play.typeracer.com'), 'typeracer');
        eq(Site.detectSite('data.typeracer.com'), 'typeracer');
        eq(Site.detectSite('typeracer.com'), 'typeracer');
        eq(Site.detectSite('nottyperacer.com'), 'other');
    });
    check('typeracer needs no player selector of its own', () => {
        // Every other site in this table is here because it has a <video>.
        // A typing test has nothing to play, and a selector list for it would
        // only ever match something that is not a player.
        eq(Site.PLAYER_SELECTORS.typeracer, undefined);
    });

    check('typeracer is in the launcher', () => {
        eq(SiteIcons.list(['typeracer', 'youtube']).map((s) => s.id).slice(0, 3), ['typeracer', 'youtube', 'chess'],
            'a saved order first, then every site it does not name');
        eq(SiteIcons.list(['nope', 'chess', 'chess']).length, SiteIcons.ORDER.length, 'unknown and repeated ids were kept');
        eq(SiteIcons.list(null).map((s) => s.id), SiteIcons.ORDER.slice());
        eq(SiteIcons.ORDER.map((id) => SiteIcons.tint(id)).slice(0, 5), [1, 2, 3, 4, 1], 'the tint belongs to the site');
        const SiteSort = require('../src/page/site-sort.js');
        eq(SiteSort.moved(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
        eq(SiteSort.moved(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c'], 'moved past the start');
        eq(globalThis.BB.Settings.DEFAULTS.siteOrder, []);
        const dashboard = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
        assert(dashboard.indexOf('src/page/site-sort.js') > 0, 'the dashboard cannot drag');
        eq(SiteIcons.get('typeracer').name, 'TypeRacer');
        assert(SiteIcons.list().some((site) => site.id === 'typeracer'), 'not in ORDER');
        assert(SiteIcons.svg('typeracer').includes('<svg'), 'draws nothing');
        // It was the site's 16px favicon, sixteen squares wide at card size.
        assert(/<image href="data:image\/svg\+xml,/.test(SiteIcons.svg('typeracer')), 'not the vector logo');
        assert(!SiteIcons.get('typeracer').image.includes('"'), 'a double quote would end the href it is put in');
    });
    check('vimeo and netflix have a card under the id they are detected by, and a page behind each', () => {
        const html = readRepo('dashboard.html');
        const dashboard = readRepo('dashboard.js');
        eq(SiteIcons.ORDER.slice(-3), ['vimeo', 'netflix', 'wikipedia'], 'after every site a saved order already names');
        for (const [id, host, name] of [['vimeo', 'vimeo.com', 'Vimeo'], ['netflix', 'www.netflix.com', 'Netflix']]) {
            eq(Site.detectSite(host), id);
            eq(SiteIcons.get(id).name, name);
            assert(html.includes(`id="${id}HomePanel" class="site-panel" data-site="${id}"`) && dashboard.includes(`'${id}HomePanel'`), `${id} opens on nothing`);
            assert(html.includes(`data-site-settings="${id}"`), `${id} has no settings panel`);
        }
        eq(SiteIcons.get('vimeo').color, '#1AB7EA');
        // Netflix's N as Simple Icons carries it: one path in Netflix's red,
        // the legs cut short of the ribbon. It was redrawn here once, shaded
        // and with those gaps closed, which made it a mark of nobody's.
        const netflix = SiteIcons.get('netflix');
        eq([netflix.color, netflix.image], ['#E50914', undefined]);
        assert(netflix.path.startsWith('m5.398 0 8.348 23.602c2.346.059 4.856.398 4.856.398L10.113 0H5.398z'), 'not the original ribbon');
        eq(netflix.path.match(/z/g).length, 3, 'the ribbon and the two legs are one path of three shapes');
        assert(/<path fill="#E50914" d="m5\.398 0 /.test(SiteIcons.svg('netflix')), 'not the vector logo');
    });
    check('a site switched off leaves the dashboard and keeps its place in the order', () => {
        const SiteSort = require('../src/page/site-sort.js');
        eq(SiteSort.within(['a', 'b', 'c', 'd'], ['d', 'a', 'c']), ['d', 'b', 'a', 'c'], 'b was hidden, and moved');
        eq(SiteSort.within(['a', 'b', 'c'], ['c', 'b', 'a']), ['c', 'b', 'a']);
        eq(SiteSort.within(['a', 'b'], []), ['a', 'b']);
        const dashboard = readRepo('dashboard.js');
        assert(/SiteSort\.within\(this\.siteIds \|\| ids, ids\)/.test(dashboard), 'a drag on the dashboard sends the hidden sites to the end');
        assert(/attach\(settingsGrid, \{ selector: '\.site-slot'/.test(dashboard), 'settings drags a card and leaves its switch behind');
        assert(/Settings\.watch\(\['siteOrder', 'sitesOff'\]/.test(dashboard), 'a switch does not redraw the grids');
        assert(/shown = sites\.filter\(\(site\) => !off\.has\(site\.id\)\)/.test(dashboard), 'the dashboard draws a site switched off');
        assert(/role="switch" data-site-switch=/.test(dashboard));
        // The smallest switch: it is a mark at a card's corner, not a control in a row.
        const track = (size) => readRepo('dashboard.css')
            .match(new RegExp(`\\.toggle-switch\\.toggle-${size} \\{ --track-w: (\\d+)px; --track-h: (\\d+)px;`)).slice(1).map(Number);
        assert(/class="toggle-switch toggle-xs site-switch"/.test(dashboard), 'a card’s switch is not the small one');
        assert(track('xs')[0] < track('sm')[0] && track('xs')[1] < track('sm')[1], 'the card’s switch is no smaller than a row’s');
    });
    check('the typeracer workspace has a panel behind every tab', () => {
        const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
        const dashboard = require('fs').readFileSync(`${__dirname}/../dashboard.js`, 'utf8');
        // The tab list and the panels are two files apart, and a tab whose
        // panel is missing switches to a blank page rather than failing.
        for (const id of ['typerRacesPanel', 'typerWeakPanel', 'typerPracticePanel']) {
            assert(dashboard.includes(`'${id}'`), `${id} is in the page but no tab opens it`);
            assert(html.includes(`id="${id}"`), `${id} is referenced but not in the page`);
        }
    });
    check('leetcode is in the launcher', () => {
        eq(SiteIcons.get('leetcode').name, 'LeetCode');
        assert(SiteIcons.list().some((site) => site.id === 'leetcode'), 'not in ORDER');
        assert(SiteIcons.svg('leetcode').includes('<svg'), 'draws nothing');
    });

    check('the shorts keys are the arrows, and only exist while the setting is on', () => {
        const Keybindings = require('../src/shared/keybindings.js');
        const ids = (settings) => Keybindings.list({}, 'youtube', settings).map((b) => b.id);
        assert(!ids({ shortsSeek: false }).includes('shorts-forward'), 'on the keyboard map while switched off');
        assert(ids({ shortsSeek: true }).includes('shorts-back') && ids({ shortsSeek: true }).includes('shorts-forward'));
        eq(Keybindings.resolve({}, 'shorts-back').combo.code, 'ArrowLeft');
        eq(Keybindings.resolve({}, 'shorts-forward').combo.code, 'ArrowRight');
        for (const id of ['shorts-back', 'shorts-forward']) {
            eq(Keybindings.conflicts({}, id, Keybindings.resolve({}, id).combo), []);
        }
    });
    check('a shorts skip lands inside the short', () => {
        const Site = require('../src/content/site.js');
        eq(Site.shortsSeekTo(10, 5, 40), 15);
        eq(Site.shortsSeekTo(2, -5, 40), 0, 'went before the start');
        eq(Site.shortsSeekTo(38, 5, 40), 39.75, 'ran into the end, where a short starts over');
        eq(Site.shortsSeekTo(3, 5, NaN), 8, 'a duration not known yet does not stop the skip');
        assert(Site.isShortsPath('/shorts/abcDEF12345'));
        assert(!Site.isShortsPath('/shorts') && !Site.isShortsPath('/watch'), 'not a short');
    });
    check('y y stamps a video\'s link with the player\'s second, and only once asked to', () => {
        const Site = require('../src/content/site.js');
        const YouTube = require('../src/shared/youtube.js');
        const page = (advert) => ({ querySelector: (selector) => (advert && selector === '#movie_player.ad-showing' ? {} : null) });
        eq(Site.playhead({ currentTime: 83.9 }, page(false)), 83);
        eq(YouTube.watchUrl('dQw4w9WgXcQ', Site.playhead({ currentTime: 83.9 }, page(false))),
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=83s');
        eq(Site.playhead({ currentTime: 7 }, page(true)), 0, 'an advert\'s clock was taken for the video\'s');
        eq([Site.playhead(null, page(false)), Site.playhead({ currentTime: NaN }, page(false))], [0, 0]);

        eq(require('../src/shared/settings.js').DEFAULTS.youtubeLinkTimestamp, false);
        const html = readRepo('dashboard.html');
        const from = html.indexOf('id="youtubeSettingsPanel"');
        const panel = html.slice(from, html.indexOf('class="settings-section"', from));
        assert(panel.includes('<input type="checkbox" id="youtubeLinkTimestamp">'), 'no switch in the YouTube panel');

        const main = readRepo('src/content/main.js');
        assert(/copyPageLink: \(\) => copyPageLink\(linkTime\(\),/.test(main), 'y y never asks where the player is');
        assert(/settings\.youtubeLinkTimestamp !== true/.test(main), 'stamped with the switch off');
        assert(/case 'copyMarkdownLink':\s+copyPageLink\(\);/.test(main), 'Ctrl+Shift+L was stamped too');
    });
    check('y y copies markdown until settings ask for plain text, and nothing else is asked', () => {
        const Markdown = require('../src/content/markdown.js');
        eq(Markdown.plain('A  [live]\n set', 'https://example.com/a_(b)'), 'A [live] set https://example.com/a_(b)',
            'the brackets are Markdown\'s to escape, and text has none');
        eq(Markdown.plain('https://example.com/', 'https://example.com/'), 'https://example.com/', 'a page with no title was named twice');
        eq(Markdown.plain('', 'https://example.com/'), 'https://example.com/');
        assert(!/\n/.test(Markdown.plain('one\ntwo', 'https://example.com/')), 'a one-line field has no second line');

        eq(require('../src/shared/settings.js').DEFAULTS.copyAsMarkdown, true);
        const html = readRepo('dashboard.html');
        const from = html.indexOf('data-plate="General"');
        const panel = html.slice(from, html.indexOf('class="settings-section"', from));
        assert(panel.includes('<input type="checkbox" id="copyAsMarkdown">'), 'no switch under General');

        const main = readRepo('src/content/main.js');
        assert(/copyPageLink\(linkTime\(\), settings\.copyAsMarkdown !== false\)/.test(main), 'y y never asks which');
        assert(/case 'copyMarkdownLink':\s+copyPageLink\(\);/.test(main), 'Ctrl+Shift+L copied text, under a name that says Markdown');
    });
    check('ctrl+shift+v is the plain paste, by the key or by the letter, and it is listened for', () => {
        const Markdown = require('../src/content/markdown.js');
        const key = (code, letter, held) => ({ code, key: letter, ctrlKey: false, shiftKey: false, metaKey: false, ...held });
        eq(Markdown.isPlainPaste(key('KeyV', 'V', { ctrlKey: true, shiftKey: true })), true);
        eq(Markdown.isPlainPaste(key('KeyV', 'V', { metaKey: true, shiftKey: true })), true, 'a Mac\'s');
        eq(Markdown.isPlainPaste(key('Period', 'V', { ctrlKey: true, shiftKey: true })), true, 'Dvorak\'s V is not on KeyV');
        eq(Markdown.isPlainPaste(key('KeyV', 'М', { ctrlKey: true, shiftKey: true })), true, 'a layout with no v on it');
        eq([key('KeyV', 'v', { ctrlKey: true }), key('KeyV', 'V', { shiftKey: true }), key('KeyC', 'C', { ctrlKey: true, shiftKey: true })]
            .map(Markdown.isPlainPaste), [false, false, false]);

        // Every tab knows the link from storage, and what is on this
        // machine's clipboard is nothing for a backup to restore.
        const Settings = require('../src/shared/settings.js');
        assert(Settings.TRANSIENT.includes(Settings.DATA.linkCopy), 'the last link copied went into a backup');
        assert(readRepo('src/content/markdown.js').includes('Settings.set({ [COPIED]: copied })'), 'a copy is this tab\'s alone');

        const main = readRepo('src/content/main.js');
        assert(/markdown\.installPlainPaste\(\);/.test(main), 'nothing listens for the paste');
        assert(/markdown\.copyLink\(markdown\.pageLink\(at\), asMarkdown\)/.test(main), 'the page\'s link is copied but not remembered');
    });
    check('a video\'s link names its channel after "by", on a switch in the youtube panel that is on', () => {
        const Markdown = require('../src/content/markdown.js');
        const pageInfo = {
            getVideoId: () => 'dQw4w9WgXcQ',
            getVideoTitle: () => 'Artist - Song',
            getChannelInfo: () => ({ channelName: 'Somebody' }),
        };
        const getPage = () => ({ title: 'Artist - Song - YouTube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', path: '/watch' });
        const link = (settings) => Markdown.createMarkdown({ site: 'youtube', pageInfo, getSettings: () => settings, getPage }).pageLink().markdown;
        eq(link({}), '[Artist - Song by Somebody](https://www.youtube.com/watch?v=dQw4w9WgXcQ)', 'a dash made the channel one more piece of the title');
        eq(link({ youtubeLinkChannel: false }), '[Artist - Song](https://www.youtube.com/watch?v=dQw4w9WgXcQ)');

        eq(require('../src/shared/settings.js').DEFAULTS.youtubeLinkChannel, true);
        const html = readRepo('dashboard.html');
        const from = html.indexOf('id="youtubeSettingsPanel"');
        const panel = html.slice(from, html.indexOf('class="settings-section"', from));
        assert(panel.includes('<input type="checkbox" id="youtubeLinkChannel">'), 'no switch in the YouTube panel');
        assert(/createMarkdown\(\{ site, pageInfo: PageInfo, getSettings: \(\) => settings \}\)/.test(readRepo('src/content/main.js')),
            'the links are made without the settings');
    });
    check('a video playing from a playlist keeps it in its link, until links are asked for at a moment', () => {
        const YouTube = require('../src/shared/youtube.js');
        const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        const list = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
        eq(YouTube.playlistPlace(`${watch}&list=${list}&index=7&pp=iAQB`), { list, index: '7' });
        eq(YouTube.playlistPlace(`${watch}&list=${list}`), { list, index: '' });
        eq(YouTube.playlistPlace(`${watch}&list=${list}&index=7abc`).index, '', 'an index is a number or it is nothing');
        // Nobody following the link has this viewer's mix, or their Watch later.
        for (const own of ['RDdQw4w9WgXcQ', 'WL', 'LL']) eq(YouTube.playlistPlace(`${watch}&list=${own}&index=2`), null, own);
        eq([YouTube.playlistPlace(watch), YouTube.playlistPlace('')], [null, null]);

        eq(YouTube.watchUrl('dQw4w9WgXcQ', 0, { list, index: '7' }), `${watch}&list=${list}&index=7`);
        eq(YouTube.watchUrl('dQw4w9WgXcQ', 83, { list, index: '' }), `${watch}&list=${list}&t=83s`);
        eq([YouTube.watchUrl('dQw4w9WgXcQ', 83, null), YouTube.watchUrl('dQw4w9WgXcQ')], [`${watch}&t=83s`, watch]);

        const pageInfo = { getVideoId: () => 'dQw4w9WgXcQ', getVideoTitle: () => 'A set', getChannelInfo: () => ({ channelName: 'Somebody' }) };
        const link = (url, settings, seconds) => require('../src/content/markdown.js').createMarkdown({
            site: 'youtube', pageInfo, getSettings: () => settings, getPage: () => ({ title: 'A set - YouTube', url, path: '/watch' }),
        }).pageLink(seconds).markdown;
        const playing = `${watch}&list=${list}&index=7&pp=iAQB`;
        eq(link(playing, {}), `[A set by Somebody](${watch}&list=${list}&index=7)`, 'the playlist was left behind');
        eq(link(playing, { youtubeLinkTimestamp: true }, 83), `[A set by Somebody](${watch}&t=83s)`);
        eq(link(playing, { youtubeLinkTimestamp: true }), `[A set by Somebody](${watch})`, 'Ctrl+Shift+L\'s, with the switch on, is to the video alone too');
        eq(link(`${watch}&list=RDdQw4w9WgXcQ&start_radio=1`, {}), `[A set by Somebody](${watch})`, 'a mix is not a playlist to link into');
        eq(link(watch, {}), `[A set by Somebody](${watch})`);
    });
    check('a reddit link names its subreddit last and spelled out, wherever reddit\'s own title had it', () => {
        const { redditLabel } = require('../src/content/markdown.js');
        const post = '/r/AskReddit/comments/1abc2d/what_is_it/';
        const named = (title, path = post) => redditLabel(title, path, true);
        eq(named('What is it? : r/AskReddit'), 'What is it? in AskReddit subreddit');
        eq(named('r/AskReddit on Reddit: What is it?'), 'What is it? in AskReddit subreddit', 'the title a link preview is given');
        eq(named('What is it? : AskReddit'), 'What is it? in AskReddit subreddit', 'old reddit');
        eq(named('What is it?'), 'What is it? in AskReddit subreddit', 'a post is in its subreddit whatever its title says');
        eq(named('What is it? : r/AskReddit', '/r/askreddit/comments/1abc2d/'), 'What is it? in AskReddit subreddit',
            'the address has what was typed, the title has its name');
        eq(named('Is it : r/AskRedditAfterDark : r/AskReddit'), 'Is it : r/AskRedditAfterDark in AskReddit subreddit',
            'a post\'s own words were taken for the subreddit');
        eq(named('r/AskRedditors: who is in? : r/AskReddit'), 'r/AskRedditors: who is in? in AskReddit subreddit');

        const bare = (title, path = post) => redditLabel(title, path, false);
        eq([bare('What is it? : r/AskReddit'), bare('r/AskReddit on Reddit: What is it?'), bare('What is it?')],
            ['What is it?', 'What is it?', 'What is it?']);

        // The subreddit's own page is named by it alone, and any other page
        // is named by reddit and left that way.
        eq([named('r/AskReddit', '/r/AskReddit/'), bare('r/AskReddit', '/r/AskReddit/')], ['AskReddit subreddit', 'r/AskReddit']);
        eq(named('Ask Reddit...', '/r/AskReddit/'), 'Ask Reddit...');
        eq(named('index - AskReddit', '/r/AskReddit/wiki/index/'), 'index in AskReddit subreddit');
        eq(named('Reddit - The heart of the internet', '/'), 'Reddit - The heart of the internet');
        eq(named('A post : u/somebody', '/user/somebody/comments/1abc2d/a_post/'), 'A post : u/somebody');

        eq(require('../src/shared/settings.js').DEFAULTS.redditLinkSubreddit, true);
        const html = readRepo('dashboard.html');
        const from = html.indexOf('id="redditSettingsPanel"');
        const panel = html.slice(from, html.indexOf('class="settings-section"', from));
        assert(panel.includes('<input type="checkbox" id="redditLinkSubreddit">'), 'no switch in the Reddit panel');

        // The link itself, on reddit and off it, by the switch.
        const url = `https://www.reddit.com${post}`;
        const getPage = () => ({ title: 'What is it? : r/AskReddit', url, path: post });
        const link = (site, settings) => require('../src/content/markdown.js')
            .createMarkdown({ site, pageInfo: {}, getSettings: () => settings, getPage }).pageLink().markdown;
        eq(link('reddit', {}), `[What is it? in AskReddit subreddit](${url})`);
        eq(link('reddit', { redditLinkSubreddit: false }), `[What is it?](${url})`);
        eq(link('other', {}), `[What is it? : r/AskReddit](${url})`, 'reddit switched off in Settings is any other site');
    });
    check('a right-clicked link pastes as text too, and one with no name of its own is its address once', () => {
        const markdown = require('../src/content/markdown.js').createMarkdown({ site: 'other', pageInfo: {} });
        eq(markdown.contextLink('https://example.com/docs', 'the  docs'),
            { markdown: '[the docs](https://example.com/docs)', text: 'the docs https://example.com/docs' });
        eq(markdown.contextLink('https://www.example.com/a/b/', ''),
            { markdown: '[example.com/a/b](https://www.example.com/a/b/)', text: 'https://www.example.com/a/b/' },
            'a name made out of the address said it twice');
        eq(markdown.contextLink('not a url', '').text, 'not a url');
        assert(/markdown\.copyLink\(markdown\.contextLink\(message\.linkUrl, message\.selectionText\)\)/.test(readRepo('src/content/main.js')),
            'copied, but never remembered for the paste');
    });
    check('the shorts setting has its controls, in the youtube panel, bounded as the code is', () => {
        const html = require('fs').readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
        const from = html.indexOf('id="youtubeSettingsPanel"');
        const panel = html.slice(from, html.indexOf('class="settings-section"', from));
        assert(/<input type="checkbox" id="shortsSeek">/.test(panel), 'no switch');
        const seconds = (/<input[^>]*id="shortsSeekSeconds"[^>]*>/.exec(panel) || [''])[0];
        assert(/min="1"/.test(seconds) && /max="30"/.test(seconds), `unbounded: ${seconds}`);
        eq(globalThis.BB.Settings.DEFAULTS.shortsSeek, false);
        eq(globalThis.BB.Settings.DEFAULTS.shortsSeekSeconds, 5);
    });

    check('the leetcode shortcuts are bound under their own scope', () => {
        const Keybindings = require('../src/shared/keybindings.js');
        eq(Keybindings.SCOPES.leetcode, 'LeetCode');
        eq(Keybindings.list({}, 'leetcode').map((b) => b.id), ['leet-templates', 'leet-mock']);
        // Both fire with the caret inside Monaco, so neither may be a bare
        // letter and neither may collide with anything already bound.
        for (const binding of Keybindings.list({}, 'leetcode')) {
            assert(binding.combo.ctrl && binding.combo.alt, `${binding.id} is not modified enough`);
            eq(Keybindings.conflicts({}, binding.id, binding.combo), []);
        }
    });

    // ------------------------------------------------------ chat sites

    section('the chat site registry');

    const ChatSites = require('../src/shared/chat-sites.js');

    check('every chat setting the registry can name has a default', () => {
        eq(ChatSites.allKeys().filter((key) => !(key in globalThis.BB.Settings.DEFAULTS)), []);
        eq(ChatSites.siteKey('chatgpt', 'queueGap'), 'chatgptQueueGapSeconds');
        eq(ChatSites.siteKey('chatgpt', 'nonsense'), null);
        eq(ChatSites.siteKey('nowhere', 'queueGap'), null);
    });
    check('the composer buttons are asked for, not assumed', () => {
        // They are drawn into somebody else's composer. The panel toggle and
        // the hotkeys are how everything is reachable without them.
        eq(globalThis.BB.Settings.DEFAULTS.chatgptComposerTools, false);
    });
    check('a chatgpt path gives up its conversation id however it is prefixed', () => {
        const { convIdOf, isNewChat } = ChatSites.get('chatgpt');
        const id = '6a864ad2-54d0-83e8-b47e-0716102a840c';
        eq(convIdOf(`/c/${id}`), id);
        eq(convIdOf(`/g/g-abc123/c/${id}`), id, 'a custom GPT');
        eq(convIdOf(`/g/g-p-abc123-notes/c/${id}?model=x`), id, 'a project');
        eq(convIdOf('/'), null);
        eq(convIdOf('/codex'), null);
        assert(isNewChat('/') && isNewChat('/g/g-abc123') && isNewChat('/g/g-p-abc-notes/project'));
        assert(!isNewChat(`/c/${id}`) && !isNewChat('/gpts'), 'not a new chat');
    });
    check('a new chat can ask for its model, an existing one cannot', () => {
        const { chatUrl } = ChatSites.get('chatgpt');
        eq(chatUrl('abc'), 'https://chatgpt.com/c/abc');
        eq(chatUrl(null), 'https://chatgpt.com/');
        eq(chatUrl(null, { model: 'gpt-5' }), 'https://chatgpt.com/?model=gpt-5');
        eq(chatUrl('abc', { model: 'gpt-5' }), 'https://chatgpt.com/c/abc');
    });
    check('the worker can tell which chat a tab is on from its url alone', () => {
        eq(ChatSites.siteOfUrl('https://chatgpt.com/c/abc12345').id, 'chatgpt');
        eq(ChatSites.siteOfUrl('https://chat.openai.com/').id, 'chatgpt');
        eq(ChatSites.siteOfUrl('https://evil.example/chatgpt.com/'), null);
        eq(ChatSites.convIdOfUrl('chatgpt', 'https://chatgpt.com/c/abc12345?x=1'), 'abc12345');
        eq(ChatSites.convIdOfUrl('chatgpt', 'not a url'), null);
    });

    check('claude is a chat site of its own, with the same six settings', () => {
        const claude = ChatSites.get('claude');
        const id = '9a978684-1ba6-4d23-af91-b09ad7ae3f9c';
        eq(claude.convIdOf(`/chat/${id}`), id);
        eq(claude.convIdOf('/code/abc'), null, 'Claude Code on the web is not a chat');
        eq(claude.convIdOf('/chat/not-a-uuid'), null);
        assert(claude.isNewChat('/new') && claude.isNewChat(`/project/${id}`) && !claude.isNewChat('/recents'));
        eq(claude.chatUrl(id), `https://claude.ai/chat/${id}`);
        eq(claude.chatUrl(null, { model: 'opus' }), 'https://claude.ai/new', 'a new Claude chat has no address for a model');
        eq(ChatSites.siteOfUrl('https://claude.ai/chat/x').id, 'claude');
        eq(ChatSites.allKeys().filter((key) => key.startsWith('claude')).length, 6);
        eq(ChatSites.siteKey('claude', 'queueOpenTab'), 'claudeQueueOpenTab');
    });
    check('every claude notice blocks, and says which allowance ran out', () => {
        const T = new Date(2025, 10, 13, 18).getTime();
        const five = new Date(2025, 10, 13, 21).getTime();
        eq(ChatSites.readLimit('claude', 'You are out of free messages until 9 PM.', T),
            { model: '', until: five, blocked: true, window: '' });
        eq(ChatSites.readLimit('claude', '5-hour limit reached · resets 9:00 PM', T).window, 'session');
        const weekly = ChatSites.readLimit('claude', 'Weekly limit reached. Your limit resets Monday at 9 AM.', T);
        eq([weekly.window, weekly.blocked, new Date(weekly.until).getDay()], ['weekly', true, 1]);
        eq(ChatSites.readLimit('claude', 'Claude can make mistakes.', T), null);
    });
    check('claude.ai is detected under its own name', () => {
        const Site = require('../src/content/site.js');
        eq(Site.detectSite('claude.ai'), 'claude');
        eq(Site.detectSite('notclaude.ai'), 'other');
    });

    // ------------------------------------------------- the forge registry

    section('the forge registry');

    const ForgeSites = require('../src/shared/forge-sites.js');

    check('every forge setting the registry can name has a default, and each button\'s is off', () => {
        // A button goes into the forge's own page, which is asked for. How
        // a copied link reads puts nothing there, and is on; so is watching
        // your own pull request, which waits for the Watch button anyway.
        eq(ForgeSites.allKeys(), ['githubCiWatch', 'githubCiWatchOwn', 'githubFolderDownload', 'githubLinkRepo', 'githubTopicSearch',
            'gitlabCiWatch', 'forgejoCiWatch']);
        eq(ForgeSites.allKeys().map((key) => globalThis.BB.Settings.DEFAULTS[key]), [false, true, false, true, false, false, false]);
        eq([ForgeSites.siteKey('gitlab', 'ciWatch'), ForgeSites.siteKey('gitlab', 'ciWatchOwn'), ForgeSites.siteKey('gitlab', 'nonsense'),
            ForgeSites.siteKey('nowhere', 'ciWatch')], ['gitlabCiWatch', null, null, null]);
    });
    check('only a forge without a folder download of its own has one from here', () => {
        // GitLab's and Forgejo's folder menus both zip a folder already.
        eq(ForgeSites.list().map((site) => ForgeSites.siteKey(site.id, 'folderDownload')), ['githubFolderDownload', null, null]);
        eq(Object.keys(globalThis.BB.Settings.DEFAULTS).filter((key) => /FolderDownload$/.test(key)), ['githubFolderDownload']);
    });
    check('a github link names its repository last, after a dash, wherever github\'s own title had it', () => {
        const Markdown = require('../src/content/markdown.js');
        const named = (title, path = '/microsoft/vscode') => Markdown.githubLabel(title, path, true);
        // Signed in, as github.com gave them in October 2026.
        eq(named('microsoft/vscode: Visual Studio Code'), 'Visual Studio Code - microsoft/vscode');
        eq(named('Open Source VS Code · Issue #1 · microsoft/vscode', '/microsoft/vscode/issues/1'),
            'Open Source VS Code · Issue #1 - microsoft/vscode');
        eq(named('vscode/README.md at main · microsoft/vscode', '/microsoft/vscode/blob/main/README.md'),
            'vscode/README.md at main - microsoft/vscode');
        eq(named('A question · microsoft/vscode · Discussion #7', '/microsoft/vscode/discussions/7'),
            'A question · Discussion #7 - microsoft/vscode', 'in the middle');
        eq(named('microsoft/vscode'), 'microsoft/vscode', 'a repository with nothing said about it is its name');
        eq(named('Issues · microsoft/vscode', '/Microsoft/VSCode/issues'), 'Issues - microsoft/vscode',
            'the address has what was typed, the title has its name');

        // Signed out, GitHub's own name is around the same title.
        eq(named('GitHub - microsoft/vscode: Visual Studio Code · GitHub'), 'Visual Studio Code - microsoft/vscode');
        eq(named('Open Source VS Code · Issue #1 · microsoft/vscode · GitHub', '/microsoft/vscode/issues/1'),
            'Open Source VS Code · Issue #1 - microsoft/vscode');
        eq(named('GitHub - a mirror · Issue #2 · microsoft/vscode · GitHub', '/microsoft/vscode/issues/2'),
            'GitHub - a mirror · Issue #2 - microsoft/vscode', 'an issue\'s own words were taken for the site\'s name');

        const bare = (title, path = '/microsoft/vscode') => Markdown.githubLabel(title, path, false);
        eq([bare('microsoft/vscode: Visual Studio Code'), bare('Commits · microsoft/vscode', '/microsoft/vscode/commits/main'), bare('microsoft/vscode')],
            ['Visual Studio Code', 'Commits', 'microsoft/vscode']);

        // Not a repository's page, or one that names it some other way.
        for (const [title, path] of [
            ['Your profile', '/settings/profile'], ['microsoft repositories · GitHub', '/orgs/microsoft/repositories'],
            ['torvalds (Linus Torvalds)', '/torvalds'], ['Home · microsoft/vscode Wiki', '/microsoft/vscode/wiki'],
            ['Contributors to microsoft/vscode', '/microsoft/vscode/graphs/contributors'],
            ['Build · microsoft/vscode@1a2b3c4', '/microsoft/vscode/actions/runs/1'],
        ]) eq([named(title, path), bare(title, path)], [title, title], path);

        const url = 'https://github.com/microsoft/vscode/issues/1';
        const getPage = () => ({ title: 'Open Source VS Code · Issue #1 · microsoft/vscode', url, path: '/microsoft/vscode/issues/1' });
        const link = (site, settings) => Markdown.createMarkdown({ site, pageInfo: {}, getSettings: () => settings, getPage }).pageLink().markdown;
        eq(link('github', {}), `[Open Source VS Code · Issue #1 - microsoft/vscode](${url})`);
        eq(link('github', { githubLinkRepo: false }), `[Open Source VS Code · Issue #1](${url})`);
        eq(link('gitlab', {}), `[Open Source VS Code · Issue #1 · microsoft/vscode](${url})`, 'another forge\'s titles are not GitHub\'s');
    });
    check('every forge has a settings panel of its own, drawn before binding, whose switch carries its key as its id', () => {
        const ForgeSettings = require('../src/page/forge-settings.js');
        const html = readRepo('dashboard.html');
        const dashboard = readRepo('dashboard.js');
        for (const site of ForgeSites.list()) {
            assert(html.includes(`data-site-settings="${site.id}" data-forge-settings="${site.id}"`), `${site.id} has no settings panel`);
            const panel = ForgeSettings.panelHtml(site);
            for (const kind of site.features) {
                const key = ForgeSites.siteKey(site.id, kind);
                assert(panel.includes(`<input type="checkbox" id="${key}">`), `${key} has no switch`);
                eq(html.includes(`id="${key}"`), false, `${key} is drawn twice`);
            }
            eq(panel.includes('FolderDownload'), site.features.includes('folderDownload'), `${site.id} draws a switch it has no key for`);
        }
        assert(!html.includes('data-plate="Git forges"'), 'the switches are under General as well');
        const at = dashboard.indexOf('ForgeSettings.mountAll()');
        assert(at > -1 && at < dashboard.indexOf('SettingsForm.bindAll()'), 'drawn after the form was bound, so never bound');
    });
    check('each forge has a card in the launcher under the id it is detected by, and a page behind it', () => {
        const SiteIcons = require('../src/shared/site-icons.js');
        const html = readRepo('dashboard.html');
        const dashboard = readRepo('dashboard.js');
        for (const site of ForgeSites.list()) {
            eq(SiteIcons.get(site.id) && SiteIcons.get(site.id).name, site.name, site.id);
            assert(html.includes(`id="${site.id}WatchingPanel"`) && dashboard.includes(`'${site.id}WatchingPanel'`), `${site.id} opens on nothing`);
        }
        eq(SiteIcons.ORDER.slice(-6, -3), ['github', 'gitlab', 'forgejo'], 'after every site a saved order already names');
    });
    check('a github run is the same run on any of its tabs, and a pull request on any of its', () => {
        const run = ForgeSites.pageOfUrl('https://github.com/microsoft/vscode/actions/runs/37600934749');
        eq(run, { site: 'github', kind: 'run', repo: 'microsoft/vscode', number: '37600934749', key: 'github:microsoft/vscode:run:37600934749' });
        for (const tail of ['/job/1066', '/attempts/2', '?pr=4', '#summary-9']) {
            eq(ForgeSites.pageOfUrl(`https://github.com/microsoft/vscode/actions/runs/37600934749${tail}`).key, run.key, tail);
        }
        eq(ForgeSites.pageOfUrl('https://github.com/microsoft/vscode/pull/340224/checks').key, 'github:microsoft/vscode:pull:340224');
        eq(ForgeSites.pageOfUrl('https://www.github.com/a/b/pull/7/files').kind, 'pull');
    });
    check('a github page that is neither is nothing to watch', () => {
        for (const url of ['https://github.com/microsoft/vscode', 'https://github.com/microsoft/vscode/actions',
            'https://github.com/microsoft/vscode/actions/runs/abc', 'https://github.com/microsoft/vscode/pulls',
            'https://github.com/microsoft/vscode/issues/12', 'https://gist.github.com/a/b/pull/1', 'not a url']) {
            eq(ForgeSites.pageOfUrl(url), null, url);
        }
    });
    check('a gitlab project is everything before /-/, however deep its groups go', () => {
        eq(ForgeSites.pageOfUrl('https://gitlab.com/gitlab-org/gitlab-runner/-/pipelines/2921579040').key,
            'gitlab:gitlab-org/gitlab-runner:run:2921579040');
        const deep = ForgeSites.pageOfUrl('https://gitlab.com/a/b/c/d/project/-/merge_requests/7353/diffs');
        eq([deep.repo, deep.kind, deep.number], ['a/b/c/d/project', 'pull', '7353']);
        for (const url of ['https://gitlab.com/gitlab-org/gitlab-runner/-/pipelines', 'https://gitlab.com/gitlab-org/gitlab-runner/-/jobs/12',
            'https://gitlab.com/project/-/pipelines/1', 'https://gitlab.com/a/b/pipelines/1']) {
            eq(ForgeSites.pageOfUrl(url), null, url);
        }
    });
    check('codeberg reads as forgejo: runs under actions, pull requests under pulls', () => {
        eq(ForgeSites.pageOfUrl('https://codeberg.org/forgejo/forgejo/actions/runs/205222/jobs/0/attempt/1').key, 'forgejo:forgejo/forgejo:run:205222');
        eq(ForgeSites.pageOfUrl('https://codeberg.org/forgejo/forgejo/pulls/14738/files').key, 'forgejo:forgejo/forgejo:pull:14738');
        eq(ForgeSites.pageOfUrl('https://codeberg.org/forgejo/forgejo/pull/14738'), null, 'that is github\'s word');
        eq([ForgeSites.siteOfHost('codeberg.org').name, ForgeSites.siteOfHost('CODEBERG.ORG').id, ForgeSites.siteOfHost('example.org')],
            ['Codeberg', 'forgejo', null]);
    });
    check('a forge is detected by its exact host, and nothing beside it is', () => {
        const Site = require('../src/content/site.js');
        eq(['github.com', 'www.github.com', 'gist.github.com', 'notgithub.com'].map((host) => Site.detectSite(host)),
            ['github', 'github', 'other', 'other']);
        eq(['gitlab.com', 'docs.gitlab.com', 'about.gitlab.com'].map((host) => Site.detectSite(host)), ['gitlab', 'other', 'other']);
        eq(['codeberg.org', 'docs.codeberg.org', 'translate.codeberg.org'].map((host) => Site.detectSite(host)), ['forgejo', 'other', 'other']);
    });
    check('each forge that is detected has its entry and its adapter, and its switch reaches an open page', () => {
        const Site = require('../src/content/site.js');
        const main = readRepo('src/content/main.js');
        const entry = contentScripts().find((one) => (one.js || []).includes('src/content/ci-watch.js'));
        const detected = ForgeSites.list().filter((forge) => Site.detectSite(forge.hosts[0]) === forge.id);
        assert(detected.length, 'no forge is detected at all');
        for (const forge of detected) {
            for (const pattern of forge.tabPatterns) assert(entry.matches.includes(pattern), `${pattern} is not matched`);
            const file = `src/content/${forge.id}-read.js`;
            assert(entry.js.indexOf(file) > -1 && entry.js.indexOf(file) < entry.js.indexOf('src/content/main.js'), `${file} is not loaded before main.js`);
            assert(new RegExp(`${forge.id}: \\(\\) => BB\\.\\w+Read\\.adapter`).test(main), `${forge.id} has no adapter in main.js`);
        }
        assert(/forgeSurfacesChanged && forgeUi\) forgeUi\.refreshSurfaces\(\)/.test(main), 'turning the switch would wait for a reload');
    });

    section('the forge ci watch — reading a run');

    const CiWatch = require('../src/shared/ci-watch.js');

    check('every spelling the three forges were seen to draw reads as its state', () => {
        // Copied from the live pages and their data, October 2026.
        const seen = {
            failed: ['failed:  octicon octicon-x-circle-fill color-fg-danger', 'failing checks', 'FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE',
                'ERROR', 'status_failed_borderless-icon', 'ci-icon ci-icon-variant-danger', 'failed', 'failure',
                'svg octicon-x-circle-fill text red', 'commit-status icon text red svg octicon-x', 'commit-status icon text red svg gitea-exclamation'],
            running: ['currently running: ', 'anim-rotate', 'StatusIcon-module__animRotate__PjD3B', 'in progress checks', 'IN_PROGRESS',
                'prc-Spinner-SpinnerAnimation-tutJZ', 'status_running_borderless-icon', 'running', 'svg octicon-meter text yellow job-status-rotate'],
            queued: ['queued: ', 'QUEUED', 'PENDING', 'EXPECTED', 'status_pending_borderless', 'created', 'preparing', 'waiting_for_resource',
                'scheduled', 'waiting', 'blocked', 'commit-status icon text yellow svg octicon-dot-fill'],
            passed: ['completed successfully: ', 'octicon octicon-check-circle-fill color-fg-success', 'successful checks', 'SUCCESS', 'NEUTRAL',
                'status_success_borderless-icon', 'status_warning', 'success', 'svg octicon-check-circle-fill text green',
                'commit-status icon text green svg octicon-check', 'commit-status icon text yellow svg gitea-exclamation'],
            cancelled: ['cancelled: octicon-stop', 'CANCELLED', 'status_canceled', 'canceling'],
            skipped: ['skipped: octicon-skip', 'SKIPPED', 'STALE', 'commit-status icon text grey svg octicon-skip'],
            manual: ['status_manual', 'manual', 'ACTION_REQUIRED'],
        };
        for (const [state, spellings] of Object.entries(seen)) {
            for (const one of spellings) eq(CiWatch.stateOf(one), state, one);
        }
        eq([CiWatch.stateOf(''), CiWatch.stateOf('   '), CiWatch.stateOf('unknown'), CiWatch.stateOf(null)], [null, null, null, null]);
        eq(CiWatch.stateOf('Blocked by required conditions'), 'queued', '"required" is not red');
    });
    check('a run\'s own state is taken as drawn; checks with none are read from their jobs', () => {
        const jobs = (...states) => states.map((state, i) => ({ name: `job ${i}`, state }));
        eq(CiWatch.summarize({ state: 'running', jobs: jobs('passed', 'failed', 'running') }),
            { state: 'running', failed: ['job 1'], left: 1 });
        eq(CiWatch.summarize({ jobs: jobs('passed', 'queued') }).state, 'running', 'a check yet to start');
        eq(CiWatch.summarize({ jobs: jobs('passed', 'failed', 'cancelled') }).state, 'failed');
        eq(CiWatch.summarize({ jobs: jobs('passed', 'cancelled') }).state, 'cancelled');
        eq(CiWatch.summarize({ jobs: jobs('passed', 'manual', 'skipped') }).state, 'manual');
        eq(CiWatch.summarize({ jobs: jobs('skipped', 'skipped') }).state, 'skipped');
        eq(CiWatch.summarize({ jobs: jobs('passed', 'skipped') }).state, 'passed');
        eq([CiWatch.summarize({ jobs: [] }), CiWatch.summarize(null), CiWatch.summarize({ jobs: [{ name: 'x', state: null }] })], [null, null, null]);
    });
    check('a job drawn twice is named once, and a nameless one not at all', () => {
        // GitHub draws each job in the sidebar and again in the graph.
        const twice = [{ name: 'Linux / Electron', state: 'failed' }, { name: ' Linux / Electron ', state: 'failed' }, { name: '', state: 'failed' }];
        eq(CiWatch.summarize({ state: 'failed', jobs: twice }).failed, ['Linux / Electron']);
    });
    check('the watch ends when the run does, or at the first failure', () => {
        const at = (state, failed = []) => CiWatch.outcome({ state, failed, left: 0 });
        eq([at('running'), at('queued'), at('passed'), at('cancelled'), at('manual'), at('skipped')],
            [null, null, 'passed', 'cancelled', 'manual', 'skipped']);
        eq(at('running', ['Compile & Hygiene']), 'failed', 'the run goes on; the wait is over');
        eq(at('failed'), 'failed', 'a failure the page names no job for');
        const going = { state: 'running', failed: ['lint'], left: 2 };
        eq([CiWatch.outcome(going, ['lint']), CiWatch.outcome({ ...going, failed: ['lint', 'test'] }, ['lint'])], [null, 'failed'],
            'a failure on screen as the watch began is not news; the next one is');
        eq(CiWatch.outcome(null), null);
    });
    check('the notification says what ended, how, where, and which jobs failed', () => {
        const watch = { noun: 'Checks', label: 'chore: bump @github/copilot-sdk', repo: 'microsoft/vscode' };
        eq(CiWatch.message(watch, { state: 'passed', failed: [], left: 0 }, 'passed'),
            { title: 'Checks passed — microsoft/vscode', message: 'chore: bump @github/copilot-sdk' });
        const early = CiWatch.message(watch, { state: 'running', failed: ['A', 'B', 'C', 'D', 'E'], left: 3 }, 'failed');
        eq(early.message.split('\n')[1], 'Failed: A, B, C and 2 more (3 still running)');
        const late = CiWatch.message({ ...watch, noun: 'Pipeline' }, { state: 'failed', failed: ['lint'], left: 0 }, 'failed');
        eq(late, { title: 'Pipeline failed — microsoft/vscode', message: 'chore: bump @github/copilot-sdk\nFailed: lint' });
        eq(CiWatch.message(watch, { state: 'manual', failed: [], left: 1 }, 'manual').title, 'Checks stopped at a manual job — microsoft/vscode');
    });

    section('the forge ci watch — the worker');

    require('../src/background/router.js');
    const CiWatchWorker = require('../src/background/ci-watch.js');

    /** The worker over fakes that write down what they were asked. */
    function ciWorker({ session = true, tabs = {} } = {}) {
        const kept = {};
        const asked = { notes: [], cleared: [], tabs: [], windows: [] };
        const areaOf = { get: async (key) => ({ [key]: kept[key] }), set: async (values) => { Object.assign(kept, JSON.parse(JSON.stringify(values))); } };
        const api = {
            storage: session ? { session: areaOf } : { local: areaOf },
            runtime: { getURL: (path) => `chrome-extension://bb/${path}` },
            notifications: { create: async (id, options) => { asked.notes.push({ id, ...options }); }, clear: async (id) => { asked.cleared.push(id); } },
            tabs: {
                get: async (id) => { if (id === 404) throw new Error('No tab with id'); return { id, windowId: 9, ...tabs[id] }; },
                update: async (id, props) => { asked.tabs.push([id, props]); tabs[id] = { ...tabs[id], ...props }; },
            },
            windows: { update: async (id, props) => { asked.windows.push([id, props]); } },
        };
        return { worker: CiWatchWorker.createWorker(api), kept, asked };
    }
    const fromTab = (id) => ({ tab: { id } });
    const ciWatch = { key: 'github:microsoft/vscode:run:1', noun: 'Run', label: 'chore: bump', repo: 'microsoft/vscode' };

    await checkAsync('a watch is its tab\'s, and only a page on the same run gets it back', async () => {
        const { worker } = ciWorker();
        eq(await worker.start({ watch: { ...ciWatch, known: ['lint'] } }, fromTab(7)), { ok: true });
        const kept = await worker.get({ key: ciWatch.key }, fromTab(7));
        eq([kept.label, kept.known], ['chore: bump', ['lint']], 'the failures it began with outlive a reload');
        eq(await worker.get({ key: 'github:microsoft/vscode:run:2' }, fromTab(7)), null, 'another run in the same tab');
        eq(await worker.get({ key: ciWatch.key }, fromTab(8)), null, 'the same run in another tab');
        eq(await worker.get({ key: ciWatch.key }, {}), null, 'not from a tab at all');
        eq(await worker.start({ watch: {} }, fromTab(7)), { ok: false });
    });
    await checkAsync('a watch started without a click still says so after a reload; one clicked for says nothing of it', async () => {
        const { worker } = ciWorker();
        await worker.start({ watch: { ...ciWatch, auto: true } }, fromTab(7));
        await worker.start({ watch: { ...ciWatch, auto: 'yes' } }, fromTab(8));
        eq((await worker.get({ key: ciWatch.key }, fromTab(7))).auto, true);
        eq('auto' in (await worker.get({ key: ciWatch.key }, fromTab(8))), false);
    });
    await checkAsync('the end of a run is said once, and only for a watch the worker knows', async () => {
        const { worker, asked } = ciWorker();
        await worker.start({ watch: ciWatch }, fromTab(7));
        const end = { key: ciWatch.key, title: 'Run passed — microsoft/vscode', message: 'chore: bump' };
        eq(await worker.done(end, fromTab(7)), { ok: true });
        eq(await worker.done(end, fromTab(7)), { ok: false }, 'a second report of the same end');
        eq(await worker.done(end, fromTab(8)), { ok: false }, 'a tab that was not watching');
        eq(asked.notes.length, 1);
        const [note] = asked.notes;
        assert(note.id.startsWith('bb-ci:7:'), note.id);
        eq([note.type, note.title, note.message, note.iconUrl], ['basic', end.title, end.message, 'chrome-extension://bb/icons/icon128.png']);
        eq(await worker.get({ key: ciWatch.key }, fromTab(7)), null, 'the watch is over');
    });
    await checkAsync('stopping, or closing the tab, ends a watch without a word', async () => {
        const { worker, asked } = ciWorker({ session: false });
        await worker.start({ watch: ciWatch }, fromTab(7));
        await worker.start({ watch: { ...ciWatch, key: 'gitlab:a/b:run:3' } }, fromTab(8));
        eq(await worker.stop({ key: 'gitlab:a/b:run:4' }, fromTab(8)), { ok: false }, 'not the run it watches');
        eq(await worker.stop({ key: ciWatch.key }, fromTab(7)), { ok: true });
        await worker.closed(8);
        eq(await worker.all(), {});
        eq(asked.notes, []);
    });
    await checkAsync('a watched tab is kept from being discarded until its watch is over; one kept already is left as it was', async () => {
        const { worker, asked } = ciWorker({ tabs: { 8: { autoDiscardable: false } } });
        await worker.start({ watch: ciWatch }, fromTab(7));
        await worker.start({ watch: { ...ciWatch, key: 'github:microsoft/vscode:pull:2' } }, fromTab(7));
        await worker.start({ watch: ciWatch }, fromTab(8));
        eq(asked.tabs, [[7, { autoDiscardable: false }]], 'once for the tab, and never for the one kept already');
        eq(await worker.stop({ key: 'github:microsoft/vscode:pull:2' }, fromTab(7)), { ok: true });
        eq(asked.tabs[1], [7, { autoDiscardable: true }], 'the replaced watch\'s hold is undone with the one that replaced it');
        await worker.done({ key: ciWatch.key, title: 'Run passed', message: '' }, fromTab(8));
        eq(asked.tabs.length, 2, 'tab 8 is left kept');
        await worker.start({ watch: ciWatch }, fromTab(404));
        eq(asked.tabs.length, 2, 'a tab that is gone is not asked to stay');
    });
    await checkAsync('two tabs starting at once both keep their watch', async () => {
        const { worker } = ciWorker();
        await Promise.all([1, 2, 3].map((tab) => worker.start({ watch: { ...ciWatch, key: `k${tab}` } }, fromTab(tab))));
        eq(Object.keys(await worker.all()).sort(), ['1', '2', '3']);
    });
    await checkAsync('a click brings the watched tab forward, and a closed one quietly does not', async () => {
        const { worker, asked } = ciWorker();
        eq(await worker.clicked('bb-ci:7:1700000000000'), true);
        eq([asked.cleared, asked.tabs, asked.windows], [['bb-ci:7:1700000000000'], [[7, { active: true }]], [[9, { focused: true }]]]);
        eq(await worker.clicked('bb-ci:404:1'), false, 'closed since');
        eq(await worker.clicked('somebody-else:7:1'), false, 'not ours');
    });
    check('the dashboard lists a forge\'s watches from the worker\'s own key, the newest first', () => {
        const View = require('../src/page/ci-watch-view.js');
        eq(View.KEY, CiWatchWorker.KEY);
        const watches = {
            7: { key: 'github:a/b:run:1', noun: 'Run', label: 'older', repo: 'a/b', since: 1000 },
            8: { key: 'gitlab:g/p:run:2', noun: 'Pipeline', label: 'not github', repo: 'g/p', since: 3000 },
            9: { key: 'github:a/b:pull:3', noun: 'Checks', label: '<b>newer</b>', repo: 'a/b', since: 2000 },
        };
        eq(View.listFor('github', watches).map((one) => [one.tab, one.label]), [[9, '<b>newer</b>'], [7, 'older']]);
        eq(View.listFor('forgejo', watches), []);
        const html = View.render('github', View.listFor('github', watches), 2000 + 5 * 60000);
        assert(html.includes('&lt;b&gt;newer&lt;/b&gt;') && !html.includes('<b>newer'), 'a title is the page\'s, and is text');
        assert(html.includes('Checks · a/b · watched since 5 minutes ago'), html);
        const empty = View.render('forgejo', []);
        assert(empty.includes('Nothing on Codeberg is being watched') && empty.includes('data-open-settings="forgejo"'), empty);
    });
    check('the worker is loaded, after the router, and the notifications it raises are asked for', () => {
        const scripts = [.../importScripts\(([\s\S]*?)\);/.exec(readRepo('background.js'))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
        assert(scripts.indexOf('src/background/ci-watch.js') > scripts.indexOf('src/background/router.js'));
        for (const name of ['manifest.json', 'manifest.firefox.json']) {
            const doc = JSON.parse(readRepo(name));
            assert(doc.permissions.includes('notifications'), name);
        }
        assert(JSON.parse(readRepo('manifest.firefox.json')).background.scripts.includes('src/background/ci-watch.js'));
    });

    section('the forge folder download');

    globalThis.BB.Zip = require('../src/shared/zip.js');
    const FetchPool = require('../src/shared/fetch-pool.js');
    const FolderDownload = require('../src/content/folder-download.js');
    const GithubFolder = require('../src/content/github-read.js');

    check('a github folder is anything under /tree/, and a repo, a file or a run is not', () => {
        eq(GithubFolder.folderAt('/yt-dlp/yt-dlp/tree/master/yt_dlp/extractor'), { repo: 'yt-dlp/yt-dlp', url: '/yt-dlp/yt-dlp/tree/master/yt_dlp/extractor' });
        eq(GithubFolder.folderAt('/a/b/tree/feature/x/src?plain=1').url, '/a/b/tree/feature/x/src');
        for (const path of ['/a/b', '/a/b/tree', '/a/b/blob/main/x.js', '/a/b/actions/runs/1', '/a']) eq(GithubFolder.folderAt(path), null, path);
    });
    await checkAsync('the folder is read from its own JSON: the commit it is at, and its path', async () => {
        const answer = (body, ok = true) => async () => ({ ok, json: async () => body });
        const route = { path: 'yt_dlp/extractor/youtube', refInfo: { name: 'master', currentOid: '51bab8a0116f4d8004c315706d809782607d5847' }, tree: { items: [] } };
        eq(await GithubFolder.readFolder({ url: '/x' }, { fetchImpl: answer({ payload: { codeViewTreeRoute: route } }) }),
            { oid: '51bab8a0116f4d8004c315706d809782607d5847', path: 'yt_dlp/extractor/youtube', items: [] });
        eq(await GithubFolder.readFolder({ url: '/x' }, { fetchImpl: answer({ payload: { codeViewTreeRoute: { ...route, refInfo: { currentOid: 'main' } } } }) }), null,
            'a name where a commit should be');
        eq(await GithubFolder.readFolder({ url: '/x' }, { fetchImpl: answer({}, false) }), null);
        eq(await GithubFolder.readFolder({ url: '/x' }, { fetchImpl: async () => { throw new Error('offline'); } }), null);
    });
    await checkAsync('the file finder\'s list is cut to the folder, and a sibling that starts the same is not in it', async () => {
        const asked = [];
        const fetchImpl = async (url) => { asked.push(url); return { ok: true, json: async () => ({ paths: ['a/lib/x.js', 'a/lib/y/z.md', 'a/libx/no.js', 'b.js'] }) }; };
        eq(await GithubFolder.listFolder({ repo: 'o/r' }, { oid: 'f'.repeat(40), path: 'a/lib', items: [] }, { fetchImpl }), ['a/lib/x.js', 'a/lib/y/z.md']);
        eq(asked, [`/o/r/tree-list/${'f'.repeat(40)}`]);
    });
    check('each file is fetched raw, from the forge itself, at the commit, its path escaped', () => {
        eq(GithubFolder.adapter.folder.rawUrl({ repo: 'o/r' }, { oid: 'f'.repeat(40) }, 'docs/a b#1.md'), `/o/r/raw/${'f'.repeat(40)}/docs/a%20b%231.md`);
    });
    check('a zip opens to the folder itself, with what is under it', () => {
        eq(FolderDownload.entryName('src/shared', 'src/shared/zip.js'), 'shared/zip.js');
        eq(FolderDownload.entryName('docs', 'docs/a/b.md'), 'docs/a/b.md');
    });
    await checkAsync('the files are fetched a few at a time, kept in order, and the first failure ends it', async () => {
        let inFlight = 0;
        let most = 0;
        const out = await FetchPool.mapLimit([5, 1, 3, 2], 2, async (n) => {
            most = Math.max(most, ++inFlight);
            await new Promise((done) => setTimeout(done, n));
            inFlight--;
            return n * 10;
        });
        eq([out, most], [[50, 10, 30, 20], 2]);
        const started = [];
        let error = null;
        try {
            await FetchPool.mapLimit([1, 2, 3, 4, 5], 1, async (n) => { started.push(n); if (n === 2) throw new Error('two'); });
        } catch (thrown) { error = thrown.message; }
        eq([error, started], ['two', [1, 2]]);
    });
    await checkAsync('a file whose connection drops is asked for again, and a refusal is worded by whoever asked', async () => {
        const asked = [];
        const answers = [() => { throw new TypeError('Failed to fetch'); }, () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([7, 8]).buffer }), () => ({ ok: false, status: 404 })];
        const fetchImpl = async (url, init) => { asked.push(init.credentials); return answers.shift()(); };
        const options = { fetchImpl, init: { credentials: 'same-origin' }, as: 'arrayBuffer', retryMs: 0, refused: (status) => `Could not fetch a.js (${status})` };
        eq(Array.from(new Uint8Array(await FetchPool.fetchBody('/raw/a.js', options))), [7, 8]);
        let message = '';
        try { await FetchPool.fetchBody('/raw/a.js', options); } catch (error) { message = error.message; }
        eq([message, asked], ['Could not fetch a.js (404)', ['same-origin', 'same-origin', 'same-origin']]);
    });

    section('the github topic search');

    check('a topic page is /topics/<name>, and a topic is spelled as github spells one', () => {
        eq([GithubFolder.topicAt('/topics/cloud-native'), GithubFolder.topicAt('/topics/Go?o=desc&s=stars'), GithubFolder.topicAt('/topics/c%2B%2B')],
            ['cloud-native', 'go', 'c']);
        for (const path of ['/topics', '/topics/', '/topics/go/more', '/collections/go', '/a/topics', '/topics/%E0%A4%A']) eq(GithubFolder.topicAt(path), null, path);
        eq(['Cloud Native', 'topic:kubernetes', ' service_mesh ', '--a  b--', '#!', 'x'.repeat(60)].map(GithubFolder.topicName),
            ['cloud-native', 'kubernetes', 'service-mesh', 'a-b', '', 'x'.repeat(50)]);
    });
    check('a word typed in the box is a topic, or a filter kept as it was typed', () => {
        eq(['helm', 'topic:Helm', 'Stars:>500', 'pushed:>2026-06-01', 'language:go', '-archived:true', 'stars:', '#!'].map(GithubFolder.topicTerm), [
            { topic: 'helm' }, { topic: 'helm' }, { filter: 'stars:>500' }, { filter: 'pushed:>2026-06-01' }, { filter: 'language:go' },
            { filter: '-archived:true' }, null, null,
        ]);
    });
    check('every topic has to be on a repository, and every filter after them', () => {
        eq(GithubFolder.topicQuery({ topics: ['go', 'Kubernetes', 'go', ''], filters: ['stars:>500', 'pushed:>2026-06-01', 'stars:>500'] }),
            'topic:go topic:kubernetes stars:>500 pushed:>2026-06-01');
        const url = new URL(GithubFolder.topicSearchUrl({ topics: ['go', 'kubernetes'], filters: ['stars:>500'], sort: 'stars' }, 2));
        eq([url.origin + url.pathname, url.searchParams.get('q'), url.searchParams.get('sort'), url.searchParams.get('order'), url.searchParams.get('page')],
            ['https://api.github.com/search/repositories', 'topic:go topic:kubernetes stars:>500', 'stars', 'desc', '2']);
        eq(new URL(GithubFolder.topicSearchUrl({ topics: ['go'] })).searchParams.has('sort'), false, 'best match is no sort');
    });
    await checkAsync('the search is asked signed out, and says what it found and whether there is more', async () => {
        const asked = [];
        const answer = (status, body, headers = {}) => async (url, init) => {
            asked.push([url, init.credentials]);
            return { ok: status < 300, status, headers: { get: (name) => headers[name] || null }, json: async () => body };
        };
        const item = { full_name: 'kubernetes/kubernetes', description: 'Production-Grade Container Scheduling', stargazers_count: 118000,
            forks_count: 41000, language: 'Go', topics: ['go', 'kubernetes'], pushed_at: '2026-10-17T10:00:00Z' };
        const full = await GithubFolder.searchTopics({ topics: ['go'] }, 1, { fetchImpl: answer(200, { total_count: 250, items: Array(100).fill(item) }) });
        eq([full.total, full.repos.length, full.more, full.repos[0]], [250, 100, true, {
            repo: 'kubernetes/kubernetes', description: 'Production-Grade Container Scheduling', stars: 118000, forks: 41000,
            language: 'Go', topics: ['go', 'kubernetes'], pushed: '2026-10-17T10:00:00Z', archived: false,
        }]);
        eq(asked[0][1], 'omit', 'the search went with your session');
        const last = await GithubFolder.searchTopics({ topics: ['go'] }, 10, { fetchImpl: answer(200, { total_count: 5000, items: Array(100).fill(item) }) });
        eq(last.more, false, 'past the 1,000 the search hands back');

        const limited = await GithubFolder.searchTopics({ topics: ['go'] }, 1, {
            now: 1000000, fetchImpl: answer(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1042' }),
        });
        eq([limited.wait, /ten searches a minute/.test(limited.error)], [42, true]);
        eq((await GithubFolder.searchTopics({ topics: ['go'] }, 1, { fetchImpl: answer(429, {}, { 'retry-after': '7' }) })).wait, 7);
        eq((await GithubFolder.searchTopics({ topics: ['go'] }, 1, {
            fetchImpl: answer(403, { message: 'Request forbidden by administrative rules.' }, { 'x-ratelimit-remaining': '8' }),
        })).error, 'Request forbidden by administrative rules.', 'a refusal is not the limit');
        eq((await GithubFolder.searchTopics({ topics: ['go'] }, 1, { fetchImpl: answer(422, { message: 'Validation Failed' }) })).error, 'Validation Failed');
        eq((await GithubFolder.searchTopics({ topics: ['go'] }, 1, { fetchImpl: async () => { throw new TypeError('offline'); } })).error,
            'GitHub\'s search could not be reached');
    });

    // ------------------------------------------------- the conversation tree

    section('the conversation tree');

    const ChatTree = require('../src/shared/chat-tree.js');

    /**
     * A chat with the two things that make it a tree: the second prompt was
     * edited (u2a and u2b are siblings), and the answer to the edit was asked
     * for three times, the page showing the second.
     */
    function chatFixture({ current = 'a2b2' } = {}) {
        const n = (role, parent, children, text, at, extra) => ({ role, parent, children, text, at, ...extra });
        return ChatTree.build({
            site: 'chatgpt', id: 'c1', title: 'Flaky test', url: 'https://chatgpt.com/c/c1',
            createdAt: 1000, updatedAt: 9000, root: 'r', current,
            nodes: {
                r: n('root', null, ['u1'], '', 0),
                u1: n('user', 'r', ['a1'], 'Why is the login test flaky?\nIt fails one run in ten.', 1),
                a1: n('assistant', 'u1', ['u2a', 'u2b'],
                    '## Cause\nA race on the session.\n```sh\n# not a heading\n```\n### Fix\nAwait it.', 2, { model: 'gpt-5' }),
                u2a: n('user', 'a1', ['a2a'], 'Retry it three times?', 10),
                a2a: n('assistant', 'u2a', [], 'Retries hide it.', 11),
                u2b: n('user', 'a1', ['a2b1', 'a2b2', 'a2b3', 'ghost'], 'What about mocking the clock?', 20),
                a2b1: n('assistant', 'u2b', [], 'Mock it with fake timers.', 21),
                a2b2: n('assistant', 'u2b', [], 'Freeze the clock.\n# Steps\nOne.', 22, { ids: ['a2b2', 'tool-1', 'a2b2-final'] }),
                a2b3: n('assistant', 'u2b', [], 'Use a clock you inject.', 23),
            },
        });
    }

    check('a child that names no node is dropped rather than walked into', () => {
        eq(chatFixture().nodes.u2b.children, ['a2b1', 'a2b2', 'a2b3']);
    });
    check('the forks are every edit and every regenerate', () => {
        eq(ChatTree.forks(chatFixture()).sort(), ['a1', 'u2b']);
    });
    check('a sibling reads the way the page numbers it', () => {
        eq(ChatTree.siblingIndex(chatFixture(), 'a2b2'), { index: 2, count: 3 });
        eq(ChatTree.siblingIndex(chatFixture(), 'u2a'), { index: 1, count: 2 });
        eq(ChatTree.siblingIndex(chatFixture(), 'u1'), { index: 1, count: 1 });
    });
    check('the path shown follows the current leaf, and never includes the root', () => {
        eq(ChatTree.activePath(chatFixture()), ['u1', 'a1', 'u2b', 'a2b2']);
        eq(ChatTree.pathTo(chatFixture(), 'a2a'), ['u1', 'a1', 'u2a', 'a2a']);
    });
    check('with no current leaf the newest branch is the one shown', () => {
        const conv = chatFixture({ current: 'nowhere' });
        eq(conv.current, null);
        eq(ChatTree.activePath(conv), ['u1', 'a1', 'u2b', 'a2b3']);
        eq(ChatTree.leafUnder(conv, 'u2a'), 'a2a');
    });
    check('a raw id the page drew is found in the turn that spans it', () => {
        const conv = chatFixture();
        eq(ChatTree.turnOf(conv, 'tool-1'), 'a2b2');
        eq(ChatTree.turnOf(conv, 'a2b2-final'), 'a2b2');
        eq(ChatTree.turnOf(conv, 'unknown'), null);
    });
    check('the outline is every prompt and every heading, and a # in a fence is neither', () => {
        eq(ChatTree.outline(chatFixture()).map((e) => `${e.level}:${e.text}`), [
            '0:Why is the login test flaky?', '2:Cause', '3:Fix', '0:What about mocking the clock?', '1:Steps',
        ]);
    });
    check('a fence closes only on the same mark, at least as long', () => {
        eq(ChatTree.headings('````md\n```\n# inside\n```\n````\n## After').map((h) => h.text), ['After']);
        eq(ChatTree.headings('~~~\n# inside\n```\n~~~\n# Out').map((h) => h.text), ['Out']);
    });
    check('a code block survives a fence of its own inside it', () => {
        eq(ChatTree.fence('x = 1\n', 'python'), '```python\nx = 1\n```');
        eq(ChatTree.fence('```js\nf()\n```', 'md'), '````md\n```js\nf()\n```\n````');
    });
    check('a first line is cut on a word', () => {
        eq(ChatTree.firstLine('\n  hello   world\nmore'), 'hello world');
        const long = ChatTree.firstLine('word '.repeat(40), 30);
        assert(long.length <= 30 && long.endsWith('…') && !/\s…$/.test(long), long);
    });

    // ------------------------------------------------- reading chatgpt's tree

    section('reading a chatgpt conversation');

    const ChatgptFormat = require('../src/shared/chatgpt-format.js');

    /**
     * backend-api/conversation/<id> as it answers: a synthetic root, a hidden
     * system message and the custom instructions above the first prompt; an
     * answer that searched, reasoned and then wrote, as five raw messages; a
     * regenerate of it; and a prompt with an image whose answer ran code.
     */
    function chatgptRaw() {
        const msg = (id, role, content, { t = 1700000000, recipient = 'all', metadata = {} } = {}) =>
            ({ id, author: { role }, create_time: t, content, recipient, metadata });
        const node = (id, parent, children, message) => ({ id, parent, children, message });
        const text = (s) => ({ content_type: 'text', parts: [s] });
        const cite = 'citeturn0search3';
        const stray = 'navlistturn0news1';
        return {
            conversation_id: 'conv-1', title: 'Flaky login test', create_time: 1700000000.5, update_time: 1700000900,
            current_node: 'a2b',
            mapping: {
                'client-created-root': node('client-created-root', null, ['sys'], null),
                sys: node('sys', 'client-created-root', ['ctx'], msg('sys', 'system', text(''),
                    { metadata: { is_visually_hidden_from_conversation: true } })),
                ctx: node('ctx', 'sys', ['u1'], msg('ctx', 'user', { content_type: 'user_editable_context' })),
                u1: node('u1', 'ctx', ['a1', 'a1x'], msg('u1', 'user', text('Why is it flaky?'), { t: 1700000001 })),
                a1: node('a1', 'u1', ['t1'], msg('a1', 'assistant', text('{"search_query":[{"q":"flaky login test"}]}'),
                    { recipient: 'web.run' })),
                t1: node('t1', 'a1', ['a1b'], msg('t1', 'tool', text('ten results'))),
                a1b: node('a1b', 't1', ['a1c'], msg('a1b', 'assistant',
                    { content_type: 'thoughts', thoughts: [{ summary: 'Looking', content: 'It races.' }] })),
                a1c: node('a1c', 'a1b', ['a1d'], msg('a1c', 'assistant', { content_type: 'reasoning_recap', content: 'Thought for 4s' })),
                a1d: node('a1d', 'a1c', ['u2'], msg('a1d', 'assistant', text(`## Cause\nA race.${cite} Stray${stray}.\n\n## Fix\nAwait it.`), {
                    metadata: {
                        model_slug: 'gpt-5-thinking',
                        content_references: [{ matched_text: cite, type: 'grouped_webpages',
                            items: [{ title: 'Race conditions', url: 'https://example.com/race' }] }],
                    },
                })),
                a1x: node('a1x', 'u1', [], msg('a1x', 'assistant', text('Regenerated.'), { metadata: { model_slug: 'gpt-5' } })),
                u2: node('u2', 'a1d', ['a2'], msg('u2', 'user',
                    { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer' }, 'Run this'] })),
                a2: node('a2', 'u2', ['t2'], msg('a2', 'assistant', { content_type: 'code', language: 'unknown', text: 'print(1)' },
                    { recipient: 'python' })),
                t2: node('t2', 'a2', ['a2b'], msg('t2', 'tool', { content_type: 'execution_output', text: '1' })),
                a2b: node('a2b', 't2', [], msg('a2b', 'assistant', text('It printed 1.'), { metadata: { model_slug: 'gpt-5' } })),
            },
        };
    }

    check('the synthetic root and everything hidden under it drop out', () => {
        const conv = ChatgptFormat.normalize(chatgptRaw());
        eq(conv.root, 'client-created-root');
        eq(conv.nodes['client-created-root'].children, ['u1']);
        assert(!conv.nodes.sys && !conv.nodes.ctx, 'a hidden message became a turn');
        eq(ChatTree.activePath(conv), ['u1', 'a1', 'u2', 'a2']);
    });
    check('a tool chain is one turn, named for its first message and spanning all five', () => {
        const conv = ChatgptFormat.normalize(chatgptRaw());
        eq(conv.nodes.a1.ids, ['a1', 't1', 'a1b', 'a1c', 'a1d']);
        eq(conv.nodes.a1.blocks.map((b) => b.kind), ['tool', 'thinking', 'thinking', 'text']);
        eq(conv.nodes.a1.blocks[0].text, 'Searched the web: "flaky login test"');
        eq(conv.nodes.a1.model, 'gpt-5-thinking');
        eq(ChatTree.turnOf(conv, 'a1d'), 'a1');
    });
    check('a regenerate is a sibling of the answer it replaced', () => {
        const conv = ChatgptFormat.normalize(chatgptRaw());
        eq(ChatTree.forks(conv), ['u1']);
        eq(ChatTree.siblingIndex(conv, 'a1x'), { index: 2, count: 2 });
    });
    check('reasoning stays out of the text, and code and its output are fenced', () => {
        const conv = ChatgptFormat.normalize(chatgptRaw());
        assert(!conv.nodes.a1.text.includes('It races'), 'the thinking leaked into the answer');
        eq(conv.nodes.u2.text, '[image]\n\nRun this');
        eq(conv.nodes.a2.text, '```python\nprint(1)\n```\n\n```output\n1\n```\n\nIt printed 1.');
    });
    check('citations become footnotes and no private-use character survives anywhere', () => {
        const conv = ChatgptFormat.normalize(chatgptRaw());
        assert(conv.nodes.a1.text.includes('A race.[^1] Stray.'), conv.nodes.a1.text);
        eq(conv.nodes.a1.cites, [{ n: 1, title: 'Race conditions', url: 'https://example.com/race' }]);
        eq(/[-]/.test(JSON.stringify(conv)), false);
    });
    check('times arrive as seconds from one endpoint and ISO from another', () => {
        const conv = ChatgptFormat.normalize(chatgptRaw());
        eq(conv.createdAt, 1700000000500);
        eq(conv.nodes.u1.at, 1700000001000);
        eq(conv.url, 'https://chatgpt.com/c/conv-1');
        eq(ChatgptFormat.listItem({ id: 'x', title: ' ', update_time: '2025-11-09T10:00:00Z' }),
            { id: 'x', title: 'Untitled chat', updatedAt: Date.parse('2025-11-09T10:00:00Z') });
    });
    check('an empty or broken answer from the api is an empty tree, not a throw', () => {
        eq(ChatTree.activePath(ChatgptFormat.normalize(null)), []);
    });


    // ------------------------------------------------- landing on a turn

    section('the shared scroll helpers');

    check('skim keeps no copy of the helpers it now shares', () => {
        const source = readRepo('src/content/skim.js');
        assert(!/function (innerScroller|isPinned|markArrival)\b/.test(source), 'a private copy is back');
        assert(/ScrollTo\.markArrival\(pulse/.test(source), 'skim no longer marks its arrival');
    });
    check('the helpers load before the launcher that calls them', () => {
        const js = JSON.parse(readRepo('manifest.json')).content_scripts[0].js;
        assert(js.indexOf('src/content/scroll-to.js') > -1, 'not shipped');
        assert(js.indexOf('src/content/scroll-to.js') < js.indexOf('src/content/skim.js'),
            'skim.js would get undefined for ScrollTo at load');
    });

    // ------------------------------------------------------ the chat panel

    section('the chat panel');

    const ChatPanel = require('../src/content/chat-panel.js');

    check('the panel docks only where the thread leaves it room', () => {
        // A 768px thread centred in 1180px of main pane ends at 1234 on a
        // 1440 window: 206px of margin, which a 340px panel would cover.
        eq(ChatPanel.fitsBeside(1440, 1234), false);
        eq(ChatPanel.fitsBeside(1920, 1344), true);
        eq(ChatPanel.fitsBeside(1100, null), false, 'nothing to measure on a narrow window');
        eq(ChatPanel.fitsBeside(1600, null), true, 'nothing to measure on a wide one');
    });
    check('what the panel draws is painted by the skins, never by a colour of its own', () => {
        const css = readRepo('content-chat.css');
        const block = css.slice(css.indexOf('Chat sites — ChatGPT and Claude'));
        const hard = block.match(/:\s*#[0-9a-f]{3,8}\b/gi) || [];
        eq(hard, [], `a colour was baked into the chat rules: ${hard.join(', ')}`);
    });
    check('the outline row being read is the last one at or above the reading line', () => {
        const conv = chatFixture();
        const entries = ChatTree.outline(conv);  // u1, Cause, Fix, u2b, Steps
        const path = ChatTree.activePath(conv);
        eq(ChatPanel.currentEntry(entries, path, { id: 'u1', heading: '' }), 0);
        eq(ChatPanel.currentEntry(entries, path, { id: 'a1', heading: '' }), 0, 'an answer above its first heading is its prompt');
        eq(ChatPanel.currentEntry(entries, path, { id: 'a1', heading: 'Cause' }), 1);
        eq(ChatPanel.currentEntry(entries, path, { id: 'a1', heading: 'Fix' }), 2);
        eq(ChatPanel.currentEntry(entries, path, { id: 'a2b2', heading: '' }), 3);
        eq(ChatPanel.currentEntry(entries, path, null), -1);
    });
    check('an outline row carries its turn and heading, and escapes what the chat wrote', () => {
        const html = ChatPanel.outlineHtml([{ id: 'u"1', level: 0, text: '<b>hi</b>' }, { id: 'a1', level: 2, text: 'Fix', heading: 'Fix' }]);
        assert(html.includes('data-bb-chat-reach="u&quot;1"') && html.includes('&lt;b&gt;hi&lt;/b&gt;'), html);
        assert(html.includes('class="bb-chat-entry is-l2"') && html.includes('data-bb-chat-heading="Fix"'), html);
        assert(ChatPanel.outlineHtml([]).includes('bb-chat-empty'));
    });
    check('the panel remembers itself under a key of its own', () => {
        eq(globalThis.BB.Settings.DATA.chatPanel, 'bbChatPanel');
    });

    // ---------------------------------------------- moving the page to a turn

    section('reaching a turn');

    const ChatNav = require('../src/content/chat-nav.js');

    check('with nothing mounted a turn is looked for at its share of the thread', () => {
        eq(ChatNav.estimateTop({ index: 10, total: 40, scrollHeight: 20000 }), 5000);
        eq(ChatNav.estimateTop({ index: 0, total: 0, scrollHeight: 20000 }), 0);
    });
    check('with turns mounted it steps from the nearest by their average height', () => {
        // Turns 20-22 are mounted, 300px apiece, from 6000 down.
        const mounted = [{ index: 20, top: 6000, height: 300 }, { index: 21, top: 6300, height: 300 },
            { index: 22, top: 6600, height: 300 }];
        eq(ChatNav.estimateTop({ index: 30, total: 40, scrollHeight: 20000, mounted }), 9000);
        eq(ChatNav.estimateTop({ index: 5, total: 40, scrollHeight: 20000, mounted }), 1500);
        eq(ChatNav.estimateTop({ index: 0, total: 40, scrollHeight: 20000, mounted: [{ index: 3, top: 100, height: 900 }] }), 0,
            'never above the top of the thread');
    });

    const path = ['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4', 'a4'];
    const prompts = ['u1', 'u2', 'u3', 'u4'];
    check('the next prompt is the first one below the reading line', () => {
        const mounted = [{ id: 'a2', top: -400 }, { id: 'u3', top: 250 }, { id: 'a3', top: 400 }];
        eq(ChatNav.pickNeighbour({ prompts, path, mounted, direction: 1 }), 'u3');
        eq(ChatNav.pickNeighbour({ prompts, path, mounted, direction: -1 }), 'u2',
            'none mounted above the line, so the path says which');
    });
    check('a prompt sitting on the line is where you are, not where you go', () => {
        const mounted = [{ id: 'u2', top: 3 }, { id: 'a2', top: 90 }];
        eq(ChatNav.pickNeighbour({ prompts, path, mounted, direction: 1 }), 'u3');
        eq(ChatNav.pickNeighbour({ prompts, path, mounted, direction: -1 }), 'u1');
    });
    check('there is nothing past either end', () => {
        eq(ChatNav.pickNeighbour({ prompts, path, mounted: [{ id: 'a4', top: -50 }], direction: 1 }), null);
        eq(ChatNav.pickNeighbour({ prompts, path, mounted: [{ id: 'u1', top: 0 }], direction: -1 }), null);
        eq(ChatNav.pickNeighbour({ prompts, path, mounted: [], direction: 1 }), 'u1', 'an unmounted thread starts at the top');
    });
    check('a turn not on the path shown is not somewhere to go', () => {
        const mounted = [{ id: 'elsewhere', top: 100 }, { id: 'u1', top: -10 }];
        eq(ChatNav.pickNeighbour({ prompts, path, mounted, direction: 1 }), 'u2');
    });

    // ------------------------------------------------------- chat hotkeys

    section('chat hotkeys');

    check('the chat keys fire in the prompt box, so none is a bare letter and none clashes', () => {
        const Keybindings = require('../src/shared/keybindings.js');
        eq(Keybindings.SCOPES.chat, 'ChatGPT and Claude');
        eq(Keybindings.list({}, 'chat').map((b) => b.id), ['chat-next', 'chat-prev', 'chat-pin', 'chat-prompts', 'chat-queue']);
        for (const binding of Keybindings.list({}, 'chat')) {
            assert(binding.combo.ctrl && binding.combo.alt, `${binding.id} would fire while typing`);
            assert(!/^Arrow/.test(binding.combo.code), 'Ctrl+Alt+arrows rotate the screen on Windows');
            eq(Keybindings.conflicts({}, binding.id, binding.combo), []);
        }
    });
    check('a chat hotkey is taken, and a symbol typed through AltGr is not', () => {
        const ChatUi = require('../src/content/chat-ui.js');
        const quiet = { add() {}, remove() {}, has: () => false, schedule() {}, stop() {} };
        const ui = ChatUi.createChatUi({ adapter: { site: 'chatgpt' }, watcher: quiet, notify() {} });
        const press = (key, { ctrl = true, alt = true, altGraph = false } = {}) => ({
            code: 'KeyJ', key, ctrlKey: ctrl, altKey: alt, shiftKey: false, metaKey: false,
            getModifierState: (name) => name === 'AltGraph' && altGraph,
            preventDefault() { this.defaulted = true; },
            stopPropagation() {},
        });
        const next = press('j');
        ui.onHotkey(next);
        eq(next.defaulted, true, 'Ctrl+Alt+J was left to the page');
        for (const typed of [press('@'), press('j', { altGraph: true }), press('j', { ctrl: false, alt: false })]) {
            ui.onHotkey(typed);
            eq(typed.defaulted, undefined, `swallowed ${typed.key}`);
        }
        assert(!ui.isAltGr({ key: 'й', getModifierState: () => false }), 'a letter in another script is still that key');
    });

    // ----------------------------------------------------- the branch tree

    section('the branch tree');

    const ChatTreeView = require('../src/content/chat-tree-view.js');

    check('a forkless run folds into one segment, and forks, leaves and the current turn stay', () => {
        const nodes = { r: { role: 'root', parent: null, children: ['t1'] } };
        for (let i = 1; i <= 40; i++) {
            nodes[`t${i}`] = { role: i % 2 ? 'user' : 'assistant', parent: i === 1 ? 'r' : `t${i - 1}`,
                children: i < 40 ? [`t${i + 1}`] : [], text: `turn ${i}`, at: i };
        }
        nodes.t30.children.push('x31');
        nodes.x31 = { role: 'user', parent: 't30', children: [], text: 'an edit', at: 99 };
        const drawn = ChatTree.layout(ChatTree.build({ root: 'r', current: 't40', nodes }));
        eq(drawn.nodes.map((n) => String(n.run || n.id)).sort(), ['28', '8', 't1', 't30', 't31', 't40', 'x31'],
            'the kept turns, and the two runs by their length');
        eq(drawn.height, 6, 'forty turns drawn six deep');
        eq(drawn.width, 2);
        eq(drawn.nodes.find((n) => n.id === 'x31').sib, { index: 2, count: 2 });
        assert(drawn.nodes.find((n) => n.id === 'run:t2').onPath, 'the run on the path is not marked as on it');
        eq(ChatTree.layout(ChatTree.build({ root: 'r', current: 't40', nodes }), { compress: false }).height, 40);
    });
    check('a parent sits over the middle of its children', () => {
        const drawn = ChatTree.layout(chatFixture());
        const at = (id) => drawn.nodes.find((n) => n.id === id);
        eq([at('a2b1').x, at('a2b2').x, at('a2b3').x], [1, 2, 3]);
        eq(at('u2b').x, 2);
        eq(at('a1').x, (at('u2a').x + at('u2b').x) / 2);
        eq(at('a2b2').sib, { index: 2, count: 3 });
    });
    check('the tree is drawn in classes, never in colours, and labels each fork k/n', () => {
        const svg = ChatTreeView.render(ChatTree.layout(chatFixture()), { picked: ['a2b1'] });
        assert(svg.includes('>2/3<'), 'a regenerate has no k/n');
        assert(/data-bb-chat-node="a2b1"/.test(svg) && svg.includes('is-picked'), 'the picked node is not marked');
        eq(svg.match(/#[0-9a-f]{3,8}\b|rgba?\(|fill="(?!none)|stroke="/gi), null);
        assert(ChatTreeView.render(ChatTree.layout(chatFixture())).includes('<title>What about mocking the clock?</title>'));
        eq(ChatTreeView.render({ nodes: [], edges: [] }), '');
    });

    // ------------------------------------------------ comparing two answers

    section('comparing two answers');

    const ChatDiff = require('../src/shared/chat-diff.js');

    check('identical answers are one unchanged piece', () => {
        eq(ChatDiff.diff('same words here', 'same words here'), [{ op: '=', text: 'same words here' }]);
        eq(ChatDiff.diff('', ''), []);
    });
    check('a changed word is one out and one in, with its whitespace', () => {
        eq(ChatDiff.diff('Freeze the clock first.', 'Freeze the timer first.'),
            [{ op: '=', text: 'Freeze the ' }, { op: '-', text: 'clock ' }, { op: '+', text: 'timer ' }, { op: '=', text: 'first.' }]);
    });
    check('the pieces rejoin into both inputs exactly, whatever the whitespace', () => {
        const pairs = [
            ['  lead\n\n- one\n- two  \n', 'lead\n- one\n-  three\n'],
            ['a b c d e f g', 'x a c d f g y'],
            ['', 'all new'],
            ['all gone', ''],
        ];
        for (const [a, b] of pairs) {
            const ops = ChatDiff.diff(a, b);
            eq(ChatDiff.rejoin(ops, 'a'), a, 'the first side');
            eq(ChatDiff.rejoin(ops, 'b'), b, 'the second side');
        }
    });
    check('past the cap it diffs by line, and past that it shows the two whole', () => {
        const a = Array.from({ length: 30 }, (_, i) => `line ${i} alpha beta gamma`).join('\n');
        const b = Array.from({ length: 30 }, (_, i) => i % 2 ? `line ${i} alpha beta gamma` : `rewritten ${i} delta`).join('\n');
        const byLine = ChatDiff.compare(a, b, { wordEdits: 5 });
        eq(byLine.unit, 'line');
        eq(ChatDiff.rejoin(byLine.ops, 'b'), b);
        eq(ChatDiff.compare(a, b, { wordEdits: 5, lineEdits: 3 }).unit, 'whole');
    });

    const ChatCompare = require('../src/content/chat-compare.js');

    check('two regenerates share their prompt, which is shown once', () => {
        const html = ChatCompare.bodyHtml(chatFixture(), 'a2b1', 'a2b3');
        eq((html.match(/The prompt</g) || []).length, 1);
        assert(html.includes('>1/3<') && html.includes('>3/3<'), 'the two are not named as the page names them');
        assert(html.includes('<del>Mock ') && html.includes('<ins>Use '), html);
    });
    check('branches that split at an edit lead with the edit', () => {
        // A prompt picked stands for its answer.
        const html = ChatCompare.bodyHtml(chatFixture(), 'u2a', 'u2b');
        assert(html.includes('The prompts differ'), 'the edited prompts are not diffed');
        eq(ChatCompare.sides(chatFixture(), 'u2b').answer.id, 'a2b3', 'a prompt stands for its newest answer');
        assert(html.includes('Retries hide it.'), 'the first branch’s answer is missing');
    });
    check('what the chat wrote is escaped in a comparison', () => {
        const conv = chatFixture();
        conv.nodes.a2b1.text = '<img src=x onerror=alert(1)>';
        assert(!ChatCompare.bodyHtml(conv, 'a2b1', 'a2b2', 'inline').includes('<img'), 'markup from an answer reached the page');
    });

    // ------------------------------------------------------- chat export

    section('exporting a chat');

    const ChatExport = require('../src/shared/chat-export.js');

    check('maths becomes dollars in prose and is left alone inside code', () => {
        eq(ChatExport.toDollars('Area is \\( \\pi r^2 \\).'), 'Area is $\\pi r^2$.');
        eq(ChatExport.toDollars('\\[\nE = mc^2\n\\]'), '$$\nE = mc^2\n$$');
        const code = 'Match with `\\(x\\)` or:\n```regex\n\\(\\d+\\)\n```\nand \\(y\\).';
        eq(ChatExport.toDollars(code), 'Match with `\\(x\\)` or:\n```regex\n\\(\\d+\\)\n```\nand $y$.');
    });
    check('a table passes through byte for byte', () => {
        const table = '| a | b |\n|---|:-:|\n| `x|y` | \\(z\\) |';
        const conv = chatFixture();
        conv.nodes.a2b2.text = table;
        conv.nodes.a2b2.blocks = [];
        assert(ChatExport.markdown(conv, { dollars: false }).includes(table), 'the table was rewritten');
    });
    check('code keeps its language, and an answer quoting a fence gets a longer one', () => {
        const md = ChatExport.markdown(ChatgptFormat.normalize(chatgptRaw()), { now: 0 });
        assert(md.includes('```python\nprint(1)\n```'), 'the language was lost');
        const conv = chatFixture();
        conv.nodes.a2b2.blocks = [{ kind: 'code', lang: 'md', text: '```js\nf()\n```' }];
        assert(ChatExport.markdown(conv).includes('````md\n```js\nf()\n```\n````'), 'the inner fence closed the outer one');
    });
    check('a chatgpt export reads as front matter, then You and ChatGPT turn by turn', () => {
        const md = ChatExport.markdown(ChatgptFormat.normalize(chatgptRaw()), { now: Date.UTC(2025, 10, 9) });
        assert(md.startsWith('---\ntitle: "Flaky login test"\nsite: ChatGPT\nurl: https://chatgpt.com/c/conv-1\n'), md.slice(0, 120));
        assert(md.includes('models: ["gpt-5-thinking","gpt-5"]') && md.includes('exported: 2025-11-09T00:00:00.000Z'));
        eq((md.match(/^## You$/gm) || []).length, 2);
        eq((md.match(/^## ChatGPT$/gm) || []).length, 2);
        assert(md.includes('A race.[^1]') && md.includes('[^1]: [Race conditions](https://example.com/race)'), 'no footnote');
        assert(md.includes('*Searched the web: "flaky login test"*'), 'the search was dropped');
        assert(!md.includes('It races') && !md.includes('<details>'), 'thinking was exported unasked');
        assert(ChatExport.markdown(ChatgptFormat.normalize(chatgptRaw()), { thinking: true })
            .includes('<details><summary>Thought for 4s</summary>\n\n**Looking**\nIt races.\n\n</details>'));
        eq(/[\uE000-\uF8FF]/.test(md), false);
    });
    check('the json is the path shown, or the whole tree when asked', () => {
        const conv = chatFixture();
        const active = ChatExport.json(conv, { now: 0 });
        eq(active.type, 'bell-bearer-chat');
        eq(Object.keys(active.nodes).sort(), ['a1', 'a2b2', 'r', 'u1', 'u2b']);
        eq(active.nodes.a1.children, ['u2b'], 'a branch not exported is still listed as a child');
        eq(Object.keys(ChatExport.json(conv, { branches: 'all' }).nodes).length, 9);
        eq(ChatExport.json(conv, { raw: { x: 1 } }).raw, { x: 1 });
    });
    check('a file name is dated and something Windows will save', () => {
        const conv = { title: 'Why: "is" <this> a/b\\c|d?* flaky...', createdAt: new Date(2025, 10, 9, 12).getTime() };
        const name = ChatExport.fileName(conv, 'md');
        eq(name, '2025-11-09 Why is this a b c d flaky.md');
        assert(!/[<>:"/\\|?*]/.test(name));
        assert(ChatExport.fileName({ title: 'x'.repeat(400), createdAt: 1 }, 'json').length <= 120);
    });

    // ------------------------------------------------------------- zip

    section('the zip writer');

    const Zip = require('../src/shared/zip.js');

    /** Just enough of a zip reader to check one: the central directory, and each entry's bytes. */
    function readZip(bytes) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const end = bytes.length - 22;
        assert(view.getUint32(end, true) === 0x06054B50, 'no end-of-directory record where it should be');
        const count = view.getUint16(end + 10, true);
        let at = view.getUint32(end + 16, true);
        const out = [];
        for (let i = 0; i < count; i++) {
            assert(view.getUint32(at, true) === 0x02014B50, `entry ${i} is not a directory record`);
            const flags = view.getUint16(at + 8, true);
            const size = view.getUint32(at + 24, true);
            const nameLength = view.getUint16(at + 28, true);
            const local = view.getUint32(at + 42, true);
            const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
            const start = local + 30 + view.getUint16(local + 26, true);
            out.push({ name, size, utf8: !!(flags & 0x0800), crc: view.getUint32(at + 16, true), data: bytes.subarray(start, start + size) });
            at += 46 + nameLength;
        }
        return out;
    }

    check('the checksum is the standard CRC-32', () => {
        eq(Zip.crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')).toString(16), '414fa339');
        eq(Zip.crc32(new Uint8Array(0)), 0);
    });
    check('eight bytes a step sums the same as one at a time, at every length and offset around the step', () => {
        const table = Array.from({ length: 256 }, (_, n) => {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            return c >>> 0;
        });
        const slow = (bytes) => {
            let crc = 0xFFFFFFFF;
            for (const byte of bytes) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
            return (crc ^ 0xFFFFFFFF) >>> 0;
        };
        const data = Uint8Array.from({ length: 64 }, (_, i) => (i * 2654435761 >>> 13) & 255);
        for (let offset = 0; offset < 8; offset++) {
            for (let length = 0; length <= 40; length++) eq(Zip.crc32(data.subarray(offset, offset + length)), slow(data.subarray(offset, offset + length)), `${length} from ${offset}`);
        }
    });
    check('an archive reads back with the same names, sizes and bytes', () => {
        const files = [
            { name: 'index.md', data: '# Chats\n', at: new Date(2025, 10, 13, 10, 5, 8).getTime() },
            { name: '2025-11-09 Café — naïve.md', data: 'Ünïcödé body', at: Date.now() },
            { name: 'raw.bin', data: new Uint8Array([0, 255, 7]) },
        ];
        const read = readZip(Zip.build(files));
        eq(read.map((entry) => entry.name), files.map((file) => file.name));
        eq(read.map((entry) => entry.size), [8, 16, 3]);
        assert(read.every((entry) => entry.utf8), 'a name is not flagged as UTF-8');
        eq(new TextDecoder().decode(read[1].data), 'Ünïcödé body');
        eq(Array.from(read[2].data), [0, 255, 7]);
        eq(read[0].crc, Zip.crc32(new TextEncoder().encode('# Chats\n')));
    });
    await checkAsync('a file kept as a Blob once it is summed gives the same archive, byte for byte', async () => {
        const at = new Date(2025, 10, 13, 10, 5, 8).getTime();
        const files = [{ name: 'lib/a.js', data: 'export const a = 1;', at }, { name: 'lib/b.bin', data: new Uint8Array([0, 255, 7]), at }];
        const entries = files.map((file) => ({ ...Zip.entry(file), data: new Blob([file.data]) }));
        const joined = new Uint8Array(await new Blob(Zip.parts(entries)).arrayBuffer());
        eq(Array.from(joined), Array.from(Zip.build(files)));
        eq(readZip(joined).map((one) => one.name), ['lib/a.js', 'lib/b.bin']);
    });
    check('a DOS time stamp keeps the local time, to the two seconds it can', () => {
        const { time, date } = Zip.dosTime(new Date(2025, 10, 13, 10, 5, 9).getTime());
        eq([time >> 11, (time >> 5) & 63, (time & 31) * 2], [10, 5, 8]);
        eq([(date >> 9) + 1980, (date >> 5) & 15, date & 31], [2025, 11, 13]);
    });

    // ------------------------------------------------------------- mp4

    section('merging a video and an audio mp4');

    const Mp4Mux = require('../src/shared/mp4-mux.js');

    const u32s = (...values) => {
        const out = new Uint8Array(values.length * 4);
        values.forEach((value, i) => new DataView(out.buffer).setUint32(i * 4, value));
        return out;
    };
    const ascii4 = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));
    const fullBox = (type, version, flags, ...parts) => Mp4Mux.box(type, u32s(version * 2 ** 24 + flags), ...parts);

    /**
     * A DASH stream as YouTube serves one: ftyp, a one-track moov, a sidx,
     * then a moof and an mdat per fragment. Each fragment's one sample is
     * the text `<marker><n>`, so where it lands can be checked byte for byte.
     * `absolute` writes each base offset as a position in the file instead
     * of leaving it to the moof.
     */
    function dashStream({ marker, handler, scale, media, starts, absolute = false, edit = 0, unsaid = false, pad = 0 }) {
        const duration = unsaid ? 0 : Math.round((starts[starts.length - 1] + 1) * scale);
        const tkhd = fullBox('tkhd', 0, 3, u32s(0, 0, 1, 0, duration), new Uint8Array(60));
        const mdia = Mp4Mux.box('mdia', fullBox('mdhd', 0, 0, u32s(0, 0, media, Math.round(duration * media / scale)), new Uint8Array(4)),
            fullBox('hdlr', 0, 0, u32s(0), ascii4(handler), new Uint8Array(13)));
        const edts = edit ? [Mp4Mux.box('edts', fullBox('elst', 0, 0, u32s(1, edit, 0, 0x10000)))] : [];
        const moov = Mp4Mux.box('moov', fullBox('mvhd', 0, 0, u32s(0, 0, scale, duration), new Uint8Array(76), u32s(2)),
            Mp4Mux.box('mvex', fullBox('trex', 0, 0, u32s(1, 1, 0, 0, 0))), Mp4Mux.box('trak', tkhd, ...edts, mdia));
        const parts = [Mp4Mux.box('ftyp', ascii4('dash'), u32s(0), ascii4('iso6')), moov, fullBox('sidx', 0, 0, u32s(1, scale, 0, 0, 0))];
        let at = parts.reduce((sum, part) => sum + part.length, 0);
        starts.forEach((start, n) => {
            const sample = new Uint8Array(2 + pad);
            sample.set(ascii4(`${marker}${n}`));
            const moofOf = (dataOffset) => Mp4Mux.box('moof', fullBox('mfhd', 0, 0, u32s(n + 1)), Mp4Mux.box('traf',
                absolute ? fullBox('tfhd', 0, 0x000001, u32s(1, 0, at)) : fullBox('tfhd', 0, 0x020000, u32s(1)),
                fullBox('tfdt', 0, 0, u32s(Math.round(start * media))), fullBox('trun', 0, 0x000001, u32s(1, dataOffset))));
            const moof = moofOf(moofOf(0).length + 8);
            parts.push(moof, Mp4Mux.box('mdat', sample));
            at += moof.length + 8 + sample.length;
        });
        const bytes = new Uint8Array(at);
        let put = 0;
        for (const part of parts) { bytes.set(part, put); put += part.length; }
        return bytes;
    }

    /** The merged file as one buffer, and each fragment read back the way a player reads it. */
    function readMerged({ parts, size }, sources) {
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const part of parts) {
            const chunk = part instanceof Uint8Array ? part : sources[part.source].subarray(part.at, part.at + part.size);
            bytes.set(chunk, at);
            at += chunk.length;
        }
        eq(at, size, 'the parts add up to the size given');
        const dv = new DataView(bytes.buffer);
        const top = Mp4Mux.boxesIn(bytes);
        const fragments = top.filter((one) => one.type === 'moof').map((moof) => {
            const kids = (parent) => Mp4Mux.boxesIn(bytes, parent.at + 8, parent.at + parent.size);
            const mfhd = kids(moof).find((one) => one.type === 'mfhd');
            const traf = kids(moof).find((one) => one.type === 'traf');
            const [tfhd, tfdt, trun] = ['tfhd', 'tfdt', 'trun'].map((type) => kids(traf).find((one) => one.type === type));
            const base = dv.getUint32(tfhd.at + 8) & 1 ? dv.getUint32(tfhd.at + 16) * 2 ** 32 + dv.getUint32(tfhd.at + 20) : moof.at;
            const start = base + dv.getInt32(trun.at + 16);
            return { seq: dv.getUint32(mfhd.at + 12), track: dv.getUint32(tfhd.at + 12), time: dv.getUint32(tfdt.at + 12),
                sample: String.fromCharCode(...bytes.subarray(start, start + 2)) };
        });
        return { bytes, dv, top, fragments };
    }

    const videoStream = (more = {}) => dashStream({ marker: 'V', handler: 'vide', scale: 15360, media: 15360, starts: [0, 4, 8], edit: 15360 * 12, ...more });
    const audioStream = (more = {}) => dashStream({ marker: 'A', handler: 'soun', scale: 44100, media: 44100, starts: [0, 10], ...more });

    await checkAsync('both tracks come out in one moov, the audio renumbered to track 2', async () => {
        const sources = [videoStream(), audioStream()];
        const merged = await Mp4Mux.merge(sources.map(Mp4Mux.bytesSource));
        const { bytes, dv, top } = readMerged(merged, sources);
        eq(top.slice(0, 2).map((one) => one.type), ['ftyp', 'moov']);
        assert(!top.some((one) => one.type === 'sidx'), 'an index of one stream\'s bytes is kept');
        const moov = top[1];
        const inMoov = Mp4Mux.boxesIn(bytes, moov.at + 8, moov.at + moov.size);
        eq(inMoov.map((one) => one.type), ['mvhd', 'mvex', 'trak', 'trak']);
        const ids = inMoov.filter((one) => one.type === 'trak').map((trak) => dv.getUint32(Mp4Mux.boxesIn(bytes, trak.at + 8, trak.at + trak.size)[0].at + 20));
        eq(ids, [1, 2]);
        const mvex = inMoov[1];
        eq(Mp4Mux.boxesIn(bytes, mvex.at + 8, mvex.at + mvex.size).map((trex) => dv.getUint32(trex.at + 12)), [1, 2]);
        const mvhd = inMoov[0];
        eq([dv.getUint32(mvhd.at + 20), dv.getUint32(mvhd.at + mvhd.size - 4)], [15360, 3], 'the video\'s timescale, and the next free track');
        // Eleven seconds of audio is longer than nine of video, and is said in the video's units.
        eq([dv.getUint32(mvhd.at + 24), merged.seconds], [11 * 15360, 11]);
        const audioTkhd = Mp4Mux.boxesIn(bytes, inMoov[3].at + 8, inMoov[3].at + inMoov[3].size)[0];
        eq(dv.getUint32(audioTkhd.at + 28), 11 * 15360, 'the audio track\'s length in the movie\'s timescale');
    });
    await checkAsync('the fragments are interleaved by start time and numbered again, and every sample is where its moof says', async () => {
        const sources = [videoStream(), audioStream()];
        const { fragments } = readMerged(await Mp4Mux.merge(sources.map(Mp4Mux.bytesSource)), sources);
        eq(fragments.map((one) => [one.seq, one.track, one.sample]), [
            [1, 1, 'V0'], [2, 2, 'A0'], [3, 1, 'V1'], [4, 1, 'V2'], [5, 2, 'A1'],
        ]);
    });
    await checkAsync('a base offset written as a file position is moved with its fragment', async () => {
        const sources = [videoStream({ absolute: true }), audioStream({ absolute: true })];
        const { fragments } = readMerged(await Mp4Mux.merge(sources.map(Mp4Mux.bytesSource)), sources);
        eq(fragments.map((one) => one.sample), ['V0', 'A0', 'V1', 'V2', 'A1']);
    });
    await checkAsync('the mdats are named in their sources rather than copied', async () => {
        const sources = [videoStream(), audioStream()];
        const { parts } = await Mp4Mux.merge(sources.map(Mp4Mux.bytesSource));
        const spliced = parts.filter((part) => !(part instanceof Uint8Array));
        eq(spliced.map((part) => part.source), [0, 1, 0, 0, 1]);
        eq(spliced.map((part) => part.size), [10, 10, 10, 10, 10]);
    });
    await checkAsync('a stream whose headers leave its length out takes the length it is given', async () => {
        // Vimeo's, October 2026: mvhd, mdhd and mehd all 0, the length in its playlist.
        const sources = [videoStream({ unsaid: true }), audioStream({ unsaid: true })];
        const given = sources.map((bytes, i) => ({ ...Mp4Mux.bytesSource(bytes), seconds: [9.5, 11.25][i] }));
        const merged = await Mp4Mux.merge(given);
        const { bytes, dv, top } = readMerged(merged, sources);
        const inMoov = Mp4Mux.boxesIn(bytes, top[1].at + 8, top[1].at + top[1].size);
        eq([dv.getUint32(inMoov[0].at + 24), merged.seconds], [Math.round(11.25 * 15360), 11.25]);
        const tkhds = inMoov.filter((one) => one.type === 'trak').map((trak) => Mp4Mux.boxesIn(bytes, trak.at + 8, trak.at + trak.size)[0]);
        eq(tkhds.map((tkhd) => dv.getUint32(tkhd.at + 28)), [Math.round(9.5 * 15360), Math.round(11.25 * 15360)]);
    });
    await checkAsync('each fragment is one read — its header, its moof and the next header together — however large its mdat', async () => {
        const sources = [videoStream({ pad: 100 << 10 }), audioStream({ pad: 100 << 10 })];
        let reads = 0;
        const counted = sources.map((bytes) => {
            const source = Mp4Mux.bytesSource(bytes);
            return { size: source.size, read: (at, length) => { reads += 1; return source.read(at, length); } };
        });
        const { fragments } = readMerged(await Mp4Mux.merge(counted), sources);
        eq([fragments.map((one) => one.sample), reads], [['V0', 'A0', 'V1', 'V2', 'A1'], 5], 'twenty-three, read box by box');
    });
    await checkAsync('one stream on its own comes through as a file of its own', async () => {
        const sources = [videoStream()];
        const { fragments } = readMerged(await Mp4Mux.merge(sources.map(Mp4Mux.bytesSource)), sources);
        eq(fragments.map((one) => one.sample), ['V0', 'V1', 'V2']);
    });
    await checkAsync('a cut-short stream, a stream that is not mp4, and an encrypted one are each refused', async () => {
        const refused = async (sources) => {
            try { await Mp4Mux.merge(sources.map(Mp4Mux.bytesSource)); } catch (error) { return error.message; }
            return 'merged';
        };
        const whole = videoStream();
        assert(/cut short/.test(await refused([whole.subarray(0, whole.length - 3), audioStream()])));
        assert(/not an MP4/.test(await refused([new TextEncoder().encode('<html>Sign in to confirm you\'re not a bot</html>')])));
        const locked = videoStream();
        const hdlr = new TextDecoder('latin1').decode(locked).indexOf('vide');
        locked.set(ascii4('enca'), hdlr);
        assert(/encrypted/.test(await refused([locked])), 'an encrypted sample entry went through');
    });

    // ------------------------------------------------------- saving a video

    section('saving a video — the rendition, the pieces, the file');

    globalThis.BB.Mp4Mux = Mp4Mux;
    const VideoDownload = require('../src/content/video-download.js');

    const rendition = (width, height, more = {}) => ({ width, height, p: Math.min(width, height), label: `${Math.min(width, height)}p`, fps: 30, rank: 0, ...more });

    check('the quality wanted is the picture the player draws, else the one it was told to keep', () => {
        eq(VideoDownload.wanted({ videoWidth: 1920, videoHeight: 800 }, 720), { width: 1920, height: 800, p: 800 });
        eq(VideoDownload.wanted({ videoWidth: 1080, videoHeight: 1920 }, 0).p, 1080, 'a short is named by its narrow side');
        eq(VideoDownload.wanted({ videoWidth: 0, videoHeight: 0 }, 1080), { p: 1080 }, 'no frame drawn yet');
        eq(VideoDownload.wanted(null, 0), null);
    });
    check('the exact size wins; then the same lines; then the nearest below, and only then above', () => {
        const wide = rendition(1920, 800, { label: '1080p', p: 1080 });
        eq(VideoDownload.pick([rendition(1280, 534, { label: '720p', p: 720 }), wide], { width: 1920, height: 800, p: 800 }), wide,
            'a scope film is 1080p by name and 800 lines by picture');
        const list = [rendition(1280, 720), rendition(1920, 1080), rendition(3840, 2160, { rank: 1 })];
        eq(VideoDownload.pick(list, { p: 1080 }).height, 1080);
        eq(VideoDownload.pick(list, { p: 1440 }).height, 1080, 'nothing at 1440, so the nearest below');
        eq(VideoDownload.pick(list, { p: 144 }).height, 720, 'nothing below, so the nearest above');
        eq(VideoDownload.pick(list, null).height, 1080, 'nothing to match: the best up to 1080p');
        eq(VideoDownload.pick([], { p: 720 }), null);
    });
    check('among equals, the higher frame rate, then the adapter\'s codec, then the higher bitrate', () => {
        const av1 = rendition(1920, 1080, { fps: 60, rank: 1 });
        const avc = rendition(1920, 1080, { fps: 60, rank: 0, bitrate: 1 });
        const avcRich = rendition(1920, 1080, { fps: 60, rank: 0, bitrate: 2 });
        eq(VideoDownload.pick([rendition(1920, 1080, { fps: 30 }), av1, avc, avcRich], { width: 1920, height: 1080, p: 1080 }), avcRich);
    });
    check('a stream is fetched in pieces that cover it end to end', () => {
        eq(VideoDownload.chunks(25, 10), [[0, 9], [10, 19], [20, 24]]);
        eq(VideoDownload.chunks(20, 10), [[0, 9], [10, 19]]);
        eq(VideoDownload.chunks(0, 10), []);
    });
    check('a title becomes a file name any system takes, with the quality after it', () => {
        eq(VideoDownload.fileName('AC/DC: "Live" at <River Plate>?', '1080p60'), 'AC DC Live at River Plate (1080p60).mp4');
        eq(VideoDownload.fileName('  ...  ', ''), 'video.mp4');
        eq(VideoDownload.fileName('Ends with a dot.', '720p'), 'Ends with a dot (720p).mp4');
        assert(VideoDownload.fileName('x'.repeat(400), '720p').length < 170);
    });

    /** A server that answers `?range=a-b` from `bytes`, with whatever `trouble` says first. */
    function rangeServer(files, trouble = {}) {
        const asked = [];
        const fetchImpl = async (url) => {
            asked.push(url);
            const [base, query] = url.split('?');
            const range = /range=(\d+)-(\d+)/.exec(query || '');
            const bytes = files[base] || files[url];
            const problem = trouble[url] && trouble[url].shift();
            if (problem === 'drop') throw new TypeError('Failed to fetch');
            if (typeof problem === 'number') return { ok: false, status: problem, blob: async () => new Blob([]) };
            if (!bytes) return { ok: false, status: 404, blob: async () => new Blob([]) };
            const body = range ? bytes.subarray(Number(range[1]), Number(range[2]) + 1) : bytes;
            return { ok: true, status: 200, blob: async () => new Blob([problem === 'short' ? body.subarray(1) : body]) };
        };
        return { fetchImpl, asked };
    }
    const blobBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

    await checkAsync('the pieces come back in order, and a dropped, busy or short one is asked for again', async () => {
        const bytes = Uint8Array.from({ length: 25 }, (_, i) => i);
        const url = 'https://v.example/s?x=1';
        const server = rangeServer({ 'https://v.example/s': bytes }, { [`${url}&range=10-19`]: ['drop', 503], [`${url}&range=20-24`]: ['short'] });
        const sizes = [];
        const [blob] = await VideoDownload.fetchStreams([{ url, size: 25 }], { fetchImpl: server.fetchImpl, chunk: 10, retryMs: 0, onPiece: (size) => sizes.push(size) });
        eq(Array.from(await blobBytes(blob)), Array.from(bytes));
        eq([server.asked.length, sizes.sort((a, b) => a - b)], [6, [5, 10, 10]]);
        eq(VideoDownload.CHUNK, 10 << 20, 'yt-dlp\'s piece size, which googlevideo does not throttle');
    });
    await checkAsync('a refused piece is not asked for again, and the whole stream fails with it', async () => {
        const url = 'https://v.example/gone';
        const server = rangeServer({}, { [`${url}?range=0-9`]: [403] });
        let message = '';
        try { await VideoDownload.fetchStreams([{ url, size: 10 }], { fetchImpl: server.fetchImpl }); } catch (error) { message = error.message; }
        assert(/refused \(403\)/.test(message), message);
        eq(server.asked.length, 1);
    });
    await checkAsync('a segment list is fetched whole, each in its place', async () => {
        const server = rangeServer({ 'https://v.example/init.mp4': ascii4('II'), 'https://v.example/1.m4s': ascii4('11'), 'https://v.example/2.m4s': ascii4('22') });
        const [blob] = await VideoDownload.fetchStreams([{ urls: ['https://v.example/init.mp4', 'https://v.example/1.m4s', 'https://v.example/2.m4s'] }], { fetchImpl: server.fetchImpl });
        eq(new TextDecoder().decode(await blobBytes(blob)), 'II1122');
    });
    await checkAsync('the streams share one pool: once the sound is in, the picture has all six connections', async () => {
        const server = rangeServer({ 'https://v.example/video': new Uint8Array(120), 'https://v.example/audio': new Uint8Array(10) });
        const going = { video: 0, all: 0, mostVideo: 0, most: 0 };
        const fetchImpl = async (url) => {
            const video = url.includes('/video');
            going.all += 1;
            going.video += video ? 1 : 0;
            going.most = Math.max(going.most, going.all);
            going.mostVideo = Math.max(going.mostVideo, going.video);
            await new Promise((done) => setTimeout(done, 1));
            going.all -= 1;
            going.video -= video ? 1 : 0;
            return server.fetchImpl(url);
        };
        const blobs = await VideoDownload.fetchStreams([{ url: 'https://v.example/video', size: 120 }, { url: 'https://v.example/audio', size: 10 }], { fetchImpl, chunk: 10 });
        eq([blobs.map((blob) => blob.size), going.mostVideo, going.most], [[120, 10], 6, 6]);
    });

    /** An adapter with nothing to say about any site: a 720p picture and its sound, served by `server`. */
    function fakeVideoSite(streams, more = {}) {
        const offer = async () => ({ title: 'A video', video: [{ ...rendition(1280, 720), ...streams[0] }], audio: streams.slice(1) });
        return { site: 'test', name: 'Test', onVideo: () => true, storedQuality: () => 0, offer, ...more };
    }

    check('a film cropped to its size is what was asked for, a quality not there is said, and only a silent clip goes without sound', () => {
        const scope = rendition(1920, 800, { label: '1080p', p: 1080, url: 'https://v.example/scope' });
        const sound = { url: 'https://v.example/sound' };
        const offer = { title: 'Film', video: [scope], audio: [sound] };
        eq(VideoDownload.choose(offer, { width: 1920, height: 800, p: 800 }, 'YouTube').note, '', 'an 800-line picture saved as the 1080p it is called');
        eq(VideoDownload.choose(offer, { p: 1440 }, 'YouTube').note, '1440p is not offered as MP4 here — saving 1080p');
        eq(VideoDownload.choose(offer, null, 'YouTube').streams, [scope, sound]);
        eq(VideoDownload.choose({ title: 'Beeps', video: [scope], audio: [], silent: true }, null, 'Vimeo').streams, [scope]);
        let message = '';
        try { VideoDownload.choose({ title: 'Beeps', video: [scope], audio: [] }, null, 'Vimeo'); } catch (error) { message = error.message; }
        eq(message, 'Vimeo offered no MP4 streams for this video');
    });

    await checkAsync('a download fetches both streams, merges them, and saves one playable file', async () => {
        const video = videoStream();
        const audio = audioStream();
        const server = rangeServer({ 'https://v.example/video': video, 'https://v.example/audio': audio });
        const notes = [];
        const saved = [];
        const downloader = VideoDownload.createDownloader({
            adapter: fakeVideoSite([{ url: 'https://v.example/video', size: video.length }, { url: 'https://v.example/audio', size: audio.length }]),
            notify: (text, type) => notes.push([text, type]), getVideoElement: () => ({ videoWidth: 1280, videoHeight: 720 }),
            fetchImpl: server.fetchImpl, save: (name, blob, type) => saved.push({ name, blob, type }),
        });
        eq(downloader.info(), { ok: true, busy: false, percent: 0, label: '720p' });
        await downloader.start();
        eq([saved.length, saved[0].name, saved[0].type], [1, 'A video (720p).mp4', 'video/mp4']);
        const bytes = await blobBytes(saved[0].blob);
        const merged = readMerged({ parts: [bytes], size: bytes.length }, []);
        eq(merged.fragments.map((one) => one.sample), ['V0', 'A0', 'V1', 'V2', 'A1']);
        eq(notes[notes.length - 1], ['Saved A video (720p).mp4', 'success']);
        assert(notes.some(([text]) => text === 'Downloading 720p — 100%'), JSON.stringify(notes));
    });
    await checkAsync('a site with the download switched off is offered nothing, and a failure is said, not thrown', async () => {
        const off = VideoDownload.createDownloader({ adapter: fakeVideoSite([]), notify: () => {}, getVideoElement: () => null, enabled: () => false, save: () => assert(false, 'saved') });
        eq(off.info(), { ok: false });
        await off.start();
        const notes = [];
        const failing = VideoDownload.createDownloader({
            adapter: fakeVideoSite([], { offer: async () => { throw new Error('YouTube would not give the streams: Sign in'); } }),
            notify: (text, type) => notes.push([text, type]), getVideoElement: () => null, save: () => assert(false, 'saved'),
        });
        await failing.start();
        eq(notes.pop(), ['YouTube would not give the streams: Sign in', 'error']);
        eq(failing.info().busy, false);
    });

    /** A site whose list is three videos, `fails` among them unavailable, each a 720p picture and its sound. */
    function fakeListSite(fails = []) {
        const video = videoStream();
        const audio = audioStream();
        const server = rangeServer({ 'https://v.example/video': video, 'https://v.example/audio': audio });
        const streams = [{ url: 'https://v.example/video', size: video.length }, { url: 'https://v.example/audio', size: audio.length }];
        const titles = { v1: 'First', v2: 'Second', v3: 'Third' };
        const adapter = fakeVideoSite(streams, {
            offer: async ({ videoId }) => {
                if (fails.includes(videoId)) throw new Error('Video unavailable');
                return { title: titles[videoId], video: [{ ...rendition(1280, 720), ...streams[0] }], audio: streams.slice(1) };
            },
            list: async () => ({ title: 'A: Course?', videos: Object.keys(titles).map((id) => ({ id, title: titles[id] })) }),
        });
        return { adapter, fetchImpl: server.fetchImpl };
    }

    await checkAsync('a list is saved video by video into its folder, numbered, never asked about, and one that fails is passed over', async () => {
        const { adapter, fetchImpl } = fakeListSite(['v2']);
        const notes = [];
        const saved = [];
        const states = [];
        const downloader = VideoDownload.createDownloader({
            adapter, fetchImpl, notify: (text, type) => notes.push([text, type]), getVideoElement: () => null,
            save: (name, blob, type, only) => saved.push([name, type, only]), onChange: (one) => states.push(one),
        });
        await downloader.startList('PLcourse');
        eq(saved, [['A Course/1 - First (720p).mp4', 'video/mp4', { ask: false }], ['A Course/3 - Third (720p).mp4', 'video/mp4', { ask: false }]]);
        eq(notes.pop(), ['Saved 2 of 3 to A Course — not Second', 'warning']);
        assert(notes.some(([text]) => text === '3 of 3 · Downloading 720p — 100%'), JSON.stringify(notes));
        eq([...new Set(states.filter((one) => one.place).map((one) => `${one.place.at}/${one.place.of}`))], ['1/3', '2/3', '3/3']);
        eq(states[0].busy, true);
        eq(downloader.state(), { busy: false, percent: 100, place: null });
    });
    await checkAsync('cancelling a list stops the video going and every one after it, and a site without lists starts none', async () => {
        const { adapter, fetchImpl } = fakeListSite();
        const notes = [];
        const saved = [];
        const downloader = VideoDownload.createDownloader({
            adapter, fetchImpl, notify: (text, type) => notes.push([text, type]), getVideoElement: () => null,
            save: (name) => { saved.push(name); downloader.cancel(); },
        });
        await downloader.startList('PLcourse');
        eq([saved.length, notes.pop()], [1, ['Download cancelled', 'info']]);
        const plain = VideoDownload.createDownloader({ adapter: fakeVideoSite([]), notify: (text) => notes.push(text), getVideoElement: () => null, save: () => assert(false, 'saved') });
        const off = VideoDownload.createDownloader({ adapter, notify: (text) => notes.push(text), getVideoElement: () => null, enabled: () => false, save: () => assert(false, 'saved') });
        const before = notes.length;
        await plain.startList('PLcourse');
        await off.startList('PLcourse');
        eq(notes.length, before, 'something was said or started');
    });

    section('saving a youtube video');

    const YoutubeDownload = require('../src/content/youtube-download.js');

    /** A visionos answer in the shape YouTube gave for Big Buck Bunny, October 2026, cut to what is read. */
    const fmt = (itag, mimeType, more = {}) => ({ itag, mimeType, url: `https://rr1.googlevideo.com/videoplayback?itag=${itag}`, contentLength: String(itag * 1000), bitrate: itag, ...more });
    const ytAnswer = (formats, more = {}) => ({
        playabilityStatus: { status: 'OK' },
        videoDetails: { title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film', isLive: false },
        streamingData: { adaptiveFormats: formats },
        ...more,
    });
    const BUNNY = [
        fmt(401, 'video/mp4; codecs="av01.0.13M.08"', { width: 3840, height: 2160, fps: 60, qualityLabel: '2160p60' }),
        fmt(315, 'video/webm; codecs="vp9"', { width: 3840, height: 2160, fps: 60, qualityLabel: '2160p60' }),
        fmt(400, 'video/mp4; codecs="av01.0.12M.08"', { width: 2560, height: 1440, fps: 60, qualityLabel: '1440p60' }),
        fmt(299, 'video/mp4; codecs="avc1.64002A"', { width: 1920, height: 1080, fps: 60, qualityLabel: '1080p60' }),
        fmt(399, 'video/mp4; codecs="av01.0.09M.08"', { width: 1920, height: 1080, fps: 60, qualityLabel: '1080p60' }),
        fmt(137, 'video/mp4; codecs="avc1.640028"', { width: 1920, height: 1080, fps: 60, qualityLabel: '1080p60', url: undefined, signatureCipher: 's=x&url=y' }),
        fmt(134, 'video/mp4; codecs="avc1.4D401E"', { width: 640, height: 360, fps: 30, qualityLabel: '360p' }),
        fmt(140, 'audio/mp4; codecs="mp4a.40.2"', { audioQuality: 'AUDIO_QUALITY_MEDIUM' }),
        fmt(140, 'audio/mp4; codecs="mp4a.40.2"', { isDrc: true, bitrate: 999 }),
        fmt(141, 'audio/mp4; codecs="mp4a.40.2"', { audioTrack: { displayName: 'French', audioIsDefault: false }, bitrate: 900 }),
        fmt(139, 'audio/mp4; codecs="mp4a.40.5"', {}),
        fmt(251, 'audio/webm; codecs="opus"', { bitrate: 5000 }),
    ];

    check('the player request is yt-dlp\'s visionos client, without cookies, carrying the page\'s visitor id', () => {
        const { url, init } = YoutubeDownload.playerRequest('aqz-KE-bpKQ', 'Cgt-visitor');
        eq([url, init.method, init.credentials], ['/youtubei/v1/player?prettyPrint=false', 'POST', 'omit']);
        eq([init.headers['X-YouTube-Client-Name'], init.headers['X-YouTube-Client-Version'], init.headers['X-Goog-Visitor-Id']], ['101', '1.02', 'Cgt-visitor']);
        const body = JSON.parse(init.body);
        eq([body.videoId, body.context.client.clientName, body.context.client.visitorData, body.contentCheckOk], ['aqz-KE-bpKQ', 'VISIONOS', 'Cgt-visitor', true]);
        assert(!('X-Goog-Visitor-Id' in YoutubeDownload.playerRequest('x', '').init.headers), 'an empty visitor id is still sent');
    });
    check('only MP4 with a plain address is offered, and the sound is the original, not a dub or the stable-volume copy', () => {
        const read = YoutubeDownload.readPlayer(ytAnswer(BUNNY));
        eq(read.video.map((one) => `${one.label} ${one.rank}`), ['2160p60 1', '1440p60 1', '1080p60 0', '1080p60 1', '360p 0']);
        eq(read.audio.map((one) => one.bitrate), [140, 139], 'loudest-first, without the DRC copy, the French dub or the opus');
        eq(read.title, 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film');
    });
    check('a video YouTube will not play this way, or a live one, says why', () => {
        eq(YoutubeDownload.readPlayer({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }),
            { ok: false, reason: 'Sign in to confirm you’re not a bot' });
        eq(YoutubeDownload.readPlayer(ytAnswer(BUNNY, { videoDetails: { isLive: true } })).reason, 'a live stream has no end to save');
        eq(YoutubeDownload.readPlayer(null).ok, false);
    });
    check('the quality the gear menu kept, and the visitor id the page was given, are read as the page wrote them', () => {
        const win = (value) => ({ localStorage: { getItem: () => value } });
        eq(YoutubeDownload.storedQuality(win('{"data":"{\\"quality\\":1080,\\"previousQuality\\":480}","expiration":1821081782210,"creation":1789977782210}')), 1080);
        eq([YoutubeDownload.storedQuality(win(null)), YoutubeDownload.storedQuality(win('not json'))], [0, 0]);
        const doc = { scripts: [{ textContent: 'var a = 1;' }, { textContent: 'ytcfg.set({"INNERTUBE_API_KEY":"k","VISITOR_DATA":"CgtaWnp%3D%3D","X":1});' }] };
        eq([YoutubeDownload.visitorData(doc), YoutubeDownload.visitorData({ scripts: [] })], ['CgtaWnp%3D%3D', '']);
    });
    await checkAsync('the plan is the rendition the player shows, as MP4, with the best original sound', async () => {
        const answering = (answer) => async () => ({ ok: true, json: async () => answer });
        const offered = (formats) => YoutubeDownload.adapter.offer({ videoId: 'aqz-KE-bpKQ', doc: { scripts: [] }, fetchImpl: answering(ytAnswer(formats)) });
        const plan = async (want, formats = BUNNY) => VideoDownload.choose(await offered(formats), want, YoutubeDownload.adapter.name);
        const hd = await plan({ width: 1920, height: 1080, p: 1080 });
        eq([hd.label, hd.streams.map((one) => /itag=(\d+)/.exec(one.url)[1]), hd.note], ['1080p60', ['299', '140'], '']);
        eq(hd.fileName, 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film (1080p60).mp4');
        eq((await plan({ width: 2560, height: 1440, p: 1440 })).streams[0].url, BUNNY[2].url, 'above 1080p the MP4 is AV1');
        eq((await plan({ p: 2160 }, BUNNY.filter((one) => one.itag !== 401))).note, '2160p is not offered as MP4 here — saving 1440p60');
        let message = '';
        try { await YoutubeDownload.adapter.offer({ videoId: 'x', doc: { scripts: [] }, fetchImpl: async () => ({ ok: false, status: 429 }) }); } catch (error) { message = error.message; }
        eq(message, 'YouTube refused to list the streams (429)');
    });
    /** A browse answer for a playlist in the shape YouTube gave in October 2026, cut to what is read. */
    const lockup = (id, title, contentType = 'LOCKUP_CONTENT_TYPE_VIDEO') => ({ lockupViewModel: { contentId: id, contentType, metadata: { lockupMetadataViewModel: { title: { content: title } } } } });
    const more = (token) => ({ continuationItemViewModel: { continuationCommand: { innertubeCommand: { continuationCommand: { token } } } } });
    const firstPage = (items, title = 'Uploads from Blender') => ({
        metadata: { playlistMetadataRenderer: { title } },
        contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ itemSectionRenderer: {
            // The sort chips carry commands of their own, and are not the next page.
            header: { chipBarViewModel: { chips: [{ chipViewModel: { tapCommand: { innertubeCommand: { continuationCommand: { token: 'SORT' } } } } }] } },
            contents: items,
        } }] } } } }] } },
    });
    const laterPage = (items) => ({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: items } }] });

    check('a playlist page is read for its videos in order, the next page\'s token, and its title', () => {
        const read = YoutubeDownload.readPlaylist(firstPage([lockup('a1', 'One'), lockup('PLx', 'A playlist', 'LOCKUP_CONTENT_TYPE_PLAYLIST'), lockup('a2', 'Two'), more('NEXT')]));
        eq(read, { ok: true, title: 'Uploads from Blender', videos: [{ id: 'a1', title: 'One' }, { id: 'a2', title: 'Two' }], next: 'NEXT' });
        eq(YoutubeDownload.readPlaylist(laterPage([lockup('a3', 'Three')])), { ok: true, title: '', videos: [{ id: 'a3', title: 'Three' }], next: '' });
        const older = { contents: { playlistVideoListRenderer: { contents: [
            { playlistVideoRenderer: { videoId: 'b1', title: { runs: [{ text: 'Old ' }, { text: 'shape' }] } } },
            { playlistVideoRenderer: { videoId: 'b2', title: { simpleText: 'Gone' }, isPlayable: false } },
            { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'OLD' } } } },
        ] } } };
        eq(YoutubeDownload.readPlaylist(older), { ok: true, title: '', videos: [{ id: 'b1', title: 'Old shape' }], next: 'OLD' }, 'the shape before lockups, and a deleted entry left out');
        eq(YoutubeDownload.readPlaylist({ alerts: [{ alertRenderer: { type: 'ERROR', text: { runs: [{ text: 'The playlist does not exist.' }] } } }] }),
            { ok: false, reason: 'The playlist does not exist.' });
        eq(YoutubeDownload.readPlaylist(null).ok, false);
    });
    check('a playlist is asked for as the web client, by its VL browse id, then by each page\'s token', () => {
        const first = YoutubeDownload.browseRequest({ playlistId: 'PLcourse' }, 'Cgt-visitor', '2.20261016.01.00');
        eq([first.url, first.init.method, first.init.credentials], ['/youtubei/v1/browse?prettyPrint=false', 'POST', 'omit']);
        eq([first.init.headers['X-YouTube-Client-Name'], first.init.headers['X-YouTube-Client-Version'], first.init.headers['X-Goog-Visitor-Id']], ['1', '2.20261016.01.00', 'Cgt-visitor']);
        const body = JSON.parse(first.init.body);
        eq([body.browseId, body.context.client.clientName, body.continuation], ['VLPLcourse', 'WEB', undefined]);
        const next = JSON.parse(YoutubeDownload.browseRequest({ continuation: 'NEXT' }, '').init.body);
        eq([next.continuation, next.browseId, next.context.client.clientVersion], ['NEXT', undefined, YoutubeDownload.WEB_VERSION]);
    });
    await checkAsync('a whole playlist is every page\'s videos, each once, in the version the page names', async () => {
        const pages = { '': firstPage([lockup('a1', 'One'), lockup('a2', 'Two'), more('P2')]), P2: laterPage([lockup('a2', 'Two'), lockup('a3', 'Three'), more('P3')]), P3: laterPage([lockup('a4', 'Four')]) };
        const asked = [];
        const fetchImpl = async (url, init) => {
            const body = JSON.parse(init.body);
            asked.push([body.browseId || body.continuation, body.context.client.clientVersion]);
            return { ok: true, json: async () => pages[body.continuation || ''] };
        };
        const doc = { scripts: [{ textContent: 'ytcfg.set({"INNERTUBE_CLIENT_VERSION":"2.20990101.00.00","VISITOR_DATA":"Cgt"});' }] };
        const got = await YoutubeDownload.adapter.list({ listId: 'PLcourse', doc, fetchImpl });
        eq([got.title, got.videos.map((one) => one.id)], ['Uploads from Blender', ['a1', 'a2', 'a3', 'a4']]);
        eq(asked, [['VLPLcourse', '2.20990101.00.00'], ['P2', '2.20990101.00.00'], ['P3', '2.20990101.00.00']]);
        let message = '';
        try { await YoutubeDownload.adapter.list({ listId: 'x', doc: { scripts: [] }, fetchImpl: async () => ({ ok: true, json: async () => ({ alerts: [{ alertRenderer: { type: 'ERROR', text: { simpleText: 'This playlist is private.' } } }] }) }) }); } catch (error) { message = error.message; }
        eq(message, 'YouTube would not give the playlist: This playlist is private.');
    });
    check('a watch page, a short or a live page has a video to save, and the home page does not', () => {
        const at = (pathname) => YoutubeDownload.adapter.onVideo({ location: { pathname } }, 'abc');
        eq(['/watch', '/shorts/abc', '/live/abc', '/', '/results', '/@channel'].map(at), [true, true, true, false, false, false]);
        eq(YoutubeDownload.adapter.onVideo({ location: { pathname: '/watch' } }, null), false);
    });
    check('the youtube entry loads the merge, the core and the adapter before main.js', () => {
        for (const name of ['manifest.json', 'manifest.firefox.json']) {
            const entry = contentScripts(name).find((one) => one.js.includes('src/content/youtube-ui.js'));
            const at = (file) => entry.js.indexOf(file);
            assert(at('src/shared/fetch-pool.js') > -1 && at('src/shared/fetch-pool.js') < at('src/content/video-download.js'), name);
            assert(at('src/shared/mp4-mux.js') > -1 && at('src/shared/mp4-mux.js') < at('src/content/video-download.js'), name);
            assert(at('src/content/video-download.js') < at('src/content/youtube-download.js') && at('src/content/youtube-download.js') < at('src/content/main.js'), name);
        }
    });

    section('saving a youtube video — the switch and the popup');

    check('the download is off until Settings › YouTube turns it on, and the switch is bound by its key', () => {
        eq(globalThis.BB.Settings.DEFAULTS.youtubeDownload, false);
        const html = readRepo('dashboard.html');
        assert(html.includes('<input type="checkbox" id="youtubeDownload">'), 'no switch');
        const start = html.indexOf('id="youtubeSettingsPanel"');
        const next = html.indexOf('class="settings-section"', start);
        const at = html.indexOf('id="youtubeDownload"');
        assert(at > start && (next < 0 || at < next), 'the switch is not in the YouTube panel');
    });
    check('the popup asks the tab, and the tab answers all three questions', () => {
        const popup = readRepo('popup.js');
        const main = readRepo('src/content/main.js');
        assert(readRepo('popup.html').includes('id="downloadBar"') && popup.includes("Settings.get(['youtubeDownload'])"), 'the bar is not tied to the switch');
        for (const action of ['downloadInfo', 'downloadVideo', 'downloadCancel']) {
            assert(readRepo('src/page/tab-actions.js').includes(`action: '${action}'`), `the popup never asks ${action}`);
            assert(main.includes(`case '${action}':`), `the tab never answers ${action}`);
        }
        assert(/enabled: \(\) => settings\.youtubeDownload === true/.test(main), 'the tab would download with the switch off');
    });
    check('the popup\'s download is its glyph alone, the quality it saves its tooltip, and a stop while it runs', () => {
        const html = readRepo('popup.html');
        const button = html.slice(html.indexOf('<button id="downloadBtn"'), html.indexOf('</button>', html.indexOf('<button id="downloadBtn"')));
        assert(button.includes('data-icon="download-simple"') && button.includes('data-icon="x"'), 'no glyph to start or to stop');
        assert(/<span id="downloadLabel" hidden><\/span>/.test(button), 'the button still has words at rest');
        const popup = readRepo('popup.js');
        assert(/`Download\$\{info\.label \? ` \$\{info\.label\}` : ''\}`/.test(popup) && popup.includes('button.title = said;'), 'the quality is not in the tooltip');
        assert(popup.includes("button.classList.toggle('is-busy', this.downloadBusy)"), 'a running download does not turn into a stop');
    });
    check('the download beside a playlist\'s follow is the tab\'s downloader, and follows the switch on a page already open', () => {
        const main = readRepo('src/content/main.js');
        assert(/playlistDownload: \{\s*enabled: \(\) => settings\.youtubeDownload === true,\s*start: \(listId\) => downloader\.startList\(listId\)/.test(main), 'not the tab\'s downloader, or not behind the switch');
        assert(main.includes('onChange: () => youtubeUi.markDownloadButton(),'), 'the button does not follow the download');
        assert(main.includes('if (downloadChanged && youtubeUi) youtubeUi.markDownloadButton();'), 'the switch does not reach an open page');
    });
    check('download, the party, the reader and the speed share one row in the popup, with no line of description', () => {
        const html = readRepo('popup.html');
        const row = html.slice(html.indexOf('id="pageActions"'), html.indexOf('id="youtubePanel"'));
        for (const group of ['downloadBar', 'partyBar', 'readerBar', 'speedControlBar']) assert(row.includes(`id="${group}"`), `${group} is not in the row`);
        assert(html.indexOf('id="pageActions"') < html.indexOf('id="youtubePanel"'), 'the row is inside the YouTube panel, so no other site has it');
        assert(!/reader-bar-note|Note"/.test(html), 'a button still has a description beside it');
        assert(!/getElementById\('\w*Note'\)/.test(readRepo('popup.js')), 'popup.js still writes a description');
    });
    /** A button in the popup's row, from its tag to its close; '' when it is not there. */
    function rowButton(id) {
        const html = readRepo('popup.html');
        const row = html.slice(html.indexOf('id="pageActions"'), html.indexOf('id="youtubePanel"'));
        const at = row.indexOf(`<button id="${id}"`);
        return at < 0 ? '' : row.slice(at, row.indexOf('</button>', at));
    }
    const wordless = (button) => /aria-label="[^"]+"/.test(button) && button.replace(/<[^>]*>/g, '').trim() === '';
    check('the party is its glyph alone, and Join is a tab behind its button', () => {
        assert(wordless(rowButton('partyBtn')), 'the party button has words, or nothing to name it');
        eq(rowButton('partyJoinBtn'), '', 'Join is still a button of its own');
        assert(readRepo('popup.js').includes("on('partyBtn', 'click', () => this.openParty('start'));"), 'the party button does not open its screen');
        for (const [file, view] of [['src/page/party-start-view.js', 'start'], ['src/page/party-join-view.js', 'join']]) {
            assert(readRepo(file).includes(`\${p.doors('${view}')}`), `${view} has no Start and Join tabs`);
        }
    });
    check('the reader is its glyph alone, and the rate reads beside the speed icon with the two steps after it', () => {
        assert(wordless(rowButton('openReaderBtn')), 'the reader has words, or nothing to name it');
        const html = readRepo('popup.html');
        const at = ['data-icon="speedometer"', 'id="speedDisplay"', 'id="speedDownBtn"', 'id="speedUpBtn"'].map((one) => html.indexOf(one));
        assert(at.every((one, i) => one > 0 && (i === 0 || one > at[i - 1])), `out of order: ${at}`);
    });
    check('the dashboard button is the air traffic control glyph alone, named by its label', () => {
        const html = readRepo('popup.html');
        const at = html.indexOf('<button id="dashboardBtn"');
        const button = html.slice(at, html.indexOf('</button>', at));
        assert(at > 0 && wordless(button), 'the dashboard button has words, or nothing to name it');
        assert(button.includes('data-icon="air-traffic-control"'), 'not the air traffic control glyph');
    });

    section('saving a video — where it goes');

    const FileSaver = require('../src/content/file-saver.js');

    check('the folder setting stays inside Downloads, and keeps nothing the browser would refuse', () => {
        const name = 'Big Buck Bunny (480p).mp4';
        eq(FileSaver.savePath('', name), name);
        eq(FileSaver.savePath('  YouTube ', name), `YouTube/${name}`);
        eq(FileSaver.savePath('Videos\\YouTube\\', name), `Videos/YouTube/${name}`);
        eq(FileSaver.savePath('../../Windows', name), `Windows/${name}`);
        eq(FileSaver.savePath('C:\\Users\\me', name), `C/Users/me/${name}`);
        eq(FileSaver.savePath('/etc/ talks. ', name), `etc/talks/${name}`);
        eq(FileSaver.savePath('a<b>|c?', name), `abc/${name}`);
    });

    /** A saver over a worker that answers `answer`, with what it was sent and what the link saved. */
    function fakeSaver(options, answer) {
        const sent = [];
        const linked = [];
        const urls = { made: 0, types: [], revoked: [], createObjectURL(blob) { this.made += 1; this.types.push(blob.type); return `blob:https://www.youtube.com/${this.made}`; }, revokeObjectURL(url) { this.revoked.push(url); } };
        const saver = FileSaver.createSaver({
            options: () => options, urls,
            send: async (message) => { sent.push(message); return typeof answer === 'function' ? answer(message) : answer; },
            link: (name) => linked.push(name),
        });
        return { saver, sent, linked, urls };
    }

    await checkAsync('with neither setting, a link saves it into Downloads, as before', async () => {
        const { saver, sent, linked } = fakeSaver({ ask: false, folder: '' }, { ok: true });
        eq(await saver.save('a.mp4', new Blob(['x'])), true);
        eq(linked, ['a.mp4']);
        eq(sent, []);
    });
    await checkAsync('with a folder, the worker is handed the path, and the blob is kept until the save ends', async () => {
        const { saver, sent, linked, urls } = fakeSaver({ ask: false, folder: 'YouTube' }, { ok: true, id: 4 });
        const saving = saver.save('a.mp4', new Blob(['x']), 'video/mp4');
        await new Promise((done) => setTimeout(done, 0));
        eq(sent, [{ action: 'saveDownload', url: 'blob:https://www.youtube.com/1', filename: 'YouTube/a.mp4', ask: false }]);
        eq(urls.types, ['video/mp4'], 'an untyped file is saved by Chrome as .txt');
        eq(urls.revoked, [], 'let go before the browser read it');
        saver.ended({ url: 'blob:https://www.youtube.com/1', state: 'complete' });
        eq(await saving, true);
        eq(urls.revoked, ['blob:https://www.youtube.com/1']);
        eq(linked, []);
    });
    await checkAsync('a playlist\'s video goes under the folder asked for, in its own, without Save As even when that is on', async () => {
        const { saver, sent } = fakeSaver({ ask: true, folder: 'YouTube' }, { ok: true, id: 7 });
        saver.save('A Course/1 - a.mp4', new Blob(['x']), 'video/mp4', { ask: false });
        await new Promise((done) => setTimeout(done, 0));
        eq([sent[0].filename, sent[0].ask], ['YouTube/A Course/1 - a.mp4', false]);
        const plain = fakeSaver({ ask: false, folder: '' }, { ok: true, id: 8 });
        plain.saver.save('A Course/1 - a.mp4', new Blob(['x']), 'video/mp4', { ask: false });
        await new Promise((done) => setTimeout(done, 0));
        eq([plain.sent[0].filename, plain.linked], ['A Course/1 - a.mp4', []], 'a link would have saved "A Course_1 - a.mp4"');
    });
    await checkAsync('closing Save As is "not saved", in Chrome\'s way and in Firefox\'s, and nothing falls back to Downloads', async () => {
        const chrome = fakeSaver({ ask: true, folder: '' }, { ok: true, id: 5 });
        const saving = chrome.saver.save('a.mp4', new Blob(['x']));
        await new Promise((done) => setTimeout(done, 0));
        eq(chrome.sent[0].ask, true);
        chrome.saver.ended({ url: chrome.sent[0].url, state: 'interrupted', error: 'USER_CANCELED' });
        eq(await saving, false);
        const firefox = fakeSaver({ ask: true, folder: '' }, { ok: false, error: 'Download canceled by the user' });
        eq(await firefox.saver.save('a.mp4', new Blob(['x'])), false);
        eq([...chrome.linked, ...firefox.linked], []);
        eq(firefox.urls.revoked.length, 1);
    });
    await checkAsync('a failed save is an error, and a worker that cannot take it leaves the link to save it', async () => {
        const failing = fakeSaver({ ask: false, folder: 'YouTube' }, { ok: true, id: 6 });
        const saving = failing.saver.save('a.mp4', new Blob(['x']));
        await new Promise((done) => setTimeout(done, 0));
        failing.saver.ended({ url: failing.sent[0].url, state: 'interrupted', error: 'FILE_NO_SPACE' });
        let message = '';
        try { await saving; } catch (error) { message = error.message; }
        eq(message, 'The browser could not save it (FILE_NO_SPACE)');
        for (const answer of [null, { ok: false, error: 'Invalid filename' }]) {
            const gone = fakeSaver({ ask: false, folder: 'YouTube' }, answer);
            eq(await gone.saver.save('a.mp4', new Blob(['x'])), true);
            eq(gone.linked, ['a.mp4']);
        }
    });

    /** The worker's half over a fake browser whose download is `state` as soon as it is searched for. */
    function fakeDownloads(state) {
        const store = {};
        const told = [];
        const asked = [];
        const api = {
            storage: { session: { get: async (key) => ({ [key]: store[key] }), set: async (values) => Object.assign(store, JSON.parse(JSON.stringify(values))) } },
            tabs: { sendMessage: async (tabId, message) => told.push([tabId, message]) },
            downloads: {
                download: async (options) => { asked.push(options); return 9; },
                search: async ({ id }) => [{ id, state: state(), error: state() === 'interrupted' ? 'USER_CANCELED' : '' }],
            },
        };
        return { worker: require('../src/background/downloads.js').createWorker(api), told, asked, store };
    }

    await checkAsync('the worker starts the download, keeps it by tab, and tells the tab once when it is over', async () => {
        let state = 'in_progress';
        const { worker, told, asked, store } = fakeDownloads(() => state);
        const answer = await worker.save({ url: 'blob:https://www.youtube.com/1', filename: 'YouTube/a.mp4', ask: true }, { tab: { id: 3 } });
        eq(answer, { ok: true, id: 9 });
        eq(asked, [{ url: 'blob:https://www.youtube.com/1', filename: 'YouTube/a.mp4', saveAs: true }]);
        eq(Object.keys(store.bbSaving), ['9']);
        state = 'interrupted';
        worker.changed({ id: 9, state: { current: 'interrupted' } });
        worker.changed({ id: 9, state: { current: 'interrupted' } });
        await new Promise((done) => setTimeout(done, 10));
        eq(told, [[3, { action: 'downloadSaved', url: 'blob:https://www.youtube.com/1', state: 'interrupted', error: 'USER_CANCELED' }]]);
        eq(store.bbSaving, {});
    });
    await checkAsync('a save over before it was kept is still told, and Save As is left to the browser when not asked for', async () => {
        const { worker, told, asked } = fakeDownloads(() => 'complete');
        await worker.save({ url: 'blob:https://vimeo.com/2', filename: 'a.mp4', ask: false }, { tab: { id: 4 } });
        eq('saveAs' in asked[0], false);
        eq(told.map(([tab, message]) => [tab, message.state]), [[4, 'complete']]);
        eq((await worker.save({ url: 'https://example.com/a.mp4', filename: 'a.mp4' }, { tab: { id: 4 } })).ok, false);
    });
    check('the worker may download, and youtube and vimeo both save the way the settings ask', () => {
        eq([globalThis.BB.Settings.DEFAULTS.downloadAskWhere, globalThis.BB.Settings.DEFAULTS.downloadFolder], [false, '']);
        for (const name of ['manifest.json', 'manifest.firefox.json']) assert(JSON.parse(readRepo(name)).permissions.includes('downloads'), name);
        const main = readRepo('src/content/main.js');
        for (const name of ['manifest.json', 'manifest.firefox.json']) {
            for (const entry of contentScripts(name).filter((one) => one.js.includes('src/content/video-download.js'))) {
                assert(entry.js.includes('src/content/file-saver.js'), `${name}: a site that downloads videos has no saver`);
            }
        }
        assert(/youtubeDownload === true,\s*save: saver\.save/.test(main), 'youtube saves without the settings');
        assert(/VimeoDownload\.adapter[^\n]*save: saver\.save/.test(main), 'vimeo saves without the settings');
    });
    check('the two rows sit under the YouTube download switch, shown only while it is on', () => {
        const html = readRepo('dashboard.html');
        const row = html.indexOf('id="youtubeDownload"');
        const follow = html.indexOf('<div class="settings-follow">', row);
        assert(follow > row && follow < html.indexOf('</div>', html.indexOf('for="youtubeDownload"')) + 40, 'the rows are not right after the switch');
        for (const key of ['downloadAskWhere', 'downloadFolder']) assert(html.indexOf(`id="${key}"`) > follow, `${key} is not in the rows`);
        assert(readRepo('dashboard.css').includes('.settings-option:has(> .toggle-switch input:not(:checked)) + .settings-follow { display: none; }'), 'the rows show with the switch off');
    });

    section('saving a vimeo video');

    const VimeoDownload = require('../src/content/vimeo-download.js');

    check('a clip is found in any of vimeo\'s addresses for one, with an unlisted clip\'s hash', () => {
        const at = (url) => VimeoDownload.clipOf(url);
        eq(at('https://vimeo.com/1231817291'), { id: '1231817291', hash: '' });
        eq(at('https://vimeo.com/1231817291/8272103f6e?share=copy'), { id: '1231817291', hash: '8272103f6e' });
        eq(at('https://www.vimeo.com/channels/staffpicks/1231817291').id, '1231817291');
        eq(at('https://vimeo.com/groups/123/videos/456').id, '456');
        eq(at('https://vimeo.com/showcase/11/video/22').id, '22');
        for (const url of ['https://vimeo.com/', 'https://vimeo.com/watch', 'https://vimeo.com/channels/staffpicks', 'https://player.vimeo.com/video/1', 'nonsense']) {
            eq(at(url), null, url);
        }
        const Site = require('../src/content/site.js');
        eq(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com', 'notvimeo.com'].map((host) => Site.detectSite(host)), ['vimeo', 'vimeo', 'other', 'other']);
    });
    check('a config whose request names DRM, or whose playlist is under /drm/, is encrypted; an .mpd is read as its .json', () => {
        const config = (request) => ({ video: { title: 'Beeps' }, request });
        const cdns = (url) => ({ files: { dash: { default_cdn: 'akfire', cdns: { akfire: { url } } } } });
        eq(VimeoDownload.readConfig(config(cdns('https://vod.example/v2/playlist/av/primary/playlist.json?omit=av1'))),
            { title: 'Beeps', drm: false, playlist: 'https://vod.example/v2/playlist/av/primary/playlist.json?omit=av1' });
        eq(VimeoDownload.readConfig(config({ ...cdns('https://vod.example/v2/playlist/drm/cenc,derivedv2,a/playlist.mpd?x=1'), drm: {} })).drm, true);
        eq(VimeoDownload.readConfig(config(cdns('https://vod.example/v2/playlist/drm/cenc/playlist.mpd'))).drm, true);
        eq(VimeoDownload.readConfig(config(cdns('https://vod.example/v2/playlist.mpd?x=1'))).playlist, 'https://vod.example/v2/playlist.json?x=1');
        eq(VimeoDownload.readConfig(null), { title: '', drm: false, playlist: '' });
    });

    /** A playlist in the shape vimeo.com served one, October 2026, cut to two video streams and both sounds. */
    const VIMEO_PLAYLIST_URL = 'https://vod-adaptive-ak.vimeocdn.com/exp=1~hmac=x/62fd/psid=1/v2/playlist/av/primary/prot/cXNyPTE/playlist.json?omit=opus&pathsig=y';
    const vimeoStream = (id, more) => ({ id, base_url: '', mime_type: 'video/mp4', duration: 907.82, init_segment: Buffer.from(`init-${id}`).toString('base64'),
        segments: [{ start: 0, end: 6, url: `cmFuZ2U9MC0x/avf/${id}.mp4?pathsig=a` }, { start: 6, end: 12, url: `cmFuZ2U9Mi0z/avf/${id}.mp4?pathsig=b` }], ...more });
    const vimeoPlaylist = {
        clip_id: '62fddc37', base_url: '../../../../../range/prot/',
        video: [
            vimeoStream('v360', { codecs: 'avc1.64001E', width: 640, height: 360, framerate: 23.976, bitrate: 781000 }),
            vimeoStream('v1080', { codecs: 'avc1.64002A', width: 1920, height: 1080, framerate: 23.976, bitrate: 5765000 }),
        ],
        audio: [
            vimeoStream('opus', { mime_type: 'audio/mp4', codecs: 'opus', bitrate: 102000 }),
            vimeoStream('aac', { mime_type: 'audio/mp4', codecs: 'mp4a.40.2', bitrate: 196000 }),
        ],
    };

    check('the playlist\'s addresses resolve against the playlist, its init segments are bytes, and AAC comes before Opus', () => {
        const read = VimeoDownload.readPlaylist(vimeoPlaylist, VIMEO_PLAYLIST_URL);
        eq(read.video.map((one) => [one.label, one.fps, one.rank]), [['360p', 24, 0], ['1080p', 24, 0]]);
        eq(read.video[1].urls, [
            'https://vod-adaptive-ak.vimeocdn.com/exp=1~hmac=x/62fd/psid=1/v2/range/prot/cmFuZ2U9MC0x/avf/v1080.mp4?pathsig=a',
            'https://vod-adaptive-ak.vimeocdn.com/exp=1~hmac=x/62fd/psid=1/v2/range/prot/cmFuZ2U9Mi0z/avf/v1080.mp4?pathsig=b',
        ]);
        eq(new TextDecoder().decode(read.video[1].head), 'init-v1080');
        eq([read.audio.map((one) => one.codecs), read.audio[0].seconds, read.silent], [['mp4a.40.2', 'opus'], 907.82, false]);
        eq(VimeoDownload.readPlaylist({ ...vimeoPlaylist, audio: [] }, VIMEO_PLAYLIST_URL).silent, true);
    });

    /** vimeo.com as a download sees it, in the order it is asked. */
    function fakeVimeo({ config }) {
        const asked = [];
        const fetchImpl = async (url, init = {}) => {
            asked.push({ url, init });
            const json = (body) => ({ ok: true, status: 200, json: async () => body });
            if (url === '/_next/viewer') return json({ jwt: 'anon.jwt' });
            if (url.startsWith('https://api.vimeo.com/videos/')) return json({ config_url: 'https://player.vimeo.com/video/1231817291/config?h=x&s=signed' });
            if (url.startsWith('https://player.vimeo.com/')) return json(config);
            if (url === VIMEO_PLAYLIST_URL) return json(vimeoPlaylist);
            return { ok: false, status: 404 };
        };
        return { fetchImpl, asked };
    }
    const vimeoConfig = (more = {}) => ({ video: { title: 'Beeps' }, request: { files: { dash: { default_cdn: 'a', cdns: { a: { url: VIMEO_PLAYLIST_URL } } } }, ...more } });
    const vimeoPage = { querySelector: (selector) => (selector === 'meta[name="video-signature-1231817291"]' ? { content: 'anon-sig' } : null) };

    await checkAsync('the plan asks as the page does — its token, the API with the page\'s signature, the signed config — and picks the size playing', async () => {
        const site = fakeVimeo({ config: vimeoConfig() });
        const offer = await VimeoDownload.adapter.offer({ win: { location: { href: 'https://vimeo.com/1231817291' } }, doc: vimeoPage, fetchImpl: site.fetchImpl });
        const plan = VideoDownload.choose(offer, { width: 1920, height: 1080, p: 1080 }, VimeoDownload.adapter.name);
        eq([plan.label, plan.fileName, plan.streams.length], ['1080p', 'Beeps (1080p).mp4', 2]);
        eq(new TextDecoder().decode(plan.streams[1].head), 'init-aac');
        eq(plan.streams[0].seconds, 907.82);
        const api = new URL(site.asked[1].url);
        eq([api.pathname, api.searchParams.get('anon_signature'), api.searchParams.get('fields'), site.asked[1].init.headers.Authorization],
            ['/videos/1231817291', 'anon-sig', 'config_url', 'jwt anon.jwt']);
        eq(site.asked.map((one) => one.init.credentials), ['include', undefined, 'include', 'omit'], 'the playlist goes without cookies, which its CDN does not take');
    });
    await checkAsync('an encrypted clip is refused before a single stream is asked for', async () => {
        const site = fakeVimeo({ config: vimeoConfig({ drm: { asset: 'x' } }) });
        let message = '';
        try {
            await VimeoDownload.adapter.offer({ win: { location: { href: 'https://vimeo.com/1231817291' } }, doc: vimeoPage, fetchImpl: site.fetchImpl });
        } catch (error) { message = error.message; }
        eq(message, VimeoDownload.DRM_REFUSAL);
        assert(!site.asked.some((one) => one.url === VIMEO_PLAYLIST_URL), 'the playlist was fetched');
    });
    check('the popup offers its download on vimeo, with no switch in the way, and the tab builds a downloader there', () => {
        const popup = readRepo('popup.js');
        assert(/this\.site === 'vimeo'\) this\.setupDownloadBar\(\)/.test(popup), 'no download on vimeo');
        assert(/if \(this\.site === 'youtube' && !\(await Settings\.get\(\['youtubeDownload'\]\)\)/.test(popup), 'the switch reaches past youtube');
        assert(/site === 'vimeo'[\s\S]{0,300}BB\.VimeoDownload\.adapter/.test(readRepo('src/content/main.js')), 'no downloader on vimeo');
    });

    // ------------------------------------------------------------ netflix

    section('netflix — how loud a preview plays');

    const NetflixUi = require('../src/content/netflix-ui.js');

    /** A Netflix page at `path`, its videos, and a clock the write window can be moved along. */
    function netflixPage(path = '/browse', percent = 30) {
        const listeners = {};
        const videos = [];
        const settings = { netflixPreviewVolume: percent };
        const clock = { now: 1000 };
        const doc = {
            addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
            querySelectorAll: (selector) => (selector === 'video' ? videos : []),
        };
        const ui = NetflixUi.createNetflixUi({ getSettings: () => settings, doc, pathname: () => path, now: () => clock.now });
        ui.install();
        const video = ({ inPlayer = false, volume = 1, muted = false } = {}) => {
            const one = { tagName: 'VIDEO', volume, muted, closest: (selector) => (inPlayer && selector === '.watch-video' ? {} : null) };
            videos.push(one);
            return one;
        };
        const fire = (type, target) => (listeners[type] || []).forEach((fn) => fn({ type, target }));
        return { ui, video, fire, settings, clock, listeners };
    }

    check('a level is a percent below 100; 100, or nothing readable, is netflix\'s own', () => {
        eq([30, 0, -5, '45'].map(NetflixUi.previewLevel), [0.3, 0, 0, 0.45]);
        eq([100, 150, '', null, undefined, 'loud'].map(NetflixUi.previewLevel), [null, null, null, null, null, null]);
        eq(globalThis.BB.Settings.DEFAULTS.netflixPreviewVolume, 100, 'nothing is written until it is asked for');
    });
    check('a preview is turned down before its first sound, and listened for on the capture path', () => {
        const page = netflixPage('/browse', 30);
        eq(Object.keys(page.listeners).sort(), ['loadedmetadata', 'play', 'volumechange']);
        const card = page.video();
        page.fire('play', card);
        eq(card.volume, 0.3);
    });
    check('an episode is no preview, by its address or by its player', () => {
        const watching = netflixPage('/watch/81234567', 30);
        const episode = watching.video();
        watching.fire('play', episode);
        eq(episode.volume, 1, 'on a watch page');
        const browse = netflixPage('/browse', 30);
        const player = browse.video({ inPlayer: true });
        browse.fire('play', player);
        eq(player.volume, 1, 'inside the episode\'s player');
        assert(!browse.ui.isPreview({ tagName: 'AUDIO', closest: () => null }), 'only a video is a preview');
    });
    check('a preview muted in netflix stays muted, either way netflix spells it', () => {
        const page = netflixPage('/browse', 30);
        const muted = page.video({ muted: true });
        const silent = page.video({ volume: 0 });
        page.fire('play', muted);
        page.fire('volumechange', silent);
        eq([muted.muted, muted.volume, silent.volume], [true, 1, 0]);
        // Unmuted from Netflix's button, at Netflix's full level: down it goes.
        silent.volume = 1;
        page.fire('volumechange', silent);
        eq(silent.volume, 0.3);
    });
    check('netflix putting its level back is answered a few times, then left to it', () => {
        const page = netflixPage('/browse', 50);
        const card = page.video();
        for (let i = 0; i < NetflixUi.MAX_WRITES + 2; i++) {
            card.volume = 1;
            page.fire('volumechange', card);
        }
        eq(card.volume, 1, 'still trading writes with the page');
        page.clock.now += NetflixUi.WRITE_WINDOW_MS;
        page.fire('volumechange', card);
        eq(card.volume, 0.5, 'a new window, a new go');
    });
    check('the setting moved reaches previews already playing, and 100 gives back only what was turned down', () => {
        const page = netflixPage('/browse', 30);
        const card = page.video();
        const other = page.video({ volume: 0.6 });
        page.fire('play', card);
        page.settings.netflixPreviewVolume = 70;
        page.ui.refresh();
        eq([card.volume, other.volume], [0.7, 0.7]);
        const untouched = page.video({ volume: 0.4 });
        page.settings.netflixPreviewVolume = 100;
        page.ui.refresh();
        eq([card.volume, other.volume, untouched.volume], [1, 1, 0.4]);
    });
    check('netflix has an entry of its own, a setting on its panel, and a page that follows it', () => {
        const entry = SiteScripts.ENTRIES.find((one) => one.id === 'netflix');
        eq(entry.sites, { netflix: ['*://*.netflix.com/*'] });
        assert(entry.js.includes('src/content/netflix-ui.js'));
        const panel = readRepo('dashboard.html').split('id="netflixSettingsPanel"')[1].split('</div>\r\n                    <div class="settings-section"')[0];
        assert(/<input type="range" id="netflixPreviewVolume" min="0" max="100"/.test(panel), 'no slider on the Netflix panel');
        const main = readRepo('src/content/main.js');
        assert(/netflix: 'NetflixUi'/.test(main), 'main.js does not know netflix by its module');
        assert(/NETFLIX_SURFACES = \['netflixPreviewVolume'[,\]]/.test(main), 'a change does not reach an open page');
    });

    section('netflix — j, k and l');

    /** An episode's <video> that counts the currentTime writes Netflix answers with M7375. */
    function netflixEpisode(at = 100, duration = 1500) {
        let written = 0;
        const video = {
            paused: false, duration, played: 0,
            get currentTime() { return at; },
            set currentTime(_) { written++; },
            play() { this.played++; this.paused = false; return Promise.resolve(); },
            pause() { this.paused = true; },
        };
        return { video, written: () => written };
    }
    function netflixKeys({ path = '/watch/81234567', answer = { ok: true, seek: true }, seconds = 10 } = {}) {
        const asked = [];
        const told = [];
        const episode = netflixEpisode();
        const ui = NetflixUi.createNetflixUi({
            getSettings: () => ({ netflixSeekSeconds: seconds }),
            getVideoElement: () => episode.video,
            notify: (message, type) => told.push([message, type]),
            ask: (message) => { asked.push(message); return answer; },
            doc: { addEventListener: () => {}, querySelectorAll: () => [] },
            pathname: () => path,
        });
        return { ui, asked, told, episode };
    }

    check('j, k and l are claimed on an episode with the setting on, and nowhere else', () => {
        const Keybindings = require('../src/shared/keybindings.js');
        const Shortcuts = require('../src/content/shortcuts.js');
        const ran = [];
        const claim = (code, { on = true, episode = true } = {}) => Shortcuts.createBindings({
            featureOn: (key) => key === 'netflixSeekKeys' && on,
            onNetflixEpisode: () => episode,
            netflixStep: (direction) => ran.push(direction),
            netflixTogglePlay: () => ran.push('k'),
        }).filter((binding) => binding.match({ code, key: code.slice(3).toLowerCase(), ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }))
            .map((binding) => [binding.name, binding.enabled()]);
        eq(claim('KeyJ'), [['netflix-back', true]]);
        eq(claim('KeyK'), [['netflix-play', true]]);
        eq(claim('KeyL'), [['netflix-forward', true]]);
        eq(claim('KeyL', { on: false }), [['netflix-forward', false]], 'switched off, the key goes back to the page');
        eq(claim('KeyJ', { episode: false }), [['netflix-back', false]], 'on the browse page they are letters');
        eq(Keybindings.SCOPES.netflix, 'Netflix');
        const ids = (settings) => Keybindings.list({}, 'netflix', settings).map((b) => b.id);
        eq(ids({ netflixSeekKeys: false }), [], 'listed while switched off');
        eq(ids({ netflixSeekKeys: true }), ['netflix-back', 'netflix-play', 'netflix-forward']);
        for (const id of ids()) eq(Keybindings.conflicts({}, id, Keybindings.resolve({}, id).combo), [], id);
    });
    check('a skip asks netflix\'s player, from where the episode is, and never writes the video', () => {
        const keys = netflixKeys({ seconds: 10 });
        assert(keys.ui.isWatching());
        assert(keys.ui.step(1));
        assert(keys.ui.step(-1));
        eq(keys.asked, [{ type: 'seek', ms: 110000 }, { type: 'seek', ms: 90000 }]);
        eq(keys.told.map((one) => one[0]), ['+10s', '−10s']);
        eq(keys.episode.written(), 0, 'a currentTime write is M7375 on netflix');
        eq(netflixKeys({ path: '/browse' }).ui.isWatching(), false);
    });
    check('a skip stays inside the episode, by the seconds the setting asks for', () => {
        eq([NetflixUi.seekStep(5), NetflixUi.seekStep(0), NetflixUi.seekStep(99), NetflixUi.seekStep('x'), NetflixUi.seekStep(2.6)], [5, 10, 30, 10, 3]);
        const keys = netflixKeys({ seconds: 30 });
        keys.ui.skip(-500);
        keys.ui.skip(5000);
        eq(keys.asked.map((one) => one.ms), [0, 1500000]);
    });
    check('with no player to answer, nothing is skipped and the user is told', () => {
        const keys = netflixKeys({ answer: null });
        eq(keys.ui.step(1), false);
        eq(keys.episode.written(), 0);
        eq(keys.told, [['Netflix\'s player did not answer, so nothing was skipped', 'error']]);
    });
    check('k plays or pauses through the player, and through the video when it does not answer', () => {
        const keys = netflixKeys();
        keys.ui.togglePlay();
        keys.episode.video.paused = true;
        keys.ui.togglePlay();
        eq(keys.asked, [{ type: 'pause' }, { type: 'play' }]);
        eq(keys.episode.video.played, 0, 'the player did it');
        const alone = netflixKeys({ answer: null });
        alone.ui.togglePlay();
        assert(alone.episode.video.paused, 'not paused');
        alone.ui.togglePlay();
        eq([alone.episode.video.paused, alone.episode.video.played], [false, 1]);
    });
    check('the number-key skips go through netflix\'s player too, and never the video', () => {
        // Alt+digit and Shift+digit went to player.skip on every site, and on
        // Netflix that is a currentTime write: error M7375, episode stopped.
        const main = readRepo('src/content/main.js');
        assert(/skip: \(seconds\) => \(netflixUi \? netflixUi\.isWatching\(\) && netflixUi\.skip\(seconds\) : player\.skip\(seconds\)\)/.test(main),
            'the number keys skip netflix through the <video>');
        const keys = netflixKeys();
        assert(keys.ui.skip(5));
        eq([keys.asked, keys.episode.written()], [[{ type: 'seek', ms: 105000 }], 0]);
    });
    check('netflix\'s player bridge is on every netflix page, and the party asks it on the same channel', () => {
        const page = SiteScripts.PAGE.find((one) => one.id === 'netflix-page');
        eq([page.site, page.matches, page.js], ['netflix', ['*://*.netflix.com/*'], ['src/content/netflix-page.js']]);
        const bridge = readRepo('src/content/netflix-page.js');
        assert(bridge.includes("const REQUEST = 'bb:netflix';") && bridge.includes("const ANSWER = 'bb:netflix:ok';"));
        assert(readRepo('src/content/party-media.js').includes("Bridge.ask('bb:netflix', message, 'bb:netflix:ok')"), 'the party asks elsewhere');
        assert(readRepo('src/content/netflix-ui.js').includes("Bridge.ask('bb:netflix', message, 'bb:netflix:ok')"), 'the keys ask elsewhere');
        const panel = readRepo('dashboard.html').split('id="netflixSettingsPanel"')[1].split('</div>\r\n                    <div class="settings-section"')[0];
        assert(panel.includes('<input type="checkbox" id="netflixSeekKeys">'), 'no switch');
        assert(panel.includes('<input type="number" id="netflixSeekSeconds" min="1" max="30" step="1">'), 'no seconds');
        eq([globalThis.BB.Settings.DEFAULTS.netflixSeekKeys, globalThis.BB.Settings.DEFAULTS.netflixSeekSeconds], [false, 10]);
    });

    section('subtitles — reading a file');

    const Subtitles = require('../src/shared/subtitles.js');
    const plain = (cues) => cues.map((cue) => [cue.start, cue.end, Subtitles.textOf(cue.parts)]);

    /** TTML the way Netflix writes it: ticks, styles by id, one <p> a cue. */
    const NETFLIX_TTML = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<tt xmlns:tt="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000" xml:lang="en">',
        '<head><styling>',
        '<style xml:id="style0" tts:fontStyle="normal" tts:color="white"/>',
        '<style xml:id="style1" tts:color="white" tts:fontStyle="italic"/>',
        '<style xml:id="style2" style="style1"/>',
        '</styling></head>',
        '<body><div>',
        '<p begin="40000000t" end="52000000t" style="style2" xml:id="subtitle1">[door creaks] &amp; then',
        '   silence</p>',
        '<p begin="35618750t" end="38955000t" region="region0" xml:id="subtitle0"><span style="style0">Where have you been,</span><br/><span style="style1">Hopper</span>?</p>',
        '<p begin="00:00:06.000" end="00:00:07.500"><span tts:ruby="container"><span tts:ruby="base">漢字</span><span tts:ruby="text">かんじ</span></span>です</p>',
        '<p begin="60000000t" end="60000000t">a cue with no length</p>',
        '</div></body></tt>',
    ].join('\n');

    check('netflix\'s ttml: ticks, italic by style and by a style it inherits, and lines only at <br/>', () => {
        const cues = Subtitles.parse(NETFLIX_TTML);
        eq(plain(cues), [
            [3.561875, 3.8955, 'Where have you been,\nHopper?'],
            [4, 5.2, '[door creaks] & then silence'],
            [6, 7.5, '漢字です'],
        ], 'in time order, the reading over the kanji dropped, and the empty cue gone');
        eq(cues[0].parts, [{ text: 'Where have you been,\n', italic: false }, { text: 'Hopper', italic: true }, { text: '?', italic: false }]);
        eq(cues[1].parts[0].italic, true, 'style2 is italic through style1');
    });
    check('ttml times: ticks at the file\'s rate, clocks, frames and offsets', () => {
        eq(Subtitles.ttmlTime('25000000t'), 2.5, 'netflix\'s 10MHz by default');
        eq(Subtitles.ttmlTime('2500t', { tickRate: 1000 }), 2.5);
        eq(Subtitles.ttmlTime('01:02:03.25'), 3723.25);
        eq(Subtitles.ttmlTime('00:00:01:15', { frameRate: 30 }), 1.5);
        eq([Subtitles.ttmlTime('2.5s'), Subtitles.ttmlTime('500ms'), Subtitles.ttmlTime('1m')], [2.5, 0.5, 60]);
        assert(Number.isNaN(Subtitles.ttmlTime('soon')) && Number.isNaN(Subtitles.ttmlTime(null)));
        const slow = NETFLIX_TTML.replace('ttp:tickRate="10000000"', 'ttp:tickRate="1000"');
        // Ticks read at a thousand a second are ten hours on, after the
        // clock cue, which does not care about the tick rate.
        eq(plain(Subtitles.parse(slow)).map((cue) => cue[0]), [6, 35618.75, 40000]);
    });
    check('netflix\'s webvtt: settings after the times, classes unwrapped, <i> italic, ruby and entities', () => {
        const vtt = [
            '﻿WEBVTT', '', 'NOTE Netflix', '',
            '1', '00:00:03.561 --> 00:00:05.895 position:50.00%,middle align:middle size:80.00% line:79.33%',
            '&lrm;<c.bg_transparent>Where have you been,</c.bg_transparent>', '<i>Hopper</i>?', '',
            '2', '00:06.000 --> 00:07.500', '<ruby>漢字<rt>かんじ</rt></ruby>です &amp; more', '',
            '3', '00:00:09.000 --> 00:00:08.000', 'ends before it starts', '',
        ].join('\r\n');
        const cues = Subtitles.parse(vtt);
        eq(plain(cues), [[3.561, 5.895, '‎Where have you been,\nHopper?'], [6, 7.5, '漢字です & more']]);
        eq(cues[0].parts.map((part) => part.italic), [false, true, false]);
        eq([Subtitles.vttTime('1:02:03.4'), Subtitles.vttTime('02:03,456')], [3723.4, 123.456]);
    });
    check('a file that is neither format is no cues, and entities are only ever text', () => {
        eq(Subtitles.parse('<html><body>Access denied</body></html>'), []);
        eq(Subtitles.parse(''), []);
        eq(Subtitles.parse(null), []);
        eq(Subtitles.decode('&lt;b&gt; &#65;&#x42; &bogus; &#0;'), '<b> AB &bogus; &#0;');
    });
    check('the cues showing at a moment, overlapping ones too, and when that next changes', () => {
        const cues = [
            { start: 1, end: 3, parts: [{ text: 'a', italic: false }] },
            { start: 2, end: 6, parts: [{ text: 'b', italic: false }] },
            { start: 4, end: 5, parts: [{ text: 'c', italic: false }] },
        ];
        const at = (time) => Subtitles.cuesAt(cues, time).map((cue) => cue.parts[0].text).join('');
        eq([0, 1, 2.5, 3, 4.5, 5.5, 6].map(at), ['', 'a', 'ab', 'b', 'bc', 'b', '']);
        eq([0, 1, 2.5, 3, 4.5, 5.5, 6].map((time) => Subtitles.nextChange(cues, time)), [1, 2, 3, 4, 5, 6, Infinity]);
        eq(Subtitles.cuesAt([], 3), []);
    });

    section('netflix — several subtitles at once');


    /**
     * src/content/netflix-subs-page.js in a context of its own, with a JSON
     * of its own to wrap — never this process's — and a document that keeps
     * what is said on it.
     */
    function netflixSubsPage() {
        const vm = require('vm');
        const told = [];
        const listeners = {};
        const document = {
            addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
            dispatchEvent: (event) => {
                told.push([event.type, JSON.parse(event.detail)]);
                (listeners[event.type] || []).forEach((fn) => fn(event));
            },
        };
        class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } }
        const context = vm.createContext({ document, CustomEvent });
        context.window = context;
        vm.runInContext(readRepo('src/content/netflix-subs-page.js'), context);
        const pageJson = vm.runInContext('JSON', context);
        const ask = (movieId) => {
            document.dispatchEvent(new CustomEvent('bb:netflix:subs', { detail: JSON.stringify({ type: 'tracks', movieId }) }));
            return told.filter(([type]) => type === 'bb:netflix:subs:ok').pop()[1];
        };
        return { context, pageJson, told, ask };
    }
    const nfTrack = (language, files, extra = {}) => ({
        type: 'timedtext', rawTrackType: 'subtitles', language, languageDescription: language.toUpperCase(),
        isNoneTrack: false, isForcedNarrative: false, new_track_id: `T:${language}`, ttDownloadables: files, ...extra,
    });

    check('the page reads a manifest as the player parses it, and hands back the very value it was given', () => {
        const page = netflixSubsPage();
        const manifest = { result: { movieId: 81234567, timedtexttracks: [
            { isNoneTrack: true, language: 'none' },
            nfTrack('en', { 'dfxp-ls-sdh': { urls: [{ url: 'https://ttml.example/en' }] }, 'webvtt-lssdh-ios8': { downloadUrls: { 4: 'https://vtt.example/en' } } }),
            nfTrack('en', { 'imsc1.1': { urls: [{ url: 'https://ttml.example/forced' }] } }, { isForcedNarrative: true, new_track_id: 'T:forced' }),
            nfTrack('ja', { 'nflx-cmisc': { isImage: true, urls: [{ url: 'https://img.example/ja' }] } }),
            nfTrack('es', { 'imsc1.1': { urls: [{ url: 'http://plain.example/es' }] } }, { rawTrackType: 'closedcaptions' }),
        ] } };
        const text = JSON.stringify(manifest);
        const parsed = page.pageJson.parse(text, (key, value) => (key === 'languageDescription' ? `${value}!` : value));
        eq(parsed.result.timedtexttracks[1].languageDescription, 'EN!', 'the reviver went through');
        const [type, said] = page.told[0];
        eq(type, 'bb:netflix:tracks');
        eq(said.movieId, '81234567');
        eq(said.tracks.map((one) => [one.id, one.language, one.kind, one.forced, one.format, one.url]), [
            ['T:en', 'en', 'subtitles', false, 'webvtt-lssdh-ios8', 'https://vtt.example/en'],
            ['T:forced', 'en', 'subtitles', true, 'imsc1.1', 'https://ttml.example/forced'],
            ['T:ja', 'ja', 'subtitles', false, null, null],
            ['T:es', 'es', 'closedcaptions', false, null, null],
        ], 'webvtt first, the none track gone, a picture or a plain-http address no file to fetch');
        eq(page.ask('81234567').tracks.length, 4, 'asked again later, by the isolated world');
        eq(page.ask('999').tracks, null);
    });
    check('whatever the page parses, it gets back unharmed — the reader can never be what throws', () => {
        const page = netflixSubsPage();
        eq(page.pageJson.parse('[1,2]'), [1, 2]);
        eq(page.pageJson.parse('"x"'), 'x');
        eq(page.pageJson.parse('null'), null);
        let threw = null;
        try { page.pageJson.parse('{nope'); } catch (error) { threw = error; }
        assert(threw instanceof require('vm').runInContext('SyntaxError', page.context), 'a bad document still throws the page\'s own SyntaxError');
        const odd = page.pageJson.parse('{"movieId": 1, "timedtexttracks": [null, 7, {"language": 3}]}');
        eq(odd.movieId, 1);
        eq(page.told.map((one) => one[1].tracks), [[]], 'nothing usable, and nothing thrown');
        // A second copy, as a second registration would load, wraps nothing twice.
        const before = page.pageJson.parse;
        require('vm').runInContext(readRepo('src/content/netflix-subs-page.js'), page.context);
        assert(page.pageJson.parse === before, 'wrapped again');
    });
    check('only the newest few titles are kept: hover previews parse manifests too', () => {
        const page = netflixSubsPage();
        for (let id = 1; id <= 12; id++) page.pageJson.parse(JSON.stringify({ movieId: id, timedtexttracks: [] }));
        eq(page.ask('1').tracks, null, 'the oldest went');
        eq(page.ask('12').tracks, []);
        eq(page.ask('5').tracks, []);
    });
    check('the reader is registered for every netflix page, ahead of the player', () => {
        const page = SiteScripts.PAGE.find((one) => one.id === 'netflix-subs-page');
        eq([page.site, page.matches, page.js, page.runAt], ['netflix', ['*://*.netflix.com/*'], ['src/content/netflix-subs-page.js'], 'document_start']);
    });
    const NetflixSubs = require('../src/content/netflix-subs.js');
    const NetflixSubsView = require('../src/content/netflix-subs-view.js');

    check('the languages a setting names: codes in order, at most three, nothing else', () => {
        eq(NetflixSubs.languagesOf('ja en'), ['ja', 'en']);
        eq(NetflixSubs.languagesOf(' es, pt-BR;zh-Hans  '), ['es', 'pt-BR', 'zh-Hans']);
        eq(NetflixSubs.languagesOf('en EN fr de it'), ['en', 'fr', 'de'], 'a repeat in other case is a repeat, and three is the most');
        eq(NetflixSubs.languagesOf('english <b> 1 e'), [], 'not codes');
        eq(NetflixSubs.languagesOf(undefined), []);
    });
    check('a language finds its track: exactly, then by its base, subtitles over captions, never forced', () => {
        const t = (id, language, extra = {}) => ({ id, language, kind: 'subtitles', forced: false, url: `https://x/${id}`, ...extra });
        const tracks = [
            t('cc', 'en', { kind: 'closedcaptions' }), t('en', 'en'), t('forced', 'es', { forced: true }),
            t('br', 'pt-BR'), t('pt', 'pt'), t('img', 'ja', { url: null }), t('hans', 'zh-Hans'),
        ];
        const id = (wanted) => (NetflixSubs.pick(tracks, wanted) || {}).id || null;
        eq([id('en'), id('EN'), id('pt'), id('pt-BR'), id('pt-PT'), id('zh'), id('es'), id('ja'), id('de')],
            ['en', 'en', 'pt', 'br', 'pt', 'hans', null, null, null]);
        eq(id('en'), 'en', 'captions only when there is nothing else');
        eq(NetflixSubs.pick([t('cc', 'en', { kind: 'closedcaptions' })], 'en').id, 'cc');
        eq(NetflixSubs.pick(null, 'en'), null);
    });
    /** The data side with a view that only records what it was handed. */
    function netflixSubsWith({ settings = {}, tracks = null, files = {}, path = '/watch/81' } = {}) {
        const shown = [];
        const layouts = [];
        const told = [];
        const fetched = [];
        let announce = null;
        const state = { path, settings: { netflixSubs: true, netflixSubsLanguages: 'en es', netflixSubsLayout: 'stack', ...settings } };
        const subs = NetflixSubs.createNetflixSubs({
            view: {
                install: () => {},
                show: (next) => shown.push(next.map((one) => [one.track.id, one.cues.length])),
                setLayout: (layout) => layouts.push(layout),
                isShowing: () => shown.length > 0 && shown[shown.length - 1].length > 0,
            },
            getSettings: () => state.settings,
            notify: (message) => told.push(message),
            ask: () => ({ movieId: '81', tracks }),
            listen: (handler) => { announce = handler; },
            fetchText: async (url) => {
                fetched.push(url);
                if (!(url in files)) throw new Error('404');
                return files[url];
            },
            pathname: () => state.path,
        });
        return { subs, shown, layouts, told, fetched, state, announce: (message) => announce(message) };
    }
    const NF_VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello\n';
    const nfTracks = [
        { id: 'en', language: 'en', kind: 'subtitles', forced: false, url: 'https://x/en' },
        { id: 'es', language: 'es', kind: 'subtitles', forced: false, url: 'https://x/es' },
    ];

    checkAsync('the languages asked for become tracks and cues, handed to the view in their order', async () => {
        const nf = netflixSubsWith({ tracks: nfTracks, settings: { netflixSubsLanguages: 'es en' }, files: { 'https://x/en': NF_VTT, 'https://x/es': NF_VTT } });
        await nf.subs.sync();
        eq(nf.shown, [[['es', 1], ['en', 1]]]);
        eq(nf.layouts, ['stack']);
        await nf.subs.sync();
        eq(nf.shown.length, 1, 'nothing changed, nothing redrawn');
        eq(nf.fetched.length, 2, 'each file once');
    });
    checkAsync('switched off, or off an episode, the view is emptied; a file that failed is asked for again', async () => {
        const nf = netflixSubsWith({ tracks: nfTracks, files: { 'https://x/en': NF_VTT } });
        await nf.subs.sync();
        eq(nf.shown, [[['en', 1]]], 'es failed to load, and is left out');
        nf.state.path = '/browse';
        await nf.subs.sync();
        eq(nf.shown[1], []);
        nf.state.path = '/watch/81';
        await nf.subs.sync();
        eq(nf.fetched.filter((url) => url === 'https://x/es').length, 2, 'not asked for again');
        nf.state.settings.netflixSubs = false;
        await nf.subs.sync();
        eq(nf.shown[nf.shown.length - 1], []);
    });
    checkAsync('an episode left while its files come is not drawn over what follows', async () => {
        let release;
        const slow = new Promise((resolve) => { release = resolve; });
        const shown = [];
        const state = { path: '/watch/81' };
        const subs = NetflixSubs.createNetflixSubs({
            view: { install() {}, show: (next) => shown.push(next.map((one) => one.track.id)), setLayout() {}, isShowing: () => false },
            getSettings: () => ({ netflixSubs: true, netflixSubsLanguages: 'en' }),
            ask: () => ({ movieId: '81', tracks: nfTracks }),
            listen: () => {},
            fetchText: () => slow.then(() => NF_VTT),
            pathname: () => state.path,
        });
        const pending = subs.sync();
        state.path = '/browse';
        await subs.sync();
        release();
        await pending;
        eq(shown, [[]], 'the episode left behind was drawn after all');
    });
    checkAsync('tracks announced after the first ask are taken up, for this episode only', async () => {
        const nf = netflixSubsWith({ tracks: null, files: { 'https://x/en': NF_VTT, 'https://x/es': NF_VTT } });
        nf.subs.install();
        await new Promise((resolve) => setTimeout(resolve, 0));
        eq(nf.shown, [], 'nothing to draw yet');
        nf.announce({ movieId: '99', tracks: nfTracks });
        await new Promise((resolve) => setTimeout(resolve, 0));
        eq(nf.shown, [], 'another title\'s tracks drew this one');
        nf.announce({ movieId: '81', tracks: nfTracks });
        await new Promise((resolve) => setTimeout(resolve, 0));
        eq(nf.shown, [[['en', 1], ['es', 1]]]);
    });
    check('netflix draws them with styles of its own, from a panel that sets them, and an open episode follows it', () => {
        const entry = SiteScripts.ENTRIES.find((one) => one.id === 'netflix');
        eq(entry.css, ['content-netflix.css']);
        const at = (file) => entry.js.indexOf(`src/${file}`);
        assert(at('shared/subtitles.js') >= 0 && at('shared/subtitles.js') < at('content/netflix-subs-view.js'), 'the view loads before what it reads cues with');
        assert(at('content/netflix-subs-view.js') < at('content/netflix-subs.js'));
        const panel = readRepo('dashboard.html').split('id="netflixSettingsPanel"')[1].split('</div>\r\n                    <div class="settings-section"')[0];
        assert(panel.includes('<input type="checkbox" id="netflixSubs">'), 'no switch');
        assert(panel.includes('id="netflixSubsLanguages"'), 'no languages');
        eq([...panel.split('id="netflixSubsLayout"')[1].matchAll(/<option value="(\w+)"/g)].map((m) => m[1]), NetflixSubsView.LAYOUTS);
        const defaults = globalThis.BB.Settings.DEFAULTS;
        eq([defaults.netflixSubs, defaults.netflixSubsLanguages, defaults.netflixSubsLayout], [false, '', 'stack']);
        assert(/NETFLIX_SURFACES = \[[^\]]*'netflixSubs', 'netflixSubsLanguages', 'netflixSubsLayout'\]/.test(readRepo('src/content/main.js')), 'a change does not reach an open episode');
    });

    // ------------------------------------------------------ bulk export

    section('bulk chat export');

    const ChatLibrary = require('../src/content/chat-library.js');

    check('chats are fetched about a second apart, and a 429 doubles the wait', () => {
        eq([ChatLibrary.pace(() => 0), ChatLibrary.pace(() => 1)], [900, 1600]);
        eq([1, 2, 3].map(ChatLibrary.backoff), [5000, 10000, 20000]);
        eq(ChatLibrary.STRIKES, 3);
    });
    check('the archive has an index, and two chats with one name do not overwrite each other', () => {
        const one = chatFixture();
        const two = { ...chatFixture(), id: 'c2' };
        const files = ChatLibrary.archive([one, two], { site: 'chatgpt', format: 'both', now: new Date(2025, 10, 13).getTime() });
        eq(files.map((f) => f.name), ['index.md', '1970-01-01 Flaky test.md', '1970-01-01 Flaky test.json',
            '1970-01-01 Flaky test (2).md', '1970-01-01 Flaky test (2).json']);
        assert(files[0].data.startsWith('# ChatGPT export — 2025-11-13\n\n2 chats.'), files[0].data);
        assert(files[0].data.includes('[md](1970-01-01%20Flaky%20test%20(2).md)'), 'the index does not link the renamed file');
        eq(ChatLibrary.zipName('chatgpt', new Date(2025, 10, 13).getTime()), 'chatgpt-export-2025-11-13.zip');
    });
    check('a markdown-only archive has no json in it', () => {
        const files = ChatLibrary.archive([chatFixture()], { site: 'chatgpt', format: 'md' });
        eq(files.filter((f) => f.name.endsWith('.json')), []);
    });

    // ------------------------------------------------- prompt templates

    section('prompt templates');

    const PromptTemplates = require('../src/shared/prompt-templates.js');

    await checkAsync('the starters are seeded when the key is absent, and not when it is empty', async () => {
        clearStore();
        const first = await PromptTemplates.load();
        eq(first.length, 10);
        eq(first[0].name, 'Code review');
        eq(store.bbPromptTemplates.length, 10, 'the seed was not written, so it would seed again');
        clearStore();
        store.bbPromptTemplates = [];
        eq(await PromptTemplates.load(), [], 'someone who deleted all ten got them back');
    });
    await checkAsync('restoring the starters puts back only what is missing', async () => {
        clearStore();
        const all = await PromptTemplates.load();
        await PromptTemplates.remove(all[2].id);
        await PromptTemplates.create({ name: 'Mine', body: 'Explain {{thing}}' });
        const back = await PromptTemplates.restoreStarters();
        eq(back.length, 11);
        eq(back.filter((t) => t.id === all[2].id).length, 1);
        eq(back[9].name, 'Mine', 'restoring reordered what was there');
    });
    await checkAsync('a template the store could not write is not given an id, and an edit says it failed', async () => {
        clearStore();
        const [mine] = await PromptTemplates.load();
        const [set, error] = [global.chrome.storage.local.set, console.error];
        global.chrome.storage.local.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
        console.error = () => {};
        try {
            eq(await PromptTemplates.create({ name: 'Lost', body: 'never written' }), null);
            eq(await PromptTemplates.edit(mine.id, { name: 'Renamed' }), false);
            eq(await PromptTemplates.remove(mine.id), false);
        } finally {
            Object.assign(global.chrome.storage.local, { set });
            console.error = error;
        }
        eq((await PromptTemplates.load()).length, 10);
        eq(await PromptTemplates.edit(mine.id, { name: 'Renamed' }), true, 'the same edit again');
    });
    check('fields are asked for once each, in order, and the selection is never asked', () => {
        eq(PromptTemplates.fields('Compare {{options}} for {{ goal }} — {{options}} again, on {{selection}}'), ['options', 'goal']);
        eq(PromptTemplates.fill('Why {{code}}? See {{selection}}. {{missing}}.', { code: 'x()', selection: 'this part' }),
            'Why x()? See this part. .');
        assert(PromptTemplates.STARTERS.every((t) => /\S/.test(t.body) && t.body.length < PromptTemplates.BODY_CAP));
    });
    check('a site sees its own templates and the unfiled ones, last used first', () => {
        const state = [
            { id: 'a', name: 'Anywhere', body: 'x', usedAt: 1 },
            { id: 'b', name: 'Also ChatGPT', body: 'x', sites: ['chatgpt'] },
            { id: 'c', name: 'ChatGPT only', body: 'a review of it', sites: ['chatgpt'], usedAt: 5 },
            { id: 'd', name: 'Nowhere real', body: 'x', sites: ['myspace'] },
        ];
        eq(PromptTemplates.forSite(state, 'chatgpt').map((t) => t.id), ['c', 'a', 'b', 'd'],
            'a site that no longer exists is dropped, which leaves the template for every site');
        eq(PromptTemplates.search(state, 'chatgpt', 'REVIEW').map((t) => t.id), ['c']);
    });

    // ------------------------------------------------------ prompt queue

    section('the prompt queue');

    const PromptQueue = require('../src/shared/prompt-queue.js');

    /** A queue built by the module's own functions, with the ids made readable. */
    function queueOf(...specs) {
        let state = PromptQueue.blank();
        for (const [id, spec] of specs) {
            const made = PromptQueue.add(state, { site: 'chatgpt', conv: 'c1', text: id, now: 1, ...spec });
            state = { ...made.state, items: made.state.items.map((item) => (item.id === made.item.id ? { ...item, id } : item)) };
        }
        return state;
    }

    check('a chat sends its first waiting prompt, and one scheduled later holds back the rest', () => {
        const state = queueOf(['p1', {}], ['p2', { notBefore: 5000 }], ['p3', {}], ['other', { conv: 'c2' }]);
        eq(PromptQueue.next(state, 'chatgpt', 'c1', 100).id, 'p1');
        const after = PromptQueue.patch(state, 'p1', { status: 'sent', sentAt: 100 });
        eq(PromptQueue.next(after, 'chatgpt', 'c1', 100), null, 'p3 jumped the scheduled p2');
        eq(PromptQueue.next(after, 'chatgpt', 'c1', 5000).id, 'p2');
        eq(PromptQueue.next(after, 'chatgpt', 'c2', 100).id, 'other', 'two chats wait on each other');
    });
    check('a hold stops a whole site and a pause stops one chat', () => {
        const state = queueOf(['p1', {}], ['q1', { conv: 'c2' }]);
        const held = PromptQueue.hold(state, 'chatgpt', 1000, 'GPT-5 limit');
        eq(PromptQueue.next(held, 'chatgpt', 'c1', 999), null);
        eq(PromptQueue.next(held, 'chatgpt', 'c1', 1000).id, 'p1', 'the hold did not end at its time');
        const paused = PromptQueue.pause(state, 'chatgpt:c1');
        eq(PromptQueue.next(paused, 'chatgpt', 'c1', 1), null);
        eq(PromptQueue.next(paused, 'chatgpt', 'c2', 1).id, 'q1');
        eq(PromptQueue.next(PromptQueue.pause(paused, 'chatgpt:c1', false), 'chatgpt', 'c1', 1).id, 'p1');
    });
    check('the worker wakes at the earliest schedule or hold end, and not for nothing', () => {
        const state = queueOf(['p1', { notBefore: 9000 }], ['p2', { notBefore: 4000 }]);
        eq(PromptQueue.nextWake(state, 1000), 4000);
        eq(PromptQueue.nextWake(PromptQueue.hold(state, 'chatgpt', 2500), 1000), 2500);
        eq(PromptQueue.nextWake(PromptQueue.hold(PromptQueue.blank(), 'chatgpt', 2500), 1000), null, 'a hold with nothing behind it');
        eq(PromptQueue.due(state, 5000).map((item) => item.id), ['p2']);
    });
    check('two pages cannot both hold one chat’s queue until the lease runs out', () => {
        const state = PromptQueue.claim(PromptQueue.blank(), 'chatgpt:c1', 'page-a', 0);
        assert(PromptQueue.canClaim(state, 'chatgpt:c1', 'page-a', 10));
        assert(!PromptQueue.canClaim(state, 'chatgpt:c1', 'page-b', 10));
        assert(PromptQueue.canClaim(state, 'chatgpt:c1', 'page-b', PromptQueue.LEASE_MS));
        assert(PromptQueue.canClaim(state, 'chatgpt:c2', 'page-b', 10), 'another chat waited on this one');
        eq(PromptQueue.release(state, 'chatgpt:c1', 'page-b').leases['chatgpt:c1'].by, 'page-a', 'a page let go of a lease it did not hold');
        eq(PromptQueue.release(state, 'chatgpt:c1', 'page-a').leases, {});
    });
    check('a new chat’s chain follows the first prompt to the chat it made', () => {
        const state = queueOf(['n1', { conv: null, chain: 'pc_x' }], ['n2', { conv: null, chain: 'pc_x' }], ['m1', { conv: null, chain: 'pc_y' }]);
        eq(PromptQueue.next(state, 'chatgpt', null, 1).id, 'n1');
        const bound = PromptQueue.bind(state, 'pc_x', 'c9');
        eq(PromptQueue.itemsFor(bound, 'chatgpt', 'c9').map((item) => item.id), ['n1', 'n2']);
        eq(PromptQueue.itemsFor(bound, 'chatgpt', null).map((item) => item.id), ['m1']);
        eq(PromptQueue.chatKey('chatgpt', null, 'pc_y'), 'chatgpt:new:pc_y');
    });
    check('a schedule that passed while the browser was shut is held for a yes', () => {
        const state = queueOf(['late', { notBefore: 1000 }], ['fresh', { notBefore: 1000 + PromptQueue.STALE_MS }], ['now', {}]);
        const out = PromptQueue.holdStale(state, 1001 + PromptQueue.STALE_MS);
        eq(out.items.map((item) => item.status), ['held', 'waiting', 'waiting']);
        assert(/browser was shut/.test(out.items[0].note));
    });
    check('what has finished is kept a day and then let go', () => {
        const state = PromptQueue.patch(queueOf(['p1', {}]), 'p1', { status: 'sent', sentAt: 1000 });
        eq(PromptQueue.clean(state, 1000 + 1000).items.length, 1);
        eq(PromptQueue.clean(state, 1000 + PromptQueue.KEEP_DONE_MS).items.length, 0);
    });

    // -------------------------------------------------------- queue strip

    section('the queue strip');

    const ChatQueueView = require('../src/content/chat-queue-view.js');

    check('the strip lists what is still to go, and says when each goes', () => {
        const now = new Date(2025, 10, 13, 18).getTime();
        let state = queueOf(['p1', {}], ['p2', { notBefore: new Date(2025, 10, 13, 19, 42).getTime() }], ['p3', {}]);
        state = PromptQueue.patch(state, 'p3', { status: 'sent', sentAt: now });
        const html = ChatQueueView.listHtml(state.items, { now });
        assert(html.includes('2 queued'), 'a sent prompt is counted as queued');
        assert(html.includes('>next<') && /at 7:42/.test(html), html);
        eq(ChatQueueView.listHtml([], { now }), '', 'an empty strip should not be drawn at all');
        assert(ChatQueueView.listHtml(state.items, { paused: true, now }).includes('data-bb-q="resume"'));
    });
    check('what a row’s buttons ask for is done to the queue', () => {
        let state = queueOf(['p1', {}], ['p2', {}], ['p3', {}]);
        const write = (mutate) => { state = mutate(state); };
        const press = (verb, id, editing = null) => ChatQueueView.onClick(
            { target: { closest: () => ({ dataset: { bbQ: verb, bbQId: id }, closest: () => null }) } },
            { items: state.items, key: 'chatgpt:c1', write, editing });
        press('up', 'p3');
        eq(state.items.map((i) => i.id), ['p1', 'p3', 'p2']);
        press('down', 'p1');
        eq(state.items.map((i) => i.id), ['p3', 'p1', 'p2']);
        press('remove', 'p1');
        eq(state.items.map((i) => i.id), ['p3', 'p2']);
        eq(press('edit', 'p2'), 'p2', 'edit did not open the row');
        press('pause');
        eq(state.paused, { 'chatgpt:c1': true });
        state = PromptQueue.patch(state, 'p2', { status: 'failed', note: 'no box' });
        press('retry', 'p2');
        eq([state.items[1].status, state.items[1].note, state.paused], ['waiting', '', {}], 'a retry should unpause too');
    });
    check('a queued prompt can be sent now, in an hour, or at a time picked', () => {
        const T = new Date(2025, 10, 13, 18).getTime();
        let state = queueOf(['p1', {}]);
        const write = (mutate) => { state = mutate(state); };
        const press = (verb, extra = {}) => ChatQueueView.onClick({ target: { closest: () => ({
            dataset: { bbQ: verb, bbQId: 'p1', ...extra },
            closest: () => ({ querySelector: () => ({ value: '2025-11-13T21:30' }) }),
        }) } }, { items: state.items, key: 'chatgpt:c1', write, editing: null, now: () => T });
        eq(press('when'), 'when:p1', 'the time editor did not open');
        eq(press('hour'), null);
        eq(state.items[0].notBefore, T + 3600000);
        press('at');
        eq(state.items[0].notBefore, new Date(2025, 10, 13, 21, 30).getTime(), 'a picked time is local time');
        press('reset', { bbQAt: String(T + 5000) });
        eq(state.items[0].notBefore, T + 5000 + 60000, 'a reset is rounded; a minute after it is the first safe send');
        press('now');
        eq(state.items[0].notBefore, 0);
        const form = ChatQueueView.listHtml(state.items, { editing: 'when:p1', now: T, resetAt: T + 5000 });
        assert(form.includes('type="datetime-local"') && form.includes('When the limit resets'), form);
    });
    check('a prompt someone wrote is escaped in the strip', () => {
        const html = ChatQueueView.listHtml(queueOf(['<b>x</b>', { text: '<img src=x onerror=alert(1)>' }]).items);
        assert(!html.includes('<img'), 'markup from a prompt reached the page');
    });

    check('chatgpt is in the launcher, its mark in the page’s ink', () => {
        const SiteIcons = require('../src/shared/site-icons.js');
        eq(SiteIcons.get('chatgpt').name, 'ChatGPT');
        eq(SiteIcons.get('chatgpt').color, 'currentColor');
        assert(SiteIcons.list().some((site) => site.id === 'chatgpt'), 'not in ORDER');
    });
    check('the chatgpt workspace has a panel behind every tab', () => {
        const html = readRepo('dashboard.html');
        const dashboard = readRepo('dashboard.js');
        const tabs = /chatgpt: \[([\s\S]*?)\],/.exec(dashboard)[1];
        for (const [, id] of tabs.matchAll(/panel: '([^']+)'/g)) {
            assert(html.includes(`id="${id}"`), `${id} is opened by a tab but is not in the page`);
        }
        // Its views load when the site is first opened, and not with the page.
        assert(/chatgpt: \['ChatViews'\]/.test(dashboard), 'opening the site does not load its views');
        assert(!html.includes('"src/page/chat-views.js"'), 'the views load with the page as well');
    });
    check('the chatgpt settings panel binds a control to every setting the site has', () => {
        require('../src/page/chat-settings.js');
        const html = globalThis.BB.ChatSettings.panelHtml(ChatSites.get('chatgpt'));
        for (const key of ChatSites.allKeys().filter((one) => one.startsWith('chatgpt'))) {
            assert(html.includes(`id="${key}"`), `${key} has no control`);
        }
        assert(/id="chatgptQueueGapSeconds"[^>]*min="1"/.test(html), 'the gap can be set below a second');
        const page = readRepo('dashboard.html');
        assert(page.includes('data-chat-settings="chatgpt"'), 'no panel for the settings card to open');
        const dashboard = readRepo('dashboard.js');
        assert(dashboard.indexOf('ChatSettings.mountAll') < dashboard.indexOf('SettingsForm.bindAll'), 'the controls are drawn after the form is bound');
    });
    check('claude has its card, a panel behind every tab, and its settings', () => {
        const SiteIcons = require('../src/shared/site-icons.js');
        eq([SiteIcons.get('claude').name, SiteIcons.get('claude').color], ['Claude', '#D97757']);
        assert(SiteIcons.list().some((site) => site.id === 'claude'), 'not in ORDER');
        const html = readRepo('dashboard.html');
        const tabs = /claude: \[([\s\S]*?)\],/.exec(readRepo('dashboard.js'))[1];
        eq([...tabs.matchAll(/panel: '([^']+)'/g)].map((m) => m[1]), ['claudePinsPanel', 'claudePromptsPanel', 'claudeQueuePanel']);
        for (const id of ['claudePinsPanel', 'claudePromptsPanel', 'claudeQueuePanel']) assert(html.includes(`id="${id}"`), `${id} is not in the page`);
        assert(html.includes('data-chat-settings="claude"'), 'no settings panel for the card to open');
        const panel = globalThis.BB.ChatSettings.panelHtml(ChatSites.get('claude'));
        for (const key of ChatSites.allKeys().filter((one) => one.startsWith('claude'))) assert(panel.includes(`id="${key}"`), `${key} has no control`);
    });
    check('a pin opens its chat with the turn named in the address', () => {
        require('../src/page/chat-views.js');
        eq(globalThis.BB.ChatViews.pinUrl({ site: 'chatgpt', conv: 'abc12345', node: 'n/1', url: '' }),
            'https://chatgpt.com/c/abc12345#bb-node=n%2F1');
    });
    check('a chat setting that changes the page reaches the page that is open', () => {
        const main = readRepo('src/content/main.js');
        assert(/const CHAT_SURFACES = chatUi \? \[[\s\S]*?'composerTools', 'limitSuggest'[\s\S]*?\] : \[\];/.test(main), 'the chat surfaces are not listed');
        assert(/chatSurfacesChanged && chatUi\) chatUi\.refreshSurfaces\(\)/.test(main), 'nothing repaints them');
    });
    check('the worker loads the same scripts in Chrome and Firefox, the queue among them', () => {
        const chrome = [...readRepo('background.js').matchAll(/'(src\/[^']+)'/g)].map((m) => m[1]);
        const firefox = JSON.parse(readRepo('manifest.firefox.json')).background.scripts;
        eq(firefox, chrome);
        assert(chrome.indexOf('src/shared/prompt-queue.js') < chrome.indexOf('src/background/prompt-queue.js'),
            'the worker would get undefined for PromptQueue at load');
        assert(chrome.indexOf('src/shared/chat-sites.js') < chrome.indexOf('src/background/prompt-queue.js'));
    });

    // --------------------------------------------------- when limits reset

    section('reading when a chat limit resets');

    /** 18:00 today, built with setHours so the check runs in any time zone. */
    const clock = (hours, minutes = 0, days = 0) => {
        const d = new Date(2025, 10, 13);
        d.setDate(d.getDate() + days);
        d.setHours(hours, minutes, 0, 0);
        return d.getTime();
    };
    const T18 = clock(18);

    check('a clock time later today is today, and one already past is tomorrow', () => {
        eq(PromptQueue.parseReset('after 7:42 PM', T18), clock(19, 42));
        eq(PromptQueue.parseReset('after 7:42 PM', clock(20)), clock(19, 42, 1));
        eq(PromptQueue.parseReset('until 3 PM', T18), clock(15, 0, 1));
        eq(PromptQueue.parseReset('at 23:05', T18), clock(23, 5));
        eq(PromptQueue.parseReset('resets at 12 a.m.', T18), clock(0, 0, 1));
    });
    check('relative times, tomorrow and a weekday are read too', () => {
        eq(PromptQueue.parseReset('in 2 hours 13 minutes', T18), T18 + (2 * 60 + 13) * 60000);
        eq(PromptQueue.parseReset('try again in 45 minutes', T18), T18 + 45 * 60000);
        eq(PromptQueue.parseReset('tomorrow at 9 AM', T18), clock(9, 0, 1));
        // 13 November 2025 is a Thursday.
        eq(PromptQueue.parseReset('Monday at 9 AM', T18), clock(9, 0, 4));
        eq(PromptQueue.parseReset('Thursday at 5 PM', T18), clock(17, 0, 7), 'this Thursday has gone');
    });
    check('what is not a time is null, never a guess', () => {
        eq(PromptQueue.parseReset('soon', T18), null);
        eq(PromptQueue.parseReset('', T18), null);
        eq(PromptQueue.parseReset('at 25:00', T18), null);
        eq(PromptQueue.parseReset('your weekly limit resets Monday', T18), null, 'a day with no time on it');
    });
    check('a chatgpt limit notice gives up its model, its time and whether it blocks', () => {
        const fallback = ChatSites.readLimit('chatgpt',
            'You\'ve hit the Free plan limit for GPT-4.5. Responses will use another model until your limit resets after 7:42 PM.', T18);
        eq(fallback, { model: 'GPT-4.5', until: clock(19, 42), blocked: false, window: '' });
        const blocked = ChatSites.readLimit('chatgpt', 'You\'ve reached our limit of messages per hour. Please try again in 30 minutes.', T18);
        eq(blocked, { model: '', until: T18 + 30 * 60000, blocked: true, window: '' });
        eq(ChatSites.readLimit('chatgpt', 'Nothing to see', T18), null);
        eq(ChatSites.readLimit('nowhere', 'limit', T18), null);
    });

    // ------------------------------------------------------ chat pins

    section('chat pins');

    const ChatPins = require('../src/shared/chat-pins.js');

    await checkAsync('a pin is kept by turn id, once, with its chat beside it', async () => {
        clearStore();
        const where = { site: 'chatgpt', conv: 'c1', title: 'Flaky test', url: 'https://chatgpt.com/c/c1' };
        await ChatPins.pin({ ...where, node: 'a1', excerpt: '## Cause\nA **race** on the session.', now: 10 });
        await ChatPins.pin({ ...where, node: 'a1', excerpt: 'again', now: 20 });
        await ChatPins.pin({ ...where, node: 'a3', excerpt: 'Await it.', now: 30 });
        const state = await ChatPins.load();
        eq(ChatPins.forConv(state, 'chatgpt', 'c1').map((p) => p.node), ['a1', 'a3']);
        eq(ChatPins.forConv(state, 'chatgpt', 'c1')[0].excerpt, 'Cause A race on the session.');
        eq(state['chatgpt:c1'].title, 'Flaky test');
        assert(ChatPins.isPinned(state, 'chatgpt', 'c1', 'a3') && !ChatPins.isPinned(state, 'chatgpt', 'c2', 'a3'));
    });
    await checkAsync('a label is the pin’s own, and the last unpin forgets the chat', async () => {
        clearStore();
        const where = { site: 'chatgpt', conv: 'c1' };
        await ChatPins.pin({ ...where, node: 'a1', now: 1 });
        await ChatPins.relabel({ ...where, node: 'a1', label: '  the fix  ' });
        eq(ChatPins.forConv(await ChatPins.load(), 'chatgpt', 'c1')[0].label, 'the fix');
        await ChatPins.unpin({ ...where, node: 'a1' });
        eq(await ChatPins.load(), {});
    });
    await checkAsync('the dashboard gets every pin on a site, newest first', async () => {
        clearStore();
        await ChatPins.pin({ site: 'chatgpt', conv: 'c1', node: 'a1', now: 1 });
        await ChatPins.pin({ site: 'chatgpt', conv: 'c2', node: 'b1', now: 5 });
        await ChatPins.pin({ site: 'claude', conv: 'k1', node: 'z1', now: 9 });
        const all = ChatPins.all(await ChatPins.load(), 'chatgpt');
        eq(all.map((p) => `${p.conv}/${p.node}`), ['c2/b1', 'c1/a1']);
    });
    check('an excerpt drops fenced code rather than showing its fence', () => {
        eq(ChatPins.excerptOf('```python\nprint(1)\n```\nThen [run it](https://x.y).'), 'Then run it.');
        assert(ChatPins.excerptOf('word '.repeat(60)).length <= ChatPins.EXCERPT);
    });

    // ------------------------------------------------------ the composer

    section('the composer');

    check('a prompt is only ever typed and sent by the page, never posted by us', () => {
        // The sites' send endpoints want tokens only their own page mints.
        // Anything else is a request they are built to refuse, and one that
        // looks exactly like the automation they are watching for.
        const source = readRepo('src/content/composer.js');
        assert(!/\bfetch\(|XMLHttpRequest|sendBeacon/.test(source), 'the composer makes a request');
        assert(!/new KeyboardEvent/.test(source), 'the composer sends a synthetic Enter');
    });

    // ------------------------------------------------ reading claude's tree

    section('reading a claude conversation');

    const ClaudeFormat = require('../src/shared/claude-format.js');

    /**
     * chat_conversations/<uuid>?tree=True as it answers: the sentinel parent,
     * a prompt edited once (h2, h2b), an answer retried (a2, a2r), thinking, a
     * web search with a cited answer, pasted text on a prompt, and one old
     * message with text and no content.
     */
    function claudeRaw({ leaf = 'a2r' } = {}) {
        const m = (uuid, parent, sender, at, content, extra = {}) => ({
            uuid, parent_message_uuid: parent, sender, index: 0, created_at: `2025-11-13T10:00:${String(at).padStart(2, '0')}Z`,
            content, text: '', attachments: [], files: [], ...extra,
        });
        const text = (t, citations) => ({ type: 'text', text: t, citations });
        return {
            uuid: 'conv-uuid', name: 'Why the build fails', model: 'claude-sonnet-4',
            created_at: '2025-11-13T10:00:00Z', updated_at: '2025-11-13T10:05:00Z',
            current_leaf_message_uuid: leaf,
            chat_messages: [
                m('h1', ClaudeFormat.SENTINEL, 'human', 1, [], { text: 'Old style prompt' }),
                m('a1', 'h1', 'assistant', 2, [{ type: 'thinking', thinking: 'Let me look.' }, text('It is the linker.')]),
                m('h2', 'a1', 'human', 3, [text('Here is the log')], { attachments: [{ file_name: 'paste.txt', extracted_content: 'ld: undefined symbol' }] }),
                m('a2', 'h2', 'assistant', 4, [
                    { type: 'tool_use', name: 'web_search', input: { query: 'ld undefined symbol' } },
                    { type: 'tool_result', name: 'web_search', content: [] },
                    text('Link the math library.', [{ url: 'https://example.com/ld', title: 'ld manual', start_index: 0, end_index: 22 }]),
                ]),
                m('a2r', 'h2', 'assistant', 5, [text('Add -lm to the link line.')]),
                m('h2b', 'a1', 'human', 6, [text('An edited question')], { files: [{ file_name: 'screenshot.png' }] }),
            ],
        };
    }

    check('the sentinel parent is the root and the current leaf is the path shown', () => {
        const conv = ClaudeFormat.normalize(claudeRaw());
        eq(conv.root, ClaudeFormat.SENTINEL);
        eq(ChatTree.activePath(conv), ['h1', 'a1', 'h2', 'a2r']);
        eq(conv.site, 'claude');
        eq(conv.url, 'https://claude.ai/chat/conv-uuid');
    });
    check('an edit and a retry are siblings, numbered by when each was written', () => {
        const conv = ClaudeFormat.normalize(claudeRaw());
        eq(ChatTree.siblingIndex(conv, 'a2r'), { index: 2, count: 2 });
        eq(ChatTree.siblingIndex(conv, 'h2b'), { index: 2, count: 2 });
        eq(ChatTree.forks(conv).sort(), ['a1', 'h2']);
    });
    check('with no current leaf yet, the newest message is the leaf', () => {
        const raw = claudeRaw();
        delete raw.current_leaf_message_uuid;
        eq(ChatTree.activePath(ClaudeFormat.normalize(raw)), ['h1', 'a1', 'h2b']);
    });
    check('thinking stays out of the text, citations become footnotes, pasted text is kept', () => {
        const conv = ClaudeFormat.normalize(claudeRaw({ leaf: 'a2' }));
        eq(conv.nodes.a1.text, 'It is the linker.');
        eq(conv.nodes.a1.blocks[0], { kind: 'thinking', text: 'Let me look.' });
        eq(conv.nodes.a2.text, 'Link the math library.[^1]');
        eq(conv.nodes.a2.blocks[0].text, 'Searched the web: "ld undefined symbol"');
        eq(conv.nodes.a2.cites, [{ n: 1, title: 'ld manual', url: 'https://example.com/ld' }]);
        eq(conv.nodes.h2.blocks[1], { kind: 'attachment', name: 'paste.txt', text: 'ld: undefined symbol' });
        eq(conv.nodes.h2b.text, 'An edited question\n\n[file: screenshot.png]');
        eq(conv.nodes.h1.text, 'Old style prompt', 'a message with only text did not read');
        eq(conv.nodes.a1.model, 'claude-sonnet-4');
    });
    check('a list row reads as the library wants it', () => {
        eq(ClaudeFormat.listItem({ uuid: 'u', name: '', updated_at: '2025-11-13T10:00:00Z' }),
            { id: 'u', title: 'Untitled chat', updatedAt: Date.parse('2025-11-13T10:00:00Z') });
    });

    // ------------------------------------------------ replaying artifacts

    section('replaying claude artifacts');

    /** A chat that builds a component over four answers, and makes a second document too. */
    function artifactChat() {
        const tool = (input) => ({ type: 'tool_use', name: 'artifacts', input });
        const said = (t) => ({ type: 'text', text: t });
        const m = (uuid, parent, sender, at, content) => ({
            uuid, parent_message_uuid: parent, sender, created_at: `2025-11-13T10:00:${String(at).padStart(2, '0')}Z`, content,
        });
        const code = 'function add(a, b) {\n  return a + b;\n}\n```not a fence end```';
        return ClaudeFormat.normalize({
            uuid: 'c', name: 'Adder', current_leaf_message_uuid: 'a4',
            chat_messages: [
                m('h1', ClaudeFormat.SENTINEL, 'human', 1, [said('Write add')]),
                m('a1', 'h1', 'assistant', 2, [said('Here:'), tool({ command: 'create', id: 'add', title: 'add.js', type: 'application/vnd.ant.code', language: 'javascript', content: code })]),
                m('h2', 'a1', 'human', 3, [said('Rename a')]),
                m('a2', 'h2', 'assistant', 4, [tool({ command: 'update', id: 'add', old_str: 'a, b', new_str: 'x, b' }),
                    tool({ command: 'create', id: 'notes', title: 'Notes', type: 'text/markdown', content: '# Notes' })]),
                m('h3', 'a2', 'human', 5, [said('Start over')]),
                m('a3', 'h3', 'assistant', 6, [tool({ command: 'rewrite', id: 'add', content: 'const add = (x, y) => x + y;' })]),
                m('h4', 'a3', 'human', 7, [said('Rename x')]),
                m('a4', 'h4', 'assistant', 8, [tool({ command: 'update', id: 'add', old_str: '(x, y) => x', new_str: '(p, y) => p' }),
                    tool({ command: 'update', id: 'notes', old_str: 'nowhere', new_str: 'x' })]),
                // An abandoned branch that rewrote it into something else.
                m('a4x', 'h4', 'assistant', 9, [tool({ command: 'rewrite', id: 'add', content: 'BRANCH' })]),
            ],
        });
    }

    check('create, update, rewrite and update replay to the final text', () => {
        const [add, notes] = ChatExport.artifacts(artifactChat());
        eq(add.content, 'const add = (p, y) => p + y;');
        eq([add.title, add.language, add.lastTurn, add.stale], ['add.js', 'javascript', 'a4', false]);
        eq([notes.language, notes.content], ['markdown', '# Notes'], 'a second document crossed with the first');
    });
    check('an update whose passage is missing marks the document stale and changes nothing', () => {
        const notes = ChatExport.artifacts(artifactChat())[1];
        eq([notes.stale, notes.content], [true, '# Notes']);
    });
    check('an artifact is exported once, in full, after the turn that last touched it', () => {
        const md = ChatExport.markdown(artifactChat(), { now: 0 });
        eq((md.match(/### add\.js/g) || []).length, 1);
        assert(md.indexOf('### add.js') > md.indexOf('Rename x'), 'printed before its last edit');
        assert(md.includes('*(wrote "add.js" — final version below)*') && md.includes('*(updated "add.js" — final version below)*'));
        assert(md.includes('```javascript\nconst add = (p, y) => p + y;\n```'), 'the final text is not what was printed');
        assert(!md.includes('BRANCH'), 'an abandoned branch reached the export');
        assert(md.includes('may be out of date'), 'a stale document was not said to be one');
        eq(ChatExport.json(artifactChat()).artifacts.map((a) => a.id), ['add', 'notes']);
    });
    check('a fence inside an artifact never closes the export’s fence around it', () => {
        const chat = artifactChat();
        chat.current = 'a1';
        const md = ChatExport.markdown(chat);
        assert(md.includes('````javascript\nfunction add(a, b)'), md);
    });
    check('pasted text rides along under the prompt, folded', () => {
        const md = ChatExport.markdown(ClaudeFormat.normalize(claudeRaw()), { now: 0 });
        assert(md.includes('<details><summary>paste.txt</summary>\n\n```\nld: undefined symbol\n```\n\n</details>'), md);
        assert(md.includes('## Claude'), 'the other side is not named Claude');
    });

    // ------------------------------------------------------ reading claude.ai

    section('reading claude.ai');

    const ClaudeRead = require('../src/content/claude-read.js');

    check('a row is its place on the path shown, when its words say so', () => {
        const conv = ClaudeFormat.normalize(claudeRaw());
        eq(ClaudeRead.matchTurn(conv, 1, 'Thought for 3s It is the linker.'), ['a1']);
        eq(ClaudeRead.matchTurn(conv, 3, 'Add -lm to the link line. Copy Retry'), ['a2r']);
    });
    check('a row whose words disagree is no turn at all — never the likely one', () => {
        const conv = ClaudeFormat.normalize(claudeRaw());
        eq(ClaudeRead.matchTurn(conv, 1, 'Something else entirely'), []);
        eq(ClaudeRead.matchTurn(conv, 9, 'It is the linker.'), [], 'past the end of the path');
    });
    check('a row showing a sibling — the page’s own arrows were used — is that sibling', () => {
        const conv = ClaudeFormat.normalize(claudeRaw());
        eq(ClaudeRead.matchTurn(conv, 3, 'Link the math library. 1'), ['a2']);
        eq(ClaudeRead.matchTurn(conv, 2, 'An edited question'), ['h2b']);
    });
    check('a node\'s words are worked out once, however many rows and passes ask', () => {
        // Every row asked for them on every pass, several passes a frame
        // while an answer streamed — four regexes over the whole answer each.
        const conv = ClaudeFormat.normalize(claudeRaw());
        let reads = 0;
        const node = conv.nodes.a1;
        const blocks = node.blocks;
        Object.defineProperty(node, 'blocks', { get: () => { reads++; return blocks; } });
        eq(ClaudeRead.matchTurn(conv, 1, 'Thought for 3s It is the linker.'), ['a1']);
        const once = reads;
        for (let pass = 0; pass < 4; pass++) eq(ClaudeRead.matchTurn(conv, 1, 'Thought for 3s It is the linker.'), ['a1']);
        eq(reads, once, 'four more passes read the node again');
    });
    check('a long row is matched off its start, and a start bare of letters still reaches its words', () => {
        const conv = ClaudeFormat.normalize(claudeRaw());
        eq(ClaudeRead.matchTurn(conv, 1, `It is the linker. ${'word '.repeat(20000)}`), ['a1']);
        eq(ClaudeRead.matchTurn(conv, 1, `${'-'.repeat(6000)} It is the linker.`), ['a1'], 'past a ruler of dashes');
    });
    check('nothing is drawn under /code, or anywhere that is not a chat', () => {
        assert(ClaudeRead.onChatPage('/new') && ClaudeRead.onChatPage('/chat/9a978684-1ba6-4d23-af91-b09ad7ae3f9c'));
        for (const path of ['/code', '/code/session_1', '/settings/profile', '/recents', '/projects', '/artifacts']) {
            assert(!ClaudeRead.onChatPage(path), `${path} is not a chat`);
        }
    });

    await checkAsync('the organisation comes from the page’s cookie, or the first that can chat', async () => {
        const calls = [];
        const answer = (body) => ({ ok: true, status: 200, json: async () => body });
        const impl = async (url) => {
            calls.push(url);
            if (url === '/api/organizations') return answer([{ uuid: 'api-only', capabilities: ['api'] }, { uuid: 'org-2', capabilities: ['chat'] }]);
            return answer([{ uuid: 'k1', name: 'First', updated_at: '2025-11-13T10:00:00Z' }]);
        };
        const fromCookie = ClaudeRead.createApi(impl, () => 'a=1; lastActiveOrg=org-1; b=2');
        eq((await fromCookie.listConversations({ limit: 1 })).total, 2, 'a full page should admit there may be more');
        eq(calls, ['/api/organizations/org-1/chat_conversations?limit=1&offset=0']);
        calls.length = 0;
        const fromApi = ClaudeRead.createApi(impl, () => '');
        eq((await fromApi.listConversations({ limit: 5 })).items, [{ id: 'k1', title: 'First', updatedAt: Date.parse('2025-11-13T10:00:00Z') }]);
        eq(calls[1], '/api/organizations/org-2/chat_conversations?limit=5&offset=0');
    });
    await checkAsync('a conversation arrives already in the tree shape', async () => {
        const impl = async () => ({ ok: true, status: 200, json: async () => claudeRaw() });
        const conv = await ClaudeRead.createApi(impl, () => 'lastActiveOrg=o').fetchConversation('conv-uuid');
        eq(ChatTree.activePath(conv), ['h1', 'a1', 'h2', 'a2r']);
    });

    // ------------------------------------------------ claude's page bridge

    section('the claude page bridge');

    /**
     * claude-page.js run against a fetch that answers `response`, with a
     * document that records what it says. Node has Response, streams and
     * CustomEvent of its own, which is all the bridge touches.
     */
    async function throughBridge(response, url) {
        const saved = { window: global.window, document: global.document };
        const heard = [];
        global.document = new EventTarget();
        for (const name of ['bb:claude:stream', 'bb:claude:limit']) {
            document.addEventListener(name, (event) => heard.push([name.slice(10), JSON.parse(event.detail)]));
        }
        global.window = { fetch: async () => response };
        try {
            delete require.cache[require.resolve('../src/content/claude-page.js')];
            require('../src/content/claude-page.js');
            const answer = await window.fetch(url, { method: 'POST' });
            const pageRead = answer.ok ? await answer.text() : '';
            for (let i = 0; i < 50 && !heard.some(([, d]) => d.phase === 'end'); i++) await new Promise((done) => setTimeout(done, 5));
            return { heard, pageRead };
        } finally {
            global.window = saved.window;
            global.document = saved.document;
        }
    }

    const completion = '/api/organizations/o/chat_conversations/9a978684-1ba6-4d23-af91-b09ad7ae3f9c/completion';
    const sse = (...events) => events.map((body) => `event: ${body.type}\r\ndata: ${JSON.stringify(body)}\r\n\r\n`).join('');

    await checkAsync('the bridge reports the start, the exact limit and the end, and the page still reads it all', async () => {
        const body = sse({ type: 'message_start' },
            { type: 'message_limit', message_limit: { type: 'approaching_limit', resetsAt: 1763000000, remaining: 2 } },
            { type: 'content_block_delta', delta: { text: 'hi' } }, { type: 'message_stop' });
        const { heard, pageRead } = await throughBridge(new Response(body), completion);
        eq(heard, [
            ['stream', { phase: 'start', conv: '9a978684-1ba6-4d23-af91-b09ad7ae3f9c' }],
            ['limit', { type: 'approaching_limit', resetsAt: 1763000000000, remaining: 2 }],
            ['stream', { phase: 'end', conv: '9a978684-1ba6-4d23-af91-b09ad7ae3f9c' }],
        ]);
        eq(pageRead, body, 'the page did not get its whole stream');
    });
    await checkAsync('a 429 says which limit and when it resets, and ends the answer', async () => {
        const error = { type: 'error', error: { type: 'rate_limit_error', message: JSON.stringify({ type: 'exceeded_limit', resetsAt: 1763003600 }) } };
        const { heard } = await throughBridge(new Response(JSON.stringify(error), { status: 429 }), completion);
        eq(heard.slice(1), [
            ['limit', { type: 'exceeded_limit', resetsAt: 1763003600000, remaining: null }],
            ['stream', { phase: 'end', conv: '9a978684-1ba6-4d23-af91-b09ad7ae3f9c', error: 429 }],
        ]);
    });
    await checkAsync('any other request goes by untouched and unreported', async () => {
        const { heard } = await throughBridge(new Response('{}'), '/api/organizations/o/chat_conversations?limit=5');
        eq(heard, []);
    });
    check('the bridge runs in the page’s world on claude.ai alone, before the page takes its fetch', () => {
        const entry = contentScripts().find((one) => one.js.includes('src/content/claude-page.js'));
        eq([entry.world, entry.run_at, entry.matches], ['MAIN', 'document_start', ['*://claude.ai/*']]);
        const source = readRepo('src/content/claude-page.js');
        assert(!/chrome\./.test(source.replace(/\/\*[\s\S]*?\*\//g, '')), 'a MAIN-world script cannot use chrome.*');
    });

    // ------------------------------------------------- reading chatgpt.com

    section('reading chatgpt.com');

    const ChatgptRead = require('../src/content/chatgpt-read.js');

    check('a sibling count reads as k/n or it is not the sibling control', () => {
        eq(ChatgptRead.readCount(' 2 / 3 '), { index: 2, count: 3 });
        eq(ChatgptRead.readCount('2/3 answers'), null, 'prose that mentions a count');
        eq(ChatgptRead.readCount('1/1'), null, 'a single sibling has no control');
        eq(ChatgptRead.readCount('4/3'), null);
    });
    check('the turn selectors lead with the markup chatgpt.com draws now', () => {
        // A <section> since 2026. The older spellings stay below it.
        eq(ChatgptRead.SELECTORS.turn[0], 'section[data-testid^="conversation-turn-"]');
        assert(ChatgptRead.SELECTORS.turn.some((s) => s.startsWith('article')), 'the old spelling was collapsed away');
    });

    /** A stand-in fetch that answers from a table and records what it was asked. */
    function fakeFetch(routes) {
        const calls = [];
        const impl = async (url, options = {}) => {
            calls.push({ url, auth: options.headers && options.headers.Authorization });
            const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
            const answer = route ? routes[route](calls.length) : { status: 404 };
            return { ok: answer.status === 200, status: answer.status, json: async () => answer.body };
        };
        return { impl, calls };
    }

    await checkAsync('the token is fetched once, and once more on a 401', async () => {
        let issued = 0;
        let rejected = false;
        const { impl, calls } = fakeFetch({
            '/api/auth/session': () => ({ status: 200, body: { accessToken: `t${++issued}` } }),
            '/backend-api/conversations': () => {
                if (!rejected) { rejected = true; return { status: 401 }; }
                return { status: 200, body: { items: [{ id: 'a', title: 'One', update_time: 1700000000 }], total: 40 } };
            },
        });
        const api = ChatgptRead.createApi(impl);
        const page = await api.listConversations({ offset: 0, limit: 1 });
        eq(page, { items: [{ id: 'a', title: 'One', updatedAt: 1700000000000 }], total: 40 });
        eq(calls.map((c) => c.url.split('?')[0]), ['/api/auth/session', '/backend-api/conversations',
            '/api/auth/session', '/backend-api/conversations']);
        eq(calls[3].auth, 'Bearer t2', 'the retry went out with the stale token');
        await api.listConversations();
        eq(calls.filter((c) => c.url === '/api/auth/session').length, 2, 'the token was not kept');
    });
    await checkAsync('a conversation arrives already in the tree shape', async () => {
        const { impl } = fakeFetch({
            '/api/auth/session': () => ({ status: 200, body: { accessToken: 't' } }),
            '/backend-api/conversation/conv-1': () => ({ status: 200, body: chatgptRaw() }),
        });
        const conv = await ChatgptRead.createApi(impl).fetchConversation('conv-1');
        eq(ChatTree.activePath(conv), ['u1', 'a1', 'u2', 'a2']);
    });
    await checkAsync('signed out is said as such, not as an empty list', async () => {
        const { impl } = fakeFetch({ '/api/auth/session': () => ({ status: 200, body: {} }) });
        let code = null;
        try { await ChatgptRead.createApi(impl).listConversations(); } catch (error) { code = error.code; }
        eq(code, 'signed-out');
    });

    // --------------------------------------------------- the text reader

    section('reader loader — the text reader is brought in when it is asked for');
    const ReaderLoader = require('../src/background/reader-loader.js');

    /** The worker's API, as far as the loader uses it, with the tab answering as told. */
    function readerApi({ core = true, reader = false, fail = false, answer = { ok: true } } = {}) {
        const calls = [];
        const api = {
            runtime: { getManifest: () => JSON.parse(readRepo('manifest.json')), lastError: null },
            scripting: {
                executeScript: async (options) => {
                    calls.push(options.files ? ['files', ...options.files] : ['probe']);
                    if (fail) throw new Error('Cannot access contents of the page');
                    return options.func ? [{ result: { core, reader } }] : [{}];
                },
            },
            tabs: {
                sendMessage: (tabId, message, done) => {
                    calls.push(['tell', tabId, message.action, message.op || '']);
                    done(answer);
                },
            },
        };
        return { api, calls };
    }

    checkAsync('a page with the core gets the reader\'s files, then is told to open it', async () => {
        const { api, calls } = readerApi();
        eq(await ReaderLoader.createLoader(api).open(3, 'https://example.com/post', { op: 'open' }), { ok: true, reason: '' });
        eq(calls, [['probe'], ['files', ...ReaderLoader.BASE_FILES, ...ReaderLoader.SITE_FILES.other], ['tell', 3, 'textReader', 'open']]);
    });
    checkAsync('a page that has the reader is only told; one whose scripts died with a reload gets the core first', async () => {
        const has = readerApi({ reader: true });
        await ReaderLoader.createLoader(has.api).open(3, 'https://example.com/post');
        eq(has.calls, [['probe'], ['tell', 3, 'textReader', 'toggle']]);

        const stale = readerApi({ core: false });
        await ReaderLoader.createLoader(stale.api).open(3, 'https://example.com/post');
        const generic = JSON.parse(readRepo('manifest.json')).content_scripts[0].js;
        eq(stale.calls[1], ['files', ...generic], 'the reader would stand on a core that is not there');
        eq(generic[generic.length - 1], 'src/content/main.js', 'nothing would answer the tell');
        eq(stale.calls.length, 4);
    });
    checkAsync('youtube is the video reader\'s, and a page nothing may run on says so', async () => {
        const tube = readerApi();
        eq(await ReaderLoader.createLoader(tube.api).open(3, 'https://www.youtube.com/watch?v=x'), { ok: true, reason: 'youtube' });
        eq(tube.calls, [['tell', 3, 'openReader', '']]);

        const store = readerApi({ fail: true });
        eq(await ReaderLoader.createLoader(store.api).open(3, 'https://chromewebstore.google.com/detail/x'), { ok: false, reason: 'unscriptable' });
        const local = readerApi();
        eq(await ReaderLoader.createLoader(local.api).open(3, 'chrome://extensions/'), { ok: false, reason: 'unscriptable' });
        eq(local.calls, [], 'a chrome:// page was probed');
    });
    check('the reader is in no list every page loads, and the worker carries the loader', () => {
        for (const name of ['manifest.json', 'manifest.firefox.json']) {
            const manifest = JSON.parse(readRepo(name));
            const listed = manifest.content_scripts.flatMap((one) => one.js || []);
            eq(listed.filter((file) => ReaderLoader.BASE_FILES.includes(file)), [], name);
            const shared = manifest.web_accessible_resources.find((one) => one.matches.includes('<all_urls>')).resources;
            assert(shared.includes('content-reader.css') && shared.includes('textures/*.png'), `${name}: the reader's shadow root cannot have its sheet or its paper`);
        }
        const worker = [.../importScripts\(([\s\S]*?)\);/.exec(readRepo('background.js'))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
        assert(worker.indexOf('src/background/reader-loader.js') > worker.indexOf('src/background/router.js'), 'it answers through the router');
        assert(JSON.parse(readRepo('manifest.firefox.json')).background.scripts.includes('src/background/reader-loader.js'), 'not in Firefox\'s worker');
        for (const file of [...ReaderLoader.BASE_FILES, ...Object.values(ReaderLoader.SITE_FILES).flat()]) {
            assert(require('fs').existsSync(`${__dirname}/../${file}`), `${file} is missing`);
        }
    });
    check('an x thread is read from x\'s own responses, kept from the page\'s start, and only looked at', () => {
        const page = SiteScripts.PAGE.find((one) => one.id === 'twitter-thread-page');
        eq([page.site, page.runAt, page.js], ['twitter', 'document_start', ['src/content/twitter-thread-page.js']],
            'a wrapper put on after X took its own fetch never sees a request');
        eq(SiteScripts.scripts(SiteScripts.genericOf(JSON.parse(readRepo('manifest.json'))), ['twitter']).some((one) => one.id === 'bb-twitter-thread-page'), false,
            'kept on an X switched off');
        for (const url of ['https://x.com/ada/status/1', 'https://mobile.twitter.com/ada/status/1']) eq(ReaderLoader.siteOf(url), 'twitter', url);
        assert(ReaderLoader.SITE_FILES.twitter.includes('src/content/x-thread-read.js'), 'the extractor would read X');
        // Its code, without the comments that say what it does not do.
        const capture = readRepo('src/content/twitter-thread-page.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        assert(!/new XMLHttpRequest|fetched\((?!\s*\))|chrome\./.test(capture.replace(/fetched\.apply\(this, arguments\)/g, '')), 'the capture asks X for something of its own');
        const main = readRepo('src/content/main.js');
        assert(/ON_X && XThreadRead \? XThreadRead\.adapter/.test(main), 'X is read by the extractor');
        assert(/ON_X \? X_STATUS\.test\(location\.pathname\)/.test(main), 'the key is claimed on every X page, not only a post\'s');
    });

    // ---------------------------------------------------- party loader

    section('party loader — nothing loads until a party starts');
    const PartyLoader = require('../src/background/party-loader.js');
    const fs = require('fs');

    check('no manifest loads party code into a page', () => {
        for (const name of ['manifest.json', 'manifest.firefox.json']) {
            const manifest = JSON.parse(fs.readFileSync(`${__dirname}/../${name}`, 'utf8'));
            const listed = [...manifest.content_scripts, ...SiteScripts.scripts(SiteScripts.genericOf(manifest))].flatMap((one) => one.js || []);
            eq(listed.filter((file) => /party/.test(file)), [], name);
        }
    });
    check('every file the loader injects is on disk', () => {
        const files = [...PartyLoader.CONTENT_FILES, ...PartyLoader.CSS_FILES, ...Object.values(PartyLoader.PAGE_FILES).flat()];
        for (const file of files) assert(fs.existsSync(`${__dirname}/../${file}`), `${file} is missing`);
    });

    /** Just the chrome.* the loader touches, recording what it injects. */
    function loaderWith(session = {}) {
        const injected = [];
        const styled = [];
        const api = {
            storage: { session: {
                get: async (key) => (key in session ? { [key]: session[key] } : {}),
                set: async (values) => { Object.assign(session, values); },
                remove: async (key) => { delete session[key]; },
            } },
            scripting: {
                executeScript: async ({ target, files, world }) => { injected.push({ tab: target.tabId, files, world }); },
                insertCSS: async ({ target, files }) => { styled.push({ tab: target.tabId, files }); },
            },
        };
        return { loader: PartyLoader.createLoader(api), injected, styled, session };
    }
    const done = { status: 'complete' };

    await checkAsync('a tab that has never been in a party is never injected', async () => {
        const { loader, injected } = loaderWith();
        await loader.onUpdated(7, done, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
        eq(injected, []);
    });
    await checkAsync('starting a party brings the code into that tab only', async () => {
        const { loader, injected, styled, session } = loaderWith();
        assert(await loader.bind(7, 'https://www.netflix.com/watch/81234567'));
        eq(styled, [{ tab: 7, files: ['party-page.css'] }], 'the chip\'s styles, with its code');
        eq(injected.map((one) => one.tab), [7, 7]);
        eq(injected[0].files, [...PartyLoader.CONTENT_FILES]);
        eq([injected[1].world, injected[1].files], ['MAIN', ['src/content/netflix-page.js']], 'the player bridge, in the page\'s world');
        eq(session[PartyLoader.KEY], { tabId: 7, site: 'netflix' });
        assert(!(await loader.bind(8, 'https://example.com/')), 'not a site the party plays on');
    });
    await checkAsync('the party tab reloading is injected again; others and elsewhere are not', async () => {
        const { loader, injected } = loaderWith({ [PartyLoader.KEY]: { tabId: 7, site: 'youtube' } });
        await loader.onUpdated(7, { status: 'loading' }, { url: 'https://www.youtube.com/' });
        await loader.onUpdated(8, done, { url: 'https://www.youtube.com/' });
        await loader.onUpdated(7, done, { url: 'https://example.com/' });
        eq(injected, [], 'not complete, not the party tab, not a party site');
        await loader.onUpdated(7, done, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
        eq(injected.map((one) => one.tab), [7], 'read back from the session after a worker restart');
    });
    await checkAsync('leaving, or closing the tab, shuts the gate again', async () => {
        const { loader, injected, session } = loaderWith();
        const closed = [];
        loader.onClosed((tabId) => closed.push(tabId));
        await loader.bind(7, 'https://www.youtube.com/');
        await loader.onRemoved(8);
        await loader.onRemoved(7);
        eq(session[PartyLoader.KEY], undefined);
        eq(closed, [7], 'told about the party\'s tab, not any tab');
        await loader.onUpdated(7, done, { url: 'https://www.youtube.com/' });
        eq(injected.length, 1);
    });

    // --------------------------------------------------- party loopback

    section('party loopback — the room, with no network in between');
    const PartyLoopback = require('../src/offscreen/party-loopback.js');

    /** A loopback and a way to open members on it, each keeping what it hears. */
    function loopbackWith(policy = {}) {
        const loop = PartyLoopback.createLoopback({ policy, now: () => 1000 });
        const member = () => {
            const heard = [];
            const link = loop.open((msg) => heard.push(msg));
            return { link, heard, last: (t) => heard.filter((msg) => msg.t === t).pop() };
        };
        return { loop, member };
    }

    check('a link is nobody until it says create or hello', () => {
        const { loop, member } = loopbackWith();
        const ana = member();
        ana.link.send({ t: 'intent', id: 1, base: 0, op: 'play', pos: 0 });
        eq([ana.heard, loop.room.members()], [[], []]);
        ana.link.send({ t: 'create', v: 1, name: 'Ana' });
        eq(ana.heard.map((msg) => msg.t), ['welcome', 'members'], 'its own welcome, caught before its id was known');
        eq(ana.last('welcome').room.members.map((m) => [m.name, m.role]), [['Ana', 'host']]);
        loop.close();
    });
    check('members on one loopback share the room', () => {
        const { loop, member } = loopbackWith();
        const ana = member();
        const ben = member();
        ana.link.send({ t: 'create', v: 1, name: 'Ana' });
        ben.link.send({ t: 'hello', v: 1, name: 'Ben' });
        ben.link.send({ t: 'intent', id: 1, base: 0, op: 'play', pos: 4 });
        eq([ana.last('state').paused, ana.last('state').by], [false, ben.last('welcome').you]);
        loop.close();
    });
    check('hanging up keeps the member for a resume; bye does not', () => {
        const { loop, member } = loopbackWith();
        const ana = member();
        ana.link.send({ t: 'create', v: 1, name: 'Ana' });
        const { you, resume } = ana.last('welcome');
        ana.link.close();
        const back = member();
        back.link.send({ t: 'hello', v: 1, resume });
        eq(back.last('welcome').you, you);
        back.link.send({ t: 'bye' });
        eq(loop.room.members(), []);
        const late = member();
        late.link.send({ t: 'hello', v: 1, resume });
        eq(late.heard, [{ t: 'error', code: 'expired' }]);
        loop.close();
    });
    check('a resume on a new link is welcomed there, and the old link is nobody', () => {
        const { loop, member } = loopbackWith();
        const ana = member();
        ana.link.send({ t: 'create', v: 1, name: 'Ana' });
        const { you, resume } = ana.last('welcome');
        const back = member();
        back.link.send({ t: 'hello', v: 1, resume });
        eq([back.last('welcome').you, ana.heard.filter((msg) => msg.t === 'welcome').length], [you, 1], 'not sent down the old link');
        ana.link.send({ t: 'intent', id: 1, base: 0, op: 'play', pos: 0 });
        ana.link.close();
        eq([loop.room.state().paused, loop.room.members().length], [true, 1]);
        back.link.send({ t: 'intent', id: 2, base: 0, op: 'play', pos: 0 });
        eq(loop.room.state().paused, false, 'the old link hanging up did not take the new one with it');
        loop.close();
    });
    check('a refused join is told why', () => {
        const { loop, member } = loopbackWith();
        const ana = member();
        ana.link.send({ t: 'create', v: 1, name: 'Ana' });
        ana.link.send({ t: 'policy', locked: true });
        const ben = member();
        ben.link.send({ t: 'hello', v: 1, name: 'Ben' });
        eq(ben.heard, [{ t: 'error', code: 'locked' }]);
        loop.close();
    });

    // ---------------------------------------------------- party session

    section('party session — the member the party tab plugs into');
    const PartySession = require('../src/offscreen/party-session.js');

    /** A runtime port as the session sees it, with the tab's end to talk and hang up on. */
    function tabPort(name = PartySession.PORT) {
        const on = { message: [], disconnect: [] };
        const port = {
            name, heard: [], gone: false,
            postMessage: (msg) => port.heard.push(JSON.parse(JSON.stringify(msg))),
            disconnect() { port.gone = true; },
            onMessage: { addListener: (fn) => on.message.push(fn) },
            onDisconnect: { addListener: (fn) => on.disconnect.push(fn) },
            say: (msg) => on.message.forEach((fn) => fn(msg)),
            hangUp: () => on.disconnect.forEach((fn) => fn()),
            last: (t) => port.heard.filter((msg) => msg.t === t).pop(),
        };
        return port;
    }
    async function inParty(t = 50000) {
        const session = PartySession.createSession({ now: () => t });
        const started = await session.control({ op: 'start', name: 'Ana', policy: { control: 'everyone' } });
        const you = started.status.you;
        const leave = () => session.control({ op: 'leave' });
        return { session, started, you, leave };
    }

    await checkAsync('a tab joining is handed the room, and its play comes back acknowledged', async () => {
        const { session, started, you, leave } = await inParty();
        eq([started.ok, started.status.members.map((m) => [m.name, m.role])], [true, [['Ana', 'host']]]);
        const tab = tabPort();
        session.connect(tab);
        const welcome = tab.last('welcome');
        eq([welcome.you, welcome.room.state.paused], [you, true]);
        tab.say({ t: 'intent', id: 1, base: welcome.room.state.seq, op: 'play', pos: 3, at: 50000 });
        const state = tab.last('state');
        eq([state.paused, state.pos, state.ack], [false, 3, { member: you, id: 1 }]);
        await leave();
    });
    await checkAsync('the tab\'s ping is answered in room time, with the state when it is behind', async () => {
        const { session, leave } = await inParty(50000);
        const tab = tabPort();
        session.connect(tab);
        tab.heard.length = 0;
        tab.say({ t: 'ping', c: 49990, seq: 0 });
        eq(tab.heard.map((msg) => msg.t), ['pong'], 'up to date: just the pong');
        eq(tab.last('pong'), { t: 'pong', c: 49990, s: 50000, s2: 50000 });
        tab.say({ t: 'ping', c: 49995, seq: -1 });
        eq(tab.heard.map((msg) => msg.t), ['pong', 'pong', 'state']);
        await leave();
    });
    await checkAsync('a tab going keeps the member, and stops the room waiting on it', async () => {
        const { session, you, leave } = await inParty();
        const flags = () => session.status().members.map((m) => [m.ready, m.solo]);
        for (const replaced of [false, true]) {
            const before = tabPort();
            session.connect(before);
            before.say({ t: 'ready', ready: false, why: 'buffering' });
            before.say({ t: 'solo', solo: true });
            eq(flags(), [[false, true]]);
            const after = tabPort();
            if (replaced) session.connect(after);
            else before.hangUp();
            eq(flags(), [[true, false]], 'the next document starts ready and in the room');
            if (!replaced) session.connect(after);
            eq(after.last('welcome').you, you, 'the same member, not a new one');
            if (!replaced) continue;
            assert(before.last('detach') && before.gone, 'the tab taken over from is let go');
            before.say({ t: 'intent', id: 1, base: 0, op: 'play', pos: 0, at: 50000 });
            eq(session.status().state.paused, true, 'and no longer heard');
        }
        await leave();
    });
    await checkAsync('REGRESSION: a welcome from another room starts the clock again', async () => {
        // A tracker party's next host, or a server that lost the room, keeps
        // its own clock. The old room's samples stayed in the window and, with
        // the faster round trip, went on setting room time.
        let deliver = null;
        let skew = 0;
        let rtt = 10;
        let t = 100000;
        const room = (id, seq) => ({ id, policy: {}, members: [], state: { seq, paused: true, pos: 0, rate: 1, at: 0 } });
        const transport = {
            open(fn) {
                deliver = fn;
                return {
                    send(msg) {
                        if (msg.t === 'create') deliver({ t: 'welcome', you: 'm1', resume: 'r1', room: room('p1', 1) });
                        if (msg.t === 'ping') deliver({ t: 'pong', c: msg.c, s: msg.c + rtt / 2 + skew, s2: msg.c + rtt / 2 + skew });
                    },
                    close() {},
                };
            },
            close() {},
        };
        const session = PartySession.createSession({ transports: { loopback: () => transport }, now: () => (t += rtt) && t - rtt });
        await session.control({ op: 'start', name: 'Ana' });
        skew = 2000;
        rtt = 80;
        deliver({ t: 'welcome', you: 'm9', resume: 'r9', room: room('p2', 5) });
        const tab = tabPort();
        session.connect(tab);
        tab.say({ t: 'ping', c: t });
        const pong = tab.last('pong');
        assert(pong && Math.abs(pong.s - t - skew) < 100, `room time is the new room's: ${pong && pong.s - t}`);
        await session.control({ op: 'leave' });
    });
    await checkAsync('REGRESSION: welcomed as a new member, the session says again that the tab is solo and buffering', async () => {
        // Past the resume grace, or in a tracker party's next room, the member
        // is new and starts ready; the tab reports only changes, so a buffering
        // member read "Ready" and the room started without them.
        let deliver = null;
        const said = [];
        const room = (id) => ({ id, policy: {}, members: [], state: { seq: 1, paused: true, pos: 0, rate: 1, at: 0 } });
        const transport = {
            open(fn) {
                deliver = fn;
                return {
                    send(msg) {
                        if (msg.t === 'create') deliver({ t: 'welcome', you: 'm1', resume: 'r1', room: room('p1') });
                        else if (msg.t !== 'ping') said.push(msg);
                    },
                    close() {},
                };
            },
            close() {},
        };
        const session = PartySession.createSession({ transports: { loopback: () => transport }, now: () => 1000 });
        await session.control({ op: 'start', name: 'Ana' });
        const tab = tabPort();
        session.connect(tab);
        tab.say({ t: 'solo', solo: true });
        tab.say({ t: 'ready', ready: false, why: 'loading' });
        said.length = 0;
        deliver({ t: 'welcome', you: 'm1', resume: 'r1', room: room('p1') });
        eq(said, [], 'back as the same member, the room still has it');
        deliver({ t: 'welcome', you: 'm2', resume: 'r2', room: room('p1') });
        eq(said, [{ t: 'ready', ready: false, why: 'loading' }, { t: 'solo', solo: true }], 'a new member is told');
        said.length = 0;
        tab.say({ t: 'solo', solo: false });
        tab.say({ t: 'ready', ready: true });
        said.length = 0;
        deliver({ t: 'welcome', you: 'm3', resume: 'r3', room: room('p2') });
        eq(said, [], 'a member ready and in step has nothing to say');
        await session.control({ op: 'leave' });
    });
    await checkAsync('the tab says how far off its player is, for the popup, and the room never hears it', async () => {
        const loop = PartyLoopback.createLoopback();
        const session = PartySession.createSession({ transports: { loopback: () => loop }, now: () => 1000 });
        await session.control({ op: 'start', name: 'Ana' });
        const heard = [];
        const room = loop.room.handle;
        loop.room.handle = (id, msg, at) => { heard.push(msg.t); return room(id, msg, at); };
        const tab = tabPort();
        session.connect(tab);
        eq(session.status().drift, undefined, 'nothing said yet');
        tab.say({ t: 'drift', ms: -42 });
        tab.say({ t: 'drift', ms: 'far' });
        tab.say({ t: 'drift', ms: 38 });
        tab.say({ t: 'ready', ready: true });
        eq([session.status().drift, heard], [38, ['ready']], 'what the tab says for the room still reaches it');
        await session.control({ op: 'leave' });
    });
    await checkAsync('chat said on the tab comes back as the log keeps it, and others\' lines are unread until the panel is open', async () => {
        const loop = PartyLoopback.createLoopback();
        const session = PartySession.createSession({ transports: { loopback: () => loop }, now: () => 1000 });
        const { status } = await session.control({ op: 'start', name: 'Ana' });
        const ben = loop.open(() => {});
        ben.send({ t: 'hello', v: 1, name: 'Ben' });
        const tab = tabPort();
        session.connect(tab);
        tab.say({ t: 'chat', text: ' hi all ' });
        const mine = tab.last('chat-line');
        eq([mine.line.text, mine.line.from, mine.line.name, mine.unread], ['hi all', status.you, 'Ana', 0]);
        ben.send({ t: 'chat', text: 'hey' });
        ben.send({ t: 'chat', text: 'ready?' });
        eq(session.status().chat, { unread: 2, last: 'Ben' });
        tab.say({ t: 'chat-read', open: true });
        ben.send({ t: 'chat', text: 'now?' });
        eq([session.status().chat, tab.last('chat-line').unread], [{ unread: 0, last: null }, 0], 'read as it comes');
        tab.hangUp();
        ben.send({ t: 'chat', text: 'hello?' });
        eq(session.status().chat.unread, 1, 'open on a tab that has gone is nobody reading');
        const next = tabPort();
        session.connect(next);
        const log = next.last('chat-log');
        eq([log.open, log.unread], [true, 1], 'the next tab opens it again');
        eq(log.lines.map((one) => one.sys ? `(${one.text})` : `${one.name}: ${one.text}`), ['(Ben joined)', 'Ana: hi all', 'Ben: hey', 'Ben: ready?', 'Ben: now?', 'Ben: hello?']);
        await session.control({ op: 'leave' });
    });
    await checkAsync('the room\'s history is not unread; a line missed while away, replayed after the next welcome, is', async () => {
        let deliver = null;
        const welcome = (you) => ({ t: 'welcome', v: 1, you, resume: 'r', room: { id: 'p', policy: {}, members: [], state: { seq: 0, paused: true } } });
        const transport = { open: (fn) => { deliver = fn; return { send: (msg) => { if (msg.t === 'create') fn(welcome('m1')); }, close() {} }; }, close() {} };
        const session = PartySession.createSession({ transports: { loopback: () => transport }, now: () => 1000 });
        await session.control({ op: 'start', name: 'Ana' });
        const line = (id, extra = {}) => ({ t: 'chat', id, from: 'm2', name: 'Ben', at: 900, text: id, past: true, ...extra });
        deliver(line('c1'));
        eq(session.status().chat.unread, 0, 'said before we came');
        deliver(welcome('m1'));
        deliver(line('c1'));
        deliver(line('c2'));
        deliver(line('c3', { from: 'm1', past: undefined }));
        eq(session.status().chat, { unread: 1, last: 'Ben' }, 'c1 we had, c2 we missed, c3 is our own');
        await session.control({ op: 'leave' });
    });
    await checkAsync('the popup\'s "Open on page" reaches the tab, if there is one', async () => {
        const { session, leave } = await inParty();
        eq(await session.control({ op: 'chat' }), { ok: false });
        const tab = tabPort();
        session.connect(tab);
        eq([await session.control({ op: 'chat' }), !!tab.last('chat-show')], [{ ok: true }, true]);
        await leave();
        eq(await session.control({ op: 'chat' }), { ok: false, error: 'inactive' });
    });
    await checkAsync('the tab cannot leave, kick or reconfigure the room', async () => {
        const { session, leave } = await inParty();
        const tab = tabPort();
        session.connect(tab);
        tab.say({ t: 'policy', control: 'host', locked: true });
        tab.say({ t: 'bye' });
        const now = session.status();
        eq([now.active, now.members.length, now.policy.control, now.policy.locked], [true, 1, 'everyone', false]);
        await leave();
    });
    await checkAsync('the host\'s controls from the popup reach the room, with only the fields each one takes', async () => {
        const loop = PartyLoopback.createLoopback();
        const session = PartySession.createSession({ transports: { loopback: () => loop }, now: () => 1000 });
        await session.control({ op: 'start', name: 'Ana', policy: { control: 'everyone', wait: true } });
        for (const name of ['Ben', 'Cy']) loop.open(() => {}).send({ t: 'hello', v: 1, name });
        const [, ben, cy] = session.status().members.map((m) => m.id);
        eq(await session.control({ op: 'policy', control: 'host', locked: true, member: ben }), { ok: true });
        eq(session.status().policy, { control: 'host', wait: true, locked: true });
        await session.control({ op: 'role', member: ben, role: 'cohost' });
        await session.control({ op: 'kick', member: cy });
        eq(session.status().members.map((m) => [m.name, m.role]), [['Ana', 'host'], ['Ben', 'cohost']]);
        await session.control({ op: 'leave' });
        eq(await session.control({ op: 'kick', member: ben }), { ok: false, error: 'inactive' });
    });
    await checkAsync('leaving lets the tab go, and a tab outside a party is hung up on at once', async () => {
        const { session, leave } = await inParty();
        const tab = tabPort();
        session.connect(tab);
        await leave();
        assert(tab.last('detach') && tab.gone);
        eq(session.status(), { active: false });
        const late = tabPort();
        const other = tabPort('bb:other');
        session.connect(late);
        session.connect(other);
        assert(late.gone, 'its adapter detaches when the port does');
        assert(!other.gone, 'somebody else\'s port is not ours to close');
    });

    // -------------------------------------------------- party websocket

    section('party websocket — a party server, and getting back to it');
    const PartyWs = require('../src/offscreen/party-ws.js');
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    const until = async (test, what) => {
        for (let i = 0; i < 400 && !test(); i++) await tick();
        assert(test(), `timed out waiting for ${what}`);
    };

    /** WebSockets the test plays the server for: accept, say, and die on demand. */
    function fakeSockets() {
        const all = [];
        class Fake {
            constructor(url) {
                Object.assign(this, { url, sent: [], closed: false });
                all.push(this);
            }
            send(text) { this.sent.push(JSON.parse(text)); }
            close() { this.closed = true; }
            accept() { this.onopen(); }
            say(msg) { this.onmessage({ data: JSON.stringify(msg) }); }
            die() { this.onclose(); }
        }
        return { Fake, all, last: () => all[all.length - 1] };
    }
    const wsWelcome = (you, resume) => ({ t: 'welcome', v: 1, you, resume, now: 0, room: { id: 'r1', policy: {}, members: [], state: { seq: 3 } } });

    /** A transport on fake sockets, opened, with what it delivers kept. */
    function wsLink(options) {
        const sockets = fakeSockets();
        const transport = PartyWs.createTransport({ WebSocket: sockets.Fake, random: () => 0, ...options });
        const heard = [];
        const link = transport.open((msg) => heard.push(msg));
        return { ...sockets, transport, link, heard };
    }

    check('an invite round-trips, and only a ws address is one', () => {
        const code = PartyWs.inviteCode({ url: 'wss://party.example/', room: 'r1', secret: 's3cr3t' });
        assert(code.startsWith(PartyWs.PREFIX) && !/[+/=]/.test(code), code);
        eq(PartyWs.readInvite(` ${code} `), { url: 'wss://party.example/', room: 'r1', secret: 's3cr3t' });
        eq(PartyWs.readInvite(PartyWs.inviteCode({ url: 'https://party.example/', room: 'r1', secret: 's' })), null);
        eq([PartyWs.readInvite('bbp1s.@@@'), PartyWs.readInvite('bbp1i.abc')], [null, null]);
        eq([PartyWs.serverUrl(' ws://192.168.1.5:7070 '), PartyWs.serverUrl('192.168.1.5:7070')], ['ws://192.168.1.5:7070/', null]);
        eq(PartyWs.createTransport({ url: 'http://x', WebSocket: fakeSockets().Fake }), null);
    });
    check('starting a room says create, and the secret that comes back stays in the transport', () => {
        const w = wsLink({ url: 'ws://127.0.0.1:7070' });
        w.link.send({ t: 'create', v: 1, name: 'Ana', policy: { control: 'host' } });
        eq(w.all.map((ws) => ws.url), ['ws://127.0.0.1:7070/']);
        w.link.send({ t: 'ping', c: 1, seq: 0 });
        w.last().accept();
        eq(w.last().sent, [{ t: 'create', v: 1, name: 'Ana', policy: { control: 'host' } }], 'nothing but the greeting before the welcome');
        w.last().say({ t: 'created', room: 'r1', secret: 'k' });
        w.last().say(wsWelcome('m1', 'z1'));
        eq(w.heard.map((msg) => msg.t), ['welcome']);
        eq(PartyWs.readInvite(w.transport.invite()), { url: 'ws://127.0.0.1:7070/', room: 'r1', secret: 'k' });
        w.transport.close();
    });
    check('an invite says hello with its room and secret', () => {
        const w = wsLink({ code: PartyWs.inviteCode({ url: 'ws://h:1', room: 'r1', secret: 'k' }) });
        w.link.send({ t: 'create', v: 1, name: 'Ben', policy: {} });
        w.last().accept();
        eq(w.last().sent, [{ t: 'hello', v: 1, room: 'r1', secret: 'k', name: 'Ben' }]);
        w.transport.close();
    });
    await checkAsync('a dropped socket comes back as the same member, with only the latest of what was said while down', async () => {
        const w = wsLink({ url: 'ws://h:1' });
        w.link.send({ t: 'create', v: 1, name: 'Ana' });
        w.last().accept();
        w.last().say({ t: 'created', room: 'r1', secret: 'k' });
        w.last().say(wsWelcome('m1', 'z1'));
        w.last().die();
        eq(w.heard.map((msg) => msg.t), ['welcome', 'link']);
        for (const msg of [
            { t: 'intent', id: 4, base: 3, op: 'pause', pos: 10 }, { t: 'ping', c: 1, seq: 3 },
            { t: 'intent', id: 5, base: 3, op: 'play', pos: 10 }, { t: 'request', op: 'pause' }, { t: 'ready', ready: false },
        ]) w.link.send(msg);
        await tick();
        eq(w.all.length, 2, 'retried');
        w.last().accept();
        eq(w.last().sent, [{ t: 'hello', v: 1, room: 'r1', resume: 'z1' }]);
        w.last().say(wsWelcome('m1', 'z2'));
        eq(w.last().sent.slice(1), [{ t: 'ready', ready: false }, { t: 'intent', id: 5, base: 3, op: 'play', pos: 10 }]);
        w.link.send({ t: 'ping', c: 2, seq: 3 });
        eq(w.last().sent.length, 4, 'up again: sent as it is said');
        w.transport.close();
    });
    await checkAsync('lines typed while the socket is down go on the way back, as many as the room takes at once', async () => {
        const w = wsLink({ url: 'ws://h:1' });
        w.link.send({ t: 'create', v: 1, name: 'Ana' });
        w.last().accept();
        w.last().say({ t: 'created', room: 'r1', secret: 'k' });
        w.last().say(wsWelcome('m1', 'z1'));
        w.last().die();
        for (let i = 1; i <= PartyChat.BURST + 2; i++) w.link.send({ t: 'chat', text: `line ${i}` });
        w.link.send({ t: 'ready', ready: false });
        await tick();
        w.last().accept();
        w.last().say(wsWelcome('m1', 'z2'));
        eq(w.last().sent.slice(1).map((msg) => msg.text || msg.t), ['ready', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7']);
        w.transport.close();
    });
    await checkAsync('REGRESSION: what went into a socket that had died is said again on the way back', async () => {
        // A dead path is not noticed for up to SILENT_MS, and what was sent
        // meanwhile was gone: a solo pressed then never reached the room.
        const roomOf = (you, seq, me = {}) => ({ t: 'welcome', v: 1, you, resume: `z${seq}`, now: 0, room: { id: 'r1', policy: {}, members: [{ id: you, ready: true, solo: false, ...me }], state: { seq } } });
        const w = wsLink({ url: 'ws://h:1' });
        w.link.send({ t: 'create', v: 1, name: 'Ana' });
        w.last().accept();
        w.last().say({ t: 'created', room: 'r1', secret: 'k' });
        w.last().say(roomOf('m1', 3));
        const intent = { t: 'intent', id: 7, base: 3, op: 'pause', pos: 20 };
        for (const msg of [{ t: 'solo', solo: true }, intent, { t: 'chat', text: 'still there?' }, { t: 'ready', ready: false, why: 'buffering' }]) w.link.send(msg);
        eq(w.last().sent.length, 5, 'sent, into a socket nobody knows is dead');
        w.last().die();
        await tick();
        w.last().accept();
        w.last().say(roomOf('m1', 3));
        eq(w.last().sent.slice(1), [{ t: 'ready', ready: false, why: 'buffering' }, { t: 'solo', solo: true }, intent], 'what the room is missing');
        w.last().say({ t: 'members', list: [] });
        eq(w.last().sent.slice(4), [{ t: 'chat', text: 'still there?' }], 'the line, once the history is in');
        w.transport.close();
    });
    await checkAsync('what did arrive is not said again, and a session saying it as well is one copy', async () => {
        const roomOf = (you, seq, me = {}) => ({ t: 'welcome', v: 1, you, resume: `z${seq}`, now: 0, room: { id: 'r1', policy: {}, members: [{ id: you, ready: true, solo: false, ...me }], state: { seq } } });
        const sockets = fakeSockets();
        const transport = PartyWs.createTransport({ WebSocket: sockets.Fake, random: () => 0, url: 'ws://h:1' });
        // The session says solo again as it hears it is a new member.
        const link = transport.open((msg) => { if (msg.t === 'welcome' && msg.you === 'm2') link.send({ t: 'solo', solo: true }); });
        const last = () => sockets.last();
        link.send({ t: 'create', v: 1, name: 'Ana' });
        last().accept();
        last().say({ t: 'created', room: 'r1', secret: 'k' });
        last().say(roomOf('m1', 3));
        link.send({ t: 'solo', solo: true });
        link.send({ t: 'intent', id: 7, base: 3, op: 'pause', pos: 20 });
        link.send({ t: 'chat', text: 'heard' });
        link.send({ t: 'chat', text: 'echo lost' });
        last().say({ t: 'state', seq: 4, ack: { member: 'm1', id: 7 } });
        last().say({ t: 'chat', id: 'c1', from: 'm1', text: 'heard' });
        last().die();
        await tick();
        last().accept();
        last().say(roomOf('m1', 4, { solo: true }));
        last().say({ t: 'chat', id: 'c2', from: 'm1', text: 'echo lost', past: true });
        last().say({ t: 'members', list: [] });
        eq(last().sent.slice(1), [], 'acknowledged, echoed, in the history, or already the room\'s');

        link.send({ t: 'intent', id: 8, base: 4, op: 'play', pos: 20 });
        last().die();
        await tick();
        last().accept();
        last().say({ t: 'error', code: 'expired' });
        last().accept();
        last().say(roomOf('m2', 6));
        eq(last().sent.slice(1), [{ t: 'solo', solo: true }], 'an intent the room has moved past is let go; solo once, though the session said it too');
        transport.close();
    });
    await checkAsync('past the grace it joins again as someone new instead of ending the party', async () => {
        const w = wsLink({ url: 'ws://h:1' });
        w.link.send({ t: 'create', v: 1, name: 'Ana' });
        w.last().accept();
        w.last().say({ t: 'created', room: 'r1', secret: 'k' });
        w.last().say(wsWelcome('m1', 'z1'));
        w.last().die();
        await tick();
        w.last().accept();
        w.last().say({ t: 'error', code: 'expired' });
        eq(w.all.length, 3);
        w.last().accept();
        eq(w.last().sent, [{ t: 'hello', v: 1, room: 'r1', secret: 'k', name: 'Ana' }]);
        eq(w.heard.map((msg) => msg.t), ['welcome', 'link'], 'the expiry is not the session\'s business');
        w.transport.close();
    });
    await checkAsync('an address that never answered, or a refusal, ends it without a retry', async () => {
        for (const refused of [false, true]) {
            const w = wsLink({ url: 'ws://h:1' });
            w.link.send({ t: 'create', v: 1, name: 'Ana' });
            if (refused) {
                w.last().accept();
                w.last().say({ t: 'error', code: 'bad-secret' });
            } else {
                w.last().die();
            }
            await tick();
            eq([w.heard, w.all.length], [[{ t: 'error', code: refused ? 'bad-secret' : 'unreachable' }], 1]);
        }
    });
    await checkAsync('a session on a server waits for the welcome, and offers the invite', async () => {
        const sockets = fakeSockets();
        const server = (options) => PartyWs.createTransport({ ...options, WebSocket: sockets.Fake });
        const session = PartySession.createSession({ transports: { server }, now: () => 1000 });
        eq(await session.control({ op: 'start', mode: 'server', url: 'nonsense' }), { ok: false, error: 'address' });
        const starting = session.control({ op: 'start', mode: 'server', url: 'ws://h:1', name: 'Ana' });
        sockets.last().accept();
        sockets.last().say({ t: 'created', room: 'r1', secret: 'k' });
        sockets.last().say(wsWelcome('m1', 'z1'));
        const started = await starting;
        eq([started.ok, started.status.you, started.status.up], [true, 'm1', true]);
        eq(PartyWs.readInvite(started.status.invite).room, 'r1');
        sockets.last().die();
        eq(session.status().up, false, 'reconnecting');
        await session.control({ op: 'leave' });
    });

    // ------------------------------------------------------ party codes

    section('party codes — a peer connection in a chat message');
    const PartyCode = require('../src/shared/party-code.js');

    /**
     * Chrome 154's own offer for a negotiated data channel, gathered against
     * two STUN servers. The public address and the ICE credentials are
     * replaced with stand-ins of the same shape; the rest is as Chrome wrote it.
     */
    const CHROME_OFFER = [
        'v=0', 'o=- 2274914143508482837 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
        'm=application 55253 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 203.0.113.7',
        'a=candidate:3725240560 1 udp 2113937151 5b8d7825-a86d-4a3e-a5cb-aabdf9f47caf.local 55253 typ host generation 0 network-cost 999',
        'a=candidate:2790751920 1 udp 1677729535 203.0.113.7 55253 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
        'a=candidate:1 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active generation 0',
        'a=ice-ufrag:q9Zr', 'a=ice-pwd:hT3k+vJ9sLx/0bWq2Fe7yRnA', 'a=ice-options:trickle',
        'a=fingerprint:sha-256 F4:67:98:82:5B:D5:65:2C:A6:D9:49:17:C8:B8:7C:97:66:64:0E:FF:E0:17:7C:82:8B:34:F0:80:D0:B4:1D:81',
        'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '',
    ].join('\r\n');
    const inviteFields = (desc = PartyCode.parseSdp(CHROME_OFFER)) => ({
        tag: Uint8Array.from([1, 2, 3, 4]), desc, room: Uint8Array.from([9, 9, 9, 9, 9, 9]), secret: new Uint8Array(16).fill(7),
        expires: 4102444800789,
    });

    check('a chrome offer comes down to credentials, a fingerprint and its udp addresses', () => {
        const desc = PartyCode.parseSdp(CHROME_OFFER);
        eq([desc.ufrag, desc.pwd, desc.mid, desc.fingerprint.length, desc.fingerprint[0]], ['q9Zr', 'hT3k+vJ9sLx/0bWq2Fe7yRnA', '0', 32, 0xf4]);
        eq(desc.candidates, [
            { type: 'host', address: '5b8d7825-a86d-4a3e-a5cb-aabdf9f47caf.local', port: 55253 },
            { type: 'srflx', address: '203.0.113.7', port: 55253 },
        ], 'tcp dropped');
        eq(PartyCode.parseSdp('v=0\r\na=ice-ufrag:abcd\r\n'), null);
    });
    check('an invite round-trips in under 200 characters, and a reply is not an invite', () => {
        const code = PartyCode.inviteCode(inviteFields());
        assert(code.startsWith('bbp1i.') && code.length < 200 && /^[A-Za-z0-9._-]+$/.test(code), `${code.length}: ${code}`);
        const back = PartyCode.readInvite(` ${code}\n`);
        const { mid, ...carried } = PartyCode.parseSdp(CHROME_OFFER);
        eq([back.desc, [...back.tag], [...back.secret]], [carried, [1, 2, 3, 4], new Array(16).fill(7)], 'all but the mid, which an answer takes from its offer');
        eq(back.expires, 4102444800000, 'the expiry, to the second, past the 32-bit sign bit');
        eq([PartyCode.readInvite(code.slice(0, -3)), PartyCode.readInvite(code.replace('bbp1i.', 'bbp1r.')), PartyCode.readInvite('bbp1i.!!')], [null, null, null]);
    });
    check('ipv6 and odd-length credentials survive the packing', () => {
        const desc = {
            ufrag: 'Ab+/9', pwd: 'x'.repeat(22) + '/+/', fingerprint: new Array(32).fill(0xab),
            candidates: [{ type: 'host', address: '2001:db8::7', port: 1 }, { type: 'relay', address: 'fe80::1:2', port: 65535 }],
        };
        const back = PartyCode.readInvite(PartyCode.inviteCode(inviteFields(desc))).desc;
        eq([back.ufrag, back.pwd], [desc.ufrag, desc.pwd]);
        eq(back.candidates.map((c) => [c.type, c.address, c.port]), [['host', '2001:db8:0:0:0:0:0:7', 1], ['relay', 'fe80:0:0:0:0:0:1:2', 65535]]);
    });
    check('the rebuilt description is sdp that parses back to the same description', () => {
        const desc = PartyCode.parseSdp(CHROME_OFFER);
        for (const type of ['offer', 'answer']) {
            const sdp = PartyCode.buildSdp(desc, { type, mid: '0' });
            assert(sdp.includes(`a=setup:${type === 'offer' ? 'actpass' : 'active'}\r\n`) && sdp.endsWith('\r\n'), sdp);
            eq(PartyCode.parseSdp(sdp), desc);
        }
        const lines = PartyCode.buildSdp(desc, { type: 'offer' }).split('\r\n').filter((line) => line.startsWith('a=candidate'));
        eq(lines[1], 'a=candidate:2 1 udp 1694498559 203.0.113.7 55253 typ srflx raddr 0.0.0.0 rport 0');
    });
    await checkAsync('a reply is signed with the invite\'s secret, and a changed byte or another secret fails it', async () => {
        const { tag, desc, secret } = inviteFields();
        const code = await PartyCode.replyCode({ tag, desc }, secret);
        assert(code.startsWith('bbp1r.') && code.length < 160, code);
        const reply = PartyCode.readReply(code);
        eq([[...reply.tag], reply.desc.candidates.length], [[1, 2, 3, 4], 2]);
        assert(await PartyCode.verifyReply(reply, secret));
        assert(!(await PartyCode.verifyReply(reply, new Uint8Array(16))), 'another secret');
        const bytes = PartyCode.fromBase64Url(code.slice(6));
        bytes[12] ^= 1;
        assert(!(await PartyCode.verifyReply(PartyCode.readReply('bbp1r.' + PartyCode.toBase64Url(bytes)), secret)), 'tampered');
    });
    check('bytes compare equal only when every one matches, and a missing side is a no', () => {
        const same = PartyCode.sameBytes;
        eq([same(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3)), same(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4)),
            same(Uint8Array.of(9, 2, 3), Uint8Array.of(1, 2, 3)), same(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3)),
            same(new Uint8Array(0), new Uint8Array(0)), same(undefined, Uint8Array.of(1))], [true, false, false, false, true, false]);
    });
    check('a code says in words which addresses it gives away', () => {
        eq(PartyCode.describe({ candidates: [
            { type: 'host', address: '5b8d7825-a86d-4a3e-a5cb-aabdf9f47caf.local', port: 1 },
            { type: 'host', address: '192.168.1.5', port: 2 }, { type: 'srflx', address: '203.0.113.5', port: 54012 },
            { type: 'relay', address: '2001:db8:0:0:0:0:0:1', port: 3478 },
        ] }), ['this computer on your network (address hidden)', 'local network 192.168.1.5:2', 'public 203.0.113.5:54012', 'relay [2001:db8:0:0:0:0:0:1]:3478']);
    });

    // ------------------------------------------------------- party webrtc

    section('party webrtc — invites, replies, and the channel bound to them');
    const PartyRtc = require('../src/offscreen/party-rtc.js');

    /**
     * Peer connections that connect only when two of them hold each other's
     * descriptions — matched by DTLS fingerprint, as the real handshake is —
     * and whose negotiated channels then open in pairs by id.
     */
    function fakeRtc() {
        const all = [];
        const later = (fn) => setTimeout(fn, 1);
        const fpOf = (description) => PartyCode.parseSdp(description.sdp).fingerprint.join();
        class Channel {
            constructor(pc, options) { Object.assign(this, { pc, id: options.id, readyState: 'connecting', sent: [] }); }
            send(data) {
                if (this.readyState !== 'open') throw new Error('not open');
                this.sent.push(JSON.parse(data));
                const other = this.pc.other.channels.find((c) => c.id === this.id);
                later(() => other.readyState === 'open' && other.onmessage && other.onmessage({ data }));
            }
        }
        class RTC extends EventTarget {
            constructor(config) {
                super();
                Object.assign(this, { config, fp: new Array(32).fill(all.length + 1), channels: [], added: [], iceGatheringState: 'new', connectionState: 'new' });
                all.push(this);
            }
            async addIceCandidate(candidate) { this.added.push(candidate); }
            createDataChannel(label, options) {
                const channel = new Channel(this, options);
                this.channels.push(channel);
                return channel;
            }
            async setLocalDescription() {
                // An answer if a remote offer is waiting for one; otherwise an offer, as after restartIce().
                const type = this.owed ? 'answer' : 'offer';
                this.owed = false;
                const n = this.fp[0];
                const desc = { ufrag: `u${n}x${this.restarts || 0}`, pwd: 'p'.repeat(22) + n, fingerprint: this.fp, candidates: [{ type: 'host', address: '127.0.0.1', port: 5000 + n }] };
                this.localDescription = { type, sdp: PartyCode.buildSdp(desc, { type }) };
                later(() => {
                    this.iceGatheringState = 'complete';
                    this.dispatchEvent(new Event('icegatheringstatechange'));
                });
                this.meet();
            }
            async setRemoteDescription(description) {
                this.remoteDescription = description;
                this.owed = description.type === 'offer';
                this.meet();
            }
            restartIce() { this.restarts = (this.restarts || 0) + 1; }
            /** A connection that has lost its path for now, as Chrome reports one before consent freshness gives up. */
            stall() {
                this.connectionState = 'disconnected';
                this.dispatchEvent(new Event('connectionstatechange'));
            }
            meet() {
                if (!this.localDescription || !this.remoteDescription) return;
                // Renegotiated (an ICE restart) on a connection already made:
                // the path comes back, and the channels never went.
                if (this.other) {
                    if (this.localDescription.type !== 'answer' && this.remoteDescription.type !== 'answer') return;
                    for (const pc of [this, this.other]) {
                        later(() => {
                            pc.connectionState = 'connected';
                            pc.dispatchEvent(new Event('connectionstatechange'));
                        });
                    }
                    return;
                }
                const other = all.find((pc) => pc !== this && pc.fp.join() === fpOf(this.remoteDescription));
                if (!other || !other.localDescription || !other.remoteDescription || fpOf(other.remoteDescription) !== this.fp.join()) return;
                [this.other, other.other] = [other, this];
                for (const pc of [this, other]) later(() => pc.state('connected', 'open'));
            }
            state(connection, channels) {
                this.connectionState = connection;
                for (const c of this.channels) {
                    c.readyState = channels;
                    const fn = channels === 'open' ? c.onopen : c.onclose;
                    if (fn) fn();
                }
                this.dispatchEvent(new Event('connectionstatechange'));
            }
            close() {
                if (this.connectionState === 'closed') return;
                this.state('closed', 'closed');
                if (this.other) later(() => this.other.state('failed', 'closed'));
            }
        }
        return { RTC, all };
    }
    /** A host's invite, a guest's reply to it, and the host applying the reply. */
    async function rtcPair(options = {}) {
        const { RTC, all } = fakeRtc();
        const invite = await PartyRtc.createInvite({ room: new Uint8Array(6), RTC, gatherMs: 50, ...options });
        const guest = await PartyRtc.acceptInvite(invite.code, { RTC, gatherMs: 50 });
        return { RTC, all, invite, guest, host: invite.answer(PartyCode.readReply(guest.reply)) };
    }

    await checkAsync('an invite answered by its reply opens a bound channel both ways', async () => {
        const { invite, guest, host, all } = await rtcPair({ iceServers: [{ urls: 'stun:x' }] });
        eq(all[0].config, { iceServers: [{ urls: 'stun:x' }] });
        assert(invite.code.startsWith('bbp1i.') && guest.reply.startsWith('bbp1r.'));
        const [hostPeer, guestPeer] = await Promise.all([host, guest.bound]);
        assert(hostPeer && guestPeer, 'both bound');
        eq(all[0].channels.map((c) => c.sent.map((msg) => msg.t)), [['bind', 'proof'], []], 'binding is on ctl alone');
        eq(await invite.answer(PartyCode.readReply(guest.reply)), null, 'an invite opens one connection');
    });
    await checkAsync('a link sends pings on tick and the rest on ctl, and hears what arrived while it was being made', async () => {
        const { host, guest } = await rtcPair();
        const [hostPeer, guestPeer] = await Promise.all([host, guest.bound]);
        const heard = [];
        const guestLink = PartyRtc.peerLink(guestPeer, { deliver: () => {} });
        guestLink.send({ t: 'hello', v: 1, name: 'Ben' });
        guestLink.send({ t: 'ping', c: 1, seq: 0 });
        guestLink.send({ t: 'intent', pad: 'x'.repeat(PartyRtc.MAX_FRAME) });
        await tick();
        PartyRtc.peerLink(hostPeer, { deliver: (msg) => heard.push(msg.t) });
        await tick();
        eq(heard, ['hello', 'ping'], 'the oversized frame never went');
        eq([guestPeer.ctl.sent.map((msg) => msg.t).slice(2), guestPeer.tick.sent.map((msg) => msg.t)], [['hello'], ['ping']]);
    });
    await checkAsync('what came before the link is heard once whoever made it holds it', async () => {
        // A hello waiting from before was heard inside peerLink, and the room's
        // welcome went back through a link the host had not been handed yet.
        const { host, guest } = await rtcPair();
        const [hostPeer, guestPeer] = await Promise.all([host, guest.bound]);
        PartyRtc.peerLink(guestPeer, { deliver: () => {} }).send({ t: 'hello', v: 1 });
        await tick();
        const heard = [];
        let link = null;
        link = PartyRtc.peerLink(hostPeer, { deliver: (msg) => heard.push(link ? msg.t : 'too soon') });
        await tick();
        eq(heard, ['hello']);
    });
    await checkAsync('a reply to another invite, or one signed with another secret, is not answered', async () => {
        const { RTC } = fakeRtc();
        const room = new Uint8Array(6);
        const [one, two] = [await PartyRtc.createInvite({ room, RTC, gatherMs: 50 }), await PartyRtc.createInvite({ room, RTC, gatherMs: 50 })];
        const guest = await PartyRtc.acceptInvite(one.code, { RTC, gatherMs: 50 });
        const reply = PartyCode.readReply(guest.reply);
        eq([two.fits(reply), one.fits(reply)], [false, true]);
        eq(await two.answer(reply), null);
        const forged = PartyCode.readReply(await PartyCode.replyCode({ tag: reply.tag, desc: reply.desc }, new Uint8Array(16)));
        eq(await one.answer(forged), null);
        eq(await PartyRtc.acceptInvite('bbp1r.nope', { RTC }), null);
    });
    await checkAsync('an invite past its expiry is refused before anything is gathered, with a minute for clock skew', async () => {
        const { RTC } = fakeRtc();
        const invite = await PartyRtc.createInvite({ room: new Uint8Array(6), RTC, gatherMs: 50, now: () => 1000000 });
        const at = (ms) => PartyRtc.acceptInvite(invite.code, { RTC, gatherMs: 50, now: () => ms });
        const late = await at(invite.expires + PartyRtc.SKEW_MS - 500);
        assert(late && late.reply && late.expires === invite.expires, 'inside the slack');
        late.close();
        eq(await at(invite.expires + PartyRtc.SKEW_MS + 500), { expired: true });
    });
    await checkAsync('the channel is only bound when both ends hold the same secret', async () => {
        const { RTC } = fakeRtc();
        const [a, b] = [PartyRtc.openPeer({ RTC }), PartyRtc.openPeer({ RTC })];
        await a.pc.setLocalDescription();
        await b.pc.setRemoteDescription(a.pc.localDescription);
        await b.pc.setLocalDescription();
        await a.pc.setRemoteDescription(b.pc.localDescription);
        const fps = { hostFp: a.pc.fp, guestFp: b.pc.fp, timeoutMs: 500 };
        eq(await Promise.all([
            PartyRtc.bind(a, { ...fps, secret: new Uint8Array(16).fill(1) }),
            PartyRtc.bind(b, { ...fps, secret: new Uint8Array(16).fill(2) }),
        ]), [false, false]);
    });
    await checkAsync('a guest that speaks while the host is still checking its proof is bound, and heard', async () => {
        // The host took the hello for a failed bind and dropped the guest:
        // about one run in twelve, wherever a timer tick handed it both at once.
        const { RTC } = fakeRtc();
        const [a, b] = [PartyRtc.openPeer({ RTC }), PartyRtc.openPeer({ RTC })];
        await a.pc.setLocalDescription();
        await b.pc.setRemoteDescription(a.pc.localDescription);
        await b.pc.setLocalDescription();
        await a.pc.setRemoteDescription(b.pc.localDescription);
        const options = { hostFp: a.pc.fp, guestFp: b.pc.fp, timeoutMs: 500, secret: new Uint8Array(16).fill(3) };
        // Hold the guest's proof back, to hand it over with the guest's first word.
        let held = null;
        const send = b.ctl.send.bind(b.ctl);
        b.ctl.send = (data) => { if (JSON.parse(data).t === 'proof') held = data; else send(data); };
        const host = PartyRtc.bind(a, options);
        eq(await PartyRtc.bind(b, options), true, 'the guest is bound');
        assert(held, 'the guest was bound before its proof went');
        a.ctl.onmessage({ data: held });
        a.ctl.onmessage({ data: JSON.stringify({ t: 'hello', v: 1 }) });
        eq(await host, true, 'the host is bound');
        eq(a.early.map((event) => JSON.parse(event.data).t), ['hello']);
        a.pc.close();
    });
    /** A host's offer the guest has answered, the answer not yet back with the host. */
    async function halfMet() {
        const { RTC } = fakeRtc();
        const [a, b] = [PartyRtc.openPeer({ RTC }), PartyRtc.openPeer({ RTC })];
        await a.pc.setLocalDescription();
        await b.pc.setRemoteDescription(a.pc.localDescription);
        await b.pc.setLocalDescription();
        const options = { hostFp: a.pc.fp, guestFp: b.pc.fp, timeoutMs: 2000, retryMs: 5, secret: new Uint8Array(16).fill(4) };
        return { a, b, options, remote: PartyCode.parseSdp(a.pc.localDescription.sdp) };
    }
    await checkAsync('a guest whose connection fails before the host has the reply keeps offering the host\'s addresses', async () => {
        // Chrome stops checking about 12 s after the guest makes its reply.
        // The guest took that for the end, so a host who pasted the reply any
        // later never connected across two routers.
        const { a, b, options, remote } = await halfMet();
        const guest = PartyRtc.bind(b, { ...options, remote });
        b.pc.state('failed', 'connecting');
        await until(() => b.pc.added.length === 1, 'the host\'s address offered again');
        b.pc.state('failed', 'connecting');
        await until(() => b.pc.added.length === 2, 'and again after the next failure');
        eq(b.pc.added.map((one) => [one.candidate.split(' ')[0], one.candidate.split(' ')[4]]), [['candidate:9', '127.0.0.1'], ['candidate:17', '127.0.0.1']],
            'a new foundation each time, or Chrome ignores it');
        await a.pc.setRemoteDescription(b.pc.localDescription);
        eq(await Promise.all([PartyRtc.bind(a, options), guest]), [true, true]);
    });
    await checkAsync('a connection that came up and then failed still ends the bind', async () => {
        const { a, b, options, remote } = await halfMet();
        const guest = PartyRtc.bind(b, { ...options, remote });
        await a.pc.setRemoteDescription(b.pc.localDescription);
        await until(() => b.pc.connectionState === 'connected', 'connected');
        a.pc.close();
        eq(await guest, false);
        eq(b.pc.added, []);
    });
    check('the ice settings become ice servers, with a turn server\'s credentials taken out of its url', () => {
        eq(PartyRtc.iceServers({ stun: ' stun:a.example:19302  stun:b.example ', turn: 'turn:ana:s3cr:et@relay.example:3478?transport=udp turns:relay.example:5349 http://x' }), [
            { urls: ['stun:a.example:19302', 'stun:b.example'] },
            { urls: 'turn:relay.example:3478?transport=udp', username: 'ana', credential: 's3cr:et' },
            { urls: 'turns:relay.example:5349' },
        ]);
        eq(PartyRtc.iceServers({ stun: 'nonsense', turn: '' }), []);
    });
    check('two stun servers seeing two ports on one address is a symmetric nat', () => {
        const two = [{ urls: ['stun:a', 'stun:b'] }];
        const nat = (candidates, servers = two) => PartyRtc.natOf({ candidates }, servers);
        const host = { type: 'host', address: '5b8d7825-a86d-4a3e-a5cb-aabdf9f47caf.local', port: 1 };
        const srflx = (port, address = '203.0.113.7') => ({ type: 'srflx', address, port });
        eq(nat([host, srflx(5000)]), 'consistent');
        eq(nat([host, srflx(5000), srflx(5001)]), 'symmetric');
        eq(nat([host, srflx(5000), srflx(6000, '2001:db8:0:0:0:0:0:1')]), 'consistent', 'an ipv4 and an ipv6 mapping');
        eq([nat([host]), nat([host], [])], ['blocked', 'unknown'], 'nobody answered; nobody was asked');
        eq(nat([srflx(5000)], [{ urls: 'stun:a' }]), 'unknown', 'one server has nothing to compare with');
    });
    await checkAsync('a link hears once that its peer has gone', async () => {
        const { host, guest } = await rtcPair();
        const [hostPeer, guestPeer] = await Promise.all([host, guest.bound]);
        let downs = 0;
        PartyRtc.peerLink(hostPeer, { deliver: () => {}, onDown: () => downs++ });
        PartyRtc.peerLink(guestPeer, { deliver: () => {} }).close();
        await tick();
        eq([downs, hostPeer.pc.connectionState], [1, 'failed']);
    });

    // --------------------------------------------------- party p2p host

    section('party p2p host — the room in this browser, guests on data channels');
    const PartyHost = require('../src/offscreen/party-host.js');

    /** A guest as the host sees one: its own end of an invite, speaking the wire protocol on it. */
    async function rawGuest(code, RTC) {
        const guest = await PartyRtc.acceptInvite(code, { RTC, gatherMs: 50 });
        const heard = [];
        const bound = guest.bound.then((peer) => peer && PartyRtc.peerLink(peer, { deliver: (msg) => heard.push(msg) }));
        return { reply: guest.reply, bound, heard, last: (t) => heard.filter((msg) => msg.t === t).pop() };
    }

    await checkAsync('a guest answering the host\'s invite joins the room the host is in', async () => {
        const { RTC } = fakeRtc();
        const session = PartySession.createSession({ transports: { codes: (o) => PartyHost.createHost({ ...o, RTC, gatherMs: 50 }) }, now: () => Date.now() });
        const started = await session.control({ op: 'start', mode: 'codes', name: 'Ana' });
        eq([started.ok, started.status.invites], [true, []]);
        const { invite } = await session.control({ op: 'invite' });
        assert(invite.code.startsWith('bbp1i.') && invite.expires > Date.now(), invite.code);
        eq(invite.addresses, ['local network 127.0.0.1:5001']);
        eq([invite.nat, session.status().nat], ['blocked', 'blocked'], 'two stun servers asked, and neither answered the fake');
        eq(session.status().invites.map((one) => one.code), [invite.code]);

        const ben = await rawGuest(invite.code, RTC);
        eq(await session.control({ op: 'accept', code: ben.reply }), { ok: true });
        eq(session.status().invites, [], 'used up');
        const link = await ben.bound;
        link.send({ t: 'hello', v: 1, name: 'Ben' });
        await until(() => ben.last('welcome'), 'Ben\'s welcome');
        eq(ben.last('welcome').room.members.map((m) => [m.name, m.role]), [['Ana', 'host'], ['Ben', 'guest']]);
        link.send({ t: 'intent', id: 1, base: 0, op: 'play', pos: 2, at: Date.now() });
        await until(() => session.status().state.paused === false, 'Ben\'s play to reach Ana');
        await session.control({ op: 'leave' });
        await until(() => link.state() === 'failed', 'Ben to hear the host go');
    });
    await checkAsync('an invite taken back gives its ports back, and cannot be taken back twice', async () => {
        const { RTC } = fakeRtc();
        const session = PartySession.createSession({ transports: { codes: (o) => PartyHost.createHost({ ...o, RTC, gatherMs: 50 }) }, now: () => Date.now() });
        await session.control({ op: 'start', mode: 'codes', name: 'Ana' });
        const [{ invite: one }, { invite: two }] = [await session.control({ op: 'invite' }), await session.control({ op: 'invite' })];
        eq(await session.control({ op: 'revoke', code: one.code }), { ok: true });
        eq(await session.control({ op: 'revoke', code: one.code }), { ok: false });
        eq(session.status().invites.map((invite) => invite.code), [two.code]);
        await session.control({ op: 'leave' });
    });
    await checkAsync('the host turns away what is not a reply to one of its open invites', async () => {
        const { RTC } = fakeRtc();
        const host = PartyHost.createHost({ RTC, gatherMs: 50 });
        const other = PartyHost.createHost({ RTC, gatherMs: 50 });
        const theirs = await rawGuest((await other.createInvite()).code, RTC);
        eq(await host.accept('bbp1i.abc'), { ok: false, error: 'code' });
        eq(await host.accept(theirs.reply), { ok: false, error: 'unknown' });
        host.close();
        other.close();
    });
    await checkAsync('two sessions meet through an invite and its reply, and the guest\'s ends with the host\'s', async () => {
        const { RTC } = fakeRtc();
        const ended = [];
        const transports = { codes: (o) => PartyHost.createTransport({ ...o, RTC, gatherMs: 50 }) };
        const ana = PartySession.createSession({ transports });
        const ben = PartySession.createSession({ transports, onEnd: (code) => ended.push(code) });
        await ana.control({ op: 'start', mode: 'codes', name: 'Ana' });
        const { invite } = await ana.control({ op: 'invite' });

        const waiting = await ben.control({ op: 'start', mode: 'codes', code: invite.code, name: 'Ben' });
        eq([waiting.ok, waiting.status.you, waiting.status.up], [true, null, false], 'back with the reply, not the welcome');
        assert(waiting.status.invite.startsWith('bbp1r.'), waiting.status.invite);
        eq(waiting.status.expires, Math.floor(invite.expires / 1000) * 1000, 'the reply is good for as long as the invite is held open');
        const tab = tabPort();
        ben.connect(tab);
        tab.say({ t: 'ping', c: 1, seq: 0 });
        eq(tab.heard, [], 'no pong made up before there is a room clock to make it from');

        eq(await ana.control({ op: 'accept', code: waiting.status.invite }), { ok: true });
        await until(() => ben.status().up && ben.status().rtt !== null, 'Ben to be welcomed and timed');
        eq(ben.status().members.map((m) => [m.name, m.role]), [['Ana', 'host'], ['Ben', 'guest']]);
        eq(tab.last('welcome').you, ben.status().you, 'the tab bound while waiting hears the welcome');
        tab.say({ t: 'intent', id: 1, base: 0, op: 'play', pos: 7, at: Date.now() });
        await until(() => ana.status().state.paused === false, 'Ben\'s play to reach Ana');

        await ana.control({ op: 'leave' });
        await until(() => !ben.status().active, 'Ben\'s party to end');
        eq([ended, tab.last('error')], [['host-left'], { t: 'error', code: 'host-left' }]);
    });
    await checkAsync('an invite that cannot be read ends the guest\'s start at once', async () => {
        const { RTC } = fakeRtc();
        const guest = (code) => PartySession.createSession({ transports: { codes: (o) => PartyHost.createTransport({ ...o, code, RTC, gatherMs: 50 }) } })
            .control({ op: 'start', mode: 'codes', code });
        eq(await guest('bbp1i.nope'), { ok: false, error: 'address' });
    });
    await checkAsync('an invite nobody answers gives its ports back', async () => {
        const { RTC, all } = fakeRtc();
        const host = PartyHost.createHost({ RTC, gatherMs: 50, inviteMs: 20 });
        await host.createInvite();
        eq(host.pending().length, 1);
        await until(() => host.pending().length === 0, 'the invite to lapse');
        eq(all[0].connectionState, 'closed');
        host.close();
    });

    // ---------------------------------------------------- party tracker

    section('party tracker — meeting through a webtorrent tracker, sealed');
    const PartyTracker = require('../src/offscreen/party-tracker.js');

    /**
     * A WebTorrent tracker in memory, doing what the real ones do with a
     * swarm: offers handed one each to other peers on the same hash, answers
     * handed to `to_peer_id`, and `stopped` leaving. `seen` keeps every frame
     * it was sent, to check what a tracker gets to read. A socket in
     * `blocked` is one whose browser has lost its network: nothing it says
     * arrives, and nothing is handed to it.
     */
    function fakeTracker({ down = false } = {}) {
        const swarms = new Map();
        const seen = [];
        const blocked = new Set();
        class Socket {
            constructor(url) {
                Object.assign(this, { url, readyState: 0 });
                setTimeout(() => {
                    if (down) return this.onclose && this.onclose();
                    this.readyState = 1;
                    if (this.onopen) this.onopen();
                }, 1);
            }
            send(text) {
                if (blocked.has(this)) return;
                const msg = JSON.parse(text);
                seen.push(msg);
                const swarm = swarms.get(msg.info_hash) || new Map();
                swarms.set(msg.info_hash, swarm);
                const tell = (socket, out) => setTimeout(() => !blocked.has(socket) && socket.onmessage && socket.onmessage({ data: JSON.stringify({ action: 'announce', info_hash: msg.info_hash, ...out }) }), 1);
                if (msg.answer) {
                    const to = swarm.get(msg.to_peer_id);
                    if (to) tell(to, { peer_id: msg.peer_id, offer_id: msg.offer_id, answer: msg.answer });
                    return;
                }
                if (msg.event === 'stopped') return swarm.delete(msg.peer_id);
                swarm.set(msg.peer_id, this);
                tell(this, { interval: 120, complete: 0, incomplete: swarm.size });
                const others = [...swarm.entries()].filter(([id, socket]) => id !== msg.peer_id && !blocked.has(socket));
                (msg.offers || []).forEach((one, i) => {
                    if (others[i]) tell(others[i][1], { peer_id: msg.peer_id, offer_id: one.offer_id, offer: one.offer });
                });
            }
            close() { this.readyState = 3; }
        }
        return { Socket, seen, swarms, blocked };
    }

    await checkAsync('a tracker code is the secret, and the swarm and key come from it alone', async () => {
        const { code, secret } = PartyTracker.newCode();
        assert(code.startsWith('bbp1t.') && code.length === 28, code);
        eq([...PartyTracker.readCode(` ${code} `)], [...secret]);
        eq([PartyTracker.readCode('bbp1t.abc'), PartyTracker.readCode('bbp1i.' + code.slice(6))], [null, null]);
        const [one, again, other] = await Promise.all([secret, secret, PartyTracker.newCode().secret].map(PartyTracker.keysFor));
        eq([one.topic.length, one.topic === again.topic, one.topic === other.topic], [20, true, false]);
        const sealed = await PartyTracker.seal(one.key, Uint8Array.from([1, 2, 3]));
        eq([...(await PartyTracker.unseal(again.key, sealed))], [1, 2, 3]);
        eq([await PartyTracker.unseal(other.key, sealed), await PartyTracker.unseal(one.key, 'short')], [null, null], 'a stranger\'s blob');
        eq(PartyTracker.trackerUrls(' wss://a.example  http://b ws://c:8000 '), ['wss://a.example', 'ws://c:8000']);
        eq(PartyTracker.trackerUrls(''), [...PartyTracker.DEFAULT_TRACKERS]);
    });
    await checkAsync('two sessions meet through a tracker, which reads nothing of what they said', async () => {
        const { RTC } = fakeRtc();
        const tracker = fakeTracker();
        const transports = { tracker: (o) => PartyTracker.createTransport({ ...o, RTC, gatherMs: 50, WebSocket: tracker.Socket }) };
        const ana = PartySession.createSession({ transports });
        const ben = PartySession.createSession({ transports });
        try {
            const started = await ana.control({ op: 'start', mode: 'tracker', name: 'Ana', trackers: 'wss://t1 wss://t2' });
            const code = started.status.invite;
            await until(() => ana.status().trackers === 2, 'both trackers to answer the host');
            const joined = await ben.control({ op: 'start', mode: 'tracker', code, name: 'Ben', trackers: 'wss://t1 wss://t2' });
            eq([joined.ok, joined.status.members.map((m) => [m.name, m.role])], [true, [['Ana', 'host'], ['Ben', 'guest']]]);
            await until(() => [...tracker.swarms.values()].every((swarm) => swarm.size === 1), 'Ben to leave the swarm');

            const said = JSON.stringify(tracker.seen);
            assert(!said.includes(code.slice(6)) && !said.includes('a=fingerprint') && !said.includes('127.0.0.1'), 'no secret, sdp or address');
            eq(tracker.seen.filter((msg) => msg.answer).length, 1, 'answered once though announced to two trackers');
        } finally {
            await ben.control({ op: 'leave' });
            await ana.control({ op: 'leave' });
        }
    });

    /** A tracker party on fakes, with its waits cut to milliseconds, and members to add to it. */
    async function trackerParty() {
        const { RTC, all } = fakeRtc();
        const tracker = fakeTracker();
        /** Whose browser each socket is, so one can be cut off from the tracker. */
        const owners = new Map();
        const knobs = { RTC, gatherMs: 20, joinMs: 400, renewMs: 40, stallMs: 30, probeMs: 100 };
        const sessions = [];
        const add = async (name, code, { now = () => Date.now() } = {}) => {
            class Socket extends tracker.Socket {
                constructor(url) {
                    super(url);
                    owners.set(this, name);
                }
            }
            const transports = { tracker: (o) => PartyTracker.createTransport({ ...o, ...knobs, WebSocket: Socket }) };
            const session = PartySession.createSession({ transports, now });
            sessions.push(session);
            const started = await session.control({ op: 'start', mode: 'tracker', name, code, trackers: 'wss://t' });
            assert(started.ok, `${name} started: ${started.error}`);
            return { session, code: started.status.invite };
        };
        /** That browser's way to the tracker goes, or comes back; its sockets stay open, as a dead path's do. */
        function offline(name, off = true) {
            for (const [socket, owner] of owners) {
                if (owner !== name) continue;
                if (off) tracker.blocked.add(socket);
                else tracker.blocked.delete(socket);
            }
        }
        const leave = () => Promise.all(sessions.map((one) => one.control({ op: 'leave' })));
        return { all, tracker, add, offline, leave };
    }
    const roles = (session) => session.status().members.map((m) => `${m.name}:${m.role}`);

    await checkAsync('a restart through the tracker is answered on the peer the host already has', async () => {
        const { RTC } = fakeRtc();
        const tracker = fakeTracker();
        const { secret } = PartyTracker.newCode();
        const net = { secret, urls: ['wss://t'], RTC, gatherMs: 20, WebSocket: tracker.Socket, renewMs: 40 };
        const admitted = [];
        const host = PartyTracker.hostSwarm({ ...net, admit: (peer) => admitted.push(peer) });
        try {
            await until(() => host.up() === 1, 'the host in the swarm');
            const joined = await PartyTracker.joinSwarm({ ...net, timeoutMs: 400 }).done;
            assert(joined.peer && joined.tag.length === 4, 'joined, with the tag a restart goes by');
            await until(() => admitted.length === 1, 'the host to admit the joiner');
            const ok = await PartyTracker.restartSwarm({ ...net, peer: joined.peer, tag: joined.tag, timeoutMs: 400 }).done;
            eq([ok, admitted.length, joined.peer.pc.restarts], [true, 1, 1], 'no second peer on the host');
            eq(tracker.seen.filter((msg) => msg.answer).length, 2, 'a restart sent as several offers is answered once');
            const other = await PartyTracker.restartSwarm({ ...net, secret: PartyTracker.newCode().secret, peer: joined.peer, tag: joined.tag, timeoutMs: 100 }).done;
            eq(other, false, 'nobody answers a restart sealed under another code');
        } finally {
            host.close();
        }
    });
    await checkAsync('a stalled connection is restarted through the tracker, and the member never leaves', async () => {
        const party = await trackerParty();
        try {
            const ana = await party.add('Ana');
            await until(() => ana.session.status().trackers === 1, 'the host in the swarm');
            const ben = await party.add('Ben', ana.code);
            const you = ben.session.status().you;
            const benPc = party.all.find((pc) => pc.connectionState === 'connected' && pc.localDescription.type === 'offer');
            const answers = () => party.tracker.seen.filter((msg) => msg.answer).length;
            eq(answers(), 1);
            benPc.stall();
            await until(() => answers() === 2 && benPc.connectionState === 'connected', 'the host to answer the restart');
            eq([benPc.restarts, ben.session.status().you, ben.session.status().up], [1, you, true], 'same peer, same member, never down');
            eq(roles(ana.session), ['Ana:host', 'Ben:guest']);
        } finally {
            await party.leave();
        }
    });
    await checkAsync('with the host gone the earliest joiner carries the room on, and the others find them', async () => {
        const party = await trackerParty();
        try {
            const ana = await party.add('Ana');
            await until(() => ana.session.status().trackers === 1, 'the host in the swarm');
            const ben = await party.add('Ben', ana.code);
            const cat = await party.add('Cat', ana.code);
            const tab = tabPort();
            ben.session.connect(tab);
            tab.say({ t: 'intent', id: 1, base: 0, op: 'play', pos: 30, at: Date.now() });
            tab.say({ t: 'chat', text: 'the cliffs!' });
            await until(() => cat.session.status().state.paused === false && roles(cat.session).length === 3 && tab.last('chat-line'), 'Ben\'s play to reach Cat');
            const said = tab.last('chat-line').line;
            const seq = cat.session.status().state.seq;
            const before = cat.session.status().you;

            // Ana's bye has the old room promote Ben on its way out, so the
            // roles alone read right before anyone has moved: wait for Ben
            // to be hosting and Cat to be welcomed into his room.
            await ana.session.control({ op: 'leave' });
            await until(() => ben.session.status().trackers !== undefined && cat.session.status().up && cat.session.status().you !== before,
                'Ben to host, and Cat to find him');
            eq([roles(ben.session), roles(cat.session)], [['Ben:host', 'Cat:guest'], ['Ben:host', 'Cat:guest']]);
            const state = cat.session.status().state;
            eq([state.paused, state.seq >= seq, state.pos >= 30], [false, true, true], 'still playing, from where it had got to');
            eq(ben.session.status().invite, ana.code, 'the same code finds the room');

            const dan = await party.add('Dan', ana.code);
            const danTab = tabPort();
            dan.session.connect(danTab);
            const heardBy = () => danTab.heard.flatMap((msg) => (msg.t === 'chat-log' ? msg.lines : msg.t === 'chat-line' ? [msg.line] : []));
            await until(() => heardBy().some((line) => line.text === 'the cliffs!'), 'Dan, joining after the handover, to see what was said before it');
            eq(heardBy().find((line) => !line.sys).id, said.id, 'under the id everyone else already has it by');
        } finally {
            await party.leave();
        }
    });
    const hosting = (session) => session.status().active && session.status().trackers !== undefined;
    const hostOf = (session) => (session.status().members.find((m) => m.role === 'host') || {}).name;
    const settle = async (test, what, ms = 6000) => {
        for (const end = Date.now() + ms; !test() && Date.now() < end;) await tick();
        assert(test(), `timed out waiting for ${what}`);
    };
    check('a later room beats an earlier one, and in one generation the lower token stays', () => {
        const a = PartyTracker.newClaim(0);
        const b = PartyTracker.newClaim(1);
        eq([PartyTracker.beats(b, a), PartyTracker.beats(a, b)], [true, false]);
        const [low, high] = [{ gen: 1, token: '0a' }, { gen: 1, token: 'f0' }];
        eq([PartyTracker.beats(low, high), PartyTracker.beats(high, low), PartyTracker.beats(low, low)], [true, false, false]);
        assert(/^[0-9a-f]{16}$/.test(a.token) && a.token !== PartyTracker.newClaim(0).token);
    });
    await checkAsync('REGRESSION: a host back to find its room carried on steps down and joins it, with whoever found it meanwhile', async () => {
        // A host whose network went long enough for the next in line to
        // carry the room on came back still hosting under the same code.
        // New joiners landed in either room, and neither host ever knew.
        const party = await trackerParty();
        try {
            const ana = await party.add('Ana');
            await until(() => ana.session.status().trackers === 1, 'the host in the swarm');
            const ben = await party.add('Ben', ana.code);
            const cat = await party.add('Cat', ana.code);
            const anas = party.all.filter((pc) => pc.connectionState === 'connected' && pc.localDescription.type === 'answer');
            party.offline('Ana');
            for (const pc of anas) {
                pc.state('failed', 'closed');
                pc.other.state('failed', 'closed');
            }
            await settle(() => hosting(ben.session) && hostOf(cat.session) === 'Ben' && cat.session.status().up, 'Ben to carry the room on');

            // Ana back while Ben cannot be reached: a newcomer finds her old room.
            party.offline('Ben');
            party.offline('Ana', false);
            const eve = await party.add('Eve', ana.code);
            eq([hostOf(eve.session), hosting(ana.session)], ['Ana', true], 'two rooms under one code');

            party.offline('Ben', false);
            await settle(() => !hosting(ana.session) && [ana, eve].every((one) => one.session.status().up && hostOf(one.session) === 'Ben'),
                'Ana to step down, and her room to follow her');
            eq(roles(ben.session).sort(), ['Ana:guest', 'Ben:host', 'Cat:guest', 'Eve:guest']);
        } finally {
            await party.leave();
        }
    });
    await checkAsync('REGRESSION: two members who both carried the room on settle on one', async () => {
        // Ben's path went quiet, so the room marked him away; Cat heard that
        // roster and Ben did not. When the host left, each was next by its
        // own roster, and each hosted a room of one from then on.
        const party = await trackerParty();
        let jump = 0;
        try {
            const ana = await party.add('Ana', undefined, { now: () => Date.now() + jump });
            await until(() => ana.session.status().trackers === 1, 'the host in the swarm');
            const ben = await party.add('Ben', ana.code);
            const cat = await party.add('Cat', ana.code);
            const bens = party.all.find((pc) => pc.connectionState === 'connected' && pc.localDescription.type === 'offer');
            for (const channel of [...bens.channels, ...bens.other.channels]) channel.send = () => {};
            // The room's clock a quarter of a minute on: everyone quiet that long is away, then Cat speaks.
            jump = PartyRoom.AWAY_MS + 1000;
            await settle(() => (cat.session.status().members.find((m) => m.name === 'Ben') || {}).away, 'the room to mark Ben away', 3000);
            const catTab = tabPort();
            cat.session.connect(catTab);
            catTab.say({ t: 'ready', ready: true });
            await settle(() => !(cat.session.status().members.find((m) => m.name === 'Cat') || {}).away, 'Cat to be heard');
            assert(!(ben.session.status().members.find((m) => m.name === 'Ben') || {}).away, 'Ben never heard he was away');

            await ana.session.control({ op: 'leave' });
            let both = false;
            await settle(() => {
                both = both || (hosting(ben.session) && hosting(cat.session));
                return both && [ben, cat].filter((one) => hosting(one.session)).length === 1
                    && hostOf(ben.session) === hostOf(cat.session) && ben.session.status().up && cat.session.status().up;
            }, 'both to carry it on, then one to step down');
            eq(roles(ben.session).length, 2, 'one room, both in it');
        } finally {
            await party.leave();
        }
    });
    await checkAsync('REGRESSION: a room carried on runs from the new host\'s own clock', async () => {
        // takeOver() stamped the state with Date.now(), but the new room runs
        // on the session's clock. Ahead of it, the room jumped forward; behind
        // it, the start read as still to come and held everyone paused.
        for (const skew of [3000, -3000]) {
            const party = await trackerParty();
            try {
                const ana = await party.add('Ana');
                await until(() => ana.session.status().trackers === 1, 'the host in the swarm');
                const ben = await party.add('Ben', ana.code, { now: () => Date.now() + skew });
                const tab = tabPort();
                ben.session.connect(tab);
                const t0 = Date.now();
                tab.say({ t: 'intent', id: 1, base: 0, op: 'play', pos: 100, at: Date.now() });
                await until(() => ana.session.status().state.paused === false, 'Ben\'s play to reach Ana');
                await ana.session.control({ op: 'leave' });
                await until(() => ben.session.status().trackers !== undefined, 'Ben to carry the room on');
                const state = ben.session.status().state;
                const roomNow = Date.now() + skew;
                const off = PartyState.expected(state, roomNow) - (100 + (Date.now() - t0) / 1000);
                assert(Math.abs(off) < 0.3 && !PartyState.scheduled(state, roomNow), `clock ${skew}: off by ${off.toFixed(2)} s`);
            } finally {
                await party.leave();
            }
        }
    });
    await checkAsync('a joiner says whether the trackers or the host were missing', async () => {
        const { RTC } = fakeRtc();
        const { secret } = PartyTracker.newCode();
        const join = (tracker) => PartyTracker.joinSwarm({ secret, urls: ['wss://t'], RTC, gatherMs: 50, WebSocket: tracker.Socket, timeoutMs: 100 }).done;
        eq(await join(fakeTracker({ down: true })), { error: 'tracker' });
        eq(await join(fakeTracker()), { error: 'no-host' });
    });

    // ------------------------------------------------- party dev server

    section('party dev server — the session over a real socket');
    const PartyDevServer = require('./party-dev-server.js');

    await checkAsync('two sessions meet through an invite, and come back as themselves after an outage', async () => {
        const server = await PartyDevServer.startServer({ port: 0 });
        const ana = PartySession.createSession();
        const ben = PartySession.createSession();
        try {
            const made = await ana.control({ op: 'start', mode: 'server', url: server.url, name: 'Ana' });
            const joined = await ben.control({ op: 'start', mode: 'server', code: made.status.invite, name: 'Ben' });
            eq(joined.status.members.map((m) => [m.name, m.role]), [['Ana', 'host'], ['Ben', 'guest']]);
            const tab = tabPort();
            ben.connect(tab);
            tab.say({ t: 'intent', id: 1, base: 0, op: 'play', pos: 5, at: Date.now() });
            await until(() => ana.status().state.paused === false, 'Ben\'s play to reach Ana');

            const [room] = server.rooms.values();
            const before = [ana.status().you, ben.status().you];
            server.sever();
            eq(room.links.size, 0);
            await until(() => room.links.size === 2 && ana.status().up && ben.status().up, 'both to reconnect');
            eq([ana.status().you, ben.status().you], before, 'resumed, not joined anew');
            eq(ana.status().members.length, 2);
        } finally {
            await ana.control({ op: 'leave' });
            await ben.control({ op: 'leave' });
            await server.close();
        }
    });
    await checkAsync('the dev server refuses a wrong secret and an unknown room', async () => {
        const server = await PartyDevServer.startServer({ port: 0 });
        try {
            const ana = PartySession.createSession();
            const made = await ana.control({ op: 'start', mode: 'server', url: server.url });
            const { url, room } = PartyWs.readInvite(made.status.invite);
            const joinWith = (invite) => PartySession.createSession().control({ op: 'start', mode: 'server', code: PartyWs.inviteCode(invite) });
            eq(await joinWith({ url, room, secret: 'guess' }), { ok: false, error: 'bad-secret' });
            eq(await joinWith({ url, room: 'nope', secret: 'guess' }), { ok: false, error: 'no-room' });
            await ana.control({ op: 'leave' });
        } finally {
            await server.close();
        }
    });

    // ----------------------------------------------------- party worker

    section('party worker — the document a party lives in, open only while it does');
    const PartyWorker = require('../src/background/party.js');

    check('offscreen.html loads the session after everything it reads', () => {
        const html = fs.readFileSync(`${__dirname}/../offscreen.html`, 'utf8');
        const files = [...html.matchAll(/<script src="([^"]+)"/g)].map((one) => one[1]);
        for (const file of files) assert(fs.existsSync(`${__dirname}/../${file}`), `${file} is missing`);
        const at = (name) => files.findIndex((file) => file.endsWith(`/${name}.js`));
        // party-code before party-ws, which reads text through its base64url,
        // and settings first, for the transports' defaults.
        const order = ['settings', 'party-clock', 'party-state', 'party-chat', 'party-room', 'party-loopback', 'party-code', 'party-ws', 'party-rtc', 'party-host', 'party-tracker', 'party-session'];
        eq(order.map(at), order.map((_, i) => i));
    });
    check('the worker and the session agree on how the worker addresses it', () => {
        eq(PartyWorker.SESSION, PartySession.TARGET);
    });
    check('only chrome asks for an offscreen document', () => {
        const permissions = (name) => JSON.parse(fs.readFileSync(`${__dirname}/../${name}`, 'utf8')).permissions;
        assert(permissions('manifest.json').includes('offscreen'));
        assert(!permissions('manifest.firefox.json').includes('offscreen'), 'firefox has no chrome.offscreen');
    });

    /** A party over fakes: the document, the loader and the alarm, each writing down what it was asked. */
    /** `more` is the rest of chrome.* a case needs, laid over the fakes. */
    function partyWith({ answer = { ok: true }, bound = null, more = {} } = {}) {
        const calls = [];
        const alarms = {};
        let open = false;
        const host = {
            exists: async () => open,
            open: async () => { calls.push('open'); open = true; },
            close: async () => { calls.push('close'); open = false; },
            ask: async (msg) => { calls.push(`ask ${msg.op}`); calls.asked = msg; return msg.op === 'start' ? answer : { ok: true }; },
        };
        const loader = {
            bind: async (tabId) => { calls.push(`bind ${tabId}`); return true; },
            unbind: async () => { calls.push('unbind'); },
            current: async () => bound,
        };
        const session = {};
        const api = {
            alarms: { create: (name, info) => { alarms[name] = info; }, clear: async (name) => { delete alarms[name]; } },
            storage: { session: { set: async (items) => Object.assign(session, items) } },
            ...more,
        };
        return { party: PartyWorker.createParty({ api, loader, host }), calls, alarms, session };
    }
    const partyVideo = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

    await checkAsync('a party opens its document, and the tab\'s code goes in only once it is listening', async () => {
        const { party, calls } = partyWith();
        eq((await party.start(7, partyVideo)).ok, true);
        eq(calls, ['open', 'ask start', 'bind 7']);
        eq([calls.asked.mode, calls.asked.policy], ['loopback', { control: 'everyone', wait: true }], 'the settings\' defaults');
        eq(calls.asked.ice, { stun: 'stun:stun.l.google.com:19302 stun:stun.cloudflare.com:3478', turn: '' });
    });
    await checkAsync('a tab on another site starts nothing', async () => {
        const { party, calls } = partyWith();
        eq(await party.start(7, 'https://example.com/'), { ok: false, error: 'site' });
        eq(calls, []);
    });
    await checkAsync('a start the session refuses leaves nothing open', async () => {
        const { party, calls } = partyWith({ answer: { ok: false, error: 'full' } });
        eq(await party.start(7, partyVideo), { ok: false, error: 'full' });
        eq(calls, ['open', 'ask start', 'ask leave', 'close', 'unbind']);
    });
    await checkAsync('leaving closes the document and shuts the gate', async () => {
        const { party, calls } = partyWith();
        await party.start(7, partyVideo);
        calls.length = 0;
        await party.leave();
        eq(calls, ['ask leave', 'close', 'unbind']);
        eq(await party.status(), { ok: true, status: { active: false } }, 'asked with no document open, nothing is opened');
    });
    await checkAsync('the party\'s tab closing ends it half a minute on, unless it was started again', async () => {
        for (const bound of [null, { tabId: 9, site: 'youtube' }]) {
            const { party, calls, alarms } = partyWith({ bound });
            await party.start(7, partyVideo);
            party.onTabClosed(7);
            eq(alarms[PartyWorker.LINGER_ALARM], { delayInMinutes: PartyWorker.LINGER_MIN });
            eq(await party.onAlarm({ name: PartyWorker.LINGER_ALARM }), !bound);
            eq(calls.includes('close'), !bound, bound ? 'moved to tab 9: kept' : 'nobody took it up: over');
        }
    });
    await checkAsync('a server party starts on the address given, else the setting\'s, and an invite joins', async () => {
        const tab = { tab: { id: 7, url: partyVideo } };
        const asked = async (message) => {
            const { party, calls } = partyWith();
            await PartyWorker.handle({}, party, message, tab);
            const { mode, url, code } = calls.asked;
            return { mode, url, code };
        };
        eq(await asked({ action: 'partyStart' }), { mode: 'loopback', url: '', code: undefined });
        eq(await asked({ action: 'partyStart', server: 'ws://10.0.0.2:7070' }), { mode: 'server', url: 'ws://10.0.0.2:7070', code: undefined });
        eq(await asked({ action: 'partyStart', server: '' }), { mode: 'server', url: '', code: undefined }, 'partyServerUrl, blank by default');
        eq(await asked({ action: 'partyJoin', code: 'bbp1s.x' }), { mode: 'server', url: '', code: 'bbp1s.x' });
        eq(await asked({ action: 'partyStart', mode: 'codes' }), { mode: 'codes', url: '', code: undefined });
        eq(await asked({ action: 'partyJoin', code: ' bbp1i.x ' }), { mode: 'codes', url: '', code: 'bbp1i.x' });
        eq(await asked({ action: 'partyStart', mode: 'tracker' }), { mode: 'tracker', url: '', code: undefined });
        eq(await asked({ action: 'partyJoin', code: 'bbp1t.x' }), { mode: 'tracker', url: '', code: 'bbp1t.x' });
    });
    await checkAsync('a code that is none of ours opens nothing', async () => {
        const { party, calls } = partyWith();
        eq(await PartyWorker.handle({}, party, { action: 'partyJoin', code: 'hello' }, { tab: { id: 7, url: partyVideo } }), { ok: false, error: 'code' });
        eq(calls, []);
    });
    await checkAsync('a pasted reply lets a guest into the party on, and an invite is asked of it', async () => {
        const { party, calls } = partyWith();
        eq(await PartyWorker.handle({}, party, { action: 'partyInvite' }, {}), { ok: false, error: 'inactive' });
        await party.start(7, partyVideo);
        calls.length = 0;
        await PartyWorker.handle({}, party, { action: 'partyJoin', code: ' bbp1r.abc ' }, {});
        await PartyWorker.handle({}, party, { action: 'partyInvite' }, {});
        eq([calls, calls.asked], [['ask accept', 'ask invite'], { op: 'invite' }], 'no new party, no tab bound');
    });
    await checkAsync('a party the authority ended is closed down, and why is kept for the popup; a page cannot claim one was', async () => {
        const { party, calls, session } = partyWith();
        await party.start(7, partyVideo);
        calls.length = 0;
        eq(await PartyWorker.handle({}, party, { action: 'partyEnded' }, { tab: { id: 7 } }), { ok: false });
        eq(calls, []);
        await PartyWorker.handle({}, party, { action: 'partyEnded', code: 'kicked' }, { url: 'chrome-extension://x/offscreen.html' });
        eq(calls, ['ask leave', 'close', 'unbind']);
        eq(session[PartyWorker.ENDED_KEY].code, 'kicked');
    });
    await checkAsync('the popup\'s host controls are passed on as they are, and nothing else is', async () => {
        const { party, calls } = partyWith();
        eq(await PartyWorker.handle({}, party, { action: 'partyControl', op: 'kick', member: 'm2' }, {}), { ok: false, error: 'inactive' });
        await party.start(7, partyVideo);
        calls.length = 0;
        await PartyWorker.handle({}, party, { action: 'partyControl', op: 'policy', control: 'host' }, {});
        eq(calls.asked, { op: 'policy', control: 'host' });
        eq(await PartyWorker.handle({}, party, { action: 'partyControl', op: 'leave' }, {}), { ok: false, error: 'op' });
        eq(await PartyWorker.handle({}, party, { action: 'partyControl', op: 'start' }, {}), { ok: false, error: 'op' });
        eq(calls, ['ask policy']);
    });
    await checkAsync('"Open on page" brings the party\'s tab forward, then asks the session to open its chat', async () => {
        const more = {
            tabs: { update: async (id, info) => { calls.push(`tab ${id} ${info.active}`); return { id, windowId: 3 }; } },
            windows: { update: async (id, info) => { calls.push(`window ${id} ${info.focused}`); } },
        };
        const none = partyWith({ more });
        eq(await PartyWorker.handle({}, none.party, { action: 'partyChat' }, {}), { ok: false, error: 'tab' }, 'no party tab');
        const { party, calls } = partyWith({ bound: { tabId: 9, site: 'youtube' }, more });
        await party.start(9, partyVideo);
        calls.length = 0;
        eq(await PartyWorker.handle({}, party, { action: 'partyChat' }, {}), { ok: true });
        eq(calls, ['tab 9 true', 'window 3 true', 'ask chat']);
    });
    await checkAsync('the session reports a kick, but not a start that failed or a leave', async () => {
        const ended = [];
        const loop = PartyLoopback.createLoopback();
        const session = PartySession.createSession({ transports: { loopback: () => loop }, now: () => 1000, onEnd: (code) => ended.push(code) });
        await session.control({ op: 'start', name: 'Ana' });
        const ben = loop.open(() => {});
        ben.send({ t: 'hello', v: 1, name: 'Ben' });
        const [ana, benId] = loop.room.members().map((m) => m.id);
        loop.room.handle(ana, { t: 'role', member: benId, role: 'host' }, 1000);
        eq(ended, [], 'handing over is not ending');
        ben.send({ t: 'kick', member: ana });
        eq([ended, session.status().active], [['kicked'], false]);
        const left = PartySession.createSession({ now: () => 1000, onEnd: (code) => ended.push(code) });
        await left.control({ op: 'start' });
        await left.control({ op: 'leave' });
        const refused = PartySession.createSession({ transports: { loopback: () => ({ open: (deliver) => ({ send: () => deliver({ t: 'error', code: 'full' }), close() {} }), close() {} }) }, onEnd: (code) => ended.push(code) });
        eq(await refused.control({ op: 'start' }), { ok: false, error: 'full' });
        eq(ended, ['kicked']);
    });
    await checkAsync('two starts close together open one offscreen document', async () => {
        let documents = 0;
        const api = {
            runtime: {
                getURL: (path) => `chrome-extension://x/${path}`,
                getContexts: async () => Array.from({ length: documents }, () => ({})),
            },
            offscreen: { createDocument: () => new Promise((resolve) => setTimeout(() => { documents++; resolve(); }, 5)) },
        };
        const host = PartyWorker.offscreenHost(api);
        await Promise.all([host.open(), host.open()]);
        eq(documents, 1);
    });

    check('firefox\'s background page does not list the session: it is loaded when a party starts', () => {
        const scripts = JSON.parse(fs.readFileSync(`${__dirname}/../manifest.firefox.json`, 'utf8')).background.scripts;
        eq(scripts.filter((file) => /offscreen\//.test(file)), []);
    });
    await checkAsync('firefox loads offscreen.html\'s scripts into its page, in order, once, and asks the tab to keep it', async () => {
        const html = fs.readFileSync(`${__dirname}/../offscreen.html`, 'utf8');
        const appended = [];
        // The background page already ran settings.js, from manifest.firefox.json.
        const doc = {
            scripts: [{ src: 'moz-extension://x/src/shared/settings.js' }],
            createElement: () => ({}),
            head: { appendChild: (script) => { appended.push(script.src); setTimeout(script.onload); } },
        };
        const api = {
            runtime: {
                getURL: (path) => `moz-extension://x/${path}`,
                onConnect: { addListener: () => {} },
                onMessage: { addListener: () => {} },
            },
        };
        const host = PartyWorker.pageHost(api, { doc, fetchText: async () => html });
        try {
            await Promise.all([host.open(), host.open()]);
            eq(appended, [...html.matchAll(/<script src="([^"]+)"/g)].map((one) => `moz-extension://x/${one[1]}`)
                .filter((url) => !url.endsWith('/settings.js')), 'what the page has already is not run twice');
            assert(!(await host.exists()), 'loaded, but no party yet');
            eq((await host.ask({ op: 'start', name: 'Ana' })).ok, true, 'called directly, not by message');
            assert(await host.exists());
            const tab = tabPort();
            globalThis.__bbPartySession.connect(tab);
            eq(tab.last('keepalive'), { t: 'keepalive', ms: PartyWorker.KEEPALIVE_MS });
            await host.ask({ op: 'leave' });
            assert(!(await host.exists()));
        } finally {
            delete globalThis.__bbPartySession;
        }
    });

    // ------------------------------------------------------ party panel

    section('party panel — the popup\'s views, loaded only when asked for');
    globalThis.BB.Settings = globalThis.BB.Settings || require('../src/shared/settings.js');
    globalThis.BB.PartyCode = PartyCode;
    globalThis.BB.Ui = globalThis.BB.Ui || {};
    const PartyPanel = require('../src/page/party-panel.js');
    const StartView = require('../src/page/party-start-view.js');
    const JoinViews = require('../src/page/party-join-view.js');

    check('the popup lists no party file: they are appended, in order, when a party is wanted', () => {
        const html = fs.readFileSync(`${__dirname}/../popup.html`, 'utf8');
        assert(!/<script src="[^"]*party[^"]*"/.test(html) && !/party\.css/.test(html), 'popup.html must not load the party');
        const popup = fs.readFileSync(`${__dirname}/../popup.js`, 'utf8');
        const files = JSON.parse(`[${/PARTY_FILES = \[([^\]]+)\]/.exec(popup)[1].replace(/'/g, '"')}]`);
        eq(files.slice(0, 2), ['src/shared/party-code.js', 'src/page/party-panel.js'], 'the panel after the codes it reads, before the views');
        for (const file of [...files, 'party.css']) assert(fs.existsSync(`${__dirname}/../${file}`), file);
    });
    check('every party setting has its control in the dashboard, bound by its id', () => {
        const html = fs.readFileSync(`${__dirname}/../dashboard.html`, 'utf8');
        const keys = Object.keys(globalThis.BB.Settings.DEFAULTS).filter((key) => key.startsWith('party'));
        eq(keys.length, 8);
        for (const key of keys) assert(html.includes(`id="${key}"`), key);
    });
    check('REGRESSION: a round trip the authority sends is shown only as a number', () => {
        // It went into the popup's markup as it came. A server or a hosting
        // browser could put an image, a style or a working host control there.
        const RoomView = require('../src/page/party-room-view.js');
        const esc = globalThis.BB.Dom.escapeHtml;
        const evil = '<img src="http://x.invalid/b.png"><button data-act="role" data-member="m9" data-role="host">Fix</button>';
        const status = {
            you: 'm1', policy: {}, up: true,
            members: [
                { id: 'm1', name: 'Ana', role: 'host', ready: true, rtt: 5 },
                { id: 'm2', name: 'Ben', role: 'guest', ready: true, rtt: evil },
                { id: 'm3', name: 'Cat', role: 'guest', ready: true, rtt: 41.6 },
                { id: 'm4', name: 'Dan', role: 'guest', ready: true, rtt: null },
            ],
        };
        const html = RoomView.render({ status, esc, tab: null, openMember: null, subhead: ({ title }) => esc(title) });
        assert(!html.includes('<img') && !html.includes('data-member="m9"'), 'nothing of it is markup');
        const rtts = [...html.matchAll(/class="party-rtt">([^<]*)</g)].map((one) => one[1]);
        eq(rtts, ['—', '—', '42 ms', '—'], 'yours, a string, a number, none');
    });
    check('a countdown is m:ss and never goes below nothing', () => {
        eq([PartyPanel.countdown(61400, 0), PartyPanel.countdown(9000, 0), PartyPanel.countdown(0, 5000)], ['1:01', '0:09', '0:00']);
    });
    check('Start and Join are tabs over either screen, the open one is not redrawn, and both are gone while a party is on', () => {
        const body = { hidden: false, innerHTML: '', addEventListener(type, fn) { this.click = fn; }, querySelector: () => null };
        const panel = PartyPanel.createPanel({ body, site: 'youtube', onClose() {} });
        panel.prefs = { partyName: '' };
        const door = (view) => body.click({ target: { closest: () => ({ disabled: false, dataset: { act: 'door', view } }) } });
        const tabs = panel.doors('join');
        eq([...tabs.matchAll(/class="([^"]*)" data-act="door" data-view="(\w+)"/g)].map((m) => [m[2], m[1]]), [['start', ''], ['join', 'is-on']]);
        door('join');
        assert(body.innerHTML.includes('Join a party') && body.innerHTML.includes('data-act="door"'), 'the tab did not open Join');
        body.innerHTML = 'a half-pasted code';
        door('join');
        eq(body.innerHTML, 'a half-pasted code', 'the open tab was drawn again over what was typed');
        panel.status = { active: true };
        eq(panel.doors('join'), '');
    });
    await checkAsync('opening the panel again keeps one status timer, and a panel with nothing to show keeps none', async () => {
        // The popup opens it from resumeParty and again from Start and Join;
        // each open used to leave its own one-second timer behind.
        const live = new Set();
        const [realSet, realClear, realChrome] = [globalThis.setInterval, globalThis.clearInterval, globalThis.chrome];
        globalThis.setInterval = (fn) => { const id = realSet(fn, 1e9); live.add(id); return id; };
        globalThis.clearInterval = (id) => { live.delete(id); realClear(id); };
        globalThis.chrome = {
            runtime: { sendMessage: (message, done) => done({ ok: true, status: { active: false } }) },
            storage: { session: { get: async () => ({}) } },
        };
        globalThis.BB.PartyViews.probe = { render: () => '' };
        try {
            const body = { hidden: true, innerHTML: '', addEventListener() {}, querySelector: () => null };
            const panel = PartyPanel.createPanel({ body, site: 'youtube', onClose() {} });
            await Promise.all([panel.open('probe'), panel.open('probe')]);
            await panel.open('probe');
            eq(live.size, 1, 'timers running after three opens');
            panel.close();
            eq(live.size, 0, 'after close');
            await panel.open(null);
            eq([body.hidden, live.size], [true, 0], 'no party and nothing asked for');
        } finally {
            for (const id of live) realClear(id);
            Object.assign(globalThis, { setInterval: realSet, clearInterval: realClear, chrome: realChrome });
            delete globalThis.BB.PartyViews.probe;
        }
    });
    check('a pasted code is named before it is joined, with an invite\'s address and time left', () => {
        const { readCode } = JoinViews.join;
        const invite = PartyCode.inviteCode({ ...inviteFields(), expires: 1000000 + 9 * 60000 });
        eq(readCode(invite, { now: 1000000 }), { ok: true, kind: 'Invite code', note: ' · from 203.0.113.7:55253 · 9 min left' });
        eq(readCode(invite, { now: 1000000 + 10 * 60000 }).ok, false, 'expired');
        eq(readCode(invite.slice(0, -4)).ok, false, 'cut short');
        eq(readCode(PartyWs.inviteCode({ url: 'wss://party.example/', room: 'r', secret: 's' })), { ok: true, kind: 'Server code', note: ' · on party.example' });
        eq([readCode('bbp1t.abc').ok, readCode('bbp1r.abc').ok, readCode('hello').kind, readCode('  ')], [true, false, 'Not a party code', null]);
    });
    await checkAsync('the tracker probe counts the sockets that open in time, and closes every one', async () => {
        const made = [];
        class Socket {
            constructor(url) {
                this.url = url;
                made.push(this);
                if (url.includes('up')) setTimeout(() => this.onopen());
                if (url.includes('bad')) setTimeout(() => this.onerror());
            }
            close() { this.closed = true; }
        }
        const n = await StartView.probeTrackers('wss://up.one wss://bad.two  wss://slow.three https://no.four', { Socket, ms: 30 });
        eq([n, made.map((one) => one.url), made.every((one) => one.closed)], [1, ['wss://up.one', 'wss://bad.two', 'wss://slow.three'], true]);
    });
    check('the room shows chat said while the page\'s panel was shut, and who last said it, and nothing when all is read', () => {
        const RoomView = require('../src/page/party-room-view.js');
        const panel = (chat) => ({
            status: { mode: 'loopback', you: 'm1', up: true, members: [{ id: 'm1', name: 'Nadia', role: 'host', ready: true }], policy: {}, chat },
            esc: globalThis.BB.Dom.escapeHtml, subhead: () => '',
        });
        const strip = RoomView.render(panel({ unread: 3, last: '<b>Ana</b>' }));
        assert(strip.includes('<strong>3 new</strong> in chat · last from &lt;b&gt;Ana&lt;/b&gt;'), strip);
        assert(strip.includes('data-act="chat">Open on page</button>'), 'the way there');
        for (const chat of [{ unread: 0, last: null }, undefined]) assert(!RoomView.render(panel(chat)).includes('party-chat-strip'));
    });
    check('every way a party ends that the session can report has words, and each way on is a view', () => {
        for (const code of ['host-left', 'expired', 'tracker', 'invite', 'no-host', 'kicked']) assert(JoinViews.ended.knows(code), code);
        for (const one of Object.values(JoinViews.ended.ENDINGS)) assert(['join', 'start', 'codes'].includes(one.go), one.go);
    });

    console.log('\n' + '='.repeat(52));
    if (AREA && passed + failed === 0) {
        console.log(`no section has "${AREA}" in its name`);
        process.exit(1);
    }
    console.log(`${passed}/${passed + failed} passed` + (failed ? `  (${failed} FAILED)` : '  — all green')
        + (AREA ? `, ${skipped} outside "${AREA}" skipped` : ''));
    process.exit(failed ? 1 : 0);
})();
