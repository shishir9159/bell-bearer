/**
 * Settings → GitHub, GitLab and Codeberg, drawn from one template per forge,
 * the way src/page/chat-settings.js draws the chat sites' — so the next forge
 * is one more `<div data-forge-settings>` in dashboard.html and nothing here.
 *
 * Every control's id is its setting key from src/shared/forge-sites.js, so
 * src/page/settings-form.js binds them like any other setting. That means
 * this has to run before SettingsForm.bindAll().
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { ForgeSites, Dom } = BB;

    const esc = Dom.escapeHtml;

    function panelHtml(site) {
        const key = ForgeSites.siteKey(site.id, 'ciWatch');
        const name = esc(site.name);
        return `
            <p class="settings-hint">A <strong>Watch</strong> button on ${esc(site.watches)} on ${esc(site.hosts[0])}. Click it and carry
               on elsewhere: a desktop notification says when the run has finished — passed, or failed and which jobs did — and
               clicking it brings the tab back. What is being watched now is on ${name}'s page in the dashboard.</p>

            <h4 class="shortcut-heading">In the page</h4>
            <div class="settings-option">
                <label class="toggle-switch">
                    <input type="checkbox" id="${key}">
                    <span class="toggle-slider"></span>
                </label>
                <label class="setting-label" for="${key}">Watch button on ${esc(site.watches)}</label>
            </div>

            <h4 class="shortcut-heading">What it asks for</h4>
            <p class="settings-hint chess-settings-lead">The run is read from its open tab, so keep the tab open; it can be in the background. Nothing is
               sent anywhere: where ${name}'s page stops updating while out of sight, the tab asks ${name} itself, about once a
               minute and with your own session, for what the page would have shown.</p>`;
    }

    /** Fill every `[data-forge-settings="<forge id>"]` on the page. */
    function mountAll(scope = document) {
        scope.querySelectorAll('[data-forge-settings]').forEach((panel) => {
            const site = ForgeSites.get(panel.dataset.forgeSettings);
            if (!site) return;
            // The plate's legend carries the forge's name, spelled its way.
            panel.dataset.plate = site.name;
            panel.setAttribute('data-plate-proper', '');
            panel.innerHTML = panelHtml(site);
        });
    }

    const ForgeSettings = { mountAll, panelHtml };

    BB.ForgeSettings = ForgeSettings;
    if (typeof module !== 'undefined' && module.exports) module.exports = ForgeSettings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
