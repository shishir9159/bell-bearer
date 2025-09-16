/**
 * Wires the Appearance section's skin picker.
 *
 * Additive on purpose: dashboard.js does not need to know skins exist. The
 * picker writes through BB.Skin, and BB.Skin.install() (already running from
 * the page's own boot) repaints every open surface.
 */
(function () {
    'use strict';

    const BB = (window.BB = window.BB || {});

    function mark(picker, active) {
        picker.querySelectorAll('.skin-option').forEach((option) => {
            option.setAttribute('aria-pressed', String(option.dataset.skinId === active));
        });
    }

    async function install() {
        const picker = document.getElementById('skinPicker');
        if (!picker || !BB.Skin) return;

        mark(picker, (await BB.Skin.read()) || BB.Skin.DEFAULT);

        picker.addEventListener('click', async (event) => {
            const option = event.target.closest('.skin-option');
            if (!option) return;
            const chosen = await BB.Skin.select(option.dataset.skinId);
            mark(picker, chosen);
            if (BB.Ui && BB.Ui.toast) BB.Ui.toast(`Skin: ${option.querySelector('.skin-name').textContent}`, 'info');
        });
    }

    BB.SkinPicker = { install };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install, { once: true });
    } else {
        install();
    }
})();
