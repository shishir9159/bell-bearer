/**
 * "Copy as Markdown" — for the current page (Ctrl+Shift+L, y y or the page
 * context menu) and for a right-clicked link. y y copies the same link as
 * plain text instead, once Settings › General asks for that, and Ctrl+Shift+V
 * pastes a link copied as Markdown as that plain text.
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
     * The same link with the Markdown taken off: what it is called, then
     * where it is. One line, because a search box is where it is pasted as
     * often as not, and that has no second one. A page with nothing to call
     * it but its address is the address, once.
     */
    function plain(label, url) {
        const name = String(label || '').replace(/\s+/g, ' ').trim();
        const address = String(url || '').trim();
        return name && name !== address ? `${name} ${address}` : address;
    }

    /** One link in both its spellings, which is what a copy is given. */
    const both = (label, url) => ({ markdown: link(label, url), text: plain(label, url) });

    /** How long after Ctrl+Shift+V goes down a paste is still that key's. */
    const PLAIN_PASTE_MS = 1000;

    /**
     * Ctrl+Shift+V — ⌘ for Ctrl on a Mac — the browser's own "paste as plain
     * text". By the letter as well as the key: the browser follows the
     * layout, and on Dvorak the V it means is not where KeyV is.
     */
    function isPlainPaste(event) {
        const v = event.code === 'KeyV' || String(event.key || '').toLowerCase() === 'v';
        return v && !!event.shiftKey && !!(event.ctrlKey || event.metaKey);
    }

    /** Whether a paste aimed at `node` lands in something that takes text. */
    function takesText(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node.isContentEditable) return true;
        return (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') && !node.readOnly && !node.disabled;
    }

    /**
     * Put `text` where a paste aimed at `target` would have gone.
     *
     * An editor that reads its pastes itself — ProseMirror, which is both
     * chat sites' prompt box, and most editors like it — is handed one: a
     * `paste` of its own carrying the text, which it takes and cancels. A
     * plain field does nothing with an event a script made and leaves it
     * uncancelled, so there the text is typed in instead, which also keeps
     * the field's undo. Firefox's constructor takes the text as `data` and
     * `dataType` rather than as a DataTransfer, hence both.
     */
    function pasteText(target, text) {
        let taken = false;
        try {
            const data = new DataTransfer();
            data.setData('text/plain', text);
            taken = !target.dispatchEvent(new ClipboardEvent('paste', {
                clipboardData: data, data: text, dataType: 'text/plain', bubbles: true, cancelable: true, composed: true,
            }));
        } catch (_) { /* no such event to make here: typed in, below */ }
        if (!taken) document.execCommand('insertText', false, text);
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

        /**
         * What the page is called and where it is: `title - channel` and the
         * watch URL on YouTube, the tab's title and its address elsewhere.
         * `seconds` is where in the video the link opens, and 0 is its start;
         * a page that is not a video has no use for it.
         */
        function pageParts(seconds) {
            if (site === 'youtube') {
                const videoId = pageInfo.getVideoId();
                if (videoId) {
                    const title = pageInfo.getVideoTitle();
                    const channel = pageInfo.getChannelInfo().channelName;
                    return [`${title} - ${channel}`, YouTube.watchUrl(videoId, seconds)];
                }
            }
            return [document.title || location.href, location.href];
        }

        /** The page as a link, in both its spellings: `{ markdown, text }`. */
        function pageLink(seconds = 0) {
            const [label, url] = pageParts(seconds);
            return both(label, url);
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
         * The link last copied as Markdown, in both spellings:
         * Ctrl+Shift+V is answered from it.
         */
        let copied = null;

        /** Put a link on the clipboard, in the spelling asked for. Resolves to whether it got there. */
        async function copyLink(one, asMarkdown = true) {
            const ok = await Dom.copyText(asMarkdown ? one.markdown : one.text);
            if (ok && asMarkdown) copied = { markdown: one.markdown, text: one.text };
            return ok;
        }

        /**
         * After a link is copied as Markdown, Ctrl+V pastes the Markdown —
         * it is what the clipboard holds — and Ctrl+Shift+V pastes the same
         * link as plain text. Returns a function that removes it.
         *
         * The paste event does not say which of the two keys it came from,
         * so the key is watched for and the paste that follows it is the
         * plain one. And it is reworded only when the clipboard still holds,
         * to the letter, the link that was copied: a Markdown link copied
         * out of somebody's README is theirs, and pastes as it is.
         */
        function installPlainPaste({ now = () => performance.now() } = {}) {
            let pressedAt = -Infinity;
            // The paste handed to an editor below comes back through here.
            let handing = false;

            // Any other key in between is another keystroke, and its paste
            // — Ctrl+V straight after — is not the plain one.
            const onKeyDown = (event) => {
                pressedAt = isPlainPaste(event) ? now() : -Infinity;
            };

            const onPaste = (event) => {
                if (handing) return;
                const plainOne = now() - pressedAt <= PLAIN_PASTE_MS;
                pressedAt = -Infinity;
                if (!plainOne || !copied) return;

                const target = (event.composedPath && event.composedPath()[0]) || event.target;
                const data = event.clipboardData;
                if (!takesText(target) || !data || data.getData('text/plain') !== copied.markdown) return;

                // Stopped as well as cancelled: the page's own paste handler
                // would otherwise put the Markdown in beside the text.
                event.preventDefault();
                event.stopImmediatePropagation();
                handing = true;
                try {
                    pasteText(target, copied.text);
                } finally {
                    handing = false;
                }
            };

            window.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('paste', onPaste, true);

            return function uninstall() {
                window.removeEventListener('keydown', onKeyDown, true);
                window.removeEventListener('paste', onPaste, true);
            };
        }

        return {
            trackContextLinks, pageLink, buildLinkMarkdown, copyLink, installPlainPaste,
            copy: (text) => Dom.copyText(text),
        };
    }

    const Markdown = { createMarkdown, escapeLabel, escapeUrl, plain, isPlainPaste, PLAIN_PASTE_MS, checkpointList };

    root.BB = root.BB || {};
    root.BB.Markdown = Markdown;
    if (typeof module !== 'undefined' && module.exports) module.exports = Markdown;
})(typeof globalThis !== 'undefined' ? globalThis : this);
