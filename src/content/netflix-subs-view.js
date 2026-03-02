/**
 * Several Netflix subtitles drawn over the player as one block, in time with
 * the <video> — what src/content/netflix-subs.js has chosen and read.
 *
 * Every language is drawn here, the first one too, and Netflix's own subtitle
 * is hidden while they are. Tried against a stand-in player first:
 *  - Netflix's line left where Netflix puts it, the others set just above it.
 *    Netflix's text grows upward, so the line above jumped a whole line each
 *    time Netflix's went from one line to two.
 *  - The browser's own text tracks, one per language. It stacked them at the
 *    very bottom, under the controls, in an order of its choosing and one style
 *    for all, with nothing to say where each goes.
 *  - Side by side. Each language wraps at half the width, and the eye goes
 *    back and forth across the picture.
 * What is left is stacked about a seam (see content-netflix.css).
 *
 * Netflix's own layer is hidden with `visibility`, not `display`: it is still
 * laid out, and where Netflix puts its text — higher, while the controls are
 * up — is where the block's bottom edge goes, so the controls never cover it.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Subtitles = ns.Subtitles || req('../shared/subtitles.js');

    /** Netflix's player, which the block is drawn in, newest spelling first. */
    const PLAYER = ['.watch-video--player-view', '.watch-video', '[data-uia="player"]'];

    /** Netflix's own subtitle layer, and the box its text is set in. */
    const OWN = '.player-timedtext';
    const OWN_TEXT = '.player-timedtext-text-container';

    const LAYOUTS = ['stack'];
    const layoutOf = (value) => (LAYOUTS.includes(value) ? value : LAYOUTS[0]);

    function createView({
        watcher,
        getVideoElement,
        doc = root.document,
        frame = (run) => root.requestAnimationFrame(run),
    }) {
        /** What is drawn: [{ track, cues }], the first language first. */
        let showing = [];
        let layout = LAYOUTS[0];
        let overlay = null;
        let hideOwn = null;
        /** Netflix's own layer, watched so the block follows it up and down with the controls. */
        let ownWatch = null;
        let watchedOwn = null;
        /** The span of time the lines on screen hold for: [from, until). */
        let span = [Infinity, -Infinity];
        let looping = false;
        let video = null;

        function mount() {
            video = getVideoElement();
            const player = video && video.closest(PLAYER.join(','));
            if (!player) return false;
            if (!overlay) {
                overlay = doc.createElement('div');
                overlay.className = 'bb-nf-subs';
                overlay.setAttribute('aria-hidden', 'true');
                overlay.dataset.layout = layout;
                const seam = overlay.appendChild(doc.createElement('div'));
                seam.className = 'bb-nf-seam';
                for (const side of ['above', 'below']) seam.appendChild(doc.createElement('div')).className = `bb-nf-block bb-nf-${side}`;
            }
            const own = player.querySelector(OWN);
            if (overlay.parentNode !== player) {
                // Beside Netflix's own layer, so its controls, later in the
                // player, still paint over the block as they do over Netflix's.
                if (own && own.parentNode === player) own.after(overlay);
                else player.appendChild(overlay);
            }
            // Measured only as the block's own lines changed, the edge lagged:
            // the controls came up, Netflix lifted its text, and the block
            // stayed under them until its next cue.
            if (own !== watchedOwn) {
                if (ownWatch) ownWatch.disconnect();
                watchedOwn = own;
                if (own && typeof MutationObserver === 'function') {
                    ownWatch = ownWatch || new MutationObserver(() => { if (overlay) anchor(); });
                    ownWatch.observe(own, { subtree: true, childList: true, attributes: true, characterData: true });
                }
            }
            if (!hideOwn || !hideOwn.isConnected) {
                hideOwn = doc.createElement('style');
                hideOwn.textContent = `${OWN} { visibility: hidden !important; }`;
                (doc.head || doc.documentElement).appendChild(hideOwn);
            }
            return true;
        }

        function unmount() {
            if (overlay) overlay.remove();
            if (hideOwn) hideOwn.remove();
            if (ownWatch) ownWatch.disconnect();
            overlay = null;
            hideOwn = null;
            watchedOwn = null;
        }

        /** A cue's runs as nodes: italic in <i>, each line break a <br>. */
        function cueNode(cue) {
            const node = doc.createElement('span');
            node.className = 'bb-nf-cue';
            for (const part of cue.parts) {
                const holder = part.italic ? node.appendChild(doc.createElement('i')) : node;
                part.text.split('\n').forEach((line, index) => {
                    if (index) holder.appendChild(doc.createElement('br'));
                    if (line) holder.appendChild(doc.createTextNode(line));
                });
            }
            return node;
        }

        /** Where Netflix would set its text, as the block's bottom edge; kept while Netflix shows none. */
        function anchor() {
            const own = overlay.parentNode && overlay.parentNode.querySelector(OWN_TEXT);
            if (!own) return;
            const mine = overlay.getBoundingClientRect();
            const theirs = own.getBoundingClientRect();
            if (theirs.height > 0 && mine.height > 0) {
                overlay.style.setProperty('--bb-nf-bottom', `${Math.max(0, Math.round(mine.bottom - theirs.bottom))}px`);
            }
        }

        function draw(force = false) {
            if (!showing.length) return;
            if ((!overlay || !overlay.isConnected) && !mount()) return;
            const time = video.currentTime;
            if (!force && time >= span[0] && time < span[1]) return;
            let until = Infinity;
            const lines = showing.map(({ track, cues }) => {
                until = Math.min(until, Subtitles.nextChange(cues, time));
                return { track, cues: Subtitles.cuesAt(cues, time) };
            });
            span = [time, until];
            const [above, below] = ['above', 'below'].map((name) => overlay.querySelector(`.bb-nf-${name}`));
            [above, below].forEach((block) => { block.textContent = ''; });
            overlay.dataset.count = String(lines.length);
            lines.forEach(({ track, cues }, index) => {
                const row = doc.createElement('div');
                row.className = 'bb-nf-track';
                row.dataset.n = String(index);
                row.lang = track.language;
                cues.forEach((cue) => row.appendChild(cueNode(cue)));
                (index ? below : above).appendChild(row);
            });
            anchor();
        }

        /** Every frame while playing; one look on a pause or a seek, which the loop is not running for. */
        function tick() {
            if (!looping) return;
            if (!showing.length || !video || video.paused) {
                looping = false;
                return;
            }
            draw();
            frame(tick);
        }

        function wake() {
            const current = getVideoElement();
            if (current && current !== video) {
                video = current;
                span = [Infinity, -Infinity];
            }
            draw();
            if (!looping && video && !video.paused) {
                looping = true;
                frame(tick);
            }
        }

        /** Draw `next` from now on — [{ track, cues }] — or, empty, nothing, and Netflix's own back. */
        function show(next) {
            showing = next || [];
            span = [Infinity, -Infinity];
            if (!showing.length) unmount();
            else wake();
        }

        function setLayout(value) {
            layout = layoutOf(value);
            if (overlay) overlay.dataset.layout = layout;
        }

        function install() {
            // Media events do not bubble, but they cross the capture path.
            ['play', 'playing', 'seeked', 'timeupdate'].forEach((type) => doc.addEventListener(type, (event) => {
                if (event.target && event.target.tagName === 'VIDEO' && showing.length) wake();
            }, { capture: true, passive: true }));
            // Netflix redraws its player on its own schedule; a block it
            // threw out goes back in on the next pass.
            watcher.add('netflix-subs', () => {
                if (showing.length && (!overlay || !overlay.isConnected) && mount()) draw(true);
                return false;
            });
        }

        return { install, show, setLayout, isShowing: () => showing.length > 0 };
    }

    const NetflixSubsView = { createView, LAYOUTS, layoutOf };

    root.BB = root.BB || {};
    root.BB.NetflixSubsView = NetflixSubsView;
    if (typeof module !== 'undefined' && module.exports) module.exports = NetflixSubsView;
})(typeof globalThis !== 'undefined' ? globalThis : this);
