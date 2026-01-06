/**
 * Keyboard commands and messages the popup/dashboard send to the worker.
 */
(function () {
    'use strict';

    const { Router, Settings } = globalThis.BB;

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
            Settings.get(['shortcuts']).then(({ shortcuts }) => {
                const override = shortcuts && shortcuts['copy-markdown-link'];
                if (override && override.enabled === false) return;
                tellActiveTab({ action: 'copyMarkdownLink' });
            });
        });
    }

    Router.on('getBookmarks', async () => {
        const stored = await chrome.storage.local.get([Settings.DATA.bookmarks]);
        return { bookmarks: stored[Settings.DATA.bookmarks] || [] };
    });

    // The hash is how a caller asks for a particular site's tools rather than
    // the launcher — `#site/twitter`, the same spelling the popup and
    // dashboard.js#followHash already use. Anything that is not one of ours
    // is dropped rather than appended, since it arrives from a content script
    // on a page we do not own.
    Router.on('openDashboard', (message) => {
        const hash = /^#[a-z]+\/[a-z]+$/.test(message.hash || '') ? message.hash : '';
        chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${hash}`) });
        return { success: true };
    });

    // A chess move read aloud (src/content/chess.js). Queued, so a quick reply
    // is spoken after the move before it, not over it. No chrome.tts
    // (Firefox) answers ok:false and the page speaks.
    Router.on('speak', (message) => {
        if (!chrome.tts || typeof message.text !== 'string') return { ok: false };
        chrome.tts.speak(message.text.slice(0, 200), { enqueue: true, rate: 1.1 });
        return { ok: true };
    });
})();
