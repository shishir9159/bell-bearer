/**
 * Playback control against a real <video> and real KeyboardEvents — the
 * regression suite for "speed up and down is buggy sometimes": one press ran
 * our handler and the page's, the site reset the rate on a new source, and a
 * change made in the site's own menu was ignored.
 */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A player on a real, attached <video>, with the shortcuts installed and a
 * page keydown listener standing in for YouTube's own.
 */
function harness() {
    const host = document.createElement('div');
    // The locator ignores a video that is detached or zero-sized.
    host.style.cssText = 'position:fixed;left:-9999px;width:320px;height:180px;';
    const video = document.createElement('video');
    video.width = 320;
    video.height = 180;
    host.appendChild(video);
    document.body.appendChild(host);

    const notes = [];
    let remember = true;
    const player = window.BB.Player.createPlayer({
        getVideoElement: () => video,
        notify: (message) => notes.push(message),
        shouldRemember: () => remember,
    });
    player.attach();

    let pageHandlerRuns = 0;
    const pageHandler = () => { pageHandlerRuns++; };
    document.addEventListener('keydown', pageHandler);

    const uninstall = window.BB.Shortcuts.install({
        hasVideo: () => true,
        skip: (seconds) => player.skip(seconds),
        faster: () => player.faster(),
        slower: () => player.slower(),
        resetSpeed: () => player.resetSpeed(),
        boostSpeed: (seconds) => player.boostSpeed(seconds),
        startRecording: () => notes.push('record:start'),
        stopRecording: () => notes.push('record:stop'),
        toggleSegment: () => notes.push('segment'),
    }, { canRecord: () => true });

    return {
        video, player, notes,
        get pageHandlerRuns() { return pageHandlerRuns; },
        setRemember: (value) => { remember = value; },
        press: (init, target = document.body) => target.dispatchEvent(
            new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init))),
        destroy: () => {
            uninstall();
            player.detach();
            document.removeEventListener('keydown', pageHandler);
            host.remove();
        },
    };
}

async function using(fn) {
    const h = harness();
    try {
        await fn(h);
    } finally {
        h.destroy();
    }
}

const FASTER = { key: '>', code: 'Period', shiftKey: true };
const SLOWER = { key: '<', code: 'Comma', shiftKey: true };
const RESET = { key: '+', code: 'Equal', shiftKey: true };

suite('player: speed shortcuts', () => {
    test('one press moves exactly one rung, down retraces up, and + goes back to 1x', () => using((h) => {
        h.press(FASTER);
        assertEqual(h.video.playbackRate, 1.25);
        h.press(FASTER);
        assertEqual(h.video.playbackRate, 1.5);
        h.press(SLOWER);
        h.press(SLOWER);
        assertEqual(h.video.playbackRate, 1);
        for (let i = 0; i < 4; i++) h.press(FASTER);
        h.press(RESET);
        assertEqual(h.video.playbackRate, 1);
    }));

    test('REGRESSION: the page never sees a key we handled, and still gets the rest', () => using((h) => {
        // preventDefault() does not stop another listener, so YouTube's own
        // handling ran too and the rate moved twice per press.
        h.press(FASTER);
        h.press(SLOWER);
        assertEqual(h.pageHandlerRuns, 0);
        h.press({ key: 'k', code: 'KeyK' });
        assertEqual(h.pageHandlerRuns, 1);
    }));

    test('typing in a field is never hijacked', () => using((h) => {
        const field = document.createElement('input');
        document.body.appendChild(field);
        try {
            h.press(FASTER, field);
            assertEqual(h.video.playbackRate, 1, 'a ">" typed into a field must stay a ">"');
        } finally {
            field.remove();
        }
    }));
});

suite('player: holding the rate against the page', () => {
    test('a reset by the page on a new source is put back, unless the setting is off', async () => {
        for (const remember of [true, false]) {
            await using(async (h) => {
                h.player.setRate(2, { announce: false });
                h.setRemember(remember);
                h.video.dispatchEvent(new Event('loadstart'));
                await wait(20);
                h.video.playbackRate = 1;
                await wait(20);
                assertEqual(h.video.playbackRate, remember ? 2 : 1, `remember ${remember}`);
            });
        }
    });

    test('adopts a change made through the site own speed control', () => using(async (h) => {
        // Away from a source change, a rate we did not set is the user's.
        // Fighting it made the site's speed menu unusable.
        h.player.setRate(2, { announce: false });
        h.video.playbackRate = 0.75;
        await wait(20);
        assertEqual(h.video.playbackRate, 0.75, 'pulled back');
        assertEqual(h.player.desiredRate, 0.75, 'not the new intent');
        h.press(FASTER);
        assertEqual(h.video.playbackRate, 1, 'stepping continues from the adopted rate');
    }));
});

suite('player: telling its own writes apart', () => {
    test('REGRESSION: a boost is not adopted as the chosen rate', () => using(async (h) => {
        // ratechange is queued, and the flag marking our own writes was
        // cleared before it ran, so a new video started at the boost's 3x.
        h.player.setRate(1.5, { announce: false });
        h.player.boostSpeed(10);
        await wait(50);
        assertEqual(h.player.desiredRate, 1.5);
    }));

    test('while a watch party holds the rate, its writes are not adopted and the keys go to it', () => using(async (h) => {
        const steps = [];
        h.player.setRate(1, { announce: false });
        h.player.holdRate(true, { step: (direction) => { steps.push(direction); return 1.25; } });
        assert(h.player.isRateHeld());
        h.video.playbackRate = 0.93; // a sync nudge
        await wait(50);
        assertEqual(h.player.desiredRate, 1, 'a nudge is not a choice');
        h.press(FASTER);
        assertDeepEqual(steps, [1]);
        assertEqual(h.video.playbackRate, 0.93, 'the party writes the rate, not the player');
        h.player.holdRate(false);
        assert(!h.player.isRateHeld());
    }));
});

suite('player: temporary boost', () => {
    test('runs at 3x then restores the previous rate', () => using(async (h) => {
        h.player.setRate(1.5, { announce: false });
        h.player.boostSpeed(0.1);
        assertEqual(h.video.playbackRate, 3);
        await wait(250);
        assertEqual(h.video.playbackRate, 1.5);
    }));

    test('a manual change during a boost cancels it', () => using(async (h) => {
        h.player.setRate(1.5, { announce: false });
        h.player.boostSpeed(0.1);
        h.press(FASTER);
        const chosen = h.video.playbackRate;
        await wait(250);
        assertEqual(h.video.playbackRate, chosen, 'the restore undid a manual change');
    }));

    test('re-triggering extends the boost without losing the original rate', () => using(async (h) => {
        h.player.setRate(1.25, { announce: false });
        h.player.boostSpeed(0.1);
        h.player.boostSpeed(0.2);
        await wait(400);
        assertEqual(h.video.playbackRate, 1.25);
    }));
});

/**
 * Reddit's player: a shreddit-player whose open shadow root holds the
 * <video>. Larger than the harness's, so it outranks any video left over.
 */
function redditPlayer(top = 0) {
    const host = document.createElement('shreddit-player');
    host.style.cssText = `position:fixed;left:-9999px;top:${top}px;display:block;width:400px;height:225px;`;
    const video = document.createElement('video');
    video.width = 400;
    video.height = 225;
    host.attachShadow({ mode: 'open' }).appendChild(video);
    document.body.appendChild(host);
    return { host, video };
}

async function onReddit(fn) {
    const { host, video } = redditPlayer();
    const player = window.BB.Player.createPlayer({
        getVideoElement: window.BB.Site.createPlayerLocator('reddit'), notify: () => {},
    });
    player.attach();
    try {
        await fn(player, video);
    } finally {
        player.detach();
        host.remove();
    }
}

suite('player: Reddit, whose video is inside a shadow root', () => {
    test('REGRESSION: the locator finds it', () => {
        const { host, video } = redditPlayer();
        try {
            assertEqual(document.querySelector('shreddit-player video'), null, 'precondition');
            assertEqual(window.BB.Site.createPlayerLocator('reddit')(), video);
        } finally { host.remove(); }
    });

    test('on a feed, the player on screen wins over one scrolled past', () => {
        const first = redditPlayer();
        let second = null;
        try {
            const locate = window.BB.Site.createPlayerLocator('reddit');
            assertEqual(locate(), first.video);
            first.host.style.top = '-5000px';
            second = redditPlayer();
            assertEqual(locate(), second.video, 'the memoised one is still attached, but nobody can see it');
        } finally {
            first.host.remove();
            if (second) second.host.remove();
        }
    });

    test('REGRESSION: a reset while loading is put back, because the root is listened in', () => onReddit(async (player, video) => {
        // Media events are not composed: a capture listener on document never heard this ratechange.
        player.setRate(2, { announce: false });
        video.dispatchEvent(new Event('loadstart'));
        await wait(20);
        video.playbackRate = 1;
        await wait(20);
        assertEqual(video.playbackRate, 2);
    }));

    test('a change made in Reddit\'s own speed menu is adopted', () => onReddit(async (player, video) => {
        player.setRate(2, { announce: false });
        video.playbackRate = 0.75;
        await wait(20);
        assertEqual(player.desiredRate, 0.75);
    }));
});

suite('player: skipping', () => {
    test('skips by the amount asked, never before the start, before the duration is known', () => using((h) => {
        // duration is NaN until metadata loads, and Math.min(x, NaN) once went into currentTime.
        assert(Number.isNaN(h.video.duration), 'precondition');
        h.player.skip(5);
        assertEqual(h.video.currentTime, 5);
        h.player.skip(-3);
        assertEqual(h.video.currentTime, 2);
        h.player.skip(-9);
        assertEqual(h.video.currentTime, 0);
    }));
});
