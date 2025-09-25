/**
 * Trials, where they meet the browser: making a trial's tab group, putting a
 * tab into it, and bringing one trial to the front with the rest folded away.
 *
 * This is the worker's job because chrome.tabGroups exists nowhere else — not
 * in a content script, not in the dashboard page. The dashboard asks by
 * message and draws whatever comes back.
 *
 * The awkward part is that a tab group is not a thing you can keep. Its id is
 * handed out per session, a group with no tabs left in it stops existing, and
 * closing the window takes it with you. So the id in the store is only ever a
 * guess: every operation starts by checking whether the group is still there
 * and makes a new one if it is not. That is `ensureGroup`, and it is why
 * nothing here trusts `trial.groupId` on its own.
 *
 * Firefox has no tab groups at all, so every entry point answers
 * `{ ok: false, unsupported: true }` there rather than throwing.
 */
(function (root) {
    'use strict';

    const { Trials } = root.BB;

    const HAS_GROUPS = typeof chrome !== 'undefined' && !!chrome.tabGroups;

    /** Does this group still exist? A missing group throws rather than answering null. */
    async function groupExists(groupId) {
        if (groupId == null) return false;
        try {
            await chrome.tabGroups.get(groupId);
            return true;
        } catch (_) {
            return false;
        }
    }

    /** The trial's title and colour on the group itself, so the strip matches. */
    async function applyMeta(groupId, trial) {
        try {
            await chrome.tabGroups.update(groupId, { title: trial.name, color: trial.color });
        } catch (_) { /* the group went between the check and here */ }
    }

    /**
     * The trial's group, made if it has gone. `seedTabIds` is what to build it
     * from — the tab being filed, when there is one, so that filing a tab does
     * not also leave an empty tab behind just to have something to group.
     */
    async function ensureGroup(trial, seedTabIds) {
        if (await groupExists(trial.groupId)) return trial.groupId;

        let tabIds = seedTabIds;
        if (!tabIds || !tabIds.length) {
            const tab = await chrome.tabs.create({ active: false });
            tabIds = [tab.id];
        }

        const groupId = await chrome.tabs.group({ tabIds });
        await applyMeta(groupId, trial);
        await Trials.update((list) => Trials.setGroup(list, trial.id, groupId));
        return groupId;
    }

    async function find(id) {
        const list = await Trials.load();
        return { list, trial: Trials.byId(list, id) };
    }

    /**
     * Put one trial in front: its group open and active, every other trial's
     * group collapsed. Collapsing is what makes this a focus rather than just
     * a jump — the other work is still there, just not in the way.
     */
    async function focus(id) {
        const { list, trial } = await find(id);
        if (!trial) return { ok: false };

        const groupId = await ensureGroup(trial);

        for (const other of list) {
            if (other.id === id || other.groupId == null) continue;
            try {
                await chrome.tabGroups.update(other.groupId, { collapsed: true });
            } catch (_) { /* that group has gone; onRemoved will forget it */ }
        }

        try {
            await chrome.tabGroups.update(groupId, { collapsed: false });
        } catch (_) { /* nothing to open */ }

        const tabs = await chrome.tabs.query({ groupId });
        if (tabs.length) {
            await chrome.tabs.update(tabs[0].id, { active: true });
            try { await chrome.windows.update(tabs[0].windowId, { focused: true }); } catch (_) { /* same window */ }
        }

        await Trials.update((next) => Trials.touch(next, id));
        return { ok: true, groupId, tabs: tabs.length };
    }

    /** File a tab under a trial — the active one unless another is named. */
    async function addTab(id, tabId) {
        const { trial } = await find(id);
        if (!trial) return { ok: false };

        let target = tabId;
        if (target == null) {
            const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
            target = active && active.id;
        }
        if (target == null) return { ok: false };

        const groupId = await ensureGroup(trial, [target]);
        try {
            await chrome.tabs.group({ tabIds: [target], groupId });
        } catch (_) {
            return { ok: false };
        }
        return { ok: true, groupId };
    }

    /** Take a tab back out of whatever trial holds it. */
    async function removeTab(tabId) {
        if (tabId == null) return { ok: false };
        try {
            await chrome.tabs.ungroup([tabId]);
            return { ok: true };
        } catch (_) {
            return { ok: false };
        }
    }

    /** Every trial with the tabs its group currently holds, for the dashboard. */
    async function summary() {
        const list = await Trials.load();
        const out = [];
        for (const trial of list) {
            let tabs = [];
            let live = false;
            if (await groupExists(trial.groupId)) {
                live = true;
                tabs = (await chrome.tabs.query({ groupId: trial.groupId }))
                    .map((tab) => ({ id: tab.id, title: tab.title || tab.url || '', url: tab.url || '', active: !!tab.active }));
            }
            out.push({ ...trial, live, tabs });
        }
        return out;
    }

    /** Push a renamed or recoloured trial onto its group. */
    async function syncMeta(id) {
        const { trial } = await find(id);
        if (!trial || !(await groupExists(trial.groupId))) return { ok: false };
        await applyMeta(trial.groupId, trial);
        return { ok: true };
    }

    // A group the user closed takes its id with it. Forgetting it here is what
    // lets the next focus quietly build a new one instead of failing.
    if (HAS_GROUPS && chrome.tabGroups.onRemoved) {
        chrome.tabGroups.onRemoved.addListener((group) => {
            Trials.update((list) => Trials.forgetGroup(list, group.id));
        });
    }

    const HANDLERS = {
        trialFocus: (message) => focus(message.id),
        trialAddTab: (message) => addTab(message.id, message.tabId),
        trialRemoveTab: (message) => removeTab(message.tabId),
        trialSummary: () => summary(),
        trialSyncMeta: (message) => syncMeta(message.id),
    };

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const handler = message && HANDLERS[message.action];
        if (!handler) return false;
        if (!HAS_GROUPS) {
            sendResponse({ ok: false, unsupported: true });
            return false;
        }
        handler(message)
            .then((result) => sendResponse(Array.isArray(result) ? { ok: true, trials: result } : result))
            .catch((error) => sendResponse({ ok: false, error: String(error && error.message || error) }));
        return true; // every handler is async
    });

    root.BB.TrialsWorker = { focus, addTab, removeTab, summary, syncMeta, ensureGroup, HAS_GROUPS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
