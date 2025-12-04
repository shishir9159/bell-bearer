/**
 * Specs for the party's media adapter, against a real <video> playing real
 * (silent) media — the echo problem is about the order a browser queues media
 * events in, which nothing but a browser reproduces.
 */

const partyWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for a player state rather than a fixed time: a page still loading can take longer than any guess. */
async function partyUntil(condition, ms = 1500) {
    for (const end = Date.now() + ms; !condition() && Date.now() < end;) await partyWait(20);
    return condition();
}

/** `seconds` of 8 kHz 8-bit silence as a WAV blob: small, seekable, and it plays muted without a gesture. */
function silentWav(seconds) {
    const samples = 8000 * seconds;
    const bytes = new Uint8Array(44 + samples);
    const view = new DataView(bytes.buffer);
    const text = (at, s) => [...s].forEach((c, i) => { bytes[at + i] = c.charCodeAt(0); });
    text(0, 'RIFF'); view.setUint32(4, 36 + samples, true); text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
    text(36, 'data'); view.setUint32(40, samples, true);
    bytes.fill(128, 44);
    return new Blob([bytes], { type: 'audio/wav' });
}

const PARTY_VIDEO = { site: 'youtube', id: 'dQw4w9WgXcQ' };

async function partyHarness(over = {}) {
    const party = over.party || PARTY_VIDEO;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;width:320px;height:180px;';
    const video = document.createElement('video');
    video.width = 320;
    video.height = 180;
    video.muted = true;
    host.appendChild(video);
    document.body.appendChild(host);
    const url = URL.createObjectURL(silentWav(60));
    video.src = url;
    await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));

    const sent = [];
    const gone = [];
    let onVideo = party;
    const media = window.BB.PartyMedia.createPartyMedia({
        site: party.site,
        getVideo: () => video,
        send: (msg) => sent.push(msg),
        mediaNow: () => onVideo,
        go: (to) => gone.push(to),
        ...over,
    });
    media.attach();

    let seq = 1;
    const vector = (fields) => ({ seq, media: party, paused: true, pos: 0, rate: 1, at: Date.now(), by: 'm2', hold: null, ...fields });
    media.receive({ t: 'welcome', you: 'm1', room: { state: vector({}) } });

    return {
        video, media, sent, gone, url,
        intents: () => sent.filter((msg) => msg.t === 'intent'),
        /** The room moving on, as another member made it. */
        room(fields, extra = {}) {
            seq++;
            media.receive({ t: 'state', ...vector(fields), ...extra });
        },
        ackLast(fields = {}) {
            const last = sent.filter((msg) => msg.t === 'intent').pop();
            seq++;
            media.receive({ t: 'state', ...vector({ by: 'm1', ...fields }), ack: { member: 'm1', id: last.id } });
        },
        get seq() { return seq; },
        moveTo: (next) => { onVideo = next; },
        destroy() {
            media.detach();
            video.pause();
            URL.revokeObjectURL(url);
            host.remove();
        },
    };
}

suite('party media: telling our writes from the user', () => {
    test('a remote play and pause are played, and send nothing back', async () => {
        const h = await partyHarness();
        try {
            h.room({ paused: false });
            assert(await partyUntil(() => !h.video.paused), 'the room said play');
            h.room({ paused: true, pos: h.video.currentTime });
            assert(await partyUntil(() => h.video.paused), 'the room said pause');
            await partyWait(window.BB.PartyMedia.SEEK_DEBOUNCE_MS + 150);
            assertDeepEqual(h.intents(), [], 'our own writes are not intents');
        } finally { h.destroy(); }
    });

    test('a user pause is one intent, built on the vector it was made against', async () => {
        const h = await partyHarness();
        try {
            h.room({ paused: false });
            await partyWait(200);
            h.video.pause();
            await partyWait(100);
            const intents = h.intents();
            assertEqual(intents.length, 1);
            assertEqual(intents[0].op, 'pause');
            assertEqual(intents[0].base, h.seq);
        } finally { h.destroy(); }
    });


    test('scrubbing sends one seek, from where it stopped', async () => {
        const h = await partyHarness();
        try {
            for (const at of [5, 9, 14]) {
                h.video.currentTime = at;
                await partyWait(40);
            }
            await partyWait(window.BB.PartyMedia.SEEK_DEBOUNCE_MS + 150);
            const seeks = h.intents().filter((one) => one.op === 'seek');
            assertEqual(seeks.length, 1);
            assert(Math.abs(seeks[0].pos - 14) < 0.5);
        } finally { h.destroy(); }
    });

    test('a user rate change is an intent', async () => {
        const h = await partyHarness();
        try {
            h.video.playbackRate = 1.5;
            await partyWait(100);
            assertDeepEqual(h.intents().map((one) => [one.op, one.rate]), [['rate', 1.5]]);
        } finally { h.destroy(); }
    });
});

suite('party media: waiting on the authority', () => {
    test('a stale vector does not undo a pause the room has not answered yet', async () => {
        const h = await partyHarness();
        try {
            h.room({ paused: false });
            await partyWait(200);
            h.video.pause();
            await partyWait(100);
            h.room({ paused: false }); // a heartbeat from before our pause reached anyone
            await partyWait(200);
            assert(h.video.paused, 'must stay paused until our intent is answered');
            h.ackLast({ paused: true, pos: h.video.currentTime });
            await partyWait(200);
            assert(h.video.paused);
            assertEqual(h.intents().length, 1, 'and nothing was sent in the meantime');
        } finally { h.destroy(); }
    });

    test('a rejected intent snaps back to the room, even to the vector we already had', async () => {
        const h = await partyHarness();
        try {
            h.room({ paused: false });
            await partyWait(200);
            h.video.pause();
            await partyWait(100);
            const intent = h.intents()[0];
            h.media.receive({ t: 'reject', id: intent.id, why: 'policy' });
            h.media.receive({ t: 'state', seq: h.seq, media: PARTY_VIDEO, paused: false, pos: 0, rate: 1, at: Date.now(), by: 'm2', hold: null });
            await partyWait(200);
            assert(!h.video.paused, 'the host has control: back to playing');
            assertEqual(h.media.status(), 'synced');
        } finally { h.destroy(); }
    });
});


suite('party media: keeping up with the room', () => {
    test('a remote seek lands without echoing back as a seek', async () => {
        const h = await partyHarness();
        try {
            h.room({ pos: 20 });
            // Past the seek debounce, or an echo would not have been sent yet.
            await partyWait(window.BB.PartyMedia.SEEK_DEBOUNCE_MS + 150);
            assert(Math.abs(h.video.currentTime - 20) < 0.5, `landed at ${h.video.currentTime}`);
            assertDeepEqual(h.intents(), []);
        } finally { h.destroy(); }
    });

    test('a little behind is caught up by a rate nudge, which is not an intent', async () => {
        const h = await partyHarness();
        try {
            h.room({ paused: false, pos: 0, at: Date.now() - 700 });
            await partyWait(300);
            assert(h.video.playbackRate > 1, `still at ${h.video.playbackRate}`);
            assert(h.media.stats().nudges >= 1);
            assertEqual(h.media.stats().seeks, 0, 'under a second and a half behind is never a seek');
            assertDeepEqual(h.intents(), []);
        } finally { h.destroy(); }
    });

    test('a nudge is never remembered as the chosen speed', async () => {
        const watching = { video: null };
        const player = window.BB.Player.createPlayer({ getVideoElement: () => watching.video, notify: () => {} });
        const h = await partyHarness({ player });
        watching.video = h.video;
        player.attach();
        try {
            player.desiredRate = 1;
            h.room({ paused: false, pos: 0, at: Date.now() - 700 });
            await partyWait(300);
            assert(h.video.playbackRate > 1, 'nudged');
            assertEqual(player.desiredRate, 1);
        } finally {
            player.detach();
            h.destroy();
        }
    });

    test('the speed keys step the room rate, from the room rate', async () => {
        const held = { step: null };
        const player = { holdRate: (on, options) => { held.step = on ? options.step : null; } };
        const h = await partyHarness({ player });
        try {
            h.room({ paused: false, pos: 0, at: Date.now() - 700 }); // mid-nudge
            await partyWait(300);
            assertEqual(held.step(1), 1.25, 'one rung above the room, not above the nudge');
            assertDeepEqual(h.intents().map((one) => [one.op, one.rate]), [['rate', 1.25]]);
            h.media.detach();
            assertEqual(held.step, null, 'leaving hands the keys back');
        } finally { h.destroy(); }
    });

    test('leaving mid-nudge hands back the room rate', async () => {
        const h = await partyHarness();
        try {
            h.room({ paused: false, pos: 0, at: Date.now() - 700 });
            await partyWait(300);
            h.media.detach();
            assertEqual(h.video.playbackRate, 1);
        } finally { h.destroy(); }
    });
});

suite('party media: which video', () => {
    test('the room moving to another video is followed, by a url built here', async () => {
        const h = await partyHarness();
        try {
            h.room({ media: { site: 'youtube', id: 'aaaaaaaaaaa' } });
            assertDeepEqual(h.gone, ['https://www.youtube.com/watch?v=aaaaaaaaaaa']);
            assertEqual(h.media.status(), 'elsewhere');
        } finally { h.destroy(); }
    });

    test('while on another video, nothing it does is sent to the room', async () => {
        const h = await partyHarness({ followMedia: () => false });
        try {
            h.moveTo({ site: 'youtube', id: 'bbbbbbbbbbb' });
            h.video.currentTime = 12;
            h.video.playbackRate = 2;
            await partyWait(window.BB.PartyMedia.SEEK_DEBOUNCE_MS + 150);
            assertDeepEqual(h.intents(), []);
        } finally { h.destroy(); }
    });

    test('loading another video here moves the room to it, and the load itself is not an intent', async () => {
        const h = await partyHarness();
        try {
            const next = { site: 'youtube', id: 'ccccccccccc' };
            h.moveTo(next);
            h.video.src = h.url; // a new source, as a watch-page navigation gives the player
            h.video.playbackRate = 1.75; // the page putting its remembered rate back mid-load
            await new Promise((resolve) => h.video.addEventListener('loadeddata', resolve, { once: true }));
            await partyWait(100);
            assertDeepEqual(h.intents().map((one) => [one.op, one.media]), [['media', next]]);
        } finally { h.destroy(); }
    });
});

/**
 * Netflix's player API as the page world has it, with a billboard session
 * ahead of the one being watched. Its seek moves the video the way Netflix's
 * does; any other currentTime write is counted, because on Netflix it is
 * error M7375.
 */
function fakeNetflix(video) {
    const calls = [];
    const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    let viaApi = false;
    let direct = 0;
    Object.defineProperty(video, 'currentTime', {
        configurable: true,
        get() { return native.get.call(this); },
        set(value) { if (!viaApi) direct++; native.set.call(this, value); },
    });
    const watching = {
        seek(ms) {
            calls.push(['seek', ms]);
            viaApi = true;
            try { video.currentTime = ms / 1000; } finally { viaApi = false; }
        },
        play() { calls.push(['play']); video.play().catch(() => {}); },
        pause() { calls.push(['pause']); video.pause(); },
    };
    const billboard = { seek() { throw new Error('the billboard is not what is being watched'); } };
    const videoPlayer = {
        getAllPlayerSessionIds: () => ['motion-billboard-1', 'watch-12'],
        getVideoPlayerBySessionId: (id) => (id === 'watch-12' ? watching : billboard),
    };
    window.netflix = { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer }) } } } };
    return {
        calls,
        direct: () => direct,
        remove() {
            delete window.netflix;
            delete video.currentTime;
        },
    };
}

suite('party media: netflix', () => {
    const NETFLIX = { site: 'netflix', id: '81234567' };

    test('a seek goes through the player api, to the session being watched, never currentTime', async () => {
        const h = await partyHarness({ party: NETFLIX });
        const netflix = fakeNetflix(h.video);
        try {
            h.room({ pos: 20 });
            await partyWait(window.BB.PartyMedia.SEEK_DEBOUNCE_MS + 150);
            assertDeepEqual(netflix.calls, [['seek', 20000]]);
            assertEqual(netflix.direct(), 0);
            assertDeepEqual(h.intents(), [], 'the seek we made is not an intent');
        } finally {
            netflix.remove();
            h.destroy();
        }
    });

    test('play and pause go through the api as well', async () => {
        const h = await partyHarness({ party: NETFLIX });
        const netflix = fakeNetflix(h.video);
        try {
            h.room({ paused: false });
            assert(await partyUntil(() => !h.video.paused));
            h.room({ paused: true, pos: h.video.currentTime });
            assert(await partyUntil(() => h.video.paused));
            assertDeepEqual(netflix.calls.map((one) => one[0]).filter((op) => op !== 'seek'), ['play', 'pause']);
            assertDeepEqual(h.intents(), []);
        } finally {
            netflix.remove();
            h.destroy();
        }
    });

    test('with no player api, no seek is made and the party says so; play still works', async () => {
        const statuses = [];
        const h = await partyHarness({ party: NETFLIX, onStatus: (status) => statuses.push(status) });
        try {
            h.room({ pos: 20 });
            await partyWait(100);
            assert(h.video.currentTime < 1, 'never a currentTime write');
            assert(statuses.includes('no-seek'));
            assert(!h.media.canSeek());
            h.room({ paused: false, pos: 0, at: Date.now() });
            assert(await partyUntil(() => !h.video.paused), 'play falls back to the <video>');
        } finally { h.destroy(); }
    });

    test('a nudge netflix puts back sends this member to seek-only, and is not an intent', async () => {
        const h = await partyHarness({ party: NETFLIX });
        const netflix = fakeNetflix(h.video);
        try {
            h.room({ paused: false, pos: 0, at: Date.now() - 700 });
            assert(await partyUntil(() => h.video.playbackRate > 1), 'nudged');
            h.video.playbackRate = 1; // Netflix putting its own rate back
            await partyWait(100);
            assertEqual(h.media.stats().profile, 'seekOnly');
            assertDeepEqual(h.intents(), []);
        } finally {
            netflix.remove();
            h.destroy();
        }
    });
});

suite('party media: readiness', () => {
    const readies = (h) => h.sent.filter((msg) => msg.t === 'ready').map((msg) => (msg.ready ? 'ready' : msg.why));

    test('a stall is not ready, never a pause, and is cleared when the frames come back', async () => {
        const h = await partyHarness();
        try {
            h.room({ paused: false });
            assert(await partyUntil(() => !h.video.paused));
            await partyWait(150); // paused flips at once; the real `playing` comes after
            h.video.dispatchEvent(new Event('waiting'));
            await partyWait(window.BB.PartyMedia.STALL_MS + 150);
            assertDeepEqual(readies(h), ['buffering']);
            h.video.dispatchEvent(new Event('playing'));
            assertDeepEqual(readies(h), ['buffering', 'ready']);
            assertDeepEqual(h.intents(), [], 'a stall is never a pause intent');
        } finally { h.destroy(); }
    });

    test('a hiccup shorter than the threshold is not worth telling the room', async () => {
        const h = await partyHarness();
        try {
            h.room({ paused: false });
            assert(await partyUntil(() => !h.video.paused));
            h.video.dispatchEvent(new Event('waiting'));
            await partyWait(200);
            h.video.dispatchEvent(new Event('playing'));
            await partyWait(window.BB.PartyMedia.STALL_MS);
            assertDeepEqual(readies(h), []);
        } finally { h.destroy(); }
    });

    test('the room holding for someone pauses softly and says who for', async () => {
        const h = await partyHarness();
        try {
            h.room({ paused: false });
            assert(await partyUntil(() => !h.video.paused));
            h.room({ paused: false, hold: { waiting: ['m3'], since: Date.now() } });
            assert(await partyUntil(() => h.video.paused));
            assertEqual(h.media.status(), 'waiting');
            assertDeepEqual(h.intents(), [], 'the pause for a hold is ours, not an intent');
        } finally { h.destroy(); }
    });

    test('an ad is this member\'s alone: not ready, nothing sent, and caught up afterwards', async () => {
        const player = document.createElement('div');
        player.id = 'movie_player';
        document.body.appendChild(player);
        const h = await partyHarness();
        try {
            h.room({ paused: false });
            assert(await partyUntil(() => !h.video.paused));
            player.className = 'ad-showing';
            h.video.dispatchEvent(new Event('timeupdate'));
            assertDeepEqual(readies(h), ['ad'], 'an ad never holds the room, but the room is told');
            h.video.pause(); // skipping about in the ad
            h.video.playbackRate = 2;
            await partyWait(window.BB.PartyMedia.SEEK_DEBOUNCE_MS);
            assertDeepEqual(h.intents(), []);
            player.className = '';
            h.video.dispatchEvent(new Event('timeupdate'));
            assertDeepEqual(readies(h), ['ad', 'ready']);
            // The ad cost it some time, so it is nudged back up to the room —
            // at the room's rate give or take a nudge, not the 2x set in the ad.
            assert(await partyUntil(() => !h.video.paused && Math.abs(h.video.playbackRate - 1) <= 0.08), 'back with the room');
        } finally {
            h.destroy();
            player.remove();
        }
    });
});
