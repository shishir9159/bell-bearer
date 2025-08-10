/**
 * The pouch panel on x.com: a column of topics over X's own navigation.
 *
 * It is deliberately not the YouTube sheet. That one is a near-full-screen
 * frosted panel because what it shows is a grid of video thumbnails, which
 * needs the room. This shows names and one-line notes, so it is drawn at the
 * width of the nav column it covers and the timeline stays readable behind
 * it — which is the point: the panel is for remembering who someone is while
 * you are reading, not a place to go and sit.
 *
 * Two levels, and no more. The first is the topics of one side; the second is
 * what is filed under one of them. Nothing here creates, renames, reorders or
 * deletes a topic, and nothing here un-saves — those are dashboard actions,
 * and the empty state says so rather than offering a button that is not
 * coming.
 *
 * Everything the panel draws is text X's users wrote — display names, handles,
 * post bodies, the user's own notes — so it all goes through escapeHtml, and
 * the one URL it interpolates (an avatar) through safeUrlAttr.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Time = ns.Time || req('../shared/time.js');
    const XPouch = ns.XPouch || req('../shared/x-pouch.js');

    const PANEL_ID = 'bb-x-pouch-panel';
    const SCRIM_ID = 'bb-x-pouch-scrim';

    /**
     * Marks everything of ours that a click may land on without dismissing
     * the panel. The outside-click rule keys off this attribute rather than
     * off containment in the panel, because the pickers on a post and on a
     * profile header are ours too and sit nowhere near it.
     */
    const KEEP = 'data-bb-keep-panel';

    const esc = (text) => Dom.escapeHtml(text);

    /**
     * `isCovered` answers "is one of ours in front of the panel right now" —
     * in practice, an open topic picker. The panel has to ask rather than
     * know: it takes Escape on document in the capture phase, which is ahead
     * of anything inside a picker, so without this the first Escape over an
     * open picker would take the whole panel down and leave the picker
     * standing on a page with nothing behind it.
     */
    function createPanel({ openDashboard, goToProfile, goToPost, onClose, isCovered }) {
        let side = 'people';
        let openTopic = null;
        let state = null;
        let host = null;
        let scrim = null;

        const isOpen = () => !!host;

        /**
         * Open over `anchor` — X's nav column — or over the left edge of the
         * viewport when there is none, which is what a narrow window gives
         * you: X collapses the nav to a strip of icons and the panel would
         * otherwise be pinned to a 60px column.
         */
        async function open(anchor) {
            if (isOpen()) return close();

            scrim = document.createElement('div');
            scrim.id = SCRIM_ID;
            scrim.className = 'bb-x-scrim';

            host = document.createElement('div');
            host.id = PANEL_ID;
            host.className = 'bb-x-panel bb-themed';
            host.setAttribute(KEEP, '1');
            host.setAttribute('role', 'dialog');
            host.setAttribute('aria-label', 'Bell Bearer pouch');

            const rect = anchor && anchor.getBoundingClientRect();
            // Left of the nav's own left edge by the padding the design puts
            // between the two, and clamped so a collapsed nav cannot push the
            // panel off screen.
            const left = rect && rect.width > 120 ? Math.max(6, rect.left + 6) : 6;
            host.style.left = `${left}px`;

            document.body.appendChild(scrim);
            document.body.appendChild(host);
            listen();

            render();
            state = await XPouch.load();
            if (isOpen()) render();
            return null;
        }

        /**
         * Every way the panel goes away comes through here — the nav row, a
         * click outside, Escape, a navigation — so `onClose` is the one place
         * the nav row's highlight is taken off. It used to be set on open and
         * cleared nowhere, which left the row lit over a closed panel.
         */
        function close() {
            if (!isOpen()) return null;
            unlisten();
            host.remove();
            scrim.remove();
            host = null;
            scrim = null;
            openTopic = null;
            if (onClose) onClose();
            return null;
        }

        /** Repaint from storage — the dashboard may have changed it under us. */
        async function refresh() {
            if (!isOpen()) return;
            state = await XPouch.load();
            if (isOpen()) render();
        }

        function dress(look) {
            if (host && ns.Theme) ns.Theme.dress(host, look);
            if (scrim && ns.Theme) ns.Theme.dress(scrim, look);
        }

        // ------------------------------------------------------ dismissal

        function onDocumentClick(event) {
            // Anything of ours, anywhere on the page, keeps the panel up.
            if (event.target.closest && event.target.closest(`[${KEEP}]`)) return;
            close();
        }

        function onKeyDown(event) {
            if (event.key !== 'Escape') return;
            // Something of ours is in front; that Escape belongs to it.
            if (isCovered && isCovered()) return;
            event.stopPropagation();
            close();
        }

        function listen() {
            // Capture, because X stops a good deal of what happens in its own
            // column from reaching the document at all.
            document.addEventListener('click', onDocumentClick, true);
            document.addEventListener('keydown', onKeyDown, true);
        }

        function unlisten() {
            document.removeEventListener('click', onDocumentClick, true);
            document.removeEventListener('keydown', onKeyDown, true);
        }

        // -------------------------------------------------------- drawing

        function render() {
            if (!host) return;
            host.innerHTML = state ? bodyHtml() : loadingHtml();
            wire();
        }

        const loadingHtml = () => `
            <div class="bb-x-seg" role="group" aria-label="People or posts">
                <button type="button" class="bb-btn bb-btn-primary" disabled>People</button>
                <button type="button" class="bb-btn" disabled>Posts</button>
            </div>
            <div class="bb-x-empty">Loading…</div>`;

        function bodyHtml() {
            const topics = XPouch.topicsOf(state, side);
            const open = openTopic ? topics.find((t) => t.id === openTopic) : null;
            return segHtml() + (open ? topicHtml(open) : topicsHtml(topics));
        }

        function segHtml() {
            const on = (id) => (side === id ? 'bb-btn bb-btn-primary' : 'bb-btn');
            return `
                <div class="bb-x-seg" role="group" aria-label="People or posts">
                    <button type="button" class="${on('people')}" data-bb-side="people"
                            aria-pressed="${side === 'people'}">People</button>
                    <button type="button" class="${on('posts')}" data-bb-side="posts"
                            aria-pressed="${side === 'posts'}">Posts</button>
                </div>`;
        }

        function topicsHtml(topics) {
            if (!topics.length) {
                return `<div class="bb-x-empty">
                    <p>No ${esc(XPouch.sideOf(side).noun)} topics yet. They are made in the dashboard.</p>
                    <button type="button" class="bb-btn" data-bb-dashboard="1">Open dashboard</button>
                </div>`;
            }
            return `<div class="bb-x-tiles">${topics.map((topic) => `
                <button type="button" class="bb-x-tile" data-bb-topic="${Dom.escapeAttr(topic.id)}">
                    <span class="bb-x-tile-name">${esc(topic.name)}</span>
                    <span class="bb-x-tile-n">${XPouch.inTopic(state, side, topic.id).length}</span>
                </button>`).join('')}</div>`;
        }

        function topicHtml(topic) {
            const items = XPouch.inTopic(state, side, topic.id);
            const rows = items.length
                ? (side === 'people' ? items.map(personHtml).join('') : items.map(postHtml).join(''))
                : `<div class="bb-x-empty">
                       <p>Nothing filed here yet. Topics are made and managed in the dashboard.</p>
                       <button type="button" class="bb-btn" data-bb-dashboard="1">Open dashboard</button>
                   </div>`;

            return `
                <div class="bb-x-tiles">
                    <div class="bb-x-tile bb-x-tile-on">
                        <span class="bb-x-tile-name">${esc(topic.name)}</span>
                        <button type="button" class="bb-x-close" data-bb-back="1" title="Back to topics"
                                aria-label="Back to topics">
                            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
                                 stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12"></path><path d="M18 6 6 18"></path></svg>
                        </button>
                    </div>
                    <div class="bb-x-items">${rows}</div>
                </div>`;
        }

        function personHtml(person) {
            return `
                <button type="button" class="bb-x-person" data-bb-handle="${Dom.escapeAttr(person.handle)}"
                        title="Open ${esc(person.handle)}">
                    ${avatarHtml(person)}
                    <span class="bb-x-person-text">
                        <span class="bb-x-person-name">${esc(person.name)}</span>
                        ${person.note ? `<span class="bb-x-person-note">${esc(person.note)}</span>` : ''}
                    </span>
                </button>`;
        }

        /**
         * The avatar over the monogram, so a picture that never arrives
         * uncovers initials rather than leaving a hole.
         *
         * The monogram is always in the markup and the <img> is stacked on
         * top of it by CSS; the image is dropped on error in wire() below,
         * which is where the fallback actually happens. That matters more
         * than it looks — the stored URL is whatever the page was showing
         * when the person was filed, and it 404s the day they change their
         * picture, with nothing ever going back to X to check. The listener
         * is attached in script rather than written as an `onerror`
         * attribute because X serves a strict CSP and an inline handler in
         * injected markup is refused without a word.
         */
        function avatarHtml(person) {
            const mono = esc(XPouch.monogram(person.name, person.handle));
            if (!person.avatar) return `<span class="bb-x-avatar">${mono}</span>`;
            return `<span class="bb-x-avatar">${mono}<img class="bb-x-avatar-img"
                src="${Dom.safeUrlAttr(person.avatar)}" alt="" loading="lazy"></span>`;
        }

        /**
         * A saved post, as a row that opens it.
         *
         * It used to be a plain <div>: the panel showed you what you had
         * saved and gave you no way to get to it, which made the Posts side a
         * list of things you had to go and find again by hand. A button
         * rather than an <a>, for the same reason the person rows are — X is
         * a single-page app and going there is a navigation it has to be told
         * about, not a link the browser follows.
         *
         * The url comes from XPouch.postUrl rather than off the record, so a
         * post filed before that field existed still opens.
         */
        function postHtml(post) {
            const when = Time.shortAge(post.postedAt || post.savedAt);
            const url = XPouch.postUrl(post);
            const head = `
                <div class="bb-x-post-head">
                    <span class="bb-x-post-handle">${esc(post.handle)}</span>
                    ${when ? `<span class="bb-x-post-when">${esc(when)}</span>` : ''}
                </div>
                ${post.text ? `<p class="bb-x-post-text">${esc(post.text)}</p>` : ''}`;

            if (!url) return `<div class="bb-x-post">${head}</div>`;
            return `
                <button type="button" class="bb-x-post bb-x-post-open"
                        data-bb-post="${Dom.escapeAttr(url)}"
                        title="Open this post">${head}</button>`;
        }

        // --------------------------------------------------------- wiring

        function wire() {
            // See avatarHtml: removing the image is what uncovers the
            // monogram underneath it.
            host.querySelectorAll('.bb-x-avatar-img').forEach((img) => {
                img.addEventListener('error', () => img.remove(), { once: true });
            });

            host.querySelectorAll('[data-bb-side]').forEach((button) => {
                button.addEventListener('click', () => {
                    // Switching sides drops back to the topic list: the open
                    // topic belongs to the side being left, and the two lists
                    // are independent, so there is nothing to keep open.
                    side = button.dataset.bbSide;
                    openTopic = null;
                    render();
                });
            });

            host.querySelectorAll('[data-bb-topic]').forEach((button) => {
                button.addEventListener('click', () => {
                    openTopic = button.dataset.bbTopic;
                    render();
                });
            });

            const back = host.querySelector('[data-bb-back]');
            if (back) back.addEventListener('click', () => { openTopic = null; render(); });

            host.querySelectorAll('[data-bb-dashboard]').forEach((button) => {
                button.addEventListener('click', () => { close(); openDashboard(); });
            });

            host.querySelectorAll('[data-bb-handle]').forEach((button) => {
                button.addEventListener('click', () => {
                    const handle = button.dataset.bbHandle;
                    close();
                    goToProfile(handle);
                });
            });

            host.querySelectorAll('[data-bb-post]').forEach((button) => {
                button.addEventListener('click', () => {
                    const url = button.dataset.bbPost;
                    close();
                    if (goToPost) goToPost(url);
                });
            });
        }

        return { open, close, refresh, dress, isOpen, KEEP };
    }

    const TwitterPanel = { createPanel, PANEL_ID, KEEP };

    root.BB = root.BB || {};
    root.BB.TwitterPanel = TwitterPanel;
    if (typeof module !== 'undefined' && module.exports) module.exports = TwitterPanel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
