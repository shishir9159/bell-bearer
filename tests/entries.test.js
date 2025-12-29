/**
 * Each of the manifest's isolated-world entries boots on its own.
 *
 * A page gets exactly one entry: the core list, that site's own files, then
 * main.js. So main.js runs with the core and one site's modules and nothing
 * else, and a site block that reached for another site's module — or a core
 * module that leaned on a site's — throws at load on that site alone, where
 * none of the other specs would ever see it: they load everything at once.
 *
 * This loads each entry's files, and only those, into a frame of their own,
 * tells Site which site it is on, and lets main.js boot there. Over file://
 * the manifest cannot be fetched, and these say so rather than fail.
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
    };

    /** The entry a page of `site` gets: the one carrying its mark, or the generic one. */
    async function entryFor(site) {
        const entries = (await readManifest()).content_scripts.filter((entry) => entry.world !== 'MAIN');
        const mark = MARKS[site];
        return mark ? entries.find((entry) => entry.js.includes(mark)) : entries.find((entry) => entry.matches.includes('<all_urls>'));
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

    suite('manifest entries — each boots on its own', () => {
        for (const site of ['other', 'netflix', ...Object.keys(MARKS)]) {
            test(`a ${site} page`, async () => {
                if (location.protocol === 'file:') return; // reading ../manifest.json needs http
                const entry = await entryFor(site);
                assert(entry, `no entry loads ${MARKS[site]}`);
                const { booted, errors } = await boot(entry, site);
                assertDeepEqual(errors, [], 'errors while it loaded');
                assert(booted, 'main.js did not finish');
            });
        }
    });
})();
