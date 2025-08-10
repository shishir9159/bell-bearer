/**
 * Netflix's player, from inside the page's own JavaScript world, for the watch
 * party.
 *
 * A party has to seek, and on Netflix the one way that works is the player's
 * own API. Writing the <video>'s currentTime — what every other site takes —
 * throws error M7375 and stops playback. That API hangs off
 * `window.netflix`, which a content script's isolated world cannot see, so
 * the party loader injects this file with `world: 'MAIN'` into the party's tab
 * and nowhere else.
 *
 * It answers `bb:party` with `bb:party:ok` inside the same dispatch — DOM
 * events are synchronous and both worlds listen on one document — so the
 * content script has its answer when its own dispatchEvent returns. Details
 * go across as JSON strings: an object made in one world arrives in the other
 * as null.
 *
 * The path to the player has moved before, so several spellings are tried.
 * When none is there the answer says `seek: false`, and the party carries on
 * with play and pause through the <video> alone.
 */
(function () {
    'use strict';

    if (window.__bbNetflixPage) return;
    window.__bbNetflixPage = true;

    const REQUEST = 'bb:party';
    const ANSWER = 'bb:party:ok';

    const APIS = [
        () => window.netflix.appContext.state.playerApp.getAPI().videoPlayer,
        () => window.netflix.appContext.getPlayerApp().getAPI().videoPlayer,
    ];

    /** The session being watched. Billboards and hover previews run players of their own. */
    function sessionPlayer() {
        for (const way of APIS) {
            let api;
            let ids;
            try {
                api = way();
                ids = api.getAllPlayerSessionIds() || [];
            } catch (_) {
                continue;
            }
            const watching = ids.filter((id) => /watch/i.test(id));
            for (const id of watching.concat(ids.filter((id) => !watching.includes(id)))) {
                let player = null;
                try { player = api.getVideoPlayerBySessionId(id); } catch (_) { /* a session ending under us */ }
                if (player && typeof player.seek === 'function') return player;
            }
        }
        return null;
    }

    function answer(body) {
        document.dispatchEvent(new CustomEvent(ANSWER, { detail: JSON.stringify(body) }));
    }

    document.addEventListener(REQUEST, (event) => {
        let message;
        try { message = JSON.parse(event.detail); } catch (_) { return; }
        if (!message || typeof message.type !== 'string') return;

        const player = sessionPlayer();
        if (!player) return answer({ ok: false, seek: false });
        try {
            if (message.type === 'seek') {
                const ms = Number(message.ms);
                if (!Number.isFinite(ms) || ms < 0) return answer({ ok: false, seek: true });
                player.seek(Math.round(ms));
            } else if (message.type === 'play') {
                player.play();
            } else if (message.type === 'pause') {
                player.pause();
            } else if (message.type !== 'probe') {
                return answer({ ok: false, seek: true });
            }
            answer({ ok: true, seek: true });
        } catch (_) {
            answer({ ok: false, seek: true });
        }
    });
})();
