/**
 * A Node smoke-check for the parts of the suite that are pure logic.
 *
 * The browser suite in tests/index.html stays the real thing — it drives real
 * KeyboardEvents against a real <video>, which Node cannot do. But a browser
 * throttles timers hard in a backgrounded tab, and the mock defers every
 * chrome.* callback through one, so a full run there can take minutes. This
 * runs the timestamp arithmetic and the activity store in a second, which is
 * what you want while actually changing that code.
 *
 *     node tests/node-check.js
 */
'use strict';

let passed = 0;
let failed = 0;

function check(name, fn) {
    try {
        fn();
        passed++;
    } catch (error) {
        failed++;
        console.log(`  FAIL  ${name}\n        ${error.message}`);
    }
}

async function checkAsync(name, fn) {
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

/**
 * A curve's shape rather than its values. The FSRS formulas are somebody
 * else's arithmetic and pinning them to constants would only record what this
 * machine computed today; what actually has to hold is that a more stable card
 * waits longer and a higher retention target waits less.
 */
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

console.log('\n# speed ladder');
check('steps to the next rung strictly above', () => {
    eq(Speed.nextStep(1), 1.25);
    eq(Speed.nextStep(2), 2.25);
});
check('an off-ladder rate does not skip a rung', () => {
    // The old "nearest index + 1" turned 2.4 into 3 and skipped 2.5 entirely.
    eq(Speed.nextStep(2.4), 2.5);
    eq(Speed.prevStep(2.4), 2.25);
});
check('stepping stops at the ends rather than wrapping', () => {
    eq(Speed.nextStep(5), 5);
    eq(Speed.prevStep(0.25), 0.25);
});
check('direction 0 is a reset to 1x', () => eq(Speed.step(2.5, 0), 1));
check('clamps out-of-range rates', () => {
    eq(Speed.clamp(99), Speed.MAX_RATE);
    eq(Speed.clamp(0), Speed.MIN_RATE);
});

// ----------------------------------------------------------------- dom

const Dom = require('../src/shared/dom.js');

console.log('\n# escaping and URL safety');
check('escapes markup in text', () => eq(Dom.escapeHtml('<b>&"x"'), '&lt;b&gt;&amp;&quot;x&quot;'));
check('javascript: URLs are neutralised', () => {
    eq(Dom.safeUrl('javascript:alert(1)'), '#');
    eq(Dom.safeUrl('data:text/html,<script>'), '#');
});
check('http(s) URLs pass through', () => {
    eq(Dom.safeUrl('https://youtube.com/watch?v=x'), 'https://youtube.com/watch?v=x');
});

// ------------------------------------------------------------- youtube

const YouTube = require('../src/shared/youtube.js');

console.log('\n# youtube URLs');
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
check('non-watch pages have no id', () => {
    eq(YouTube.extractVideoId('https://www.youtube.com/feed/subscriptions'), null);
});

const PageInfo = require('../src/content/page-info.js');

console.log('\n# youtube channel pages');
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

console.log('\n# checkpoints');
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
check('removing the last checkpoint drops the video entry', () => {
    const videos = [{ id: 'v', title: 'V', url: 'u', bookmarks: [{ time: 5 }] }];
    eq(Bookmarks.removeBookmark(videos, 'v', 0).length, 0);
});
check('timestamp links parse out of pasted text, one per line', () => {
    const found = Bookmarks.parseTimestampLinks(
        'https://youtu.be/abcdefghijk?t=90' + String.fromCharCode(10) +
        'https://www.youtube.com/watch?v=abcdefghijk&t=2m30s');
    eq(found.length, 1, 'both links are the same video, so one entry');
    eq(found[0].bookmarks.map((b) => b.time), [90, 150]);
});

// ---------------------------------------------------------------- time

const Time = require('../src/shared/time.js');
const now = Date.parse('2026-08-30T12:00:00Z');
const ago = (ms) => Time.relativeTime(now - ms, now);

console.log('\n# relative time');
check('under a minute is "just now"', () => eq(ago(59 * 1000), 'just now'));
check('rounds down (13 days is 1 week)', () => eq(ago(13 * 864e5), '1 week ago'));
check('singular', () => eq(ago(864e5), '1 day ago'));
check('plural', () => eq(ago(3 * 864e5), '3 days ago'));
check('a future date is not a negative age', () => eq(Time.relativeTime(now + 5e6, now), 'just now'));
check('a missing date gets no label', () => {
    eq(Time.relativeTime(0, now), '', 'zero');
    eq(Time.relativeTime(undefined, now), '', 'undefined');
    eq(Time.relativeTime(null, now), '', 'null');
});
check('formatTime still works', () => {
    eq(Time.formatTime(65), '1:05');
    eq(Time.formatTime(3725), '1:02:05');
});

// ---------------------------------------------------------------- fsrs

const Fsrs = require('../src/shared/fsrs.js');

console.log('\n# fsrs — the forgetting curve');
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

console.log('\n# fsrs — reviewing');
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
    // The lapse curve is not "S times a constant", and on a card that is still
    // young it genuinely computes a *higher* stability than the card has —
    // forgetting after 120 days something whose stability is 3 says little.
    // The cap is what keeps that from reading as a reward for forgetting.
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

console.log('\n# fsrs — suggesting a grade');
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

// Two in the afternoon today rather than a fixed calendar date, for the same
// reason the activity suite uses one: the store prunes anything older than
// KEEP_DAYS on write, so a hard-coded date quietly stops being recorded once
// the suite is run a year after it was written. Local, and set with setHours
// so a tester west of UTC lights up the same square as one east of it.
const L0 = new Date().setHours(14, 0, 0, 0);
const days = (n) => n * Leet.DAY_MS;

const problemPage = {
    slug: 'two-sum',
    title: 'Two Sum',
    difficulty: 'Easy',
    tags: ['Array', 'Hash Table'],
    url: 'https://leetcode.com/problems/two-sum/',
};

console.log('\n# leetcode — seeing a problem');
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

console.log('\n# leetcode — attempts and day buckets');
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

console.log('\n# leetcode — pruning');
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

console.log('\n# leetcode — the three rails');
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

console.log('\n# leetcode — grading inputs');
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

console.log('\n# leetcode — putting something back in the queue');
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

console.log('\n# leetcode — the heat map');
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

console.log('\n# leetcode — reading the address bar');
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

console.log('\n# leetcode — reading the stopwatch');
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
 * Drive the clock without a browser.
 *
 * Only what createLeetUi actually touches is stubbed — it reads the page's
 * visibility, registers listeners it is never sent, and asks LeetRead what
 * the stopwatch says. That last one is the seam: `reads` is the sequence of
 * readings LeetCode's widget is pretending to show, and null means "no widget
 * on this page", which is the branch the wall clock covers.
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

console.log('\n# leetcode — the clock');
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

console.log('\n# leetcode — template languages');
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

console.log('\n# leetcode — offering templates');
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

console.log('\n# leetcode — what a template may hold');
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

console.log('\n# leetcode — reading the submission calendar');
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
    // Read back in local time, a midnight timestamp lands on the day before
    // for anyone west of Greenwich and the day after for anyone far enough
    // east. Matching LeetCode's own profile page is the answer a person can
    // actually check against.
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

console.log('\n# leetcode — asking LeetCode for it');
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

console.log('\n# leetcode — the pouch panel');
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

console.log('\n# leetcode — what the grade card offers');
check('the four grades are offered with what each would schedule', () => {
    withStubbedPage('/problems/two-sum/', ({ ui }) => {
        const fresh = { slug: 'two-sum', difficulty: 'Medium', fsrs: null };
        const options = ui.previewIntervals(fresh, Date.now());
        eq(options.map((o) => o.label), ['Again', 'Hard', 'Good', 'Easy']);
        // Harder answers bring it back sooner. Not *strictly* — on a first
        // review Again and Hard both round down to tomorrow, which is the
        // honest answer for both — but it must never invert, or the buttons
        // are lying about their own consequences.
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

console.log('\n# leetcode — the settings panel');
check('every leetcode setting has a control carrying its key as an id', () => {
    // This is the whole binding. src/page/settings-form.js matches a control
    // to a setting by id and nothing else, so a setting with no element is a
    // setting that can never be changed, and it fails silently — which is
    // exactly the kind of thing a reader would not notice.
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

console.log('\n# leetcode — the dashboard panels');
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
 * A keystroke stream, written the way a race actually happens.
 *
 * `quote` is what was on screen; `typed` is what went in, where a `<` is one
 * backspace. Every gap is `step` unless the character is preceded by a number
 * in braces, which is that gap in milliseconds — so a test can put a four
 * second stare or a three millisecond key repeat exactly where it wants one
 * without arithmetic in the test body.
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

console.log('\n# typeracer — folding a character');
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

console.log('\n# typeracer — reading the keystrokes');
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
    eq(Object.keys(grams.bi), []);
    eq(Object.keys(grams.tri), []);
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

console.log('\n# typeracer — merging and evicting');
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

console.log('\n# typeracer — the race log');
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
 * A page shaped like TypeRacer's, without a browser.
 *
 * `bySelector` maps one of the spellings in TyperRead.SELECTORS to the node
 * (or nodes) it finds. That is the whole seam: the readers are selector list
 * plus validation, and it is the validation these tests are about — whether
 * the real spelling is still current is the browser suite's question, and
 * beyond that, the site's.
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

console.log('\n# typeracer — reading the address bar');
check('the pit and a race are race pages, and the rest of the site is not', () => {
    eq(TyperRead.isRacePage('/'), true, 'the front door is the pit');
    eq(TyperRead.isRacePage('/pit/'), true);
    eq(TyperRead.isRacePage('/race'), true);
    eq(TyperRead.isRacePage('/play'), true);
    eq(TyperRead.isRacePage('/pit/profile'), true, 'still under the pit');
    eq(TyperRead.isRacePage('/texts'), false);
    eq(TyperRead.isRacePage('/forum/thread'), false);
});

console.log('\n# typeracer — reading the quote');
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

console.log('\n# typeracer — the box you type in');
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

console.log('\n# typeracer — the results panel');
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

console.log('\n# typeracer — where the caret belongs');
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
 * Drive a race without a browser.
 *
 * Only what createTyperUi actually touches is stubbed: the capture listener it
 * registers on `document`, the monotonic clock it timestamps with, and the
 * four readers it asks about the page. `record` is intercepted rather than
 * left to storage — what is written is the thing under test here, and the
 * store's own arithmetic has its own section above.
 *
 * `clock` is moved by hand. A typing test measured against a clock that some
 * test slept through would be a test of how fast this machine is.
 */
function withTyperPage(run, { settings = {}, quote = '' } = {}) {
    const BB = globalThis.BB;
    const saved = {
        document: global.document,
        performance: global.performance,
        location: global.location,
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
        // The caret is on its default ('site') through all of these, so it
        // draws nothing — but tearing it down is unconditional, and a page
        // with no <html> on it would fail there rather than in the code
        // these tests are about.
        documentElement: { classList: { add() {}, remove() {}, contains: () => false, toggle() {} } },
    };
    global.location = { pathname: '/' };

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

    /**
     * Type `text` into the box, one `beforeinput` per character, `step`
     * milliseconds apart. A `<` is one backspace, as in the store's tests.
     */
    const type = (text, { step = 200 } = {}) => {
        for (const ch of text) {
            clock += step;
            if (ch === '<') {
                handlers.beforeinput({ inputType: 'deleteContentBackward', data: null, target: { value: '', selectionStart: 1, selectionEnd: 1 } });
            } else {
                handlers.beforeinput({ inputType: 'insertText', data: ch, target: { value: ch, selectionStart: 1, selectionEnd: 1 } });
            }
        }
    };

    const pass = () => tasks.get('typer-race')();

    try {
        return run({ ui, page, type, pass, written, watcher, handlers, wait: (ms) => { clock += ms; } });
    } finally {
        ui.uninstall();
        Object.assign(global, { document: saved.document, performance: saved.performance, location: saved.location });
        BB.Typer.record = saved.record;
        BB.TyperRead.readResult = saved.readResult;
        BB.TyperRead.quoteId = saved.quoteId;
        BB.TyperRead.quoteText = saved.quoteText;
        BB.TyperRead.find = saved.find;
    }
}

console.log('\n# typeracer — counting what a delete took away');
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
check('an input that cannot say is treated as one character', () => {
    eq(TyperUi.deletedCount(null, 'deleteContentBackward'), 1);
    eq(TyperUi.deletedCount({ value: 'x' }, 'deleteContentBackward'), 1);
});

console.log('\n# typeracer — measuring a race');
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
check('deleting past the start of the quote is not recorded', () => {
    withTyperPage(({ ui, pass, type }) => {
        pass();
        type('t<<<');
        eq(ui.currentRace().depth, 0);
        eq(ui.currentRace().events.filter((e) => e.del).length, 1, 'only the one that had something to take');
    }, { quote: 'the quick brown fox jumps over it' });
});

console.log('\n# typeracer — ending a race');
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

console.log('\n# typeracer — what correcting cost');
check('the window is the span from the wrong key to the restored prefix', () => {
    // "the quick" typed as t, h, x, q, u, then three backspaces taking the
    // x back off, then the right letters. The clock starts on the x and
    // stops on the backspace that removed it — not on the retype, because
    // the moment the box is a correct prefix again is the moment the
    // correcting is over.
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

console.log('\n# typeracer — clean speed');
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

console.log('\n# typeracer — the cost over a range');
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

console.log('\n# typeracer — the typing caret');
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
    const html = require('fs').readFileSync(`${__dirname}/../content.css`, 'utf8');
    for (const shape of TyperUi.SHAPES) {
        if (shape === 'site') continue;
        assert(html.includes(`[data-bb-caret="${shape}"]`), `${shape} has no rule to draw it`);
    }
});
check('the caret is drawn from the skin’s tokens rather than a colour', () => {
    // So it follows a skin or a day/night change without being redrawn, the
    // rule every surface this extension injects follows.
    const css = require('fs').readFileSync(`${__dirname}/../content.css`, 'utf8');
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

console.log('\n# the sound module');
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

console.log('\n# typeracer — the sound of typing');

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

console.log('\n# the line chart');
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

console.log('\n# the line chart — the run rather than the jitter');
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

console.log('\n# typeracer — the headline figures');
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

console.log('\n# typeracer — the races panel');

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

console.log('\n# typeracer — the slowest grams');

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

console.log('\n# typeracer — the characters you get wrong');
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

console.log('\n# typeracer — the weak spot panel');
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

console.log('\n# typeracer — the practice map');
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

console.log('\n# typeracer — the streak');
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

console.log('\n# typeracer — the drill');
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

console.log('\n# typeracer — the settings panel');
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

console.log('\n# the lists that have to move together');

const readRepo = (name) => require('fs').readFileSync(`${__dirname}/../${name}`, 'utf8');

check('the two manifests load exactly the same content scripts', () => {
    // They are byte-identical today and the point is to keep them so: a
    // module added to one and not the other fails in that browser only, at
    // load, with "undefined is not an object".
    const chrome = JSON.parse(readRepo('manifest.json')).content_scripts;
    const firefox = JSON.parse(readRepo('manifest.firefox.json')).content_scripts;
    eq(firefox, chrome);
});
check('typeracer needs no page-world script, and has not grown one', () => {
    // chess.com and LeetCode each need one because the board object and
    // window.fetch only exist in the page's world. Keystrokes are DOM events,
    // which a capture listener in the isolated world sees in full.
    const worlds = JSON.parse(readRepo('manifest.json')).content_scripts
        .filter((entry) => entry.world === 'MAIN');
    for (const entry of worlds) {
        assert(!entry.matches.some((match) => /typeracer/.test(match)),
            `a MAIN-world entry was added for ${entry.matches.join(', ')}`);
    }
});
check('every typeracer source the manifest loads is in the browser suite too', () => {
    const manifest = JSON.parse(readRepo('manifest.json')).content_scripts[0].js;
    const suite = readRepo('tests/index.html');
    for (const src of manifest.filter((one) => /typeracer|sfx/.test(one))) {
        assert(suite.includes(`../${src}`), `${src} is shipped but never loaded by the suite`);
    }
    assert(suite.includes('typeracer.test.js'), 'the spec itself is not loaded');
});
check('a module is loaded after everything it destructures off BB', () => {
    // Load order is manual — there is no bundler — and getting it wrong fails
    // in that one surface, at load.
    const suite = readRepo('tests/index.html');
    const at = (src) => suite.indexOf(`<script src="../${src}">`);
    for (const [first, second] of [
        ['src/shared/typeracer.js', 'src/content/typeracer-read.js'],
        ['src/content/typeracer-read.js', 'src/content/typeracer-ui.js'],
        ['src/shared/sfx.js', 'src/content/typeracer-ui.js'],
        ['src/shared/typeracer.js', 'src/page/typeracer-stats.js'],
        ['src/page/spark.js', 'src/page/typeracer-stats.js'],
    ]) {
        assert(at(first) !== -1 && at(second) !== -1, `${first} or ${second} is missing from the suite`);
        assert(at(first) < at(second), `${second} is loaded before ${first}`);
    }
});
check('the manifest loads them in that order as well', () => {
    const js = JSON.parse(readRepo('manifest.json')).content_scripts[0].js;
    const at = (src) => js.indexOf(src);
    assert(at('src/shared/sfx.js') < at('src/content/typeracer-ui.js'));
    assert(at('src/shared/typeracer.js') < at('src/content/typeracer-read.js'));
    assert(at('src/content/typeracer-read.js') < at('src/content/typeracer-ui.js'));
    // main.js is the bootstrap and destructures all of them.
    assert(at('src/content/typeracer-ui.js') < at('src/content/main.js'));
});

console.log('\n# the chess low-clock tone, on the sound module');
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
check('the sound module is loaded before the file that now plays through it', () => {
    // Load order is manual. chess.js sits well before the TypeRacer cluster,
    // so moving this one line is the whole of the migration's risk.
    const js = JSON.parse(require('fs').readFileSync(`${__dirname}/../manifest.json`, 'utf8'))
        .content_scripts[0].js;
    assert(js.indexOf('src/shared/sfx.js') < js.indexOf('src/content/chess.js'),
        'chess.js would get undefined for Sfx at load');
});

// ------------------------------------------------------------ activity

// Just enough chrome.* for the store: a local key/value area, promise form.
const store = {};
global.chrome = {
    storage: {
        local: {
            get: (keys, cb) => {
                const out = {};
                (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
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
        },
    },
};

require('../src/shared/settings.js');
require('../src/shared/activity.js');
const Activity = globalThis.BB.Activity;
const Feed = require('../src/shared/feed.js');

// One o'clock today, not a fixed calendar date. The store prunes any day older
// than KEEP_DAYS, and it prunes on write — so a hard-coded date quietly stops
// being recorded at all once the suite is run more than sixty days after it was
// written, and every tick starts the day over. One o'clock because these tests
// add seconds and minutes to it and none of them should cross midnight.
const T0 = new Date().setHours(13, 0, 0, 0);
const secs = (n) => n * 1000;
const tabAt = (url, title) => ({ url, title });

function reset({ on = true } = {}) {
    Object.keys(store).forEach((k) => delete store[k]);
    store.trackActivity = on;
    Activity.blur();
}

const dayRecord = (at = T0) =>
    (store[Activity.KEY] || {})[new Date(at).toISOString().slice(0, 10)] || null;

(async () => {
    console.log('\n# activity — recording');

    await checkAsync('records nothing while tracking is off', async () => {
        reset({ on: false });
        await Activity.tick(tabAt('https://github.com/a', 'A'), T0);
        await Activity.tick(tabAt('https://github.com/a', 'A'), T0 + secs(60));
        eq(store[Activity.KEY], undefined);
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

        // What MV3 does between two alarms: the worker is discarded and the
        // module is evaluated afresh, with only storage carrying over. The stub
        // above has no chrome.storage.session, so this covers the local
        // fallback too.
        delete require.cache[require.resolve('../src/shared/activity.js')];
        const restarted = require('../src/shared/activity.js');

        await restarted.tick(tabAt('https://a.test/x', 'X'), T0 + secs(30));
        eq(dayRecord().total, 30, 'the gap is credited, not thrown away with the worker');
    });

    await checkAsync('the longest page accumulates across ticks', async () => {
        reset();
        await Activity.tick(tabAt('https://a.test/x', 'Short page'), T0);
        await Activity.tick(tabAt('https://b.test/y', 'Long page'), T0 + secs(10));
        await Activity.tick(tabAt('https://b.test/y', 'Long page'), T0 + secs(40));
        await Activity.tick(tabAt('https://c.test/z', 'Another'), T0 + secs(70));
        const day = dayRecord();
        eq(day.top.title, 'Long page');
        eq(day.top.seconds, 60);
        eq(day.total, 70);
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

    await checkAsync('a gap is filed under the day it started', async () => {
        reset();
        const beforeMidnight = new Date(2026, 6, 15, 23, 59, 40).getTime();
        await Activity.tick(tabAt('https://a.test/x', 'X'), beforeMidnight);
        await Activity.tick(tabAt('https://a.test/x', 'X'), beforeMidnight + secs(40));
        eq(Object.keys(store[Activity.KEY]),
            [new Date(beforeMidnight).toISOString().slice(0, 10)]);
    });

    console.log('\n# activity — hosts');
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

    console.log('\n# activity — summary');

    function seed(data, offsetDays, record) {
        const key = new Date(Date.now() - offsetDays * 864e5).toISOString().slice(0, 10);
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

        eq(store[Activity.KEY][old].top, null, 'the title is gone from storage, not just from the view');
        eq(store[Activity.KEY][old].total, 900, 'the day itself is inside the 60-day window and stays');
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

    console.log('\n# activity — formatting');
    check('human() reads naturally', () => {
        eq(Activity.human(0), '0m');
        eq(Activity.human(45), '45s');
        eq(Activity.human(90), '2m');
        eq(Activity.human(3600), '1h');
        eq(Activity.human(3720), '1h 2m');
    });

    console.log('\n# feed — whose channel is this page?');

    // A channel page names a dozen channels, and only three of those mentions
    // are the page's own. The resolver used to take none of them: it took the
    // first "channelId" in the document, which on a real page belongs to a
    // recommendation. Every handle in the pouch therefore pulled a stranger's
    // feed, which is how the pouch filled up with channels nobody had filed.
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

    console.log('\n# checkpoint ordering');

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

    console.log('\n# pinning');
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

    console.log('\n# playlist ids');
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

    console.log('\n# feed — fetching a large pouch');
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

    console.log('\n# reading the account’s own subscriptions');

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
        // A subscriptions page names a dozen channels it is not listing — the
        // viewer's own account in the masthead, anything in a recommendation
        // shelf. This is why it walks for the grid's own renderers rather than
        // running a regex for "channelId" over the document.
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

    console.log('\n# following a playlist');

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

    console.log('\n# palette');

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

    console.log('\n# remembered cookie sites');

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

    await checkAsync('a site remembered as rejected keeps that answer', async () => {
        clearStore();
        await CookieSites.remember('example.com', 'decline', 7);
        eq(CookieSites.match(await CookieSites.load(), 'shop.example.com').decision, 'decline');
    });

    // ------------------------------------------------------------ backup

    console.log('\n# export / import');

    const Backup = require('../src/shared/backup.js');

    check('an export carries settings and data, never the caches', () => {
        const file = Backup.build({
            skin: 'deco',
            shortcuts: { 'speed-up': { enabled: false } },
            bbCookieSites: { 'a.com': { decision: 'accept' } },
            bbFeedCache: { huge: true },
            bbChessArchiveCache: { huge: true },
        }, 0);
        eq(Object.keys(file.data).sort(), ['bbCookieSites', 'shortcuts', 'skin']);
        eq(Backup.validate(file), true);
        eq(Backup.validate({ type: 'bell-bearer-checkpoints', data: {} }), false);
    });

    await checkAsync('importing writes the file back, still without caches', async () => {
        clearStore();
        store.skin = 'default';
        await Backup.importAll({ type: Backup.TYPE, data: { skin: 'riso', bbFeedCache: { stale: true } } });
        eq(store.skin, 'riso');
        eq(store.bbFeedCache, undefined);
    });

    // --------------------------------------------------------- shortcuts

    console.log('\n# keyboard shortcuts');

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
        eq(ids({ skimMode: false, linkHints: false }), ['copy-markdown-link'],
            'the bare-Shift keys are nobody else\'s until Settings asks for them');
        eq(ids({ skimMode: true, linkHints: false }),
            ['skim-find', 'skim-history', 'skim-actions', 'copy-markdown-link']);
        eq(ids({ skimMode: true, linkHints: true }).includes('link-hints'), true);
        eq(ids({ pouchShortcut: true }).includes('open-pouch'), true);
        eq(ids({ pouchShortcut: false }).includes('open-pouch'), false,
            'Shift+P stays a capital P until the pouch shortcut is asked for');
        eq(ids(null).length, 6, 'with no settings to check against, the table is the whole table');
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
    });

    // --------------------------------------------------------------- chess

    console.log('\n# chess.com games');

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
        eq(Object.keys(store.bbChessArchiveCache.archives).length, 13);
        await Chess.fetchGames('me', { now: now + 10 * 60 * 1000, fetchImpl });
        eq(Object.keys(store.bbChessArchiveCache.archives).length, 13, 'popup-sized read must keep the year');
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

    console.log('\n# lichess games');

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
        eq(urls.length, 3, 'the year needs only the older games: the newer were just read');
        eq([urls[2].searchParams.get('sort'), urls[2].searchParams.get('until')],
            ['dateDesc', String(now - 30 * 86400000 - 1)], 'the year continues back from where 30 days stopped');
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

    console.log('\n# chess sites in game: clock warning and spoken moves');

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

        // What chess.com actually ships: the figurine is an empty icon span
        // and the square follows after a space, inside a wrapper. Splitting on
        // that space and keeping the first token — which is what this did —
        // turned every piece move on the site into its bare letter, so "Qg4"
        // was read aloud as "Queen".
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
        // The bug this fixes: Coach, bots and the analysis board have no clock,
        // so they classify as no control at all. Gating them on a separate
        // "Untimed" box, off by default, left a user with Blitz ticked hearing
        // nothing on Coach.
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

    console.log('\n# chess daily limits');

    const ChessLimits = require('../src/shared/chess-limits.js');

    const DAY = new Date(2026, 8, 16, 12, 0, 0).getTime();
    const limitOn = {
        chessDailyLimits: true, chessLimitBullet: 2, chessLimitBlitz: 0, chessLimitRapid: null,
    };

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

    console.log('\n# trials');

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

    // -------------------------------------------------------- framed plate

    console.log('\n# the framed plate');

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

    // -------------------------------------------------- the annotated board

    console.log('\n# the annotated keyboard');

    const KeyboardWidget = require('../src/page/keyboard.js');

    check('every binding finds the keycap it is actually on', () => {
        const on = (id) => KeyboardWidget.kidOf(Keybindings.resolve(null, id));
        eq(on('skim-find'), 'KeyF');
        eq(on('skim-history'), 'KeyH');
        eq(on('skim-actions'), 'KeyA');
        eq(on('link-hints'), 'KeyL');
        eq(on('copy-markdown-link'), 'KeyL');
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

    console.log('\n# the list of sites held to a limit');

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

    console.log('\n# what today has gone on, against the limit');

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

    // ------------------------------------------------------- the roster

    console.log('\n# a site roster, out to a file and back');

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

    check('a job is claimed by one page at a time', () => {
        const job = Roster.newJob({ site: 'twitter', action: 'apply', names: ['a', 'b'], now: 1000 });
        eq(Roster.canClaim(job, 'page1', 1000), true, 'nobody holds it yet');

        const held = Roster.claim(job, 'page1', 1000);
        eq(Roster.canClaim(held, 'page2', 1000), false, 'two tabs would follow the same account twice');
        eq(Roster.canClaim(held, 'page1', 1000), true, 'but the holder may carry on');
        eq(Roster.canClaim(held, 'page2', 1000 + Roster.LEASE_MS + 1), true,
            'a tab closed mid-job cannot hold it forever');
        eq(Roster.canClaim(Roster.release(held), 'page2', 1000), true,
            'and it is handed back before navigating');
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

    check('the dashboard and the content script agree where a read starts', () => {
        const RosterContent = require('../src/content/roster.js');
        // Two copies of two URLs, which is two too many — but the page cannot
        // import the content script's table and vice versa, so the next best
        // thing is a test that fails the moment they drift.
        const page = require('fs').readFileSync('src/page/roster-view.js', 'utf8');
        for (const id of Roster.ids()) {
            eq(page.includes(RosterContent.START[id]), true, `${id}: ${RosterContent.START[id]}`);
        }
    });

    check('a handle is read off an href, and a site page is not a handle', () => {
        const RosterContent = require('../src/content/roster.js');
        eq(RosterContent.handleFromHref('/alice'), 'alice');
        eq(RosterContent.handleFromHref('https://x.com/bob/following'), 'bob');
        eq(RosterContent.handleFromHref('/home'), '', "X's own pages sit at a one-segment path too");
        eq(RosterContent.subFromHref('https://old.reddit.com/r/rust/'), 'rust');
        eq(RosterContent.subFromHref('/user/someone'), '');
    });

    // ------------------------------------------------------------- skim

    console.log('\n# skim — where the match lands');

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

    check('at the top of the page the launcher drops', () => {
        const out = Skim.plan({ ...window900, scrollTop: 0, target: 120 });
        eq(out.pos, 'bottom');
        eq(out.scrollTop, 0, 'a page that cannot scroll up is not asked to');
    });

    check('a match in a sticky panel moves the launcher, never the page', () => {
        const high = Skim.plan({ ...window900, scrollTop: 500, target: 560, pinned: true });
        eq(high.pos, 'bottom', 'the match is near the top, so the launcher goes low');
        eq(high.scrollTop, 500, 'scrolling cannot move a sticky panel');
        const low = Skim.plan({ ...window900, scrollTop: 500, target: 1300, pinned: true });
        eq(low.pos, 'top');
    });

    console.log('\n# skim — the list');

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

    // ------------------------------------------------------------ X pouch

    console.log('\n# the X pouch — two independent lists');

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
        // Not a guard that throws — the two id spaces simply never meet, so a
        // post filed under a PEOPLE topic id lands in a post topic that does
        // not exist and shows up in no card. This pins the shape that makes
        // that impossible to do by accident: the prefixes differ.
        eq(ids.people.startsWith('xpt_'), true);
        eq(ids.posts.startsWith('xst_'), true);
    });

    check('the monogram falls back through name, then handle', () => {
        eq(XPouch.monogram('Wei Tan', '@weitan'), 'WT');
        eq(XPouch.monogram('Cher', '@cher'), 'CH', 'one word gives two letters, not one');
        eq(XPouch.monogram('', '@isorokin'), 'IS');
    });

    console.log('\n# the X pouch — reading x.com');

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

    check('the three X surfaces are settings, and all three are off', () => {
        const { DEFAULTS } = require('../src/shared/settings.js');
        // Each of them reaches into a page somebody else designed, which is
        // not a default to assume for anyone — and the dashboard binds a
        // control by giving it the key's own id, so a typo here is a toggle
        // that silently does nothing.
        for (const key of ['twitterHideBookmark', 'twitterPouchPeople', 'twitterPouchPosts']) {
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

    console.log('\n# short ages');

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

    console.log('\n# opening the dashboard at a site');

    check('only a hash of our own shape survives into the URL', () => {
        // The worker's openDashboard branch, driven directly. The hash it
        // appends arrives from a content script — that is, from a page we do
        // not own — so the guard matters: without it, x.com could ask the
        // worker to open our own extension URL with a fragment of its
        // choosing. Everything that is not `#<word>/<word>` is dropped
        // rather than rejected, so a caller that gets it wrong still lands
        // on the dashboard.
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

        delete require.cache[require.resolve('../src/background/commands.js')];
        require('../src/background/commands.js');

        const send = (hash) => onMessage({ action: 'openDashboard', hash }, {}, () => {});
        send('#site/twitter');
        send('#settings/chess');
        send('javascript:alert(1)');
        send('#../../evil');
        send(undefined);

        global.chrome = saved;

        eq(opened, [
            'x/dashboard.html#site/twitter',
            'x/dashboard.html#settings/chess',
            'x/dashboard.html',
            'x/dashboard.html',
            'x/dashboard.html',
        ]);
    });

    // ------------------------------------------------------- site detection

    console.log('\n# site detection');

    const Site = require('../src/content/site.js');

    check('chess.com and Lichess are sites of their own', () => {
        eq(Site.detectSite('www.chess.com'), 'chess');
        eq(Site.detectSite('chess.com'), 'chess');
        eq(Site.detectSite('notchess.com'), 'other');
        eq(Site.detectSite('lichess.org'), 'lichess');
        eq(Site.detectSite('en.lichess.org'), 'lichess');
        eq(Site.detectSite('notlichess.org'), 'other');
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

    console.log('\n# the site registry');

    const SiteIcons = require('../src/shared/site-icons.js');

    check('every site in the order has a card to draw', () => {
        for (const site of SiteIcons.list()) {
            assert(site && site.id, 'an id in ORDER with no entry in SITES');
            assert(site.name && site.description, `${site.id} is missing its plate`);
            assert(/^M/.test(site.path), `${site.id}'s glyph is not a path`);
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
        eq(SiteIcons.get('typeracer').name, 'TypeRacer');
        assert(SiteIcons.list().some((site) => site.id === 'typeracer'), 'not in ORDER');
        assert(SiteIcons.svg('typeracer').includes('<svg'), 'draws nothing');
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

    console.log('\n' + '='.repeat(52));
    console.log(`${passed}/${passed + failed} passed` + (failed ? `  (${failed} FAILED)` : '  — all green'));
    process.exit(failed ? 1 : 0);
})();
