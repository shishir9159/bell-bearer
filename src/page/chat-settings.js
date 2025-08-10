/**
 * Settings → ChatGPT, drawn from one template per chat site, the way
 * src/page/chess-settings.js draws both chess panels — so the next chat site
 * is one more `<div data-chat-settings>` in dashboard.html and nothing here.
 *
 * Every control's id is its setting key from src/shared/chat-sites.js, so
 * src/page/settings-form.js binds them like any other setting. That means
 * this has to run before SettingsForm.bindAll().
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { ChatSites, Dom } = BB;

    const esc = Dom.escapeHtml;

    function switchRow(id, label) {
        return `
            <div class="settings-option">
                <label class="toggle-switch">
                    <input type="checkbox" id="${id}">
                    <span class="toggle-slider"></span>
                </label>
                <label class="setting-label" for="${id}">${label}</label>
            </div>`;
    }

    function panelHtml(site) {
        const key = (kind) => ChatSites.siteKey(site.id, kind);
        const name = esc(site.name);
        return `
            <p class="settings-hint">On ${esc(site.host)}, the panel — an outline of the chat, its branches as a tree, your pins and its
               queue — opens from the button in the chat's header, or with <kbd>Shift</kbd>+<kbd>P</kbd> when the pouch shortcut is on
               (it types a P while the caret is in the prompt box). With the caret anywhere, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>J</kbd>
               and <kbd>K</kbd> step between prompts, <kbd>P</kbd> pins the message you are reading, <kbd>I</kbd> inserts a prompt
               template and <kbd>Q</kbd> queues what is in the box. Conversations are read from ${name}'s own API with your
               session, and are never stored — only your pins, prompts and queue are.</p>

            <h4 class="shortcut-heading">In the page</h4>
            ${switchRow(key('composerTools'), `Prompts and Queue buttons beside ${name}'s own composer buttons`)}
            ${switchRow(key('limitSuggest'), `Offer to hold or schedule prompts when ${name} says a limit has been reached`)}

            <h4 class="shortcut-heading">Queue</h4>
            <p class="settings-hint chess-settings-lead">Queued prompts are typed into the page's own prompt box and sent with its own
               send button, one after another. Typing in the box yourself always wins, and pressing ${name}'s stop pauses the queue.</p>
            <div class="settings-option">
                <span class="chess-row-gap"></span>
                <label class="setting-label chess-warn-name" for="${key('queueGap')}">Pause between answers</label>
                <input type="number" id="${key('queueGap')}" class="text-control chess-warn-seconds" min="1" max="600" step="1" inputmode="numeric">
                <span class="setting-label chess-warn-unit">seconds</span>
            </div>
            ${switchRow(key('queueOpenTab'), 'Open the chat in a background tab when a scheduled prompt is due and no tab has it')}

            <h4 class="shortcut-heading">Export</h4>
            ${switchRow(key('exportDollars'), 'Write maths as $ and $$, which Obsidian and GitHub render')}
            ${switchRow(key('exportThinking'), 'Include reasoning summaries')}`;
    }

    /** Fill every `[data-chat-settings="<site id>"]` on the page. */
    function mountAll(scope = document) {
        scope.querySelectorAll('[data-chat-settings]').forEach((panel) => {
            const site = ChatSites.get(panel.dataset.chatSettings);
            if (!site) return;
            // The plate's legend carries the site's name, spelled its way.
            panel.dataset.plate = site.name;
            panel.setAttribute('data-plate-proper', '');
            panel.innerHTML = panelHtml(site);
        });
    }

    BB.ChatSettings = { mountAll, panelHtml };
})(typeof globalThis !== 'undefined' ? globalThis : this);
