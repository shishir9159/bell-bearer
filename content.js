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
        this.preferredSubtitleLanguage = 'en'; // Default preferred subtitle
        this.enableSkipShortcuts = true;
        this.pouchButtonStyle = 'auto'; // 'auto' | 'accent' | 'hidden' — look of the on-page "Add to pouch" button
        this.syncThemeWithYouTube = false; // make Bell Bearer follow YouTube's light/dark theme
        this.speedBoostTimeout = null; // Timeout for temporary speed boost
        this.originalSpeed = null; // Store original speed before boost
        this.currentSite = this.detectSite(); // Detect which site we're on
        this.userSetSpeed = null; // Track user-intended speed for enforcement
        this.speedEnforcementInterval = null;
        this.init();
    }

    /**
     * Detect which supported site we're currently on
     * @returns {'youtube'|'netflix'|'reddit'|'twitter'|'other'}
     */
    detectSite() {
        const hostname = window.location.hostname;
        if (hostname.includes('youtube.com')) return 'youtube';
        if (hostname.includes('netflix.com')) return 'netflix';
        if (hostname.includes('reddit.com')) return 'reddit';
        if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
        return 'other';
    }

    init() {
        this.loadSettings();
        this.setupKeyboardListeners();
        this.setupMessageListener();

        // YouTube-specific features
        if (this.currentSite === 'youtube') {
            this.detectVideoChange();
            this.setupPlaybackSpeedSync();
            this.setupSubscribeButton();
            this.setupThemeSync();
            this.setupGuideDrawer();
            setInterval(() => {
                this.detectVideoChange();
            }, 2000);
        }

        // Speed enforcement for non-YouTube sites that may reset playbackRate.
        // (YouTube respects playbackRate and has its own speed menu, so we leave
        // it alone to avoid fighting the native control.) Enforcement only acts
        // after the user changes speed with our shortcuts (userSetSpeed is set).
        if (this.currentSite !== 'youtube') {
            this.setupSpeedEnforcement();
        }
    }

    loadSettings() {
        chrome.storage.local.get(['enableSkipShortcuts', 'preferredSubtitleLanguage', 'pouchButtonStyle', 'syncThemeWithYouTube'], (result) => {
            this.enableSkipShortcuts = result.enableSkipShortcuts !== false;
            this.syncThemeWithYouTube = result.syncThemeWithYouTube === true;
            if (this.syncThemeWithYouTube && this._applyYouTubeTheme) this._applyYouTubeTheme();
            if (result.preferredSubtitleLanguage) {
                this.preferredSubtitleLanguage = result.preferredSubtitleLanguage;
            }
            if (result.pouchButtonStyle) {
                this.pouchButtonStyle = result.pouchButtonStyle;
                this.applyPouchButtonStyle();
            }
        });

        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local') {
                if (changes.enableSkipShortcuts) {
                    this.enableSkipShortcuts = changes.enableSkipShortcuts.newValue;
                }
                if (changes.preferredSubtitleLanguage) {
                    this.preferredSubtitleLanguage = changes.preferredSubtitleLanguage.newValue;
                }
                if (changes.pouchButtonStyle) {
                    this.pouchButtonStyle = changes.pouchButtonStyle.newValue || 'auto';
                    this.applyPouchButtonStyle();
                }
                if (changes.syncThemeWithYouTube) {
                    this.syncThemeWithYouTube = changes.syncThemeWithYouTube.newValue === true;
                    if (this.syncThemeWithYouTube && this._applyYouTubeTheme) this._applyYouTubeTheme();
                }
            }
        });
    }

    /**
     * Re-render the on-page "Add to pouch" button after its style setting
     * changes. Removes the current button; the persistent check re-adds it with
     * the new look (unless the style is 'hidden').
     */
    applyPouchButtonStyle() {
        const existing = document.getElementById('bb-add-to-subscriptions-btn');
        if (existing) existing.remove();
        if (this.pouchButtonStyle !== 'hidden' && this.currentSite === 'youtube' && this._recheckPouchButton) {
            this._recheckPouchButton();
        }
    }

    /**
     * When "Match YouTube theme" is enabled, mirror YouTube's light/dark mode
     * into Bell Bearer's saved theme so the popup/dashboard follow it.
     */
    setupThemeSync() {
        this._applyYouTubeTheme = () => {
            if (!this.syncThemeWithYouTube) return;
            const isDark = document.documentElement.hasAttribute('dark') ||
                getComputedStyle(document.documentElement).getPropertyValue('--yt-spec-base-background').trim() === '#0f0f0f';
            const theme = isDark ? 'dark' : 'light';
            try {
                chrome.storage.local.get(['theme'], (res) => {
                    if (!chrome.runtime.lastError && res.theme !== theme) {
                        chrome.storage.local.set({ theme });
                    }
                });
            } catch (e) {
                // Extension context may be invalid after a reload — ignore.
            }
        };

        // YouTube toggles the `dark` attribute on <html> when its theme changes.
        const observer = new MutationObserver(() => this._applyYouTubeTheme());
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });

        this._applyYouTubeTheme();
    }

    /**
     * Inject a "Bell Bearer" entry into YouTube's left drawer. Clicking it opens
     * an overlay to pick a topic and see the latest upload from each of its channels.
     */
    setupGuideDrawer() {
        const inject = () => {
            const sections = document.querySelector('ytd-guide-renderer #sections');
            if (!sections || document.getElementById('bb-guide-entry')) return;

            const entry = document.createElement('div');
            entry.id = 'bb-guide-entry';
            entry.className = 'bb-guide-entry';
            entry.setAttribute('role', 'link');
            entry.setAttribute('tabindex', '0');
            entry.title = 'Bell Bearer — latest from your topics';
            entry.innerHTML = `
                <span class="bb-guide-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg></span>
                <span class="bb-guide-text">Bell Bearer</span>
            `;
            const open = () => this.showTopicsOverlay();
            entry.addEventListener('click', open);
            entry.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });
            sections.prepend(entry);
        };

        inject();
        const observer = new MutationObserver(() => inject());
        observer.observe(document.body, { childList: true, subtree: true });
        setInterval(inject, 2000);
    }

    /**
     * Overlay that lists the user's topics; picking one loads the latest upload
     * from each channel in that topic.
     */
    async showTopicsOverlay() {
        if (!chrome.runtime || !chrome.runtime.id) {
            this.showNotification('Bell Bearer was updated — please refresh this page.', 'warning');
            return;
        }
        if (document.getElementById('bb-topics-overlay')) return;

        let topics = [], channels = [], savedTheme = null;
        try {
            const r = await chrome.storage.local.get(['subscriptionTopics', 'subscriptionChannels', 'theme']);
            topics = r.subscriptionTopics || [];
            channels = r.subscriptionChannels || [];
            savedTheme = r.theme || null;
        } catch (e) {
            this.showNotification('Bell Bearer was updated — please refresh this page.', 'warning');
            return;
        }

        const ytDark = document.documentElement.hasAttribute('dark') ||
            getComputedStyle(document.documentElement).getPropertyValue('--yt-spec-base-background').trim() === '#0f0f0f';
        const dark = savedTheme ? savedTheme === 'dark' : ytDark;
        // Match Bell Bearer's palette: rose accent in light, Discord blurple in dark.
        const t = dark
            ? { panel: '#2f3136', text: '#e3e5e8', sub: '#b5bac1', border: '#26282c', chip: '#36393f', card: '#36393f' }
            : { panel: '#ffffff', text: '#14171d', sub: '#59626f', border: '#e6e8ef', chip: '#f6f7fb', card: '#f6f7fb' };
        const accent = dark ? '#7289da' : '#e11d48';

        const overlay = document.createElement('div');
        overlay.id = 'bb-topics-overlay';
        overlay.className = 'bb-modal-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;justify-content:center;align-items:flex-start;z-index:2147483647;overflow:auto;padding:48px 16px;';

        const topicChips = topics.length
            ? topics.map(tp => `<button class="bb-topic-chip" data-topic-id="${tp.id}" style="background:${t.chip};color:${t.text};border:1px solid ${t.border};padding:7px 14px;border-radius:999px;font-size:14px;font-weight:600;cursor:pointer;">${this.escapeHtml(tp.name)}</button>`).join('')
            : `<p style="color:${t.sub};font-size:14px;margin:0;">No topics yet — add channels to a topic using the button next to Subscribe.</p>`;

        overlay.innerHTML = `
            <div style="background:${t.panel};color:${t.text};border-radius:16px;width:100%;max-width:780px;box-shadow:0 24px 64px rgba(0,0,0,.5);font-family:'Roboto','Arial',sans-serif;overflow:hidden;">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid ${t.border};">
                    <h3 style="margin:0;font-size:18px;">Latest by topic</h3>
                    <button id="bb-overlay-close" title="Close" style="background:none;border:none;color:${t.sub};font-size:26px;line-height:1;cursor:pointer;padding:0 4px;">&times;</button>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;padding:16px 22px;border-bottom:1px solid ${t.border};">${topicChips}</div>
                <div id="bb-topic-videos" style="padding:18px 22px;min-height:120px;">
                    <p style="color:${t.sub};font-size:14px;margin:0;">Select a topic to load the latest video from each of its channels.</p>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('#bb-overlay-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey, true); } };
        document.addEventListener('keydown', onKey, true);

        const videosBox = overlay.querySelector('#bb-topic-videos');
        overlay.querySelectorAll('.bb-topic-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                overlay.querySelectorAll('.bb-topic-chip').forEach(c => {
                    c.style.background = t.chip; c.style.color = t.text; c.style.borderColor = t.border;
                });
                chip.style.background = accent; chip.style.color = '#fff'; chip.style.borderColor = accent;
                this.loadTopicVideos(chip.dataset.topicId, channels, videosBox, t);
            });
        });
    }

    async loadTopicVideos(topicId, channels, container, t) {
        const topicChannels = channels.filter(c => c.topicId === topicId);
        if (topicChannels.length === 0) {
            container.innerHTML = `<p style="color:${t.sub};font-size:14px;margin:0;">No channels in this topic yet.</p>`;
            return;
        }
        container.innerHTML = `<p style="color:${t.sub};font-size:14px;margin:0;">Loading latest videos…</p>`;

        const videos = [];
        await Promise.all(topicChannels.map(async (ch) => {
            const cid = await this.resolveChannelId(ch);
            if (!cid) return;
            const latest = await this.fetchLatestVideos(cid);
            if (latest[0]) videos.push({ ...latest[0], channelName: ch.name });
        }));

        if (videos.length === 0) {
            container.innerHTML = `<p style="color:${t.sub};font-size:14px;margin:0;">Couldn't load videos for these channels.</p>`;
            return;
        }
        videos.sort((a, b) => b.published - a.published);

        container.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;">` +
            videos.map(v => `
                <a href="${v.url}" style="text-decoration:none;color:${t.text};background:${t.card};border:1px solid ${t.border};border-radius:12px;overflow:hidden;display:block;">
                    <img src="${v.thumb}" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#000;">
                    <div style="padding:10px 12px;">
                        <div style="font-size:13px;font-weight:600;line-height:1.3;max-height:2.6em;overflow:hidden;">${this.escapeHtml(v.title)}</div>
                        <div style="font-size:12px;color:${t.sub};margin-top:5px;">${this.escapeHtml(v.channelName)}</div>
                    </div>
                </a>
            `).join('') + `</div>`;
    }

    /**
     * Resolve a channel's UC… id (needed for the RSS feed). Uses the URL directly
     * when it's a /channel/UC… link, otherwise fetches the channel page once and
     * caches the result.
     */
    async resolveChannelId(channel) {
        const url = channel.url || '';
        const direct = url.match(/\/channel\/(UC[\w-]+)/);
        if (direct) return direct[1];

        try {
            const cache = (await chrome.storage.local.get(['bbChannelIdCache'])).bbChannelIdCache || {};
            if (cache[url]) return cache[url];

            const res = await fetch(url);
            const html = await res.text();
            const m = html.match(/"channelId":"(UC[\w-]+)"/) || html.match(/\/channel\/(UC[\w-]+)/);
            const cid = m ? m[1] : null;
            if (cid) {
                cache[url] = cid;
                chrome.storage.local.set({ bbChannelIdCache: cache });
            }
            return cid;
        } catch (e) {
            return null;
        }
    }

    /** Fetch + parse a channel's public RSS feed into a list of recent videos. */
    async fetchLatestVideos(channelId) {
        try {
            const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
            const xml = await res.text();
            const doc = new DOMParser().parseFromString(xml, 'text/xml');
            return Array.from(doc.getElementsByTagName('entry')).map(en => {
                const vid = (en.getElementsByTagName('yt:videoId')[0] || {}).textContent || '';
                const title = (en.getElementsByTagName('title')[0] || {}).textContent || '';
                const publishedText = (en.getElementsByTagName('published')[0] || {}).textContent || '';
                const published = publishedText ? new Date(publishedText).getTime() : 0;
                const thumbEl = en.getElementsByTagName('media:thumbnail')[0];
                const thumb = (thumbEl && thumbEl.getAttribute('url')) || (vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : '');
                return { id: vid, title, url: `https://www.youtube.com/watch?v=${vid}`, thumb, published };
            }).filter(v => v.id);
        } catch (e) {
            return [];
        }
    }

    /**
     * Build a Markdown link for the current page: [title](url). On a YouTube
     * watch page it uses the video title + channel name and a clean watch URL.
     */
    buildMarkdownLink() {
        if (this.currentSite === 'youtube') {
            const videoId = this.getCurrentVideoId();
            if (videoId) {
                const title = this.getCurrentVideoTitle();
                const channel = this.getChannelInfo().channelName;
                return `[${title} - ${channel}](https://www.youtube.com/watch?v=${videoId})`;
            }
        }
        const title = (document.title || location.href).replace(/\s+/g, ' ').trim();
        return `[${title}](${location.href})`;
    }

    /** Copy text to the clipboard (works via the clipboardWrite permission). */
    copyTextToClipboard(text) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            if (ok) return true;
        } catch (e) { /* fall through to async API */ }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => {});
        }
        return false;
    }

    setupKeyboardListeners() {
        // Use capture phase to ensure we catch events before YouTube
        document.addEventListener('keydown', (e) => {
            // Never hijack keystrokes while the user is typing in a field/editor.
            // (Essential now that the script runs on every site.)
            if (this.isTypingTarget(e.target)) return;

            // Ctrl + B: start a checkpoint recording (only where we track a video).
            if (e.ctrlKey && (e.key === 'b' || e.key === 'B') && !this.isRecording) {
                if (this.videoID) {
                    e.preventDefault();
                    this.startRecording();
                }
                return;
            }

            // Every shortcut below acts on a media element. If the page has none,
            // let the keystroke pass through untouched.
            if (!this.getVideoElement()) return;

            // Alt + 1-9: skip forward by number of seconds
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

            // Shift + 1-9: skip backward by number of seconds
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

            // + key (Shift + = on most keyboards, or numpad +): reset playback speed to 1x
            if (e.key === '+' && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                this.resetPlaybackSpeed();
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

    /**
     * True when keyboard focus is in a text field / editable element, so we
     * should not intercept shortcut keys (avoids breaking typing on any site).
     */
    isTypingTarget(el) {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
    }

    setupMessageListener() {
        // popup or background script messages
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'seekToTime') {
                this.seekToTime(message.time);
                sendResponse({ ok: true });
            } else if (message.action === 'changeSpeed') {
                // Sent by the popup / dashboard speed buttons.
                const newRate = this.changeSpeedByDelta(message.delta);
                sendResponse({ ok: newRate !== null, rate: newRate });
            } else if (message.action === 'copyMarkdownLink') {
                // Triggered by the Ctrl+Shift+L command (relayed by background.js).
                this.copyTextToClipboard(this.buildMarkdownLink());
                this.showNotification('Copied page as Markdown link', 'success');
                sendResponse({ ok: true });
            }
            // Returning a falsy value closes the channel synchronously, which is
            // what we want here since all responses above are sent synchronously.
        });
    }

    /**
     * Adjust the current video's playback rate by `delta`, clamped to a sane
     * range. Returns the resulting rate, or null if no video was found.
     * Used by the popup/dashboard "Speed Up / Slow Down" buttons.
     */
    changeSpeedByDelta(delta) {
        const video = this.getVideoElement();
        if (!video) return null;

        const newRate = Math.max(0.25, Math.min(16, video.playbackRate + delta));
        video.playbackRate = newRate;
        this.userSetSpeed = newRate; // Track user intent for enforcement

        // Show the actual resulting rate (read back from the element) so the
        // notification can never disagree with what is really playing.
        const actualRate = Math.round(video.playbackRate * 100) / 100;
        this.showNotification(`Playback speed: ${actualRate}x`, 'info');
        return actualRate;
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
            // Fetch preferred language, falling back to English (auto-generated preferred)
            this.currentTranscript = await this.transcriptApi.fetch(videoId, { languages: [this.preferredSubtitleLanguage, 'en'] });
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
        switch (this.currentSite) {
            case 'youtube':
                return document.querySelector('video.html5-main-video') || document.querySelector('video');
            case 'netflix':
                return document.querySelector('video');
            case 'reddit': {
                // Reddit uses shreddit-player or media-element containers
                const redditVideo = document.querySelector('shreddit-player video') ||
                    document.querySelector('.media-element video') ||
                    document.querySelector('[data-testid="shreddit-player"] video') ||
                    document.querySelector('video');
                return redditVideo;
            }
            case 'twitter': {
                // Twitter/X wraps videos in a testid container
                const twitterVideo = document.querySelector('[data-testid="videoPlayer"] video') ||
                    document.querySelector('video');
                return twitterVideo;
            }
            default:
                return document.querySelector('video');
        }
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

        // Check if preferred subtitle language is missing and show warning
        if (!this.currentTranscript || (this.currentTranscript.languageCode && !this.currentTranscript.languageCode.startsWith(this.preferredSubtitleLanguage))) {
            this.showNotification(`Warning: Preferred subtitles language not found`, 'warning');
        }

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
        this.userSetSpeed = 3; // Track for enforcement
        this.showNotification(`Speed boost: 3x for ${seconds}s`, 'info');

        // Set timeout to restore original speed
        this.speedBoostTimeout = setTimeout(() => {
            if (video && this.originalSpeed !== null) {
                video.playbackRate = this.originalSpeed;
                this.userSetSpeed = this.originalSpeed; // Track restored speed
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

            // Set the speed directly on the video element. playbackRate is a
            // native accessor on HTMLMediaElement; assigning to it is all that's
            // needed. (Do NOT redefine the property with Object.defineProperty —
            // that replaces the native setter with a plain value, after which the
            // video keeps playing at the old rate while reads return the fake
            // value. That is the "speed up stops working but the popup still
            // shows the new number" bug.)
            video.playbackRate = newSpeed;
            this.userSetSpeed = newSpeed; // Track user intent for enforcement

            // Report the rate the element actually accepted.
            this.showNotification(`Playback speed: ${video.playbackRate}x`, 'info');
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

            // Set the speed directly on the video element. See the note in
            // increasePlaybackSpeed() — never redefine the property.
            video.playbackRate = newSpeed;
            this.userSetSpeed = newSpeed; // Track user intent for enforcement

            // Report the rate the element actually accepted.
            this.showNotification(`Playback speed: ${video.playbackRate}x`, 'info');
        }
    }

    resetPlaybackSpeed() {
        const video = this.getVideoElement();
        if (video) {
            video.playbackRate = 1;
            this.userSetSpeed = 1; // Track user intent for enforcement
            this.showNotification(`Playback speed: ${video.playbackRate}x`, 'info');
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
            if (this.pouchButtonStyle === 'hidden') return; // user turned the button off
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

        // Expose for live re-rendering when the pouch-button style setting changes.
        this._recheckPouchButton = checkForSubscribeButton;

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

        // Set colors based on theme, or use the Bell Bearer accent for 'accent' style
        const accent = this.pouchButtonStyle === 'accent';
        const bgColor = accent ? '#e11d48' : (isDarkTheme ? '#272727' : '#f0f0f0');
        const bgHoverColor = accent ? '#c40f3f' : (isDarkTheme ? '#3f3f3f' : '#e0e0e0');
        const textColor = accent ? '#ffffff' : (isDarkTheme ? '#ffffff' : '#0f0f0f');
        const borderColor = accent ? '#e11d48' : (isDarkTheme ? '#3f3f3f' : '#d0d0d0');

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
            Promise.resolve(this.showAddChannelModal()).catch((err) => {
                console.error('Bell Bearer: could not open pouch dialog', err);
                this.showNotification('Could not open the pouch dialog — try refreshing the page.', 'error');
            });
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
        // If the extension was reloaded/updated, this content script's context is
        // dead and any chrome.* call will throw. Tell the user to refresh.
        if (!chrome.runtime || !chrome.runtime.id) {
            this.showNotification('Bell Bearer was updated — please refresh this page, then try again.', 'warning');
            return;
        }

        const channelInfo = this.getChannelInfo();

        // Get topics + the saved Bell Bearer theme (so the modal honors it).
        let topics = [];
        let savedTheme = null;
        try {
            const result = await chrome.storage.local.get(['subscriptionTopics', 'theme']);
            topics = result.subscriptionTopics || [];
            savedTheme = result.theme || null;
        } catch (err) {
            this.showNotification('Bell Bearer was updated — please refresh this page, then try again.', 'warning');
            return;
        }

        // Use the selected Bell Bearer theme if one is saved; otherwise match YouTube's.
        const ytDark = document.documentElement.hasAttribute('dark') ||
            getComputedStyle(document.documentElement).getPropertyValue('--yt-spec-base-background').trim() === '#0f0f0f';
        const isDark = savedTheme ? savedTheme === 'dark' : ytDark;
        const c = isDark
            ? { surface: '#212121', text: '#f1f1f1', sub: '#aaaaaa', inputBg: '#121212', border: '#3f3f3f', cancelBg: '#2b2b2b' }
            : { surface: '#ffffff', text: '#0f0f0f', sub: '#606060', inputBg: '#ffffff', border: '#d0d0d0', cancelBg: '#f0f0f0' };
        const accent = '#e11d48';

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'bb-modal-overlay';
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 2147483647;
        `;

        modal.innerHTML = `
            <div class="bb-modal-content" style="
                background: ${c.surface};
                color: ${c.text};
                border-radius: 14px;
                padding: 22px;
                max-width: 380px;
                width: 90%;
                box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
                font-family: 'Roboto', 'Arial', sans-serif;
            ">
                <h3 style="margin: 0 0 6px 0; font-size: 17px; color: ${c.text};">Add channel to pouch</h3>
                <p style="margin: 0 0 18px 0; font-size: 14px; font-weight: 500; color: ${c.sub};">${this.escapeHtml(channelInfo.channelName)}</p>

                <label style="display: block; margin-bottom: 8px; font-size: 13px; color: ${c.sub};">Topic</label>
                <select id="bb-topic-select" style="
                    width: 100%;
                    padding: 10px;
                    border: 1px solid ${c.border};
                    border-radius: 8px;
                    font-size: 14px;
                    box-sizing: border-box;
                    background: ${c.inputBg};
                    color: ${c.text};
                ">
                    ${topics.map(topic => `<option value="${topic.id}">${this.escapeHtml(topic.name)}</option>`).join('')}
                    <option value="__new__">➕ Create new topic…</option>
                </select>
                <input type="text" id="bb-new-topic" placeholder="New topic name" style="
                    display: none;
                    width: 100%;
                    margin-top: 10px;
                    padding: 10px;
                    border: 1px solid ${c.border};
                    border-radius: 8px;
                    font-size: 14px;
                    box-sizing: border-box;
                    background: ${c.inputBg};
                    color: ${c.text};
                ">

                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                    <button id="bb-cancel-channel" style="
                        background: ${c.cancelBg};
                        color: ${c.text};
                        border: 1px solid ${c.border};
                        padding: 9px 18px;
                        border-radius: 18px;
                        font-size: 14px;
                        font-weight: 500;
                        cursor: pointer;
                    ">Cancel</button>
                    <button id="bb-save-channel" style="
                        background: ${accent};
                        color: white;
                        border: none;
                        padding: 9px 20px;
                        border-radius: 18px;
                        font-size: 14px;
                        font-weight: 600;
                        cursor: pointer;
                    ">Add</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Reveal the "new topic" field when "Create new topic" is chosen.
        const topicSelect = modal.querySelector('#bb-topic-select');
        const newTopicInput = modal.querySelector('#bb-new-topic');
        if (topics.length === 0) {
            topicSelect.value = '__new__';
            newTopicInput.style.display = 'block';
        }
        topicSelect.addEventListener('change', () => {
            const creating = topicSelect.value === '__new__';
            newTopicInput.style.display = creating ? 'block' : 'none';
            if (creating) newTopicInput.focus();
        });

        modal.querySelector('#bb-save-channel').addEventListener('click', async () => {
            const channelName = channelInfo.channelName;
            const channelUrl = channelInfo.channelUrl;

            try {
                let topicId = topicSelect.value;
                if (topicId === '__new__') {
                    const newName = newTopicInput.value.trim();
                    if (!newName) {
                        this.showNotification('Enter a name for the new topic.', 'warning');
                        newTopicInput.focus();
                        return;
                    }
                    topicId = await this.createTopic(newName);
                }
                await this.saveChannelToSubscriptions(channelName, channelUrl, topicId);
                modal.remove();
                this.showNotification('Channel added to pouch!', 'success');
            } catch (err) {
                console.error('Bell Bearer: failed to save channel', err);
                this.showNotification('Bell Bearer was updated — please refresh this page, then try again.', 'warning');
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

    async createTopic(name) {
        const result = await chrome.storage.local.get(['subscriptionTopics']);
        const topics = result.subscriptionTopics || [];
        const topic = { id: Date.now().toString(), name: name, createdAt: Date.now() };
        topics.push(topic);
        await chrome.storage.local.set({ subscriptionTopics: topics });
        return topic.id;
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

    /**
     * Enforce playback speed on sites that may reset it (Netflix, Reddit).
     * Periodically checks and re-applies the user's intended speed.
     */
    setupSpeedEnforcement() {
        this.speedEnforcementInterval = setInterval(() => {
            if (this.userSetSpeed !== null) {
                const video = this.getVideoElement();
                if (video && Math.abs(video.playbackRate - this.userSetSpeed) > 0.01) {
                    video.playbackRate = this.userSetSpeed;
                }
            }
        }, 500);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new YouTubeBookmarker();
    });
} else {
    new YouTubeBookmarker();
} 