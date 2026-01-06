/**
 * Trials, where they meet the browser: the desk of tab groups, the ungrouped
 * tabs beside it, and every move between the two.
 *
 * This is the worker's job because chrome.tabGroups exists nowhere else — not
 * in a content script, not in the dashboard page. The dashboard asks by
 * message and draws what comes back; it holds no state of its own.
 *
 * The desk is Chrome's own, not a copy of it: a group in play is an expanded
 * tab group, a parked one is collapsed, and a tab's place on the desk is its
 * place in the tab strip. So a group renamed or dragged in the strip is
 * already right here, and there is nothing to reconcile. What Chrome does not
 * keep — when each group was last worked in, and whether one is locked — lives
 * in shared/trials.js, keyed by group id and pruned whenever we look.
 *
 * A locked group is frozen: nothing goes in or out of it, it cannot be
 * renamed, parked or discarded, and it is the last group parked to make room.
 *
 * Firefox has no tab groups at all, so every entry point answers
 * `{ ok: false, unsupported: true }` there rather than throwing.
 */
(function (root) {
    'use strict';

    const { Trials, Router } = root.BB;

    const HAS_GROUPS = typeof chrome !== 'undefined' && !!chrome.tabGroups;
    const NONE = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE

    /** Chrome's own tab-group colours, in the order a new group takes them. */
    const COLORS = ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'grey'];

    async function currentWindowId() {
        const win = await chrome.windows.getCurrent();
        return win.id;
    }

    /** Every tab and group of the window in front, in tab-strip order. */
    async function desk() {
        const windowId = await currentWindowId();
        const tabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
        const groups = await chrome.tabGroups.query({ windowId });
        const state = await Trials.update((stored) => Trials.sanitize(stored, groups.map((g) => g.id)));
        return { windowId, tabs, groups, state };
    }

    function tabsOf(tabs, groupId) {
        return tabs.filter((tab) => tab.groupId === groupId);
    }

    /** The groups in play, which are the only ones a lock can be held by. */
    function openIds(groups) {
        return groups.filter((group) => !group.collapsed).map((group) => group.id);
    }

    /** The group holding the desk, or null. */
    function held(state, groups) {
        return Trials.lockedId(state, openIds(groups));
    }

    /** What the dashboard draws: the desk as plain facts, nothing styled. */
    async function snapshot() {
        const { tabs, groups, state } = await desk();
        const row = (tab) => ({ id: tab.id, title: tab.title || tab.url || '', url: tab.url || '', active: !!tab.active });
        return {
            ok: true,
            desk: {
                now: Date.now(),
                state,
                lockedId: held(state, groups),
                loose: tabsOf(tabs, NONE).map(row),
                groups: groups.map((group) => ({
                    id: group.id,
                    title: group.title || '',
                    color: group.color,
                    parked: !!group.collapsed,
                    tabs: tabsOf(tabs, group.id).map(row),
                })),
            },
        };
    }

    /**
     * Park groups until only SLOT_LIMIT are left in play, newest kept. Called
     * after anything that can put a fourth group on the desk.
     */
    async function trim(state, groups, keepId) {
        const open = openIds(groups).filter((groupId) => groupId !== keepId);
        const spare = open.length + (keepId == null ? 0 : 1) - Trials.SLOT_LIMIT;
        for (const groupId of Trials.parkVictims(state, open, spare)) {
            try { await chrome.tabGroups.update(groupId, { collapsed: true }); } catch (_) { /* gone already */ }
        }
    }

    /**
     * Move one tab so it sits at `index` of a group's list, or of the
     * ungrouped list when `groupId` is null.
     *
     * `index` is a position in the list as drawn, which is not a position in
     * the tab strip, so it is turned into one by naming the tab it should land
     * beside. The strip is read again after the grouping, because grouping a
     * tab can itself shift it to sit beside its new group.
     */
    async function moveTab(tabId, groupId, index) {
        const { tabs, groups, state } = await desk();
        const tab = tabs.find((item) => item.id === tabId);
        if (!tab) return { ok: false };
        // A locked group is sealed: nothing dropped in, nothing dragged out.
        const lockedId = held(state, groups);
        if (lockedId != null && (lockedId === groupId || lockedId === tab.groupId)) return { ok: false, locked: true };

        const target = groupId == null ? NONE : groupId;
        const siblings = tabsOf(tabs, target).filter((item) => item.id !== tabId);
        const at = typeof index === 'number' ? Math.max(0, Math.min(index, siblings.length)) : siblings.length;
        // Land before the sibling standing at that spot, or after the last one.
        const anchor = siblings[at] || siblings[siblings.length - 1];
        const after = !siblings[at];

        try {
            if (target === NONE) await chrome.tabs.ungroup([tabId]);
            else await chrome.tabs.group({ tabIds: [tabId], groupId: target });
            if (anchor) await place(tabId, anchor.id, after);
        } catch (_) {
            return { ok: false };
        }
        if (target !== NONE) await Trials.update((stored) => Trials.touch(stored, target));
        return { ok: true };
    }

    /**
     * Put `tabId` on one side of `anchorId`. chrome.tabs.move takes the index
     * the tab should end up at, which is one less than where the anchor stands
     * whenever the tab is being dragged rightwards — pulling it out of the
     * strip first shifts everything after it along.
     */
    async function place(tabId, anchorId, after) {
        const strip = (await chrome.tabs.query({ windowId: await currentWindowId() })).sort((a, b) => a.index - b.index);
        const moving = strip.find((tab) => tab.id === tabId);
        const anchor = strip.find((tab) => tab.id === anchorId);
        if (!moving || !anchor) return;
        const shift = moving.index < anchor.index ? -1 : 0;
        await chrome.tabs.move(tabId, { index: anchor.index + shift + (after ? 1 : 0) });
    }

    /** A colour no group in this window is wearing yet. */
    function freeColor(groups) {
        const taken = new Set(groups.map((group) => group.color));
        return COLORS.find((color) => !taken.has(color)) || COLORS[groups.length % COLORS.length];
    }

    /** Start a group off one tab, the way dropping onto the empty slot does. */
    async function newGroupFrom(tabId) {
        const { groups, state } = await desk();
        let groupId;
        try {
            groupId = await chrome.tabs.group({ tabIds: [tabId] });
            await chrome.tabGroups.update(groupId, { title: 'Untitled group', color: freeColor(groups) });
        } catch (_) {
            return { ok: false };
        }
        await Trials.update((stored) => Trials.touch(stored, groupId));
        await trim(state, groups, groupId);
        return { ok: true, groupId };
    }

    /** Bring a parked group back, parking whatever has to go to make room. */
    async function openGroup(groupId) {
        const { tabs, groups } = await desk();
        const state = await Trials.update((stored) => Trials.touch(stored, groupId));
        await trim(state, groups, groupId);
        try {
            await chrome.tabGroups.update(groupId, { collapsed: false });
        } catch (_) {
            return { ok: false };
        }
        const first = tabsOf(tabs, groupId)[0];
        if (first) {
            await chrome.tabs.update(first.id, { active: true });
            try { await chrome.windows.update(first.windowId, { focused: true }); } catch (_) { /* same window */ }
        }
        return { ok: true };
    }

    async function renameGroup(groupId, title) {
        const { groups, state } = await desk();
        if (held(state, groups) === groupId) return { ok: false, locked: true };
        try {
            await chrome.tabGroups.update(groupId, { title: Trials.cleanName(title) });
            return { ok: true };
        } catch (_) {
            return { ok: false };
        }
    }

    /**
     * Drag one group into another's place, so the desk reads in your order.
     * The group dropped on shifts along rather than being swapped with.
     *
     * chrome.tabGroups.move wants the strip index the group's first tab should
     * end up at, counted with the dragged group already lifted out — so every
     * tab of it standing left of the target counts against the index.
     */
    async function moveGroup(groupId, beforeId) {
        if (groupId === beforeId) return { ok: true };
        const { tabs, groups, state } = await desk();
        // While one group holds the desk, the order is not up for rearranging.
        if (held(state, groups) != null) return { ok: false, locked: true };
        const anchor = tabsOf(tabs, beforeId)[0];
        const dragged = tabsOf(tabs, groupId);
        if (!anchor || !dragged.length) return { ok: false };
        const lifted = dragged.filter((tab) => tab.index < anchor.index).length;
        try {
            await chrome.tabGroups.move(groupId, { index: anchor.index - lifted });
            return { ok: true };
        } catch (_) {
            return { ok: false };
        }
    }

    /** Hold the desk for a stretch. Zero minutes lets it go again. */
    async function lockGroup(groupId, minutes) {
        await Trials.update((stored) => (minutes ? Trials.lock(stored, groupId, minutes) : Trials.unlock(stored, groupId)));
        return { ok: true };
    }

    /** Throw the group away, tabs and all. The dashboard asks first. */
    async function discardGroup(groupId) {
        const { tabs, groups, state } = await desk();
        if (held(state, groups) === groupId) return { ok: false, locked: true };
        const ids = tabsOf(tabs, groupId).map((tab) => tab.id);
        if (!ids.length) return { ok: false };
        try {
            await chrome.tabs.remove(ids);
        } catch (_) {
            return { ok: false };
        }
        await Trials.update((stored) => Trials.forget(stored, groupId));
        return { ok: true };
    }

    // A group the user closed takes its id with it; the record goes too, or a
    // later group handed the same id would inherit a stale lock.
    if (HAS_GROUPS && chrome.tabGroups.onRemoved) {
        chrome.tabGroups.onRemoved.addListener((group) => {
            Trials.update((state) => Trials.forget(state, group.id));
        });
    }

    const HANDLERS = {
        trialSnapshot: () => snapshot(),
        trialMoveTab: (m) => moveTab(m.tabId, m.groupId, m.index),
        trialNewGroup: (m) => newGroupFrom(m.tabId),
        trialOpenGroup: (m) => openGroup(m.groupId),
        trialRenameGroup: (m) => renameGroup(m.groupId, m.title),
        trialMoveGroup: (m) => moveGroup(m.groupId, m.beforeId),
        trialLockGroup: (m) => lockGroup(m.groupId, m.minutes),
        trialDiscardGroup: (m) => discardGroup(m.groupId),
    };

    for (const [action, handler] of Object.entries(HANDLERS)) {
        Router.on(action, (message) => (HAS_GROUPS ? handler(message) : { ok: false, unsupported: true }));
    }

    root.BB.TrialsWorker = {
        snapshot, moveTab, newGroupFrom, openGroup,
        renameGroup, moveGroup, lockGroup, discardGroup, HAS_GROUPS,
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
