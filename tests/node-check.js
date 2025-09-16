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

const T0 = new Date(2026, 6, 15, 13, 0, 0).getTime();
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

    console.log('\n' + '='.repeat(52));
    console.log(`${passed}/${passed + failed} passed` + (failed ? `  (${failed} FAILED)` : '  — all green'));
    process.exit(failed ? 1 : 0);
})();
