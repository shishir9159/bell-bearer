/**
 * Settings → Keyboard Shortcuts: one keyboard, annotated, with a tab per scope.
 *
 * Built to the standalone design export, which is the live version of it. The
 * shape is a printed callout diagram rather than a list: every shortcut in the
 * scope you are on gets a label in the margin, and a leader line runs from that
 * label to the keycap it names. The lanes fill top first, then the two sides,
 * then the bottom, so a leader never has to cross the board to reach its key.
 *
 * Three things drive what is lit:
 *  - pointing at a label or a keycap focuses that shortcut and pushes the rest
 *    of the board back;
 *  - holding Ctrl, Shift or Alt lights what that modifier reaches;
 *  - clicking a bound keycap puts the shortcut into rebind mode — the cap lifts
 *    off the board, every other leader goes, and the next keystroke binds.
 *
 * Nothing about a binding is held here. The table is src/shared/keybindings.js
 * and the editing, conflict-checking and saving all belong to
 * src/page/shortcut-list.js — this asks that module to start an edit and
 * redraws when it says something changed. A label's position on the board is
 * worked out from the binding's own `combo.code`, so rebinding a shortcut moves
 * its label to the key it now sits on instead of leaving a stale annotation.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const FeatherIcons = BB.FeatherIcons || req('../shared/feather-icons.js');
    const Keybindings = BB.Keybindings || req('../shared/keybindings.js');
    const SiteIcons = BB.SiteIcons || req('../shared/site-icons.js');
    const Dom = BB.Dom || req('../shared/dom.js');

    const esc = (text) => (Dom ? Dom.escapeHtml(text) : String(text));

    /** Below this the side lanes have nowhere to go, so everything stacks. */
    const NARROW = 860;

    /**
     * One row per array, the design's own layout. `label`/`sub` draw a
     * two-line legend the way a physical keycap prints a shifted symbol above
     * its base one; `icon` draws a Feather glyph instead.
     *
     * `code` is the KeyboardEvent.code that cap sends, and it doubles as the
     * cap's id — that is what lets a binding find its own key without a
     * second table to keep in step. `mod` marks a modifier cap, which lights
     * whenever a shortcut that needs it is in play.
     */
    const ROWS = [
        [
            { icon: 'x', cls: 'key__esc', code: 'Escape' },
            { label: '!', sub: '1', code: 'Digit1' }, { label: '@', sub: '2', code: 'Digit2' },
            { label: '#', sub: '3', code: 'Digit3' }, { label: '$', sub: '4', code: 'Digit4' },
            { label: '%', sub: '5', code: 'Digit5' }, { label: '^', sub: '6', code: 'Digit6' },
            { label: '&', sub: '7', code: 'Digit7' }, { label: '*', sub: '8', code: 'Digit8' },
            { label: '(', sub: '9', code: 'Digit9' }, { label: ')', sub: '0', code: 'Digit0' },
            { label: '_', sub: '-', code: 'Minus' }, { label: '+', sub: '=', code: 'Equal' },
            { icon: 'delete', cls: 'key__delete', code: 'Backspace' },
        ],
        [
            { icon: 'log-in', cls: 'key__oneandhalf', code: 'Tab' },
            { label: 'Q', code: 'KeyQ' }, { label: 'W', code: 'KeyW' }, { label: 'E', code: 'KeyE' },
            { label: 'R', code: 'KeyR' }, { label: 'T', code: 'KeyT' }, { label: 'Y', code: 'KeyY' },
            { label: 'U', code: 'KeyU' }, { label: 'I', code: 'KeyI' }, { label: 'O', code: 'KeyO' },
            { label: 'P', code: 'KeyP' },
            { label: '{', sub: '[', code: 'BracketLeft' }, { label: '}', sub: ']', code: 'BracketRight' },
            { label: '|', sub: '\\', cls: 'key__oneandhalf', code: 'Backslash' },
        ],
        [
            { icon: 'meh', cls: 'key__caps', code: 'CapsLock' },
            { label: 'A', code: 'KeyA' }, { label: 'S', code: 'KeyS' }, { label: 'D', code: 'KeyD' },
            { label: 'F', code: 'KeyF' }, { label: 'G', code: 'KeyG' }, { label: 'H', code: 'KeyH' },
            { label: 'J', code: 'KeyJ' }, { label: 'K', code: 'KeyK' }, { label: 'L', code: 'KeyL' },
            { label: ':', sub: ';', code: 'Semicolon' }, { label: '"', sub: "'", code: 'Quote' },
            { icon: 'corner-down-left', cls: 'key__enter', code: 'Enter' },
        ],
        [
            { icon: 'arrow-up-circle', cls: 'key__shift-left', mod: 'shift' },
            { label: 'Z', code: 'KeyZ' }, { label: 'X', code: 'KeyX' }, { label: 'C', code: 'KeyC' },
            { label: 'V', code: 'KeyV' }, { label: 'B', code: 'KeyB' }, { label: 'N', code: 'KeyN' },
            { label: 'M', code: 'KeyM' },
            { label: '>', sub: '.', code: 'Period' }, { label: '<', sub: ',', code: 'Comma' },
            { label: '?', sub: '/', code: 'Slash' },
            // The right Shift is drawn but never lit. Two caps lighting for
            // one modifier reads as two different keys being asked for, and
            // the leader from the label only ever points at one of them.
            { icon: 'arrow-up-circle' },
            { icon: 'arrow-up', cls: 'key__arrow', code: 'ArrowUp' },
            { icon: 'trash-2', code: 'Delete' },
        ],
        [
            { label: '^', cls: 'key__bottom-funct', mod: 'ctrl' },
            { icon: 'activity', cls: 'key__bottom-funct', mod: 'alt' },
            { icon: 'command', cls: 'key__bottom-funct', mod: 'meta' },
            { cls: 'key__spacebar', code: 'Space' },
            { icon: 'command', mod: 'meta' },
            { icon: 'activity', mod: 'alt' },
            { icon: 'arrow-left', cls: 'key__arrow', code: 'ArrowLeft' },
            { icon: 'arrow-down', cls: 'key__arrow', code: 'ArrowDown' },
            { icon: 'arrow-right', cls: 'key__arrow', code: 'ArrowRight' },
        ],
    ];

    /** code → which row it is on, and the character its cap prints. */
    const CAPS = {};
    /** A printed character → the cap that prints it, for `char` combos. */
    const CHARS = {};
    ROWS.forEach((row, index) => {
        row.forEach((spec) => {
            if (!spec.code) return;
            CAPS[spec.code] = { row: index };
            [spec.label, spec.sub].forEach((mark) => {
                if (mark && !CHARS[mark]) CHARS[mark] = spec.code;
            });
        });
    });

    /** The scopes the tab strip offers, in order. */
    const SCOPES = [
        { id: 'general', name: 'Common', icon: 'keyboard' },
        { id: 'youtube', name: 'YouTube', site: 'youtube' },
        { id: 'chess', name: 'Chess.com', site: 'chess' },
        { id: 'lichess', name: 'Lichess', site: 'lichess' },
    ];

    const HINT = 'Click a key to rebind it; hold Ctrl, Shift or Alt to see what that modifier reaches.';
    const LICHESS_HINT = 'Lichess has no shortcuts of its own yet — the Chess.com bindings are shown here, '
        + 'and are not available on Lichess.';

    let host = null;
    let annot = null;
    let scope = 'general';
    let hover = null;
    let held = null; // { ctrl, alt, shift } while a modifier is down
    let listOpen = false;
    let narrow = false;
    let frame = 0;

    /** Lichess borrows the Chess.com table until it has one of its own. */
    const bindingScope = () => (scope === 'lichess' ? 'chess' : scope);

    const scopeName = () => (SCOPES.find((item) => item.id === scope) || SCOPES[0]).name;

    /**
     * The bindings on this tab. A shortcut whose feature is switched off is
     * not among them — the board is what the keyboard actually does right
     * now, so turning Skim on in Settings is what makes its keys appear here.
     */
    function shortcuts() {
        const list = BB.ShortcutList;
        const overrides = list ? list.overrides() : {};
        const features = list && list.features ? list.features() : null;
        return Keybindings.list(overrides, bindingScope(), features);
    }

    const editingId = () => (BB.ShortcutList ? BB.ShortcutList.editingId() : null);

    // --------------------------------------------------------- the board

    /** Which cap a binding points at, or null when it is not on this board. */
    function kidOf(shortcut) {
        if (shortcut.kind === 'digit') return 'digits';
        const combo = shortcut.combo || {};
        if (combo.code && CAPS[combo.code]) return combo.code;
        if (combo.key && CHARS[combo.key]) return CHARS[combo.key];
        return null;
    }

    const rowOf = (kid) => (kid === 'digits' ? 0 : (CAPS[kid] || { row: 0 }).row);

    /** "Ctrl + Shift — Mark a segment", the way a shared cap lists its modes. */
    function modName(shortcut) {
        const combo = shortcut.combo || {};
        const mods = [];
        if (combo.ctrl) mods.push('Ctrl');
        if (combo.alt) mods.push('Alt');
        if (combo.shift) mods.push('Shift');
        return mods.length ? `${mods.join(' + ')} — ${shortcut.label}` : shortcut.label;
    }

    /**
     * One label per cap. A cap carrying several shortcuts — one per modifier,
     * which is how the number row works — lists them under a single leader,
     * each on its own line named by the modifier that reaches it.
     */
    function labelData() {
        const byKid = new Map();
        const out = [];
        shortcuts().forEach((shortcut) => {
            const kid = kidOf(shortcut);
            if (!kid) return;
            const seen = byKid.get(kid);
            if (seen) {
                seen.ids.push(shortcut.id);
                seen.lines.push(modName(shortcut));
                return;
            }
            const entry = { kid, row: rowOf(kid), ids: [shortcut.id], lines: [], shortcut };
            byKid.set(kid, entry);
            out.push(entry);
        });
        out.forEach((entry) => {
            entry.id = entry.ids[0];
            entry.title = entry.ids.length > 1 ? modName(entry.shortcut) : entry.shortcut.label;
        });
        return out;
    }

    /** Where a cap sits inside the annotation box, or null if it is not drawn. */
    function capRect(kid) {
        if (!annot) return null;
        const box = annot.getBoundingClientRect();
        const local = (element) => {
            const rect = element.getBoundingClientRect();
            return {
                left: rect.left - box.left, right: rect.right - box.left,
                top: rect.top - box.top, bottom: rect.bottom - box.top,
            };
        };
        let bounds;
        if (kid === 'digits') {
            const first = annot.querySelector('[data-kid="Digit1"]');
            const last = annot.querySelector('[data-kid="Digit9"]');
            if (!first || !last) return null;
            const a = local(first);
            const b = local(last);
            bounds = { left: a.left, right: b.right, top: a.top, bottom: a.bottom };
        } else {
            const cap = annot.querySelector(`[data-kid="${kid}"]`);
            if (!cap) return null;
            bounds = local(cap);
        }
        return {
            ...bounds,
            cx: (bounds.left + bounds.right) / 2,
            cy: (bounds.top + bounds.bottom) / 2,
        };
    }

    /**
     * Lanes fill top first, then the sides, then the bottom: the number row is
     * annotated from above, the home row from whichever side its key is
     * nearer, the lower rows from below. Sorting each lane by the position of
     * its key is what keeps two leaders from crossing.
     */
    function laid() {
        const list = labelData();
        const at = {};
        list.forEach((entry) => {
            const rect = capRect(entry.kid);
            at[entry.kid] = rect || { cx: 0, cy: 0 };
        });
        const middle = annot ? annot.clientWidth / 2 : 500;
        list.forEach((entry) => {
            if (narrow) entry.lane = entry.row <= 2 ? 'top' : 'bottom';
            else if (entry.row <= 1) entry.lane = 'top';
            else if (entry.row === 2) entry.lane = at[entry.kid].cx < middle ? 'left' : 'right';
            else entry.lane = 'bottom';
        });
        const byX = [...list].sort((a, b) => at[a.kid].cx - at[b.kid].cx);
        const byY = [...list].sort((a, b) => at[a.kid].cy - at[b.kid].cy);
        const order = { top: byX, left: byY, right: byY, bottom: byX };
        return ['top', 'left', 'right', 'bottom']
            .flatMap((lane) => order[lane].filter((entry) => entry.lane === lane));
    }

    /** At rest nothing is dim; a focus or a held modifier is what pushes back. */
    function focusId() {
        const id = editingId() || hover;
        if (!id) return null;
        return shortcuts().some((shortcut) => shortcut.id === id) ? id : null;
    }

    function isDim(id) {
        const focus = focusId();
        if (focus) return focus !== id;
        if (!held) return false;
        const shortcut = shortcuts().find((item) => item.id === id);
        if (!shortcut) return true;
        const combo = shortcut.combo || {};
        return !(!!combo.ctrl === !!held.ctrl && !!combo.alt === !!held.alt && !!combo.shift === !!held.shift);
    }

    // ------------------------------------------------------------ drawing

    function capHtml(spec) {
        const kid = spec.code || '';
        const classes = ['kbd-key'];
        if (spec.cls) classes.push(spec.cls);
        const body = spec.icon
            ? FeatherIcons.svg(spec.icon, 16)
            : spec.sub
                ? `${esc(spec.label)}<span class="kbd-sub">${esc(spec.sub)}</span>`
                : esc(spec.label || '');
        return `<div class="${classes.join(' ')}" role="button" tabindex="0"
                     ${kid ? `data-kid="${kid}"` : ''}${spec.mod ? ` data-mod="${spec.mod}"` : ''}>${body}</div>`;
    }

    function boardHtml() {
        return ROWS.map((row) => `<div class="kbd-row">${row.map(capHtml).join('')}</div>`).join('');
    }

    function tabsHtml() {
        return SCOPES.map((item) => {
            const mark = item.site
                ? SiteIcons.svg(item.site, { size: 18 })
                : FeatherIcons.svg(item.icon, 18);
            return `<button class="kbd-scope" type="button" role="tab" data-scope="${item.id}"
                            title="${esc(item.name)}" aria-label="${esc(item.name)}">
                        <span class="kbd-scope-mark">${mark}</span>
                        <span class="kbd-scope-name bb-proper">${esc(item.name)}</span>
                    </button>`;
        }).join('');
    }

    /** The frame, built once; paint() is what changes after that. */
    function skeleton() {
        host.innerHTML = `
            <div class="kbd-scopebar">
                <div class="kbd-scopes" role="tablist">${tabsHtml()}</div>
                <button class="kbd-reset" type="button" data-act="reset"></button>
            </div>
            <p class="kbd-hint"></p>
            <div class="kbd-annot" data-annot>
                <div class="kbd-lane is-top"></div>
                <div class="kbd-lane is-left"></div>
                <div class="kbd-board" data-board>${boardHtml()}</div>
                <div class="kbd-lane is-right"></div>
                <div class="kbd-lane is-bottom"></div>
                <svg class="kbd-leaders" aria-hidden="true" focusable="false"></svg>
            </div>
            <div class="kbd-listbar">
                <button class="kbd-listtoggle" type="button" data-act="list"></button>
                <span class="kbd-bound"></span>
            </div>
            <div class="kbd-list" hidden>
                <div class="shortcut-list" data-shortcut-scope="general"></div>
            </div>`;
        annot = host.querySelector('[data-annot]');
    }

    function labelHtml(entry) {
        const editing = editingId() === entry.id;
        const classes = ['kbd-label'];
        if (editing) classes.push('is-editing');
        else if (isDim(entry.id)) classes.push('is-dim');
        const title = editing ? 'Press the new shortcut…' : entry.title;
        const lines = editing ? ['Esc cancels'] : entry.lines;
        return `<div class="${classes.join(' ')}" data-lid="${entry.id}" data-kid-for="${entry.kid}">
                    <span class="kbd-label-title">${esc(title)}</span>
                    ${lines.map((line) => `<span class="kbd-label-line">${esc(line)}</span>`).join('')}
                </div>`;
    }

    /**
     * Everything that answers to a hover, a held modifier or the scope: the
     * labels, what each cap looks like, and the leaders between them.
     */
    function paint() {
        if (!host) return;
        const editing = editingId();
        const list = shortcuts();

        host.querySelectorAll('.kbd-scope').forEach((tab) => {
            tab.classList.toggle('is-active', tab.dataset.scope === scope);
            tab.setAttribute('aria-selected', tab.dataset.scope === scope ? 'true' : 'false');
        });
        host.querySelector('.kbd-reset').textContent = `Reset ${scopeName()} shortcuts`;
        host.querySelector('.kbd-hint').textContent = scope === 'lichess' ? LICHESS_HINT : HINT;

        // Rewriting a lane that has not changed would resize the box for no
        // reason, and the resize observer would call straight back in here.
        const entries = laid();
        ['top', 'left', 'right', 'bottom'].forEach((lane) => {
            const box = host.querySelector(`.kbd-lane.is-${lane}`);
            const html = entries.filter((entry) => entry.lane === lane).map(labelHtml).join('');
            if (box.innerHTML !== html) box.innerHTML = html;
        });

        // Which shortcut each cap belongs to, so a cap can be hovered, dimmed
        // and clicked as the thing it is bound to.
        const owner = {};
        entries.forEach((entry) => {
            if (entry.kid !== 'digits') { owner[entry.kid] = entry.id; return; }
            for (let n = 1; n <= 9; n++) owner[`Digit${n}`] = entry.id;
        });

        const focused = !!(focusId() || held);
        const hovered = editing ? null : list.find((item) => item.id === focusId());
        host.querySelectorAll('.kbd-key').forEach((cap) => {
            const id = owner[cap.dataset.kid];
            const mod = cap.dataset.mod;
            const litMod = !!mod && (
                (hovered && !!(hovered.combo || {})[mod]) || (held && !!held[mod])
            );
            const dim = focused && !litMod && (!id || isDim(id));
            const lit = litMod || (!!id && !dim);
            cap.classList.toggle('is-dim', !!dim);
            cap.classList.toggle('is-lit', !!lit);
            cap.classList.toggle('is-editing', !!id && id === editing);
            cap.classList.toggle('is-bound', !!id);
            if (id) cap.dataset.shortcut = id;
            else delete cap.dataset.shortcut;
        });

        const count = list.length;
        host.querySelector('.kbd-bound').textContent =
            `${count} shortcut${count === 1 ? '' : 's'} on this tab`;
        host.querySelector('.kbd-listtoggle').textContent = listOpen ? 'Hide list view' : 'List view';
        host.querySelector('.kbd-listtoggle').classList.toggle('is-on', listOpen);
        host.querySelector('.kbd-list').hidden = !listOpen;
        host.querySelector('.kbd-list').classList.toggle('is-unavailable', scope === 'lichess');

        drawLeaders(entries);
    }

    const round = (n) => Math.round(n * 10) / 10;
    const sign = (n) => (n < 0 ? -1 : 1);

    /**
     * A leader is two segments: a straight run out of the text, one bend, then
     * a single oblique into the key. No elbow at the key and no terminal dot —
     * the line arrives and stops, the way a printed callout does. It runs all
     * the way to the cap's centre but paints behind the caps, so it shows in
     * the gutters and disappears under the one it names.
     */
    function drawLeaders(entries) {
        const svg = host.querySelector('.kbd-leaders');
        if (!svg || !annot) return;
        const editing = editingId();
        const paths = [];

        entries.forEach((entry) => {
            const label = annot.querySelector(`[data-lid="${entry.id}"]`);
            const target = capRect(entry.kid);
            if (!label || !target) return;
            // In rebind mode only the listening key keeps its line; every
            // other leader is gone, not faded.
            if (editing && entry.id !== editing) return;

            const box = annot.getBoundingClientRect();
            const rect = label.getBoundingClientRect();
            const dim = isDim(entry.id);
            let d;

            if (entry.lane === 'top' || entry.lane === 'bottom') {
                const up = entry.lane === 'bottom';
                const x0 = rect.left + rect.width / 2 - box.left;
                const y0 = up ? rect.top - box.top - 4 : rect.bottom - box.top + 4;
                const span = Math.abs((up ? target.bottom : target.top) - y0);
                if (Math.abs(target.cx - x0) < 1.5) {
                    d = `M${round(x0)} ${round(y0)}V${round(target.cy)}`;
                } else {
                    const stub = Math.max(8, Math.min(20, span - 14));
                    const turn = y0 + sign(target.cy - y0) * stub;
                    d = `M${round(x0)} ${round(y0)}V${round(turn)}L${round(target.cx)} ${round(target.cy)}`;
                }
            } else {
                const toLeft = entry.lane === 'right';
                const x0 = toLeft ? rect.left - box.left - 4 : rect.right - box.left + 4;
                const y0 = rect.top + rect.height / 2 - box.top;
                const span = Math.abs((toLeft ? target.right : target.left) - x0);
                if (Math.abs(target.cy - y0) < 1.5) {
                    d = `M${round(x0)} ${round(y0)}H${round(target.cx)}`;
                } else {
                    const stub = Math.max(10, Math.min(26, span - 18));
                    const turn = x0 + sign(target.cx - x0) * stub;
                    d = `M${round(x0)} ${round(y0)}H${round(turn)}L${round(target.cx)} ${round(target.cy)}`;
                }
            }
            paths.push({ d, dim });

            // The number row is one label over nine caps, so it is bracketed
            // rather than pointed at.
            if (entry.kid === 'digits') {
                const y = target.top - 3;
                paths.push({
                    d: `M${round(target.left)} ${round(y - 4)}v4H${round(target.right)}v-4`,
                    dim,
                });
            }
        });

        svg.innerHTML = paths.map((path) =>
            `<path d="${path.d}" fill="none" stroke-width="1" stroke-linejoin="miter"
                   class="kbd-leader${path.dim ? ' is-dim' : ''}"></path>`).join('');
    }

    /** Measuring reflects the DOM as it was, so re-measure on the next frame. */
    function schedule() {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            if (!annot) return;
            // clientWidth, not the rect: under browser zoom the scaled rect
            // flips the narrow/wide decision and the side lanes never appear.
            const nowNarrow = annot.clientWidth > 0 && annot.clientWidth < NARROW;
            if (nowNarrow !== narrow) {
                narrow = nowNarrow;
                annot.classList.toggle('is-narrow', narrow);
            }
            paint();
        });
    }

    // ------------------------------------------------------------ events

    function wire() {
        host.addEventListener('click', (event) => {
            const tab = event.target.closest('[data-scope]');
            if (tab) {
                scope = tab.dataset.scope;
                hover = null;
                if (BB.ShortcutList) {
                    BB.ShortcutList.stopEditing();
                    BB.ShortcutList.setScope(host.querySelector('[data-shortcut-scope]'), bindingScope());
                }
                return schedule();
            }

            const action = event.target.closest('[data-act]');
            if (action && action.dataset.act === 'list') {
                listOpen = !listOpen;
                return schedule();
            }
            if (action && action.dataset.act === 'reset') return askReset();

            const cap = event.target.closest('.kbd-key');
            if (cap && cap.dataset.shortcut && BB.ShortcutList) {
                const id = cap.dataset.shortcut;
                if (editingId() === id) BB.ShortcutList.stopEditing();
                else BB.ShortcutList.startEditing(id);
                return schedule();
            }
            return undefined;
        });

        host.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const cap = event.target.closest('.kbd-key');
            if (!cap || !cap.dataset.shortcut) return;
            event.preventDefault();
            cap.click();
        });

        const enter = (event) => {
            const label = event.target.closest('[data-lid]');
            const cap = event.target.closest('.kbd-key');
            const id = label ? label.dataset.lid : (cap && cap.dataset.shortcut) || null;
            if (id === hover) return;
            hover = id;
            schedule();
        };
        host.addEventListener('mouseover', enter);
        host.addEventListener('mouseout', (event) => {
            if (host.contains(event.relatedTarget)) return;
            hover = null;
            schedule();
        });

        // Holding a modifier lights what it reaches. Only while the keyboard is
        // on screen, and never while a rebind is listening — the keystroke
        // belongs to the rebind then.
        document.addEventListener('keydown', (event) => {
            if (editingId() || !annot || !annot.clientWidth) return;
            const next = event.ctrlKey || event.altKey || event.shiftKey
                ? { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey }
                : null;
            if (JSON.stringify(next) === JSON.stringify(held)) return;
            held = next;
            schedule();
        }, true);
        document.addEventListener('keyup', () => {
            if (!held) return;
            held = null;
            schedule();
        }, true);

        window.addEventListener('resize', schedule);
        if (typeof ResizeObserver !== 'undefined') {
            // The settings view is hidden until it is picked, so the board has
            // no size to measure until then; the observer is what catches it
            // coming into view, and a skin change resizing the labels too.
            new ResizeObserver(schedule).observe(annot);
        }
        if (BB.ShortcutList) BB.ShortcutList.watch(schedule);
    }

    async function askReset() {
        const Ui = BB.Ui;
        const name = scopeName();
        const yes = Ui && Ui.confirmDialog
            ? await Ui.confirmDialog({
                title: `Reset ${name} shortcuts?`,
                message: `Every ${name} shortcut goes back to its default keys, and any you turned off are`
                    + ' turned back on. Shortcuts on the other tabs are left alone.',
                confirmLabel: 'Reset',
                cancelLabel: 'Cancel',
                danger: true,
            })
            : true;
        if (!yes || !BB.ShortcutList) return;
        await BB.ShortcutList.resetScope(bindingScope());
        schedule();
    }

    /** Draw the section into `container`, replacing whatever was there. */
    function mount(container) {
        if (!container) return;
        host = container;
        skeleton();
        wire();
        schedule();
    }

    const KeyboardWidget = { mount, SCOPES, kidOf, rowOf };

    BB.KeyboardWidget = KeyboardWidget;
    if (typeof module !== 'undefined' && module.exports) module.exports = KeyboardWidget;
})(typeof globalThis !== 'undefined' ? globalThis : this);
