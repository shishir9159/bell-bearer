/**
 * Reading your roster off a site, and working through a list to follow or join
 * what is in it — the half that has to happen on the site's own pages.
 *
 * What a job *is* lives in src/shared/roster.js; this is the part that reads
 * x.com's and reddit.com's markup. Three rules govern everything here, and all
 * three are about the account not being mistaken for a robot:
 *
 *   Nothing is pressed for you. The job rings the site's own Follow or Join
 *   button and waits for you to press it. It used to press it itself, and X's
 *   automation rules name scripting its website as a reason to suspend an
 *   account; a click from a script is not one the site sees a person make,
 *   either. Reading is the same: what you scroll past is read, and nothing is
 *   scrolled for you.
 *
 *   One name per page load, then a navigation. Not because it is tidier —
 *   because it is what a person does, and because a job that survives a page
 *   load survives the browser being closed halfway through a four-hundred
 *   account list.
 *
 *   Stop at the first thing that is not understood. No retries, no pressing
 *   on to the next name. A site putting a "you are doing that too much" sheet
 *   in front of the page, or sending the tab somewhere else, stops the job
 *   with a note to be looked at. A missing button is the one thing you are
 *   asked about instead — Skip, or Stop — since you can see the page and the
 *   job cannot.
 *
 * Nothing here calls an API or touches a token. Every name is a page the
 * browser navigates to and a button your own mouse clicks.
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

    /**
     * The text of a file the user picks, or null when they pick none. Called
     * from the press on the bar's button and nowhere else: a browser opens a
     * file dialog only for a press, and the press has to be this turn's.
     */
    function chooseFile() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.txt,text/plain';
            input.addEventListener('change', () => {
                const file = input.files && input.files[0];
                if (!file) return resolve(null);
                return file.text().then(resolve, () => resolve(null));
            });
            input.addEventListener('cancel', () => resolve(null));
            input.click();
        });
    }

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
             * The button the job rings is looked for inside this and nowhere
             * else; see actionScope for why that is not optional.
             */
            actions: ['[data-testid="userActions"]'],
            /** The Follow button, before it is pressed. */
            follow: ['[data-testid$="-follow"]'],
            /** And after — how the press is seen to have taken. */
            followed: ['[data-testid$="-unfollow"]'],
            /** A protected account's Follow, once pressed, is a request. */
            requested: ['[data-testid$="-cancel"]'],
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
            requested: [],
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
     * No header is a null rather than a fallback to the document: nothing is
     * rung, and the bar says there is no button here. A profile page with no
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
     * @param {(site: string) => number} [deps.delay]  the gap after a follow; the suite's is short
     * @param {() => Promise<string|null>} [deps.pickFile]  the text of a file the user picks
     * @param {() => Promise<number|null>} [deps.tabId]  which tab this page is in, asked of the worker
     */
    function createRoster({ site, notify, page = PAGE, appearance = async () => ({}), dress = () => {}, delay = Roster.nextDelay, pickFile = chooseFile, tabId = async () => null }) {
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

        /** The bar's Stop: the popup's, from the page. */
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
         * has not thrown them away, and the popup can save what it holds.
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
                // The popup's Stop is a write to the job.
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
            notify(`Read ${found.size} ${found.size === 1 ? rules.one : rules.many} — Download .txt is in the popup`, 'success');
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
            notify(`Read ${found.size} ${found.size === 1 ? rules.one : rules.many} — Download .txt is in the popup`, 'success');
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

        /** A stop the popup should show, said on the page as well. */
        function pause(note) {
            bar.hide();
            notify(note, 'warning');
            return halt('paused', note);
        }

        /**
         * Ask for the Follow or Join on this page, wait for the user to press
         * it, then go to the next one. Nothing here presses anything: see the
         * head of the file.
         *
         * Every exit from here either advances the job by exactly one or stops
         * it, and only the user's Skip advances it past a name nobody followed.
         */
        async function applyOne(job) {
            const name = Roster.currentName(job);
            if (!name) {
                notify(`Done — ${job.done} ${job.done === 1 ? rules.one : rules.many} ${rules.verbed.toLowerCase()}`, 'success');
                return finish(`${job.done} ${rules.verbed.toLowerCase()}, ${job.skipped} already there, ${job.passed || 0} skipped`);
            }
            if (Roster.atCap(job)) {
                const note = `That is today's ${rules.pace.cap}. Carry on from the popup tomorrow; it starts again at ${rules.prefix}${name}.`;
                notify(note, 'info');
                return halt('waiting', note);
            }

            const startedAt = Date.now();
            let pressedAt = 0;
            let choice = '';
            let checkedAt = Date.now();
            let leasedAt = Date.now();

            // The user's press on the button, seen on its way in, before the
            // site redraws it. It is what tells a follow made now from one that
            // was already there when the page opened — only the first counts
            // against the day.
            const onPress = (event) => {
                const scope = actionScope(site);
                const button = scope && first(site, 'follow', scope);
                if (button && button.contains(event.target)) pressedAt = Date.now();
            };
            document.addEventListener('click', onPress, true);
            try {
                while (!choice) {
                    // Somewhere else in X's own app, for now: the bar waits there.
                    if (!onPageFor(name)) {
                        bar.hide();
                        await sleep(500);
                        continue;
                    }
                    if (first(site, 'trouble')) {
                        return pause(`${rules.name} put something in the way at ${rules.prefix}${name}. Stopped rather than pressed on.`);
                    }
                    const scope = actionScope(site);
                    if (scope && (first(site, 'followed', scope) || first(site, 'requested', scope))) {
                        bar.unmark();
                        // Already there costs nothing against the cap, so
                        // re-running a list half applied yesterday is cheap.
                        return step(job, name, pressedAt ? 'done' : 'skipped');
                    }
                    const button = scope && first(site, 'follow', scope);
                    if (button) bar.mark(button);
                    else bar.unmark();

                    const day = Roster.forDay(job);
                    bar.show({
                        head: `${rules.verb} ${rules.prefix}${name}?`,
                        line: button
                            ? `Press ${rules.name}'s own ${rules.verb} button, ringed in red — Bell Bearer never presses it for you. ` +
                              `${job.at + 1} of ${job.names.length} in the list, ${day.today} of ${rules.pace.cap} today.`
                            : Date.now() - startedAt < 8000
                                ? `Looking for the ${rules.verb} button…`
                                : `No ${rules.verb} button here. The ${rules.one} may be gone or private, or ${rules.name} is asking something first — Skip it, or Stop.`,
                        acts: [{ id: 'skip', label: 'Skip' }, { id: 'stop', label: 'Stop', danger: true }],
                        onAct: (id) => { choice = id; },
                    });

                    // The popup's Stop, and another tab moving the cursor.
                    if (Date.now() - checkedAt > 2000) {
                        const latest = await mine();
                        if (!latest || latest.at !== job.at) return void bar.hide();
                        checkedAt = Date.now();
                    }
                    // Waiting on a person can outlast a lease; keep it.
                    if (Date.now() - leasedAt > 60000) {
                        await take();
                        leasedAt = Date.now();
                    }
                    await sleep(300);
                }
            } finally {
                document.removeEventListener('click', onPress, true);
            }
            if (choice === 'stop') return stopHere();
            bar.unmark();
            return step(job, name, 'passed');
        }

        /**
         * Count down to `until` on the bar. False when the job was stopped,
         * from the bar or the popup, before it got there.
         */
        async function countDown(until, head, line) {
            let stopped = false;
            let checkedAt = Date.now();
            while (Date.now() < until && !stopped) {
                bar.show({
                    head,
                    line: line(Math.ceil((until - Date.now()) / 1000)),
                    acts: [{ id: 'stop', label: 'Stop', danger: true }],
                    onAct: () => { stopped = true; },
                });
                if (Date.now() - checkedAt > 2000) {
                    if (!(await mine())) return false;
                    checkedAt = Date.now();
                }
                await sleep(Math.min(500, Math.max(0, until - Date.now())));
            }
            if (stopped) await stopHere();
            return !stopped;
        }

        /**
         * One name behind us: record it, wait out the gap, and move on.
         *
         * The wait happens here rather than on arrival at the next page so the
         * gap is between two *follows*, which is the thing being paced. Waiting
         * on arrival would put the page load inside the gap and make it
         * shorter than it reads. A name skipped, or already there, was no
         * follow, and the next page opens after a moment instead.
         */
        async function step(job, name, how) {
            const now = Date.now();
            const wait = how === 'done' ? delay(site) : 1200;

            const next = await Roster.updateJob((current) => {
                if (!current || current.site !== site) return current;
                const day = Roster.forDay(current, now);
                // Another page moved the cursor while this one waited. Ours
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
                    passed: (day.passed || 0) + (how === 'passed' ? 1 : 0),
                    today: day.today + (how === 'done' ? 1 : 0),
                    actedAt: now,
                    nextAt: now + wait,
                    note: '',
                };
            });

            if (!Roster.isRunning(next) || next.at === job.at) return void bar.hide();
            const after = Roster.currentName(next);
            const said = { done: rules.verbed, skipped: `Already ${rules.verbing}`, passed: 'Skipped' }[how];
            if (!after) {
                bar.hide();
                notify(`Done — ${next.done} ${next.done === 1 ? rules.one : rules.many} ${rules.verbed.toLowerCase()}`, 'success');
                return finish(`${next.done} ${rules.verbed.toLowerCase()}, ${next.skipped} already there, ${next.passed} skipped`);
            }

            const ok = await countDown(next.nextAt, `${said} ${rules.prefix}${name}`, (seconds) => (how === 'done'
                ? `${rules.prefix}${after} opens in ${seconds}s. The gap keeps ${rules.name} seeing a person's pace.`
                : `On to ${rules.prefix}${after}.`));
            if (!ok) return void bar.hide();
            // Re-read: the popup's Stop is a write to the same key.
            const latest = await mine();
            if (!latest) return void bar.hide();
            return goTo(pageFor(Roster.currentName(latest)));
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
         * Where `job` should be, and whether this page is it: its own page is
         * the following list, the listing, or the profile of the name it is
         * on. `url` is that page, or '' when it cannot be told from here.
         *
         * `look` waits for X to draw its navigation, to learn whose following
         * list that is. It used to be read as soon as the script ran, before X
         * had drawn it, so no read ever found the account and every one
         * stopped on its first page. A page with no reason to care does not
         * wait.
         */
        async function place(job, look) {
            if (job.action === 'apply') {
                const name = Roster.currentName(job);
                // No name left is a job to finish, which any page may do.
                if (!name) return { here: true };
                return { here: onPageFor(name), url: pageFor(name), what: `${rules.prefix}${name}` };
            }
            if (site === 'reddit') {
                return {
                    here: /^\/subreddits\/mine(?:\/|$)/.test(page.path()),
                    url: LISTING,
                    // Signed out, as a rule: old Reddit sends that to /login.
                    what: 'your list of subreddits — sign in to Reddit, then carry on',
                };
            }
            const path = page.path().replace(/\/$/, '').toLowerCase();
            if (!look && !/^\/[a-z0-9_]{1,15}\/following$/.test(path)) return { here: false, url: '' };
            const handle = await signedIn();
            return {
                here: !!handle && path === `/${handle}/following`.toLowerCase(),
                url: handle ? `https://x.com/${handle}/following` : '',
                what: 'your following list',
                lost: 'Could not tell which account is signed in — sign in to x.com, then carry on.',
            };
        }

        /** Whether this page is doing a job's work now; a second ask must not start a second copy of it. */
        let working = false;

        /** Carry `job` on from this page: do its work here, or go to where it is done. */
        async function run(job, { go = false, hop = '' } = {}) {
            if (working) return null;
            working = true;
            try {
                const where = await place(job, go || !!hop);
                if (where.here) {
                    if (!(await take())) return null;
                    if (job.action === 'apply') return await applyOne(job);
                    return await (site === 'twitter' ? readTwitter(job) : readReddit(job));
                }
                if (go) {
                    if (!(await take())) return null;
                    return await (where.url ? goTo(where.url) : pause(where.lost));
                }
                // Sent somewhere by the job, and somewhere else is where the
                // tab is: the site's doing, and not one to send it round again.
                if (hop) return await pause(`${rules.name} sent the tab to ${page.path()} instead of ${where.what}.`);
                // Another page of the site, on an ordinary visit: left alone.
                return null;
            } catch (error) {
                // Including the extension being reloaded out from under this
                // page, which throws from every chrome.* call. A job left
                // running with a live lease would be stuck; halting is the
                // recoverable end.
                bar.hide();
                return halt('paused', `Stopped on an error: ${error && error.message ? error.message : 'unknown'}`);
            } finally {
                working = false;
            }
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
            // Its own tab, and no other: the one that was asked to run it.
            // Every page of the site once took a job up, and an x.com tab
            // opened that evening was sent off to somebody's profile.
            if (job.tabId == null || (await tabId()) !== job.tabId) return;
            // A read may find its way from any page for a moment after the
            // dashboard opened a tab for it; see Roster.isKicked.
            await run(job, { go: job.action === 'read' && !hop && Roster.isKicked(job), hop });
        }

        /**
         * A job asked for from the popup, on this tab: `read` starts one,
         * `pick` asks for the list to follow from, and `resume` and `skip`
         * carry on the one there is — here, whichever tab it stopped in.
         *
         * The page that is asked is the page that does it. A job used to be
         * written to storage by the dashboard for whichever tab loaded next,
         * and when none could — a tab still running the content script from
         * before an update, as it turned out — the job sat there "running"
         * with nothing to say so. Asked directly, a tab with no script to
         * answer is silence the popup can hear, and no job is written.
         *
         * Answers at once; the work goes on after the popup has closed.
         */
        function start(request) {
            const { kind, tabId: tab } = request || {};
            if (!rules) return { ok: false };
            // Asked before anything is offered: is this page at work on a job?
            if (kind === 'status') return { ok: true, working };
            // The tab is told which it is, because the job is to be its.
            if (!['read', 'pick', 'resume', 'skip'].includes(kind) || !Number.isInteger(tab)) return { ok: false };
            begin(kind, tab);
            return { ok: true };
        }

        /**
         * Choose the list to follow from, here on the page, and say what it
         * will cost before anything starts.
         *
         * On the page and not in the popup that asked for it. A popup closes
         * when a file dialog takes the focus from it — in Firefox always, in
         * Chrome on some systems — and the file is then picked into nothing.
         * The bar's own button is also a press on the page, which is what a
         * browser wants before it will open a file dialog at all.
         */
        async function pick(tab) {
            if (Roster.isOpen(await Roster.loadJob())) {
                return notify('A roster job is not finished — carry it on or clear it first', 'warning');
            }
            let names = [];
            const cancel = { id: 'cancel', label: 'Cancel', danger: true };

            async function onAct(id) {
                if (id === 'cancel') return bar.hide();
                if (id === 'go') {
                    // Looked at again: the bar may have stood here a while.
                    if (Roster.isOpen(await Roster.loadJob())) return bar.hide();
                    const job = Roster.newJob({ site, action: 'apply', names, tabId: tab });
                    await Roster.saveJob(job);
                    return run(job, { go: true });
                }
                // Before any await: the dialog opens on this press or not at all.
                const text = await pickFile();
                if (text === null) return null;
                names = Roster.parseList(text, site);
                if (!names.length) return ask('Nothing in that file parsed as a name. Pick another.');
                const known = ((await Roster.loadRosters())[site] || {}).names || [];
                return bar.show({
                    head: `${rules.verb} ${names.length} from this list?`,
                    line: Roster.planText(site, names, known),
                    acts: [{ id: 'go', label: `${rules.verb} them` }, { id: 'choose', label: 'Another file' }, cancel],
                    onAct,
                });
            }
            const ask = (line) => bar.show({
                head: `${rules.verb} from a list`,
                line,
                acts: [{ id: 'choose', label: 'Choose a file…' }, cancel],
                onAct,
            });
            return ask(`Pick a .txt with one ${rules.one} per line — one Bell Bearer wrote, or your own.`);
        }

        async function begin(kind, tab) {
            if (kind === 'pick') return pick(tab);
            if (kind === 'read') {
                if (Roster.isOpen(await Roster.loadJob())) {
                    return notify('A roster job is not finished — carry it on or clear it first', 'warning');
                }
                const job = Roster.newJob({ site, action: 'read', tabId: tab });
                await Roster.saveJob(job);
                return run(job, { go: true });
            }
            // Carried on in the tab that was asked, which may not be the one
            // it stopped in: that one may be closed.
            const next = await Roster.updateJob((job) => (job && job.site === site
                ? {
                    ...Roster.release(job), tabId: tab, status: 'running', note: '',
                    ...(kind === 'skip' && job.action === 'apply' ? { at: job.at + 1, passed: (job.passed || 0) + 1 } : {}),
                }
                : job));
            if (!next || next.site !== site) return null;
            return run(Roster.forDay(next), { go: true });
        }

        return { install, start };
    }

    /** Old Reddit's list of your subreddits, where a read of them starts. */
    const LISTING = 'https://old.reddit.com/subreddits/mine/subscriber/?limit=100';

    const RosterContent = { createRoster, SELECTORS, LISTING, actionScope, handleFromHref, subFromHref };

    root.BB = root.BB || {};
    root.BB.RosterContent = RosterContent;
    if (typeof module !== 'undefined' && module.exports) module.exports = RosterContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
