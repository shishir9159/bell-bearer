/**
 * The daily time limit on x.com and reddit.com: counting the time, and
 * standing in the way once it is spent.
 *
 * The page counts its own seconds. Only a page can tell whether it is the one
 * being looked at — the tab on screen, in the window that has the machine's
 * focus — and "focused" is what the limit is about. A tab left open behind
 * another window is not time spent, and the worker sampling the active tab
 * could not tell the two apart.
 *
 * Time is credited as the gap between ticks rather than a count of them, so
 * a throttled timer in a tab the browser has decided to slow down does not
 * undercount, and src/shared/time-limits.js caps a single credit so a machine
 * waking from sleep cannot charge you for the night.
 *
 * The block is a sheet over the page rather than a redirect. Closing the tab
 * is deliberate; being bounced somewhere else is disorienting, and the sheet
 * can say what was spent and when it comes back.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const TimeLimits = ns.TimeLimits || req('../shared/time-limits.js');
    const Settings = ns.Settings || req('../shared/settings.js');

    const SHEET_ID = 'bb-time-limit';
    /** How often the page banks what it has spent. */
    const TICK_MS = 15000;

    /**
     * @param {object} deps
     * @param {string} deps.site         what detectSite() returned
     * @param {() => object} deps.getSettings
     * @param {() => Promise<object>} deps.appearance
     */
    function createTimeLimit({ site, getSettings, appearance }) {
        const known = TimeLimits.get(site);
        let state = TimeLimits.blank();
        let sheet = null;
        let timer = 0;
        let since = 0;  // when the seconds now being counted started

        const watching = () => document.visibilityState === 'visible' && document.hasFocus();

        function status() {
            return TimeLimits.statusFor(state, getSettings(), site);
        }

        /** Bank the gap since the last tick, if it was spent looking at this. */
        async function bank() {
            const now = Date.now();
            const spent = since ? Math.round((now - since) / 1000) : 0;
            since = watching() ? now : 0;
            if (spent <= 0) return;
            state = await TimeLimits.update((current) => TimeLimits.add(current, site, spent, now));
            render();
        }

        /**
         * Counting runs only while the page is watched and the limit is on.
         * A site with no limit set costs nothing at all: no timer, no reads,
         * no writes.
         */
        function sync() {
            const on = status().on;
            const run = on && watching();

            if (run && !timer) {
                since = Date.now();
                timer = setInterval(bank, TICK_MS);
            } else if (!run && timer) {
                clearInterval(timer);
                timer = 0;
                bank();
            } else if (!run) {
                since = 0;
            }
            render();
        }

        // ------------------------------------------------------- the sheet

        function sheetHtml(now) {
            const resets = new Date(TimeLimits.resetsAt())
                .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            return `
                <div class="bb-limit-card">
                    <p class="bb-limit-kicker">Bell Bearer</p>
                    <h2 class="bb-limit-title">That is ${TimeLimits.human(now.allowed)} of ${known.name} today</h2>
                    <p class="bb-limit-body">
                        You set the limit; this is it arriving. The tally starts again
                        at midnight, ${resets}, and nothing about today is kept past that.
                    </p>
                    <p class="bb-limit-spent">${TimeLimits.human(now.spent)} spent</p>
                </div>`;
        }

        async function showSheet() {
            if (sheet) return;
            sheet = document.createElement('div');
            sheet.id = SHEET_ID;
            sheet.className = 'bb-themed bb-limit-sheet';
            const look = await appearance();
            sheet.dataset.bbTheme = look.theme;
            sheet.dataset.bbSkin = look.skin;
            sheet.innerHTML = sheetHtml(status());
            document.documentElement.append(sheet);
        }

        function hideSheet() {
            if (!sheet) return;
            sheet.remove();
            sheet = null;
        }

        function render() {
            const now = status();
            if (!now.blocked) return hideSheet();
            if (!sheet) return showSheet();
            sheet.innerHTML = sheetHtml(now);
            return undefined;
        }

        async function install() {
            if (!known) return;

            state = await TimeLimits.load();

            // Another tab of the same site is counting into the same tally,
            // and the limit itself can be changed from the dashboard while
            // this page is open.
            Settings.watch([TimeLimits.KEY, known.onKey, known.minutesKey], async (changed) => {
                if (TimeLimits.KEY in changed) state = TimeLimits.forDay(changed[TimeLimits.KEY]);
                sync();
            });

            document.addEventListener('visibilitychange', sync);
            window.addEventListener('focus', sync);
            window.addEventListener('blur', sync);
            // The last few seconds before the tab goes are worth keeping;
            // pagehide is the one teardown event a bfcache'd page still gets.
            window.addEventListener('pagehide', bank);

            sync();
        }

        return { install, sync, status, bank };
    }

    const TimeLimitContent = { createTimeLimit, TICK_MS };

    root.BB = root.BB || {};
    root.BB.TimeLimitContent = TimeLimitContent;
    if (typeof module !== 'undefined' && module.exports) module.exports = TimeLimitContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
