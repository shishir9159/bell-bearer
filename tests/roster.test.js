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

        test('reddit is scoped to the page, because its toggle is unambiguous', () => {
            stage('<div class="fancy-toggle-button"><a class="option add">subscribe</a></div>');
            assertEqual(RosterContent().actionScope('reddit'), document);
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
    });

    /**
     * Which page may act on a job. A job used to be taken up by every page of
     * its site for as long as it ran, which looped forever on a page the site
     * redirected — and took over any tab of the site opened while it ran.
     */
    const Roster = () => window.BB.Roster;
    const HOP = 'bb-roster-hop';

    /** A stand-in for `location` at `path`, recording where it was sent. */
    function pageAt(path) {
        const sent = [];
        return { sent, path: () => path, href: () => `https://example.test${path}`, assign: (url) => sent.push(url) };
    }

    async function enter(site, path, job, hop = '') {
        await Roster().saveJob(job);
        if (hop) sessionStorage.setItem(HOP, hop);
        const page = pageAt(path);
        await RosterContent().createRoster({ site, notify: () => {}, page }).install();
        return { page, job: await Roster().loadJob() };
    }

    async function clean() {
        sessionStorage.removeItem(HOP);
        await Roster().clearJob();
    }

    suite('the roster — which page may take a job up', () => {
        test('REGRESSION: a tab sent to the list and signed out stops, rather than going round', async () => {
            try {
                const job = Roster().newJob({ site: 'reddit', action: 'read' });
                const { page, job: after } = await enter('reddit', '/login/', job, '/subreddits/mine/subscriber/');
                assertEqual(page.sent.length, 0, 'sent back to the list, it is only sent to /login again');
                assertEqual(after.status, 'paused');
                assert(/sign in/i.test(after.note), after.note);
            } finally { await clean(); }
        });

        test('just after the dashboard opened a tab, it finds its way to the list', async () => {
            try {
                const job = Roster().newJob({ site: 'reddit', action: 'read' });
                const { page } = await enter('reddit', '/', job);
                assertEqual(page.sent.length, 1);
                assert(/\/subreddits\/mine\//.test(page.sent[0]), page.sent[0]);
                assertEqual(sessionStorage.getItem(HOP), '/subreddits/mine/subscriber/', 'and marks the tab as sent');
            } finally { await clean(); }
        });

        test('later on, another page of the site leaves the job alone', async () => {
            try {
                const job = Roster().newJob({ site: 'reddit', action: 'read', now: Date.now() - Roster().KICK_MS - 1000 });
                const { page, job: after } = await enter('reddit', '/r/rust/', job);
                assertEqual(page.sent.length, 0, 'an ordinary visit is not taken over');
                assertEqual(after.status, 'running');
                assertEqual(after.leaseBy, '', 'nor held');
            } finally { await clean(); }
        });

        test('a profile that is not the name the job is on is left alone', async () => {
            try {
                const job = Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice'] });
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
                const job = Roster().newJob({ site: 'reddit', action: 'read' });
                const { job: after } = await enter('reddit', '/subreddits/mine/subscriber/', job);
                assertEqual(after.status, 'done');
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
                const job = Roster().newJob({ site: 'reddit', action: 'read' });
                const { job: after } = await enter('reddit', '/subreddits/mine/subscriber/', job);
                assertEqual(after.status, 'paused');
                assertDeepEqual((await Roster().loadRosters()).reddit.names, ['kept']);
            } finally {
                teardown();
                await clean();
            }
        });

        test('a tab sent to a name and landing elsewhere stops the job', async () => {
            try {
                const job = Roster().newJob({ site: 'twitter', action: 'apply', names: ['alice'] });
                const { page, job: after } = await enter('twitter', '/i/flow/login', job, '/alice');
                assertEqual(page.sent.length, 0);
                assertEqual(after.status, 'paused');
                assert(after.note.includes('@alice'), after.note);
            } finally { await clean(); }
        });
    });
})();
