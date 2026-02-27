/**
 * Netflix outside a watch party: how loud its previews play.
 *
 * Netflix plays a trailer, with sound, under every card the pointer rests
 * on, in the card opened from one, and in the billboard at the top of the
 * page — at full volume, with nothing but a mute button to answer it.
 * Settings › Netflix gives them a level of their own.
 *
 * A preview is any <video> that is not an episode's player. Its level is
 * written on that element alone, so the episode's own volume is never in
 * play. Its mute is never touched: a preview muted with Netflix's button
 * stays muted, whichever way Netflix spells that — `muted`, or a volume of 0.
 */
(function (root) {
    'use strict';

    /**
     * Writes to one element allowed within WRITE_WINDOW_MS. Should Netflix
     * put its own level back every time, the two would trade volumechange
     * events forever; past this, the preview is left as Netflix has it.
     */
    const MAX_WRITES = 4;
    const WRITE_WINDOW_MS = 2000;

    /** An episode's player, which is not a preview. */
    const WATCHING = '.watch-video';

    const isWatchPath = (pathname) => /^\/watch\//.test(String(pathname || ''));

    /** The volume a 0–100 setting asks for, or null at 100 or anything unreadable: Netflix's own. */
    function previewLevel(percent) {
        const value = Number(percent);
        if (percent === '' || percent === null || !Number.isFinite(value) || value >= 100) return null;
        return Math.max(0, value) / 100;
    }

    function createNetflixUi({
        getSettings,
        doc = root.document,
        pathname = () => root.location.pathname,
        now = () => Date.now(),
    }) {
        /** The times each element was last written, within the window. */
        const writes = new WeakMap();
        /** Previews this turned down, to turn back up when the setting goes back to 100. */
        const lowered = new WeakSet();

        const isPreview = (video) => !!video && video.tagName === 'VIDEO' &&
            !isWatchPath(pathname()) && !(video.closest && video.closest(WATCHING));

        function mayWrite(video) {
            const at = now();
            const recent = (writes.get(video) || []).filter((time) => at - time < WRITE_WINDOW_MS);
            const ok = recent.length < MAX_WRITES;
            if (ok) recent.push(at);
            writes.set(video, recent);
            return ok;
        }

        function level(video) {
            if (!isPreview(video)) return;
            const muted = video.muted || video.volume === 0;
            const target = previewLevel(getSettings().netflixPreviewVolume);
            if (target === null) {
                if (lowered.has(video) && !muted && video.volume < 1 && mayWrite(video)) video.volume = 1;
                lowered.delete(video);
                return;
            }
            if (muted || Math.abs(video.volume - target) < 0.005 || !mayWrite(video)) return;
            video.volume = target;
            lowered.add(video);
        }

        // `play` is ahead of the first sound, so a preview never starts loud
        // and then drops; `volumechange` is Netflix's unmute, or its own
        // level being put back over ours.
        const EVENTS = ['loadedmetadata', 'play', 'volumechange'];
        const onMedia = (event) => level(event.target);

        function install() {
            EVENTS.forEach((type) => doc.addEventListener(type, onMedia, { capture: true, passive: true }));
        }

        /** The setting changed: the previews already playing follow it. */
        function refresh() {
            doc.querySelectorAll('video').forEach(level);
        }

        return { install, refresh, isPreview };
    }

    const NetflixUi = { createNetflixUi, previewLevel, isWatchPath, MAX_WRITES, WRITE_WINDOW_MS };

    root.BB = root.BB || {};
    root.BB.NetflixUi = NetflixUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = NetflixUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
