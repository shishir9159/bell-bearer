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
        eq(ids(null).length, 5, 'with no settings to check against, the table is the whole table');
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

    console.log('\n# daily time limits');

    const TimeLimits = require('../src/shared/time-limits.js');

    const A_DAY = 864e5;
    const noon = new Date('2026-03-14T12:00:00').getTime();

    // A tally straight into the store. add() caps a single credit, which is
    // the right thing for a real one and no way to set up an afternoon.
    const spent = (siteId, seconds, when = noon) => ({
        day: TimeLimits.dayKey(when),
        seconds: { twitter: 0, reddit: 0, [siteId]: seconds },
    });

    check('the two sites are the ones detectSite already names', () => {
        eq(TimeLimits.ids(), ['twitter', 'reddit']);
        eq(TimeLimits.get('twitter').host, 'x.com');
        eq(TimeLimits.get('youtube'), null, 'no limit is offered on a site that has no row');
    });

    check('yesterday is discarded whole, not aged out', () => {
        const yesterday = spent('twitter', 600, noon - A_DAY);
        eq(TimeLimits.forDay(yesterday, noon - A_DAY).seconds.twitter, 600);
        const today = TimeLimits.forDay(yesterday, noon);
        eq(today.seconds.twitter, 0, 'the store is one day deep by design');
        eq(today.day, TimeLimits.dayKey(noon));
    });

    check('time adds up, and a single credit is capped', () => {
        let state = TimeLimits.blank(noon);
        state = TimeLimits.add(state, 'reddit', 15, noon);
        state = TimeLimits.add(state, 'reddit', 15, noon);
        eq(state.seconds.reddit, 30);
        // A laptop lid closed for three hours reports one enormous gap; the
        // cap is what stops the night being charged to the morning.
        state = TimeLimits.add(state, 'reddit', 3 * 3600, noon);
        eq(state.seconds.reddit, 30 + TimeLimits.MAX_CREDIT);
        eq(TimeLimits.add(state, 'reddit', -5, noon).seconds.reddit, 30 + TimeLimits.MAX_CREDIT,
            'a negative gap credits nothing');
    });

    check('a site with the switch off, or no minutes, has no limit at all', () => {
        const state = spent('twitter', 4000);
        const off = TimeLimits.statusFor(state, { twitterDailyLimit: false, twitterLimitMinutes: 30 }, 'twitter', noon);
        eq(off.on, false);
        eq(off.blocked, false, 'nothing is blocked by a limit nobody set');
        eq(off.spent, 4000, 'but what was spent is still there to show');

        // Zero reads as "no limit", not as "blocked from the first second":
        // a limit that bites the moment it is switched on looks like a bug.
        const zero = TimeLimits.statusFor(state, { twitterDailyLimit: true, twitterLimitMinutes: 0 }, 'twitter', noon);
        eq(zero.on, false);
        eq(zero.blocked, false);
    });

    check('the block lands when the day is spent, not before', () => {
        const settings = { redditDailyLimit: true, redditLimitMinutes: 30 };
        const under = spent('reddit', 1700);
        eq(TimeLimits.statusFor(under, settings, 'reddit', noon).blocked, false);
        eq(TimeLimits.statusFor(under, settings, 'reddit', noon).remaining, 100);

        const over = TimeLimits.add(under, 'reddit', 100, noon);
        const status = TimeLimits.statusFor(over, settings, 'reddit', noon);
        eq(status.blocked, true);
        eq(status.remaining, 0);
        eq(status.allowed, 1800);
    });

    check('a tally from another day cannot block today', () => {
        const yesterday = spent('reddit', 9999, noon - A_DAY);
        const status = TimeLimits.statusFor(yesterday, { redditDailyLimit: true, redditLimitMinutes: 30 }, 'reddit', noon);
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

    check('every settings key a site names is a setting that exists', () => {
        const Settings = require('../src/shared/settings.js');
        for (const site of TimeLimits.list()) {
            eq(site.onKey in Settings.DEFAULTS, true, site.onKey);
            eq(site.minutesKey in Settings.DEFAULTS, true, site.minutesKey);
        }
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

    console.log('\n' + '='.repeat(52));
    console.log(`${passed}/${passed + failed} passed` + (failed ? `  (${failed} FAILED)` : '  — all green'));
    process.exit(failed ? 1 : 0);
})();
