/**
 * How wide the toolbar popup asks to be.
 *
 * A browser action popup has no resizable viewport: Chrome and Firefox both
 * size the window to the document and cap it at 800x600. So "wide or compact"
 * is a question the document answers by asking for a different width, and the
 * media queries already in popup.css do the rest — neither layout needs any
 * script of its own beyond this.
 *
 * It runs from <head>, ahead of the popup's own scripts, because the answer
 * lives in storage and storage is asynchronous: the earlier the read starts,
 * the smaller the window in which the popup is painted at one width and then
 * resized to the other. That window cannot be closed altogether — extension
 * pages may not run inline scripts, and there is no synchronous storage to
 * read instead — so the default is the one most people keep.
 */
(function (root) {
    'use strict';

    const KEY = 'popupWidth';
    const DEFAULT = 'wide';
    const WIDTHS = ['wide', 'compact'];

    const isKnown = (value) => WIDTHS.indexOf(value) !== -1;

    /** Paint the width. `documentElement` exists by the time a head script runs. */
    function apply(value) {
        const width = isKnown(value) ? value : DEFAULT;
        document.documentElement.setAttribute('data-bb-width', width);
        return width;
    }

    function read() {
        const Settings = root.BB && root.BB.Settings;
        if (Settings && Settings.get) return Settings.get([KEY]).then((values) => values[KEY]);
        return new Promise((done) => {
            try {
                chrome.storage.local.get([KEY], (out) => done(out && out[KEY]));
            } catch (_) {
                done(DEFAULT);
            }
        });
    }

    /**
     * Paint the stored width, then follow it. The dashboard is a different
     * document, so without the watch a popup left open across a settings
     * change would keep the width it opened at.
     */
    async function install() {
        apply(await read());

        const Settings = root.BB && root.BB.Settings;
        if (Settings && Settings.watch) Settings.watch([KEY], (changed) => apply(changed[KEY]));
    }

    const PopupWidth = { KEY, DEFAULT, WIDTHS, apply, read, install };

    root.BB = root.BB || {};
    root.BB.PopupWidth = PopupWidth;
    if (typeof module !== 'undefined' && module.exports) module.exports = PopupWidth;

    if (typeof document !== 'undefined') install();
})(typeof globalThis !== 'undefined' ? globalThis : this);
