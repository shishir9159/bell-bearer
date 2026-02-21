/**
 * The one part of the roster work that needs a real page: which Follow button
 * a job is allowed to click.
 *
 * Everything else — the file format, the pace, the cap, the lease, the plan —
 * is pure and lives in tests/node-check.js. This is here because it guards the
 * worst thing in the feature that could go wrong, and the only one that would
 * go wrong quietly.
 *
 * A profile page on x.com carries more than one Follow button. The account the
 * page is about has one in its header; the "You might like" module in the
 * sidebar has one per suggestion, and the timeline sometimes has more.
 * `[data-testid$="-follow"]` matches every one of them, so taking the first in
 * document order follows whoever X happened to be suggesting — silently,
 * plausibly, and on somebody else's account. The fixture below is built so that
 * the wrong button comes first, which is what makes the test worth having.
 */
(function () {
    'use strict';

    const RosterContent = () => window.BB.RosterContent;

    function stage(html) {
        teardown();
        const host = document.createElement('div');
        host.id = 'bb-roster-test';
        host.innerHTML = html;
        document.body.appendChild(host);
        return host;
    }

    function teardown() {
        const host = document.getElementById('bb-roster-test');
        if (host) host.remove();
    }

    /** A sidebar suggestion ahead of the profile's own header, as X orders it. */
    const PROFILE = `
        <div data-testid="sidebarColumn">
            <div><button data-testid="99-follow" id="suggestion">Follow</button></div>
        </div>
        <div data-testid="primaryColumn">
            <div id="headerRow">
                <button data-testid="userActions"></button>
                <button data-testid="42-follow" id="theirs">Follow</button>
            </div>
        </div>`;

    suite('the roster — which Follow button may be clicked', () => {
        test('the scope is the profile header row, not the page', () => {
            stage(PROFILE);
            const scope = RosterContent().actionScope('twitter');

            assert(scope, 'there is a header to scope to');
            assertEqual(scope.id, 'headerRow');
            assertEqual(scope.querySelector('[data-testid$="-follow"]').id, 'theirs',
                'the account the page is about');
            teardown();
        });

        test('the first Follow on the page is the wrong one', () => {
            // Not a test of our code — a test that the fixture still shows the
            // hazard the scope exists for. If X ever orders these the other
            // way this assertion fails and says so, rather than the test above
            // passing for the wrong reason.
            stage(PROFILE);
            assertEqual(document.querySelector('[data-testid$="-follow"]').id, 'suggestion');
            teardown();
        });

        test('no header row means no scope, rather than the whole page', () => {
            stage('<div><button data-testid="99-follow" id="suggestion"></button></div>');
            assertEqual(RosterContent().actionScope('twitter'), null,
                'a job stops on a null, and stopping is the right answer here');
            teardown();
        });

        test('REGRESSION: on old Reddit, a subreddit not joined reads as not joined', () => {
            // Old Reddit's toggle is both links, always; `.active` is the one drawn.
            stage(`<div class="side"><div class="titlebox"><span class="fancy-toggle-button subscribe-button toggle">
                <a class="option active add login-required" href="#">subscribe</a><a class="option remove" href="#">unsubscribe</a>
            </span></div></div>`);
            const scope = RosterContent().actionScope('reddit');
            const table = RosterContent().SELECTORS.reddit;
            assertEqual(scope.className, 'titlebox', 'the sidebar\'s own box');
            assert(scope.querySelector('.fancy-toggle-button a.option.remove:not(.hidden)'),
                'precondition: the old spelling matched a subreddit nobody had joined');
            assertEqual(scope.querySelector(table.followed[0]), null);
            assert(scope.querySelector(table.follow[0]), 'and its subscribe is the one to press');
            teardown();
        });
    });

    suite('the roster — the bar on the site\'s page', () => {
        const bar = () => window.BB.RosterBar.createBar({ appearance: async () => ({}), dress: () => {} });

        test('says what it is doing, and hands its buttons back', async () => {
            const one = bar();
            const pressed = [];
            try {
                await one.show({ head: 'Follow @alice?', line: 'Press Follow', acts: [{ id: 'skip', label: 'Skip' }], onAct: (id) => pressed.push(id) });
                const element = document.getElementById(window.BB.RosterBar.ID);
                assertEqual(element.querySelector('.bb-roster-bar-head').textContent, 'Follow @alice?');
                const skip = element.querySelector('[data-bb-roster-act="skip"]');
                skip.click();
                assertDeepEqual(pressed, ['skip']);

                await one.show({ head: 'Follow @bob?', acts: [{ id: 'skip', label: 'Skip' }] });
                assert(skip.isConnected, 'the same buttons are not drawn again under the pointer');
                assertEqual(element.querySelector('.bb-roster-bar-line').textContent, '');
            } finally { one.hide(); }
            assertEqual(document.getElementById(window.BB.RosterBar.ID), null);
        });

        test('two shows at once draw one bar, and a hide before it is built wins', async () => {
            const one = bar();
            await Promise.all([one.show({ head: 'a' }), one.show({ head: 'b' })]);
            assertEqual(document.querySelectorAll(`#${window.BB.RosterBar.ID}`).length, 1);
            one.hide();
            const shown = one.show({ head: 'c' });
            one.hide();
            await shown;
            assertEqual(document.getElementById(window.BB.RosterBar.ID), null);
        });

        test('rings the site\'s button and takes the ring off again', () => {
            const one = bar();
            const button = document.createElement('button');
            document.body.append(button);
            try {
                one.mark(button);
                assert(button.hasAttribute(window.BB.RosterBar.MARK));
                one.unmark();
                assert(!button.hasAttribute(window.BB.RosterBar.MARK));
            } finally { button.remove(); }
        });
    });

    /**
     * Which page may act on a job: one in the job's own tab. A job used to be
     * taken up by every page of its site for as long as it ran, which looped
     * forever on a page the site redirected — and took over any tab of the
     * site opened while it ran.
     */
    const Roster = () => window.BB.Roster;
    /** The tab the specs' jobs are in, and the one their pages say they are in. */
    const TAB = 7;
    const jobFor = (options) => Roster().newJob({ tabId: TAB, ...options });

    /** A stand-in for `location` at `path`, recording where it was sent. */
    function pageAt(path) {
        const sent = [];
        return { sent, path: () => path, href: () => `https://example.test${path}`, assign: (url) => sent.push(url) };
    }

    /** A page at `path` loading in `tab`, with `job` in storage. */
    async function enter(site, path, job, tab = TAB) {
        await Roster().saveJob(job);
        const page = pageAt(path);
        await RosterContent().createRoster({ site, notify: () => {}, page, tabId: async () => tab }).install();
        return { page, job: await Roster().loadJob() };
    }

    const clean = () => Roster().clearJob();

    suite('the roster — which page may take a job up', () => {
        test('REGRESSION: a tab sent to the list and signed out stops, rather than going round', async () => {
            try {
                const job = Roster().heading(jobFor({ site: 'reddit', action: 'read' }), '/subreddits/mine/subscriber/');
                const { page, job: after } = await enter('reddit', '/login/', job);
                assertEqual(page.sent.length, 0, 'sent back to the list, it is only sent to /login again');
                assertEqual(after.status, 'paused');
                assert(/sign in/i.test(after.note), after.note);
            } finally { await clean(); }
        });

        test('REGRESSION: another tab of the site leaves the job alone, on the job\'s own page too', async () => {
            // Every page of the site once took a job up, and an x.com tab
            // opened that evening was sent off to somebody's profile.
            stage('<div id="siteTable"><div class="thing subreddit"><a class="title" href="/r/rust/">rust</a></div></div>');
            try {
                const { page, job: after } = await enter('reddit', '/subreddits/mine/subscriber/', jobFor({ site: 'reddit', action: 'read' }), TAB + 1);
                assertEqual(page.sent.length, 0);
                assertDeepEqual([after.status, after.found.length], ['running', 0], 'not read, not stopped');
            } finally {
                teardown();
                await clean();
            }
        });

        test('its own tab, taken somewhere else by the user, waits', async () => {
            try {
                const { page, job: after } = await enter('reddit', '/r/rust/', jobFor({ site: 'reddit', action: 'read' }));
                assertEqual(page.sent.length, 0, 'an ordinary visit is not dragged back');
                assertEqual(after.status, 'running');
            } finally { await clean(); }
        });

        test('a profile that is not the name the job is on is left alone', async () => {
            try {
                const job = jobFor({ site: 'twitter', action: 'apply', names: ['alice'] });
                const { page, job: after } = await enter('twitter', '/bob', job);
                assertEqual(page.sent.length, 0);
                assertEqual(after.status, 'running');
                assertEqual(after.at, 0);
            } finally { await clean(); }
        });

        test('a page of old Reddit\'s list is read into the roster', async () => {
            stage(`<div id="siteTable">
                <div class="thing subreddit"><a class="title" href="https://old.reddit.com/r/rust/">rust</a></div>
                <div class="thing subreddit"><a class="title" href="https://old.reddit.com/r/cpp/">cpp</a></div>
                <div class="thing subreddit"><a class="title" href="https://old.reddit.com/user/someone/">a profile</a></div>
            </div>`);
            try {
                // Sent from reddit.com to old.reddit.com: another origin, where
                // a mark kept in the tab's sessionStorage did not follow.
                const job = Roster().heading(jobFor({ site: 'reddit', action: 'read' }), '/subreddits/mine/subscriber/');
                const { job: after } = await enter('reddit', '/subreddits/mine/subscriber/', job);
                assertEqual(after.status, 'done');
                assertEqual(after.headingTo, '', 'and it has arrived');
                assertDeepEqual((await Roster().loadRosters()).reddit.names, ['rust', 'cpp']);
                assertEqual(document.getElementById(window.BB.RosterBar.ID), null, 'and the bar is gone');
            } finally {
                teardown();
                await clean();
            }
        });

        test('an empty list is not saved over the last read', async () => {
            stage('<div id="siteTable"></div>');
            try {
                await Roster().saveRoster('reddit', ['kept']);
                const { job: after } = await enter('reddit', '/subreddits/mine/subscriber/', jobFor({ site: 'reddit', action: 'read' }));
                assertEqual(after.status, 'paused');
                assertDeepEqual((await Roster().loadRosters()).reddit.names, ['kept']);
            } finally {
                teardown();
                await clean();
            }
        });

        test('REGRESSION: the following list is read from rows you follow, and nothing is scrolled', async () => {
            const row = (name, testid) => `<div data-testid="UserCell"><a href="/${name}">${name}</a>
                <button data-testid="1-${testid}"></button></div>`;
            stage(`<a data-testid="AppTabBar_Profile_Link" href="/me"></a>
                <div data-testid="sidebarColumn">${row('sidebarpick', 'unfollow')}</div>
                <div data-testid="primaryColumn">${row('alice', 'unfollow')}${row('suggested', 'follow')}${row('bob', 'unfollow')}</div>`);
            const scrollTo = window.scrollTo;
            let scrolled = 0;
            window.scrollTo = () => { scrolled++; };
            try {
                await Roster().saveJob(jobFor({ site: 'twitter', action: 'read' }));
                const reading = RosterContent().createRoster({
                    site: 'twitter', notify: () => {}, page: pageAt('/me/following'), tabId: async () => TAB,
                }).install();
                const done = await (async () => {
                    for (let i = 0; i < 40; i++) {
                        const button = document.querySelector('#bb-roster-bar [data-bb-roster-act="done"]');
                        if (button && /2 so far/.test(document.getElementById('bb-roster-bar').textContent)) return button;
                        await new Promise((resolve) => setTimeout(resolve, 100));
                    }
                    return null;
                })();
                assert(done, 'the bar counts the two rows you follow');
                done.click();
                await reading;
                assertDeepEqual((await Roster().loadRosters()).twitter.names, ['alice', 'bob'],
                    'not the suggestion under the list, nor the sidebar');
                assertEqual((await Roster().loadJob()).status, 'done');
                assertEqual(scrolled, 0, 'scrolling x.com from a script is scripting the site');
            } finally {
                window.scrollTo = scrollTo;
                teardown();
                await clean();
            }
        });

        test('a tab sent to a name and landing elsewhere stops the job', async () => {
            try {
                const job = Roster().heading(jobFor({ site: 'twitter', action: 'apply', names: ['alice'] }), '/alice');
                const { page, job: after } = await enter('twitter', '/i/flow/login', job);
                assertEqual(page.sent.length, 0);
                assertEqual(after.status, 'paused');
                assert(after.note.includes('@alice'), after.note);
            } finally { await clean(); }
        });

        test('sent there long ago, the tab being elsewhere is the user\'s doing', async () => {
            try {
                const then = Date.now() - Roster().SENT_MS - 1000;
                const job = Roster().heading(jobFor({ site: 'twitter', action: 'apply', names: ['alice'] }), '/alice', then);
                const { job: after } = await enter('twitter', '/home', job);
                assertEqual(after.status, 'running', 'not a stop: nothing went wrong');
            } finally { await clean(); }
        });
    });

    /**
     * Following from a list. The job used to press Follow itself; now it
     * rings the button and waits, and the press is the user's.
     */
    const MARK = () => window.BB.RosterBar.MARK;

    async function until(test, ms = 4000) {
        for (const end = Date.now() + ms; Date.now() < end;) {
            if (test()) return true;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
    }

    /** A job on @alice, then @bob, running on @alice's page. */
    async function onAlice(gap = 50) {
        await Roster().saveJob(jobFor({ site: 'twitter', action: 'apply', names: ['alice', 'bob'] }));
        const page = pageAt('/alice');
        const running = RosterContent().createRoster({ site: 'twitter', notify: () => {}, page, delay: () => gap, tabId: async () => TAB }).install();
        return { page, running };
    }

    suite('the roster — following is your press, not the job\'s', () => {
        test('REGRESSION: nothing is pressed for you; your press moves the job on', async () => {
            stage(PROFILE);
            const theirs = document.getElementById('theirs');
            let presses = 0;
            // X's own handler, as far as this needs it: the button turns.
            theirs.addEventListener('click', () => { presses++; theirs.dataset.testid = '42-unfollow'; });
            try {
                const { page, running } = await onAlice();
                assert(await until(() => theirs.hasAttribute(MARK())), 'the header\'s Follow is rung');
                await new Promise((resolve) => setTimeout(resolve, 800));
                assertEqual(presses, 0, 'and nothing pressed it');
                assertEqual((await Roster().loadJob()).at, 0, 'so the job waits');
                assert(!document.getElementById('suggestion').hasAttribute(MARK()), 'the suggestion is not rung');

                theirs.click();
                await running;
                const after = await Roster().loadJob();
                assertDeepEqual([after.at, after.done, after.today], [1, 1, 1]);
                assertDeepEqual(page.sent, ['https://x.com/bob']);
            } finally {
                teardown();
                await clean();
            }
        });

        test('Stop during the gap after a follow ends the job before the next page', async () => {
            stage(PROFILE);
            const theirs = document.getElementById('theirs');
            theirs.addEventListener('click', () => { theirs.dataset.testid = '42-unfollow'; });
            try {
                const { page, running } = await onAlice(5000);
                assert(await until(() => theirs.hasAttribute(MARK())));
                theirs.click();
                const head = () => document.querySelector(`#${window.BB.RosterBar.ID} .bb-roster-bar-head`);
                assert(await until(() => head() && head().textContent === 'Followed @alice'), 'the gap is counted down');
                assert(/@bob opens in \ds/.test(document.getElementById(window.BB.RosterBar.ID).textContent));
                document.querySelector(`#${window.BB.RosterBar.ID} [data-bb-roster-act="stop"]`).click();
                await running;
                assertEqual(await Roster().loadJob(), null);
                assertDeepEqual(page.sent, [], '@bob is never opened');
            } finally {
                teardown();
                await clean();
            }
        });

        test('an account already followed costs nothing against the day', async () => {
            stage(PROFILE.replace('42-follow', '42-unfollow'));
            try {
                const { page, running } = await onAlice();
                await running;
                const after = await Roster().loadJob();
                assertDeepEqual([after.at, after.skipped, after.today], [1, 1, 0]);
                assertDeepEqual(page.sent, ['https://x.com/bob']);
            } finally {
                teardown();
                await clean();
            }
        });

        test('with no Follow button, Skip is yours to press', async () => {
            stage('<div data-testid="primaryColumn"><div><button data-testid="userActions"></button></div></div>');
            try {
                const { page, running } = await onAlice();
                const skip = () => document.querySelector(`#${window.BB.RosterBar.ID} [data-bb-roster-act="skip"]`);
                assert(await until(skip), 'the bar offers Skip');
                assertEqual((await Roster().loadJob()).status, 'running', 'a missing button is asked about, not a stop');
                skip().click();
                await running;
                const after = await Roster().loadJob();
                assertDeepEqual([after.at, after.passed, after.today], [1, 1, 0]);
                assertDeepEqual(page.sent, ['https://x.com/bob']);
            } finally {
                teardown();
                await clean();
            }
        });
    });

    /**
     * A job asked for from the popup: the tab that is asked is the tab that
     * does it, so one with no script to answer leaves nothing waiting.
     */
    function asked(site, path) {
        const page = pageAt(path);
        const notes = [];
        const roster = RosterContent().createRoster({ site, notify: (message) => notes.push(message), page });
        return { page, notes, roster };
    }

    suite('the roster — asked from the popup', () => {
        test('a read starts on the tab that was asked, and goes to the list', async () => {
            try {
                const { page, roster } = asked('reddit', '/r/rust/');
                assertDeepEqual(roster.start({ kind: 'read', tabId: TAB }), { ok: true });
                assert(await until(() => page.sent.length === 1), 'no dashboard, and no waiting for a tab');
                assert(/\/subreddits\/mine\//.test(page.sent[0]), page.sent[0]);
                const job = await Roster().loadJob();
                assertDeepEqual([job.site, job.action, job.status], ['reddit', 'read', 'running']);
                assertEqual(job.tabId, TAB, 'the job is that tab\'s');
                assertEqual(job.headingTo, '/subreddits/mine/subscriber/', 'and where it was sent is written down');
            } finally { await clean(); }
        });

        test('with a job running, a second is not started over it', async () => {
            try {
                await Roster().saveJob(Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice'] }));
                const { page, notes, roster } = asked('reddit', '/r/rust/');
                roster.start({ kind: 'read', tabId: TAB });
                assert(await until(() => notes.length === 1), 'said on the page');
                assertEqual(page.sent.length, 0);
                assertEqual((await Roster().loadJob()).site, 'twitter');
            } finally { await clean(); }
        });

        test('Carry on takes a stopped job back to the page it stopped on', async () => {
            try {
                // Stopped in a tab since closed; carried on in the one asked.
                const job = { ...Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice', 'bob'], tabId: 3 }), status: 'paused', note: 'x' };
                await Roster().saveJob(job);
                const { page, roster } = asked('twitter', '/home');
                roster.start({ kind: 'resume', tabId: TAB });
                assert(await until(() => page.sent.length === 1));
                assertDeepEqual(page.sent, ['https://x.com/alice']);
                const after = await Roster().loadJob();
                assertDeepEqual([after.status, after.note, after.at, after.tabId], ['running', '', 0, TAB]);
            } finally { await clean(); }
        });

        test('Skip passes over the name it stopped on', async () => {
            try {
                const job = { ...Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice', 'bob'] }), status: 'paused' };
                await Roster().saveJob(job);
                const { page, roster } = asked('twitter', '/home');
                roster.start({ kind: 'skip', tabId: TAB });
                assert(await until(() => page.sent.length === 1));
                assertDeepEqual(page.sent, ['https://x.com/bob']);
                const after = await Roster().loadJob();
                assertDeepEqual([after.at, after.passed, after.today], [1, 1, 0]);
            } finally { await clean(); }
        });

        test('a list is picked on the page, its cost said, and only then started', async () => {
            const page = pageAt('/home');
            const roster = RosterContent().createRoster({
                site: 'twitter', notify: () => {}, page, pickFile: async () => '@alice\n# not her\n@bob\n',
            });
            const bar = () => document.getElementById(window.BB.RosterBar.ID);
            const act = (id) => bar() && bar().querySelector(`[data-bb-roster-act="${id}"]`);
            try {
                await Roster().saveRoster('twitter', ['bob']);
                roster.start({ kind: 'pick', tabId: TAB });
                assert(await until(() => act('choose')), 'the bar asks for the file');
                act('choose').click();
                assert(await until(() => act('go')), 'and then for a yes');
                assert(/2 accounts, 1 not in your last read\. You press Follow on each/.test(bar().textContent),
                    bar().textContent.trim());
                assertEqual(await Roster().loadJob(), null, 'a file is a plan, not a job');
                act('go').click();
                assert(await until(() => page.sent.length === 1));
                assertDeepEqual(page.sent, ['https://x.com/alice']);
                const made = await Roster().loadJob();
                assertDeepEqual([made.names, made.tabId], [['alice', 'bob'], TAB]);
            } finally {
                if (bar()) bar().remove();
                await clean();
            }
        });

        test('a file with no names in it starts nothing', async () => {
            const roster = RosterContent().createRoster({ site: 'reddit', notify: () => {}, page: pageAt('/'), pickFile: async () => 'x\n\n' });
            const bar = () => document.getElementById(window.BB.RosterBar.ID);
            try {
                roster.start({ kind: 'pick', tabId: TAB });
                assert(await until(() => bar() && bar().querySelector('[data-bb-roster-act="choose"]')));
                bar().querySelector('[data-bb-roster-act="choose"]').click();
                assert(await until(() => /Nothing in that file/.test(bar().textContent)));
                assertEqual(bar().querySelector('[data-bb-roster-act="go"]'), null);
                assertEqual(await Roster().loadJob(), null);
            } finally {
                if (bar()) bar().remove();
                await clean();
            }
        });

        test('a request it does not know is refused, and nothing is written', async () => {
            try {
                const { roster } = asked('reddit', '/');
                assertDeepEqual(roster.start({ kind: 'follow-everyone', tabId: TAB }), { ok: false });
                assertDeepEqual(roster.start({ kind: 'read' }), { ok: false }, 'nor one that does not say which tab');
                assertDeepEqual(roster.start({ kind: 'status' }), { ok: true, working: false });
                assertEqual(await Roster().loadJob(), null);
            } finally { await clean(); }
        });
    });

    /**
     * The popup's panel over tab TAB, which answers `answer` to whatever it
     * is asked; `open` is the other tabs there are.
     */
    async function popup(site, answer, open = []) {
        const body = document.createElement('div');
        document.body.append(body);
        const asks = [];
        const shown = [];
        let closed = 0;
        const view = window.BB.RosterPopup.createView({
            body,
            site,
            tabId: TAB,
            ask: async (kind) => { if (kind !== 'status') asks.push(kind); return answer; },
            alive: async (id) => open.includes(id),
            show: (id) => shown.push(id),
            close: () => { closed++; },
        });
        await view.render();
        const press = async (act) => {
            body.querySelector(`[data-act="${act}"]`).click();
            await new Promise((resolve) => setTimeout(resolve, 60));
        };
        return { body, asks, shown, view, press, closed: () => closed, button: (act) => body.querySelector(`[data-act="${act}"]`) };
    }

    suite('the roster — the popup\'s panel', () => {
        test('a read is asked of the tab, and the popup closes over it', async () => {
            await chrome.storage.local.remove(Roster().ROSTERS_KEY);
            const p = await popup('reddit', { ok: true });
            try {
                assert(/Your subreddits/i.test(p.body.textContent));
                assert(p.button('download').disabled, 'nothing read, nothing to download');
                await p.press('read');
                assertDeepEqual(p.asks, ['read']);
                assertEqual(p.closed(), 1);
                assertEqual(await Roster().loadJob(), null, 'the popup writes no job: the tab that runs it does');
            } finally { p.body.remove(); await clean(); }
        });

        test('REGRESSION: a tab with nothing in it to answer is said so, and nothing is left running', async () => {
            // The dashboard wrote the job and opened a tab; a tab that could
            // not take it left it "running" with no tab working on it.
            const p = await popup('reddit', null);
            try {
                await p.press('read');
                assertEqual(p.closed(), 0, 'the popup stays, to say why');
                assert(/Reload this tab first/.test(p.body.querySelector('.roster-pop-problem').textContent),
                    'in the panel, where it is still there to read');
                assertEqual(await Roster().loadJob(), null);
            } finally { p.body.remove(); await clean(); }
        });

        test('a stopped job offers to carry on here, or to skip the name it stopped on', async () => {
            await Roster().saveJob({
                ...Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice', 'carol'] }),
                at: 1, done: 1, status: 'paused', note: 'Twitter sent the tab to /i/flow/login instead of @carol.',
            });
            const p = await popup('twitter', { ok: true });
            try {
                assert(/instead of @carol/.test(p.body.textContent));
                assertEqual(p.button('skip').textContent, 'Skip @carol');
                assert(p.button('read').disabled, 'one job at a time');
                await p.press('skip');
                assertDeepEqual(p.asks, ['skip']);
            } finally { p.body.remove(); await clean(); }
        });

        test('a job of the other site is shown, and stopped, but not carried on from here', async () => {
            await Roster().saveJob({ ...Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice'] }), status: 'paused', note: 'x' });
            const p = await popup('reddit', { ok: true });
            try {
                assert(/Twitter: Following/.test(p.body.textContent), p.body.textContent.trim());
                assertEqual(p.button('resume'), null, 'that is for a tab of x.com to be asked');
                await p.press('stop');
                assertEqual(await Roster().loadJob(), null);
            } finally { p.body.remove(); await clean(); }
        });

        test('REGRESSION: a job whose tab is closed is said so, and carried on here', async () => {
            // "No reddit.com tab is working on this", for as long as anyone looked.
            await Roster().saveJob(Roster().newJob({ site: 'reddit', action: 'read', tabId: 99 }));
            const p = await popup('reddit', { ok: true });
            try {
                assert(/The tab it was running in is closed/.test(p.body.textContent), p.body.textContent.trim());
                await p.press('resume');
                assertDeepEqual(p.asks, ['resume']);
            } finally { p.body.remove(); await clean(); }
        });

        test('one running in another tab is gone to, not started twice', async () => {
            await Roster().saveJob(Roster().newJob({ site: 'reddit', action: 'read', tabId: 99 }));
            const p = await popup('reddit', { ok: true }, [99]);
            try {
                assertEqual(p.button('resume'), null);
                await p.press('show');
                assertDeepEqual(p.shown, [99]);
            } finally { p.body.remove(); await clean(); }
        });

        test('one at work in this tab is only said to be', async () => {
            await Roster().saveJob(jobFor({ site: 'twitter', action: 'apply', names: ['alice'] }));
            const p = await popup('twitter', { ok: true, working: true });
            try {
                assert(/Waiting in this tab for you to press Follow/.test(p.body.textContent), p.body.textContent.trim());
                assertEqual(p.button('resume'), null);
                assertEqual(p.button('stop').textContent, 'Stop');
            } finally { p.body.remove(); await clean(); }
        });

        test('what a read had found is saved from here, its tab closed or not', async () => {
            await Roster().saveJob({ ...Roster().newJob({ site: 'reddit', action: 'read' }), found: ['rust', 'cpp'] });
            const p = await popup('reddit', { ok: true });
            try {
                await p.press('save');
                assertDeepEqual((await Roster().loadRosters()).reddit.names, ['rust', 'cpp']);
                assertEqual(await Roster().loadJob(), null);
                assert(!p.button('download').disabled, 'and there is a file to download');
            } finally { p.body.remove(); await clean(); }
        });
    });
})();
