/**
 * The browser suite in a headless Chrome, for CI and for a run nobody has to
 * keep a tab in front of: serves the repo, opens each page, and prints what
 * its harness reports. Exits non-zero when anything failed or never finished.
 *
 *     node tests/run-browser.js                     # index.html
 *     node tests/run-browser.js party-only.html "index.html?suite=reader"
 *     SIZE=344x550 node tests/run-browser.js        # a narrow window
 *
 * Headless counts as visible, so the harness's short timeouts apply. Reduced
 * motion is forced off: with it on — and a machine with animations turned off
 * reports it on — drags and settles skip the paths their specs are about.
 * `CHROME` names the browser where it is not in its usual place.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Serve = require('./serve.js');

const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ['index.html'];
const PORT = Number(process.env.PORT || 5611);
const PAGE_MS = 10 * 60 * 1000;

const CHROMES = {
    win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

function chromePath() {
    if (process.env.CHROME) return process.env.CHROME;
    const found = (CHROMES[process.platform] || []).find((one) => fs.existsSync(one));
    if (!found) throw new Error('no Chrome found: set CHROME to its path');
    return found;
}

/** Chrome, headless, on a debugging port of its own choosing; resolves to { port, stop }. */
async function launch() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-suite-'));
    const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
        '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', 'about:blank'];
    // GitHub's Ubuntu runners refuse the sandbox's user namespaces.
    if (process.env.CI && process.platform === 'linux') args.unshift('--no-sandbox');
    const chrome = spawn(chromePath(), args, { stdio: 'ignore' });
    const stop = () => {
        chrome.kill();
        setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* still held */ } }, 500);
    };
    const file = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100; i++) {
        if (fs.existsSync(file)) {
            const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
            if (port) return { port, stop };
        }
        await wait(100);
    }
    stop();
    throw new Error('Chrome did not open a debugging port');
}

/** One page's results text, or null if it never finished. */
async function run(port, page) {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done, fail) => { ws.addEventListener('open', done); ws.addEventListener('error', fail); });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    });
    const send = (method, params = {}) => new Promise((done) => {
        const n = ++id;
        pending.set(n, done);
        ws.send(JSON.stringify({ id: n, method, params }));
    });
    try {
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        if (process.env.SIZE) {
            const [width, height] = process.env.SIZE.split('x').map(Number);
            await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        }
        await send('Page.navigate', { url: `http://localhost:${PORT}/tests/${page}` });
        const until = Date.now() + PAGE_MS;
        while (Date.now() < until) {
            await wait(500);
            const answer = await send('Runtime.evaluate', { expression: 'window.__testResults && JSON.stringify(window.__testResults)', returnByValue: true });
            const value = answer.result && answer.result.result && answer.result.result.value;
            if (value) return JSON.parse(value);
        }
        return null;
    } finally {
        ws.close();
    }
}

async function main() {
    const servers = Serve.start(PORT, { quiet: true });
    const chrome = await launch();
    let ok = true;
    try {
        for (const page of PAGES) {
            const results = await run(chrome.port, page);
            if (!results) {
                console.log(`${page}: did not finish in ${PAGE_MS / 60000} minutes`);
                ok = false;
                continue;
            }
            const failures = results.text.split('\n').filter((line, at, all) => /^ {2}FAIL /.test(line) || /^ {2}FAIL /.test(all[at - 1] || ''));
            console.log(`${page}: ${results.text.split('\n').pop()}`);
            if (failures.length) console.log(failures.join('\n'));
            if (results.failed) ok = false;
        }
    } finally {
        chrome.stop();
        servers.forEach((server) => server.close());
    }
    process.exit(ok ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
