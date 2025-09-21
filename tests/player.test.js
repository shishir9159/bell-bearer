/**
 * Specs for playback control, driven against a real <video> element and real
 * KeyboardEvents.
 *
 * This is the regression suite for "speed up and down is buggy sometimes". The
 * three causes each have a test:
 *
 *  - one keypress ran both our handler and the page's, so the rate moved two
 *    rungs (or landed off the ladder entirely);
 *  - the site reset playbackRate when it loaded a new source and nothing put it
 *    back;
 *  - a change made through the site's own speed menu was ignored, so the next
 *    step jumped from a rate the user could not see.
 */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A player wired to a real, attached <video>, plus the shortcut handling and a
 * page-level keydown listener standing in for YouTube's own.
 */
function harness() {
    const host = document.createElement('div');
    // Attached and non-zero-sized: the locator ignores videos that are neither.
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

    // Stands in for YouTube's own `<` / `>` handling.
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

const FASTER = { key: '>', code: 'Period', shiftKey: true };
const SLOWER = { key: '<', code: 'Comma', shiftKey: true };
const RESET = { key: '+', code: 'Equal', shiftKey: true };

suite('player: speed shortcuts', () => {
    test('one press moves exactly one rung', async () => {
        const h = harness();
        try {
            h.press(FASTER);
            assertEqual(h.video.playbackRate, 1.25);
            h.press(FASTER);
            assertEqual(h.video.playbackRate, 1.5);
        } finally { h.destroy(); }
    });

    test('REGRESSION: the page never sees a key we handled', async () => {
        // preventDefault() does not stop another listener, so YouTube's own
        // speed handling ran too and the rate moved twice per press.
        const h = harness();
        try {
            h.press(FASTER);
            h.press(SLOWER);
            assertEqual(h.pageHandlerRuns, 0, 'the page handler must not run for a key we act on');
        } finally { h.destroy(); }
    });

    test('a key we do not handle still reaches the page', async () => {
        const h = harness();
        try {
            h.press({ key: 'k', code: 'KeyK' });
            assertEqual(h.pageHandlerRuns, 1);
        } finally { h.destroy(); }
    });

    test('up then down returns to where it started', async () => {
        const h = harness();
        try {
            h.press(FASTER);
            h.press(FASTER);
            h.press(SLOWER);
            h.press(SLOWER);
            assertEqual(h.video.playbackRate, 1);
        } finally { h.destroy(); }
    });

    test('+ goes straight back to 1x from anywhere', async () => {
        const h = harness();
        try {
            for (let i = 0; i < 4; i++) h.press(FASTER);
            h.press(RESET);
            assertEqual(h.video.playbackRate, 1);
        } finally { h.destroy(); }
    });

    test('typing in a field is never hijacked', async () => {
        const h = harness();
        const field = document.createElement('input');
        document.body.appendChild(field);
        try {
            h.press(FASTER, field);
            assertEqual(h.video.playbackRate, 1, 'a ">" typed into a field must stay a ">"');
        } finally {
            field.remove();
            h.destroy();
        }
    });
});

suite('player: holding the rate against the page', () => {
    test('re-applies the chosen rate when the page resets it on a new source', async () => {
        const h = harness();
        try {
            h.player.setRate(2, { announce: false });

            h.video.dispatchEvent(new Event('loadstart'));
            await wait(20);
            h.video.playbackRate = 1; // the page stomping us mid-load
            await wait(20);

            assertEqual(h.video.playbackRate, 2, 'the rate should have been put back');
        } finally { h.destroy(); }
    });

    test('does not fight the page when the setting is off', async () => {
        const h = harness();
        try {
            h.player.setRate(2, { announce: false });
            h.setRemember(false);

            h.video.dispatchEvent(new Event('loadstart'));
            await wait(20);
            h.video.playbackRate = 1;
            await wait(20);

            assertEqual(h.video.playbackRate, 1);
        } finally { h.destroy(); }
    });

    test('adopts a change made through the site own speed control', async () => {
        // Outside the after-a-source-change window, a rate we did not set is
        // the user driving the page. Fighting it made our speed menu unusable.
        const h = harness();
        try {
            h.player.setRate(2, { announce: false });
            h.video.playbackRate = 0.75;
            await wait(20);

            assertEqual(h.video.playbackRate, 0.75, 'must not be pulled back');
            assertEqual(h.player.desiredRate, 0.75, 'must become the new intent');

            h.press(FASTER);
            assertEqual(h.video.playbackRate, 1, 'stepping continues from the adopted rate');
        } finally { h.destroy(); }
    });
});

suite('player: temporary boost', () => {
    test('runs at 3x then restores the previous rate', async () => {
        const h = harness();
        try {
            h.player.setRate(1.5, { announce: false });
            h.player.boostSpeed(0.1);
            assertEqual(h.video.playbackRate, 3);

            await wait(250);
            assertEqual(h.video.playbackRate, 1.5);
        } finally { h.destroy(); }
    });

    test('a manual change during a boost cancels it', async () => {
        // Otherwise the restore fires later and silently undoes the choice the
        // user just made.
        const h = harness();
        try {
            h.player.setRate(1.5, { announce: false });
            h.player.boostSpeed(0.1);
            h.press(FASTER);
            const chosen = h.video.playbackRate;

            await wait(250);
            assertEqual(h.video.playbackRate, chosen, 'the restore must not undo a manual change');
        } finally { h.destroy(); }
    });

    test('re-triggering extends the boost without losing the original rate', async () => {
        const h = harness();
        try {
            h.player.setRate(1.25, { announce: false });
            h.player.boostSpeed(0.1);
            h.player.boostSpeed(0.2);   // the original rate must still be 1.25
            await wait(400);
            assertEqual(h.video.playbackRate, 1.25);
        } finally { h.destroy(); }
    });
});

suite('player: skipping', () => {
    test('skips forward and back by the requested amount', async () => {
        const h = harness();
        try {
            h.player.skip(5);
            assertEqual(h.video.currentTime, 5);
            h.player.skip(-3);
            assertEqual(h.video.currentTime, 2);
        } finally { h.destroy(); }
    });

    test('never seeks before the start', async () => {
        const h = harness();
        try {
            h.player.skip(-9);
            assertEqual(h.video.currentTime, 0);
        } finally { h.destroy(); }
    });

    test('an unknown duration does not poison currentTime', async () => {
        // duration is NaN until metadata loads, and Math.min(x, NaN) is NaN —
        // which the old code wrote straight into currentTime.
        const h = harness();
        try {
            assert(Number.isNaN(h.video.duration), 'precondition: duration is not known yet');
            h.player.skip(7);
            assert(!Number.isNaN(h.video.currentTime), 'currentTime must stay a number');
            assertEqual(h.video.currentTime, 7);
        } finally { h.destroy(); }
    });
});
