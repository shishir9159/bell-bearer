chrome.runtime.onInstalled.addListener(() => {
    console.log('Bell Bearer extension is installed');
});

// icon click from the toolbar
chrome.action.onClicked.addListener((tab) => {

    // default_popup manifest
    console.log('Extension icon clicked');
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getBookmarks') {
        chrome.storage.local.get(['youtubeBookmarks'], (result) => {
            sendResponse({ bookmarks: result.youtubeBookmarks || [] });
        });
        
        // Keep the message channel open for async response
        return true;
    }
}); 