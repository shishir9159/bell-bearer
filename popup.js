/**
 * The toolbar popup: recent checkpoints, and an optional speed bar.
 *
 * Import/export, modals, toasts, theme and tab control all live in the shared
 * modules now — this file is the popup's own wiring and rendering only. It used
 * to carry its own copy of each, plus two dead methods (a changeSpeed() nothing
 * called and a copySubtitles() with no button).
 */
(function () {
    'use strict';

    const { Bookmarks, Settings, Speed, Time, Dom, Ui, Transfer, TabActions } = window.BB;

    class Popup {
        constructor() {
            this.videos = [];
            this.selectedVideoId = null;
            this.showSpeedBar = false;
            this.speedTab = null;

            this.transfer = Transfer.createTransfer({
                getVideos: () => this.videos,
                setVideos: async (videos) => {
                    this.videos = videos;
                    await Bookmarks.save(videos);
                    this.render();
                },
                notify: (message, type) => Ui.toast(message, type),
                fileInputId: 'importFile',
            });
        }

        async init() {
            Ui.installTheme({});
            this.wireControls();
            this.transfer.install();

            const [videos, settings] = await Promise.all([
                Bookmarks.load(),
                Settings.get(['showSpeedButtonsInPopup', 'hideInstructions']),
            ]);
            this.videos = videos;
            this.showSpeedBar = settings.showSpeedButtonsInPopup;

            this.setupInstructions(settings.hideInstructions);
            this.render();
            this.setupSpeedBar();

            // The popup is a separate document from the pages that write
            // checkpoints, so without this it shows a stale list whenever a
            // checkpoint is saved while it is open.
            Settings.watch([Bookmarks.KEY], () => {
                Bookmarks.load().then((next) => {
                    this.videos = next;
                    this.render();
                });
            });
        }

        // ------------------------------------------------------- controls

        wireControls() {
            const on = (id, event, handler) => {
                const element = document.getElementById(id);
                if (element) element.addEventListener(event, handler);
            };

            on('dashboardBtn', 'click', () => {
                chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
                window.close();
            });
            on('exportBtn', 'click', () => this.transfer.exportBookmarks());
            on('importBtn', 'click', () => this.transfer.showImportOptions());
            on('clearAll', 'click', () => this.clearAll());

            // Delegation: the list is re-rendered wholesale, so per-row
            // listeners would have to be re-attached (and were leaking).
            const list = document.getElementById('videoList');
            list.addEventListener('click', (event) => {
                const item = event.target.closest('.video-item');
                if (item) this.selectVideo(item.dataset.videoId);
            });

            const details = document.getElementById('bookmarkDetails');
            details.addEventListener('click', (event) => {
                const button = event.target.closest('button');
                if (!button) return;
                const item = button.closest('.bookmark-item');
                if (!item) return;

                if (button.classList.contains('seek-btn')) {
                    this.seek(item.dataset.videoId, Number(button.dataset.time));
                } else if (button.classList.contains('delete-btn')) {
                    this.deleteBookmark(item.dataset.videoId, Number(item.dataset.bookmarkIndex));
                }
            });
        }

        setupInstructions(hidden) {
            const box = document.getElementById('instructions');
            if (!box) return;
            if (hidden) box.style.display = 'none';

            const dismiss = document.getElementById('dismissInstructions');
            if (dismiss) {
                dismiss.addEventListener('click', () => {
                    box.style.display = 'none';
                    Settings.set({ hideInstructions: true });
                });
            }
        }

        // ------------------------------------------------------ speed bar

        async setupSpeedBar() {
            const bar = document.getElementById('speedControlBar');
            if (!bar) return;

            if (!this.showSpeedBar) {
                bar.hidden = true;
                return;
            }
            bar.hidden = false;

            document.getElementById('speedUpBtn').addEventListener('click', () => this.step(1));
            document.getElementById('speedDownBtn').addEventListener('click', () => this.step(-1));
            document.getElementById('speedResetBtn').addEventListener('click', () => this.step(0));

            this.speedTab = await TabActions.activeTab();
            this.showRate(await TabActions.getRate(this.speedTab));
        }

        /**
         * Step the ladder in the active tab. The buttons used to add a flat
         * +/-0.5, which is what put the rate between the rungs the keyboard
         * shortcuts step through.
         */
        async step(direction) {
            if (!this.speedTab) this.speedTab = await TabActions.activeTab();
            this.showRate(await TabActions.stepRate(this.speedTab, direction));
        }

        showRate(rate) {
            const display = document.getElementById('speedDisplay');
            if (!display) return;
            display.textContent = rate == null ? '—' : Speed.format(rate);
            display.title = rate == null ? 'No video on this page' : '';
        }

        // -------------------------------------------------------- actions

        selectVideo(videoId) {
            this.selectedVideoId = videoId;
            this.render();
        }

        /**
         * Jump to a checkpoint. When the current tab is not that video, offer to
         * open it rather than silently seeking whatever happens to be playing.
         */
        async seek(videoId, time) {
            const tab = await TabActions.activeTab();
            const onThisVideo = tab && window.BB.YouTube.extractVideoId(tab.url || '') === videoId;

            if (onThisVideo && await TabActions.seek(tab, time)) return;

            const open = await Ui.confirmDialog({
                title: 'Open this video?',
                message: 'This tab is not playing that video. Open it in a new tab at the checkpoint?',
                confirmLabel: 'Open video',
            });
            if (!open) return;

            await chrome.tabs.create({
                url: window.BB.YouTube.watchUrl(videoId, time),
                index: tab ? tab.index + 1 : undefined,
            });
        }

        async deleteBookmark(videoId, bookmarkIndex) {
            this.videos = Bookmarks.removeBookmark(this.videos, videoId, bookmarkIndex);
            if (!this.videos.some((video) => video.id === this.selectedVideoId)) {
                this.selectedVideoId = null;
            }
            await Bookmarks.save(this.videos);
            this.render();
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
            this.selectedVideoId = null;
            await Bookmarks.save(this.videos);
            this.render();
            Ui.toast('All checkpoints deleted', 'info');
        }

        // ------------------------------------------------------ rendering

        render() {
            this.renderVideoList();
            this.renderDetails();
        }

        renderVideoList() {
            const list = document.getElementById('videoList');

            if (this.videos.length === 0) {
                list.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">🔖</div>
                        <h3>No checkpoints yet</h3>
                        <p>Hold <strong>Ctrl + B</strong> on any YouTube video to drop your first checkpoint.</p>
                    </div>`;
                return;
            }

            list.innerHTML = this.videos.map((video) => {
                const count = video.bookmarks.length;
                return `
                    <div class="video-item${video.id === this.selectedVideoId ? ' selected' : ''}"
                         data-video-id="${Dom.escapeAttr(video.id)}" role="button" tabindex="0">
                        <div class="video-title">${Dom.escapeHtml(video.title)}</div>
                        <div class="video-meta">
                            <span class="bookmark-count">${count}</span>
                            checkpoint${count === 1 ? '' : 's'}
                        </div>
                    </div>`;
            }).join('');
        }

        renderDetails() {
            const details = document.getElementById('bookmarkDetails');
            const video = this.videos.find((v) => v.id === this.selectedVideoId);

            if (!video) {
                details.innerHTML = `
                    <div class="no-selection">
                        <div class="empty-icon">⏱️</div>
                        <p>Select a video to see its checkpoints</p>
                    </div>`;
                return;
            }

            const count = video.bookmarks.length;
            details.innerHTML = `
                <div class="bd-header">
                    <h3>${Dom.escapeHtml(video.title)}</h3>
                    <span class="bd-count">${count} checkpoint${count === 1 ? '' : 's'}</span>
                </div>
                <div class="checkpoint-timeline">
                    ${video.bookmarks.map((bookmark, index) => renderBookmark(video, bookmark, index)).join('')}
                </div>`;
        }
    }

    function renderBookmark(video, bookmark, index) {
        const isSpan = typeof bookmark.start === 'number' && typeof bookmark.end === 'number';
        const time = Bookmarks.bookmarkTime(bookmark);
        const label = isSpan
            ? `${Time.formatTime(bookmark.start)} – ${Time.formatTime(bookmark.end)}`
            : Time.formatTime(time);

        return `
            <div class="bookmark-item" data-bookmark-index="${index}" data-video-id="${Dom.escapeAttr(video.id)}">
                <div class="bookmark-time">${label}</div>
                ${bookmark.title ? `<div class="bookmark-name">${Dom.escapeHtml(bookmark.title)}</div>` : ''}
                ${bookmark.note ? `<div class="bookmark-note">${Dom.escapeHtml(bookmark.note)}</div>` : ''}
                <div class="bookmark-actions">
                    <button class="btn-small seek-btn" data-time="${time}">▶ Go to</button>
                    <button class="btn-small delete delete-btn">Delete</button>
                </div>
            </div>`;
    }

    new Popup().init().catch((error) => {
        console.error('Bell Bearer: popup failed to start', error);
    });
})();
