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
        // Shortcuts / playback
        enableSkipShortcuts: true,
        rememberPlaybackSpeed: true,
        showSpeedButtonsInPopup: false,

        // Transcripts
        preferredSubtitleLanguage: 'en',

        // Appearance
        theme: 'light',
        syncThemeWithYouTube: false,
        pouchButtonStyle: 'auto', // 'auto' | 'accent' | 'hidden'
        hideInstructions: false,

        // Browser integration
        openTabNextToCurrent: false,
        markdownContextMenu: true,
        connectToSowon: false,
        bbTabMoveDebug: false,
    });

    const KEYS = Object.freeze(Object.keys(DEFAULTS));

    /** Data keys — not settings, but the same storage area. */
    const DATA = Object.freeze({
        bookmarks: 'youtubeBookmarks',
        topics: 'subscriptionTopics',
        channels: 'subscriptionChannels',
        newVideos: 'newVideos',
        channelIdCache: 'bbChannelIdCache',
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
