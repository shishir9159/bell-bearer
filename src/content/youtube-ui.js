/**
 * Everything Bell Bearer injects into YouTube's own page: the "add to pouch"
 * button beside Subscribe, the "follow playlist" button in a playlist header,
 * the entry in the left drawer, and the panel the pouch button opens.
 *
 * The sheet the drawer entry opens is not here — it is src/content/pouch-sheet.js,
 * which is a surface of its own rather than an injection into YouTube's chrome.
 *
 * All the markup here interpolates data the user does not control — channel
 * and playlist names scraped from the page — so text goes through escapeHtml
 * and every URL through safeUrlAttr, which drops anything that is not http(s).
 *
 * Both surfaces carry `data-bb-theme` and `data-bb-skin`, and content.css keys
 * its palette off the pair. The two are independent on purpose: the skin
 * chooses the palette and the type, while light/dark follows the page
 * underneath, so a sheet over a dark YouTube is never a white slab.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Feed = ns.Feed || req('../shared/feed.js');
    const Playlists = ns.Playlists || req('../shared/playlists.js');
    const Settings = ns.Settings || req('../shared/settings.js');
    const Subscriptions = ns.Subscriptions || req('../shared/subscriptions.js');
    const YouTube = ns.YouTube || req('../shared/youtube.js');
    const Overlay = ns.Overlay || req('./overlay.js');
    const PageInfo = ns.PageInfo || req('./page-info.js');
    const PouchSheet = ns.PouchSheet || req('./pouch-sheet.js');
    const Theme = ns.Theme || req('./theme.js');

    const BUTTON_ID = 'bb-add-to-subscriptions-btn';
    const PLAYLIST_BUTTON_ID = 'bb-follow-playlist-btn';
    const GUIDE_ID = 'bb-guide-entry';
    const CONTEXT_LOST = 'Bell Bearer was updated — please refresh this page.';

    const POUCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:24px;height:24px;fill:currentColor;"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"></path></svg>';

    /**
     * The filed state. YouTube turns its own Subscribe button into a flat grey
     * "Subscribed" pill once you are subscribed, and the pouch button sits
     * right next to it — so a filed channel gets the same treatment, a tick on
     * the same grey, rather than going on offering a "+" for something already
     * done.
     */
    const TICK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:22px;height:22px;fill:currentColor;"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>';

    /**
     * Where the playlist panel on a watch page keeps its header, and where a
     * /playlist page keeps its own. Newest spelling first, as everywhere else
     * in this extension that reaches into YouTube's DOM.
     */
    const PLAYLIST_HEADER_SELECTORS = [
        'ytd-playlist-panel-renderer #container > .header',
        'ytd-playlist-panel-renderer .header.ytd-playlist-panel-renderer',
        'ytd-playlist-header-renderer .metadata-buttons-wrapper',
        'ytd-playlist-header-renderer #actions',
        // The current /playlist page. The qualified form first, so the header's
        // own action row wins over any other flexible-actions row on the page.
        'yt-page-header-renderer yt-flexible-actions-view-model',
        'yt-flexible-actions-view-model',
        'ytd-playlist-sidebar-primary-info-renderer #menu',
    ];

    const PLAYLIST_TITLE_SELECTORS = [
        'ytd-playlist-panel-renderer #container .header #publisher-container ~ * h3',
        'ytd-playlist-panel-renderer #header-description h3 a',
        'ytd-playlist-panel-renderer #header-description h3',
        'ytd-playlist-header-renderer yt-dynamic-sizing-formatted-string',
        'yt-page-header-renderer h1',
        'ytd-playlist-sidebar-primary-info-renderer h1',
    ];

    /**
     * The extension icon, for the drawer entry and the sheet header alike.
     * Both are injected into YouTube's page, so `icons/` has to be listed in
     * web_accessible_resources or the browser refuses to load either one.
     */
    function iconUrl() {
        try {
            return chrome.runtime.getURL('icons/icon128.png');
        } catch (_) {
            return '';
        }
    }

    /** chrome.* throws once the extension reloads; a live id means we are fine. */
    function hasExtensionContext() {
        return !!(chrome.runtime && chrome.runtime.id);
    }

    /**
     * Dress an overlay in the current theme and skin. Every surface goes
     * through this, so the two attributes are always set together and cannot
     * drift apart.
     */
    function dress(element, { theme, skin }) {
        element.classList.add('bb-themed');
        element.dataset.bbTheme = theme;
        element.dataset.bbSkin = skin;
    }

    /**
     * What to dress the next surface in: the skin the user picked, and the
     * light/dark of the page we are sitting on top of. Only the skin is a
     * setting — see Theme.pageTheme for why the theme is not.
     */
    async function appearance() {
        const { skin } = await Settings.get(['skin']);
        return { theme: Theme.pageTheme(), skin: skin || 'default' };
    }

    /**
     * Is this element actually drawn? Zero-sized and `display:none` nodes are
     * both out; so is `visibility:hidden`, which keeps its box.
     *
     * Size rather than `offsetParent`, which this used to test: offsetParent
     * is null for a `position:fixed` element that is perfectly visible, and
     * YouTube's headers do become fixed when the page is scrolled.
     */
    function isVisible(element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) return false;
        const style = getComputedStyle(element);
        return style.visibility !== 'hidden' && style.display !== 'none';
    }

    /**
     * The first element, across these selectors, that is actually on screen.
     *
     * Every match of each selector is considered, not just the first in the
     * document. That is the whole point: a /playlist page keeps a
     * `ytd-playlist-panel-renderer` header in the DOM — the queue-panel markup
     * a watch page would show — fully built but zero-sized, and YouTube also
     * renders more than one `yt-flexible-actions-view-model` per page. Testing
     * only `document.querySelector` meant that when the dead copy happened to
     * come first, the selector was abandoned and the real header below it was
     * never seen, so the follow button appeared on whichever playlists put the
     * live node first and on no others.
     */
    function firstMatch(selectors) {
        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
                if (isVisible(element)) return element;
            }
        }
        return null;
    }

    function createYouTubeUi({ watcher, notify, getPouchButtonStyle }) {

        const sheet = PouchSheet.createPouchSheet({ notify, dress, appearance, iconUrl });

        /**
         * The pouch's channels, held here so that deciding whether the button
         * on this page should read "+" or a tick does not go to storage on
         * every SPA navigation. The storage watcher below keeps it honest.
         */
        let pouchChannels = null;

        async function channels() {
            if (!pouchChannels) pouchChannels = (await Subscriptions.load()).channels;
            return pouchChannels;
        }

        Settings.watch([Settings.DATA.channels], () => {
            pouchChannels = null;
            markPouchButton();
        });

        /** Followed playlists, cached the same way and for the same reason. */
        let followed = null;

        async function followedPlaylists() {
            if (!followed) followed = await Playlists.load();
            return followed;
        }

        Settings.watch([Settings.DATA.playlists], () => {
            followed = null;
            markPlaylistButton();
        });

        // ------------------------------------------------------ pouch button

        /**
         * Insert the button after YouTube's Subscribe button.
         *
         * Two strategies, not the previous five: sit next to the animation
         * wrapper inside the subscribe renderer if it is there, otherwise
         * directly after the renderer. The extra fallbacks all resolved to
         * containers that put the button on its own line anyway.
         */
        function injectPouchButton() {
            if (getPouchButtonStyle() === 'hidden') return true;
            if (document.getElementById(BUTTON_ID)) return true;

            const renderer = document.querySelector('ytd-subscribe-button-renderer');
            const anchor = renderer || document.querySelector('yt-button-shape button[aria-label*="Subscribe"]');
            if (!anchor || !anchor.parentElement) return false;

            const button = document.createElement('button');
            button.id = BUTTON_ID;
            button.type = 'button';
            button.className = getPouchButtonStyle() === 'accent' ? 'bb-accent' : '';
            button.innerHTML = POUCH_ICON;
            button.title = 'Add channel to Bell Bearer pouch';
            button.setAttribute('aria-label', 'Add channel to Bell Bearer pouch');
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (button.classList.contains('bb-in-pouch')) openRemoveChannelDialog();
                else openAddChannelDialog();
            });

            const smartimation = renderer && renderer.querySelector('yt-smartimation');
            const target = (smartimation && smartimation.parentElement) ? smartimation : anchor;
            const parent = target.parentElement;

            parent.classList.add('bb-inline-row');
            parent.insertBefore(button, target.nextSibling);

            markPouchButton();
            return true;
        }

        /**
         * Show whether this page's channel is already filed.
         *
         * Runs after injection and again on every navigation, because YouTube
         * keeps the same button element across an SPA move to a different
         * channel's video — without this the tick would stay behind on a
         * channel that was never in the pouch.
         */
        async function markPouchButton() {
            const button = document.getElementById(BUTTON_ID);
            if (!button || !hasExtensionContext()) return;

            const info = PageInfo.getChannelInfo();
            const filed = (await channels()).some((channel) => sameChannel(channel, info));

            button.classList.toggle('bb-in-pouch', filed);
            button.innerHTML = filed ? TICK_ICON : POUCH_ICON;

            const label = filed
                ? `${info.channelName} is in your pouch — click to remove it`
                : 'Add channel to Bell Bearer pouch';
            button.title = label;
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-pressed', String(filed));
        }

        /**
         * A pouch record and the page's channel are the same channel when
         * either the URL matches or the key derived from it does — a channel
         * filed from its /@handle page and met again as /channel/UC… on a
         * watch page is one channel, not two.
         */
        function sameChannel(channel, info) {
            if (!info.channelUrl) return false;
            if (channel.url === info.channelUrl) return true;
            const key = YouTube.extractChannelId(info.channelUrl);
            return !!key && channel.id === key;
        }

        /** Re-render the button after its style setting changed. */
        function refreshPouchButton() {
            const existing = document.getElementById(BUTTON_ID);
            if (existing) existing.remove();
            if (getPouchButtonStyle() === 'hidden') return;
            watcher.add('pouch-button', injectPouchButton);
        }

        // --------------------------------------------------- playlist button

        /**
         * A "follow this playlist" button in the playlist header.
         *
         * YouTube will tell you when a channel uploads; it will not tell you
         * when something is added to a playlist you care about, which for a
         * course, a label's releases or a friend's mix is the only event that
         * matters. Following one puts its new entries in the strip at the
         * bottom of the pouch sheet.
         */
        function injectPlaylistButton(href) {
            const playlistId = currentPlaylistId(href);
            if (!playlistId) return true; // nothing to follow on this page

            if (document.getElementById(PLAYLIST_BUTTON_ID)) return true;

            const header = firstMatch(PLAYLIST_HEADER_SELECTORS);
            if (!header) return false;

            const button = document.createElement('button');
            button.id = PLAYLIST_BUTTON_ID;
            button.type = 'button';
            button.className = 'bb-playlist-follow';
            button.dataset.playlistId = playlistId;
            button.innerHTML = '<span class="bb-pf-label">Follow</span>';
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                togglePlaylist(button);
            });

            header.appendChild(button);
            markPlaylistButton();
            return true;
        }

        /**
         * The playlist this page is about, mixes and autoplay queues excluded.
         *
         * `href` is a seam for the tests, which cannot move the address bar of
         * the page they run in. Nothing in the extension passes it.
         */
        function currentPlaylistId(href) {
            return YouTube.extractPlaylistId(href || window.location.href);
        }

        function playlistTitle() {
            const element = firstMatch(PLAYLIST_TITLE_SELECTORS);
            const text = element && (element.textContent || '').replace(/\s+/g, ' ').trim();
            return text || 'Playlist';
        }

        async function markPlaylistButton() {
            const button = document.getElementById(PLAYLIST_BUTTON_ID);
            if (!button || !hasExtensionContext()) return;

            const isFollowed = Playlists.has(await followedPlaylists(), button.dataset.playlistId);
            button.classList.toggle('bb-following', isFollowed);
            button.querySelector('.bb-pf-label').textContent = isFollowed ? 'Following' : 'Follow';
            button.title = isFollowed
                ? 'New entries in this playlist show in your pouch — click to stop following'
                : 'Follow this playlist and see new entries in your pouch';
            button.setAttribute('aria-pressed', String(isFollowed));
        }

        async function togglePlaylist(button) {
            if (!hasExtensionContext()) return notify(CONTEXT_LOST, 'warning');

            const playlistId = button.dataset.playlistId;
            button.disabled = true;

            try {
                if (Playlists.has(await followedPlaylists(), playlistId)) {
                    await Playlists.remove(playlistId);
                    followed = null;
                    await markPlaylistButton();
                    notify('Playlist unfollowed', 'info');
                    return;
                }

                // What the playlist holds right now is recorded as already
                // seen, so following it does not immediately report all two
                // hundred existing entries as new.
                const current = await Feed.fetchPlaylistVideos(playlistId, Playlists.SEEN_LIMIT);
                await Playlists.add({
                    id: playlistId,
                    title: playlistTitle(),
                    url: YouTube.playlistUrl(playlistId),
                    videoIds: current.map((video) => video.id),
                });

                followed = null;
                await markPlaylistButton();
                notify('Following this playlist — new entries appear in your pouch', 'success');
            } catch (error) {
                console.error('Bell Bearer: could not follow playlist', error);
                notify('Could not follow that playlist', 'error');
            } finally {
                button.disabled = false;
            }
        }

        // ------------------------------------------------------- guide entry

        /**
         * Sit third in YouTube's own first section — after Home and Shorts —
         * rather than above the drawer entirely, where a bare div prepended to
         * `#sections` read as a stray heading above the nav instead of an item
         * in it.
         *
         * YouTube streams the drawer in, so the first section can be one or
         * two items short on the first few passes. Returning false leaves the
         * task armed and the watcher tries again on the next mutation. After
         * GUIDE_ATTEMPTS passes we take whatever slot exists: a signed-out
         * drawer, or one with Shorts turned off, may never reach three.
         */
        const GUIDE_ATTEMPTS = 12;
        let guideTries = 0;

        function injectGuideEntry() {
            const sections = document.querySelector('ytd-guide-renderer #sections');
            if (!sections) return false;
            if (document.getElementById(GUIDE_ID)) return true;

            const items = sections.querySelector('ytd-guide-section-renderer #items');
            if (!items) return false;
            if (items.children.length < 3 && ++guideTries < GUIDE_ATTEMPTS) return false;
            guideTries = 0;

            const entry = document.createElement('div');
            entry.id = GUIDE_ID;
            entry.className = 'bb-guide-entry';
            entry.setAttribute('role', 'link');
            entry.setAttribute('tabindex', '0');
            entry.title = 'Bell Bearer — latest from your topics';
            // The icon is the extension's own, which is why icons/ has to stay in
            // web_accessible_resources: YouTube's page cannot load it otherwise.
            //
            // The row also carries YouTube's own scope classes. Those rules are
            // real, global and specific enough to win, so the icon column and
            // the label take their metrics from the same stylesheet Home and
            // Shorts do; content.css keeps a matching fallback for the day
            // YouTube renames them.
            //
            // The label is the one word. It used to read "Open Pouch", which
            // is an instruction sitting in a list of places — every other row
            // in that drawer is named after where it goes, not after what
            // clicking it does.
            entry.innerHTML =
                '<span class="bb-guide-ico guide-icon style-scope ytd-guide-entry-renderer">' +
                '<img src="' + iconUrl() + '" alt="" aria-hidden="true">' +
                '</span>' +
                '<span class="bb-guide-text title style-scope ytd-guide-entry-renderer">Pouch</span>';

            const open = () => openTopicsDialog();
            entry.addEventListener('click', open);
            entry.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                open();
            });

            items.insertBefore(entry, items.children[2] || null);
            return true;
        }

        // ---------------------------------------------------- topics sheet

        async function openTopicsDialog() {
            if (!hasExtensionContext()) return notify(CONTEXT_LOST, 'warning');
            return sheet.open();
        }

        // ------------------------------------------------------ pouch panel

        /**
         * File the channel on screen under a topic.
         *
         * The panel leads with the channel so it is obvious which one is being
         * filed, offers the existing topics as single-select chips, and keeps a
         * new-topic field underneath — a channel belongs to exactly one topic.
         */
        async function openAddChannelDialog() {
            if (!hasExtensionContext()) return notify(CONTEXT_LOST, 'warning');

            const channelInfo = PageInfo.getChannelInfo();
            const [{ topics, channels: filed }, look] = await Promise.all([
                Subscriptions.load(),
                appearance(),
            ]);

            const already = filed.find((channel) => sameChannel(channel, channelInfo));
            const currentTopic = already && topics.find((topic) => topic.id === already.topicId);

            const dialog = Overlay.open({
                id: 'bb-add-channel-modal',
                contentHtml: pouchHtml(channelInfo, topics, currentTopic),
            });
            if (!dialog) return;

            dress(dialog.element, look);

            const $ = (selector) => dialog.element.querySelector(selector);
            const chipRow = $('.bb-chips');
            const newTopicName = $('.bb-new-topic input');
            const createTopic = $('.bb-new-topic button');
            const save = $('#bb-save-channel');

            let chosen = currentTopic ? currentTopic.id : (topics[0] ? topics[0].id : null);

            function markChips() {
                chipRow.querySelectorAll('.bb-topic-chip').forEach((chip) => {
                    chip.setAttribute('aria-pressed', String(chip.dataset.topicId === chosen));
                });
            }
            markChips();

            chipRow.addEventListener('click', (event) => {
                const chip = event.target.closest('.bb-topic-chip');
                if (!chip) return;
                chosen = chip.dataset.topicId;
                markChips();
            });

            /**
             * Creating a topic files the channel in it and closes, rather than
             * creating an empty topic and waiting to be told to save. Naming a
             * topic while a channel is on screen in front of you is not a
             * request for a topic — it is the answer to "where does this go".
             */
            createTopic.addEventListener('click', async () => {
                const name = newTopicName.value.trim();
                if (!name) {
                    notify('Enter a name for the new topic.', 'warning');
                    return newTopicName.focus();
                }

                createTopic.disabled = true;
                const id = await Subscriptions.createTopic(name);
                if (!id) {
                    createTopic.disabled = false;
                    return notify('Could not create that topic', 'error');
                }

                chosen = id;
                await fileChannel(`Added to "${name}"`);
            });

            newTopicName.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                createTopic.click();
            });

            save.addEventListener('click', () => {
                if (!chosen) {
                    notify('Pick a topic, or create one first.', 'warning');
                    return newTopicName.focus();
                }
                fileChannel('Channel added to pouch!');
            });

            /** The one write both paths go through. */
            async function fileChannel(message) {
                save.disabled = true; // a double-click otherwise filed it twice
                createTopic.disabled = true;

                try {
                    await Subscriptions.addChannel({
                        name: channelInfo.channelName,
                        url: channelInfo.channelUrl,
                        topicId: chosen,
                    });
                    pouchChannels = null;
                    dialog.close();
                    markPouchButton();
                    notify(message, 'success');
                } catch (error) {
                    console.error('Bell Bearer: failed to save channel', error);
                    save.disabled = false;
                    createTopic.disabled = false;
                    notify(CONTEXT_LOST, 'warning');
                }
            }
        }

        /**
         * Take the channel on screen back out of the pouch.
         *
         * A tick that a stray click turns straight back into nothing would be
         * the one nasty surprise in an otherwise reversible toggle, so this
         * asks first — a skin-aware confirm rather than a native `confirm()`,
         * which would sit outside the theme entirely.
         */
        async function openRemoveChannelDialog() {
            if (!hasExtensionContext()) return notify(CONTEXT_LOST, 'warning');

            const channelInfo = PageInfo.getChannelInfo();
            const [filed, look] = await Promise.all([channels(), appearance()]);
            const channel = filed.find((entry) => sameChannel(entry, channelInfo));
            if (!channel) return openAddChannelDialog(); // state drifted; let the user re-file

            const dialog = Overlay.open({
                id: 'bb-remove-channel-modal',
                contentHtml: removeChannelHtml(channelInfo),
            });
            if (!dialog) return;

            dress(dialog.element, look);

            const remove = dialog.element.querySelector('#bb-confirm-remove');
            remove.addEventListener('click', async () => {
                remove.disabled = true;
                try {
                    await Subscriptions.deleteChannel(channel.id);
                    pouchChannels = null;
                    dialog.close();
                    markPouchButton();
                    notify('Channel removed from pouch', 'info');
                } catch (error) {
                    console.error('Bell Bearer: failed to remove channel', error);
                    remove.disabled = false;
                    notify(CONTEXT_LOST, 'warning');
                }
            });
        }

        function removeChannelHtml(channelInfo) {
            return `
                <div class="bb-panel bb-panel-sm">
                    <div class="bb-panel-head">
                        <h3>Remove from pouch?</h3>
                        <button class="bb-close" type="button" data-bb-close aria-label="Close">&times;</button>
                    </div>
                    <div class="bb-panel-body">
                        <p class="bb-muted">${Dom.escapeHtml(channelInfo.channelName)} will be taken out of your
                            pouch. Its topic keeps the other channels in it.</p>
                        <div class="bb-actions">
                            <button class="bb-btn" type="button" data-bb-close>Cancel</button>
                            <button class="bb-btn bb-btn-danger" type="button" id="bb-confirm-remove">Remove</button>
                        </div>
                    </div>
                </div>`;
        }

        function pouchHtml(channelInfo, topics, currentTopic) {
            const avatar = channelInfo.avatar
                ? `<img class="bb-pouch-avatar" src="${Dom.safeUrlAttr(channelInfo.avatar)}" alt="">`
                : '<div class="bb-pouch-avatar"></div>';

            const status = currentTopic
                ? `in ${Dom.escapeHtml(currentTopic.name)}`
                : 'not yet in a topic';
            const subscribers = channelInfo.subscribers
                ? `${Dom.escapeHtml(channelInfo.subscribers)} · `
                : '';

            const chips = topics.map((topic) => `
                <button class="bb-topic-chip" type="button" data-topic-id="${Dom.escapeAttr(topic.id)}"
                        aria-pressed="false">${Dom.escapeHtml(topic.name)}</button>`).join('');

            return `
                <div class="bb-panel bb-panel-sm">
                    <div class="bb-panel-head">
                        <h3>Add to pouch</h3>
                        <button class="bb-close" type="button" data-bb-close aria-label="Close">&times;</button>
                    </div>
                    <div class="bb-pouch-channel">
                        ${avatar}
                        <div style="min-width:0">
                            <div class="bb-pouch-name">${Dom.escapeHtml(channelInfo.channelName)}</div>
                            <div class="bb-pouch-sub">${subscribers}${status}</div>
                        </div>
                    </div>
                    <div class="bb-panel-body">
                        <span class="bb-field-label">Topic</span>
                        <div class="bb-chips">${chips}</div>
                        <span class="bb-field-label">${topics.length ? 'Or Create a New One' : 'Start your first topic'}</span>
                        <div class="bb-new-topic">
                            <input class="bb-input" type="text" placeholder="Topic name" aria-label="New topic name">
                            <button class="bb-btn" type="button">Create</button>
                        </div>
                        <div class="bb-actions">
                            <button class="bb-btn" type="button" data-bb-close>Cancel</button>
                            <button class="bb-btn bb-btn-primary" type="button" id="bb-save-channel">Save channel</button>
                        </div>
                    </div>
                </div>`;
        }

        // ------------------------------------------------------------ setup

        function install() {
            watcher.add('pouch-button', injectPouchButton);
            watcher.add('guide-entry', injectGuideEntry);
            watcher.add('playlist-button', injectPlaylistButton);
        }

        /** YouTube rebuilds the page on SPA navigation; re-arm the injections. */
        function onNavigate() {
            if (!document.getElementById(BUTTON_ID)) watcher.add('pouch-button', injectPouchButton);
            else markPouchButton();

            if (!document.getElementById(GUIDE_ID)) watcher.add('guide-entry', injectGuideEntry);

            // The playlist button is torn out rather than re-marked: a watch
            // page reached from a different playlist keeps the old panel
            // element, and following one list while looking at another is the
            // kind of bug nobody notices until the wrong thing is followed.
            const playlistButton = document.getElementById(PLAYLIST_BUTTON_ID);
            if (playlistButton && playlistButton.dataset.playlistId !== currentPlaylistId()) {
                playlistButton.remove();
            }
            if (!document.getElementById(PLAYLIST_BUTTON_ID)) {
                watcher.add('playlist-button', injectPlaylistButton);
            } else {
                markPlaylistButton();
            }
        }

        // injectGuideEntry is returned so a test can place the entry without
        // going through the watcher, which only runs on an animation frame.
        return {
            install, onNavigate, refreshPouchButton,
            openTopicsDialog, openAddChannelDialog, openRemoveChannelDialog,
            injectGuideEntry, injectPouchButton, injectPlaylistButton,
            markPouchButton, markPlaylistButton,
        };
    }

    const YouTubeUi = {
        createYouTubeUi,
        firstMatch, isVisible, PLAYLIST_HEADER_SELECTORS,
        BUTTON_ID, GUIDE_ID, PLAYLIST_BUTTON_ID,
        RANGES: PouchSheet.RANGES, SORTS: PouchSheet.SORTS,
        ALL_TOPICS: PouchSheet.ALL_TOPICS, PER_CHANNEL: PouchSheet.PER_CHANNEL,
    };

    root.BB = root.BB || {};
    root.BB.YouTubeUi = YouTubeUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = YouTubeUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
