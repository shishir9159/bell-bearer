/**
 * Shared plumbing for the two on-page dialogs (add-to-pouch, latest-by-topic).
 *
 * Both used to hand-roll the same overlay: build markup, append, wire a close
 * button, wire a backdrop click, wire Escape. The Escape listener in the topics
 * overlay was only removed when Escape itself was pressed, so closing any other
 * way leaked a document-level keydown handler for the life of the page.
 *
 * The Escape listener is on `document` in the capture phase, because the page
 * underneath (YouTube) has its own and would otherwise swallow the key. That
 * has one consequence worth stating: it sees Escape before anything inside the
 * dialog does, so a field inside a dialog could never cancel itself — the
 * whole dialog went instead. isTyping() below is what carves that out.
 */
(function (root) {
    'use strict';

    /**
     * Is the keystroke aimed at something the user is typing in?
     *
     * Resolved at event time rather than at load: overlay.js is loaded before
     * shortcuts.js, so BB.Shortcuts does not exist yet when this file runs.
     * The inline fallback keeps the dialogs working anywhere the content
     * bundle is not fully present, such as a test page.
     */
    function isTyping(event) {
        const shortcuts = root.BB && root.BB.Shortcuts;
        if (shortcuts && shortcuts.isTypingTarget) return shortcuts.isTypingTarget(event);

        const target = event.target;
        if (!target || target.nodeType !== 1) return false;
        return target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable === true;
    }

    /**
     * Open a modal containing `contentHtml`. Returns { element, close } where
     * `element` is the backdrop; query inside it to wire up controls.
     *
     * Every teardown path — the close button, the backdrop, Escape — goes
     * through the same close(), which removes all three listeners.
     */
    function open({ id, contentHtml, onClose } = {}) {
        if (id && document.getElementById(id)) return null;

        const overlay = document.createElement('div');
        if (id) overlay.id = id;
        overlay.className = 'bb-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = contentHtml;

        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKeyDown, true);
            overlay.removeEventListener('click', onBackdropClick);
            overlay.remove();
            if (onClose) onClose();
        };

        function onKeyDown(event) {
            if (event.key !== 'Escape') return;

            // Escape inside a field belongs to that field — it clears the
            // entry, or cancels the little inline form the field sits in. Let
            // it through; a second Escape, with nothing focused, closes us.
            if (overlay.contains(event.target) && isTyping(event)) return;

            event.stopPropagation();
            close();
        }
        function onBackdropClick(event) {
            if (event.target === overlay) close();
        }

        overlay.addEventListener('click', onBackdropClick);
        document.addEventListener('keydown', onKeyDown, true);
        document.body.appendChild(overlay);

        // Any element marked data-bb-close dismisses the dialog.
        overlay.querySelectorAll('[data-bb-close]').forEach((el) => {
            el.addEventListener('click', close);
        });

        return { element: overlay, close };
    }

    const Overlay = { open };

    root.BB = root.BB || {};
    root.BB.Overlay = Overlay;
    if (typeof module !== 'undefined' && module.exports) module.exports = Overlay;
})(typeof globalThis !== 'undefined' ? globalThis : this);
