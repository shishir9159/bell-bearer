/**
 * A small, shared color palette and the color math that goes with it.
 *
 * Nothing uses it yet; it is here for the next feature that wants a
 * user-chosen color — store a hex string in a setting, draw with rgba().
 */
(function (root) {
    'use strict';

    const SWATCHES = Object.freeze([
        { id: 'ember', label: 'Ember', hex: '#e8590c' },
        { id: 'gold', label: 'Gold', hex: '#f2b705' },
        { id: 'lime', label: 'Lime', hex: '#74b816' },
        { id: 'jade', label: 'Jade', hex: '#12b886' },
        { id: 'sky', label: 'Sky', hex: '#1c9bef' },
        { id: 'indigo', label: 'Indigo', hex: '#4c6ef5' },
        { id: 'violet', label: 'Violet', hex: '#9c36b5' },
        { id: 'rose', label: 'Rose', hex: '#e64980' },
        { id: 'red', label: 'Red', hex: '#e03131' },
        { id: 'ink', label: 'Ink', hex: '#212529' },
    ]);

    const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

    function isHex(value) {
        return typeof value === 'string' && HEX.test(value);
    }

    /** '#abc' or '#aabbcc' → { r, g, b }, or null. */
    function hexToRgb(hex) {
        if (!isHex(hex)) return null;
        let digits = hex.slice(1);
        if (digits.length === 3) digits = digits.split('').map((d) => d + d).join('');
        const n = parseInt(digits, 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function rgba(hex, alpha = 1) {
        const rgb = hexToRgb(hex);
        if (!rgb) return '';
        const a = Math.max(0, Math.min(1, Number(alpha)));
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
    }

    /** '#000' or '#fff', whichever reads better on `hex` (WCAG relative luminance). */
    function readableOn(hex) {
        const rgb = hexToRgb(hex);
        if (!rgb) return '#000000';
        const lin = (c) => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        const luminance = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
        return luminance > 0.4 ? '#000000' : '#ffffff';
    }

    function find(hex) {
        if (!isHex(hex)) return null;
        const wanted = hex.toLowerCase();
        return SWATCHES.find((swatch) => swatch.hex === wanted) || null;
    }

    const Palette = { SWATCHES, isHex, hexToRgb, rgba, readableOn, find };

    root.BB = root.BB || {};
    root.BB.Palette = Palette;
    if (typeof module !== 'undefined' && module.exports) module.exports = Palette;
})(typeof globalThis !== 'undefined' ? globalThis : this);
