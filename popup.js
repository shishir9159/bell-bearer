class BookmarkManager {
    constructor() {
        this.videos = [];
        this.selectedVideoId = null;
        this.init();
    }

    async init() {
        await this.loadBookmarks();
        this.setupEventListeners();
        this.setupTheme();
        this.renderVideoList();
        this.renderBookmarkDetails();
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

    setupEventListeners() {
        document.getElementById('dashboardBtn').addEventListener('click', () => {
            this.openDashboard();
        });
        
        document.getElementById('clearAll').addEventListener('click', () => {
            this.clearAllBookmarks();
        });
        
        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportBookmarks();
        });
        
        document.getElementById('importBtn').addEventListener('click', () => {
            this.showImportOptions();
        });
        
        document.getElementById('importFile').addEventListener('change', (e) => {
            this.handleFileImport(e.target.files[0]);
        });

        // event delegation for bookmark actions
        const bookmarkDetails = document.getElementById('bookmarkDetails');
        bookmarkDetails.addEventListener('click', (e) => {
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
            }
        });
    }

    renderVideoList() {
        const videoList = document.getElementById('videoList');
        
        if (this.videos.length === 0) {
            videoList.innerHTML = `
                <div class="empty-state">
                    <h3>No bookmarked videos</h3>
                    <p>Start watching YouTube videos and use Ctrl+B to create bookmarks</p>
                </div>
            `;
            return;
        }

        videoList.innerHTML = this.videos.map(video => `
            <div class="video-item ${video.id === this.selectedVideoId ? 'selected' : ''}" 
                 data-video-id="${video.id}">
                <div class="video-title">${this.escapeHtml(video.title)}</div>
                <div class="video-meta">
                    ${video.bookmarks.length} bookmark${video.bookmarks.length !== 1 ? 's' : ''}
                    <span class="bookmark-count">${video.bookmarks.length}</span>
                </div>
            </div>
        `).join('');

        videoList.querySelectorAll('.video-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectVideo(item.dataset.videoId);
            });
        });
    }

    renderBookmarkDetails() {
        const bookmarkDetails = document.getElementById('bookmarkDetails');
        
        if (!this.selectedVideoId) {
            bookmarkDetails.innerHTML = `
                <div class="no-selection">
                    <p>Select a video to view bookmarks</p>
                </div>
            `;
            return;
        }

        const video = this.videos.find(v => v.id === this.selectedVideoId);
        if (!video) return;

        bookmarkDetails.innerHTML = `
            <h3>${this.escapeHtml(video.title)}</h3>
            <p style="color: #666; margin-bottom: 16px; font-size: 12px;">
                ${video.bookmarks.length} bookmark${video.bookmarks.length !== 1 ? 's' : ''}
            </p>
            ${video.bookmarks.map((bookmark, index) => {
                const isSegment = 'start' in bookmark && 'end' in bookmark;
                const time = isSegment ? bookmark.start : bookmark.time;
                const timeDisplay = isSegment 
                    ? `${this.formatTime(bookmark.start)} - ${this.formatTime(bookmark.end)}`
                    : this.formatTime(bookmark.time);
                
                return `
                <div class="bookmark-item" data-bookmark-index="${index}" data-video-id="${video.id}">
                    <div class="bookmark-time">${timeDisplay}</div>
                    ${bookmark.note ? `<div class="bookmark-note">${this.escapeHtml(bookmark.note)}</div>` : ''}
                    <div class="bookmark-actions">
                        <button class="btn-small seek-btn" data-time="${time}">
                            Go to Time
                        </button>
                        <button class="btn-small delete delete-btn" data-bookmark-index="${index}">
                            Delete
                        </button>
                    </div>
                </div>
            `;
            }).join('')}
        `;
    }

    selectVideo(videoId) {
        this.selectedVideoId = videoId;
        this.renderVideoList();
        this.renderBookmarkDetails();
    }

    async seekToTime(videoId, time) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                console.error('No active tab found');
                return;
            }

            // Check if current tab is YouTube and if video ID matches
            const currentVideoId = this.extractVideoIdFromUrl(tab.url);
            const isYouTube = tab.url && (tab.url.includes('youtube.com') || tab.url.includes('youtu.be'));
            
            if (!isYouTube || currentVideoId !== videoId) {
                // Show popup asking if user wants to open the video
                const shouldOpen = await this.showOpenVideoPrompt(videoId, time);
                if (shouldOpen) {
                    const videoUrl = `https://www.youtube.com/watch?v=${videoId}${time > 0 ? `&t=${Math.floor(time)}s` : ''}`;
                    await chrome.tabs.create({
                        url: videoUrl,
                        index: tab.index + 1 //open in next tab
                    });
                }
                return;
            }

            try {
                await chrome.tabs.sendMessage(tab.id, {
                    action: 'seekToTime',
                    time: time
                });
            } catch (messageError) {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
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
        } catch (error) {
            console.error('Error seeking to time:', error);
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

    showOpenVideoPrompt(videoId, time) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'import-modal';
            modal.style.zIndex = '10000';
            modal.innerHTML = `
                <div class="import-modal-content">
                    <h3>Open Video in New Tab?</h3>
                    <p style="font-size: 14px; color: #666; margin-bottom: 16px;">
                        The current page is not the video for this bookmark. Would you like to open it in a new tab?
                    </p>
                    <div class="import-modal-buttons">
                        <button id="openVideoConfirm" class="btn-primary">Open Video</button>
                        <button id="openVideoCancel" class="import-modal-close">Cancel</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            modal.querySelector('#openVideoConfirm').addEventListener('click', () => {
                modal.remove();
                resolve(true);
            });

            modal.querySelector('#openVideoCancel').addEventListener('click', () => {
                modal.remove();
                resolve(false);
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve(false);
                }
            });
        });
    }

    async deleteBookmark(videoId, bookmarkIndex) {
        const videoIndex = this.videos.findIndex(v => v.id === videoId);
        if (videoIndex === -1) return;

        const video = this.videos[videoIndex];
        if (bookmarkIndex < 0 || bookmarkIndex >= video.bookmarks.length) return;

        video.bookmarks.splice(bookmarkIndex, 1);

        if (video.bookmarks.length === 0) {
            this.videos.splice(videoIndex, 1);
            this.selectedVideoId = null;
        }

        await this.saveBookmarks();
        this.renderVideoList();
        this.renderBookmarkDetails();
    }

    async clearAllBookmarks() {
        if (confirm('Are you sure you want to delete all bookmarks?')) {
            this.videos = [];
            this.selectedVideoId = null;
            await this.saveBookmarks();
            this.renderVideoList();
            this.renderBookmarkDetails();
        }
    }

    exportBookmarks() {
        if (this.videos.length === 0) {
            this.showImportExportMessage('No bookmarks to export', 'warning');
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

        this.showImportExportMessage(`Exported ${this.videos.length} videos with ${exportData.totalBookmarks} bookmarks`, 'info');
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
            this.showImportExportMessage('No links provided', 'warning');
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
            this.showImportExportMessage('No valid YouTube timestamp links found', 'error');
            return;
        }

        const importedVideos = Array.from(videoMap.values());
        const result = await this.mergeImportedBookmarks(importedVideos);
        this.showImportExportMessage(result.message, result.type);
        
        await this.loadBookmarks();
        this.renderVideoList();
        this.renderBookmarkDetails();
    }

    parseYouTubeTimestampLink(url) {
        try {
            const urlObj = new URL(url);
            
            // Check if it's a YouTube URL
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
                this.showImportExportMessage('Invalid file format. Please use a valid bookmark export file.', 'error');
                return;
            }

            const result = await this.mergeImportedBookmarks(importData.videos);
            this.showImportExportMessage(result.message, result.type);
            
            await this.loadBookmarks();
            this.renderVideoList();
            this.renderBookmarkDetails();
            
        } catch (error) {
            console.error('Import error:', error);
            this.showImportExportMessage('Error reading file. Please check the file format.', 'error');
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
            return { message: 'No valid videos found in import file', type: 'error' };
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
            return { message: 'No new bookmarks found to import', type: 'warning' };
        }

        const message = `Import completed: ${addedVideos} new videos, ${updatedVideos} updated videos, ${addedBookmarks} new bookmarks`;
        return { message, type: 'info' };
    }

    showImportExportMessage(message, type = 'info') {

        const existingMessages = document.querySelectorAll('.import-export-info, .import-export-error, .import-export-warning');
        existingMessages.forEach(msg => msg.remove());

        const messageDiv = document.createElement('div');
        messageDiv.className = `import-export-${type}`;
        messageDiv.textContent = message;

        const bookmarkDetails = document.getElementById('bookmarkDetails');
        bookmarkDetails.insertBefore(messageDiv, bookmarkDetails.firstChild);

        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.remove();
            }
        }, 5000);
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

    showCopyNotification(includeTimestamp) {
        const notification = document.createElement('div');
        notification.textContent = `Subtitles copied ${includeTimestamp ? 'with timestamps' : 'without timestamps'}!`;
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

    openDashboard() {
        chrome.tabs.create({
            url: chrome.runtime.getURL('dashboard.html')
        });
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
                const themeToggle = document.getElementById('themeToggle');
                if (themeToggle) {
                    themeToggle.textContent = '☀️';
                }
            } else {
                document.body.classList.remove('dark-theme');
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

const bookmarkManager = new BookmarkManager(); 