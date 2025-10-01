/**
 * Keyboard shortcuts.
 *
 * Which keys each shortcut uses, and whether it is on, comes from
 * src/shared/keybindings.js and the user's `shortcuts` setting; this file
 * pairs each one with what it does.
 *
 * Two behaviours are load-bearing:
 *
 *  - Handled keys call stopImmediatePropagation(). YouTube binds `<` and `>` to
 *    its own speed control, and preventDefault() does not stop a listener — so
 *    one press used to run our step *and* YouTube's, landing on a rate neither
 *    ladder contains. That is the main reason speed up/down "sometimes" jumped
 *    two steps or appeared to do nothing.
 *  - Nothing is handled while the user is typing. The script runs on every
 *    site, so a bare `>` must stay a `>` inside a comment box — including one
 *    inside shadow DOM, which is why the check walks composedPath().
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Keybindings = ns.Keybindings || req('../shared/keybindings.js');

    /** Elements that own the keystroke: typing in them must never be hijacked. */
    const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

    function isTypingTarget(event) {
        const path = (event.composedPath && event.composedPath()) || [event.target];
        for (const node of path) {
            if (!node || node.nodeType !== 1) continue;
            if (TYPING_TAGS.has(node.tagName)) return true;
            if (node.isContentEditable) return true;
            const role = node.getAttribute && node.getAttribute('role');
            if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
            if (node.tagName === 'BODY') break;
        }
        return false;
    }

    const { digitOf } = Keybindings;

    /**
     * Build the keydown bindings.
     *
     * `actions` supplies the behaviour. `options.getShortcut(id)` returns the
     * resolved binding — Keybindings.resolve over the user's `shortcuts`
     * setting — and is read on every keystroke, so a change in Settings
     * applies without reloading the page. Without it, the defaults apply.
     *
     * Modifiers match exactly, which is what keeps Alt+1 and Ctrl+Alt+1 from
     * both firing "skip forward".
     */
    function createBindings(actions, options = {}) {
        const canRecord = options.canRecord || (() => false);
        const getShortcut = options.getShortcut || ((id) => Keybindings.resolve(null, id));
        const hasVideo = () => actions.hasVideo();

        // Held or toggled bindings ignore auto-repeat: holding Ctrl+B must not
        // restart the recording, and a held Ctrl+Shift+S must not flip the
        // segment on and off.
        // A shortcut whose feature is switched off is matched and then left
        // alone — `enabled` false means the key goes back to the page, which
        // is what a bare Shift+F must do when Skim is not turned on.
        const feature = (name) => () => !!(actions.featureOn && actions.featureOn(name));

        const rows = [
            ['skim-find', { enabled: feature('skimMode'), run: () => actions.openSkim('page') }],
            ['skim-history', { enabled: feature('skimMode'), run: () => actions.openSkim('history') }],
            ['skim-actions', { enabled: feature('skimMode'), run: () => actions.openSkim('actions') }],
            ['link-hints', { enabled: feature('linkHints'), run: () => actions.openHints() }],

            ['record-checkpoint', { noRepeat: true, enabled: canRecord, run: () => actions.startRecording() }],
            ['segment-toggle', { noRepeat: true, enabled: canRecord, run: () => actions.toggleSegment() }],
            ['skip-forward', { enabled: hasVideo, run: (e) => actions.skip(digitOf(e)) }],
            ['skip-backward', { enabled: hasVideo, run: (e) => actions.skip(-digitOf(e)) }],
            ['speed-boost', { enabled: hasVideo, run: (e) => actions.boostSpeed(digitOf(e)) }],
            ['speed-up', { enabled: hasVideo, run: () => actions.faster() }],
            ['speed-down', { enabled: hasVideo, run: () => actions.slower() }],
            ['speed-reset', { enabled: hasVideo, run: () => actions.resetSpeed() }],
        ];

        return rows.map(([name, row]) => ({
            name,
            match: (e) => {
                if (row.noRepeat && e.repeat) return false;
                const shortcut = getShortcut(name);
                return !!shortcut && shortcut.enabled && Keybindings.matches(e, shortcut.combo, shortcut.kind);
            },
            enabled: row.enabled,
            run: row.run,
        }));
    }

    /**
     * Install the keyboard handling. Returns a function that removes it.
     */
    function install(actions, options = {}) {
        const bindings = createBindings(actions, options);

        const onKeyDown = (event) => {
            if (isTypingTarget(event)) return;

            for (const binding of bindings) {
                if (!binding.match(event)) continue;
                if (!binding.enabled()) return; // matched but switched off: leave the key alone

                event.preventDefault();
                // Stop the page's own handler for this key. Without it YouTube
                // also acts on `<` / `>` and the two ladders fight.
                event.stopImmediatePropagation();
                binding.run(event);
                return;
            }
        };

        // Releasing the checkpoint key ends the held checkpoint. Matched by
        // physical key, so a Shift held alongside it cannot stop the release
        // from being recognised.
        const getShortcut = options.getShortcut || ((id) => Keybindings.resolve(null, id));
        const onKeyUp = (event) => {
            const shortcut = getShortcut('record-checkpoint');
            if (shortcut && event.code && event.code === shortcut.combo.code) actions.stopRecording();
        };

        // A held Ctrl+B whose keyup lands on another window would otherwise
        // leave the recording indicator up for good.
        const onInterrupt = () => actions.stopRecording();

        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', onInterrupt);
        document.addEventListener('visibilitychange', onInterrupt);

        return function uninstall() {
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', onInterrupt);
            document.removeEventListener('visibilitychange', onInterrupt);
        };
    }

    const Shortcuts = { install, createBindings, isTypingTarget, digitOf };

    root.BB = root.BB || {};
    root.BB.Shortcuts = Shortcuts;
    if (typeof module !== 'undefined' && module.exports) module.exports = Shortcuts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
