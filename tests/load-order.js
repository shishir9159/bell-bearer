/**
 * Every list that loads the extension's classic scripts, and a check that
 * each file in a list comes after the files it takes off `BB` as it loads.
 *
 * There is no bundler, so load order is kept by hand in a dozen places (see
 * CLAUDE.md's table), and getting one wrong fails in that surface only, at
 * load, as "undefined is not an object". node-check.js used to pin a handful
 * of pairs; this reads what each file actually needs instead.
 *
 * A file "needs" a name when it captures it at the top of its IIFE, in one of
 * the three shapes the repo uses:
 *
 *     const { Settings, Dom } = root.BB;          (or window.BB, or BB)
 *     const Settings = ns.Settings || req('…');   (or BB.Settings || …)
 *     const Settings = root.BB && root.BB.Settings;   (bracketed, or globalThis)
 *
 * Only those at the IIFE's own indentation (four spaces) count. The same
 * shapes inside a function are read when the function runs, which is after
 * every list has finished loading — chess-stats reads BB.HeatMap that way, in
 * a popup that never loads the heat map because it never draws one.
 *
 * A file "provides" a name by assigning it: `root.BB.Settings = Settings`.
 *
 *     node tests/load-order.js     # print what is out of order, if anything
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Files whose load-time reads are checked: the extension's own, not the specs. */
const CHECKED = /^(src\/|popup\.js$|dashboard\.js$|transcript\.js$)/;

function needs(source) {
    const out = new Set();
    const add = (name) => { if (/^[A-Z]\w*$/.test(name)) out.add(name); };
    for (const m of source.matchAll(/^ {4}(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:root\.|window\.|globalThis\.)?BB\b/gm)) {
        m[1].split(',').map((one) => one.split(':')[0].trim()).forEach(add);
    }
    for (const m of source.matchAll(/^ {4}(?:const|let|var)\s+\w+\s*=\s*(?:ns|(?:root\.|window\.|globalThis\.)?BB)\.([A-Z]\w*)\s*\|\|/gm)) add(m[1]);
    // `(root.BB && root.BB.Sfx) || req(…)` too, but not `() => (root.BB && …)`:
    // an arrow reads when it is called.
    for (const m of source.matchAll(/^ {4}(?:const|let|var)\s+\w+\s*=\s*\(?\s*(?:root|window|globalThis)\.BB\s*&&\s*(?:root|window|globalThis)\.BB\.([A-Z]\w*)/gm)) add(m[1]);
    return out;
}

function provides(source) {
    return new Set([...source.matchAll(/(?:^|[^.\w])(?:root\.|window\.|globalThis\.)?BB\.([A-Z]\w*)\s*=(?!=)/gm)].map((m) => m[1]));
}

/**
 * What is out of order in `files`, as sentences. `sources` maps a file to its
 * text, for the self-test; the repo's own files are read otherwise.
 */
function lint(files, sources = null) {
    const text = (file) => (sources ? sources[file] : read(file));
    const checked = files.filter((file) => CHECKED.test(file) && (sources ? file in sources : fs.existsSync(path.join(ROOT, file))));
    const owner = new Map();
    for (const file of checked) for (const name of provides(text(file))) owner.set(name, file);

    const problems = [];
    const loaded = new Set();
    for (const file of checked) {
        const source = text(file);
        const own = provides(source);
        for (const name of needs(source)) {
            if (own.has(name) || loaded.has(name)) continue;
            problems.push(owner.has(name)
                ? `${file} takes ${name} as it loads, but ${owner.get(name)} is loaded after it`
                : `${file} takes ${name} as it loads, and nothing before it provides one`);
        }
        own.forEach((name) => loaded.add(name));
    }
    return problems;
}

const scriptsIn = (html, base = '') => [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => path.posix.normalize(base + m[1]));

/** Every list in CLAUDE.md's table, by a name that says where it is. */
function lists() {
    const out = {};
    const manifest = JSON.parse(read('manifest.json'));
    const firefox = JSON.parse(read('manifest.firefox.json'));
    // Both manifests' entries: node-check asserts they are the same today,
    // but a list read here is a list that cannot drift unnoticed.
    for (const [name, doc] of [['manifest.json', manifest], ['manifest.firefox.json', firefox]]) {
        doc.content_scripts.forEach((entry, i) => {
            out[`${name} content_scripts[${i}]${entry.world === 'MAIN' ? ' (MAIN)' : ''}`] = entry.js;
        });
    }
    out['manifest.firefox.json background.scripts'] = firefox.background.scripts;
    out['background.js importScripts'] = [.../importScripts\(([\s\S]*?)\);/.exec(read('background.js'))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    const popup = scriptsIn(read('popup.html'));
    const party = JSON.parse(`[${/PARTY_FILES = \[([^\]]+)\]/.exec(read('popup.js'))[1].replace(/'/g, '"')}]`);
    out['popup.html'] = popup;
    out['popup.html, then popup.js#PARTY_FILES'] = [...popup, ...party];
    out['dashboard.html'] = scriptsIn(read('dashboard.html'));
    out['offscreen.html'] = scriptsIn(read('offscreen.html'));
    // Firefox has no offscreen documents: the party's session is read into
    // the background page, after everything already there.
    out['firefox background, then offscreen.html'] = [...firefox.background.scripts, ...out['offscreen.html']];

    // The party lands in the isolated world a manifest entry already filled.
    const Loader = require('../src/background/party-loader.js');
    manifest.content_scripts.forEach((entry, i) => {
        if (entry.world === 'MAIN') return;
        out[`content_scripts[${i}], then PartyLoader.CONTENT_FILES`] = [...entry.js, ...Loader.CONTENT_FILES];
    });
    for (const [site, files] of Object.entries(Loader.PAGE_FILES)) out[`PartyLoader.PAGE_FILES.${site}`] = [...files];

    for (const page of fs.readdirSync(__dirname).filter((name) => name.endsWith('.html'))) {
        out[`tests/${page}`] = scriptsIn(read(`tests/${page}`), 'tests/');
    }
    return out;
}

/** Every problem in every list, each prefixed with the list it is in. */
function lintAll() {
    return Object.entries(lists()).flatMap(([name, files]) => lint(files).map((problem) => `${name}: ${problem}`));
}

module.exports = { needs, provides, lint, lists, lintAll };

if (require.main === module) {
    const problems = lintAll();
    console.log(problems.length ? problems.join('\n') : 'every list loads each file after what it takes off BB');
    process.exit(problems.length ? 1 : 0);
}
