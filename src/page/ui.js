/**
 * Extension-page UI helpers shared by the popup and the dashboard: modals,
 * toasts, clipboard, file download/read, theme.
 *
 * The two pages had near-identical copies of every one of these. Where they had
 * drifted, this keeps the better half: the dashboard's blocking `alert()` and
 * `confirm()` calls are replaced with the popup's inline messages and a real
 * dialog, since a native alert in an extension page blocks the whole tab.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Settings = ns.Settings || req('../shared/settings.js');

    // ------------------------------------------------------------- modals

    /**
     * Open a modal built from `contentHtml`. Returns { element, close }; every
     * teardown path goes through the same close(), so the Escape listener is
     * always removed.
     */
    function openModal(contentHtml, { onClose } = {}) {
        const modal = document.createElement('div');
        modal.className = 'import-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML = `<div class="import-modal-content">${contentHtml}</div>`;

        let closed = false;
        const close = (result) => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKeyDown, true);
            modal.remove();
            if (onClose) onClose(result);
        };

        function onKeyDown(event) {
            if (event.key === 'Escape') close(undefined);
        }

        modal.addEventListener('click', (event) => {
            if (event.target === modal) close(undefined);
        });
        document.addEventListener('keydown', onKeyDown, true);
        document.body.appendChild(modal);

        modal.querySelectorAll('.import-modal-close').forEach((button) => {
            button.addEventListener('click', () => close(undefined));
        });

        return { element: modal, close };
    }

    /** A yes/no dialog. Resolves to true only when the user confirms. */
    function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
        return new Promise((resolve) => {
            const modal = openModal(`
                <h3>${Dom.escapeHtml(title)}</h3>
                <p class="modal-message">${Dom.escapeHtml(message)}</p>
                <div class="import-modal-buttons">
                    <button id="bb-confirm-yes" class="btn-primary${danger ? ' btn-danger' : ''}">${Dom.escapeHtml(confirmLabel)}</button>
                    <button class="import-modal-close">${Dom.escapeHtml(cancelLabel)}</button>
                </div>`, { onClose: (result) => resolve(result === true) });

            modal.element.querySelector('#bb-confirm-yes').addEventListener('click', () => modal.close(true));
        });
    }

    /** A single-field prompt. Resolves to the trimmed text, or null if cancelled. */
    function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save' }) {
        return new Promise((resolve) => {
            const modal = openModal(`
                <h3>${Dom.escapeHtml(title)}</h3>
                ${label ? `<label class="modal-label" for="bb-prompt-input">${Dom.escapeHtml(label)}</label>` : ''}
                <input type="text" id="bb-prompt-input" class="modal-input"
                       value="${Dom.escapeAttr(value)}" placeholder="${Dom.escapeAttr(placeholder)}">
                <div class="import-modal-buttons">
                    <button id="bb-prompt-ok" class="btn-primary">${Dom.escapeHtml(confirmLabel)}</button>
                    <button class="import-modal-close">Cancel</button>
                </div>`, { onClose: (result) => resolve(typeof result === 'string' ? result : null) });

            const input = modal.element.querySelector('#bb-prompt-input');
            const submit = () => {
                const text = input.value.trim();
                if (text) modal.close(text);
            };
            modal.element.querySelector('#bb-prompt-ok').addEventListener('click', submit);
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') submit();
            });
            input.focus();
            input.select();
        });
    }

    // ------------------------------------------------------------- toasts

    const TOAST_MS = 4000;
    let toastTimer = 0;

    /**
     * Show a transient message. One toast element is reused, so a burst of
     * messages replaces rather than stacks and an old timer can never remove a
     * newer message.
     */
    function toast(message, type = 'info') {
        let element = document.getElementById('bb-toast');
        if (!element) {
            element = document.createElement('div');
            element.id = 'bb-toast';
            element.setAttribute('role', 'status');
            element.setAttribute('aria-live', 'polite');
            document.body.appendChild(element);
        }
        element.textContent = message;
        element.className = `bb-toast bb-toast-${type} is-visible`;

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => element.classList.remove('is-visible'), TOAST_MS);
    }

    // ---------------------------------------------------------- clipboard

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) {
            try {
                const field = document.createElement('textarea');
                field.value = text;
                field.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
                document.body.appendChild(field);
                field.select();
                const ok = document.execCommand('copy');
                field.remove();
                return ok;
            } catch (__) {
                return false;
            }
        }
    }

    // --------------------------------------------------------------- files

    /**
     * Offer `text` as a download of `type`. The two wrappers below are what
     * callers use; the anchor-clicking itself is Dom.download, which the chat
     * exports share from inside a site's page.
     */
    function downloadText(filename, text, type = 'text/plain') {
        Dom.download(filename, String(text), type);
    }

    const downloadJson = (filename, data) =>
        downloadText(filename, JSON.stringify(data, null, 2), 'application/json');

    const saveText = (text, filename) => downloadText(filename, text);

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
            reader.readAsText(file);
        });
    }

    // --------------------------------------------------------------- theme

    /**
     * Apply the saved theme and keep following it. `dark-theme` goes on <html>
     * as well as <body> so the page background is themed before first paint.
     */
    function installTheme({ toggleId } = {}) {
        const apply = (theme) => {
            const dark = theme === 'dark';
            document.documentElement.classList.toggle('dark-theme', dark);
            document.body.classList.toggle('dark-theme', dark);
            document.querySelectorAll('header').forEach((el) => el.classList.toggle('dark-theme', dark));
            const toggle = toggleId && document.getElementById(toggleId);
            if (toggle) {
                toggle.textContent = dark ? '☀️' : '🌙';
                toggle.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
            }
        };

        Settings.get(['theme']).then((s) => apply(s.theme));
        Settings.watch(['theme'], (changed) => apply(changed.theme));

        const toggle = toggleId && document.getElementById(toggleId);
        if (toggle) {
            toggle.addEventListener('click', () => {
                const dark = !document.body.classList.contains('dark-theme');
                apply(dark ? 'dark' : 'light');
                Settings.set({ theme: dark ? 'dark' : 'light' });
            });
        }
    }

    const Ui = { openModal, confirmDialog, promptDialog, toast, copyText,
        downloadText, downloadJson, saveText, readFileAsText, installTheme };

    root.BB = root.BB || {};
    root.BB.Ui = Ui;
    if (typeof module !== 'undefined' && module.exports) module.exports = Ui;
})(typeof globalThis !== 'undefined' ? globalThis : this);
