/**
 * The pouch sheet: a near-full-screen frosted panel over YouTube, the topic
 * rail on the left and a thumbnail grid on the right. Followed playlists get
 * their own rail entry, "Subscribed Playlist" — one card per playlist, its
 * newest video not yet watched — rather than a strip under the grid.
 *
 * It used to live inside youtube-ui.js. It is here on its own because it grew
 * three things that have nothing to do with injecting buttons into YouTube's
 * chrome: a progressive loader, a second source of channels, and its own idea
 * of what the user has already seen.
 *
 * How it loads is the part worth reading. Opening the sheet does not wait for
 * the network at all:
 *
 *   1. the frame it opens in, it draws whatever shared/feed.js already has
 *      cached — after the first run of the day that is usually everything;
 *   2. the fetch then runs with a bounded number of feeds in flight, and each
 *      channel that lands is folded in and the grid redrawn on a timer, so a
 *      pouch with two hundred channels fills in rather than blocking;
 *   3. nothing is refetched that is still inside the feed cache's TTL.
 *
 * Everything after that — picking a topic, narrowing the range, re-sorting —
 * is local. The earliest version refetched every channel on every topic click.
 *
 * All the markup interpolates data the user does not control (channel names
 * scraped from a page, titles and thumbnails from an RSS feed), so text goes
 * through escapeHtml and every URL through safeUrlAttr.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Icons = ns.Icons || req('../shared/icons.js');
    const Feed = ns.Feed || req('../shared/feed.js');
    const Playlists = ns.Playlists || req('../shared/playlists.js');
    const Settings = ns.Settings || req('../shared/settings.js');
    const Subscriptions = ns.Subscriptions || req('../shared/subscriptions.js');
    const Time = ns.Time || req('../shared/time.js');
    const Watched = ns.Watched || req('../shared/watched.js');
    const YtSubs = ns.YtSubs || req('../shared/yt-subs.js');
    const Overlay = ns.Overlay || req('./overlay.js');

    const OVERLAY_ID = 'bb-topics-overlay';

    /** How many uploads to pull per channel. The 90d range needs some depth. */
    const PER_CHANNEL = 15;

    /**
     * Subscribed-but-not-filed channels are shown one deep. The point of the
     * "All subscribed" toggle is breadth — everything you follow, newest first
     * — and fifteen uploads each from four hundred channels is six thousand
     * cards nobody scrolls.
     */
    const PER_SUBSCRIBED_CHANNEL = 3;

    /**
     * How far back into a playlist to look for its newest unwatched video.
     * One would do if nothing were ever watched out of order, but a viewer
     * who jumps around a playlist can leave its single newest entry watched
     * while older ones are not — this is the depth that "newest unwatched"
     * searches before giving up on a playlist.
     */
    const PLAYLIST_LATEST_DEPTH = 10;

    const RANGES = [
        { id: '7d', label: '7d', days: 7 },
        { id: '30d', label: '30d', days: 30 },
        { id: '90d', label: '90d', days: 90 },
        { id: 'all', label: 'All', days: null },
    ];
    const DEFAULT_RANGE = '30d';

    const SORTS = [
        { id: 'newest', label: 'Newest' },
        { id: 'oldest', label: 'Oldest' },
        { id: 'channel', label: 'Channel' },
    ];

    const ALL_TOPICS = '__all__';

    /**
     * The rail entry for followed playlists. It behaves like a topic (same
     * row template, same click handling) but its grid is not a slice of
     * `byChannel` — it is one card per followed playlist: that playlist's
     * newest video the user has not watched yet. See playlistLatestHtml().
     */
    const PLAYLISTS_VIEW = '__playlists__';

    /** Redraws while feeds are streaming in are coalesced onto this interval. */
    const REDRAW_MS = 220;

    /**
     * How many cards the grid draws before it offers the rest. With
     * Subscriptions on, All can run to thousands of cards — a few hundred
     * channels at three videos each — and every redraw while the feeds came
     * in rebuilt all of them, images and all, four times a second. A
     * screenful is a few dozen.
     */
    const CARDS_STEP = 120;

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    function createPouchSheet({ notify, dress, appearance, iconUrl }) {

        /**
         * Open the sheet now, load everything it needs behind it.
         *
         * The overlay used to wait on five storage reads — topics, channels,
         * the "all subscribed" setting, watched marks, followed playlists —
         * before the backdrop even appeared, so clicking the drawer entry did
         * nothing for a beat. None of that is needed to draw the frame: the
         * sheet opens on its "Loading…" shell immediately, off the same
         * `sheetHtml` markup and empty state Sheet already renders for a
         * channel-less pouch, and every read streams in behind it — skin
         * first (so the dress-up is never wrong for more than a frame), then
         * the rest as one batch that unlocks the rail and grid. The network
         * fetch inside loadEverything() was already this asynchronous; this
         * just extends the same idea one step earlier, to storage.
         */
        function open() {
            const dialog = Overlay.open({ id: OVERLAY_ID, contentHtml: sheetHtml(iconUrl()) });
            if (!dialog) return;

            dialog.element.classList.add('bb-sheet-overlay');
            // Theme is read synchronously off the page; only the skin needs
            // storage, so the shell dresses itself the instant that lands
            // rather than holding up the shell that has nothing to do with it.
            appearance().then((look) => { if (dialog.element.isConnected) dress(dialog.element, look); });

            const sheet = new Sheet({ dialog, notify });
            sheet.start();

            Promise.all([
                Subscriptions.load(),
                Settings.get(['pouchShowAllSubscribed']),
                Watched.load(),
                Playlists.load(),
            ]).then(([{ topics, channels }, settings, watched, playlists]) => {
                if (sheet.alive) sheet.hydrate({ topics, channels, settings, watched, playlists });
            });
        }

        return { open, PER_CHANNEL, ALL_TOPICS, RANGES, SORTS };
    }

    /**
     * One open sheet.
     *
     * Videos are held per channel rather than in one flat list, because a
     * channel's feed arriving twice (cached first, then fresh) has to replace
     * its own entries and not append to them.
     */
    class Sheet {
        /**
         * Built with nothing yet to show: `open()` constructs this the
         * instant the overlay exists, before any of topics, channels,
         * settings, watched marks or playlists have been read. `hydrate()`
         * is what turns it into the sheet described above — see there for
         * why the two are split.
         */
        constructor({ dialog, notify }) {
            this.dialog = dialog;
            this.notify = notify;

            this.topics = [];
            this.channels = [];
            this.watched = {};
            this.playlists = [];
            this.hydrated = false;

            /** channelId -> videos[]. */
            this.byChannel = new Map();
            /** channelId -> the channel record, pouch and subscribed alike. */
            this.known = new Map();

            this.subscribed = null;   // lazily fetched, then cached here
            this.loadingSubs = false;

            this.topicId = ALL_TOPICS;
            this.range = DEFAULT_RANGE;
            this.sort = 'newest';
            this.allSubscribed = false;

            this.loading = false;
            this.done = 0;
            this.total = 0;

            /** One entry per followed playlist: its newest unwatched video. */
            this.playlistLatest = [];
            this.playlistsRead = true;
            this.redrawTimer = null;
            /** How many cards the grid shows; back to CARDS_STEP whenever what it shows changes. */
            this.shown = CARDS_STEP;
            /** The grid's markup as last drawn, so a redraw that would change nothing is skipped. */
            this.drawnGrid = null;

            const $ = (selector) => dialog.element.querySelector(selector);
            this.el = {
                rail: $('.bb-topics'),
                grid: $('.bb-videos'),
                sub: $('.bb-sheet-sub'),
            };
        }

        get alive() {
            return this.dialog.element.isConnected;
        }

        /** Wires the shell and draws its "Loading…" state — nothing to fetch yet. */
        start() {
            this.wire();
            this.render();
        }

        /**
         * What `open()` was waiting on before the sheet ever appeared, now
         * arriving after it. One assignment, one render, one kick of the
         * network fetch — the exact sequence `start()` used to run inline.
         */
        hydrate({ topics, channels, settings, watched, playlists }) {
            this.topics = topics;
            this.channels = channels;
            this.watched = watched;
            this.playlists = playlists;
            this.known = new Map(channels.map((channel) => [channel.id, channel]));
            this.allSubscribed = !!settings.pouchShowAllSubscribed;

            this.loading = channels.length > 0;
            this.total = channels.length;
            this.playlistsRead = playlists.length === 0;
            this.hydrated = true;

            this.render();
            this.loadEverything();
        }

        // ------------------------------------------------------------ data

        /**
         * Draw from cache, then fetch. Both phases feed the same `absorb`, so
         * the grid never clears — it only gains and refreshes rows.
         */
        async loadEverything() {
            if (this.channels.length) {
                const cached = await Feed.peekLatestForChannels(this.channels, PER_CHANNEL);
                if (!this.alive) return;
                if (cached.length) {
                    this.absorbAll(cached);
                    this.render();
                }

                await Feed.fetchLatestForChannels(this.channels, PER_CHANNEL, {
                    onProgress: (videos, done, total) => {
                        if (!this.alive) return;
                        this.absorb(videos);
                        this.done = done;
                        this.total = total;
                        this.scheduleRender();
                    },
                });
                if (!this.alive) return;
            }

            this.loading = false;
            this.render();

            // The playlist rail entry and the subscription sweep are both
            // extras: they come after the pouch itself is on screen.
            this.loadPlaylistLatest();
            if (this.allSubscribed) this.loadSubscribed();
        }

        /** Replace one channel's contribution. */
        absorb(videos) {
            if (!videos || videos.length === 0) return;
            this.byChannel.set(videos[0].channelId, videos);
        }

        absorbAll(videos) {
            const grouped = new Map();
            for (const video of videos) {
                if (!grouped.has(video.channelId)) grouped.set(video.channelId, []);
                grouped.get(video.channelId).push(video);
            }
            for (const [channelId, list] of grouped) this.byChannel.set(channelId, list);
        }

        /**
         * Pull in every channel the account subscribes to.
         *
         * These are not filed under a topic and are never counted down the
         * rail — they widen "All" and nothing else. They come in shallow (see
         * PER_SUBSCRIBED_CHANNEL) and through the same bounded fetch as the
         * pouch, so turning the toggle on with six hundred subscriptions does
         * not lock the page up.
         */
        async loadSubscribed() {
            if (this.loadingSubs) return;
            this.loadingSubs = true;
            this.render();

            try {
                if (!this.subscribed) this.subscribed = await YtSubs.list();
                if (!this.alive) return;

                // A channel already in the pouch keeps its pouch record, so it
                // stays counted under its topic and is not fetched twice.
                const extra = this.subscribed.filter((channel) => !this.known.has(channel.id));
                extra.forEach((channel) => this.known.set(channel.id, channel));

                if (extra.length === 0) {
                    if (this.subscribed.length === 0) {
                        this.notify('Could not read your subscriptions — are you signed in?', 'warning');
                    }
                    return;
                }

                await Feed.fetchLatestForChannels(extra, PER_SUBSCRIBED_CHANNEL, {
                    onProgress: (videos) => {
                        if (!this.alive) return;
                        this.absorb(videos);
                        this.scheduleRender();
                    },
                });
            } finally {
                this.loadingSubs = false;
                if (this.alive) this.render();
            }
        }

        /**
         * One card per followed playlist: whichever of its recent videos is
         * newest and not yet watched. "Watched" here is the same map the
         * main grid uses (see Watched.mark), not a playlist's own `seen`
         * list — the point of this row is "what's left to watch", not "what
         * changed since I followed this", so opening a video anywhere in the
         * pouch also clears it from here.
         */
        async loadPlaylistLatest() {
            if (this.playlists.length === 0) return;
            try {
                const perPlaylist = await Promise.all(this.playlists.map(async (playlist) => {
                    const videos = await Feed.fetchPlaylistVideos(playlist.id, PLAYLIST_LATEST_DEPTH);
                    const unwatched = videos
                        .filter((video) => !this.watched[video.id])
                        .sort((a, b) => b.published - a.published);
                    if (!unwatched.length) return null;
                    return { ...unwatched[0], playlistId: playlist.id, playlistTitle: playlist.title };
                }));
                this.playlistLatest = perPlaylist.filter(Boolean);
            } catch (_) {
                this.playlistLatest = [];
            }
            this.playlistsRead = true;
            if (this.alive) this.renderGrid();
        }

        // -------------------------------------------------------- selecting

        /** The channels the current topic covers, as a Set of ids. */
        scopeIds(topicId) {
            if (topicId !== ALL_TOPICS) {
                const ids = new Set();
                for (const channel of this.channels) {
                    if (channel.topicId === topicId) ids.add(channel.id);
                }
                return ids;
            }

            const ids = new Set(this.channels.map((channel) => channel.id));
            if (this.allSubscribed && this.subscribed) {
                this.subscribed.forEach((channel) => ids.add(channel.id));
            }
            return ids;
        }

        /**
         * The oldest publication date the current range admits, or 0 for "all".
         *
         * Resolved once per pass and handed down rather than worked out per
         * video: the range lookup was running four string comparisons and a
         * Date.now() for every card, thousands of times per redraw.
         */
        cutoff() {
            const days = (RANGES.find((entry) => entry.id === this.range) || {}).days;
            return days ? Date.now() - days * 864e5 : 0;
        }

        /**
         * Call `each(video)` for every video the given topic admits.
         *
         * Walks the per-channel map for the channels in scope rather than
         * filtering one flat list against a channel list — the old form was a
         * `channels.some(…)` inside a `videos.filter(…)`, which with a hundred
         * channels and fifteen uploads each was a hundred and fifty thousand
         * comparisons on every interaction.
         */
        each(topicId, visit) {
            const scope = this.scopeIds(topicId);
            const since = this.cutoff();
            // Already-watched videos are dropped from "All" outright. In a
            // topic they stay: a topic is a shelf you go back to, and a hole
            // in it reads as something having gone missing.
            const hideWatched = topicId === ALL_TOPICS;

            for (const channelId of scope) {
                const videos = this.byChannel.get(channelId);
                if (!videos) continue;
                for (const video of videos) {
                    if (video.published < since) continue;
                    if (hideWatched && this.watched[video.id]) continue;
                    visit(video);
                }
            }
        }

        /** How many cards a topic would draw. Counting does not need a sort. */
        countFor(topicId) {
            let n = 0;
            this.each(topicId, () => { n += 1; });
            return n;
        }

        /** The cards to draw, in the chosen order. */
        visible(topicId = this.topicId) {
            const out = [];
            this.each(topicId, (video) => out.push(video));

            if (this.sort === 'oldest') return out.sort((a, b) => a.published - b.published);
            if (this.sort === 'channel') {
                return out.sort((a, b) =>
                    (a.channelName || '').localeCompare(b.channelName || '') ||
                    b.published - a.published);
            }
            return out.sort((a, b) => b.published - a.published);
        }

        /**
         * Videos in range per topic, for the counts down the rail. One pass
         * over the pouch's own channels; subscribed-only channels have no
         * topic and are deliberately not counted anywhere.
         */
        counts() {
            const byTopic = new Map(this.topics.map((topic) => [topic.id, 0]));
            const since = this.cutoff();

            for (const channel of this.channels) {
                const videos = this.byChannel.get(channel.id);
                if (!videos || !byTopic.has(channel.topicId)) continue;

                let n = 0;
                for (const video of videos) if (video.published >= since) n++;
                byTopic.set(channel.topicId, byTopic.get(channel.topicId) + n);
            }

            // "All" is counted as what All actually shows — subscriptions
            // folded in, watched ones taken out — rather than as the pouch's
            // own total, so the number and the grid never disagree.
            return { allTotal: this.countFor(ALL_TOPICS), byTopic };
        }

        // ------------------------------------------------------- rendering

        /** Coalesce the redraws that streaming feeds would otherwise cause. */
        scheduleRender() {
            if (this.redrawTimer) return;
            this.redrawTimer = setTimeout(() => {
                this.redrawTimer = null;
                if (this.alive) this.render();
            }, REDRAW_MS);
        }

        render() {
            this.renderRail();
            this.renderGrid();
        }

        renderRail() {
            // Not while the user is naming a topic. The rail is redrawn on a
            // timer as feeds stream in, and redrawing it under a half-typed
            // name would throw the name away mid-keystroke.
            if (this.el.rail.querySelector('.bb-new-topic')) return;

            // Nothing to draw a rail from yet — topics/channels are still in
            // flight from hydrate(). A bare "Loading…" beats a rail that
            // claims zero topics for the half-second it takes storage to answer.
            if (!this.hydrated) {
                this.el.rail.innerHTML = '<div class="bb-topics-label">Topics</div>';
                this.el.sub.textContent = 'Loading…';
                return;
            }

            const { allTotal, byTopic } = this.counts();
            const show = (n) => (this.loading && this.byChannel.size === 0 ? '' : String(n));

            const rows = this.topics.map((topic) => topicRow(
                topic.id,
                topic.name,
                show(byTopic.get(topic.id) || 0),
                topic.id === this.topicId,
            ));

            this.el.rail.innerHTML = `
                <div class="bb-topics-label">Topics</div>
                ${topicRow(ALL_TOPICS, 'All', show(allTotal), this.topicId === ALL_TOPICS)}
                ${this.subscribedToggleHtml()}
                ${this.playlistNavHtml()}
                ${rows.join('')}
                <button class="bb-topic-add" type="button">+ New topic</button>`;

            this.el.sub.textContent = this.loading
                ? (this.total ? `Loading ${this.done}/${this.total}…` : 'Loading…')
                : `${plural(allTotal, 'video')} · ${plural(this.topics.length, 'topic')}`;
        }

        /**
         * The switch that widens "All" to every subscription. It is nested
         * under the All row rather than put in the header because that is
         * exactly what it modifies, and it shows a count once one is known.
         */
        subscribedToggleHtml() {
            const count = this.subscribed ? this.subscribed.length : 0;
            const note = this.loadingSubs
                ? 'reading…'
                : (count ? String(count) : '');

            return `
                <button class="bb-subs-toggle" type="button" role="switch"
                        aria-checked="${this.allSubscribed}">
                    <span class="bb-switch" aria-hidden="true"><span class="bb-switch-dot"></span></span>
                    <span class="bb-subs-label">Subscriptions</span>
                    <span class="bb-topic-n">${Dom.escapeHtml(note)}</span>
                </button>`;
        }

        /**
         * The rail row for followed playlists — a topic row in every way
         * that matters to the DOM (same class, same click delegation in
         * wire()), so it needs no wiring of its own. Absent until a playlist
         * is followed, the way the "New in your playlists" strip used to be.
         */
        playlistNavHtml() {
            if (this.playlists.length === 0) return '';
            const count = this.playlistsRead ? String(this.playlistLatest.length) : '';
            return topicRow(PLAYLISTS_VIEW, 'Subscribed Playlist', count, this.topicId === PLAYLISTS_VIEW);
        }

        /**
         * Put `html` in the grid unless it is already there. Most redraws while
         * the feeds stream in change nothing on screen — the new videos are
         * past the cards drawn, or outside the range — and rebuilding the grid
         * anyway reloaded every thumbnail in it.
         */
        drawGrid(html) {
            if (html === this.drawnGrid) return;
            this.drawnGrid = html;
            this.el.grid.innerHTML = html;
        }

        renderGrid() {
            if (!this.hydrated) {
                this.drawGrid('<p class="bb-muted">Loading your pouch…</p>');
                return;
            }

            if (this.topicId === PLAYLISTS_VIEW) {
                this.drawGrid(this.playlistLatestHtml());
                return;
            }

            const parts = [];

            if (this.channels.length === 0 && !this.allSubscribed) {
                parts.push(`<p class="bb-muted">No channels yet — use the button beside Subscribe to file one
                    under a topic, or turn on <strong>Subscriptions</strong> to see everything you follow.</p>`);
            } else {
                const list = this.visible();
                if (list.length) {
                    parts.push(cardsHtml(list, this.shown));
                } else if (this.loading || this.loadingSubs) {
                    parts.push('<p class="bb-muted">Loading the latest from your channels…</p>');
                } else {
                    parts.push('<p class="bb-muted">Nothing published in this range.</p>');
                }
            }

            this.drawGrid(parts.join(''));
        }

        /**
         * The "Subscribed Playlist" rail entry's own grid: one card per
         * followed playlist (see loadPlaylistLatest for what "latest" means
         * here), not a slice of the channel feed the rest of the sheet reads.
         */
        playlistLatestHtml() {
            if (this.playlists.length === 0) {
                return '<p class="bb-muted">Follow a playlist from its own page on YouTube to see it here.</p>';
            }
            if (!this.playlistsRead) {
                return '<p class="bb-muted">Checking your playlists…</p>';
            }
            if (this.playlistLatest.length === 0) {
                return `<p class="bb-muted">Nothing unwatched in ${plural(this.playlists.length, 'playlist')}.</p>`;
            }
            return `<div class="bb-video-grid">${this.playlistLatest.map(playlistCard).join('')}</div>`;
        }

        // ----------------------------------------------------- interaction

        wire() {
            const overlay = this.dialog.element;

            // One delegated listener per region: the rail and the grid are both
            // re-rendered wholesale, so per-element listeners would have to be
            // re-bound on every pass.
            this.el.rail.addEventListener('click', (event) => {
                if (event.target.closest('.bb-topic-add')) {
                    return this.startNewTopic(this.el.rail.querySelector('.bb-topic-add'));
                }
                if (event.target.closest('.bb-subs-toggle')) return this.toggleSubscribed();

                const button = event.target.closest('.bb-topic');
                if (!button) return;
                this.topicId = button.dataset.topicId;
                this.shown = CARDS_STEP;
                this.render();
            });

            this.el.grid.addEventListener('click', (event) => {
                if (event.target.closest('[data-bb-more]')) {
                    this.shown += CARDS_STEP;
                    return this.renderGrid();
                }
                // Opening a card is the plainest signal there is that the video
                // has been watched; the link itself is left alone.
                const card = event.target.closest('[data-video-id]');
                if (card) this.markWatched(card.dataset.videoId);
            });

            overlay.querySelector('.bb-seg').addEventListener('click', (event) => {
                const option = event.target.closest('.bb-seg-opt');
                if (!option) return;
                this.range = option.dataset.range;
                this.shown = CARDS_STEP;
                overlay.querySelectorAll('.bb-seg-opt').forEach((other) => {
                    other.setAttribute('aria-pressed', String(other === option));
                });
                this.render();
            });

            overlay.querySelector('.bb-select').addEventListener('change', (event) => {
                this.sort = event.target.value;
                this.shown = CARDS_STEP;
                this.renderGrid();
            });
        }

        async toggleSubscribed() {
            this.allSubscribed = !this.allSubscribed;
            Settings.set({ pouchShowAllSubscribed: this.allSubscribed });

            // Widening the scope only means anything from "All".
            if (this.allSubscribed) this.topicId = ALL_TOPICS;
            this.shown = CARDS_STEP;
            this.render();

            if (this.allSubscribed) await this.loadSubscribed();
        }

        markWatched(videoId) {
            if (!videoId || this.watched[videoId]) return;
            this.watched[videoId] = Date.now();
            Watched.mark(videoId);
        }

        /**
         * "+ New topic" becomes an input in place. A nested modal was the
         * obvious alternative, but its Escape handler and the sheet's would
         * both sit on document, so one Escape would close the sheet out from
         * under the prompt.
         */
        startNewTopic(button) {
            if (!button) return;

            const form = document.createElement('form');
            form.className = 'bb-new-topic';
            form.innerHTML = `
                <input class="bb-input" type="text" placeholder="Topic name" aria-label="New topic name">
                <button class="bb-btn" type="submit">Create</button>`;
            button.replaceWith(form);

            const input = form.querySelector('input');
            input.focus();

            const cancel = () => { form.replaceWith(button); };
            input.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                event.stopPropagation(); // do not also close the sheet
                cancel();
            });
            input.addEventListener('blur', () => { if (!input.value.trim()) cancel(); });

            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const name = input.value.trim();
                if (!name) return cancel();

                form.querySelector('button').disabled = true;
                const id = await Subscriptions.createTopic(name);
                if (!id) {
                    form.querySelector('button').disabled = false;
                    return this.notify('Could not create that topic', 'error');
                }
                // A name already taken answers with that topic's id, and
                // pushing it again drew the topic twice.
                if (!this.topics.some((topic) => topic.id === id)) this.topics.push({ id, name });
                this.topicId = id;
                this.shown = CARDS_STEP;
                this.render();
                this.notify(`Topic "${name}" created`, 'success');
            });
        }
    }

    // -------------------------------------------------------- templates

    function sheetHtml(icon) {
        const ranges = RANGES.map((range) => `
            <button class="bb-seg-opt" type="button" data-range="${range.id}"
                    aria-pressed="${range.id === DEFAULT_RANGE}">${range.label}</button>`).join('');

        const sorts = SORTS.map((sort) =>
            `<option value="${sort.id}">${sort.label}</option>`).join('');

        return `
            <div class="bb-sheet">
                <div class="bb-sheet-head">
                    <div class="bb-sheet-brand">
                        <img src="${Dom.escapeAttr(icon)}" alt="">
                        <span class="bb-sheet-title">Pouch</span>
                        <span class="bb-sheet-sub">Loading…</span>
                    </div>
                    <div class="bb-sheet-tools">
                        <div class="bb-seg" role="group" aria-label="Time range">${ranges}</div>
                        <select class="bb-select" aria-label="Sort">${sorts}</select>
                        <button class="bb-close" type="button" data-bb-close aria-label="Close">${Icons.svg('x')}</button>
                    </div>
                </div>
                <div class="bb-sheet-body">
                    <nav class="bb-topics"></nav>
                    <div class="bb-videos"></div>
                </div>
            </div>`;
    }

    function topicRow(id, name, count, active) {
        return `
            <button class="bb-topic" type="button" data-topic-id="${Dom.escapeAttr(id)}"${active ? ' aria-current="true"' : ''}>
                <span class="bb-topic-name">${Dom.escapeHtml(name)}</span>
                <span class="bb-topic-n">${Dom.escapeHtml(count)}</span>
            </button>`;
    }

    /** The grid for `list`: its first `shown` cards, and a row offering the rest. */
    function cardsHtml(list, shown, card = videoCard) {
        const more = list.length - shown;
        const offer = more > 0
            ? `<button class="bb-btn bb-more" type="button" data-bb-more="1">Show ${Math.min(CARDS_STEP, more)} more of ${more}</button>`
            : '';
        return `<div class="bb-video-grid">${list.slice(0, shown).map(card).join('')}</div>${offer}`;
    }

    function videoCard(video) {
        // An entry with no published date gets no age label at all, rather
        // than a placeholder dash the eye has to skip over.
        const age = Time.relativeTime(video.published);
        return `
            <a class="bb-video-card" href="${Dom.safeUrlAttr(video.url)}" data-video-id="${Dom.escapeAttr(video.id)}">
                <img src="${Dom.safeUrlAttr(video.thumb)}" alt="" loading="lazy">
                <div class="bb-video-meta">
                    <div class="bb-video-title">${Dom.escapeHtml(video.title)}</div>
                    <div class="bb-video-channel">
                        <span>${Dom.escapeHtml(video.channelName || '')}</span>
                        ${age ? `<span class="bb-video-age">${Dom.escapeHtml(age)}</span>` : ''}
                    </div>
                </div>
            </a>`;
    }

    function playlistCard(entry) {
        const age = Time.relativeTime(entry.published);
        return `
            <a class="bb-video-card" href="${Dom.safeUrlAttr(entry.url)}" data-video-id="${Dom.escapeAttr(entry.id)}">
                <img src="${Dom.safeUrlAttr(entry.thumb)}" alt="" loading="lazy">
                <div class="bb-video-meta">
                    <div class="bb-video-title">${Dom.escapeHtml(entry.title)}</div>
                    <div class="bb-video-channel">
                        <span class="bb-pill">${Dom.escapeHtml(entry.playlistTitle || 'Playlist')}</span>
                        ${age ? `<span class="bb-video-age">${Dom.escapeHtml(age)}</span>` : ''}
                    </div>
                </div>
            </a>`;
    }

    const PouchSheet = {
        createPouchSheet, ALL_TOPICS, RANGES, SORTS, PER_CHANNEL, PER_SUBSCRIBED_CHANNEL, CARDS_STEP, cardsHtml,
    };

    root.BB = root.BB || {};
    root.BB.PouchSheet = PouchSheet;
    if (typeof module !== 'undefined' && module.exports) module.exports = PouchSheet;
})(typeof globalThis !== 'undefined' ? globalThis : this);
