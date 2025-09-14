/**
 * Specs for the playback-rate model.
 *
 * These are the regression tests for "speed up and down is buggy sometimes".
 * The bug had two halves — the ladder skipping a rung when the current rate was
 * off-ladder, and each surface using a different step size — and both are
 * pinned here.
 */

const S = window.BB.Speed;

suite('speed: stepping the ladder', () => {
    test('stepping up from 1x walks the ladder in order', () => {
        let rate = 1;
        const seen = [];
        for (let i = 0; i < 5; i++) {
            rate = S.nextStep(rate);
            seen.push(rate);
        }
        assertDeepEqual(seen, [1.25, 1.5, 1.75, 2, 2.25]);
    });

    test('stepping down mirrors stepping up', () => {
        let rate = 2.25;
        const seen = [];
        for (let i = 0; i < 5; i++) {
            rate = S.prevStep(rate);
            seen.push(rate);
        }
        assertDeepEqual(seen, [2, 1.75, 1.5, 1.25, 1]);
    });

    test('up then down returns to the starting rate', () => {
        for (const start of S.STEPS.slice(1, -1)) {
            assertEqual(S.prevStep(S.nextStep(start)), start, `round trip from ${start}`);
        }
    });

    test('an off-ladder rate steps to the NEXT rung, never past it', () => {
        // The old code took the index of the *nearest* step and added one, so
        // 2.4 -> nearest 2.5 -> returned 3, skipping 2.5 entirely.
        assertEqual(S.nextStep(2.4), 2.5);
        assertEqual(S.nextStep(1.1), 1.25);
        assertEqual(S.nextStep(0.3), 0.5);
    });

    test('an off-ladder rate steps down to the previous rung, never past it', () => {
        assertEqual(S.prevStep(2.6), 2.5);
        assertEqual(S.prevStep(1.4), 1.25);
        assertEqual(S.prevStep(4.9), 4);
    });

    test('stepping saturates at the ends instead of running off', () => {
        const fastest = S.STEPS[S.STEPS.length - 1];
        const slowest = S.STEPS[0];
        assertEqual(S.nextStep(fastest), fastest);
        assertEqual(S.prevStep(slowest), slowest);
    });

    test('float noise does not count as a different rate', () => {
        // 0.1 + 0.2 arithmetic used to leave the rate a hair off a rung, and the
        // exact-match search then fell through to the nearest-index path.
        assertEqual(S.nextStep(1.7500000000000002), 2);
        assert(S.sameRate(1.7500000000000002, 1.75));
    });

    test('step() dispatches on direction, with 0 meaning reset', () => {
        assertEqual(S.step(1, 1), 1.25);
        assertEqual(S.step(1.25, -1), 1);
        assertEqual(S.step(3, 0), 1);
    });
});

suite('speed: clamping and formatting', () => {
    test('clamps to what a media element will actually play', () => {
        assertEqual(S.clamp(99), S.MAX_RATE);
        assertEqual(S.clamp(0), S.MIN_RATE);
        assertEqual(S.clamp(-4), S.MIN_RATE);
    });

    test('a non-numeric rate falls back to 1x rather than NaN', () => {
        assertEqual(S.clamp('fast'), 1);
        assertEqual(S.clamp(undefined), 1);
        assertEqual(S.clamp(NaN), 1);
    });

    test('formatting trims float noise', () => {
        assertEqual(S.format(1.7500000000000002), '1.75x');
        assertEqual(S.format(2), '2x');
    });
});
