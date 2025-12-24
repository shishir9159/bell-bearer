/**
 * Link hints — Shift+L labels everything in view you could click, and typing
 * a label activates it.
 *
 * A link opens in a tab beside the one you are on, which is the whole point:
 * the page you are reading stays where it is and the thing you picked is
 * next to it rather than at the far end of the strip. Anything that is not a
 * link — a button, a field, a summary — is simply clicked or focused where
 * it stands, because there is nowhere else for it to go.
 *
 * Labels are placed from a snapshot of where things were when Shift+L was
 * pressed, so they go stale the moment the page moves under them. Rather
 * than chase every target with a rAF loop, hint mode ends on the first
 * scroll — pressing it again is one keystroke, and a label pointing at the
 * wrong thing is worse than no label at all. Escape ends it too, and so does
 * a click, a resize, or the tab going away.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Skim = ns.Skim || req('../shared/skim.js');
    const Dom = ns.Dom || req('../shared/dom.js');

    const LAYER_ID = 'bb-hints';
    const FLASH_MS = 440;

    /** What counts as a target. Anything drawn, in view, and big enough to hit. */
    const TARGETS = [
        'a[href]', 'button', 'summary', 'input:not([type="hidden"])', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="checkbox"]',
        '[contenteditable="true"]', '[onclick]',
    ].join(',');

    // No raw-text fallback for a missing Dom; see skim.js.
    const esc = (text) => Dom.escapeHtml(text);

    /**
     * @param {object} deps
     * @param {(url: string) => Promise<object>} deps.openLink  hand a link to the worker
     */
    function createLinkHints({ openLink }) {
        let layer = null;
        let status = null;
        let hints = [];
        let typed = '';
        let active = false;

        function visibleTargets() {
            const width = window.innerWidth;
            const height = window.innerHeight;
            return Array.from(document.querySelectorAll(TARGETS)).filter((element) => {
                if (element.disabled || element.closest(`#${LAYER_ID}, #bb-skim`)) return false;
                const box = element.getBoundingClientRect();
                if (box.width < 5 || box.height < 5) return false;
                if (box.bottom < 4 || box.top > height - 4) return false;
                if (box.right < 4 || box.left > width - 4) return false;
                const style = getComputedStyle(element);
                return style.visibility !== 'hidden' && style.display !== 'none';
            });
        }

        /** What the label is for, for the status line and the toast after it. */
        function nameOf(element) {
            const text = (element.getAttribute('aria-label') || element.textContent || '')
                .trim().replace(/\s+/g, ' ');
            if (text) return text.slice(0, 52);
            return (element.getAttribute('title') || element.tagName.toLowerCase()).slice(0, 52);
        }

        function build() {
            layer = document.createElement('div');
            layer.id = LAYER_ID;
            layer.className = 'bb-themed bb-hints';
            layer.innerHTML = '<div class="bb-hints-marks"></div><div class="bb-hints-bar"></div>';
            document.documentElement.append(layer);
            status = layer.querySelector('.bb-hints-bar');
        }

        function draw() {
            const shown = hints.filter((hint) => hint.label.startsWith(typed));
            layer.querySelector('.bb-hints-marks').innerHTML = shown.map((hint) => `
                <span class="bb-hint" style="left:${hint.x}px;top:${hint.y}px">
                    <b>${esc(hint.label.slice(0, typed.length))}</b>${esc(hint.label.slice(typed.length))}
                </span>`).join('');

            const count = `${shown.length} target${shown.length === 1 ? '' : 's'}`;
            status.innerHTML = `
                <span class="bb-hints-title">Hints</span>
                <span>${count}${typed ? ` · typed “${esc(typed)}”` : ''}</span>
                <span class="bb-hints-note">a link opens in a tab beside this one</span>
                <span class="bb-hints-note">esc cancel</span>`;
        }

        function type(next) {
            const matches = hints.filter((hint) => hint.label.startsWith(next));
            // A key that matches nothing clears back to the full board rather
            // than ending hint mode — a typo should cost one keystroke.
            if (!matches.length) {
                typed = '';
                draw();
                return;
            }
            if (matches.length === 1 && matches[0].label === next) {
                fire(matches[0]);
                return;
            }
            typed = next;
            draw();
        }

        async function fire(hint) {
            const element = hint.element;
            stop();
            if (!element || !element.isConnected) return;

            element.classList.add('bb-hint-flash');
            setTimeout(() => element.classList.remove('bb-hint-flash'), FLASH_MS);

            // Only a real navigable link becomes a tab. A javascript: or
            // in-page anchor does its work here, on this page, like a click.
            const href = element.tagName === 'A' ? element.href : '';
            if (href && /^https?:/i.test(href) && !href.startsWith(`${location.href.split('#')[0]}#`)) {
                await openLink(href);
                return;
            }
            if (typeof element.focus === 'function' &&
                /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) {
                element.focus();
                return;
            }
            element.click();
        }

        function onKey(event) {
            if (!active) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                stop();
                return;
            }
            if (event.key === 'Backspace') {
                event.preventDefault();
                event.stopImmediatePropagation();
                typed = typed.slice(0, -1);
                draw();
                return;
            }
            if (/^[a-z]$/i.test(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.preventDefault();
                event.stopImmediatePropagation();
                type(typed + event.key.toLowerCase());
            }
        }

        const onScroll = () => stop();

        function start() {
            if (active) return stop();
            if (!layer) build();

            const elements = visibleTargets();
            if (!elements.length) return;

            const labels = Skim.hintLabels(elements.length);
            hints = elements.map((element, index) => {
                const box = element.getBoundingClientRect();
                return {
                    element,
                    label: labels[index],
                    name: nameOf(element),
                    // Tagged at the top-left corner, just outside it, so the
                    // target itself stays readable under its own label.
                    x: Math.max(2, Math.round(box.left - 6)),
                    y: Math.max(2, Math.round(box.top - 8)),
                };
            });

            typed = '';
            active = true;
            layer.classList.add('is-on');
            draw();

            // At `window`, in the capture phase, for the same reason the
            // shortcut dispatcher is: a site that binds a bare letter with a
            // capture listener on window would otherwise run its own hotkey
            // for the character being typed at a hint.
            window.addEventListener('keydown', onKey, true);
            window.addEventListener('scroll', onScroll, true);
            window.addEventListener('resize', onScroll);
            window.addEventListener('blur', onScroll);
            document.addEventListener('mousedown', onScroll, true);
        }

        function stop() {
            if (!active) return;
            active = false;
            typed = '';
            hints = [];
            if (layer) {
                layer.classList.remove('is-on');
                // Cleared, not merely hidden: the labels point at where
                // things were, and the next Shift+L measures again anyway.
                layer.querySelector('.bb-hints-marks').innerHTML = '';
            }
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
            window.removeEventListener('blur', onScroll);
            document.removeEventListener('mousedown', onScroll, true);
        }

        /** Repaint in the current skin before the labels go up. */
        function dress(look) {
            if (!layer) build();
            layer.dataset.bbTheme = look.theme;
            layer.dataset.bbSkin = look.skin;
        }

        return { start, stop, dress, isOn: () => active };
    }

    const LinkHints = { createLinkHints, TARGETS };

    root.BB = root.BB || {};
    root.BB.LinkHints = LinkHints;
    if (typeof module !== 'undefined' && module.exports) module.exports = LinkHints;
})(typeof globalThis !== 'undefined' ? globalThis : this);
