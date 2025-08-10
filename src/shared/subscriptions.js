/**
 * The "pouch": topics, the channels filed under them, and the new-video list.
 *
 * The content script and the dashboard both create topics and channels. They
 * had separate implementations that generated ids differently and disagreed on
 * what to do with a duplicate, so a channel added from YouTube could show up
 * twice in the dashboard.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');
    const YouTube = ns.YouTube || req('./youtube.js');

    const { topics: TOPICS_KEY, channels: CHANNELS_KEY, newVideos: NEW_VIDEOS_KEY } = Settings.DATA;

    let writeChain = Promise.resolve();
    let idCounter = 0;

    /**
     * Ids were `Date.now().toString()`, so two topics created in the same
     * millisecond collided and the second overwrote the first. The counter
     * makes that impossible while keeping ids sortable by creation time.
     */
    function newId(prefix) {
        idCounter = (idCounter + 1) % 1000;
        return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
    }

    async function load() {
        try {
            const stored = await chrome.storage.local.get([TOPICS_KEY, CHANNELS_KEY, NEW_VIDEOS_KEY]);
            return {
                topics: Array.isArray(stored[TOPICS_KEY]) ? stored[TOPICS_KEY] : [],
                channels: Array.isArray(stored[CHANNELS_KEY]) ? stored[CHANNELS_KEY] : [],
                newVideos: Array.isArray(stored[NEW_VIDEOS_KEY]) ? stored[NEW_VIDEOS_KEY] : [],
            };
        } catch (_) {
            return { topics: [], channels: [], newVideos: [] };
        }
    }

    async function save({ topics, channels, newVideos }) {
        const values = {};
        if (topics) values[TOPICS_KEY] = topics;
        if (channels) values[CHANNELS_KEY] = channels;
        if (newVideos) values[NEW_VIDEOS_KEY] = newVideos;

        const write = () => chrome.storage.local.set(values);
        writeChain = writeChain.then(write, write).catch((error) => {
            console.error('Bell Bearer: could not save subscriptions', error);
        });
        return writeChain;
    }

    /** Read-modify-write as one atomic step, so concurrent edits do not clobber. */
    async function update(mutate) {
        const run = async () => {
            const state = await load();
            const next = (await mutate(state)) || state;
            await chrome.storage.local.set({
                [TOPICS_KEY]: next.topics,
                [CHANNELS_KEY]: next.channels,
                [NEW_VIDEOS_KEY]: next.newVideos,
            });
            return next;
        };
        writeChain = writeChain.then(run, run).catch((error) => {
            console.error('Bell Bearer: could not update subscriptions', error);
            return { topics: [], channels: [], newVideos: [] };
        });
        return writeChain;
    }

    /** Create a topic, or return the existing one with that name. */
    async function createTopic(name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return null;

        let created = null;
        await update((state) => {
            const existing = state.topics.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
            if (existing) {
                created = existing;
                return state;
            }
            created = { id: newId('topic'), name: trimmed, createdAt: Date.now() };
            return { ...state, topics: [...state.topics, created] };
        });
        return created ? created.id : null;
    }

    async function renameTopic(topicId, name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return;
        await update((state) => ({
            ...state,
            topics: state.topics.map((t) => (t.id === topicId ? { ...t, name: trimmed } : t)),
        }));
    }

    /** Delete a topic; its channels become uncategorised rather than vanishing. */
    async function deleteTopic(topicId) {
        await update((state) => ({
            ...state,
            topics: state.topics.filter((t) => t.id !== topicId),
            channels: state.channels.map((c) => (c.topicId === topicId ? { ...c, topicId: null } : c)),
        }));
    }

    /** Add or re-file a channel. Keyed by channel id so re-adding is a move. */
    async function addChannel({ name, url, topicId }) {
        const channelId = YouTube.extractChannelId(url) || newId('channel');
        const channel = {
            id: channelId,
            name: String(name || '').trim() || 'Unknown Channel',
            url,
            topicId: topicId || null,
            addedAt: Date.now(),
        };

        await update((state) => {
            const index = state.channels.findIndex((c) => c.id === channelId);
            const channels = state.channels.slice();
            if (index === -1) channels.push(channel);
            else channels[index] = { ...channels[index], ...channel, addedAt: channels[index].addedAt };
            return { ...state, channels };
        });
        return channelId;
    }

    async function deleteChannel(channelId) {
        await update((state) => ({
            ...state,
            channels: state.channels.filter((c) => c.id !== channelId),
            newVideos: state.newVideos.filter((v) => v.channelId !== channelId),
        }));
    }

    /** Replace the new-video list, keeping only videos still not marked watched. */
    async function setNewVideos(videos) {
        await update((state) => {
            const watched = new Set((state.newVideos || []).filter((v) => v.watched).map((v) => v.id));
            return { ...state, newVideos: videos.filter((v) => !watched.has(v.id)) };
        });
    }

    async function markWatched(videoId) {
        await update((state) => ({
            ...state,
            newVideos: state.newVideos.filter((v) => v.id !== videoId),
        }));
    }

    const Subscriptions = {
        newId, load, save, update,
        createTopic, renameTopic, deleteTopic,
        addChannel, deleteChannel,
        setNewVideos, markWatched,
    };

    root.BB = root.BB || {};
    root.BB.Subscriptions = Subscriptions;
    if (typeof module !== 'undefined' && module.exports) module.exports = Subscriptions;
})(typeof globalThis !== 'undefined' ? globalThis : this);
