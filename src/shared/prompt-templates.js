/**
 * Prompt templates: the prompts you would otherwise retype — a review, a
 * debugging brief, "summarise this so I can start a new chat".
 *
 * The shape and the CRUD are src/shared/leet-templates.js's, with the
 * language swapped for the sites a template is offered on (`sites: []` is
 * every chat site). An array, because the order is the display order.
 *
 * Unlike the LeetCode templates, a starting set ships — and that is the
 * opposite of leet-templates.js's "nothing ships" for a reason: a code
 * template is only worth having if it is the version *you* trust, in a
 * language you use, whereas a prose prompt has no language and a good one is
 * useful on the first day. The starters are seeded only when the key is
 * *absent*, never when it is merely empty: someone who deleted all ten does
 * not want them back on the next load. Their ids are fixed so "Restore the
 * starters" can put back the missing ones without doubling the rest.
 *
 * A body may hold `{{name}}` fields, filled in when it is used. `{{selection}}`
 * is built in: whatever was selected on the page when the picker opened,
 * which is how you ask about half of an earlier answer.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const Ids = ns.Ids || req('./ids.js');
    const ChatSites = ns.ChatSites || req('./chat-sites.js');
    const Store = ns.Store || req('./store.js');

    const KEY = Settings.DATA.promptTemplates;
    const NAME_CAP = 60;
    const BODY_CAP = 8000;
    const SELECTION = 'selection';
    const FIELD = /\{\{\s*([a-z][a-z0-9_ -]*?)\s*\}\}/gi;

    const STARTERS = Object.freeze([
        ['code-review', 'Code review', 'Review the code below. List the bugs first, most serious first — for each, the line it is on and an input that makes it fail. Then the risks: what is likely to break under load, on bad input, or after the next change. Then whatever makes it hard to change. Do not rewrite it unless I ask; quote only the lines you are talking about.\n\n{{code}}'],
        ['debug', 'Debug an error', 'I am getting this error:\n\n{{error}}\n\nfrom this code:\n\n{{code}}\n\nTell me the most likely cause first, and one quick check that would confirm it before I change anything. Then the fix. If you are missing something you would need to be sure — a version, the input, the rest of the stack trace — ask me for it rather than guessing.'],
        ['summarise', 'Summarise this chat', 'Summarise this conversation so far so that I can reread it in a minute: the decisions we made and why, what we tried that did not work, the questions still open, and where things stand now, with the exact names, values, commands and file paths. Leave out anything we went back on.'],
        ['hand-off', 'Hand off to a new chat', 'Write a brief I can paste into a brand-new conversation to carry this work on without this one. It has to stand on its own: the goal, the constraints, the decisions made and why, what has been ruled out, the exact current state — names, versions, the code that matters — and the next step. Never write "as above" or point back to this chat; the new one will not have it.'],
        ['teach', 'Teach me step by step', 'Teach me {{topic}}. Start by asking what I already know. Then go one idea at a time, in plain words, each with a small example, and end each with one question that checks I followed it. Wait for my answer before you go on, and tell me plainly when I have it wrong.'],
        ['rewrite', 'Rewrite for clarity', 'Rewrite this to be clearer and shorter, in the same voice and making the same claims. Add nothing, and neither soften nor strengthen what it says:\n\n{{text}}\n\nGive me the rewrite, then one line on anything you had to guess at.'],
        ['compare', 'Compare options', 'I have to choose between {{options}} for {{goal}}. Compare them in a table on the criteria that matter for this goal — not every criterion there is. Then pick one, and name the one condition that would change your pick.'],
        ['tests', 'Write tests', 'Write tests for this code in {{framework}}:\n\n{{code}}\n\nCover the normal path, the edge cases and the ways it should fail — one behaviour per test, each named for that behaviour. Afterwards, tell me what makes this code hard to test, if anything does.'],
        ['pre-mortem', 'Pre-mortem', 'Imagine it is six months from now and this plan has failed:\n\n{{plan}}\n\nList the likeliest reasons, most likely first. For each, give the earliest warning sign I could watch for and a cheap way to prevent it now.'],
        ['actions', 'Extract action items', 'Pull the action items out of this:\n\n{{text}}\n\nAs a checklist of what, who and by when — only as stated; do not invent owners or dates. Then list anything that needs a decision before it can become an action.'],
    ].map(([slug, name, body]) => Object.freeze({ id: `pt_starter_${slug}`, name, body })));

    const newId = () => Ids.next('pt');

    const text = (value) => String(value == null ? '' : value).trim();
    const count = (value) => Math.max(0, Math.round(Number(value)) || 0);

    function clean(record) {
        const template = record && typeof record === 'object' ? record : {};
        return {
            id: text(template.id) || newId(),
            name: text(template.name).slice(0, NAME_CAP),
            // Not trimmed at the end: a blank line before a field is part of it.
            body: String(template.body == null ? '' : template.body).replace(/^\s+/, '').slice(0, BODY_CAP),
            sites: (Array.isArray(template.sites) ? template.sites : []).filter((site) => ChatSites.get(site)),
            createdAt: count(template.createdAt),
            usedAt: count(template.usedAt),
            uses: count(template.uses),
        };
    }

    const templatesOf = (state) => (Array.isArray(state) ? state : []).map(clean).filter((t) => t.name && t.body);

    const starters = (now = Date.now()) => STARTERS.map((starter) => clean({ ...starter, createdAt: now }));

    const { load, update } = Store.create({
        keys: [KEY],
        read: async (stored) => {
            if (stored[KEY] !== undefined) return templatesOf(stored[KEY]);
            // The first read writes the starters, so the ids they were given
            // are the ids an edit to one of them finds.
            const seeded = starters();
            await chrome.storage.local.set({ [KEY]: seeded });
            return seeded;
        },
        clean: templatesOf,
        blank: () => [],
        name: 'the prompt templates',
    });

    async function create({ name, body, sites = [] }) {
        if (!text(name) || !text(body)) return null;
        const id = newId();
        await update((state) => [...state, clean({ id, name, body, sites, createdAt: Date.now() })]);
        return id;
    }

    /** Only the fields passed are touched. */
    function edit(id, changes) {
        return update((state) => state.map((template) => (template.id === id ? clean({ ...template, ...changes, id }) : template)));
    }

    const remove = (id) => update((state) => state.filter((template) => template.id !== id));

    /** Move `id` to where `beforeId` sits; to the end when `beforeId` is not given. */
    function move(id, beforeId) {
        return update((state) => {
            const out = state.slice();
            const from = out.findIndex((t) => t.id === id);
            if (from < 0 || id === beforeId) return state;
            const [moving] = out.splice(from, 1);
            const to = beforeId ? out.findIndex((t) => t.id === beforeId) : out.length;
            out.splice(to < 0 ? out.length : to, 0, moving);
            return out;
        });
    }

    const touch = (id) => update((state) => state.map((template) => (template.id === id
        ? { ...template, usedAt: Date.now(), uses: template.uses + 1 } : template)));

    /** Put back any starter that is missing, at the end, and nothing else. */
    const restoreStarters = () => update((state) => {
        const have = new Set(state.map((t) => t.id));
        return [...state, ...starters().filter((starter) => !have.has(starter.id))];
    });

    /** The `{{fields}}` a body asks for, in order, once each — `selection` aside, which is not asked. */
    function fields(body) {
        const out = [];
        for (const match of String(body || '').matchAll(FIELD)) {
            const name = match[1].trim().toLowerCase();
            if (name !== SELECTION && !out.includes(name)) out.push(name);
        }
        return out;
    }

    /** The body with every field filled; a field with no value is left empty. */
    const fill = (body, values = {}) => String(body || '').replace(FIELD, (_, name) => {
        const value = values[name.trim().toLowerCase()];
        return value == null ? '' : String(value);
    });

    /**
     * The templates offered on `site`, most recently used first and never
     * used last, display order breaking ties — the order the picker lists.
     */
    function forSite(state, site) {
        const all = templatesOf(state);
        return all.filter((t) => !t.sites.length || t.sites.includes(site))
            .sort((a, b) => (b.usedAt - a.usedAt) || (all.indexOf(a) - all.indexOf(b)));
    }

    /** forSite, narrowed by what was typed, on the name and the body. */
    function search(state, site, query) {
        const needle = text(query).toLowerCase();
        const rows = forSite(state, site);
        if (!needle) return rows;
        return rows.filter((t) => t.name.toLowerCase().includes(needle) || t.body.toLowerCase().includes(needle));
    }

    const PromptTemplates = {
        KEY, KEYS: [KEY], STARTERS, NAME_CAP, BODY_CAP, SELECTION,
        clean, templatesOf, starters, load, update, create, edit, remove, move, touch, restoreStarters,
        fields, fill, forSite, search, newId,
    };

    root.BB = root.BB || {};
    root.BB.PromptTemplates = PromptTemplates;
    if (typeof module !== 'undefined' && module.exports) module.exports = PromptTemplates;
})(typeof globalThis !== 'undefined' ? globalThis : this);
