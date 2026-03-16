/**
 * What the reader gains on Wikipedia: following the encyclopedia's own links
 * without leaving the reader.
 *
 * A link to another article is fetched — the same page the click would have
 * loaded, from Wikipedia itself, one request for one click — read by the
 * same adapter and drawn in this article's place. The address follows
 * (history.pushState), so Back and Forward step through what was read, and
 * each article comes back where it was left: the one place the reader keeps,
 * and only between the articles of one reading. The last few pages are kept
 * in memory for that; one dropped from it is fetched again.
 *
 * Closing the reader on an article other than the page underneath loads that
 * article for real, since that is what the address already says. A link to
 * anything that is not an article — a talk page, a category, an image's own
 * page — is followed as a link.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const WikiRead = ns.WikiRead || req('./wiki-read.js');

    /** How many articles of a reading are kept to step back to without fetching. */
    const KEEP = 10;
    /** A state of ours on the history, told apart from one of Wikipedia's own. */
    const STATE = 'bbReader';

    /** `href` as an address on this Wikipedia under /wiki/, or null: an article, perhaps, until it is read. */
    function wikiLink(href, origin = root.location.origin) {
        let at;
        try { at = new URL(href, origin); } catch (_) { return null; }
        if (at.origin !== origin || !/^\/wiki\/./.test(at.pathname)) return null;
        return at;
    }

    function enhance(api) {
        /** By article key: the document it was read from, its address, and where it was left. */
        const kept = new Map();
        const home = { key: api.article.key, title: root.document.title };
        // " - Wikipedia", or however this language's Wikipedia ends a title.
        const suffix = home.title.startsWith(api.article.title) ? home.title.slice(api.article.title.length) : ' - Wikipedia';
        let shown = home.key;
        let ticket = 0;

        kept.set(home.key, { doc: root.document, url: root.location.href.split('#')[0], top: 0 });

        function keep(key, entry) {
            kept.delete(key);
            kept.set(key, entry);
            for (const old of kept.keys()) {
                if (kept.size <= KEEP) break;
                if (old !== home.key && old !== key) kept.delete(old);
            }
        }

        /** Where the article shown was left, for coming back to it. */
        function leave() {
            const entry = kept.get(shown);
            if (entry) entry.top = api.scroll.scrollTop;
        }

        function draw(key, entry, { hash = '', top = 0 } = {}) {
            const article = WikiRead.read(entry.doc, entry.url, api.settings());
            if (!article) return false;
            shown = key;
            api.show(article, { doc: entry.doc, url: entry.url });
            root.document.title = key === home.key ? home.title : `${article.title}${suffix}`;
            const target = hash && api.body.querySelector(`#${CSS.escape(`bbr-${decodeURIComponent(hash.slice(1))}`)}`);
            if (target) api.jumpTo(target);
            else api.scroll.scrollTop = top;
            return true;
        }

        async function fetchDoc(url) {
            const answer = await fetch(url, { credentials: 'same-origin' });
            if (!answer.ok) throw new Error(`${answer.status}`);
            return new DOMParser().parseFromString(await answer.text(), 'text/html');
        }

        /** A link followed: read in place if it is an article, followed as a link if it is not. */
        async function follow(at) {
            const mine = ++ticket;
            const url = `${at.origin}${at.pathname}${at.search}`;
            let doc;
            try {
                doc = await fetchDoc(url);
            } catch (_) {
                if (mine === ticket && api.alive) root.location.assign(at.href);
                return;
            }
            if (mine !== ticket || !api.alive) return;
            if (!WikiRead.isArticle(doc)) {
                root.location.assign(at.href);
                return;
            }
            leave();
            const key = WikiRead.keyOf(url);
            const entry = { doc, url, top: 0 };
            keep(key, entry);
            root.history.pushState({ [STATE]: key }, '', `${url}${at.hash}`);
            draw(key, entry, { hash: at.hash });
        }

        function onClick(event) {
            if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            const link = event.target.closest('a[href]');
            if (!link || !api.body.contains(link)) return;
            const at = wikiLink(link.getAttribute('href'));
            if (!at) return;
            // A link to the article shown, to a part of it, is the reader's own.
            if (WikiRead.keyOf(at.href) === shown) return;
            event.preventDefault();
            follow(at);
        }

        /** Back and Forward between the articles of this reading; anything else is not ours to answer. */
        function popstate(event) {
            const state = event.state && event.state[STATE];
            const key = state || (WikiRead.keyOf(root.location.href) === home.key ? home.key : null);
            if (!key) return false;
            leave();
            const entry = kept.get(key);
            if (entry) {
                draw(key, entry, { top: entry.top });
                return true;
            }
            // Dropped from memory: the page again, from Wikipedia.
            const mine = ++ticket;
            fetchDoc(root.location.href.split('#')[0]).then((doc) => {
                if (mine !== ticket || !api.alive) return;
                const fresh = { doc, url: root.location.href.split('#')[0], top: 0 };
                keep(key, fresh);
                draw(key, fresh);
            }).catch(() => root.location.reload());
            return true;
        }

        api.element.addEventListener('click', onClick);

        return {
            popstate,
            /** Closed on another article than the page's: the address says that one, so it is loaded. */
            closed() {
                ticket++;
                if (shown !== home.key) root.location.replace(root.location.href);
            },
        };
    }

    const WikiUi = { enhance, wikiLink, KEEP };

    root.BB = root.BB || {};
    root.BB.WikiUi = WikiUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = WikiUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
