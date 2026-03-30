/**
 * The browser suite's framework: `suite`, `test`, `assert*`. `?suite=<word>`
 * runs only the suites whose name has that word in it.
 */
(function () {
    'use strict';

    const suites = [];
    let current = null;
    const only = new URLSearchParams(location.search).get('suite');

    window.suite = function (name, fn) {
        if (only && !name.includes(only)) return;
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
    const prefix = (msg) => (msg ? msg + ': ' : '');

    window.assert = function (cond, msg) {
        if (!cond) fail(msg || 'expected truthy, got ' + cond);
    };
    window.assertEqual = function (actual, expected, msg) {
        if (actual !== expected) {
            fail(`${prefix(msg)}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    };
    window.assertDeepEqual = function (actual, expected, msg) {
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);
        if (a !== e) fail(`${prefix(msg)}expected ${e}, got ${a}`);
    };

    // Turns a test that never settles into a named failure. A hidden tab
    // throttles timers, and the mock defers every callback through one, so
    // the same tests legitimately take minutes there.
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

        for (const s of suites) {
            for (const t of s.tests) {
                // Named before it runs, so a test that hangs says which it is.
                if (outEl) outEl.textContent = `running… ${s.name} › ${t.name}`;
                const started = performance.now();
                try {
                    await withTimeout(Promise.resolve().then(t.fn), t.name);
                    results.push({ suite: s.name, name: t.name, ok: true, ms: performance.now() - started });
                    passed++;
                } catch (e) {
                    results.push({ suite: s.name, name: t.name, ok: false, detail: (e && e.message) || String(e) });
                    failed++;
                }
            }
        }

        const lines = [];
        let lastSuite = null;
        for (const r of results) {
            if (r.suite !== lastSuite) {
                lines.push('', '# ' + r.suite);
                lastSuite = r.suite;
            }
            const slow = r.ok && r.ms > 900 ? `  (${Math.round(r.ms)}ms)` : '';
            lines.push((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + slow);
            if (!r.ok) lines.push('        ' + r.detail);
        }
        lines.push('', '='.repeat(52));
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
