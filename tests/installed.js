/**
 * The extension as Chrome installs it: loaded unpacked into a headless Chrome
 * with a throwaway profile, and asked, through its own worker, what the specs
 * cannot — that the site scripts are registered on install, that a site
 * switched off is taken out and one the browser refuses takes no other with
 * it, that a worker stopped and woken again still answers, and that a reload
 * registers everything over again. Exits non-zero when any of it fails.
 *
 *     node tests/installed.js        # CHROME=<path> where Chrome is elsewhere
 *
 * Chrome is driven over a pipe, which is what lets a branded Chrome load an
 * unpacked extension at all (--load-extension is ignored there).
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SiteScripts = require('../src/background/site-scripts.js');

const ROOT = fs.realpathSync.native(path.resolve(__dirname, '..'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const CHROMES = {
    win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

const REQUEST_MS = 20000;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const sorted = (list) => [...list].sort();

/** Chrome over --remote-debugging-pipe: requests in on fd 3, answers and events out on fd 4, NUL between messages. */
function launch() {
    const chrome = process.env.CHROME || (CHROMES[process.platform] || []).find((one) => fs.existsSync(one));
    if (!chrome) throw new Error('no Chrome found: set CHROME to its path');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-installed-'));
    const args = ['--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`,
        '--no-first-run', '--no-default-browser-check', 'about:blank'];
    // GitHub's Ubuntu runners refuse the sandbox's user namespaces.
    if (process.env.CI && process.platform === 'linux') args.unshift('--no-sandbox');
    const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    const [, , , input, output] = child.stdio;
    let id = 0;
    let buffer = '';
    const pending = new Map();
    const listeners = new Set();
    output.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let end;
        while ((end = buffer.indexOf('\0')) >= 0) {
            const msg = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            if (msg.id && pending.has(msg.id)) {
                pending.get(msg.id)(msg);
                pending.delete(msg.id);
            } else {
                listeners.forEach((fn) => fn(msg));
            }
        }
    });
    /** A request, answered or failed within REQUEST_MS: a Chrome that stops answering fails the run rather than hanging it. */
    function send(method, params = {}, sessionId) {
        const n = ++id;
        if (process.env.DEBUG) console.log('>', method);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(n);
                reject(new Error(`${method}: no answer in ${REQUEST_MS / 1000}s`));
            }, REQUEST_MS);
            pending.set(n, (msg) => {
                clearTimeout(timer);
                if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
                else resolve(msg.result);
            });
            input.write(`${JSON.stringify({ id: n, method, params, sessionId })}\0`);
        });
    }
    const stop = () => {
        child.kill();
        setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* still held */ } }, 500);
    };
    return { send, stop, on: (fn) => listeners.add(fn) };
}

function createRunner(cdp, extensionId) {
    const workerUrl = `chrome-extension://${extensionId}/background.js`;

    /** A session on the extension's worker, starting it by opening one of its pages if it is not running. */
    async function worker() {
        for (let i = 0; i < 100; i++) {
            const { targetInfos } = await cdp.send('Target.getTargets');
            const target = targetInfos.find((one) => one.type === 'service_worker' && one.url === workerUrl);
            if (target) {
                const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
                return { targetId: target.targetId, sessionId };
            }
            await wait(100);
        }
        throw new Error('the worker never started');
    }

    /** `expression` evaluated in the worker, awaited, its value returned. */
    async function inWorker(expression) {
        const { sessionId } = await worker();
        const answer = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception ? answer.exceptionDetails.exception.description : answer.exceptionDetails.text);
        return answer.result.value;
    }

    /**
     * `expression` until `done(value)` says so, or the last value after `ms`.
     * A worker just started has no chrome.* for a moment, and one going away
     * stops answering: either is tried again rather than failed.
     */
    async function until(expression, done, ms = 15000) {
        const end = Date.now() + ms;
        let value;
        while (Date.now() < end) {
            try {
                value = await Promise.race([inWorker(expression), wait(4000).then(() => { throw new Error('no answer'); })]);
                if (done(value)) return value;
            } catch (_) { /* again */ }
            await wait(150);
        }
        return value;
    }

    const REGISTERED = 'chrome.scripting.getRegisteredContentScripts().then((list) => list.map((one) => one.id).sort())';
    const registered = () => until(REGISTERED, Array.isArray);
    /** Wait for what is registered to be `ids`; answers what it ended as. */
    const settles = (ids) => until(REGISTERED, (have) => JSON.stringify(have) === JSON.stringify(sorted(ids)));

    /** A worker other than the one marked: its globals start over, so the mark is gone. */
    const mark = () => until('(self.__bbInstalledMark = true)', (value) => value === true);
    const restarted = () => until('typeof self.__bbInstalledMark === "undefined"', (value) => value === true);

    return { worker, inWorker, until, registered, settles, mark, restarted };
}

async function main() {
    const cdp = launch();
    const results = [];
    const check = async (name, fn) => {
        try {
            await fn();
            results.push(`  PASS  ${name}`);
        } catch (error) {
            results.push(`  FAIL  ${name}\n        ${error.message}`);
        }
    };
    const eq = (actual, expected, what) => {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    };
    try {
        await wait(500);
        const { id } = await cdp.send('Extensions.loadUnpacked', { path: ROOT });
        const run = createRunner(cdp, id);
        const all = SiteScripts.scripts(SiteScripts.genericOf(MANIFEST), []).map((one) => one.id);

        await check('every site\'s scripts are registered as it is installed', async () => {
            eq(await run.settles(all), sorted(all), 'registered');
        });

        await check('a site switched off is taken out, and its pages get the plain entry', async () => {
            const off = SiteScripts.scripts(SiteScripts.genericOf(MANIFEST), ['youtube']).map((one) => one.id);
            await run.inWorker('chrome.storage.local.set({ sitesOff: ["youtube"] })');
            eq(await run.settles(off), sorted(off), 'registered with YouTube off');
            await run.inWorker('chrome.storage.local.set({ sitesOff: [] })');
            eq(await run.settles(all), sorted(all), 'registered with it back on');
        });

        await check('a script the browser refuses is said to be, and takes no other down', async () => {
            const refused = await run.inWorker(`(async () => {
                const want = BB.SiteScripts.scripts(chrome.runtime.getManifest().content_scripts.find((one) => one.matches.includes('<all_urls>')), []);
                const out = await BB.SiteScripts.apply(chrome.scripting, [...want, { id: 'bb-refused', matches: ['not a match pattern'], js: ['src/content/main.js'] }]);
                return out.map((one) => one.id);
            })()`);
            eq(refused, ['bb-refused'], 'refused');
            eq(sorted(await run.registered()), sorted(all), 'what else is registered');
        });

        await check('a worker stopped and started again answers, and keeps what it registered', async () => {
            eq(await run.mark(), true, 'the worker marked');
            const { targetId: worker } = await run.worker();
            await cdp.send('Target.closeTarget', { targetId: worker });
            // Opening one of its pages is a message to it, which starts it again.
            const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${id}/popup.html` });
            eq(await run.restarted(), true, 'the same worker went on running');
            const answer = await run.until('BB.Router.dispatch({ action: "partyStatus" }, {})', (value) => !!value);
            eq(answer && answer.ok, true, 'a message answered by the worker started again');
            eq(await run.registered(), sorted(all), 'registered after the restart');
            await cdp.send('Target.closeTarget', { targetId });
        });

        await check('a reload registers everything over again', async () => {
            eq(await run.mark(), true, 'the worker marked');
            await cdp.send('Extensions.loadUnpacked', { path: ROOT });
            eq(await run.restarted(), true, 'the reload left the old worker running');
            eq(await run.settles(all), sorted(all), 'registered after the reload');
        });
    } finally {
        cdp.stop();
    }
    console.log(results.join('\n'));
    const failed = results.filter((line) => line.startsWith('  FAIL')).length;
    console.log(`\n${results.length - failed}/${results.length} passed${failed ? `  (${failed} FAILED)` : ''}`);
    process.exit(failed ? 1 : 0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
