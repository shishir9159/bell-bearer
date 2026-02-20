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

    // What every page loads. A site's own modules are loaded on that site
    // alone — the worker registers one entry per site, each the core list
    // plus its own files and then this one — so they are taken off BB inside
    // that site's block below, and are simply not there anywhere else.
    const { Settings, Speed, Site, Notify, Player, Shortcuts, Markdown, PageInfo, DomWatch, Theme,
        CookieSites, CookieBanner, Keybindings, SkimContent, LinkHints, TimeLimitContent } = BB;

    /**
     * One module only each site's own entry loads. A site switched off in
     * Settings gets the core list and this file alone (see
     * src/background/site-scripts.js), so the host no longer says by itself
     * whether the site's code is here — and a block run on the host alone
     * would reach for a module that never came. Without its own module, a
     * site is any other site.
     */
    const OWN = {
        youtube: 'YouTubeUi', twitter: 'TwitterUi', reddit: 'RosterContent', chess: 'ChessContent', lichess: 'ChessContent',
        leetcode: 'LeetUi', typeracer: 'TyperUi', chatgpt: 'ChatUi', claude: 'ChatUi',
        github: 'CiWatchContent', gitlab: 'CiWatchContent', forgejo: 'CiWatchContent', vimeo: 'VimeoDownload',
    };
    const host = Site.detectSite();
    const site = !OWN[host] || BB[OWN[host]] ? host : 'other';
    const getVideoElement = Site.createPlayerLocator(site);
    const notify = (message, type, durationMs) => Notify.show(message, type, durationMs);

    /** Settings mirror, kept current by the storage listener below. */
    const settings = { ...Settings.DEFAULTS };

    const player = Player.createPlayer({
        getVideoElement,
        notify,
        shouldRemember: () => settings.rememberPlaybackSpeed,
    });

    /** YouTube's, built in its block below: no other page has a video to take a checkpoint of. */
    let transcripts = null;
    let recorder = null;

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

    const markdown = Markdown.createMarkdown({ site, pageInfo: PageInfo });

    // ------------------------------------------------------------- skim

    /**
     * One round trip to the worker, as a promise. Skim asks for tabs,
     * history and the actions it cannot run itself; a worker that has been
     * torn down by an extension reload answers nothing rather than throwing
     * into the page.
     */
    function askWorker(message) {
        return new Promise((done) => {
            try {
                chrome.runtime.sendMessage(message, (answer) => {
                    void chrome.runtime.lastError;
                    done(answer || null);
                });
            } catch (_) {
                done(null);
            }
        });
    }

    const skim = SkimContent.createSkim({
        notify,
        appearance: () => Theme.appearance(),
        ask: askWorker,
    });

    const hints = LinkHints.createLinkHints({
        openLink: (url) => askWorker({ action: 'skimOpenLink', url }),
    });

    /** Labels go up in the skin that is on, which may have changed since. */
    async function openHints() {
        hints.dress(await Theme.appearance());
        hints.start();
    }

    // --------------------------------------------------------- keyboard

    Shortcuts.install({
        hasVideo: () => !!getVideoElement(),
        skip: (seconds) => player.skip(seconds),
        faster: () => player.faster(),
        slower: () => player.slower(),
        resetSpeed: () => player.resetSpeed(),
        boostSpeed: (seconds) => player.boostSpeed(seconds),
        startRecording: () => recorder && recorder.startRecording(),
        stopRecording: () => recorder && recorder.stopRecording(),
        toggleSegment: () => recorder && recorder.toggleSegment(),
        toggleReader: () => reader && reader.toggle(),
        onShorts: () => site === 'youtube' && Site.isShortsPath(),
        shortsSkip: (direction) => skipShort(direction),
        openSkim: (source) => skim.show(source),
        openHints,
        // Two sites draw a pouch, and the shortcut opens whichever one this
        // page has. Resolved on each press rather than bound once: both are
        // built further down this file, after the keyboard is installed.
        openPouch: () => pouchUi() && pouchUi().openPouch(),
        canOpenPouch: () => !!pouchUi(),
        featureOn: (key) => settings[key] === true,
    }, {
        canRecord: () => !!getVideo(),
        getShortcut: (id) => Keybindings.resolve(settings.shortcuts, id),
        paused: () => skim.isOpen() || hints.isOn(),
    });

    /**
     * Skip within the short on screen. Not through `player`: its locator
     * memoises one element, and on Shorts the element changes with every
     * swipe, so the short playing is found afresh on each press.
     */
    function skipShort(direction) {
        const video = Site.activeShortsVideo();
        if (!video) return;
        const step = Math.max(1, Math.min(30, Math.round(Number(settings.shortsSeekSeconds)) || 5));
        video.currentTime = Site.shortsSeekTo(video.currentTime, direction * step, video.duration);
        notify(`${direction > 0 ? '+' : '−'}${step}s`, 'info', 900);
    }

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

            case 'openReader':
                sendResponse({ ok: !!reader && reader.open() });
                break;

            case 'copyMarkdownLink':
                markdown.copy(markdown.buildPageMarkdown()).then((ok) => {
                    if (ok) notify('Copied page as Markdown link', 'success');
                });
                sendResponse({ ok: true });
                break;

            // The worker's alarm: a scheduled prompt for a chat this tab is
            // on has come due. The page would find it on its next look
            // anyway; this is so it does not wait for one.
            case 'promptQueueWake':
                if (chatUi) chatUi.wakeQueue();
                sendResponse({ ok: !!chatUi });
                break;

            case 'downloadInfo':
                sendResponse(downloader ? downloader.info() : { ok: false });
                break;

            // Answered at once: the download goes on in this tab long after
            // the popup that asked for it has closed.
            case 'downloadVideo':
                if (downloader) downloader.start();
                sendResponse({ ok: !!downloader });
                break;

            case 'downloadCancel':
                if (downloader) downloader.cancel();
                sendResponse({ ok: !!downloader });
                break;

            // The worker, when the browser has finished saving a file this
            // tab handed it: the file's blob can go now.
            case 'downloadSaved':
                saver.ended(message);
                sendResponse({ ok: true });
                break;

            // The popup's Roster panel, asking this tab to read its list or
            // to carry a job on. Answered at once, like the download: the
            // work goes on here after the popup has closed.
            case 'rosterStart':
                sendResponse(roster ? roster.start(message) : { ok: false });
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
    let twitterUi = null;
    let twitterAds = null;
    let leetUi = null;
    let typerUi = null;
    let chatUi = null;
    /** Reading and applying a roster, on x.com and reddit.com. */
    let roster = null;
    /** The YouTube reader; built on YouTube only, and opened on demand. */
    let reader = null;
    /** Saving the video on the page as an .mp4, on a site with an adapter for it. */
    let downloader = null;
    /** Where it is saved, as Settings › YouTube asks, for YouTube and Vimeo alike. */
    const saver = BB.FileSaver ? BB.FileSaver.createSaver({
        options: () => ({ ask: settings.downloadAskWhere === true, folder: settings.downloadFolder || '' }),
        send: askWorker,
    }) : { ended: () => {} };

    /**
     * Whichever site's pouch surface this page has, or null for the rest. On
     * a chat site the "pouch" is the chat panel: Shift+P is the one key that
     * opens what Bell Bearer draws on a site, whatever that site's is.
     */
    function pouchUi() {
        return youtubeUi || twitterUi || leetUi || chatUi;
    }

    if (site === 'youtube') {
        const { YouTubeUi, Reader, Checkpoints, Transcripts } = BB;
        const watcher = DomWatch.createWatcher();

        transcripts = Transcripts.createTranscripts({
            getPreferredLanguage: () => settings.preferredSubtitleLanguage,
            notify,
        });
        recorder = Checkpoints.createRecorder({ player, notify, getVideo, transcripts });

        youtubeUi = YouTubeUi.createYouTubeUi({
            watcher,
            notify,
            getPouchButtonStyle: () => settings.pouchButtonStyle,
        });
        youtubeUi.install();

        Theme.installYouTubeSync(() => settings.syncThemeWithYouTube);

        reader = Reader.createReader({
            player, watcher, getVideo, getSettings: () => settings, transcripts,
            copyText: (text) => markdown.copy(text),
        });

        downloader = BB.VideoDownload.createDownloader({
            adapter: BB.YoutubeDownload.adapter, notify,
            // The player locator keeps one element, and Shorts swaps it on every swipe.
            getVideoElement: () => (Site.isShortsPath() ? Site.activeShortsVideo() : getVideoElement()),
            getVideoId: () => PageInfo.getVideoId(),
            enabled: () => settings.youtubeDownload === true,
            save: saver.save,
        });

        // YouTube is a single-page app: it fires yt-navigate-finish instead of
        // reloading. `loadstart` is the belt-and-braces path for the cases where
        // the player swaps its source without a navigation event.
        //
        // Only a navigation, or a loadstart on a URL we have not seen, re-arms
        // the page's injections. Every hover preview on the home grid is a
        // <video> firing loadstart, and each one used to re-arm the playlist
        // button for its twenty settling passes and re-read the pouch.
        let lastVideoId = null;
        let lastHref = null;
        const onPageChange = (event) => {
            if (event && event.type === 'loadstart' && location.href === lastHref) return;
            lastHref = location.href;
            youtubeUi.onNavigate();
            const id = PageInfo.getVideoId();
            reader.onNavigate(id);
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

    // ------------------------------------------------------- Vimeo extras

    // Not behind a switch, as YouTube's is: on Vimeo the popup's Download
    // is the only thing Bell Bearer adds, and it does nothing until clicked.
    if (site === 'vimeo') {
        downloader = BB.VideoDownload.createDownloader({ adapter: BB.VimeoDownload.adapter, notify, getVideoElement, save: saver.save });
    }

    // ------------------------------------------------------------ X extras

    if (site === 'twitter') {
        const { TwitterUi, TwitterAds } = BB;
        const watcher = DomWatch.createWatcher();

        twitterUi = TwitterUi.createTwitterUi({ watcher, notify, getSettings: () => settings });
        twitterUi.install();

        twitterAds = TwitterAds.createTwitterAds({
            watcher,
            isEnabled: () => settings.twitterHideAds === true,
        });
        twitterAds.install();

        // X is a single-page app and announces nothing — there is no
        // equivalent of YouTube's yt-navigate-finish, and patching pushState
        // would mean reaching into the page's own world. So the URL is
        // watched instead of listened for, and on the shared observer rather
        // than a timer of its own: a navigation always rebuilds the timeline,
        // so the mutation that tells us the page changed has already fired by
        // the time the path differs.
        let lastPath = location.pathname;
        watcher.add('x-route', () => {
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                twitterUi.onNavigate();
                twitterAds.sync();
            }
            return false;
        });
        window.addEventListener('popstate', () => watcher.schedule());
    }

    // ----------------------------------------------------- LeetCode extras

    if (site === 'leetcode') {
        const watcher = DomWatch.createWatcher();

        leetUi = BB.LeetUi.createLeetUi({ watcher, notify, getSettings: () => settings });
        leetUi.install();

        // Same treatment as X, and for the same reasons: LeetCode is a
        // single-page app with no navigation event of its own, and patching
        // pushState would mean reaching into the page's world. Switching
        // between the description, the editor and the solutions pane all
        // change the path, and every one of them rebuilds enough of the DOM
        // that the observer has already fired by the time the path differs.
        let lastPath = location.pathname;
        watcher.add('leet-route', () => {
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                leetUi.onNavigate();
            }
            return false;
        });
        window.addEventListener('popstate', () => watcher.schedule());
    }

    // ---------------------------------------------------- TypeRacer extras

    if (site === 'typeracer') {
        const watcher = DomWatch.createWatcher();

        typerUi = BB.TyperUi.createTyperUi({ watcher, notify, getSettings: () => settings });
        typerUi.install();

        // The same treatment as X and LeetCode: a single-page app with no
        // navigation event of its own. Every move between the pit and a
        // finished race rebuilds the panel, so the observer has already fired
        // by the time the path differs.
        let lastPath = location.pathname;
        watcher.add('typer-route', () => {
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                typerUi.onNavigate();
            }
            return false;
        });
        window.addEventListener('popstate', () => watcher.schedule());
    }

    // ------------------------------------------------------- chat sites

    /**
     * The site's adapter — everything about its markup and its API — by id.
     * The chat core never names a site, so a second chat site is one line
     * here and one entry in src/shared/chat-sites.js.
     */
    const CHAT_ADAPTERS = { chatgpt: () => BB.ChatgptRead.adapter, claude: () => BB.ClaudeRead.adapter };

    if (BB.ChatSites && BB.ChatSites.get(site) && CHAT_ADAPTERS[site]) {
        const watcher = DomWatch.createWatcher();

        chatUi = BB.ChatUi.createChatUi({
            adapter: CHAT_ADAPTERS[site](), watcher, notify, getSettings: () => settings,
            copyText: (text) => markdown.copy(text),
        });
        chatUi.install();

        // The X treatment again: a single-page app with no navigation event
        // of its own. Opening a chat rebuilds the thread, so the observer has
        // fired by the time the path differs.
        let lastPath = location.pathname;
        watcher.add('chat-route', () => {
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                chatUi.onNavigate();
            }
            return false;
        });
        window.addEventListener('popstate', () => watcher.schedule());
    }

    // ------------------------------------------------------- git forges

    /**
     * The forge's adapter by id, as the chat sites have theirs: the CI watch
     * never names a forge, so the next one is one line here and one entry in
     * src/shared/forge-sites.js.
     */
    const FORGE_ADAPTERS = {
        github: () => BB.GithubRead.adapter,
        gitlab: () => BB.GitlabRead.adapter,
        forgejo: () => BB.ForgejoRead.adapter,
    };
    let forgeUi = null;
    /** The Download folder button, on a forge whose adapter reads folders. */
    let folderUi = null;

    if (BB.ForgeSites && BB.ForgeSites.get(site) && FORGE_ADAPTERS[site]) {
        const watcher = DomWatch.createWatcher();
        const adapter = FORGE_ADAPTERS[site]();

        forgeUi = BB.CiWatchContent.createCiWatch({
            adapter, watcher, notify, getSettings: () => settings, ask: askWorker,
        });
        forgeUi.install();
        if (adapter.folder) {
            folderUi = BB.FolderDownload.createFolderDownload({ adapter, watcher, notify, getSettings: () => settings });
            folderUi.install();
        }

        // The X treatment once more: every forge moves between a run and its
        // jobs, or a pull request's tabs, without loading a page, and none
        // announces it in a way the isolated world can hear.
        let lastPath = location.pathname;
        watcher.add('forge-route', () => {
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                forgeUi.onNavigate();
                if (folderUi) folderUi.onNavigate();
            }
            return false;
        });
        window.addEventListener('popstate', () => watcher.schedule());
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

        document.addEventListener('timeupdate', (event) => {
            const id = PageInfo.getVideoId();
            if (!id || id === marked) return;

            // The element the event came from, rather than asking the locator
            // which video to look at. timeupdate fires about four times a
            // second, and the locator's first move is to check that its
            // memoised element still has a box — a bounding-rect read, which
            // forces the browser to flush layout. Four forced layouts a
            // second, for the whole first minute of every video, bought
            // nothing: the event already says which element is playing.
            const video = event.target;
            if (!video || video.tagName !== 'VIDEO') return;

            const enough = Number.isFinite(video.duration) && video.duration > 0
                ? Math.min(WATCHED_AFTER_S, video.duration * 0.25)
                : WATCHED_AFTER_S;
            if (video.currentTime < enough) return;

            // Only once the threshold is reached is it worth asking whether
            // this is the player at all. It usually is — but a hover preview
            // is also a <video> firing timeupdate, and a short one looping
            // past a quarter of its length would otherwise mark a video as
            // watched that nobody opened. One layout read per video, at the
            // moment it matters, instead of two hundred and forty.
            if (video !== getVideoElement()) return;

            marked = id;
            BB.Watched.mark(id);
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
                const { channels } = await BB.Subscriptions.load();
                if (channels.length) await BB.Feed.warm(channels);
            } catch (_) { /* nothing is on screen to report this to */ }
        };

        if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 10000 });
        else setTimeout(warm, 5000);
    }

    // --------------------------------------------- chess.com / Lichess extras

    let chess = null;
    let chessLimits = null;

    if (BB.ChessSites && BB.ChessSites.get(site)) {
        chess = BB.ChessContent.createChess({
            site,
            Keybindings,
            Shortcuts,
            notify,
            getShortcut: (id) => Keybindings.resolve(settings.shortcuts, id),
            getSettings: () => settings,
        });
        chess.install();

        installChessLimits();
    }

    /**
     * Grey out what would start a game once the day's allowance for that time
     * control is gone.
     *
     * The tally is read from storage rather than counted here, because the
     * worker fills it from the site's own API — see
     * src/background/chess-limits.js. Landing on a chess page is also the cue
     * to ask for a fresh read: the counts may have been left by a session that
     * ended hours ago, and a stale tally either blocks a game that is allowed
     * or lets one through that is not.
     */
    function installChessLimits() {
        const { ChessLimits, ChessLimitsContent } = BB;
        let limitState = ChessLimits.blank();

        chessLimits = ChessLimitsContent.createChessLimits({
            site,
            notify,
            getSettings: () => settings,
            getStatus: () => ChessLimits.statusFor(limitState, settings, site),
            getCurrentClass: () => chess.currentClass(),
        });

        const reload = () => ChessLimits.load().then((state) => {
            limitState = state;
            chessLimits.sync();
        });

        reload();
        Settings.watch([ChessLimits.KEY], reload);

        try {
            chrome.runtime.sendMessage({ action: 'chessLimitsRefresh' }, () => {
                // The worker writes what it read, and the watch above picks it
                // up; a worker that is not listening is not an error here.
                void chrome.runtime.lastError;
            });
        } catch (_) { /* the extension reloaded out from under this page */ }
    }

    // ---------------------------------------------------- daily time limit

    /**
     * Every page builds one of these, because any host can be in the limit
     * list now. For a host with no row in it, which is nearly every host, it
     * costs two reads at load and a storage watch — no timer, no writes.
     *
     * The reference is kept. It used to be dropped on the floor here, and the
     * limit was never enforced on a page that was loaded with one already set:
     * install() reads the settings mirror, the mirror is still the schema's
     * defaults when this line runs, and the storage watcher inside only fires
     * on a *change* — so the initial Settings.get() below told it nothing and
     * nothing ever counted a second. It reads its own store now rather than the
     * mirror, which closes that hole at the source, and applySettings syncs it
     * anyway so a page open across a settings change behaves.
     */
    const timeLimit = TimeLimitContent.createTimeLimit({
        site,
        appearance: () => Theme.appearance(),
    });
    timeLimit.install();

    // ------------------------------------------------------------- rosters

    /**
     * Reading your own list off x.com or reddit.com, and working through one to
     * follow or join what is in it.
     *
     * Asked for from the popup (the rosterStart message above), carried out
     * here, and picked up again by the job's next page — which is what makes
     * it survive the navigation between one name and the next. Nothing
     * happens unless there is a job in storage for this site, so on an
     * ordinary visit this is one storage read.
     */
    if (site === 'twitter' || site === 'reddit') {
        roster = BB.RosterContent.createRoster({
            site,
            notify,
            appearance: () => Theme.appearance(),
            dress: Theme.dress,
            // A job belongs to a tab, and only the worker can say which this is.
            tabId: async () => {
                const answer = await askWorker({ action: 'rosterTab' });
                return answer && Number.isInteger(answer.tabId) ? answer.tabId : null;
            },
        });
        roster.install();
    }

    // ------------------------------------------------------ cookie banners

    CookieBanner.createCookieBanner({
        CookieSites,
        notify,
        showAccept: () => settings.cookieAcceptButton,
        showReject: () => settings.cookieRejectButton,
        chipsOn: async () => {
            const chips = await Settings.get(['cookieAcceptButton', 'cookieRejectButton']);
            return !!(chips.cookieAcceptButton || chips.cookieRejectButton);
        },
    }).install();

    // --------------------------------------------------------- settings

    /** What Bell Bearer puts into x.com's own chrome, each switchable. */
    const X_SURFACES = ['twitterPouchPosts', 'twitterPouchPeople', 'twitterHideBookmark'];

    /** And the same for LeetCode's. */
    const LEET_SURFACES = ['leetNoteButton', 'leetMockMode', 'leetMockMinutes', 'leetGradePrompt'];

    /** And TypeRacer's. */
    // 'shortcuts' is in here because the caret hotkey is resolved once and
    // cached — see applyHotkey in typeracer-ui.js — so a rebind has to reach
    // the page rather than waiting for the next load.
    const TYPER_SURFACES = ['typerTrack', 'typerCaret', 'typerCaretSmooth', 'typerCaretBlink',
        'typerSound', 'typerSoundVoice', 'typerSoundVolume', 'typerErrorSound', 'shortcuts'];

    /**
     * And a chat site's: the composer buttons and the limit chip, for every
     * chat site — and 'shortcuts', since the chat hotkeys are resolved per
     * keystroke but a rebind should still reach an open page.
     */
    const CHAT_SURFACES = chatUi ? [
        ...BB.ChatSites.list().flatMap((one) => ['composerTools', 'limitSuggest'].map((kind) => BB.ChatSites.siteKey(one.id, kind))),
        'shortcuts',
    ] : [];

    /** And a forge's Watch and Download folder buttons, on their switches. */
    const FORGE_SURFACES = forgeUi ? BB.ForgeSites.allKeys() : [];

    /** And what an open YouTube reader has to follow without being closed. */
    const READER_SURFACES = ['readerFontSize', 'readerLineHeight', 'readerLineWidth', 'readerHideChrome', 'skin'];

    function applySettings(values) {
        const pouchStyleChanged = 'pouchButtonStyle' in values &&
            values.pouchButtonStyle !== settings.pouchButtonStyle;
        const hideAdsChanged = 'twitterHideAds' in values &&
            values.twitterHideAds !== settings.twitterHideAds;
        const xSurfacesChanged = X_SURFACES.some((key) =>
            key in values && values[key] !== settings[key]);
        const leetSurfacesChanged = LEET_SURFACES.some((key) =>
            key in values && values[key] !== settings[key]);
        const typerSurfacesChanged = TYPER_SURFACES.some((key) =>
            key in values && values[key] !== settings[key]);
        const readerSurfacesChanged = READER_SURFACES.some((key) =>
            key in values && values[key] !== settings[key]);
        const chatSurfacesChanged = CHAT_SURFACES.some((key) =>
            key in values && values[key] !== settings[key]);
        const forgeSurfacesChanged = FORGE_SURFACES.some((key) =>
            key in values && values[key] !== settings[key]);

        Object.assign(settings, values);

        if (pouchStyleChanged && youtubeUi) youtubeUi.refreshPouchButton();
        // Both directions matter here: turning it off has to put the hidden
        // posts back on the page that is already open, or the switch looks
        // like it did nothing until the next reload.
        if (hideAdsChanged && twitterAds) twitterAds.sync();
        // And the same for the three X surfaces, for the same reason.
        if (xSurfacesChanged && twitterUi) twitterUi.refreshSurfaces();
        // And the same again for LeetCode's, which additionally has to undo
        // mock mode on the page that is already open.
        if (leetSurfacesChanged && leetUi) leetUi.refreshSurfaces();
        // And again for TypeRacer's, which has to stop measuring the race
        // already in progress rather than waiting for the next page.
        if (typerSurfacesChanged && typerUi) typerUi.refreshSurfaces();
        if (readerSurfacesChanged && reader) reader.refresh();
        if (chatSurfacesChanged && chatUi) chatUi.refreshSurfaces();
        if (forgeSurfacesChanged && forgeUi) forgeUi.refreshSurfaces();
        if (forgeSurfacesChanged && folderUi) folderUi.refreshSurfaces();
        if (chess) chess.sync();
        if (chessLimits) chessLimits.sync();
        if (timeLimit) timeLimit.sync();
    }

    Settings.get().then(applySettings);
    Settings.watch(null, applySettings);

    // The watch party takes the player off this (party-media.js boot()), and
    // it is handy from the page console. recorder and transcripts are null
    // anywhere but YouTube.
    root.__bellBearer = { player, recorder, transcripts, settings, Speed };
})(typeof globalThis !== 'undefined' ? globalThis : this);
