/**
 * Reading x.com's DOM: every selector in one table, and the two readers that
 * turn a chunk of X's markup into a post or a person.
 *
 * This is the file that will rot. X renames its classes constantly and ships
 * A/B variants to different accounts on the same day, so the rules here are
 * the ones the chess sites taught us: several spellings per thing, newest
 * first, and never collapse a list to "the current one". What is stable is
 * `data-testid` — X's own test hooks — which is why almost nothing below is a
 * class name.
 *
 * Nothing here writes to the page or to storage. It answers questions about
 * what is on screen, so the UI file can stay about buttons and panels.
 */
(function (root) {
    'use strict';

    const SELECTORS = Object.freeze({
        /** One post, anywhere it appears: timeline, thread, profile, search. */
        post: ['article[data-testid="tweet"]', 'article[role="article"]'],

        /** The Reply / Repost / Like / Bookmark row inside a post. */
        actions: ['[role="group"][id^="id__"]', '[role="group"]'],

        /** The post's own text. Absent on an image-only post, which is fine. */
        text: ['[data-testid="tweetText"]'],

        /** The name/handle cluster at the top of a post. */
        author: ['[data-testid="User-Name"]'],

        /** The post's avatar. X nests the real <img> a few levels down. */
        postAvatar: [
            '[data-testid="Tweet-User-Avatar"] img[src*="profile_images"]',
            '[data-testid^="UserAvatar-Container-"] img[src*="profile_images"]',
            'img[src*="profile_images"]',
        ],

        /**
         * A promoted post. X wraps paid placements in this rather than only
         * labelling them, which is what makes hiding them a structural test
         * instead of a hunt for the word "Promoted" in eleven languages.
         */
        promoted: ['[data-testid="placementTracking"]'],

        /** X's own upsells, which are not third-party ads but are not posts. */
        upsell: [
            '[data-testid="premium-signup-tab"]',
            '[data-testid="super-upsell"]',
            '[data-testid="verified_profile_upsell"]',
            'aside[aria-label*="Premium"]',
            'aside[aria-label*="Subscribe"]',
        ],

        /** The left navigation column, where the Pouch entry goes. */
        nav: [
            'header[role="banner"] nav[role="navigation"]',
            'nav[aria-label="Primary"]',
            'header nav',
        ],

        /** A nav row to copy the metrics of, and to sit beneath. */
        navHome: ['a[data-testid="AppTabBar_Home_Link"]', 'nav[role="navigation"] a[href="/home"]'],

        /**
         * Every row of the left navigation, so ours can be matched to the
         * ones around it.
         *
         * Home is not enough on its own. X draws the row you are on in bold
         * and the rest in the body weight, and Home is the row you are on
         * most of the time — so a Pouch row that copied Home wore the
         * selected weight permanently. Both readings are wanted, and
         * `aria-current` is how X marks which is which.
         */
        navRows: [
            'header[role="banner"] nav[role="navigation"] a[href]',
            'nav[role="navigation"] a[href]',
            'header nav a[href]',
        ],

        /** The profile header's action row, where the add-to-pouch button goes. */
        profileActions: ['[data-testid="userActions"]'],

        /** The profile's display name and handle block. */
        profileName: ['[data-testid="UserName"]'],

        /** The profile's own avatar, which is not inside a post. */
        profileAvatar: [
            'a[href$="/photo"] img[src*="profile_images"]',
            '[data-testid^="UserAvatar-Container-"] img[src*="profile_images"]',
        ],
    });

    /** The first element matching any spelling, in order. */
    function find(names, scope = document) {
        for (const selector of SELECTORS[names] || []) {
            const found = scope.querySelector(selector);
            if (found) return found;
        }
        return null;
    }

    /** Every element matching any spelling — the first spelling that hits wins. */
    function findAll(names, scope = document) {
        for (const selector of SELECTORS[names] || []) {
            const found = scope.querySelectorAll(selector);
            if (found.length) return Array.from(found);
        }
        return [];
    }

    /** Does `element` match, or sit inside something matching, `names`? */
    function closest(names, element) {
        for (const selector of SELECTORS[names] || []) {
            const hit = element.closest && element.closest(selector);
            if (hit) return hit;
        }
        return null;
    }

    /**
     * The biggest version of an avatar that is still cheap.
     *
     * X serves profile images at several sizes off the same path — `_normal`
     * is 48px and is what the timeline uses, `_bigger` is 73px, `_400x400` is
     * the full one. The panel draws them at 28-30px on displays that are
     * routinely 2x, so `_normal` is visibly soft; `_bigger` is the next rung
     * and costs nothing extra because it is the same CDN object the profile
     * page already pulled. Anything not matching the pattern is left alone.
     */
    function avatarUrl(img) {
        const src = (img && img.src) || '';
        if (!/^https:\/\/pbs\.twimg\.com\/profile_images\//.test(src)) return '';
        return src.replace(/_(normal|mini|x96)\.(jpg|jpeg|png|webp|gif)$/i, '_bigger.$2');
    }

    /** '@handle' from any x.com profile link, or '' if it is not one. */
    function handleFromHref(href) {
        const path = String(href || '').replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com/i, '');
        const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(path);
        if (!match) return '';
        // These are x.com's own pages, not accounts, and several of them sit
        // at a one-segment path that looks exactly like a handle.
        const reserved = new Set(['home', 'explore', 'notifications', 'messages', 'i',
            'search', 'settings', 'compose', 'bookmarks', 'jobs', 'lists', 'topics']);
        return reserved.has(match[1].toLowerCase()) ? '' : `@${match[1]}`;
    }

    /**
     * Read one post out of its <article>.
     *
     * Returns null rather than a half-filled record when there is no status
     * id: that id is how a post is keyed in storage, so a post without one
     * cannot be filed, moved or recognised again, and half a record would
     * file the same post twice on the next scroll.
     */
    function readPost(article) {
        if (!article) return null;

        // The timestamp link is the only reliable source of the status id.
        // The article's own testid carries no id, and a post reached from a
        // quote or a thread has several status links inside it — this takes
        // the one wrapping the <time>, which always belongs to the post
        // itself rather than to something it quotes.
        const time = article.querySelector('time[datetime]');
        const stamp = time && time.closest('a[href*="/status/"]');
        const id = stamp && (/\/status\/(\d+)/.exec(stamp.getAttribute('href') || '') || [])[1];
        if (!id) return null;

        const author = find('author', article);
        const link = author && author.querySelector('a[href^="/"]');
        const handle = handleFromHref(link && link.getAttribute('href'));

        // The display name comes from that first link, not from the author
        // block as a whole. Both point at the same profile, but the block
        // also carries the handle, a middot and the "6h" timestamp, and
        // reading the lot and cutting at the '@' picks up whichever of those
        // X happened to put first — in one layout that is the timestamp, and
        // the name came out as "Ilya Sorokin 6h".
        //
        // The cut at '@' is still here because some layouts wrap the name and
        // the handle in one link; the handle is never part of a name. The
        // whitespace collapse is because X sets the two on separate lines.
        const label = ((link && link.textContent) || (author && author.textContent) || '');
        const name = label.split('@')[0].replace(/·[\s\S]*$/, '').replace(/\s+/g, ' ').trim();

        const textNode = find('text', article);
        const avatar = avatarUrl(find('postAvatar', article));

        return {
            statusId: id,
            handle,
            name: name || handle,
            text: (textNode && textNode.textContent.trim()) || '',
            url: `https://x.com/${handle.slice(1) || 'i'}/status/${id}`,
            postedAt: time ? Date.parse(time.getAttribute('datetime')) || 0 : 0,
            avatar,
        };
    }

    /** Is this /<handle> — a profile page — and whose? '' when it is not one. */
    function profileHandle() {
        // Only the bare one-segment path is a profile. /<handle>/status/… is a
        // post and /<handle>/followers is a list, and putting an
        // "add to pouch" button on either would file the wrong thing from the
        // wrong page.
        if (/^\/[A-Za-z0-9_]{1,15}\/?$/.test(location.pathname) === false) return '';
        return handleFromHref(location.pathname);
    }

    /** Read the person whose profile is on screen, or null. */
    function readProfile() {
        const handle = profileHandle();
        if (!handle) return null;

        const block = find('profileName');
        const label = (block && block.textContent) || '';
        const name = label.split('@')[0].trim();

        return {
            handle,
            name: name || handle,
            avatar: avatarUrl(find('profileAvatar')),
        };
    }

    const TwitterPage = {
        SELECTORS, find, findAll, closest,
        avatarUrl, handleFromHref, readPost, readProfile, profileHandle,
    };

    root.BB = root.BB || {};
    root.BB.TwitterPage = TwitterPage;
    if (typeof module !== 'undefined' && module.exports) module.exports = TwitterPage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
