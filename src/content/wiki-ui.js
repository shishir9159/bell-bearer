/**
 * What the reader gains on Wikipedia: following the encyclopedia's own links
 * without leaving the reader, and a look at where one goes before following.
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
 *
 * Resting the pointer on a link shows the article's summary beside it, from
 * the endpoint Wikipedia's own Page Previews use: one request for one look,
 * kept for the rest of the page. Settings › Wikipedia turns them off.
 *
 * A picture opens large over the article, the arrows stepping through the
 * article's pictures, rather than on its own file page; and a formula, which
 * is a picture too, is copied as the LaTeX it was written in.
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
    /** How long the pointer rests on a link before its preview is asked for: passing over one is not a look. */
    const PREVIEW_MS = 450;

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
        /** Summaries asked for, by title: a promise each, so a second look asks nothing. */
        const summaries = new Map();
        let hover = 0;

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

        // ------------------------------------------------- previews

        function summaryOf(at) {
            const title = at.pathname.slice('/wiki/'.length);
            if (!summaries.has(title)) {
                summaries.set(title, fetch(`${at.origin}/api/rest_v1/page/summary/${title}`, { credentials: 'same-origin' })
                    .then((answer) => (answer.ok ? answer.json() : null))
                    .catch(() => null));
            }
            return summaries.get(title);
        }

        /** The card: built from the summary's plain fields, never its HTML. */
        function previewCard(summary, at) {
            const card = document.createElement('div');
            card.className = 'tr-preview';
            const image = summary.thumbnail && /^https:\/\//.test(summary.thumbnail.source) ? summary.thumbnail.source : '';
            if (image) {
                const img = document.createElement('img');
                img.className = 'tr-preview-img';
                img.src = image;
                img.alt = '';
                card.appendChild(img);
            }
            const words = document.createElement('div');
            words.className = 'tr-preview-words';
            const title = document.createElement('p');
            title.className = 'tr-preview-title';
            title.textContent = summary.title || decodeURIComponent(at.pathname.slice(6)).replace(/_/g, ' ');
            const text = document.createElement('p');
            text.className = 'tr-preview-text';
            text.textContent = summary.extract || '';
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'tr-preview-open';
            open.textContent = 'Read it here';
            open.addEventListener('click', () => {
                api.popover.hide();
                follow(at);
            });
            words.append(title, text, open);
            card.appendChild(words);
            return card;
        }

        function onHover(event) {
            if (event.pointerType !== 'mouse' || event.buttons || api.settings().wikipediaPreviews === false) return;
            const link = event.target.closest('a[href]');
            if (!link || !api.body.contains(link) || link.closest('sup')) return;
            const at = wikiLink(link.getAttribute('href'));
            if (!at || WikiRead.keyOf(at.href) === shown) return;
            clearTimeout(hover);
            hover = setTimeout(async () => {
                const summary = await summaryOf(at);
                // Still on it, and on an article: a page with no summary has no card.
                if (!api.alive || !link.matches(':hover') || !summary || summary.type === 'no-extract' || !summary.extract) return;
                api.popover.show(link, previewCard(summary, at), { kind: 'preview' });
            }, PREVIEW_MS);
        }

        function onLeave(event) {
            const link = event.target.closest('a[href]');
            if (!link || (event.relatedTarget && link.contains(event.relatedTarget))) return;
            clearTimeout(hover);
            api.popover.hideSoon(link);
        }

        // ---------------------------------------------- pictures and formulas

        /** The article's pictures, in order: not formulas, and not the icons a table carries. */
        const pictures = () => [...api.element.querySelectorAll('.tr-body img:not(.tr-math), .tr-glance-box img')]
            .filter((img) => (Number(img.getAttribute('width')) || img.naturalWidth || 0) >= 80);

        function view(list, at) {
            const viewer = document.createElement('div');
            viewer.className = 'tr-viewer';
            viewer.setAttribute('role', 'dialog');
            viewer.setAttribute('aria-label', 'Picture');
            viewer.innerHTML = `<figure class="tr-viewer-figure"><img alt=""><figcaption></figcaption></figure>
                <button type="button" class="tr-viewer-step is-prev" aria-label="Previous picture">‹</button>
                <button type="button" class="tr-viewer-step is-next" aria-label="Next picture">›</button>
                <button type="button" class="tr-viewer-close" aria-label="Close">×</button>
                <span class="tr-viewer-count"></span>`;
            const img = viewer.querySelector('img');
            const go = (to) => {
                at = (to + list.length) % list.length;
                const one = list[at];
                // Wikipedia's larger rendering, else the best the page offered.
                const fallback = one.currentSrc || one.src;
                img.onerror = () => { img.onerror = null; img.src = fallback; };
                img.src = one.dataset.full || fallback;
                img.alt = one.alt || '';
                const caption = one.closest('figure') && one.closest('figure').querySelector('figcaption');
                viewer.querySelector('figcaption').textContent = caption ? caption.textContent.trim() : one.alt || '';
                viewer.querySelector('.tr-viewer-count').textContent = list.length > 1 ? `${at + 1} / ${list.length}` : '';
            };
            const shut = () => {
                document.removeEventListener('keydown', onKey, true);
                viewer.remove();
                api.element.classList.remove('has-modal');
            };
            const onKey = (event) => {
                if (event.key === 'Escape') shut();
                else if (event.key === 'ArrowLeft') go(at - 1);
                else if (event.key === 'ArrowRight') go(at + 1);
                else return;
                event.preventDefault();
                event.stopPropagation();
            };
            viewer.addEventListener('click', (event) => {
                if (event.target.closest('.is-prev')) go(at - 1);
                else if (event.target.closest('.is-next')) go(at + 1);
                else if (!event.target.closest('img')) shut();
            });
            viewer.querySelectorAll('.tr-viewer-step').forEach((button) => { button.hidden = list.length < 2; });
            document.addEventListener('keydown', onKey, true);
            api.element.classList.add('has-modal');
            api.element.appendChild(viewer);
            go(at);
            return shut;
        }

        /** A formula's LaTeX, as its picture's alt text carries it, without the display wrapper. */
        const latexOf = (img) => String(img.alt || '').trim().replace(/^\{\\displaystyle\s*/, '').replace(/\}$/, '').trim();

        function onPicture(event) {
            if (event.defaultPrevented || event.button !== 0) return;
            const img = event.target.closest('img');
            if (!img || !(api.body.contains(img) || img.closest('.tr-glance-box'))) return;
            if (img.classList.contains('tr-math')) {
                event.preventDefault();
                const latex = latexOf(img);
                if (latex) api.copyText(latex).then((ok) => api.toast(ok ? 'Copied the formula as LaTeX' : 'Could not reach the clipboard'));
                return;
            }
            const list = pictures();
            const at = list.indexOf(img);
            if (at < 0) return;
            event.preventDefault();
            view(list, at);
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

        api.element.addEventListener('click', onPicture);
        api.element.addEventListener('click', onClick);
        api.body.addEventListener('pointerover', onHover);
        api.body.addEventListener('pointerout', onLeave);

        return {
            popstate,
            /** Closed on another article than the page's: the address says that one, so it is loaded. */
            closed() {
                ticket++;
                clearTimeout(hover);
                if (shown !== home.key) root.location.replace(root.location.href);
            },
        };
    }

    const WikiUi = { enhance, wikiLink, KEEP, PREVIEW_MS };

    root.BB = root.BB || {};
    root.BB.WikiUi = WikiUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = WikiUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
