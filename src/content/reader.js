/**
 * The distraction-free reader: YouTube's own player at a size you pick, the
 * transcript beside it, and your checkpoints under that.
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

    const ROOT_ID = 'bb-reader';
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
            };
            const mine = session;

            document.body.appendChild(element);
            document.documentElement.classList.add(OPEN_CLASS);

            element.querySelector('.bb-reader-close').addEventListener('click', close);
            document.addEventListener('keydown', onKey, true);

            Theme.appearance().then((look) => { if (mine.alive) Theme.dress(element, look); }).catch(() => {});
            transcripts.fetch(video.id).then((transcript) => {
                if (mine.alive) hydrate(transcript);
            });
            return true;
        }

        function hydrate(transcript) {
            const column = session.element.querySelector('.bb-reader-transcript');
            if (!transcript) column.innerHTML = '<p class="bb-reader-empty">This video has no transcript.</p>';
        }

        /** Close from anywhere — Escape, the button, a navigation. Idempotent. */
        function close() {
            if (!session) return;
            const done = session;
            done.alive = false;
            session = null;
            document.removeEventListener('keydown', onKey, true);
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

    const Reader = { createReader, ROOT_ID, PLAYER_ID, OPEN_CLASS };

    root.BB = root.BB || {};
    root.BB.Reader = Reader;
    if (typeof module !== 'undefined' && module.exports) module.exports = Reader;
})(typeof globalThis !== 'undefined' ? globalThis : this);
