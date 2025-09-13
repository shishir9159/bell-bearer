/**
 * Which site are we on, and which <video> on it is the one the user is
 * watching.
 *
 * Picking the right element matters more than it looks: the old code fell back
 * to `document.querySelector('video')`, which returns the *first* video in DOM
 * order. On a YouTube watch page that is often a hover-preview or an off-screen
 * player, so a speed change applied to a video nobody was watching and the main
 * player appeared to ignore the shortcut.
 */
(function (root) {
    'use strict';

    /** Selectors tried in order, per site, before the generic fallback. */
    const PLAYER_SELECTORS = {
        youtube: [
            '#movie_player video.html5-main-video',
            'ytd-player video.html5-main-video',
            'video.html5-main-video',
        ],
        netflix: ['.watch-video video', '#appMountPoint video'],
        reddit: ['shreddit-player video', '.media-element video', '[data-testid="shreddit-player"] video'],
        twitter: ['[data-testid="videoPlayer"] video'],
    };

    function detectSite(hostname = window.location.hostname) {
        const host = hostname.replace(/^www\./, '');
        if (/(^|\.)youtube(-nocookie)?\.com$/.test(host) || host === 'youtu.be') return 'youtube';
        if (/(^|\.)netflix\.com$/.test(host)) return 'netflix';
        if (/(^|\.)reddit\.com$/.test(host)) return 'reddit';
        if (/(^|\.)(twitter|x)\.com$/.test(host)) return 'twitter';
        return 'other';
    }

    /** A video the user could plausibly be watching: attached, sized, ready. */
    function isUsable(video) {
        if (!video || !video.isConnected) return false;
        const rect = video.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    /** Rank candidates so a playing, on-screen, large player wins. */
    function score(video) {
        const rect = video.getBoundingClientRect();
        const area = rect.width * rect.height;
        const onScreen = rect.bottom > 0 && rect.top < window.innerHeight;
        return (video.paused ? 0 : 4e9) + (onScreen ? 2e9 : 0) + area;
    }

    /**
     * The video element to act on, or null when the page has none.
     *
     * Callers hit this on every keystroke, so the result is memoised until the
     * element is detached — `querySelectorAll('video')` plus layout reads on a
     * page as large as YouTube is not free.
     */
    function createPlayerLocator(site) {
        let cached = null;

        return function getVideoElement() {
            if (isUsable(cached)) return cached;
            cached = null;

            for (const selector of PLAYER_SELECTORS[site] || []) {
                const found = document.querySelector(selector);
                if (isUsable(found)) {
                    cached = found;
                    return cached;
                }
            }

            const videos = Array.from(document.querySelectorAll('video')).filter(isUsable);
            if (videos.length === 0) return null;
            cached = videos.length === 1
                ? videos[0]
                : videos.reduce((best, video) => (score(video) > score(best) ? video : best));
            return cached;
        };
    }

    const Site = { detectSite, createPlayerLocator, PLAYER_SELECTORS };

    root.BB = root.BB || {};
    root.BB.Site = Site;
    if (typeof module !== 'undefined' && module.exports) module.exports = Site;
})(typeof globalThis !== 'undefined' ? globalThis : this);
