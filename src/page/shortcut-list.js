/**
 * The shortcut lists in Settings: every row can be turned off, and rebound.
 *
 * Rows come from src/shared/keybindings.js, filtered by the container's
 * `data-shortcut-scope`; changes go to the `shortcuts` setting, which the
 * content scripts read on every keystroke — so a change applies to open tabs
 * straight away.
 *
 * Editing: the pencil puts the row into listening mode. The next keystroke
 * (modifiers held) becomes the shortcut, unless another enabled shortcut
 * already uses it; Escape or a click elsewhere cancels. A browser command
 * (Copy as Markdown) can only be rebound by the browser, so its pencil opens
 * the browser's own shortcut page instead.
 */
(function (root) {
    'use strict';

    const ns = root.BB || {};
    const { Keybindings, Settings, Dom, Ui, FeatherIcons } = ns;

    const BROWSER_SHORTCUTS_URL = 'chrome://extensions/shortcuts';

    let overrides = {};
    let editing = null; // { id, row }
    const mounts = [];

    function keysHtml(parts) {
        return parts.map((part) => `<kbd class="kbd-chip">${Dom.escapeHtml(part)}</kbd>`).join('<span class="kbd-plus">+</span>');
    }

    function rowHtml(shortcut, commandKeys) {
        const isCommand = shortcut.kind === 'command';
        const combo = isCommand && commandKeys[shortcut.command || shortcut.id] !== undefined
            ? commandKeys[shortcut.command || shortcut.id]
            : null;
        const keys = isCommand && combo !== null
            ? (combo ? keysHtml(combo.split('+')) : '<span class="kbd-none">Not set</span>')
            : keysHtml(Keybindings.parts(shortcut.combo, shortcut.kind));

        const isEditing = editing && editing.id === shortcut.id;
        return `
            <div class="shortcut-item${shortcut.enabled ? '' : ' is-off'}${isEditing ? ' is-editing' : ''}" data-shortcut="${Dom.escapeAttr(shortcut.id)}">
                <span class="shortcut-key">${isEditing ? '<span class="kbd-listening">Press the new shortcut…</span>' : keys}</span>
                <span class="shortcut-desc">${Dom.escapeHtml(shortcut.label)}</span>
                <span class="shortcut-actions">
                    ${shortcut.custom ? `<button type="button" class="shortcut-icon-btn" data-shortcut-action="reset" title="Back to default (${Dom.escapeAttr(Keybindings.format(Keybindings.resolve(null, shortcut.id).combo, shortcut.kind))})" aria-label="Reset ${Dom.escapeAttr(shortcut.label)} to default">${FeatherIcons.svg('rotate-ccw', 14)}</button>` : '<span class="shortcut-icon-slot" aria-hidden="true"></span>'}
                    <button type="button" class="shortcut-icon-btn${isEditing ? ' is-active' : ''}" data-shortcut-action="edit"
                            title="${isCommand ? 'Change in the browser\'s shortcut settings' : isEditing ? 'Cancel' : 'Change shortcut'}"
                            aria-label="${isEditing ? 'Cancel editing' : 'Edit'} ${Dom.escapeAttr(shortcut.label)}">${FeatherIcons.svg(isCommand ? 'external-link' : isEditing ? 'x' : 'edit-2', 14)}</button>
                    <label class="toggle-switch toggle-sm" title="${shortcut.enabled ? 'Turn off' : 'Turn on'}">
                        <input type="checkbox" data-shortcut-action="toggle" ${shortcut.enabled ? 'checked' : ''} aria-label="${Dom.escapeAttr(shortcut.label)} on">
                        <span class="toggle-slider"></span>
                    </label>
                </span>
            </div>`;
    }

    /** What the browser has bound each manifest command to, or {} where unknown. */
    async function readCommands() {
        try {
            if (!chrome.commands || !chrome.commands.getAll) return {};
            const commands = await chrome.commands.getAll();
            return Object.fromEntries(commands.map((command) => [command.name, command.shortcut || '']));
        } catch (_) {
            return {};
        }
    }

    let commandKeys = {};

    function renderAll() {
        for (const { container, scope } of mounts) {
            container.innerHTML = Keybindings.list(overrides, scope).map((shortcut) => rowHtml(shortcut, commandKeys)).join('');
        }
    }

    function save(id, change) {
        const next = { ...overrides };
        const merged = { ...(next[id] || {}), ...change };
        if (merged.enabled !== false) delete merged.enabled;
        if (!merged.combo) delete merged.combo;
        if (Object.keys(merged).length) next[id] = merged;
        else delete next[id];
        overrides = next;
        renderAll();
        return Settings.set({ shortcuts: next });
    }

    function stopEditing() {
        if (!editing) return;
        document.removeEventListener('keydown', onCapture, true);
        document.removeEventListener('mousedown', onOutside, true);
        editing = null;
        renderAll();
    }

    function onOutside(event) {
        if (editing && !event.target.closest(`[data-shortcut="${editing.id}"]`)) stopEditing();
    }

    function onCapture(event) {
        if (!editing) return;
        event.preventDefault();
        event.stopPropagation();

        if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
            stopEditing();
            return;
        }

        const shortcut = Keybindings.resolve(overrides, editing.id);
        const result = Keybindings.record(event, shortcut.kind);
        if (result.pending) return;
        if (result.error) {
            Ui.toast(result.error, 'warning');
            return;
        }

        const clash = Keybindings.conflicts(overrides, editing.id, result.combo)[0];
        if (clash) {
            Ui.toast(`${Keybindings.format(result.combo, shortcut.kind)} is already "${clash.label}"`, 'warning');
            return;
        }

        const id = editing.id;
        const isDefault = Keybindings.signature(result.combo, shortcut.kind) ===
            Keybindings.signature(Keybindings.resolve(null, id).combo, shortcut.kind) &&
            !Keybindings.resolve(null, id).combo.char;
        stopEditing();
        save(id, { combo: isDefault ? null : result.combo });
        Ui.toast(`${shortcut.label}: ${Keybindings.format(result.combo, shortcut.kind)}`, 'info');
    }

    function startEditing(id) {
        stopEditing();
        editing = { id };
        renderAll();
        document.addEventListener('keydown', onCapture, true);
        document.addEventListener('mousedown', onOutside, true);
    }

    function onClick(event) {
        const control = event.target.closest('[data-shortcut-action]');
        if (!control || control.tagName === 'INPUT') return;
        const id = control.closest('[data-shortcut]').dataset.shortcut;
        const shortcut = Keybindings.resolve(overrides, id);

        if (control.dataset.shortcutAction === 'reset') {
            const clash = Keybindings.conflicts(overrides, id, Keybindings.resolve(null, id).combo)[0];
            if (clash) {
                Ui.toast(`The default is in use by "${clash.label}" — change that one first`, 'warning');
                return;
            }
            save(id, { combo: null });
        } else if (control.dataset.shortcutAction === 'edit') {
            if (shortcut.kind === 'command') {
                chrome.tabs.create({ url: BROWSER_SHORTCUTS_URL }).catch(() => {
                    Ui.toast(`Open ${BROWSER_SHORTCUTS_URL} to change this one`, 'info');
                });
            } else if (editing && editing.id === id) {
                stopEditing();
            } else {
                startEditing(id);
            }
        }
    }

    function onChange(event) {
        const input = event.target.closest('input[data-shortcut-action="toggle"]');
        if (!input) return;
        const id = input.closest('[data-shortcut]').dataset.shortcut;
        if (input.checked) {
            const shortcut = Keybindings.resolve(overrides, id);
            const clash = Keybindings.conflicts(overrides, id, shortcut.combo)[0];
            if (clash) {
                input.checked = false;
                Ui.toast(`Its keys are now "${clash.label}" — edit one of them first`, 'warning');
                return;
            }
        }
        save(id, { enabled: input.checked });
    }

    /** Fill every `[data-shortcut-scope]` element under `rootElement`. */
    async function mountAll(rootElement = document) {
        rootElement.querySelectorAll('[data-shortcut-scope]').forEach((container) => {
            mounts.push({ container, scope: container.dataset.shortcutScope });
            container.addEventListener('click', onClick);
            container.addEventListener('change', onChange);
        });

        const [values, commands] = await Promise.all([Settings.get(['shortcuts']), readCommands()]);
        overrides = values.shortcuts || {};
        commandKeys = commands;
        renderAll();

        Settings.watch(['shortcuts'], (changed) => {
            overrides = changed.shortcuts || {};
            if (!editing) renderAll();
        });
    }

    root.BB = root.BB || {};
    root.BB.ShortcutList = { mountAll };
})(typeof globalThis !== 'undefined' ? globalThis : this);
