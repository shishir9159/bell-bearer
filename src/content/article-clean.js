/**
 * A page's article, rebuilt in the text reader's own markup.
 *
 * **Rebuilt, never copied.** Each node of the page is read and a new one is
 * made from an allowlist: the tags prose is written in, and on each only the
 * attributes it needs. Everything else is dropped (script, forms, buttons,
 * icons, anything hidden) or unwrapped, its children kept and the wrapper
 * not — so no handler, inline style or class of the page's comes along, and
 * the reader's stylesheet is the only one that dresses what it draws. A copy
 * of the subtree, scrubbed after, would have had to know every way a page can
 * carry script; an allowlist only has to know what an article is made of.
 *
 * The page's ids are kept under a prefix, and its `#links` to them follow: the
 * copy sits in the same document as the page, and two elements under one id
 * would send a footnote's link to the page's own footnote, under the reader.
 *
 * Works on any document, the live page or one read with DOMParser, and
 * builds into `doc`, the one the reader draws in.
 */
(function (root) {
    'use strict';

    /** Our ids, apart from the page's own. */
    const ID_PREFIX = 'bbr-';

    const MATHML = 'http://www.w3.org/1998/Math/MathML';

    /** Kept as they are, children and all. */
    const BLOCK = new Set(['P', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
        'FIGURE', 'FIGCAPTION', 'TABLE', 'CAPTION', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'HR', 'DETAILS', 'SUMMARY']);
    const INLINE = new Set(['A', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'DEL', 'INS', 'SUB', 'SUP', 'SMALL', 'MARK', 'CODE',
        'KBD', 'SAMP', 'VAR', 'ABBR', 'TIME', 'Q', 'CITE', 'BR', 'BDI', 'DFN', 'WBR']);

    /** Gone with everything in them. */
    const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'TITLE', 'HEAD', 'SVG', 'CANVAS', 'FORM',
        'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'OPTION', 'LABEL', 'NAV', 'ASIDE', 'DIALOG', 'OBJECT', 'EMBED',
        'MAP', 'AREA', 'MENU', 'FIELDSET', 'OUTPUT', 'PROGRESS', 'METER', 'SLOT', 'PORTAL', 'COLGROUP', 'COL', 'RP', 'RT']);

    /** Wrappers whose children are blocks of their own: a run of text in one is a paragraph. */
    const CONTAINER = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'CENTER', 'ADDRESS', 'HGROUP', 'BODY']);

    /** Where what is kept goes to, per tag, beyond the attributes every element keeps. */
    const ATTRS = {
        TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan', 'scope'], OL: ['start', 'reversed', 'type'], LI: ['value'],
        TIME: ['datetime'], ABBR: ['title'], DFN: ['title'],
    };
    const EVERYWHERE = ['lang', 'dir'];

    /** Hosts whose iframe is a player: shown as a link to it, not as a frame the page's policy may refuse. */
    const PLAYERS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|loom\.com|ted\.com|soundcloud\.com|spotify\.com|codepen\.io|jsfiddle\.net|streamable\.com)$/;

    /** Classes that mean the element is not shown, on sites that hide it with a class rather than the attribute. */
    const HIDDEN_CLASS = /(^|\s)(hidden|sr-only|visually-hidden|screen-reader-text|screenreader-only|u-hidden|is-hidden|d-none|noprint)(\s|$)/i;

    /** A heading's own permalink: the ¶ or # a heading carries for copying its address. */
    const PERMALINK = /^\s*[#¶§🔗]?\s*$/u;

    function isHidden(el) {
        if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
        const style = el.getAttribute('style') || '';
        if (/(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)) return true;
        return HIDDEN_CLASS.test(el.getAttribute('class') || '');
    }

    /** `href` as an absolute http(s) or mailto address, `#frag` as ours, or null for anything else. */
    function linkOf(href, base) {
        const raw = String(href || '').trim();
        if (!raw) return null;
        if (raw.startsWith('#')) return raw.length > 1 ? `#${ID_PREFIX}${raw.slice(1)}` : null;
        let url;
        try { url = new URL(raw, base); } catch (_) { return null; }
        if (url.protocol === 'mailto:') return url.href;
        if (!/^https?:$/.test(url.protocol)) return null;
        // A link to this same page's fragment, written out in full, is an
        // in-page link like any other.
        if (url.hash && base && url.href.split('#')[0] === String(base).split('#')[0]) return `#${ID_PREFIX}${url.hash.slice(1)}`;
        return url.href;
    }

    /** `src` as an absolute http(s) address or an inline image, or null. */
    function sourceOf(src, base) {
        const raw = String(src || '').trim();
        if (!raw) return null;
        if (/^data:image\//i.test(raw)) return raw;
        try {
            const url = new URL(raw, base);
            return /^https?:$/.test(url.protocol) ? url.href : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * A srcset's candidates, absolute, as `[{ url, size, rank }]`: `size`
     * the descriptor as written (`640w`, `2x`), `rank` it as a number to
     * order by — widths as they are, a density as a thousand pixels a unit.
     */
    function candidates(srcset, base) {
        const out = [];
        // Split on the comma between candidates, not one inside an address.
        for (const part of String(srcset || '').split(/,\s+(?=\S)|,(?=\s*https?:)/)) {
            const [url, size = ''] = part.trim().split(/\s+/);
            const src = sourceOf(url, base);
            if (!src || src.startsWith('data:')) continue;
            const width = /^(\d+)w$/.exec(size);
            const density = /^([\d.]+)x$/.exec(size);
            const rank = width ? Number(width[1]) : density ? Number(density[1]) * 1000 : 1000;
            out.push({ url: src, size: width || density ? size : '', rank });
        }
        return out;
    }

    /** The largest candidate, for the image viewer. */
    function largest(srcset, base) {
        const list = candidates(srcset, base).sort((a, b) => b.rank - a.rank);
        return list.length ? list[0].url : null;
    }

    /** A placeholder some lazy loader drew while the real image waited: a 1×1 gif, or nothing. */
    const isPlaceholder = (src) => !src || /^data:image\/(gif|png|svg)/i.test(src) && src.length < 600;

    function createCleaner({ doc = root.document, base = '', drop = '', keepClass = null } = {}) {
        const make = (tag) => doc.createElement(tag);

        /** Does the site's adapter want this one gone? */
        function dropped(el) {
            if (!drop) return false;
            try { return el.matches(drop); } catch (_) { return false; }
        }

        function copyAttrs(from, to) {
            for (const name of [...EVERYWHERE, ...(ATTRS[from.tagName] || [])]) {
                const value = from.getAttribute(name);
                if (value != null && value !== '') to.setAttribute(name, value);
            }
            const id = from.getAttribute('id') || (from.tagName === 'A' && from.getAttribute('name'));
            if (id) to.id = ID_PREFIX + id;
            if (from.getAttribute('title') && !to.hasAttribute('title') && from.tagName !== 'A') to.title = from.getAttribute('title');
            // Classes a site's adapter knows the meaning of — Wikipedia's
            // `skin-invert`, say — kept so the reader can act on them.
            if (keepClass) {
                const kept = String(from.getAttribute('class') || '').split(/\s+/).filter((one) => one && keepClass.test(one));
                if (kept.length) to.className = kept.join(' ');
            }
        }

        // ------------------------------------------------------------ media

        function image(el) {
            // Lazy loaders keep the real address in a data attribute and a
            // placeholder in src until the image scrolls into view — which a
            // copy never does.
            let src = sourceOf(el.getAttribute('src'), base);
            const lazy = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-hi-res-src']
                .map((name) => sourceOf(el.getAttribute(name), base)).find(Boolean);
            if (lazy && isPlaceholder(src)) src = lazy;
            const set = el.getAttribute('data-srcset') || el.getAttribute('data-lazy-srcset') || el.getAttribute('srcset') || '';
            const picture = el.parentElement && el.parentElement.tagName === 'PICTURE' ? el.parentElement : null;
            const sources = picture ? [...picture.querySelectorAll('source')].map((one) => one.getAttribute('srcset') || one.getAttribute('data-srcset') || '') : [];
            // One kind of descriptor to a srcset: the img's own if it has
            // one, else the first <source> that does.
            const all = [set, ...sources].map((one) => candidates(one, base)).find((list) => list.length) || [];
            if (isPlaceholder(src) && all.length) src = [...all].sort((a, b) => b.rank - a.rank)[0].url;
            if (!src || isPlaceholder(src)) return null;
            // Icons, spacers and tracking pixels, as the page sizes them.
            const w = Number(el.getAttribute('width'));
            const h = Number(el.getAttribute('height'));
            if ((w && w < 48 && (!h || h < 48)) || (h && h < 48 && (!w || w < 48))) return null;
            const img = make('img');
            img.src = src;
            if (all.some((one) => one.size)) img.setAttribute('srcset', all.map((one) => `${one.url} ${one.size || '1x'}`).join(', '));
            img.alt = el.getAttribute('alt') || '';
            if (w) img.setAttribute('width', String(w));
            if (h) img.setAttribute('height', String(h));
            img.loading = 'lazy';
            img.decoding = 'async';
            copyAttrs(el, img);
            return img;
        }

        function media(el) {
            const out = make(el.tagName.toLowerCase());
            const src = sourceOf(el.getAttribute('src'), base);
            if (src) out.src = src;
            const poster = sourceOf(el.getAttribute('poster'), base);
            if (poster) out.poster = poster;
            for (const one of el.querySelectorAll('source')) {
                const url = sourceOf(one.getAttribute('src'), base);
                if (!url) continue;
                const source = make('source');
                source.src = url;
                if (one.getAttribute('type')) source.type = one.getAttribute('type');
                out.appendChild(source);
            }
            if (!src && !out.querySelector('source')) return null;
            out.controls = true;
            out.preload = 'none';
            return out;
        }

        function frame(el) {
            const src = sourceOf(el.getAttribute('src') || el.getAttribute('data-src'), base);
            if (!src) return null;
            let host = '';
            try { host = new URL(src).hostname.replace(/^www\./, ''); } catch (_) { return null; }
            if (!PLAYERS.test(host)) return null;
            const p = make('p');
            p.className = 'tr-embed';
            const a = make('a');
            a.href = src.replace('youtube.com/embed/', 'youtube.com/watch?v=').replace('youtube-nocookie.com/embed/', 'youtube.com/watch?v=');
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = `${el.getAttribute('title') || 'Embedded'} — ${host}`;
            p.appendChild(a);
            return p;
        }

        /** What a <noscript> holds for a reader with no script: the real <img> a lazy loader replaced. */
        function noscript(el, out) {
            // Its content is text on a page with script on, and parsed
            // elements in a document read with DOMParser, which has none.
            const html = el.children.length ? el.innerHTML : el.textContent || '';
            if (!/<img\b/i.test(html) || typeof DOMParser !== 'function') return;
            const parsed = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
            const img = parsed && image(parsed);
            if (!img) return;
            const last = out.lastChild;
            if (last && last.tagName === 'IMG') {
                if (last.src === img.src) return;
                if (isPlaceholder(last.getAttribute('src'))) last.remove();
            }
            out.appendChild(img);
        }

        // ------------------------------------------------------------- code

        /** A block's code as text: a <br> or a line's own element is a newline, a gutter of line numbers is nothing. */
        function codeText(node) {
            let text = '';
            const walk = (one) => {
                if (one.nodeType === 3) { text += one.data; return; }
                if (one.nodeType !== 1) return;
                const cls = one.getAttribute('class') || '';
                if (/(^|\s)(linenos?|line-numbers?(-rows)?|gutter|ln|hljs-ln-numbers|line-number)(\s|$)/.test(cls) || one.hasAttribute('data-line-number')) return;
                if (one.tagName === 'BR') { text += '\n'; return; }
                for (const child of one.childNodes) walk(child);
                if (/^(DIV|P|LI|TR)$/.test(one.tagName) && !text.endsWith('\n')) text += '\n';
            };
            walk(node);
            return text.replace(/\n$/, '');
        }

        function languageOf(el) {
            for (const one of [el, el.querySelector('code'), el.parentElement, el.parentElement && el.parentElement.parentElement]) {
                if (!one || !one.getAttribute) continue;
                const cls = `${one.getAttribute('class') || ''} ${one.getAttribute('data-lang') || ''} ${one.getAttribute('data-language') || ''}`;
                const match = /(?:^|\s)(?:language-|lang-|highlight-(?:source-)?|brush:\s*)([\w+#-]+)/.exec(cls) ||
                    /^\s*([\w+#-]+)\s*$/.exec(one.getAttribute('data-lang') || one.getAttribute('data-language') || '');
                if (match && !/^(none|text|plain|plaintext)$/i.test(match[1])) return match[1].toLowerCase();
            }
            return '';
        }

        function preformatted(el) {
            const pre = make('pre');
            const code = make('code');
            code.textContent = codeText(el);
            const lang = languageOf(el);
            if (lang) pre.dataset.lang = lang;
            pre.appendChild(code);
            return code.textContent.trim() ? pre : null;
        }

        // ------------------------------------------------------------- math

        function math(el) {
            const copy = (one) => {
                if (one.nodeType === 3) return doc.createTextNode(one.data);
                if (one.nodeType !== 1) return null;
                const out = doc.createElementNS(MATHML, one.localName);
                for (const { name, value } of [...one.attributes]) {
                    if (/^on/i.test(name) || /href$/i.test(name) || name === 'style' || name === 'class' || name === 'id') continue;
                    try { out.setAttribute(name, value); } catch (_) { /* an attribute name the DOM refuses */ }
                }
                for (const child of one.childNodes) {
                    const made = copy(child);
                    if (made) out.appendChild(made);
                }
                return out;
            };
            return copy(el);
        }

        // ----------------------------------------------------------- tables

        /** A table used to lay a page out rather than to hold data: one cell a row, or saying so. */
        function isLayoutTable(el) {
            if (el.getAttribute('role') === 'presentation') return true;
            const rows = [...el.rows || []];
            return !el.querySelector('th') && rows.length > 0 && rows.every((row) => row.cells.length <= 1);
        }

        // ------------------------------------------------------------ walk

        /** Children of `el` cleaned into `out`. */
        function children(el, out) {
            for (const child of el.childNodes) node(child, out);
            return out;
        }

        function node(one, out) {
            if (one.nodeType === 3) {
                out.appendChild(doc.createTextNode(one.data));
                return;
            }
            if (one.nodeType !== 1) return;
            const tag = one.tagName.toUpperCase();
            if (one.namespaceURI === MATHML || tag === 'MATH') {
                if (!isHidden(one)) out.appendChild(math(one));
                return;
            }
            if (tag === 'NOSCRIPT') { noscript(one, out); return; }
            if (DROP.has(tag) || isHidden(one) || dropped(one)) return;
            // MathJax 3 draws in elements of its own, with the MathML beside them for screen readers.
            if (tag === 'MJX-CONTAINER') {
                const mml = one.querySelector('math');
                if (mml) out.appendChild(math(mml));
                return;
            }
            if (tag === 'IMG') { const img = image(one); if (img) out.appendChild(img); return; }
            if (tag === 'PICTURE') { const img = one.querySelector('img'); const made = img && image(img); if (made) out.appendChild(made); return; }
            if (tag === 'VIDEO' || tag === 'AUDIO') { const made = media(one); if (made) out.appendChild(made); return; }
            if (tag === 'IFRAME') { const made = frame(one); if (made) out.appendChild(made); return; }
            if (tag === 'PRE') { const made = preformatted(one); if (made) out.appendChild(made); return; }
            if (tag === 'TABLE') {
                if (isLayoutTable(one)) { out.appendChild(blocks(one)); return; }
                const wrap = make('div');
                wrap.className = 'tr-table';
                const table = make('table');
                copyAttrs(one, table);
                children(one, table);
                wrap.appendChild(table);
                out.appendChild(wrap);
                return;
            }
            if (tag === 'H1') { out.appendChild(heading(one, 'h2')); return; }
            if (/^H[2-6]$/.test(tag)) { out.appendChild(heading(one, tag.toLowerCase())); return; }
            if (tag === 'A') { out.appendChild(link(one)); return; }
            if (BLOCK.has(tag) || INLINE.has(tag)) {
                const made = make(tag.toLowerCase());
                copyAttrs(one, made);
                if (tag === 'CODE') made.textContent = one.textContent;
                else children(one, made);
                out.appendChild(made);
                return;
            }
            if (CONTAINER.has(tag)) {
                const made = blocks(one);
                // Its id goes to its first block, where a link to it lands.
                const first = made.firstElementChild;
                if (one.getAttribute('id') && first && !first.id) first.id = ID_PREFIX + one.getAttribute('id');
                out.appendChild(made);
                return;
            }
            // A span, a font, a custom element: its children, unwrapped. An
            // id it carried stays reachable, on an empty anchor.
            const id = one.getAttribute('id');
            if (id) {
                const anchor = make('span');
                anchor.id = ID_PREFIX + id;
                out.appendChild(anchor);
            }
            children(one, out);
        }

        function heading(el, tag) {
            const h = make(tag);
            copyAttrs(el, h);
            children(el, h);
            // The ¶ or # a heading carries as its own permalink.
            for (const a of [...h.querySelectorAll('a[href]')]) {
                if (PERMALINK.test(a.textContent) && !a.querySelector('img')) a.remove();
            }
            return h;
        }

        function link(el) {
            const href = linkOf(el.getAttribute('href'), base);
            const a = make('a');
            copyAttrs(el, a);
            if (href) {
                a.setAttribute('href', href);
                if (!href.startsWith('#')) {
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                }
                if (el.getAttribute('title')) a.title = el.getAttribute('title');
            }
            children(el, a);
            return a;
        }

        /**
         * A wrapper's children as blocks. Unwrapped as they come, two
         * <div>s of text would run together as one line, so a run of inline
         * content becomes a paragraph of its own — between blocks, or as all
         * a wrapper holds — split again at a doubled <br>, the paragraph
         * break of pages written before CSS.
         */
        function blocks(el) {
            const made = children(el, doc.createDocumentFragment());
            const kids = [...made.childNodes];
            const out = doc.createDocumentFragment();
            let run = [];
            const flush = () => {
                for (const part of splitAtBreaks(run)) {
                    if (!part.some(hasContent)) continue;
                    const p = make('p');
                    part.forEach((one) => p.appendChild(one));
                    out.appendChild(p);
                }
                run = [];
            };
            for (const kid of kids) {
                if (isBlock(kid)) { flush(); out.appendChild(kid); } else run.push(kid);
            }
            flush();
            return out;
        }

        return { clean: (el) => tidy(el.tagName && CONTAINER.has(el.tagName.toUpperCase()) ? blocks(el) : children(el, doc.createDocumentFragment())), image, largest: (set) => largest(set, base) };
    }

    const isBlock = (one) => one.nodeType === 1 && (BLOCK.has(one.tagName) || /^(PRE|VIDEO|AUDIO|DIV)$/.test(one.tagName));

    const hasContent = (one) => (one.nodeType === 3 ? /\S/.test(one.data) : one.nodeType === 1 && one.tagName !== 'BR');

    function splitAtBreaks(run) {
        const parts = [[]];
        for (let i = 0; i < run.length; i++) {
            const one = run[i];
            if (one.nodeType === 1 && one.tagName === 'BR') {
                let j = i + 1;
                while (j < run.length && run[j].nodeType === 3 && !/\S/.test(run[j].data)) j++;
                if (j < run.length && run[j].nodeType === 1 && run[j].tagName === 'BR') {
                    parts.push([]);
                    i = j;
                    continue;
                }
            }
            parts[parts.length - 1].push(one);
        }
        return parts;
    }

    /** Something to see with no text in it. */
    const SOLID = new Set(['IMG', 'VIDEO', 'AUDIO', 'HR', 'IFRAME', 'TD', 'TH', 'PRE', 'math']);

    /**
     * Drop what is left with nothing to read or see — the wrapper of a
     * share button, a paragraph that held an icon. One pass from the leaves
     * up, so an element emptied by its children going goes with them. An
     * empty element with an id stays, for the link that lands on it, but
     * does not keep its parent.
     */
    function tidy(fragment) {
        const prune = (one) => {
            if (one.nodeType === 3) return /\S/.test(one.data);
            if (one.nodeType !== 1) return false;
            // A line break stays in the text it breaks, but is not text.
            if (one.tagName === 'BR' || one.tagName === 'WBR') return false;
            let any = SOLID.has(one.tagName) || (one.classList && one.classList.contains('tr-embed'));
            for (const child of [...one.childNodes]) if (prune(child)) any = true;
            if (!any && !one.id) one.remove();
            return any;
        };
        for (const child of [...fragment.childNodes]) prune(child);
        return fragment;
    }

    /** `el`'s article, cleaned, as a fragment of `doc`. */
    function clean(el, options = {}) {
        return createCleaner(options).clean(el);
    }

    const ArticleClean = { clean, createCleaner, linkOf, sourceOf, candidates, largest, ID_PREFIX };

    root.BB = root.BB || {};
    root.BB.ArticleClean = ArticleClean;
    if (typeof module !== 'undefined' && module.exports) module.exports = ArticleClean;
})(typeof globalThis !== 'undefined' ? globalThis : this);
