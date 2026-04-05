/**
 * Where Bell Bearer's own controls land on YouTube. The injectors are called
 * directly rather than through install(), whose watcher only runs on an
 * animation frame that a hidden tab may not get.
 */

const YouTubeUi = () => window.BB.YouTubeUi;
const NO_WATCHER = { add() {}, remove() {}, has: () => false, schedule() {}, stop() {} };

/** A fresh factory: each one carries its own retry counter. */
const makeUi = (pouchStyle = 'hidden') => YouTubeUi().createYouTubeUi({
    watcher: NO_WATCHER, notify() {}, getPouchButtonStyle: () => pouchStyle,
});

/** Markup on the page for the length of `run`. */
function staged(html, run) {
    const host = document.createElement('div');
    host.id = 'bb-test-youtube';
    host.innerHTML = html;
    document.body.appendChild(host);
    try {
        return run(host);
    } finally {
        host.remove();
    }
}

// The entry was once prepended to #sections, above YouTube's whole nav
// rather than in it. It belongs third in the first section.
suite('youtube drawer entry', () => {
    /** `count` items in the first section, one in a second. */
    const drawer = (count) => `
        <ytd-guide-renderer>
            <div id="sections">
                <ytd-guide-section-renderer><div id="items">${['Home', 'Shorts', 'Subscriptions', 'You'].slice(0, count)
                    .map((name) => `<ytd-guide-entry-renderer>${name}</ytd-guide-entry-renderer>`).join('')}</div></ytd-guide-section-renderer>
                <ytd-guide-section-renderer><div id="items">
                    <ytd-guide-entry-renderer>History</ytd-guide-entry-renderer>
                </div></ytd-guide-section-renderer>
            </div>
        </ytd-guide-renderer>`;
    const firstSection = (host) => host.querySelector('#sections ytd-guide-section-renderer #items').children;
    const labels = (host) => [...firstSection(host)].map((el) => el.id || el.textContent.trim());
    const entries = () => document.querySelectorAll('#bb-guide-entry').length;

    test('lands third, as an item of the first section, once however often it runs', () => staged(drawer(3), (host) => {
        const ui = makeUi();
        ui.injectGuideEntry();
        assertDeepEqual(labels(host), ['Home', 'Shorts', 'bb-guide-entry', 'Subscriptions']);
        assertEqual(ui.injectGuideEntry(), true);
        assertEqual(entries(), 1);
    }));

    test('reads "Pouch", under the extension\'s own icon, in YouTube\'s own styles', () => staged(drawer(3), () => {
        makeUi().injectGuideEntry();
        const entry = document.getElementById('bb-guide-entry');
        // Every row in that drawer is named after where it goes.
        assertEqual(entry.textContent.trim(), 'Pouch');
        const icon = entry.querySelector('.bb-guide-ico img');
        assert(icon && /icons\/icon\d*\.png$/.test(icon.getAttribute('src') || ''),
            'the Bell Bearer icon, from icons/ — which is why that folder is web-accessible');
        assert(entry.querySelector('.guide-icon.style-scope.ytd-guide-entry-renderer'), 'the icon column Home and Shorts use');
        assert(entry.querySelector('.title.style-scope.ytd-guide-entry-renderer'), 'and their label');
    }));

    test('appears at once on a half-built drawer, and slides back to third', () => staged(drawer(1), (host) => {
        // YouTube streams the drawer. Waiting for the third slot made the row arrive visibly late.
        const ui = makeUi();
        assertEqual(ui.injectGuideEntry(), false, 'placed, but still watching');
        assertDeepEqual(labels(host), ['Home', 'bb-guide-entry']);

        firstSection(host)[0].insertAdjacentHTML('afterend',
            '<ytd-guide-entry-renderer>Shorts</ytd-guide-entry-renderer>' +
            '<ytd-guide-entry-renderer>Subscriptions</ytd-guide-entry-renderer>');
        assertEqual(ui.injectGuideEntry(), true, 'the drawer is full, so the task is done');
        assertDeepEqual(labels(host), ['Home', 'Shorts', 'bb-guide-entry', 'Subscriptions']);
        assertEqual(entries(), 1, 'moved, not duplicated');
    }));

    test('stops watching a drawer that never reaches three', () => staged(drawer(2), (host) => {
        // Signed out, or with Shorts turned off.
        const ui = makeUi();
        let result = false;
        for (let i = 0; i < 20 && result === false; i += 1) result = ui.injectGuideEntry();
        assertEqual(result, true, 'it never stopped watching');
        assertDeepEqual(labels(host), ['Home', 'Shorts', 'bb-guide-entry']);
    }));

    test('no drawer on the page yet is a retry, not a crash', () => {
        assertEqual(makeUi().injectGuideEntry(), false);
    });
});

/**
 * Which header the playlist "Follow" button goes into.
 *
 * YouTube leaves a fully built but zero-sized `ytd-playlist-panel-renderer`
 * on every /playlist page, and renders more than one flexible-actions row.
 * Matching only `document.querySelector` per selector meant that whenever a
 * dead copy came first in the document, the selector was abandoned and the
 * live header after it was never found — so the button showed up on whichever
 * playlists happened to order the DOM favourably, and on no others.
 */
suite('youtube playlist header', () => {
    let host = null;

    function stage(html) {
        host = document.createElement('div');
        host.innerHTML = html;
        document.body.appendChild(host);
        return host;
    }

    function teardown() {
        if (host) host.remove();
        host = null;
    }

    test('a hidden first match does not veto a visible later one', () => {
        // The shape of the bug: same selector, dead copy first.
        stage(`
            <yt-flexible-actions-view-model id="dead" style="display:none"></yt-flexible-actions-view-model>
            <yt-flexible-actions-view-model id="live" style="display:block;width:200px;height:40px"></yt-flexible-actions-view-model>
        `);
        try {
            const found = YouTubeUi().firstMatch(['yt-flexible-actions-view-model']);
            assertEqual(found && found.id, 'live');
        } finally { teardown(); }
    });

    test('a zero-sized node is not a header', () => {
        stage('<div class="header" style="width:0;height:0"></div>');
        try {
            assertEqual(YouTubeUi().firstMatch(['.header']), null);
        } finally { teardown(); }
    });

    test('visibility:hidden keeps its box but is still not on screen', () => {
        stage('<div class="header" style="width:200px;height:40px;visibility:hidden"></div>');
        try {
            assertEqual(YouTubeUi().firstMatch(['.header']), null);
        } finally { teardown(); }
    });

    test('selectors are tried in order, and an absent one is skipped', () => {
        stage('<div class="second" style="width:120px;height:20px"></div>');
        try {
            const found = YouTubeUi().firstMatch(['.first', '.second']);
            assertEqual(found && found.className, 'second');
        } finally { teardown(); }
    });
});

/**
 * The pouch button beside Subscribe, across an SPA move.
 *
 * YouTube keeps the watch page in the DOM, hidden, when you go from a video to
 * its channel. "There is already a button" used to retire the task with the
 * button stranded in that hidden page, so the channel page had none.
 */
suite('youtube pouch button', () => {
    let host = null;

    function stage(html) {
        host = document.createElement('div');
        host.innerHTML = html;
        document.body.appendChild(host);
    }

    function teardown() {
        if (host) host.remove();
        host = null;
    }

    function makeShownUi() {
        return YouTubeUi().createYouTubeUi({
            watcher: { add() {}, remove() {}, has: () => false, schedule() {}, stop() {} },
            notify() {},
            getPouchButtonStyle: () => 'default',
        });
    }

    const SUB = '<ytd-subscribe-button-renderer style="display:block;width:90px;height:36px">' +
        '</ytd-subscribe-button-renderer>';

    test('a button stranded in a hidden page moves to the Subscribe on screen', () => {
        stage(`<div id="watch" style="display:none"><div>${SUB}</div></div>` +
            `<div id="channel"><div>${SUB}</div></div>`);
        try {
            const ui = makeShownUi();
            const { BUTTON_ID } = YouTubeUi();

            // Placed on the watch page while it was the one on screen.
            host.querySelector('#watch').style.display = '';
            host.querySelector('#channel').style.display = 'none';
            assertEqual(ui.injectPouchButton('/watch'), true);
            assert(host.querySelector('#watch #' + BUTTON_ID), 'placed on the watch page');

            // Off to the channel, which YouTube shows beside the hidden video.
            host.querySelector('#watch').style.display = 'none';
            host.querySelector('#channel').style.display = '';
            assertEqual(ui.injectPouchButton('/@someone'), true);
            assert(host.querySelector('#channel #' + BUTTON_ID), 'moved to the channel page');
            assertEqual(document.querySelectorAll('#' + BUTTON_ID).length, 1, 'moved, not duplicated');
        } finally { teardown(); }
    });

    test('a page with no Subscribe lets the task go at once', () => {
        stage(SUB);
        try {
            assertEqual(makeShownUi().injectPouchButton('/'), true);
            assertEqual(document.getElementById(YouTubeUi().BUTTON_ID), null,
                'nothing placed on the home page');
        } finally { teardown(); }
    });

    test('only home, the feeds, search and playlists go without Subscribe', () => {
        const { hasSubscribe } = YouTubeUi();
        for (const path of ['/', '/feed/subscriptions', '/results', '/playlist']) {
            assertEqual(hasSubscribe(path), false, path);
        }
        for (const path of ['/watch', '/@someone', '/channel/UC123', '/shorts/abc', '/playlists-fan']) {
            assertEqual(hasSubscribe(path), true, path);
        }
    });
});
