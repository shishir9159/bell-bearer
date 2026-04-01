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
        test('one button goes into the action row, as a cell of its own, carrying the status id', () => {
            timeline();
            makeUi().injectPostButtons();

            assertEqual(count('.bb-x-post-btn'), 1);
            const button = q('.bb-x-post-btn');
            // Bare, it sat half a line low in an opened post, where each cell is a growing flex box.
            assert(button.parentElement.classList.contains('bb-x-post-slot'), 'wrapped, not bare');
            assert(button.closest('[role="group"]'), 'inside X\'s own action row');
            assertEqual(button.dataset.bbStatus, '1770');
            teardown();
        });

        test('a post is only ever fitted once', () => {
            timeline();
            const ui = makeUi();
            ui.injectPostButtons();
            ui.injectPostButtons();
            ui.injectPostButtons();
            assertEqual(count('.bb-x-post-btn'), 1);
            teardown();
        });

        test('it stands where the bookmark was, and the bookmark stands down', () => {
            timeline();
            makeUi().injectPostButtons();

            const theirs = q('[data-testid="bookmark"]').parentElement;
            assert(bookmarkHidden(), 'X\'s bookmark is hidden, not removed');
            assertEqual(q('.bb-x-post-btn').parentElement.nextElementSibling, theirs, 'ours takes its place');
            teardown();
        });

        test('with no bookmark in the row it still goes right after Like', () => {
            // Appending put it past Share on the rows X leaves the bookmark off.
            for (const hide of [true, false]) {
                timeline({ bookmark: false });
                makeUi({ twitterHideBookmark: hide }).injectPostButtons();
                const slot = q('.bb-x-post-slot');
                assert(slot.querySelector('.bb-x-post-btn'), 'placed');
                assertEqual(q('[data-testid="like"]').closest('[role="group"] > *').nextElementSibling, slot,
                    `hiding the bookmark ${hide}`);
            }
            teardown();
        });

        test('it wears the colour and size of X’s own glyphs, and follows a theme switch', () => {
            // X's glyphs are a muted grey, and ours once took the brighter text colour.
            const host = timeline();
            const reply = host.querySelector('[data-testid="reply"]');
            reply.innerHTML = '<svg viewBox="0 0 24 24" style="color: rgb(113, 118, 123); height: 18.75px; width: 18.75px"></svg>';
            const ui = makeUi();
            ui.injectPostButtons();
            const sheet = () => iconLook().textContent;
            assert(sheet().includes('--bb-x-icon-color: rgb(113, 118, 123)'), sheet());
            assert(sheet().includes('--bb-x-icon-size: 18.75px'), sheet());

            // The look is re-read when the page's inline background changes.
            reply.querySelector('svg').style.color = 'rgb(83, 100, 113)';
            const was = document.body.style.backgroundColor;
            document.body.style.backgroundColor = 'rgb(255, 255, 255)';
            try {
                ui.injectPostButtons();
            } finally {
                document.body.style.backgroundColor = was;
            }
            assert(sheet().includes('--bb-x-icon-color: rgb(83, 100, 113)'), 'the switch was not followed');
            teardown();
        });

        test('the pouch is phthalo green, lifted on X\'s dark themes so it does not vanish', () => {
            const host = timeline();
            host.querySelector('[data-testid="reply"]').innerHTML = '<svg viewBox="0 0 24 24" style="height: 18.75px"></svg>';
            const ui = makeUi();
            const sheet = () => iconLook().textContent;
            const was = document.body.style.backgroundColor;
            try {
                document.body.style.backgroundColor = 'rgb(255, 255, 255)';
                ui.injectPostButtons();
                assert(sheet().includes('--bb-x-pouch: #123524'), sheet());
                assert(sheet().includes('--bb-x-pouch-glow: rgba(18, 53, 36, 0.1)'), sheet());

                // #123524 on black is 1.6:1.
                document.body.style.backgroundColor = 'rgb(0, 0, 0)';
                ui.injectPostButtons();
                assert(sheet().includes('--bb-x-pouch: #349868'), 'the switch to a dark theme was not followed');
            } finally {
                document.body.style.backgroundColor = was;
            }
            teardown();
        });

        test('each row wears the size of its own glyphs', () => {
            // An opened post's marks are bigger than its replies', and reading
            // the first post only put oversized glyphs on every reply.
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
            teardown();
        });

        test('a count is written in the size of X\'s digits, not of the box they are in', () => {
            const host = timeline();
            host.querySelector('[data-testid="reply"]').innerHTML = `
                <span data-testid="app-text-transition-container" style="font-size: 15px">
                    <span style="font-size: 13px"><span>4</span></span>
                </span>`;
            makeUi().injectPostButtons();
            assertEqual(q('.bb-x-post-slot').style.getPropertyValue('--bb-x-count-size'), '13px');
            teardown();
        });

        test('a post already fitted costs no query and no style read on the next pass', () => {
            // The injector runs on every frame X mutates in, which while scrolling is all of them.
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
            assertEqual(count('.bb-x-post-btn'), 1);
            teardown();
        });

        test('a row capped narrower than the post it is in is let out', () => {
            // X caps the row and leaves it left-aligned, so a sixth cell squeezed the five.
            const row = stage('<div style="width: 600px"><div role="group" style="max-width: 425px"></div></div>')
                .querySelector('[role="group"]');
            TwitterUi().stretchRow(row);
            assertEqual(row.style.maxWidth, 'none');
            assertEqual(row.dataset.bbStretched, '1', 'and not measured again on the next render');

            const narrow = stage('<div style="width: 300px"><div role="group" style="max-width: 425px"></div></div>')
                .querySelector('[role="group"]');
            TwitterUi().stretchRow(narrow);
            assertEqual(narrow.style.maxWidth, '425px', 'nothing to let it out into');
            teardown();
        });

        const countText = () => {
            const shown = q('.bb-x-post-btn .bb-x-post-count');
            return shown ? shown.textContent : null;
        };
        const savedPosts = (n) => Array.from({ length: n }, (_, i) => ({ id: String(900 + i), topic: 'xst-1', handle: '@someone' }));
        const pouchOf = (n) => MockChrome.reset({
            localStore: { bbXPostTopics: [{ id: 'xst-1', name: 'Shaders' }], bbXPosts: savedPosts(n) },
        });
        // A round trip through the mock's deferred storage.
        const settle = () => new Promise((done) => setTimeout(done, 150));

        test('the number beside the glyph is the pouch\'s total, not the post\'s bookmarks', async () => {
            pouchOf(3);
            try {
                const host = opened();
                // It once showed this, so an opened post read "462" twice.
                host.querySelector('[data-testid="bookmark"]').setAttribute('aria-label', '462 Bookmarks. Bookmark');
                makeUi().injectPostButtons();
                await settle();
                // PouchButton.mark rebuilds the button's markup, number and all.
                assert(q('.bb-x-post-btn .bb-pouch-glyph'), 'marked');
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
                await chrome.storage.local.set({ bbXPosts: savedPosts(2) });
                await settle();
                assertEqual(countText(), '2');
            } finally {
                MockChrome.reset();
                teardown();
            }
        });
    });

    suite('x.com — the X surfaces are off until asked for', () => {
        test('a post gets nothing, and keeps its bookmark, by default', () => {
            timeline();
            // No settings at all: the factory falls back to the schema, not to defaults of its own.
            TwitterUi().createTwitterUi({ watcher: NO_WATCHER, notify() {} }).injectPostButtons();
            assertEqual(count('.bb-x-post-btn'), 0);
            assert(!bookmarkHidden(), 'X\'s own button is left alone');
            teardown();
        });

        test('the pouch button can go in with the bookmark left standing', () => {
            timeline();
            makeUi({ twitterHideBookmark: false }).injectPostButtons();
            assertEqual(count('.bb-x-post-btn'), 1);
            assert(!bookmarkHidden(), 'the two settings are independent');
            teardown();
        });

        test('the bookmark can go with nothing put in its place', () => {
            timeline();
            makeUi({ twitterPouchPosts: false }).injectPostButtons();
            assertEqual(count('.bb-x-post-btn'), 0);
            assert(bookmarkHidden());
            teardown();
        });

        test('switching them off puts the page that is open back', () => {
            timeline();
            let settings = { ...ALL_ON };
            const ui = uiWith(() => settings);
            ui.injectPostButtons();

            settings = { twitterPouchPosts: false, twitterPouchPeople: false, twitterHideBookmark: false };
            ui.refreshSurfaces();
            assertEqual(count('.bb-x-post-btn'), 0, 'ours is gone');
            assertEqual(count('.bb-x-post-slot'), 0, 'and so is its cell, which would leave a gap');
            assert(!bookmarkHidden(), 'and X\'s is back');
            teardown();
        });

        test('the numbers are hidden by one mark on the page, and come back with it', () => {
            timeline();
            let settings = { ...ALL_ON, twitterHideCounts: true };
            const ui = uiWith(() => settings);
            const root = document.documentElement;
            try {
                // On the root, so posts that arrive as the timeline scrolls are covered too.
                ui.refreshSurfaces();
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
            // A display:none cell has no layout to copy.
            timeline();
            makeUi().injectPostButtons();
            assertEqual(q('.bb-x-post-slot').style.display, 'flex');
            teardown();
        });
    });

    // Called on the module directly: driving them through injectProfileButton
    // needs the address bar at /<handle>, which a file:// page cannot do.
    suite('x.com — copying X\'s own layout', () => {
        test('a cell of an opened post\'s row is copied, not guessed at', () => {
            const host = stage('<div style="display: block; flex-grow: 1; justify-content: center"></div>');
            const button = document.createElement('button');
            const slot = TwitterUi().slotFor(button, host.firstElementChild);

            assertEqual(slot.style.flexGrow, '1', 'grows with the cells beside it');
            assertEqual(slot.style.justifyContent, 'center');
            assertEqual(slot.style.alignItems, 'center', 'which centres the glyph');
            assertEqual(slot.style.display, 'flex', "a copied 'block' drops the glyph to the baseline");
            assertEqual(slot.firstElementChild, button);
            teardown();
        });

        test('a cell with nothing to copy is still a cell', () => {
            const slot = TwitterUi().slotFor(document.createElement('button'), null);
            assert(slot.classList.contains('bb-x-post-slot'), 'content.css carries the fallback');
            assertEqual(slot.getAttribute('style'), null);
        });

        test('a profile button wears X\'s ring rather than one of its own', () => {
            // Our own 36px ring in currentColor was a shade too dark and sat below X's line.
            const host = stage(`
                <button data-testid="userActions"
                        style="width: 34px; height: 34px; border: 1px solid rgb(83, 100, 113);
                               margin-left: 0px; margin-right: 0px"></button>`);
            const button = document.createElement('button');
            TwitterUi().wearRing(button, TwitterUi().ringModel(host.firstElementChild));

            assertEqual(button.style.getPropertyValue('--bb-x-ring-size'), '34px');
            assertEqual(button.style.getPropertyValue('--bb-x-ring'), 'rgb(83, 100, 113)');
            assertEqual(button.style.getPropertyValue('--bb-x-ring-width'), '1px');
            assertEqual(button.style.marginRight, '0px', 'not a guessed 8px');
            teardown();
        });

        test('the ring is found when X has moved the border inside', () => {
            const host = stage(`
                <div data-testid="userActions">
                    <div style="border: 2px solid rgb(1, 2, 3); width: 40px; height: 40px"></div>
                </div>`);
            assertEqual(TwitterUi().ringModel(host.firstElementChild), host.firstElementChild.firstElementChild);
            teardown();
        });
    });

    suite('x.com — reading a post', () => {
        test('a post is read off its own markup', () => {
            timeline();
            const post = TwitterPage().readPost(q('article'));
            assertEqual(post.statusId, '1770');
            assertEqual(post.handle, '@isorokin');
            assertEqual(post.name, 'Ilya Sorokin');
            assertEqual(post.text, 'Occupancy is not throughput.');
            assertEqual(post.avatar, 'https://pbs.twimg.com/profile_images/1/ilya_bigger.jpg');
            assertEqual(post.postedAt, Date.parse('2026-09-21T06:00:00.000Z'));
            teardown();
        });

        test('an opened post is read by its own stamp, not the quoted one\'s, and gets its button', () => {
            // The quote's <time> comes first and is in no link, so the post
            // once read with no id and was the one post with no button.
            opened();
            const post = TwitterPage().readPost(q('article'));
            assert(post, 'read at all');
            assertEqual(post.statusId, '2112354505346146630');
            assertEqual(post.handle, '@iquilezles');
            assertEqual(post.text, 'A provocation.');
            assertEqual(post.postedAt, Date.parse('2026-10-20T15:12:00.000Z'), "its own time, not the quote's");

            makeUi().injectPostButtons();
            assertEqual(q('.bb-x-post-btn').dataset.bbStatus, '2112354505346146630');
            teardown();
        });

        test('a post with no status id is not half-read, and gets no button', () => {
            // The id is the storage key: half a record files the same post twice.
            stage('<article data-testid="tweet"><div data-testid="tweetText">x</div><div role="group"></div></article>');
            assertEqual(TwitterPage().readPost(q('article')), null);
            makeUi().injectPostButtons();
            assertEqual(count('.bb-x-post-btn'), 0);
            teardown();
        });
    });

    suite('x.com — promoted posts and upsells', () => {
        const makeAds = (on) => TwitterAds().createTwitterAds({ watcher: NO_WATCHER, isEnabled: () => on });

        test('a promoted post is hidden by its whole cell, not just its article', () => {
            timeline({ promoted: true });
            makeAds(true).sweep();
            assert(q('[data-testid="cellInnerDiv"]').classList.contains('bb-x-ad-hidden'),
                'the article alone leaves X\'s padding as an empty stripe');
            teardown();
        });

        test('an ordinary post is left alone, and nothing is hidden while the setting is off', () => {
            timeline({ promoted: false });
            makeAds(true).sweep();
            assertEqual(count('.bb-x-ad-hidden'), 0);
            timeline({ promoted: true });
            makeAds(false).sweep();
            assertEqual(count('.bb-x-ad-hidden'), 0);
            teardown();
        });

        test('turning it off puts the page back without a reload', () => {
            timeline({ promoted: true });
            const ads = makeAds(true);
            ads.sweep();
            assertEqual(count('.bb-x-ad-hidden'), 1);
            ads.restore();
            assertEqual(count('.bb-x-ad-hidden'), 0);
            assertEqual(count('[data-bb-ad]'), 0, 'and the marks come off, so a re-enable sweeps again');
            teardown();
        });

        test('an upsell in the right-hand column has no cell to hide', () => {
            stage('<aside aria-label="Subscribe to Premium"><span>Premium</span></aside>');
            makeAds(true).sweep();
            assert(q('aside').classList.contains('bb-x-ad-hidden'), 'hidden itself, with no timeline cell around it');
            teardown();
        });
    });
})();
