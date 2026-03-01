/**
 * Several of a Netflix episode's subtitles at once — say the language spoken
 * and one you read: which tracks, and their cues.
 *
 * Netflix draws one subtitle at a time, so these are not Netflix's. The track
 * list comes from src/content/netflix-subs-page.js, which reads it in the
 * page's world as the player loads it; each language asked for in Settings ›
 * Netflix is matched to a track, its file fetched and read into cues
 * (src/shared/subtitles.js), and the lot handed to the view
 * (src/content/netflix-subs-view.js) to draw.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Bridge = ns.Bridge || req('./bridge.js');
    const Subtitles = ns.Subtitles || req('../shared/subtitles.js');

    /** Languages at most: past three, the block covers more of the picture than it leaves. */
    const MAX_LANGUAGES = 3;

    /** The languages a setting names, in order: `ja en`, `es, pt-BR`. Unknown tokens and repeats are dropped. */
    function languagesOf(value) {
        const out = [];
        for (const token of String(value || '').split(/[\s,;]+/)) {
            if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(token)) continue;
            if (!out.some((one) => one.toLowerCase() === token.toLowerCase())) out.push(token);
        }
        return out.slice(0, MAX_LANGUAGES);
    }

    /**
     * The track to show for `wanted`: the language exactly, else the bare
     * base language, else another of its regions — `pt-PT` takes `pt` before
     * `pt-BR`, and `pt` takes `pt-BR` when that is all there is. A track with
     * a text file to fetch, never a forced one — that is only the
     * foreign-language lines — and subtitles over captions, whose [sounds]
     * would double up beside a second language.
     */
    function pick(tracks, wanted) {
        const base = (code) => String(code).toLowerCase().split('-')[0];
        const usable = (tracks || []).filter((track) => track && track.url && !track.forced);
        const closeness = (language) => {
            const code = language.toLowerCase();
            if (code === wanted.toLowerCase()) return 0;
            return code === base(wanted) ? 1 : 2;
        };
        const rank = (track) => (closeness(track.language) * 2) + (track.kind === 'subtitles' ? 0 : 1);
        return usable
            .filter((track) => base(track.language) === base(wanted))
            .sort((a, b) => rank(a) - rank(b))[0] || null;
    }

    function createNetflixSubs({
        view,
        getSettings,
        notify = () => {},
        ask = (message) => Bridge.ask('bb:netflix:subs', message, 'bb:netflix:subs:ok'),
        listen = (handler) => Bridge.listen('bb:netflix:tracks', handler),
        fetchText = (url) => fetch(url, { credentials: 'omit' }).then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        }),
        pathname = () => root.location.pathname,
    }) {
        /** Each title's tracks, by movie id, as the page announced or answered them. */
        const titles = new Map();
        /** Each track's cues, as a promise, by its address. */
        const files = new Map();
        /** Languages already reported missing on a title, so it is said once. */
        const reported = new Set();
        /** The title and languages on screen; a different one starts over. */
        let wantKey = '';

        const movieId = () => {
            const match = /^\/watch\/(\d+)/.exec(String(pathname() || ''));
            return match ? match[1] : null;
        };

        function cuesOf(track) {
            if (!files.has(track.url)) {
                files.set(track.url, fetchText(track.url).then(Subtitles.parse).catch(() => {
                    files.delete(track.url); // a later look may fare better
                    return [];
                }));
            }
            return files.get(track.url);
        }

        function tracksFor(id) {
            if (!titles.has(id)) {
                const answer = ask({ type: 'tracks', movieId: id });
                if (answer && Array.isArray(answer.tracks)) titles.set(id, answer.tracks);
            }
            return titles.get(id) || null;
        }

        /** Settings, the address or the track list changed: work out what to draw. */
        async function sync() {
            const settings = getSettings();
            view.setLayout(settings.netflixSubsLayout);
            const id = settings.netflixSubs === true ? movieId() : null;
            const wanted = languagesOf(settings.netflixSubsLanguages);
            const tracks = id && wanted.length ? tracksFor(id) : null;
            const key = tracks ? `${id}|${wanted.join(' ')}` : '';
            if (key === wantKey) return;
            wantKey = key;
            if (!key) return view.show([]);

            const chosen = wanted.map((language) => ({ language, track: pick(tracks, language) }));
            const missing = chosen.filter((one) => !one.track && !reported.has(`${id}|${one.language}`));
            missing.forEach((one) => reported.add(`${id}|${one.language}`));
            if (missing.length) {
                notify(`No ${missing.map((one) => one.language).join(' or ')} subtitles on this title`, 'info', 4000);
            }
            const loaded = await Promise.all(chosen.filter((one) => one.track)
                .map(async ({ track }) => ({ track, cues: await cuesOf(track) })));
            if (key !== wantKey) return; // moved on while the files came
            view.show(loaded.filter((one) => one.cues.length));
        }

        function install() {
            listen((message) => {
                if (!message || typeof message.movieId !== 'string' || !Array.isArray(message.tracks)) return;
                titles.set(message.movieId, message.tracks);
                if (message.movieId === movieId()) {
                    wantKey = '';
                    sync();
                }
            });
            view.install();
            sync();
        }

        return { install, sync, isShowing: () => view.isShowing() };
    }

    const NetflixSubs = { createNetflixSubs, languagesOf, pick, MAX_LANGUAGES };

    root.BB = root.BB || {};
    root.BB.NetflixSubs = NetflixSubs;
    if (typeof module !== 'undefined' && module.exports) module.exports = NetflixSubs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
