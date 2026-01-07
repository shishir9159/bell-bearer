/**
 * Wakes a chat for a scheduled prompt.
 *
 * The repo's first one-shot alarm; every other is periodic. It keeps exactly
 * one, at PromptQueue.nextWake() — the earliest schedule or hold end — or
 * none, and moves it whenever the queue changes. When it fires, each chat
 * with a prompt due is found among the open tabs and told to look; a chat with
 * no tab gets one, in the background, when the site's setting allows. The
 * page picks the prompt up on load anyway — every chat page checks the queue
 * as it starts — so the message is a nudge, not the only path.
 *
 * Chrome floors an alarm at thirty seconds, and a background tab's timers run
 * about once a minute after five minutes hidden, so a scheduled prompt can go
 * up to a minute late. That is said in the dashboard rather than fought.
 *
 * Listeners are registered at top level, synchronously, because the worker is
 * torn down and started again constantly.
 */
(function (root) {
    'use strict';

    const { Settings, ChatSites, PromptQueue, Router } = root.BB;

    const ALARM = 'bb-prompt-queue';

    async function sync(now = Date.now()) {
        const when = PromptQueue.nextWake(await PromptQueue.load(), now);
        if (when) chrome.alarms.create(ALARM, { when });
        else await chrome.alarms.clear(ALARM);
        return when;
    }

    /** Does this tab show the chat an item belongs to — or, for an unbound one, a new chat? */
    function shows(tab, item) {
        const site = ChatSites.get(item.site);
        if (!site || !tab.url) return false;
        if (item.conv) return ChatSites.convIdOfUrl(item.site, tab.url) === item.conv;
        try { return site.isNewChat(new URL(tab.url).pathname); } catch (_) { return false; }
    }

    async function wake(now = Date.now()) {
        const due = PromptQueue.due(await PromptQueue.load(), now);
        // One nudge per chat, however many of its prompts are due.
        const chats = new Map();
        for (const item of due) if (!chats.has(PromptQueue.keyOf(item))) chats.set(PromptQueue.keyOf(item), item);

        const settings = await Settings.get(ChatSites.allKeys());
        for (const item of chats.values()) {
            const site = ChatSites.get(item.site);
            if (!site) continue;
            const tabs = await chrome.tabs.query({ url: site.tabPatterns.slice() });
            const tab = tabs.find((one) => shows(one, item));
            if (tab) {
                chrome.tabs.sendMessage(tab.id, { action: 'promptQueueWake' }, () => { void chrome.runtime.lastError; });
            } else if (settings[ChatSites.siteKey(item.site, 'queueOpenTab')] !== false) {
                chrome.tabs.create({ url: site.chatUrl(item.conv, { model: item.model }), active: false });
            }
        }
        return sync(now);
    }

    Router.alarm(ALARM, () => { wake(); });
    Settings.watch([PromptQueue.KEY], () => { sync(); });
    Router.started(() => { sync(); });
    sync();

    root.BB.PromptQueueWorker = { ALARM, sync, wake, shows };
})(typeof globalThis !== 'undefined' ? globalThis : this);
