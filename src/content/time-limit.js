/**
 * The daily limit, on whatever site has one: counting the time, and standing
 * in the way once it is spent.
 *
 * Which sites those are is not this file's business — it is the list in
 * Settings → General, kept by src/shared/limit-sites.js. This runs on every
 * page, asks the list whether the host it is on has a row, and does nothing at
 * all when it does not, which is the common case.
 *
 * Two kinds of limit, and the difference is only in what `blocked` comes out
 * as: a budget of minutes a day, and a window of clock hours the site is
 * allowed between. Both are counted the same way, because the Time view shows
 * what the day has gone on either way.
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
 * can say what was spent and when it comes back. It also carries a snooze:
 * ten minutes, as many times as you ask, and it says how many times you have.
 * A limit with no way through it is a limit you switch off for good the first
 * time it is wrong about your afternoon.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const TimeLimits = ns.TimeLimits || req('../shared/time-limits.js');
    const LimitSites = ns.LimitSites || req('../shared/limit-sites.js');
    const Settings = ns.Settings || req('../shared/settings.js');
    const Dom = ns.Dom || req('../shared/dom.js');

    const SHEET_ID = 'bb-time-limit';
    /** How often the page banks what it has spent, and re-reads the clock. */
    const TICK_MS = 15000;

    const esc = (text) => Dom.escapeHtml(text);

    /** "once" / "twice" / "5 times" — for how often a block has been snoozed. */
    function times(n) {
        if (n === 1) return 'once';
        if (n === 2) return 'twice';
        return `${n} times`;
    }

    /**
     * @param {object} deps
     * @param {string} deps.site         what detectSite() returned
     * @param {string} [deps.host]       the hostname to look the limit up by
     * @param {() => Promise<object>} deps.appearance
     */
    function createTimeLimit({ site, host = location.hostname, appearance }) {
        const at = LimitSites.normalizeHost(host);
        /** "Twitter" for a site with a workspace, the bare host otherwise. */
        const known = TimeLimits.get(site);
        const name = (known && known.host === at ? known.name : '') || at;

        let limit = null;   // the list row covering this host, or null
        let state = TimeLimits.blank();
        let sheet = null;
        let timer = 0;
        let since = 0;      // when the seconds now being counted started

        const watching = () => document.visibilityState === 'visible' && document.hasFocus();
        const status = () => TimeLimits.statusFor(state, limit, at);

        /** Bank the gap since the last tick, if it was spent looking at this. */
        async function bank() {
            const now = Date.now();
            const spent = since ? Math.round((now - since) / 1000) : 0;
            since = watching() ? now : 0;
            if (spent <= 0) return;
            // A failed update keeps what this page had. It used to hand back
            // a blank day with this credit in it, and lift the block.
            state = (await TimeLimits.update((current) => TimeLimits.add(current, at, spent, now))) || state;
            render();
        }

        /**
         * Bank, then look again.
         *
         * The second half is not redundant: a window limit turns over on the
         * clock rather than on anything this page does, and a snooze runs out
         * the same way, so the sheet has to be reconsidered even on a tick that
         * credited nothing.
         */
        function tick() {
            bank();
            render();
        }

        /**
         * The timer runs while this host has a limit at all, whether or not the
         * page is being watched — the clock moves either way, and a window that
         * closed while the tab sat behind another window has to be found when
         * it comes back. A host with no limit costs nothing: no timer, no
         * reads, no writes.
         */
        function sync() {
            const on = status().on;

            if (on && !timer) {
                since = watching() ? Date.now() : 0;
                timer = setInterval(tick, TICK_MS);
            } else if (!on && timer) {
                clearInterval(timer);
                timer = 0;
                bank();
            } else if (!on) {
                since = 0;
            } else {
                // Still on. Start or stop counting according to what changed.
                since = watching() ? (since || Date.now()) : 0;
            }
            render();
        }

        // ------------------------------------------------------- the sheet

        function titleHtml(now) {
            if (now.mode === 'window') {
                return `${esc(name)} is yours ${esc(LimitSites.clockText(limit.from))}
                        to ${esc(LimitSites.clockText(limit.to))}`;
            }
            return `That is ${esc(TimeLimits.human(now.allowed))} of ${esc(name)} today`;
        }

        function bodyHtml(now) {
            if (now.mode === 'window') {
                return `Outside those hours it is covered. You set the window; this is it
                        holding. Nothing about today is kept past midnight.`;
            }
            return `You set the limit; this is it arriving. The tally starts again
                    at midnight, and nothing about today is kept past that.`;
        }

        function sheetHtml(now) {
            const snoozeMinutes = Math.round(TimeLimits.SNOOZE_MS / 60000);
            return `
                <div class="bb-limit-card">
                    <p class="bb-limit-kicker">Bell Bearer</p>
                    <h2 class="bb-limit-title">${titleHtml(now)}</h2>
                    <p class="bb-limit-body">${bodyHtml(now)}</p>
                    <p class="bb-limit-spent">${esc(TimeLimits.human(now.spent))} spent</p>
                    <button type="button" class="bb-limit-snooze" data-bb-snooze="1">
                        Snooze ${snoozeMinutes} minutes
                    </button>
                    ${now.snoozes
                        ? `<p class="bb-limit-tally">Snoozed ${esc(times(now.snoozes))} already today.</p>`
                        : ''}
                </div>`;
        }

        /**
         * Ten more minutes.
         *
         * Written to storage rather than held here, so every tab of the site
         * stands its sheet down together — two windows of the same site, each
         * with its own sheet and only one of them snoozed, is not a state
         * anyone would read as working.
         */
        async function onSnooze() {
            state = (await TimeLimits.update((current) => TimeLimits.snooze(current, at))) || state;
            render();
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
            // Delegated to the sheet, which outlives every repaint of its
            // contents — sheetHtml is written over on each render, so a
            // listener on the button itself would be dropped with it.
            sheet.addEventListener('click', (event) => {
                if (event.target.closest('[data-bb-snooze]')) onSnooze();
            });
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
            // The listener is on the sheet, not on the card, so writing the
            // card over does not take the snooze button's handler with it.
            sheet.innerHTML = sheetHtml(now);
            return undefined;
        }

        /** Re-read the list; the row may have been added, changed or dropped. */
        async function reload() {
            limit = LimitSites.entryFor(await LimitSites.load(), at);
            sync();
        }

        async function install() {
            if (!at) return;

            [state, limit] = await Promise.all([
                TimeLimits.load(),
                LimitSites.load().then((sites) => LimitSites.entryFor(sites, at)),
            ]);

            // Another tab of the same site counts into the same tally, and the
            // limit itself can be changed from the dashboard while this page is
            // open — including added to a site that had none a moment ago.
            Settings.watch([TimeLimits.KEY, LimitSites.KEY], async (changed) => {
                if (TimeLimits.KEY in changed) state = TimeLimits.forDay(changed[TimeLimits.KEY]);
                if (LimitSites.KEY in changed) {
                    limit = LimitSites.entryFor(changed[LimitSites.KEY], at);
                }
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

        return { install, sync, reload, status, bank, snooze: onSnooze };
    }

    const TimeLimitContent = { createTimeLimit, TICK_MS, times };

    root.BB = root.BB || {};
    root.BB.TimeLimitContent = TimeLimitContent;
    if (typeof module !== 'undefined' && module.exports) module.exports = TimeLimitContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
