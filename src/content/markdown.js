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
    const Settings = ns.Settings || req('../shared/settings.js');

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

    /**
     * What a video's link calls it: its title, and whose it is. "by", where
     * this used to put a dash: titles have dashes of their own — "Artist -
     * Song" — and after one more the channel read as another piece of it.
     */
    function videoLabel(pageInfo, withChannel) {
        const title = pageInfo.getVideoTitle();
        return withChannel ? `${title} by ${pageInfo.getChannelInfo().channelName}` : title;
    }

    /**
     * A Reddit page's title with its subreddit moved to the end and spelled
     * out — "Title in AskReddit subreddit" — or taken off.
     *
     * Reddit puts the subreddit in the title itself, and not in one place: a
     * post is "Title : r/AskReddit" in the tab, "r/AskReddit on Reddit:
     * Title" in the title it hands a link preview, and "Title : AskReddit"
     * on old Reddit. Whichever is there comes off, and only where it names
     * the subreddit the address is in: a post whose own words end in
     * ": r/somewhere" keeps them. The name it is given back is the title's
     * spelling of it, which is the subreddit's, where the address has
     * whatever was typed.
     *
     * A post always gets the name, and so does any page Reddit named that
     * way. Another page under /r/ — a wiki, a listing with a title of its
     * own — was never called by its subreddit, and is left as it is.
     */
    function redditLabel(title, pathname, withSubreddit) {
        const text = String(title || '').replace(/\s+/g, ' ').trim();
        const at = /^\/r\/([A-Za-z0-9_]+)(\/comments\/)?/.exec(String(pathname || ''));
        if (!at) return text;

        let name = at[1];
        const take = (all, spelled) => {
            name = spelled;
            return '';
        };
        const bare = text
            .replace(new RegExp(`^r/(${at[1]})(?: on Reddit)?\\s*(?:[:|·-]\\s+|$)`, 'i'), take)
            .replace(new RegExp(`\\s+[:|·-]\\s*(?:r/)?(${at[1]})$`, 'i'), take);

        if (bare === text && !at[2]) return text;
        if (!withSubreddit) return bare || text;
        return bare ? `${bare} in ${name} subreddit` : `${name} subreddit`;
    }

    /**
     * A GitHub page's title with its repository moved to the end, after a
     * dash — "Title · Issue #12 - owner/repo" — or taken off.
     *
     * GitHub names the repository in the title, and where depends on the
     * page: last on an issue or a file ("… · Issue #12 · owner/repo"), in
     * the middle on a discussion, in front on the repository's own page
     * ("owner/repo: what it is"). Signed out it also puts its own name
     * around the lot — "GitHub - owner/repo: … · GitHub" — which comes off
     * with it, so a page is one link signed in or out.
     *
     * Only a title that names the repository its address is in is touched.
     * /settings/profile is two segments and no repository, and a page that
     * names its repository some other way — "owner/repo@1a2b3c" on a run,
     * "Contributors to owner/repo" — reads right as it is. The name is the
     * title's spelling of it; the address has whatever was typed.
     */
    function githubLabel(title, pathname, withRepo) {
        const text = String(title || '').replace(/\s+/g, ' ').trim();
        const [owner, repo] = String(pathname || '').split('/').filter(Boolean);
        if (!owner || !repo) return text;
        const wanted = `${owner}/${repo}`.toLowerCase();

        const parts = text.split(' · ');
        const signedOut = parts.length > 1 && parts[parts.length - 1] === 'GitHub';
        if (signedOut) parts.pop();

        let name = '';
        const at = parts.findIndex((part) => part.toLowerCase() === wanted);
        if (at >= 0) {
            [name] = parts.splice(at, 1);
        } else {
            // Its own page. The "GitHub - " goes only with the "· GitHub"
            // it comes with: an issue can be titled "GitHub - …" too.
            const head = signedOut ? parts[0].replace(/^GitHub - /, '') : parts[0];
            const lower = head.toLowerCase();
            if (lower !== wanted && !lower.startsWith(`${wanted}: `)) return text;
            name = head.slice(0, wanted.length);
            parts[0] = head.slice(wanted.length + 1).trim();
        }

        const rest = parts.filter(Boolean).join(' · ');
        if (!rest) return name;
        return withRepo ? `${rest} - ${name}` : rest;
    }

    /** The tab's title and where it is, which is all a link is made from. */
    const thisPage = () => ({ title: document.title, url: location.href, path: location.pathname });

    /**
     * `getSettings` is the page's mirror of the settings, read at each copy
     * so a switch thrown in the dashboard is followed without a reload.
     * `getPage` is thisPage, and the suite's way to be on another site's.
     */
    function createMarkdown({ site, pageInfo, getSettings = () => Settings.DEFAULTS, getPage = thisPage }) {
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
         * What the page is called and where it is: `title by channel` and
         * the watch URL on YouTube, the tab's title — with its subreddit put
         * last on Reddit, and its repository on GitHub — and its address
         * elsewhere. `seconds` is where in the video the link opens, and 0
         * is its start; a page that is not a video has no use for it.
         */
        function pageParts(seconds) {
            const settings = getSettings();
            const page = getPage();
            if (site === 'youtube') {
                const videoId = pageInfo.getVideoId();
                if (videoId) {
                    // The watch URL is rebuilt from the id, which used to
                    // leave behind the playlist the video was playing from.
                    // It is kept while links are to a video's start; once
                    // Settings asks for them at a moment, a link is to the
                    // video alone.
                    const playlist = settings.youtubeLinkTimestamp === true ? null : YouTube.playlistPlace(page.url);
                    return [
                        videoLabel(pageInfo, settings.youtubeLinkChannel !== false),
                        YouTube.watchUrl(videoId, seconds, playlist),
                    ];
                }
            }
            let label = page.title;
            if (site === 'reddit') label = redditLabel(label, page.path, settings.redditLinkSubreddit !== false);
            if (site === 'github') label = githubLabel(label, page.path, settings.githubLinkRepo !== false);
            return [label || page.url, page.url];
        }

        /** The page as a link, in both its spellings: `{ markdown, text }`. */
        function pageLink(seconds = 0) {
            const [label, url] = pageParts(seconds);
            return both(label, url);
        }

        /**
         * A right-clicked link, in both spellings. `[label](url)` is the
         * anchor's own text first, then any selected text, then a readable
         * form of the URL itself — which as plain text would only say the
         * address twice, so there it is the address alone.
         */
        function contextLink(linkUrl, selectionText) {
            let label = '';
            if (lastContextLink && lastContextLink.url === linkUrl) {
                label = lastContextLink.text || lastContextLink.title;
            }
            if (!label && selectionText) label = selectionText;
            if (label) return both(label, linkUrl);
            try {
                const parsed = new URL(linkUrl);
                label = parsed.hostname.replace(/^www\./, '') + parsed.pathname.replace(/\/$/, '');
            } catch (_) {
                label = linkUrl;
            }
            return { markdown: link(label, linkUrl), text: plain('', linkUrl) };
        }

        /**
         * The link last copied as Markdown, by this tab or any other, in
         * both spellings: Ctrl+Shift+V is answered from it. It is kept in
         * storage because a link is copied in one tab to be pasted in
         * another, and mirrored here because a paste has to be answered
         * while its event is still being dispatched, which no read from
         * storage comes back in time for.
         */
        const COPIED = Settings.DATA.linkCopy;
        let copied = null;

        const asCopied = (value) => (value && typeof value.markdown === 'string' && typeof value.text === 'string'
            ? { markdown: value.markdown, text: value.text }
            : null);

        /** Put a link on the clipboard, in the spelling asked for. Resolves to whether it got there. */
        async function copyLink(one, asMarkdown = true) {
            const ok = await Dom.copyText(asMarkdown ? one.markdown : one.text);
            if (ok && asMarkdown) {
                copied = asCopied(one);
                Settings.set({ [COPIED]: copied });
            }
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
            /** The Ctrl+Shift+V last pressed — `{ at, answered }` — while a paste can still be its. */
            let press = null;
            // The paste handed to an editor below comes back through here.
            let handing = false;

            // A copy made here since this was asked is newer than its answer.
            Settings.get([COPIED]).then((stored) => {
                if (!copied) copied = asCopied(stored[COPIED]);
            });
            const unwatch = Settings.watch([COPIED], (changed) => {
                copied = asCopied(changed[COPIED]);
            });

            // Any other key in between is another keystroke, and its paste
            // — Ctrl+V straight after — is not the plain one.
            const onKeyDown = (event) => {
                press = isPlainPaste(event) ? { at: now(), answered: false } : null;
            };

            const onPaste = (event) => {
                if (handing || !press || !copied || now() - press.at > PLAIN_PASTE_MS) return;

                const target = (event.composedPath && event.composedPath()[0]) || event.target;
                const data = event.clipboardData;
                if (!takesText(target) || !data || data.getData('text/plain') !== copied.markdown) return;

                // Stopped as well as cancelled: the page's own paste handler
                // would otherwise put the Markdown in beside the text.
                event.preventDefault();
                event.stopImmediatePropagation();

                // One press can arrive as two pastes. When the paste comes
                // with the key as an edit command — a test driver sends it
                // so — Chrome takes the cancelled command for a key nobody
                // handled and runs its own binding for it, which pastes
                // again, in the same task. That one used to go through, and
                // the Markdown landed after the text. So a press stays this
                // one's until the task is over, and is answered once.
                if (press.answered) return;
                press.answered = true;
                const mine = press;
                setTimeout(() => {
                    if (press === mine) press = null;
                }, 0);

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
                unwatch();
                window.removeEventListener('keydown', onKeyDown, true);
                window.removeEventListener('paste', onPaste, true);
            };
        }

        return {
            trackContextLinks, pageLink, contextLink, copyLink, installPlainPaste,
            copy: (text) => Dom.copyText(text),
        };
    }

    const Markdown = {
        createMarkdown, escapeLabel, escapeUrl, plain, redditLabel, githubLabel, isPlainPaste, PLAIN_PASTE_MS, checkpointList,
    };

    root.BB = root.BB || {};
    root.BB.Markdown = Markdown;
    if (typeof module !== 'undefined' && module.exports) module.exports = Markdown;
})(typeof globalThis !== 'undefined' ? globalThis : this);
