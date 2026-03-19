/**
 * An X thread, read out of X's own conversation responses: every post the
 * author wrote, in order, with its photos and its videos.
 *
 * The responses are what src/content/twitter-thread-page.js kept of the
 * page's own TweetDetail and TweetResultByRestId queries. This turns them
 * into posts and the posts into a thread, and is pure — node checks it on
 * responses shaped as X sends them.
 *
 * **The thread is the author's, not X's drawing of it.** Starting from the
 * post the page is open on, it climbs to the first of the author's own posts
 * in the chain and walks down again by the author's own replies, which is
 * the thread as written; an Obsidian-style clipper reading the page stops at
 * the first post by anyone else that X happens to have drawn in between.
 * Everything else the author said in the conversation is kept too, under the
 * thread, each beside the post it answers.
 *
 * Two shapes for nearly everything, as X ships them: the author's handle in
 * `core.screen_name` (newer) or `legacy.screen_name`, a post wrapped in
 * TweetWithVisibilityResults or not. A post X will not show is a tombstone,
 * kept as one line that says so.
 */
(function (root) {
    'use strict';

    /** A video no wider than this: the largest X makes is more than a reading column needs. */
    const MAX_VIDEO_WIDTH = 1280;

    const PHOTO_HOSTS = /^https:\/\/pbs\.twimg\.com\//;
    const VIDEO_HOSTS = /^https:\/\/video\.twimg\.com\//;

    /** A post's own record, out of the wrappers X puts around it. */
    function unwrap(result) {
        let one = result;
        for (let depth = 0; one && depth < 3; depth++) {
            if (one.__typename === 'TweetWithVisibilityResults' && one.tweet) one = one.tweet;
            else if (one.result && !one.rest_id && !one.legacy) one = one.result;
            else break;
        }
        return one || null;
    }

    function userOf(core) {
        const user = unwrap(core && core.user_results && core.user_results.result) || {};
        const legacy = user.legacy || {};
        const own = user.core || {};
        return {
            id: String(user.rest_id || ''),
            handle: String(own.screen_name || legacy.screen_name || ''),
            name: String(own.name || legacy.name || ''),
            avatar: String((user.avatar && user.avatar.image_url) || legacy.profile_image_url_https || ''),
        };
    }

    /**
     * Text and its entities as segments: plain text, and links, mentions
     * and tags as what they say and where they go. Entity offsets count
     * code points, not UTF-16 units — sliced as a string, every entity after
     * an emoji came out one character to the left, and a link swallowed the
     * letter before it. `range` is display_text_range: the reply's leading
     * @mentions and the trailing link to its own media are not the text.
     */
    function segmentsOf(text, entities = {}, range = null) {
        const chars = Array.from(String(text || ''));
        const [from, to] = range && range.length === 2 ? range : [0, chars.length];
        const marks = [];
        for (const url of entities.urls || []) {
            marks.push({ start: url.indices[0], end: url.indices[1], type: 'link', text: url.display_url || url.expanded_url, href: url.expanded_url || url.url });
        }
        for (const user of entities.user_mentions || []) {
            marks.push({ start: user.indices[0], end: user.indices[1], type: 'mention', href: `https://x.com/${user.screen_name}` });
        }
        for (const tag of entities.hashtags || []) {
            marks.push({ start: tag.indices[0], end: tag.indices[1], type: 'tag', href: `https://x.com/hashtag/${encodeURIComponent(tag.text)}` });
        }
        for (const media of entities.media || []) marks.push({ start: media.indices[0], end: media.indices[1], type: 'drop' });
        marks.sort((a, b) => a.start - b.start);
        const out = [];
        let at = from;
        const plain = (a, b) => {
            if (b > a) out.push({ type: 'text', text: decode(chars.slice(a, b).join('')) });
        };
        for (const mark of marks) {
            if (mark.start < at || mark.start >= to) continue;
            plain(at, mark.start);
            const words = decode(chars.slice(mark.start, Math.min(mark.end, to)).join(''));
            if (mark.type !== 'drop') out.push({ type: mark.type, text: mark.type === 'link' ? mark.text : words, href: mark.href });
            at = Math.min(mark.end, to);
        }
        plain(at, to);
        return out;
    }

    /** X sends text with &amp; &lt; &gt; escaped, whatever the format. */
    const decode = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

    function mediaOf(legacy) {
        const list = (legacy.extended_entities && legacy.extended_entities.media) || (legacy.entities && legacy.entities.media) || [];
        return list.map((one) => {
            const poster = PHOTO_HOSTS.test(one.media_url_https || '') ? one.media_url_https : '';
            const size = one.original_info || {};
            if (one.type === 'photo') {
                return poster && { type: 'photo', url: `${poster}?name=large`, alt: one.ext_alt_text || '', width: size.width || 0, height: size.height || 0 };
            }
            const variants = ((one.video_info && one.video_info.variants) || [])
                .filter((variant) => variant.content_type === 'video/mp4' && VIDEO_HOSTS.test(variant.url || ''))
                .map((variant) => ({ url: variant.url, bitrate: variant.bitrate || 0, width: Number((/\/(\d+)x\d+\//.exec(variant.url) || [])[1]) || 0 }))
                .sort((a, b) => b.bitrate - a.bitrate);
            const fits = variants.find((variant) => !variant.width || variant.width <= MAX_VIDEO_WIDTH) || variants[variants.length - 1];
            return {
                type: one.type === 'animated_gif' ? 'gif' : 'video',
                url: fits ? fits.url : '',
                poster,
                alt: one.ext_alt_text || '',
                width: size.width || 0,
                height: size.height || 0,
            };
        }).filter(Boolean);
    }

    /** A link card, as its binding values name it. */
    function cardOf(record) {
        const legacy = record.card && record.card.legacy;
        if (!legacy || !Array.isArray(legacy.binding_values)) return null;
        const value = (key) => {
            const found = legacy.binding_values.find((one) => one.key === key);
            return found && found.value ? found.value.string_value || (found.value.image_value && found.value.image_value.url) || '' : '';
        };
        if (/^poll\d/.test(legacy.name || '')) {
            const choices = [];
            for (let i = 1; i <= 4; i++) {
                const label = value(`choice${i}_label`);
                if (label) choices.push({ label, count: Number(value(`choice${i}_count`)) || 0 });
            }
            return choices.length ? { type: 'poll', choices } : null;
        }
        const title = value('title');
        const url = value('card_url') || (legacy.url || '');
        return title ? { type: 'link', title, domain: value('vanity_url') || value('domain'), url, image: value('thumbnail_image_large') || value('summary_photo_image_large') } : null;
    }

    /**
     * One post, or null for something that is not one. `depth` keeps a
     * quoted post's own quote from being read: one level, as X draws it.
     */
    function normalize(result, depth = 0) {
        const record = unwrap(result);
        if (!record) return null;
        if (record.__typename === 'TweetTombstone') return { unavailable: true, text: 'This post is unavailable.' };
        const legacy = record.legacy;
        if (!legacy || !record.rest_id) return null;
        const note = record.note_tweet && record.note_tweet.note_tweet_results && record.note_tweet.note_tweet_results.result;
        // A long post's whole text is in its note; legacy has its first 280 characters.
        const segments = note && note.text
            ? segmentsOf(note.text, note.entity_set || {})
            : segmentsOf(legacy.full_text, legacy.entities || {}, legacy.display_text_range);
        const quoted = depth === 0 && record.quoted_status_result ? normalize(record.quoted_status_result.result, 1) : null;
        return {
            id: String(record.rest_id),
            conversationId: String(legacy.conversation_id_str || record.rest_id),
            replyTo: legacy.in_reply_to_status_id_str ? String(legacy.in_reply_to_status_id_str) : null,
            replyToHandle: legacy.in_reply_to_screen_name || '',
            author: userOf(record.core),
            createdAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : '',
            lang: legacy.lang && legacy.lang !== 'und' && legacy.lang !== 'zxx' ? legacy.lang : '',
            replies: Number(legacy.reply_count) || 0,
            segments,
            media: mediaOf(legacy),
            quote: quoted,
            card: cardOf(record),
        };
    }

    /**
     * Every post in a response, and after which posts X held the rest of a
     * chain back behind a "Show more" of its own: a conversation module ends
     * with that cursor when it has more of its chain than it sent.
     */
    function parse(json) {
        const posts = [];
        const heldAfter = [];
        const content = (item) => item && (item.itemContent || (item.content && item.content.itemContent));
        const data = (json && json.data) || {};
        const conversation = data.threaded_conversation_with_injections_v2 || data.threaded_conversation_with_injections || {};
        for (const instruction of conversation.instructions || []) {
            for (const entry of instruction.entries || (instruction.entry ? [instruction.entry] : [])) {
                const body = entry.content || {};
                let last = null;
                for (const item of [body, ...(body.items || []).map((one) => one.item || one)]) {
                    const inner = content(item);
                    if (!inner) continue;
                    const post = inner.tweet_results ? normalize(inner.tweet_results.result) : null;
                    if (post && post.id) {
                        posts.push(post);
                        last = post.id;
                    }
                    if (inner.itemType === 'TimelineTimelineCursor' && /ShowMore/i.test(inner.cursorType || '') && last) heldAfter.push(last);
                }
            }
        }
        if (data.tweetResult) {
            const post = normalize(data.tweetResult.result);
            if (post && post.id) posts.push(post);
        }
        return { posts, heldAfter };
    }

    /** Snowflake ids, compared as the numbers they are: strings of different lengths sort wrong. */
    const older = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);

    /**
     * The thread through `focalId`: the author's own chain from its first
     * post down, what that first post answers if it answers someone, the
     * author's other posts in the conversation beside what each answers, and
     * whether more of the thread is still to come from X.
     */
    function unroll(posts, focalId, { heldAfter = [] } = {}) {
        const byId = new Map();
        for (const post of posts) {
            const had = byId.get(post.id);
            // The fuller of two copies: a long post's note is not in every response.
            if (!had || JSON.stringify(post).length > JSON.stringify(had).length) byId.set(post.id, post);
        }
        const focal = byId.get(String(focalId));
        if (!focal) return null;
        const author = focal.author.id || focal.author.handle;
        const mine = (post) => post && !post.unavailable && (post.author.id || post.author.handle) === author;

        let first = focal;
        while (first.replyTo && mine(byId.get(first.replyTo))) first = byId.get(first.replyTo);
        const context = first.replyTo ? byId.get(first.replyTo) || null : null;

        const all = [...byId.values()].filter((post) => !post.unavailable);
        const thread = [first];
        const used = new Set([first.id]);
        for (let tail = first; ;) {
            const next = all.filter((post) => post.replyTo === tail.id && mine(post) && !used.has(post.id)).sort(older)[0];
            if (!next) break;
            thread.push(next);
            used.add(next.id);
            tail = next;
        }
        const tail = thread[thread.length - 1];
        const others = all.filter((post) => mine(post) && !used.has(post.id) && post.conversationId === first.conversationId)
            .sort(older)
            .map((post) => ({ post, answers: post.replyTo ? byId.get(post.replyTo) || null : null }));
        // More to come: X held the rest of the chain back after the last
        // post, or that post has replies none of which arrived — the
        // author's next post may well be among them.
        const incomplete = heldAfter.includes(tail.id) || (tail.replies > 0 && !all.some((post) => post.replyTo === tail.id));
        return { thread, context, others, incomplete, author: first.author, conversationId: first.conversationId };
    }

    /** Every response kept, read and joined: one list of posts, and where any held the rest back. */
    function fromResponses(texts) {
        const posts = [];
        const heldAfter = [];
        for (const text of texts) {
            let json = null;
            try { json = JSON.parse(text); } catch (_) { continue; }
            const read = parse(json);
            posts.push(...read.posts);
            heldAfter.push(...read.heldAfter);
        }
        return { posts, heldAfter };
    }

    const XThread = { parse, normalize, segmentsOf, mediaOf, unroll, fromResponses, MAX_VIDEO_WIDTH };

    root.BB = root.BB || {};
    root.BB.XThread = XThread;
    if (typeof module !== 'undefined' && module.exports) module.exports = XThread;
})(typeof globalThis !== 'undefined' ? globalThis : this);
