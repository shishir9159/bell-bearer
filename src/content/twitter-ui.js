/**
 * Everything Bell Bearer injects into x.com: the Pouch row in the left
 * navigation, the pouch button on every post, the add-to-pouch button on a
 * profile header, and the topic picker both of those open.
 *
 * The panel the nav row opens is not here — it is src/content/twitter-panel.js.
 * Reading X's DOM is not here either — that is src/content/twitter-page.js,
 * which holds every selector. What is left in this file is where our own
 * elements go and what they do, which is the part that changes for reasons of
 * ours rather than X's.
 *
 * The button itself is shared with YouTube rather than written again — it is
 * shared/pouch-button.js, so the glyph and the filed state are the same mark
 * on both sites and change in one place. The nav row wears that same glyph,
 * which is where this file parts company with YouTube's drawer entry: that one
 * carries the extension's artwork, and this one cannot. X's navigation is a
 * column of outline marks that take their colour from the theme, and a square
 * of artwork dropped into it reads as an advert — so the row is drawn in
 * currentColor and takes its type off the rows around it. See dressNavEntry.
 *
 * The button is never labelled. On YouTube it sits in the subscribe row with
 * room for words; here it sits in X's action row between Repost and Like,
 * which is a row of bare glyphs, so writing "Pouch" on it would make it the
 * only labelled control in the row and read as something X had added.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Settings = ns.Settings || req('../shared/settings.js');
    const XPouch = ns.XPouch || req('../shared/x-pouch.js');
    const PouchButton = ns.PouchButton || req('../shared/pouch-button.js');
    const Theme = ns.Theme || req('./theme.js');
    const TwitterPage = ns.TwitterPage || req('./twitter-page.js');
    const TwitterPanel = ns.TwitterPanel || req('./twitter-panel.js');

    const NAV_ID = 'bb-x-nav-entry';
    const PROFILE_BUTTON_ID = 'bb-x-profile-btn';
    const PICKER_ID = 'bb-x-picker';
    const KEEP = TwitterPanel.KEEP;

    const CONTEXT_LOST = 'Bell Bearer was updated — please refresh this page.';

    /** chrome.* throws once the extension reloads; a live id means we are fine. */
    const hasExtensionContext = () => !!(chrome.runtime && chrome.runtime.id);

    /**
     * The properties the nav row copies off X's own, and nothing more.
     *
     * Colour is pointedly not in the list. `color: inherit` in content.css
     * follows X's theme the instant it changes; a value read once and written
     * into a style attribute would be the old theme's grey forever.
     */
    const NAV_TYPE = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing'];

    /**
     * The text of a nav row — the word, not the unread badge.
     *
     * The badge is a span of digits in much smaller type sitting in the same
     * link, and copying its metrics gave the Pouch row a 12px label.
     */
    function navLabel(row) {
        for (const selector of ['div[dir] > span', 'span']) {
            for (const span of row.querySelectorAll(selector)) {
                const text = (span.textContent || '').trim();
                if (text && !/^\d+\+?$/.test(text)) return span;
            }
        }
        return null;
    }

    /**
     * What a cell of X's action row is copied by, when ours goes in beside it.
     *
     * `display` is handled separately in slotFor — everything here is a value
     * that can be carried across as it stands.
     */
    const SLOT_LAYOUT = ['flexGrow', 'flexShrink', 'flexBasis', 'justifyContent',
        'minWidth', 'maxWidth', 'marginLeft', 'marginRight'];

    /**
     * Our button, wrapped the way X wraps its own.
     *
     * The action row is laid out differently in a post in the timeline and in
     * a post opened on its own page. In the timeline the cells are bare and
     * evenly spaced; on a post's own page each one is a growing flex cell with
     * the glyph centred inside it. A bare <button> inserted as a sibling is
     * right in the first case and sits half a line low in the second, which is
     * exactly what it did — so the cell beside it is measured rather than
     * guessed at.
     */
    function slotFor(button, model) {
        const holder = document.createElement('div');
        holder.className = 'bb-x-post-slot';
        holder.setAttribute(KEEP, '1');
        holder.appendChild(button);
        if (!model || typeof getComputedStyle !== 'function') return holder;

        const style = getComputedStyle(model);
        for (const property of SLOT_LAYOUT) {
            if (style[property]) holder.style[property] = style[property];
        }
        // Whatever the cell beside us is, ours centres its one child. A
        // `block` or `inline` carried straight across would put the glyph on
        // the row's text baseline, which is the drop this is here to fix.
        holder.style.display = /flex/.test(style.display) ? style.display : 'flex';
        holder.style.alignItems = 'center';
        return holder;
    }

    /**
     * A cell of X's own action row to copy, when the bookmark's is not there
     * to use — a post whose bookmark X has not rendered still has a Reply and
     * a Like, and either is the same cell.
     */
    function rowModel(actions, preferred) {
        if (preferred) return preferred;
        for (const id of ['like', 'unlike', 'retweet', 'unretweet', 'reply']) {
            const control = actions.querySelector(`[data-testid="${id}"]`);
            const slot = control && control.closest('[role="group"] > *');
            if (slot) return slot;
        }
        return null;
    }

    /**
     * Dress our profile button as one of X's own header rings.
     *
     * The row beside Follow is More / notify / message, and all three are the
     * same circle: X's border grey, which is a good deal lighter than the text
     * next to it, at whatever size X's display setting is currently drawing
     * them. Ours was a hard 36px ring in `currentColor`, so it was both a
     * shade too dark and two pixels too tall — which is what pushed it off the
     * line the others sit on.
     *
     * Written as custom properties rather than as `width` and `border-color`
     * so that content.css keeps the last word: the filed state fills the ring
     * with the accent, and an inline colour would win over it forever.
     */
    function wearRing(button, model) {
        if (!model || typeof getComputedStyle !== 'function') return;
        const style = getComputedStyle(model);

        const size = Math.round(model.getBoundingClientRect().height);
        if (size) button.style.setProperty('--bb-x-ring-size', `${size}px`);
        if (parseFloat(style.borderTopWidth) > 0) {
            button.style.setProperty('--bb-x-ring', style.borderTopColor);
            button.style.setProperty('--bb-x-ring-width', style.borderTopWidth);
        }
        // X spaces this row with its own margins in one layout and with a gap
        // in another. Copying the model's means we are spaced the way it is,
        // and a zero here is an answer rather than a gap to fill in.
        button.style.marginLeft = style.marginLeft;
        button.style.marginRight = style.marginRight;
    }

    /**
     * The ring in a profile header to measure. The More button itself, unless
     * X has moved the border onto something inside it.
     */
    function ringModel(actions) {
        if (typeof getComputedStyle !== 'function') return actions;
        const bordered = (element) => parseFloat(getComputedStyle(element).borderTopWidth) > 0;
        if (bordered(actions)) return actions;
        for (const inner of actions.querySelectorAll('div')) {
            if (bordered(inner)) return inner;
        }
        return actions;
    }

    function createTwitterUi({ watcher, notify }) {
        /**
         * The pouch, held here so that deciding whether a post is already
         * filed does not read storage once per post on a timeline that is
         * still scrolling. Dropped whenever anything writes, including from
         * the dashboard in another tab.
         */
        let pouch = null;

        async function state() {
            if (!pouch) pouch = await XPouch.load();
            return pouch;
        }

        const panel = TwitterPanel.createPanel({
            openDashboard: () => {
                try {
                    chrome.runtime.sendMessage({ action: 'openDashboard', hash: '#site/twitter' });
                } catch (_) { /* the extension reloaded out from under this page */ }
            },
            // X is a single-page app; a full navigation would throw away the
            // timeline the user was reading. Its own nav links are what it
            // listens to, so a synthesised click on one is the only way in
            // from outside — and there is not always one for an arbitrary
            // handle, hence the assign() fallback.
            goToProfile: (handle) => {
                const path = `/${String(handle).replace(/^@/, '')}`;
                const link = document.querySelector(`a[href="${CSS.escape(path)}"]`);
                if (link) link.click();
                else location.assign(`https://x.com${path}`);
            },
            onClose: () => setNavActive(false),
            // A picker is drawn over the panel, so it takes Escape first.
            isCovered: () => !!document.getElementById(PICKER_ID),
        });

        // A write from anywhere — this page, another tab, the dashboard —
        // invalidates the cache and repaints whatever is on screen.
        Settings.watch(XPouch.KEYS, () => {
            pouch = null;
            markAll();
            panel.refresh();
        });

        // ------------------------------------------------------- nav entry

        /**
         * A Pouch row in X's left navigation, under Home.
         *
         * Not styled by copying X's classes: they are emotion-generated
         * (`css-1jxf684` and friends) and change on every deploy, so the row
         * is ours and content.css matches its metrics to the rows around it.
         *
         * Never reports itself done, unlike YouTube's drawer entry. X rebuilds
         * its navigation column on its own schedule — not only on a
         * navigation, which is the only thing onNavigate would catch — and a
         * task that retired after placing the row once would leave the row
         * gone for the rest of the session. getElementById is what keeps that
         * cheap: it only finds the row while the row is still in the
         * document, so a rebuild that took it away is also what puts it back.
         */
        function injectNavEntry() {
            const nav = TwitterPage.find('nav');
            if (!nav) return false;
            if (document.getElementById(NAV_ID)) return false;

            const entry = document.createElement('div');
            entry.id = NAV_ID;
            entry.className = 'bb-x-nav';
            entry.setAttribute(KEEP, '1');
            entry.setAttribute('role', 'link');
            entry.setAttribute('tabindex', '0');
            entry.title = 'Bell Bearer — your pouch';
            // An inline glyph rather than the extension's artwork. The <img>
            // that used to be here was run through Dom.safeUrlAttr, which
            // only passes http(s) and so turned every `chrome-extension://`
            // src into "#" — a broken image in X's navigation column. Drawing
            // the mark instead fixes that and is the better row anyway: it
            // inherits X's colour the way its own nav icons do, so a switch
            // to Dim or Lights out needs nothing from us.
            entry.innerHTML =
                '<span class="bb-x-nav-ico">' + PouchButton.ICON + '</span>' +
                '<span class="bb-x-nav-text">Pouch</span>';

            const open = () => togglePanel();
            entry.addEventListener('click', open);
            entry.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                open();
            });

            // Under Home, which is where the design puts it and where the eye
            // looks first. Appended to the end of the nav when Home is not
            // found rather than not placed at all.
            const home = TwitterPage.find('navHome');
            const after = home && home.parentElement === nav ? home : (home && home.closest('nav > *'));
            if (after && after.parentElement === nav) nav.insertBefore(entry, after.nextSibling);
            else nav.appendChild(entry);

            // After it is in the document, so the metrics below are measured
            // rather than guessed.
            dressNavEntry(entry, home);

            // The panel may still be open — a rebuild of the nav does not
            // close it — so the new row has to be lit if it is.
            setNavActive(panel.isOpen());
            return false;
        }

        /**
         * Match the row to the ones around it.
         *
         * content.css carries numbers measured off X's navigation, but they
         * are one reading of it: X has a display-size setting that scales both
         * the label and the icons of that column, and at the largest size a
         * hard 19px/26px row sits visibly small among the others. None of this
         * can be done by copying a class — every class on that column is
         * emotion-generated and renamed on each deploy — so the numbers are
         * read off the Home row instead, and the CSS stays as the fallback for
         * when Home is not there to read.
         *
         * Nothing has to re-run this: X rebuilds the navigation when either
         * setting changes, and injectNavEntry never retires, so the new column
         * gets a freshly measured row.
         */
        function dressNavEntry(entry, home) {
            if (!home || typeof getComputedStyle !== 'function') return;

            const label = navLabel(home);
            const text = entry.querySelector('.bb-x-nav-text');
            if (label && text) {
                const style = getComputedStyle(label);
                for (const property of NAV_TYPE) {
                    if (style[property]) text.style[property] = style[property];
                }
            }

            const glyph = home.querySelector('svg');
            const size = glyph && Math.round(glyph.getBoundingClientRect().height);
            const box = entry.querySelector('.bb-x-nav-ico');
            if (size && box) {
                box.style.flexBasis = `${size}px`;
                box.style.width = `${size}px`;
                box.style.height = `${size}px`;
            }
        }

        async function togglePanel() {
            if (!hasExtensionContext()) return notify(CONTEXT_LOST, 'warning');
            if (panel.isOpen()) return panel.close();

            closePicker();
            const nav = TwitterPage.find('nav');
            await panel.open(nav);
            panel.dress(await Theme.appearance());
            setNavActive(true);
            return null;
        }

        function setNavActive(on) {
            const entry = document.getElementById(NAV_ID);
            if (entry) entry.classList.toggle('bb-x-nav-on', on);
        }

        // ---------------------------------------------------- post buttons

        /**
         * One pouch button per post, in place of X's bookmark.
         *
         * Never returns true: unlike YouTube's subscribe button, which exists
         * once per page, posts arrive for as long as the timeline is
         * scrolled, so this task stays registered for the life of the page.
         *
         * "Already done" is the presence of our button rather than a marker
         * attribute, which is the subtler of the two and the right one: X
         * re-renders a post's action row on its own — liking something is
         * enough — and a marker alone would leave a button it wiped out
         * un-replaced for the life of the page. The only marker kept is for
         * a post that cannot be filed at all, so those are not re-read on
         * every frame forever.
         */
        function injectPostButtons() {
            for (const article of TwitterPage.findAll('post')) {
                if (article.querySelector('.bb-x-post-btn')) continue;
                if (article.hasAttribute('data-bb-unfilable')) continue;
                if (!addPostButton(article)) article.setAttribute('data-bb-unfilable', '1');
            }
            return false;
        }

        /** True when a button went in; false when this post cannot carry one. */
        function addPostButton(article) {
            const actions = TwitterPage.find('actions', article);
            if (!actions) return false;

            const post = TwitterPage.readPost(article);
            if (!post) return false;

            const button = PouchButton.create({
                className: 'bb-x-post-btn',
                label: 'Save this post to your pouch',
                onClick: (event) => openPostPicker(event.currentTarget, post),
            });
            button.setAttribute(KEEP, '1');
            button.dataset.bbStatus = post.statusId;

            // X's bookmark is the control this stands in for — the same
            // gesture, filed somewhere we can organise. Hidden rather than
            // removed, so that if X re-renders the row (it does, on every
            // like) its own button comes back into a slot that is still
            // hidden instead of into a layout that has shifted.
            const bookmark = actions.querySelector('[data-testid="bookmark"], [data-testid="removeBookmark"]');
            const slot = bookmark && bookmark.closest('[role="group"] > *');

            // Measured before the bookmark's cell is hidden: a `display: none`
            // element reports none of the layout we are copying off it.
            const holder = slotFor(button, rowModel(actions, slot));
            if (slot) {
                slot.classList.add('bb-x-hidden');
                slot.parentElement.insertBefore(holder, slot);
            } else {
                actions.appendChild(holder);
            }

            markPost(button, post.statusId);
            return true;
        }

        async function markPost(button, statusId) {
            if (!button || !button.isConnected || !hasExtensionContext()) return;
            const topic = XPouch.topicForStatus(await state(), statusId);
            const name = topic
                ? (XPouch.topicsOf(await state(), 'posts').find((t) => t.id === topic) || {}).name
                : '';
            PouchButton.mark(button, {
                filed: !!topic,
                label: topic ? `Filed under ${name} — click to re-file` : 'Save this post to your pouch',
            });
        }

        // -------------------------------------------------- profile button

        /**
         * The add-to-pouch button in a profile header, beside Follow.
         *
         * Never reports itself done, for the same reason the nav row does not:
         * X rebuilds this header on its own schedule — changing the theme is
         * enough — and a task that retired after placing the button once would
         * leave it gone until the next navigation. getElementById keeps that
         * cheap, and off a profile readProfile answers from the path alone.
         */
        function injectProfileButton() {
            const person = TwitterPage.readProfile();
            if (!person) {
                // Left over from the profile we navigated away from.
                const stale = document.getElementById(PROFILE_BUTTON_ID);
                if (stale) stale.remove();
                return false;
            }

            const actions = TwitterPage.find('profileActions');
            if (!actions || !actions.parentElement) return false;

            const placed = document.getElementById(PROFILE_BUTTON_ID);
            if (placed) {
                // Same element, different person: X keeps the header across an
                // SPA move between two profiles, so without this the tick
                // stays behind on someone who was never filed.
                if (placed.dataset.bbHandle !== person.handle) {
                    placed.dataset.bbHandle = person.handle;
                    markProfile(placed, person);
                }
                return false;
            }

            const button = PouchButton.create({
                id: PROFILE_BUTTON_ID,
                className: 'bb-x-profile-btn',
                label: `Add ${person.handle} to your pouch`,
                onClick: (event) => openProfilePicker(event.currentTarget, TwitterPage.readProfile() || person),
            });
            button.setAttribute(KEEP, '1');
            button.dataset.bbHandle = person.handle;

            actions.parentElement.insertBefore(button, actions.nextSibling);
            wearRing(button, ringModel(actions));
            markProfile(button, person);
            return false;
        }

        async function markProfile(button, person) {
            if (!button || !button.isConnected || !hasExtensionContext()) return;
            const topic = XPouch.topicForHandle(await state(), person.handle);
            const name = topic
                ? (XPouch.topicsOf(await state(), 'people').find((t) => t.id === topic) || {}).name
                : '';
            PouchButton.mark(button, {
                filed: !!topic,
                label: topic
                    ? `${person.handle} is filed under ${name} — click to re-file`
                    : `Add ${person.handle} to your pouch`,
            });
        }

        /** Repaint every button on the page after the pouch changed. */
        function markAll() {
            const profile = document.getElementById(PROFILE_BUTTON_ID);
            const person = TwitterPage.readProfile();
            if (profile && person) markProfile(profile, person);

            document.querySelectorAll('.bb-x-post-btn').forEach((button) => {
                markPost(button, button.dataset.bbStatus);
            });
        }

        // --------------------------------------------------------- pickers

        /**
         * Dismiss the picker on a click anywhere that is not ours.
         *
         * The panel has a rule like this of its own and they cannot be shared:
         * a click on a picker must not close the panel behind it, but a click
         * on the panel must close a picker that is open in front of it, so
         * "outside" means something different to each. This one keys off the
         * picker itself; the panel's keys off the [data-bb-keep-panel] subtree
         * that both of them are marked with.
         */
        function onOutsideClick(event) {
            const picker = document.getElementById(PICKER_ID);
            if (!picker || picker.contains(event.target)) return;
            // A pouch button decides for itself. This listener is on document
            // in the capture phase, so it sees the click first — and closing
            // the picker here would make the button's own toggle reopen it a
            // moment later, so the same button could never shut the picker it
            // had opened. openPicker below is what toggles it instead.
            if (event.target.closest && event.target.closest(`.${PouchButton.CLASS}`)) return;
            closePicker();
        }

        /**
         * Escape closes the picker and nothing else.
         *
         * On document rather than on the picker, so it works with the caret
         * anywhere — the picker is opened from a click, and a click does not
         * always leave the focus inside it. The panel behind reads the same
         * key and stands aside for exactly this: see its `isCovered`.
         */
        function onPickerKeyDown(event) {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            closePicker();
        }

        function closePicker() {
            const open = document.getElementById(PICKER_ID);
            if (!open) return;
            document.removeEventListener('click', onOutsideClick, true);
            document.removeEventListener('keydown', onPickerKeyDown, true);
            open.remove();
        }

        /**
         * The topic list, anchored under the button that opened it.
         *
         * Fixed rather than absolute, and positioned from the button's own
         * rect: X's action row sits inside a stack of transformed and
         * clipped containers, and an absolutely-positioned child of any of
         * them is cut off at the edge of the post.
         */
        async function openPicker(anchor, { side, currentTopic, headingHtml, footerHtml, onPick, allowNew }) {
            const already = document.getElementById(PICKER_ID);
            closePicker();
            if (already && already.dataset.bbAnchor === anchorKey(anchor)) return;

            const topics = XPouch.topicsOf(await state(), side);

            const picker = document.createElement('div');
            picker.id = PICKER_ID;
            picker.className = 'bb-x-picker bb-themed';
            picker.setAttribute(KEEP, '1');
            picker.dataset.bbAnchor = anchorKey(anchor);
            picker.innerHTML = headingHtml + listHtml(topics, currentTopic) +
                (allowNew ? newTopicHtml() : '') + (footerHtml || '');

            document.body.appendChild(picker);
            Theme.dress(picker, await Theme.appearance());
            place(picker, anchor);

            // Registered after the click that opened this has finished
            // dispatching. On document in the capture phase the ordering
            // already works out, but the picker is opened from an async
            // handler and a stray listener that fires on its own opening
            // click is the kind of bug that only shows up on a slow machine.
            document.addEventListener('keydown', onPickerKeyDown, true);
            setTimeout(() => {
                if (document.getElementById(PICKER_ID) === picker) {
                    document.addEventListener('click', onOutsideClick, true);
                }
            }, 0);

            picker.querySelectorAll('[data-bb-pick]').forEach((button) => {
                button.addEventListener('click', async () => {
                    closePicker();
                    await onPick(button.dataset.bbPick);
                });
            });

            if (allowNew) wireNewTopic(picker, onPick);

            const first = picker.querySelector('button, input');
            if (first) first.focus({ preventScroll: true });
        }

        const anchorKey = (anchor) => (anchor.id || anchor.dataset.bbStatus || 'x');

        /** Below the button, right-aligned, and flipped up near the fold. */
        function place(picker, anchor) {
            const rect = anchor.getBoundingClientRect();
            const box = picker.getBoundingClientRect();
            const gap = 8;

            const below = rect.bottom + gap;
            const top = below + box.height > window.innerHeight - 12
                ? Math.max(12, rect.top - gap - box.height)
                : below;

            const right = Math.min(window.innerWidth - 12, Math.max(box.width + 12, rect.right));
            picker.style.top = `${top}px`;
            picker.style.left = `${right - box.width}px`;
        }

        function listHtml(topics, currentTopic) {
            if (!topics.length) {
                return '<p class="bb-x-picker-empty">No topics yet.</p>';
            }
            return `<div class="bb-x-picker-list">${topics.map((topic) => `
                <button type="button" class="bb-x-picker-row" data-bb-pick="${Dom.escapeAttr(topic.id)}">
                    <span class="bb-x-dot${topic.id === currentTopic ? ' is-on' : ''}"></span>
                    <span class="bb-x-picker-name">${Dom.escapeHtml(topic.name)}</span>
                </button>`).join('')}</div>`;
        }

        /**
         * The one exception to "topics are made in the dashboard": filing a
         * post is the moment you discover you need a topic for it, and
         * bouncing to another tab to make one loses the post.
         */
        function newTopicHtml() {
            return `
                <div class="bb-x-picker-new">
                    <button type="button" class="bb-x-picker-row bb-x-picker-add" data-bb-new="1">
                        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
                             stroke-width="2"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
                        New topic
                    </button>
                    <form class="bb-x-picker-form" hidden>
                        <input type="text" class="bb-input" placeholder="Topic name" maxlength="60" required>
                        <button type="submit" class="bb-btn bb-btn-primary">Add</button>
                    </form>
                </div>`;
        }

        function wireNewTopic(picker, onPick) {
            const add = picker.querySelector('[data-bb-new]');
            const form = picker.querySelector('.bb-x-picker-form');
            if (!add || !form) return;

            add.addEventListener('click', () => {
                add.hidden = true;
                form.hidden = false;
                form.querySelector('input').focus({ preventScroll: true });
            });

            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const name = form.querySelector('input').value.trim();
                if (!name) return;
                const id = await XPouch.createTopic('posts', name);
                pouch = null;
                closePicker();
                if (id) await onPick(id);
            });
        }

        async function openPostPicker(button, post) {
            if (!hasExtensionContext()) return notify(CONTEXT_LOST, 'warning');
            const current = XPouch.topicForStatus(await state(), post.statusId);

            return openPicker(button, {
                side: 'posts',
                currentTopic: current,
                allowNew: true,
                headingHtml: `<p class="bb-x-picker-head">Save to pouch</p>`,
                onPick: async (topicId) => {
                    await XPouch.filePost({ ...post, topic: topicId });
                    pouch = null;
                    notify(current ? 'Post re-filed' : 'Post saved to your pouch', 'success');
                    markAll();
                },
            });
        }

        async function openProfilePicker(button, person) {
            if (!hasExtensionContext()) return notify(CONTEXT_LOST, 'warning');
            const current = XPouch.topicForHandle(await state(), person.handle);

            return openPicker(button, {
                side: 'people',
                currentTopic: current,
                // No "new topic" here, and no note field: the design keeps
                // people topics a dashboard decision, and a note is three to
                // five words you write after you have read someone for a
                // while, not in the second you file them.
                allowNew: false,
                headingHtml: `<p class="bb-x-picker-head">Add to pouch</p>
                    <p class="bb-x-picker-sub">${Dom.escapeHtml(person.handle)}</p>`,
                footerHtml: '<p class="bb-x-picker-foot">Notes are written in the dashboard</p>',
                onPick: async (topicId) => {
                    await XPouch.filePerson({ ...person, topic: topicId });
                    pouch = null;
                    notify(current ? `${person.handle} re-filed` : `${person.handle} added to your pouch`, 'success');
                    markAll();
                },
            });
        }

        // ---------------------------------------------------------- wiring

        function install() {
            watcher.add('x-nav', injectNavEntry);
            watcher.add('x-posts', injectPostButtons);
            watcher.add('x-profile', injectProfileButton);
        }

        /**
         * X navigated without a page load.
         *
         * Nothing is re-armed: all three tasks never retire, because X rebuilds
         * the navigation column, a post's action row and a profile header on
         * its own schedule rather than only on a navigation. What is left to do
         * here is shut the picker, which was anchored to a button on the page
         * we have just left.
         */
        function onNavigate() {
            closePicker();
        }

        /** Shift+P, and the only way in besides the nav row. */
        function openPouch() {
            return togglePanel();
        }

        return {
            install, onNavigate, openPouch, panel,
            injectNavEntry, injectPostButtons, injectProfileButton,
        };
    }

    // slotFor, rowModel, wearRing and ringModel are exported so the specs can
    // read them off elements they build. Driving them through the injectors
    // would mean moving the address bar to /<handle>, which is the one thing a
    // page opened over file:// cannot do.
    const TwitterUi = {
        createTwitterUi, NAV_ID, PROFILE_BUTTON_ID, PICKER_ID,
        navLabel, slotFor, rowModel, wearRing, ringModel,
    };

    root.BB = root.BB || {};
    root.BB.TwitterUi = TwitterUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = TwitterUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
