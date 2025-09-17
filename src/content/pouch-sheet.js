/**
 * The pouch sheet: a near-full-screen frosted panel over YouTube, the topic
 * rail on the left and a thumbnail grid on the right, with new playlist
 * entries in a strip beneath the grid.
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

    /** Redraws while feeds are streaming in are coalesced onto this interval. */
    const REDRAW_MS = 220;

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    function createPouchSheet({ notify, dress, appearance, iconUrl }) {

        async function open() {
            // Storage first, network never: everything below draws from what
            // is already known and fills in afterwards.
            const [{ topics, channels }, look, settings, watched, playlists] = await Promise.all([
                Subscriptions.load(),
                appearance(),
                Settings.get(['pouchShowAllSubscribed']),
                Watched.load(),
                Playlists.load(),
            ]);

            const dialog = Overlay.open({ id: OVERLAY_ID, contentHtml: sheetHtml(iconUrl()) });
            if (!dialog) return;

            dialog.element.classList.add('bb-sheet-overlay');
            dress(dialog.element, look);

            new Sheet({ dialog, topics, channels, settings, watched, playlists, notify }).start();
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
        constructor({ dialog, topics, channels, settings, watched, playlists, notify }) {
            this.dialog = dialog;
            this.topics = topics;
            this.channels = channels;
            this.notify = notify;
            this.watched = watched;
            this.playlists = playlists;

            /** channelId -> videos[]. */
            this.byChannel = new Map();
            /** channelId -> the channel record, pouch and subscribed alike. */
            this.known = new Map(channels.map((channel) => [channel.id, channel]));

            this.subscribed = null;   // lazily fetched, then cached here
            this.loadingSubs = false;

            this.topicId = ALL_TOPICS;
            this.range = DEFAULT_RANGE;
            this.sort = 'newest';
            this.allSubscribed = !!settings.pouchShowAllSubscribed;

            this.loading = channels.length > 0;
            this.done = 0;
            this.total = channels.length;

            this.playlistEntries = [];
            this.playlistsRead = playlists.length === 0;
            this.redrawTimer = null;

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

        start() {
            this.wire();
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

            // The playlist strip and the subscription sweep are both extras:
            // they come after the pouch itself is on screen.
            this.loadPlaylists();
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

        async loadPlaylists() {
            if (this.playlists.length === 0) return;
            try {
                this.playlistEntries = await Playlists.newEntries(this.playlists, Feed);
            } catch (_) {
                this.playlistEntries = [];
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
                    <span class="bb-subs-label">All subscribed</span>
                    <span class="bb-topic-n">${Dom.escapeHtml(note)}</span>
                </button>`;
        }

        renderGrid() {
            const parts = [];

            if (this.channels.length === 0 && !this.allSubscribed) {
                parts.push(`<p class="bb-muted">No channels yet — use the button beside Subscribe to file one
                    under a topic, or turn on <strong>All subscribed</strong> to see everything you follow.</p>`);
            } else {
                const list = this.visible();
                if (list.length) {
                    parts.push(`<div class="bb-video-grid">${list.map(videoCard).join('')}</div>`);
                } else if (this.loading || this.loadingSubs) {
                    parts.push('<p class="bb-muted">Loading the latest from your channels…</p>');
                } else {
                    parts.push('<p class="bb-muted">Nothing published in this range.</p>');
                }
            }

            parts.push(this.playlistStripHtml());
            this.el.grid.innerHTML = parts.join('');
        }

        /**
         * New entries in followed playlists, under the grid.
         *
         * A playlist is followed from its own header on YouTube; what is "new"
         * is anything added since it was followed or last cleared — see
         * shared/playlists.js, which owns that bookkeeping.
         */
        playlistStripHtml() {
            if (this.playlists.length === 0) return '';

            const entries = this.playlistEntries;
            let body;
            if (entries.length) {
                body = `<div class="bb-video-grid">${entries.map(playlistCard).join('')}</div>`;
            } else if (!this.playlistsRead) {
                // "Nothing new" is a claim, and it must not be made before the
                // playlists have actually been read.
                body = '<p class="bb-muted">Checking your playlists…</p>';
            } else {
                body = `<p class="bb-muted">Nothing new in ${plural(this.playlists.length, 'playlist')} yet.</p>`;
            }

            return `
                <section class="bb-strip">
                    <div class="bb-strip-head">
                        <h4>New in your playlists</h4>
                        <span class="bb-strip-n">${entries.length || ''}</span>
                        ${entries.length
                            ? '<button class="bb-strip-clear" type="button">Mark all seen</button>'
                            : ''}
                    </div>
                    ${body}
                </section>`;
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
                this.render();
            });

            this.el.grid.addEventListener('click', (event) => {
                if (event.target.closest('.bb-strip-clear')) {
                    event.preventDefault();
                    return this.clearPlaylistStrip();
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
                overlay.querySelectorAll('.bb-seg-opt').forEach((other) => {
                    other.setAttribute('aria-pressed', String(other === option));
                });
                this.render();
            });

            overlay.querySelector('.bb-select').addEventListener('change', (event) => {
                this.sort = event.target.value;
                this.renderGrid();
            });
        }

        async toggleSubscribed() {
            this.allSubscribed = !this.allSubscribed;
            Settings.set({ pouchShowAllSubscribed: this.allSubscribed });

            // Widening the scope only means anything from "All".
            if (this.allSubscribed) this.topicId = ALL_TOPICS;
            this.render();

            if (this.allSubscribed) await this.loadSubscribed();
        }

        markWatched(videoId) {
            if (!videoId || this.watched[videoId]) return;
            this.watched[videoId] = Date.now();
            Watched.mark(videoId);
        }

        async clearPlaylistStrip() {
            const entries = this.playlistEntries;
            this.playlistEntries = [];
            this.renderGrid();
            await Playlists.markAllSeen(entries);
            this.playlists = await Playlists.load();
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
                this.topics.push({ id, name });
                this.topicId = id;
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
                        <button class="bb-close" type="button" data-bb-close aria-label="Close">&times;</button>
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
        createPouchSheet, ALL_TOPICS, RANGES, SORTS, PER_CHANNEL, PER_SUBSCRIBED_CHANNEL,
    };

    root.BB = root.BB || {};
    root.BB.PouchSheet = PouchSheet;
    if (typeof module !== 'undefined' && module.exports) module.exports = PouchSheet;
})(typeof globalThis !== 'undefined' ? globalThis : this);
