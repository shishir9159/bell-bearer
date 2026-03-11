/**
 * The text reader: a page's article in one quiet column over the page, in
 * the skin the rest of Bell Bearer wears.
 *
 * What is read is an adapter's: Wikipedia's (src/content/wiki-read.js), an
 * X thread's (x-thread-read.js), or for every other page the extractor
 * (article-extract.js). An adapter's `read(doc)` answers an Article — the
 * title, byline, date and site, and the body as a fragment already cleaned
 * into the reader's markup — and this draws it, the same way for all three.
 *
 * **Nothing of the page's is removed or changed.** The reader is one element
 * at the end of <body> and one class on <html>; the page under it is held
 * still, and closing takes all three away, leaving the page where it was.
 *
 * **The reader is drawn in a shadow root of its own.** The YouTube reader is
 * not — it sits over one site, whose styles are known — but this one opens on
 * any site, and a site's `p { margin: 0 }` or `article { background: #fff }`
 * reached straight into the article (seen on the first page it was tried
 * on). A shadow root is the one boundary a page's stylesheet does not cross,
 * so the reader's styles are the only ones inside it: the same sheet the
 * YouTube reader uses, read once and adopted, palette and skins and all.
 *
 * Every setting is in Settings › Reader, not in here. The reader carries
 * only what is done to the article — closing it, and the tools an adapter
 * or the highlights add to its bar — so nothing in it asks to be tuned while
 * reading.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Icons = ns.Icons || req('../shared/icons.js');
    const Theme = ns.Theme || req('./theme.js');
    const Settings = ns.Settings || req('../shared/settings.js');

    const ROOT_ID = 'bb-text-reader';
    /** On <html> while the reader is up. */
    const OPEN_CLASS = 'bb-text-reader-open';
    /** The sheet the reader's shadow root adopts: the YouTube reader's, whose palette both share. */
    const SHEET = 'content-reader.css';

    /**
     * How the host element is placed, written inline and important: it is
     * the one piece of the reader in the page's own tree, where a page's
     * `body > div:last-child` could otherwise reach it. A custom tag, so no
     * rule of the page's names it either. Its ground is set by the theme
     * (GROUND), so the frame before the styles are in is not a white flash
     * over a dark page.
     */
    const HOST_STYLE = Object.freeze({ all: 'initial', display: 'block', position: 'fixed', inset: '0', 'z-index': '999990' });
    const GROUND = Object.freeze({ light: ['#ffffff', '#0f0f0f'], dark: ['#181a1b', '#e3e0db'] });

    /** The sheet as text, read once a page; `load` is how, so the specs can hand it their own. */
    let sheetText = null;
    function sheetOf(load) {
        if (!sheetText) {
            sheetText = Promise.resolve().then(load).catch((error) => {
                console.error('Bell Bearer: the reader\'s styles did not load', error);
                sheetText = null;
                return '';
            });
        }
        return sheetText;
    }

    const loadSheet = () => fetch(chrome.runtime.getURL(SHEET)).then((answer) => (answer.ok ? answer.text() : ''));

    /** Fewer words than this is not an article: a front page, a login, a feed. */
    const MIN_WORDS = 140;
    /** Words a minute, and characters a minute for scripts written without spaces. */
    const WPM = 230;
    const CPM = 500;

    const ICON = Object.freeze({
        close: Icons.svg('x', { size: 18 }),
        out: Icons.svg('arrow-square-out', { size: 14 }),
    });

    /** Words, and the minutes they take: CJK by the character, everything else by the word. */
    function measure(text) {
        const value = String(text || '');
        const cjk = (value.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || []).length;
        const words = (value.replace(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g, ' ').match(/\S+/g) || []).length;
        return { words: words + Math.round(cjk / 2), minutes: Math.max(1, Math.round(words / WPM + cjk / CPM)) };
    }

    /** Tracking parameters, which make one article many addresses. */
    const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|mc_cid|mc_eid|ref|ref_src|igshid|si)$/i;

    /** One article, one key: the address without its fragment or its tracking. */
    function keyOf(url) {
        try {
            const at = new URL(url);
            for (const name of [...at.searchParams.keys()]) if (TRACKING.test(name)) at.searchParams.delete(name);
            at.hash = '';
            return at.href;
        } catch (_) {
            return String(url || '');
        }
    }

    /** "1 May 2024", in the page's language, or what the page wrote if it is no date. */
    function dateLabel(value, lang) {
        if (!value) return '';
        const at = new Date(value);
        if (Number.isNaN(at.getTime())) return String(value).length <= 40 ? String(value) : '';
        try {
            return at.toLocaleDateString(lang || undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        } catch (_) {
            return at.toDateString();
        }
    }

    function shellHtml() {
        return `
            <div class="tr-tex"></div>
            <header class="tr-bar">
                <span class="tr-where"></span>
                <span class="tr-flex"></span>
                <div class="tr-tools"></div>
                <button type="button" class="tr-btn tr-close" title="Close the reader (Esc)" aria-label="Close the reader">${ICON.close}</button>
            </header>
            <div class="tr-scroll" tabindex="-1">
                <div class="tr-page">
                    <article class="tr-article">
                        <header class="tr-head"></header>
                        <div class="tr-body"></div>
                        <footer class="tr-foot"></footer>
                    </article>
                </div>
            </div>`;
    }

    /**
     * Hold the page still under the reader, by its own inline style: there
     * is no stylesheet of ours in the page to do it with. Answers how to let
     * go, putting back whatever the page had there.
     */
    function holdPage() {
        const held = [document.documentElement, document.body].filter(Boolean).map((el) => ({
            el, value: el.style.getPropertyValue('overflow'), priority: el.style.getPropertyPriority('overflow'),
        }));
        held.forEach(({ el }) => el.style.setProperty('overflow', 'hidden', 'important'));
        document.documentElement.classList.add(OPEN_CLASS);
        return () => {
            held.forEach(({ el, value, priority }) => {
                if (value) el.style.setProperty('overflow', value, priority);
                else el.style.removeProperty('overflow');
            });
            document.documentElement.classList.remove(OPEN_CLASS);
        };
    }

    function createArticleReader({ adapter, getSettings, copyText, notify = () => {}, loadStyles = loadSheet }) {
        /**
         * The open reader, or null. A fresh object per open, so an answer
         * that arrives after a close — the skin read, a fetch an adapter
         * started — can see it belongs to a reader that is gone.
         */
        let session = null;

        const settings = () => (getSettings ? getSettings() : Settings.DEFAULTS);

        // ------------------------------------------------ open and close

        /**
         * Open on the page's article. `force` opens a page that does not
         * look like an article, as "Open anyway" asks; `auto` is the reader
         * opening itself on a listed site, which on such a page does nothing.
         */
        function open({ force = false, auto = false } = {}) {
            if (session) return true;
            let article = null;
            try {
                article = adapter.read(document, location.href);
            } catch (error) {
                console.error('Bell Bearer: the reader could not read this page', error);
            }
            if (!article || !article.body) {
                if (!auto) notify('Nothing to read on this page', 'info');
                return false;
            }
            const counted = measure(article.body.textContent);
            if (counted.words < MIN_WORDS && !force && auto) return false;

            const host = document.createElement('bb-text-reader');
            host.id = ROOT_ID;
            for (const [name, value] of Object.entries(HOST_STYLE)) host.style.setProperty(name, value, 'important');
            // Closed: the page has no business reading the notes typed in it.
            const shadow = host.attachShadow({ mode: 'closed' });
            const element = document.createElement('div');
            element.className = 'bb-text-reader is-still';
            element.setAttribute('role', 'dialog');
            element.setAttribute('aria-label', 'Reader');
            element.innerHTML = shellHtml();
            shadow.appendChild(element);
            const part = (selector) => element.querySelector(selector);

            session = {
                alive: true,
                host,
                shadow,
                element,
                scroll: part('.tr-scroll'),
                body: part('.tr-body'),
                article: null,
                url: keyOf(location.href),
                focus: document.activeElement,
                release: null,
            };
            const mine = session;

            dress(mine, { theme: Theme.pageTheme(), skin: 'default' });
            document.body.appendChild(host);
            mine.release = holdPage();
            show(mine, article, counted, { force });
            // Shown once its styles are in: unstyled for a frame, it would be
            // the article as the browser's defaults set it, flashing.
            sheetOf(loadStyles).then((text) => {
                if (!mine.alive) return;
                const sheet = new CSSStyleSheet();
                sheet.replaceSync(text);
                shadow.adoptedStyleSheets = [sheet];
                requestAnimationFrame(() => element.classList.remove('is-still'));
            });

            part('.tr-close').addEventListener('click', close);
            element.addEventListener('click', (event) => onClick(mine, event));
            // The page's own shortcuts stop at the reader: a key pressed in
            // here is the reader's, or the browser's. Ours are on window's
            // capture phase, ahead of this, and still run.
            host.addEventListener('keydown', (event) => event.stopPropagation());
            document.addEventListener('keydown', onKey, true);
            window.addEventListener('popstate', onPopState);

            Theme.appearance().then((look) => {
                if (mine.alive) dress(mine, look);
            }).catch(() => {});
            mine.scroll.focus({ preventScroll: true });
            return true;
        }

        function dress(mine, look) {
            Theme.dress(mine.element, look);
            const [ground, ink] = GROUND[look.theme] || GROUND.light;
            mine.host.style.setProperty('background', ground, 'important');
            mine.host.style.setProperty('color', ink, 'important');
            try {
                for (const name of ['newsprint', 'parchment']) {
                    mine.element.style.setProperty(`--rd-tex-${name}`, `url("${chrome.runtime.getURL(`textures/${name}.png`)}")`);
                }
            } catch (_) {
                // The extension reloaded under this page: plain paper it is.
            }
        }

        // ----------------------------------------------------- drawing

        /** Draw `article` in the open reader: the head, the body, the foot. */
        function show(mine, article, counted = measure(article.body.textContent), { force = false } = {}) {
            mine.article = article;
            mine.key = article.key || keyOf(article.url);
            const esc = Dom.escapeHtml;
            const element = mine.element;
            element.querySelector('.tr-where').textContent = article.siteName || '';
            const column = element.querySelector('.tr-article');
            if (article.lang) column.setAttribute('lang', article.lang);
            else column.removeAttribute('lang');
            if (article.dir) column.setAttribute('dir', article.dir);
            else column.removeAttribute('dir');

            const when = dateLabel(article.published, article.lang);
            const facts = [article.byline, when, `${counted.minutes} min read`].filter(Boolean).map(esc).join(' <span class="tr-dot">·</span> ');
            const dek = article.description && !squash(article.body.textContent.slice(0, 600)).includes(squash(article.description).slice(0, 80))
                ? `<p class="tr-dek">${esc(article.description)}</p>` : '';
            element.querySelector('.tr-head').innerHTML = `
                ${article.kicker ? `<p class="tr-kicker">${esc(article.kicker)}</p>` : ''}
                <h1 class="tr-title">${esc(article.title || document.title || 'Untitled')}</h1>
                ${dek}
                <p class="tr-byline">${facts}</p>
                ${article.hero ? `<figure class="tr-hero"><img src="${Dom.escapeAttr(article.hero)}" alt="" decoding="async"></figure>` : ''}`;

            const body = mine.body;
            body.textContent = '';
            if (counted.words < MIN_WORDS && !force) {
                body.innerHTML = `<div class="tr-thin"><p>This page does not look like an article — ${counted.words} words to read.</p>
                    <button type="button" class="tr-anyway">Open anyway</button></div>`;
                body.querySelector('.tr-anyway').addEventListener('click', () => show(mine, article, counted, { force: true }));
            } else {
                body.appendChild(article.body);
            }

            const host = (() => { try { return new URL(article.url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
            element.querySelector('.tr-foot').innerHTML = host
                ? `<a class="tr-source" href="${Dom.safeUrlAttr(article.url)}">${ICON.out}<span>${esc(host)}</span></a>` : '';
            mine.scroll.scrollTop = 0;
        }

        const squash = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

        // ------------------------------------------------------ keys

        function onClick(mine, event) {
            const source = event.target.closest('.tr-source');
            // The source of an article read where it was opened is the page
            // right under the reader: closing is the way there.
            if (source && keyOf(source.href) === mine.url) {
                event.preventDefault();
                close();
            }
        }

        function onKey(event) {
            const mine = session;
            if (!mine || event.defaultPrevented) return;
            // Focus inside the shadow root reads, from outside, as the host.
            const active = mine.shadow.activeElement;
            const typing = active && (/^(TEXTAREA|INPUT|SELECT)$/.test(active.tagName) || active.isContentEditable);
            if (event.key === 'Escape') {
                event.stopPropagation();
                if (typing) active.blur();
                else close();
            }
        }

        /** A navigation of the page's own (an app moving to another page) leaves the reader behind. */
        function onPopState() {
            const mine = session;
            if (mine && keyOf(location.href) !== mine.url) close();
        }

        // ------------------------------------------------- the settings

        /** A setting changed: the skin follows without the reader closing. */
        function refresh() {
            const mine = session;
            if (!mine) return;
            Theme.appearance().then((look) => {
                if (mine.alive) dress(mine, look);
            }).catch(() => {});
        }

        /** Close from anywhere. Idempotent, and leaves the page as it found it. */
        function close() {
            if (!session) return;
            const done = session;
            done.alive = false;
            session = null;
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('popstate', onPopState);
            done.host.remove();
            if (done.release) done.release();
            if (done.focus && done.focus.isConnected && typeof done.focus.focus === 'function') {
                try { done.focus.focus({ preventScroll: true }); } catch (_) { /* not focusable any more */ }
            }
        }

        function toggle(options) {
            if (!session) return open(options);
            close();
            return false;
        }

        return {
            open, close, toggle, refresh,
            get isOpen() { return !!session; },
            /** For the specs: the shadow root is closed to everyone else. */
            get element() { return session ? session.element : null; },
            get host() { return session ? session.host : null; },
        };
    }

    const ArticleReader = { createArticleReader, measure, keyOf, dateLabel, ROOT_ID, OPEN_CLASS, MIN_WORDS, SHEET };

    root.BB = root.BB || {};
    root.BB.ArticleReader = ArticleReader;
    if (typeof module !== 'undefined' && module.exports) module.exports = ArticleReader;
})(typeof globalThis !== 'undefined' ? globalThis : this);
