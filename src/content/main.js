/**
 * Content-script entry point: wires the modules together and installs the
 * listeners.
 *
 * What used to live here as one 1600-line class is now split by concern —
 * site/player/shortcuts/checkpoints/transcripts/markdown/youtube-ui — and this
 * file only decides what runs where.
 *
 * The timers are worth calling out. The old bootstrap started five: video
 * detection (2s), guide-drawer injection (2s), speed sync (1s), subscribe-button
 * injection (1s) and, off YouTube, rate enforcement (500ms) — on every page of
 * every site, forever. None of them survive:
 *   - which video is playing is read from the URL when something asks,
 *   - injections run on a shared observer that stops once they are placed,
 *   - the rate is kept by media events instead of polling.
 */
(function (root) {
    'use strict';

    const BB = root.BB;
    if (!BB) {
        console.error('Bell Bearer: shared modules failed to load');
        return;
    }

    // Content scripts can be injected twice (manifest match plus an explicit
    // executeScript). A second copy would double every shortcut.
    if (root.__bellBearerInstalled) return;
    root.__bellBearerInstalled = true;

    const { Settings, Speed, Site, Notify, Player, Shortcuts, Checkpoints, Transcripts, Markdown,
        PageInfo, DomWatch, Theme, YouTubeUi, Feed, Subscriptions, Watched,
        CookieSites, CookieBanner, ChessContent, Keybindings } = BB;

    const site = Site.detectSite();
    const getVideoElement = Site.createPlayerLocator(site);
    const notify = (message, type) => Notify.show(message, type);

    /** Settings mirror, kept current by the storage listener below. */
    const settings = { ...Settings.DEFAULTS };

    const player = Player.createPlayer({
        getVideoElement,
        notify,
        shouldRemember: () => settings.rememberPlaybackSpeed,
    });

    const transcripts = Transcripts.createTranscripts({
        getPreferredLanguage: () => settings.preferredSubtitleLanguage,
        notify,
    });

    /**
     * The video the user is on right now, read live from the URL rather than
     * tracked in a field. The old code refreshed a `this.videoID` on a 2s timer,
     * so a checkpoint taken just after navigating was filed under the previous
     * video — and the field stayed set after navigating away from a watch page.
     */
    function getVideo() {
        if (site !== 'youtube') return null;
        const id = PageInfo.getVideoId();
        if (!id) return null;
        return {
            id,
            title: PageInfo.getVideoTitle(),
            url: BB.YouTube.watchUrl(id, 0),
        };
    }

    const recorder = Checkpoints.createRecorder({ player, notify, getVideo, transcripts });

    const markdown = Markdown.createMarkdown({ site, pageInfo: PageInfo });

    // --------------------------------------------------------- keyboard

    Shortcuts.install({
        hasVideo: () => !!getVideoElement(),
        skip: (seconds) => player.skip(seconds),
        faster: () => player.faster(),
        slower: () => player.slower(),
        resetSpeed: () => player.resetSpeed(),
        boostSpeed: (seconds) => player.boostSpeed(seconds),
        startRecording: () => recorder.startRecording(),
        stopRecording: () => recorder.stopRecording(),
        toggleSegment: () => recorder.toggleSegment(),
    }, {
        canRecord: () => !!getVideo(),
        getShortcut: (id) => Keybindings.resolve(settings.shortcuts, id),
    });

    player.attach();
    markdown.trackContextLinks();

    // --------------------------------------------------------- messaging

    /**
     * Requests from the popup, the dashboard and the background worker.
     *
     * Every branch answers synchronously and the listener returns undefined,
     * which closes the channel — returning a truthy value would leave the
     * sender waiting for a response that never comes.
     */
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message && message.action) {
            case 'seekToTime':
                sendResponse({ ok: player.seekTo(message.time) });
                break;

            case 'stepSpeed': {
                // The popup and dashboard step the same ladder the keyboard
                // does; they used to add a flat +/-0.5 of their own, which is
                // how the rate ended up between rungs.
                const rate = message.direction === 0
                    ? player.resetSpeed()
                    : (message.direction > 0 ? player.faster() : player.slower());
                sendResponse({ ok: rate !== null, rate });
                break;
            }

            case 'getSpeed':
                sendResponse({ ok: !!getVideoElement(), rate: player.currentRate() });
                break;

            case 'copyMarkdownLink':
                markdown.copy(markdown.buildPageMarkdown()).then((ok) => {
                    if (ok) notify('Copied page as Markdown link', 'success');
                });
                sendResponse({ ok: true });
                break;

            case 'copyLinkAsMarkdown':
                markdown.copy(markdown.buildLinkMarkdown(message.linkUrl, message.selectionText)).then((ok) => {
                    if (ok) notify('Copied link as Markdown', 'success');
                });
                sendResponse({ ok: true });
                break;

            default:
                break;
        }
    });

    // ------------------------------------------------------ YouTube extras

    let youtubeUi = null;

    if (site === 'youtube') {
        const watcher = DomWatch.createWatcher();

        youtubeUi = YouTubeUi.createYouTubeUi({
            watcher,
            notify,
            getPouchButtonStyle: () => settings.pouchButtonStyle,
        });
        youtubeUi.install();

        Theme.installYouTubeSync(() => settings.syncThemeWithYouTube);

        // YouTube is a single-page app: it fires yt-navigate-finish instead of
        // reloading. `loadstart` is the belt-and-braces path for the cases where
        // the player swaps its source without a navigation event.
        let lastVideoId = null;
        const onPageChange = () => {
            youtubeUi.onNavigate();
            const id = PageInfo.getVideoId();
            if (!id || id === lastVideoId) return;
            lastVideoId = id;
            transcripts.prefetch(id);
        };

        window.addEventListener('yt-navigate-finish', onPageChange);
        window.addEventListener('popstate', onPageChange);
        document.addEventListener('loadstart', onPageChange, { capture: true, passive: true });
        onPageChange();

        installWatchedTracking();
        warmPouchInBackground();
    }

    /**
     * Note that a video has actually been watched.
     *
     * The pouch stops offering back what has already been seen, and this is
     * where "seen" is decided: a minute of playback, or a quarter of a short
     * video, whichever comes first. Opening a card in the pouch marks it too,
     * but most videos are reached from YouTube itself.
     *
     * It rides YouTube's own timeupdate rather than a timer of its own. That
     * event fires about four times a second while playing and not at all while
     * paused, which is exactly the clock wanted here, and the handler is one
     * comparison once the video has been marked.
     */
    const WATCHED_AFTER_S = 60;

    function installWatchedTracking() {
        let marked = null;

        document.addEventListener('timeupdate', () => {
            const id = PageInfo.getVideoId();
            if (!id || id === marked) return;

            const video = getVideoElement();
            if (!video) return;

            const enough = Number.isFinite(video.duration) && video.duration > 0
                ? Math.min(WATCHED_AFTER_S, video.duration * 0.25)
                : WATCHED_AFTER_S;
            if (video.currentTime < enough) return;

            marked = id;
            Watched.mark(id);
        }, { capture: true, passive: true });
    }

    /**
     * Pull the pouch's feeds down while the page is idle.
     *
     * The drawer entry is on screen from the moment YouTube's nav is, so by the
     * time it is clicked the sheet should have something to draw immediately.
     * Waiting for idle is the whole point — this must never compete with
     * YouTube's own start-up for the network.
     */
    function warmPouchInBackground() {
        const warm = async () => {
            try {
                const { channels } = await Subscriptions.load();
                if (channels.length) await Feed.warm(channels);
            } catch (_) { /* nothing is on screen to report this to */ }
        };

        if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 10000 });
        else setTimeout(warm, 5000);
    }

    // ------------------------------------------------------ chess.com extras

    let chess = null;

    if (site === 'chess') {
        chess = ChessContent.createChess({
            Keybindings,
            Shortcuts,
            notify,
            getShortcut: (id) => Keybindings.resolve(settings.shortcuts, id),
            getSettings: () => settings,
        });
        chess.install();
    }

    // ------------------------------------------------------ cookie banners

    CookieBanner.createCookieBanner({
        CookieSites,
        notify,
        showAccept: () => settings.cookieAcceptButton,
        showReject: () => settings.cookieRejectButton,
    }).install();

    // --------------------------------------------------------- settings

    function applySettings(values) {
        const pouchStyleChanged = 'pouchButtonStyle' in values &&
            values.pouchButtonStyle !== settings.pouchButtonStyle;

        Object.assign(settings, values);

        if (pouchStyleChanged && youtubeUi) youtubeUi.refreshPouchButton();
        if (chess) chess.syncClockWarning();
    }

    Settings.get().then(applySettings);
    Settings.watch(null, applySettings);

    // Exposed for debugging from the page console; nothing depends on it.
    root.__bellBearer = { player, recorder, transcripts, settings, Speed };
})(typeof globalThis !== 'undefined' ? globalThis : this);
