/**
 * A row of color swatches bound to one setting — the settings-page half of
 * src/shared/palette.js.
 *
 * The stored value is a hex string, or '' for "leave the site's own color
 * alone". A native color input at the end covers anything the palette lacks;
 * picking a color there that happens to be a palette swatch lights that
 * swatch, so the row never shows two different selections for one value.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('../shared/settings.js');
    const Palette = ns.Palette || req('../shared/palette.js');
    const Dom = ns.Dom || req('../shared/dom.js');

    function mount(container, { key, swatches = Palette.SWATCHES, defaultLabel = 'Site default' }) {
        if (!container) return () => {};

        container.classList.add('swatch-picker');
        container.setAttribute('role', 'group');

        container.innerHTML = `
            <button type="button" class="swatch swatch-default" data-hex="" title="${Dom.escapeAttr(defaultLabel)}"
                    aria-label="${Dom.escapeAttr(defaultLabel)}"><span>${Dom.escapeHtml(defaultLabel)}</span></button>
            ${swatches.map((swatch) => `
                <button type="button" class="swatch" data-hex="${Dom.escapeAttr(swatch.hex)}"
                        style="--swatch:${Dom.escapeAttr(swatch.hex)}"
                        title="${Dom.escapeAttr(swatch.label)}" aria-label="${Dom.escapeAttr(swatch.label)}"></button>`).join('')}
            <label class="swatch swatch-custom" title="Custom color">
                <input type="color" aria-label="Custom color">
            </label>`;

        const custom = container.querySelector('.swatch-custom');
        const input = custom.querySelector('input');

        function show(value) {
            const hex = Palette.isHex(value) ? value.toLowerCase() : '';
            const inPalette = hex === '' || !!Palette.find(hex);
            container.querySelectorAll('button.swatch').forEach((button) => {
                button.setAttribute('aria-pressed', String(button.dataset.hex === hex));
            });
            custom.classList.toggle('is-selected', !inPalette);
            custom.style.setProperty('--swatch', inPalette ? 'transparent' : hex);
            if (hex) input.value = hex;
        }

        const choose = (hex) => {
            show(hex);
            Settings.set({ [key]: hex });
        };

        container.addEventListener('click', (event) => {
            const button = event.target.closest('button.swatch');
            if (button) choose(button.dataset.hex);
        });
        input.addEventListener('change', () => choose(input.value.toLowerCase()));

        Settings.get([key]).then((values) => show(values[key]));
        return Settings.watch([key], (changed) => show(changed[key]));
    }

    const SwatchPicker = { mount };

    root.BB = root.BB || {};
    root.BB.SwatchPicker = SwatchPicker;
    if (typeof module !== 'undefined' && module.exports) module.exports = SwatchPicker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
