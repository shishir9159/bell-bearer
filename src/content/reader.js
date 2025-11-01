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

    const ROOT_ID = 'bb-reader';
    const SLOT_ID = 'bb-reader-slot';
    const PLAYER_ID = 'movie_player';
    /** On <html> while the reader is up; content.css keys everything off it. */
    const OPEN_CLASS = 'bb-reader-open';

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
                </aside>
            </div>`;
    }

    function createReader({ watcher, getVideo, transcripts }) {
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
                active: -1,
            };
            const mine = session;

            document.body.appendChild(element);
            document.documentElement.classList.add(OPEN_CLASS);
            adopt();

            element.querySelector('.bb-reader-close').addEventListener('click', close);
            document.addEventListener('keydown', onKey, true);
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
            return true;
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
        }

        /**
         * Close from anywhere — Escape, the button, a navigation. Idempotent,
         * and safe when YouTube has already destroyed the player.
         */
        function close() {
            if (!session) return;
            const done = session;
            done.alive = false;
            restore();
            session = null;
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('fullscreenchange', onFullscreen);
            watcher.remove('reader-player');
            done.element.remove();
            document.documentElement.classList.remove(OPEN_CLASS);
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
            open, close, toggle, onNavigate,
            get isOpen() { return !!session; },
            /** For the specs. */
            get element() { return session ? session.element : null; },
        };
    }

    const Reader = { createReader, ROOT_ID, SLOT_ID, PLAYER_ID, OPEN_CLASS };

    root.BB = root.BB || {};
    root.BB.Reader = Reader;
    if (typeof module !== 'undefined' && module.exports) module.exports = Reader;
})(typeof globalThis !== 'undefined' ? globalThis : this);
