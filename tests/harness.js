/**
 * The browser suite's framework — `suite`, `test`, `assert*` — and the page
 * that runs it: a suite page is a heading and its script tags. `?suite=<word>`
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
    class Skipped extends Error {}

    /**
     * A test that cannot run here says so, and is counted as skipped. A
     * return in its place counted as a pass: over file:// every entry spec
     * passed without having loaded anything.
     */
    window.skip = function (why) { throw new Skipped(why); };

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
        let skipped = 0;

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
                    if (e instanceof Skipped) {
                        results.push({ suite: s.name, name: t.name, skipped: true, detail: e.message });
                        skipped++;
                        continue;
                    }
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
            lines.push((r.skipped ? '  SKIP  ' : r.ok ? '  PASS  ' : '  FAIL  ') + r.name + slow);
            if (!r.ok) lines.push('        ' + r.detail);
        }
        lines.push('', '='.repeat(52));
        lines.push(`${passed}/${passed + failed} passed` + (failed ? `  (${failed} FAILED)` : '  — all green')
            + (skipped ? `, ${skipped} skipped` : ''));

        const text = lines.join('\n');
        if (outEl) {
            outEl.textContent = text;
            outEl.className = failed ? 'failed' : 'passed';
        }
        window.__testResults = { passed, failed, skipped, text };
        return window.__testResults;
    };

    const STYLE = `
        body { font: 13px/1.5 Consolas, ui-monospace, monospace; background: #1b1b1b; color: #ddd; margin: 0; padding: 24px; }
        h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
        h1 + p { color: #888; margin: 0 0 16px; }
        #out { white-space: pre; padding: 16px; border-radius: 6px; background: #141414; border: 1px solid #333; overflow-x: auto; }
        #out.passed { border-color: #2d7d46; }
        #out.failed { border-color: #a33; }
        #banner { margin-top: 14px; padding: 10px 14px; border-radius: 6px; font-weight: 600; }
        .ok { background: #16341f; color: #7ee2a0; }
        .bad { background: #3a1717; color: #ff9b9b; }`;

    document.addEventListener('DOMContentLoaded', async () => {
        document.head.insertAdjacentHTML('beforeend', `<style>${STYLE}</style>`);
        document.body.insertAdjacentHTML('beforeend', '<pre id="out">running…</pre><div id="banner"></div>');
        const out = document.getElementById('out');
        const banner = document.getElementById('banner');
        try {
            const r = await window.runAllTests(out);
            banner.className = r.failed ? 'bad' : 'ok';
            banner.textContent = r.failed ? `${r.failed} test(s) failing` : `all ${r.passed} tests passing`;
        } catch (e) {
            out.className = 'failed';
            out.textContent = 'HARNESS ERROR\n\n' + (e && e.stack ? e.stack : e);
            banner.className = 'bad';
            banner.textContent = 'suite crashed';
        }
    });
})();
