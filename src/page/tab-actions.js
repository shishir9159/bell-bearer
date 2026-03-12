/**
 * Driving a video in another tab from the popup or the dashboard.
 *
 * Both surfaces used to do this themselves, and both got it wrong in the same
 * way: they added a flat +/-0.5 to playbackRate instead of stepping the ladder
 * the keyboard uses, so mixing the two controls left the rate between rungs.
 * Everything here goes through the content script, which owns the ladder; the
 * injected fallback (for a tab the content script never loaded into) is handed
 * the same steps rather than inventing its own.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Speed = ns.Speed || req('../shared/speed.js');
    const YouTube = ns.YouTube || req('../shared/youtube.js');

    async function activeTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab || null;
    }

    /** The tab already playing `videoId`, or null. */
    async function findVideoTab(videoId) {
        try {
            const tabs = await chrome.tabs.query({});
            return tabs.find((tab) => YouTube.extractVideoId(tab.url || '') === videoId) || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Send a message to the content script, resolving to null when it is not
     * there (a tab loaded before the extension, or a restricted page).
     */
    async function ask(tabId, message) {
        try {
            return await chrome.tabs.sendMessage(tabId, message);
        } catch (_) {
            return null;
        }
    }

    /**
     * Run `func` in the page when the content script is unavailable.
     * Resolves to null if scripting is not permitted there either.
     */
    async function inject(tabId, func, args) {
        try {
            const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
            return results && results[0] ? results[0].result : null;
        } catch (_) {
            return null;
        }
    }

    // --- functions injected into the page (no closure over this module) ---

    function readRateInPage() {
        const videos = Array.from(document.querySelectorAll('video'))
            .filter((v) => v.isConnected && v.getBoundingClientRect().width > 0);
        if (videos.length === 0) return null;
        const playing = videos.find((v) => !v.paused);
        return (playing || videos[0]).playbackRate;
    }

    function stepRateInPage(direction, steps) {
        const videos = Array.from(document.querySelectorAll('video'))
            .filter((v) => v.isConnected && v.getBoundingClientRect().width > 0);
        if (videos.length === 0) return null;

        const video = videos.find((v) => !v.paused) || videos[0];
        const current = video.playbackRate;
        const epsilon = 1e-3;

        let target;
        if (direction === 0) {
            target = 1;
        } else if (direction > 0) {
            target = steps.find((s) => s > current + epsilon) ?? steps[steps.length - 1];
        } else {
            target = [...steps].reverse().find((s) => s < current - epsilon) ?? steps[0];
        }

        video.playbackRate = target;
        return video.playbackRate;
    }

    function seekInPage(seconds) {
        const videos = Array.from(document.querySelectorAll('video'))
            .filter((v) => v.isConnected && v.getBoundingClientRect().width > 0);
        if (videos.length === 0) return false;
        const video = videos.find((v) => !v.paused) || videos[0];
        video.currentTime = seconds;
        const played = video.play();
        if (played && played.catch) played.catch(() => {});
        return true;
    }

    // --- public API ------------------------------------------------------

    /** Current playback rate in `tab`, or null when it has no usable video. */
    async function getRate(tab) {
        if (!tab || tab.id == null) return null;
        const answer = await ask(tab.id, { action: 'getSpeed' });
        if (answer && answer.ok) return answer.rate;
        return inject(tab.id, readRateInPage);
    }

    /** Step the rate: +1 faster, -1 slower, 0 back to 1x. Returns the new rate. */
    async function stepRate(tab, direction) {
        if (!tab || tab.id == null) return null;
        const answer = await ask(tab.id, { action: 'stepSpeed', direction });
        if (answer && answer.ok) return answer.rate;
        return inject(tab.id, stepRateInPage, [direction, Speed.STEPS]);
    }

    /** Seek `tab` to `seconds` and play. Returns true when it took effect. */
    async function seek(tab, seconds) {
        if (!tab || tab.id == null) return false;
        const answer = await ask(tab.id, { action: 'seekToTime', time: seconds });
        if (answer && answer.ok) return true;
        return (await inject(tab.id, seekInPage, [seconds])) === true;
    }

    /**
     * Open the reader in `tab`. There is no injected fallback, unlike the
     * speed and seek actions above: the reader is the content script's own
     * surface, and without it there is nothing to open. True when it opened.
     */
    async function openReader(tab) {
        if (!tab || tab.id == null) return false;
        const answer = await ask(tab.id, { action: 'openReader' });
        return !!(answer && answer.ok);
    }

    /**
     * Open the text reader in `tab`, any page but YouTube's: the worker
     * brings it into the tab first if it is not there yet
     * (src/background/reader-loader.js). Answers `{ ok, reason }`.
     */
    async function openTextReader(tab) {
        if (!tab || tab.id == null) return null;
        return new Promise((done) => {
            try {
                chrome.runtime.sendMessage({ action: 'openTextReader', tabId: tab.id, url: tab.url, op: 'open' }, (answer) => {
                    void chrome.runtime.lastError;
                    done(answer || null);
                });
            } catch (_) {
                done(null);
            }
        });
    }

    /**
     * The tab's video download: what it would save — `{ ok, busy, percent,
     * label }` — or null when there is no content script to ask. No injected
     * fallback, for the reader's reason: the download is the content
     * script's own.
     */
    async function downloadInfo(tab) {
        if (!tab || tab.id == null) return null;
        return ask(tab.id, { action: 'downloadInfo' });
    }

    /** Start saving the tab's video, or stop it. True when the tab took the message. */
    async function startDownload(tab) {
        if (!tab || tab.id == null) return false;
        const answer = await ask(tab.id, { action: 'downloadVideo' });
        return !!(answer && answer.ok);
    }

    async function cancelDownload(tab) {
        if (!tab || tab.id == null) return false;
        const answer = await ask(tab.id, { action: 'downloadCancel' });
        return !!(answer && answer.ok);
    }

    /**
     * Ask `tab` to do a roster job's `kind` — read, pick, resume or skip —
     * or for its `status`. The tab is told which it is: the job will be its.
     * Its answer, or null when no content script is there to give one; no
     * injected fallback, for the reader's reason.
     */
    async function rosterStart(tab, kind) {
        if (!tab || tab.id == null) return null;
        return ask(tab.id, { action: 'rosterStart', kind, tabId: tab.id });
    }

    const TabActions = { activeTab, findVideoTab, getRate, stepRate, seek, openReader, openTextReader, downloadInfo, startDownload, cancelDownload, rosterStart };

    root.BB = root.BB || {};
    root.BB.TabActions = TabActions;
    if (typeof module !== 'undefined' && module.exports) module.exports = TabActions;
})(typeof globalThis !== 'undefined' ? globalThis : this);
