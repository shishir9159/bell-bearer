/**
 * A Node check for the tab-group desk: src/background/trials.js driven against
 * a tab strip made of plain objects.
 *
 * Every other test in the suite is of pure logic, because that is all Node can
 * reach. This one is the exception, and it earns it: the desk's hard parts are
 * the index arithmetic of chrome.tabs.move and chrome.tabGroups.move, both of
 * which take the position a tab should end up at *after* it has been lifted out
 * of the strip. Off-by-one there does not throw — it quietly drops a tab in the
 * wrong group, or splits the group it was dragged past. Nothing but a strip you
 * can read back catches that.
 *
 * So the stubs below are not mocks that record calls; they are a working strip
 * that reorders itself the way Chrome's does. `strip()` renders it as a line of
 * `id:group` for the assertions to read.
 *
 *     node tests/desk-check.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const NONE = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE

let tabs = [];
let groups = [];
const store = {};

const strip = () => tabs.map((t) => `${t.id}${t.groupId === NONE ? '' : `:g${t.groupId}`}`).join(' ');
const reindex = () => tabs.forEach((tab, i) => { tab.index = i; });

const chrome = {
    runtime: { onMessage: { addListener() {} }, lastError: null },
    storage: {
        local: {
            get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])),
            set: async (values) => Object.assign(store, values),
        },
        onChanged: { addListener() {} },
    },
    windows: { getCurrent: async () => ({ id: 1 }), update: async () => {} },
    tabs: {
        query: async ({ windowId, groupId }) => tabs
            .filter((t) => (windowId == null || t.windowId === windowId) && (groupId == null || t.groupId === groupId))
            .map((t) => ({ ...t })),
        group: async ({ tabIds, groupId }) => {
            const id = groupId == null ? groups.reduce((n, g) => Math.max(n, g.id), 0) + 1 : groupId;
            if (groupId == null) groups.push({ id, windowId: 1, title: '', color: 'grey', collapsed: false });
            for (const tabId of tabIds) tabs.find((t) => t.id === tabId).groupId = id;
            return id;
        },
        ungroup: async (tabIds) => { for (const id of tabIds) tabs.find((t) => t.id === id).groupId = NONE; },
        // Lift the tab out, then put it back at `index` — Chrome's own order.
        move: async (tabId, { index }) => {
            const [tab] = tabs.splice(tabs.findIndex((t) => t.id === tabId), 1);
            tabs.splice(index, 0, tab);
            reindex();
        },
        update: async () => {},
        remove: async (tabIds) => { tabs = tabs.filter((t) => !tabIds.includes(t.id)); reindex(); },
        onUpdated: { addListener() {} },
        onRemoved: { addListener() {} },
        onActivated: { addListener() {} },
    },
    tabGroups: {
        query: async () => groups.map((g) => ({ ...g })),
        get: async (id) => {
            const group = groups.find((g) => g.id === id);
            if (!group) throw new Error('no such group');
            return { ...group };
        },
        update: async (id, changes) => { Object.assign(groups.find((g) => g.id === id), changes); },
        // The whole group lifts out and goes back together, staying contiguous.
        move: async (id, { index }) => {
            const moving = tabs.filter((t) => t.groupId === id);
            const rest = tabs.filter((t) => t.groupId !== id);
            rest.splice(index, 0, ...moving);
            tabs = rest;
            reindex();
        },
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {} },
    },
};

const sandbox = { chrome, console, URL, Date, Math, JSON, setTimeout, clearTimeout };
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ['src/shared/settings.js', 'src/shared/trials.js', 'src/background/trials.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
const Desk = sandbox.BB.TrialsWorker;
const Trials = sandbox.BB.Trials;

/**
 * A student's window: two groups in play, one parked, two loose tabs. Pass
 * `full` to have all three in play, which is what makes the next group park one.
 */
function seed(full) {
    tabs = [];
    for (const key of Object.keys(store)) delete store[key];
    groups = [
        { id: 10, windowId: 1, title: 'Coursework', color: 'blue', collapsed: false },
        { id: 20, windowId: 1, title: 'Thesis', color: 'cyan', collapsed: false },
        { id: 30, windowId: 1, title: 'Admin', color: 'green', collapsed: !full },
    ];
    const add = (id, groupId) => tabs.push({
        id, windowId: 1, groupId, url: `https://s${id}.test/`, title: `tab ${id}`, active: false,
    });
    add(1, 10); add(2, 10);
    add(3, 20); add(4, 20);
    add(5, 30);
    add(6, NONE); add(7, NONE);
    reindex();
}

const used = (state) => Trials.update(() => state);
const openGroups = () => groups.filter((group) => !group.collapsed).map((group) => group.id);

let passed = 0;
let failed = 0;

function eq(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) {
        passed += 1;
        return;
    }
    failed += 1;
    console.log(`  FAIL  ${name}\n        expected ${JSON.stringify(want)}\n        got      ${JSON.stringify(got)}`);
}

(async () => {
    console.log('\n# the desk as the dashboard reads it');

    seed();
    let snap = (await Desk.snapshot()).desk;
    eq('the ungrouped tabs are listed on their own', snap.loose.map((t) => t.id), [6, 7]);
    eq('a collapsed group reads as parked', snap.groups.map((g) => [g.id, g.parked]), [[10, false], [20, false], [30, true]]);
    eq('nothing holds the desk to begin with', snap.lockedId, null);

    console.log('\n# dragging a tab');

    seed();
    await Desk.moveTab(6, 10, 0);
    eq('a tab dropped at the top of a group lands there', strip(), '6:g10 1:g10 2:g10 3:g20 4:g20 5:g30 7');

    await Desk.moveTab(6, 20, 2);
    eq('and dragged on to the end of another, last in it', strip(), '1:g10 2:g10 3:g20 4:g20 6:g20 5:g30 7');

    await Desk.moveTab(6, null, 0);
    eq('dragged back to the left it leaves every group', tabs.find((t) => t.id === 6).groupId, NONE);

    seed();
    await Desk.moveTab(2, 10, 0);
    eq('a tab reorders inside its own group', strip(), '2:g10 1:g10 3:g20 4:g20 5:g30 6 7');

    console.log('\n# three run at a time');

    seed(true);
    await used(Trials.touch(Trials.touch(Trials.touch({}, 10, 1000), 20, 3000), 30, 2000));
    const made = await Desk.newGroupFrom(7);
    eq('a loose tab can start a group', made.ok, true);
    eq('the new group is named and coloured', [
        groups.find((g) => g.id === made.groupId).title,
        groups.find((g) => g.id === made.groupId).color,
    ], ['Untitled group', 'yellow']);
    eq('and it parks the group left longest', openGroups(), [20, 30, made.groupId]);
    eq('three in play, never four', openGroups().length, Trials.SLOT_LIMIT);

    seed();
    groups.push({ id: 40, windowId: 1, title: 'Travel', color: 'pink', collapsed: false });
    tabs.push({ id: 8, windowId: 1, groupId: 40, url: 'https://s8.test/', title: 'tab 8', active: false });
    reindex();
    await used(Trials.touch(Trials.touch(Trials.touch({}, 10, 1000), 20, 3000), 40, 2000));
    await Desk.openGroup(30);
    eq('opening a parked group brings it back', groups.find((g) => g.id === 30).collapsed, false);
    eq('and parks the stalest of the three', openGroups(), [20, 30, 40]);

    console.log('\n# a locked group holds the desk');

    seed();
    await Desk.lockGroup(10, 25);
    snap = (await Desk.snapshot()).desk;
    eq('the lock shows in the snapshot', snap.lockedId, 10);
    eq('nothing can be dropped into it', (await Desk.moveTab(6, 10, 0)).locked, true);
    eq('nothing can be dragged out of it', (await Desk.moveTab(1, null, 0)).locked, true);
    eq('it cannot be renamed', (await Desk.renameGroup(10, 'nope')).locked, true);
    eq('it cannot be discarded', (await Desk.discardGroup(10)).locked, true);
    eq('and the desk order is frozen with it', (await Desk.moveGroup(20, 10)).locked, true);
    eq('another group still takes tabs', (await Desk.moveTab(6, 20, 0)).ok, true);

    await Desk.lockGroup(10, 0);
    eq('unlocking lets go of all that', (await Desk.renameGroup(10, 'Renamed')).ok, true);
    eq('and the rename reaches the group', groups.find((g) => g.id === 10).title, 'Renamed');

    console.log('\n# dragging a group');

    seed();
    await Desk.moveGroup(20, 10);
    eq('a group dragged left takes the other one place', strip(), '3:g20 4:g20 1:g10 2:g10 5:g30 6 7');

    seed();
    await Desk.moveGroup(10, 30);
    eq('and dragged right, the same', strip(), '3:g20 4:g20 1:g10 2:g10 5:g30 6 7');

    seed();
    await Desk.moveGroup(30, 20);
    eq('a group stays whole wherever it lands', strip(), '1:g10 2:g10 5:g30 3:g20 4:g20 6 7');

    console.log('\n# discarding');

    seed();
    await used(Trials.touch(Trials.touch({}, 10, 1000), 20, 2000));
    eq('discarding closes the tabs with the group', (await Desk.discardGroup(10)).ok, true);
    eq('and they are gone from the strip', strip(), '3:g20 4:g20 5:g30 6 7');
    eq('its record goes with it, the others stay', Object.keys(store[Trials.KEY] || {}), ['20']);

    console.log(`\n${'='.repeat(52)}`);
    console.log(`${passed}/${passed + failed} passed${failed ? `  (${failed} FAILED)` : ''}\n`);
    process.exit(failed ? 1 : 0);
})();
