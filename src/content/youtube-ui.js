/**
 * Everything Bell Bearer injects into YouTube's own page: the "add to pouch"
 * button beside Subscribe, the entry in the left drawer, and the two dialogs
 * those open.
 *
 * All the markup here interpolates data the user does not control — channel
 * names scraped from the page, titles and thumbnail URLs from an RSS feed — so
 * text goes through escapeHtml and every URL through safeUrlAttr, which drops
 * anything that is not http(s).
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Feed = ns.Feed || req('../shared/feed.js');
    const Settings = ns.Settings || req('../shared/settings.js');
    const Subscriptions = ns.Subscriptions || req('../shared/subscriptions.js');
    const Overlay = ns.Overlay || req('./overlay.js');
    const PageInfo = ns.PageInfo || req('./page-info.js');
    const Theme = ns.Theme || req('./theme.js');

    const BUTTON_ID = 'bb-add-to-subscriptions-btn';
    const GUIDE_ID = 'bb-guide-entry';
    const CONTEXT_LOST = 'Bell Bearer was updated — please refresh this page.';

    const POUCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:24px;height:24px;fill:currentColor;"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"></path></svg>';

    const BELL_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

    /** chrome.* throws once the extension reloads; a live id means we are fine. */
    function hasExtensionContext() {
        return !!(chrome.runtime && chrome.runtime.id);
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

        function injectGuideEntry() {
            const sections = document.querySelector('ytd-guide-renderer #sections');
            if (!sections) return false;
            if (document.getElementById(GUIDE_ID)) return true;

            const entry = document.createElement('div');
            entry.id = GUIDE_ID;
            entry.className = 'bb-guide-entry';
            entry.setAttribute('role', 'link');
            entry.setAttribute('tabindex', '0');
            entry.title = 'Bell Bearer — latest from your topics';
            entry.innerHTML = `<span class="bb-guide-ico">${BELL_ICON}</span><span class="bb-guide-text">Bell Bearer</span>`;

            const open = () => openTopicsDialog();
            entry.addEventListener('click', open);
            entry.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                open();
            });

            sections.prepend(entry);
            return true;
        }

        // --------------------------------------------------- topics overlay

        async function openTopicsDialog() {
            if (!hasExtensionContext()) return notify(CONTEXT_LOST, 'warning');

            const [{ topics, channels }, settings] = await Promise.all([
                Subscriptions.load(),
                Settings.get(['theme']),
            ]);
            const theme = Theme.palette(settings.theme);

            const chips = topics.length
                ? topics.map((topic) =>
                    `<button class="bb-topic-chip" type="button" aria-pressed="false" data-topic-id="${Dom.escapeAttr(topic.id)}">${Dom.escapeHtml(topic.name)}</button>`).join('')
                : '<p class="bb-muted">No topics yet — add channels to a topic using the button next to Subscribe.</p>';

            const dialog = Overlay.open({
                id: 'bb-topics-overlay',
                contentHtml: `
                    <div class="bb-panel bb-panel-lg">
                        <div class="bb-panel-head">
                            <h3>Latest by topic</h3>
                            <button class="bb-close" type="button" title="Close" data-bb-close aria-label="Close">&times;</button>
                        </div>
                        <div class="bb-chips">${chips}</div>
                        <div class="bb-panel-body" id="bb-topic-videos">
                            <p class="bb-muted">Select a topic to load the latest video from each of its channels.</p>
                        </div>
                    </div>`,
            });
            if (!dialog) return;

            dialog.element.classList.add('bb-themed', 'bb-modal-top');
            dialog.element.dataset.bbTheme = theme.dark ? 'dark' : 'light';

            const results = dialog.element.querySelector('#bb-topic-videos');
            const chipButtons = Array.from(dialog.element.querySelectorAll('.bb-topic-chip'));

            // One token guards against a slow first request overwriting the
            // results of a second, faster one when topics are clicked quickly.
            let requestToken = 0;

            chipButtons.forEach((chip) => {
                chip.addEventListener('click', async () => {
                    chipButtons.forEach((other) => other.setAttribute('aria-pressed', String(other === chip)));

                    const token = ++requestToken;
                    results.innerHTML = '<p class="bb-muted">Loading latest videos…</p>';

                    const topicChannels = channels.filter((c) => c.topicId === chip.dataset.topicId);
                    if (topicChannels.length === 0) {
                        results.innerHTML = '<p class="bb-muted">No channels in this topic yet.</p>';
                        return;
                    }

                    const videos = await Feed.fetchLatestForChannels(topicChannels, 1);
                    if (token !== requestToken || !dialog.element.isConnected) return;

                    results.innerHTML = videos.length
                        ? `<div class="bb-video-grid">${videos.map(videoCard).join('')}</div>`
                        : '<p class="bb-muted">Could not load videos for these channels.</p>';
                });
            });
        }

        function videoCard(video) {
            return `
                <a class="bb-video-card" href="${Dom.safeUrlAttr(video.url)}">
                    <img src="${Dom.safeUrlAttr(video.thumb)}" alt="" loading="lazy">
                    <div class="bb-video-meta">
                        <div class="bb-video-title">${Dom.escapeHtml(video.title)}</div>
                        <div class="bb-video-channel">${Dom.escapeHtml(video.channelName || '')}</div>
                    </div>
                </a>`;
        }

        // ----------------------------------------------- add-channel dialog

        async function openAddChannelDialog() {
            if (!hasExtensionContext()) return notify(CONTEXT_LOST, 'warning');

            const channelInfo = PageInfo.getChannelInfo();
            const [{ topics }, settings] = await Promise.all([
                Subscriptions.load(),
                Settings.get(['theme']),
            ]);
            const theme = Theme.palette(settings.theme);

            const options = topics
                .map((topic) => `<option value="${Dom.escapeAttr(topic.id)}">${Dom.escapeHtml(topic.name)}</option>`)
                .join('');

            const dialog = Overlay.open({
                id: 'bb-add-channel-modal',
                contentHtml: `
                    <div class="bb-panel bb-panel-sm">
                        <div class="bb-panel-body">
                            <h3 style="margin:0 0 6px;font-size:17px;">Add channel to pouch</h3>
                            <p class="bb-muted" style="margin-bottom:18px;font-weight:500;">${Dom.escapeHtml(channelInfo.channelName)}</p>

                            <label class="bb-field-label" for="bb-topic-select">Topic</label>
                            <select class="bb-input" id="bb-topic-select">
                                ${options}
                                <option value="__new__">➕ Create new topic…</option>
                            </select>
                            <input class="bb-input" type="text" id="bb-new-topic" placeholder="New topic name" style="display:none;">

                            <div class="bb-actions">
                                <button class="bb-btn" type="button" data-bb-close>Cancel</button>
                                <button class="bb-btn bb-btn-primary" type="button" id="bb-save-channel">Add</button>
                            </div>
                        </div>
                    </div>`,
            });
            if (!dialog) return;

            dialog.element.classList.add('bb-themed');
            dialog.element.dataset.bbTheme = theme.dark ? 'dark' : 'light';

            const select = dialog.element.querySelector('#bb-topic-select');
            const newTopic = dialog.element.querySelector('#bb-new-topic');
            const save = dialog.element.querySelector('#bb-save-channel');

            const syncNewTopicField = () => {
                const creating = select.value === '__new__';
                newTopic.style.display = creating ? 'block' : 'none';
                if (creating) newTopic.focus();
            };
            if (topics.length === 0) select.value = '__new__';
            syncNewTopicField();
            select.addEventListener('change', syncNewTopicField);

            save.addEventListener('click', async () => {
                save.disabled = true; // a double-click otherwise filed the channel twice
                try {
                    let topicId = select.value;
                    if (topicId === '__new__') {
                        const name = newTopic.value.trim();
                        if (!name) {
                            notify('Enter a name for the new topic.', 'warning');
                            newTopic.focus();
                            save.disabled = false;
                            return;
                        }
                        topicId = await Subscriptions.createTopic(name);
                    }
                    await Subscriptions.addChannel({
                        name: channelInfo.channelName,
                        url: channelInfo.channelUrl,
                        topicId,
                    });
                    dialog.close();
                    notify('Channel added to pouch!', 'success');
                } catch (error) {
                    console.error('Bell Bearer: failed to save channel', error);
                    save.disabled = false;
                    notify(CONTEXT_LOST, 'warning');
                }
            });

            newTopic.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') save.click();
            });
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

        return { install, onNavigate, refreshPouchButton, openTopicsDialog, openAddChannelDialog };
    }

    const YouTubeUi = { createYouTubeUi, BUTTON_ID, GUIDE_ID };

    root.BB = root.BB || {};
    root.BB.YouTubeUi = YouTubeUi;
    if (typeof module !== 'undefined' && module.exports) module.exports = YouTubeUi;
})(typeof globalThis !== 'undefined' ? globalThis : this);
