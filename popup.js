/**
 * The toolbar popup: recent checkpoints, and an optional speed bar.
 *
 * Modals, toasts, theme and tab control live in the shared modules; this file
 * is the popup's own wiring and rendering only. Import, export and "clear all"
 * belong to the dashboard now, so the popup header is Dashboard alone.
 *
 * Layout note: the popup is fluid between 340 and 800px, and which end of that
 * range it asks for is the `popupWidth` setting — src/page/popup-width.js puts
 * the answer on <html> before this file runs. Under 560px it is a single column
 * and selecting a video replaces the list with the detail pane (`.is-detail` on
 * .main-content, unwound by the back button); at 560px and up both panes are on
 * screen and the class is inert.
 */
(function () {
    'use strict';

    const { Bookmarks, Settings, Speed, Time, Dom, Ui, TabActions, Skin, Site,
        ChessSites, ChessStats, ChessLimitButton, Leet, LeetPopup } = window.BB;

    class Popup {
        constructor() {
            this.videos = [];
            this.selectedVideoId = null;
            this.showSpeedBar = false;
            this.speedTab = null;
            this.site = 'other';
            this.isWebPage = false;
            /** The LeetCode problem in the active tab, if it is one. */
            this.leetSlug = '';
            this.leetTitle = '';
        }

        async init() {
            Ui.installTheme({});
            if (Skin) await Skin.install();
            this.wireControls();
            await this.applySiteLayout();

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

            on('dashboardBtn', 'click', () => openDashboard(ChessSites.get(this.site) ? `#site/${this.site}` : ''));
            on('openReaderBtn', 'click', () => this.openReader());
            on('downloadBtn', 'click', () => this.toggleDownload());
            on('partyStartBtn', 'click', () => this.openParty('start'));
            on('partyJoinBtn', 'click', () => this.openParty('join'));

            // The daily-limit override. It draws itself or stays hidden, and
            // is not a chess-panel control: the limit can bite while you are
            // on any page, and this is the one place to lift it.
            ChessLimitButton.mount(document.getElementById('limitOverrideBtn')).refresh();

            // Delegation: the list is re-rendered wholesale, so per-row
            // listeners would have to be re-attached (and were leaking).
            const list = document.getElementById('videoList');
            list.addEventListener('click', (event) => {
                const item = event.target.closest('.video-item');
                if (item) this.selectVideo(item.dataset.videoId);
            });
            list.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                const item = event.target.closest('.video-item');
                if (!item) return;
                event.preventDefault();
                this.selectVideo(item.dataset.videoId);
            });

            const details = document.getElementById('bookmarkDetails');
            details.addEventListener('click', (event) => {
                if (event.target.closest('.bd-back')) {
                    this.closeDetail();
                    return;
                }

                const button = event.target.closest('button');
                if (!button) return;
                const item = button.closest('.bookmark-item');
                if (!item) return;

                if (button.classList.contains('seek-btn')) {
                    this.seek(item.dataset.videoId, Number(button.dataset.time));
                } else if (button.classList.contains('delete-btn')) {
                    this.deleteBookmark(item.dataset.videoId, item.dataset.key);
                }
            });

            // Escape backs out of the detail pane before it closes the popup.
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && this.selectedVideoId) {
                    event.preventDefault();
                    this.closeDetail();
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

        /**
         * The popup is a different tool per site: on YouTube it is the
         * checkpoint list this file was written for, on chess.com the
         * player's games, and anywhere else just the header. Decided once,
         * up front, off the one thing that tells them apart — the site.
         *
         * The speed bar is not part of this split: src/page/tab-actions.js
         * already drives it through a generic "find a <video> on this page"
         * fallback when the content script has no site-specific reader for
         * it, so it is offered on both panels precisely because it is not
         * site-specific.
         */
        async applySiteLayout() {
            try {
                const tab = await TabActions.activeTab();
                const url = tab && tab.url ? new URL(tab.url) : null;
                // The speed bar only makes sense where a <video> could live —
                // an ordinary web page. On the dashboard, on chrome:// /
                // about: pages, and on the extension's own pages there is no
                // video (and no content script), so the popup is the header
                // alone: just "Dashboard", no playback controls.
                this.isWebPage = !!url && (url.protocol === 'http:' || url.protocol === 'https:');
                this.site = url && Site ? Site.detectSite(url.hostname) : 'other';

                // Read straight off the tab rather than asked of the content
                // script. The popup must be able to say "add this one" even on
                // a page where the content script never loaded — which is
                // exactly the case someone is most likely to be looking at the
                // popup to find out about.
                const match = url && /^\/problems\/([A-Za-z0-9-]+)(?:[/?#]|$)/.exec(url.pathname);
                this.leetSlug = (this.site === 'leetcode' && match) ? match[1] : '';
                // LeetCode titles its tabs "Two Sum - LeetCode".
                this.leetTitle = String((tab && tab.title) || '')
                    .replace(/\s*[-–|]\s*LeetCode.*$/i, '')
                    .replace(/^\d+\.\s*/, '')
                    .trim();
            } catch (_) {
                this.isWebPage = false;
                this.leetSlug = '';
                this.site = 'other';
            }
            document.body.dataset.bbSite = this.site;

            document.getElementById('youtubePanel').hidden = this.site !== 'youtube';
            if (this.site === 'youtube') {
                this.setupReaderBar();
                this.setupDownloadBar();
            }
            // The party plays on YouTube and Netflix. On Netflix its bar is
            // the popup's only content, so it moves out of the YouTube panel.
            const partyBar = document.getElementById('partyBar');
            partyBar.hidden = this.site !== 'youtube' && this.site !== 'netflix';
            if (this.site === 'netflix') {
                const netflix = document.getElementById('netflixPanel');
                netflix.appendChild(partyBar);
                netflix.hidden = false;
            }
            // The download bar's other home: on Vimeo it is the popup.
            if (this.site === 'vimeo') {
                const vimeo = document.getElementById('vimeoPanel');
                vimeo.appendChild(document.getElementById('downloadBar'));
                vimeo.hidden = false;
                this.setupDownloadBar();
            }
            this.resumeParty();
            const chessSite = ChessSites.get(this.site);
            document.getElementById('chessPanel').hidden = !chessSite;

            if (chessSite) {
                ChessStats.createView({
                    site: chessSite.id,
                    body: document.getElementById('chessPopupBody'),
                    compact: true,
                    onSetUsername: () => openDashboard(`#settings/${chessSite.id}`),
                }).render();
            }

            const leetPanel = document.getElementById('leetPanel');
            if (leetPanel) leetPanel.hidden = this.site !== 'leetcode';
            if (this.site === 'leetcode' && LeetPopup) {
                const view = LeetPopup.createView({
                    body: document.getElementById('leetPopupBody'),
                    currentSlug: () => this.leetSlug,
                    currentTitle: () => this.leetTitle,
                    onOpen: (url) => openTab(url),
                    onDashboard: () => openDashboard('#site/leetcode'),
                });
                view.render();
                // The queue changes from the page itself — a verdict lands, a
                // grade is picked — and the popup is a separate document, so
                // without this it shows a list that is already out of date.
                Settings.watch(Leet.KEYS, () => view.render());
            }
        }

        // ----------------------------------------------------- reader bar

        /**
         * The reader needs a video to read, so the button is only live on a
         * watch page — and says why when it is not, rather than sitting there
         * greyed out with no explanation.
         */
        async setupReaderBar() {
            const button = document.getElementById('openReaderBtn');
            const note = document.getElementById('readerBarNote');
            const tab = await TabActions.activeTab();
            let onVideo = false;
            try {
                onVideo = !!window.BB.YouTube.extractVideoId(tab.url) && /^\/(watch|live)\b/.test(new URL(tab.url).pathname);
            } catch (_) { /* no tab, or not a URL */ }
            button.disabled = !onVideo;
            note.textContent = onVideo
                ? 'The player, its transcript and your notes, side by side'
                : 'Open a video to read it beside its transcript';
        }

        async openReader() {
            const note = document.getElementById('readerBarNote');
            const tab = await TabActions.activeTab();
            if (await TabActions.openReader(tab)) {
                window.close();
                return;
            }
            // A tab opened before the extension was installed or reloaded
            // has no content script to answer.
            note.textContent = 'Reload the YouTube tab first — Bell Bearer is not running in it yet';
        }

        // -------------------------------------------------------- download

        /**
         * Download, on a page whose video can be saved — on YouTube once
         * Settings › YouTube has asked for it. The button names the quality
         * the player is on, as the tab reads it, which is what it will save.
         * The work is the tab's: this only starts it, follows it and stops it.
         */
        async setupDownloadBar() {
            if (this.site === 'youtube' && !(await Settings.get(['youtubeDownload'])).youtubeDownload) return;
            this.downloadTab = await TabActions.activeTab();
            const info = await TabActions.downloadInfo(this.downloadTab);
            if (info && !info.ok) return;
            document.getElementById('downloadBar').hidden = false;
            this.showDownload(info);
            // While it runs, the percentage follows it.
            this.downloadTimer = setInterval(async () => {
                if (this.downloadBusy) this.showDownload(await TabActions.downloadInfo(this.downloadTab));
            }, 1000);
        }

        showDownload(info) {
            const button = document.getElementById('downloadBtn');
            const note = document.getElementById('downloadNote');
            // A tab opened before the extension was installed or reloaded has
            // no content script to answer.
            button.disabled = !info;
            this.downloadBusy = !!(info && info.busy);
            button.textContent = !info ? 'Download' : info.busy ? 'Cancel' : `Download${info.label ? ` ${info.label}` : ''}`;
            note.textContent = !info ? 'Reload the tab first — Bell Bearer is not running in it yet'
                : info.busy ? `Saving — ${info.percent}%. It carries on in the tab if this closes.`
                    : 'Picture and sound in one .mp4, at the quality the player is on';
        }

        async toggleDownload() {
            const info = await TabActions.downloadInfo(this.downloadTab);
            if (!info || !info.ok) return;
            if (info.busy) await TabActions.cancelDownload(this.downloadTab);
            else await TabActions.startDownload(this.downloadTab);
            this.showDownload({ ...info, busy: !info.busy, percent: 0 });
        }

        // ----------------------------------------------------- watch party

        /**
         * A party on, or one that just ended, is what the popup opens on.
         * Asked of storage rather than of the worker, so a popup with no
         * party in sight loads none of the party's code.
         */
        async resumeParty() {
            let found = {};
            try { found = await chrome.storage.session.get(['bbPartyTab', 'bbPartyEnded']); } catch (_) { /* no party to find */ }
            if (found.bbPartyTab || found.bbPartyEnded) this.openParty(null);
        }

        /** The party's views over the rest of the popup; `view` is what was asked for, null to land where the party is. */
        async openParty(view) {
            await loadParty();
            document.body.classList.add('is-party');
            if (!this.party) {
                this.party = window.BB.PartyPanel.createPanel({
                    body: document.getElementById('partyView'),
                    site: this.site,
                    openDashboard,
                    onClose: () => document.body.classList.remove('is-party'),
                });
            }
            await this.party.open(view);
        }

        // ------------------------------------------------------ speed bar

        async setupSpeedBar() {
            const bar = document.getElementById('speedControlBar');
            if (!bar) return;

            if (!this.showSpeedBar || !this.isWebPage) {
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
            const main = document.getElementById('mainContent');
            if (main) main.classList.add('is-detail');
        }

        closeDetail() {
            const main = document.getElementById('mainContent');
            if (main) main.classList.remove('is-detail');
            this.selectedVideoId = null;
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

        /**
         * By key, against what is stored now. It used to drop an index from
         * the list the popup loaded and save that whole list back, which
         * erased a checkpoint saved from a YouTube tab in the meantime — and
         * the index could by then point at a different checkpoint.
         */
        async deleteBookmark(videoId, key) {
            this.videos = await Bookmarks.update((videos) => Bookmarks.removeBookmarkById(videos, videoId, key));
            if (!this.videos.some((video) => video.id === this.selectedVideoId)) {
                this.selectedVideoId = null;
            }
            this.render();
        }

        // ------------------------------------------------------ rendering

        render() {
            this.renderCount();
            this.renderVideoList();
            this.renderDetails();
        }

        renderCount() {
            const label = document.getElementById('brandCount');
            if (!label) return;
            const total = this.videos.reduce((sum, video) => sum + video.bookmarks.length, 0);
            label.textContent = total ? `${total} checkpoint${total === 1 ? '' : 's'}` : '';
        }

        /**
         * The list, most recently checkpointed first.
         *
         * The store is in append order, so rendering it as it comes put the
         * first video ever saved at the top and pushed the one just
         * checkpointed to the bottom of a scroll — in a popup that exists to
         * get you back to where you were a minute ago.
         */
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

            list.innerHTML = Bookmarks.sortVideos(this.videos, 'recent').map((video) => {
                const count = video.bookmarks.length;
                return `
                    <div class="video-item${video.id === this.selectedVideoId ? ' selected' : ''}"
                         data-video-id="${Dom.escapeAttr(video.id)}" role="button" tabindex="0">
                        <div class="video-title">${Dom.escapeHtml(video.title)}</div>
                        <div class="video-meta">
                            <span class="bookmark-count">${count}</span>
                            <span class="video-channel">checkpoint${count === 1 ? '' : 's'}</span>
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
                        <div class="empty-icon">⏱</div>
                        <p>Select a video to see its checkpoints</p>
                    </div>`;
                return;
            }

            const count = video.bookmarks.length;
            details.innerHTML = `
                <div class="bd-header">
                    <button class="bd-back" type="button" aria-label="Back to videos">‹</button>
                    <div class="bd-heading">
                        <h3>${Dom.escapeHtml(video.title)}</h3>
                        <div class="bd-sub">${count} checkpoint${count === 1 ? '' : 's'}</div>
                    </div>
                    <span class="bd-count">${count}</span>
                </div>
                <div class="checkpoint-timeline">
                    ${video.bookmarks.map((bookmark) => renderBookmark(video, bookmark)).join('')}
                </div>`;
        }
    }

    /** The party's styles and scripts, in order, the first time they are wanted. */
    const PARTY_FILES = ['src/shared/party-code.js', 'src/page/party-panel.js', 'src/page/party-start-view.js',
        'src/page/party-join-view.js', 'src/page/party-room-view.js', 'src/page/party-invite-view.js'];
    let partyLoading = null;
    function loadParty() {
        partyLoading = partyLoading || (async () => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'party.css';
            document.head.appendChild(link);
            for (const src of PARTY_FILES) {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = src;
                    script.onload = resolve;
                    script.onerror = () => reject(new Error(`${src} did not load`));
                    document.body.appendChild(script);
                });
            }
        })();
        return partyLoading;
    }

    function openDashboard(hash) {
        chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${hash || ''}`) });
        window.close();
    }

    /**
     * Open a problem in the tab that is already there rather than a new one:
     * picking the next thing to work on replaces what you were looking at.
     * Only ever an https URL built from a slug, but checked anyway, since
     * what is stored came off a page.
     */
    function openTab(url) {
        if (!/^https:\/\/([a-z0-9-]+\.)*leetcode\.com\//i.test(String(url || ''))) return;
        chrome.tabs.update({ url });
        window.close();
    }

    function renderBookmark(video, bookmark) {
        const isSpan = typeof bookmark.start === 'number' && typeof bookmark.end === 'number';
        const time = Bookmarks.bookmarkTime(bookmark);
        const label = isSpan
            ? `${Time.formatTime(bookmark.start)} – ${Time.formatTime(bookmark.end)}`
            : Time.formatTime(time);

        return `
            <div class="bookmark-item" data-key="${Dom.escapeAttr(Bookmarks.bookmarkKey(bookmark))}" data-video-id="${Dom.escapeAttr(video.id)}">
                <div class="bookmark-time">${label}</div>
                ${bookmark.title ? `<div class="bookmark-name">${Dom.escapeHtml(bookmark.title)}</div>` : ''}
                ${bookmark.note ? `<div class="bookmark-note">${Dom.escapeHtml(bookmark.note)}</div>` : ''}
                <div class="bookmark-actions">
                    <button class="btn-small seek-btn" data-time="${time}">Go to</button>
                    <button class="btn-small delete delete-btn">Delete</button>
                </div>
            </div>`;
    }

    new Popup().init().catch((error) => {
        console.error('Bell Bearer: popup failed to start', error);
    });
})();
