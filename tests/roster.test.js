/**
 * The roster on a real page. The file format, pace, cap and plan are pure
 * and in node-check.js; what is here is which page and which button a job
 * may act on. A profile on x.com carries several Follow buttons, and
 * `[data-testid$="-follow"]` matches the sidebar's suggestions first — so the
 * fixture puts the wrong one first.
 */
(function () {
    'use strict';

    const RosterContent = () => window.BB.RosterContent;
    const Roster = () => window.BB.Roster;
    const BAR = () => window.BB.RosterBar.ID;
    const MARK = () => window.BB.RosterBar.MARK;
    const bar = () => document.getElementById(BAR());
    const act = (id) => bar() && bar().querySelector(`[data-bb-roster-act="${id}"]`);

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

    const clean = () => Roster().clearJob();
    /** A spec body that leaves no fixture and no job behind, however it ends. */
    const cleanly = (run) => async () => {
        try {
            await run();
        } finally {
            teardown();
            await clean();
        }
    };

    async function until(test, ms = 4000) {
        for (const end = Date.now() + ms; Date.now() < end;) {
            if (test()) return true;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return false;
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
            assertEqual(scope && scope.id, 'headerRow');
            assertEqual(scope.querySelector('[data-testid$="-follow"]').id, 'theirs');
            // The fixture still shows the hazard: if X ever reorders these, this says so.
            assertEqual(document.querySelector('[data-testid$="-follow"]').id, 'suggestion');
            teardown();
        });

        test('no header row means no scope, rather than the whole page', () => {
            stage('<div><button data-testid="99-follow" id="suggestion"></button></div>');
            assertEqual(RosterContent().actionScope('twitter'), null, 'a job stops on a null');
            teardown();
        });

        test('REGRESSION: on old Reddit, a subreddit not joined reads as not joined', () => {
            // Old Reddit's toggle is both links, always; `.active` is the one drawn.
            stage(`<div class="side"><div class="titlebox"><span class="fancy-toggle-button subscribe-button toggle">
                <a class="option active add login-required" href="#">subscribe</a><a class="option remove" href="#">unsubscribe</a>
            </span></div></div>`);
            const scope = RosterContent().actionScope('reddit');
            const table = RosterContent().SELECTORS.reddit;
            assertEqual(scope.className, 'titlebox');
            assert(scope.querySelector('.fancy-toggle-button a.option.remove:not(.hidden)'),
                'precondition: the old spelling matched a subreddit nobody had joined');
            assertEqual(scope.querySelector(table.followed[0]), null);
            assert(scope.querySelector(table.follow[0]), 'and its subscribe is the one to press');
            teardown();
        });
    });

    suite('the roster — the bar on the site\'s page', () => {
        const newBar = () => window.BB.RosterBar.createBar({ appearance: async () => ({}), dress: () => {} });

        test('says what it is doing, and hands its buttons back', async () => {
            const one = newBar();
            const pressed = [];
            try {
                await one.show({ head: 'Follow @alice?', line: 'Press Follow', acts: [{ id: 'skip', label: 'Skip' }], onAct: (id) => pressed.push(id) });
                assertEqual(bar().querySelector('.bb-roster-bar-head').textContent, 'Follow @alice?');
                const skip = act('skip');
                skip.click();
                assertDeepEqual(pressed, ['skip']);

                await one.show({ head: 'Follow @bob?', acts: [{ id: 'skip', label: 'Skip' }] });
                assert(skip.isConnected, 'the same buttons are not drawn again under the pointer');
                assertEqual(bar().querySelector('.bb-roster-bar-line').textContent, '');
            } finally { one.hide(); }
            assertEqual(bar(), null);
        });

        test('two shows at once draw one bar, and a hide before it is built wins', async () => {
            const one = newBar();
            await Promise.all([one.show({ head: 'a' }), one.show({ head: 'b' })]);
            assertEqual(document.querySelectorAll(`#${BAR()}`).length, 1);
            one.hide();
            const shown = one.show({ head: 'c' });
            one.hide();
            await shown;
            assertEqual(bar(), null);
        });

        test('rings the site\'s button and takes the ring off again', () => {
            const one = newBar();
            const button = document.createElement('button');
            document.body.append(button);
            try {
                one.mark(button);
                assert(button.hasAttribute(MARK()));
                one.unmark();
                assert(!button.hasAttribute(MARK()));
            } finally { button.remove(); }
        });
    });

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

    // A job once ran on every page of its site: it looped on a page the site
    // redirected, and took over any tab of the site opened meanwhile.
    suite('the roster — which page may take a job up', () => {
        test('REGRESSION: a tab sent to the list and signed out stops, rather than going round', cleanly(async () => {
            const job = Roster().heading(jobFor({ site: 'reddit', action: 'read' }), '/subreddits/mine/subscriber/');
            const { page, job: after } = await enter('reddit', '/login/', job);
            assertEqual(page.sent.length, 0, 'sent back to the list, it is only sent to /login again');
            assertEqual(after.status, 'paused');
            assert(/sign in/i.test(after.note), after.note);
        }));

        test('REGRESSION: another tab of the site leaves the job alone, on the job\'s own page too', cleanly(async () => {
            stage('<div id="siteTable"><div class="thing subreddit"><a class="title" href="/r/rust/">rust</a></div></div>');
            const { page, job: after } = await enter('reddit', '/subreddits/mine/subscriber/', jobFor({ site: 'reddit', action: 'read' }), TAB + 1);
            assertEqual(page.sent.length, 0);
            assertDeepEqual([after.status, after.found.length], ['running', 0], 'not read, not stopped');
        }));

        test('its own tab, taken somewhere else by the user, waits', cleanly(async () => {
            const { page, job: after } = await enter('reddit', '/r/rust/', jobFor({ site: 'reddit', action: 'read' }));
            assertEqual(page.sent.length, 0, 'an ordinary visit is not dragged back');
            assertEqual(after.status, 'running');
        }));

        test('a profile that is not the name the job is on is left alone', cleanly(async () => {
            const { page, job: after } = await enter('twitter', '/bob', jobFor({ site: 'twitter', action: 'apply', names: ['alice'] }));
            assertEqual(page.sent.length, 0);
            assertDeepEqual([after.status, after.at], ['running', 0]);
        }));

        test('a page of old Reddit\'s list is read into the roster', cleanly(async () => {
            stage(`<div id="siteTable">
                <div class="thing subreddit"><a class="title" href="https://old.reddit.com/r/rust/">rust</a></div>
                <div class="thing subreddit"><a class="title" href="https://old.reddit.com/r/cpp/">cpp</a></div>
                <div class="thing subreddit"><a class="title" href="https://old.reddit.com/user/someone/">a profile</a></div>
            </div>`);
            // Sent to old.reddit.com: another origin, where a mark in sessionStorage did not follow.
            const job = Roster().heading(jobFor({ site: 'reddit', action: 'read' }), '/subreddits/mine/subscriber/');
            const { job: after } = await enter('reddit', '/subreddits/mine/subscriber/', job);
            assertEqual(after.status, 'done');
            assertEqual(after.headingTo, '', 'and it has arrived');
            assertDeepEqual((await Roster().loadRosters()).reddit.names, ['rust', 'cpp']);
            assertEqual(bar(), null, 'and the bar is gone');
        }));

        test('an empty list is not saved over the last read', cleanly(async () => {
            stage('<div id="siteTable"></div>');
            await Roster().saveRoster('reddit', ['kept']);
            const { job: after } = await enter('reddit', '/subreddits/mine/subscriber/', jobFor({ site: 'reddit', action: 'read' }));
            assertEqual(after.status, 'paused');
            assertDeepEqual((await Roster().loadRosters()).reddit.names, ['kept']);
        }));

        test('REGRESSION: the following list is read from rows you follow, and nothing is scrolled', cleanly(async () => {
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
                assert(await until(() => act('done') && /2 so far/.test(bar().textContent)), 'the bar counts the two rows you follow');
                act('done').click();
                await reading;
                assertDeepEqual((await Roster().loadRosters()).twitter.names, ['alice', 'bob'],
                    'not the suggestion under the list, nor the sidebar');
                assertEqual((await Roster().loadJob()).status, 'done');
                assertEqual(scrolled, 0, 'scrolling x.com from a script is scripting the site');
            } finally {
                window.scrollTo = scrollTo;
            }
        }));

        test('a tab sent to a name and landing elsewhere stops the job', cleanly(async () => {
            const job = Roster().heading(jobFor({ site: 'twitter', action: 'apply', names: ['alice'] }), '/alice');
            const { page, job: after } = await enter('twitter', '/i/flow/login', job);
            assertEqual(page.sent.length, 0);
            assertEqual(after.status, 'paused');
            assert(after.note.includes('@alice'), after.note);
        }));

        test('sent there long ago, the tab being elsewhere is the user\'s doing', cleanly(async () => {
            const then = Date.now() - Roster().SENT_MS - 1000;
            const job = Roster().heading(jobFor({ site: 'twitter', action: 'apply', names: ['alice'] }), '/alice', then);
            const { job: after } = await enter('twitter', '/home', job);
            assertEqual(after.status, 'running', 'not a stop: nothing went wrong');
        }));
    });

    /** A job on @alice, then @bob, running on @alice's page. */
    async function onAlice(gap = 50) {
        await Roster().saveJob(jobFor({ site: 'twitter', action: 'apply', names: ['alice', 'bob'] }));
        const page = pageAt('/alice');
        const running = RosterContent().createRoster({ site: 'twitter', notify: () => {}, page, delay: () => gap, tabId: async () => TAB }).install();
        return { page, running };
    }

    // The job once pressed Follow itself; now it rings the button and waits.
    suite('the roster — following is your press, not the job\'s', () => {
        test('REGRESSION: nothing is pressed for you; your press moves the job on', cleanly(async () => {
            stage(PROFILE);
            const theirs = document.getElementById('theirs');
            let presses = 0;
            // X's own handler, as far as this needs it: the button turns.
            theirs.addEventListener('click', () => { presses++; theirs.dataset.testid = '42-unfollow'; });
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
        }));

        test('Stop during the gap after a follow ends the job before the next page', cleanly(async () => {
            stage(PROFILE);
            const theirs = document.getElementById('theirs');
            theirs.addEventListener('click', () => { theirs.dataset.testid = '42-unfollow'; });
            const { page, running } = await onAlice(5000);
            assert(await until(() => theirs.hasAttribute(MARK())));
            theirs.click();
            const head = () => document.querySelector(`#${BAR()} .bb-roster-bar-head`);
            assert(await until(() => head() && head().textContent === 'Followed @alice'), 'the gap is counted down');
            assert(/@bob opens in \ds/.test(bar().textContent));
            act('stop').click();
            await running;
            assertEqual(await Roster().loadJob(), null);
            assertDeepEqual(page.sent, [], '@bob is never opened');
        }));

        test('an account already followed costs nothing against the day', cleanly(async () => {
            stage(PROFILE.replace('42-follow', '42-unfollow'));
            const { page, running } = await onAlice();
            await running;
            const after = await Roster().loadJob();
            assertDeepEqual([after.at, after.skipped, after.today], [1, 1, 0]);
            assertDeepEqual(page.sent, ['https://x.com/bob']);
        }));

        test('with no Follow button, Skip is yours to press', cleanly(async () => {
            stage('<div data-testid="primaryColumn"><div><button data-testid="userActions"></button></div></div>');
            const { page, running } = await onAlice();
            assert(await until(() => act('skip')), 'the bar offers Skip');
            assertEqual((await Roster().loadJob()).status, 'running', 'a missing button is asked about, not a stop');
            act('skip').click();
            await running;
            const after = await Roster().loadJob();
            assertDeepEqual([after.at, after.passed, after.today], [1, 1, 0]);
            assertDeepEqual(page.sent, ['https://x.com/bob']);
        }));
    });

    /** A content script asked from the popup: the tab asked is the tab that does it. */
    function asked(site, path, extra = {}) {
        const page = pageAt(path);
        const notes = [];
        const roster = RosterContent().createRoster({ site, notify: (message) => notes.push(message), page, ...extra });
        return { page, notes, roster };
    }

    suite('the roster — asked from the popup', () => {
        const cleanBar = (run) => cleanly(async () => {
            try {
                await run();
            } finally {
                if (bar()) bar().remove();
            }
        });

        test('a read starts on the tab that was asked, and goes to the list', cleanly(async () => {
            const { page, roster } = asked('reddit', '/r/rust/');
            assertDeepEqual(roster.start({ kind: 'read', tabId: TAB }), { ok: true });
            assert(await until(() => page.sent.length === 1), 'no dashboard, and no waiting for a tab');
            assert(/\/subreddits\/mine\//.test(page.sent[0]), page.sent[0]);
            const job = await Roster().loadJob();
            assertDeepEqual([job.site, job.action, job.status], ['reddit', 'read', 'running']);
            assertEqual(job.tabId, TAB, 'the job is that tab\'s');
            assertEqual(job.headingTo, '/subreddits/mine/subscriber/', 'and where it was sent is written down');
        }));

        test('with a job running, a second is not started over it', cleanly(async () => {
            await Roster().saveJob(Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice'] }));
            const { page, notes, roster } = asked('reddit', '/r/rust/');
            roster.start({ kind: 'read', tabId: TAB });
            assert(await until(() => notes.length === 1), 'said on the page');
            assertEqual(page.sent.length, 0);
            assertEqual((await Roster().loadJob()).site, 'twitter');
        }));

        test('Carry on takes a stopped job back to the page it stopped on', cleanly(async () => {
            // Stopped in a tab since closed; carried on in the one asked.
            await Roster().saveJob({ ...Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice', 'bob'], tabId: 3 }), status: 'paused', note: 'x' });
            const { page, roster } = asked('twitter', '/home');
            roster.start({ kind: 'resume', tabId: TAB });
            assert(await until(() => page.sent.length === 1));
            assertDeepEqual(page.sent, ['https://x.com/alice']);
            const after = await Roster().loadJob();
            assertDeepEqual([after.status, after.note, after.at, after.tabId], ['running', '', 0, TAB]);
        }));

        test('Skip passes over the name it stopped on', cleanly(async () => {
            await Roster().saveJob({ ...Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice', 'bob'] }), status: 'paused' });
            const { page, roster } = asked('twitter', '/home');
            roster.start({ kind: 'skip', tabId: TAB });
            assert(await until(() => page.sent.length === 1));
            assertDeepEqual(page.sent, ['https://x.com/bob']);
            const after = await Roster().loadJob();
            assertDeepEqual([after.at, after.passed, after.today], [1, 1, 0]);
        }));

        test('a list is picked on the page, its cost said, and only then started', cleanBar(async () => {
            const { page, roster } = asked('twitter', '/home', { pickFile: async () => '@alice\n# not her\n@bob\n' });
            await Roster().saveRoster('twitter', ['bob']);
            roster.start({ kind: 'pick', tabId: TAB });
            assert(await until(() => act('choose')), 'the bar asks for the file');
            act('choose').click();
            assert(await until(() => act('go')), 'and then for a yes');
            assert(/2 accounts, 1 not in your last read\. You press Follow on each/.test(bar().textContent), bar().textContent.trim());
            assertEqual(await Roster().loadJob(), null, 'a file is a plan, not a job');
            act('go').click();
            assert(await until(() => page.sent.length === 1));
            assertDeepEqual(page.sent, ['https://x.com/alice']);
            const made = await Roster().loadJob();
            assertDeepEqual([made.names, made.tabId], [['alice', 'bob'], TAB]);
        }));

        test('a file with no names in it starts nothing', cleanBar(async () => {
            const { roster } = asked('reddit', '/', { pickFile: async () => 'x\n\n' });
            roster.start({ kind: 'pick', tabId: TAB });
            assert(await until(() => act('choose')));
            act('choose').click();
            assert(await until(() => /Nothing in that file/.test(bar().textContent)));
            assertEqual(act('go'), null);
            assertEqual(await Roster().loadJob(), null);
        }));

        test('a request it does not know is refused, and nothing is written', cleanly(async () => {
            const { roster } = asked('reddit', '/');
            assertDeepEqual(roster.start({ kind: 'follow-everyone', tabId: TAB }), { ok: false });
            assertDeepEqual(roster.start({ kind: 'read' }), { ok: false }, 'nor one that does not say which tab');
            assertDeepEqual(roster.start({ kind: 'status' }), { ok: true, working: false });
            assertEqual(await Roster().loadJob(), null);
        }));
    });

    /**
     * The popup's panel over tab TAB, which answers `answer` to whatever it
     * is asked; `open` is the other tabs there are. `run` gets the panel.
     */
    function withPopup(site, answer, open, run) {
        return cleanly(async () => {
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
            try {
                await view.render();
                const press = async (name) => {
                    body.querySelector(`[data-act="${name}"]`).click();
                    await new Promise((resolve) => setTimeout(resolve, 60));
                };
                await run({ body, asks, shown, press, closed: () => closed, button: (name) => body.querySelector(`[data-act="${name}"]`) });
            } finally {
                body.remove();
            }
        });
    }

    suite('the roster — the popup\'s panel', () => {
        test('a read is asked of the tab, and the popup closes over it', async () => {
            await chrome.storage.local.remove(Roster().ROSTERS_KEY);
            await withPopup('reddit', { ok: true }, [], async (p) => {
                assert(/Your subreddits/i.test(p.body.textContent));
                assert(p.button('download').disabled, 'nothing read, nothing to download');
                await p.press('read');
                assertDeepEqual(p.asks, ['read']);
                assertEqual(p.closed(), 1);
                assertEqual(await Roster().loadJob(), null, 'the popup writes no job: the tab that runs it does');
            })();
        });

        test('REGRESSION: a tab with nothing in it to answer is said so, and nothing is left running', withPopup('reddit', null, [], async (p) => {
            // A tab that could not take a job once left it "running" with no tab on it.
            await p.press('read');
            assertEqual(p.closed(), 0, 'the popup stays, to say why');
            assert(/Reload this tab first/.test(p.body.querySelector('.roster-pop-problem').textContent));
            assertEqual(await Roster().loadJob(), null);
        }));

        test('a stopped job offers to carry on here, or to skip the name it stopped on', async () => {
            await Roster().saveJob({
                ...Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice', 'carol'] }),
                at: 1, done: 1, status: 'paused', note: 'Twitter sent the tab to /i/flow/login instead of @carol.',
            });
            await withPopup('twitter', { ok: true }, [], async (p) => {
                assert(/Accounts you follow/.test(p.body.textContent), 'not "your accounts", which are the ones you own');
                assert(/instead of @carol/.test(p.body.textContent));
                assertEqual(p.button('skip').textContent, 'Skip @carol');
                assert(p.button('read').disabled, 'one job at a time');
                await p.press('skip');
                assertDeepEqual(p.asks, ['skip']);
            })();
        });

        test('a job of the other site is shown, and stopped, but not carried on from here', async () => {
            await Roster().saveJob({ ...Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice'] }), status: 'paused', note: 'x' });
            await withPopup('reddit', { ok: true }, [], async (p) => {
                assert(/Twitter: Following/.test(p.body.textContent), p.body.textContent.trim());
                assertEqual(p.button('resume'), null, 'that is for a tab of x.com to be asked');
                await p.press('stop');
                assertEqual(await Roster().loadJob(), null);
            })();
        });

        test('REGRESSION: a job whose tab is closed is said so, and carried on here', async () => {
            // "No reddit.com tab is working on this", for as long as anyone looked.
            await Roster().saveJob(Roster().newJob({ site: 'reddit', action: 'read', tabId: 99 }));
            await withPopup('reddit', { ok: true }, [], async (p) => {
                assert(/The tab it was running in is closed/.test(p.body.textContent), p.body.textContent.trim());
                await p.press('resume');
                assertDeepEqual(p.asks, ['resume']);
            })();
        });

        test('one running in another tab is gone to, not started twice', async () => {
            await Roster().saveJob(Roster().newJob({ site: 'reddit', action: 'read', tabId: 99 }));
            await withPopup('reddit', { ok: true }, [99], async (p) => {
                assertEqual(p.button('resume'), null);
                await p.press('show');
                assertDeepEqual(p.shown, [99]);
            })();
        });

        test('one at work in this tab is only said to be', async () => {
            await Roster().saveJob(jobFor({ site: 'twitter', action: 'apply', names: ['alice'] }));
            await withPopup('twitter', { ok: true, working: true }, [], async (p) => {
                assert(/Waiting in this tab for you to press Follow/.test(p.body.textContent), p.body.textContent.trim());
                assertEqual(p.button('resume'), null);
                assertEqual(p.button('stop').textContent, 'Stop');
            })();
        });

        test('what a read had found is saved from here, its tab closed or not', async () => {
            await Roster().saveJob({ ...Roster().newJob({ site: 'reddit', action: 'read' }), found: ['rust', 'cpp'] });
            await withPopup('reddit', { ok: true }, [], async (p) => {
                await p.press('save');
                assertDeepEqual((await Roster().loadRosters()).reddit.names, ['rust', 'cpp']);
                assertEqual(await Roster().loadJob(), null);
                assert(!p.button('download').disabled, 'and there is a file to download');
            })();
        });
    });
})();
