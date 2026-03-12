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
        const hasPouch = () => !!(actions.canOpenPouch && actions.canOpenPouch());
        // Only on a Shorts page: the arrows are the page's everywhere else,
        // the watch page's own ±5s seek included.
        const onShorts = () => feature('shortsSeek')() && !!(actions.onShorts && actions.onShorts());
        // Only on a Netflix episode: J, K and L are letters everywhere else,
        // Netflix's own search box included — though that is a typing target
        // and never reaches here.
        const onNetflix = () => feature('netflixSeekKeys')() && !!(actions.onNetflixEpisode && actions.onNetflixEpisode());

        const rows = [
            ['skim-find', { enabled: feature('skimMode'), run: () => actions.openSkim('page') }],
            ['skim-history', { enabled: feature('skimMode'), run: () => actions.openSkim('history') }],
            ['skim-actions', { enabled: feature('skimMode'), run: () => actions.openSkim('actions') }],
            ['link-hints', { enabled: feature('linkHints'), run: () => actions.openHints() }],
            // Also gated on there being a pouch to open: the binding is
            // `general` scope, so it is matched on every site, and on a site
            // with no pouch surface the key has to go back to the page —
            // a bare Shift+P must stay a capital P on a site we do nothing on.
            ['open-pouch', {
                enabled: () => feature('pouchShortcut')() && hasPouch(),
                run: () => actions.openPouch(),
            }],
            ['copy-page-link', { enabled: () => true, run: () => actions.copyPageLink() }],

            ['record-checkpoint', { noRepeat: true, enabled: canRecord, run: () => actions.startRecording() }],
            ['segment-toggle', { noRepeat: true, enabled: canRecord, run: () => actions.toggleSegment() }],
            ['skip-forward', { enabled: hasVideo, run: (e) => actions.skip(digitOf(e)) }],
            ['skip-backward', { enabled: hasVideo, run: (e) => actions.skip(-digitOf(e)) }],
            ['speed-boost', { enabled: hasVideo, run: (e) => actions.boostSpeed(digitOf(e)) }],
            ['speed-up', { enabled: hasVideo, run: () => actions.faster() }],
            ['speed-down', { enabled: hasVideo, run: () => actions.slower() }],
            ['speed-reset', { enabled: hasVideo, run: () => actions.resetSpeed() }],
            // The video reader on YouTube, which needs a video; the text
            // reader on any other page, which needs only a page.
            ['reader-mode', { noRepeat: true, enabled: () => (actions.canRead ? actions.canRead() : canRecord()), run: () => actions.toggleReader && actions.toggleReader() }],
            ['shorts-back', { enabled: onShorts, run: () => actions.shortsSkip(-1) }],
            ['shorts-forward', { enabled: onShorts, run: () => actions.shortsSkip(1) }],
            ['netflix-back', { enabled: onNetflix, run: () => actions.netflixStep(-1) }],
            ['netflix-play', { noRepeat: true, enabled: onNetflix, run: () => actions.netflixTogglePlay() }],
            ['netflix-forward', { enabled: onNetflix, run: () => actions.netflixStep(1) }],
        ];

        return rows.map(([name, row]) => {
            // A 'double' binding matches each press of its key; install()
            // counts them. A key held down auto-repeats well inside the
            // double-tap window, and that is one press, not two.
            const double = Keybindings.resolve(null, name).kind === 'double';
            return {
                name,
                double,
                match: (e) => {
                    if ((row.noRepeat || double) && e.repeat) return false;
                    const shortcut = getShortcut(name);
                    return !!shortcut && shortcut.enabled && Keybindings.matches(e, shortcut.combo, shortcut.kind);
                },
                enabled: row.enabled,
                run: row.run,
            };
        });
    }

    /**
     * Install the keyboard handling. Returns a function that removes it.
     */
    function install(actions, options = {}) {
        const bindings = createBindings(actions, options);
        // While one of our own overlays is up it owns the keyboard, down to
        // the bare letters a hint label is made of. Without this the
        // dispatcher, which is registered first, would run a shortcut for
        // the character being typed at a hint.
        const paused = options.paused || (() => false);
        const now = options.now || (() => performance.now());

        // The first press of a 'double' binding, waiting for its second:
        // { name, at }. Any other keystroke in between ends the wait, so
        // `y`, `a`, `y` is three keys and not a double tap.
        let tapped = null;

        const onKeyDown = (event) => {
            if (paused() || isTypingTarget(event)) {
                tapped = null;
                return;
            }
            // Not a keystroke yet, and it must not end the wait either: a
            // double tap rebound to Shift+Y has Shift going down between.
            if (Keybindings.isModifier(event)) return;

            const first = tapped;
            tapped = null;

            for (const binding of bindings) {
                if (!binding.match(event)) continue;
                if (!binding.enabled()) return; // matched but switched off: leave the key alone

                if (binding.double && !(first && first.name === binding.name &&
                    now() - first.at <= Keybindings.DOUBLE_TAP_MS)) {
                    // The first press is left to the page, untouched: it
                    // may be all there is, and a page's own single-key
                    // shortcut has to go on working.
                    tapped = { name: binding.name, at: now() };
                    return;
                }

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

        // On `window`, not `document`, and in the capture phase — which is
        // the very first point a keystroke can be seen. A site that binds its
        // own hotkey with `window.addEventListener('keydown', fn, true)` was
        // otherwise ahead of us: Shift+L reached the page's plain-L handler
        // and ran it, because a capture listener on document cannot stop one
        // that has already fired on window. Everything the dispatcher claims
        // now stops there.
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', onInterrupt);
        document.addEventListener('visibilitychange', onInterrupt);

        return function uninstall() {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', onInterrupt);
            document.removeEventListener('visibilitychange', onInterrupt);
        };
    }

    const Shortcuts = { install, createBindings, isTypingTarget, digitOf };

    root.BB = root.BB || {};
    root.BB.Shortcuts = Shortcuts;
    if (typeof module !== 'undefined' && module.exports) module.exports = Shortcuts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
