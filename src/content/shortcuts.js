/**
 * Keyboard shortcuts.
 *
 * The bindings are a table rather than a run of `if` statements, so a new
 * shortcut is one row and a conflict is visible by reading down the list.
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

    /** 1-9 from either the number row or the numpad, else null. */
    function digitOf(event) {
        const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || '');
        return match ? Number(match[1]) : null;
    }

    /**
     * Exact modifier match. Requiring the full set (rather than only checking
     * the modifiers a binding cares about) is what keeps Alt+1 and Ctrl+Alt+1
     * from both firing "skip forward".
     */
    function modifiers(event, { ctrl = false, shift = false, alt = false } = {}) {
        return event.ctrlKey === ctrl && event.shiftKey === shift && event.altKey === alt && !event.metaKey;
    }

    /**
     * Build the keydown/keyup bindings.
     *
     * `actions` supplies the behaviour; `options.skipShortcutsEnabled()` gates
     * the skip/boost rows, matching the Settings toggle.
     */
    function createBindings(actions, options = {}) {
        const skipEnabled = options.skipShortcutsEnabled || (() => true);
        const canRecord = options.canRecord || (() => false);

        return [
            {
                name: 'record-checkpoint',
                // Held, not tapped: keyup ends the checkpoint. Repeats are
                // ignored so holding the key does not restart the recording.
                match: (e) => !e.repeat && modifiers(e, { ctrl: true }) && e.key.toLowerCase() === 'b',
                enabled: () => canRecord(),
                run: () => actions.startRecording(),
            },
            {
                name: 'segment-toggle',
                // A press marks the start, the next press marks the end. The
                // old binding set the start on keydown and ended it on keyup of
                // the same press, so a segment was always zero-length — nothing
                // ever bound the start, and the end handler was unreachable.
                match: (e) => !e.repeat && modifiers(e, { ctrl: true, shift: true }) && e.key.toLowerCase() === 's',
                enabled: () => canRecord(),
                run: () => actions.toggleSegment(),
            },
            {
                name: 'skip-forward',
                match: (e) => modifiers(e, { alt: true }) && digitOf(e) !== null,
                enabled: () => skipEnabled() && actions.hasVideo(),
                run: (e) => actions.skip(digitOf(e)),
            },
            {
                name: 'skip-backward',
                match: (e) => modifiers(e, { shift: true }) && digitOf(e) !== null,
                enabled: () => skipEnabled() && actions.hasVideo(),
                run: (e) => actions.skip(-digitOf(e)),
            },
            {
                name: 'speed-boost',
                match: (e) => modifiers(e, { ctrl: true, shift: true }) && digitOf(e) !== null,
                enabled: () => skipEnabled() && actions.hasVideo(),
                run: (e) => actions.boostSpeed(digitOf(e)),
            },
            {
                name: 'speed-up',
                // Shift+. produces ">" on most layouts, but not all; accept the
                // physical key too so the shortcut survives a different layout.
                match: (e) => !e.ctrlKey && !e.altKey && !e.metaKey &&
                    (e.key === '>' || (e.shiftKey && e.code === 'Period')),
                enabled: () => actions.hasVideo(),
                run: () => actions.faster(),
            },
            {
                name: 'speed-down',
                match: (e) => !e.ctrlKey && !e.altKey && !e.metaKey &&
                    (e.key === '<' || (e.shiftKey && e.code === 'Comma')),
                enabled: () => actions.hasVideo(),
                run: () => actions.slower(),
            },
            {
                name: 'speed-reset',
                match: (e) => !e.ctrlKey && !e.altKey && !e.metaKey && e.key === '+',
                enabled: () => actions.hasVideo(),
                run: () => actions.resetSpeed(),
            },
        ];
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

        // Releasing B ends the held checkpoint. Compared case-insensitively:
        // with Shift down the key is "B", and the old `=== 'b'` check meant the
        // recording indicator could never be dismissed.
        const onKeyUp = (event) => {
            if (event.key && event.key.toLowerCase() === 'b') actions.stopRecording();
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

    const Shortcuts = { install, createBindings, isTypingTarget, digitOf, modifiers };

    root.BB = root.BB || {};
    root.BB.Shortcuts = Shortcuts;
    if (typeof module !== 'undefined' && module.exports) module.exports = Shortcuts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
