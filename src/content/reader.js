/**
 * The distraction-free reader: YouTube's own player at a size you pick, the
 * transcript beside it, and your checkpoints under that.
 *
 * **The player is moved, never re-embedded.** `#movie_player` is adopted into
 * the reader's stage and put back on close. Playback position, quality,
 * volume, captions and the rate Bell Bearer keeps all survive, because it is
 * the same element — which is the one thing an iframe of the video could never
 * do, and why the player here can be any size at all. Moving a playing
 * <video> does not pause it: the element is back in a document before the
 * browser gets round to asking whether it left.
 *
 * YouTube does not know it has been moved, so two of its habits are answered
 * here rather than fought. It sizes its controls off a resize event, so one
 * is sent whenever the stage changes size. And it fullscreens its own
 * container rather than the player, so for the length of a fullscreen the
 * player goes home and comes back after.
 *
 * Nothing on YouTube's page is removed or rebuilt. One class on <html> and
 * content.css do all of the hiding — the bb-leet-mock rule.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Theme = ns.Theme || req('./theme.js');
    const ReaderTranscript = ns.ReaderTranscript || req('./reader-transcript.js');
    const Bookmarks = ns.Bookmarks || req('../shared/bookmarks.js');
    const Settings = ns.Settings || req('../shared/settings.js');
    const Time = ns.Time || req('../shared/time.js');
    const Markdown = ns.Markdown || req('./markdown.js');

    const ROOT_ID = 'bb-reader';
    const SLOT_ID = 'bb-reader-slot';
    const PLAYER_ID = 'movie_player';
    /** On <html> while the reader is up; content.css keys everything off it. */
    const OPEN_CLASS = 'bb-reader-open';

    /**
     * How long the transcript leaves you alone after you scroll it yourself.
     * A column that yanks itself back to the playing line while you are
     * reading ahead of it is unusable, and four seconds is long enough to
     * find your place and short enough that it catches up again on its own.
     */
    const HANDS_OFF_MS = 4000;

    /** How long the checkpoint toast, and its Undo, stays up. */
    const TOAST_MS = 6000;

    /** A note is written this long after the last keystroke, not on every one. */
    const NOTE_DEBOUNCE_MS = 400;

    /**
     * The four shapes the reader takes. The layout itself is all CSS — one
     * grid per id, chosen by `data-layout` — and there is no layout maths
     * in this file at all.
     */
    const LAYOUTS = Object.freeze([
        Object.freeze({ id: 'split', label: 'Split', hint: 'Video beside the transcript' }),
        Object.freeze({ id: 'stacked', label: 'Stacked', hint: 'Video above the transcript' }),
        Object.freeze({ id: 'theatre', label: 'Theatre', hint: 'Video first, transcript in a drawer' }),
        Object.freeze({ id: 'focus', label: 'Focus', hint: 'Transcript first, video in the corner' }),
    ]);
    const LAYOUT_IDS = Object.freeze(LAYOUTS.map((layout) => layout.id));

    const layoutOf = (id) => (LAYOUT_IDS.includes(id) ? id : 'split');

    function layoutsHtml(current) {
        return `<div class="bb-reader-layouts" role="radiogroup" aria-label="Layout">${LAYOUTS.map((layout) => `
            <button type="button" role="radio" class="bb-reader-layout" data-layout="${layout.id}"
                    aria-checked="${layout.id === current}" title="${layout.hint}">${layout.label}</button>`).join('')}
        </div>`;
    }

    /** Keys that scroll the column, which count as the user scrolling it. */
    const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

    function shellHtml(title) {
        const esc = Dom.escapeHtml;
        return `
            <header class="bb-reader-bar">
                <h2 class="bb-reader-title">${esc(title || 'Reader')}</h2>
                <div class="bb-reader-tools"></div>
                <button type="button" class="bb-reader-close" aria-label="Close the reader" title="Close (Esc)">&times;</button>
            </header>
            <div class="bb-reader-body">
                <div class="bb-reader-stage"><div class="bb-reader-screen"></div></div>
                <aside class="bb-reader-side">
                    <section class="bb-reader-transcript" aria-label="Transcript">
                        <p class="bb-reader-empty">Loading the transcript…</p>
                    </section>
                    <section class="bb-reader-notes" aria-label="Checkpoints">
                        <header class="bb-rn-head">
                            <h3 class="bb-rn-title">Checkpoints <span class="bb-rn-count"></span></h3>
                            <button type="button" class="bb-rn-copy" title="Copy every checkpoint as a Markdown list">Copy</button>
                        </header>
                        <ol class="bb-rn-list"></ol>
                    </section>
                </aside>
            </div>
            <div class="bb-reader-toast" role="status" aria-live="polite" hidden><span
                 class="bb-reader-toast-text"></span><button type="button" class="bb-reader-toast-act"></button></div>`;
    }

    const spanText = (bookmark) => (typeof bookmark.start === 'number' && typeof bookmark.end === 'number'
        ? `${Time.formatTime(bookmark.start)} – ${Time.formatTime(bookmark.end)}`
        : Time.formatTime(Bookmarks.bookmarkTime(bookmark)));

    function noteHtml(bookmark) {
        const esc = Dom.escapeHtml;
        const said = bookmark.subtitle && bookmark.subtitle !== 'null' ? bookmark.subtitle : '';
        return `
            <li class="bb-rn-item" data-key="${Dom.escapeAttr(Bookmarks.bookmarkKey(bookmark))}">
                <div class="bb-rn-row">
                    <button type="button" class="bb-rn-time" title="Play from here">${esc(spanText(bookmark))}</button>
                    <button type="button" class="bb-rn-delete" aria-label="Delete this checkpoint" title="Delete">&times;</button>
                </div>
                ${said ? `<blockquote class="bb-rn-quote">${esc(said)}</blockquote>` : ''}
                <textarea class="bb-rn-note" rows="2" placeholder="Add a note…"
                          aria-label="Note">${esc(bookmark.note || '')}</textarea>
            </li>`;
    }

    function createReader({ player, watcher, getVideo, getSettings, transcripts, recorder, copyText }) {
        /**
         * The open reader, or null. A fresh object per open, so an answer that
         * arrives after a close — the transcript fetch, the skin read — can
         * see it belongs to a reader that is gone and leave the page alone.
         */
        let session = null;

        // --------------------------------------------------- the player

        /**
         * Where the player lives on YouTube's page.
         *
         * The sibling is remembered and not an index: YouTube inserts and
         * removes things around the player while we hold it, so the index it
         * had is not the index it should go back to. The slot is only the
         * fallback for a sibling YouTube has since thrown away.
         */
        function rememberHome(player) {
            let slot = document.getElementById(SLOT_ID);
            if (!slot) {
                slot = document.createElement('div');
                slot.id = SLOT_ID;
            }
            player.parentNode.insertBefore(slot, player);
            session.home = { parent: player.parentNode, next: player.nextSibling, slot };
        }

        function adopt() {
            const player = document.getElementById(PLAYER_ID);
            if (!session || !player || !player.parentNode) return false;
            if (player.parentNode === session.screen) return true;
            rememberHome(player);
            session.screen.appendChild(player);
            session.player = player;
            nudge();
            return true;
        }

        /** Put the player back where YouTube had it. Safe with no player at all. */
        function restore() {
            const home = session && session.home;
            const player = session && session.player;
            if (!home || !player) return;
            const { parent, next, slot } = home;
            session.home = null;
            // YouTube threw ours away and built another: putting the old one
            // back would leave two players answering to one id.
            const replaced = !player.isConnected && document.getElementById(PLAYER_ID);
            if (parent.isConnected && !replaced) {
                if (next && next.parentNode === parent) parent.insertBefore(player, next);
                else if (slot.parentNode === parent) parent.insertBefore(player, slot);
                else parent.appendChild(player);
            }
            slot.remove();
            nudge();
        }

        /**
         * Tell YouTube its player changed size. It lays out the control bar and
         * the video box off window resize, and has no way to know the reader
         * moved it — without this the controls keep the width they had.
         */
        function nudge() {
            requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        }

        /**
         * YouTube fullscreens its own container, not the player. With the
         * player in the reader that container is empty, so the player goes
         * home for the length of it and is adopted again on the way out. A
         * fullscreen of the player itself is fine where it stands.
         */
        function onFullscreen() {
            if (!session) return;
            const full = document.fullscreenElement;
            if (full && session.player && session.home && !full.contains(session.player)) {
                session.lent = true;
                restore();
            } else if (!full && session.lent) {
                session.lent = false;
                adopt();
            }
        }

        // ------------------------------------------------ open and close

        function open() {
            if (session) return true;
            const video = getVideo();
            if (!video || !document.getElementById(PLAYER_ID)) return false;

            const element = document.createElement('div');
            element.id = ROOT_ID;
            element.className = 'bb-reader';
            element.setAttribute('role', 'dialog');
            element.setAttribute('aria-label', 'Reader');
            element.innerHTML = shellHtml(video.title);
            const layout = layoutOf(getSettings().readerLayout);
            element.dataset.layout = layout;
            element.querySelector('.bb-reader-tools').innerHTML = layoutsHtml(layout);
            // Dressed for the page's light or dark from the first frame, and
            // for the skin as soon as storage answers.
            Theme.dress(element, { theme: Theme.pageTheme(), skin: 'default' });

            session = {
                alive: true,
                videoId: video.id,
                element,
                screen: element.querySelector('.bb-reader-screen'),
                player: null,
                home: null,
                lent: false,
                entries: [],
                rows: [],
                checkpoints: [],
                unwatch: null,
                notesShape: null,
                pending: new Map(),
                active: -1,
                handsOffAt: 0,
            };
            const mine = session;

            document.body.appendChild(element);
            document.documentElement.classList.add(OPEN_CLASS);
            adopt();

            element.querySelector('.bb-reader-close').addEventListener('click', close);
            element.querySelector('.bb-reader-layouts').addEventListener('click', (event) => {
                const button = event.target.closest('.bb-reader-layout');
                if (button) setLayout(button.dataset.layout);
            });
            document.addEventListener('keydown', onKey, true);
            document.addEventListener('timeupdate', onTime, { capture: true, passive: true });

            const column = element.querySelector('.bb-reader-transcript');
            column.addEventListener('click', onRowClick);
            const handsOff = () => { mine.handsOffAt = Date.now(); };
            column.addEventListener('wheel', handsOff, { passive: true });
            column.addEventListener('touchmove', handsOff, { passive: true });
            column.addEventListener('keydown', (event) => { if (SCROLL_KEYS.has(event.key)) handsOff(); });
            // Let go of the mouse, or of Shift after selecting with the keys:
            // the selection is finished, and only then is it read. Watching
            // selectionchange for a quiet moment instead would save half a
            // passage whenever the drag paused with the button still held.
            column.addEventListener('pointerup', onSelectEnd);
            column.addEventListener('keyup', (event) => { if (event.key === 'Shift') onSelectEnd(); });
            const notes = element.querySelector('.bb-rn-list');
            notes.addEventListener('click', onNotesClick);
            notes.addEventListener('input', onNoteInput);
            notes.addEventListener('focusout', (event) => {
                if (event.target.classList.contains('bb-rn-note')) flushNote(mine, keyOf(event.target));
            });
            element.querySelector('.bb-rn-copy').addEventListener('click', copyNotes);
            element.querySelector('.bb-reader-toast-act').addEventListener('click', () => {
                const act = mine.toastAction;
                hideToast();
                if (act) act();
            });
            document.addEventListener('fullscreenchange', onFullscreen);

            // YouTube reparents its player on some navigations. The task takes
            // it back, and reports done once the reader has closed, which is
            // DomWatch's cue to drop it.
            watcher.add('reader-player', () => {
                if (!mine.alive) return true;
                if (!mine.lent) adopt();
                return false;
            });

            Theme.appearance().then((look) => { if (mine.alive) Theme.dress(element, look); }).catch(() => {});
            transcripts.fetch(video.id).then((transcript) => {
                if (mine.alive) hydrate(transcript);
            });
            // A checkpoint saved, edited or deleted anywhere — this reader,
            // Ctrl+B, the dashboard in another tab — lands here.
            mine.unwatch = Settings.watch([Bookmarks.KEY], () => loadCheckpoints(mine));
            loadCheckpoints(mine);
            return true;
        }

        // ---------------------------------------------------- checkpoints

        async function loadCheckpoints(mine) {
            const videos = await Bookmarks.load();
            if (!mine.alive) return;
            const entry = videos.find((video) => video.id === mine.videoId);
            mine.checkpoints = entry ? entry.bookmarks : [];
            shade();
            renderNotes();
        }

        // ---------------------------------------------------------- notes

        const keyOf = (node) => {
            const item = node && node.closest('.bb-rn-item');
            return item ? item.dataset.key : '';
        };

        const findCheckpoint = (key) => session.checkpoints.find((b) => Bookmarks.bookmarkKey(b) === key);

        /**
         * The list is rebuilt only when which checkpoints there are changes.
         * A note saved — which is every pause in typing — only refreshes the
         * boxes nobody is typing in; rebuilding under the one in focus would
         * throw the caret out of it mid-word.
         */
        function renderNotes() {
            const list = session.element.querySelector('.bb-rn-list');
            const shape = session.checkpoints.map((b) => Bookmarks.bookmarkKey(b)).join('|');
            session.element.querySelector('.bb-rn-count').textContent =
                session.checkpoints.length ? `(${session.checkpoints.length})` : '';

            if (shape !== session.notesShape) {
                session.notesShape = shape;
                const focused = document.activeElement;
                const keep = list.contains(focused) && focused.classList.contains('bb-rn-note')
                    ? { key: keyOf(focused), at: focused.selectionStart } : null;
                list.innerHTML = session.checkpoints.length
                    ? session.checkpoints.map(noteHtml).join('')
                    : '<li class="bb-rn-empty">Highlight a passage in the transcript to keep it here.</li>';
                if (keep) {
                    const box = list.querySelector(`.bb-rn-item[data-key="${CSS.escape(keep.key)}"] .bb-rn-note`);
                    if (box) { box.focus(); box.setSelectionRange(keep.at, keep.at); }
                }
                return;
            }
            for (const box of list.querySelectorAll('.bb-rn-note')) {
                const key = keyOf(box);
                if (box === document.activeElement || session.pending.has(key)) continue;
                const checkpoint = findCheckpoint(key);
                if (checkpoint && box.value !== (checkpoint.note || '')) box.value = checkpoint.note || '';
            }
        }

        function onNotesClick(event) {
            const key = keyOf(event.target);
            const checkpoint = key && findCheckpoint(key);
            if (!checkpoint) return;
            if (event.target.closest('.bb-rn-time')) {
                player.seekTo(typeof checkpoint.start === 'number' ? checkpoint.start : checkpoint.time);
            } else if (event.target.closest('.bb-rn-delete')) {
                deleteCheckpoint(checkpoint);
            }
        }

        /**
         * Typing a note writes it once the typing stops, through the same
         * serialised update every other writer uses — not once a keystroke.
         */
        function onNoteInput(event) {
            if (!event.target.classList.contains('bb-rn-note')) return;
            const mine = session;
            const key = keyOf(event.target);
            const pending = mine.pending.get(key);
            if (pending) clearTimeout(pending.timer);
            mine.pending.set(key, {
                note: event.target.value,
                timer: setTimeout(() => flushNote(mine, key), NOTE_DEBOUNCE_MS),
            });
        }

        function flushNote(mine, key) {
            const pending = mine.pending.get(key);
            if (!pending) return;
            clearTimeout(pending.timer);
            mine.pending.delete(key);
            Bookmarks.update((videos) => Bookmarks.editBookmark(videos, mine.videoId, key, { note: pending.note }));
        }

        async function deleteCheckpoint(checkpoint) {
            const mine = session;
            const key = Bookmarks.bookmarkKey(checkpoint);
            await Bookmarks.update((videos) => Bookmarks.removeBookmarkById(videos, mine.videoId, key));
            if (!mine.alive) return;
            showToast('Checkpoint deleted', 'Undo', () => {
                const video = getVideo() || { id: mine.videoId };
                Bookmarks.update((videos) => Bookmarks.addBookmarks(videos, video, [checkpoint]).videos);
            });
        }

        async function copyNotes() {
            if (!session.checkpoints.length) {
                showToast('No checkpoints to copy yet');
                return;
            }
            const video = getVideo() || { id: session.videoId };
            const text = Markdown.checkpointList(video, session.checkpoints, Time.formatTime);
            const ok = await copyText(text);
            if (session) showToast(ok ? 'Copied as Markdown' : 'Could not reach the clipboard');
        }

        /** Shade the rows each checkpoint covers — by time, never by DOM position. */
        function shade() {
            if (!session.rows.length) return;
            const marks = ReaderTranscript.marksFor(session.entries, session.checkpoints);
            session.rows.forEach((row, index) => {
                if (marks[index]) row.dataset.bbMarks = String(Math.min(marks[index], 3));
                else delete row.dataset.bbMarks;
            });
        }

        /**
         * Fill the transcript column. A video with no captions says so and
         * carries on — the player and everything else in the reader work the
         * same without one.
         */
        function hydrate(transcript) {
            const column = session.element.querySelector('.bb-reader-transcript');
            session.entries = ReaderTranscript.entriesOf(transcript);
            session.active = -1;
            if (!session.entries.length) {
                column.innerHTML = '<p class="bb-reader-empty">This video has no transcript.</p>';
                return;
            }
            column.innerHTML = `<div class="bb-rt-rows">${ReaderTranscript.rowsHtml(session.entries)}</div>`;
            session.rows = Array.from(column.querySelectorAll(`.${ReaderTranscript.ROW_CLASS}`));
            shade();
            follow(player.currentTime());
        }

        // ------------------------------------------ seeking and following

        /** A click on a row plays from it — unless it ended a selection. */
        function onRowClick(event) {
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) return;
            const row = ReaderTranscript.rowAt(event.target);
            const entry = row && session.entries[ReaderTranscript.indexOf(row)];
            if (entry) player.seekTo(entry.start);
        }

        /**
         * The one timeupdate listener, in the shape the watched-video tracker
         * in main.js was fixed into: work out the row from the time alone — a
         * binary search, no layout read — and return straight away unless it
         * changed. Only a change touches the DOM, which is a few times a
         * minute rather than four times a second.
         */
        function onTime(event) {
            if (!session || !session.rows.length) return;
            const video = event.target;
            if (!session.player || !session.player.contains(video)) return;
            follow(video.currentTime);
        }

        // ------------------------------------------ highlight to checkpoint

        /**
         * Deferred a turn, so the click that ended a drag has settled it. A
         * timeout rather than a frame: a frame only comes when something on
         * screen changes, and a finished selection changes nothing.
         */
        function onSelectEnd() {
            const mine = session;
            setTimeout(() => { if (mine.alive) captureSelection(); }, 0);
        }

        function captureSelection() {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || !selection.rangeCount) return;
            const range = selection.getRangeAt(0);
            const column = session.element.querySelector('.bb-reader-transcript');
            if (!column.contains(range.commonAncestorContainer)) return;

            const span = ReaderTranscript.selectionToRange(range, session.entries);
            const text = ReaderTranscript.rangeText(range);
            if (!span || !text) return;
            const video = getVideo();
            if (!video || video.id !== session.videoId) return;

            const highlight = { video, start: span.start, end: span.end, text };
            if (getSettings().readerAutoCheckpoint === false) {
                showToast(`“${clip(text)}”`, 'Save as checkpoint', () => saveHighlight(highlight, selection));
                return;
            }
            saveHighlight(highlight, selection);
        }

        /**
         * Saved on the spot, with an Undo right there. The Undo is what makes
         * saving without asking safe enough to be the default: without it the
         * gesture is a commitment, and people stop using it.
         */
        async function saveHighlight(highlight, selection) {
            const mine = session;
            const saved = await recorder.saveHighlight(highlight);
            if (!mine.alive) return;
            if (!saved) {
                showToast('Could not save the checkpoint');
                return;
            }
            if (selection) selection.removeAllRanges();
            if (saved.repeat) {
                showToast('Already a checkpoint');
                return;
            }
            const id = saved.record.id;
            showToast(`Checkpoint saved: “${clip(highlight.text)}”`, 'Undo', () => {
                Bookmarks.update((videos) => Bookmarks.removeBookmarkById(videos, mine.videoId, id));
            });
        }

        const clip = (text) => (text.length > 48 ? `${text.slice(0, 47)}…` : text);

        function showToast(message, actionLabel, action) {
            const toast = session.element.querySelector('.bb-reader-toast');
            const button = toast.querySelector('.bb-reader-toast-act');
            toast.querySelector('.bb-reader-toast-text').textContent = message;
            button.textContent = actionLabel || '';
            button.hidden = !actionLabel;
            session.toastAction = action || null;
            toast.hidden = false;
            clearTimeout(session.toastTimer);
            session.toastTimer = setTimeout(hideToast, TOAST_MS);
        }

        function hideToast() {
            if (!session) return;
            clearTimeout(session.toastTimer);
            session.toastAction = null;
            session.element.querySelector('.bb-reader-toast').hidden = true;
        }

        function follow(t) {
            const index = ReaderTranscript.activeIndex(session.entries, t);
            if (index === session.active) return;
            const before = session.rows[session.active];
            const after = session.rows[index];
            session.active = index;
            if (before) before.classList.remove('is-active');
            if (!after) return;
            after.classList.add('is-active');
            if (getSettings().readerFollow === false) return;
            if (Date.now() - session.handsOffAt < HANDS_OFF_MS) return;
            // The column is scrolled, not the row "into view": scrollIntoView
            // also scrolls every ancestor that can be, and YouTube's page
            // under the reader is one of them — it came back from the reader
            // somewhere other than where it was left.
            const column = after.offsetParent;
            if (!column) return;
            const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            column.scrollTo({
                top: after.offsetTop - (column.clientHeight - after.offsetHeight) / 2,
                behavior: still ? 'auto' : 'smooth',
            });
        }

        /**
         * Close from anywhere — Escape, the button, a navigation. Idempotent,
         * and safe when YouTube has already destroyed the player.
         */
        function close() {
            if (!session) return;
            const done = session;
            // A note typed a moment ago is written, not lost with the panel.
            for (const key of Array.from(done.pending.keys())) flushNote(done, key);
            done.alive = false;
            clearTimeout(done.toastTimer);
            if (done.unwatch) done.unwatch();
            restore();
            session = null;
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('timeupdate', onTime, { capture: true });
            document.removeEventListener('fullscreenchange', onFullscreen);
            watcher.remove('reader-player');
            done.element.remove();
            document.documentElement.classList.remove(OPEN_CLASS);
        }

        /**
         * Switch layout live, and remember it as the one the next reader opens
         * in. The transcript is not fetched again and nothing is redrawn: the
         * grid changes under the same elements.
         */
        function setLayout(id) {
            if (!session) return;
            const layout = layoutOf(id);
            session.element.dataset.layout = layout;
            for (const button of session.element.querySelectorAll('.bb-reader-layout')) {
                button.setAttribute('aria-checked', String(button.dataset.layout === layout));
            }
            Settings.set({ readerLayout: layout });
            nudge();
        }

        function toggle() {
            if (!session) return open();
            close();
            return false;
        }

        /**
         * Escape leaves a field before it leaves the reader, so a stray press
         * mid-note does not throw the whole view away. In fullscreen it is
         * YouTube's, for leaving fullscreen.
         */
        function onKey(event) {
            if (event.key !== 'Escape' || !session || document.fullscreenElement) return;
            const active = document.activeElement;
            if (active && session.element.contains(active) && /^(TEXTAREA|INPUT|SELECT)$/.test(active.tagName)) {
                active.blur();
                return;
            }
            event.stopPropagation();
            close();
        }

        /**
         * A navigation, or the player swapping its source. Only a different
         * video closes the reader: `loadstart` also fires when an advert hands
         * back to the video, and that is no reason to throw the reader away.
         */
        function onNavigate(videoId) {
            if (session && videoId !== session.videoId) close();
        }

        return {
            open, close, toggle, onNavigate, setLayout,
            get isOpen() { return !!session; },
            /** For the specs. */
            get element() { return session ? session.element : null; },
        };
    }

    const Reader = { createReader, ROOT_ID, SLOT_ID, PLAYER_ID, OPEN_CLASS, HANDS_OFF_MS, LAYOUTS, LAYOUT_IDS };

    root.BB = root.BB || {};
    root.BB.Reader = Reader;
    if (typeof module !== 'undefined' && module.exports) module.exports = Reader;
})(typeof globalThis !== 'undefined' ? globalThis : this);
