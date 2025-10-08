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

    window.runAllTests = async function (outEl) {
        const results = [];
        let passed = 0;
        let failed = 0;

        for (const s of suites) {
            for (const t of s.tests) {
                try {
                    await t.fn();
                    results.push({ suite: s.name, name: t.name, ok: true });
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
            lines.push((r.ok ? '  PASS  ' : '  FAIL  ') + r.name);
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
