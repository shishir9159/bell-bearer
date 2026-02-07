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
    const Dom = ns.Dom || req('../shared/dom.js');

    /** Characters that would otherwise break out of a [label](url) pair. */
    function escapeLabel(text) {
        return String(text || '').replace(/([\\[\]])/g, '\\$1').replace(/\s+/g, ' ').trim();
    }

    /**
     * A URL as the inside of `(…)`. Whitespace or a parenthesis without its
     * pair ends the link early, so those are percent-encoded — and only
     * those: a balanced pair is legal Markdown, and encoding it would turn
     * every https://en.wikipedia.org/wiki/Foo_(bar) into Foo_%28bar%29.
     */
    function escapeUrl(url) {
        const text = String(url || '').replace(/\s/g, (ch) => encodeURIComponent(ch));
        let depth = 0;
        let balanced = true;
        for (const ch of text) {
            if (ch === '(') depth++;
            else if (ch === ')' && --depth < 0) balanced = false;
        }
        return balanced && depth === 0 ? text : text.replace(/\(/g, '%28').replace(/\)/g, '%29');
    }

    function link(label, url) {
        return `[${escapeLabel(label)}](${escapeUrl(url)})`;
    }

    /**
     * A video's checkpoints as a timestamped Markdown list:
     *
     *     ## [Title](watch url)
     *
     *     - [1:02–1:15](watch url at 1:02) what was said
     *       - your note
     *
     * The note goes under the passage, the way the reader sets it at the end
     * of the highlight; on the same line it read as part of the quote. The
     * note Ctrl+B used to write by itself ("Checkpoint 1:02 - 1:15") is left
     * out: it only repeats the times beside it.
     */
    function checkpointList(video, bookmarks, formatTime) {
        const lines = [`## ${link(video.title || video.id, YouTube.watchUrl(video.id, 0))}`, ''];
        for (const bookmark of bookmarks || []) {
            const at = typeof bookmark.start === 'number' ? bookmark.start : bookmark.time;
            const span = typeof bookmark.end === 'number' && bookmark.end > at
                ? `${formatTime(at)}–${formatTime(bookmark.end)}` : formatTime(at);
            const said = String(bookmark.subtitle || '').replace(/\s+/g, ' ').trim();
            const note = String(bookmark.note || '').replace(/\s+/g, ' ').trim();
            const own = note && !/^(Checkpoint|Segment:) \d/.test(note) ? note : '';
            let line = `- ${link(span, YouTube.watchUrl(video.id, at))}`;
            if (said && said !== 'null') line += ` ${said}`;
            lines.push(line);
            if (own) lines.push(`  - ${own}`);
        }
        return lines.join('\n');
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

        return { trackContextLinks, buildPageMarkdown, buildLinkMarkdown, copy: (text) => Dom.copyText(text) };
    }

    const Markdown = { createMarkdown, escapeLabel, escapeUrl, checkpointList };

    root.BB = root.BB || {};
    root.BB.Markdown = Markdown;
    if (typeof module !== 'undefined' && module.exports) module.exports = Markdown;
})(typeof globalThis !== 'undefined' ? globalThis : this);
