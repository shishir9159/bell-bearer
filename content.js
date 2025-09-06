class YouTubeBookmarker {
    constructor() {
        this.isRecording = false; // recording checkpoints is still running
        this.videoID = null;
        this.videoTitle = null;
        this.bookmarks = [];
        this.segmentStart = null;
        this.init();
    }

    init() {
        this.setupKeyboardListeners();
        this.setupMessageListener();
        this.detectVideoChange();
        setInterval(() => {
            this.detectVideoChange();
        }, 2000);
    }

    setupKeyboardListeners() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'b' && !this.isRecording) {
                // overriding default browser behavior for keypress
                e.preventDefault();
                this.startRecording();
            }
            // segment start
            if (e.key === 'S' && e.ctrlKey && e.shiftKey && this.segmentStart === null) {
                e.preventDefault();
                this.handleSegmentStart();
            }
            
            // Alt + 1-9: skip forward by number of seconds
            if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
                e.preventDefault();
                const seconds = parseInt(e.key);
                this.skipForward(seconds);
            }
            
            // Shift + 1-9: skip backward by number of seconds
            if (e.shiftKey && !e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '9') {
                e.preventDefault();
                const seconds = parseInt(e.key);
                this.skipBackward(seconds);
            }
            
            // > key: increase playback speed (Shift + .)
            if ((e.key === '>' || (e.key === '.' && e.shiftKey)) && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                this.increasePlaybackSpeed();
            }
            
            // < key: decrease playback speed (Shift + ,)
            if ((e.key === '<' || (e.key === ',' && e.shiftKey)) && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                this.decreasePlaybackSpeed();
            }
        });

        document.addEventListener('keyup', (e) => {
            // todo: e.ctrlKey should not 
            // stop recording after Ctrl + B is released
            if (e.key === 'b' && this.isRecording) {
                this.stopRecording();
            }
            // segment ends
            if (e.key === 'S' && e.ctrlKey && e.shiftKey && this.segmentStart !== null) {
                e.preventDefault();
                this.handleSegmentEnd();
            }
        });
    }

    setupMessageListener() {
        // popup or background script messages
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            // TODO: FIRST PRIORITY
            if (message.action === 'seekToTime') {
                this.seekToTime(message.time);
            }
        });
    }

    detectVideoChange() {
        const videoId = this.getCurrentVideoId();
        const videoTitle = this.getCurrentVideoTitle();

        if (videoId && videoId !== this.videoID) {
            this.videoID = videoId;
            this.videoTitle = videoTitle;
            this.bookmarks = [];
        }
    }

    getCurrentVideoId() {
        const url = window.location.href;
        const match = url.match(/[?&]v=([^&]+)/);
        return match ? match[1] : null;
    }

    getCurrentVideoTitle() {
        const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer') || // YouTube title
                             document.querySelector('h1.title') || // alternative title selector
                             document.querySelector('title'); // fallback strategy to page title
        return titleElement ? titleElement.textContent.trim() : 'Unknown Title';
    }

    getCurrentTime() {
        const video = document.querySelector('video') // todo: website specific?
        return video ? video.currentTime : 0;
    }

    startRecording() {
        if (!this.videoID) {
            this.showNotification('No video detected', 'error')
            return;
        }

        this.isRecording = true;
        this.showNotification('Hold Ctrl+B to create a checkpoint...', 'info');
        this.addRecordingIndicator();
    }

    stopRecording() {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.removeRecordingIndicator();
        
        const currentTime = this.getCurrentTime();
        if (currentTime > 0) {
            const bookmark = {
                time: Math.floor(currentTime),
                timestamp: Date.now(),
                note: `Checkpoint at ${this.formatTime(currentTime)}`
            };
            
            this.bookmarks = [bookmark];
            this.saveBookmarks();
            this.showNotification(`Checkpoint created at ${this.formatTime(currentTime)}!`, 'success');
        } else {
            this.showNotification('No checkpoint created - video not playing', 'warning');
        }
    }

    async saveBookmarks() {
        try {

            const result = await chrome.storage.local.get(['youtubeBookmarks']);
            let videos = result.youtubeBookmarks || [];
            
            let videoIndex = videos.findIndex(v => v.id === this.videoID);
            
            // add to a map rather than array
            if (videoIndex === -1) {
                videos.push({
                    id: this.videoID,
                    title: this.videoTitle,
                    url: window.location.href,
                    bookmarks: []
                });
                videoIndex = videos.length - 1;
            }
            
            videos[videoIndex].bookmarks.push(...this.bookmarks);
            videos[videoIndex].bookmarks.sort((a, b) => a.time - b.time);
            
            // todo: look for overlap
            videos[videoIndex].bookmarks = videos[videoIndex].bookmarks.filter(
                (bookmark, index, self) => 
                    index === 0 || bookmark.time !== self[index - 1].time
            );
            
            await chrome.storage.local.set({ youtubeBookmarks: videos });
        } catch (error) {
            console.error('Error saving bookmarks:', error);
            this.showNotification('Error saving bookmarks', 'error');
        }
    }

    seekToTime(time) {
        // BUGFIX
        const video = document.querySelector('video');
        if (video) {
            video.currentTime = time; 
            video.play();
        }
    }

    skipForward(seconds) {
        const video = document.querySelector('video');
        if (video) {
            const newTime = Math.min(video.currentTime + seconds, video.duration);
            video.currentTime = newTime;
            this.showNotification(`Skipped forward ${seconds}s`, 'info');
        }
    }

    skipBackward(seconds) {
        const video = document.querySelector('video');
        if (video) {
            const newTime = Math.max(video.currentTime - seconds, 0);
            video.currentTime = newTime;
            this.showNotification(`Skipped backward ${seconds}s`, 'info');
        }
    }

    increasePlaybackSpeed() {
        const video = document.querySelector('video');
        if (video) {
            const currentSpeed = video.playbackRate;
            const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
            const currentIndex = speeds.findIndex(s => s >= currentSpeed) || speeds.length - 1;
            const nextIndex = Math.min(currentIndex + 1, speeds.length - 1);
            video.playbackRate = speeds[nextIndex];
            this.showNotification(`Playback speed: ${speeds[nextIndex]}x`, 'info');
        }
    }

    decreasePlaybackSpeed() {
        const video = document.querySelector('video');
        if (video) {
            const currentSpeed = video.playbackRate;
            const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
            const currentIndex = speeds.findIndex(s => s >= currentSpeed) || 0;
            const prevIndex = Math.max(currentIndex - 1, 0);
            video.playbackRate = speeds[prevIndex];
            this.showNotification(`Playback speed: ${speeds[prevIndex]}x`, 'info');
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

    showNotification(message, type = 'info') {

        const existing = document.getElementById('yt-bookmarker-notification');
        if (existing) {
            existing.remove();
        }

        const notification = document.createElement('div');
        notification.id = 'yt-bookmarker-notification';
        notification.textContent = message;
        notification.className = `yt-bookmarker-notification yt-bookmarker-${type}`; // css class variables
        
        document.body.appendChild(notification);
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 3000);
    }

    addRecordingIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'yt-bookmarker-recording-indicator';
        indicator.innerHTML = `
            <div class="recording-dot"></div> <!-- Animated dot -->
            <span>Recording checkpoints...</span> <!-- Text message -->
        `;
        document.body.appendChild(indicator);
    }

    removeRecordingIndicator() {
        const indicator = document.getElementById('yt-bookmarker-recording-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    // merge recording strategy
    handleSegmentStart() {
        if (!this.videoID) { // Check if we're on a video page
            this.showNotification('No video detected', 'error');
            return;
        }
        const currentTime = Math.floor(this.getCurrentTime());
        this.segmentStart = currentTime;
        this.showNotification(`Segment start set at ${this.formatTime(currentTime)}`, 'info');
    }

    // merge recording strategy
    handleSegmentEnd() {
        // Handle the end of a segment bookmark
        const segmentEnd = Math.floor(this.getCurrentTime());
        if (segmentEnd <= this.segmentStart) {
            this.showNotification('End time must be after start time', 'error');
            this.segmentStart = null;
            return;
        }

        this.bookmarks.push({
            start: this.segmentStart,
            end: segmentEnd,
            timestamp: Date.now(),
            note: `Segment: ${this.formatTime(this.segmentStart)} - ${this.formatTime(segmentEnd)}`
        });
        this.saveBookmarks();
        this.showNotification(`Segment saved: ${this.formatTime(this.segmentStart)} - ${this.formatTime(segmentEnd)}`, 'success');
        this.segmentStart = null;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new YouTubeBookmarker();
    });
} else {
    new YouTubeBookmarker();
} 