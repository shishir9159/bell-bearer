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

    const Dom = { escapeHtml, escapeAttr, safeUrl, safeUrlAttr };

    root.BB = root.BB || {};
    root.BB.Dom = Dom;
    if (typeof module !== 'undefined' && module.exports) module.exports = Dom;
})(typeof globalThis !== 'undefined' ? globalThis : this);
