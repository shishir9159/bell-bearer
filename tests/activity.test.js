/**
 * The activity store, and the relative-time formatter the video cards use.
 *
 * Activity is the one new subsystem that writes to storage on a timer, so the
 * things worth pinning are the ones that would quietly corrupt a total: it
 * must record nothing at all while the setting is off, it must credit elapsed
 * wall time rather than counting ticks, and it must drop a gap that is really
 * the machine having been away.
 *
 * Every test drives `tick`'s clock explicitly rather than sleeping. Sleeping
 * through the elapsed time would make the suite both slow and dependent on
 * timer resolution, and none of this logic is about real time passing — it is
 * arithmetic on two timestamps.
 */

const Activity = () => window.BB.Activity;

/** A fixed, safely mid-day starting point so hour buckets never wrap a date. */
const T0 = new Date(2026, 6, 15, 13, 0, 0).getTime();
const secs = (n) => n * 1000;

/** Re-arm the store: no data, no in-memory marker, tracking on unless told. */
function freshActivity({ on = true } = {}) {
    MockChrome.reset({ localStore: { trackActivity: on } });
    Activity().blur();
}

const tabAt = (url, title) => ({ url, title });

/** The stored record for the day `at` falls on, or null. */
function dayRecord(at = T0) {
    return MockChrome.state.localStore[Activity().dayStore(window.BB.Time.dayKey(at))] || null;
}

/** The days stored one key each, oldest first. */
function storedDays() {
    const prefix = Activity().DAY_PREFIX;
    return Object.keys(MockChrome.state.localStore)
        .filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)).sort();
}

/** Local-date key, matching the one `dayRecord` derives from a timestamp. */
const keyFor = (at) => window.BB.Time.dayKey(at);

suite('activity — recording', () => {

    test('records nothing at all while tracking is off', async () => {
        freshActivity({ on: false });

        await Activity().tick(tabAt('https://github.com/a', 'A'), T0);
        await Activity().tick(tabAt('https://github.com/a', 'A'), T0 + secs(60));

        assertDeepEqual(storedDays(), [], 'the store must not even be created while the setting is off');
        assertEqual(MockChrome.state.localStore[Activity().DAYS_KEY], undefined);
    });

    test('the first tick records nothing — there is no elapsed time yet', async () => {
        freshActivity();
        await Activity().tick(tabAt('https://github.com/a', 'A'), T0);
        assertEqual(dayRecord(), null);
    });

    test('credits the gap between two ticks to what was focused first', async () => {
        freshActivity();

        await Activity().tick(tabAt('https://github.com/one', 'One'), T0);
        // Focus has moved on, but the 30 elapsed seconds belong to the old page.
        await Activity().tick(tabAt('https://example.com/two', 'Two'), T0 + secs(30));

        const day = dayRecord();
        assert(day, 'a day record should exist');
        assertEqual(day.hosts['github.com'], 30);
        assertEqual(day.hosts['example.com'], undefined,
            'the tab only just seen has not accrued anything yet');
        assertEqual(day.total, 30);
    });

    test('elapsed time is measured, not counted in ticks', async () => {
        freshActivity();

        // One long gap, as happens when the MV3 worker is suspended between
        // alarms. Counting ticks would score this 1 second; measuring gives 45.
        await Activity().tick(tabAt('https://a.test/x', 'X'), T0);
        await Activity().tick(tabAt('https://a.test/x', 'X'), T0 + secs(45));

        assertEqual(dayRecord().total, 45);
    });

    test('a gap longer than the idle threshold is dropped, not counted', async () => {
        freshActivity();

        // Machine asleep for ten minutes. That is not time at the screen.
        await Activity().tick(tabAt('https://a.test/x', 'X'), T0);
        await Activity().tick(tabAt('https://a.test/x', 'X'), T0 + secs(600));

        assertEqual(dayRecord(), null);
    });

    test('www. is stripped so one site is not counted as two', () => {
        assertEqual(Activity().hostOf('https://www.youtube.com/watch?v=x'), 'youtube.com');
        assertEqual(Activity().hostOf('https://youtube.com/watch?v=x'), 'youtube.com');
    });

    test('non-http pages are not sites', () => {
        assertEqual(Activity().hostOf('chrome://extensions'), null);
        assertEqual(Activity().hostOf('about:blank'), null);
        assertEqual(Activity().hostOf(''), null);
        assertEqual(Activity().hostOf('file:///c:/notes.txt'), null);
    });

    test('a tab with no host clears the marker rather than carrying it over', async () => {
        freshActivity();

        await Activity().tick(tabAt('https://github.com/a', 'A'), T0);
        await Activity().tick(tabAt('chrome://extensions', 'Extensions'), T0 + secs(10));
        const afterFirst = dayRecord().total;

        // A long stretch on the settings page, then back. The marker was
        // cleared, so that stretch is credited to nothing.
        await Activity().tick(tabAt('https://github.com/a', 'A'), T0 + secs(70));

        assertEqual(dayRecord().total, afterFirst,
            'time on a non-http page is not credited to any site');
        assertEqual(afterFirst, 10);
    });

    test('blur() stops the clock, so a closed laptop does not accrue time', async () => {
        freshActivity();

        await Activity().tick(tabAt('https://github.com/a', 'A'), T0);
        Activity().blur();
        await Activity().tick(tabAt('https://github.com/a', 'A'), T0 + secs(30));

        assertEqual(dayRecord(), null, 'the gap spanned a blur, so it is not screen time');
    });

    test('the marker is kept somewhere a restarted worker can still find it', async () => {
        // In MV3 the service worker is torn down a few seconds after it goes
        // idle, which is most of the gap between two alarms. While the marker
        // was a plain variable it died with the worker, so every tick was the
        // first tick and the store never gained a single second.
        freshActivity();
        await Activity().tick(tabAt('https://a.test/x', 'X'), T0);

        const marker = MockChrome.state.sessionStore[Activity().LAST_KEY];
        assert(marker && marker.host === 'a.test',
            'the marker outlives the process, in session storage');
        assertEqual(MockChrome.state.localStore[Activity().LAST_KEY], undefined,
            'and it is not written to disk twice a minute to do it');
    });

    test('the longest single page is tracked, and accumulates across ticks', async () => {
        freshActivity();

        await Activity().tick(tabAt('https://a.test/x', 'Short page'), T0);
        await Activity().tick(tabAt('https://b.test/y', 'Long page'), T0 + secs(10));
        await Activity().tick(tabAt('https://b.test/y', 'Long page'), T0 + secs(40));
        await Activity().tick(tabAt('https://c.test/z', 'Another'), T0 + secs(70));

        const day = dayRecord();
        assertEqual(day.top.title, 'Long page');
        assertEqual(day.top.host, 'b.test');
        assertEqual(day.top.seconds, 60, 'the two stretches on it are summed, not replaced');
        assertEqual(day.total, 70);
    });

    test('time lands in the hour bucket it happened in', async () => {
        freshActivity();

        await Activity().tick(tabAt('https://a.test/x', 'X'), T0);
        await Activity().tick(tabAt('https://a.test/x', 'X'), T0 + secs(30));

        const day = dayRecord();
        assertEqual(day.hours.length, 24);
        assertEqual(day.hours.reduce((a, b) => a + b, 0), day.total,
            'the hour buckets sum to the day total');
        assertEqual(day.hours[new Date(T0).getHours()], 30);
    });

    test('a gap is filed under the day it started, not the day it was noticed', async () => {
        freshActivity();

        const beforeMidnight = new Date(2026, 6, 15, 23, 59, 40).getTime();
        await Activity().tick(tabAt('https://a.test/x', 'X'), beforeMidnight);
        await Activity().tick(tabAt('https://a.test/x', 'X'), beforeMidnight + secs(40));

        assertDeepEqual(storedDays(), [keyFor(beforeMidnight)],
            'the whole stretch belongs to the day it began on');
    });

    test('clear() empties the store', async () => {
        freshActivity();
        await Activity().tick(tabAt('https://a.test/x', 'X'), T0);
        await Activity().tick(tabAt('https://a.test/x', 'X'), T0 + secs(30));
        assert(dayRecord(), 'something was recorded');

        await Activity().clear();
        assertDeepEqual(storedDays(), []);
    });
});

suite('activity — summary', () => {

    /** Write a day record directly; the summary is pure over what is stored. */
    function seed(store, offsetDays, record) {
        const key = keyFor(Date.now() - offsetDays * 864e5);
        store[key] = Object.assign(
            { total: 0, hours: new Array(24).fill(0), hosts: {}, top: null },
            record);
        return store;
    }

    function hoursAt(hour, seconds) {
        const hours = new Array(24).fill(0);
        hours[hour] = seconds;
        return hours;
    }

    test('sums hosts and hours across the requested window only', async () => {
        const store = {};
        seed(store, 0, { total: 100, hosts: { 'a.test': 100 }, hours: hoursAt(9, 100) });
        seed(store, 3, { total: 50, hosts: { 'b.test': 50 }, hours: hoursAt(14, 50) });
        seed(store, 20, { total: 999, hosts: { 'c.test': 999 }, hours: hoursAt(2, 999) });
        MockChrome.reset({ localStore: { trackActivity: true, [Activity().KEY]: store } });

        const week = await Activity().summary(7);
        assertEqual(week.total, 150, 'the 20-day-old day is outside a 7-day window');
        assertEqual(week.sites, 2);
        assertEqual(week.hosts[0].host, 'a.test', 'hosts come back ranked by time');
        assertEqual(week.peakHour, 9);
        assertEqual(week.days, 2, 'only the days with something recorded are counted');

        const month = await Activity().summary(30);
        assertEqual(month.total, 1149);
        assertEqual(month.hosts[0].host, 'c.test');
    });

    test('the longest page across the range wins, and days come back newest first', async () => {
        const store = {};
        seed(store, 0, { total: 60, hosts: { 'a.test': 60 }, top: { title: 'Today', host: 'a.test', seconds: 60 } });
        seed(store, 1, { total: 900, hosts: { 'b.test': 900 }, top: { title: 'Yesterday', host: 'b.test', seconds: 900 } });
        MockChrome.reset({ localStore: { trackActivity: true, [Activity().KEY]: store } });

        const summary = await Activity().summary(7);
        assertEqual(summary.longest.title, 'Yesterday');
        assertEqual(summary.daily.length, 2);
        assert(summary.daily[0].day > summary.daily[1].day, 'newest day first');
    });

    test('report() answers the window and the one before it from a single read', async () => {
        // The view shows a "vs the period before" delta. It used to read the
        // whole store twice — once for n days, once for 2n — to get it.
        const store = {};
        seed(store, 0, { total: 100, hosts: { 'a.test': 100 } });
        seed(store, 8, { total: 40, hosts: { 'b.test': 40 } });
        MockChrome.reset({ localStore: { trackActivity: true, [Activity().KEY]: store } });

        const { now, previousTotal } = await Activity().report(7);
        assertEqual(now.total, 100, 'the last 7 days');
        assertEqual(previousTotal, 40, 'the 7 days before those');
    });

    test('an empty store summarises to zeroes rather than throwing', async () => {
        MockChrome.reset({ localStore: { trackActivity: true } });
        const summary = await Activity().summary(7);
        assertEqual(summary.total, 0);
        assertEqual(summary.sites, 0);
        assertEqual(summary.days, 0);
        assertEqual(summary.longest, null);
        assertDeepEqual(summary.hosts, []);
    });
});

suite('activity — formatting', () => {

    test('human() reads the way a person would say it', () => {
        const human = Activity().human;
        assertEqual(human(0), '0m');
        assertEqual(human(45), '45s', 'under a minute, seconds');
        assertEqual(human(90), '2m', 'under an hour, minutes only');
        assertEqual(human(3600), '1h', 'a round hour drops the trailing 0m');
        assertEqual(human(3720), '1h 2m');
        assertEqual(human(7 * 3600 + 1800), '7h 30m');
    });
});

suite('relative time', () => {

    const now = Date.parse('2026-08-30T12:00:00Z');
    const ago = (ms) => window.BB.Time.relativeTime(now - ms, now);

    test('rounds down, so a card never ages a video past what it is', () => {
        // 13 days is a week and six days. Rounding up would call it two weeks,
        // which reads as older than the video actually is.
        assertEqual(ago(13 * 864e5), '1 week ago');
        assertEqual(ago(6 * 864e5), '6 days ago');
        assertEqual(ago(59 * 1e3), 'just now', 'under a minute');
    });

    test('singular and plural', () => {
        assertEqual(ago(6e4), '1 minute ago');
        assertEqual(ago(2 * 6e4), '2 minutes ago');
        assertEqual(ago(36e5), '1 hour ago');
        assertEqual(ago(864e5), '1 day ago');
        assertEqual(ago(31536e6), '1 year ago');
    });

    test('a feed dated in the future reads as just now, not a negative age', () => {
        // Clock skew between YouTube's feed and this machine is ordinary.
        assertEqual(window.BB.Time.relativeTime(now + 5e6, now), 'just now');
    });

    test('a missing date gets no label rather than a date at the epoch', () => {
        // Feed.parseFeed stores 0 when an entry carries no published date.
        // Treating that as an instant put "56 years ago" on the card.
        assertEqual(window.BB.Time.relativeTime(0, now), '');
        assertEqual(window.BB.Time.relativeTime(undefined, now), '');
        assertEqual(window.BB.Time.relativeTime(null, now), '');
    });
});
