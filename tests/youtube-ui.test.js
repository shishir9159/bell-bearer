/**
 * Where Bell Bearer's row lands in YouTube's left drawer.
 *
 * This is the one injection whose *position* is the feature: the entry used to
 * be prepended to `#sections`, which put a bare div above YouTube's whole nav
 * rather than in it. It now belongs third in the first section, after Home and
 * Shorts, and that is easy to lose again the next time this file is touched.
 *
 * The tests call `injectGuideEntry` straight off the factory rather than going
 * through `install()`. The watcher only runs its tasks on an animation frame,
 * and a background tab may not get one for seconds at a time.
 */

const YouTubeUi = () => window.BB.YouTubeUi;

/** A stand-in drawer: `count` items in the first section, one in a second. */
function drawer(count) {
    const host = document.createElement('div');
    host.id = 'bb-test-guide';

    const first = ['Home', 'Shorts', 'Subscriptions', 'You']
        .slice(0, count)
        .map((name) => `<ytd-guide-entry-renderer>${name}</ytd-guide-entry-renderer>`)
        .join('');

    host.innerHTML = `
        <ytd-guide-renderer>
            <div id="sections">
                <ytd-guide-section-renderer><div id="items">${first}</div></ytd-guide-section-renderer>
                <ytd-guide-section-renderer><div id="items">
                    <ytd-guide-entry-renderer>History</ytd-guide-entry-renderer>
                </div></ytd-guide-section-renderer>
            </div>
        </ytd-guide-renderer>`;

    document.body.appendChild(host);
    return host;
}

function teardown() {
    const host = document.getElementById('bb-test-guide');
    if (host) host.remove();
}

/** A fresh factory: each one carries its own retry counter. */
function makeUi() {
    return YouTubeUi().createYouTubeUi({
        watcher: { add() {}, remove() {}, has: () => false, schedule() {}, stop() {} },
        notify() {},
        getPouchButtonStyle: () => 'hidden',
    });
}

/** The first section's items, with our entry named rather than shown as HTML. */
function firstSection() {
    return [...document.querySelectorAll('#bb-test-guide #sections ytd-guide-section-renderer')][0]
        .querySelector('#items').children;
}

const labels = () => [...firstSection()].map((el) => el.id || el.textContent.trim());

suite('youtube drawer entry', () => {

    test('lands third, after Home and Shorts', () => {
        drawer(3);
        try {
            assert(makeUi().injectGuideEntry() === true, 'placing it should finish the task');
            assertDeepEqual(labels(),
                ['Home', 'Shorts', 'bb-guide-entry', 'Subscriptions']);
        } finally { teardown(); }
    });

    test('goes in the first section, not above the whole drawer', () => {
        drawer(3);
        try {
            makeUi().injectGuideEntry();
            const entry = document.getElementById('bb-guide-entry');
            assert(entry.parentElement.id === 'items',
                'the entry is an item in the list, not a sibling of the sections');
        } finally { teardown(); }
    });

    test('reads "Pouch", under the extension\'s own icon', () => {
        drawer(3);
        try {
            makeUi().injectGuideEntry();
            const entry = document.getElementById('bb-guide-entry');
            // Every other row in that drawer is named after where it goes,
            // not after what clicking it does, so this one is too.
            assertEqual(entry.textContent.trim(), 'Pouch');

            const icon = entry.querySelector('.bb-guide-ico img');
            assert(icon, 'the row wears the Bell Bearer icon, not a generic glyph');
            assert(/icons\/icon\d*\.png$/.test(icon.getAttribute('src') || ''),
                'and it comes from icons/, which is why that folder is web-accessible');

            // The row borrows YouTube's scope classes, so the rules that size
            // its icon column and set the weight of its labels reach ours too.
            assert(entry.querySelector('.guide-icon.style-scope.ytd-guide-entry-renderer'),
                'the icon column is styled by the rule Home and Shorts use');
            assert(entry.querySelector('.title.style-scope.ytd-guide-entry-renderer'),
                'and so is the label');
        } finally { teardown(); }
    });

    test('waits rather than settling for second place while the drawer fills in', () => {
        // YouTube streams the drawer; on the first pass only Home may exist.
        // Taking that slot would leave the entry sitting second for good.
        drawer(1);
        try {
            const ui = makeUi();
            assertEqual(ui.injectGuideEntry(), false, 'not enough items yet — try again later');
            assertEqual(document.getElementById('bb-guide-entry'), null);

            // The rest arrive, and now it takes its place.
            firstSection()[0].insertAdjacentHTML('afterend',
                '<ytd-guide-entry-renderer>Shorts</ytd-guide-entry-renderer>' +
                '<ytd-guide-entry-renderer>Subscriptions</ytd-guide-entry-renderer>');
            assertEqual(ui.injectGuideEntry(), true);
            assertDeepEqual(labels(), ['Home', 'Shorts', 'bb-guide-entry', 'Subscriptions']);
        } finally { teardown(); }
    });

    test('gives up waiting and appears anyway on a drawer that never reaches three', () => {
        // Signed out, or with Shorts turned off. Never injecting would be worse
        // than injecting in the wrong slot.
        drawer(2);
        try {
            const ui = makeUi();
            let result = false;
            for (let i = 0; i < 20 && result === false; i += 1) result = ui.injectGuideEntry();

            assertEqual(result, true, 'it must stop waiting eventually');
            assertDeepEqual(labels(), ['Home', 'Shorts', 'bb-guide-entry']);
        } finally { teardown(); }
    });

    test('a second pass does not add a duplicate', () => {
        drawer(3);
        try {
            const ui = makeUi();
            ui.injectGuideEntry();
            assertEqual(ui.injectGuideEntry(), true);
            assertEqual(document.querySelectorAll('#bb-guide-entry').length, 1);
        } finally { teardown(); }
    });

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
            <yt-flexible-actions-view-model id="live" style="width:200px;height:40px"></yt-flexible-actions-view-model>
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
