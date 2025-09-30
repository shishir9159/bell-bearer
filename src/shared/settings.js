/**
 * Every persisted setting in one place: its storage key, its default, and how
 * to read/write/observe it.
 *
 * The keys used to be spelled out at each call site — the dashboard wrote them,
 * the content script and background read them — so a default was expressed as
 * `x !== false` in one file and `x === true` in another, and a renamed key had
 * to be found by grep. DEFAULTS below is the schema; everything else derives.
 */
(function (root) {
    'use strict';

    const DEFAULTS = Object.freeze({
        // Shortcuts / playback. `shortcuts` holds only what the user changed —
        // `{ [id]: { enabled?, combo? } }` — see src/shared/keybindings.js.
        shortcuts: {},
        rememberPlaybackSpeed: true,
        showSpeedButtonsInPopup: false,

        // Transcripts
        preferredSubtitleLanguage: 'en',

        // Appearance
        theme: 'light',
        skin: 'default', // 'default' | 'riso' | 'medieval' | 'deco' — see src/shared/skin.js
        syncThemeWithYouTube: false,
        pouchButtonStyle: 'auto', // 'auto' | 'accent' | 'hidden'

        // How wide the toolbar popup asks to be. 'wide' is the two-pane
        // layout at the largest size a browser action popup is allowed;
        // 'compact' is one column with a drill-in. See popup.css.
        popupWidth: 'wide', // 'wide' | 'compact'
        hideInstructions: false,

        // How the dashboard orders its checkpoint cards. Pinned cards float
        // above the order whatever it is — see src/shared/pins.js.
        dashboardSort: 'recent', // 'recent' | 'oldest' | 'title' | 'most'

        // The pouch sheet's "All" rail row covers the channels in the pouch.
        // Turning this on widens it to every channel the account subscribes
        // to; it is remembered so the sheet reopens the way it was left.
        pouchShowAllSubscribed: false,

        // Skim: the search launcher (Shift+F page, Shift+H history, Shift+A
        // actions) and the link hints (Shift+L). Both are off until asked
        // for — they claim bare-Shift letters on every site, so they are not
        // something to switch on for someone without being told. The keys
        // themselves are bindings like any other; see shared/keybindings.js,
        // whose `needs` field points back at these two keys.
        skimMode: false,
        linkHints: false,

        // Browser integration
        markdownContextMenu: true,
        connectToSowon: false,

        // Cookie banners: which of "Always accept" / "Always reject" are
        // added to a site's consent popup. A site remembered either way is
        // answered for you regardless; those sites are data, DATA.cookieSites.
        cookieAcceptButton: true,
        cookieRejectButton: true,

        // Activity tracking. Off by default and nothing is recorded while it
        // is off; turning it on reveals the dashboard's Activity tab.
        trackActivity: false,

        // Chess sites, one set per site; the key names come from
        // src/shared/chess-sites.js — #settingKey for the per-time-control
        // ones, #siteKey for the rest. Per time control:
        //   <site>Warn<Class> / <site>Warn<Class>Seconds — a warning during a
        //     game when the opponent's clock is more than N seconds ahead;
        //   <site>Speak<Class> — every move read aloud as it is played;
        //   <site>LowTime<Class>Seconds — where your own clock counts as low;
        //   <site>Limit<Class> — games of that control allowed in a day.
        // Per site:
        //   <site>SpeakUntimed — read moves aloud in a game with no clock
        //     (Coach, a bot, an analysis board), which no control describes;
        //   <site>LowTime / <site>LowTimeVolume / <site>MuteSiteLowTime — the
        //     low-clock tone, how loud (percent, above 100 amplifies), and
        //     whether the site's own low-time sound is silenced for it;
        //   <site>DailyLimits — whether the per-control daily limits apply.
        chessUsername: '',
        chessWarnBullet: false,
        chessWarnBulletSeconds: 10,
        chessWarnBlitz: false,
        chessWarnBlitzSeconds: 30,
        chessWarnRapid: false,
        chessWarnRapidSeconds: 60,
        chessSpeakBullet: false,
        chessSpeakBlitz: false,
        chessSpeakRapid: false,
        chessSpeakUntimed: false,
        chessLowTime: false,
        chessLowTimeBulletSeconds: 10,
        chessLowTimeBlitzSeconds: 30,
        chessLowTimeRapidSeconds: 60,
        chessLowTimeVolume: 60,
        chessMuteSiteLowTime: false,
        chessDailyLimits: false,
        chessLimitBullet: 10,
        chessLimitBlitz: 6,
        chessLimitRapid: 3,

        lichessUsername: '',
        lichessWarnBullet: false,
        lichessWarnBulletSeconds: 10,
        lichessWarnBlitz: false,
        lichessWarnBlitzSeconds: 30,
        lichessWarnRapid: false,
        lichessWarnRapidSeconds: 60,
        lichessSpeakBullet: false,
        lichessSpeakBlitz: false,
        lichessSpeakRapid: false,
        lichessSpeakUntimed: false,
        lichessLowTime: false,
        lichessLowTimeBulletSeconds: 10,
        lichessLowTimeBlitzSeconds: 30,
        lichessLowTimeRapidSeconds: 60,
        lichessLowTimeVolume: 60,
        lichessMuteSiteLowTime: false,
        lichessDailyLimits: false,
        lichessLimitBullet: 10,
        lichessLimitBlitz: 6,
        lichessLimitRapid: 3,
    });

    const KEYS = Object.freeze(Object.keys(DEFAULTS));

    /** Data keys — not settings, but the same storage area. */
    const DATA = Object.freeze({
        bookmarks: 'youtubeBookmarks',
        topics: 'subscriptionTopics',
        channels: 'subscriptionChannels',
        newVideos: 'newVideos',
        // v2: the entries the first version wrote are not merely stale, they
        // point at the wrong channels — see resolveChannelId in shared/feed.js.
        // A new key is how they are discarded rather than trusted.
        channelIdCache: 'bbChannelIdCache2',

        // Parsed RSS, so the first pouch open after a browser restart is not a
        // cold fetch of every channel. shared/feed.js owns the shape.
        feedCache: 'bbFeedCache',

        // Videos already watched, so the pouch stops offering them back.
        watched: 'bbWatchedVideos',

        // Checkpoint cards the user pinned to the top of the dashboard.
        pinned: 'bbPinnedVideos',

        // The account's own YouTube subscriptions, scraped once and cached —
        // the pouch's "All subscribed" toggle reads this.
        subscribed: 'bbSubscribedChannels',

        // Playlists followed for new entries. shared/playlists.js owns it.
        playlists: 'bbPlaylists',

        // Sites whose cookie banner is accepted without asking.
        // shared/cookie-sites.js owns the shape.
        cookieSites: 'bbCookieSites',

        // chess.com monthly game archives, normalized. shared/chess.js.
        chessCache: 'bbChessArchiveCache',

        // Lichess games, normalized, and how far the export was read. shared/lichess.js.
        lichessCache: 'bbLichessGameCache',

        // Games played today per site and time control, and the extra games
        // granted from the popup. shared/chess-limits.js owns the shape.
        chessLimits: 'bbChessDailyLimits',

        // Trials: a named task and the tab group standing in for it.
        // shared/trials.js owns the shape.
        trials: 'bbTrials',
    });

    function withDefaults(stored, keys) {
        const wanted = keys && keys.length ? keys : KEYS;
        const out = {};
        for (const key of wanted) {
            const value = stored ? stored[key] : undefined;
            out[key] = value === undefined ? DEFAULTS[key] : value;
        }
        return out;
    }

    /**
     * Read settings, filling in defaults. Resolves to defaults rather than
     * rejecting when the extension context has been invalidated (which happens
     * to every content script the moment the extension reloads).
     */
    async function get(keys) {
        const wanted = keys && keys.length ? keys : KEYS;
        try {
            const stored = await chrome.storage.local.get(wanted);
            return withDefaults(stored, wanted);
        } catch (_) {
            return withDefaults(null, wanted);
        }
    }

    async function set(values) {
        try {
            await chrome.storage.local.set(values);
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Call `handler(changedSettings)` when any of `keys` changes, with defaults
     * already applied. Returns an unsubscribe function.
     */
    function watch(keys, handler) {
        const wanted = new Set(keys && keys.length ? keys : KEYS);
        const listener = (changes, area) => {
            if (area !== 'local') return;
            const changed = {};
            let any = false;
            for (const key of Object.keys(changes)) {
                if (!wanted.has(key)) continue;
                const value = changes[key].newValue;
                changed[key] = value === undefined ? DEFAULTS[key] : value;
                any = true;
            }
            if (any) handler(changed);
        };
        try {
            chrome.storage.onChanged.addListener(listener);
        } catch (_) {
            return () => {};
        }
        return () => {
            try { chrome.storage.onChanged.removeListener(listener); } catch (_) { /* context gone */ }
        };
    }

    const Settings = { DEFAULTS, KEYS, DATA, withDefaults, get, set, watch };

    root.BB = root.BB || {};
    root.BB.Settings = Settings;
    if (typeof module !== 'undefined' && module.exports) module.exports = Settings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
