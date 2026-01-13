/**
 * The extension as a store upload: a zip of what runs, and nothing else.
 *
 * There is no build step, and this does not add one — the folder is what runs
 * while you work on it, loaded unpacked. But that folder also holds the specs,
 * a dev party server, design files and notes, which nobody installing from a
 * store has any use for. This zips the runtime alone: the manifest, the three
 * pages and their scripts, src/, the styles, fonts, icons and textures. Then
 * it checks that everything the manifest and the pages name made it in, so a
 * file outside those places fails here rather than in a user's browser.
 *
 *   node tools/pack.js            dist/bell-bearer-<version>.zip
 *   node tools/pack.js --firefox  dist/bell-bearer-<version>-firefox.zip, with
 *                                 manifest.firefox.json as its manifest.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Zip = require('../src/shared/zip.js');

const ROOT = path.join(__dirname, '..');
const PAGES = ['popup.html', 'dashboard.html', 'offscreen.html'];
const ROOT_FILES = ['background.js', 'popup.js', 'dashboard.js', 'LICENSE', ...PAGES];
const DIRS = ['src', 'fonts', 'icons', 'textures'];
/** The kinds of file the extension is made of: what .gitignore lets in. */
const SHIPPED = /\.(js|css|html|json|png|svg|woff2)$/;

const read = (file) => fs.readFileSync(path.join(ROOT, file));

function walk(dir) {
    return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const file = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return walk(file);
        return SHIPPED.test(entry.name) ? [file] : [];
    });
}

/** What goes in, by its path in the package, mapped to its path here. */
function files({ firefox = false } = {}) {
    const out = new Map([['manifest.json', firefox ? 'manifest.firefox.json' : 'manifest.json']]);
    const rootCss = fs.readdirSync(ROOT).filter((name) => name.endsWith('.css'));
    for (const file of [...ROOT_FILES, ...rootCss, ...DIRS.flatMap(walk)]) out.set(file, file);
    // icons/ also keeps the art the icons were cut from, six megabytes of it:
    // an icon goes in only when something packed names it.
    const text = [...out.values()].filter((file) => /\.(js|css|html|json)$/.test(file)).map((file) => read(file).toString('utf8')).join('\n');
    for (const [name] of out) {
        if (name.startsWith('icons/') && !text.includes(path.basename(name))) out.delete(name);
    }
    return out;
}

/**
 * Every file the manifest names and every script and stylesheet the pages
 * load, by path. Globs in web_accessible_resources are left out: they name
 * a kind of file, and the folders they point into are packed whole.
 */
function named(manifest) {
    const out = new Set();
    for (const entry of manifest.content_scripts || []) [...(entry.js || []), ...(entry.css || [])].forEach((file) => out.add(file));
    const background = manifest.background || {};
    [background.service_worker, background.page, ...(background.scripts || [])].filter(Boolean).forEach((file) => out.add(file));
    Object.values(manifest.icons || {}).forEach((file) => out.add(file));
    if (manifest.action && manifest.action.default_popup) out.add(manifest.action.default_popup);
    for (const page of PAGES) {
        const html = read(page).toString('utf8');
        for (const [, file] of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"#?:]+)"/g)) out.add(file);
    }
    return out;
}

/** What the manifest and the pages name that the package would not have. */
function missing({ firefox = false } = {}) {
    const packed = files({ firefox });
    const manifest = JSON.parse(read(packed.get('manifest.json')).toString('utf8'));
    return [...named(manifest)].filter((file) => !packed.has(file));
}

function pack({ firefox = false } = {}) {
    const absent = missing({ firefox });
    if (absent.length) throw new Error(`named but not packed: ${absent.join(', ')}`);
    const packed = files({ firefox });
    const { version } = JSON.parse(read(packed.get('manifest.json')).toString('utf8'));
    const entries = [...packed].map(([name, from]) => ({ name, data: read(from), at: fs.statSync(path.join(ROOT, from)).mtimeMs }));
    const out = path.join(ROOT, 'dist', `bell-bearer-${version}${firefox ? '-firefox' : ''}.zip`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Zip.build(entries));
    return { out, count: entries.length, bytes: fs.statSync(out).size };
}

module.exports = { files, named, missing, pack };

if (require.main === module) {
    try {
        const { out, count, bytes } = pack({ firefox: process.argv.includes('--firefox') });
        console.log(`${path.relative(ROOT, out)}: ${count} files, ${Math.round(bytes / 1024)} KB`);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
