/**
 * The daily limit on a real page; its arithmetic is in node-check.js. The
 * content script once read the settings mirror while it still held the
 * schema's defaults, and the watcher only fires on a change — so a page
 * loaded with a limit already set never put the sheet up. Every `install()`
 * below is a check on that.
 */
(function () {
    'use strict';

    const LimitSites = () => window.BB.LimitSites;
    const TimeLimits = () => window.BB.TimeLimits;
    const TimeLimitContent = () => window.BB.TimeLimitContent;

    const look = () => Promise.resolve({ theme: 'light', skin: 'default' });
    const sheet = () => document.getElementById('bb-time-limit');
    const text = () => String(sheet() ? sheet().textContent : '').replace(/[\s ]+/g, ' ').trim();
    const teardownSheet = () => { if (sheet()) sheet().remove(); };
    /** `HH:00`, `offset` hours from now. */
    const hourFromNow = (offset) => `${String((new Date().getHours() + offset + 24) % 24).padStart(2, '0')}:00`;

    async function stage({ host, minutes, from, to, spent = 0 }) {
        teardownSheet();
        await LimitSites().save({});
        await TimeLimits().save(TimeLimits().blank());
        await LimitSites().remember({ host, minutes, from, to });
        if (spent) await TimeLimits().save(TimeLimits().add(TimeLimits().blank(), host, spent));
        const limit = TimeLimitContent().createTimeLimit({ site: 'other', host, appearance: look });
        await limit.install();
        // showSheet awaits the appearance before it appends.
        await new Promise((done) => setTimeout(done, 0));
        return limit;
    }

    suite('the daily limit — the sheet on the page', () => {
        test('a budget already spent covers the page', async () => {
            await stage({ host: 'budget.test', minutes: 1, spent: 120 });
            assert(sheet(), 'no sheet on a page loaded with the limit spent');
            assert(/That is 1m of budget.test today/.test(text()), text().slice(0, 160));
            assert(/2m spent/.test(text()), 'and says what went on it');
            teardownSheet();
        });

        test('a budget with room left, or a host with no row, covers nothing', async () => {
            await stage({ host: 'budget.test', minutes: 30, spent: 120 });
            assertEqual(sheet(), null, 'two minutes of thirty');
            await stage({ host: 'nolimit.test', spent: 9999 });
            assertEqual(sheet(), null, 'a limit nobody set');
            teardownSheet();
        });

        test('the snooze takes the sheet down and counts itself', async () => {
            await stage({ host: 'budget.test', minutes: 1, spent: 120 });
            const button = sheet().querySelector('[data-bb-snooze]');
            assert(button, 'there is a way through it');
            button.click();
            // Through storage, which stands every tab of the site down at once.
            await new Promise((done) => setTimeout(done, 60));
            assertEqual(sheet(), null);
            assertEqual(TimeLimits().snoozesOn(await TimeLimits().load(), 'budget.test'), 1);
            teardownSheet();
        });

        test('a window covers the page outside its hours, naming them, and nothing inside', async () => {
            await stage({ host: 'window.test', from: hourFromNow(-2), to: hourFromNow(-1) });
            assert(sheet(), 'outside the hours it is covered');
            assert(/window.test is yours/.test(text()), text().slice(0, 200));

            await stage({ host: 'window.test', from: hourFromNow(0), to: hourFromNow(2) });
            assertEqual(sheet(), null, 'inside the window the site is yours');
            teardownSheet();
        });
    });
})();
