/**
 * Reading a Wikipedia article into the text reader: Wikipedia's adapter.
 *
 * The article is `.mw-parser-output`, the same element under Vector 2022,
 * the older skins, Parsoid's read views and the mobile site; everything
 * around it — the menus, the sidebar, the footer — is the site, not the
 * article. Inside it, what Wikipedia adds for editors and for browsing the
 * encyclopedia is left behind: edit links, navigation boxes, maintenance
 * banners, the "for other uses" notes. What an article is written with stays.
 *
 * Two things are kept that the page hides. A formula is an image Wikipedia
 * hides from screen readers, beside MathML it hides from sight; the image is
 * the formula as it is meant to look, and its alt text is the LaTeX it was
 * written in. And the article's short description, hidden on the desktop
 * site, is the line under its title.
 *
 * One selector table, with the spellings of each skin, as every site's
 * reading here has.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Selectors = ns.Selectors || req('../shared/selectors.js');
    const ArticleClean = ns.ArticleClean || req('./article-clean.js');

    const SELECTORS = Object.freeze({
        content: ['#mw-content-text > .mw-parser-output', '#mw-content-text .mw-parser-output', '#bodyContent .mw-parser-output', '.mw-parser-output'],
        title: ['#firstHeading .mw-page-title-main', '#firstHeading', 'h1.firstHeading', '#section_0'],
        description: ['.shortdescription'],
        edited: ['#footer-info-lastmod', '.last-modified-bar', '#mw-mf-last-modified'],
    });
    const { find } = Selectors.table(SELECTORS);

    /** What Wikipedia puts inside an article that is not the article. */
    const NOISE = Object.freeze([
        '.mw-editsection', '.mw-empty-elt', '.navbox', '.navbox-styles', '.vertical-navbox', 'table.sidebar', '.navigation-not-searchable',
        '.hatnote', '.dablink', '.ambox', '.ombox', '.tmbox', '.cmbox', '.fmbox', '.imbox', '.mbox-small', '.metadata',
        '.sistersitebox', '.side-box', '.portalbox', '.portal-bar', '.authority-control', '.shortdescription', '.Z3988',
        '#coordinates', '.geo-default', '.mw-cite-backlink', '#toc', '.toc', '.mw-jump-link', '.catlinks', '.printfooter',
        '.infobox',
    ].join(', '));

    /** Kept, though the page hides it: a formula's picture. */
    const FORMULA = 'img.mwe-math-fallback-image-inline, img.mwe-math-fallback-image-display';
    /** Classes the reader acts on: what is safe to turn light on dark, and what is a formula. */
    const KEEP_CLASS = /^(skin-invert(-image)?|mwe-math-fallback-image-(inline|display))$/;
    /**
     * Parsoid gives nearly every element an id of its own — mwAQ, mwB_Q —
     * and nothing links to them; kept, each would be an anchor the cleaner
     * has to hold on to. A heading's or a footnote's id is a word, and stays.
     */
    const PARSOID_ID = /^mw[\w-]{2,6}$/;

    /** The page's configuration, as MediaWiki writes it into a script for its own code. */
    function configOf(doc) {
        for (const script of doc.querySelectorAll('script')) {
            const text = script.textContent || '';
            if (text.includes('wgRevisionId')) return text;
        }
        return '';
    }

    /** An article read, not edited or compared — and not the main page, which is no article. */
    function isArticle(doc) {
        const body = doc.body;
        if (!body || !body.classList.contains('ns-0')) return false;
        if (/"wgIsMainPage":true/.test(configOf(doc)) || body.classList.contains('page-Main_Page')) return false;
        return !/\baction-(?!view\b)/.test(body.className);
    }

    /** "en" of en.wikipedia.org and en.m.wikipedia.org alike. */
    function langOf(url) {
        try {
            const match = /^([\w-]+)(?:\.m)?\.wikipedia\.org$/.exec(new URL(url).hostname);
            return match ? match[1] : '';
        } catch (_) {
            return '';
        }
    }

    /** The article's title as its address spells it: underscores, decoded. */
    function titleOf(url) {
        try {
            const at = new URL(url);
            const path = /^\/wiki\/(.+)$/.exec(at.pathname);
            const raw = path ? decodeURIComponent(path[1]) : at.searchParams.get('title') || '';
            return raw.replace(/ /g, '_');
        } catch (_) {
            return '';
        }
    }

    /** One key for an article whichever of its addresses it was read at — the mobile site's too. */
    const keyOf = (url) => `wikipedia:${langOf(url)}:${titleOf(url)}`;

    function read(doc = root.document, url = doc.baseURI) {
        if (!isArticle(doc)) return null;
        const content = find('content', doc);
        if (!content) return null;
        const canonical = doc.querySelector('link[rel="canonical"]');
        const where = (canonical && canonical.href) || String(url).split('#')[0];
        const body = ArticleClean.clean(content, {
            doc: root.document, base: where, drop: NOISE, keep: FORMULA, keepClass: KEEP_CLASS,
            keepId: (id) => !PARSOID_ID.test(id),
        });
        body.querySelectorAll('img[class*="mwe-math"]').forEach((img) => img.classList.add('tr-math'));
        const heading = find('title', doc);
        const short = find('description', doc);
        const edited = /\bon (\d{1,2} \S+ \d{4}|\S+ \d{1,2}, \d{4})/.exec((find('edited', doc) || {}).textContent || '');
        return {
            key: keyOf(where),
            url: where,
            site: 'wikipedia',
            kind: 'wiki',
            title: heading ? heading.textContent.trim() : doc.title.replace(/\s[-–—]\s.*$/, ''),
            description: short ? short.textContent.trim() : '',
            byline: edited ? `Last edited ${edited[1]}` : '',
            siteName: 'Wikipedia',
            lang: content.getAttribute('lang') || doc.documentElement.getAttribute('lang') || '',
            dir: content.getAttribute('dir') || doc.documentElement.getAttribute('dir') || '',
            body,
            aside: null,
            meta: { revision: Number((/"wgRevisionId":(\d+)/.exec(configOf(doc)) || [])[1]) || null },
        };
    }

    const adapter = { id: 'wikipedia', read };

    const WikiRead = { read, adapter, isArticle, keyOf, langOf, titleOf, SELECTORS, NOISE };

    root.BB = root.BB || {};
    root.BB.WikiRead = WikiRead;
    if (typeof module !== 'undefined' && module.exports) module.exports = WikiRead;
})(typeof globalThis !== 'undefined' ? globalThis : this);
