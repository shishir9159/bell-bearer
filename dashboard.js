/**
 * The dashboard: saved checkpoints, the subscription pouch, and settings.
 *
 * Rendering and event wiring are separated here. Every list is re-rendered
 * wholesale into innerHTML, so listeners are attached ONCE to the container and
 * dispatched by delegation. renderSubscriptions() used to add a fresh click
 * listener to its container on every render — after three renders one "Remove
 * channel" click ran three confirmations and three deletes.
 */
(function () {
    'use strict';

    const { Bookmarks, Pins, Subscriptions, Settings, Feed, Time, Dom, YouTube, Ui, Transfer, TabActions, SettingsForm } = window.BB;

    /**
     * A pin, as a glyph. An emoji pin renders as a different object on every
     * platform and is coloured by the font rather than the skin; this one takes
     * currentColor and so follows the accent of whichever skin is on.
     */
    const PIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3v2h-1v5l2 2.5V15h-4.2v6l-.8 1-.8-1v-6H7v-2.5L9 10V5H8V3z"/></svg>';

    // Tab id / view id stems. 'stats' is the Activity view: its tab stays
    // hidden until the trackActivity setting is on, but the switching wiring
    // is unconditional so it works the moment the tab appears.
    const VIEWS = ['dashboard', 'subscriptions', 'stats', 'settings'];

    class Dashboard {
        constructor() {
            this.videos = [];
            this.pinned = [];
            this.topics = [];
            this.channels = [];
            this.newVideos = [];
            this.view = 'dashboard';
            this.sort = Settings.DEFAULTS.dashboardSort;
            this.refreshing = false;

            this.transfer = Transfer.createTransfer({
                getVideos: () => this.videos,
                setVideos: async (videos) => {
                    this.videos = videos;
                    await Bookmarks.save(videos);
                    this.renderBookmarks();
                },
                notify: (message, type) => Ui.toast(message, type),
                fileInputId: 'importFile',
            });
        }

        async init() {
            // Wire the UI before loading data: a failure while reading storage
            // must never leave the settings toggles dead, since a setting could
            // then never be turned on.
            Ui.installTheme({ toggleId: 'themeToggle' });
            SettingsForm.bindAll();
            this.wireControls();
            this.transfer.install();

            await this.reload();
            this.render();

            // Follow changes made from a YouTube page or the popup, reloading
            // only the store that moved. Saving one checkpoint used to re-read
            // the bookmarks, the topics, the channels and the new-video list.
            const subscriptionKeys = [Settings.DATA.topics, Settings.DATA.channels, Settings.DATA.newVideos];
            Settings.watch([Bookmarks.KEY, Pins.KEY, ...subscriptionKeys], (changed) => {
                const jobs = [];
                if (Bookmarks.KEY in changed) {
                    jobs.push(Bookmarks.load().then((videos) => { this.videos = videos; }));
                }
                if (Pins.KEY in changed) {
                    jobs.push(Pins.load().then((pinned) => { this.pinned = pinned; }));
                }
                if (subscriptionKeys.some((key) => key in changed)) {
                    jobs.push(Subscriptions.load().then((subscriptions) => {
                        this.topics = subscriptions.topics;
                        this.channels = subscriptions.channels;
                        this.newVideos = subscriptions.newVideos;
                    }));
                }
                Promise.all(jobs).then(() => this.render());
            });
        }

        async reload() {
            const [videos, subscriptions, pinned, settings] = await Promise.all([
                Bookmarks.load(),
                Subscriptions.load(),
                Pins.load(),
                Settings.get(['dashboardSort']),
            ]);
            this.videos = videos;
            this.pinned = pinned;
            this.sort = settings.dashboardSort;
            this.topics = subscriptions.topics;
            this.channels = subscriptions.channels;
            this.newVideos = subscriptions.newVideos;
        }

        // ------------------------------------------------------- controls

        wireControls() {
            const on = (id, event, handler) => {
                const element = document.getElementById(id);
                if (element) element.addEventListener(event, handler);
            };

            VIEWS.forEach((view) => on(`${view}Tab`, 'click', () => this.switchView(view)));

            on('exportBtn', 'click', () => this.transfer.exportBookmarks());
            on('importBtn', 'click', () => this.transfer.showImportOptions());
            on('clearAll', 'click', () => this.clearAll());
            this.setupSortControl();
            on('addTopicBtn', 'click', () => this.addTopic());
            on('refreshVideosBtn', 'click', () => this.refreshNewVideos());

            this.wireVideosContainer();
            this.wireTopicsContainer();
        }

        wireVideosContainer() {
            const container = document.getElementById('videosContainer');

            container.addEventListener('click', (event) => {
                const button = event.target.closest('button');
                if (!button) return;

                const card = button.closest('.video-card');
                const item = button.closest('.bookmark-item');
                const videoId = card && card.dataset.videoId;
                const index = item ? Number(item.dataset.bookmarkIndex) : -1;

                if (button.classList.contains('pin-btn')) this.togglePin(videoId);
                else if (button.classList.contains('seek-btn')) this.seek(videoId, Number(button.dataset.time));
                else if (button.classList.contains('delete-btn')) this.deleteBookmark(videoId, index);
                else if (button.classList.contains('copy-bookmark-subtitle')) this.copyOne(videoId, index);
                else if (button.classList.contains('copy-subtitles-with-time')) this.copyAll(videoId, true);
                else if (button.classList.contains('copy-subtitles-no-time')) this.copyAll(videoId, false);
            });

            container.addEventListener('change', (event) => {
                const input = event.target.closest('.bookmark-title-input');
                if (!input) return;
                const item = input.closest('.bookmark-item');
                const card = input.closest('.video-card');
                this.saveBookmarkTitle(card.dataset.videoId, Number(item.dataset.bookmarkIndex), input.value.trim());
            });

            container.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && event.target.closest('.bookmark-title-input')) event.target.blur();
            });
        }

        wireTopicsContainer() {
            const container = document.getElementById('topicsContainer');

            container.addEventListener('click', (event) => {
                const button = event.target.closest('button');
                if (!button) return;

                if (button.classList.contains('edit-topic-btn')) this.renameTopic(button.dataset.topicId);
                else if (button.classList.contains('delete-topic-btn')) this.deleteTopic(button.dataset.topicId);
                else if (button.classList.contains('delete-channel-btn')) this.deleteChannel(button.dataset.channelId);
                else if (button.classList.contains('mark-watched-btn')) this.markWatched(button.dataset.videoId);
            });
        }

        switchView(view) {
            this.view = view;
            VIEWS.forEach((name) => {
                const tab = document.getElementById(`${name}Tab`);
                const panel = document.getElementById(`${name}View`);
                if (tab) tab.classList.toggle('active', name === view);
                if (panel) panel.classList.toggle('active', name === view);
            });
            this.render();
        }

        render() {
            const select = document.getElementById('sortVideos');
            if (select && select.value !== this.sort) select.value = this.sort;

            if (this.view === 'dashboard') this.renderBookmarks();
            else if (this.view === 'subscriptions') this.renderSubscriptions();
            // 'stats' renders itself — src/page/stats.js owns that view and
            // reads the activity store, never the bookmark store.
            else if (this.view === 'stats' && window.BB.Stats) window.BB.Stats.render();
        }

        // ------------------------------------------------- checkpoint view

        renderBookmarks() {
            const container = document.getElementById('videosContainer');

            if (this.videos.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <h3>No saved checkpoints</h3>
                        <p>Hold Ctrl + B while watching a video to save one.</p>
                    </div>`;
                return;
            }

            // Sort first, then lift the pinned ones out of the result: the two
            // are independent, so changing the order never loses a pin and
            // pinning never quietly changes the order of everything else.
            const ordered = Pins.hoist(Bookmarks.sortVideos(this.videos, this.sort), this.pinned);
            const pinned = new Set(this.pinned);

            container.innerHTML = ordered
                .map((video) => this.renderVideoCard(video, pinned.has(video.id)))
                .join('');
        }

        renderVideoCard(video, isPinned) {
            const hasSubtitles = video.bookmarks.some((bookmark) => bookmark.subtitle);
            const count = video.bookmarks.length;

            return `
                <div class="video-card${isPinned ? ' is-pinned' : ''}" data-video-id="${Dom.escapeAttr(video.id)}">
                    <div class="video-card-header">
                        <button class="pin-btn" type="button" aria-pressed="${!!isPinned}"
                                title="${isPinned ? 'Unpin from the top' : 'Pin to the top'}"
                                aria-label="${isPinned ? 'Unpin' : 'Pin'} ${Dom.escapeAttr(video.title)}">${PIN_ICON}</button>
                        <h3 class="video-title">${Dom.escapeHtml(video.title)}</h3>
                        <div class="video-card-meta">
                            <span class="bookmark-count-badge">${count} checkpoint${count === 1 ? '' : 's'}</span>
                            ${hasSubtitles ? `
                                <button class="btn-small copy-subtitles-with-time" title="Copy all subtitles with timestamps">📋 Copy all (time)</button>
                                <button class="btn-small copy-subtitles-no-time" title="Copy all subtitles">📋 Copy all</button>
                            ` : ''}
                        </div>
                    </div>
                    <div class="video-bookmarks">
                        ${count > 0
                            ? video.bookmarks.map((bookmark, index) => renderBookmarkRow(bookmark, index)).join('')
                            : '<p class="no-bookmarks">No checkpoints for this video</p>'}
                    </div>
                </div>`;
        }

        // ----------------------------------------------- subscription view

        renderSubscriptions() {
            const container = document.getElementById('topicsContainer');

            if (this.topics.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <h3>No topics yet</h3>
                        <p>Create a topic, then add channels to it with the pouch button next to Subscribe on YouTube.</p>
                    </div>`;
                return;
            }

            container.innerHTML = this.topics.map((topic) => {
                const channels = this.channels.filter((channel) => channel.topicId === topic.id);
                const channelIds = new Set(channels.map((channel) => channel.id));
                const videos = this.newVideos.filter((video) => channelIds.has(video.channelId));

                return `
                    <div class="topic-card" data-topic-id="${Dom.escapeAttr(topic.id)}">
                        <div class="topic-header">
                            <h3 class="topic-name">${Dom.escapeHtml(topic.name)}</h3>
                            <div class="topic-actions">
                                <button class="btn-small edit-topic-btn" data-topic-id="${Dom.escapeAttr(topic.id)}">Rename</button>
                                <button class="btn-small delete-topic-btn" data-topic-id="${Dom.escapeAttr(topic.id)}">Delete</button>
                            </div>
                        </div>
                        <div class="topic-channels">
                            <h4>Channels (${channels.length})</h4>
                            ${channels.length > 0
                                ? `<div class="channels-list">${channels.map(renderChannelRow).join('')}</div>`
                                : '<p class="no-channels">No channels in this topic</p>'}
                        </div>
                        ${videos.length > 0 ? `
                            <div class="topic-new-videos">
                                <h4>Latest (${videos.length})</h4>
                                <div class="new-videos-list">${videos.map(renderNewVideoRow).join('')}</div>
                            </div>` : ''}
                    </div>`;
            }).join('');
        }

        // ------------------------------------------------- sorting, pinning

        /**
         * Fill the sort dropdown from the shared list and remember the choice.
         *
         * The options are built here rather than written into dashboard.html so
         * that adding an order means touching one array in the bookmark store,
         * not three files that then disagree.
         */
        setupSortControl() {
            const select = document.getElementById('sortVideos');
            if (!select) return;

            select.innerHTML = Bookmarks.SORTS
                .map((sort) => `<option value="${Dom.escapeAttr(sort.id)}">${Dom.escapeHtml(sort.label)}</option>`)
                .join('');

            select.addEventListener('change', () => {
                this.sort = select.value;
                Settings.set({ dashboardSort: this.sort });
                this.renderBookmarks();
            });
        }

        async togglePin(videoId) {
            if (!videoId) return;
            const wasPinned = this.pinned.includes(videoId);

            this.pinned = await Pins.toggle(videoId);
            this.renderBookmarks();

            // Pinning moves the card to the top of a long list, which is easy
            // to miss if you were looking at where it used to be.
            Ui.toast(wasPinned ? 'Unpinned' : 'Pinned to the top', 'info');
        }

        // ---------------------------------------------------- bookmark ops

        async seek(videoId, time) {
            const tab = await TabActions.findVideoTab(videoId);
            if (tab) {
                await chrome.tabs.update(tab.id, { active: true });
                await chrome.windows.update(tab.windowId, { focused: true });
                if (await TabActions.seek(tab, time)) return;
            }
            await chrome.tabs.create({ url: YouTube.watchUrl(videoId, time) });
        }

        async deleteBookmark(videoId, index) {
            this.videos = Bookmarks.removeBookmark(this.videos, videoId, index);
            await Bookmarks.save(this.videos);
            this.renderBookmarks();
        }

        async saveBookmarkTitle(videoId, index, title) {
            const video = this.videos.find((v) => v.id === videoId);
            if (!video || !video.bookmarks[index]) return;
            video.bookmarks[index].title = title;
            await Bookmarks.save(this.videos);
        }

        async clearAll() {
            const confirmed = await Ui.confirmDialog({
                title: 'Delete every checkpoint?',
                message: 'This removes all saved checkpoints for every video. It cannot be undone.',
                confirmLabel: 'Delete all',
                danger: true,
            });
            if (!confirmed) return;

            this.videos = [];
            await Bookmarks.save(this.videos);
            this.renderBookmarks();
            Ui.toast('All checkpoints deleted', 'info');
        }

        // ------------------------------------------------------ subtitles

        async copyOne(videoId, index) {
            const video = this.videos.find((v) => v.id === videoId);
            const bookmark = video && video.bookmarks[index];
            if (!bookmark || !bookmark.subtitle) {
                Ui.toast('That checkpoint has no subtitle text', 'warning');
                return;
            }
            const time = Time.formatTime(Bookmarks.bookmarkTime(bookmark));
            const ok = await Ui.copyText(`[${time}] ${bookmark.subtitle}`);
            Ui.toast(ok ? 'Subtitle copied' : 'Could not copy to the clipboard', ok ? 'info' : 'error');
        }

        async copyAll(videoId, withTimestamps) {
            const video = this.videos.find((v) => v.id === videoId);
            const withText = (video ? video.bookmarks : []).filter((bookmark) => bookmark.subtitle);
            if (withText.length === 0) {
                Ui.toast('No subtitles saved for this video', 'warning');
                return;
            }

            const lines = withText.map((bookmark) => (withTimestamps
                ? `[${Time.formatTime(Bookmarks.bookmarkTime(bookmark))}] ${bookmark.subtitle}`
                : bookmark.subtitle));

            const ok = await Ui.copyText(lines.join('\n'));
            Ui.toast(
                ok ? `Copied ${lines.length} subtitles${withTimestamps ? ' with timestamps' : ''}` : 'Could not copy to the clipboard',
                ok ? 'info' : 'error',
            );
        }

        // -------------------------------------------------- subscriptions

        async addTopic() {
            const name = await Ui.promptDialog({
                title: 'Add a topic',
                label: 'Topic name',
                placeholder: 'Programming, Gaming, Music…',
            });
            if (!name) return;

            await Subscriptions.createTopic(name);
            await this.reload();
            this.renderSubscriptions();
        }

        async renameTopic(topicId) {
            const topic = this.topics.find((t) => t.id === topicId);
            if (!topic) return;

            const name = await Ui.promptDialog({ title: 'Rename topic', label: 'Topic name', value: topic.name });
            if (!name) return;

            await Subscriptions.renameTopic(topicId, name);
            await this.reload();
            this.renderSubscriptions();
        }

        async deleteTopic(topicId) {
            const confirmed = await Ui.confirmDialog({
                title: 'Delete this topic?',
                message: 'Its channels are kept, but they will no longer belong to a topic.',
                confirmLabel: 'Delete topic',
                danger: true,
            });
            if (!confirmed) return;

            await Subscriptions.deleteTopic(topicId);
            await this.reload();
            this.renderSubscriptions();
        }

        async deleteChannel(channelId) {
            const confirmed = await Ui.confirmDialog({
                title: 'Remove this channel?',
                message: 'It will be taken out of the pouch.',
                confirmLabel: 'Remove',
                danger: true,
            });
            if (!confirmed) return;

            await Subscriptions.deleteChannel(channelId);
            await this.reload();
            this.renderSubscriptions();
        }

        async markWatched(videoId) {
            await Subscriptions.markWatched(videoId);
            await this.reload();
            this.renderSubscriptions();
        }

        /**
         * Pull the latest uploads for every channel in the pouch from their
         * public RSS feeds. This button used to open an alert explaining that
         * the user should go and check YouTube themselves.
         */
        async refreshNewVideos() {
            if (this.refreshing) return;

            const button = document.getElementById('refreshVideosBtn');
            if (this.channels.length === 0) {
                Ui.toast('Add some channels to the pouch first', 'warning');
                return;
            }

            this.refreshing = true;
            const label = button.textContent;
            button.disabled = true;
            button.textContent = 'Refreshing…';

            try {
                // Refresh means refresh: skip the feed cache the pouch reads
                // from. With a large pouch this is a minute of work, so the
                // button counts the channels off rather than sitting on one
                // unchanging "Refreshing…" while nothing appears to happen.
                const videos = await Feed.fetchLatestForChannels(this.channels, 3, {
                    fresh: true,
                    onProgress: (_videos, done, total) => {
                        button.textContent = `Refreshing ${done}/${total}…`;
                    },
                });
                if (videos.length === 0) {
                    Ui.toast('Could not read any channel feeds', 'error');
                    return;
                }
                await Subscriptions.setNewVideos(videos.map((video) => ({
                    id: video.id,
                    title: video.title,
                    url: video.url,
                    channelId: video.channelId,
                    channelName: video.channelName,
                    publishedAt: video.published,
                    addedAt: Date.now(),
                })));
                await this.reload();
                this.renderSubscriptions();
                Ui.toast(`Found ${videos.length} recent uploads`, 'info');
            } catch (error) {
                console.error('Bell Bearer: refresh failed', error);
                Ui.toast('Could not refresh — check your connection', 'error');
            } finally {
                this.refreshing = false;
                button.disabled = false;
                button.textContent = label;
            }
        }
    }

    // --------------------------------------------------------- templates

    function renderBookmarkRow(bookmark, index) {
        const isSpan = typeof bookmark.start === 'number' && typeof bookmark.end === 'number';
        const time = Bookmarks.bookmarkTime(bookmark);
        const label = isSpan
            ? `${Time.formatTime(bookmark.start)} – ${Time.formatTime(bookmark.end)}`
            : Time.formatTime(time);

        // Older saves recorded a missing subtitle as the string "null".
        const subtitle = bookmark.subtitle && bookmark.subtitle !== 'null' ? bookmark.subtitle : '';

        return `
            <div class="bookmark-item" data-bookmark-index="${index}">
                <div class="bookmark-time-row">
                    <div class="bookmark-time">${label}</div>
                    <input type="text" class="bookmark-title-input" placeholder="Add title…"
                           value="${Dom.escapeAttr(bookmark.title || '')}">
                </div>
                ${bookmark.note ? `<div class="bookmark-note">${Dom.escapeHtml(bookmark.note)}</div>` : ''}
                ${subtitle ? `<div class="bookmark-subtitle">"${Dom.escapeHtml(subtitle)}"</div>` : ''}
                <div class="bookmark-actions">
                    ${subtitle ? '<button class="btn-small copy-bookmark-subtitle" title="Copy subtitle">📋</button>' : ''}
                    <button class="btn-small seek-btn" data-time="${time}">Go to time</button>
                    <button class="btn-small delete delete-btn">Delete</button>
                </div>
            </div>`;
    }

    function renderChannelRow(channel) {
        return `
            <div class="channel-item" data-channel-id="${Dom.escapeAttr(channel.id)}">
                <span class="channel-name">${Dom.escapeHtml(channel.name)}</span>
                <div class="channel-actions">
                    <a href="${Dom.safeUrlAttr(channel.url)}" target="_blank" rel="noopener noreferrer" class="btn-small">Visit</a>
                    <button class="btn-small delete-channel-btn" data-channel-id="${Dom.escapeAttr(channel.id)}">Remove</button>
                </div>
            </div>`;
    }

    function renderNewVideoRow(video) {
        const published = video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : '';
        return `
            <div class="new-video-item" data-video-id="${Dom.escapeAttr(video.id)}">
                <div class="new-video-info">
                    <a href="${Dom.safeUrlAttr(video.url)}" target="_blank" rel="noopener noreferrer" class="new-video-title">${Dom.escapeHtml(video.title)}</a>
                    <span class="new-video-channel">${Dom.escapeHtml(video.channelName || '')}</span>
                    <span class="new-video-date">${Dom.escapeHtml(published)}</span>
                </div>
                <div class="new-video-actions">
                    <button class="btn-small mark-watched-btn" data-video-id="${Dom.escapeAttr(video.id)}">Mark watched</button>
                </div>
            </div>`;
    }

    new Dashboard().init().catch((error) => {
        console.error('Bell Bearer: dashboard failed to start', error);
    });
})();
