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
 *
 * Three tools on the bar: search (or `/`), read in place like a link; the
 * article in another language, which opens on that language's Wikipedia
 * straight into the reader; and a citation of the exact revision read, as a
 * Markdown link — or, with Alt, as BibTeX, the way Wikipedia's own "Cite
 * this page" gives it.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Icons = ns.Icons || req('../shared/icons.js');
    const WikiRead = ns.WikiRead || req('./wiki-read.js');

    /** How many articles of a reading are kept to step back to without fetching. */
    const KEEP = 10;
    /** A state of ours on the history, told apart from one of Wikipedia's own. */
    const STATE = 'bbReader';
    /** How long the pointer rests on a link before its preview is asked for: passing over one is not a look. */
    const PREVIEW_MS = 450;
    /** How long typing in the search rests before Wikipedia is asked. */
    const SEARCH_MS = 220;
    /** The address that opens an article straight into the reader: another language's, chosen from this one. */
    const OPEN_HASH = '#bb-reader';

    const ICON = Object.freeze({
        search: Icons.svg('magnifying-glass', { size: 18 }),
        languages: Icons.svg('translate', { size: 18 }),
        cite: Icons.svg('book-bookmark', { size: 18 }),
    });

    /** "Alan Turing — Wikipedia", as a Markdown link to the revision read. */
    function markdownCite(article, url) {
        return `[${`${article.title} — Wikipedia`.replace(/([[\]])/g, '\\$1')}](${url})`;
    }

    /** As Special:CiteThisPage gives it. */
    function bibtexCite(article, url, now = new Date()) {
        const day = `${now.getDate()}-${now.toLocaleString('en', { month: 'long' })}-${now.getFullYear()}`;
        return [
            `@misc{wiki:${WikiRead.titleOf(article.url) || 'article'},`,
            '  author = "{Wikipedia contributors}",',
            `  title = "${article.title.replace(/"/g, "''")} --- {Wikipedia}{,} The Free Encyclopedia",`,
            `  year = "${now.getFullYear()}",`,
            `  url = "${url}",`,
            `  note = "[Online; accessed ${day}]"`,
            '}',
        ].join('\n');
    }

    /** The address of the exact revision of `article` read, or its own address where the page did not say which. */
    function revisionUrl(article) {
        const revision = article.meta && article.meta.revision;
        if (!revision) return article.url;
        const at = new URL(article.url);
        return `${at.origin}/w/index.php?title=${encodeURIComponent(WikiRead.titleOf(article.url))}&oldid=${revision}`;
    }

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
            closeMenu();
            api.show(article, { doc: entry.doc, url: entry.url });
            fitTools();
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

        // ------------------------------------------------ the bar's tools

        function tool(icon, label, title) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tr-btn';
            button.title = title;
            button.setAttribute('aria-label', label);
            button.innerHTML = icon;
            return button;
        }

        const searchButton = tool(ICON.search, 'Search Wikipedia', 'Search Wikipedia, and read what you pick here ( / )');
        const languageButton = tool(ICON.languages, 'Other languages', 'This article in another language');
        const citeButton = tool(ICON.cite, 'Cite', 'Copy a citation of this revision as a Markdown link — Alt-click for BibTeX');
        api.tools.prepend(searchButton, languageButton, citeButton);

        /** A small panel under the bar: a field over a list, gone with Escape or a click elsewhere. */
        let menu = null;
        function openMenu(kind, placeholder, fill, pick) {
            closeMenu();
            menu = document.createElement('div');
            menu.className = `tr-menu is-${kind}`;
            menu.innerHTML = `<input type="search" class="tr-menu-field" autocomplete="off" spellcheck="false"><ol class="tr-menu-list"></ol>`;
            const field = menu.querySelector('input');
            field.placeholder = placeholder;
            field.setAttribute('aria-label', placeholder);
            const list = menu.querySelector('ol');
            let items = [];
            let active = 0;
            const draw = (next) => {
                items = next;
                active = 0;
                list.innerHTML = items.map((item, i) => `<li><button type="button" class="tr-menu-item${i ? '' : ' is-on'}" data-i="${i}">
                    <span class="tr-menu-name">${Dom.escapeHtml(item.name)}</span>${item.note ? `<span class="tr-menu-note">${Dom.escapeHtml(item.note)}</span>` : ''}</button></li>`).join('');
            };
            const mark = () => list.querySelectorAll('.tr-menu-item').forEach((one, i) => one.classList.toggle('is-on', i === active));
            field.addEventListener('input', () => fill(field.value, draw));
            field.addEventListener('keydown', (event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    active = Math.max(0, Math.min(items.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
                    mark();
                } else if (event.key === 'Enter' && items[active]) {
                    event.preventDefault();
                    const item = items[active];
                    closeMenu();
                    pick(item);
                }
            });
            list.addEventListener('click', (event) => {
                const button = event.target.closest('.tr-menu-item');
                if (!button) return;
                const item = items[Number(button.dataset.i)];
                closeMenu();
                pick(item);
            });
            // Taking the panel out moves the focus out of it too, and that
            // focusout comes after `menu` has let go of it.
            const panel = menu;
            panel.addEventListener('focusout', (event) => {
                if (menu === panel && !panel.contains(event.relatedTarget)) closeMenu();
            });
            api.element.appendChild(menu);
            fill('', draw);
            field.focus();
        }

        function closeMenu() {
            if (!menu) return;
            const done = menu;
            menu = null;
            done.remove();
        }

        let searching = 0;
        function search() {
            const origin = new URL(api.article.url).origin;
            openMenu('search', 'Search Wikipedia', (query, draw) => {
                clearTimeout(searching);
                if (!query.trim()) {
                    draw([]);
                    return;
                }
                searching = setTimeout(async () => {
                    let pages = [];
                    try {
                        const answer = await fetch(`${origin}/w/rest.php/v1/search/title?q=${encodeURIComponent(query)}&limit=8`, { credentials: 'same-origin' });
                        pages = answer.ok ? (await answer.json()).pages || [] : [];
                    } catch (_) { /* nothing found is what is shown */ }
                    if (menu && menu.classList.contains('is-search')) draw(pages.map((page) => ({ name: page.title, note: page.description || '', key: page.key })));
                }, SEARCH_MS);
            }, (item) => {
                const path = encodeURIComponent(item.key).replace(/%2F/g, '/').replace(/%3A/g, ':');
                follow(new URL(`/wiki/${path}`, origin));
            });
        }

        const languagesOf = () => (api.article.meta && api.article.meta.languages) || [];

        function languages() {
            // Simple English first, for a reader who came for an easier telling.
            const all = languagesOf().slice().sort((a, b) => (b.lang === 'simple') - (a.lang === 'simple'));
            openMenu('languages', `${all.length} languages`, (query, draw) => {
                const want = query.trim().toLowerCase();
                draw(all.filter((one) => !want || [one.name, one.english, one.lang].some((word) => word.toLowerCase().includes(want)))
                    .map((one) => ({ name: one.name, note: one.title && one.title !== api.article.title ? one.title : one.english, href: one.href })));
            }, (item) => root.location.assign(`${item.href.split('#')[0]}${OPEN_HASH}`));
        }

        async function cite(event) {
            const article = api.article;
            const url = revisionUrl(article);
            const text = event.altKey ? bibtexCite(article, url) : markdownCite(article, url);
            const ok = await api.copyText(text);
            api.toast(ok ? `Copied the citation${event.altKey ? ' as BibTeX' : ''}` : 'Could not reach the clipboard');
        }

        /** A tool that has nothing to offer for the article shown is not on the bar. */
        function fitTools() {
            languageButton.hidden = !languagesOf().length;
        }

        searchButton.addEventListener('click', search);
        languageButton.addEventListener('click', languages);
        citeButton.addEventListener('click', cite);
        api.element.addEventListener('keydown', (event) => {
            const active = api.element.getRootNode().activeElement;
            const typing = active && (/^(TEXTAREA|INPUT|SELECT)$/.test(active.tagName) || active.isContentEditable);
            if (event.key !== '/' || typing || event.ctrlKey || event.metaKey || event.altKey) return;
            event.preventDefault();
            search();
        });
        fitTools();

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
                clearTimeout(searching);
                if (shown !== home.key) root.location.replace(root.location.href);
            },
        };
    }

    /**
     * An article opened from another language's: the page loads with our
     * hash on it, which is taken off as the reader opens. Answers whether
     * it was there.
     */
    function openAsked(open) {
        if (root.location.hash !== OPEN_HASH) return false;
        root.history.replaceState(root.history.state, '', root.location.href.split('#')[0]);
        open();
        return true;
    }

    const WikiUi = { enhance, openAsked, wikiLink, markdownCite, bibtexCite, revisionUrl, KEEP, PREVIEW_MS, OPEN_HASH };

    root.BB = root.BB || {};
    root.BB.WikiUi = WikiUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = WikiUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
