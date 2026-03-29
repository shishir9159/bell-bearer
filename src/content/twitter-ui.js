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
 * on both sites and change in one place. The nav row wears the extension's own
 * artwork, as YouTube's drawer entry does, with that shared glyph stacked
 * underneath it so a picture that cannot be loaded uncovers a mark in
 * currentColor rather than leaving a hole. This file used to draw the glyph
 * alone on the grounds that a square of artwork in X's column of outline marks
 * reads as an advert; the ask was for the two sites to carry the same mark, and
 * they now do. See navIconHtml.
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
    const Icons = ns.Icons || req('../shared/icons.js');
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
    const ICON_LOOK_ID = 'bb-x-icon-look';
    const COUNTS_HIDDEN = 'data-bb-x-counts-hidden';

    const CONTEXT_LOST = 'Bell Bearer was updated — please refresh this page.';

    /** chrome.* throws once the extension reloads; a live id means we are fine. */
    const hasExtensionContext = () => !!(chrome.runtime && chrome.runtime.id);

    /**
     * The type properties the nav row copies off X's own, and the custom
     * property each is written into.
     *
     * Custom properties rather than `style.fontSize` and friends, because the
     * row has two states and only one style attribute: the selected row is
     * drawn larger and heavier, and content.css derives that from the resting
     * numbers. An inline `font-size` would win over the rule that grows it.
     *
     * Colour is pointedly not in the list. `color: inherit` in content.css
     * follows X's theme the instant it changes; a value read once and written
     * into a style attribute would be the old theme's grey forever.
     */
    const NAV_TYPE = Object.freeze({
        fontFamily: '--bb-x-nav-font',
        fontSize: '--bb-x-nav-size',
        fontWeight: '--bb-x-nav-weight',
        letterSpacing: '--bb-x-nav-track',
    });

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
     * The two rows of X's navigation worth measuring: one at rest and the one
     * that is selected.
     *
     * Only rows with a glyph in them count. X puts a "More" menu button and,
     * signed in, an account switcher in the same column, and neither is the
     * shape the icon-plus-word rows are.
     */
    function navModels(rows) {
        const usable = rows.filter((row) => row.querySelector('svg') && navLabel(row));
        const current = usable.find((row) => row.getAttribute('aria-current') === 'page');
        const rest = usable.find((row) => row.getAttribute('aria-current') !== 'page');
        return { rest: rest || current || null, current: current || rest || null };
    }

    /**
     * The nav row's mark: the extension's own artwork, with the shared glyph
     * behind it.
     *
     * Both are in the markup and the image is stacked over the glyph by
     * content.css, exactly as the panel stacks an avatar over a monogram —
     * the <img> is dropped on error in injectNavEntry, which is what uncovers
     * the glyph. That matters here because `chrome.runtime.getURL` throws the
     * moment the extension reloads, and because the artwork is only loadable
     * at all while `icons/` stays in web_accessible_resources.
     *
     * The URL is not run through Dom.safeUrlAttr: that passes http(s) and
     * nothing else, so it turned this very src into "#" the last time the row
     * carried an image. It is not user input — it is our own extension id —
     * and it is written as a property rather than into an HTML string so
     * there is no markup for it to escape from.
     */
    function navIconHtml() {
        return '<span class="bb-x-nav-ico">' + PouchButton.ICON +
            '<img class="bb-x-nav-img" alt="" aria-hidden="true"></span>';
    }

    function navIconUrl() {
        try {
            return chrome.runtime.getURL('icons/icon128.png');
        } catch (_) {
            return '';
        }
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
        // A cell that has been taken out of the row reports none of the layout
        // we came for — which is what the bookmark's is, the moment
        // twitterHideBookmark has hidden it.
        if (style.display === 'none') return holder;

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
     * The size of the glyphs in the row our cell sits in, written onto the
     * cell.
     *
     * Per row, not once for the page along with the colour. X draws the post
     * opened on its own page with bigger marks than the replies under it, and
     * that post is usually the first on its page — so the one size read off
     * it put an oversized pouch glyph on every reply.
     */
    function wearRowSize(holder, actions) {
        if (!actions || typeof getComputedStyle !== 'function') return;
        const glyph = actions.querySelector('[data-testid="reply"] svg');
        const size = glyph ? parseFloat(getComputedStyle(glyph).height) : 0;
        if (size > 0) holder.style.setProperty('--bb-x-icon-size', `${size}px`);

        // And the type of the row's counts, for ours to be written in. A row
        // with no count in it yet leaves content-x.css's fallback.
        const count = actions.querySelector('[data-testid="app-text-transition-container"]');
        if (!count) return;
        const type = getComputedStyle(count);
        if (type.fontSize) holder.style.setProperty('--bb-x-count-size', type.fontSize);
        if (type.fontFamily) holder.style.setProperty('--bb-x-count-font', type.fontFamily);
    }

    /**
     * The post's bookmark count after our glyph, the way X writes a count
     * after each of its own marks, and left off at zero as X leaves its own.
     *
     * Written again after every PouchButton.mark, which rebuilds the
     * button's markup for the filed state and takes the number with it.
     */
    function showCount(button) {
        const count = TwitterPage.bookmarkCount(button.closest('[role="group"]'));
        let text = button.querySelector('.bb-x-post-count');
        if (!count) {
            if (text) text.remove();
            return;
        }
        if (!text) {
            text = document.createElement('span');
            text.className = 'bb-x-post-count';
            button.appendChild(text);
        }
        text.textContent = TwitterPage.shortCount(count, document.documentElement.lang);
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
     * Which cell of X's action row ours goes in front of.
     *
     * The bookmark's, which is the gesture this stands in for. Failing that,
     * the cell after Like — pointedly *not* the end of the row, which is
     * where appending used to put it. X renders a bookmark on a post's own
     * page and leaves it off a good many timeline and profile rows, so the
     * same button landed between Like and Bookmark on one screen and out
     * past Share on the next, for no reason a reader could see.
     *
     * `null` means the end, which is the right answer for a row whose last
     * cell is Like.
     */
    function postSlotBefore(actions) {
        const bookmark = actions.querySelector('[data-testid="bookmark"], [data-testid="removeBookmark"]');
        const beside = bookmark && bookmark.closest('[role="group"] > *');
        if (beside) return beside;

        for (const id of ['like', 'unlike']) {
            const control = actions.querySelector(`[data-testid="${id}"]`);
            const slot = control && control.closest('[role="group"] > *');
            if (slot) return slot.nextElementSibling;
        }
        return null;
    }

    /**
     * Let the action row use the width the post has.
     *
     * X caps that row at a fixed pixel width and leaves it left-aligned, so
     * on a wide timeline the marks sit bunched into the left half with empty
     * page beside them — and a sixth cell squeezes the five already there
     * rather than taking any of the room going spare.
     *
     * The cap is lifted only when there is somewhere to lift it into, and
     * only on a row we have put a button in, so a page with the pouch button
     * switched off is untouched. X re-renders this row on every like, which
     * drops the inline style and the marker together and is why neither is
     * treated as permanent.
     */
    function stretchRow(actions) {
        if (!actions || typeof getComputedStyle !== 'function') return;
        if (actions.dataset.bbStretched) return;

        const parent = actions.parentElement;
        const cap = parseFloat(getComputedStyle(actions).maxWidth);
        if (!parent || !Number.isFinite(cap)) return;
        if (!(parent.getBoundingClientRect().width > cap + 8)) return;

        actions.style.maxWidth = 'none';
        actions.dataset.bbStretched = '1';
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
     * Nudge the ring onto the line X's own buttons sit on.
     *
     * Measured rather than reasoned about, and a translate rather than a
     * margin. X's header row does not lay its children out the same way in
     * every variant — a centred flex row in one, an inline run in another —
     * so there is no single declaration that puts our ring on the same line
     * as the three beside it, and it sat a couple of pixels below them.
     * Comparing the two boxes and shifting by the difference is right in
     * either layout; a margin would not be, because a flex row that centres
     * its children counts the margin in and absorbs half of any correction.
     *
     * `wearRing` has to have run first, or the box measured is the fallback
     * 34px one rather than the size actually drawn.
     */
    function centreRing(button, model) {
        if (!model || typeof getComputedStyle !== 'function') return;
        const ours = button.getBoundingClientRect();
        const theirs = model.getBoundingClientRect();
        if (!ours.height || !theirs.height) return;

        const drop = (ours.top + ours.height / 2) - (theirs.top + theirs.height / 2);
        if (Math.abs(drop) < 0.5 || Math.abs(drop) > 24) return;
        button.style.transform = `translateY(${(-drop).toFixed(2)}px)`;
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

    /**
     * `getSettings` reads the content script's settings mirror. It defaults to
     * the schema's own defaults, which have all three surfaces off — so a
     * caller that does not pass one gets the extension at rest rather than a
     * quietly different set of defaults to keep in step with settings.js.
     */
    function createTwitterUi({ watcher, notify, getSettings = () => Settings.DEFAULTS }) {
        const on = (key) => getSettings()[key] === true;

        /**
         * The pouch, held here so that deciding whether a post is already
         * filed does not read storage once per post on a timeline that is
         * still scrolling. Dropped whenever anything writes, including from
         * the dashboard in another tab.
         *
         * The read is held, not what it resolved to: holding the value left
         * it null until the read landed, so every post on screen asked for one
         * of its own after each write, and a read that was out when a write
         * dropped it put the stale pouch back when it landed.
         */
        let pouch = null;

        function state() {
            if (!pouch) pouch = XPouch.load();
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
            // Same trick and the same fallback as goToProfile. A post the
            // timeline is already showing has a link to it on the page, and
            // clicking that keeps X's router in charge; anything else is a
            // navigation, which is fine — you asked to go and read it.
            goToPost: (url) => {
                const path = String(url).replace(/^https:\/\/(?:x|twitter)\.com/i, '');
                const link = path && document.querySelector(`a[href="${CSS.escape(path)}"]`);
                if (link) link.click();
                else location.assign(url);
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
         *
         * Not on a chat page. X keeps the same column there but squeezes it to
         * a rail of icons, and our row — which carries its word regardless —
         * spilled out of the rail over the conversation list. It is taken out
         * rather than restyled: Shift+P still opens the pouch, and the row
         * comes back on the first pass after you leave the chat. `path` is
         * the specs' seam; the watcher passes nothing.
         */
        function injectNavEntry(path) {
            const placed = document.getElementById(NAV_ID);
            if (TwitterPage.isChatPath(path)) {
                if (placed) placed.remove();
                return false;
            }
            if (placed) return false;
            const nav = TwitterPage.find('nav');
            if (!nav) return false;

            const entry = document.createElement('div');
            entry.id = NAV_ID;
            entry.className = 'bb-x-nav';
            entry.setAttribute(KEEP, '1');
            entry.setAttribute('role', 'link');
            entry.setAttribute('tabindex', '0');
            entry.title = 'Bell Bearer — your pouch';
            entry.innerHTML = navIconHtml() + '<span class="bb-x-nav-text">Pouch</span>';

            // See navIconHtml: the src goes on as a property, and dropping the
            // image is what uncovers the glyph stacked under it. `once`,
            // because a src that failed is not going to succeed on a retry.
            const art = entry.querySelector('.bb-x-nav-img');
            const url = navIconUrl();
            if (url) {
                art.addEventListener('error', () => art.remove(), { once: true });
                art.src = url;
            } else {
                art.remove();
            }

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
            dressNavEntry(entry);

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
         * read off X's own rows instead, and the CSS stays as the fallback for
         * when there are none to read.
         *
         * Two rows are read, not one. X draws the row you are on heavier than
         * the rest, and the row measured used to be Home — which is the row
         * you are on nearly always, so Pouch wore the selected weight the
         * whole time and read as a tab that would not let go. The resting
         * numbers come from a row that is not current and the selected weight
         * from the row that is; `--bb-x-nav-weight-on` is what content.css
         * swaps to while the panel is open.
         *
         * The label offset is measured rather than assumed for the same
         * reason the type is. Our row's padding and the gap after its icon are
         * two numbers that only matter as a sum — where the word starts — and
         * X's own sum changes with its display-size setting, which is what
         * left the Pouch label a couple of pixels left of every other word in
         * the column. So the sum is read off X's row and split back into the
         * two, rather than either being a constant.
         *
         * Nothing has to re-run this: X rebuilds the navigation when either
         * setting changes, and injectNavEntry never retires, so the new column
         * gets a freshly measured row.
         */
        function dressNavEntry(entry) {
            if (typeof getComputedStyle !== 'function') return;

            const { rest, current } = navModels(TwitterPage.findAll('navRows'));
            if (!rest) return;

            const label = navLabel(rest);
            if (label) {
                const style = getComputedStyle(label);
                for (const [property, custom] of Object.entries(NAV_TYPE)) {
                    if (style[property]) entry.style.setProperty(custom, style[property]);
                }
            }

            // The selected row's weight, so "bolder when open" means bolder by
            // X's own reckoning rather than by a hard 800 that is heavier than
            // anything the column actually uses.
            const onLabel = current && current !== rest && navLabel(current);
            if (onLabel) {
                const weight = getComputedStyle(onLabel).fontWeight;
                if (weight) entry.style.setProperty('--bb-x-nav-weight-on', weight);
            }

            const glyph = rest.querySelector('svg');
            const size = glyph ? Math.round(glyph.getBoundingClientRect().height) : 0;
            if (size) entry.style.setProperty('--bb-x-nav-ico', `${size}px`);

            alignNavLabel(entry, rest, size);
        }

        /**
         * Put our word where X puts its words.
         *
         * Measured from our own left edge rather than from X's row's, because
         * the two are not always the same element depth: X wraps a nav row in
         * a div of its own in some layouts, and a target read off that row's
         * box would be off by its wrapper's padding. Our own rect answers the
         * only question there is — how far in from *our* edge the word belongs.
         *
         * A reading that cannot be right is dropped rather than applied: a
         * column collapsed to icons has no label offset worth copying, and a
         * row that has not been laid out yet measures zero.
         */
        function alignNavLabel(entry, model, iconSize) {
            const label = navLabel(model);
            if (!label) return;

            const from = entry.getBoundingClientRect().left;
            const want = label.getBoundingClientRect().left - from;
            const icon = iconSize || 26;
            if (!(want > icon + 2) || want > 140) return;

            // The sum is fixed; how it splits is ours. The pill keeps as much
            // of it as padding as it can up to 14px, and what is left is the
            // gap — never under 6px, or the word crowds the mark.
            const pad = Math.max(0, Math.min(14, Math.round(want - icon - 6)));
            entry.style.setProperty('--bb-x-nav-pad', `${pad}px`);
            entry.style.setProperty('--bb-x-nav-gap', `${Math.round(want - icon - pad)}px`);
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
         * One pouch button per post, and X's own bookmark stood down — two
         * settings rather than one, and both off until they are asked for.
         *
         * The order inside the loop is not arbitrary. Our button is placed
         * first and the bookmark hidden after, because the cell our button
         * copies its layout from is usually the bookmark's, and a cell that
         * has already been hidden has no layout left to read.
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
         *
         * This runs on every frame X mutates in, which while scrolling is all
         * of them, so a post already done has to cost next to nothing. Each
         * remembers the button and the hidden slot it was given, and a pass
         * only checks those are still in it: a query per post per frame, and
         * the icon look read with getComputedStyle — a forced layout — on
         * every frame, was the cost of scrolling the timeline.
         */
        const placedIn = new WeakMap();
        const hiddenIn = new WeakMap();
        const stillIn = (element, article) => !!element && element.isConnected && article.contains(element);

        function hasButton(article) {
            if (stillIn(placedIn.get(article), article)) return true;
            const found = article.querySelector('.bb-x-post-btn');
            if (found) placedIn.set(article, found);
            return !!found;
        }

        function injectPostButtons() {
            const wanted = on('twitterPouchPosts');
            const hide = on('twitterHideBookmark');
            if (!wanted && !hide) return false;

            const posts = TwitterPage.findAll('post');
            const bare = wanted ? posts.filter((article) => !article.hasAttribute('data-bb-unfilable') && !hasButton(article)) : [];
            if (wanted && posts.length) lookAgain(posts[0], bare.length > 0);
            for (const article of bare) {
                const button = addPostButton(article);
                if (button) placedIn.set(article, button);
                else article.setAttribute('data-bb-unfilable', '1');
            }
            if (hide) {
                for (const article of posts) {
                    const slot = hiddenIn.get(article);
                    if (stillIn(slot, article) && slot.classList.contains('bb-x-hidden')) continue;
                    const hidden = setBookmarkHidden(article, true);
                    if (hidden) hiddenIn.set(article, hidden);
                }
            }
            return false;
        }

        /**
         * The colour and size of X's own action glyphs, for ours to wear.
         *
         * Read off the page, never written down: X has three themes and a
         * font-size setting, and its glyphs are a muted grey in each, not the
         * post's text colour. Ours used to take that text colour at 72%,
         * which came out brighter than every icon beside it. The values go
         * into one sheet of custom properties rather than onto each button,
         * so a theme switch — which re-renders the timeline and so runs this
         * pass again — repaints every button already placed.
         *
         * Reply's glyph is the one read: Like and Repost change colour once
         * pressed, Reply never does.
         *
         * Read when buttons are being placed, when X's own theme marks move —
         * it sets the page's background and root font size inline, which
         * costs nothing to read — and otherwise at most once a second, as a
         * backstop for a switch that moves neither.
         */
        const LOOK_EVERY_MS = 1000;
        let lookedAt = 0;
        let lookedFor = '';
        const themeMarks = () => `${document.body ? document.body.style.backgroundColor : ''}|${document.documentElement.style.fontSize}`;

        function lookAgain(article, placing) {
            const marks = themeMarks();
            const now = Date.now();
            if (!placing && marks === lookedFor && now - lookedAt < LOOK_EVERY_MS) return;
            const moved = lookedFor !== '' && marks !== lookedFor;
            lookedFor = marks;
            lookedAt = now;
            wearIconLook(TwitterPage.find('actions', article));
            // The size is written onto each cell, which a new root font size
            // does not reach the way it reaches the sheet.
            if (moved) {
                document.querySelectorAll('.bb-x-post-slot').forEach((slot) => {
                    wearRowSize(slot, slot.closest('[role="group"]'));
                });
            }
        }

        let iconLook = '';
        function wearIconLook(actions) {
            const glyph = actions && actions.querySelector('[data-testid="reply"] svg');
            if (!glyph || typeof getComputedStyle !== 'function') return;
            const style = getComputedStyle(glyph);
            const size = parseFloat(style.height);
            const look = `--bb-x-icon-color: ${style.color};` + (size > 0 ? ` --bb-x-icon-size: ${size}px;` : '');
            if (look === iconLook && document.getElementById(ICON_LOOK_ID)) return;
            iconLook = look;
            let sheet = document.getElementById(ICON_LOOK_ID);
            if (!sheet) {
                sheet = document.createElement('style');
                sheet.id = ICON_LOOK_ID;
                sheet.setAttribute(KEEP, '1');
                (document.head || document.documentElement).appendChild(sheet);
            }
            sheet.textContent = `:root { ${look} }`;
        }

        /**
         * X's own bookmark, out of a row — or back into it.
         *
         * Hidden rather than removed, so that if X re-renders the row (it
         * does, on every like) its own button comes back into a cell that is
         * still hidden instead of into a layout that has shifted. It is also
         * what makes the setting reversible without a reload.
         */
        function setBookmarkHidden(scope, hidden) {
            const marks = scope.querySelectorAll('[data-testid="bookmark"], [data-testid="removeBookmark"]');
            let slot = null;
            for (const mark of marks) {
                slot = mark.closest('[role="group"] > *') || mark;
                slot.classList.toggle('bb-x-hidden', hidden);
            }
            return slot;
        }

        /** The button that went in, or null when this post cannot carry one. */
        function addPostButton(article) {
            const actions = TwitterPage.find('actions', article);
            if (!actions) return null;

            const post = TwitterPage.readPost(article);
            if (!post) return null;

            const button = PouchButton.create({
                className: 'bb-x-post-btn',
                label: 'Save this post to your pouch',
                onClick: (event) => openPostPicker(event.currentTarget, post),
            });
            button.setAttribute(KEEP, '1');
            button.dataset.bbStatus = post.statusId;

            // Where X's bookmark is, or where it would be — the same reach,
            // filed somewhere you can organise. Whether that bookmark is still
            // beside ours afterwards is twitterHideBookmark's business and not
            // this function's.
            const before = postSlotBefore(actions);
            const holder = slotFor(button, rowModel(actions, before));
            wearRowSize(holder, actions);
            actions.insertBefore(holder, before);
            showCount(button);

            // After the cell is in, so the row is measured at the width it
            // will actually be asked to hold.
            stretchRow(actions);

            markPost(button, post.statusId);
            return button;
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
            showCount(button);
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
            // Off, or not a profile — the same answer either way, and the same
            // tidying up after whichever page we were on before.
            const person = on('twitterPouchPeople') ? TwitterPage.readProfile() : null;
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
            const ring = ringModel(actions);
            wearRing(button, ring);
            // After wearRing, so what is measured is the ring as drawn.
            centreRing(button, ring);
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
                        ${Icons.svg('plus')}
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

        /**
         * One of the X surfaces was switched on or off in the dashboard.
         *
         * Both directions are handled, and on the page that is already open: a
         * switch that only takes effect on the next reload reads as a switch
         * that did nothing. Turning something off is the half that needs code —
         * turning it on is just letting the injector run again.
         */
        function refreshSurfaces() {
            if (!on('twitterPouchPosts')) {
                document.querySelectorAll('.bb-x-post-slot, .bb-x-post-btn')
                    .forEach((element) => element.remove());
                // The row was widened to hold a cell that has just gone.
                document.querySelectorAll('[data-bb-stretched]').forEach((row) => {
                    row.style.maxWidth = '';
                    delete row.dataset.bbStretched;
                });
            }
            if (!on('twitterPouchPeople')) {
                const placed = document.getElementById(PROFILE_BUTTON_ID);
                if (placed) placed.remove();
            }
            if (!on('twitterHideBookmark')) setBookmarkHidden(document, false);

            // One mark on the page's root rather than one per post: content-x.css
            // hides the numbers off it, so every post that arrives later is
            // covered without a pass of its own.
            document.documentElement.toggleAttribute(COUNTS_HIDDEN, on('twitterHideCounts'));

            // Anchored to a button that may have just been taken off the page.
            closePicker();

            injectPostButtons();
            injectProfileButton();
        }

        /** Shift+P, and the only way in besides the nav row. */
        function openPouch() {
            return togglePanel();
        }

        return {
            install, onNavigate, openPouch, panel, refreshSurfaces,
            injectNavEntry, injectPostButtons, injectProfileButton,
        };
    }

    // slotFor, rowModel, wearRing and ringModel are exported so the specs can
    // read them off elements they build. Driving them through the injectors
    // would mean moving the address bar to /<handle>, which is the one thing a
    // page opened over file:// cannot do.
    const TwitterUi = {
        createTwitterUi, NAV_ID, PROFILE_BUTTON_ID, PICKER_ID, ICON_LOOK_ID,
        navLabel, navModels, slotFor, rowModel, postSlotBefore, stretchRow,
        wearRing, ringModel, centreRing,
    };

    root.BB = root.BB || {};
    root.BB.TwitterUi = TwitterUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = TwitterUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
