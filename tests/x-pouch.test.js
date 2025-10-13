/**
 * The bits of the X surfaces that only a real DOM can answer: where the pouch
 * button lands in a post's action row, what gets read out of a post, and what
 * the ad sweep hides.
 *
 * The pure logic — two independent topic lists, re-filing as a move, handles,
 * avatar URLs — is in tests/node-check.js, which runs in a second. What is
 * here is everything that needs elements.
 *
 * Like the YouTube specs, these call the injectors straight off the factory
 * rather than through install(): the watcher only runs its tasks on an
 * animation frame, and a backgrounded tab may not get one for seconds.
 */

/*
 * Wrapped, unlike the older specs, because these share the global scope with
 * them: this file declares a makeUi and a teardown of its own, and a bare
 * `const makeUi` beside youtube-ui.test.js's `function makeUi` is a
 * SyntaxError that takes the whole file out of the run without failing a
 * single test. The suites below register through the globals `suite` and
 * `test`, so nothing here needs to be global itself.
 */
(function () {
    'use strict';

    const TwitterUi = () => window.BB.TwitterUi;
    const TwitterAds = () => window.BB.TwitterAds;
    const TwitterPage = () => window.BB.TwitterPage;

    const NO_WATCHER = { add() {}, remove() {}, has: () => false, schedule() {}, stop() {} };

    /**
     * A stand-in post, built out of the `data-testid` hooks X's own markup uses —
     * which is the whole reason the selectors key off those rather than off class
     * names that change on every deploy.
     */
    function timeline({ promoted = false, bookmark = true } = {}) {
        teardown();
        const host = document.createElement('div');
        host.id = 'bb-x-test';

        const actions = `
            <div role="group" id="id__abc">
                <button data-testid="reply"></button>
                <button data-testid="retweet"></button>
                <button data-testid="like"></button>
                ${bookmark ? '<div><button data-testid="bookmark"></button></div>' : ''}
                <div><button aria-label="Share post"></button></div>
            </div>`;

        const article = `
            <article data-testid="tweet" role="article">
                <div data-testid="Tweet-User-Avatar">
                    <img src="https://pbs.twimg.com/profile_images/1/ilya_normal.jpg">
                </div>
                <div data-testid="User-Name">
                    <a href="/isorokin"><div><span>Ilya Sorokin</span></div></a>
                    <a href="/isorokin"><span>@isorokin</span></a>
                    <span>·</span>
                    <a href="/isorokin/status/1770"><time datetime="2026-09-21T06:00:00.000Z">6h</time></a>
                </div>
                <div data-testid="tweetText">Occupancy is not throughput.</div>
                ${actions}
            </article>`;

        host.innerHTML = `
            <div data-testid="cellInnerDiv">
                ${promoted ? `<div data-testid="placementTracking">${article}</div>` : article}
            </div>`;

        document.body.appendChild(host);
        return host;
    }

    function teardown() {
        const host = document.getElementById('bb-x-test');
        if (host) host.remove();
        document.querySelectorAll('#bb-x-picker, #bb-x-pouch-panel, #bb-x-pouch-scrim').forEach((el) => el.remove());
    }

    /**
     * Put raw markup on the page, clearing whatever was there.
     *
     * Clearing FIRST rather than only in teardown() is the point: the harness
     * has no afterEach, so a test that fails at its first assertion never
     * reaches its own teardown, and the next three read the DOM it left
     * behind. One real failure used to report as four.
     */
    function stage(html) {
        teardown();
        const host = document.createElement('div');
        host.id = 'bb-x-test';
        host.innerHTML = html;
        document.body.appendChild(host);
        return host;
    }

    /**
     * All three X surfaces are off in the schema, so a spec about where a
     * button lands has to ask for it. Pass an override to turn one back off:
     * `makeUi({ twitterHideBookmark: false })`.
     */
    const ALL_ON = {
        twitterPouchPosts: true,
        twitterPouchPeople: true,
        twitterHideBookmark: true,
    };

    const makeUi = (settings) => TwitterUi().createTwitterUi({
        watcher: NO_WATCHER,
        notify() {},
        getSettings: () => ({ ...ALL_ON, ...settings }),
    });

    /** The factory with no settings at all — the extension as it ships. */
    const defaultUi = () => TwitterUi().createTwitterUi({ watcher: NO_WATCHER, notify() {} });

    /**
     * X's navigation column, cut down to the one row ours is measured
     * against. The badge sits in a `div[dir]` of its own ahead of the label
     * on purpose — that is the arrangement that made the Pouch row come out
     * in 11px type before navLabel learned to step over a number.
     */
    const NAV = `
        <header role="banner">
            <nav role="navigation">
                <a data-testid="AppTabBar_Home_Link" href="/home">
                    <div dir="ltr"><span style="font-size: 11px">3</span></div>
                    <svg width="30" height="30" style="width: 30px; height: 30px"></svg>
                    <div dir="ltr"><span style="font-size: 23px; font-weight: 800">Home</span></div>
                </a>
            </nav>
        </header>`;

    suite('x.com — the Pouch row in the navigation', () => {
        test('the mark is drawn rather than loaded', () => {
            stage(NAV);
            makeUi().injectNavEntry();

            const entry = document.getElementById('bb-x-nav-entry');
            assert(entry, 'the row goes in');
            // The <img> this replaced went through Dom.safeUrlAttr, which
            // passes http(s) and nothing else — so a chrome-extension:// src
            // came out as "#" and the row wore a broken image.
            assertEqual(entry.querySelectorAll('img').length, 0, 'nothing to fail to load');
            assert(entry.querySelector('.bb-pouch-glyph'), 'the shared glyph, in currentColor');
            teardown();
        });

        test('it sits under Home', () => {
            stage(NAV);
            makeUi().injectNavEntry();

            const home = document.querySelector('[data-testid="AppTabBar_Home_Link"]');
            assertEqual(home.nextElementSibling.id, 'bb-x-nav-entry');
            teardown();
        });

        test('its type and icon are measured off X\'s own row, not the badge', () => {
            stage(NAV);
            makeUi().injectNavEntry();

            const entry = document.getElementById('bb-x-nav-entry');
            const text = entry.querySelector('.bb-x-nav-text');
            // X scales both with its display-size setting, and content.css
            // can only carry one reading of it.
            assertEqual(text.style.fontSize, '23px', 'the label, not the 11px badge beside it');
            assertEqual(text.style.fontWeight, '800');
            assertEqual(entry.querySelector('.bb-x-nav-ico').style.height, '30px');
            teardown();
        });

        test('a navigation with no Home row still gets a row', () => {
            stage('<header role="banner"><nav role="navigation"></nav></header>');
            makeUi().injectNavEntry();

            // Nothing to measure is not a reason to place nothing: content.css
            // carries the fallback metrics for exactly this.
            assert(document.getElementById('bb-x-nav-entry'), 'placed anyway');
            teardown();
        });
    });

    suite('x.com — the pouch button on a post', () => {
        test('one button goes into the action row of every post', () => {
            timeline();
            makeUi().injectPostButtons();

            const buttons = document.querySelectorAll('#bb-x-test .bb-x-post-btn');
            assertEqual(buttons.length, 1, 'exactly one, in the post');
            assert(buttons[0].closest('[role="group"]'), 'inside X\'s own action row');
            teardown();
        });

        test('a post is only ever fitted once', () => {
            timeline();
            const ui = makeUi();
            // The injector runs on every mutation for the life of the page, so
            // "already done" has to be cheap AND correct — a second button per
            // post on every scroll is the bug the guard prevents.
            ui.injectPostButtons();
            ui.injectPostButtons();
            ui.injectPostButtons();

            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-post-btn').length, 1);
            teardown();
        });

        test('it stands where the bookmark was, and the bookmark stands down', () => {
            timeline();
            makeUi().injectPostButtons();

            const ours = document.querySelector('#bb-x-test .bb-x-post-btn');
            const theirs = document.querySelector('#bb-x-test [data-testid="bookmark"]').parentElement;

            assert(theirs.classList.contains('bb-x-hidden'), 'X\'s bookmark is hidden, not removed');
            assertEqual(ours.parentElement.nextElementSibling, theirs, 'ours takes its place in the row');
            teardown();
        });

        test('the button goes in wrapped, as one of the row\'s own cells', () => {
            timeline();
            makeUi().injectPostButtons();

            const slot = document.querySelector('#bb-x-test .bb-x-post-btn').parentElement;

            // A bare <button> as a sibling is right in a timeline row and half
            // a line low in an opened post's, where every cell is a growing
            // flex box with the glyph centred inside it.
            assert(slot.classList.contains('bb-x-post-slot'), 'wrapped, not bare');
            assert(slot.closest('[role="group"]'), 'and still inside X\'s action row');
            teardown();
        });

        test('a row with no bookmark still gets the button, at the end', () => {
            timeline({ bookmark: false });
            makeUi().injectPostButtons();

            const group = document.querySelector('#bb-x-test [role="group"]');
            assert(group.lastElementChild.classList.contains('bb-x-post-slot'),
                'no bookmark to replace, so it goes on the end rather than nowhere');
            assert(group.lastElementChild.querySelector('.bb-x-post-btn'), 'with the button in it');
            teardown();
        });

        test('the button carries the status id it will file', () => {
            timeline();
            makeUi().injectPostButtons();

            assertEqual(document.querySelector('#bb-x-test .bb-x-post-btn').dataset.bbStatus, '1770');
            teardown();
        });
    });

    /*
     * The two helpers below are tested straight off the module rather than
     * through an injector. Both answer the same question — what does the
     * control X put here look like, so ours can look like it too — and both
     * are read off elements the specs can build, where driving them through
     * injectProfileButton would mean moving the address bar to /<handle>,
     * which is the one thing a page opened over file:// cannot do.
     */
    suite('x.com — the X surfaces are off until asked for', () => {
        test('a post gets nothing, and keeps its bookmark, by default', () => {
            timeline();
            // No settings passed at all: the factory falls back to the schema,
            // rather than to a second set of defaults of its own to keep in
            // step with settings.js.
            defaultUi().injectPostButtons();

            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-post-btn').length, 0);
            assert(!document.querySelector('#bb-x-test [data-testid="bookmark"]')
                .parentElement.classList.contains('bb-x-hidden'), 'X\'s own button is left alone');
            teardown();
        });

        test('the pouch button can go in with the bookmark left standing', () => {
            timeline();
            makeUi({ twitterHideBookmark: false }).injectPostButtons();

            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-post-btn').length, 1);
            assert(!document.querySelector('#bb-x-test [data-testid="bookmark"]')
                .parentElement.classList.contains('bb-x-hidden'),
                'the two settings are independent — either half is a reasonable thing to want');
            teardown();
        });

        test('the bookmark can go with nothing put in its place', () => {
            timeline();
            makeUi({ twitterPouchPosts: false }).injectPostButtons();

            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-post-btn').length, 0);
            assert(document.querySelector('#bb-x-test [data-testid="bookmark"]')
                .parentElement.classList.contains('bb-x-hidden'));
            teardown();
        });

        test('switching them off puts the page that is open back', () => {
            timeline();
            let settings = { ...ALL_ON };
            const ui = TwitterUi().createTwitterUi({
                watcher: NO_WATCHER, notify() {}, getSettings: () => settings,
            });
            ui.injectPostButtons();

            // A switch that only takes effect on the next reload reads as a
            // switch that did nothing.
            settings = { twitterPouchPosts: false, twitterPouchPeople: false, twitterHideBookmark: false };
            ui.refreshSurfaces();

            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-post-btn').length, 0, 'ours is gone');
            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-post-slot').length, 0,
                'and so is the cell it sat in, which would otherwise be a gap in the row');
            assert(!document.querySelector('#bb-x-test [data-testid="bookmark"]')
                .parentElement.classList.contains('bb-x-hidden'), 'and X\'s is back');
            teardown();
        });

        test('the bookmark is hidden after ours is measured against it', () => {
            timeline();
            makeUi().injectPostButtons();

            // Hiding it first leaves nothing to copy: a display:none cell
            // reports no layout at all, and the button lands unaligned.
            const slot = document.querySelector('#bb-x-test .bb-x-post-slot');
            assertEqual(slot.style.display, 'flex', 'it was measured while the row was whole');
            teardown();
        });
    });

    suite('x.com — copying X\'s own layout', () => {
        test('a cell of an opened post\'s row is copied, not guessed at', () => {
            // Each cell there is a growing flex box; ours has to grow with
            // them or the row comes out lopsided.
            const host = stage('<div style="display: block; flex-grow: 1; justify-content: center"></div>');
            const button = document.createElement('button');
            const slot = TwitterUi().slotFor(button, host.firstElementChild);

            assertEqual(slot.style.flexGrow, '1', 'grows with the cells beside it');
            assertEqual(slot.style.justifyContent, 'center');
            assertEqual(slot.style.alignItems, 'center', 'which is what centres the glyph');
            assertEqual(slot.style.display, 'flex', "a copied 'block' drops the glyph to the baseline");
            assertEqual(slot.firstElementChild, button, 'and the button is in it');
            teardown();
        });

        test('a cell with nothing to copy is still a cell', () => {
            const slot = TwitterUi().slotFor(document.createElement('button'), null);
            assert(slot.classList.contains('bb-x-post-slot'), 'content.css carries the fallback');
            assertEqual(slot.getAttribute('style'), null, 'and nothing is written over it');
        });

        test('a profile button wears X\'s ring rather than one of its own', () => {
            const host = stage(`
                <button data-testid="userActions"
                        style="width: 34px; height: 34px; border: 1px solid rgb(83, 100, 113);
                               margin-left: 0px; margin-right: 0px"></button>`);
            const more = host.firstElementChild;
            const button = document.createElement('button');

            TwitterUi().wearRing(button, TwitterUi().ringModel(more));

            // Our own 36px ring in currentColor was both a shade too dark and
            // two pixels too tall, which is what put it below their line.
            assertEqual(button.style.getPropertyValue('--bb-x-ring-size'), '34px');
            assertEqual(button.style.getPropertyValue('--bb-x-ring'), 'rgb(83, 100, 113)');
            assertEqual(button.style.getPropertyValue('--bb-x-ring-width'), '1px');
            // A guessed 8px is wrong wherever X spaces that row with a gap.
            assertEqual(button.style.marginRight, '0px');
            teardown();
        });

        test('the ring is found when X has moved the border inside', () => {
            const host = stage(`
                <div data-testid="userActions">
                    <div style="border: 2px solid rgb(1, 2, 3); width: 40px; height: 40px"></div>
                </div>`);
            const model = TwitterUi().ringModel(host.firstElementChild);

            // Reading the outer element would have given a zero border and
            // left the button in currentColor, which is the bug in miniature.
            assertEqual(model, host.firstElementChild.firstElementChild);
            teardown();
        });
    });

    suite('x.com — reading a post', () => {
        test('a post is read off its own markup', () => {
            timeline();
            const post = TwitterPage().readPost(document.querySelector('#bb-x-test article'));

            assertEqual(post.statusId, '1770');
            assertEqual(post.handle, '@isorokin');
            assertEqual(post.name, 'Ilya Sorokin');
            assertEqual(post.text, 'Occupancy is not throughput.');
            assertEqual(post.avatar, 'https://pbs.twimg.com/profile_images/1/ilya_bigger.jpg');
            assertEqual(post.postedAt, Date.parse('2026-09-21T06:00:00.000Z'));
            teardown();
        });

        test('a post with no status id is not half-read', () => {
            stage('<article data-testid="tweet"><div data-testid="tweetText">x</div></article>');

            // The status id is how a post is keyed in storage. Half a record would
            // file the same post twice on the next scroll.
            assertEqual(TwitterPage().readPost(document.querySelector('#bb-x-test article')), null);
            teardown();
        });

        test('no button is fitted to a post that cannot be filed', () => {
            stage('<article data-testid="tweet"><div role="group"></div></article>');

            makeUi().injectPostButtons();
            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-post-btn').length, 0);
            teardown();
        });
    });

    suite('x.com — promoted posts and upsells', () => {
        const makeAds = (on) => TwitterAds().createTwitterAds({ watcher: NO_WATCHER, isEnabled: () => on });

        test('a promoted post is hidden by its whole cell, not just its article', () => {
            timeline({ promoted: true });
            makeAds(true).sweep();

            const cell = document.querySelector('#bb-x-test [data-testid="cellInnerDiv"]');
            assert(cell.classList.contains('bb-x-ad-hidden'),
                'hiding the article alone leaves X\'s padding behind as an empty stripe');
            teardown();
        });

        test('an ordinary post is left alone', () => {
            timeline({ promoted: false });
            makeAds(true).sweep();

            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-ad-hidden').length, 0);
            teardown();
        });

        test('nothing is hidden while the setting is off', () => {
            timeline({ promoted: true });
            makeAds(false).sweep();

            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-ad-hidden').length, 0);
            teardown();
        });

        test('turning it off puts the page back without a reload', () => {
            timeline({ promoted: true });
            const ads = makeAds(true);
            ads.sweep();
            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-ad-hidden').length, 1);

            // The switch has to undo itself on the page that is already open, or
            // it looks like it did nothing until the next reload.
            ads.restore();
            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-ad-hidden').length, 0);
            assertEqual(document.querySelectorAll('#bb-x-test [data-bb-ad]').length, 0,
                'and the marks come off too, so a re-enable sweeps it again');
            teardown();
        });

        test('an upsell in the right-hand column has no cell to hide', () => {
            stage('<aside aria-label="Subscribe to Premium"><span>Premium</span></aside>');

            makeAds(true).sweep();
            assert(document.querySelector('#bb-x-test aside').classList.contains('bb-x-ad-hidden'),
                'closest() answering null is the difference between a timeline slot and a sidebar');
            teardown();
        });
    });

    suite('x.com — the nav row', () => {
        test('the Pouch row goes under Home', () => {
            stage(`
                <header role="banner"><nav role="navigation">
                    <a data-testid="AppTabBar_Home_Link" href="/home">Home</a>
                    <a href="/explore">Explore</a>
                </nav></header>`);

            makeUi().injectNavEntry();

            const rows = [...document.querySelectorAll('#bb-x-test nav > *')];
            assertEqual(rows[1].id, 'bb-x-nav-entry', 'second, right after Home');
            assertEqual(rows.length, 3);
            teardown();
        });

        test('it is placed once, however often the injector runs', () => {
            stage('<header role="banner"><nav role="navigation"></nav></header>');

            const ui = makeUi();
            ui.injectNavEntry();
            ui.injectNavEntry();

            assertEqual(document.querySelectorAll('#bb-x-nav-entry, #bb-x-test .bb-x-nav').length, 1);
            teardown();
        });
    });

})();
