/**
 * Specs for several Netflix subtitles at once (src/content/netflix-subs.js),
 * against a stand-in for Netflix's player — its class names, its own
 * subtitle layer — around a real <video> playing silence, laid out with
 * content-netflix.css, which is what decides where each line ends up.
 */

const nfWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nfFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

async function nfUntil(condition, ms = 1500) {
    for (const end = Date.now() + ms; !condition() && Date.now() < end;) await nfWait(20);
    return condition();
}

/** `seconds` of 8 kHz 8-bit silence, as a WAV blob. */
function nfSilence(seconds) {
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

const NF_FILES = {
    'https://nf.test/en': 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nDid you leave the lantern on?\n\n'
        + '00:00:04.000 --> 00:00:06.000\nNo — I thought you had it.\nIt was by the door.\n',
    'https://nf.test/es': '<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000"><body><div>'
        + '<p begin="10000000t" end="30000000t">¿Dejaste la linterna encendida?</p>'
        + '<p begin="40000000t" end="60000000t">No, creí que la tenías tú.<br/>Estaba junto a la puerta.</p>'
        + '</div></body></tt>',
};

const NF_TRACKS = [
    { id: 'en', language: 'en', kind: 'subtitles', forced: false, url: 'https://nf.test/en' },
    { id: 'es', language: 'es', kind: 'subtitles', forced: false, url: 'https://nf.test/es' },
    { id: 'de-forced', language: 'de', kind: 'subtitles', forced: true, url: 'https://nf.test/en' },
    { id: 'ko', language: 'ko', kind: 'subtitles', forced: false, url: null },
];

async function nfStage({ languages = 'en es', layout = 'stack', answer = NF_TRACKS } = {}) {
    let css = document.querySelector('link[data-nf-spec]');
    if (!css) {
        css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = '../content-netflix.css';
        css.dataset.nfSpec = '';
        document.head.appendChild(css);
        await new Promise((resolve) => { css.onload = resolve; css.onerror = resolve; });
    }
    const host = document.createElement('div');
    host.className = 'watch-video';
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:640px;height:360px;';
    host.innerHTML = '<div class="watch-video--player-view" style="position:absolute;inset:0">'
        + '<div data-uia="video-canvas" style="position:absolute;inset:0"><video muted style="width:100%;height:100%"></video></div>'
        + '<div class="player-timedtext" style="position:absolute;inset:0">'
        + '<div class="player-timedtext-text-container" style="position:absolute;left:10%;right:10%;bottom:10%;font-size:16px"></div></div>'
        + '<div class="controls" style="position:absolute;left:0;right:0;bottom:0;height:12%"></div></div>';
    document.body.appendChild(host);
    const video = host.querySelector('video');
    video.src = URL.createObjectURL(nfSilence(20));
    await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));

    const settings = { netflixSubs: true, netflixSubsLanguages: languages, netflixSubsLayout: layout };
    const told = [];
    let announce = null;
    const watcher = window.BB.DomWatch.createWatcher();
    const subs = window.BB.NetflixSubs.createNetflixSubs({
        view: window.BB.NetflixSubsView.createView({ watcher, getVideoElement: () => video }),
        getSettings: () => settings,
        notify: (message) => told.push(message),
        ask: () => (answer ? { movieId: '81', tracks: answer } : { movieId: '81', tracks: null }),
        listen: (handler) => { announce = handler; },
        fetchText: async (url) => NF_FILES[url],
        pathname: () => '/watch/81',
    });
    subs.install();

    const own = host.querySelector('.player-timedtext');
    const ownText = host.querySelector('.player-timedtext-text-container');
    const rows = () => [...host.querySelectorAll('.bb-nf-track')].map((row) => [row.lang, row.textContent]);
    const box = (lang) => host.querySelector(`.bb-nf-track[lang="${lang}"]`).getBoundingClientRect();
    async function at(seconds) {
        video.currentTime = seconds;
        await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
        await nfFrames();
    }
    return {
        host, video, settings, subs, told, own, ownText, rows, box, at,
        announce: (message) => announce(message),
        destroy() { watcher.stop(); host.remove(); document.querySelectorAll('style').forEach((one) => { if (one.textContent.includes('.player-timedtext { visibility')) one.remove(); }); },
    };
}

suite('netflix — several subtitles at once', () => {
    test('each language is drawn in time with the video, beside netflix\'s own layer, which is hidden', async () => {
        const s = await nfStage();
        try {
            await nfUntil(() => s.host.querySelector('.bb-nf-subs'));
            await s.at(1.5);
            assertDeepEqual(s.rows(), [['en', 'Did you leave the lantern on?'], ['es', '¿Dejaste la linterna encendida?']]);
            assert(s.own.nextElementSibling.classList.contains('bb-nf-subs'), 'not beside Netflix\'s layer, under its controls');
            assertEqual(getComputedStyle(s.own).visibility, 'hidden');
            await s.at(3.5);
            assertDeepEqual(s.rows(), [['en', ''], ['es', '']], 'between cues');
            await s.at(4.5);
            assertEqual(s.host.querySelectorAll('.bb-nf-track[lang="es"] br').length, 1, 'the TTML line break');
        } finally { s.destroy(); }
    });

    test('stacked, a language wrapping to two lines moves neither the other nor itself', async () => {
        const s = await nfStage();
        try {
            await nfUntil(() => s.host.querySelector('.bb-nf-subs'));
            await s.at(1.5);
            const [en1, es1] = [s.box('en'), s.box('es')];
            await s.at(4.5);
            const [en2, es2] = [s.box('en'), s.box('es')];
            assert(en2.height > en1.height * 1.5 && es2.height > es1.height * 1.5, 'both should be two lines now');
            assertEqual(Math.round(en2.bottom), Math.round(en1.bottom), 'the first language\'s last line moved');
            assertEqual(Math.round(es2.top), Math.round(es1.top), 'the second language\'s first line moved');
            assert(en1.bottom <= es1.top, 'the first is above the second');
        } finally { s.destroy(); }
    });

    test('switched off, the block goes and netflix\'s own comes back', async () => {
        const s = await nfStage();
        try {
            await nfUntil(() => s.host.querySelector('.bb-nf-subs'));
            s.settings.netflixSubs = false;
            await s.subs.sync();
            assert(!s.host.querySelector('.bb-nf-subs'), 'the block stayed');
            assertEqual(getComputedStyle(s.own).visibility, 'visible');
            assert(!s.subs.isShowing());
        } finally { s.destroy(); }
    });

    test('a language the title lacks is said once; a forced track or a picture is never used', async () => {
        const s = await nfStage({ languages: 'en ko de' });
        try {
            await nfUntil(() => s.host.querySelector('.bb-nf-subs'));
            await s.at(1.5);
            assertDeepEqual(s.rows().map((row) => row[0]), ['en']);
            assertDeepEqual(s.told, ['No ko or de subtitles on this title']);
            s.settings.netflixSubsLanguages = 'ko en';
            await s.subs.sync();
            s.settings.netflixSubsLanguages = 'en ko de';
            await s.subs.sync();
            assertEqual(s.told.length, 1, 'said again');
        } finally { s.destroy(); }
    });

    test('tracks the page hands over after it was first asked are picked up', async () => {
        const s = await nfStage({ answer: null });
        try {
            await nfWait(100);
            assert(!s.host.querySelector('.bb-nf-subs'), 'drew with no tracks');
            s.announce({ movieId: '81', tracks: NF_TRACKS });
            await nfUntil(() => s.host.querySelector('.bb-nf-subs'));
            await s.at(1.5);
            assertDeepEqual(s.rows().map((row) => row[0]), ['en', 'es']);
        } finally { s.destroy(); }
    });
});
