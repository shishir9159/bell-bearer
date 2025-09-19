/**
 * The interactive keycap layout in Settings → General Keyboard Shortcuts.
 *
 * The layout (rows, key widths, which keys carry an icon) matches a keyboard
 * design the user supplied; only the skin — CSS variables instead of the
 * original's hard-coded palette — and the icon source — src/shared/feather-icons.js,
 * fetched once from the feather-icons package rather than loaded from a CDN,
 * since an extension page's CSP will not run a remote script — are ours.
 *
 * "Interactive" here means every key answers a click: the ones bound to an
 * actual Bell Bearer shortcut say what they do, and the rest say plainly that
 * they are not bound to anything. A settings page has no video to seek and no
 * page to apply a shortcut to, so a click is a lookup, not a keypress.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const FeatherIcons = ns.FeatherIcons || req('../shared/feather-icons.js');

    const NO_SHORTCUT = 'No shortcut assigned yet.';

    const SHIFT_TIP = 'Shift — hold with a number key to skip backward, or with F for hop mode.';
    const MOD_TIP = "A modifier key. Bell Bearer's shortcuts that use one: Ctrl+Shift+1-9 and Ctrl+Shift+L.";

    /** What each key id means, for the tooltip a click opens. */
    const TIPS = {
        gt: 'Increase playback speed.',
        lt: 'Decrease playback speed.',
        plus: 'Reset playback speed to 1x.',
        markdown: 'Ctrl+Shift+L — copy this page as a Markdown link.',
        hop: 'Shift+F — enter hop mode. (Placeholder — not wired up yet.)',
        shift: SHIFT_TIP,
        mod: MOD_TIP,
        esc: 'Closes an open Bell Bearer panel or dialog.',
    };
    for (let n = 1; n <= 9; n++) {
        TIPS[String(n)] =
            `Alt+${n} — skip forward ${n}s. Shift+${n} — skip back ${n}s. Ctrl+Shift+${n} — 3x speed for ${n}s.`;
    }

    /**
     * One row per array. `label`/`sub` draw a two-line legend the way a
     * physical keycap prints a shifted symbol above its base one; `icon`
     * draws a Feather glyph instead. `id` looks the key up in TIPS — keys
     * without one just say they are not bound to anything.
     */
    const ROWS = [
        [
            { icon: 'x', cls: 'key__esc', id: 'esc' },
            { label: '!', sub: '1', id: '1' }, { label: '@', sub: '2', id: '2' },
            { label: '#', sub: '3', id: '3' }, { label: '$', sub: '4', id: '4' },
            { label: '%', sub: '5', id: '5' }, { label: '^', sub: '6', id: '6' },
            { label: '&', sub: '7', id: '7' }, { label: '*', sub: '8', id: '8' },
            { label: '(', sub: '9', id: '9' }, { label: ')', sub: '0' },
            { label: '_', sub: '-' }, { label: '+', sub: '=', id: 'plus' },
            { icon: 'delete', cls: 'key__delete' },
        ],
        [
            { icon: 'log-in', cls: 'key__oneandhalf' },
            { label: 'Q' }, { label: 'W' }, { label: 'E' }, { label: 'R' }, { label: 'T' },
            { label: 'Y' }, { label: 'U' }, { label: 'I' }, { label: 'O' }, { label: 'P' },
            { label: '{', sub: '[' }, { label: '}', sub: ']' },
            { label: '|', sub: '\\', cls: 'key__oneandhalf' },
        ],
        [
            { icon: 'meh', cls: 'key__caps' },
            { label: 'A' }, { label: 'S' }, { label: 'D' }, { label: 'F', id: 'hop' }, { label: 'G' },
            { label: 'H' }, { label: 'J' }, { label: 'K' }, { label: 'L', id: 'markdown' },
            { label: ':', sub: ';' }, { label: '"', sub: '\'' },
            { icon: 'corner-down-left', cls: 'key__enter' },
        ],
        [
            { icon: 'arrow-up-circle', cls: 'key__shift-left', id: 'shift' },
            { label: 'Z' }, { label: 'X' }, { label: 'C' }, { label: 'V' }, { label: 'B' },
            { label: 'N' }, { label: 'M' },
            { label: '>', sub: '.', id: 'gt' }, { label: '<', sub: '.', id: 'lt' }, { label: '?', sub: '/' },
            { icon: 'arrow-up-circle', id: 'shift' },
            { icon: 'arrow-up', cls: 'key__arrow' },
            { icon: 'trash-2' },
        ],
        [
            { label: '^', cls: 'key__bottom-funct', id: 'mod' },
            { icon: 'activity', cls: 'key__bottom-funct', id: 'mod' },
            { icon: 'command', cls: 'key__bottom-funct', id: 'mod' },
            { cls: 'key__spacebar' },
            { icon: 'command', id: 'mod' },
            { icon: 'activity', id: 'mod' },
            { icon: 'arrow-left', cls: 'key__arrow' },
            { icon: 'arrow-down', cls: 'key__arrow' },
            { icon: 'arrow-right', cls: 'key__arrow' },
        ],
    ];

    function keyEl(spec) {
        const key = document.createElement('div');
        key.className = 'kbd-key' + (spec.cls ? ' ' + spec.cls : '');
        key.tabIndex = 0;
        key.setAttribute('role', 'button');

        if (spec.icon) {
            key.innerHTML = FeatherIcons.svg(spec.icon, 16);
        } else if (spec.sub) {
            key.innerHTML = `${spec.label}<span class="kbd-sub">${spec.sub}</span>`;
        } else if (spec.label) {
            key.textContent = spec.label;
        }

        const tip = TIPS[spec.id] || NO_SHORTCUT;
        key.setAttribute('aria-label', (spec.label || spec.icon || 'key') + ': ' + tip);
        return { key, tip };
    }

    /**
     * One shared tooltip bubble, moved to whichever key was clicked, rather
     * than one per key — a keyboard this size is 60-odd elements, and only
     * ever one tip is open at a time.
     */
    function createTooltip(root) {
        const bubble = document.createElement('div');
        bubble.className = 'kbd-tip';
        bubble.hidden = true;
        root.appendChild(bubble);

        let hideTimer = 0;
        return {
            show(target, text) {
                clearTimeout(hideTimer);
                bubble.textContent = text;
                bubble.hidden = false;

                const hostRect = root.getBoundingClientRect();
                const keyRect = target.getBoundingClientRect();
                bubble.style.left = Math.max(0, keyRect.left - hostRect.left) + 'px';
                bubble.style.top = (keyRect.top - hostRect.top - bubble.offsetHeight - 8) + 'px';

                hideTimer = setTimeout(() => { bubble.hidden = true; }, 3200);
            },
        };
    }

    /** Draw the keyboard into `container`, replacing whatever was there. */
    function mount(container) {
        if (!container) return;
        container.innerHTML = '';
        container.classList.add('kbd-widget');

        const tooltip = createTooltip(container);

        ROWS.forEach((row) => {
            const rowEl = document.createElement('div');
            rowEl.className = 'kbd-row';

            row.forEach((spec) => {
                const { key, tip } = keyEl(spec);
                const press = () => {
                    key.classList.add('is-active');
                    setTimeout(() => key.classList.remove('is-active'), 150);
                    tooltip.show(key, tip);
                };
                key.addEventListener('click', press);
                key.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        press();
                    }
                });
                rowEl.appendChild(key);
            });

            container.appendChild(rowEl);
        });
    }

    const KeyboardWidget = { mount };

    root.BB = root.BB || {};
    root.BB.KeyboardWidget = KeyboardWidget;
    if (typeof module !== 'undefined' && module.exports) module.exports = KeyboardWidget;
})(typeof globalThis !== 'undefined' ? globalThis : this);
