/**
 * Everything Bell Bearer injects into YouTube's own page: the "add to pouch"
 * button beside Subscribe, the entry in the left drawer, and the two surfaces
 * those open — the topics sheet and the pouch panel.
 *
 * All the markup here interpolates data the user does not control — channel
 * names scraped from the page, titles and thumbnail URLs from an RSS feed — so
 * text goes through escapeHtml and every URL through safeUrlAttr, which drops
 * anything that is not http(s).
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
    const Settings = ns.Settings || req('../shared/settings.js');
    const Subscriptions = ns.Subscriptions || req('../shared/subscriptions.js');
    const Time = ns.Time || req('../shared/time.js');
    const Overlay = ns.Overlay || req('./overlay.js');
    const PageInfo = ns.PageInfo || req('./page-info.js');
    const Theme = ns.Theme || req('./theme.js');

    const BUTTON_ID = 'bb-add-to-subscriptions-btn';
    const GUIDE_ID = 'bb-guide-entry';
    const CONTEXT_LOST = 'Bell Bearer was updated — please refresh this page.';

    /** How many uploads to pull per channel. The 90d range needs some depth. */
    const PER_CHANNEL = 15;

    const RANGES = [
        { id: '7d', label: '7d', days: 7 },
        { id: '30d', label: '30d', days: 30 },
        { id: '90d', label: '90d', days: 90 },
        { id: 'all', label: 'All', days: null },
    ];
    const DEFAULT_RANGE = '30d';

    const SORTS = [
        { id: 'newest', label: 'Newest' },
        { id: 'oldest', label: 'Oldest' },
        { id: 'channel', label: 'Channel' },
    ];

    const ALL_TOPICS = '__all__';

    const POUCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:24px;height:24px;fill:currentColor;"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"></path></svg>';

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

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

    function createYouTubeUi({ watcher, notify, getPouchButtonStyle }) {

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
            button.title = 'Add channel to Bell Bearer pouch';
            button.setAttribute('aria-label', 'Add channel to Bell Bearer pouch');
            button.innerHTML = POUCH_ICON;
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openAddChannelDialog();
            });

            const smartimation = renderer && renderer.querySelector('yt-smartimation');
            const target = (smartimation && smartimation.parentElement) ? smartimation : anchor;
            const parent = target.parentElement;

            parent.classList.add('bb-inline-row');
            parent.insertBefore(button, target.nextSibling);
            return true;
        }

        /** Re-render the button after its style setting changed. */
        function refreshPouchButton() {
            const existing = document.getElementById(BUTTON_ID);
            if (existing) existing.remove();
            if (getPouchButtonStyle() === 'hidden') return;
            watcher.add('pouch-button', injectPouchButton);
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
            entry.innerHTML =
                '<span class="bb-guide-ico guide-icon style-scope ytd-guide-entry-renderer">' +
                '<img src="' + iconUrl() + '" alt="" aria-hidden="true">' +
                '</span>' +
                '<span class="bb-guide-text title style-scope ytd-guide-entry-renderer">Open Pouch</span>';

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

        /**
         * The topics sheet: a near-full-screen frosted panel, the topic rail on
         * the left and a thumbnail grid on the right.
         *
         * Every channel's feed is fetched once when the sheet opens and held
         * for as long as it stays open. Choosing a topic, narrowing the range
         * and re-sorting are then all local. The previous version refetched on
         * every topic click, so returning to a topic you had already looked at
         * went back to the network for answers it already had.
         */
        async function openTopicsDialog() {
            if (!hasExtensionContext()) return notify(CONTEXT_LOST, 'warning');

            const [{ topics, channels }, look] = await Promise.all([
                Subscriptions.load(),
                appearance(),
            ]);

            const dialog = Overlay.open({ id: 'bb-topics-overlay', contentHtml: sheetHtml() });
            if (!dialog) return;

            dialog.element.classList.add('bb-sheet-overlay');
            dress(dialog.element, look);

            const $ = (selector) => dialog.element.querySelector(selector);
            const rail = $('.bb-topics');
            const grid = $('.bb-videos');
            const sub = $('.bb-sheet-sub');

            /** Everything fetched, across every channel. Filtered, never refetched. */
            let videos = [];
            let topicId = ALL_TOPICS;
            let range = DEFAULT_RANGE;
            let sort = 'newest';
            let loading = true;

            const channelsIn = (id) => channels.filter((channel) => channel.topicId === id);

            function inRange(video) {
                const days = (RANGES.find((entry) => entry.id === range) || {}).days;
                if (!days) return true;
                return video.published >= Date.now() - days * 864e5;
            }

            function visible() {
                const wanted = videos.filter(inRange);
                const scoped = topicId === ALL_TOPICS
                    ? wanted
                    : wanted.filter((video) => channelsIn(topicId).some((c) => c.id === video.channelId));

                if (sort === 'oldest') return [...scoped].sort((a, b) => a.published - b.published);
                if (sort === 'channel') {
                    return [...scoped].sort((a, b) =>
                        (a.channelName || '').localeCompare(b.channelName || '') ||
                        b.published - a.published);
                }
                return [...scoped].sort((a, b) => b.published - a.published);
            }

            /** Videos in range per topic, for the counts down the rail. */
            function counts() {
                const wanted = videos.filter(inRange);
                const byTopic = new Map(topics.map((topic) => [topic.id, 0]));
                wanted.forEach((video) => {
                    const channel = channels.find((entry) => entry.id === video.channelId);
                    if (!channel || !byTopic.has(channel.topicId)) return;
                    byTopic.set(channel.topicId, byTopic.get(channel.topicId) + 1);
                });
                return { total: wanted.length, byTopic };
            }

            function renderRail() {
                const { total, byTopic } = counts();
                const rows = topics.map((topic) => topicRow(
                    topic.id,
                    topic.name,
                    loading ? '' : String(byTopic.get(topic.id) || 0),
                    topic.id === topicId,
                ));

                rail.innerHTML = `
                    <div class="bb-topics-label">Topics</div>
                    ${topicRow(ALL_TOPICS, 'All', loading ? '' : String(total), topicId === ALL_TOPICS)}
                    ${rows.join('')}
                    <button class="bb-topic-add" type="button">+ New topic</button>`;

                sub.textContent = loading
                    ? 'Loading…'
                    : `${plural(total, 'video')} · ${plural(topics.length, 'topic')}`;
            }

            function renderGrid() {
                if (loading) {
                    grid.innerHTML = '<p class="bb-muted">Loading the latest from your channels…</p>';
                    return;
                }
                if (!channels.length) {
                    grid.innerHTML = '<p class="bb-muted">No channels yet — use the button beside Subscribe to file one under a topic.</p>';
                    return;
                }

                const list = visible();
                grid.innerHTML = list.length
                    ? `<div class="bb-video-grid">${list.map(videoCard).join('')}</div>`
                    : '<p class="bb-muted">Nothing published in this range.</p>';
            }

            const render = () => { renderRail(); renderGrid(); };
            render();

            // ---- interaction

            // One delegated listener: the rail is re-rendered whenever a count
            // changes, so per-button listeners would have to be re-bound.
            rail.addEventListener('click', (event) => {
                const add = event.target.closest('.bb-topic-add');
                if (add) return startNewTopic(add);

                const button = event.target.closest('.bb-topic');
                if (!button) return;
                topicId = button.dataset.topicId;
                render();
            });

            $('.bb-seg').addEventListener('click', (event) => {
                const option = event.target.closest('.bb-seg-opt');
                if (!option) return;
                range = option.dataset.range;
                dialog.element.querySelectorAll('.bb-seg-opt').forEach((other) => {
                    other.setAttribute('aria-pressed', String(other === option));
                });
                render();
            });

            $('.bb-select').addEventListener('change', (event) => {
                sort = event.target.value;
                renderGrid();
            });

            /**
             * "+ New topic" becomes an input in place. A nested modal was the
             * obvious alternative, but its Escape handler and the sheet's would
             * both sit on document, so one Escape would close the sheet out
             * from under the prompt.
             */
            function startNewTopic(button) {
                const form = document.createElement('form');
                form.className = 'bb-new-topic';
                form.innerHTML = `
                    <input class="bb-input" type="text" placeholder="Topic name" aria-label="New topic name">
                    <button class="bb-btn" type="submit">Create</button>`;
                button.replaceWith(form);

                const input = form.querySelector('input');
                input.focus();

                const cancel = () => { form.replaceWith(button); };
                input.addEventListener('keydown', (event) => {
                    if (event.key !== 'Escape') return;
                    event.stopPropagation(); // do not also close the sheet
                    cancel();
                });
                input.addEventListener('blur', () => { if (!input.value.trim()) cancel(); });

                form.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    const name = input.value.trim();
                    if (!name) return cancel();

                    form.querySelector('button').disabled = true;
                    const id = await Subscriptions.createTopic(name);
                    topics.push({ id, name });
                    topicId = id;
                    render();
                    notify(`Topic "${name}" created`, 'success');
                });
            }

            // ---- the fetch

            if (!channels.length) {
                loading = false;
                render();
                return;
            }

            const fetched = await Feed.fetchLatestForChannels(channels, PER_CHANNEL);
            if (!dialog.element.isConnected) return; // closed while we waited
            videos = fetched;
            loading = false;
            render();
        }

        function sheetHtml() {
            const ranges = RANGES.map((range) => `
                <button class="bb-seg-opt" type="button" data-range="${range.id}"
                        aria-pressed="${range.id === DEFAULT_RANGE}">${range.label}</button>`).join('');

            const sorts = SORTS.map((sort) =>
                `<option value="${sort.id}">${sort.label}</option>`).join('');

            return `
                <div class="bb-sheet">
                    <div class="bb-sheet-head">
                        <div class="bb-sheet-brand">
                            <img src="${Dom.escapeAttr(iconUrl())}" alt="">
                            <span class="bb-sheet-title">Pouch</span>
                            <span class="bb-sheet-sub">Loading…</span>
                        </div>
                        <div class="bb-sheet-tools">
                            <div class="bb-seg" role="group" aria-label="Time range">${ranges}</div>
                            <select class="bb-select" aria-label="Sort">${sorts}</select>
                            <button class="bb-close" type="button" data-bb-close aria-label="Close">&times;</button>
                        </div>
                    </div>
                    <div class="bb-sheet-body">
                        <nav class="bb-topics"></nav>
                        <div class="bb-videos"></div>
                    </div>
                </div>`;
        }

        function topicRow(id, name, count, active) {
            return `
                <button class="bb-topic" type="button" data-topic-id="${Dom.escapeAttr(id)}"${active ? ' aria-current="true"' : ''}>
                    <span class="bb-topic-name">${Dom.escapeHtml(name)}</span>
                    <span class="bb-topic-n">${Dom.escapeHtml(count)}</span>
                </button>`;
        }

        function videoCard(video) {
            // An entry with no published date gets no age label at all, rather
            // than a placeholder dash the eye has to skip over.
            const age = Time.relativeTime(video.published);
            return `
                <a class="bb-video-card" href="${Dom.safeUrlAttr(video.url)}">
                    <img src="${Dom.safeUrlAttr(video.thumb)}" alt="" loading="lazy">
                    <div class="bb-video-meta">
                        <div class="bb-video-title">${Dom.escapeHtml(video.title)}</div>
                        <div class="bb-video-channel">
                            <span>${Dom.escapeHtml(video.channelName || '')}</span>
                            ${age ? `<span class="bb-video-age">${Dom.escapeHtml(age)}</span>` : ''}
                        </div>
                    </div>
                </a>`;
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
            const [{ topics, channels }, look] = await Promise.all([
                Subscriptions.load(),
                appearance(),
            ]);

            const already = channels.find((channel) => channel.url === channelInfo.channelUrl);
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

            createTopic.addEventListener('click', async () => {
                const name = newTopicName.value.trim();
                if (!name) {
                    notify('Enter a name for the new topic.', 'warning');
                    return newTopicName.focus();
                }

                createTopic.disabled = true;
                const id = await Subscriptions.createTopic(name);

                const chip = document.createElement('button');
                chip.className = 'bb-topic-chip';
                chip.type = 'button';
                chip.dataset.topicId = id;
                chip.textContent = name;
                chipRow.appendChild(chip);

                chosen = id;
                markChips();
                newTopicName.value = '';
                createTopic.disabled = false;
            });

            newTopicName.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                createTopic.click();
            });

            save.addEventListener('click', async () => {
                if (!chosen) {
                    notify('Pick a topic, or create one first.', 'warning');
                    return newTopicName.focus();
                }

                save.disabled = true; // a double-click otherwise filed it twice
                try {
                    await Subscriptions.addChannel({
                        name: channelInfo.channelName,
                        url: channelInfo.channelUrl,
                        topicId: chosen,
                    });
                    dialog.close();
                    notify('Channel added to pouch!', 'success');
                } catch (error) {
                    console.error('Bell Bearer: failed to save channel', error);
                    save.disabled = false;
                    notify(CONTEXT_LOST, 'warning');
                }
            });
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
                        <span class="bb-field-label">${topics.length ? 'Or start a new one' : 'Start your first topic'}</span>
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
        }

        /** YouTube rebuilds the page on SPA navigation; re-arm the injections. */
        function onNavigate() {
            if (!document.getElementById(BUTTON_ID)) watcher.add('pouch-button', injectPouchButton);
            if (!document.getElementById(GUIDE_ID)) watcher.add('guide-entry', injectGuideEntry);
        }

        // injectGuideEntry is returned so a test can place the entry without
        // going through the watcher, which only runs on an animation frame.
        return {
            install, onNavigate, refreshPouchButton,
            openTopicsDialog, openAddChannelDialog, injectGuideEntry,
        };
    }

    const YouTubeUi = { createYouTubeUi, BUTTON_ID, GUIDE_ID, RANGES, SORTS, ALL_TOPICS, PER_CHANNEL };

    root.BB = root.BB || {};
    root.BB.YouTubeUi = YouTubeUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = YouTubeUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
