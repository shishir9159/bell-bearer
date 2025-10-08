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
// "Copy as Markdown" context menus.
//
// Markdown conversion is an EXPLICIT action: it happens only when the user
// right-clicks a link (or the page) and picks the item. An earlier version
// intercepted Ctrl+C and converted whenever "nothing looked selected", which
// was wrong — window.getSelection() is empty for selections inside shadow DOM
// and form fields, so ordinary copies were silently replaced.
//
// Note: copying from the browser's address bar cannot be hooked. The omnibox
// is browser chrome, not page content, and no extension API exposes it.
// ---------------------------------------------------------------------------
const MENU_LINK = 'bb-copy-link-markdown';
const MENU_PAGE = 'bb-copy-page-markdown';

function refreshContextMenus() {
    chrome.contextMenus.removeAll(() => {
        void chrome.runtime.lastError;
        chrome.storage.local.get(['markdownContextMenu'], (s) => {
            // Enabled unless explicitly turned off.
            if (s.markdownContextMenu === false) return;
            chrome.contextMenus.create({
                id: MENU_LINK,
                title: 'Copy link as Markdown',
                contexts: ['link'],
            }, () => { void chrome.runtime.lastError; });
            chrome.contextMenus.create({
                id: MENU_PAGE,
                title: 'Copy page as Markdown',
                contexts: ['page'],
            }, () => { void chrome.runtime.lastError; });
        });
    });
}

// Menus are per-profile and persist, but must be (re)created when the
// extension installs/updates and when the browser starts a new session.
chrome.runtime.onInstalled.addListener(refreshContextMenus);
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(refreshContextMenus);
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.markdownContextMenu) refreshContextMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab || tab.id == null) return;

    if (info.menuItemId === MENU_LINK && info.linkUrl) {
        chrome.tabs.sendMessage(tab.id, {
            action: 'copyLinkAsMarkdown',
            linkUrl: info.linkUrl,
            selectionText: info.selectionText || '',
        }, () => { void chrome.runtime.lastError; });
    } else if (info.menuItemId === MENU_PAGE) {
        chrome.tabs.sendMessage(tab.id, {
            action: 'copyMarkdownLink',
        }, () => { void chrome.runtime.lastError; });
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

// Backoff so that, with "Connect to sowon" enabled but no timer
// running, we don't fire a doomed localhost fetch on every tab switch
// all day. After a few consecutive failures we retry at most once a
// minute; the first success clears it. State is in-memory only — an
// MV3 worker restart resets it, which just means one probe on wake.
let sowonFailures = 0;
let sowonNextAttempt = 0;
const SOWON_MAX_FAILURES = 3;
const SOWON_BACKOFF_MS = 60000;

function reportFocusToSowon() {
    if (sowonFailures >= SOWON_MAX_FAILURES && Date.now() < sowonNextAttempt) return;

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
            }).then(() => {
                sowonFailures = 0; // sowon is up — resume normal cadence
            }).catch(() => {
                // sowon not running — count toward backoff.
                sowonFailures++;
                sowonNextAttempt = Date.now() + SOWON_BACKOFF_MS;
            });
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
//
// Modeled on sblask/webextension-open-tabs-next-to-current. The core ideas
// that make it reliable:
//  - Keep a most-recently-used list of tab ids per window (unshift on
//    activate, forget on remove). The "anchor" — the tab the user was on —
//    is simply the most recent id that isn't the new tab. This sidesteps the
//    onCreated/onActivated ordering race entirely: whether or not the new
//    tab's own activation has been recorded yet, the previous tab is next.
//  - Do NOT gate on the new tab's URL. A brittle "is this a blank new tab?"
//    URL check was the bug: Ctrl+T tabs whose URL didn't match were skipped.
//    Instead, move any newly created tab that has no opener; tabs opened from
//    a link carry openerTabId and are already positioned by the browser, and
//    a tab already in the right place is left alone.
//  - State lives in chrome.storage.session so it survives MV3 worker sleep.
//  - chrome.tabs.move on a just-created tab can be transiently rejected, so
//    the move is retried rather than swallowed.
//
// Diagnostic logging goes to the service-worker console (chrome://extensions
// -> Inspect views: service worker). Silence it with
// chrome.storage.local.set({ bbTabMoveDebug: false }) there.
// ---------------------------------------------------------------------------
let bbDebug = true;
chrome.storage.local.get(['bbTabMoveDebug'], (s) => { if (s.bbTabMoveDebug === false) bbDebug = false; });
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bbTabMoveDebug) bbDebug = changes.bbTabMoveDebug.newValue === true;
});
const bbLog = (...a) => { if (bbDebug) console.log('[bell-bearer tabmove]', ...a); };

const bbMruKey = (windowId) => `bbMru_${windowId}`; // MRU-first array of tab ids

// Most-recently-active tab id, per window, at the front of the array.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    const key = bbMruKey(windowId);
    chrome.storage.session.get([key], (res) => {
        let mru = (res[key] || []).filter((id) => id !== tabId);
        mru.unshift(tabId);
        if (mru.length > 25) mru = mru.slice(0, 25);
        chrome.storage.session.set({ [key]: mru });
    });
});

// Drop closed tabs so a stale id is never chosen as the anchor.
chrome.tabs.onRemoved.addListener((tabId, info) => {
    const key = bbMruKey(info.windowId);
    chrome.storage.session.get([key], (res) => {
        const mru = (res[key] || []).filter((id) => id !== tabId);
        chrome.storage.session.set({ [key]: mru });
    });
});

// Move with retry: a just-created (or being-dragged) tab may be temporarily
// un-moveable; a few spaced attempts let it settle.
function bbMoveTab(tabId, index, attempt = 0) {
    chrome.tabs.move(tabId, { index }, () => {
        const err = chrome.runtime.lastError;
        if (err) {
            bbLog('move failed:', err.message, '(attempt', attempt + ')');
            if (attempt < 5) setTimeout(() => bbMoveTab(tabId, index, attempt + 1), 60);
        } else {
            bbLog('moved tab', tabId, 'to index', index);
        }
    });
}

// Place newTab immediately after anchorTab (resolving the anchor's CURRENT
// index, which may have shifted), unless it's already there.
function bbPlaceAfter(newTab, anchorId) {
    chrome.tabs.get(anchorId, (anchorTab) => {
        if (chrome.runtime.lastError || !anchorTab) { bbLog('anchor', anchorId, 'gone'); return; }
        if (anchorTab.windowId !== newTab.windowId) { bbLog('anchor in another window'); return; }
        const target = anchorTab.index + 1;
        if (newTab.index === target) { bbLog('already positioned at', target); return; }
        bbMoveTab(newTab.id, target);
    });
}

chrome.tabs.onCreated.addListener((tab) => {
    bbLog('onCreated', { id: tab.id, index: tab.index, url: tab.url, pendingUrl: tab.pendingUrl, openerTabId: tab.openerTabId, active: tab.active });

    // Tabs opened from a link/opener are already placed next to their opener.
    if (tab.openerTabId != null) { bbLog('skip: has openerTabId'); return; }

    chrome.storage.local.get(['openTabNextToCurrent'], (s) => {
        bbLog('setting openTabNextToCurrent =', s.openTabNextToCurrent);
        if (s.openTabNextToCurrent !== true) return;

        const key = bbMruKey(tab.windowId);
        chrome.storage.session.get([key], (res) => {
            const mru = res[key] || [];
            const anchorId = mru.find((id) => id !== tab.id);
            bbLog('mru', mru, '-> anchorId', anchorId);

            if (anchorId != null) {
                bbPlaceAfter(tab, anchorId);
                return;
            }

            // No history yet (e.g. first tab action after a cold start).
            // Query the active tab directly; if it's this new tab, there's
            // nothing to anchor to, so leave it (typical of session restore).
            chrome.tabs.query({ windowId: tab.windowId, active: true }, (tabs) => {
                const active = tabs && tabs[0];
                if (active && active.id !== tab.id) {
                    bbLog('fallback: active tab', active.id, 'at index', active.index);
                    bbPlaceAfter(tab, active.id);
                } else {
                    bbLog('fallback: no anchor; leaving at end');
                }
            });
        });
    });
});