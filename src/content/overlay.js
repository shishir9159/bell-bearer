/**
 * Shared plumbing for the two on-page dialogs (add-to-pouch, latest-by-topic).
 *
 * Both used to hand-roll the same overlay: build markup, append, wire a close
 * button, wire a backdrop click, wire Escape. The Escape listener in the topics
 * overlay was only removed when Escape itself was pressed, so closing any other
 * way leaked a document-level keydown handler for the life of the page.
 */
(function (root) {
    'use strict';

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
