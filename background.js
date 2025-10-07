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

const SOWON_FOCUS_URL = 'http://127.0.0.1:41414/bellbearer.FocusService/ReportFocus';

function pbStringField(fieldNumber, str) {
    const data = new TextEncoder().encode(str);
    const bytes = [(fieldNumber << 3) | 2];
    let n = data.length;
    do {
        bytes.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0));
        n >>>= 7;
    } while (n > 0);
    return [...bytes, ...data];
}

function encodeFocusUpdateFrame(group, title, domain) {
    const msg = [
        ...pbStringField(1, group),
        ...pbStringField(2, title),
        ...pbStringField(3, domain || ''),
    ];
    const frame = new Uint8Array(5 + msg.length);
    frame[0] = 0;
    new DataView(frame.buffer).setUint32(1, msg.length, false);
    frame.set(msg, 5);
    return frame;
}

function reportFocusToSowon() {
    chrome.storage.local.get(['connectToSowon'], (s) => {
        if (s.connectToSowon !== true) return;

        chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab || !tab.title) return;

            let group = '';
            if (chrome.tabGroups && tab.groupId != null && tab.groupId !== -1) {
                try {
                    const g = await chrome.tabGroups.get(tab.groupId);
                    group = (g && g.title) || '';
                } catch (_) { /* group vanished between events */ }
            }

            let domain = '';
            try {
                domain = new URL(tab.url || tab.pendingUrl || '').hostname.replace(/^www\./, '');
            } catch (_) { /* chrome:// pages etc. — no domain */ }

            fetch(SOWON_FOCUS_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/grpc-web+proto',
                    'X-Grpc-Web': '1',
                },
                body: encodeFocusUpdateFrame(group, tab.title, domain),
            }).catch(() => { /* sowon not running — that's fine */ });
        });
    });
}

chrome.tabs.onActivated.addListener(() => reportFocusToSowon());
chrome.windows.onFocusChanged.addListener(() => reportFocusToSowon());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Title changes on the active tab (navigation, SPA route changes).
    if (tab && tab.active && (changeInfo.title || changeInfo.status === 'complete')) {
        reportFocusToSowon();
    }
});
if (chrome.tabGroups) {
    chrome.tabGroups.onUpdated.addListener(() => reportFocusToSowon());
}

// ---------------------------------------------------------------------------
// "Open new tabs next to the current tab" (including Ctrl+T)
// Robust against MV3 service-worker sleep: the setting is read fresh on every
// tab creation, and the active-tab history is kept in chrome.storage.session
// (which survives worker restarts within the browser session).
// ---------------------------------------------------------------------------
const bbLastActiveKey = (windowId) => `bbLastActive_${windowId}`;

// Remember the current AND previous active tab id per window. Both are
// needed: Ctrl+T activates the new tab immediately, so by the time our
// onCreated callbacks run, the "current" record may already point at the
// new tab itself — the tab the user was on is then the previous one.
// Ids are stored instead of indexes because an index goes stale as soon
// as any tab is moved or closed; the index is resolved at move time.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    const key = bbLastActiveKey(windowId);
    chrome.storage.session.get([key], (res) => {
        const old = res[key];
        const rec = { tabId };
        if (old) {
            rec.prevTabId = old.tabId !== tabId ? old.tabId : old.prevTabId;
        }
        chrome.storage.session.set({ [key]: rec });
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

        const key = bbLastActiveKey(tab.windowId);
        chrome.storage.session.get([key], (res) => {
            const rec = res[key];
            // The anchor is the tab the user was on. If the new tab's own
            // activation was recorded already, that's rec.prevTabId; if our
            // read won the race, it's still rec.tabId. Correct either way.
            const anchorId = rec ? (rec.tabId === tab.id ? rec.prevTabId : rec.tabId) : null;
            if (anchorId == null) return;

            // Resolve the anchor's index NOW — stored indexes go stale.
            chrome.tabs.get(anchorId, (anchorTab) => {
                if (chrome.runtime.lastError || !anchorTab) return;
                if (anchorTab.windowId !== tab.windowId) return;
                const targetIndex = anchorTab.index + 1;
                if (tab.index !== targetIndex) {
                    chrome.tabs.move(tab.id, { index: targetIndex }, () => { void chrome.runtime.lastError; });
                }
            });
        });
    });
});