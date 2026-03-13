/**
 * The text reader: a page's article rebuilt in the reader's own markup, and
 * the reader drawn over the page.
 *
 * The cleaner is the half that has to be right on pages nobody here has
 * seen, so its specs are written as the pages that break readers are: lazy
 * images, text in bare <div>s, a footnote's link to an id the page also has.
 */
(function () {
    'use strict';

    const ArticleClean = () => window.BB.ArticleClean;
    const BASE = 'https://example.com/blog/post.html';

    /** `html` as a document of its own, the way a fetched page is read. */
    function page(html) {
        return new DOMParser().parseFromString(`<!doctype html><html><head><base href="${BASE}"></head><body>${html}</body></html>`, 'text/html');
    }

    /** `html` cleaned, and put in a div so it can be asked about. */
    function cleaned(html, options = {}) {
        const doc = page(html);
        const out = document.createElement('div');
        out.appendChild(ArticleClean().clean(doc.body, { base: BASE, ...options }));
        return out;
    }

    suite('text reader — cleaning an article', () => {
        test('nothing that runs comes along: scripts, handlers, javascript: links, styles', () => {
            const out = cleaned(`<p onclick="alert(1)" style="color:red" class="lead">One <a href="javascript:alert(2)">two</a>
                <script>alert(3)</script><style>p{}</style><b onmouseover="x()">three</b></p>`);
            assertEqual(out.innerHTML.includes('script'), false, 'a script survived');
            assertEqual(out.querySelectorAll('[onclick], [onmouseover], [style], [class]').length, 0, 'an attribute of the page came along');
            assertEqual(out.querySelector('a').hasAttribute('href'), false, 'a javascript: link kept its address');
            assertEqual(out.querySelector('p').textContent.replace(/\s+/g, ' ').trim(), 'One two three');
        });

        test('the prose tags stay, and an h1 is one level down under the reader\'s own title', () => {
            const out = cleaned('<h1>Top</h1><h2>Part</h2><p><em>a</em> <strong>b</strong> <code>c()</code></p><blockquote><p>q</p></blockquote><ul><li>x</li></ul>');
            assertDeepEqual([...out.children].map((el) => el.tagName), ['H2', 'H2', 'P', 'BLOCKQUOTE', 'UL']);
            assertEqual(out.querySelector('code').textContent, 'c()');
        });

        test('text sitting in bare divs comes out as paragraphs, split at a doubled break', () => {
            const out = cleaned('<div><div>First line</div><div>Second <i>line</i></div></div><div>Third<br><br>Fourth<br>still fourth</div>');
            assertDeepEqual([...out.querySelectorAll('p')].map((p) => p.textContent), ['First line', 'Second line', 'Third', 'Fourthstill fourth']);
            assertEqual(out.querySelectorAll('p')[3].querySelectorAll('br').length, 1, 'a single break is a line, not a paragraph');
        });

        test('a page\'s ids are kept under our prefix, and its #links follow them', () => {
            const out = cleaned('<p>Claim<sup><a href="#fn1">1</a></sup> and <a href="post.html#fn2">again</a></p><ol><li id="fn1">Note.</li><li id="fn2">Two.</li></ol>');
            const [first, second] = out.querySelectorAll('a');
            assertEqual(first.getAttribute('href'), '#bbr-fn1');
            assertEqual(second.getAttribute('href'), '#bbr-fn2', 'the same page written out in full is an in-page link');
            assert(out.querySelector('#bbr-fn1') && !out.querySelector('#fn1'), 'two elements in one document under the page\'s id');
            assertEqual(first.hasAttribute('target'), false, 'an in-page link opened a tab');
        });

        test('other links are absolute and open beside the page', () => {
            const out = cleaned('<p><a href="../about">About</a> <a href="mailto:a@b.c">mail</a> <a href="ftp://x/y">ftp</a></p>');
            const [about, mail, ftp] = out.querySelectorAll('a');
            assertEqual(about.href, 'https://example.com/about');
            assertDeepEqual([about.target, about.rel], ['_blank', 'noopener noreferrer']);
            assertEqual(mail.getAttribute('href'), 'mailto:a@b.c');
            assertEqual(ftp.hasAttribute('href'), false);
        });

        test('what the page hides, and what it surrounds the article with, is left out', () => {
            const out = cleaned(`<p>Keep</p><p hidden>no</p><p aria-hidden="true">no</p><p style="display: none">no</p>
                <p class="sr-only">no</p><nav>no</nav><form><input></form><button>Share</button><aside>no</aside>`);
            assertEqual(out.textContent.replace(/\s+/g, ''), 'Keep');
        });

        test('a site adapter\'s own junk is dropped by selector', () => {
            const out = cleaned('<h2>Life<span class="edit">[edit]</span></h2><div class="navbox"><p>Links</p></div><p>Text</p>', { drop: '.edit, .navbox' });
            assertEqual(out.textContent, 'LifeText');
        });

        test('wrappers left empty go, and an empty anchor someone links to stays', () => {
            const out = cleaned('<div><p><span> </span></p><div class="share"><svg></svg></div></div><p>Text<a id="here"></a></p><p><br></p>');
            assertEqual(out.querySelectorAll('p').length, 1);
            assert(out.querySelector('#bbr-here'), 'the anchor went with its emptiness');
        });

        test('a heading\'s own permalink is not part of its text', () => {
            const out = cleaned('<h2 id="s">Setup <a href="#s">#</a></h2><h3>Run<a href="#r" aria-label="link">¶</a></h3>');
            assertDeepEqual([...out.querySelectorAll('h2, h3')].map((h) => h.textContent.trim()), ['Setup', 'Run']);
        });

        test('a data table scrolls in a frame of its own; a table laying the page out is unwrapped', () => {
            const out = cleaned(`<table><tr><th>A</th><th>B</th></tr><tr><td colspan="2" style="x">1</td></tr></table>
                <table role="presentation"><tr><td><p>Laid out</p></td></tr></table>`);
            const frame = out.querySelector('.tr-table');
            assert(frame && frame.querySelector('table'), 'no frame');
            assertEqual(out.querySelector('td').getAttribute('colspan'), '2');
            assertEqual(out.querySelectorAll('table').length, 1, 'the layout table was kept');
            assertEqual(out.lastElementChild.textContent, 'Laid out');
        });
    });

    const ArticleExtract = () => window.BB.ArticleExtract;

    const PARA = 'Paragraph text that goes on for a while, with commas, clauses, and enough words to be read as prose by anyone who looks. ';
    const prose = (n, tag = 'p') => Array.from({ length: n }, (_, i) => `<${tag}>${i + 1}. ${PARA}${PARA}</${tag}>`).join('');

    function article(head, body) {
        return new DOMParser().parseFromString(`<!doctype html><html lang="en"><head><base href="${BASE}">${head}</head><body>${body}</body></html>`, 'text/html');
    }

    suite('text reader — finding the article', () => {
        test('of a main holding the article and a sidebar, the article is taken, and the page around it is not', () => {
            const doc = article('<title>Post</title>', `<header><a href="/">Site</a><nav><a href="/a">A</a></nav></header>
                <main><article><h1>The post</h1>${prose(5)}<div class="share"><a href="#">Share</a></div></article>
                <div class="sidebar">${prose(1)}</div></main><footer>${prose(1)}</footer>`);
            const found = ArticleExtract().read(doc);
            const box = document.createElement('div');
            box.appendChild(found.body);
            assertEqual(box.querySelectorAll('p').length, 5);
            assertEqual(box.textContent.includes('Share'), false, 'the share bar came along');
            assertEqual(box.querySelector('h2'), null, 'the title was drawn twice, once over the body');
        });

        test('a page with no landmark at all is scored, and the paragraphs\' container wins with its neighbours', () => {
            const doc = article('<title>Old page</title>', `<div id="top"><a href="/">Home</a> | <a href="/x">X</a></div>
                <div id="wrap"><div class="text">${prose(4)}</div><div class="text">${prose(2)}</div><div class="links"><a href="/1">One link</a> <a href="/2">Two links</a></div></div>`);
            const box = document.createElement('div');
            box.appendChild(ArticleExtract().read(doc).body);
            assertEqual(box.querySelectorAll('p').length, 6);
            assertEqual(box.textContent.includes('One link'), false);
        });

        test('the title, byline, date and site come from what the page publishes for previews', () => {
            const doc = article(`<title>Fallback | Example Blog</title><meta property="og:title" content="Real title">
                <meta property="og:site_name" content="Example Blog"><meta property="og:image" content="/share.png">
                <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},
                {"@type":"BlogPosting","headline":"From JSON-LD","author":[{"@type":"Person","name":"Ada"},{"name":"Grace"}],"datePublished":"2024-05-01T10:00:00Z"}]}</script>`,
            `<article>${prose(4)}</article>`);
            const found = ArticleExtract().read(doc);
            assertDeepEqual([found.title, found.byline, found.published, found.siteName],
                ['From JSON-LD', 'Ada, Grace', '2024-05-01T10:00:00Z', 'Example Blog']);
            assertEqual(found.hero, 'https://example.com/share.png', 'an article with no picture of its own gets the page\'s');
        });

        test('a title is cut at the site\'s name, and a title\'s own dash is left alone', () => {
            const trim = ArticleExtract().trimTitle;
            assertEqual(trim('How caching works | Example Blog', 'Example Blog'), 'How caching works');
            assertEqual(trim('Example Blog — How caching works', 'Example Blog'), 'How caching works');
            assertEqual(trim('The long road to here - Part 2', 'Example Blog'), 'The long road to here - Part 2');
            assertEqual(trim('The long road to here - Part 2', 'Example Blog', { loose: true }), 'The long road to here', 'a <title>\'s tag line');
        });

        test('a page with nothing to read reads as nothing', () => {
            assertEqual(ArticleExtract().read(article('<title>x</title>', '<div><a href="/">Home</a></div>')), null);
        });
    });

    suite('text reader — images, video, code and math', () => {
        test('a lazy image is the one its loader was holding back, at an address that works here', () => {
            const out = cleaned(`<p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/img/a.jpg" alt="A"></p>
                <p><img src="b.jpg" srcset="b-640.jpg 640w, b-1280.jpg 1280w" width="640" height="360"></p>`);
            const [a, b] = out.querySelectorAll('img');
            assertEqual(a.src, 'https://example.com/img/a.jpg');
            assertEqual(a.alt, 'A');
            assertEqual(b.getAttribute('srcset'), 'https://example.com/blog/b-640.jpg 640w, https://example.com/blog/b-1280.jpg 1280w');
            assertDeepEqual([b.getAttribute('width'), b.loading], ['640', 'lazy']);
            assertEqual(ArticleClean().largest(b.getAttribute('srcset')), 'https://example.com/blog/b-1280.jpg');
        });

        test('the image a <noscript> keeps for readers without script takes the placeholder\'s place', () => {
            const out = cleaned('<figure><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><noscript><img src="/real.png" alt="Real"></noscript><figcaption>Cap</figcaption></figure>');
            const images = out.querySelectorAll('img');
            assertEqual(images.length, 1);
            assertEqual(images[0].src, 'https://example.com/real.png');
            assertEqual(out.querySelector('figcaption').textContent, 'Cap');
        });

        test('icons and tracking pixels are not pictures in the article', () => {
            const out = cleaned('<p>Text <img src="/i.svg" width="16" height="16"> <img src="/pixel.gif" width="1" height="1"></p>');
            assertEqual(out.querySelectorAll('img').length, 0);
        });

        test('a code block keeps its language and its line breaks, and leaves the line numbers behind', () => {
            const out = cleaned(`<div class="highlight-python"><pre><span class="lineno">1</span>def f():<br><span class="lineno">2</span>    return 1</pre></div>
                <pre class="language-js"><code><div class="line">let a;</div><div class="line">a = 2;</div></code></pre>`);
            const [py, js] = out.querySelectorAll('pre');
            assertEqual(py.dataset.lang, 'python');
            assertEqual(py.textContent, 'def f():\n    return 1');
            assertEqual(js.dataset.lang, 'js');
            assertEqual(js.querySelector('code').textContent, 'let a;\na = 2;');
        });

        test('a player\'s frame is a link to it; the page\'s own video plays here, and nothing starts by itself', () => {
            const out = cleaned(`<iframe src="https://www.youtube.com/embed/abcdefghijk" title="Talk"></iframe>
                <iframe src="https://ads.example.net/frame"></iframe><video autoplay src="/clip.mp4" poster="/p.jpg"></video>`);
            const link = out.querySelector('.tr-embed a');
            assertEqual(link.href, 'https://www.youtube.com/watch?v=abcdefghijk');
            assertEqual(link.textContent, 'Talk — youtube.com');
            assertEqual(out.querySelectorAll('.tr-embed').length, 1, 'an advert\'s frame became a link');
            const video = out.querySelector('video');
            assertDeepEqual([video.src, video.poster, video.controls, video.autoplay, video.preload],
                ['https://example.com/clip.mp4', 'https://example.com/p.jpg', true, false, 'none']);
        });

        test('MathML is kept as MathML, and the page drawing its own copy beside it is not', () => {
            const out = cleaned(`<p>So <span class="katex"><span class="katex-mathml"><math><mi>x</mi><mo>=</mo><mn>2</mn></math></span>
                <span class="katex-html" aria-hidden="true">x=2</span></span>.</p>`);
            const math = out.querySelector('math');
            assert(math, 'the formula went');
            assertEqual(math.namespaceURI, 'http://www.w3.org/1998/Math/MathML');
            assertEqual(out.textContent.replace(/\s+/g, ''), 'Sox=2.');
        });
    });

    // ------------------------------------------------------------ the shell

    const ArticleReader = () => window.BB.ArticleReader;

    /** The reader's sheet, over XHR: the mock has taken fetch. */
    function loadSheet() {
        return new Promise((done) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '../content-reader.css');
            xhr.onload = () => done(xhr.responseText);
            xhr.onerror = () => done('');
            xhr.send();
        });
    }

    /** An article as an adapter answers one, its body built from `html`. */
    function articleOf(html, extra = {}) {
        return () => {
            const body = document.createDocumentFragment();
            const holder = document.createElement('div');
            holder.innerHTML = html;
            while (holder.firstChild) body.appendChild(holder.firstChild);
            return { title: 'A title', byline: 'Ada', published: '2024-05-01T10:00:00Z', siteName: 'Example', url: location.href, body, ...extra };
        };
    }

    const readers = [];
    function makeReader(read, options = {}) {
        const notes = [];
        const reader = ArticleReader().createArticleReader({
            adapter: { read }, getSettings: () => ({ ...window.BB.Settings.DEFAULTS, ...(options.settings || {}) }),
            copyText: async () => true, notify: (text) => notes.push(text), loadStyles: loadSheet,
        });
        readers.push(reader);
        return { reader, notes };
    }

    function closeAll() {
        while (readers.length) readers.pop().close();
    }

    const styled = (reader) => new Promise((done) => {
        const wait = () => (reader.element && !reader.element.classList.contains('is-still') ? done() : setTimeout(wait, 10));
        wait();
    });

    const LONG = prose(4);

    suite('text reader — the reader over the page', () => {
        test('it opens over the page and closes leaving the page as it was, twice over', async () => {
            closeAll();
            document.documentElement.style.overflow = 'clip';
            const before = document.body.innerHTML;
            const { reader } = makeReader(articleOf(LONG));
            assertEqual(reader.open(), true);
            await styled(reader);
            assertEqual(document.documentElement.style.getPropertyValue('overflow'), 'hidden', 'the page scrolled under the reader');
            assertEqual(document.getElementById(ArticleReader().ROOT_ID), reader.host);
            assertEqual(reader.host.shadowRoot, null, 'the page can read the reader through an open shadow root');
            reader.close();
            reader.close();
            assertEqual(document.body.innerHTML.trim(), before.trim());
            assertEqual(document.documentElement.style.overflow, 'clip', 'the page\'s own overflow was not put back');
            assertEqual(document.documentElement.classList.contains(ArticleReader().OPEN_CLASS), false);
            document.documentElement.style.overflow = '';
        });

        test('the page\'s own styles do not reach the article', async () => {
            closeAll();
            const style = document.createElement('style');
            style.textContent = 'p { margin: 77px !important; color: rgb(255, 0, 0) !important; } div { display: none; }';
            document.head.appendChild(style);
            try {
                const { reader } = makeReader(articleOf(LONG));
                reader.open();
                await styled(reader);
                const p = reader.element.querySelector('.tr-body p');
                assert(getComputedStyle(p).marginLeft !== '77px', 'a page rule set the article\'s margins');
                assert(getComputedStyle(p).color !== 'rgb(255, 0, 0)', 'a page rule set the article\'s ink');
                assert(reader.element.getBoundingClientRect().height > 0, 'a page rule hid the reader');
            } finally {
                style.remove();
                closeAll();
            }
        });

        test('the head says who, when and how long, and leaves out a summary that is only the lead again', () => {
            closeAll();
            const lead = 'Paragraph text that goes on for a while';
            const { reader } = makeReader(articleOf(LONG, { description: lead }));
            reader.open();
            const head = reader.element.querySelector('.tr-head');
            assertEqual(head.querySelector('.tr-title').textContent, 'A title');
            const facts = head.querySelector('.tr-byline').textContent;
            assert(/^Ada · .*2024 · \d+ min read$/.test(facts), facts);
            assertEqual(head.querySelector('.tr-dek'), null);
            closeAll();
        });

        test('a page with little on it says so, and opens all the same when asked; opened by itself it stays shut', () => {
            closeAll();
            const { reader } = makeReader(articleOf('<p>Sign in to continue.</p>'));
            assertEqual(reader.open({ auto: true }), false);
            assertEqual(reader.isOpen, false);
            reader.open();
            const thin = reader.element.querySelector('.tr-thin');
            assert(thin && /does not look like an article/.test(thin.textContent), 'no word of it');
            thin.querySelector('.tr-anyway').click();
            assertEqual(reader.element.querySelector('.tr-body').textContent.trim(), 'Sign in to continue.');
            closeAll();
        });

        test('nothing to read is said once, and nothing opens', () => {
            closeAll();
            const { reader, notes } = makeReader(() => null);
            assertEqual(reader.open(), false);
            assertEqual(notes.length, 1);
            assertEqual(reader.open({ auto: true }), false);
            assertEqual(notes.length, 1, 'opening by itself announced it');
        });

        test('escape leaves a field first, then closes; the page hears no key pressed in the reader', () => {
            closeAll();
            const heard = [];
            const listen = (event) => heard.push(event.key);
            document.addEventListener('keydown', listen);
            try {
                const { reader } = makeReader(articleOf(LONG));
                reader.open();
                const field = document.createElement('input');
                reader.element.querySelector('.tr-body').appendChild(field);
                field.focus();
                field.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, composed: true }));
                assertDeepEqual(heard, [], 'the page\'s j went off under the reader');
                field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
                assertEqual(reader.isOpen, true, 'escape in a field threw the article away');
                reader.element.querySelector('.tr-scroll').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
                assertEqual(reader.isOpen, false);
            } finally {
                document.removeEventListener('keydown', listen);
                closeAll();
            }
        });
    });

    const SECTIONS = `<p>Lead.</p>${prose(2)}<h2>First part</h2>${prose(3)}<h3>A detail</h3>${prose(3)}<h2>Second part</h2>${prose(3)}
        <details><summary>References</summary><h2>Sources</h2><p>Folded.</p></details>`;
    const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const settled = (scroll) => new Promise((done) => {
        let last = -1;
        const wait = () => (scroll.scrollTop === last ? done() : (last = scroll.scrollTop, setTimeout(wait, 60)));
        setTimeout(wait, 60);
    });

    suite('text reader — the contents and the bar', () => {
        test('the sections are the article\'s own headings, folded end matter left out', async () => {
            closeAll();
            const { reader } = makeReader(articleOf(SECTIONS));
            reader.open();
            await styled(reader);
            const items = [...reader.element.querySelectorAll('.tr-toc a')].map((a) => a.textContent);
            assertDeepEqual(items, ['First part', 'A detail', 'Second part']);
            const heading = reader.element.querySelector('.tr-body h3');
            assertEqual(reader.element.querySelector('.tr-toc li.is-h3 a').getAttribute('href'), `#${heading.id}`, 'a heading with no id cannot be jumped to');
            closeAll();
        });

        test('reading down marks the section being read, and ] and [ move between sections', async () => {
            closeAll();
            const { reader } = makeReader(articleOf(SECTIONS));
            reader.open();
            await styled(reader);
            const scroll = reader.element.querySelector('.tr-scroll');
            const press = (key) => scroll.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
            press(']');
            await settled(scroll);
            await frame();
            const on = () => (reader.element.querySelector('.tr-toc a.is-on') || {}).textContent;
            assertEqual(on(), 'First part');
            press(']');
            await settled(scroll);
            await frame();
            assertEqual(on(), 'A detail');
            press('[');
            await settled(scroll);
            await frame();
            assertEqual(on(), 'First part');
            assert(reader.element.querySelector('.tr-progress span').style.transform.startsWith('scaleX(0.'), 'the hairline did not follow');
            closeAll();
        });

        test('an article of one section has no contents, and a narrow window keeps them behind the bar', async () => {
            closeAll();
            const one = makeReader(articleOf(`${prose(4)}<h2>Only</h2>${prose(2)}`)).reader;
            one.open();
            await styled(one);
            assertEqual(one.element.querySelector('.tr-toc').hidden, true);
            assertEqual(one.element.querySelector('.tr-toc-btn').hidden, true);
            closeAll();

            const { reader } = makeReader(articleOf(SECTIONS));
            reader.open();
            await styled(reader);
            reader.host.style.setProperty('width', '700px', 'important');
            await frame();
            await frame();
            const button = reader.element.querySelector('.tr-toc-btn');
            assertEqual(reader.element.classList.contains('is-wide'), false);
            assertEqual(reader.element.querySelector('.tr-toc').hidden, true, 'the rail over a narrow column');
            button.click();
            assertEqual(reader.element.querySelector('.tr-toc').hidden, false);
            reader.element.querySelector('.tr-body p').click();
            assertEqual(reader.element.querySelector('.tr-toc').hidden, true, 'the sheet stayed over the article');
            closeAll();
        });
    });
})();
