/**
 * HTML-building helpers.
 *
 * Everything the extension renders is built with template strings, and a lot of
 * it is data the user does not control: channel names and video titles scraped
 * from a page, titles and thumbnail URLs from an RSS feed. escapeHtml() covers
 * text nodes; attributes and hrefs need their own escaping, which is what the
 * other two are for.
 */
(function (root) {
    'use strict';

    const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

    /** Escape text for interpolation into element content. */
    function escapeHtml(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
    }

    /**
     * Escape text for interpolation into a double-quoted attribute value.
     * Same rules as escapeHtml, named separately so call sites read correctly.
     */
    const escapeAttr = escapeHtml;

    /**
     * Return `url` only if it is safe to put in an href/src, otherwise "#".
     * Channel URLs are typed by hand in the dashboard, so a `javascript:` URL
     * would otherwise become a one-click self-XSS.
     */
    function safeUrl(url) {
        if (!url) return '#';
        try {
            const parsed = new URL(String(url), 'https://www.youtube.com');
            return /^https?:$/.test(parsed.protocol) ? parsed.href : '#';
        } catch (_) {
            return '#';
        }
    }

    /** safeUrl() plus attribute escaping — the form needed inside a template. */
    function safeUrlAttr(url) {
        return escapeAttr(safeUrl(url));
    }

    /**
     * Stop a press on a button inside `root` from moving the focus.
     *
     * A mousedown's default action is to focus what was pressed. On a page we
     * own that is harmless; over someone else's page it is not. The focus
     * leaves whatever had it — the query box of a sheet drawn over the page,
     * or the page's own field halfway through a sentence — and the host reacts
     * to losing it: YouTube re-arms its single-key shortcuts, a cookie banner
     * closes, chess.com drops its menu. The button is then working against the
     * page it was added to.
     *
     * Cancelling the default leaves the focus where it was and costs nothing:
     * click is a separate event and is not what moves it, so the handler that
     * does the work still runs, and keyboard activation is untouched.
     *
     * One delegated listener per container rather than one per button, so a
     * panel that redraws its own contents has nothing to re-wire. `root` may
     * be the button itself — closest() matches the element it starts from.
     */
    function holdFocus(root, selector = 'button') {
        if (!root || !root.addEventListener) return root;
        root.addEventListener('mousedown', (event) => {
            // Right and middle presses do not focus anything; leave the
            // context menu and the middle-click paste alone.
            if (event.button !== 0) return;
            const target = event.target.closest && event.target.closest(selector);
            if (target) event.preventDefault();
        });
        return root;
    }

    /**
     * Offer `data` — a string, or bytes — as a file to save.
     *
     * The one implementation of the anchor-clicking this takes: the extension
     * pages' Ui.downloadText calls it, and the chat exports call it from
     * inside a site's own page, where page/ui.js is not loaded. A string is
     * saved as UTF-8; bytes (a zip) as they are, with no charset claimed.
     */
    function download(filename, data, type = 'text/plain') {
        const blob = new Blob([data], { type: typeof data === 'string' ? `${type};charset=utf-8` : type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Give the download a tick to start before the URL is invalidated.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /**
     * Write `text` to the clipboard; resolves to whether it took.
     *
     * The async API first, because it does not disturb the page's own
     * selection; the legacy textarea path when it rejects, which it does
     * whenever the document is not focused. The Markdown copier, the
     * extension pages' Ui.copyText and the chat panel each had a copy of
     * this, and the chat panel's had no fallback at all.
     */
    async function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (_) { /* not focused, or blocked — the legacy path */ }
        }
        try {
            const field = document.createElement('textarea');
            field.value = text;
            field.setAttribute('readonly', '');
            field.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
            document.body.appendChild(field);
            field.select();
            const ok = document.execCommand('copy');
            field.remove();
            return ok;
        } catch (_) {
            return false;
        }
    }

    const Dom = { escapeHtml, escapeAttr, safeUrl, safeUrlAttr, holdFocus, download, copyText };

    root.BB = root.BB || {};
    root.BB.Dom = Dom;
    if (typeof module !== 'undefined' && module.exports) module.exports = Dom;
})(typeof globalThis !== 'undefined' ? globalThis : this);
