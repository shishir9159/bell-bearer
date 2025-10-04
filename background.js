chrome.runtime.onInstalled.addListener(() => {
    console.log('Bell Bearer extension is installed');
});

// Keyboard command (Ctrl+Shift+L): copy the current page as a Markdown link.
// Rebindable at chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener((command) => {
    if (command !== 'copy-markdown-link') return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (tab && tab.id != null) {
            chrome.tabs.sendMessage(tab.id, { action: 'copyMarkdownLink' }, () => {
                void chrome.runtime.lastError; // no content script on this page — ignore
            });
        }
    });
});

// icon click from the toolbar
chrome.action.onClicked.addListener((tab) => {

    // todo:
    // debug mode only
    console.log('Extension icon clicked');
});

// listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getBookmarks') {
        chrome.storage.local.get(['youtubeBookmarks'], (result) => {
            sendResponse({ bookmarks: result.youtubeBookmarks || [] });
        });

        // message channel is kept open for async response
        return true;
    }

    if (message.action === 'openDashboard') {
        chrome.tabs.create({
            url: chrome.runtime.getURL('dashboard.html')
        });
        sendResponse({ success: true });
    }
});

// ---------------------------------------------------------------------------
// "Open new tabs next to the current tab" (including Ctrl+T)
// Robust against MV3 service-worker sleep: the setting is read fresh on every
// tab creation, and the last-active tab index is kept in chrome.storage.session
// (which survives worker restarts within the browser session).
// ---------------------------------------------------------------------------
const bbActiveIdxKey = (windowId) => `bbActiveIdx_${windowId}`;

// Remember where the current tab is, per window.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    chrome.tabs.get(tabId, (tab) => {
        if (!chrome.runtime.lastError && tab) {
            chrome.storage.session.set({ [bbActiveIdxKey(windowId)]: tab.index });
        }
    });
});

chrome.tabs.onCreated.addListener((tab) => {
    // Tabs opened from a link already sit next to their opener — leave them.
    if (tab.openerTabId != null) return;

    // Only reposition "blank" new tabs (Ctrl+T / the new-tab button), not
    // restored sessions or tabs that already have a destination.
    const url = tab.pendingUrl || tab.url || '';
    const isBlankNewTab = url === '' ||
        url.startsWith('chrome://newtab') ||
        url.startsWith('about:newtab') ||
        url.startsWith('about:blank') ||
        url.startsWith('edge://newtab');
    if (!isBlankNewTab) return;

    // Read the setting fresh — module-level caches are lost when the worker sleeps.
    chrome.storage.local.get(['openTabNextToCurrent'], (s) => {
        if (s.openTabNextToCurrent !== true) return;

        const key = bbActiveIdxKey(tab.windowId);
        chrome.storage.session.get([key], (res) => {
            const anchor = res[key];
            if (anchor != null) {
                const targetIndex = anchor + 1;
                if (tab.index !== targetIndex) {
                    chrome.tabs.move(tab.id, { index: targetIndex }, () => { void chrome.runtime.lastError; });
                }
                return;
            }
            // Fallback (first new tab before any tab switch): place after the
            // current active tab, unless the new blank tab is already it.
            chrome.tabs.query({ active: true, windowId: tab.windowId }, (tabs) => {
                const act = tabs && tabs[0];
                if (act && act.id !== tab.id) {
                    chrome.tabs.move(tab.id, { index: act.index + 1 }, () => { void chrome.runtime.lastError; });
                }
            });
        });
    });
});