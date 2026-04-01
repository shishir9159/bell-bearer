/**
 * The X surfaces that need a DOM: the pouch button in a post's action row,
 * reading a post, and the ad sweep. The pure logic is in node-check.js.
 *
 * The injectors are called directly rather than through install(), whose
 * watcher only runs on an animation frame that a hidden tab may not get.
 */

// Wrapped: a bare `const makeUi` beside youtube-ui.test.js's `function makeUi`
// is a SyntaxError that drops this whole file without failing a test.
(function () {
    'use strict';

    const TwitterUi = () => window.BB.TwitterUi;
    const TwitterAds = () => window.BB.TwitterAds;
    const TwitterPage = () => window.BB.TwitterPage;

    const NO_WATCHER = { add() {}, remove() {}, has: () => false, schedule() {}, stop() {} };

    const q = (selector) => document.querySelector(`#bb-x-test ${selector}`);
    const count = (selector) => document.querySelectorAll(`#bb-x-test ${selector}`).length;
    const bookmarkHidden = () => q('[data-testid="bookmark"]').parentElement.classList.contains('bb-x-hidden');
    const iconLook = () => document.getElementById(TwitterUi().ICON_LOOK_ID);

    function teardown() {
        const host = document.getElementById('bb-x-test');
        if (host) host.remove();
        document.querySelectorAll('#bb-x-picker, #bb-x-pouch-panel, #bb-x-pouch-scrim').forEach((el) => el.remove());
        if (iconLook()) iconLook().remove();
    }

    // Clears first: there is no afterEach, so a test that fails early never
    // reaches its own teardown and the next ones would read its DOM.
    function stage(html) {
        teardown();
        const host = document.createElement('div');
        host.id = 'bb-x-test';
        host.innerHTML = html;
        document.body.appendChild(host);
        return host;
    }

    /** A timeline post, built from the `data-testid` hooks X's own markup uses. */
    function timeline({ promoted = false, bookmark = true } = {}) {
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
                <div role="group" id="id__abc">
                    <button data-testid="reply"></button>
                    <button data-testid="retweet"></button>
                    <button data-testid="like"></button>
                    ${bookmark ? '<div><button data-testid="bookmark"></button></div>' : ''}
                    <div><button aria-label="Share post"></button></div>
                </div>
            </article>`;
        return stage(`
            <div data-testid="cellInnerDiv">
                ${promoted ? `<div data-testid="placementTracking">${article}</div>` : article}
            </div>`);
    }

    /**
     * A post opened on its own page, quoting another: its stamp moves to the
     * foot, under the quoted card, whose own <time> is in no link.
     */
    function opened() {
        return stage(`
            <article data-testid="tweet" role="article" tabindex="-1">
                <div data-testid="User-Name">
                    <a href="/iquilezles"><div><span>Inigo Quilez</span></div></a>
                    <a href="/iquilezles"><span>@iquilezles</span></a>
                </div>
                <div data-testid="tweetText">A provocation.</div>
                <div role="link" tabindex="0">
                    <div data-testid="User-Name">
                        <div><span>Shader Bot</span></div>
                        <div><span>@shaderbot</span></div>
                        <time datetime="2026-10-19T08:00:00.000Z">Oct 19</time>
                    </div>
                    <div data-testid="tweetText">One shot.</div>
                </div>
                <a href="/iquilezles/status/2112354505346146630"><time datetime="2026-10-20T15:12:00.000Z">3:12 PM, Oct 20, 2026</time></a>
                <div role="group" id="id__focal">
                    <div><button data-testid="reply"></button></div>
                    <div><button data-testid="retweet"></button></div>
                    <div><button data-testid="like"></button></div>
                    <div><button data-testid="bookmark"></button></div>
                    <div><button aria-label="Share post"></button></div>
                </div>
            </article>`);
    }

    // All three surfaces are off in the schema, so the specs ask for them.
    const ALL_ON = { twitterPouchPosts: true, twitterPouchPeople: true, twitterHideBookmark: true };
    const uiWith = (getSettings) => TwitterUi().createTwitterUi({ watcher: NO_WATCHER, notify() {}, getSettings });
    const makeUi = (settings) => uiWith(() => ({ ...ALL_ON, ...settings }));
    const defaultUi = () => TwitterUi().createTwitterUi({ watcher: NO_WATCHER, notify() {} });

    /**
     * X's navigation, cut to the row you are on and one you are not. X draws
     * the current row bold, and measuring Home alone gave the Pouch row the
     * selected weight permanently. The badge ahead of Home's label is what
     * once made the Pouch row come out in 11px type.
     */
    const NAV = `
        <header role="banner">
            <nav role="navigation">
                <a data-testid="AppTabBar_Home_Link" href="/home" aria-current="page">
                    <div dir="ltr"><span style="font-size: 11px">3</span></div>
                    <svg width="30" height="30" style="width: 30px; height: 30px"></svg>
                    <div dir="ltr"><span style="font-size: 23px; font-weight: 800">Home</span></div>
                </a>
                <a href="/explore">
                    <svg width="30" height="30" style="width: 30px; height: 30px"></svg>
                    <div dir="ltr"><span style="font-size: 23px; font-weight: 400">Explore</span></div>
                </a>
            </nav>
        </header>`;

    const navEntry = () => document.getElementById('bb-x-nav-entry');

    suite('x.com — the Pouch row in the navigation', () => {
        test('the mark is the extension\'s own, over the glyph as a fallback', () => {
            stage(NAV);
            makeUi().injectNavEntry();

            const entry = navEntry();
            assert(entry, 'the row goes in');
            // content.css stacks the picture over the glyph, and a src that
            // cannot load is dropped to uncover it. Dom.safeUrlAttr once
            // turned every chrome-extension:// src into "#".
            assert(entry.querySelector('.bb-pouch-glyph'), 'the shared glyph underneath');
            const art = entry.querySelector('.bb-x-nav-img');
            if (art) assertEqual(art.getAttribute('src') === '', false, 'never an empty src');
            teardown();
        });

        test('it sits under Home, once however often the injector runs', () => {
            stage(NAV);
            const ui = makeUi();
            ui.injectNavEntry();
            ui.injectNavEntry();

            const home = document.querySelector('[data-testid="AppTabBar_Home_Link"]');
            assertEqual(home.nextElementSibling.id, 'bb-x-nav-entry');
            assertEqual(document.querySelectorAll('#bb-x-nav-entry, #bb-x-test .bb-x-nav').length, 1);
            teardown();
        });

        test('its type and icon are measured off X\'s own rows, not the badge', () => {
            stage(NAV);
            makeUi().injectNavEntry();

            // Custom properties, not font-size: content.css derives the
            // selected look from these, and an inline size would beat it.
            const prop = (name) => navEntry().style.getPropertyValue(name);
            assertEqual(prop('--bb-x-nav-size'), '23px', 'the label, not the 11px badge beside it');
            assertEqual(prop('--bb-x-nav-ico'), '30px');
            assertEqual(prop('--bb-x-nav-weight'), '400', 'at rest, from a row that is not current');
            assertEqual(prop('--bb-x-nav-weight-on'), '800', "X's own bold when the panel is open");
            teardown();
        });

        test('with only the row you are on to read, that is what is read', () => {
            stage(`
                <header role="banner">
                    <nav role="navigation">
                        <a data-testid="AppTabBar_Home_Link" href="/home" aria-current="page">
                            <svg width="26" height="26" style="width: 26px; height: 26px"></svg>
                            <div dir="ltr"><span style="font-size: 19px; font-weight: 700">Home</span></div>
                        </a>
                    </nav>
                </header>`);
            makeUi().injectNavEntry();

            assertEqual(navEntry().style.getPropertyValue('--bb-x-nav-weight'), '700');
            // Unwritten, so content.css's fallback applies rather than no change of state.
            assertEqual(navEntry().style.getPropertyValue('--bb-x-nav-weight-on'), '');
            teardown();
        });

        test('a navigation with no Home row still gets a row', () => {
            stage('<header role="banner"><nav role="navigation"></nav></header>');
            makeUi().injectNavEntry();
            assert(navEntry(), 'content.css carries the fallback metrics');
            teardown();
        });

        test('a chat page has no row, and leaving it brings the row back', () => {
            // X squeezes the column to icons there, and the row's word spilled over the chats.
            stage(NAV);
            const ui = makeUi();
            ui.injectNavEntry('/home');
            assert(navEntry(), 'placed on the timeline');
            ui.injectNavEntry('/i/chat/123-456');
            assertEqual(navEntry(), null, 'taken out in the chat');
            ui.injectNavEntry('/messages');
            assertEqual(navEntry(), null, 'and the older inbox');
            ui.injectNavEntry('/explore');
            assert(navEntry(), 'back once the chat is left');
            teardown();
        });

        test('only the chat routes count as chat', () => {
            const { isChatPath } = TwitterPage();
            assert(isChatPath('/i/chat'));
            assert(isChatPath('/messages/123-456'));
            assertEqual(isChatPath('/messagesbot'), false, 'a profile');
            assertEqual(isChatPath('/i/bookmarks'), false);
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

        test('it wears the colour and size of X’s own glyphs, and follows a theme switch', () => {
            // X's glyphs are a muted grey in every theme, not the post's text
            // colour — which ours used to take, and so stood out brighter.
            const host = timeline();
            const reply = host.querySelector('[data-testid="reply"]');
            reply.innerHTML = '<svg viewBox="0 0 24 24" style="color: rgb(113, 118, 123); height: 18.75px; width: 18.75px"></svg>';
            const ui = makeUi();
            ui.injectPostButtons();
            const sheet = () => document.getElementById(TwitterUi().ICON_LOOK_ID).textContent;
            assert(sheet().includes('--bb-x-icon-color: rgb(113, 118, 123)'), sheet());
            assert(sheet().includes('--bb-x-icon-size: 18.75px'), sheet());

            // X marks a theme on the page's own background, inline, and that
            // is what the look is re-read on between buttons being placed.
            reply.querySelector('svg').style.color = 'rgb(83, 100, 113)'; // Default after Lights out
            const was = document.body.style.backgroundColor;
            document.body.style.backgroundColor = 'rgb(255, 255, 255)';
            try {
                ui.injectPostButtons();
            } finally {
                document.body.style.backgroundColor = was;
            }
            assert(sheet().includes('--bb-x-icon-color: rgb(83, 100, 113)'), 'the switch was not followed');
            document.getElementById(TwitterUi().ICON_LOOK_ID).remove();
            teardown();
        });

        test('the pouch is phthalo green, lifted on X\'s dark themes so it does not vanish', () => {
            const host = timeline();
            host.querySelector('[data-testid="reply"]').innerHTML = '<svg viewBox="0 0 24 24" style="height: 18.75px"></svg>';
            const ui = makeUi();
            const sheet = () => document.getElementById(TwitterUi().ICON_LOOK_ID).textContent;
            const was = document.body.style.backgroundColor;
            try {
                document.body.style.backgroundColor = 'rgb(255, 255, 255)';
                ui.injectPostButtons();
                assert(sheet().includes('--bb-x-pouch: #123524'), sheet());
                assert(sheet().includes('--bb-x-pouch-glow: rgba(18, 53, 36, 0.1)'), sheet());

                // Lights out: #123524 on black is 1.6:1.
                document.body.style.backgroundColor = 'rgb(0, 0, 0)';
                ui.injectPostButtons();
                assert(sheet().includes('--bb-x-pouch: #349868'), 'the switch to a dark theme was not followed');
            } finally {
                document.body.style.backgroundColor = was;
            }
            document.getElementById(TwitterUi().ICON_LOOK_ID).remove();
            teardown();
        });

        test('each row wears the size of its own glyphs', () => {
            // X draws an opened post's marks bigger than the replies under
            // it, and the one size read off the first post on the page — the
            // opened one — put an oversized glyph on every reply.
            const host = opened();
            host.insertAdjacentHTML('beforeend', `
                <article data-testid="tweet" role="article">
                    <div data-testid="User-Name">
                        <a href="/someone"><span>Someone</span></a>
                        <a href="/someone/status/42"><time datetime="2026-10-20T16:00:00.000Z">1h</time></a>
                    </div>
                    <div role="group" id="id__reply">
                        <div><button data-testid="reply"></button></div>
                        <div><button data-testid="like"></button></div>
                    </div>
                </article>`);
            const [big, small] = host.querySelectorAll('[data-testid="reply"]');
            big.innerHTML = '<svg viewBox="0 0 24 24" style="width: 22.5px; height: 22.5px"></svg>';
            small.innerHTML = '<svg viewBox="0 0 24 24" style="width: 18.75px; height: 18.75px"></svg>';
            makeUi().injectPostButtons();

            const sizes = [...host.querySelectorAll('.bb-x-post-slot')]
                .map((slot) => slot.style.getPropertyValue('--bb-x-icon-size'));
            assertEqual(sizes.join(' '), '22.5px 18.75px');
            const sheet = document.getElementById(TwitterUi().ICON_LOOK_ID);
            if (sheet) sheet.remove();
            teardown();
        });

        test('a count is written in the size of X\'s digits, not of the box they are in', () => {
            // X marks a span a size larger than the two inside it that hold
            // the digits, and ours read that one: 15px beside X's 13px.
            const host = timeline();
            host.querySelector('[data-testid="reply"]').innerHTML = `
                <span data-testid="app-text-transition-container" style="font-size: 15px">
                    <span style="font-size: 13px"><span>4</span></span>
                </span>`;
            makeUi().injectPostButtons();

            const slot = host.querySelector('.bb-x-post-slot');
            assertEqual(slot.style.getPropertyValue('--bb-x-count-size'), '13px');
            const sheet = document.getElementById(TwitterUi().ICON_LOOK_ID);
            if (sheet) sheet.remove();
            teardown();
        });

        test('a post already fitted costs no query and no style read on the next pass', () => {
            // The injector runs on every frame X mutates in, which while
            // scrolling is all of them.
            const host = timeline();
            const ui = makeUi();
            ui.injectPostButtons();
            const article = host.querySelector('article');
            const realQuery = article.querySelector;
            const realStyle = window.getComputedStyle;
            let queries = 0;
            let styles = 0;
            article.querySelector = function (...args) { queries++; return realQuery.apply(this, args); };
            window.getComputedStyle = function (...args) { styles++; return realStyle.apply(this, args); };
            try {
                ui.injectPostButtons();
                ui.injectPostButtons();
            } finally {
                delete article.querySelector;
                window.getComputedStyle = realStyle;
            }
            assertEqual(queries, 0, 'the post was queried again');
            assertEqual(styles, 0, 'the icon look was read again');
            assertEqual(document.querySelectorAll('#bb-x-test .bb-x-post-btn').length, 1);
            const icon = document.getElementById(TwitterUi().ICON_LOOK_ID);
            if (icon) icon.remove();
            teardown();
        });

        test('with no bookmark in the row it still sits after Like', () => {
            timeline({ bookmark: false });
            makeUi({ twitterHideBookmark: false }).injectPostButtons();

            const slot = document.querySelector('#bb-x-test .bb-x-post-slot');
            const like = document.querySelector('#bb-x-test [data-testid="like"]');

            // Appending was what this did, and X leaves the bookmark off a
            // good many timeline and profile rows — so the same button landed
            // between Like and Bookmark on a post's own page and out past
            // Share in the timeline, for no reason a reader could see.
            assertEqual(like.closest('[role="group"] > *').nextElementSibling, slot,
                'the bookmark\'s place, whether or not the bookmark is in it');
            teardown();
        });

        test('a row capped narrower than the post it is in is let out', () => {
            const host = stage('<div style="width: 600px"><div role="group" style="max-width: 425px"></div></div>');
            const row = host.querySelector('[role="group"]');
            TwitterUi().stretchRow(row);

            // X caps that row at a fixed width and leaves it left-aligned, so
            // the marks sit bunched in the left half with empty page beside
            // them — and a sixth cell squeezes the five already there instead
            // of taking any of the room going spare.
            assertEqual(row.style.maxWidth, 'none');
            assertEqual(row.dataset.bbStretched, '1', 'and not measured again on the next render');

            const tight = stage('<div style="width: 300px"><div role="group" style="max-width: 425px"></div></div>');
            const narrow = tight.querySelector('[role="group"]');
            TwitterUi().stretchRow(narrow);
            assertEqual(narrow.style.maxWidth, '425px', 'nothing to let it out into, so nothing is changed');
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

        test('a row with no bookmark still gets the button, not at the end', () => {
            timeline({ bookmark: false });
            makeUi().injectPostButtons();

            const group = document.querySelector('#bb-x-test [role="group"]');
            const slot = group.querySelector('.bb-x-post-slot');
            assert(slot, 'no bookmark to replace is not a reason to place nothing');
            assert(slot.querySelector('.bb-x-post-btn'), 'with the button in it');
            // This used to assert the opposite, and the opposite was the bug:
            // appending put the button past Share on the rows X leaves a
            // bookmark off, so its place moved between one screen and the next.
            assertEqual(group.lastElementChild === slot, false, 'the end is where it was, and where it was wrong');
            teardown();
        });

        const countText = () => {
            const count = document.querySelector('#bb-x-test .bb-x-post-btn .bb-x-post-count');
            return count ? count.textContent : null;
        };

        /** `n` posts, all filed under one topic. */
        const savedPosts = (n) => Array.from({ length: n }, (_, i) => ({ id: String(900 + i), topic: 'xst-1', handle: '@someone' }));
        const pouchOf = (n) => MockChrome.reset({
            localStore: { bbXPostTopics: [{ id: 'xst-1', name: 'Shaders' }], bbXPosts: savedPosts(n) },
        });

        // The count is written once the pouch has been read, which is a
        // round trip through the mock's deferred storage.
        const settle = () => new Promise((done) => setTimeout(done, 150));

        test('the number beside the glyph is the pouch\'s total, not the post\'s bookmarks', async () => {
            pouchOf(3);
            try {
                const host = opened();
                // What it used to show, so that an opened post read "462"
                // twice: once beside ours and once beside X's own bookmark.
                host.querySelector('[data-testid="bookmark"]').setAttribute('aria-label', '462 Bookmarks. Bookmark');
                makeUi().injectPostButtons();
                await settle();

                // PouchButton.mark rebuilds the button's markup, which would
                // take the number with it.
                assert(document.querySelector('#bb-x-test .bb-x-post-btn .bb-pouch-glyph'), 'marked');
                assertEqual(countText(), '3');
            } finally {
                MockChrome.reset();
                teardown();
            }
        });

        test('an empty pouch has no number, rather than a zero', async () => {
            MockChrome.reset();
            timeline();
            makeUi().injectPostButtons();
            await settle();
            assertEqual(countText(), null);
            teardown();
        });

        test('the total follows the pouch as it fills', async () => {
            pouchOf(1);
            try {
                timeline();
                makeUi().injectPostButtons();
                await settle();
                assertEqual(countText(), '1');

                // A post saved from another tab, or from this one.
                await chrome.storage.local.set({ bbXPosts: savedPosts(2) });
                await settle();
                assertEqual(countText(), '2');
            } finally {
                MockChrome.reset();
                teardown();
            }
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

        test('the numbers are hidden by one mark on the page, and come back with it', () => {
            timeline();
            let settings = { ...ALL_ON, twitterHideCounts: true };
            const ui = TwitterUi().createTwitterUi({
                watcher: NO_WATCHER, notify() {}, getSettings: () => settings,
            });
            const root = document.documentElement;
            try {
                ui.refreshSurfaces();
                // On the root rather than on each post, so the posts that
                // arrive as the timeline scrolls are covered too.
                assert(root.hasAttribute('data-bb-x-counts-hidden'), 'switched on');
                settings = { ...ALL_ON, twitterHideCounts: false };
                ui.refreshSurfaces();
                assertEqual(root.hasAttribute('data-bb-x-counts-hidden'), false, 'and off again on the open page');
            } finally {
                root.removeAttribute('data-bb-x-counts-hidden');
            }
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

        test('an opened post is read by its own stamp, not by the one of the post it quotes', () => {
            opened();
            const post = TwitterPage().readPost(document.querySelector('#bb-x-test article'));

            // The quoted card's <time> comes first there and is in no link,
            // so the post read as one with no id — and was the one post on
            // its own page with no button.
            assert(post, 'read at all');
            assertEqual(post.statusId, '2112354505346146630');
            assertEqual(post.handle, '@iquilezles');
            assertEqual(post.text, 'A provocation.');
            assertEqual(post.postedAt, Date.parse('2026-10-20T15:12:00.000Z'), "its own time, not the quote's");
            teardown();
        });

        test('and it gets its button', () => {
            opened();
            makeUi().injectPostButtons();

            const button = document.querySelector('#bb-x-test .bb-x-post-btn');
            assert(button, 'placed');
            assertEqual(button.dataset.bbStatus, '2112354505346146630');
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
