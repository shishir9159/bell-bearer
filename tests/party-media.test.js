/**
 * Specs for the party's media adapter, against a real <video> playing real
 * (silent) media — the echo problem is about the order a browser queues media
 * events in, which nothing but a browser reproduces.
 */

const partyWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const media = window.BB.PartyMedia.createPartyMedia({
        getVideo: () => video,
        send: (msg) => sent.push(msg),
        ...over,
    });
    media.attach();

    let seq = 1;
    const vector = (fields) => ({ seq, media: PARTY_VIDEO, paused: true, pos: 0, rate: 1, at: Date.now(), by: 'm2', hold: null, ...fields });
    media.receive({ t: 'welcome', you: 'm1', room: { state: vector({}) } });

    return {
        video, media, sent,
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
            await partyWait(200);
            assert(!h.video.paused, 'the room said play');
            h.room({ paused: true, pos: h.video.currentTime });
            await partyWait(200);
            assert(h.video.paused, 'the room said pause');
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
