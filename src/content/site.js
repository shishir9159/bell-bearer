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
        twitter: ['[data-testid="videoPlayer"] video'],
    };

    /**
     * Players that keep their <video> inside a shadow root of their own, so
     * neither the selectors above nor the generic `querySelectorAll('video')`
     * can reach it, newest spelling first.
     *
     * Reddit's is the one that made this necessary: a feed of shreddit-player
     * elements, each with an open shadow root holding the <video>, and not
     * one <video> in the page's own DOM (seen 2026-10-11). Reddit used to
     * have `shreddit-player video` above, which never matched, so the locator
     * found nothing and the speed keys did nothing on any Reddit video.
     * Reddit is also a feed, so there is no "first one" to pick: every
     * player found is ranked the way the generic fallback ranks.
     */
    const SHADOW_HOSTS = {
        reddit: ['shreddit-player-2', 'shreddit-player'],
    };

    function detectSite(hostname = window.location.hostname) {
        const host = hostname.replace(/^www\./, '');
        if (/(^|\.)youtube(-nocookie)?\.com$/.test(host) || host === 'youtu.be') return 'youtube';
        if (/(^|\.)netflix\.com$/.test(host)) return 'netflix';
        if (/(^|\.)reddit\.com$/.test(host)) return 'reddit';
        if (/(^|\.)(twitter|x)\.com$/.test(host)) return 'twitter';
        if (/(^|\.)chess\.com$/.test(host)) return 'chess';
        if (/(^|\.)lichess\.org$/.test(host)) return 'lichess';
        if (/(^|\.)leetcode\.com$/.test(host)) return 'leetcode';
        // play.typeracer.com is where a race happens and data.typeracer.com
        // is where the site keeps its own stats, so the whole domain is
        // matched rather than the one subdomain.
        if (/(^|\.)typeracer\.com$/.test(host)) return 'typeracer';
        if (/(^|\.)(chatgpt\.com|chat\.openai\.com)$/.test(host)) return 'chatgpt';
        if (/(^|\.)claude\.ai$/.test(host)) return 'claude';
        // The forges by their exact host: gist.github.com and
        // docs.gitlab.com are other sites, with no runs on them.
        if (host === 'github.com') return 'github';
        if (host === 'gitlab.com') return 'gitlab';
        // Codeberg runs Forgejo, and the adapter is Forgejo's.
        if (host === 'codeberg.org') return 'forgejo';
        // vimeo.com alone: player.vimeo.com is the player's frame on other
        // sites' pages, where a content script does not run.
        if (host === 'vimeo.com') return 'vimeo';
        return 'other';
    }

    /** A video the user could plausibly be watching: attached, sized, ready. */
    function isUsable(video) {
        if (!video || !video.isConnected) return false;
        const rect = video.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    const onScreen = (rect) => rect.bottom > 0 && rect.top < window.innerHeight;
    const isOnScreen = (video) => onScreen(video.getBoundingClientRect());

    /** Rank candidates so a playing, on-screen, large player wins. */
    function score(video) {
        const rect = video.getBoundingClientRect();
        const area = rect.width * rect.height;
        return (video.paused ? 0 : 4e9) + (onScreen(rect) ? 2e9 : 0) + area;
    }

    /** Every <video> on the page, those inside `site`'s shadow hosts included. */
    function allVideos(site) {
        const found = Array.from(document.querySelectorAll('video'));
        const hosts = SHADOW_HOSTS[site];
        if (!hosts) return found;
        for (const host of document.querySelectorAll(hosts.join(','))) {
            if (host.shadowRoot) found.push(...host.shadowRoot.querySelectorAll('video'));
        }
        return found;
    }

    /**
     * The video element to act on, or null when the page has none.
     *
     * Callers hit this on every keystroke, so the result is memoised —
     * `querySelectorAll('video')` plus layout reads on a page as large as
     * YouTube is not free. Memoised while it is on screen, not only while it
     * is attached: on a feed the first player found stays attached long after
     * it is scrolled past, and the keys went on speeding up a video nobody
     * could see. Off screen, it is looked for again, and a page with one
     * player finds the same one.
     */
    function createPlayerLocator(site) {
        let cached = null;

        return function getVideoElement() {
            if (isUsable(cached) && isOnScreen(cached)) return cached;
            cached = null;

            for (const selector of PLAYER_SELECTORS[site] || []) {
                const found = document.querySelector(selector);
                if (isUsable(found)) {
                    cached = found;
                    return cached;
                }
            }

            const videos = allVideos(site).filter(isUsable);
            if (videos.length === 0) return null;
            cached = videos.length === 1
                ? videos[0]
                : videos.reduce((best, video) => (score(video) > score(best) ? video : best));
            return cached;
        };
    }

    /**
     * The short that is playing, newest spelling first. Shorts preloads the
     * renderers either side of the one on screen, some with a <video> of
     * their own, so "the first video" is not good enough: the active
     * renderer is asked for, and failing every spelling, the playing,
     * on-screen, largest video wins the same way the locator above decides.
     */
    const SHORTS_SELECTORS = [
        'ytd-reel-video-renderer[is-active] video',
        '#shorts-player video',
        'ytd-shorts video.html5-main-video',
    ];

    function isShortsPath(pathname = window.location.pathname) {
        return /^\/shorts\/[^/]+/.test(String(pathname || ''));
    }

    function activeShortsVideo(scope = document) {
        for (const selector of SHORTS_SELECTORS) {
            const found = Array.from(scope.querySelectorAll(selector)).find(isUsable);
            if (found) return found;
        }
        const videos = Array.from(scope.querySelectorAll('video')).filter(isUsable);
        return videos.length ? videos.reduce((best, video) => (score(video) > score(best) ? video : best)) : null;
    }

    /**
     * Where a skip of `delta` seconds from `now` lands: never before the
     * start, and forward only as far as just short of the end — a short
     * loops, and a seek to its very end starts it over, which reads as the
     * skip having gone backwards.
     */
    function shortsSeekTo(now, delta, duration) {
        const target = Math.max(0, (Number(now) || 0) + delta);
        return Number.isFinite(duration) && duration > 0 ? Math.min(target, Math.max(0, duration - 0.25)) : target;
    }

    const Site = {
        detectSite, createPlayerLocator, PLAYER_SELECTORS, SHADOW_HOSTS,
        SHORTS_SELECTORS, isShortsPath, activeShortsVideo, shortsSeekTo,
    };

    root.BB = root.BB || {};
    root.BB.Site = Site;
    if (typeof module !== 'undefined' && module.exports) module.exports = Site;
})(typeof globalThis !== 'undefined' ? globalThis : this);
