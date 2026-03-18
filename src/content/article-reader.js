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
    const ArticleHighlights = ns.ArticleHighlights || req('./article-highlights.js');

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

    /** How far down the column has to go before the bar steps out of the way. */
    const BAR_HIDE_AFTER = 120;
    /** The contents rail's width, and the room either side of the column it needs before it is drawn. */
    const RAIL = 220;
    const RAIL_GAP = 40;
    /** Where a heading lands when it is jumped to: under the bar, not behind it. */
    const LANDING = 72;
    /** How long the pointer rests on a footnote's mark before its note opens, and outlives leaving it. */
    const POP_SHOW_MS = 300;
    const POP_HIDE_MS = 250;
    /** The prefix ArticleClean puts on the page's ids, and so on every link within the article. */
    const OWN_LINK = '#bbr-';
    /** How long a toast, and its Undo, stays up. */
    const TOAST_MS = 5000;

    /**
     * The typography settings, each clamped to what its control offers, as
     * the YouTube reader clamps the same three. The size is the setting
     * plus two — prose wants to be larger than a transcript set beside a
     * video — and the line length is in ems of 16px, so a larger size puts
     * fewer words on a line rather than widening the column off the screen.
     */
    const TYPE = Object.freeze({
        readerFontSize: Object.freeze({ min: 12, max: 24 }),
        readerLineHeight: Object.freeze({ min: 1.2, max: 2 }),
        readerLineWidth: Object.freeze({ min: 30, max: 60 }),
    });

    function typeOf(settings) {
        const value = (key) => {
            const { min, max } = TYPE[key];
            const number = Number(settings && settings[key]);
            return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : Settings.DEFAULTS[key];
        };
        return { size: value('readerFontSize') + 2, lead: value('readerLineHeight'), measure: value('readerLineWidth') * 16 };
    }

    /** The faces Settings › Reader offers besides the skin's own. */
    const FONTS = Object.freeze({
        serif: "Charter, 'Bitstream Charter', 'Iowan Old Style', 'Source Serif Pro', Georgia, Cambria, serif",
        sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    });

    const ICON = Object.freeze({
        close: Icons.svg('x', { size: 18 }),
        contents: Icons.svg('list', { size: 18 }),
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
            <div class="tr-progress" aria-hidden="true"><span></span></div>
            <header class="tr-bar">
                <button type="button" class="tr-btn tr-toc-btn" title="Contents" aria-label="Contents" aria-expanded="false" hidden>${ICON.contents}</button>
                <span class="tr-where"></span>
                <span class="tr-flex"></span>
                <div class="tr-tools"></div>
                <button type="button" class="tr-btn tr-close" title="Close the reader (Esc)" aria-label="Close the reader">${ICON.close}</button>
            </header>
            <div class="tr-scroll" tabindex="-1">
                <div class="tr-page">
                    <nav class="tr-toc" aria-label="Contents" hidden></nav>
                    <article class="tr-article">
                        <header class="tr-head"></header>
                        <div class="tr-body"></div>
                        <footer class="tr-foot"></footer>
                    </article>
                    <aside class="tr-aside"><section class="tr-glance" hidden></section><section class="tr-marks" aria-label="Highlights"></section></aside>
                </div>
            </div>
            <div class="tr-toast" role="status" aria-live="polite" hidden><span class="tr-toast-text"></span><button
                 type="button" class="tr-toast-undo">Undo</button></div>`;
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

        /**
         * The highlights of every article read in this page, by key — the
         * page's own article, and on Wikipedia each one reached from it —
         * with each article's title, address and text, so Copy can quote
         * and link them all. Held as long as the page is; never stored.
         */
        const kept = new Map();

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
                article = adapter.read(document, location.href, settings());
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
                // What the article shown was read from, to read it again when its layout changes.
                source: { doc: document, url: location.href },
                focus: document.activeElement,
                lastTop: 0,
                headings: [],
                current: -1,
                frame: 0,
                release: null,
            };
            const mine = session;

            dress(mine, { theme: themeOf(), skin: 'default' });
            applyType(mine);
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
            part('.tr-toast-undo').addEventListener('click', () => {
                const undo = mine.undo;
                hideToast(mine);
                if (undo) undo();
            });
            part('.tr-toc-btn').addEventListener('click', () => setToc(mine, !element.classList.contains('is-toc-open')));
            part('.tr-toc').addEventListener('click', (event) => {
                const link = event.target.closest('a[data-at]');
                if (!link) return;
                event.preventDefault();
                jumpTo(mine, mine.headings[Number(link.dataset.at)]);
                setToc(mine, false);
            });
            mine.scroll.addEventListener('scroll', () => onScroll(mine), { passive: true });
            mine.body.addEventListener('pointerover', (event) => onHover(mine, event));
            mine.body.addEventListener('pointerout', (event) => onLeave(mine, event));
            element.addEventListener('mousemove', (event) => { if (event.clientY < 48) setBar(mine, true); }, { passive: true });
            element.addEventListener('click', (event) => onClick(mine, event));
            // The rail is drawn only where there is room beside the column,
            // and the room changes with the window and with the measure.
            mine.resize = new ResizeObserver(() => fit(mine));
            mine.resize.observe(mine.scroll);
            // The page's own shortcuts stop at the reader: a key pressed in
            // here is the reader's, or the browser's. Ours are on window's
            // capture phase, ahead of this, and still run.
            host.addEventListener('keydown', (event) => event.stopPropagation());
            document.addEventListener('keydown', onKey, true);
            document.addEventListener('keyup', onKeyUp, true);
            window.addEventListener('blur', onBlur);
            window.addEventListener('popstate', onPopState);

            Theme.appearance().then((look) => {
                if (!mine.alive) return;
                dress(mine, { ...look, theme: themeOf() });
            }).catch(() => {});
            mine.scroll.focus({ preventScroll: true });
            // What a site adds to its articles (Wikipedia's, src/content/wiki-ui.js).
            mine.enhanced = adapter.enhance ? adapter.enhance(apiOf(mine)) || null : null;
            return true;
        }

        /**
         * The reader as a site's own module sees it: the article shown, the
         * means to show another in its place, and the reader's own pieces —
         * its bar, its popovers, its toast. Held only while this reader is
         * open: `alive` says when it no longer is.
         */
        function apiOf(mine) {
            return {
                get alive() { return mine.alive; },
                get element() { return mine.element; },
                get body() { return mine.body; },
                get scroll() { return mine.scroll; },
                get article() { return mine.article; },
                tools: mine.element.querySelector('.tr-tools'),
                settings,
                notify,
                /** Another page read the way this one was, by the same adapter. */
                read: (doc, url) => adapter.read(doc, url, settings()),
                copyText: (text) => Promise.resolve(copyText ? copyText(text) : false),
                /** Another article in this one's place, read from `source` — `{ doc, url }` — and drawn at its top. */
                show(article, source) {
                    if (!mine.alive) return;
                    hidePop(mine);
                    if (source) mine.source = source;
                    show(mine, article);
                },
                jumpTo: (target) => jumpTo(mine, target),
                popover: {
                    show: (anchor, content, options) => showPop(mine, anchor, content, options),
                    hide: () => hidePop(mine),
                    /** Let go of the card beside `anchor` in a moment, unless the pointer is on its way into it. */
                    hideSoon: (anchor) => { if (mine.pop && mine.pop.anchor === anchor) hidePopSoon(mine); },
                },
                toast: (text, undo) => showToast(mine, text, undo),
                close,
            };
        }

        /** The theme Settings › Reader asks for: the page's own, or day or night whatever the page is. */
        function themeOf() {
            const chosen = settings().readerTheme;
            return chosen === 'light' || chosen === 'dark' ? chosen : Theme.pageTheme();
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

        function applyType(mine) {
            const now = settings();
            const type = typeOf(now);
            const style = mine.element.style;
            style.setProperty('--tr-size', `${type.size}px`);
            style.setProperty('--tr-lead', String(type.lead));
            style.setProperty('--tr-measure', `${type.measure}px`);
            const face = FONTS[now.readerFont];
            if (face) style.setProperty('--tr-font', face);
            else style.removeProperty('--tr-font');
            const warmth = Math.min(60, Math.max(0, Number(now.readerWarmth) || 0));
            style.setProperty('--tr-warmth', `${warmth}%`);
            mine.element.classList.toggle('is-dimming', now.readerDimImages !== false);
        }

        // ----------------------------------------------------- drawing

        /** Draw `article` in the open reader: the head, the body, the foot. */
        function show(mine, article, counted = measure(article.body.textContent), { force = false } = {}) {
            mine.article = article;
            mine.key = article.key || keyOf(article.url);
            const esc = Dom.escapeHtml;
            const element = mine.element;
            element.dataset.kind = article.kind || 'article';
            element.classList.toggle('hide-cites', !!(article.meta && article.meta.hideCitations));
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
            // The pen is on the article it was made for, which is about to go.
            if (mine.hl) {
                mine.hl.destroy();
                mine.hl = null;
            }
            body.textContent = '';
            mine.thin = counted.words < MIN_WORDS && !force;
            if (mine.thin) {
                body.innerHTML = `<div class="tr-thin"><p>This page does not look like an article — ${counted.words} words to read.</p>
                    <button type="button" class="tr-anyway">Open anyway</button></div>`;
                body.querySelector('.tr-anyway').addEventListener('click', () => show(mine, article, counted, { force: true }));
            } else {
                body.appendChild(article.body);
            }

            mine.glance = null;
            element.querySelector('.tr-glance').textContent = '';
            if (article.aside && !mine.thin) {
                mine.glance = document.createElement('div');
                mine.glance.className = 'tr-glance-box';
                mine.glance.appendChild(article.aside);
            }

            const host = (() => { try { return new URL(article.url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
            element.querySelector('.tr-foot').innerHTML = host
                ? `<a class="tr-source" href="${Dom.safeUrlAttr(article.url)}">${ICON.out}<span>${esc(host)}</span></a>` : '';
            mine.scroll.scrollTop = 0;
            buildToc(mine);
            arm(mine);
            onScroll(mine);
        }

        // --------------------------------------------------- highlights

        /**
         * The pen on the article shown, as Settings › Reader has it: on, it
         * draws again whatever was highlighted in this article before; off,
         * there is no pen, and what was highlighted waits for it to be back.
         */
        function arm(mine) {
            const want = settings().readerHighlight !== false && !mine.thin;
            if (mine.hl && (!want || mine.hl.key !== mine.key)) {
                mine.hl.destroy();
                mine.hl = null;
            }
            if (!want || mine.hl) return;
            const key = mine.key;
            const article = mine.article;
            mine.hl = ArticleHighlights.createHighlights({
                element: mine.element,
                body: mine.body,
                aside: mine.element.querySelector('.tr-marks'),
                tools: mine.element.querySelector('.tr-tools'),
                selection: () => selectionOf(mine),
                toast: (text, undo) => showToast(mine, text, undo),
                copyText: (text) => Promise.resolve(copyText ? copyText(text) : false),
                jumpTo: (target) => jumpTo(mine, target),
                article: () => ({ url: article.url, title: article.title, all: () => [...kept.values()] }),
                onChange: (marks, text) => {
                    if (marks.length) kept.set(key, { title: article.title, url: article.url, text, marks });
                    else kept.delete(key);
                },
            });
            mine.hl.key = key;
            mine.hl.load(kept.has(key) ? kept.get(key).marks : []);
        }

        /**
         * What is selected in the article. The reader is in a shadow root,
         * which Chrome answers for itself; elsewhere the document's selection
         * is asked for the ranges inside it.
         */
        function selectionOf(mine) {
            if (mine.shadow.getSelection) {
                const sel = mine.shadow.getSelection();
                return sel ? { range: sel.rangeCount ? sel.getRangeAt(0) : null, clear: () => sel.removeAllRanges() } : null;
            }
            const sel = document.getSelection();
            if (!sel) return null;
            let range = null;
            try { [range] = sel.getComposedRanges({ shadowRoots: [mine.shadow] }); } catch (_) { range = null; }
            return { range: range || null, clear: () => sel.removeAllRanges() };
        }

        /** Inside the reader rather than the page's toast: it carries an Undo, which belongs where the ink went on. */
        function showToast(mine, text, undo) {
            const toast = mine.element.querySelector('.tr-toast');
            toast.querySelector('.tr-toast-text').textContent = text;
            toast.querySelector('.tr-toast-undo').hidden = !undo;
            mine.undo = undo || null;
            toast.hidden = false;
            clearTimeout(mine.toastTimer);
            mine.toastTimer = setTimeout(() => hideToast(mine), TOAST_MS);
        }

        function hideToast(mine) {
            clearTimeout(mine.toastTimer);
            mine.undo = null;
            mine.element.querySelector('.tr-toast').hidden = true;
        }

        // ---------------------------------------------- the contents rail

        /**
         * The article's sections, from its own h2s and h3s, beside the column
         * when the window has room for them and behind the bar's button when
         * it does not. A heading without an id is given one, so a section can
         * be jumped to; a heading folded away in end matter is not listed.
         */
        function buildToc(mine) {
            mine.headings = [...mine.body.querySelectorAll('h2, h3')].filter((h) => !h.closest('details') && h.textContent.trim());
            mine.headings.forEach((h, i) => { if (!h.id) h.id = `bbr-section-${i}`; });
            const toc = mine.element.querySelector('.tr-toc');
            const enough = mine.headings.length >= 2;
            toc.innerHTML = enough ? `<p class="tr-toc-title">Contents</p><ol>${mine.headings.map((h, i) => `
                <li class="is-${h.tagName.toLowerCase()}"><a href="#${Dom.escapeAttr(h.id)}" data-at="${i}">${Dom.escapeHtml(h.textContent.trim())}</a></li>`).join('')}</ol>` : '';
            mine.element.classList.toggle('has-toc', enough);
            mine.current = -1;
            fit(mine);
        }

        /** The rail beside the column if it fits there, the bar's button if it does not. */
        function fit(mine) {
            if (!mine.alive) return;
            const measure = parseFloat(mine.element.style.getPropertyValue('--tr-measure')) || 704;
            const wide = mine.scroll.clientWidth >= measure + 2 * (RAIL + RAIL_GAP) + 48;
            mine.element.classList.toggle('is-wide', wide);
            if (wide) mine.element.classList.remove('is-toc-open');
            showToc(mine);
            placeGlance(mine);
        }

        /**
         * An article's "at a glance" card — Wikipedia's infobox — beside the
         * column where there is room and its adapter asks for it there, else
         * folded under the article's first paragraph. Folded, it is in the
         * article but not of its text: a highlight counts no word of it.
         */
        function placeGlance(mine) {
            const box = mine.glance;
            const rail = mine.element.querySelector('.tr-glance');
            const side = !!box && mine.article.asidePlace !== 'fold' && mine.element.classList.contains('is-wide');
            let fold = mine.body.querySelector(':scope > .tr-glance-fold');
            if (box && side && box.parentNode !== rail) {
                rail.innerHTML = `<p class="tr-glance-title">${Dom.escapeHtml(mine.article.asideTitle || 'At a glance')}</p>`;
                rail.appendChild(box);
            } else if (box && !side && !(fold && fold.contains(box))) {
                if (!fold) {
                    fold = document.createElement('details');
                    fold.className = 'tr-glance-fold';
                    fold.innerHTML = `<summary>${Dom.escapeHtml(mine.article.asideTitle || 'At a glance')}</summary>`;
                    const lead = [...mine.body.children].find((el) => el.tagName === 'P' && el.textContent.trim());
                    if (lead) lead.after(fold);
                    else mine.body.prepend(fold);
                }
                fold.appendChild(box);
            }
            if (side && fold) fold.remove();
            rail.hidden = !side;
            mine.element.classList.toggle('has-glance', side);
        }

        function setToc(mine, open) {
            mine.element.classList.toggle('is-toc-open', open);
            showToc(mine);
        }

        function showToc(mine) {
            const { classList } = mine.element;
            const has = classList.contains('has-toc');
            const wide = classList.contains('is-wide');
            const open = classList.contains('is-toc-open');
            mine.element.querySelector('.tr-toc').hidden = !has || (!wide && !open);
            const button = mine.element.querySelector('.tr-toc-btn');
            button.hidden = !has || wide;
            button.setAttribute('aria-expanded', String(open));
        }

        /** The column scrolled so `target` is just under the bar. Never scrollIntoView, which scrolls the page under the reader too. */
        function jumpTo(mine, target) {
            if (!target) return;
            // Into folded end matter: the fold opens first, or there is nothing to see.
            for (let fold = target.closest('details'); fold; fold = fold.parentElement && fold.parentElement.closest('details')) fold.open = true;
            const scroll = mine.scroll;
            const top = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - LANDING;
            const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            scroll.scrollTo({ top: Math.max(0, top), behavior: still ? 'auto' : 'smooth' });
        }

        /** The section being read: the last heading the top of the column has passed. */
        function markSection(mine) {
            const line = mine.scroll.getBoundingClientRect().top + LANDING + 24;
            let at = -1;
            for (let i = 0; i < mine.headings.length; i++) {
                if (mine.headings[i].getBoundingClientRect().top > line) break;
                at = i;
            }
            if (at === mine.current) return;
            mine.current = at;
            const toc = mine.element.querySelector('.tr-toc');
            toc.querySelectorAll('a[data-at]').forEach((link) => link.classList.toggle('is-on', Number(link.dataset.at) === at));
            const on = toc.querySelector('a.is-on');
            // The rail scrolled by hand, for jumpTo's reason.
            if (on && (on.offsetTop < toc.scrollTop || on.offsetTop > toc.scrollTop + toc.clientHeight - 40)) {
                toc.scrollTop = on.offsetTop - toc.clientHeight / 2;
            }
        }

        /** `[` and `]`: back to the start of the section being read, or on to the next one. */
        function step(mine, by) {
            const own = mine.headings[mine.current];
            const into = own && own.getBoundingClientRect().top < mine.scroll.getBoundingClientRect().top + LANDING - 8;
            if (by < 0 && into) return jumpTo(mine, own);
            jumpTo(mine, mine.headings[Math.min(mine.headings.length - 1, Math.max(0, mine.current + by))]);
            return undefined;
        }

        // ------------------------------------------------- the bar

        /**
         * The bar steps up out of the way as the column is read down, and
         * comes back on the way up or when the pointer goes to the top. The
         * hairline over it is how far through the article the column is.
         * One frame's work per frame, however many scroll events it brings.
         */
        function onScroll(mine) {
            if (mine.pop) hidePop(mine);
            if (mine.hl) mine.hl.onScroll();
            if (mine.frame) return;
            mine.frame = requestAnimationFrame(() => {
                mine.frame = 0;
                if (!mine.alive) return;
                const scroll = mine.scroll;
                const top = scroll.scrollTop;
                const room = scroll.scrollHeight - scroll.clientHeight;
                mine.element.querySelector('.tr-progress span').style.transform = `scaleX(${room > 0 ? Math.min(1, top / room) : 1})`;
                if (top < BAR_HIDE_AFTER) setBar(mine, true);
                else if (top > mine.lastTop + 4) setBar(mine, false);
                else if (top < mine.lastTop - 4) setBar(mine, true);
                mine.lastTop = top;
                markSection(mine);
            });
        }

        function setBar(mine, shown) {
            mine.element.classList.toggle('is-bar-hidden', !shown);
        }

        // ------------------------------------------------------ popovers

        /**
         * A card beside the link it belongs to, over the column: a footnote's
         * note, so reading it does not mean leaving the sentence. One at a
         * time, below the link or above it where there is no room below, and
         * gone as soon as the column moves.
         */
        function showPop(mine, anchor, content, { kind = 'note' } = {}) {
            hidePop(mine);
            const pop = document.createElement('div');
            pop.className = `tr-pop is-${kind}`;
            pop.setAttribute('role', 'tooltip');
            pop.appendChild(content);
            mine.element.appendChild(pop);
            const box = mine.element.getBoundingClientRect();
            const at = anchor.getBoundingClientRect();
            const width = Math.min(380, box.width - 24);
            pop.style.width = `${width}px`;
            pop.style.left = `${Math.max(12, Math.min(at.left - box.left + at.width / 2 - width / 2, box.width - width - 12))}px`;
            const below = at.bottom - box.top + 8;
            const above = at.top - box.top - pop.offsetHeight - 8;
            pop.style.top = `${below + pop.offsetHeight > box.height - 12 && above > 12 ? above : below}px`;
            pop.addEventListener('pointerenter', () => clearTimeout(mine.popTimer));
            pop.addEventListener('pointerleave', () => hidePopSoon(mine));
            mine.pop = { el: pop, anchor };
            return pop;
        }

        function hidePop(mine) {
            clearTimeout(mine.popTimer);
            if (mine.pop) mine.pop.el.remove();
            mine.pop = null;
        }

        function hidePopSoon(mine) {
            clearTimeout(mine.popTimer);
            mine.popTimer = setTimeout(() => hidePop(mine), POP_HIDE_MS);
        }

        /**
         * The note a link points to, when the link is a footnote's mark: a
         * superscript, or a link of a few characters — "1", "[2]", "*" — to
         * something in the article that is not a heading. Any other link
         * within the article is a place to go, not a note to read.
         */
        function noteOf(mine, link) {
            const href = (link && link.getAttribute('href')) || '';
            if (!href.startsWith(OWN_LINK)) return null;
            let target = null;
            try { target = mine.body.querySelector(`#${CSS.escape(href.slice(1))}`); } catch (_) { return null; }
            if (!target || /^H[1-6]$/.test(target.tagName) || target.contains(link)) return null;
            return link.closest('sup') || link.textContent.trim().length <= 4 ? target : null;
        }

        /** A note's copy for its card: no ids, and without the way back to the mark it is already beside. */
        function noteCard(target) {
            const copy = target.cloneNode(true);
            copy.removeAttribute('id');
            copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
            copy.querySelectorAll(`a[href^="${OWN_LINK}"]`).forEach((a) => {
                if (/^[\s^↑↩⤴a-z]{0,3}$/u.test(a.textContent)) a.remove();
            });
            const card = document.createElement('div');
            card.className = 'tr-pop-body';
            // A list item's content rather than the item: out of its list it draws a bullet.
            if (copy.tagName === 'LI') while (copy.firstChild) card.appendChild(copy.firstChild);
            else card.appendChild(copy);
            return card;
        }

        /** A pointer resting on a footnote's mark opens its note; a touch has the click for that. */
        function onHover(mine, event) {
            if (event.pointerType && event.pointerType !== 'mouse') return;
            const link = event.target.closest('a[href]');
            const note = noteOf(mine, link);
            if (!note) return;
            clearTimeout(mine.hoverTimer);
            if (mine.pop && mine.pop.anchor === link) {
                clearTimeout(mine.popTimer);
                return;
            }
            mine.hoverTimer = setTimeout(() => { if (mine.alive) showPop(mine, link, noteCard(note)); }, POP_SHOW_MS);
        }

        function onLeave(mine, event) {
            const link = event.target.closest('a[href]');
            if (!link || (event.relatedTarget && link.contains(event.relatedTarget))) return;
            clearTimeout(mine.hoverTimer);
            if (mine.pop && mine.pop.anchor === link) hidePopSoon(mine);
        }

        const squash = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

        // ------------------------------------------------------ keys

        function onClick(mine, event) {
            // The contents sheet, on a narrow window, goes at a click anywhere else.
            if (mine.element.classList.contains('is-toc-open') && !event.target.closest('.tr-toc, .tr-toc-btn')) setToc(mine, false);
            // A footnote's mark opens its note, and a click on it again
            // closes it; any other link within the article scrolls the
            // column there, rather than the page under the reader — from the
            // glance card or a note as much as from the text: followed, an
            // in-page link would write our id into the page's own address.
            const own = !event.defaultPrevented && event.target.closest(`a[href^="${OWN_LINK}"]`);
            if (own) {
                event.preventDefault();
                const note = noteOf(mine, own);
                clearTimeout(mine.hoverTimer);
                if (note && mine.pop && mine.pop.anchor === own) hidePop(mine);
                else if (note) showPop(mine, own, noteCard(note));
                else {
                    let target = null;
                    try { target = mine.body.querySelector(`#${CSS.escape(own.getAttribute('href').slice(1))}`); } catch (_) { /* no such id */ }
                    jumpTo(mine, target);
                }
                return;
            }
            if (mine.pop && !event.target.closest('.tr-pop')) hidePop(mine);
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
            // Something over the article — a picture, large — has the keys to itself.
            if (mine.element.classList.contains('has-modal')) return;
            if (event.key === 'Alt') {
                if (mine.hl) mine.hl.setAlt(true);
                return;
            }
            // Focus inside the shadow root reads, from outside, as the host.
            const active = mine.shadow.activeElement;
            const typing = active && (/^(TEXTAREA|INPUT|SELECT)$/.test(active.tagName) || active.isContentEditable);
            if (event.key === 'Escape') {
                event.stopPropagation();
                if (typing) active.blur();
                else if (mine.hl && mine.hl.escape()) return;
                else if (mine.pop) hidePop(mine);
                else if (mine.element.classList.contains('is-toc-open')) setToc(mine, false);
                else close();
                return;
            }
            if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
            if ((event.key === 'Backspace' || event.key === 'Delete') && mine.hl && mine.hl.removePicked()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (event.key === '[' || event.key === ']') {
                event.preventDefault();
                event.stopPropagation();
                step(mine, event.key === ']' ? 1 : -1);
            }
        }

        function onKeyUp(event) {
            if (session && session.hl && event.key === 'Alt') session.hl.setAlt(false);
        }

        function onBlur() {
            if (session && session.hl) session.hl.setAlt(false);
        }

        /** A navigation of the page's own (an app moving to another page) leaves the reader behind. */
        function onPopState(event) {
            const mine = session;
            if (!mine) return;
            // A site that moves between its own articles inside the reader
            // answers its own Back and Forward.
            if (mine.enhanced && mine.enhanced.popstate && mine.enhanced.popstate(event)) return;
            if (keyOf(location.href) !== mine.url) close();
        }

        // ------------------------------------------------- the settings

        /** A setting changed: the type, the theme and the skin follow without the reader closing. */
        function refresh() {
            const mine = session;
            if (!mine) return;
            applyType(mine);
            // A setting that changes what the article shows — Wikipedia's
            // infobox, its citations — draws it again, where it was.
            if (adapter.layoutOf && adapter.layoutOf(settings()) !== mine.article.layout) {
                const next = adapter.read(mine.source.doc, mine.source.url, settings());
                if (next) {
                    const top = mine.scroll.scrollTop;
                    show(mine, next);
                    mine.scroll.scrollTop = top;
                }
            }
            arm(mine);
            Theme.appearance().then((look) => {
                if (mine.alive) dress(mine, { ...look, theme: themeOf() });
            }).catch(() => {});
        }

        /** Close from anywhere. Idempotent, and leaves the page as it found it. */
        function close() {
            if (!session) return;
            const done = session;
            done.alive = false;
            session = null;
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('popstate', onPopState);
            clearTimeout(done.toastTimer);
            if (done.resize) done.resize.disconnect();
            cancelAnimationFrame(done.frame);
            clearTimeout(done.hoverTimer);
            clearTimeout(done.popTimer);
            done.host.remove();
            if (done.release) done.release();
            if (done.focus && done.focus.isConnected && typeof done.focus.focus === 'function') {
                try { done.focus.focus({ preventScroll: true }); } catch (_) { /* not focusable any more */ }
            }
            if (done.enhanced && done.enhanced.closed) done.enhanced.closed();
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
            get highlights() { return session ? session.hl : null; },
        };
    }

    const ArticleReader = { createArticleReader, measure, keyOf, dateLabel, typeOf, TYPE, FONTS, ROOT_ID, OPEN_CLASS, MIN_WORDS, SHEET };

    root.BB = root.BB || {};
    root.BB.ArticleReader = ArticleReader;
    if (typeof module !== 'undefined' && module.exports) module.exports = ArticleReader;
})(typeof globalThis !== 'undefined' ? globalThis : this);
