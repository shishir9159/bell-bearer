/**
 * Reading your roster off a site, and working through a list to follow or join
 * what is in it — the half that has to happen on the site's own pages.
 *
 * What a job *is* lives in src/shared/roster.js; this is the part that reads
 * x.com's and reddit.com's markup and clicks their buttons. Two rules govern
 * everything here and both are about not being mistaken for a robot:
 *
 *   One action per page load, then a navigation. Not because it is tidier —
 *   because it is what a person does, and because a job that survives a page
 *   load survives the browser being closed halfway through a four-hundred
 *   account list.
 *
 *   Stop at the first thing that is not understood. No retries, no second
 *   attempt with a different selector, no pressing on to the next name. A
 *   Follow button that is not where it should be might mean X has renamed a
 *   testid; it might equally mean X has put a "you are doing that too much"
 *   interstitial in front of it, and the difference is not one this code can
 *   tell. The job pauses with a note and waits to be looked at.
 *
 * Nothing here calls an API or touches a token. Every name is a page the
 * browser navigates to and a button the mouse would have clicked.
 *
 * The selectors follow this repo's rule for somebody else's markup: several
 * spellings each, newest first, in one table per site, and never collapsed to
 * "the current one". Both of these sites rename their classes constantly;
 * `data-testid` on X and the old-Reddit class names are the two stable-ish
 * things, which is why almost everything below is one of those.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Roster = ns.Roster || req('../shared/roster.js');
    const Selectors = ns.Selectors || req('../shared/selectors.js');

    /** This page, for the job's lease. A fresh one per load, which is right. */
    const PAGE_ID = Math.random().toString(36).slice(2, 10);

    const SELECTORS = Object.freeze({
        twitter: Object.freeze({
            /** The signed-in account's own link in the left navigation. */
            me: [
                'a[data-testid="AppTabBar_Profile_Link"]',
                'nav[role="navigation"] a[aria-label="Profile"]',
                '[data-testid="SideNav_AccountSwitcher_Button"] [href^="/"]',
            ],
            /** One row of a following list. */
            cell: ['[data-testid="UserCell"]', '[data-testid="cellInnerDiv"] [data-testid="UserCell"]'],
            /**
             * The profile header's action row — More, notify, message, Follow.
             * Everything the job clicks is looked for inside this and nowhere
             * else; see actionScope for why that is not optional.
             */
            actions: ['[data-testid="userActions"]'],
            /** The Follow button, before it is pressed. */
            follow: ['[data-testid$="-follow"]'],
            /** And after — how the click is confirmed rather than assumed. */
            followed: ['[data-testid$="-unfollow"]'],
            /**
             * X saying no. An error panel, or the "Caution: this account is
             * temporarily restricted" sheet — either is a reason to stop
             * entirely rather than to try the next name.
             */
            trouble: [
                '[data-testid="error-detail"]',
                '[data-testid="denied"]',
                '[data-testid="sheetDialog"] [data-testid="confirmationSheetConfirm"]',
            ],
        }),
        reddit: Object.freeze({
            /** One row of old Reddit's "my subreddits" listing. */
            cell: [
                '.subreddit a.title[href*="/r/"]',
                '#siteTable a.title[href*="/r/"]',
                'a.title[href*="/r/"]',
            ],
            /** The link to the next page of that listing. */
            next: ['.nextprev a[rel~="next"]', 'span.next-button > a', '.next-button a'],
            /** Old Reddit's subscribe toggle, and new Reddit's Join button. */
            follow: [
                '.fancy-toggle-button a.option.add',
                '.side .fancy-toggle-button a.add',
                'button[data-testid="join-or-leave-button"]',
                'shreddit-join-button button',
            ],
            followed: ['.fancy-toggle-button a.option.remove:not(.hidden)'],
            // Pointedly not a bare `.error`: old Reddit puts that class on
            // every inline form complaint on the page, and halting the job
            // because a comment box was unhappy would be a bug that looked
            // like a rate limit.
            trouble: ['.ratelimit', '#classy-error', '.interstitial-message'],
        }),
    });

    const TABLES = Object.fromEntries(Object.entries(SELECTORS).map(([site, table]) => [site, Selectors.table(table)]));
    const first = (site, names, scope = document) => (TABLES[site] ? TABLES[site].find(names, scope) : null);
    const all = (site, names, scope = document) => (TABLES[site] ? TABLES[site].findAll(names, scope) : []);

    /**
     * Where on the page a Follow or Join button may be looked for.
     *
     * On x.com this is the profile header's action row and *only* that row.
     * A profile page carries other Follow buttons — the "You might like"
     * module in the sidebar, and sometimes one in the timeline itself — and
     * `[data-testid$="-follow"]` matches every one of them. Taking the first in
     * document order would have followed whoever X happened to be suggesting
     * instead of the account the job is on, which is the worst thing in here
     * that could go wrong: silent, plausible-looking, and about somebody else's
     * account.
     *
     * No header is a null rather than a fallback to the document. The job stops
     * on a null, and stopping is the right answer — a profile page with no
     * action row is not a page this understands.
     *
     * On reddit.com the subscribe toggle is the subreddit's own and there is
     * nothing else on the page it could be confused with, so the scope is the
     * document.
     */
    function actionScope(site) {
        if (site !== 'twitter') return document;
        const more = first(site, 'actions');
        return (more && more.parentElement) || null;
    }

    const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

    /**
     * Wait for something to appear, up to `ms`. Polled rather than observed:
     * what is being waited for is a button in a page the site streams in over
     * a second or two, and a poll every 250ms for eight seconds is both
     * simpler and easier to reason about than an observer plus a timeout.
     */
    async function waitFor(pick, ms = 8000) {
        const until = Date.now() + ms;
        for (;;) {
            const found = pick();
            if (found) return found;
            if (Date.now() >= until) return null;
            await sleep(250);
        }
    }

    /** '@handle' → 'handle' from an x.com profile href. */
    const handleFromHref = (href) => Roster.handleFromHref(href);

    /** 'name' from a /r/name/ href. */
    function subFromHref(href) {
        const match = /\/r\/([A-Za-z0-9_]{2,21})(?:[/?#]|$)/.exec(String(href || ''));
        return match ? match[1] : '';
    }

    /**
     * @param {object} deps
     * @param {string} deps.site      what detectSite() returned
     * @param {(message: string, type?: string) => void} deps.notify
     */
    function createRoster({ site, notify }) {
        const rules = Roster.siteOf(site);

        // ------------------------------------------------------ bookkeeping

        /** Stop the job, say why, and hand it back. */
        function halt(status, note) {
            return Roster.updateJob((job) => {
                if (!job || job.site !== site) return job;
                return { ...Roster.release(job), status, note };
            });
        }

        const finish = (note) => halt('done', note || '');

        /**
         * Leave for another page of the site, handing the job over first.
         *
         * The order matters: a page that navigated while still holding the
         * lease would leave the job untouchable for two and a half minutes,
         * and the page that arrives is the one that has to pick it up.
         */
        async function goTo(url) {
            await Roster.updateJob((job) => (job && job.site === site ? Roster.release(job) : job));
            location.assign(url);
        }

        /** The job as it stands, or null when there is nothing of ours to do. */
        async function mine() {
            const job = Roster.forDay(await Roster.loadJob());
            if (!job || job.site !== site) return null;
            if (!Roster.isRunning(job)) return null;
            return job;
        }

        // ------------------------------------------------------- reading

        /**
         * Twitter: scroll the following list and write down who is in it.
         *
         * One page, not a walk — X pages that list by fetching as you scroll,
         * so the whole of it arrives in this one script. The gap between
         * scrolls is the same order as a person flicking a trackpad, and the
         * list is banked every so often so a tab closed two thousand accounts
         * in has not thrown them away.
         */
        async function readTwitter(job) {
            const me = first(site, 'me');
            const handle = handleFromHref(me && me.getAttribute('href'));
            const want = handle ? `/${handle}/following` : '';

            if (!handle) {
                return halt('paused', 'Could not tell which account is signed in — open x.com and try again.');
            }
            if (location.pathname.toLowerCase() !== want.toLowerCase()) {
                return goTo(`https://x.com${want}`);
            }

            const found = new Map((job.found || []).map((name) => [name.toLowerCase(), name]));
            let still = 0;
            let rounds = 0;

            // Four quiet rounds is the end of the list; 600 is a list longer
            // than anyone has and a runaway loop either way.
            while (still < 4 && rounds < 600) {
                rounds++;
                const before = found.size;
                for (const cell of all(site, 'cell')) {
                    const link = cell.querySelector('a[href^="/"]');
                    const name = handleFromHref(link && link.getAttribute('href'));
                    if (name) found.set(name.toLowerCase(), name);
                }
                still = found.size > before ? 0 : still + 1;

                if (first(site, 'trouble')) {
                    await bank(found);
                    return halt('paused', `Twitter stopped answering after ${found.size} ${rules.many}. Leave it a while and start again.`);
                }

                // Every twentieth round, so a closed tab does not cost the lot.
                if (rounds % 20 === 0) {
                    await bank(found);
                    const still_ours = await mine();
                    if (!still_ours) return null;
                }

                window.scrollTo(0, document.documentElement.scrollHeight);
                await sleep(900 + Math.round(Math.random() * 700));
            }

            await bank(found);
            await Roster.saveRoster(site, [...found.values()]);
            notify(`Read ${found.size} ${found.size === 1 ? rules.one : rules.many} — the list is in the dashboard`, 'success');
            return finish(`${found.size} ${rules.many}`);
        }

        const bank = (found) => Roster.updateJob((job) => (job && job.site === site
            ? { ...Roster.claim(job, PAGE_ID), found: [...found.values()] }
            : job));

        /**
         * Reddit: walk old Reddit's paginated list of your subreddits.
         *
         * old.reddit.com rather than the current site, and this is the one
         * place in the extension that prefers it: `/subreddits/mine/subscriber`
         * there is a plain paginated page of links, which is both far cheaper
         * to read than the virtualised list new Reddit draws and far less
         * likely to change under us. It is the same account and the same
         * cookie either way.
         */
        async function readReddit(job) {
            const listing = /\/subreddits\/mine/.test(location.pathname);
            if (!listing) return goTo(START.reddit);

            const found = new Map((job.found || []).map((name) => [name.toLowerCase(), name]));
            for (const link of all(site, 'cell')) {
                const name = subFromHref(link.getAttribute('href'));
                if (name) found.set(name.toLowerCase(), name);
            }
            await bank(found);

            const next = first(site, 'next');
            if (next && next.href && found.size < Roster.MAX_NAMES) {
                // A page every few seconds, which is slower than clicking
                // "next" yourself and well inside what Reddit asks for.
                await sleep(2500 + Math.round(Math.random() * 2000));
                if (!(await mine())) return null;
                return goTo(next.href);
            }

            await Roster.saveRoster(site, [...found.values()]);
            notify(`Read ${found.size} ${found.size === 1 ? rules.one : rules.many} — the list is in the dashboard`, 'success');
            return finish(`${found.size} ${rules.many}`);
        }

        // ------------------------------------------------------- applying

        /** Where one name's page is. */
        const pageFor = (name) => (site === 'twitter'
            ? `https://x.com/${name}`
            : `https://old.reddit.com/r/${name}/`);

        /** Is this page the one for `name`? */
        function onPageFor(name) {
            if (site === 'twitter') {
                return location.pathname.toLowerCase() === `/${name}`.toLowerCase();
            }
            return subFromHref(location.pathname).toLowerCase() === name.toLowerCase();
        }

        /**
         * Follow or join whoever this page is, then go to the next one.
         *
         * Every exit from here either advances the job by exactly one or stops
         * it. What it must never do is try again: see the note at the head of
         * the file about what an absent button might mean.
         */
        async function applyOne(job) {
            const name = Roster.currentName(job);
            if (!name) {
                notify(`Done — ${job.done} ${job.done === 1 ? rules.one : rules.many} ${rules.verbing}`, 'success');
                return finish(`${job.done} ${rules.verbing}, ${job.skipped} already there`);
            }

            if (Roster.atCap(job)) {
                return halt('waiting',
                    `That is today's ${rules.pace.cap}. Open this again tomorrow and it carries on from ${rules.prefix}${name}.`);
            }

            if (!onPageFor(name)) return goTo(pageFor(name));

            if (first(site, 'trouble')) {
                return halt('paused', `${rules.name} put something in the way at ${rules.prefix}${name}. Stopped rather than pressed on.`);
            }

            // Everything below is looked for inside the header's own action
            // row — see actionScope. A page with no row is a page to stop on.
            const scope = await waitFor(() => actionScope(site));
            if (!scope) {
                return halt('paused',
                    `No action row on ${rules.prefix}${name}, so nothing here could be clicked safely.`);
            }

            // Already there: not a failure and not an action, so it costs
            // nothing against the day's cap. Re-running a list you half
            // applied yesterday should be cheap.
            if (first(site, 'followed', scope)) return step(job, name, 'skipped');

            const button = await waitFor(() => first(site, 'follow', scope));
            if (!button) {
                return halt('paused',
                    `No ${rules.verb} button on ${rules.prefix}${name}. It may be gone, private, or ${rules.name} may be asking something first — stopped rather than guessed.`);
            }

            button.click();

            // Confirmed rather than assumed. A click that silently did nothing
            // is exactly what a rate limit looks like from in here, and
            // counting it as done would walk the whole list doing nothing.
            const worked = await waitFor(() => first(site, 'followed', scope), 6000);
            if (!worked) {
                return halt('paused',
                    `${rules.prefix}${name} did not take. Stopping here — this is what being rate-limited looks like, and pressing on is how an account gets suspended.`);
            }

            return step(job, name, 'done');
        }

        /**
         * One name behind us: record it, wait out the gap, and move on.
         *
         * The wait happens here rather than on arrival at the next page so the
         * gap is between two *actions*, which is the thing being paced. Waiting
         * on arrival would put the page load inside the gap and make it
         * shorter than it reads.
         */
        async function step(job, name, how) {
            const now = Date.now();
            const wait = how === 'done' ? Roster.nextDelay(site) : 500;

            const next = await Roster.updateJob((current) => {
                if (!current || current.site !== site) return current;
                const day = Roster.forDay(current, now);
                // Another page moved the cursor while we were clicking. Ours
                // is the duplicate, so it is dropped rather than counted.
                if (day.at !== job.at) return current;
                return {
                    ...Roster.claim(day, PAGE_ID, now),
                    // Back to running: the job may have been 'waiting' on
                    // yesterday's cap, and forDay has just cleared that.
                    status: 'running',
                    at: day.at + 1,
                    done: day.done + (how === 'done' ? 1 : 0),
                    skipped: day.skipped + (how === 'skipped' ? 1 : 0),
                    today: day.today + (how === 'done' ? 1 : 0),
                    actedAt: now,
                    nextAt: now + wait,
                    note: '',
                };
            });

            if (!Roster.isRunning(next) || next.at === job.at) return null;
            if (!Roster.currentName(next)) {
                notify(`Done — ${next.done} ${next.done === 1 ? rules.one : rules.many} ${rules.verbing}`, 'success');
                return finish(`${next.done} ${rules.verbing}`);
            }

            await sleep(Math.max(0, next.nextAt - Date.now()));
            // Re-read: the dashboard's Stop is a write to the same key, and
            // this is the one place the job sits still long enough to miss it.
            const after = await mine();
            if (!after) return null;
            return goTo(pageFor(Roster.currentName(after)));
        }

        // --------------------------------------------------------- wiring

        /**
         * Pick the job up, if there is one for this site and nothing else has
         * it. Called once per page load and never on a timer: a job advances by
         * navigating, so every step is a new load and a new call to this.
         */
        async function install() {
            if (!rules) return;

            const job = await mine();
            if (!job) return;
            if (!Roster.canClaim(job, PAGE_ID)) return;

            await Roster.updateJob((current) => (current && current.site === site
                ? Roster.claim(current, PAGE_ID) : current));

            try {
                if (job.action === 'read') {
                    await (site === 'twitter' ? readTwitter(job) : readReddit(job));
                } else {
                    await applyOne(job);
                }
            } catch (error) {
                // Including the extension being reloaded out from under this
                // page, which throws from every chrome.* call. A job left
                // running with a live lease would be stuck; halting is the
                // recoverable end.
                await halt('paused', `Stopped on an error: ${error && error.message ? error.message : 'unknown'}`);
            }
        }

        return { install };
    }

    /** Where a read job starts, before it knows anything about the account. */
    const START = Object.freeze({
        twitter: 'https://x.com/home',
        reddit: 'https://old.reddit.com/subreddits/mine/subscriber/?limit=100',
    });

    const RosterContent = { createRoster, SELECTORS, START, actionScope, handleFromHref, subFromHref };

    root.BB = root.BB || {};
    root.BB.RosterContent = RosterContent;
    if (typeof module !== 'undefined' && module.exports) module.exports = RosterContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
