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
})();
