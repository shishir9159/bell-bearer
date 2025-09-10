class Dashboard {
    constructor() {
        this.videos = [];
        this.topics = [];
        this.channels = [];
        this.newVideos = [];
        this.currentView = 'dashboard';
        this.init();
    }

    async init() {
        await this.loadBookmarks();
        await this.loadSubscriptions();
        this.setupEventListeners();
        this.setupTheme();
        this.renderDashboard();
    }

    async loadBookmarks() {
        try {
            const result = await chrome.storage.local.get(['youtubeBookmarks']);
            this.videos = result.youtubeBookmarks || [];
        } catch (error) {
            console.error('Error loading bookmarks:', error);
            this.videos = [];
        }
    }

    async loadSubscriptions() {
        try {
            const result = await chrome.storage.local.get(['subscriptionTopics', 'subscriptionChannels', 'newVideos']);
            this.topics = result.subscriptionTopics || [];
            this.channels = result.subscriptionChannels || [];
            this.newVideos = result.newVideos || [];
        } catch (error) {
            console.error('Error loading subscriptions:', error);
            this.topics = [];
            this.channels = [];
            this.newVideos = [];
        }
    }

    async saveSubscriptions() {
        try {
            await chrome.storage.local.set({
                subscriptionTopics: this.topics,
                subscriptionChannels: this.channels,
                newVideos: this.newVideos
            });
        } catch (error) {
            console.error('Error saving subscriptions:', error);
        }
    }

    setupEventListeners() {
        document.getElementById('dashboardTab').addEventListener('click', () => {
            this.switchView('dashboard');
        });

        document.getElementById('subscriptionsTab').addEventListener('click', () => {
            this.switchView('subscriptions');
        });

        document.getElementById('settingsTab').addEventListener('click', () => {
            this.switchView('settings');
        });

        // Subscription manager controls
        document.getElementById('addChannelBtn').addEventListener('click', () => {
            this.showAddChannelModal();
        });

        document.getElementById('addTopicBtn').addEventListener('click', () => {
            this.showAddTopicModal();
        });

        document.getElementById('refreshVideosBtn').addEventListener('click', () => {
            this.refreshNewVideos();
        });

        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportBookmarks();
        });

        document.getElementById('importBtn').addEventListener('click', () => {
            this.showImportOptions();
        });

        document.getElementById('clearAll').addEventListener('click', () => {
            this.clearAllBookmarks();
        });

        document.getElementById('importFile').addEventListener('change', (e) => {
            this.handleFileImport(e.target.files[0]);
        });

        // Event delegation for bookmark actions
        const videosContainer = document.getElementById('videosContainer');
        videosContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('seek-btn')) {
                const bookmarkItem = e.target.closest('.bookmark-item');
                if (bookmarkItem) {
                    const videoId = bookmarkItem.dataset.videoId;
                    const time = parseFloat(e.target.dataset.time);
                    this.seekToTime(videoId, time);
                }
            } else if (e.target.classList.contains('delete-btn')) {
                const bookmarkItem = e.target.closest('.bookmark-item');
                if (bookmarkItem) {
                    const videoId = bookmarkItem.dataset.videoId;
                    const bookmarkIndex = parseInt(bookmarkItem.dataset.bookmarkIndex);
                    this.deleteBookmark(videoId, bookmarkIndex);
                }
            } else if (e.target.classList.contains('open-video-btn')) {
                const videoCard = e.target.closest('.video-card');
                if (videoCard) {
                    const videoId = videoCard.dataset.videoId;
                    this.openVideo(videoId);
                }
            } else if (e.target.classList.contains('copy-bookmark-subtitle')) {
                const videoId = e.target.dataset.videoId;
                const bookmarkIndex = parseInt(e.target.dataset.bookmarkIndex);
                const video = this.videos.find(v => v.id === videoId);
                if (video && video.bookmarks[bookmarkIndex]) {
                    this.copyBookmarkSubtitle(video.bookmarks[bookmarkIndex], e.target.dataset.time);
                }
            } else if (e.target.classList.contains('copy-subtitles-with-time')) {
                const videoId = e.target.dataset.videoId;
                const video = this.videos.find(v => v.id === videoId);
                if (video) {
                    this.copySubtitles(video, true);
                }
            } else if (e.target.classList.contains('copy-subtitles-no-time')) {
                const videoId = e.target.dataset.videoId;
                const video = this.videos.find(v => v.id === videoId);
                if (video) {
                    this.copySubtitles(video, false);
                }
            }
        });
    }

    switchView(view) {
        this.currentView = view;

        // Update tab states
        document.getElementById('dashboardTab').classList.toggle('active', view === 'dashboard');
        document.getElementById('subscriptionsTab').classList.toggle('active', view === 'subscriptions');
        document.getElementById('settingsTab').classList.toggle('active', view === 'settings');

        // Update view visibility
        document.getElementById('dashboardView').classList.toggle('active', view === 'dashboard');
        document.getElementById('subscriptionsView').classList.toggle('active', view === 'subscriptions');
        document.getElementById('settingsView').classList.toggle('active', view === 'settings');

        if (view === 'dashboard') {
            this.renderDashboard();
        } else if (view === 'subscriptions') {
            this.renderSubscriptions();
        }
    }

    renderDashboard() {
        const videosContainer = document.getElementById('videosContainer');

        if (this.videos.length === 0) {
            videosContainer.innerHTML = `
                <div class="empty-state">
                    <h3>No bookmarked videos</h3>
                    <p>Start watching YouTube videos and use Ctrl+B to create bookmarks</p>
                </div>
            `;
            return;
        }

        videosContainer.innerHTML = this.videos.map(video => {
            const hasSubtitles = video.bookmarks.some(b => b.subtitle);
            return `
            <div class="video-card" data-video-id="${video.id}">
                <div class="video-card-header">
                    <h3 class="video-title">${this.escapeHtml(video.title)}</h3>
                    <div class="video-card-meta">
                        <span class="bookmark-count-badge">${video.bookmarks.length} bookmark${video.bookmarks.length !== 1 ? 's' : ''}</span>
                        ${hasSubtitles ? `
                            <button class="btn-small copy-subtitles-with-time" data-video-id="${video.id}" style="margin-right: 4px;" title="Copy all subtitles with timestamps">📋 Copy All (time)</button>
                            <button class="btn-small copy-subtitles-no-time" data-video-id="${video.id}" style="margin-right: 4px;" title="Copy all subtitles without timestamps">📋 Copy All</button>
                        ` : ''}
                        <button class="open-video-btn btn-small">Open Video</button>
                    </div>
                </div>
                <div class="video-bookmarks">
                    ${video.bookmarks.length > 0 ? video.bookmarks.map((bookmark, index) => {
                const isSegment = 'start' in bookmark && 'end' in bookmark;
                const time = isSegment ? bookmark.start : bookmark.time;
                const timeDisplay = isSegment
                    ? `${this.formatTime(bookmark.start)} - ${this.formatTime(bookmark.end)}`
                    : this.formatTime(bookmark.time);

                return `
                            <div class="bookmark-item" data-bookmark-index="${index}" data-video-id="${video.id}">
                                <div class="bookmark-time">${timeDisplay}</div>
                                ${bookmark.note ? `<div class="bookmark-note">${this.escapeHtml(bookmark.note)}</div>` : ''}
                                ${bookmark.subtitle && bookmark.subtitle !== 'null' ? `<div class="bookmark-subtitle">"${this.escapeHtml(bookmark.subtitle)}"</div>` : ''}
                                <div class="bookmark-actions">
                                    ${bookmark.subtitle ? `
                                        <button class="btn-small copy-bookmark-subtitle" data-video-id="${video.id}" data-bookmark-index="${index}" data-time="${time}" title="Copy subtitle">
                                            📋
                                        </button>
                                    ` : ''}
                                    <button class="btn-small seek-btn" data-time="${time}">
                                        Go to Time
                                    </button>
                                    <button class="btn-small delete delete-btn">
                                        Delete
                                    </button>
                                </div>
                            </div>
                        `;
            }).join('') : '<p class="no-bookmarks">No bookmarks for this video</p>'}
                </div>
            </div>
        `;
        }).join('');
    }

    async seekToTime(videoId, time) {
        try {
            const tabs = await chrome.tabs.query({});
            const youtubeTab = tabs.find(tab => {
                const url = tab.url || '';
                const currentVideoId = this.extractVideoIdFromUrl(url);
                return (url.includes('youtube.com') || url.includes('youtu.be')) && currentVideoId === videoId;
            });

            if (youtubeTab) {
                // Switch to existing tab and seek
                await chrome.tabs.update(youtubeTab.id, { active: true });
                await chrome.windows.update(youtubeTab.windowId, { focused: true });

                try {
                    await chrome.tabs.sendMessage(youtubeTab.id, {
                        action: 'seekToTime',
                        time: time
                    });
                } catch (messageError) {
                    await chrome.scripting.executeScript({
                        target: { tabId: youtubeTab.id },
                        func: (seekTime) => {
                            const video = document.querySelector('video');
                            if (video) {
                                video.currentTime = seekTime;
                                video.play();
                            }
                        },
                        args: [time]
                    });
                }
            } else {
                // Open new tab
                const video = this.videos.find(v => v.id === videoId);
                const videoUrl = `https://www.youtube.com/watch?v=${videoId}${time > 0 ? `&t=${Math.floor(time)}s` : ''}`;
                await chrome.tabs.create({ url: videoUrl });
            }
        } catch (error) {
            console.error('Error seeking to time:', error);
        }
    }

    openVideo(videoId) {
        const video = this.videos.find(v => v.id === videoId);
        if (video) {
            chrome.tabs.create({ url: video.url });
        }
    }

    extractVideoIdFromUrl(url) {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname.includes('youtu.be')) {
                return urlObj.pathname.slice(1);
            } else if (urlObj.hostname.includes('youtube.com')) {
                return urlObj.searchParams.get('v');
            }
        } catch (error) {
            return null;
        }
        return null;
    }

    async deleteBookmark(videoId, bookmarkIndex) {
        const videoIndex = this.videos.findIndex(v => v.id === videoId);
        if (videoIndex === -1) return;

        const video = this.videos[videoIndex];
        if (bookmarkIndex < 0 || bookmarkIndex >= video.bookmarks.length) return;

        video.bookmarks.splice(bookmarkIndex, 1);

        if (video.bookmarks.length === 0) {
            this.videos.splice(videoIndex, 1);
        }

        await this.saveBookmarks();
        this.renderDashboard();
    }

    async clearAllBookmarks() {
        if (confirm('Are you sure you want to delete all bookmarks?')) {
            this.videos = [];
            this.selectedVideoId = null;
            await this.saveBookmarks();
            this.renderDashboard();
        }
    }

    exportBookmarks() {
        if (this.videos.length === 0) {
            alert('No bookmarks to export');
            return;
        }

        const exportData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            totalVideos: this.videos.length,
            totalBookmarks: this.videos.reduce((sum, video) => sum + video.bookmarks.length, 0),
            videos: this.videos
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: 'application/json'
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `youtube-bookmarks-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    showImportOptions() {
        const options = [
            { label: 'Import from JSON file', action: () => this.importBookmarks() },
            { label: 'Import from YouTube timestamp links', action: () => this.importFromTimestampLinks() }
        ];

        const modal = document.createElement('div');
        modal.className = 'import-modal';
        modal.innerHTML = `
            <div class="import-modal-content">
                <h3>Choose Import Method</h3>
                <div class="import-options">
                    ${options.map((option, index) => `
                        <button class="import-option-btn" data-index="${index}">
                            ${option.label}
                        </button>
                    `).join('')}
                </div>
                <button class="import-modal-close">Cancel</button>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelectorAll('.import-option-btn').forEach((btn, index) => {
            btn.addEventListener('click', () => {
                options[index].action();
                modal.remove();
            });
        });

        modal.querySelector('.import-modal-close').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    importBookmarks() {
        document.getElementById('importFile').click();
    }

    importFromTimestampLinks() {
        const modal = document.createElement('div');
        modal.className = 'import-modal';
        modal.innerHTML = `
            <div class="import-modal-content">
                <h3>Import from YouTube Timestamp Links</h3>
                <p style="font-size: 12px; color: #666; margin-bottom: 16px;">
                    Paste YouTube URLs with timestamps (one per line).<br>
                    Example: https://www.youtube.com/watch?v=VIDEO_ID&t=120s
                </p>
                <textarea id="timestampLinks" placeholder="https://www.youtube.com/watch?v=VIDEO_ID&t=120s&#10;https://www.youtube.com/watch?v=VIDEO_ID&t=300s" rows="8" style="width: 100%; margin-bottom: 16px; font-family: monospace; font-size: 12px;"></textarea>
                <div class="import-modal-buttons">
                    <button id="processTimestampLinks" class="btn-primary">Import</button>
                    <button class="import-modal-close">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#processTimestampLinks').addEventListener('click', () => {
            const links = modal.querySelector('#timestampLinks').value;
            this.processTimestampLinks(links);
            modal.remove();
        });

        modal.querySelector('.import-modal-close').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    async processTimestampLinks(linksText) {
        const lines = linksText.trim().split('\n').filter(line => line.trim());

        if (lines.length === 0) {
            alert('No links provided');
            return;
        }

        const videoMap = new Map();
        let processedLinks = 0;

        for (const line of lines) {
            const result = this.parseYouTubeTimestampLink(line);
            if (result) {
                const { videoId, time, title } = result;

                if (!videoMap.has(videoId)) {
                    videoMap.set(videoId, {
                        id: videoId,
                        title: title || `Video ${videoId}`,
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                        bookmarks: []
                    });
                }

                const video = videoMap.get(videoId);
                if (!video.bookmarks.some(b => b.time === time)) {
                    video.bookmarks.push({
                        time: time,
                        timestamp: Date.now(),
                        note: `Imported from timestamp link`
                    });
                }

                processedLinks++;
            }
        }

        if (videoMap.size === 0) {
            alert('No valid YouTube timestamp links found');
            return;
        }

        const importedVideos = Array.from(videoMap.values());
        await this.mergeImportedBookmarks(importedVideos);

        await this.loadBookmarks();
        this.renderDashboard();
    }

    parseYouTubeTimestampLink(url) {
        try {
            const urlObj = new URL(url);

            if (!urlObj.hostname.includes('youtube.com') && !urlObj.hostname.includes('youtu.be')) {
                return null;
            }

            let videoId = '';

            if (urlObj.hostname.includes('youtu.be')) {
                videoId = urlObj.pathname.slice(1);
            } else {
                videoId = urlObj.searchParams.get('v');
            }

            if (!videoId) {
                return null;
            }

            let time = 0;
            const tParam = urlObj.searchParams.get('t');

            if (tParam) {
                if (tParam.includes('h') || tParam.includes('m') || tParam.includes('s')) {
                    time = this.parseTimestampString(tParam);
                } else {
                    time = parseInt(tParam) || 0;
                }
            }

            return {
                videoId: videoId,
                time: time,
                title: null
            };
        } catch (error) {
            console.error('Error parsing YouTube URL:', error);
            return null;
        }
    }

    parseTimestampString(timestamp) {
        let totalSeconds = 0;

        const hourMatch = timestamp.match(/(\d+)h/);
        const minuteMatch = timestamp.match(/(\d+)m/);
        const secondMatch = timestamp.match(/(\d+)s/);

        if (hourMatch) {
            totalSeconds += parseInt(hourMatch[1]) * 3600;
        }
        if (minuteMatch) {
            totalSeconds += parseInt(minuteMatch[1]) * 60;
        }
        if (secondMatch) {
            totalSeconds += parseInt(secondMatch[1]);
        }

        return totalSeconds;
    }

    async handleFileImport(file) {
        if (!file) return;

        try {
            const text = await this.readFileAsText(file);
            const importData = JSON.parse(text);

            if (!this.validateImportData(importData)) {
                alert('Invalid file format. Please use a valid bookmark export file.');
                return;
            }

            await this.mergeImportedBookmarks(importData.videos);

            await this.loadBookmarks();
            this.renderDashboard();

        } catch (error) {
            console.error('Import error:', error);
            alert('Error reading file. Please check the file format.');
        }

        document.getElementById('importFile').value = '';
    }

    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    }

    validateImportData(data) {
        return data &&
            typeof data === 'object' &&
            Array.isArray(data.videos) &&
            data.version &&
            data.exportDate;
    }

    async mergeImportedBookmarks(importedVideos) {
        if (!Array.isArray(importedVideos) || importedVideos.length === 0) {
            alert('No valid videos found in import file');
            return;
        }

        let addedVideos = 0;
        let addedBookmarks = 0;
        let updatedVideos = 0;

        for (const importedVideo of importedVideos) {
            if (!importedVideo.id || !importedVideo.title || !Array.isArray(importedVideo.bookmarks)) {
                continue;
            }

            const existingVideoIndex = this.videos.findIndex(v => v.id === importedVideo.id);

            if (existingVideoIndex === -1) {
                this.videos.push({
                    id: importedVideo.id,
                    title: importedVideo.title,
                    url: importedVideo.url || `https://www.youtube.com/watch?v=${importedVideo.id}`,
                    bookmarks: importedVideo.bookmarks.filter(b => b && typeof b.time === 'number')
                });
                addedVideos++;
                addedBookmarks += importedVideo.bookmarks.length;
            } else {
                const existingVideo = this.videos[existingVideoIndex];
                const existingTimes = new Set(existingVideo.bookmarks.map(b => b.time));

                const newBookmarks = importedVideo.bookmarks.filter(b =>
                    b && typeof b.time === 'number' && !existingTimes.has(b.time)
                );

                if (newBookmarks.length > 0) {
                    existingVideo.bookmarks.push(...newBookmarks);
                    existingVideo.bookmarks.sort((a, b) => a.time - b.time);
                    updatedVideos++;
                    addedBookmarks += newBookmarks.length;
                }
            }
        }

        await this.saveBookmarks();

        if (addedVideos === 0 && updatedVideos === 0) {
            alert('No new bookmarks found to import');
            return;
        }

        alert(`Import completed: ${addedVideos} new videos, ${updatedVideos} updated videos, ${addedBookmarks} new bookmarks`);
    }

    async saveBookmarks() {
        try {
            await chrome.storage.local.set({ youtubeBookmarks: this.videos });
        } catch (error) {
            console.error('Error saving bookmarks:', error);
        }
    }

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    renderSubscriptions() {
        const topicsContainer = document.getElementById('topicsContainer');

        if (this.topics.length === 0) {
            topicsContainer.innerHTML = `
                <div class="empty-state">
                    <h3>No topics yet</h3>
                    <p>Create a topic to organize your subscribed channels</p>
                </div>
            `;
            return;
        }

        topicsContainer.innerHTML = this.topics.map(topic => {
            const topicChannels = this.channels.filter(c => c.topicId === topic.id);
            const topicNewVideos = this.newVideos.filter(v => {
                const channel = this.channels.find(c => c.id === v.channelId);
                return channel && channel.topicId === topic.id;
            });

            return `
                <div class="topic-card" data-topic-id="${topic.id}">
                    <div class="topic-header">
                        <h3 class="topic-name">${this.escapeHtml(topic.name)}</h3>
                        <div class="topic-actions">
                            <button class="btn-small edit-topic-btn" data-topic-id="${topic.id}">Edit</button>
                            <button class="btn-small delete-topic-btn" data-topic-id="${topic.id}">Delete</button>
                        </div>
                    </div>
                    <div class="topic-channels">
                        <h4>Channels (${topicChannels.length})</h4>
                        ${topicChannels.length > 0 ? `
                            <div class="channels-list">
                                ${topicChannels.map(channel => `
                                    <div class="channel-item" data-channel-id="${channel.id}">
                                        <span class="channel-name">${this.escapeHtml(channel.name)}</span>
                                        <div class="channel-actions">
                                            <a href="${channel.url}" target="_blank" class="btn-small">Visit</a>
                                            <button class="btn-small delete-channel-btn" data-channel-id="${channel.id}">Remove</button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        ` : '<p class="no-channels">No channels in this topic</p>'}
                    </div>
                    ${topicNewVideos.length > 0 ? `
                        <div class="topic-new-videos">
                            <h4>New Videos (${topicNewVideos.length})</h4>
                            <div class="new-videos-list">
                                ${topicNewVideos.map(video => `
                                    <div class="new-video-item" data-video-id="${video.id}">
                                        <div class="new-video-info">
                                            <a href="${video.url}" target="_blank" class="new-video-title">${this.escapeHtml(video.title)}</a>
                                            <span class="new-video-channel">${this.escapeHtml(video.channelName)}</span>
                                            <span class="new-video-date">${new Date(video.publishedAt).toLocaleDateString()}</span>
                                        </div>
                                        <div class="new-video-actions">
                                            <button class="btn-small mark-watched-btn" data-video-id="${video.id}">Mark Watched</button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        // Add event listeners for subscription actions
        topicsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('edit-topic-btn')) {
                const topicId = e.target.dataset.topicId;
                this.editTopic(topicId);
            } else if (e.target.classList.contains('delete-topic-btn')) {
                const topicId = e.target.dataset.topicId;
                this.deleteTopic(topicId);
            } else if (e.target.classList.contains('delete-channel-btn')) {
                const channelId = e.target.dataset.channelId;
                this.deleteChannel(channelId);
            } else if (e.target.classList.contains('mark-watched-btn')) {
                const videoId = e.target.dataset.videoId;
                this.markVideoWatched(videoId);
            }
        });
    }

    showAddTopicModal() {
        const modal = document.createElement('div');
        modal.className = 'import-modal';
        modal.innerHTML = `
            <div class="import-modal-content">
                <h3>Add New Topic</h3>
                <input type="text" id="topicNameInput" placeholder="Topic name (e.g., Programming, Gaming, Music)" style="width: 100%; padding: 12px; margin-bottom: 16px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                <div class="import-modal-buttons">
                    <button id="saveTopicBtn" class="btn-primary">Save</button>
                    <button class="import-modal-close">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#saveTopicBtn').addEventListener('click', () => {
            const topicName = modal.querySelector('#topicNameInput').value.trim();
            if (topicName) {
                this.addTopic(topicName);
                modal.remove();
            }
        });

        modal.querySelector('.import-modal-close').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        modal.querySelector('#topicNameInput').focus();
    }

    showAddChannelModal() {
        if (this.topics.length === 0) {
            alert('Please create a topic first before adding channels');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'import-modal';
        modal.innerHTML = `
            <div class="import-modal-content">
                <h3>Add Channel</h3>
                <input type="text" id="channelNameInput" placeholder="Channel name" style="width: 100%; padding: 12px; margin-bottom: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                <input type="text" id="channelUrlInput" placeholder="Channel URL (e.g., https://www.youtube.com/@channelname)" style="width: 100%; padding: 12px; margin-bottom: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                <select id="topicSelect" style="width: 100%; padding: 12px; margin-bottom: 16px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                    ${this.topics.map(topic => `<option value="${topic.id}">${this.escapeHtml(topic.name)}</option>`).join('')}
                </select>
                <div class="import-modal-buttons">
                    <button id="saveChannelBtn" class="btn-primary">Save</button>
                    <button class="import-modal-close">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#saveChannelBtn').addEventListener('click', () => {
            const channelName = modal.querySelector('#channelNameInput').value.trim();
            const channelUrl = modal.querySelector('#channelUrlInput').value.trim();
            const topicId = modal.querySelector('#topicSelect').value;

            if (channelName && channelUrl) {
                this.addChannel(channelName, channelUrl, topicId);
                modal.remove();
            }
        });

        modal.querySelector('.import-modal-close').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    addTopic(name) {
        const topic = {
            id: Date.now().toString(),
            name: name,
            createdAt: Date.now()
        };
        this.topics.push(topic);
        this.saveSubscriptions();
        this.renderSubscriptions();
    }

    editTopic(topicId) {
        const topic = this.topics.find(t => t.id === topicId);
        if (!topic) return;

        const modal = document.createElement('div');
        modal.className = 'import-modal';
        modal.innerHTML = `
            <div class="import-modal-content">
                <h3>Edit Topic</h3>
                <input type="text" id="topicNameInput" value="${this.escapeHtml(topic.name)}" style="width: 100%; padding: 12px; margin-bottom: 16px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                <div class="import-modal-buttons">
                    <button id="saveTopicBtn" class="btn-primary">Save</button>
                    <button class="import-modal-close">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#saveTopicBtn').addEventListener('click', () => {
            const topicName = modal.querySelector('#topicNameInput').value.trim();
            if (topicName) {
                topic.name = topicName;
                this.saveSubscriptions();
                this.renderSubscriptions();
                modal.remove();
            }
        });

        modal.querySelector('.import-modal-close').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    deleteTopic(topicId) {
        if (confirm('Are you sure you want to delete this topic? Channels in this topic will be moved to "Uncategorized".')) {
            const topicIndex = this.topics.findIndex(t => t.id === topicId);
            if (topicIndex === -1) return;

            // Move channels to uncategorized or remove topic reference
            this.channels.forEach(channel => {
                if (channel.topicId === topicId) {
                    channel.topicId = null;
                }
            });

            this.topics.splice(topicIndex, 1);
            this.saveSubscriptions();
            this.renderSubscriptions();
        }
    }

    addChannel(name, url, topicId) {
        const channelId = this.extractChannelIdFromUrl(url) || Date.now().toString();
        const channel = {
            id: channelId,
            name: name,
            url: url,
            topicId: topicId,
            addedAt: Date.now()
        };

        // Check if channel already exists
        const existingIndex = this.channels.findIndex(c => c.id === channelId);
        if (existingIndex !== -1) {
            this.channels[existingIndex] = channel;
        } else {
            this.channels.push(channel);
        }

        this.saveSubscriptions();
        this.renderSubscriptions();
    }

    deleteChannel(channelId) {
        if (confirm('Are you sure you want to remove this channel?')) {
            const channelIndex = this.channels.findIndex(c => c.id === channelId);
            if (channelIndex !== -1) {
                this.channels.splice(channelIndex, 1);
                // Also remove new videos from this channel
                this.newVideos = this.newVideos.filter(v => v.channelId !== channelId);
                this.saveSubscriptions();
                this.renderSubscriptions();
            }
        }
    }

    extractChannelIdFromUrl(url) {
        try {
            const urlObj = new URL(url);
            // Handle different YouTube URL formats
            if (urlObj.pathname.startsWith('/@')) {
                return urlObj.pathname.slice(1); // @channelname
            } else if (urlObj.pathname.startsWith('/channel/')) {
                return urlObj.pathname;
            } else if (urlObj.pathname.startsWith('/c/')) {
                return urlObj.pathname;
            } else if (urlObj.pathname.startsWith('/user/')) {
                return urlObj.pathname;
            }
            return urlObj.pathname || url;
        } catch (error) {
            return null;
        }
    }

    async refreshNewVideos() {
        // This would ideally fetch from YouTube API or notifications
        // For now, we'll show a message and allow manual addition
        alert('To refresh new videos, visit YouTube and check your subscriptions. You can manually mark videos as new from the YouTube page.');

        // In a real implementation, this would:
        // 1. Check YouTube notifications API
        // 2. Or scrape YouTube subscription feed
        // 3. Compare with existing newVideos
        // 4. Add new ones
    }

    markVideoWatched(videoId) {
        this.newVideos = this.newVideos.filter(v => v.id !== videoId);
        this.saveSubscriptions();
        this.renderSubscriptions();
    }

    // Method to add new video (can be called from content script when user visits YouTube)
    addNewVideo(videoData) {
        const channel = this.channels.find(c => {
            // Try to match channel from video data
            return videoData.channelUrl && c.url.includes(videoData.channelUrl);
        });

        if (channel) {
            const newVideo = {
                id: videoData.id || Date.now().toString(),
                title: videoData.title,
                url: videoData.url,
                channelId: channel.id,
                channelName: channel.name,
                publishedAt: videoData.publishedAt || Date.now(),
                addedAt: Date.now()
            };

            // Check if video already exists
            const exists = this.newVideos.some(v => v.id === newVideo.id);
            if (!exists) {
                this.newVideos.push(newVideo);
                this.saveSubscriptions();
            }
        }
    }

    copySubtitles(video, includeTimestamp) {
        const bookmarksWithSubtitles = video.bookmarks.filter(bookmark => bookmark.subtitle);

        if (bookmarksWithSubtitles.length === 0) {
            alert('No subtitles found in bookmarks');
            return;
        }

        let text = '';
        bookmarksWithSubtitles.forEach(bookmark => {
            if (includeTimestamp) {
                const timeDisplay = this.formatTime(bookmark.time);
                text += `[${timeDisplay}] ${bookmark.subtitle}\n`;
            } else {
                text += `${bookmark.subtitle}\n`;
            }
        });

        // Copy to clipboard
        navigator.clipboard.writeText(text.trim()).then(() => {
            this.showCopyNotification(includeTimestamp);
        }).catch(err => {
            console.error('Failed to copy:', err);
            // Fallback: create textarea and copy
            const textarea = document.createElement('textarea');
            textarea.value = text.trim();
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showCopyNotification(includeTimestamp);
        });
    }

    copyBookmarkSubtitle(bookmark, timeStr) {
        if (!bookmark.subtitle) {
            alert('No subtitle found for this bookmark');
            return;
        }

        // Show a prompt to ask if user wants timestamp
        const includeTimestamp = confirm('Copy subtitle with timestamp?');

        let text = '';
        if (includeTimestamp) {
            const timeDisplay = this.formatTime(parseFloat(timeStr));
            text = `[${timeDisplay}] ${bookmark.subtitle}`;
        } else {
            text = bookmark.subtitle;
        }

        // Copy to clipboard
        navigator.clipboard.writeText(text).then(() => {
            this.showCopyNotification(includeTimestamp, 'Subtitle copied!');
        }).catch(err => {
            console.error('Failed to copy:', err);
            // Fallback: create textarea and copy
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showCopyNotification(includeTimestamp, 'Subtitle copied!');
        });
    }

    showCopyNotification(includeTimestamp, customMessage = null) {
        const notification = document.createElement('div');
        notification.textContent = customMessage || `Subtitles copied ${includeTimestamp ? 'with timestamps' : 'without timestamps'}!`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4caf50;
            color: white;
            padding: 12px 16px;
            border-radius: 6px;
            z-index: 10000;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        `;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.remove();
        }, 2000);
    }

    setupTheme() {
        const themeToggle = document.getElementById('themeToggle');
        if (!themeToggle) return;

        // Load saved theme preference
        this.loadTheme();

        // Toggle theme on button click
        themeToggle.addEventListener('click', () => {
            this.toggleTheme();
        });
    }

    loadTheme() {
        chrome.storage.local.get(['theme'], (result) => {
            const isDark = result.theme === 'dark';
            if (isDark) {
                document.body.classList.add('dark-theme');
                document.querySelector('header').classList.add('dark-theme');
                const themeToggle = document.getElementById('themeToggle');
                if (themeToggle) {
                    themeToggle.textContent = '☀️';
                }
            } else {
                document.body.classList.remove('dark-theme');
                document.querySelector('header').classList.remove('dark-theme');
                const themeToggle = document.getElementById('themeToggle');
                if (themeToggle) {
                    themeToggle.textContent = '🌙';
                }
            }
        });
    }

    toggleTheme() {
        const isDark = document.body.classList.toggle('dark-theme');
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.textContent = isDark ? '☀️' : '🌙';
        }
        chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
    }
}

const dashboard = new Dashboard();