/**
 * Finding the article on a page Bell Bearer has no adapter for, and what the
 * page says about it: its title, who wrote it, when, and where.
 *
 * Two ways to the body, in order. First the places pages put an article —
 * a table with several spellings, as every site's reading here has, since a
 * theme renames its classes as freely as a site does. A candidate counts by
 * the text in its paragraphs, and of those within a fifth of the best the
 * tightest wins: `main` holds the article and its sidebar, `article` the
 * article alone. A page that uses none of them is scored the way Readability
 * scores one — each paragraph votes for its parent and, by half, for its
 * grandparent — and the winner takes the siblings that scored near it.
 *
 * The metadata is read the way a page publishes it for link previews and
 * search engines: Open Graph, then JSON-LD, then the older meta names and
 * the page's own markup. None of it is required; a page with only a title
 * still reads.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const ArticleClean = ns.ArticleClean || req('./article-clean.js');

    /** Where pages put the article, most specific first. */
    const CANDIDATES = Object.freeze([
        '[itemprop="articleBody"]', '.entry-content', '.post-content', '.article-body', '.article-content', '.article__body',
        '.post-body', '.story-body', '#article-body', '.markdown-body', '.prose', 'main article', 'article',
        '[role="main"]', 'main', '#content', '#main',
    ]);

    /** What a page puts around and inside an article that is not the article. */
    const NOISE = Object.freeze([
        '[role="navigation"]', '[role="complementary"]', '[role="banner"]', '[role="contentinfo"]', '[role="dialog"]', '[role="alert"]',
        'header:has(h1)', '.share', '.shares', '.sharing', '.social', '.social-share', '.share-buttons', '.newsletter', '.subscribe',
        '.related', '.related-posts', '.recommended', '.more-stories', '.read-more', '.comments', '#comments', '.comment-list',
        '.advert', '.advertisement', '.ad', '.ads', '.ad-slot', '[class*="sponsor"]', '.promo', '.breadcrumbs', '.breadcrumb',
        '.toc', '#toc', '.table-of-contents', '.skip-link',
    ].join(', '));

    /** A candidate this full of paragraphs is an article; below it the page is scored instead. */
    const ENOUGH = 400;

    const NEGATIVE = /comment|meta|footer|footnote|sidebar|sponsor|share|related|promo|widget|popup|cookie|banner|subscribe|newsletter|social|masthead|menu|nav\b/i;
    const POSITIVE = /article|body|content|entry|main|page|post|text|blog|story|prose/i;

    const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

    function paraText(el) {
        let total = 0;
        for (const one of el.querySelectorAll('p, pre, blockquote')) total += textOf(one).length;
        return total;
    }

    function linkDensity(el) {
        const all = textOf(el).length;
        if (!all) return 1;
        let links = 0;
        for (const a of el.querySelectorAll('a')) links += textOf(a).length;
        return links / all;
    }

    function byCandidates(doc) {
        const found = [];
        for (const selector of CANDIDATES) {
            let list = [];
            try { list = doc.querySelectorAll(selector); } catch (_) { continue; }
            for (const el of list) {
                if (found.some((one) => one.el === el)) continue;
                const text = paraText(el);
                if (text >= ENOUGH && linkDensity(el) < 0.4) found.push({ el, text, size: textOf(el).length });
            }
        }
        if (!found.length) return null;
        const best = Math.max(...found.map((one) => one.text));
        return found.filter((one) => one.text >= best * 0.8).sort((a, b) => a.size - b.size)[0].el;
    }

    function weight(el) {
        let score = { DIV: 5, ARTICLE: 10, SECTION: 3, PRE: 3, TD: 3, BLOCKQUOTE: 3, FORM: -3, UL: -3, OL: -3, TH: -5 }[el.tagName] || 0;
        const names = `${el.getAttribute('class') || ''} ${el.id || ''}`;
        if (NEGATIVE.test(names)) score -= 25;
        if (POSITIVE.test(names)) score += 25;
        return score;
    }

    /** Readability's way, for a page with no landmark around its article: the parts, in page order. */
    function byScore(doc) {
        const scores = new Map();
        for (const p of doc.body ? doc.body.querySelectorAll('p, pre, td, blockquote') : []) {
            const text = textOf(p);
            if (text.length < 25) continue;
            const vote = 1 + text.split(',').length - 1 + Math.min(3, Math.floor(text.length / 100));
            const parent = p.parentElement;
            const grand = parent && parent.parentElement;
            for (const [el, share] of [[parent, 1], [grand, 0.5]]) {
                if (!el || el === doc.documentElement) continue;
                scores.set(el, (scores.has(el) ? scores.get(el) : weight(el)) + vote * share);
            }
        }
        let top = null;
        let topScore = 0;
        for (const [el, score] of scores) {
            const scaled = score * (1 - linkDensity(el));
            scores.set(el, scaled);
            if (scaled > topScore) { top = el; topScore = scaled; }
        }
        if (!top) return [];
        const parent = top.parentElement;
        if (!parent || top === doc.body) return [top];
        return [...parent.children].filter((one) => one === top ||
            (scores.get(one) || 0) >= Math.max(10, topScore * 0.2) ||
            (one.tagName === 'P' && textOf(one).length > 80 && linkDensity(one) < 0.25));
    }

    // ------------------------------------------------------------ metadata

    function metaOf(doc, ...names) {
        for (const name of names) {
            const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`);
            const value = el && (el.getAttribute('content') || '').trim();
            if (value) return value;
        }
        return '';
    }

    /** Every JSON-LD object on the page, @graph flattened. */
    function linkedData(doc) {
        const out = [];
        for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                const walk = (one) => {
                    if (Array.isArray(one)) one.forEach(walk);
                    else if (one && typeof one === 'object') {
                        out.push(one);
                        if (one['@graph']) walk(one['@graph']);
                    }
                };
                walk(JSON.parse(script.textContent));
            } catch (_) { /* a page's broken JSON is its own */ }
        }
        return out;
    }

    const isArticleType = (one) => [].concat(one['@type'] || []).some((type) => /Article|BlogPosting|Report|NewsArticle|Posting/.test(type));

    const nameOf = (one) => [].concat(one || []).map((who) => (typeof who === 'string' ? who : who && who.name)).filter(Boolean).join(', ');

    /**
     * "How to x | Site" without the " | Site", where what is cut is the
     * site's name. `loose`, for a document's <title>, also cuts a short tag
     * line after a long title — which a title written for previews, where
     * "Part 2" after a dash is the title's own, is never put through.
     */
    function trimTitle(title, siteName, { loose = false } = {}) {
        const whole = String(title || '').trim();
        const parts = whole.split(/\s+[|–—·•»]\s+|\s+-\s+/);
        if (parts.length < 2) return whole;
        const site = String(siteName || '').toLowerCase();
        const last = parts[parts.length - 1].trim();
        const near = (part) => !!site && (part.toLowerCase().includes(site) || site.includes(part.toLowerCase()));
        const words = (list) => list.join(' ').split(/\s+/).length;
        if (near(last) || (loose && last.split(/\s+/).length <= 3 && words(parts.slice(0, -1)) >= 4)) {
            return parts.slice(0, -1).join(' – ').trim();
        }
        if (near(parts[0])) return parts.slice(1).join(' – ').trim();
        return whole;
    }

    function metadata(doc, scope) {
        const ld = linkedData(doc).find(isArticleType) || {};
        const host = (() => { try { return new URL(doc.baseURI).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
        const siteName = metaOf(doc, 'og:site_name', 'application-name') || nameOf(ld.publisher) || host;
        const heading = (scope && scope.querySelector('h1')) || doc.querySelector('h1');
        const title = ld.headline || metaOf(doc, 'og:title', 'twitter:title') ||
            (heading && textOf(heading)) || trimTitle(doc.title, siteName, { loose: true });
        const authorEl = doc.querySelector('[rel="author"], [itemprop="author"] [itemprop="name"], [itemprop="author"], .byline .author, .author-name');
        const author = metaOf(doc, 'author', 'article:author', 'parsely-author');
        const byline = nameOf(ld.author) || (author && !/^https?:/.test(author) ? author : '') ||
            (authorEl && textOf(authorEl).length < 80 ? textOf(authorEl) : '');
        const time = (scope && scope.querySelector('time[datetime]')) || doc.querySelector('article time[datetime]');
        const published = ld.datePublished || metaOf(doc, 'article:published_time', 'datePublished', 'date', 'pubdate', 'DC.date.issued') ||
            (time ? time.getAttribute('datetime') : '');
        const image = [].concat(ld.image || [])[0];
        const share = metaOf(doc, 'og:image', 'twitter:image') || (image && (image.url || image)) || '';
        const hero = typeof share === 'string' ? ArticleClean.sourceOf(share, doc.baseURI) : null;
        return {
            title: trimTitle(title, siteName),
            byline,
            published,
            siteName,
            description: ld.description || metaOf(doc, 'og:description', 'description', 'twitter:description'),
            hero: hero && !hero.startsWith('data:') ? hero : null,
            lang: doc.documentElement.getAttribute('lang') || '',
            dir: doc.documentElement.getAttribute('dir') || '',
        };
    }

    // ---------------------------------------------------------------- read

    const squash = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

    /**
     * The page's article, or null for a page with nothing to read. `doc` is
     * the live page or one read with DOMParser; the body is built in the
     * live one, where the reader draws it.
     */
    function read(doc = root.document, url = doc.baseURI) {
        if (!doc || !doc.body) return null;
        const best = byCandidates(doc);
        const parts = best ? [best] : byScore(doc);
        if (!parts.length) return null;
        const body = root.document.createDocumentFragment();
        for (const part of parts) {
            body.appendChild(ArticleClean.clean(part, { doc: root.document, base: doc.baseURI, drop: NOISE }));
        }
        const info = metadata(doc, best || parts[0].parentElement);
        // The page's own title over its text, which the reader draws itself.
        const first = body.querySelector('h2');
        if (first && squash(first.textContent) === squash(info.title)) first.remove();
        // A hero only for an article with no picture of its own: the page's
        // share image is nearly always its first figure too.
        if (body.querySelector('img')) info.hero = null;
        return { ...info, url, site: 'other', kind: 'article', body, aside: null, meta: {} };
    }

    const adapter = { id: 'article', read };

    const ArticleExtract = { read, adapter, metadata, trimTitle, linkedData, CANDIDATES, NOISE };

    root.BB = root.BB || {};
    root.BB.ArticleExtract = ArticleExtract;
    if (typeof module !== 'undefined' && module.exports) module.exports = ArticleExtract;
})(typeof globalThis !== 'undefined' ? globalThis : this);
