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
    const RosterBar = ns.RosterBar || req('./roster-bar.js');

    /** This page, for the job's lease. A fresh one per load, which is right. */
    const PAGE_ID = Math.random().toString(36).slice(2, 10);

    /**
     * Where the job last sent this tab, carried over the navigation in the
     * tab's own sessionStorage — which survives a same-origin load and is the
     * tab's alone, so a page that finds it knows it is the one that was sent.
     *
     * That is what tells "the site sent us somewhere else" from "the user
     * opened another page of the site". Old Reddit sends a signed-out visitor
     * from /subreddits/mine to /login; the read job used to send the tab back
     * to the listing from there, be sent to /login again, and go round once a
     * second for as long as the tab stayed open.
     */
    const HOP_KEY = 'bb-roster-hop';

    function markHop(path) {
        try { sessionStorage.setItem(HOP_KEY, path.toLowerCase()); } catch (_) { /* storage blocked: no loop guard, the lease still holds */ }
    }

    const PAGE = Object.freeze({
        path: () => location.pathname,
        href: () => location.href,
        assign: (url) => location.assign(url),
    });

    function takeHop() {
        try {
            const path = sessionStorage.getItem(HOP_KEY);
            sessionStorage.removeItem(HOP_KEY);
            return path || '';
        } catch (_) {
            return '';
        }
    }

    const SELECTORS = Object.freeze({
        twitter: Object.freeze({
            /** The signed-in account's own link in the left navigation. */
            me: [
                'a[data-testid="AppTabBar_Profile_Link"]',
                'nav[role="navigation"] a[aria-label="Profile"]',
            ],
            /**
             * The account switcher's avatar, whose testid ends in the handle —
             * for a layout too narrow to draw the Profile link.
             */
            meAvatar: ['[data-testid="SideNav_AccountSwitcher_Button"] [data-testid^="UserAvatar-Container-"]'],
            /**
             * One row of the following list — in the main column only. The
             * sidebar's "Who to follow" is drawn in the same rows, and the
             * bare `[data-testid="UserCell"]` this used to be read those too.
             */
            cell: ['[data-testid="primaryColumn"] [data-testid="UserCell"]', 'main [data-testid="UserCell"]'],
            /** X fetching the next stretch of a list. */
            loading: ['[data-testid="primaryColumn"] [role="progressbar"]'],
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
            /** The sidebar box the subreddit's own toggle sits in. */
            scope: ['.side .titlebox', '.side'],
            /**
             * Old Reddit's subscribe toggle, by `.active`. The toggle is two
             * links, subscribe and unsubscribe, both always in the page, and
             * `.active` is the one drawn (r2's printablebuttons.html). This
             * was `.remove:not(.hidden)`, which nothing ever hides, so every
             * subreddit read as joined and a whole list was skipped. New
             * Reddit's Join is not here: the job's pages are old Reddit's.
             */
            follow: ['.fancy-toggle-button a.option.add.active'],
            followed: ['.fancy-toggle-button a.option.remove.active'],
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
     * On old Reddit it is the sidebar's title box, where the subreddit's own
     * toggle is — the listing pages draw one toggle per row, and a subreddit's
     * sidebar can link others.
     */
    function actionScope(site) {
        if (site !== 'twitter') return first(site, 'scope');
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
     * @param {object} [deps.page]  where this page is and how to leave it;
     *   the browser suite's stand-in for `location`
     * @param {() => Promise<object>} [deps.appearance]  for the bar: Theme.appearance
     * @param {(element: Element, look: object) => void} [deps.dress]  and Theme.dress
     */
    function createRoster({ site, notify, page = PAGE, appearance = async () => ({}), dress = () => {} }) {
        const rules = Roster.siteOf(site);
        const bar = RosterBar.createBar({ appearance, dress });

        // ------------------------------------------------------ bookkeeping

        /** Stop the job, say why, and hand it back. */
        function halt(status, note) {
            return Roster.updateJob((job) => {
                if (!job || job.site !== site) return job;
                return { ...Roster.release(job), status, note };
            });
        }

        const finish = (note) => halt('done', note || '');

        /** The bar's Stop: the dashboard's, from the page. */
        async function stopHere() {
            bar.hide();
            await Roster.updateJob((job) => (job && job.site === site ? null : job));
            notify('Stopped. What was done stays done.', 'info');
        }

        /**
         * Leave for another page of the site, handing the job over first.
         *
         * The order matters: a page that navigated while still holding the
         * lease would leave the job untouchable for two and a half minutes,
         * and the page that arrives is the one that has to pick it up.
         */
        async function goTo(url) {
            await Roster.updateJob((job) => (job && job.site === site ? Roster.release(job) : job));
            markHop(new URL(url, page.href()).pathname);
            page.assign(url);
        }

        /**
         * Take the job for this page, or say it is somebody else's. The check
         * and the claim are one write, so two tabs arriving together cannot
         * both come away holding it.
         */
        async function take() {
            let ours = false;
            await Roster.updateJob((current) => {
                if (!current || current.site !== site || !Roster.canClaim(current, PAGE_ID)) return current;
                ours = true;
                return Roster.claim(current, PAGE_ID);
            });
            return ours;
        }

        /** The job as it stands, or null when there is nothing of ours to do. */
        async function mine() {
            const job = Roster.forDay(await Roster.loadJob());
            if (!job || job.site !== site) return null;
            if (!Roster.isRunning(job)) return null;
            return job;
        }

        // ------------------------------------------------------- reading

        /** The handles of the rows on screen that say you follow them. */
        function followedRows() {
            const names = [];
            for (const cell of all(site, 'cell')) {
                // A row counts only when its own button says you follow the
                // account. X draws suggestions in exactly these rows — beside
                // the list, and sometimes under it — and a read that took
                // every row, applied later, would have followed strangers.
                if (!first(site, 'followed', cell)) continue;
                const link = cell.querySelector('a[href^="/"]');
                const name = handleFromHref(link && link.getAttribute('href'));
                if (name) names.push(name);
            }
            return names;
        }

        /** The bottom of the list, with nothing more on its way. */
        const atEnd = (quietMs) => quietMs > 3000 && !first(site, 'loading') &&
            window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 300;

        /**
         * Twitter: write down the accounts on your following list as you
         * scroll it.
         *
         * Nothing is scrolled for you. This used to scroll the list itself,
         * and scrolling x.com from a script is scripting the site, which X's
         * automation rules give as a reason to suspend an account — read-only
         * or not. So the page reads what you scroll past and the bar asks you
         * to scroll; holding End is as quick as the script was. The list is
         * banked every few seconds, so a tab closed two thousand accounts in
         * has not thrown them away, and the dashboard can save what it holds.
         */
        async function readTwitter(job) {
            const found = new Map((job.found || []).map((name) => [name.toLowerCase(), name]));
            const list = page.path().replace(/\/$/, '').toLowerCase();
            let ended = '';
            let grewAt = Date.now();
            let bankedAt = Date.now();
            let banked = found.size;
            let checkedAt = Date.now();

            while (!ended) {
                // Somewhere else in X's own app, for now: the bar waits there.
                if (page.path().replace(/\/$/, '').toLowerCase() !== list) {
                    bar.hide();
                    await sleep(500);
                    continue;
                }
                for (const name of followedRows()) {
                    if (found.has(name.toLowerCase())) continue;
                    found.set(name.toLowerCase(), name);
                    grewAt = Date.now();
                }
                if (first(site, 'trouble')) {
                    await bank(found);
                    bar.hide();
                    return halt('paused', `Twitter stopped answering after ${found.size} ${rules.many}. Leave it a while and start again.`);
                }
                // Banked when it grew, and once a minute regardless: a bank
                // is also what keeps the lease, and a list read slowly must
                // not lose it to another tab.
                if ((found.size !== banked && Date.now() - bankedAt > 3000) || Date.now() - bankedAt > 60000) {
                    await bank(found);
                    banked = found.size;
                    bankedAt = Date.now();
                }
                // The dashboard's Stop is a write to the job.
                if (Date.now() - checkedAt > 2000) {
                    if (!(await mine())) return void bar.hide();
                    checkedAt = Date.now();
                }
                bar.show({
                    head: `Reading the ${rules.many} you follow — ${found.size} so far`,
                    line: atEnd(Date.now() - grewAt)
                        ? 'That looks like the end of the list. Press Done to save it.'
                        : 'Scroll down to the end of the list; holding End works. This only reads what you scroll past — nothing is followed or changed.',
                    acts: [{ id: 'done', label: 'Done' }, { id: 'stop', label: 'Cancel', danger: true }],
                    onAct: (id) => { ended = id; },
                });
                await sleep(400);
            }

            if (ended === 'stop') return stopHere();
            await bank(found);
            bar.hide();
            // Not written down empty, for the reason Reddit's is not.
            if (!found.size) {
                return halt('paused', `No ${rules.many} were read, so the last read was kept. Scroll the list before pressing Done.`);
            }
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
            const found = new Map((job.found || []).map((name) => [name.toLowerCase(), name]));
            for (const link of all(site, 'cell')) {
                const name = subFromHref(link.getAttribute('href'));
                if (name) found.set(name.toLowerCase(), name);
            }
            await bank(found);

            const next = first(site, 'next');
            const more = !!(next && next.href) && found.size < Roster.MAX_NAMES;
            bar.show({
                head: `Reading your ${rules.many}`,
                line: `${found.size} so far${more ? ', and another page to go' : ''}. Nothing is joined or changed.`,
                acts: [{ id: 'stop', label: 'Stop', danger: true }],
                onAct: stopHere,
            });
            if (more) {
                // A page every few seconds, which is slower than clicking
                // "next" yourself and well inside what Reddit asks for.
                await sleep(2500 + Math.round(Math.random() * 2000));
                if (!(await mine())) return void bar.hide();
                return goTo(next.href);
            }
            bar.hide();

            // Never written down empty: it would replace the last read, and a
            // page that drew no list is far likelier than an account with no
            // subreddits.
            if (!found.size) {
                return halt('paused', `Found no ${rules.many} on old Reddit's list of yours, so the last read was kept.`);
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
                return page.path().toLowerCase() === `/${name}`.toLowerCase();
            }
            return subFromHref(page.path()).toLowerCase() === name.toLowerCase();
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

        /** The signed-in account's handle, waited for: X draws its navigation late. */
        async function signedIn() {
            const me = await waitFor(() => first(site, 'me') || first(site, 'meAvatar'), 15000);
            if (!me) return '';
            const avatar = /^UserAvatar-Container-([A-Za-z0-9_]{1,15})$/.exec(me.getAttribute('data-testid') || '');
            return avatar ? avatar[1] : handleFromHref(me.getAttribute('href'));
        }

        /**
         * Which page acts on a job, for each kind. Its own page does — the
         * following list, the listing, the name's profile — and, for a moment
         * after the dashboard opened a tab, any page, to find its way there.
         * Any other page of the site leaves the job alone, and a tab the job
         * sent somewhere that turned out to be somewhere else stops it.
         */
        async function enterTwitterRead(job, hop) {
            const following = /^\/[A-Za-z0-9_]{1,15}\/following\/?$/.test(page.path());
            if (!following && !hop && !Roster.isKicked(job)) return null;

            // Read only after X has drawn its navigation. It used to be read
            // as soon as the script ran, before X had, so no read ever found
            // the account and every one stopped on its first page.
            const handle = await signedIn();
            const want = `/${handle}/following`;
            if (handle && page.path().replace(/\/$/, '').toLowerCase() === want.toLowerCase()) {
                return (await take()) ? readTwitter(job) : null;
            }
            if (hop) {
                return halt('paused', `x.com sent the tab to ${page.path()} instead of your following list.`);
            }
            if (!Roster.isKicked(job) || !(await take())) return null;
            if (!handle) return halt('paused', 'Could not tell which account is signed in — sign in to x.com, then start again.');
            return goTo(`https://x.com${want}`);
        }

        async function enterRedditRead(job, hop) {
            if (/^\/subreddits\/mine(?:\/|$)/.test(page.path())) {
                return (await take()) ? readReddit(job) : null;
            }
            // Signed out, as a rule: old Reddit sends that to /login.
            if (hop) {
                return halt('paused', `Reddit sent the tab to ${page.path()} instead of your list of subreddits — sign in to Reddit, then start again.`);
            }
            if (!Roster.isKicked(job) || !(await take())) return null;
            return goTo(START.reddit);
        }

        async function enterApply(job, hop) {
            const name = Roster.currentName(job);
            // No name left is a job to finish, which any page may do.
            if (!name || onPageFor(name)) return (await take()) ? applyOne(job) : null;
            if (hop) {
                return halt('paused', `${rules.name} sent the tab to ${page.path()} instead of ${rules.prefix}${name}. Stopped rather than guessed.`);
            }
            return null;
        }

        /**
         * Pick the job up, if there is one for this site and this page is
         * one that may act on it. Called once per page load and never on a
         * timer: a job advances by navigating, so every step is a new load
         * and a new call to this.
         */
        async function install() {
            if (!rules) return;

            // Taken whether or not there is a job, so a mark left by one that
            // was stopped cannot be read by the next.
            const hop = takeHop();
            const job = await mine();
            if (!job) return;

            try {
                if (job.action === 'read') {
                    await (site === 'twitter' ? enterTwitterRead(job, hop) : enterRedditRead(job, hop));
                } else {
                    await enterApply(job, hop);
                }
            } catch (error) {
                // Including the extension being reloaded out from under this
                // page, which throws from every chrome.* call. A job left
                // running with a live lease would be stuck; halting is the
                // recoverable end.
                bar.hide();
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
