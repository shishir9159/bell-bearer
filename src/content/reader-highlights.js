/**
 * Highlighting in the reader's transcript: the pen, and everything a
 * highlight then carries — its toolbar, the knobs that trim it, the note at
 * its end, and the list of them all.
 *
 * **A highlight is drawn word by word, with the reader's own pen, not with
 * the browser's selection.** Press on a word and drag: the words under the
 * pen wet as it goes and the highlight is saved when it lifts, with an Undo.
 * A click plays from the word. A selection could not do either — it snaps to
 * characters, the click that ends it is a seek, and it cannot be made to
 * look like ink. So the transcript is not selectable at all, and the pen is
 * the cursor.
 *
 * Each highlight is a checkpoint like any other, stored by its times; the
 * words it covers are worked out from those times every time it is drawn
 * (ReaderTranscript.rangeOf), so a highlight made in one caption language
 * lands on the same moment in another, and a checkpoint made with Ctrl+B is
 * drawn over the words said while it was held.
 *
 * Highlights that touch become one (ReaderTranscript.merge): the transcript
 * draws a run of ink as one passage, and two records under it would be two
 * rows in the list for what looks like one thing.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Time = ns.Time || req('../shared/time.js');
    const Bookmarks = ns.Bookmarks || req('../shared/bookmarks.js');
    const ReaderTranscript = ns.ReaderTranscript || req('./reader-transcript.js');

    /** A press that travels less than this is a click, not a stroke. */
    const MOVE_PX = 5;

    /** How long a toolbar outlives the pointer leaving its highlight — long enough to reach it. */
    const HIDE_MS = 280;

    /** A note is written this long after the last keystroke, not on every one. */
    const NOTE_DEBOUNCE_MS = 400;

    const svg = (size, body, extra = '') => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
    const ICON = Object.freeze({
        play: '<svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M1 .8v8.4L8.2 5z" fill="currentColor"></path></svg>',
        note: svg(16, '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path>'),
        pen: svg(13, '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>', ' stroke-width="2"'),
        trash: svg(16, '<path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>'),
        copy: svg(14, '<rect width="14" height="14" x="8" y="8" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>'),
    });

    /** The pen and the eraser, drawn in the skin's ink, as cursors. */
    function cursors(ink) {
        const uri = (body) => `url("data:image/svg+xml,${encodeURIComponent(body)}")`;
        const pen = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M2.5 25.5h8.5" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M2.5 25.5h8.5" stroke="${ink}" stroke-width="3" stroke-linecap="round"/><g transform="rotate(45 14 14)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"><rect x="10.5" y="1.5" width="7" height="13.5" rx="1.6" fill="#26262a"/><path d="M10.5 15h7l-1.6 4h-3.8z" fill="#26262a"/><path d="M12.4 19h3.2l-.7 3.6-2.1-.9z" fill="${ink}"/></g></svg>`;
        const eraser = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><g transform="rotate(45 14 14)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"><rect x="9" y="3" width="10" height="20" rx="2.5" fill="#26262a"/><path d="M9 15.5h10v5a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 9 20.5z" fill="#f3a6bd"/></g></svg>';
        return { pen: `${uri(pen)} 8 20, text`, eraser: `${uri(eraser)} 8 20, default` };
    }

    /** `0:12–0:30`: the span a highlight covers, as its toast and its toolbar say it. */
    function spanLabel(record) {
        const start = typeof record.start === 'number' ? record.start : record.time;
        return typeof record.end === 'number' && record.end > start
            ? `${Time.formatTime(start)}–${Time.formatTime(record.end)}`
            : Time.formatTime(start);
    }

    const autoTitle = (text) => (text.length > 60 ? `${text.slice(0, 59)}…` : text);

    function createHighlights({ element, content, lists, getVideo, videoId, seek, toast, onChange, onCopy }) {
        const state = {
            model: null,
            /** Highlights drawn in the transcript: `{ id, from, to, note, record }`, id being the bookmarkKey. */
            marks: [],
            /** Checkpoints with no words under them here — no transcript, or past its end. Listed, not drawn. */
            stray: [],
            hover: null,
            sel: null,
            edit: null,
            /** A stroke in progress: `{ from, to, base }`, base the highlight it reshapes. */
            drag: null,
            alt: false,
            band: false,
        };
        let press = null;
        let hideTimer = 0;
        let inTools = false;
        let editor = null;
        let alive = true;
        /** Notes typed and not yet written, by key: a reload from storage must not undo the typing. */
        const pending = new Map();
        /** The transcript's word and space spans, by word index; and the band's, which come and go. */
        const views = { main: { words: [], spaces: [], painted: new Map() }, band: { words: [], spaces: [], painted: new Map() } };

        const tools = document.createElement('div');
        tools.className = 'rd-tb';
        tools.hidden = true;
        tools.innerHTML = `<button type="button" class="rd-tb-play" title="Play this highlight">${ICON.play}<span></span></button>
            <span class="rd-tb-rule"></span>
            <button type="button" class="rd-tb-note" title="Note" aria-label="Note">${ICON.note}</button>
            <button type="button" class="rd-tb-remove" title="Remove (or Alt-click it)" aria-label="Remove">${ICON.trash}</button>`;
        const knobs = ['start', 'end'].map((which) => {
            const knob = document.createElement('div');
            knob.className = `rd-knob rd-knob-${which}`;
            knob.hidden = true;
            knob.title = `Drag to extend or trim the ${which}`;
            knob.dataset.which = which;
            return knob;
        });
        content.append(tools, ...knobs);

        const video = () => getVideo() || { id: videoId };
        const find = (id) => (id ? state.marks.find((mark) => mark.id === id) || null : null);
        const target = () => (state.drag || state.alt ? null : state.sel || state.hover);
        const records = () => state.marks.map((mark) => mark.record).concat(state.stray);

        // ------------------------------------------------------- loading

        /**
         * The video's checkpoints, from storage, onto the words. Called on
         * open and on every change to the store — this reader's own writes
         * included, which come back as what was already drawn.
         */
        function load(list) {
            const marks = [];
            const stray = [];
            for (const stored of list || []) {
                const key = Bookmarks.bookmarkKey(stored);
                const record = pending.has(key) ? { ...stored, note: pending.get(key).note } : stored;
                const range = state.model ? ReaderTranscript.rangeOf(state.model, record) : null;
                if (range) marks.push({ id: key, from: range.from, to: range.to, note: ReaderTranscript.ownNote(record.note), record });
                else stray.push(record);
            }
            state.marks = marks.sort((a, b) => a.from - b.from);
            state.stray = stray;
            if (state.drag && state.drag.base && !find(state.drag.base)) state.drag.base = null;
            for (const key of ['hover', 'sel', 'edit']) if (state[key] && !find(state[key])) state[key] = null;
            if (!state.edit) closeEditor();
            render();
        }

        /** A new transcript — another language, or the first one — and the same checkpoints redrawn on it. */
        function setModel(model) {
            state.model = model;
            state.hover = state.sel = state.edit = state.drag = null;
            closeEditor();
            views.main = indexView(content.querySelector('.rd-paras'));
            load(records());
        }

        function indexView(container) {
            const view = { words: [], spaces: [], painted: new Map(), paintedSpaces: new Map() };
            if (!container) return view;
            for (const node of container.querySelectorAll('.rd-w')) view.words[Number(node.dataset.w)] = node;
            for (const node of container.querySelectorAll('.rd-sp')) view.spaces[Number(node.dataset.w)] = node;
            return view;
        }

        /** The band redrew its three sentences: their words are inked afresh. */
        function setBand(on) {
            state.band = !!on;
            views.band = indexView(on ? content.querySelector('.rd-bandrows') : null);
            paint();
            place();
        }

        // ------------------------------------------------------ painting

        /**
         * Ink the words. Only highlighted words carry a class, so this walks
         * the highlights rather than the transcript, and touches only the
         * spans whose class changed since the last pass — a stroke repaints on
         * every move of the pointer, over transcripts tens of thousands of
         * words long.
         */
        function paint() {
            if (!state.model) return;
            const words = state.model.words;
            const group = new Map();
            const drag = state.drag;
            for (const mark of state.marks) {
                if (drag && drag.base === mark.id) continue;
                for (let i = mark.from; i <= mark.to; i++) group.set(i, mark.id);
            }
            if (drag) for (let i = drag.from; i <= drag.to; i++) group.set(i, '~');
            const hot = state.sel || state.hover;
            const erase = state.alt && state.hover ? state.hover : null;
            const tone = (id) => (id === '~' ? ' wet' : id === erase ? ' erase' : id === hot ? ' hot' : '');
            const wordClass = new Map();
            const spaceClass = new Map();
            for (const [i, id] of group) {
                const same = (j) => j >= 0 && j < words.length && words[j].p === words[i].p && group.get(j) === id;
                wordClass.set(i, `m${tone(id)}${same(i - 1) ? '' : ' ms'}${same(i + 1) ? '' : ' me'}`);
                if (same(i + 1)) spaceClass.set(i, `m${tone(id)}`);
            }
            for (const view of [views.main, views.band]) {
                apply(view.words, view.painted, wordClass, 'rd-w');
                apply(view.spaces, view.paintedSpaces || (view.paintedSpaces = new Map()), spaceClass, 'rd-sp');
            }
            element.classList.toggle('is-erasing', state.alt);
        }

        function apply(nodes, painted, next, base) {
            for (const [i, cls] of painted) {
                if (next.get(i) === cls) continue;
                if (nodes[i]) nodes[i].className = base;
                painted.delete(i);
            }
            for (const [i, cls] of next) {
                if (painted.get(i) === cls || !nodes[i]) continue;
                nodes[i].className = `${base} ${cls}`;
                painted.set(i, cls);
            }
        }

        /** Where the toolbar and the knobs go: over the highlight's first word, at its two ends. */
        function place() {
            const view = state.band ? views.band : views.main;
            const id = target();
            const mark = find(id);
            const first = mark && view.words[mark.from];
            const last = mark && view.words[mark.to];
            const box = content.getBoundingClientRect();
            const at = (node) => {
                const r = node.getBoundingClientRect();
                return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
            };
            const show = !!(first && first.offsetParent);
            tools.hidden = !show;
            knobs.forEach((knob) => { knob.hidden = !(show && last); });
            if (!show) return;
            const a = at(first);
            tools.querySelector('.rd-tb-play span').textContent = spanLabel(mark.record);
            let y = a.y - 50;
            if (y < 2 && last) {
                const b = at(last);
                y = b.y + b.h + 8;
            }
            const width = tools.offsetWidth || 190;
            tools.style.left = `${Math.round(Math.max(4, Math.min(a.x - 6, content.offsetWidth - width - 6)))}px`;
            tools.style.top = `${Math.round(y)}px`;
            if (!last) return;
            const b = at(last);
            Object.assign(knobs[0].style, { left: `${Math.round(a.x)}px`, top: `${Math.round(a.y - 10)}px`, height: `${Math.round(a.h + 10)}px` });
            Object.assign(knobs[1].style, { left: `${Math.round(b.x + b.w)}px`, top: `${Math.round(b.y)}px`, height: `${Math.round(b.h + 10)}px` });
        }

        // --------------------------------------------- notes and the list

        /**
         * A note sits at the end of its highlight — under the paragraph the
         * highlight ends in, so a passage that runs on into the next paragraph
         * has its note after the last of it, not after the first.
         */
        function renderNotes() {
            for (const holder of content.querySelectorAll('.rd-notes')) holder.textContent = '';
            if (!state.model) return;
            const bodies = content.querySelectorAll('.rd-paras .rd-pbody');
            for (const mark of state.marks) {
                if (!mark.note || mark.id === state.edit) continue;
                const body = bodies[state.model.words[mark.to].p];
                if (!body) continue;
                let holder = body.querySelector('.rd-notes');
                if (!holder) {
                    holder = document.createElement('div');
                    holder.className = 'rd-notes';
                    body.appendChild(holder);
                }
                const note = document.createElement('div');
                note.className = 'rd-note';
                note.dataset.hid = mark.id;
                note.title = 'Edit note';
                note.innerHTML = `${ICON.pen}<span></span>`;
                note.querySelector('span').textContent = mark.note;
                holder.appendChild(note);
            }
        }

        /**
         * The list of highlights, in the Highlights tab and down focus's side,
         * kept item by item rather than redrawn: a note is typed in here, and
         * rebuilding the list under it would throw the caret out mid-word.
         */
        function renderList() {
            const all = state.marks.map((mark) => ({ id: mark.id, record: mark.record, note: mark.note }))
                .concat(state.stray.map((record) => ({ id: Bookmarks.bookmarkKey(record), record, note: ReaderTranscript.ownNote(record.note) })))
                .sort((a, b) => Bookmarks.bookmarkTime(a.record) - Bookmarks.bookmarkTime(b.record));
            const label = all.length === 1 ? '1 highlight' : `${all.length} highlights`;
            for (const list of lists()) {
                const count = list.querySelector('.rd-list-count');
                if (count) count.textContent = list.dataset.countStyle === 'number' ? String(all.length) : label;
                const holder = list.querySelector('.rd-list-items');
                const existing = new Map(Array.from(holder.children, (item) => [item.dataset.hid, item]));
                const refit = [];
                all.forEach((one, at) => {
                    let item = existing.get(one.id);
                    existing.delete(one.id);
                    if (!item) item = listItem(one.id);
                    const said = one.record.subtitle && one.record.subtitle !== 'null' ? one.record.subtitle
                        : find(one.id) ? ReaderTranscript.textOf(state.model, find(one.id).from, find(one.id).to) : '';
                    item.querySelector('.rd-li-play span').textContent = spanLabel(one.record);
                    item.querySelector('.rd-li-text span').textContent = said;
                    item.querySelector('.rd-li-text').hidden = !said;
                    const box = item.querySelector('textarea');
                    if (box !== document.activeElement && box.value !== one.note) {
                        box.value = one.note;
                        refit.push(box);
                    }
                    if (holder.children[at] !== item) holder.insertBefore(item, holder.children[at] || null);
                });
                for (const gone of existing.values()) gone.remove();
                refit.forEach(fitBox);
                const empty = list.querySelector('.rd-list-empty');
                if (empty) empty.hidden = all.length > 0;
            }
        }

        function listItem(id) {
            const item = document.createElement('div');
            item.className = 'rd-li';
            item.dataset.hid = id;
            item.innerHTML = `<div class="rd-li-row"><button type="button" class="rd-li-play" title="Play">${ICON.play}<span></span></button>
                <button type="button" class="rd-li-remove" title="Remove" aria-label="Remove">${ICON.trash}</button></div>
                <div class="rd-li-text"><span></span></div>
                <textarea rows="1" placeholder="Add a note…" aria-label="Note"></textarea>`;
            return item;
        }

        /**
         * A note box as tall as what is in it: one line until there is more.
         * The stylesheet's field-sizing does this where the browser has it;
         * elsewhere it is measured, which only works once the box is on the
         * page and showing — a box in a closed tab measures nothing, so the
         * tabs ask again when they open.
         */
        const SIZES_ITSELF = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('field-sizing', 'content');
        function fitBox(box) {
            if (SIZES_ITSELF || !box.offsetParent) return;
            box.style.height = 'auto';
            box.style.height = `${box.scrollHeight + 2}px`;
        }

        function fitNotes() {
            for (const list of lists()) list.querySelectorAll('textarea').forEach(fitBox);
        }

        function render() {
            paint();
            renderNotes();
            renderList();
            placeEditor();
            place();
            if (onChange) onChange(count());
        }

        const count = () => state.marks.length + state.stray.length;

        // ---------------------------------------------------- the editor

        /** Open the note box at the end of a highlight, caret at the end of what is there. */
        function openEditor(id) {
            const mark = find(id);
            if (!mark) return;
            state.edit = id;
            state.sel = id;
            if (!editor) {
                editor = document.createElement('div');
                editor.className = 'rd-edit';
                editor.innerHTML = '<textarea rows="2" placeholder="Add a note…" aria-label="Note"></textarea><span>Saved as you type · Enter closes</span>';
                const box = editor.querySelector('textarea');
                box.addEventListener('input', () => setNote(state.edit, box.value));
                box.addEventListener('keydown', (event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
                        event.preventDefault();
                        closeEditor();
                        render();
                    }
                });
                box.addEventListener('blur', () => {
                    if (state.edit) {
                        closeEditor();
                        render();
                    }
                });
            }
            editor.querySelector('textarea').value = mark.note || '';
            render();
            const box = editor.querySelector('textarea');
            box.focus({ preventScroll: true });
            box.setSelectionRange(box.value.length, box.value.length);
        }

        function placeEditor() {
            if (!editor || !state.edit || !state.model) {
                if (editor) editor.remove();
                return;
            }
            const mark = find(state.edit);
            const body = mark && content.querySelectorAll('.rd-paras .rd-pbody')[state.model.words[mark.to].p];
            if (!body) {
                editor.remove();
                return;
            }
            if (editor.parentNode !== body) body.appendChild(editor);
        }

        function closeEditor() {
            const id = state.edit;
            state.edit = null;
            if (id) flush(id);
            if (editor) editor.remove();
        }

        // ------------------------------------------------------- writing

        async function write(change, failed = 'Could not save the highlight') {
            try {
                await Bookmarks.update(change);
            } catch (error) {
                console.error('Bell Bearer: could not save a highlight', error);
                if (alive) toast(failed);
            }
        }

        const swap = (keys, add) => write((videos) => Bookmarks.replaceBookmarks(videos, video(), keys, add));

        /**
         * Save a stroke, a trim or a reach with Shift: the range, joined with
         * whatever it touches. The undo puts back exactly what was there —
         * the highlights it swallowed, and the one it reshaped as it was.
         */
        function commit(range, kind) {
            const model = state.model;
            const result = ReaderTranscript.merge(state.marks, range, range.base);
            const kept = find(result.keep);
            const absorbed = result.absorbed.map(find).filter(Boolean);
            const span = ReaderTranscript.spanOf(model, result.from, result.to);
            const text = ReaderTranscript.textOf(model, result.from, result.to);
            const was = kept ? kept.record : null;
            const record = {
                ...(was || {}),
                id: (was && was.id) || Bookmarks.newId(),
                time: Math.floor(span.start),
                start: span.start,
                end: span.end,
                timestamp: was && typeof was.timestamp === 'number' ? was.timestamp : Date.now(),
                note: result.note,
                // A title the user gave it is kept; one that was only the
                // passage's opening words follows the passage.
                title: was && was.title && was.title !== autoTitle(String(was.subtitle || '')) ? was.title : autoTitle(text),
                subtitle: text,
            };
            const before = state.marks;
            const removed = (kept ? [kept] : []).concat(absorbed);
            // A note still waiting to be written is in the record now; written
            // late, it would land on a key that no longer exists.
            for (const mark of removed) {
                const waiting = pending.get(mark.id);
                if (waiting) clearTimeout(waiting.timer);
                pending.delete(mark.id);
            }
            const key = Bookmarks.bookmarkKey(record);
            state.marks = state.marks.filter((mark) => !removed.includes(mark))
                .concat([{ id: key, from: result.from, to: result.to, note: result.note, record }])
                .sort((a, b) => a.from - b.from);
            state.drag = null;
            state.hover = key;
            state.sel = kind === 'edit' ? key : null;
            render();
            swap(removed.map((mark) => mark.id), [record]);
            const verb = kind === 'new' && !result.merged ? 'Highlighted' : kind === 'edit' ? 'Changed to' : 'Extended to';
            toast(`${verb} ${spanLabel(record)}`, () => {
                state.marks = before;
                state.hover = state.sel = state.edit = state.drag = null;
                render();
                swap([key], removed.map((mark) => mark.record));
            });
        }

        function remove(id) {
            const mark = find(id);
            const record = mark ? mark.record : state.stray.find((one) => Bookmarks.bookmarkKey(one) === id);
            if (!record) return;
            const before = { marks: state.marks, stray: state.stray };
            state.marks = state.marks.filter((one) => one.id !== id);
            state.stray = state.stray.filter((one) => one !== record);
            pending.delete(id);
            state.hover = state.sel = null;
            if (state.edit === id) closeEditor();
            render();
            write((videos) => Bookmarks.removeBookmarkById(videos, videoId, id));
            toast('Highlight removed', () => {
                state.marks = before.marks;
                state.stray = before.stray;
                render();
                swap([], [record]);
            });
        }

        /** A note is drawn as it is typed and written once the typing stops. */
        function setNote(id, text) {
            const mark = find(id);
            const record = mark ? mark.record : state.stray.find((one) => Bookmarks.bookmarkKey(one) === id);
            if (!record) return;
            if (mark) mark.note = text.trim();
            const waiting = pending.get(id);
            if (waiting) clearTimeout(waiting.timer);
            pending.set(id, { note: text.trim(), timer: setTimeout(() => flush(id), NOTE_DEBOUNCE_MS) });
            renderList();
        }

        function flush(id) {
            const waiting = id && pending.get(id);
            if (!waiting) return;
            clearTimeout(waiting.timer);
            pending.delete(id);
            write((videos) => Bookmarks.editBookmark(videos, videoId, id, { note: waiting.note }), 'Could not save the note');
        }

        // ------------------------------------------------------ the pen

        const wordOf = (node) => {
            const at = node && node.closest ? node.closest('[data-w]') : null;
            return at && content.contains(at) ? Number(at.dataset.w) : null;
        };
        const markAt = (i) => {
            const mark = state.marks.find((one) => i >= one.from && i <= one.to);
            return mark ? mark.id : null;
        };

        function onDown(event) {
            if (event.button !== 0 || !state.model) return;
            if (event.target.closest('.rd-tb, .rd-edit, .rd-note')) return;
            const knob = event.target.closest('.rd-knob');
            if (knob) {
                startKnob(event, knob.dataset.which);
                return;
            }
            const w = wordOf(event.target);
            if (w === null) {
                if (state.sel || state.edit) {
                    state.sel = null;
                    closeEditor();
                    render();
                }
                return;
            }
            event.preventDefault();
            const hid = markAt(w);
            if (event.altKey || state.alt) {
                if (hid) remove(hid);
                return;
            }
            if (event.shiftKey && state.sel) {
                const mark = find(state.sel);
                commit({ from: Math.min(mark.from, w), to: Math.max(mark.to, w), base: mark.id }, 'extend');
                return;
            }
            press = { kind: 'word', w, x: event.clientX, y: event.clientY, hid, moved: false, last: w };
            follow();
        }

        function startKnob(event, which) {
            event.preventDefault();
            event.stopPropagation();
            const mark = find(state.sel || state.hover);
            if (!mark) return;
            press = { kind: 'knob', which, hid: mark.id, moved: true, w: which === 'end' ? mark.to : mark.from, last: null };
            state.drag = { from: mark.from, to: mark.to, base: mark.id };
            render();
            follow();
        }

        /** The stroke follows the pointer anywhere on the page until it lifts. */
        function follow() {
            window.addEventListener('pointermove', onMove, true);
            window.addEventListener('pointerup', onUp, true);
            window.addEventListener('pointercancel', onCancel, true);
        }

        function unfollow() {
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
            window.removeEventListener('pointercancel', onCancel, true);
        }

        function onMove(event) {
            if (!press) return;
            if (!press.moved) {
                if (Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y) < MOVE_PX) return;
                press.moved = true;
            }
            const under = document.elementFromPoint(event.clientX, event.clientY);
            let w = under && content.contains(under) ? wordOf(under) : null;
            if (w === null) w = press.last !== null ? press.last : press.w;
            press.last = w;
            let range;
            if (press.kind === 'knob') {
                const mark = find(press.hid);
                if (!mark) return;
                range = press.which === 'end'
                    ? { from: mark.from, to: Math.max(mark.from, w), base: mark.id }
                    : { from: Math.min(w, mark.to), to: mark.to, base: mark.id };
            } else if (press.hid) {
                const mark = find(press.hid);
                range = { from: Math.min(mark.from, w), to: Math.max(mark.to, w), base: mark.id };
            } else {
                range = { from: Math.min(press.w, w), to: Math.max(press.w, w), base: null };
            }
            const d = state.drag;
            if (d && d.from === range.from && d.to === range.to) return;
            state.drag = range;
            state.hover = null;
            paint();
            place();
        }

        /**
         * The stroke ends where the pointer lifts. A move the browser
         * coalesced into the release would otherwise be lost, and the
         * highlight would stop a word or two short of where it was let go.
         */
        function onUp(event) {
            if (press && event && typeof event.clientX === 'number') onMove(event);
            unfollow();
            const done = press;
            press = null;
            if (!done) return;
            if (done.moved && state.drag) {
                commit(state.drag, done.kind === 'knob' ? 'edit' : done.hid ? 'extend' : 'new');
                return;
            }
            if (done.hid) {
                state.sel = state.sel === done.hid ? null : done.hid;
                state.hover = done.hid;
                closeEditor();
                render();
                return;
            }
            state.sel = null;
            closeEditor();
            render();
            seek(state.model.words[done.w].time);
        }

        function onCancel() {
            unfollow();
            press = null;
            if (state.drag) {
                state.drag = null;
                render();
            }
        }

        /** Hovering a highlight shows its toolbar; leaving it hides it, a moment later. */
        function onOver(event) {
            if (press) return;
            const w = wordOf(event.target);
            const hid = w === null ? null : markAt(w);
            if (hid) {
                clearTimeout(hideTimer);
                if (hid !== state.hover) {
                    state.hover = hid;
                    paint();
                    place();
                }
            } else if (state.hover && !state.sel && !event.target.closest('.rd-tb, .rd-knob')) {
                hideSoon();
            }
        }

        function hideSoon() {
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
                if (!alive || inTools || press) return;
                state.hover = null;
                paint();
                place();
            }, HIDE_MS);
        }

        function onLeave() {
            if (state.hover && !state.sel) hideSoon();
        }

        function onToolClick(event) {
            const id = target();
            const mark = find(id);
            if (!mark) return;
            if (event.target.closest('.rd-tb-play')) seek(mark.record.start ?? mark.record.time);
            else if (event.target.closest('.rd-tb-note')) openEditor(id);
            else if (event.target.closest('.rd-tb-remove')) remove(id);
        }

        function onNoteClick(event) {
            const note = event.target.closest('.rd-note');
            if (note) openEditor(note.dataset.hid);
        }

        function onListClick(event) {
            const item = event.target.closest('.rd-li');
            if (event.target.closest('.rd-copy')) {
                onCopy();
                return;
            }
            if (!item) return;
            const record = (find(item.dataset.hid) || {}).record ||
                state.stray.find((one) => Bookmarks.bookmarkKey(one) === item.dataset.hid);
            if (!record) return;
            if (event.target.closest('.rd-li-play')) seek(typeof record.start === 'number' ? record.start : record.time);
            else if (event.target.closest('.rd-li-remove')) remove(item.dataset.hid);
        }

        function onListInput(event) {
            const box = event.target.closest('textarea');
            const item = box && box.closest('.rd-li');
            if (!item) return;
            fitBox(box);
            setNote(item.dataset.hid, box.value);
            renderNotes();
        }

        function onListBlur(event) {
            const item = event.target.closest && event.target.closest('.rd-li');
            if (item && event.target.matches('textarea')) flush(item.dataset.hid);
        }

        content.addEventListener('pointerdown', onDown);
        content.addEventListener('mouseover', onOver);
        content.addEventListener('mouseleave', onLeave);
        content.addEventListener('click', onNoteClick);
        tools.addEventListener('click', onToolClick);
        for (const part of [tools, ...knobs]) {
            part.addEventListener('mouseenter', () => { inTools = true; clearTimeout(hideTimer); });
            part.addEventListener('mouseleave', () => { inTools = false; if (!state.sel) hideSoon(); });
        }
        for (const list of lists()) {
            list.addEventListener('click', onListClick);
            list.addEventListener('input', onListInput);
            list.addEventListener('focusout', onListBlur);
        }

        // ------------------------------------------------------ the keys

        /** Alt held turns the pen into an eraser; let go, or leave the window, and it is a pen again. */
        function setAlt(on) {
            if (state.alt === !!on) return;
            state.alt = !!on;
            paint();
            place();
        }

        /** Escape lets go of a highlight before it closes anything. True when it had one to let go of. */
        function escape() {
            if (!state.sel && !state.edit && !state.hover) return false;
            state.sel = state.hover = null;
            closeEditor();
            render();
            return true;
        }

        /** Backspace or Delete with a highlight picked removes it. True when one went. */
        function removePicked() {
            if (!state.sel) return false;
            remove(state.sel);
            return true;
        }

        /** Let go of everything, for a change of layout. */
        function reset() {
            state.hover = state.sel = state.drag = null;
            closeEditor();
            render();
        }

        function destroy() {
            alive = false;
            unfollow();
            clearTimeout(hideTimer);
            for (const id of Array.from(pending.keys())) flush(id);
        }

        return {
            load, setModel, setBand, setAlt, escape, removePicked, reset, place, destroy, fitNotes,
            setCursors(ink) {
                const { pen, eraser } = cursors(ink);
                element.style.setProperty('--rd-cursor-pen', pen);
                element.style.setProperty('--rd-cursor-eraser', eraser);
            },
            get count() { return count(); },
            /** Every checkpoint of the video, drawn or not, in time order: what Copy copies. */
            get records() { return records().sort((a, b) => Bookmarks.bookmarkTime(a) - Bookmarks.bookmarkTime(b)); },
            /** For the specs. */
            get state() { return state; },
        };
    }

    const ReaderHighlights = { createHighlights, cursors, spanLabel, autoTitle, MOVE_PX, HIDE_MS, NOTE_DEBOUNCE_MS, ICON };

    root.BB = root.BB || {};
    root.BB.ReaderHighlights = ReaderHighlights;
    if (typeof module !== 'undefined' && module.exports) module.exports = ReaderHighlights;
})(typeof globalThis !== 'undefined' ? globalThis : this);
