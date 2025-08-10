/**
 * The daily limit as it actually behaves on a page: whether the sheet goes up,
 * whether the snooze takes it down, and whether a window closes on the clock.
 *
 * The arithmetic is in tests/node-check.js, which covers every shape of limit
 * in a second and needs no browser. What is here is the part that only a real
 * page can answer, and it exists because of a bug nothing else would have
 * caught: the content script was handed the settings mirror at a moment when
 * that mirror was still the schema's defaults, and the storage watcher inside
 * it only fires on a *change* — so on any page loaded with a limit already set,
 * nothing was ever counted and the sheet never appeared. Every assertion below
 * about `install()` putting a sheet up is really an assertion about that.
 *
 * Nothing here goes near a timer longer than a tick: the sheet is a function of
 * the store and the clock, and both are set up rather than waited for.
 */
(function () {
    'use strict';

    const LimitSites = () => window.BB.LimitSites;
    const TimeLimits = () => window.BB.TimeLimits;
    const TimeLimitContent = () => window.BB.TimeLimitContent;

    const look = () => Promise.resolve({ theme: 'light', skin: 'default' });
    const sheet = () => document.getElementById('bb-time-limit');
    const text = () => String(sheet() ? sheet().textContent : '').replace(/[\s ]+/g, ' ').trim();

    /** Two digits, for building a window relative to whatever time it is now. */
    const two = (n) => String(n).padStart(2, '0');

    /**
     * A limit and a tally, straight into storage, and a limit built over them.
     *
     * The host is a made-up one on purpose. These specs are about the machinery
     * rather than about x.com, and the machinery stopped being about any
     * particular site the day the limit became a list.
     */
    async function stage({ host, minutes, from, to, spent = 0 }) {
        teardownSheet();
        await LimitSites().save({});
        await TimeLimits().save(TimeLimits().blank());
        await LimitSites().remember({ host, minutes, from, to });
        if (spent) {
            await TimeLimits().save(TimeLimits().add(TimeLimits().blank(), host, spent));
        }
        const limit = TimeLimitContent().createTimeLimit({ site: 'other', host, appearance: look });
        await limit.install();
        // showSheet awaits the appearance before it appends, so the sheet is
        // one microtask behind install() returning.
        await new Promise((done) => setTimeout(done, 0));
        return limit;
    }

    function teardownSheet() {
        const up = sheet();
        if (up) up.remove();
    }

    suite('the daily limit — the sheet on the page', () => {
        test('a budget already spent covers the page', async () => {
            await stage({ host: 'budget.test', minutes: 1, spent: 120 });

            assert(sheet(), 'the sheet goes up on a page loaded with the limit already spent');
            assert(/That is 1m of budget.test today/.test(text()), text().slice(0, 160));
            assert(/2m spent/.test(text()), 'and says what went on it');
            teardownSheet();
        });

        test('a budget with room left covers nothing', async () => {
            await stage({ host: 'budget.test', minutes: 30, spent: 120 });
            assertEqual(sheet(), null, 'two minutes of thirty is not a spent day');
            teardownSheet();
        });

        test('a host with no row is not covered whatever has been spent', async () => {
            await stage({ host: 'nolimit.test', spent: 9999 });
            assertEqual(sheet(), null, 'nothing is blocked by a limit nobody set');
            teardownSheet();
        });

        test('the snooze takes the sheet down and counts itself', async () => {
            await stage({ host: 'budget.test', minutes: 1, spent: 120 });
            const button = sheet().querySelector('[data-bb-snooze]');
            assert(button, 'there is a way through it');

            button.click();
            // The snooze is written to storage, which is what stands every tab
            // of the site down at once — so this is a round trip, not a repaint.
            await new Promise((done) => setTimeout(done, 60));

            assertEqual(sheet(), null, 'ten minutes');
            assertEqual(TimeLimits().snoozesOn(await TimeLimits().load(), 'budget.test'), 1,
                'and it says so afterwards, which is the only check on it');
            teardownSheet();
        });

        test('a window outside its hours covers the page, and names them', async () => {
            // Two hours ending an hour ago, whatever time it is right now.
            const hour = new Date().getHours();
            const from = `${two((hour + 22) % 24)}:00`;
            const to = `${two((hour + 23) % 24)}:00`;
            await stage({ host: 'window.test', from, to });

            assert(sheet(), 'outside the hours it is covered');
            assert(/window.test is yours/.test(text()), text().slice(0, 200));
            teardownSheet();
        });

        test('a window inside its hours covers nothing', async () => {
            const hour = new Date().getHours();
            await stage({
                host: 'window.test',
                from: `${two(hour)}:00`,
                to: `${two((hour + 2) % 24)}:00`,
            });
            assertEqual(sheet(), null, 'inside the window the site is yours');
            teardownSheet();
        });
    });
})();
