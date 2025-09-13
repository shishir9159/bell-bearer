/**
 * Theme resolution for the on-page UI, and the optional "match YouTube's theme"
 * sync.
 *
 * The palette used to be re-derived inline in each of the three overlays, with
 * slightly different colours and a different dark-mode test in each. One
 * resolver now serves all of them.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('../shared/settings.js');

    const PALETTES = {
        light: {
            panel: '#ffffff', surface: '#ffffff', text: '#14171d', sub: '#59626f',
            border: '#e6e8ef', chip: '#f6f7fb', card: '#f6f7fb', inputBg: '#ffffff',
            cancelBg: '#f0f0f0', accent: '#e11d48', accentHover: '#c40f3f', onAccent: '#ffffff',
        },
        dark: {
            panel: '#2f3136', surface: '#212121', text: '#e3e5e8', sub: '#b5bac1',
            border: '#26282c', chip: '#36393f', card: '#36393f', inputBg: '#121212',
            cancelBg: '#2b2b2b', accent: '#7289da', accentHover: '#5b6eae', onAccent: '#ffffff',
        },
    };

    /** True when YouTube itself is in dark mode. */
    function isYouTubeDark() {
        if (document.documentElement.hasAttribute('dark')) return true;
        const base = getComputedStyle(document.documentElement)
            .getPropertyValue('--yt-spec-base-background').trim();
        return base === '#0f0f0f';
    }

    /**
     * The palette to draw with: the saved Bell Bearer theme when there is one,
     * otherwise whatever YouTube is currently showing.
     */
    function palette(savedTheme) {
        const dark = savedTheme ? savedTheme === 'dark' : isYouTubeDark();
        return { ...PALETTES[dark ? 'dark' : 'light'], dark };
    }

    async function currentPalette() {
        const { theme } = await Settings.get(['theme', 'syncThemeWithYouTube']);
        return palette(theme);
    }

    /**
     * Mirror YouTube's light/dark mode into the saved theme so the popup and
     * dashboard follow it. Returns a teardown function.
     */
    function installYouTubeSync(isEnabled) {
        const apply = () => {
            if (!isEnabled()) return;
            const theme = isYouTubeDark() ? 'dark' : 'light';
            Settings.get(['theme']).then((current) => {
                if (current.theme !== theme) Settings.set({ theme });
            });
        };

        // YouTube toggles the `dark` attribute on <html> when its theme changes,
        // so a single attribute filter is enough — no subtree observation.
        const observer = new MutationObserver(apply);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
        apply();

        return { apply, stop: () => observer.disconnect() };
    }

    const Theme = { PALETTES, palette, currentPalette, isYouTubeDark, installYouTubeSync };

    root.BB = root.BB || {};
    root.BB.Theme = Theme;
    if (typeof module !== 'undefined' && module.exports) module.exports = Theme;
})(typeof globalThis !== 'undefined' ? globalThis : this);
