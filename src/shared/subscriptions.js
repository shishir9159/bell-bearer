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
    const Store = ns.Store || req('./store.js');
    const Ids = ns.Ids || req('./ids.js');
    const YouTube = ns.YouTube || req('./youtube.js');

    const { topics: TOPICS_KEY, channels: CHANNELS_KEY, newVideos: NEW_VIDEOS_KEY } = Settings.DATA;

    const newId = (prefix) => Ids.next(prefix);

    const asArray = (value) => (Array.isArray(value) ? value : []);

    const store = Store.create({
        keys: [TOPICS_KEY, CHANNELS_KEY, NEW_VIDEOS_KEY],
        read: (stored) => ({
            topics: asArray(stored[TOPICS_KEY]),
            channels: asArray(stored[CHANNELS_KEY]),
            newVideos: asArray(stored[NEW_VIDEOS_KEY]),
        }),
        // Only the parts given: save() is handed one list at a time.
        write: ({ topics, channels, newVideos }) => {
            const values = {};
            if (topics) values[TOPICS_KEY] = topics;
            if (channels) values[CHANNELS_KEY] = channels;
            if (newVideos) values[NEW_VIDEOS_KEY] = newVideos;
            return values;
        },
        blank: () => ({ topics: [], channels: [], newVideos: [] }),
        name: 'subscriptions',
    });

    const { load, save, update } = store;

    /** Create a topic, or return the existing one with that name. */
    async function createTopic(name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return null;

        let created = null;
        const saved = await update((state) => {
            const existing = state.topics.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
            if (existing) {
                created = existing;
                return state;
            }
            created = { id: newId('topic'), name: trimmed, createdAt: Date.now() };
            return { ...state, topics: [...state.topics, created] };
        });
        // `created` is set before the write, so it alone said yes to a topic
        // a failed write never stored; what update() resolves to is what is.
        return created && saved.topics.some((t) => t.id === created.id) ? created.id : null;
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
