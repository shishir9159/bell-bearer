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
     * True when the page we are drawing over is dark, for any site that does
     * not announce it the way YouTube does.
     *
     * X has three themes, not two — Default, Dim and Lights out — and names
     * none of them in an attribute we could read. What it does do is set
     * `color-scheme` on the root and paint the body, so this asks the two
     * questions in that order and falls back to the OS preference for a page
     * that has painted nothing yet.
     */
    function isPageDark() {
        const scheme = getComputedStyle(document.documentElement).colorScheme || '';
        if (/\bdark\b/.test(scheme) && !/\blight\b/.test(scheme)) return true;
        if (/\blight\b/.test(scheme) && !/\bdark\b/.test(scheme)) return false;

        const painted = document.body && getComputedStyle(document.body).backgroundColor;
        const rgb = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)/.exec(painted || '');
        // A transparent body is not a light one — it is a body that has not
        // been painted, so the question falls to the OS below.
        if (rgb && (rgb[4] === undefined || Number(rgb[4]) > 0)) {
            const luma = (0.2126 * +rgb[1] + 0.7152 * +rgb[2] + 0.0722 * +rgb[3]) / 255;
            return luma < 0.5;
        }

        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
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
        // YouTube is asked directly because it answers directly; everything
        // else is read off the paint. Checking YouTube's own marker first
        // matters on a YouTube page that has not laid out yet, where the body
        // is still unpainted and the generic test would fall through to the
        // OS preference and flash the wrong state for a frame.
        if (isYouTubeDark()) return 'dark';
        return isPageDark() ? 'dark' : 'light';
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

    const Theme = { pageTheme, isYouTubeDark, isPageDark, installYouTubeSync, appearance, dress };

    root.BB = root.BB || {};
    root.BB.Theme = Theme;
    if (typeof module !== 'undefined' && module.exports) module.exports = Theme;
})(typeof globalThis !== 'undefined' ? globalThis : this);
