/**
 * Light or dark for the on-page UI, and the optional "match YouTube's theme"
 * sync.
 *
 * This file used to carry two hard-coded colour tables that each overlay read
 * and pasted into inline styles. The palette lives in content.css now, keyed
 * off `data-bb-theme` and `data-bb-skin`, so all that is left to decide is
 * which of the two states to ask for.
 *
 * The two directions here are easy to confuse, so: the injected UI reads
 * light/dark *from* the page (pageTheme), while installYouTubeSync writes it
 * the other way, mirroring YouTube's setting *into* our saved theme so the
 * popup and dashboard can follow it. Only the second is a user setting; a
 * sheet drawn over YouTube always matches YouTube, so it never glares against
 * the page underneath.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('../shared/settings.js');

    /** True when YouTube itself is in dark mode. */
    function isYouTubeDark() {
        if (document.documentElement.hasAttribute('dark')) return true;
        const base = getComputedStyle(document.documentElement)
            .getPropertyValue('--yt-spec-base-background').trim();
        return base === '#0f0f0f';
    }

    /**
     * 'dark' or 'light' for anything drawn on top of the page.
     *
     * Deliberately not the extension's own saved theme. The skin decides the
     * palette and the type; this decides only which of the skin's two states
     * to use, and it takes that from the site underneath so a sheet over a
     * dark YouTube is never a white slab. The saved theme belongs to the popup
     * and the dashboard, which are documents of our own.
     */
    function pageTheme() {
        return isYouTubeDark() ? 'dark' : 'light';
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

    /**
     * What to dress the next surface in: the skin the user picked, and the
     * light/dark of the page it will sit on. Only the skin is a setting —
     * see pageTheme above for why the theme is not.
     */
    async function appearance() {
        const { skin } = await Settings.get(['skin']);
        return { theme: pageTheme(), skin: skin || 'default' };
    }

    /**
     * Dress an overlay in that. Every injected surface goes through here, so
     * the two attributes are always set together and cannot drift apart.
     */
    function dress(element, { theme, skin }) {
        element.classList.add('bb-themed');
        element.dataset.bbTheme = theme;
        element.dataset.bbSkin = skin;
    }

    const Theme = { pageTheme, isYouTubeDark, installYouTubeSync, appearance, dress };

    root.BB = root.BB || {};
    root.BB.Theme = Theme;
    if (typeof module !== 'undefined' && module.exports) module.exports = Theme;
})(typeof globalThis !== 'undefined' ? globalThis : this);
