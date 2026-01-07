/**
 * Reports what the user is looking at to a locally running sowon timer.
 *
 * Two things keep this from becoming a nuisance:
 *
 *  - A debounce. The triggers (tab activated, window focused, title changed,
 *    load completed, tab group renamed) fire in bursts — opening a page can
 *    produce half a dozen within a second, and each one used to be its own
 *    localhost POST.
 *  - A backoff. With the integration enabled but sowon not running, every
 *    trigger was a doomed fetch. After a few consecutive failures we retry at
 *    most once a minute; the first success clears it.
 *
 * Backoff state is in memory only. An MV3 worker restart resets it, which just
 * means one probe on wake.
 */
(function () {
    'use strict';

    const { Settings } = globalThis.BB;

    const FOCUS_URL = 'http://127.0.0.1:41414/bellbearer.FocusService/ReportFocus';

    /** Collapse a burst of focus events into one report per window. */
    const THROTTLE_MS = 150;

    const MAX_FAILURES = 3;
    const BACKOFF_MS = 60000;

    let failures = 0;
    let nextAttempt = 0;
    let lastRun = 0;
    let trailingTimer = 0;

    /** Skip a report identical to the last one that actually went out. */
    let lastSent = '';

    async function activeTab() {
        try {
            const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            return (tabs && tabs[0]) || null;
        } catch (_) {
            return null;
        }
    }

    /** The tab's group title, or '' when it has none (or on Firefox). */
    async function groupTitle(tab) {
        if (!chrome.tabGroups || tab.groupId == null || tab.groupId === -1) return '';
        try {
            const group = await chrome.tabGroups.get(tab.groupId);
            return (group && group.title) || '';
        } catch (_) {
            return ''; // the group vanished between events
        }
    }

    /** chrome:// pages and the like have no domain, and answer ''. */
    const domainOf = (tab) => globalThis.BB.Hosts.of(tab.url || tab.pendingUrl || '');

    /**
     * Whether sowon is wanted, read once and again only after it changes:
     * this runs on every tab switch, title change and window focus, and it
     * used to go to storage for the answer each time.
     */
    let wanted = null;
    Settings.watch(['connectToSowon'], () => { wanted = null; });
    async function enabled() {
        if (wanted === null) wanted = (await Settings.get(['connectToSowon'])).connectToSowon === true;
        return wanted;
    }

    async function send() {
        if (failures >= MAX_FAILURES && Date.now() < nextAttempt) return;
        if (!(await enabled())) return;

        const tab = await activeTab();
        if (!tab || !tab.title) return;

        const group = await groupTitle(tab);
        const domain = domainOf(tab);

        const signature = `${group}\u0000${tab.title}\u0000${domain}`;
        if (signature === lastSent) return;

        try {
            await fetch(FOCUS_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/grpc-web+proto',
                    'X-Grpc-Web': '1',
                },
                body: encodeFocusUpdateFrame(group, tab.title, domain),
            });
            failures = 0; // sowon is up — resume the normal cadence
            lastSent = signature;
        } catch (_) {
            failures++;
            nextAttempt = Date.now() + BACKOFF_MS;
        }
    }

    /**
     * Leading-edge throttle: report the first event straight away — sowon should
     * see a focus change without a delay — then suppress the rest of the burst,
     * with one trailing call so the state we end on is the state we report.
     */
    function reportFocus() {
        const now = Date.now();
        const elapsed = now - lastRun;

        if (elapsed >= THROTTLE_MS) {
            lastRun = now;
            send();
            return;
        }
        if (trailingTimer) return;
        trailingTimer = setTimeout(() => {
            trailingTimer = 0;
            lastRun = Date.now();
            send();
        }, THROTTLE_MS - elapsed);
    }

    chrome.tabs.onActivated.addListener(reportFocus);
    chrome.windows.onFocusChanged.addListener(reportFocus);
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        // Only the active tab, and only for changes that alter what is on screen.
        if (tab && tab.active && (changeInfo.title || changeInfo.status === 'complete')) {
            reportFocus();
        }
    });
    if (chrome.tabGroups) {
        chrome.tabGroups.onUpdated.addListener(reportFocus);
    }

    globalThis.BB.Sowon = { report: reportFocus, FOCUS_URL };
})();
