chrome.runtime.onInstalled.addListener(() => {
    console.log('Bell Bearer extension is installed');
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