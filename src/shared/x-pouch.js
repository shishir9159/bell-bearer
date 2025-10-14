/**
 * The X pouch: two independent topic lists, the people filed under one and the
 * posts filed under the other.
 *
 * People and posts do NOT share topics. A "CUDA" under People and a "CUDA"
 * under Posts are different topics with different ids, and renaming or
 * deleting one leaves the other alone. That is the rule the design encodes,
 * and it is why every function here takes a `side` rather than reading one
 * list: there is no such thing as "the topics" on X.
 *
 * An item belongs to exactly one topic. Filing something already filed is a
 * move, silently — no duplicate, no prompt — so a person is keyed by handle
 * and a post by its status id, not by a fresh id each time.
 *
 * What lives where is a design rule too, and it is enforced by what this file
 * exposes to whom rather than by a flag: the on-page panel only reads, files
 * and (for posts) creates a topic; renaming, reordering, deleting a topic,
 * writing a note and un-saving a post are dashboard actions.
 *
 * Avatars are stored as the pbs.twimg.com URL scraped off the page at the
 * moment the person is filed, never as image bytes and never by asking X for
 * them. X's own endpoints are rate-limited per fifteen minutes against the
 * signed-in session, so a panel that refetched fifty profiles on open would
 * spend the user's own budget and eventually 429 their real browsing. The CDN
 * the URL points at is not rate-limited and the browser caches it, so an
 * <img src> costs nothing; a URL that has gone stale (the person changed
 * their picture) falls back to the monogram, which is why name is stored too.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('./settings.js');

    const {
        xPeopleTopics: PEOPLE_TOPICS_KEY,
        xPostTopics: POST_TOPICS_KEY,
        xPeople: PEOPLE_KEY,
        xPosts: POSTS_KEY,
    } = Settings.DATA;

    /** 'people' and 'posts', and everything that differs between the two. */
    const SIDES = Object.freeze({
        people: { id: 'people', label: 'People', topicsKey: PEOPLE_TOPICS_KEY, itemsKey: PEOPLE_KEY, noun: 'people', one: 'person' },
        posts: { id: 'posts', label: 'Posts', topicsKey: POST_TOPICS_KEY, itemsKey: POSTS_KEY, noun: 'posts', one: 'post' },
    });

    const sideOf = (side) => SIDES[side] || SIDES.people;

    let writeChain = Promise.resolve();
    let idCounter = 0;

    /**
     * Same counter trick as shared/subscriptions.js, for the same reason: two
     * topics created in the same millisecond off a bare Date.now() collide and
     * the second overwrites the first.
     */
    function newId(prefix) {
        idCounter = (idCounter + 1) % 1000;
        return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
    }

    const asArray = (value) => (Array.isArray(value) ? value : []);

    async function load() {
        try {
            const stored = await chrome.storage.local.get([
                PEOPLE_TOPICS_KEY, POST_TOPICS_KEY, PEOPLE_KEY, POSTS_KEY,
            ]);
            return {
                peopleTopics: asArray(stored[PEOPLE_TOPICS_KEY]),
                postTopics: asArray(stored[POST_TOPICS_KEY]),
                people: asArray(stored[PEOPLE_KEY]),
                posts: asArray(stored[POSTS_KEY]),
            };
        } catch (_) {
            // The extension reloading invalidates every content script's
            // context; an empty pouch draws, a rejection takes the panel down.
            return { peopleTopics: [], postTopics: [], people: [], posts: [] };
        }
    }

    /** Read-modify-write as one atomic step, so two edits cannot clobber. */
    async function update(mutate) {
        const run = async () => {
            const state = await load();
            const next = (await mutate(state)) || state;
            await chrome.storage.local.set({
                [PEOPLE_TOPICS_KEY]: next.peopleTopics,
                [POST_TOPICS_KEY]: next.postTopics,
                [PEOPLE_KEY]: next.people,
                [POSTS_KEY]: next.posts,
            });
            return next;
        };
        writeChain = writeChain.then(run, run).catch((error) => {
            console.error('Bell Bearer: could not update the X pouch', error);
            return { peopleTopics: [], postTopics: [], people: [], posts: [] };
        });
        return writeChain;
    }

    /** The topics of one side, in display order. */
    function topicsOf(state, side) {
        return asArray(state[sideOf(side).id === 'people' ? 'peopleTopics' : 'postTopics']);
    }

    /** The items of one side. */
    function itemsOf(state, side) {
        return asArray(state[sideOf(side).id === 'people' ? 'people' : 'posts']);
    }

    const stateKey = (side, what) => (sideOf(side).id === 'people'
        ? (what === 'topics' ? 'peopleTopics' : 'people')
        : (what === 'topics' ? 'postTopics' : 'posts'));

    /** Everything filed under one topic, in the order it was filed. */
    function inTopic(state, side, topicId) {
        return itemsOf(state, side).filter((item) => item.topic === topicId);
    }

    /**
     * Create a topic, or return the one already carrying that name.
     *
     * Case-insensitive, because "read later" and "Read Later" are one topic
     * the user typed twice, and the picker offers no way to tell them apart.
     */
    async function createTopic(side, name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return null;

        const key = stateKey(side, 'topics');
        let created = null;
        await update((state) => {
            const existing = state[key].find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
            if (existing) {
                created = existing;
                return state;
            }
            created = { id: newId(sideOf(side).id === 'people' ? 'xpt' : 'xst'), name: trimmed, createdAt: Date.now() };
            return { ...state, [key]: [...state[key], created] };
        });
        return created ? created.id : null;
    }

    async function renameTopic(side, topicId, name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) return;
        const key = stateKey(side, 'topics');
        await update((state) => ({
            ...state,
            [key]: state[key].map((t) => (t.id === topicId ? { ...t, name: trimmed } : t)),
        }));
    }

    /**
     * Delete a topic and everything in it.
     *
     * Deliberately not the YouTube pouch's behaviour, where deleting a topic
     * leaves its channels uncategorised. There is no uncategorised here: an
     * item belongs to exactly one topic, so a topic's rows have nowhere to
     * go. That is why the dashboard asks first.
     */
    async function deleteTopic(side, topicId) {
        const topicsKey = stateKey(side, 'topics');
        const itemsKey = stateKey(side, 'items');
        await update((state) => ({
            ...state,
            [topicsKey]: state[topicsKey].filter((t) => t.id !== topicId),
            [itemsKey]: state[itemsKey].filter((item) => item.topic !== topicId),
        }));
    }

    /**
     * Move `topicId` to where `beforeId` currently sits. Array order is the
     * display order, so reordering is a splice and nothing else is stored.
     */
    async function moveTopic(side, topicId, beforeId) {
        if (!topicId || topicId === beforeId) return;
        const key = stateKey(side, 'topics');
        await update((state) => {
            const list = state[key].slice();
            const from = list.findIndex((t) => t.id === topicId);
            const to = list.findIndex((t) => t.id === beforeId);
            if (from < 0 || to < 0) return state;
            list.splice(to, 0, list.splice(from, 1)[0]);
            return { ...state, [key]: list };
        });
    }

    /**
     * File a person under a topic, or move them to it if they are already
     * filed. Keyed by handle: the same account met on a post and again on
     * their profile is one person, not two.
     *
     * A re-file keeps the note and the date, and refreshes the name and
     * avatar from what the page is showing now — the note is the user's and
     * must survive, the other two are X's and may have changed.
     */
    async function filePerson({ handle, name, avatar, topic }) {
        const key = String(handle || '').trim().toLowerCase();
        if (!key || !topic) return null;

        let id = null;
        await update((state) => {
            const index = state.people.findIndex((p) => String(p.handle).toLowerCase() === key);
            const people = state.people.slice();
            if (index === -1) {
                id = newId('xp');
                people.push({
                    id,
                    topic,
                    handle: String(handle).trim(),
                    name: String(name || '').trim() || String(handle).trim(),
                    avatar: avatar || '',
                    note: '',
                    addedAt: Date.now(),
                });
            } else {
                id = people[index].id;
                people[index] = {
                    ...people[index],
                    topic,
                    name: String(name || '').trim() || people[index].name,
                    avatar: avatar || people[index].avatar || '',
                };
            }
            return { ...state, people };
        });
        return id;
    }

    /**
     * File a post under a topic, or move it. Keyed by the status id, which is
     * the only thing about a post that does not change — text is edited,
     * handles are renamed, and the same post arrives in the timeline, in a
     * thread and on a profile with different surrounding markup each time.
     */
    async function filePost({ statusId, handle, name, text, url, postedAt, topic }) {
        const key = String(statusId || '').trim();
        if (!key || !topic) return null;

        await update((state) => {
            const index = state.posts.findIndex((p) => p.id === key);
            const posts = state.posts.slice();
            const record = {
                id: key,
                topic,
                handle: String(handle || '').trim(),
                name: String(name || '').trim(),
                text: String(text || '').trim(),
                url: url || '',
                postedAt: Number(postedAt) || 0,
            };
            if (index === -1) posts.push({ ...record, savedAt: Date.now() });
            else posts[index] = { ...posts[index], ...record };
            return { ...state, posts };
        });
        return key;
    }

    /** The note on a person. Written in the dashboard; the panel shows it. */
    async function setNote(personId, note) {
        await update((state) => ({
            ...state,
            people: state.people.map((p) => (p.id === personId ? { ...p, note: String(note || '').trim() } : p)),
        }));
    }

    /** Take one item back out. Un-saving is a dashboard action on both sides. */
    async function remove(side, itemId) {
        const key = stateKey(side, 'items');
        await update((state) => ({
            ...state,
            [key]: state[key].filter((item) => item.id !== itemId),
        }));
    }

    /** The topic a handle is filed under, or null. Drives the profile button. */
    function topicForHandle(state, handle) {
        const key = String(handle || '').trim().toLowerCase();
        if (!key) return null;
        const person = state.people.find((p) => String(p.handle).toLowerCase() === key);
        return person ? person.topic : null;
    }

    /** The topic a status id is filed under, or null. Drives the post button. */
    function topicForStatus(state, statusId) {
        const post = state.posts.find((p) => p.id === String(statusId || ''));
        return post ? post.topic : null;
    }

    /**
     * Where a saved post lives on x.com.
     *
     * Rebuilt from the handle and the status id when the record has no url of
     * its own, rather than reported as unopenable. Posts filed before the url
     * field existed have none, and a saved post you cannot get back to is the
     * one thing the pouch must not hold — that is the whole point of saving
     * it. X serves /<anything>/status/<id> for the right id whatever handle
     * is in front of it, and /i/status/<id> is X's own spelling for the case
     * where there is no handle to put there.
     *
     * The id is digits and the handle is X's own alphabet, both filtered here
     * rather than trusted: what comes back is interpolated into an href.
     */
    function postUrl(post) {
        if (!post) return '';
        if (/^https:\/\/(?:x|twitter)\.com\//i.test(post.url || '')) return post.url;

        const id = String(post.id || '').replace(/\D/g, '');
        if (!id) return '';
        const handle = String(post.handle || '').replace(/[^A-Za-z0-9_]/g, '');
        return `https://x.com/${handle || 'i'}/status/${id}`;
    }

    /** Two initials, the fallback when a person has no usable avatar URL. */
    function monogram(name, handle) {
        const source = String(name || '').trim() || String(handle || '').replace(/^@/, '');
        const words = source.split(/\s+/).filter(Boolean);
        const letters = words.length > 1
            ? words[0][0] + words[1][0]
            : source.slice(0, 2);
        return letters.toUpperCase().slice(0, 2);
    }

    const XPouch = {
        SIDES, sideOf, newId, load, update,
        topicsOf, itemsOf, inTopic,
        createTopic, renameTopic, deleteTopic, moveTopic,
        filePerson, filePost, setNote, remove,
        topicForHandle, topicForStatus, monogram, postUrl,
        KEYS: [PEOPLE_TOPICS_KEY, POST_TOPICS_KEY, PEOPLE_KEY, POSTS_KEY],
    };

    root.BB = root.BB || {};
    root.BB.XPouch = XPouch;
    if (typeof module !== 'undefined' && module.exports) module.exports = XPouch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
