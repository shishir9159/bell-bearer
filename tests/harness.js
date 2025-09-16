/**
 * Minimal zero-dependency test framework. Runs in any browser — no Node, no
 * npm, no build step. Open tests/index.html and read the results.
 */
(function () {
    'use strict';

    const suites = [];
    let current = null;

    window.suite = function (name, fn) {
        current = { name, tests: [] };
        suites.push(current);
        fn();
        current = null;
    };

    window.test = function (name, fn) {
        if (!current) throw new Error('test() outside of suite(): ' + name);
        current.tests.push({ name, fn });
    };

    class AssertionError extends Error {}

    function fail(msg) { throw new AssertionError(msg); }

    window.assert = function (cond, msg) {
        if (!cond) fail(msg || 'expected truthy, got ' + cond);
    };
    window.assertEqual = function (actual, expected, msg) {
        if (actual !== expected) {
            fail((msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(expected) +
                ', got ' + JSON.stringify(actual));
        }
    };
    window.assertDeepEqual = function (actual, expected, msg) {
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);
        if (a !== e) fail((msg ? msg + ': ' : '') + 'expected ' + e + ', got ' + a);
    };
    window.assertThrows = async function (fn, msg) {
        try {
            await fn();
        } catch (e) {
            return e;
        }
        fail(msg || 'expected it to throw');
    };

    /**
     * A test that never settles used to freeze the whole run, leaving the page
     * reading "running…" with no clue which one was stuck. Racing each test
     * against a timeout turns that into an ordinary failure with a name on it.
     */
    /**
     * The cap exists to catch a test that never settles, not to police how
     * long one takes.
     *
     * It has to move with the tab's visibility. A browser throttles timers
     * hard in a background tab — a 100ms setTimeout can take a full second,
     * and longer once the page has been hidden a while — and the mock defers
     * every chrome.* callback through one. Run the suite in a tab you can see
     * and the whole thing is over in seconds; run it hidden and the same
     * tests legitimately need minutes. A fixed cap would fail them for the
     * environment rather than for the code.
     */
    const timeoutMs = () => (document.hidden ? 150000 : 10000);

    function withTimeout(promise, label) {
        const ms = timeoutMs();
        let timer;
        const limit = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new AssertionError(`timed out after ${ms}ms — ${label}`)), ms);
        });
        return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
    }

    window.runAllTests = async function (outEl) {
        const results = [];
        let passed = 0;
        let failed = 0;

        // Name the test in the page before running it. The report is only
        // written once every test has finished, so without this a test that
        // never settles leaves the page reading "running…" for ever with no
        // clue which one is stuck.
        const announce = (suite, name) => {
            if (outEl) outEl.textContent = `running… ${suite} › ${name}`;
        };

        for (const s of suites) {
            for (const t of s.tests) {
                announce(s.name, t.name);
                const started = performance.now();
                try {
                    await withTimeout(Promise.resolve().then(t.fn), t.name);
                    results.push({ suite: s.name, name: t.name, ok: true, ms: performance.now() - started });
                    passed++;
                } catch (e) {
                    results.push({
                        suite: s.name,
                        name: t.name,
                        ok: false,
                        detail: (e && e.message) || String(e),
                        stack: (e && e.stack) || '',
                    });
                    failed++;
                }
            }
        }

        // Plain-text report: readable in the page and easy to scrape.
        const lines = [];
        let lastSuite = null;
        for (const r of results) {
            if (r.suite !== lastSuite) {
                lines.push('');
                lines.push('# ' + r.suite);
                lastSuite = r.suite;
            }
            // Flag anything slow enough to be worth a look; the suite is meant
            // to stay fast enough that nobody avoids running it.
            const slow = r.ok && r.ms > 900 ? `  (${Math.round(r.ms)}ms)` : '';
            lines.push((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + slow);
            if (!r.ok) lines.push('        ' + r.detail);
        }
        lines.push('');
        lines.push('='.repeat(52));
        lines.push(`${passed}/${passed + failed} passed` + (failed ? `  (${failed} FAILED)` : '  — all green'));

        const text = lines.join('\n');
        if (outEl) {
            outEl.textContent = text;
            outEl.className = failed ? 'failed' : 'passed';
        }
        window.__testResults = { passed, failed, text };
        return window.__testResults;
    };
})();
