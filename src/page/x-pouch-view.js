/**
 * The dashboard's X pouch: one panel per side, each a list of topic cards.
 *
 * This is where the X pouch is actually managed. The panel on x.com reads and
 * files; everything that changes the shape of the pouch — making a topic,
 * renaming it, dragging it into a different place in the order, deleting it
 * and everything in it, writing the note under someone's name, taking a saved
 * post back out — happens here and nowhere else. That split is the design's,
 * and it is a good one: those are decisions you make while looking at the
 * whole pouch, not while reading a post.
 *
 * Both sides draw from one renderer. People topics and post topics are
 * independent lists of independent items, but a topic card is a topic card —
 * a header with a name, a tally, a pen and a trash, and rows under it — so the
 * two differ only in what a row looks like and what a tally counts.
 *
 * Rendered wholesale into innerHTML on every change, with listeners bound once
 * on the container and dispatched by delegation, exactly as dashboard.js does
 * it. The comment at the head of that file says why: a per-render listener
 * meant one "remove" click ran three deletes after three renders.
 *
 * Everything interpolated is text other people wrote — display names, handles,
 * post bodies — so it all goes through escapeHtml, and the avatar URL through
 * safeUrlAttr.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Settings, XPouch, Dom, Time } = BB;

    const esc = (text) => Dom.escapeHtml(text);
    const att = (text) => Dom.escapeAttr(text);

    const ICONS = {
        grip: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
        pen: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
        tick: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
        trash: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7v13h12V7"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>',
        cross: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>',
    };

    /**
     * Transient UI state, per panel. Deliberately not in storage: which card
     * is mid-rename and which note has the caret in it are facts about this
     * tab in this second, and persisting them would restore a half-typed
     * rename on the next visit.
     */
    function blankState() {
        return { renaming: null, confirming: null, editingNote: null, dragId: null };
    }

    function mountPanel(host, side) {
        const ui = blankState();
        let pouch = { peopleTopics: [], postTopics: [], people: [], posts: [] };

        host.innerHTML = `
            <div class="subscriptions-header">
                <h2>${side === 'people' ? 'People' : 'Posts'}</h2>
                <div class="subscriptions-controls">
                    <button class="btn-primary" data-x-add="1">+ Add Topic</button>
                </div>
            </div>
            <p class="x-pouch-hint">${side === 'people'
                ? 'People and posts keep separate topic lists. Notes are three to five words — click one to edit it.'
                : 'People and posts keep separate topic lists. Taking a saved post back out happens here.'}</p>
            <div class="topics-container x-pouch-topics"></div>`;

        const list = host.querySelector('.x-pouch-topics');

        function render() {
            const topics = XPouch.topicsOf(pouch, side);
            list.innerHTML = topics.length
                ? topics.map(cardHtml).join('')
                : `<div class="empty-state"><div class="empty-icon">\u{1F516}</div>
                       <p>No ${esc(XPouch.sideOf(side).noun)} topics yet. Add one, then file ${
                           side === 'people' ? 'people from their profile on x.com' : 'posts from the timeline'}.</p>
                   </div>`;
        }

        function cardHtml(topic) {
            const items = XPouch.inTopic(pouch, side, topic.id);
            const renaming = ui.renaming === topic.id;
            const n = items.length;

            return `
            <div class="topic-card x-topic" draggable="true" data-x-id="${att(topic.id)}"
                 ${ui.dragId === topic.id ? 'data-x-dragging="1"' : ''}>
                <div class="x-topic-head">
                    <span class="x-grip" title="Drag to reorder" aria-hidden="true">${ICONS.grip}</span>
                    ${renaming
                        ? `<input class="text-control x-rename" value="${att(topic.name)}" maxlength="60" aria-label="Topic name">
                           <button class="icon-act" data-x-act="rename-save" title="Save name">${ICONS.tick}</button>`
                        : `<h3 class="bb-title">${esc(topic.name)}</h3>
                           <button class="icon-act" data-x-act="rename" title="Rename topic">${ICONS.pen}</button>`}
                    <span class="x-tally">${n} ${n === 1 ? XPouch.sideOf(side).one : XPouch.sideOf(side).noun}</span>
                    <button class="icon-act icon-danger" data-x-act="ask-delete" title="Delete topic">${ICONS.trash}</button>
                </div>
                ${ui.confirming === topic.id ? confirmHtml(topic) : ''}
                <div class="x-rows">
                    ${items.length
                        ? items.map(side === 'people' ? personHtml : postHtml).join('')
                        : '<p class="x-empty-row">Nothing filed here yet.</p>'}
                </div>
            </div>`;
        }

        const confirmHtml = (topic) => `
            <div class="x-confirm">
                <span>Delete ${esc(topic.name)} and everything in it?</span>
                <span class="x-confirm-acts">
                    <button class="btn-secondary" data-x-act="cancel-delete">Cancel</button>
                    <button class="btn-primary" data-x-act="delete">Delete it all</button>
                </span>
            </div>`;

        /**
         * The avatar sits on top of the monogram rather than instead of it, so
         * a URL that has gone stale — the person changed their picture, and
         * nothing ever goes back to X to check — uncovers initials instead of
         * leaving a broken image. The error listener is bound in wire().
         */
        function avatarHtml(person) {
            const mono = esc(XPouch.monogram(person.name, person.handle));
            if (!person.avatar) return `<span class="x-avatar">${mono}</span>`;
            return `<span class="x-avatar">${mono}<img class="x-avatar-img"
                src="${Dom.safeUrlAttr(person.avatar)}" alt="" loading="lazy"></span>`;
        }

        function personHtml(person) {
            const editing = ui.editingNote === person.id;
            return `
            <div class="x-row" data-x-item="${att(person.id)}">
                ${avatarHtml(person)}
                <span class="x-who">
                    <span class="x-name">${esc(person.name)}</span>
                    <span class="x-handle">${esc(person.handle)}</span>
                </span>
                ${editing
                    ? `<input class="text-control x-note-input" value="${att(person.note || '')}"
                              placeholder="3–5 words" maxlength="80" aria-label="Note">`
                    : `<button class="x-note" data-x-act="edit-note" title="Click to edit">${
                           person.note ? esc(person.note) : '<span class="x-note-blank">Add a note</span>'}</button>`}
                <button class="icon-act icon-danger" data-x-act="remove" title="Remove from topic">${ICONS.cross}</button>
            </div>`;
        }

        /**
         * A saved post, as a row you can open.
         *
         * The handle and the body are inside the anchor rather than beside a
         * separate link, which is what they used to be: the link was the age
         * ("6h") in small type at the end of the row, so a saved post looked
         * like a record of something rather than a way back to it. The whole
         * of the post is now the target, which is how every other list of
         * posts anywhere behaves.
         *
         * The url comes from XPouch.postUrl rather than off the record, so a
         * post filed before that field existed still opens.
         */
        function postHtml(post) {
            const when = Time.shortAge(post.postedAt || post.savedAt);
            const url = XPouch.postUrl(post);
            const body = `<span class="x-post-handle">${esc(post.handle)}</span>
                <span class="x-post-text">${esc(post.text) || '<em>No text — an image or video post.</em>'}</span>`;

            return `
            <div class="x-row x-row-post" data-x-item="${att(post.id)}">
                ${url
                    ? `<a class="x-post-open" href="${Dom.safeUrlAttr(url)}" target="_blank"
                          rel="noopener noreferrer" title="Open this post on x.com">${body}</a>`
                    : `<span class="x-post-open is-dead" title="This post has no link to open">${body}</span>`}
                <span class="x-post-when">${esc(when)}</span>
                <button class="icon-act icon-danger" data-x-act="remove" title="Remove from pouch">${ICONS.cross}</button>
            </div>`;
        }

        // ---------------------------------------------------------- wiring

        const topicIdOf = (el) => {
            const card = el.closest('.x-topic');
            return card && card.dataset.xId;
        };

        async function reload() {
            pouch = await XPouch.load();
            render();
        }

        host.querySelector('[data-x-add]').addEventListener('click', async () => {
            const name = await BB.Ui.promptDialog({
                title: `Add a ${XPouch.sideOf(side).one} topic`,
                label: 'Topic name',
                placeholder: side === 'people' ? 'ML, CUDA, Diffusion…' : 'Papers, Benchmarks, Read later…',
            });
            if (!name) return;
            await XPouch.createTopic(side, name);
            await reload();
        });

        list.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-x-act]');
            if (!button) return;
            const topicId = topicIdOf(button);
            const row = button.closest('[data-x-item]');
            const itemId = row && row.dataset.xItem;

            switch (button.dataset.xAct) {
                case 'rename':
                    // One card at a time, and never while another is
                    // mid-confirm: two open editors on one list is how you
                    // save a name into the wrong topic.
                    ui.renaming = topicId;
                    ui.confirming = null;
                    render();
                    focusIn('.x-rename', topicId);
                    break;

                case 'rename-save': {
                    const input = list.querySelector(`[data-x-id="${CSS.escape(topicId)}"] .x-rename`);
                    ui.renaming = null;
                    if (input) await XPouch.renameTopic(side, topicId, input.value);
                    await reload();
                    break;
                }

                case 'ask-delete':
                    ui.confirming = topicId;
                    ui.renaming = null;
                    render();
                    break;

                case 'cancel-delete':
                    ui.confirming = null;
                    render();
                    break;

                case 'delete':
                    ui.confirming = null;
                    await XPouch.deleteTopic(side, topicId);
                    await reload();
                    break;

                case 'edit-note':
                    ui.editingNote = itemId;
                    render();
                    focusIn('.x-note-input', topicId);
                    break;

                case 'remove':
                    await XPouch.remove(side, itemId);
                    await reload();
                    break;

                default:
                    break;
            }
        });

        /**
         * Commit a note when the field loses the caret, which is what the
         * design specifies and is also the only thing that works: the field is
         * inside a list that re-renders, so a "Save" button next to it would
         * be a second click for something the next click already ends.
         *
         * On the container in the capture phase, because `blur` and `focusout`
         * do not bubble the same way and a delegated `blur` needs capture to
         * be seen at all.
         */
        list.addEventListener('blur', async (event) => {
            if (!event.target.classList || !event.target.classList.contains('x-note-input')) return;
            const row = event.target.closest('[data-x-item]');
            const value = event.target.value;
            ui.editingNote = null;
            if (row) await XPouch.setNote(row.dataset.xItem, value);
            await reload();
        }, true);

        // Enter commits a rename or a note, Escape abandons it. Without this
        // Enter in the rename field submits nothing and the name is lost on
        // the next re-render.
        list.addEventListener('keydown', (event) => {
            const isRename = event.target.classList && event.target.classList.contains('x-rename');
            const isNote = event.target.classList && event.target.classList.contains('x-note-input');
            if (!isRename && !isNote) return;

            if (event.key === 'Enter') {
                event.preventDefault();
                if (isNote) {
                    // The blur listener above is what commits a note, so
                    // Enter only has to give up the caret.
                    event.target.blur();
                } else {
                    const save = list.querySelector(
                        `[data-x-id="${CSS.escape(topicIdOf(event.target))}"] [data-x-act="rename-save"]`);
                    if (save) save.click();
                }
            } else if (event.key === 'Escape') {
                event.preventDefault();
                ui.renaming = null;
                ui.editingNote = null;
                render();
            }
        });

        // ------------------------------------------------------ reordering

        list.addEventListener('dragstart', (event) => {
            const card = event.target.closest('.x-topic');
            if (!card) return;
            ui.dragId = card.dataset.xId;
            // Firefox refuses to start a drag at all without something on the
            // dataTransfer; the value is never read.
            if (event.dataTransfer) event.dataTransfer.setData('text/plain', ui.dragId);
            card.setAttribute('data-x-dragging', '1');
        });

        list.addEventListener('dragover', (event) => {
            if (ui.dragId) event.preventDefault();
        });

        list.addEventListener('drop', async (event) => {
            const card = event.target.closest('.x-topic');
            if (!card || !ui.dragId) return;
            event.preventDefault();
            const dragged = ui.dragId;
            ui.dragId = null;
            await XPouch.moveTopic(side, dragged, card.dataset.xId);
            await reload();
        });

        list.addEventListener('dragend', () => {
            ui.dragId = null;
            list.querySelectorAll('[data-x-dragging]').forEach((el) => el.removeAttribute('data-x-dragging'));
        });

        /** Put the caret where the click implied it should go. */
        function focusIn(selector, topicId) {
            const field = list.querySelector(`[data-x-id="${CSS.escape(topicId)}"] ${selector}`);
            if (!field) return;
            field.focus();
            field.select();
        }

        return { reload, render, wireImages: () => {} };
    }

    /**
     * Draw every `[data-x-pouch]` panel under `scope` and keep it current.
     *
     * Following the store is not optional here: the panel on x.com writes to
     * the same four keys from another tab, and a dashboard that only read on
     * load would show a pouch that is minutes out of date while the user is
     * actively filing into it.
     */
    function mountAll(scope = document) {
        const hosts = Array.from(scope.querySelectorAll('[data-x-pouch]'));
        if (!hosts.length) return;

        const panels = hosts.map((host) => {
            const panel = mountPanel(host, host.dataset.xPouch);
            panel.reload();
            return panel;
        });

        // The avatar fallback: the image is stacked over the monogram by CSS,
        // so dropping a broken one uncovers the initials. Delegated to the
        // document in the capture phase because `error` does not bubble.
        document.addEventListener('error', (event) => {
            const img = event.target;
            if (img && img.classList && img.classList.contains('x-avatar-img')) img.remove();
        }, true);

        Settings.watch(XPouch.KEYS, () => panels.forEach((panel) => panel.reload()));
    }

    BB.XPouchView = { mountAll, mountPanel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
