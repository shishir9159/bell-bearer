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

        // The site launcher's order, as dragged on the dashboard or in
        // Settings — one order for both. Empty is SiteIcons' own order, and a
        // site this does not name yet is shown after the ones it does.
        siteOrder: [],

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

        // Shift+P for the pouch overlay, on YouTube and on X. Off for the
        // same reason as the two above: it claims a bare-Shift letter, which
        // is not something to switch on for someone without being told.
        pouchShortcut: false,

        // Legacy: the daily limit used to be two settings per site, which is
        // why only the two sites with a panel of their own could have one. It
        // is now a list any host can join — DATA.limitSites, kept by
        // src/shared/limit-sites.js, which reads these four once to seed it
        // and nothing reads them after that. They stay in the schema so that
        // seed has something to find; no control is bound to them.
        twitterDailyLimit: false,
        twitterLimitMinutes: 30,

        // Strip X's promoted posts and its own Premium upsells out of the
        // timeline. Off until asked for: this is the extension rewriting
        // somebody else's page, which is not a default to assume.
        twitterHideAds: false,

        // The three things Bell Bearer puts into x.com's own chrome, each off
        // until it is asked for. The pouch itself is always there — the row in
        // the navigation, the panel it opens, the dashboard behind it — and
        // what these govern is the extension reaching into somebody else's
        // page, which is not a default to assume for anyone.
        //
        // Standing X's bookmark down is a setting of its own rather than
        // something the post button does on its way in. The two used to be one
        // decision, and either half is a reasonable thing to want without the
        // other: a pouch button beside the bookmark, or the bookmark gone with
        // nothing put in its place.
        twitterHideBookmark: false,
        twitterPouchPeople: false,
        twitterPouchPosts: false,

        redditDailyLimit: false,
        redditLimitMinutes: 30,

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

        // LeetCode. The two that are on by default only watch — the timer is
        // LeetCode's own, started rather than drawn, and the grade prompt is
        // the one question the whole review schedule depends on, so a log
        // that never asked it would collect attempts and schedule nothing.
        // The three that reach further into the page are off until asked for,
        // the same rule the X surfaces follow.
        // The username whose submission calendar the practice heat map draws.
        // Empty means the map falls back to what Bell Bearer watched itself,
        // which starts the day it was installed. See shared/leet-api.js.
        leetUsername: '',
        leetStartTimer: true,
        leetGradePrompt: true,
        leetNoteButton: false,
        // Target retention as a percent. Below 70 the intervals grow faster
        // than anyone actually remembers at; above 97 they barely grow at all
        // and every problem comes back tomorrow.
        leetRetention: 90,
        leetMaxInterval: 365,
        leetMockMode: false,
        leetMockMinutes: 35,

        // TypeRacer. Unlike the X and LeetCode surfaces this one is on by
        // default, because it puts nothing into somebody else's page: it
        // listens to keystrokes that are already happening and writes the
        // shape of them to a store of our own. Nothing is recorded while it
        // is off, and turning it off stops the race already in progress
        // rather than waiting for the next page.
        typerTrack: true,

        // A sound as you type. Off until asked for — a page that starts
        // making noises on its own is not a default to assume for anyone —
        // and synthesised rather than played from a file, so there is nothing
        // to load before the first keystroke can click. See shared/sfx.js.
        // The volume is a percent and above 100 it really is louder, the same
        // way the chess low-clock tone works; at 0 the whole sound path is
        // skipped rather than played silently.
        typerSound: false,
        typerSoundVoice: 'click', // one of Sfx.KEY_VOICE_IDS
        typerSoundVolume: 50,
        // On, but only heard when the above is: a wrong key is the one thing
        // worth interrupting for, and it is the sound people turn the rest
        // off and keep.
        typerErrorSound: true,

        // The typing caret — the marker showing where you are in the quote,
        // not the mouse pointer. 'site' draws nothing and leaves TypeRacer's
        // own, which is the default because replacing something a site
        // already does is not a default to assume for anyone.
        typerCaret: 'site', // 'site' | 'bar' | 'block' | 'underline' | 'outline'
        typerCaretSmooth: true,
        // Off, and it is the one of the three that is off on purpose: a caret
        // blinking while you read ahead of it is exactly the distraction the
        // rest of this setting exists to remove.
        typerCaretBlink: false,

        // How many readings a letter pair needs before its mean is shown as
        // a weak spot rather than hidden as noise. Below three there is no
        // mean worth the name — one slow morning is the whole figure.
        typerMinSamples: 8,

        // The YouTube reader (src/content/reader.js). What it opens in and
        // how its transcript column reads; the player's size in each layout
        // is set by dragging, so it lives in DATA.readerSizes rather than
        // here, where a control would have nothing to bind to.
        //
        // Whether the transcript scrolls itself to the line being spoken.
        // Scrolling it yourself still pauses this for a few seconds.
        readerFollow: true,
        // Selecting transcript text saves it as a checkpoint straight away,
        // with an Undo. Off, the same selection offers a Save button instead.
        readerAutoCheckpoint: true,
        // The layout a new reader opens in; switching in the reader itself
        // updates it. One of Reader.LAYOUT_IDS.
        readerLayout: 'split', // 'split' | 'stacked' | 'theatre' | 'focus'
        // The transcript column's type: size in px, leading as a multiple,
        // and measure — the width of a line — in em. The ranges the controls
        // offer are the ones Reader.TYPE clamps to.
        readerFontSize: 16,
        readerLineHeight: 1.6,
        readerLineWidth: 44,
        // The reader covers YouTube's header as well as the page. Off, it
        // starts under the header instead, so search stays in reach.
        readerHideChrome: true,
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

        // Your own roster on a site: the accounts followed on Twitter, the
        // subreddits joined. Read off the site's own pages, and the list a
        // text file is written from. shared/roster.js owns the shape.
        rosters: 'bbRosters',

        // The read or apply job in flight, if there is one. It lives in
        // storage rather than in a page because applying a list *is* a
        // sequence of navigations, each of which ends the script that
        // started it. shared/roster.js owns the shape.
        rosterJob: 'bbRosterJob',

        // Sites held to a daily limit, and what each limit is — a budget in
        // minutes or a pair of clock times. shared/limit-sites.js owns the
        // shape, and is also where the four legacy keys below are read from
        // once, to seed this list for anyone who already had a limit set.
        limitSites: 'bbLimitSites',

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

        // Seconds spent on x.com and reddit.com today, and nothing older
        // than today. shared/time-limits.js owns the shape.
        timeLimits: 'bbTimeLimits',

        // The X pouch. People and posts keep two independent topic lists, so
        // these are four keys rather than the two the YouTube pouch needs —
        // see shared/x-pouch.js, which owns all four shapes.
        xPeopleTopics: 'bbXPeopleTopics',
        xPostTopics: 'bbXPostTopics',
        xPeople: 'bbXPeople',
        xPosts: 'bbXPosts',

        // The LeetCode practice log: one record per problem — its note, its
        // attempts and its review schedule — and one bucket per day for the
        // heat map. Two keys because they age differently; a problem is kept
        // for as long as you care about it and a day bucket for a year.
        // shared/leetcode.js owns both shapes.
        leetProblems: 'bbLeetProblems',
        leetDays: 'bbLeetDays',

        // Code templates for LeetCode's editor, in display order. Written by
        // the user — nothing ships with the extension. shared/leet-templates.js
        // owns the shape.
        leetTemplates: 'bbLeetTemplates',

        // LeetCode's own submission calendar for the past year, as its public
        // GraphQL endpoint reports it, with the day it was fetched.
        // shared/leet-api.js owns the shape.
        leetCalendar: 'bbLeetCalendar',

        // TypeRacer. Three keys rather than one, because they age at three
        // different rates: a race is a row in a table and two hundred of
        // them is the history worth keeping, the n-gram tables are a rolling
        // aggregate that never expires but is capped, and a day bucket is
        // three numbers for a square on a heat map. Raw keystrokes are never
        // stored at all — a race is about three hundred of them and a hundred
        // races would be thirty thousand rows, which chrome.storage.local is
        // not. shared/typeracer.js owns all three shapes.
        typerRaces: 'bbTyperRaces',
        typerGrams: 'bbTyperGrams',
        typerDays: 'bbTyperDays',

        // The YouTube reader's player size, one percentage per layout, set
        // by dragging and so not a setting a control could bind to. Shape
        // owned by src/content/reader.js — see readSizes there.
        readerSizes: 'bbReaderSizes',
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
