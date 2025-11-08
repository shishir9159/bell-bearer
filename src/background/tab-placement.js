/**
 * "Open new tabs next to the current tab" (including Ctrl+T).
 *
 * Modeled on sblask/webextension-open-tabs-next-to-current. The ideas that make
 * it reliable, each of which is a bug that took a while to pin down:
 *
 *  - Keep a most-recently-used list of tab ids per window (unshift on activate,
 *    forget on remove). The "anchor" — the tab the user was on — is simply the
 *    most recent id that is not the new tab. That sidesteps the
 *    onCreated/onActivated ordering race entirely: whether or not the new tab's
 *    own activation has been recorded yet, the previous tab is next in line.
 *  - Do NOT gate on the new tab's URL. A brittle "is this a blank new tab?"
 *    check was the original bug: Ctrl+T tabs whose URL did not match were
 *    skipped. Any newly created tab with no opener is moved instead; tabs opened
 *    from a link carry openerTabId and the browser has already placed them.
 *  - State lives in chrome.storage.session so it survives MV3 worker sleep.
 *  - chrome.tabs.move on a just-created tab can be transiently rejected, so the
 *    move is retried rather than swallowed.
 *
 * Diagnostic logging goes to the service-worker console (chrome://extensions ->
 * Inspect views: service worker). It is off unless
 * chrome.storage.local.set({ bbTabMoveDebug: true }).
 */
(function () {
    'use strict';

    const MRU_LIMIT = 25;
    const MOVE_RETRIES = 5;
    const MOVE_RETRY_MS = 60;

    // Off by default: this used to log on every tab creation for every user.
    let debug = false;
    chrome.storage.local.get(['bbTabMoveDebug'], (s) => { debug = s.bbTabMoveDebug === true; });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.bbTabMoveDebug) debug = changes.bbTabMoveDebug.newValue === true;
    });
    const log = (...args) => { if (debug) console.log('[bell-bearer tabmove]', ...args); };

    const mruKey = (windowId) => `bbMru_${windowId}`;

    /** Most-recently-active tab id per window, newest first. */
    chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
        const key = mruKey(windowId);
        chrome.storage.session.get([key], (res) => {
            const mru = [tabId, ...(res[key] || []).filter((id) => id !== tabId)].slice(0, MRU_LIMIT);
            chrome.storage.session.set({ [key]: mru });
        });
    });

    /** Drop closed tabs so a stale id is never chosen as the anchor. */
    chrome.tabs.onRemoved.addListener((tabId, info) => {
        const key = mruKey(info.windowId);
        chrome.storage.session.get([key], (res) => {
            chrome.storage.session.set({ [key]: (res[key] || []).filter((id) => id !== tabId) });
        });
    });

    /**
     * Move with retry: a just-created (or being-dragged) tab can be temporarily
     * un-moveable, and a few spaced attempts let it settle.
     */
    function moveTab(tabId, index, attempt = 0) {
        chrome.tabs.move(tabId, { index }, () => {
            const error = chrome.runtime.lastError;
            if (!error) return log('moved tab', tabId, 'to index', index);

            log('move failed:', error.message, '(attempt', attempt + ')');
            if (attempt < MOVE_RETRIES) {
                setTimeout(() => moveTab(tabId, index, attempt + 1), MOVE_RETRY_MS);
            }
        });
    }

    /**
     * Place newTab immediately after anchorTab, resolving the anchor's CURRENT
     * index because it may have shifted since the event fired.
     */
    function placeAfter(newTab, anchorId) {
        chrome.tabs.get(anchorId, (anchorTab) => {
            if (chrome.runtime.lastError || !anchorTab) return log('anchor', anchorId, 'gone');
            if (anchorTab.windowId !== newTab.windowId) return log('anchor is in another window');

            const target = anchorTab.index + 1;
            if (newTab.index === target) return log('already positioned at', target);
            moveTab(newTab.id, target);
        });
    }

    chrome.tabs.onCreated.addListener((tab) => {
        log('onCreated', { id: tab.id, index: tab.index, openerTabId: tab.openerTabId });

        // Tabs opened from a link already sit next to their opener.
        if (tab.openerTabId != null) return log('skip: has openerTabId');

        chrome.storage.local.get(['openTabNextToCurrent'], (settings) => {
            if (settings.openTabNextToCurrent !== true) return;

            const key = mruKey(tab.windowId);
            chrome.storage.session.get([key], (res) => {
                const anchorId = (res[key] || []).find((id) => id !== tab.id);
                if (anchorId != null) {
                    log('anchor from mru:', anchorId);
                    placeAfter(tab, anchorId);
                    return;
                }

                // No history yet (a cold start, say). Query the active tab; if
                // that is this new tab there is nothing to anchor to, which is
                // what a session restore looks like.
                chrome.tabs.query({ windowId: tab.windowId, active: true }, (tabs) => {
                    const active = tabs && tabs[0];
                    if (active && active.id !== tab.id) {
                        log('anchor from active tab:', active.id);
                        placeAfter(tab, active.id);
                    } else {
                        log('no anchor; leaving at end');
                    }
                });
            });
        });
    });
})();
