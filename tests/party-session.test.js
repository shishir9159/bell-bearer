/**
 * The whole media path with no network: a real <video>, the media adapter a
 * party tab gets, and the session with its loopback room, joined by a port.
 * A second member is opened straight onto the same room, the way a guest's
 * data channel will be. Reuses party-media.test.js's silent media.
 */

/** Both ends of a runtime port in one page. Each delivers a task later, as a real port does, and a copy, not the object. */
function partyPortPair(name) {
    const ends = [0, 1].map(() => ({ name, heard: [], gone: [] }));
    ends.forEach((end, i) => {
        const other = ends[1 - i];
        Object.assign(end, {
            postMessage: (msg) => {
                const copy = JSON.parse(JSON.stringify(msg));
                setTimeout(() => other.heard.forEach((fn) => fn(copy)));
            },
            disconnect: () => setTimeout(() => other.gone.forEach((fn) => fn())),
            onMessage: { addListener: (fn) => end.heard.push(fn) },
            onDisconnect: { addListener: (fn) => end.gone.push(fn) },
        });
    });
    return ends;
}

async function sessionHarness() {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-9999px;width:320px;height:180px;';
    const video = document.createElement('video');
    video.muted = true;
    box.appendChild(video);
    document.body.appendChild(box);
    const url = URL.createObjectURL(silentWav(60));
    video.src = url;
    await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));

    let loop = null;
    const session = window.BB.PartySession.createSession({
        transports: { loopback: (options) => (loop = window.BB.PartyLoopback.createLoopback(options)) },
    });
    await session.control({ op: 'start', name: 'Ana' });

    const [tab, offscreen] = partyPortPair(window.BB.PartySession.PORT);
    const sent = [];
    const media = window.BB.PartyMedia.createPartyMedia({
        site: 'youtube', getVideo: () => video, mediaNow: () => PARTY_VIDEO, go: () => {},
        send: (msg) => {
            sent.push(msg);
            tab.postMessage(msg);
        },
    });
    tab.onMessage.addListener(media.receive);
    tab.onDisconnect.addListener(() => media.detach());
    session.connect(offscreen);
    media.attach();

    const heard = [];
    const ben = loop.open((msg) => heard.push(msg));
    ben.send({ t: 'hello', v: 1, name: 'Ben' });

    return {
        video, media, session, sent, ben, heard,
        room: () => session.status().state,
        intents: () => sent.filter((msg) => msg.t === 'intent'),
        /** Ben acting on the room as he last saw it. */
        benDoes: (op, extra = {}) => ben.send({ t: 'intent', id: heard.length + 1, base: loop.room.state().seq, op, pos: video.currentTime, at: Date.now(), ...extra }),
        async destroy() {
            await session.control({ op: 'leave' });
            media.detach();
            video.pause();
            URL.revokeObjectURL(url);
            box.remove();
        },
    };
}

/** A session harness for `run`, once the tab is synced; left however it ends. */
async function onSession(run) {
    const h = await sessionHarness();
    try {
        assert(await partyUntil(() => h.media.status() === 'synced'), `status ${h.media.status()}`);
        await run(h);
    } finally {
        await h.destroy();
    }
}

suite('party session: the media path end to end, no network', () => {
    test('the tab joins through the session and puts the room on its video', () => onSession(async (h) => {
        assert(await partyUntil(() => (h.room().media || {}).id === PARTY_VIDEO.id), 'the room took the tab\'s video');
        assertDeepEqual(h.session.status().members.map((m) => m.name), ['Ana', 'Ben']);
    }));

    test('a user play goes round the room once and reaches the other member', () => onSession(async (h) => {
        h.video.play();
        assert(await partyUntil(() => h.room().paused === false), 'the room is playing');
        assert(h.heard.some((msg) => msg.t === 'state' && msg.paused === false), 'Ben was told');
        await partyWait(600);
        assertDeepEqual(h.intents().map((one) => one.op), ['media', 'play'], 'the room\'s answer is not played back as a new intent');
        assert(!h.video.paused, 'and the video is still going');
    }));

    test('another member\'s pause and seek reach the video, and send nothing back', () => onSession(async (h) => {
        h.benDoes('play');
        assert(await partyUntil(() => !h.video.paused), 'Ben pressed play');
        h.benDoes('pause', { pos: 20 });
        assert(await partyUntil(() => h.video.paused && Math.abs(h.video.currentTime - 20) < 0.5, 2500),
            `paused ${h.video.paused} at ${h.video.currentTime}`);
        await partyWait(window.BB.PartyMedia.SEEK_DEBOUNCE_MS + 200);
        assertDeepEqual(h.intents().map((one) => one.op), ['media']);
    }));

    test('leaving lets the tab go', () => onSession(async (h) => {
        await h.session.control({ op: 'leave' });
        assert(await partyUntil(() => h.media.status() === 'left'), `status ${h.media.status()}`);
        h.video.pause();
        await partyWait(100);
        assertDeepEqual(h.intents().map((one) => one.op), ['media'], 'a detached tab sends nothing');
    }));
});
