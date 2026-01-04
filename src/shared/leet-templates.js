/**
 * Code templates: the snippets you paste at the top of a problem before you
 * start — a binary search that gets the boundaries right, a union-find, the
 * import block you always want.
 *
 * Nothing ships with the extension. The list starts empty and is written by
 * the user, most of it by selecting working code in LeetCode's editor and
 * saving that. A bundled library of somebody else's snippets would be the
 * wrong thing twice over: it would be in languages you do not use, and the
 * value of a template is that it is the version *you* trust.
 *
 * An array rather than a map, because the order is the display order — the
 * same arrangement the pouch topic lists use, where reordering is a splice
 * and nothing else is stored.
 *
 * A template may name a language or leave it blank. Blank means "any", and it
 * is not a fallback for a language with no templates of its own so much as a
 * category: a comment header or a test harness sketch is not Python or C++.
 * See forLang, which offers the exact language first and the language-free
 * ones after.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Ids = ns.Ids || req('./ids.js');

    const KEY = Settings.DATA.leetTemplates;

    /**
     * LeetCode's own language ids, and how to write each one.
     *
     * Keyed by LeetCode's spelling because that is what the user picks in the
     * editor's own dropdown; Monaco reports something slightly different for
     * some of them, which is what normalize() below is for.
     */
    const LANGS = Object.freeze({
        cpp: 'C++',
        java: 'Java',
        python3: 'Python3',
        c: 'C',
        csharp: 'C#',
        javascript: 'JavaScript',
        typescript: 'TypeScript',
        php: 'PHP',
        swift: 'Swift',
        kotlin: 'Kotlin',
        dart: 'Dart',
        golang: 'Go',
        ruby: 'Ruby',
        scala: 'Scala',
        rust: 'Rust',
        racket: 'Racket',
        erlang: 'Erlang',
        elixir: 'Elixir',
    });

    /**
     * What Monaco calls a language, mapped onto what LeetCode calls it.
     *
     * `python` is the one judgement call here. Monaco has a single Python
     * mode and reports it for both of LeetCode's Python entries, so a
     * template saved from a Python buffer has to be filed under one of them —
     * and it is filed under Python3, because LeetCode retired Python 2 and
     * every Python buffer on the site is now a Python3 one in practice.
     */
    const ALIASES = Object.freeze({
        python: 'python3',
        go: 'golang',
        'c++': 'cpp',
        'c#': 'csharp',
        js: 'javascript',
        ts: 'typescript',
        objectivec: 'c',
    });

    /** A language id we can file under, or '' for "any language". */
    function normalize(lang) {
        const key = String(lang || '').trim().toLowerCase();
        if (!key) return '';
        const mapped = ALIASES[key] || key;
        return LANGS[mapped] ? mapped : '';
    }

    /** How to write a language id, with '' reading as "any". */
    const labelFor = (lang) => LANGS[normalize(lang)] || 'Any language';

    /** Every language, in the order the editor's dropdown roughly uses. */
    const list = () => Object.keys(LANGS).map((id) => ({ id, label: LANGS[id] }));

    let writeChain = Promise.resolve();

    const newId = () => Ids.next('lt');

    const asArray = (value) => (Array.isArray(value) ? value : []);
    const text = (value) => String(value == null ? '' : value).trim();
    const count = (value) => Math.max(0, Math.round(Number(value)) || 0);

    /** How long a template may be. A whole solution is not a template. */
    const BODY_CAP = 8000;
    const NAME_CAP = 60;

    function clean(record) {
        const template = record && typeof record === 'object' ? record : {};
        return {
            id: text(template.id) || newId(),
            name: text(template.name).slice(0, NAME_CAP),
            lang: normalize(template.lang),
            // Not trimmed: a template's leading indentation is part of it.
            body: String(template.body == null ? '' : template.body).slice(0, BODY_CAP),
            createdAt: count(template.createdAt),
            usedAt: count(template.usedAt),
            uses: count(template.uses),
        };
    }

    /** Everything stored, cleaned, in display order. */
    const templatesOf = (state) => asArray(state).map(clean).filter((t) => t.name);

    async function load() {
        try {
            const stored = await chrome.storage.local.get([KEY]);
            return templatesOf(stored[KEY]);
        } catch (_) {
            // The extension reloading invalidates every content script's
            // context; an empty list draws, a rejection takes the panel down.
            return [];
        }
    }

    /** Read-modify-write as one atomic step, so two edits cannot clobber. */
    async function update(mutate) {
        const run = async () => {
            const state = await load();
            const next = templatesOf((await mutate(state)) || state);
            await chrome.storage.local.set({ [KEY]: next });
            return next;
        };
        writeChain = writeChain.then(run, run).catch((error) => {
            console.error('Bell Bearer: could not update the LeetCode templates', error);
            return [];
        });
        return writeChain;
    }

    async function create({ name, lang, body }) {
        const trimmed = text(name);
        if (!trimmed) return null;
        const id = newId();
        await update((state) => [...state, clean({ id, name: trimmed, lang, body, createdAt: Date.now() })]);
        return id;
    }

    async function remove(id) {
        await update((state) => state.filter((template) => template.id !== id));
    }

    /**
     * Change a template in place. Only the fields passed are touched, so
     * saving an edited body cannot blank the name it was saved under.
     */
    async function edit(id, changes) {
        await update((state) => state.map((template) => {
            if (template.id !== id) return template;
            const next = { ...template };
            if (changes.name !== undefined) next.name = text(changes.name).slice(0, NAME_CAP);
            if (changes.lang !== undefined) next.lang = normalize(changes.lang);
            if (changes.body !== undefined) next.body = String(changes.body).slice(0, BODY_CAP);
            return next;
        }));
    }

    /** Move `id` to where `beforeId` sits. Array order is display order. */
    async function move(id, beforeId) {
        if (!id || id === beforeId) return;
        await update((state) => {
            const out = state.slice();
            const from = out.findIndex((t) => t.id === id);
            const to = out.findIndex((t) => t.id === beforeId);
            if (from < 0 || to < 0) return state;
            out.splice(to, 0, out.splice(from, 1)[0]);
            return out;
        });
    }

    /** Note that a template was used, so the suggester can lead with it. */
    async function touch(id) {
        await update((state) => state.map((template) => (template.id === id
            ? { ...template, usedAt: Date.now(), uses: template.uses + 1 }
            : template)));
    }

    /**
     * The templates worth offering for `lang`: that language's own first, then
     * the ones filed under no language at all.
     *
     * Within each group, most recently used first and never-used last — the
     * suggester is a list you scroll with the keyboard, and the one you
     * reached for yesterday is overwhelmingly the one you want today. Display
     * order is kept as the tie-break so a list nobody has used yet comes back
     * in the order it was arranged in.
     */
    function forLang(state, lang) {
        const wanted = normalize(lang);
        const all = templatesOf(state);
        const rank = (a, b) => (b.usedAt - a.usedAt) || (all.indexOf(a) - all.indexOf(b));

        const mine = all.filter((t) => t.lang && t.lang === wanted).sort(rank);
        const any = all.filter((t) => !t.lang).sort(rank);
        // With no language to go on — the page world could not tell us — the
        // whole list is the answer rather than only the language-free ones.
        if (!wanted) return all.slice().sort(rank);
        return [...mine, ...any];
    }

    /**
     * forLang, narrowed by what has been typed into the suggester. Matches on
     * the name and on the body, because "the one with the while loop that
     * ends on left < right" is how people actually find these.
     */
    function search(state, lang, query) {
        const needle = text(query).toLowerCase();
        const rows = forLang(state, lang);
        if (!needle) return rows;
        return rows.filter((template) =>
            template.name.toLowerCase().includes(needle) ||
            template.body.toLowerCase().includes(needle));
    }

    const LeetTemplates = {
        KEY, KEYS: [KEY], LANGS, ALIASES, BODY_CAP, NAME_CAP,
        normalize, labelFor, list, templatesOf, clean, newId,
        load, update, create, edit, remove, move, touch, forLang, search,
    };

    root.BB = root.BB || {};
    root.BB.LeetTemplates = LeetTemplates;
    if (typeof module !== 'undefined' && module.exports) module.exports = LeetTemplates;
})(typeof globalThis !== 'undefined' ? globalThis : this);
