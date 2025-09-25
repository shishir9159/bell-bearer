/**
 * The Trials view: the tasks you have named, and the tabs each one is holding.
 *
 * Everything that touches a tab group happens in the worker — see
 * src/background/trials.js — so this file sends a message and redraws from
 * what comes back. It never assumes an operation worked; the summary it asks
 * for afterwards is the truth, including whether a group is still `live`.
 *
 * A trial whose group has gone is drawn dimmed rather than hidden. That state
 * is completely normal: closing the window ends every group, and the trial is
 * still the task you meant to come back to. Focusing it makes a new group.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Trials, Dom, Ui } = BB;

    const esc = Dom.escapeHtml;

    let trials = [];
    let host = null;
    let unsupported = false;

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

    function tabRow(trial, tab) {
        return `
            <li class="trial-tab">
                <span class="trial-tab-title" title="${esc(tab.url)}">${esc(tab.title)}</span>
                <button class="trial-tab-drop" type="button" data-drop="${tab.id}"
                        title="Take this tab out of the trial" aria-label="Remove tab from trial">&times;</button>
            </li>`;
    }

    function card(trial) {
        const count = trial.tabs.length;
        return `
            <article class="trial-card${trial.live ? '' : ' is-dormant'}" data-trial="${esc(trial.id)}"
                     style="--trial-color: var(--tg-${trial.color})">
                <header class="trial-card-head">
                    <span class="trial-swatch" aria-hidden="true"></span>
                    <h3 class="trial-name">${esc(trial.name)}</h3>
                    <span class="trial-count">${trial.live ? `${count} tab${count === 1 ? '' : 's'}` : 'no group open'}</span>
                </header>
                ${count ? `<ul class="trial-tabs">${trial.tabs.map((tab) => tabRow(trial, tab)).join('')}</ul>` : ''}
                <div class="trial-actions">
                    <button class="btn-primary" type="button" data-act="focus">Focus</button>
                    <button class="btn-secondary" type="button" data-act="add">File this tab</button>
                    <button class="btn-secondary" type="button" data-act="rename">Rename</button>
                    <button class="btn-secondary btn-danger" type="button" data-act="delete">Delete</button>
                </div>
            </article>`;
    }

    function paint() {
        if (!host) return;

        if (unsupported) {
            host.innerHTML = `
                <div class="empty-state">
                    <h3>Tab groups are not available here</h3>
                    <p>Trials keep their tabs in a browser tab group, which this browser does not have.</p>
                </div>`;
            return;
        }

        host.innerHTML = `
            <div class="dashboard-header">
                <h2>Trials</h2>
                <div class="dashboard-controls">
                    <button id="trialAddBtn" class="btn-primary" type="button">+ New Trial</button>
                </div>
            </div>
            ${trials.length
                ? `<div class="trials-grid">${trials.map(card).join('')}</div>`
                : `<div class="empty-state">
                       <div class="empty-icon">⚔</div>
                       <h3>No trials yet</h3>
                       <p>A trial is one piece of work and the tabs it needs. Make one, file tabs
                          into it, and focus it to put everything else away.</p>
                   </div>`}`;
    }

    async function refresh() {
        const answer = await send({ action: 'trialSummary' });
        unsupported = !!answer.unsupported;
        // The worker returns the store with live tab data folded in; falling
        // back to the bare store keeps the view usable if it did not answer.
        trials = answer.ok && answer.trials ? answer.trials
            : (await Trials.load()).map((trial) => ({ ...trial, live: false, tabs: [] }));
        paint();
    }

    async function addTrial() {
        const name = await Ui.promptDialog({
            title: 'New trial',
            label: 'What is this piece of work called?',
            placeholder: 'Thesis chapter 3',
            confirmLabel: 'Create',
        });
        if (!name) return;
        await Trials.update((list) => Trials.create(list, name));
        await refresh();
    }

    async function renameTrial(trial) {
        const name = await Ui.promptDialog({
            title: 'Rename trial',
            label: 'A new name for this trial.',
            value: trial.name,
            confirmLabel: 'Rename',
        });
        if (!name) return;
        await Trials.update((list) => Trials.rename(list, trial.id, name));
        // The group carries the name too, so the tab strip stays in step.
        await send({ action: 'trialSyncMeta', id: trial.id });
        await refresh();
    }

    async function deleteTrial(trial) {
        const yes = await Ui.confirmDialog({
            title: `Delete "${trial.name}"?`,
            message: 'The trial is forgotten. Its tabs stay open and leave the group.',
            confirmLabel: 'Delete',
            danger: true,
        });
        if (!yes) return;
        await Trials.update((list) => Trials.remove(list, trial.id));
        await refresh();
    }

    function wire() {
        host.addEventListener('click', async (event) => {
            if (event.target.closest('#trialAddBtn')) return addTrial();

            const drop = event.target.closest('[data-drop]');
            if (drop) {
                await send({ action: 'trialRemoveTab', tabId: Number(drop.dataset.drop) });
                return refresh();
            }

            const button = event.target.closest('[data-act]');
            if (!button) return;
            const element = button.closest('[data-trial]');
            const trial = trials.find((item) => item.id === element.dataset.trial);
            if (!trial) return;

            if (button.dataset.act === 'focus') {
                await send({ action: 'trialFocus', id: trial.id });
                return refresh();
            }
            if (button.dataset.act === 'add') {
                await send({ action: 'trialAddTab', id: trial.id });
                return refresh();
            }
            if (button.dataset.act === 'rename') return renameTrial(trial);
            if (button.dataset.act === 'delete') return deleteTrial(trial);
        });
    }

    function mount(element) {
        host = element;
        if (!host) return;
        wire();
        refresh();
    }

    BB.TrialsView = { mount, render: refresh };
})(typeof globalThis !== 'undefined' ? globalThis : this);
