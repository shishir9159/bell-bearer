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
 * What Settings › Wikipedia shows is decided here: the infobox beside the
 * article as an "at a glance" card, folded under its first paragraph, or
 * not at all; the citation marks, quiet, or none. End matter — References,
 * Notes, See also, External links — is folded away at the article's end, its
 * footnotes still a hover away from their marks.
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
    /** Classes the reader acts on: what is safe to turn light on dark, a formula, a citation mark and the list it points into. */
    const KEEP_CLASS = /^(skin-invert(-image)?|mwe-math-fallback-image-(inline|display)|reference|references)$/;

    /**
     * End matter by the English names of its sections. In any other
     * language a section is end matter by what is in it — mostly footnotes,
     * or mostly lists of links — so the rule does not depend on these.
     */
    const END_MATTER = /^(References|Notes|Notes_and_references|Footnotes|Citations|Sources|Works_cited|Bibliography|Further_reading|External_links|See_also)$/i;
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

    /** What of Settings › Wikipedia changes the article drawn: the reader draws it again when this does. */
    const layoutOf = (settings = {}) => `${settings.wikipediaInfobox || 'side'}|${settings.wikipediaCitations !== false}`;

    function isEndMatter(heading, run) {
        if (END_MATTER.test(heading.id.replace(/^bbr-/, ''))) return true;
        const length = run.reduce((sum, one) => sum + (one.textContent || '').trim().length, 0);
        if (!length) return false;
        let notes = 0;
        let links = 0;
        let lists = false;
        for (const one of run) {
            if (one.nodeType !== 1) continue;
            for (const list of [one, ...one.querySelectorAll('ol.references')]) if (list.matches('ol.references')) notes += list.textContent.length;
            for (const a of one.querySelectorAll('a')) links += a.textContent.length;
            lists = lists || /^(UL|OL)$/.test(one.tagName);
        }
        return notes / length > 0.5 || (lists && links / length > 0.6);
    }

    /**
     * Each end-matter section folded into a <details> under its own name,
     * which keeps its heading's id: a footnote's mark still finds its note
     * in there, and the reader opens it when a link goes to one.
     */
    function foldEndMatter(body) {
        for (const heading of [...body.children].filter((el) => el.tagName === 'H2')) {
            const run = [];
            for (let next = heading.nextSibling; next && !(next.nodeType === 1 && next.tagName === 'H2'); next = next.nextSibling) run.push(next);
            if (!isEndMatter(heading, run)) continue;
            const details = document.createElement('details');
            details.className = 'tr-end';
            const summary = document.createElement('summary');
            summary.textContent = heading.textContent.trim();
            if (heading.id) summary.id = heading.id;
            details.append(summary, ...run);
            heading.replaceWith(details);
        }
    }

    function read(doc = root.document, url = doc.baseURI, settings = {}) {
        if (!isArticle(doc)) return null;
        const content = find('content', doc);
        if (!content) return null;
        const canonical = doc.querySelector('link[rel="canonical"]');
        const where = (canonical && canonical.href) || String(url).split('#')[0];
        const options = {
            doc: root.document, base: where, drop: NOISE, keep: FORMULA, keepClass: KEEP_CLASS,
            keepId: (id) => !PARSOID_ID.test(id),
        };
        const body = ArticleClean.clean(content, options);
        foldEndMatter(body);
        const place = settings.wikipediaInfobox || 'side';
        const infobox = place !== 'hide' && content.querySelector('table.infobox');
        const aside = infobox ? ArticleClean.cleanNode(infobox, { ...options, drop: '.mw-editsection, .navbox, .noprint, .mw-empty-elt' }) : null;
        for (const part of [body, aside].filter(Boolean)) {
            part.querySelectorAll('img[class*="mwe-math"]').forEach((img) => {
                img.classList.add('tr-math');
                img.title = 'Copy as LaTeX';
            });
            // A picture's larger rendering, for the image viewer: Wikimedia
            // draws a thumbnail at whatever width its address asks for, up
            // to the original's own (past it, the viewer falls back).
            part.querySelectorAll('img[src*="/thumb/"]:not(.tr-math)').forEach((img) => {
                const full = img.getAttribute('src').replace(/\/\d+px-([^/?]+)(?:\?.*)?$/, '/1280px-$1');
                if (full !== img.getAttribute('src')) img.dataset.full = full;
            });
        }
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
            aside: aside && aside.firstChild ? aside : null,
            asidePlace: place,
            asideTitle: 'At a glance',
            layout: layoutOf(settings),
            meta: {
                revision: Number((/"wgRevisionId":(\d+)/.exec(configOf(doc)) || [])[1]) || null,
                hideCitations: settings.wikipediaCitations === false,
            },
        };
    }

    const adapter = { id: 'wikipedia', read, layoutOf };

    const WikiRead = { read, adapter, isArticle, keyOf, langOf, titleOf, layoutOf, foldEndMatter, isEndMatter, SELECTORS, NOISE };

    root.BB = root.BB || {};
    root.BB.WikiRead = WikiRead;
    if (typeof module !== 'undefined' && module.exports) module.exports = WikiRead;
})(typeof globalThis !== 'undefined' ? globalThis : this);
