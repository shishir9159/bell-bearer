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

    /** A forge's folder switch, for the forges that have one; nothing for the rest. */
    function folderHtml(site) {
        const key = ForgeSites.siteKey(site.id, 'folderDownload');
        if (!key) return '';
        return `
            <h4 class="shortcut-heading">Folders</h4>
            <p class="settings-hint">A <strong>Download folder</strong> button beside a folder's own buttons on ${esc(site.hosts[0])}. It saves
               that folder, and everything under it, as a .zip — built in this tab from the files' raw copies at the commit you
               are looking at, rather than through a third-party site.</p>
            <div class="settings-option">
                <label class="toggle-switch">
                    <input type="checkbox" id="${key}">
                    <span class="toggle-slider"></span>
                </label>
                <label class="setting-label" for="${key}">Download folder button on folders</label>
            </div>`;
    }

    /** A forge's link switch, for the forges whose titles are reworded; nothing for the rest. */
    function linkHtml(site) {
        const key = ForgeSites.siteKey(site.id, 'linkRepo');
        if (!key) return '';
        return `
            <h4 class="shortcut-heading">Links</h4>
            <p class="settings-hint"><kbd>Y</kbd> <kbd>Y</kbd> and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> copy the page as a link.
               ${esc(site.name)}'s own title names the repository in front of its description, and after a &middot; on
               an issue, a pull request or a file; with this on, the link names it last, after a dash. Off, the
               repository is left out of the link.</p>
            <div class="settings-option">
                <label class="toggle-switch">
                    <input type="checkbox" id="${key}">
                    <span class="toggle-slider"></span>
                </label>
                <label class="setting-label" for="${key}">Name the repository at the end of a copied link — <code>[title - owner/repo](url)</code></label>
            </div>`;
    }

    /** A forge's topic search switch, for the forges that have one; nothing for the rest. */
    function topicsHtml(site) {
        const key = ForgeSites.siteKey(site.id, 'topicSearch');
        if (!key) return '';
        return `
            <h4 class="shortcut-heading">Topics</h4>
            <p class="settings-hint">A search box on a topic's page — ${esc(site.hosts[0])}/topics/go — that adds more topics, and filters
               such as <code>stars:&gt;500</code> or <code>pushed:&gt;2026-06-01</code>, and shows the repositories that have every one
               of them in place of the page's own list. It asks GitHub's public search signed out, so your account is never part
               of it; that allows ten searches a minute.</p>
            <div class="settings-option">
                <label class="toggle-switch">
                    <input type="checkbox" id="${key}">
                    <span class="toggle-slider"></span>
                </label>
                <label class="setting-label" for="${key}">Search several topics at once on a topic's page</label>
            </div>`;
    }

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
               minute and with your own session, for what the page would have shown.</p>
            ${folderHtml(site)}
            ${topicsHtml(site)}
            ${linkHtml(site)}`;
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
