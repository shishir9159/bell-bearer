/**
 * Reading an X thread into the text reader: the author's whole thread, one
 * post after another, with its photos and videos playing in the column.
 *
 * Read out of the conversation X already sent the page, which
 * src/content/twitter-thread-page.js kept (src/shared/x-thread.js reads it):
 * not the DOM, where X has drawn only part of the thread and its videos are
 * `blob:` streams no other element can play. Nothing is asked of X, nothing
 * is clicked and nothing is scrolled. Where X has not sent all of a thread
 * yet, the reader says so at the end: X's own "Show more" under the last post
 * brings the rest, and the reader opened again reads it.
 *
 * A page whose conversation was not kept — it was open before the extension
 * was loaded or reloaded — is read off what X has drawn instead: the
 * author's posts from the top of the conversation, their text and photos,
 * and a video's poster with the word that it plays on X.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Bridge = ns.Bridge || req('./bridge.js');
    const XThread = ns.XThread || req('../shared/x-thread.js');

    const ASK = 'bb:x:thread';
    const ANSWER = 'bb:x:thread:ok';

    /** X's own drawing of a post, for a page with no conversation kept: its test ids, which outlast its classes. */
    const DRAWN = Object.freeze({
        post: 'article[data-testid="tweet"]',
        text: '[data-testid="tweetText"]',
        author: '[data-testid="User-Name"]',
        photo: '[data-testid="tweetPhoto"] img[src*="pbs.twimg.com/media"]',
        video: '[data-testid="videoPlayer"] video, [data-testid="videoComponent"] video',
    });

    /** `/<handle>/status/<id>` — a post's own page — as its parts, or null for any other page. */
    function statusOf(url) {
        try {
            const match = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(new URL(url).pathname);
            return match ? { handle: match[1], id: match[2] } : null;
        } catch (_) {
            return null;
        }
    }

    const make = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text != null) el.textContent = text;
        return el;
    };

    function link(href, text, className) {
        const a = make('a', className, text);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        return a;
    }

    /**
     * A post's words: a new paragraph at a blank line, a line break at a
     * single newline, links as links. Newlines are counted across segments:
     * a blank line can fall either side of a link.
     */
    function words(segments) {
        const out = document.createDocumentFragment();
        let p = make('p');
        let newlines = 0;
        const flush = () => {
            if (p.textContent.trim()) out.appendChild(p);
            p = make('p');
        };
        const put = (node) => {
            if (newlines >= 2) flush();
            else if (newlines === 1 && p.firstChild) p.appendChild(document.createElement('br'));
            newlines = 0;
            p.appendChild(node);
        };
        for (const segment of segments) {
            if (segment.type !== 'text') {
                put(link(segment.href, segment.text, `tr-x-${segment.type}`));
                continue;
            }
            segment.text.split('\n').forEach((piece, i) => {
                if (i > 0) newlines++;
                if (piece) put(document.createTextNode(piece));
            });
        }
        flush();
        return out;
    }

    /** A video's poster, said to play on X: for one read off X's drawing, or one the page would not let play. */
    function still(one, href, words) {
        const figure = make('figure', 'tr-x-still');
        if (one.poster) {
            const img = make('img');
            img.src = one.poster;
            img.alt = one.alt;
            figure.appendChild(img);
        }
        const caption = make('figcaption', '', `${words} `);
        if (href) caption.appendChild(link(href, 'Play it on X'));
        figure.appendChild(caption);
        return figure;
    }

    function media(list, reduce, href = '') {
        const box = make('div', `tr-x-media is-${Math.min(list.length, 4)}`);
        for (const one of list) {
            if (one.type === 'photo') {
                const img = make('img');
                img.src = one.url;
                img.alt = one.alt;
                img.loading = 'lazy';
                if (one.width && one.height) {
                    img.width = one.width;
                    img.height = one.height;
                }
                box.appendChild(img);
                continue;
            }
            if (!one.url) {
                // Read off X's drawing: the video is a stream only X's player plays.
                box.appendChild(still(one, href, 'This video plays on X; reload the page to play it here.'));
                continue;
            }
            const video = make('video');
            // A page's own security policy says what may play on it, and
            // the reader is on X's page: should X ever stop allowing its own
            // video host there, the poster and the way to X stand in.
            video.addEventListener('error', () => video.replaceWith(still(one, href, 'This video would not play here.')), { once: true });
            video.src = one.url;
            if (one.poster) video.poster = one.poster;
            video.playsInline = true;
            video.preload = 'none';
            if (one.alt) video.setAttribute('aria-label', one.alt);
            if (one.type === 'gif') {
                // A GIF loops by itself, as on X — unless motion is asked to be kept down.
                video.loop = true;
                video.muted = true;
                if (reduce) video.controls = true;
                else {
                    video.autoplay = true;
                    video.preload = 'auto';
                }
            } else {
                video.controls = true;
            }
            box.appendChild(video);
        }
        return box;
    }

    /** "Ada · @ada" over a post that is not the thread's: a quote, or what one answers. */
    function who(post) {
        return make('p', 'tr-x-who', post.unavailable ? '' : `${post.author.name} · @${post.author.handle}`);
    }

    function quote(post, className = 'tr-x-quote') {
        const box = make('blockquote', className);
        if (post.unavailable) {
            box.appendChild(make('p', 'tr-x-gone', post.text));
            return box;
        }
        box.appendChild(who(post));
        box.appendChild(words(post.segments));
        if (post.media.length) box.appendChild(media(post.media.filter((one) => one.type === 'photo').slice(0, 1), true));
        box.appendChild(link(`https://x.com/${post.author.handle}/status/${post.id}`, 'Open on X', 'tr-x-open'));
        return box;
    }

    const when = (iso) => {
        const at = new Date(iso);
        return Number.isNaN(at.getTime()) ? '' : at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    };

    /** One post of the thread: its place in it, when, its words, what it shows and quotes. */
    function postOf(post, place, reduce) {
        const box = make('div', 'tr-x-post');
        box.id = `bbr-post-${post.id}`;
        const head = make('p', 'tr-x-head');
        if (place) head.appendChild(make('span', 'tr-x-place', place));
        head.appendChild(link(`https://x.com/${post.author.handle}/status/${post.id}`, when(post.createdAt) || 'Open on X', 'tr-x-time'));
        box.appendChild(head);
        box.appendChild(words(post.segments));
        if (post.media.length) box.appendChild(media(post.media, reduce, `https://x.com/${post.author.handle}/status/${post.id}`));
        if (post.card && post.card.type === 'link' && /^https?:/.test(post.card.url)) {
            const card = make('p', 'tr-x-card');
            card.appendChild(link(post.card.url, post.card.title));
            if (post.card.domain) card.appendChild(make('span', 'tr-x-domain', ` — ${post.card.domain}`));
            box.appendChild(card);
        }
        if (post.card && post.card.type === 'poll') {
            const poll = make('ul', 'tr-x-poll');
            for (const choice of post.card.choices) poll.appendChild(make('li', '', `${choice.label} — ${choice.count} votes`));
            box.appendChild(poll);
        }
        if (post.quote) box.appendChild(quote(post.quote));
        return box;
    }

    /** The posts X has drawn, for a page with no conversation kept: the author's run from the top. */
    function drawnThread(doc, status) {
        const posts = [];
        for (const article of doc.querySelectorAll(DRAWN.post)) {
            const stamp = article.querySelector('time[datetime]');
            const anchor = stamp && stamp.closest('a[href*="/status/"]');
            const id = anchor && (/\/status\/(\d+)/.exec(anchor.getAttribute('href') || '') || [])[1];
            const handle = anchor && (/^\/([A-Za-z0-9_]{1,15})\//.exec(anchor.getAttribute('href') || '') || [])[1];
            if (!id || !handle) continue;
            if (handle.toLowerCase() !== status.handle.toLowerCase()) {
                if (posts.length) break;
                continue;
            }
            const text = article.querySelector(DRAWN.text);
            const nameEl = article.querySelector(`${DRAWN.author} a[href="/${handle}"]`) || article.querySelector(DRAWN.author);
            posts.push({
                id,
                author: { id: handle, handle, name: ((nameEl && nameEl.textContent) || handle).split('@')[0].trim() },
                createdAt: stamp.getAttribute('datetime'),
                segments: [{ type: 'text', text: text ? text.innerText || text.textContent : '' }],
                media: [
                    ...[...article.querySelectorAll(DRAWN.photo)].map((img) => ({ type: 'photo', url: img.src.replace(/([?&])name=\w+/, '$1name=large'), alt: img.alt || '' })),
                    ...[...article.querySelectorAll(DRAWN.video)].map((video) => ({ type: 'video', url: '', poster: video.poster || '', alt: '' })),
                ],
                quote: null,
                card: null,
            });
        }
        return posts.length ? { thread: posts, context: null, others: [], incomplete: true, author: posts[0].author, conversationId: posts[0].id, drawn: true } : null;
    }

    function read(doc = root.document, url = root.location.href) {
        const status = statusOf(url);
        if (!status) return null;
        const kept = (Bridge.ask(ASK, {}, ANSWER) || []).map((one) => one && one.text).filter((text) => typeof text === 'string');
        const { posts, heldAfter } = XThread.fromResponses(kept);
        const found = XThread.unroll(posts, status.id, { heldAfter }) || drawnThread(doc, status);
        if (!found) return null;
        const reduce = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
        const { thread, context, others, author } = found;
        const body = document.createDocumentFragment();

        if (context) {
            const answering = make('div', 'tr-x-context');
            answering.appendChild(make('p', 'tr-x-label', 'In reply to'));
            answering.appendChild(quote(context));
            body.appendChild(answering);
        }
        thread.forEach((post, i) => body.appendChild(postOf(post, thread.length > 1 ? `${i + 1}/${thread.length}` : '', reduce)));
        if (others.length) {
            body.appendChild(make('h2', 'tr-x-others', `Also from @${author.handle} in this conversation`));
            for (const { post, answers } of others) {
                if (answers) body.appendChild(quote(answers, 'tr-x-quote is-answered'));
                body.appendChild(postOf(post, '', reduce));
            }
        }
        if (found.incomplete) {
            const count = thread.length === 1 ? 'one post' : `${thread.length} posts`;
            body.appendChild(make('p', 'tr-x-more', found.drawn
                ? 'This is what X has drawn of the thread. Reload the page to read all of it, videos included, here.'
                : `X has sent ${count} of this thread so far. Its own “Show more” under the last one brings the rest; open the reader again after.`));
        }

        const first = thread[0];
        const opening = first.segments.map((segment) => segment.text).join('').trim().split('\n')[0];
        return {
            key: `x:${found.conversationId}`,
            url: `https://x.com/${author.handle}/status/${first.id}`,
            site: 'twitter',
            kind: 'thread',
            title: `Thread by @${author.handle}`,
            description: opening.length > 160 ? `${opening.slice(0, 157)}…` : opening,
            byline: author.name && author.name !== author.handle ? `${author.name} · @${author.handle}` : `@${author.handle}`,
            published: first.createdAt,
            siteName: 'X',
            lang: first.lang || '',
            body,
            aside: null,
            meta: { count: thread.length, incomplete: !!found.incomplete },
        };
    }

    const adapter = { id: 'x', read };

    const XThreadRead = { read, adapter, statusOf, DRAWN };

    root.BB = root.BB || {};
    root.BB.XThreadRead = XThreadRead;
    if (typeof module !== 'undefined' && module.exports) module.exports = XThreadRead;
})(typeof globalThis !== 'undefined' ? globalThis : this);
