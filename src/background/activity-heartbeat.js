/**
 * Drives the activity store.
 *
 * BB.Activity is passive: it buckets whatever it is handed and works out the
 * elapsed time itself. Something has to hand it the focused tab on a regular
 * beat, and in MV3 that cannot be a setInterval — the worker is suspended a few
 * seconds after it goes idle and the timer dies with it. An alarm survives
 * that, waking the worker to take each reading.
 *
 * `tick` credits the gap since the previous reading to whatever was focused
 * *then*, so a suspended worker cannot inflate a total, and a gap longer than
 * the store's idle threshold is dropped rather than counted as time at the
 * screen. Nothing is recorded at all while `trackActivity` is off — and, since
 * the alarm below only exists while it is on, nothing is woken either.
 */
(function (root) {
    'use strict';

    const Activity = root.BB && root.BB.Activity;
    if (!Activity) {
        console.error('Bell Bearer: activity store failed to load');
        return;
    }

    const Settings = root.BB && root.BB.Settings;
    const Router = root.BB && root.BB.Router;
    const ALARM = 'bb-activity';

    /**
     * 30 seconds. Chrome clamps a periodic alarm to a 30-second floor and
     * Firefox to a minute, so a shorter period is a number the browser quietly
     * ignores; asking for 15s only made the code claim a resolution it never
     * had. The store measures wall time, so the period bounds nothing but how
     * finely the "longest single page" figure is attributed.
     */
    const PERIOD_MINUTES = 0.5;

    // chrome.alarms is absent unless the permission is granted; guard so a
    // trimmed-down build degrades to "no activity data" instead of throwing.
    if (!chrome.alarms) return;

    /**
     * Keep the alarm's existence tied to the setting.
     *
     * It used to be created unconditionally on every worker start, which was
     * wrong twice over. It woke the worker twice a minute for the whole life
     * of the browser to run a tick that returned immediately, for a setting
     * that is off by default. And creating an alarm that already exists
     * restarts its schedule — so on a busy browser, where anything from a tab
     * update to a context-menu click starts the worker, the next reading was
     * pushed 30 seconds further out each time and could go a long while
     * without ever landing.
     */
    async function sync(on) {
        try {
            if (!on) {
                await chrome.alarms.clear(ALARM);
                await Activity.blur();
                return;
            }
            const existing = await chrome.alarms.get(ALARM);
            if (!existing || existing.periodInMinutes !== PERIOD_MINUTES) {
                chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES });
            }
        } catch (_) {
            // Alarms went away under us; the next worker start tries again.
        }
    }

    Router.alarm(ALARM, async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            await Activity.tick(tab);
        } catch (_) {
            // No focused window, or the tab went away mid-query. Skipping a
            // reading is harmless: the next tick measures from now.
        }
    });

    // Losing window focus means the screen time stops here rather than running
    // on until the next tick.
    if (chrome.windows && chrome.windows.onFocusChanged) {
        chrome.windows.onFocusChanged.addListener((windowId) => {
            if (windowId === chrome.windows.WINDOW_ID_NONE) Activity.blur();
        });
    }

    // Read the setting on every worker start, and follow it from there: the
    // dashboard toggle has to start and stop the beat without a reload.
    if (Settings && Settings.get) {
        Settings.get([Activity.SETTING]).then((values) => sync(!!values[Activity.SETTING]));
        if (Settings.watch) Settings.watch([Activity.SETTING], (changed) => sync(!!changed[Activity.SETTING]));
    } else {
        sync(true);
    }

    root.BB.ActivityHeartbeat = { ALARM, PERIOD_MINUTES, sync };
})(typeof globalThis !== 'undefined' ? globalThis : this);
