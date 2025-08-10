/**
 * Reading the current page: which video, its title, and whose channel it is.
 *
 * YouTube renames these containers regularly, so every lookup is a list of
 * selectors newest-first with a metadata fallback. The old single-selector
 * lookups had gone stale, which is why saved checkpoints were showing up as
 * "Unknown Title" or as the raw "… - YouTube" page title.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const YouTube = ns.YouTube || req('../shared/youtube.js');

    const TITLE_SELECTORS = [
        'ytd-watch-metadata h1 yt-formatted-string',
        'ytd-watch-metadata #title h1',
        'h1.ytd-video-primary-info-renderer',
        '#title h1',
        'h1.title',
    ];

    const CHANNEL_SELECTORS = [
        'ytd-video-owner-renderer ytd-channel-name a',
        'ytd-watch-metadata ytd-channel-name a',
        '#owner #channel-name a',
        'ytd-channel-name a',
        '#channel-name a',
    ];

    /** The channel's avatar and subscriber line, for the pouch panel's header. */
    const AVATAR_SELECTORS = [
        'ytd-video-owner-renderer #avatar img',
        'ytd-watch-metadata #owner img#img',
        '#owner yt-img-shadow img',
        'yt-page-header-renderer img.yt-spec-avatar-shape__image',
        '#channel-header-container #avatar img',
    ];

    const SUBSCRIBER_SELECTORS = [
        'ytd-video-owner-renderer #owner-sub-count',
        '#owner #owner-sub-count',
        'yt-content-metadata-view-model .yt-content-metadata-view-model__metadata-row span',
        '#subscriber-count',
    ];

    /**
     * The channel name on a channel's *own* page, which is a different header
     * from the owner block under a video — see getChannelInfo for why that one
     * cannot simply be asked first.
     */
    const CHANNEL_PAGE_SELECTORS = [
        'yt-page-header-renderer yt-dynamic-text-view-model h1',
        'yt-page-header-view-model h1',
        '#channel-header-container #channel-name #text',
        '#inner-header-container ytd-channel-name #text',
        'ytd-c4-tabbed-header-renderer #channel-name #text',
    ];

    /** /@handle, /channel/UC…, /c/name, /user/name — and nothing after it. */
    const CHANNEL_PATH = /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)/;

    function firstText(selectors) {
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            const text = element && (element.textContent || '').replace(/\s+/g, ' ').trim();
            if (text) return { element, text };
        }
        return null;
    }

    /** The watch/shorts video id in the address bar, or null elsewhere. */
    function getVideoId(url = window.location.href) {
        return YouTube.extractVideoId(url);
    }

    function getVideoTitle() {
        const found = firstText(TITLE_SELECTORS);
        if (found) return found.text;

        const meta = document.querySelector('meta[name="title"]');
        const metaTitle = meta && meta.getAttribute('content');
        if (metaTitle) return metaTitle.trim();

        // Last resort: the tab title, minus the site suffix and unread badge.
        const title = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '').trim();
        return title || 'Unknown Title';
    }

    /**
     * The avatar image URL, or ''. Only http(s) is returned — the caller puts
     * this straight into a src attribute, and YouTube sometimes leaves a
     * data-placeholder in the img until the real one loads.
     */
    function getChannelAvatar() {
        for (const selector of AVATAR_SELECTORS) {
            const img = document.querySelector(selector);
            const src = img && (img.src || img.getAttribute('src') || '');
            if (src && /^https?:/.test(src)) return src;
        }
        return '';
    }

    /**
     * "148K subscribers", or '' when the page does not show it.
     *
     * Every match is read, not only the first one that has text in it. A
     * channel page sets the handle, the subscriber count and the video count
     * in three identical spans of one metadata row, so the first of them is
     * the handle — the count is found by reading the word, not by position.
     */
    function getSubscriberText() {
        for (const selector of SUBSCRIBER_SELECTORS) {
            for (const element of document.querySelectorAll(selector)) {
                const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
                if (/subscrib/i.test(text)) return text;
            }
        }
        return '';
    }

    /**
     * The root of the channel page we are on — '/@mathwithming' for any of its
     * tabs — or '' when this is not a channel page.
     *
     * Trimmed back to the root on purpose: a channel filed from /@x/videos and
     * met again on /@x has to come out as one channel, and the pouch keys them
     * by this path.
     */
    function channelPagePath(path = window.location.pathname) {
        const match = CHANNEL_PATH.exec(path);
        return match ? match[0] : '';
    }

    /** The name in <meta>, then the tab title, then a placeholder. */
    function fallbackChannelName() {
        const meta = document.querySelector('meta[itemprop="name"], meta[property="og:title"]');
        return (meta && meta.getAttribute('content')) ||
            (document.title || '').replace(/\s*-\s*YouTube$/, '').trim() ||
            'Unknown Channel';
    }

    function getChannelInfo() {
        const extra = { avatar: getChannelAvatar(), subscribers: getSubscriberText() };

        // A channel's own page is answered from its header and its URL before
        // CHANNEL_SELECTORS get a look in. Those are written for the owner
        // block under a video, and the only thing they can match on a channel
        // page is a `ytd-channel-name` belonging to one of the videos in the
        // grid — which would file that channel instead of the one whose page
        // is actually on screen.
        const root = channelPagePath();
        if (root) {
            const header = firstText(CHANNEL_PAGE_SELECTORS);
            return {
                ...extra,
                channelName: (header && header.text) || fallbackChannelName(),
                channelUrl: window.location.origin + root,
            };
        }

        const found = firstText(CHANNEL_SELECTORS);
        if (found) {
            const href = found.element.getAttribute('href') || found.element.href || '';
            return {
                ...extra,
                channelName: found.text,
                channelUrl: href ? new URL(href, 'https://www.youtube.com').href : window.location.href,
            };
        }

        return { ...extra, channelName: fallbackChannelName(), channelUrl: window.location.href };
    }

    const PageInfo = {
        getVideoId, getVideoTitle, getChannelInfo, getChannelAvatar, getSubscriberText,
        channelPagePath,
        TITLE_SELECTORS, CHANNEL_SELECTORS, AVATAR_SELECTORS, SUBSCRIBER_SELECTORS,
        CHANNEL_PAGE_SELECTORS,
    };

    root.BB = root.BB || {};
    root.BB.PageInfo = PageInfo;
    if (typeof module !== 'undefined' && module.exports) module.exports = PageInfo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
