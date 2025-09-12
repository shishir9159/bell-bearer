class YouTubeBookmarker {
    constructor() {
        this.isRecording = false; // recording checkpoints is still running
        this.videoID = null;
        this.videoTitle = null;
        this.bookmarks = [];
        this.segmentStart = null;
        this.checkpointStartTime = null; // Start time when Ctrl+B is pressed
        this.speedSyncSetup = false;
        this.transcriptApi = typeof YouTubeTranscriptApi !== 'undefined' ? new YouTubeTranscriptApi() : null;
        this.currentTranscript = null;
        this.enableSkipShortcuts = true;
        this.speedBoostTimeout = null; // Timeout for temporary speed boost
        this.originalSpeed = null; // Store original speed before boost
        this.init();
    }

    init() {
        this.loadSettings();
        this.setupKeyboardListeners();
        this.setupMessageListener();
        this.detectVideoChange();
        this.setupPlaybackSpeedSync();
        this.setupSubscribeButton();
        setInterval(() => {
            this.detectVideoChange();
        }, 2000);
    }

    loadSettings() {
        chrome.storage.local.get(['enableSkipShortcuts'], (result) => {
            this.enableSkipShortcuts = result.enableSkipShortcuts !== false;
        });

        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && changes.enableSkipShortcuts) {
                this.enableSkipShortcuts = changes.enableSkipShortcuts.newValue;
            }
        });
    }

    setupKeyboardListeners() {
        // Use capture phase to ensure we catch events before YouTube
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'b' && !this.isRecording) {
                // overriding default browser behavior for keypress
                e.preventDefault();
                this.startRecording();
            }

            // // segment start
            // // Allow Numpad keys for numbers if applicable (though S is a letter)
            // if (e.key === 'S' && e.ctrlKey && e.shiftKey && this.segmentStart === null) {
            //     e.preventDefault();
            //     this.handleSegmentStart();
            // }

            // Ctrl + Alt + 1-9: skip forward by number of seconds
            // Support both Digit (top row) and Numpad keys
            if (this.enableSkipShortcuts && !e.ctrlKey && e.altKey) {
                const numMatch = e.code.match(/^(?:Digit|Numpad)(\d)$/);
                if (numMatch) {
                    const num = parseInt(numMatch[1]);
                    if (num >= 1 && num <= 9) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.skipForward(num);
                    }
                }
            }

            // Ctrl + Shift + 1-9: skip backward by number of seconds
            if (this.enableSkipShortcuts && !e.ctrlKey && e.shiftKey && !e.altKey) {
                const numMatch = e.code.match(/^(?:Digit|Numpad)(\d)$/);
                if (numMatch) {
                    const num = parseInt(numMatch[1]);
                    if (num >= 1 && num <= 9) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.skipBackward(num);
                    }
                }
            }

            // Ctrl + Shift + 1-9: temporary speed boost to 3x for number of seconds
            if (e.ctrlKey && e.shiftKey && !e.altKey) {
                const numMatch = e.code.match(/^(?:Digit|Numpad)(\d)$/);
                if (numMatch) {
                    const num = parseInt(numMatch[1]);
                    if (num >= 1 && num <= 9) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.temporarySpeedBoost(num);
                    }
                }
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
        }, true); // Use capture

        document.addEventListener('keyup', (e) => {
            // stop recording after Ctrl + B is released
            if (e.key === 'b' && this.isRecording) {
                this.stopRecording();
            }
            // segment ends
            if (e.key === 'S' && e.ctrlKey && e.shiftKey && this.segmentStart !== null) {
                e.preventDefault();
                this.handleSegmentEnd();
            }
        }, true); // Use capture
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
            this.speedSyncSetup = false; // Reset speed sync for new video
            this.fetchTranscript(videoId);
        }
    }

    getCurrentVideoId() {
        const url = window.location.href;
        const match = url.match(/[?&]v=([^&]+)/);
        return match ? match[1] : null;
    }

    async fetchTranscript(videoId) {
        if (!this.transcriptApi) return;

        try {
            // Always fetch English (auto-generated preferred)
            this.currentTranscript = await this.transcriptApi.fetch(videoId, { languages: ['en'] });
            console.log('Transcript fetched:', this.currentTranscript.language, this.currentTranscript.snippets.length, 'snippets');
        } catch (error) {
            console.warn('Failed to fetch transcript:', error.message);
            this.currentTranscript = null;
        }
    }

    getCurrentVideoTitle() {
        const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer') || // YouTube title
            document.querySelector('h1.title') || // alternative title selector
            document.querySelector('title'); // fallback strategy to page title
        return titleElement ? titleElement.textContent.trim() : 'Unknown Title';
    }

    getVideoElement() {
        return document.querySelector('video.html5-main-video') || document.querySelector('video');
    }

    getCurrentTime() {
        const video = this.getVideoElement();
        return video ? video.currentTime : 0;
    }

    startRecording() {
        if (!this.videoID) {
            this.showNotification('No video detected', 'error')
            return;
        }

        this.isRecording = true;
        this.checkpointStartTime = this.getCurrentTime(); // Capture start time
        this.showNotification('Hold Ctrl+B to create a checkpoint...', 'info');
        this.addRecordingIndicator();
    }

    async stopRecording() {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.removeRecordingIndicator();

        const startTime = this.checkpointStartTime;
        const endTime = this.getCurrentTime();
        this.checkpointStartTime = null; // Reset

        if (startTime <= 0 || endTime <= 0) {
            this.showNotification('No checkpoint created - video not playing', 'warning');
            return;
        }

        // Ensure transcript is loaded
        if (!this.currentTranscript) {
            await this.fetchTranscript(this.videoID);
        }

        // Get subtitles from start to end time range
        const subtitle = this.getSubtitlesInRange(startTime, endTime);

        const bookmark = {
            time: Math.floor(startTime), // For popup display - shows start time
            start: Math.floor(startTime), // Start time for dashboard range display
            end: Math.floor(endTime), // End time for dashboard range display
            timestamp: Date.now(),
            note: `Checkpoint ${this.formatTime(startTime)} - ${this.formatTime(endTime)}`,
            subtitle: subtitle
        };

        this.bookmarks = [bookmark];
        this.saveBookmarks();

        const subtitlePreview = subtitle ? ` - "${subtitle.substring(0, 40)}${subtitle.length > 40 ? '...' : ''}"` : '';
        this.showNotification(`Checkpoint created at ${this.formatTime(startTime)}!${subtitlePreview}`, 'success');
    }

    /**
     * Get subtitle text at the specified time from the prefetched transcript
     */
    getSubtitleAtTime(time) {
        if (!this.currentTranscript) {
            console.log('No transcript available');
            return null;
        }

        // Try exact match first
        const snippet = this.currentTranscript.getSnippetAtTime(time);
        if (snippet) {
            console.log('Subtitle found:', snippet.text);
            return snippet.text;
        }

        // Fallback: get snippet at or before time (for gaps between subtitles)
        const nearSnippet = this.currentTranscript.getSnippetAtOrBefore(time);
        if (nearSnippet) {
            const endTime = nearSnippet.start + nearSnippet.duration;
            if (time <= endTime + 1) { // Within 1 second buffer
                console.log('Nearby subtitle found:', nearSnippet.text);
                return nearSnippet.text;
            }
        }

        console.log('No subtitle at time:', time);
        return null;
    }

    /**
     * Get all subtitle text within a time range from the prefetched transcript
     * @param {number} startTime - Start time in seconds
     * @param {number} endTime - End time in seconds
     * @returns {string|null} Combined subtitle text or null if no transcript
     */
    getSubtitlesInRange(startTime, endTime) {
        if (!this.currentTranscript) {
            console.log('No transcript available');
            return null;
        }

        // Use the transcript's getSnippetsInRange method
        const snippets = this.currentTranscript.getSnippetsInRange(startTime, endTime);

        if (snippets && snippets.length > 0) {
            // Join all snippet texts with space
            const combinedText = snippets.map(s => s.text).join(' ');
            console.log(`Found ${snippets.length} subtitles in range ${startTime}-${endTime}:`, combinedText);
            return combinedText;
        }

        // Fallback: try to get at least one subtitle near the range
        const nearSnippet = this.currentTranscript.getSnippetAtOrBefore(startTime);
        if (nearSnippet) {
            console.log('Nearby subtitle found for range:', nearSnippet.text);
            return nearSnippet.text;
        }

        console.log('No subtitles in range:', startTime, '-', endTime);
        return null;
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
        const video = this.getVideoElement();
        if (video) {
            video.currentTime = time;
            video.play();
        }
    }

    skipForward(seconds) {
        const video = this.getVideoElement();
        if (video) {
            const newTime = Math.min(video.currentTime + seconds, video.duration);
            video.currentTime = newTime;
            this.showNotification(`Skipped forward ${seconds}s`, 'info');
        }
    }

    skipBackward(seconds) {
        const video = this.getVideoElement();
        if (video) {
            const newTime = Math.max(video.currentTime - seconds, 0);
            video.currentTime = newTime;
            this.showNotification(`Skipped backward ${seconds}s`, 'info');
        }
    }

    temporarySpeedBoost(seconds) {
        const video = this.getVideoElement();
        if (!video) return;

        // Clear any existing speed boost timeout
        if (this.speedBoostTimeout) {
            clearTimeout(this.speedBoostTimeout);
            this.speedBoostTimeout = null;
        }

        // Store the current speed if not already boosting
        if (this.originalSpeed === null) {
            this.originalSpeed = video.playbackRate;
        }

        // Set speed to 3x
        video.playbackRate = 3;
        this.showNotification(`Speed boost: 3x for ${seconds}s`, 'info');

        // Set timeout to restore original speed
        this.speedBoostTimeout = setTimeout(() => {
            if (video && this.originalSpeed !== null) {
                video.playbackRate = this.originalSpeed;
                this.showNotification(`Speed restored to ${this.originalSpeed}x`, 'info');
                this.originalSpeed = null;
                this.speedBoostTimeout = null;
            }
        }, seconds * 1000);
    }

    setupPlaybackSpeedSync() {
        // Monitor video element and sync playback speed
        const checkVideo = () => {
            const video = this.getVideoElement();
            if (video && !this.speedSyncSetup) {
                this.speedSyncSetup = true;

                // Listen to ratechange event (fires when playback rate changes)
                video.addEventListener('ratechange', () => {
                    // This will fire for both our changes and YouTube's changes
                    // The video.playbackRate is the source of truth
                });
            }
        };

        // Check immediately and on interval
        checkVideo();
        setInterval(checkVideo, 1000);
    }

    getCurrentPlaybackSpeed() {
        const video = this.getVideoElement();
        if (!video) return 1;

        // Always read directly from video element - this is the source of truth
        return video.playbackRate;
    }

    increasePlaybackSpeed() {
        const video = this.getVideoElement();
        if (video) {
            // Extended speed options up to 5x
            const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5, 5];

            // Get current speed directly from video element
            const currentSpeed = this.getCurrentPlaybackSpeed();

            // Find the current index - use a small tolerance for floating point comparison
            let currentIndex = -1;
            for (let i = 0; i < speeds.length; i++) {
                if (Math.abs(speeds[i] - currentSpeed) < 0.01) {
                    currentIndex = i;
                    break;
                }
            }

            // If not found, find the closest one
            if (currentIndex === -1) {
                currentIndex = speeds.reduce((closest, speed, index) => {
                    return Math.abs(speed - currentSpeed) < Math.abs(speeds[closest] - currentSpeed)
                        ? index : closest;
                }, 0);
            }

            // Move to next speed
            const nextIndex = Math.min(currentIndex + 1, speeds.length - 1);
            const newSpeed = speeds[nextIndex];

            // Set the speed directly on the video element
            video.playbackRate = newSpeed;

            // Force a ratechange event if needed
            if (video.playbackRate !== newSpeed) {
                Object.defineProperty(video, 'playbackRate', {
                    value: newSpeed,
                    writable: true,
                    configurable: true
                });
            }

            this.showNotification(`Playback speed: ${newSpeed}x`, 'info');
        }
    }

    decreasePlaybackSpeed() {
        const video = this.getVideoElement();
        if (video) {
            // Extended speed options up to 5x
            const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5, 5];

            // Get current speed directly from video element
            const currentSpeed = this.getCurrentPlaybackSpeed();

            // Find the current index - use a small tolerance for floating point comparison
            let currentIndex = -1;
            for (let i = 0; i < speeds.length; i++) {
                if (Math.abs(speeds[i] - currentSpeed) < 0.01) {
                    currentIndex = i;
                    break;
                }
            }

            // If not found, find the closest one
            if (currentIndex === -1) {
                currentIndex = speeds.reduce((closest, speed, index) => {
                    return Math.abs(speed - currentSpeed) < Math.abs(speeds[closest] - currentSpeed)
                        ? index : closest;
                }, 0);
            }

            // Move to previous speed
            const prevIndex = Math.max(currentIndex - 1, 0);
            const newSpeed = speeds[prevIndex];

            // Set the speed directly on the video element
            video.playbackRate = newSpeed;

            // Force a ratechange event if needed
            if (video.playbackRate !== newSpeed) {
                Object.defineProperty(video, 'playbackRate', {
                    value: newSpeed,
                    writable: true,
                    configurable: true
                });
            }

            this.showNotification(`Playback speed: ${newSpeed}x`, 'info');
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

    setupSubscribeButton() {
        // Wait for YouTube page to load and find the subscribe button
        const checkForSubscribeButton = () => {
            // Try multiple selectors for YouTube's subscribe button container
            const subscribeButtonSelectors = [
                'ytd-subscribe-button-renderer',
                '#subscribe-button',
                'ytd-video-owner-renderer ytd-subscribe-button-renderer',
                'ytd-channel-name + ytd-subscribe-button-renderer',
                'ytd-watch-metadata ytd-subscribe-button-renderer',
                'ytd-video-owner-renderer button[aria-label*="Subscribe"]',
                'yt-button-shape button[aria-label*="Subscribe"]'
            ];

            let subscribeButton = null;
            let subscribeContainer = null;

            for (const selector of subscribeButtonSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    // If it's a container, find the actual button inside
                    if (element.tagName === 'YTD-SUBSCRIBE-BUTTON-RENDERER') {
                        subscribeContainer = element;
                        subscribeButton = element.querySelector('button') || element.querySelector('yt-button-shape');
                    } else if (element.tagName === 'BUTTON' || element.tagName === 'YT-BUTTON-SHAPE') {
                        subscribeButton = element;
                        subscribeContainer = element.closest('ytd-subscribe-button-renderer') || element.parentElement;
                    }
                    if (subscribeButton) break;
                }
            }

            // If we found a container but no button, try to find button in container
            if (subscribeContainer && !subscribeButton) {
                subscribeButton = subscribeContainer.querySelector('button') ||
                    subscribeContainer.querySelector('yt-button-shape');
            }

            if (subscribeButton && !document.getElementById('bb-add-to-subscriptions-btn')) {
                this.addSubscriptionButton(subscribeButton, subscribeContainer);
            }
        };

        // Check immediately and on interval
        checkForSubscribeButton();
        const intervalId = setInterval(() => {
            if (document.getElementById('bb-add-to-subscriptions-btn')) {
                clearInterval(intervalId);
            } else {
                checkForSubscribeButton();
            }
        }, 1000);

        // Also check when DOM changes (YouTube uses dynamic loading)
        const observer = new MutationObserver(() => {
            if (!document.getElementById('bb-add-to-subscriptions-btn')) {
                checkForSubscribeButton();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    addSubscriptionButton(subscribeButton, subscribeContainer) {
        // Create our button
        const addButton = document.createElement('button');
        addButton.id = 'bb-add-to-subscriptions-btn';
        addButton.className = 'bb-subscription-btn';

        // pouch
        addButton.innerHTML = '<svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" style="width: 24px; height: 24px; fill: currentColor;"><g><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"></path></g></svg>';
        addButton.title = 'Add channel to Bell Bearer pouch';

        // Detect YouTube theme (dark mode has dark attribute on html element)
        const isDarkTheme = document.documentElement.hasAttribute('dark') ||
            document.documentElement.getAttribute('dark') !== null ||
            getComputedStyle(document.documentElement).getPropertyValue('--yt-spec-base-background').trim() === '#0f0f0f';

        // Set colors based on theme
        const bgColor = isDarkTheme ? '#272727' : '#f0f0f0';
        const bgHoverColor = isDarkTheme ? '#3f3f3f' : '#e0e0e0';
        const textColor = isDarkTheme ? '#ffffff' : '#0f0f0f';
        const borderColor = isDarkTheme ? '#3f3f3f' : '#d0d0d0';

        // Style the button to match YouTube's style - icon only, positioned to the right
        addButton.style.cssText = `
            margin-left: 8px;
            padding: 8px 12px;
            background: ${bgColor};
            border: 1px solid ${borderColor};
            border-radius: 18px;
            color: ${textColor};
            font-size: 18px;
            cursor: pointer;
            font-family: 'Roboto', 'Arial', sans-serif;
            transition: background-color 0.2s;
            white-space: nowrap;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 36px;
            height: 36px;
            vertical-align: middle;
            flex-shrink: 0;
        `;

        addButton.addEventListener('mouseenter', () => {
            addButton.style.background = bgHoverColor;
        });

        addButton.addEventListener('mouseleave', () => {
            addButton.style.background = bgColor;
        });

        addButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showAddChannelModal();
        });

        // Try multiple insertion strategies - insert AFTER subscribe button (to the right)
        let inserted = false;

        // Strategy 1: Find yt-smartimation and insert as sibling (keeps them on same row)
        const smartimation = subscribeContainer?.querySelector('yt-smartimation') ||
            subscribeContainer?.closest('ytd-subscribe-button-renderer')?.querySelector('yt-smartimation');

        if (smartimation && smartimation.parentElement) {
            const parent = smartimation.parentElement;
            // Ensure parent uses flex layout for horizontal alignment
            parent.style.display = 'flex';
            parent.style.alignItems = 'center';
            parent.style.flexWrap = 'nowrap';

            if (smartimation.nextSibling) {
                parent.insertBefore(addButton, smartimation.nextSibling);
            } else {
                parent.appendChild(addButton);
            }
            inserted = true;
        }

        // Strategy 2: Insert after subscribe button container with flex wrapper
        if (!inserted && subscribeContainer && subscribeContainer.parentElement) {
            const parent = subscribeContainer.parentElement;
            // Ensure horizontal layout
            parent.style.display = 'flex';
            parent.style.alignItems = 'center';
            parent.style.flexWrap = 'nowrap';

            if (subscribeContainer.nextSibling) {
                parent.insertBefore(addButton, subscribeContainer.nextSibling);
            } else {
                parent.appendChild(addButton);
            }
            inserted = true;
        }

        // Strategy 3: Insert after subscribe button itself
        if (!inserted && subscribeButton && subscribeButton.parentElement) {
            const parent = subscribeButton.parentElement;
            parent.style.display = 'flex';
            parent.style.alignItems = 'center';

            if (subscribeButton.nextSibling) {
                parent.insertBefore(addButton, subscribeButton.nextSibling);
            } else {
                parent.appendChild(addButton);
            }
            inserted = true;
        }

        // Strategy 4: Find the owner renderer and append after subscribe container
        if (!inserted) {
            const ownerRenderer = document.querySelector('ytd-video-owner-renderer');
            if (ownerRenderer && subscribeContainer) {
                ownerRenderer.style.display = 'flex';
                ownerRenderer.style.alignItems = 'center';
                if (subscribeContainer.nextSibling) {
                    ownerRenderer.insertBefore(addButton, subscribeContainer.nextSibling);
                } else {
                    ownerRenderer.appendChild(addButton);
                }
                inserted = true;
            } else if (ownerRenderer && subscribeButton) {
                if (subscribeButton.nextSibling) {
                    ownerRenderer.insertBefore(addButton, subscribeButton.nextSibling);
                } else {
                    ownerRenderer.appendChild(addButton);
                }
                inserted = true;
            }
        }

        // Strategy 5: Find watch metadata section and append
        if (!inserted) {
            const watchMetadata = document.querySelector('ytd-watch-metadata');
            if (watchMetadata) {
                watchMetadata.appendChild(addButton);
            }
        }
    }

    getChannelInfo() {
        // Try to extract channel information from the page
        let channelName = null;
        let channelUrl = null;

        // Try multiple selectors for channel name
        const channelNameSelectors = [
            'ytd-channel-name a',
            '#channel-name a',
            'ytd-video-owner-renderer #channel-name a',
            'ytd-channel-name #text',
            '.ytd-channel-name a'
        ];

        for (const selector of channelNameSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                channelName = element.textContent.trim();
                channelUrl = element.href || element.getAttribute('href');
                if (channelUrl && !channelUrl.startsWith('http')) {
                    channelUrl = 'https://www.youtube.com' + channelUrl;
                }
                break;
            }
        }

        // Fallback: try to get from URL if on channel page
        if (!channelUrl) {
            const url = window.location.href;
            if (url.includes('/channel/') || url.includes('/@') || url.includes('/c/') || url.includes('/user/')) {
                channelUrl = url.split('?')[0]; // Remove query params
            }
        }

        // Fallback: try to get channel name from page title or metadata
        if (!channelName) {
            const metaChannel = document.querySelector('meta[itemprop="name"]');
            if (metaChannel) {
                channelName = metaChannel.getAttribute('content');
            } else {
                // Try to extract from page title
                const title = document.title;
                if (title.includes(' - YouTube')) {
                    channelName = title.split(' - YouTube')[0];
                }
            }
        }

        return { channelName: channelName || 'Unknown Channel', channelUrl: channelUrl || window.location.href };
    }

    async showAddChannelModal() {
        const channelInfo = this.getChannelInfo();

        // Get topics from storage
        const result = await chrome.storage.local.get(['subscriptionTopics']);
        const topics = result.subscriptionTopics || [];

        if (topics.length === 0) {
            const shouldCreateTopic = confirm('No topics found. Would you like to create one first?');
            if (shouldCreateTopic) {
                this.showNotification('Please create a topic in the Dashboard first, then try again.', 'info');
                // Open dashboard
                chrome.runtime.sendMessage({ action: 'openDashboard' });
            }
            return;
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'bb-modal-overlay';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 100000;
        `;

        modal.innerHTML = `
            <div class="bb-modal-content" style="
                background: white;
                border-radius: 12px;
                padding: 24px;
                max-width: 400px;
                width: 90%;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            ">
                <h3 style="margin: 0 0 16px 0; font-size: 18px; color: #0f0f0f;">Add to Subscription Manager</h3>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #606060;">Channel Name:</label>
                    <input type="text" id="bb-channel-name" value="${this.escapeHtml(channelInfo.channelName)}" style="
                        width: 100%;
                        padding: 10px;
                        border: 1px solid #d0d0d0;
                        border-radius: 4px;
                        font-size: 14px;
                        box-sizing: border-box;
                    ">
                </div>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #606060;">Channel URL:</label>
                    <input type="text" id="bb-channel-url" value="${this.escapeHtml(channelInfo.channelUrl)}" style="
                        width: 100%;
                        padding: 10px;
                        border: 1px solid #d0d0d0;
                        border-radius: 4px;
                        font-size: 14px;
                        box-sizing: border-box;
                    ">
                </div>
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #606060;">Select Topic:</label>
                    <select id="bb-topic-select" style="
                        width: 100%;
                        padding: 10px;
                        border: 1px solid #d0d0d0;
                        border-radius: 4px;
                        font-size: 14px;
                        box-sizing: border-box;
                    ">
                        ${topics.map(topic => `<option value="${topic.id}">${this.escapeHtml(topic.name)}</option>`).join('')}
                    </select>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="bb-save-channel" style="
                        background: #0f0f0f;
                        color: white;
                        border: none;
                        padding: 10px 24px;
                        border-radius: 18px;
                        font-size: 14px;
                        font-weight: 500;
                        cursor: pointer;
                    ">Add</button>
                    <button id="bb-cancel-channel" style="
                        background: #f0f0f0;
                        color: #0f0f0f;
                        border: 1px solid #d0d0d0;
                        padding: 10px 24px;
                        border-radius: 18px;
                        font-size: 14px;
                        font-weight: 500;
                        cursor: pointer;
                    ">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#bb-save-channel').addEventListener('click', async () => {
            const channelName = modal.querySelector('#bb-channel-name').value.trim();
            const channelUrl = modal.querySelector('#bb-channel-url').value.trim();
            const topicId = modal.querySelector('#bb-topic-select').value;

            if (channelName && channelUrl) {
                await this.saveChannelToSubscriptions(channelName, channelUrl, topicId);
                modal.remove();
                this.showNotification('Channel added to Subscription Manager!', 'success');
            }
        });

        modal.querySelector('#bb-cancel-channel').addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    async saveChannelToSubscriptions(channelName, channelUrl, topicId) {
        try {
            const result = await chrome.storage.local.get(['subscriptionChannels']);
            const channels = result.subscriptionChannels || [];

            const channelId = this.extractChannelIdFromUrl(channelUrl) || Date.now().toString();
            const channel = {
                id: channelId,
                name: channelName,
                url: channelUrl,
                topicId: topicId,
                addedAt: Date.now()
            };

            // Check if channel already exists
            const existingIndex = channels.findIndex(c => c.id === channelId);
            if (existingIndex !== -1) {
                channels[existingIndex] = channel;
            } else {
                channels.push(channel);
            }

            await chrome.storage.local.set({ subscriptionChannels: channels });
        } catch (error) {
            console.error('Error saving channel:', error);
            this.showNotification('Error saving channel', 'error');
        }
    }

    extractChannelIdFromUrl(url) {
        try {
            const urlObj = new URL(url);
            if (urlObj.pathname.startsWith('/@')) {
                return urlObj.pathname.slice(1);
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

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new YouTubeBookmarker();
    });
} else {
    new YouTubeBookmarker();
} 