/**
 * Keyboard commands and messages the popup/dashboard send to the worker.
 */
(function () {
    'use strict';

    /** Fire-and-forget message; a page with no content script is not an error. */
    function tellActiveTab(message) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab || tab.id == null) return;
            chrome.tabs.sendMessage(tab.id, message, () => { void chrome.runtime.lastError; });
        });
    }

    // Ctrl+Shift+L: copy the current page as a Markdown link. The keys are
    // rebindable at chrome://extensions/shortcuts; the on/off switch is ours,
    // in the `shortcuts` setting (see src/shared/keybindings.js).
    if (chrome.commands) {
        chrome.commands.onCommand.addListener((command) => {
            if (command !== 'copy-markdown-link') return;
            chrome.storage.local.get(['shortcuts'], (stored) => {
                const override = stored && stored.shortcuts && stored.shortcuts['copy-markdown-link'];
                if (override && override.enabled === false) return;
                tellActiveTab({ action: 'copyMarkdownLink' });
            });
        });
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message && message.action) {
            case 'getBookmarks':
                chrome.storage.local.get(['youtubeBookmarks'], (result) => {
                    sendResponse({ bookmarks: result.youtubeBookmarks || [] });
                });
                return true; // keep the channel open for the async response

            case 'openDashboard':
                chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
                sendResponse({ success: true });
                return false;

            // A chess move read aloud (src/content/chess.js). Queued, so a
            // quick reply is spoken after the move before it, not over it.
            // No chrome.tts (Firefox) answers ok:false and the page speaks.
            case 'speak':
                if (!chrome.tts || typeof message.text !== 'string') {
                    sendResponse({ ok: false });
                    return false;
                }
                chrome.tts.speak(message.text.slice(0, 200), { enqueue: true, rate: 1.1 });
                sendResponse({ ok: true });
                return false;

            default:
                return false;
        }
    });
})();
