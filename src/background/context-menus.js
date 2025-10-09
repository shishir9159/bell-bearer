/**
 * The "Copy as Markdown" context menus.
 *
 * Markdown conversion is an EXPLICIT action: it happens only when the user
 * right-clicks a link (or the page) and picks the item. An earlier version
 * intercepted Ctrl+C and converted whenever "nothing looked selected", which
 * was wrong — window.getSelection() is empty for selections inside shadow DOM
 * and form fields, so ordinary copies were silently replaced.
 *
 * Copying from the browser's address bar cannot be hooked: the omnibox is
 * browser chrome, not page content, and no extension API exposes it.
 */
(function () {
    'use strict';

    const MENU_LINK = 'bb-copy-link-markdown';
    const MENU_PAGE = 'bb-copy-page-markdown';

    // Firefox for Android has no contextMenus API at all.
    const available = !!(chrome.contextMenus && chrome.contextMenus.create);

    /** Fire-and-forget message; a page with no content script is not an error. */
    function tellTab(tabId, message) {
        chrome.tabs.sendMessage(tabId, message, () => { void chrome.runtime.lastError; });
    }

    function refresh() {
        if (!available) return;

        chrome.contextMenus.removeAll(() => {
            void chrome.runtime.lastError;
            chrome.storage.local.get(['markdownContextMenu'], (settings) => {
                // Enabled unless explicitly turned off.
                if (settings.markdownContextMenu === false) return;

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

    if (available) {
        // Menus are per-profile and persist, but must be (re)created when the
        // extension installs or updates and when the browser starts a session.
        chrome.runtime.onInstalled.addListener(refresh);
        if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(refresh);
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.markdownContextMenu) refresh();
        });

        chrome.contextMenus.onClicked.addListener((info, tab) => {
            if (!tab || tab.id == null) return;

            if (info.menuItemId === MENU_LINK && info.linkUrl) {
                tellTab(tab.id, {
                    action: 'copyLinkAsMarkdown',
                    linkUrl: info.linkUrl,
                    selectionText: info.selectionText || '',
                });
            } else if (info.menuItemId === MENU_PAGE) {
                tellTab(tab.id, { action: 'copyMarkdownLink' });
            }
        });
    }

    globalThis.refreshContextMenus = refresh;
})();
