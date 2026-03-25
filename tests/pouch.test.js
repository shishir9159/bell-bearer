/**
 * The state the two injected buttons show.
 *
 * A channel already in the pouch, and a playlist already followed, must both
 * stop offering to do the thing again — YouTube's own Subscribe button goes
 * flat and grey once you are subscribed, and these sit right beside it. That
 * is the whole behaviour under test here; the ordering, pinning, feed and
 * subscription-parsing logic is pure and lives in tests/node-check.js, which
 * runs in a second.
 *
 * The injections are called straight off the factory rather than through the
 * watcher, for the reason youtube-ui.test.js gives: the watcher only runs its
 * tasks on an animation frame, and a background tab may not get one for
 * seconds at a time.
 */

/*
 * Every spec file is a classic script sharing one global scope, so the helpers
 * below carry names of their own rather than the obvious `makeUi`/`teardown`.
 * A clash there is silent and does its damage in the other file: the later
 * definition wins, and youtube-ui.test.js starts tearing down a page it never
 * built while its own drawer leaks into the next test.
 */

/** The first path command of the tick that takes the list's plus — what "filed" looks like. */
const TICK_PATH = /M237\.66,180\.66/;

function pouchUi(style, playlistDownload = null) {
    return window.BB.YouTubeUi.createYouTubeUi({
        watcher: { add() {}, remove() {}, has: () => false, schedule() {}, stop() {} },
        notify() {},
        getPouchButtonStyle: () => style || 'auto',
        playlistDownload,
    });
}

/**
 * A stand-in watch page: a channel link, a subscribe renderer, a queue panel.
 *
 * The renderer is given a box on purpose. It is an unknown element here, so it
 * would otherwise be zero-sized — and the injector now steps over a Subscribe
 * that is not on screen, because a channel page keeps a second, hidden one in
 * its sticky header and the button was landing in that.
 */
function watchPage(channelHref) {
    const host = document.createElement('div');
    host.id = 'bb-test-page';
    host.innerHTML = `
        <div id="owner">
            <ytd-channel-name><a href="${channelHref}">A Channel</a></ytd-channel-name>
        </div>
        <ytd-subscribe-button-renderer style="display: block; width: 105px; height: 36px">
        </ytd-subscribe-button-renderer>
        <ytd-playlist-panel-renderer>
            <div id="container"><div class="header style-scope ytd-playlist-panel-renderer"></div></div>
        </ytd-playlist-panel-renderer>`;
    document.body.appendChild(host);
    return host;
}

function clearWatchPage() {
    ['bb-test-page', 'bb-add-to-subscriptions-btn', 'bb-playlist-actions']
        .map((id) => document.getElementById(id))
        .forEach((el) => { if (el) el.remove(); });
}

const filedChannel = {
    id: '@filed',
    name: 'A Channel',
    url: 'https://www.youtube.com/@filed',
    topicId: 't1',
};

const pouchButton = () => document.getElementById('bb-add-to-subscriptions-btn');

/** A watch URL inside a real playlist, for the injection-s href seam. */
const WITH_PLAYLIST = 'https://www.youtube.com/watch?v=abc&list=PLcourse';

suite('the pouch button says whether the channel is already filed', () => {

    test('a filed channel gets the tick and YouTube-s "done" grey', async () => {
        MockChrome.reset({ localStore: { subscriptionChannels: [filedChannel] } });
        watchPage('/@filed');

        try {
            assertEqual(pouchUi().injectPouchButton(), true);
            await MockChrome.settle();

            const button = pouchButton();
            assert(button.classList.contains('bb-in-pouch'),
                'the filed state is what greys it out, the way Subscribed is grey');
            assertEqual(button.getAttribute('aria-pressed'), 'true');
            assert(TICK_PATH.test(button.innerHTML), 'and the glyph is a tick, not a plus');
        } finally { clearWatchPage(); }
    });

    test('a channel not in the pouch keeps the plus', async () => {
        MockChrome.reset({ localStore: { subscriptionChannels: [] } });
        watchPage('/@stranger');

        try {
            pouchUi().injectPouchButton();
            await MockChrome.settle();

            const button = pouchButton();
            assert(!button.classList.contains('bb-in-pouch'));
            assertEqual(button.getAttribute('aria-pressed'), 'false');
            assert(!TICK_PATH.test(button.innerHTML));
        } finally { clearWatchPage(); }
    });

    test('a channel filed by handle is recognised however the URL is spelled', async () => {
        MockChrome.reset({ localStore: { subscriptionChannels: [filedChannel] } });
        // Same channel, different spelling: the pouch key decides, not the
        // string, or a tracking parameter would file it a second time.
        watchPage('/@filed?si=xyz');

        try {
            pouchUi().injectPouchButton();
            await MockChrome.settle();
            assert(pouchButton().classList.contains('bb-in-pouch'));
        } finally { clearWatchPage(); }
    });

    test('the accent style does not out-shout the filed state', async () => {
        // "Already filed" is the more important thing to say of the two.
        MockChrome.reset({ localStore: { subscriptionChannels: [filedChannel] } });
        watchPage('/@filed');

        try {
            pouchUi('accent').injectPouchButton();
            await MockChrome.settle();

            const button = pouchButton();
            assert(button.classList.contains('bb-accent'), 'the setting is still honoured');
            assert(button.classList.contains('bb-in-pouch'),
                'and content.css gives .bb-in-pouch the last word on the fill');
        } finally { clearWatchPage(); }
    });
});

suite('the follow-playlist button', () => {

    test('is not offered on a page with no playlist to follow', () => {
        MockChrome.reset();
        watchPage('/@someone');

        try {
            // No `list=` in the address bar: the task reports itself finished
            // rather than staying armed and re-querying every mutation.
            assertEqual(pouchUi().injectPlaylistButton(), true);
            assertEqual(document.getElementById('bb-follow-playlist-btn'), null);
        } finally { clearWatchPage(); }
    });

    test('lands in the queue panel header, reading Follow', async () => {
        MockChrome.reset();
        watchPage('/@someone');

        try {
            // Placing the button does not finish the task: it stays armed for
            // a few passes in case an SPA navigation builds a new header
            // beside the old one — see PLAYLIST_SETTLE in youtube-ui.js.
            const ui = pouchUi();
            assertEqual(ui.injectPlaylistButton(WITH_PLAYLIST), false, 'finished the moment it placed the button');
            await MockChrome.settle();

            const button = document.getElementById('bb-follow-playlist-btn');
            assert(button, 'the panel header is where YouTube puts the list-s own controls');
            // In a row of its own with Download, which is what goes in the header.
            assertEqual(button.parentElement.id, 'bb-playlist-actions');
            assertEqual(button.parentElement.parentElement.className,
                'header style-scope ytd-playlist-panel-renderer');
            assertEqual(button.dataset.playlistId, 'PLcourse');
            assertEqual(button.querySelector('.bb-pf-label').textContent, 'Follow');
            assertEqual(button.getAttribute('aria-pressed'), 'false');

            // Left alone in the header on screen, it settles and finishes,
            // and it is the same button throughout rather than a new one.
            let done = false;
            for (let pass = 0; pass < window.BB.YouTubeUi.PLAYLIST_SETTLE && !done; pass++) {
                done = ui.injectPlaylistButton(WITH_PLAYLIST);
            }
            assert(done, 'the task never settled');
            assert(document.getElementById('bb-follow-playlist-btn') === button, 'the button was rebuilt while settling');
        } finally { clearWatchPage(); }
    });

    test('a playlist already followed reads Following', async () => {
        MockChrome.reset({
            localStore: {
                bbPlaylists: [{ id: 'PLcourse', title: 'Course', seen: ['v1'], addedAt: 1 }],
            },
        });
        watchPage('/@someone');

        try {
            pouchUi().injectPlaylistButton(WITH_PLAYLIST);
            await MockChrome.settle();

            const button = document.getElementById('bb-follow-playlist-btn');
            assert(button.classList.contains('bb-following'));
            assertEqual(button.querySelector('.bb-pf-label').textContent, 'Following');
            // No icon on this button — just the label; see youtube-ui.js.
            assertEqual(button.getAttribute('aria-pressed'), 'true');
        } finally { clearWatchPage(); }
    });

    test('waits for the header rather than placing it nowhere', () => {
        MockChrome.reset();
        const host = document.createElement('div');
        host.id = 'bb-test-page';
        document.body.appendChild(host);

        try {
            // The panel has not streamed in yet. Returning false leaves the
            // task armed so the watcher tries again on the next mutation.
            assertEqual(pouchUi().injectPlaylistButton(WITH_PLAYLIST), false);
            assertEqual(document.getElementById('bb-follow-playlist-btn'), null);
        } finally { clearWatchPage(); }
    });
});

suite('the download beside follow', () => {

    /** The tab's downloader as the button sees it, recording what it is asked. */
    function playlistDownloads(on = true) {
        const asked = [];
        const now = { busy: false, percent: 0, place: null };
        const api = {
            enabled: () => on,
            start: (id) => asked.push(`start ${id}`),
            cancel: () => asked.push('cancel'),
            state: () => ({ ...now }),
        };
        return { asked, now, api };
    }

    test('sits right after Follow, in its row, and saves the whole playlist', async () => {
        MockChrome.reset();
        watchPage('/@someone');
        const { asked, api } = playlistDownloads();

        try {
            pouchUi(null, api).injectPlaylistButton(WITH_PLAYLIST);
            await MockChrome.settle();

            const follow = document.getElementById('bb-follow-playlist-btn');
            const download = document.getElementById('bb-download-playlist-btn');
            assert(download && !download.hidden, 'no Download beside Follow');
            assert(follow.nextElementSibling === download, 'Download is not right after Follow');
            assertEqual(download.dataset.playlistId, 'PLcourse');
            assertEqual(download.getAttribute('aria-label'), 'Download every video in this playlist');
            assertEqual(download.querySelector('.bb-pd-label').textContent, '', 'the glyph alone at rest');

            download.click();
            assertEqual(asked.join(), 'start PLcourse');
        } finally { clearWatchPage(); }
    });

    test('is hidden while the download is switched off, and shows when it is turned on', async () => {
        MockChrome.reset();
        watchPage('/@someone');
        let on = false;
        const { api } = playlistDownloads();
        api.enabled = () => on;

        try {
            const ui = pouchUi(null, api);
            ui.injectPlaylistButton(WITH_PLAYLIST);
            await MockChrome.settle();
            assert(document.getElementById('bb-download-playlist-btn').hidden, 'offered with the switch off');

            on = true;
            ui.markDownloadButton();
            assert(!document.getElementById('bb-download-playlist-btn').hidden, 'the switch did not reach the page open');
        } finally { clearWatchPage(); }
    });

    test('running, it is a stop that says how far the list has got', async () => {
        MockChrome.reset();
        watchPage('/@someone');
        const { asked, now, api } = playlistDownloads();

        try {
            const ui = pouchUi(null, api);
            ui.injectPlaylistButton(WITH_PLAYLIST);
            await MockChrome.settle();

            Object.assign(now, { busy: true, percent: 40, place: { at: 3, of: 12 } });
            ui.markDownloadButton();
            const download = document.getElementById('bb-download-playlist-btn');
            assert(download.classList.contains('bb-busy'));
            assertEqual(download.querySelector('.bb-pd-label').textContent, '3/12');
            assertEqual(download.title, 'Cancel the download — video 3 of 12, 40%');

            download.click();
            assertEqual(asked.join(), 'cancel');
        } finally { clearWatchPage(); }
    });

    test('a page without the downloader still gets Follow, and no Download', async () => {
        MockChrome.reset();
        watchPage('/@someone');

        try {
            pouchUi().injectPlaylistButton(WITH_PLAYLIST);
            await MockChrome.settle();
            assert(document.getElementById('bb-follow-playlist-btn'), 'Follow is gone');
            assert(document.getElementById('bb-download-playlist-btn').hidden);
        } finally { clearWatchPage(); }
    });
});
