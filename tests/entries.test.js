/**
 * Each isolated-world entry boots on its own, in a frame with only its files:
 * the manifest's, and each one the worker registers for a site. A site block
 * that reaches for another site's module throws on that site alone, which the
 * other specs, loading everything at once, never see. A site switched off
 * gets the core list alone. Over file:// the manifest cannot be read, and
 * these are skipped, saying so; serve the repo to run them.
 */
(function () {
    'use strict';

    // XMLHttpRequest, not fetch: mock-chrome.js puts a fetch of its own on the page.
    let manifest = null;
    const readManifest = () => (manifest = manifest || new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('GET', '../manifest.json');
        request.onload = () => resolve(JSON.parse(request.responseText));
        request.onerror = () => reject(new Error('could not read ../manifest.json'));
        request.send();
    }));

    /** Where each site's own entry is known by: a file only it loads. */
    const MARKS = {
        youtube: 'src/content/youtube-ui.js', twitter: 'src/content/twitter-ui.js', reddit: 'src/content/roster.js',
        chess: 'src/content/chess.js', lichess: 'src/content/chess.js', leetcode: 'src/content/leet-ui.js',
        typeracer: 'src/content/typeracer-ui.js', chatgpt: 'src/content/chat-ui.js', claude: 'src/content/chat-ui.js',
        netflix: 'src/content/netflix-ui.js', wikipedia: 'src/content/wiki-read.js',
        github: 'src/content/ci-watch.js', gitlab: 'src/content/ci-watch.js', forgejo: 'src/content/ci-watch.js',
        vimeo: 'src/content/vimeo-download.js',
    };
    const SERVE = 'the manifest is read over http: run node tests/serve.js';

    /** Every isolated-world entry, with the sites in `off` switched off. */
    async function entries(off = []) {
        const doc = await readManifest();
        const { SiteScripts } = window.BB;
        return [...doc.content_scripts, ...SiteScripts.scripts(SiteScripts.genericOf(doc), off)]
            .filter((entry) => entry.world !== 'MAIN');
    }

    /** The entry a page of `site` gets: the one carrying its mark, or the generic one. */
    async function entryFor(site) {
        const all = await entries();
        const mark = MARKS[site];
        return mark ? all.find((entry) => entry.js.includes(mark)) : all.find((entry) => entry.matches.includes('<all_urls>'));
    }

    /** Load `entry` into a frame as `site`; resolves to { booted, errors }. */
    function boot(entry, site) {
        return new Promise((resolve) => {
            const frame = document.createElement('iframe');
            frame.style.cssText = 'position:absolute;left:-9999px;width:800px;height:600px';
            let timer = 0;
            const done = (result) => {
                clearTimeout(timer);
                window.removeEventListener('message', onMessage);
                frame.remove();
                resolve(result);
            };
            const onMessage = (event) => { if (event.source === frame.contentWindow) done(event.data); };
            window.addEventListener('message', onMessage);

            const tag = (src) => `<script src="../${src}"></scr` + 'ipt>';
            const inline = (code) => `<script>${code}</scr` + 'ipt>';
            const scripts = entry.js.map((file) => (file === 'src/content/main.js'
                ? inline(`BB.Site.detectSite = () => ${JSON.stringify(site)};`) + tag(file)
                : tag(file)));
            frame.srcdoc = [
                '<!doctype html><html><head><meta charset="utf-8">',
                inline("window.__errors = []; window.addEventListener('error', (e) => window.__errors.push(String(e.message)));"),
                '<script src="mock-chrome.js"></scr' + 'ipt>',
                ...scripts,
                inline("setTimeout(() => parent.postMessage({ booted: !!window.__bellBearer, errors: window.__errors }, '*'), 300);"),
                '</head><body></body></html>',
            ].join('\n');
            document.body.appendChild(frame);
            timer = setTimeout(() => done({ booted: false, errors: ['the frame never answered'] }), 8000);
        });
    }

    suite('content script entries — each boots on its own', () => {
        for (const site of ['other', ...Object.keys(MARKS)]) {
            test(`a ${site} page`, async () => {
                if (location.protocol === 'file:') skip(SERVE);
                const entry = await entryFor(site);
                assert(entry, `no entry loads ${MARKS[site]}`);
                const { booted, errors } = await boot(entry, site);
                assertDeepEqual(errors, [], 'errors while it loaded');
                assert(booted, 'main.js did not finish');
            });
        }
    });

    suite('a site switched off — boots as any other page', () => {
        for (const site of Object.keys(MARKS)) {
            test(`a ${site} page, switched off`, async () => {
                if (location.protocol === 'file:') skip(SERVE);
                const entry = (await entries([site])).find((one) => one.id === 'bb-plain');
                assert(entry && !entry.js.includes(MARKS[site]), 'its own files are still registered');
                const { booted, errors } = await boot(entry, site);
                assertDeepEqual(errors, [], 'errors while it loaded');
                assert(booted, 'main.js did not finish');
            });
        }
    });
})();
