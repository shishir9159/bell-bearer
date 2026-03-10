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
})();
