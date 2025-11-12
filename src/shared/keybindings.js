/**
 * Every keyboard shortcut Bell Bearer has: its id, where it applies, what it
 * does and its default keys — plus how a keystroke is matched against one.
 *
 * The content scripts match keystrokes through here, and Settings lists,
 * turns off and rebinds from the same table, so the two can never disagree
 * about what a shortcut is. The user's changes live in the `shortcuts` setting
 * as `{ [id]: { enabled?: false, combo?: {...} } }`; anything not in there is
 * the default.
 *
 * A binding may also carry `needs`, the key of the setting that switches the
 * whole feature on. Skim and the link hints are off until Settings turns them
 * on, and a shortcut for something that is not running has no business on the
 * keyboard map or in the list — so `list()` drops them when it is given the
 * settings to check against.
 *
 * A combo is `{ ctrl, shift, alt, meta, code, key }`. Three kinds of binding:
 *  - 'key'     the modifiers must match exactly and `code` names the physical
 *              key, so a shortcut survives a keyboard layout change;
 *  - 'digit'   the modifiers must match and any of 1-9 completes it — the
 *              digit is the argument (seconds to skip, seconds to boost);
 *  - 'command' a browser-level command (manifest `commands`), which only the
 *              browser can rebind.
 * A default combo marked `char` matches by the character typed instead — `>`
 * is Shift+. on one layout and something else on another.
 */
(function (root) {
    'use strict';

    const SCOPES = Object.freeze({
        general: 'General', youtube: 'YouTube', chess: 'Chess.com', leetcode: 'LeetCode', typeracer: 'TypeRacer', chat: 'ChatGPT',
    });

    const BINDINGS = Object.freeze([
        { id: 'skim-find', scope: 'general', kind: 'key', needs: 'skimMode', label: 'Skim — find within this page', combo: { shift: true, code: 'KeyF', key: 'F' } },
        { id: 'skim-history', scope: 'general', kind: 'key', needs: 'skimMode', label: 'Skim — search browsing history', combo: { shift: true, code: 'KeyH', key: 'H' } },
        { id: 'skim-actions', scope: 'general', kind: 'key', needs: 'skimMode', label: 'Skim — search browser actions', combo: { shift: true, code: 'KeyA', key: 'A' } },
        { id: 'link-hints', scope: 'general', kind: 'key', needs: 'linkHints', label: 'Label every link for the keyboard', combo: { shift: true, code: 'KeyL', key: 'L' } },
        // General rather than a scope of its own: it is one key opening the
        // pouch, which YouTube, X and LeetCode each draw their own way — and
        // on a chat site the chat panel, which is that site's pouch. There is
        // no scope for "four sites", and hiding it under `youtube` would take
        // it off the keyboard map for most of the places it works.
        { id: 'open-pouch', scope: 'general', kind: 'key', needs: 'pouchShortcut', label: 'Open the pouch (YouTube, X and LeetCode) or the chat panel (ChatGPT)', combo: { shift: true, code: 'KeyP', key: 'P' } },
        { id: 'copy-markdown-link', scope: 'general', kind: 'command', label: 'Copy this page as a Markdown link', combo: { ctrl: true, shift: true, code: 'KeyL', key: 'L' } },

        { id: 'record-checkpoint', scope: 'youtube', kind: 'key', label: 'Create checkpoint (hold and release)', combo: { ctrl: true, code: 'KeyB', key: 'b' } },
        { id: 'segment-toggle', scope: 'youtube', kind: 'key', label: 'Mark a segment — press to start, again to end', combo: { ctrl: true, shift: true, code: 'KeyS', key: 'S' } },
        { id: 'skip-forward', scope: 'youtube', kind: 'digit', label: 'Skip forward by that many seconds', combo: { alt: true } },
        { id: 'skip-backward', scope: 'youtube', kind: 'digit', label: 'Skip backward by that many seconds', combo: { shift: true } },
        { id: 'speed-boost', scope: 'youtube', kind: 'digit', label: 'Temporary 3x speed boost for that many seconds', combo: { ctrl: true, shift: true } },
        { id: 'speed-up', scope: 'youtube', kind: 'key', label: 'Increase playback speed', combo: { shift: true, code: 'Period', key: '>', char: true } },
        { id: 'speed-down', scope: 'youtube', kind: 'key', label: 'Decrease playback speed', combo: { shift: true, code: 'Comma', key: '<', char: true } },
        { id: 'speed-reset', scope: 'youtube', kind: 'key', label: 'Reset playback speed to 1x', combo: { key: '+', char: true } },
        // Ctrl+Alt, the cluster chess and LeetCode already use: the bare-Shift
        // letters belong to Skim, and Ctrl+Shift+R is the browser's reload.
        { id: 'reader-mode', scope: 'youtube', kind: 'key', label: 'Open or close the distraction-free reader', combo: { ctrl: true, alt: true, code: 'KeyR', key: 'r' } },
        // Bare arrows, which is a large claim — but they are only ever
        // claimed on a Shorts page with the setting on. Everywhere else the
        // dispatcher matches them, sees the feature is not running here, and
        // hands the key straight back to the page. On Shorts YouTube itself
        // binds only ↑ and ↓, to change short.
        { id: 'shorts-back', scope: 'youtube', kind: 'key', needs: 'shortsSeek', label: 'Shorts — skip back', combo: { code: 'ArrowLeft', key: 'ArrowLeft' } },
        { id: 'shorts-forward', scope: 'youtube', kind: 'key', needs: 'shortsSeek', label: 'Shorts — skip forward', combo: { code: 'ArrowRight', key: 'ArrowRight' } },

        { id: 'chess-clear-arrows', scope: 'chess', kind: 'key', label: 'Clear every arrow drawn on the board', combo: { alt: true, code: 'KeyC', key: 'c' } },

        // Ctrl+Alt rather than the bare-Shift letters the rest of the page
        // shortcuts use: both of these are meant to work with the caret
        // inside LeetCode's editor, where a bare letter is a letter.
        { id: 'leet-templates', scope: 'leetcode', kind: 'key', label: 'Suggest a code template', combo: { ctrl: true, alt: true, code: 'KeyT', key: 't' } },
        { id: 'leet-mock', scope: 'leetcode', kind: 'key', label: 'Start a mock interview on this problem', combo: { ctrl: true, alt: true, code: 'KeyM', key: 'm' } },

        // Ctrl+Alt for the same reason as the two above, and more so: this
        // one fires with the caret inside the box you are racing in, where
        // every bare letter is a letter you meant to type.
        { id: 'typer-caret', scope: 'typeracer', kind: 'key', label: 'Cycle the typing caret style', combo: { ctrl: true, alt: true, code: 'KeyC', key: 'c' } },

        // Ctrl+Alt for the reason the two clusters above use it: these fire
        // with the caret in the chat's prompt box. conflicts() is checked
        // across every scope, so C, M, R and T were already taken. Not
        // Ctrl+Alt+arrows, which rotate the screen on a lot of Windows
        // laptops. The panel itself is Shift+P, the pouch key.
        { id: 'chat-next', scope: 'chat', kind: 'key', label: 'Jump to the next prompt', combo: { ctrl: true, alt: true, code: 'KeyJ', key: 'j' } },
        { id: 'chat-prev', scope: 'chat', kind: 'key', label: 'Jump to the previous prompt', combo: { ctrl: true, alt: true, code: 'KeyK', key: 'k' } },
    ]);

    const BY_ID = Object.freeze(Object.fromEntries(BINDINGS.map((binding) => [binding.id, binding])));

    const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

    /** 1-9 from either the number row or the numpad, else null. */
    function digitOf(event) {
        const match = /^(?:Digit|Numpad)([1-9])$/.exec((event && event.code) || '');
        return match ? Number(match[1]) : null;
    }

    function modifiersMatch(event, combo) {
        return !!event.ctrlKey === !!combo.ctrl && !!event.shiftKey === !!combo.shift &&
            !!event.altKey === !!combo.alt && !!event.metaKey === !!combo.meta;
    }

    function matches(event, combo, kind) {
        if (!event || !combo) return false;
        if (kind === 'digit') return modifiersMatch(event, combo) && digitOf(event) !== null;
        if (combo.char) {
            return !event.ctrlKey && !event.altKey && !event.metaKey &&
                (event.key === combo.key || (!!combo.code && event.shiftKey && event.code === combo.code));
        }
        return modifiersMatch(event, combo) && !!combo.code && event.code === combo.code;
    }

    /** A binding with the user's changes applied. */
    function resolve(overrides, id) {
        const binding = BY_ID[id];
        if (!binding) return null;
        const override = (overrides && overrides[id]) || {};
        return {
            ...binding,
            enabled: override.enabled !== false,
            combo: override.combo || binding.combo,
            custom: !!override.combo,
        };
    }

    /**
     * Is the feature behind this binding switched on? A binding with no
     * `needs` always is. Called without settings — which is every caller that
     * only wants the table — nothing is filtered out.
     */
    function available(binding, settings) {
        if (!binding || !binding.needs) return true;
        if (!settings) return true;
        return settings[binding.needs] === true;
    }

    function list(overrides, scope, settings) {
        return BINDINGS
            .filter((binding) => (!scope || binding.scope === scope) && available(binding, settings))
            .map((binding) => resolve(overrides, binding.id));
    }

    const CODE_LABELS = {
        Period: '.', Comma: ',', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
        Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Space: 'Space', Enter: 'Enter', Escape: 'Esc',
        Backspace: 'Backspace', Tab: 'Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    };

    function keyName(combo) {
        const code = combo.code || '';
        if (/^Key[A-Z]$/.test(code)) return code.slice(3);
        if (/^(Digit|Numpad)\d$/.test(code)) return code.slice(-1);
        if (CODE_LABELS[code]) return CODE_LABELS[code];
        if (code) return code;
        return String(combo.key || '?');
    }

    /** The keys as labels, e.g. ['Ctrl', 'Shift', '1-9']. */
    function parts(combo, kind) {
        if (!combo) return [];
        if (combo.char) return [combo.key];
        const out = [];
        if (combo.ctrl) out.push('Ctrl');
        if (combo.alt) out.push('Alt');
        if (combo.shift) out.push('Shift');
        if (combo.meta) out.push('Meta');
        out.push(kind === 'digit' ? '1-9' : keyName(combo));
        return out;
    }

    function format(combo, kind) {
        return parts(combo, kind).join(' + ');
    }

    /** Two combos that one keystroke could trigger both of share a signature. */
    function signature(combo, kind) {
        if (!combo) return '';
        if (combo.char) return `char:${combo.key}`;
        const mods = ['ctrl', 'alt', 'shift', 'meta'].filter((m) => combo[m]).join('+');
        const target = kind === 'digit' || digitOf(combo) !== null ? 'digit' : combo.code;
        return `${mods}|${target}`;
    }

    /**
     * Turn a keydown into a combo for `kind`, or `{ error }`. A lone modifier
     * press is `{ pending: true }` — the user is still holding keys down.
     */
    function record(event, kind) {
        if (MODIFIER_CODES.test(event.code || '') || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
            return { pending: true };
        }
        const combo = { ctrl: !!event.ctrlKey, alt: !!event.altKey, shift: !!event.shiftKey, meta: !!event.metaKey };
        const modified = combo.ctrl || combo.alt || combo.meta;

        if (kind === 'digit') {
            if (digitOf(event) === null) return { error: 'Hold the modifiers and press a number from 1 to 9' };
            if (!modified && !combo.shift) return { error: 'Number shortcuts need Ctrl, Alt or Shift, or they would fire while typing numbers' };
            return { combo };
        }

        if (!event.code) return { error: 'That key cannot be used' };
        return { combo: { ...combo, code: event.code, key: event.key } };
    }

    /** Other enabled bindings the same keystroke would also trigger. */
    function conflicts(overrides, id, combo) {
        const target = BY_ID[id];
        if (!target) return [];
        const mine = signature(combo, target.kind);
        return list(overrides)
            .filter((other) => other.id !== id && other.enabled && signature(other.combo, other.kind) === mine);
    }

    const Keybindings = {
        SCOPES, BINDINGS, digitOf, modifiersMatch, matches, resolve, list, available,
        parts, format, signature, record, conflicts,
    };

    root.BB = root.BB || {};
    root.BB.Keybindings = Keybindings;
    if (typeof module !== 'undefined' && module.exports) module.exports = Keybindings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
