/**
 * Settings → Chess.com and Settings → Lichess, drawn from one template.
 *
 * Every control's id is its setting key from src/shared/chess-sites.js, so
 * src/page/settings-form.js binds them like any other setting. That means this
 * has to run before SettingsForm.bindAll() — and before ShortcutList.mountAll(),
 * which fills the shortcut list drawn here.
 */
(function (root) {
    'use strict';

    const BB = (root.BB = root.BB || {});
    const { Chess, ChessSites, Dom } = BB;

    const esc = Dom.escapeHtml;

    function warnRow(site, name) {
        const toggle = ChessSites.settingKey(site.id, 'warn', name);
        const seconds = ChessSites.settingKey(site.id, 'warnSeconds', name);
        return `
            <div class="settings-option">
                <label class="toggle-switch">
                    <input type="checkbox" id="${toggle}">
                    <span class="toggle-slider"></span>
                </label>
                <label class="setting-label chess-warn-name" for="${seconds}">${Chess.CLASS_LABEL[name]}</label>
                <input type="number" id="${seconds}" class="text-control chess-warn-seconds" min="1" step="1" inputmode="numeric">
                <span class="setting-label chess-warn-unit">seconds</span>
            </div>`;
    }

    function speakOption(site, name) {
        const id = ChessSites.settingKey(site.id, 'speak', name);
        return `
            <label class="chess-speak-option" for="${id}">
                <input type="checkbox" id="${id}">
                <span>${Chess.CLASS_LABEL[name]}</span>
            </label>`;
    }

    function panelHtml(site) {
        const name = esc(site.name);
        return `
            <h3 class="bb-proper">${name}</h3>

            <div class="settings-option">
                <label class="setting-label" for="${site.usernameKey}">Username</label>
                <input type="text" id="${site.usernameKey}" class="text-control" placeholder="Your ${esc(site.host)} username"
                       autocomplete="off" spellcheck="false">
            </div>
            <p class="settings-hint">Games are read from ${name}'s public API for this player — no sign-in, nothing sent anywhere else.</p>

            <h4 class="shortcut-heading">Opponent clock warning</h4>
            <p class="settings-hint chess-settings-lead">During a game on ${name}, warns when your opponent's clock is ahead of yours by more than this many seconds.</p>
            <div class="chess-warn-list">${ChessSites.CLASSES.map((c) => warnRow(site, c)).join('')}</div>

            <h4 class="shortcut-heading">Speak moves</h4>
            <p class="settings-hint chess-settings-lead">Reads every move aloud as it is played — yours and your opponent's — so you learn to follow the board by ear. Only in the time controls ticked.</p>
            <div class="chess-speak-list">${ChessSites.CLASSES.map((c) => speakOption(site, c)).join('')}</div>

            ${site.shortcutScope ? `
                <h4 class="shortcut-heading">Keyboard shortcuts</h4>
                <div class="shortcut-list" data-shortcut-scope="${esc(site.shortcutScope)}"></div>` : ''}`;
    }

    /** Fill every `[data-chess-settings="<site id>"]` on the page. */
    function mountAll(scope = document) {
        scope.querySelectorAll('[data-chess-settings]').forEach((panel) => {
            const site = ChessSites.get(panel.dataset.chessSettings);
            if (site) panel.innerHTML = panelHtml(site);
        });
    }

    BB.ChessSettings = { mountAll, panelHtml };
})(typeof globalThis !== 'undefined' ? globalThis : this);
