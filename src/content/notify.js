/**
 * The small toast the content script shows for checkpoints, speed changes and
 * errors.
 *
 * One element is reused for the lifetime of the page. The old version created
 * and removed a node per message and left the previous 3s timer running, so a
 * burst of speed changes could have an old timer delete the newest message.
 */
(function (root) {
    'use strict';

    const ID = 'yt-bookmarker-notification';
    const DEFAULT_MS = 3000;

    let element = null;
    let hideTimer = null;

    function ensureElement() {
        if (element && element.isConnected) return element;
        element = document.getElementById(ID);
        if (!element) {
            element = document.createElement('div');
            element.id = ID;
            element.setAttribute('role', 'status');
            element.setAttribute('aria-live', 'polite');
        }
        if (!element.isConnected && document.body) document.body.appendChild(element);
        return element;
    }

    /**
     * Show `message`. Repeated calls replace the visible toast and restart its
     * timer rather than stacking.
     */
    function show(message, type = 'info', durationMs = DEFAULT_MS) {
        if (!document.body) return;

        const node = ensureElement();
        node.textContent = message;
        node.className = `yt-bookmarker-notification yt-bookmarker-${type}`;

        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, durationMs);
    }

    function hide() {
        clearTimeout(hideTimer);
        hideTimer = null;
        if (element && element.isConnected) element.remove();
    }

    const Notify = { show, hide };

    root.BB = root.BB || {};
    root.BB.Notify = Notify;
    if (typeof module !== 'undefined' && module.exports) module.exports = Notify;
})(typeof globalThis !== 'undefined' ? globalThis : this);
