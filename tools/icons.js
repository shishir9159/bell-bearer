/**
 * The icon set's tree shaker: src/shared/icons.js carries a Phosphor glyph
 * (phosphoricons.com, MIT) for every name the extension asks for, and none
 * that nothing asks for.
 *
 * There is no bundler here to shake an npm package down to what is used, so
 * this does it by reading the source. A name is used where it is written as
 * a string literal, `Icons.svg('name'` in a script or `data-icon="name"` in
 * a page — a name put together at run time is invisible to it, which is why
 * the code never builds one. Weights go on the end the way Phosphor's own
 * files are named: `push-pin-fill`, `x-bold`.
 *
 *   node tools/icons.js           rewrite the table in src/shared/icons.js:
 *                                 fetch each name that is new, drop each one
 *                                 nothing names any more, keep the rest as is
 *   node tools/icons.js --check   only report what is missing or unused, with
 *                                 no network; exits 1 if anything is
 *
 * tools/pack.js shakes its packed copy of the module the same way, so a zip
 * never carries a glyph nothing in it names even before this is re-run.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULE = 'src/shared/icons.js';
const PACKAGE = '@phosphor-icons/core@2.1.1';
const START = /^ *\/\/ icons:start.*$/m;
const END = /^ *\/\/ icons:end$/m;
const WEIGHT = /-(thin|light|bold|fill|duotone)$/;

const USES = [/\bIcons\.svg\(\s*['"]([a-z0-9-]+)['"]/g, /\bdata-icon="([a-z0-9-]+)"/g];

function namesIn(text) {
    return new Set(USES.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[1])));
}

/** What the runtime is made of, as pack.js packs it: package path → path here. */
function shipped() {
    return require('./pack.js').files();
}

/** Every name the scripts and pages in `files` use, the module itself aside. */
function used(files = shipped()) {
    const out = new Set();
    for (const [name, from] of files) {
        if (name === MODULE || !/\.(js|html)$/.test(name)) continue;
        namesIn(fs.readFileSync(path.join(ROOT, from), 'utf8')).forEach((icon) => out.add(icon));
    }
    return out;
}

/** The module split around its table, and the table as name → inner markup. */
function parse(source) {
    const start = START.exec(source);
    const end = END.exec(source);
    if (!start || !end || end.index < start.index) throw new Error(`${MODULE} has lost its icons:start / icons:end lines`);
    const head = source.slice(0, start.index + start[0].length);
    const table = source.slice(head.length, end.index);
    const glyphs = new Map([...table.matchAll(/^ {8}'([a-z0-9-]+)': '(.*)',$/gm)].map((m) => [m[1], m[2]]));
    return { head, glyphs, tail: source.slice(end.index) };
}

function render({ head, glyphs, tail }) {
    const rows = [...glyphs].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, body]) => `        '${name}': '${body}',`);
    return `${head}\n    const ICONS = {\n${rows.map((row) => `${row}\n`).join('')}    };\n${tail}`;
}

/** The module with only the glyphs in `names` left in its table. */
function shake(source, names) {
    const parts = parse(source);
    return render({ ...parts, glyphs: new Map([...parts.glyphs].filter(([name]) => names.has(name))) });
}

/** What the code names that the table lacks, and what it holds that nothing names. */
function audit(files = shipped()) {
    const names = used(files);
    const { glyphs } = parse(fs.readFileSync(path.join(ROOT, MODULE), 'utf8'));
    return {
        used: names,
        missing: [...names].filter((name) => !glyphs.has(name)).sort(),
        unused: [...glyphs.keys()].filter((name) => !names.has(name)).sort(),
    };
}

/** A glyph's inner markup, as the package draws it, ready to sit in a quoted string. */
async function fetchGlyph(name) {
    const weight = (WEIGHT.exec(name) || [, 'regular'])[1];
    const url = `https://cdn.jsdelivr.net/npm/${PACKAGE}/assets/${weight}/${name}.svg`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: no such Phosphor icon (${response.status} from ${url})`);
    const svg = (await response.text()).trim();
    const body = /^<svg\b[^>]*>([\s\S]*)<\/svg>$/.exec(svg);
    if (!body) throw new Error(`${name}: ${url} is not the svg it should be`);
    return body[1].replace(/\s*\n\s*/g, '').replace(/'/g, '&#39;');
}

async function update() {
    const file = path.join(ROOT, MODULE);
    const parts = parse(fs.readFileSync(file, 'utf8'));
    const names = used();
    const glyphs = new Map();
    for (const name of [...names].sort()) glyphs.set(name, parts.glyphs.get(name) || await fetchGlyph(name));
    fs.writeFileSync(file, render({ ...parts, glyphs }));
    const added = [...names].filter((name) => !parts.glyphs.has(name));
    const dropped = [...parts.glyphs.keys()].filter((name) => !names.has(name));
    return { count: glyphs.size, added, dropped };
}

module.exports = { MODULE, PACKAGE, namesIn, used, parse, shake, audit };

if (require.main === module) {
    if (process.argv.includes('--check')) {
        const { missing, unused } = audit();
        if (missing.length) console.log(`named but not in ${MODULE}: ${missing.join(', ')}`);
        if (unused.length) console.log(`in ${MODULE} but named nowhere: ${unused.join(', ')}`);
        if (missing.length || unused.length) {
            console.log('run `node tools/icons.js` to bring the table in line');
            process.exit(1);
        }
        console.log(`${MODULE} holds exactly the icons the code names`);
    } else {
        update().then(({ count, added, dropped }) => {
            console.log(`${MODULE}: ${count} icons${added.length ? `, added ${added.join(', ')}` : ''}${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
        }).catch((error) => {
            console.error(error.message);
            process.exit(1);
        });
    }
}
