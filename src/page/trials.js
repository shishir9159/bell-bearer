/**
 * The Trials view: the desk of tab groups, and the ungrouped tabs beside it.
 *
 * Built to the design in "Website extension keyboard settings" — the ungrouped
 * tabs listed down the left, up to three group slots to the right of them, an
 * empty slot to start a group by dropping a tab on it, and the parked groups on
 * a shelf underneath. Everything moves by dragging: a tab into a group, back
 * out to the left-hand list, or onto the empty slot; a group by its handle to
 * reorder the desk.
 *
 * Nothing here touches chrome.tabGroups — see src/background/trials.js. This
 * file sends a message, then redraws from the snapshot that comes back, so the
 * desk on screen is always Chrome's own state rather than a guess at it. The
 * only local state is what a drag is doing right now.
 *
 * A group can be locked for a stretch. While one is, it is the only thing on
 * the desk you can touch: the rest dims, the left-hand list goes quiet, and a
 * bar across the top of the plate runs down.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Trials, Dom, Ui, Plate } = BB;

    const esc = Dom.escapeHtml;
    const attr = Dom.escapeAttr;

    /** The glyphs the slot head needs, drawn the way the design draws them. */
    const ICONS = {
        lock: '<rect x="3" y="11" width="18" height="10" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
        unlock: '<rect x="3" y="11" width="18" height="10" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 9.6-1.4"></path>',
        x: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
    };

    const glyph = (name) => `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" aria-hidden="true">${ICONS[name]}</svg>`;

    /** The last snapshot, and what the pointer is doing to it. */
    let deskState = null;
    let unsupported = false;
    let host = null;
    let drag = null; // { kind: 'tab' | 'group', id, from }
    let over = null; // the zone a drag is hovering: a group id, 'loose' or 'new'
    let overIdx = null;
    let picked = null;
    let menu = null; // the group whose lock menu is open
    let ticker = null;

    function send(message) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) resolve({ ok: false });
                    else resolve(response || { ok: false });
                });
            } catch (_) {
                resolve({ ok: false });
            }
        });
    }

    // ------------------------------------------------------------ drawing

    function tabRow(tab, zone, index, frozen) {
        const classes = ['tg-tab'];
        if (picked === tab.id) classes.push('is-picked');
        return `
            <div class="${classes.join(' ')}" draggable="${frozen ? 'false' : 'true'}"
                 data-tab="${tab.id}" data-zone="${attr(String(zone))}" data-idx="${index}"
                 title="${attr(Trials.domainOf(tab.url) || tab.url)}">
                <span class="tg-mono" style="color:${attr(Trials.tint(tab.url))}">${esc(Trials.mono(tab.url))}</span>
                <span class="tg-tab-title">${esc(tab.title)}</span>
            </div>`;
    }

    function tabList(tabs, zone, frozen) {
        return tabs.map((tab, i) => tabRow(tab, zone, i, frozen)).join('');
    }

    /**
     * The gap showing where a drop would land, and the outline round what it
     * would land in.
     *
     * This moves nodes about rather than redrawing, and that is the point: a
     * drag in progress belongs to the element it started on, and rebuilding the
     * list under it would throw that element away mid-drag and take `dragend`
     * with it. So nothing that runs on dragover is allowed to repaint.
     */
    function markDrop() {
        host.querySelectorAll('.tg-landing').forEach((mark) => mark.remove());
        host.querySelectorAll('.is-dropping').forEach((el) => el.classList.remove('is-dropping'));
        host.querySelectorAll('.tg-tab.is-ghost').forEach((el) => el.classList.remove('is-ghost'));
        const empty = host.querySelector('[data-new] > span');
        if (empty) empty.textContent = 'Drop tabs here to start a group';
        if (!drag) return;

        if (drag.kind === 'tab') host.querySelector(`[data-tab="${drag.id}"]`)?.classList.add('is-ghost');

        const outline = over === 'new'
            ? host.querySelector('[data-new]')
            : over === 'loose'
                ? host.querySelector('.tg-zone')
                : host.querySelector(`.tg-slot[data-group="${over}"]`);
        if (!outline) return;
        outline.classList.add('is-dropping');
        if (drag.kind !== 'tab') return;
        if (over === 'new') {
            outline.firstElementChild.textContent = 'Release to start a group';
            return;
        }

        const list = over === 'loose' ? outline : outline.querySelector('.tg-slot-tabs');
        const rows = [...list.querySelectorAll(':scope > .tg-tab')];
        const mark = document.createElement('div');
        mark.className = 'tg-landing';
        if (overIdx == null || overIdx >= rows.length) list.appendChild(mark);
        else list.insertBefore(mark, rows[overIdx]);
    }

    /** The lock row: the stretches on offer, or the way back out of one. */
    function lockMenu(group, locked) {
        const presets = locked
            ? [{ label: 'Unlock now', mins: 0 }]
            : Trials.LOCK_PRESETS.map((mins) => ({ label: `${mins} min`, mins }));
        return `
            <div class="tg-menu">
                <span class="tg-menu-label">${locked ? 'Locked' : 'Lock for'}</span>
                ${presets.map((preset) => `
                    <button class="tg-preset" type="button" data-act="preset" data-mins="${preset.mins}">
                        ${esc(preset.label)}
                    </button>`).join('')}
            </div>`;
    }

    function slot(group, lockedId) {
        const locked = group.id === lockedId;
        const dimmed = lockedId != null && !locked;
        const left = Trials.minutesLeft(deskState.state, group.id, deskState.now);
        const classes = ['tg-slot'];
        if (locked) classes.push('is-locked');
        if (dimmed) classes.push('is-dimmed');

        return `
            <div class="${classes.join(' ')}" data-group="${group.id}" data-zone="${group.id}">
                <div class="tg-slot-head">
                    <span class="tg-handle" data-handle draggable="${lockedId == null ? 'true' : 'false'}"
                          title="Drag to reorder"></span>
                    <input class="tg-name" value="${attr(group.title)}" aria-label="Group name"
                           ${locked ? 'readonly' : ''} maxlength="${Trials.MAX_NAME}">
                    <span class="tg-slot-count" title="${group.tabs.length} tab${group.tabs.length === 1 ? '' : 's'}">${group.tabs.length}</span>
                    <button class="tg-icon${locked ? ' is-on' : ''}" type="button" data-act="lock"
                            title="${locked ? `${left} min left` : 'Lock this group for a stretch'}"
                            aria-label="Lock this group">${glyph(locked ? 'lock' : 'unlock')}</button>
                    <button class="tg-icon" type="button" data-act="discard" ${locked ? 'disabled' : ''}
                            title="Discard this group" aria-label="Discard this group">${glyph('x')}</button>
                </div>
                ${menu === group.id ? lockMenu(group, locked) : ''}
                ${locked ? `<div class="tg-note">${left} min left — nothing goes in or out until then</div>` : ''}
                <div class="tg-slot-tabs">${tabList(group.tabs, group.id, locked)}</div>
            </div>`;
    }

    function parkedCard(group) {
        const faces = group.tabs.slice(0, 4);
        const used = Trials.usedLabel(Trials.recordFor(deskState.state, group.id).usedAt, deskState.now);
        return `
            <button class="tg-parked-card" type="button" data-open="${group.id}"
                    title="Open ${attr(group.title || 'this group')}">
                <span class="tg-parked-name">${esc(group.title || 'Untitled group')}</span>
                <span class="tg-faces">
                    ${faces.map((tab) => `<span class="tg-mono is-small" style="color:${attr(Trials.tint(tab.url))}">${esc(Trials.mono(tab.url))}</span>`).join('')}
                    ${group.tabs.length > 4 ? `<span class="tg-more">+${group.tabs.length - 4}</span>` : ''}
                </span>
                <span class="tg-parked-meta">${group.tabs.length} tab${group.tabs.length === 1 ? '' : 's'}
                    <span class="tg-dot"></span>${esc(used)}</span>
            </button>`;
    }

    /** The parts of the plate that change; the frame itself is built once. */
    function paint() {
        if (!deskState) return;
        const { groups, loose, lockedId } = deskState;
        const open = groups.filter((group) => !group.parked);
        const parked = groups.filter((group) => group.parked);
        const locked = lockedId == null ? null : groups.find((group) => group.id === lockedId);

        const record = locked ? Trials.recordFor(deskState.state, locked.id) : null;
        const ran = record && record.lockSpan
            ? Math.max(0, Math.min(100, ((record.lockUntil - deskState.now) / record.lockSpan) * 100))
            : 0;
        const bar = host.querySelector('.tg-lockbar');
        bar.hidden = !locked;
        bar.firstElementChild.style.width = `${ran}%`;

        host.querySelector('.tg-intro').textContent = locked
            ? `${locked.title || 'That group'} is locked — the other groups sit out until the timer runs down.`
            : 'Three groups run at a time; the rest stand by. Drag a tab into a group, or onto the empty slot to start one.';

        const looseCol = host.querySelector('.tg-loose');
        looseCol.classList.toggle('is-quiet', !!locked);
        host.querySelector('.tg-loose-count').textContent = `${loose.length} ungrouped`;
        const zone = host.querySelector('.tg-zone');
        zone.innerHTML = loose.length
            ? tabList(loose, 'loose', !!locked)
            : `<p class="tg-empty">Every open tab sits in a group.</p>`;

        const newSlot = open.length < Trials.SLOT_LIMIT && !locked
            ? `<div class="tg-newslot" data-new><span>Drop tabs here to start a group</span></div>`
            : '';
        host.querySelector('.tg-slots').innerHTML = open.map((group) => slot(group, lockedId)).join('') + newSlot;

        const standby = host.querySelector('.tg-standby');
        standby.classList.toggle('is-quiet', !!locked);
        const tabCount = parked.reduce((n, group) => n + group.tabs.length, 0);
        host.querySelector('.tg-parked-count').textContent =
            `${parked.length} group${parked.length === 1 ? '' : 's'} · ${tabCount} tabs`;
        host.querySelector('.tg-parked').innerHTML = parked.length
            ? parked.map(parkedCard).join('')
            : `<span class="tg-empty">Nothing parked — all three slots are in play.</span>`;
    }

    async function refresh() {
        const answer = await send({ action: 'trialSnapshot' });
        unsupported = !!answer.unsupported;
        if (unsupported) return skeleton();
        if (answer.ok && answer.desk) deskState = answer.desk;
        paint();
        clock();
    }

    /** Tick once a second, but only while a lock is actually running down. */
    function clock() {
        const running = deskState && deskState.lockedId != null;
        if (running && !ticker) {
            ticker = setInterval(() => {
                deskState.now = Date.now();
                if (Trials.lockedId(deskState.state, [deskState.lockedId], deskState.now) == null) refresh();
                else paint();
            }, 1000);
        } else if (!running && ticker) {
            clearInterval(ticker);
            ticker = null;
        }
    }

    // ------------------------------------------------------------ actions

    function zoneOf(element) {
        const holder = element.closest('[data-zone]');
        if (!holder) return null;
        const value = holder.dataset.zone;
        return value === 'loose' ? 'loose' : Number(value);
    }

    /** Where in the list a drop would land: above the row, or below it. */
    function indexAt(row, event) {
        const box = row.getBoundingClientRect();
        const index = Number(row.dataset.idx);
        return event.clientY - box.top < box.height / 2 ? index : index + 1;
    }

    function hover(zone, index) {
        if (over === zone && overIdx === index) return;
        over = zone;
        overIdx = index;
        markDrop();
    }

    async function drop() {
        const target = over;
        const index = overIdx;
        const moving = drag;
        drag = null;
        over = null;
        overIdx = null;
        if (!moving) return paint();

        if (moving.kind === 'group') {
            if (typeof target === 'number') await send({ action: 'trialMoveGroup', groupId: moving.id, beforeId: target });
        } else if (target === 'new') {
            await send({ action: 'trialNewGroup', tabId: moving.id });
        } else if (target === 'loose') {
            await send({ action: 'trialMoveTab', tabId: moving.id, groupId: null, index });
        } else if (typeof target === 'number') {
            await send({ action: 'trialMoveTab', tabId: moving.id, groupId: target, index });
        }
        return refresh();
    }

    async function discard(group) {
        const yes = await Ui.confirmDialog({
            title: `Discard ${group.title || 'this group'}?`,
            message: `Its ${group.tabs.length} tab${group.tabs.length === 1 ? '' : 's'} close with the group.`
                + ' Park it instead if you want them back later.',
            confirmLabel: 'Discard',
            cancelLabel: 'Keep it',
            danger: true,
        });
        if (!yes) return;
        await send({ action: 'trialDiscardGroup', groupId: group.id });
        return refresh();
    }

    function groupOf(element) {
        const card = element.closest('[data-group]');
        if (!card) return null;
        return deskState.groups.find((group) => group.id === Number(card.dataset.group)) || null;
    }

    function wire() {
        host.addEventListener('dragstart', (event) => {
            const handle = event.target.closest('[data-handle]');
            if (handle) {
                const group = groupOf(handle);
                if (!group || handle.getAttribute('draggable') === 'false') return event.preventDefault();
                drag = { kind: 'group', id: group.id };
            } else {
                const row = event.target.closest('[data-tab]');
                if (!row || row.getAttribute('draggable') === 'false') return event.preventDefault();
                drag = { kind: 'tab', id: Number(row.dataset.tab), from: zoneOf(row) };
            }
            try {
                event.dataTransfer.setData('text/plain', String(drag.id));
                event.dataTransfer.effectAllowed = 'move';
            } catch (_) { /* older hosts */ }
            return markDrop();
        });

        host.addEventListener('dragend', () => {
            drag = null;
            over = null;
            overIdx = null;
            markDrop();
        });

        host.addEventListener('dragover', (event) => {
            if (!drag) return;
            if (event.target.closest('[data-new]')) {
                event.preventDefault();
                return hover('new', null);
            }
            const row = drag.kind === 'tab' && event.target.closest('[data-tab]');
            if (row) {
                event.preventDefault();
                return hover(zoneOf(row), indexAt(row, event));
            }
            const zone = zoneOf(event.target);
            if (zone == null) return undefined;
            event.preventDefault();
            const group = zone === 'loose' ? null : deskState.groups.find((item) => item.id === zone);
            return hover(zone, group ? group.tabs.length : deskState.loose.length);
        });

        host.addEventListener('drop', (event) => {
            if (!drag) return;
            event.preventDefault();
            drop();
        });

        host.addEventListener('click', async (event) => {
            const openCard = event.target.closest('[data-open]');
            if (openCard) {
                await send({ action: 'trialOpenGroup', groupId: Number(openCard.dataset.open) });
                return refresh();
            }

            const row = event.target.closest('[data-tab]');
            if (row) {
                const id = Number(row.dataset.tab);
                picked = picked === id ? null : id;
                return paint();
            }

            const button = event.target.closest('[data-act]');
            if (!button) return undefined;
            const group = groupOf(button);
            if (!group) return undefined;

            if (button.dataset.act === 'lock') {
                menu = menu === group.id ? null : group.id;
                return paint();
            }
            if (button.dataset.act === 'preset') {
                menu = null;
                await send({ action: 'trialLockGroup', groupId: group.id, minutes: Number(button.dataset.mins) });
                return refresh();
            }
            if (button.dataset.act === 'discard') return discard(group);
            return undefined;
        });

        // A tab row's double-click opens it; a single click only marks it.
        host.addEventListener('dblclick', (event) => {
            const row = event.target.closest('[data-tab]');
            if (row) chrome.tabs.update(Number(row.dataset.tab), { active: true });
        });

        host.addEventListener('change', async (event) => {
            const name = event.target.closest('.tg-name');
            if (!name) return;
            const group = groupOf(name);
            if (group) await send({ action: 'trialRenameGroup', groupId: group.id, title: name.value });
            refresh();
        });
    }

    /** The frame and the empty containers, built once so the plate stays put. */
    function skeleton() {
        host.innerHTML = `
            <div class="dashboard-header"><h2>Trials</h2></div>
            <div data-plate="Tab Groups">
                ${unsupported
                    ? `<div class="empty-state">
                           <h3>Tab groups are not available here</h3>
                           <p>The desk is built out of browser tab groups, which this browser does not have.</p>
                       </div>`
                    : `<div class="tg-lockbar" hidden><div class="tg-lockfill"></div></div>
                       <p class="tg-intro"></p>
                       <div class="tg-grid">
                           <div class="tg-loose">
                               <div class="tg-col-head">
                                   <span class="tg-col-label">Open tabs</span>
                                   <span class="tg-loose-count"></span>
                               </div>
                               <div class="tg-zone" data-zone="loose"></div>
                           </div>
                           <div class="tg-right">
                               <div class="tg-slots"></div>
                               <div class="tg-standby">
                                   <div class="tg-col-head is-ruled">
                                       <span class="tg-col-label">Parked</span>
                                       <span class="tg-rule"></span>
                                       <span class="tg-parked-count"></span>
                                   </div>
                                   <div class="tg-parked"></div>
                               </div>
                           </div>
                       </div>`}
            </div>`;
        if (Plate) Plate.mountAll(host);
    }

    function mount(element) {
        host = element;
        if (!host) return;
        skeleton();
        wire();
        refresh();
    }

    BB.TrialsView = { mount, render: refresh };
})(typeof globalThis !== 'undefined' ? globalThis : this);
