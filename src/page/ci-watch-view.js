/**
 * A forge's page in the dashboard: what is being watched on it right now,
 * filled into `[data-ci-watches="<forge id>"]`.
 *
 * The watches are the worker's (src/background/ci-watch.js), kept by tab in
 * storage.session. This lists the ones on its forge and brings a watched tab
 * forward when asked. It cannot say how a run stands — reading a run is the
 * tab's job, and the dashboard has no session on the forge — so a row says
 * what is watched and since when. The rows reuse the chat panels' list
 * styles, which are the dashboard's list styles in all but name.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { ForgeSites, Dom, Time } = BB;

    /** The worker's key; the worker is not loaded on this page, and a node check holds the two together. */
    const KEY = 'bbCiWatches';

    const esc = Dom.escapeHtml;
    const att = Dom.escapeAttr;

    /** One forge's watches, the newest first: [{ tab, key, noun, label, repo, since }]. */
    function listFor(siteId, watches) {
        return Object.entries(watches || {})
            .filter(([, watch]) => watch && String(watch.key || '').startsWith(`${siteId}:`))
            .map(([tab, watch]) => ({ ...watch, tab: Number(tab) }))
            .sort((a, b) => (Number(b.since) || 0) - (Number(a.since) || 0));
    }

    function render(siteId, list, now = Date.now()) {
        const site = ForgeSites.get(siteId);
        const rows = list.map((watch) => `
            <div class="chat-view-row" data-ci-tab="${att(String(watch.tab))}">
                <div class="chat-view-main">
                    <span class="chat-view-title">${esc(watch.label || watch.key)}</span>
                    <span class="chat-view-sub">${esc(watch.noun || 'Run')} · ${esc(watch.repo || '')} · watched since ${esc(Time.relativeTime(watch.since, now) || 'just now')}</span>
                </div>
                <div class="chat-view-actions"><button type="button" class="btn-small" data-ci-show="1">Show tab</button></div>
            </div>`).join('');
        return `
            <div class="subscriptions-header"><h2>Watching</h2></div>
            <p class="x-pouch-hint">Runs and checks on ${esc(site.name)} with a watch on them, each in its open tab. A desktop
               notification comes when one finishes; closing its tab ends the watch.</p>
            <div class="chat-view-list">${rows || `<div class="empty-inline"><span>Nothing on ${esc(site.name)} is being watched.
                Turn on the Watch button in its settings, then click Watch on ${esc(site.watches)}.</span>
                <button type="button" class="btn-small" data-open-settings="${att(siteId)}">Settings</button></div>`}</div>`;
    }

    function mountWatches(host, siteId, api = root.chrome) {
        async function reload() {
            let watches = {};
            try { watches = (await api.storage.session.get(KEY))[KEY] || {}; } catch (_) { /* none to show */ }
            host.innerHTML = render(siteId, listFor(siteId, watches));
        }

        host.addEventListener('click', async (event) => {
            const show = event.target.closest('[data-ci-show]');
            if (!show) return;
            const tabId = Number(show.closest('[data-ci-tab]').dataset.ciTab);
            try {
                const tab = await api.tabs.update(tabId, { active: true });
                await api.windows.update(tab.windowId, { focused: true });
            } catch (_) {
                reload(); // closed since, and the worker has let its watch go
            }
        });

        return { reload };
    }

    function mountAll(scope = document, api = root.chrome) {
        const views = [];
        scope.querySelectorAll('[data-ci-watches]').forEach((host) => {
            if (!ForgeSites.get(host.dataset.ciWatches)) return;
            const view = mountWatches(host, host.dataset.ciWatches, api);
            view.reload();
            views.push(view);
        });
        // A watch started, or ended, in a tab while this page is open.
        try {
            api.storage.onChanged.addListener((changes, area) => {
                if (area === 'session' && KEY in changes) views.forEach((view) => view.reload());
            });
        } catch (_) { /* nothing will move it, then */ }
    }

    const CiWatchView = { KEY, listFor, render, mountWatches, mountAll };

    BB.CiWatchView = CiWatchView;
    if (typeof module !== 'undefined' && module.exports) module.exports = CiWatchView;
})(typeof globalThis !== 'undefined' ? globalThis : this);
