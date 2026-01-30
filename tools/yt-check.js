/**
 * Does the YouTube download still work? Asks YouTube for a known video's
 * streams exactly as src/content/youtube-download.js asks from the page —
 * its CLIENT, its request, its reading of the answer — then the first
 * bytes of the video and the sound it would pick, and says which of those
 * steps broke.
 *
 * yt-dlp keeps the same watch with tests pinned to real videos; this is the
 * one-video version, to run when a download fails, or before trusting a
 * change to CLIENT.
 *
 *   node tools/yt-check.js               Big Buck Bunny, at 1080p
 *   node tools/yt-check.js <id> [lines]  another video, at another quality
 *
 * What the first FAIL has meant before, and the mend:
 *   - no visitor id: ytcfg's spelling moved; update visitorData's pattern.
 *   - the client is not answered (4xx): its version was retired; copy the
 *     client's current row from yt-dlp's yt_dlp/extractor/youtube/_base.py.
 *   - it will not play ("Sign in to confirm you're not a bot"), its streams
 *     have no plain addresses (SABR, or a signature to solve), no MP4 is
 *     offered, or the first bytes are refused (403 — a PO token is now
 *     wanted, as android_vr's were in August 2026): the client is spent.
 *     Switch it, the way yt-dlp switches its defaults: take the first of
 *     _DEFAULT_JSLESS_CLIENTS in _video.py, copy its row into CLIENT, and
 *     check the row says REQUIRE_JS_PLAYER: False with no required GVS PO
 *     token. Those are the only clients a page can use without a JavaScript
 *     challenge solver and BotGuard of its own.
 */
'use strict';

global.BB = {};
const VideoDownload = require('../src/content/video-download.js');
const YoutubeDownload = require('../src/content/youtube-download.js');

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const step = (name, ok, said) => console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${said ? ` — ${said}` : ''}`);

async function main(id = 'aqz-KE-bpKQ', lines = 1080) {
    // The page's visitor id, as the content script reads it from the page.
    const page = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { 'User-Agent': BROWSER, 'Accept-Language': 'en' } });
    const html = await page.text();
    const visitor = YoutubeDownload.visitorData({ scripts: [{ textContent: html }] });
    step('the watch page gives a visitor id', !!visitor, visitor ? '' : 'without one, YouTube asks this IP to prove it is not a bot');

    const { url, init } = YoutubeDownload.playerRequest(id, visitor);
    // Node is not on youtube.com: the page's relative address, and its
    // Origin, which the page sends by itself.
    const response = await fetch(`https://www.youtube.com${url}`, { ...init, headers: { ...init.headers, Origin: 'https://www.youtube.com', 'User-Agent': BROWSER } });
    step(`the ${YoutubeDownload.CLIENT.context.clientName} client is answered`, response.ok, `HTTP ${response.status}`);
    if (!response.ok) return false;
    const answer = await response.json();
    const player = YoutubeDownload.readPlayer(answer);
    step('it will play the video', player.ok, player.ok ? player.title : player.reason);
    if (!player.ok) return false;

    const formats = (answer.streamingData && answer.streamingData.adaptiveFormats) || [];
    const ciphered = formats.filter((one) => !one.url).length;
    step('its streams have plain addresses', formats.length > 0 && ciphered === 0,
        `${formats.length} streams, ${ciphered} without an address (SABR, or a signature to solve)`);
    step('MP4 video and sound are offered', player.video.length > 0 && player.audio.length > 0,
        `${player.video.map((one) => one.label).join(', ')}; ${player.audio.length} sound`);

    const video = VideoDownload.pick(player.video, { p: lines });
    const [audio] = player.audio;
    if (!video || !audio) return false;
    let fine = true;
    for (const [name, stream] of [[`the ${video.label} video`, video], ['the sound', audio]]) {
        // A refusal here, with everything above fine, has meant a GVS PO token is now wanted (android_vr, August 2026).
        const head = await fetch(`${stream.url}&range=0-65535`, { headers: { Origin: 'https://www.youtube.com', 'User-Agent': BROWSER } });
        const bytes = new Uint8Array(await head.arrayBuffer());
        const box = String.fromCharCode(...bytes.subarray(4, 8));
        const open = head.headers.get('access-control-allow-origin');
        step(`${name} is served, to youtube.com`, head.ok && box === 'ftyp' && open === 'https://www.youtube.com',
            `HTTP ${head.status}, starts "${box}", Access-Control-Allow-Origin ${open}`);
        fine = fine && head.ok && box === 'ftyp';
    }
    return fine;
}

main(process.argv[2], Number(process.argv[3]) || 1080)
    .then((ok) => {
        console.log(ok ? '\nThe download should work.' : '\nThe download is broken at the first FAIL — this file\'s header says what that has meant.');
        process.exit(ok ? 0 : 1);
    })
    .catch((error) => {
        console.log(`FAIL  ${error.message}`);
        process.exit(1);
    });
