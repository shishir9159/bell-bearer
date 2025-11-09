/**
 * "Copy as Markdown" — for the current page (Ctrl+Shift+L or the page context
 * menu) and for a right-clicked link.
 *
 * Conversion is only ever an explicit action. An earlier version hooked Ctrl+C
 * and converted whenever the selection "looked" empty, but getSelection()
 * returns empty for selections inside shadow DOM and form fields, so ordinary
 * copies were being silently replaced by a Markdown link.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const YouTube = ns.YouTube || req('../shared/youtube.js');

    /** Characters that would otherwise break out of a [label](url) pair. */
    function escapeLabel(text) {
        return String(text || '').replace(/([\\[\]])/g, '\\$1').replace(/\s+/g, ' ').trim();
    }

    function link(label, url) {
        return `[${escapeLabel(label)}](${url})`;
    }

    function createMarkdown({ site, pageInfo }) {
        /** The anchor most recently right-clicked, for its visible text. */
        let lastContextLink = null;

        /**
         * The context-menu API hands us an href but never the anchor's text, so
         * remember what was under the cursor. composedPath() is used so links
         * inside shadow DOM (most of modern YouTube) are found too.
         */
        function trackContextLinks() {
            document.addEventListener('contextmenu', (event) => {
                lastContextLink = null;
                const path = (event.composedPath && event.composedPath()) || [event.target];
                for (const node of path) {
                    if (!node || node.tagName !== 'A' || !node.href) continue;
                    lastContextLink = {
                        url: node.href,
                        text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
                        title: node.getAttribute('title') || '',
                    };
                    break;
                }
            }, true);
        }

        /** `[title - channel](watch url)` on YouTube, `[title](url)` elsewhere. */
        function buildPageMarkdown() {
            if (site === 'youtube') {
                const videoId = pageInfo.getVideoId();
                if (videoId) {
                    const title = pageInfo.getVideoTitle();
                    const channel = pageInfo.getChannelInfo().channelName;
                    return link(`${title} - ${channel}`, YouTube.watchUrl(videoId, 0));
                }
            }
            return link(document.title || location.href, location.href);
        }

        /**
         * `[label](url)` for a right-clicked link: the anchor's own text first,
         * then any selected text, then a readable form of the URL itself.
         */
        function buildLinkMarkdown(linkUrl, selectionText) {
            let label = '';
            if (lastContextLink && lastContextLink.url === linkUrl) {
                label = lastContextLink.text || lastContextLink.title;
            }
            if (!label && selectionText) label = selectionText;
            if (!label) {
                try {
                    const parsed = new URL(linkUrl);
                    label = parsed.hostname.replace(/^www\./, '') + parsed.pathname.replace(/\/$/, '');
                } catch (_) {
                    label = linkUrl;
                }
            }
            return link(label, linkUrl);
        }

        /**
         * Write to the clipboard, preferring the async API because it does not
         * disturb the page's own selection. Falls back to the legacy path when
         * the document is not focused, which rejects the async call.
         */
        async function copy(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(text);
                    return true;
                } catch (_) { /* not focused / blocked — try the legacy path */ }
            }
            return copyLegacy(text);
        }

        function copyLegacy(text) {
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

        return { trackContextLinks, buildPageMarkdown, buildLinkMarkdown, copy };
    }

    const Markdown = { createMarkdown, escapeLabel };

    root.BB = root.BB || {};
    root.BB.Markdown = Markdown;
    if (typeof module !== 'undefined' && module.exports) module.exports = Markdown;
})(typeof globalThis !== 'undefined' ? globalThis : this);
