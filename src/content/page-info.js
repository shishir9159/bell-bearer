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

    function getChannelInfo() {
        const found = firstText(CHANNEL_SELECTORS);
        if (found) {
            const href = found.element.getAttribute('href') || found.element.href || '';
            return {
                channelName: found.text,
                channelUrl: href ? new URL(href, 'https://www.youtube.com').href : window.location.href,
            };
        }

        const path = window.location.pathname;
        const onChannelPage = /^\/(@|channel\/|c\/|user\/)/.test(path);
        const meta = document.querySelector('meta[itemprop="name"], meta[property="og:title"]');

        return {
            channelName: (meta && meta.getAttribute('content')) ||
                (document.title || '').replace(/\s*-\s*YouTube$/, '').trim() ||
                'Unknown Channel',
            channelUrl: onChannelPage
                ? window.location.origin + path
                : window.location.href,
        };
    }

    const PageInfo = { getVideoId, getVideoTitle, getChannelInfo, TITLE_SELECTORS, CHANNEL_SELECTORS };

    root.BB = root.BB || {};
    root.BB.PageInfo = PageInfo;
    if (typeof module !== 'undefined' && module.exports) module.exports = PageInfo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
