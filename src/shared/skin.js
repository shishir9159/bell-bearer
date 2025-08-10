/**
 * Skin selection, shared by the popup and the dashboard.
 *
 * A skin is a costume over the same token contract: skins.css defines
 * `body[data-skin="…"]` for the palette and `body[data-skin="…"].dark-theme`
 * for its night state. Day/night stays where it was — Ui.installTheme owns
 * the `dark-theme` class — so a skin never has to know which one is on.
 */
(function () {
    'use strict';

    const BB = (window.BB = window.BB || {});

    const KEY = 'skin';
    const DEFAULT = 'default';

    const SKINS = [
        { id: 'default', label: 'Default', note: 'The house red, sampled from the icon' },
        { id: 'riso', label: 'Riso Paint', note: 'Three spot inks on newsprint' },
        { id: 'medieval', label: 'Medieval', note: 'Parchment, iron-gall ink, rubricated red' },
        { id: 'deco', label: 'Art Deco', note: 'Ivory and gilt, everything letter-spaced' },
    ];

    const isKnown = (id) => SKINS.some((skin) => skin.id === id);

    function apply(id) {
        const skin = isKnown(id) ? id : DEFAULT;
        const set = () => { document.body.dataset.skin = skin; };
        if (document.body) set();
        else document.addEventListener('DOMContentLoaded', set, { once: true });
        return skin;
    }

    async function read() {
        if (BB.Settings && BB.Settings.get) {
            const settings = await BB.Settings.get([KEY]);
            return settings && settings[KEY];
        }
        return new Promise((resolve) => {
            chrome.storage.local.get([KEY], (out) => resolve(out && out[KEY]));
        });
    }

    async function write(id) {
        const skin = isKnown(id) ? id : DEFAULT;
        if (BB.Settings && BB.Settings.set) await BB.Settings.set({ [KEY]: skin });
        else await chrome.storage.local.set({ [KEY]: skin });
        return skin;
    }

    /**
     * Paint the stored skin, then keep painting it when another surface
     * changes it — the popup and an open dashboard tab are separate
     * documents and would otherwise disagree until reload.
     */
    async function install() {
        apply(await read());

        if (BB.Settings && BB.Settings.watch) {
            BB.Settings.watch([KEY], (changes) => {
                const next = changes && changes[KEY];
                apply(next && next.newValue !== undefined ? next.newValue : next);
            });
        } else if (chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes) => {
                if (changes[KEY]) apply(changes[KEY].newValue);
            });
        }
    }

    async function select(id) {
        const skin = await write(id);
        apply(skin);
        return skin;
    }

    BB.Skin = { KEY, DEFAULT, SKINS, apply, read, select, install };
})();
