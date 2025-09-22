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

    /** A checkbox, a name, a number and its unit — the shape of most rows here. */
    function numberRow(toggleId, name, numberId, unit, { min = 1, max = null } = {}) {
        return `
            <div class="settings-option">
                ${toggleId ? `
                    <label class="toggle-switch">
                        <input type="checkbox" id="${toggleId}">
                        <span class="toggle-slider"></span>
                    </label>` : '<span class="chess-row-gap"></span>'}
                <label class="setting-label chess-warn-name" for="${numberId}">${name}</label>
                <input type="number" id="${numberId}" class="text-control chess-warn-seconds"
                       min="${min}"${max == null ? '' : ` max="${max}"`} step="1" inputmode="numeric">
                <span class="setting-label chess-warn-unit">${unit}</span>
            </div>`;
    }

    function warnRow(site, name) {
        return numberRow(
            ChessSites.settingKey(site.id, 'warn', name),
            Chess.CLASS_LABEL[name],
            ChessSites.settingKey(site.id, 'warnSeconds', name),
            'seconds',
        );
    }

    function lowRow(site, name) {
        return numberRow(
            null,
            Chess.CLASS_LABEL[name],
            ChessSites.settingKey(site.id, 'lowSeconds', name),
            'seconds left',
        );
    }

    function limitRow(site, name) {
        return numberRow(
            null,
            Chess.CLASS_LABEL[name],
            ChessSites.settingKey(site.id, 'limit', name),
            'games a day',
            { min: 0 },
        );
    }

    function checkOption(id, label) {
        return `
            <label class="chess-speak-option" for="${id}">
                <input type="checkbox" id="${id}">
                <span>${label}</span>
            </label>`;
    }

    function speakOption(site, name) {
        return checkOption(ChessSites.settingKey(site.id, 'speak', name), Chess.CLASS_LABEL[name]);
    }

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
        const name = esc(site.name);
        const key = (kind) => ChessSites.siteKey(site.id, kind);

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

            <h4 class="shortcut-heading">Low clock warning</h4>
            <p class="settings-hint chess-settings-lead">${name} plays its own sound when your time runs low and gives you no say in how loud it is. This is a tone of Bell Bearer's own, at a volume you set — turn ${name}'s down or off in its sound settings if you would rather hear only this one.</p>
            ${switchRow(key('lowTime'), `Play a tone when my own clock runs low on ${name}`)}
            <div class="chess-warn-list">${ChessSites.CLASSES.map((c) => lowRow(site, c)).join('')}</div>
            <div class="settings-option chess-volume-row">
                <label class="setting-label chess-warn-name" for="${key('lowVolume')}">Volume</label>
                <input type="range" id="${key('lowVolume')}" class="chess-volume" min="0" max="200" step="5"
                       aria-describedby="${key('lowVolume')}Out">
                <output class="setting-label chess-warn-unit" id="${key('lowVolume')}Out" for="${key('lowVolume')}"></output>
            </div>
            <p class="settings-hint">Above 100% is louder than the tone's own level, not just louder than ${name}.</p>

            <h4 class="shortcut-heading">Speak moves</h4>
            <p class="settings-hint chess-settings-lead">Reads every move aloud as it is played — yours and your opponent's — so you learn to follow the board by ear. Only in the time controls ticked.</p>
            <div class="chess-speak-list">
                ${ChessSites.CLASSES.map((c) => speakOption(site, c)).join('')}
                ${checkOption(key('speakUntimed'), 'Untimed')}
            </div>
            <p class="settings-hint">Games with no clock — ${site.id === 'chess' ? 'Coach, bots and the analysis board' : 'bots and the analysis board'} — are spoken whenever any box here is ticked. Tick only Untimed to hear moves in those games alone.</p>

            <h4 class="shortcut-heading">Daily limit</h4>
            <p class="settings-hint chess-settings-lead">How many games of each control you mean to play in a day. Past the limit, ${name}'s rematch and new-game buttons go grey and stop working until midnight. Games count from ${name}'s API, so games played on your phone count too. Zero blocks a control outright.</p>
            ${switchRow(key('limitsOn'), `Hold me to a daily limit on ${name}`)}
            <div class="chess-warn-list">${ChessSites.CLASSES.map((c) => limitRow(site, c)).join('')}</div>
            <p class="settings-hint">Reached the limit and want one more anyway? Bell Bearer's toolbar popup grows a button that allows exactly one more game of each control.</p>

            ${site.shortcutScope ? `
                <h4 class="shortcut-heading">Keyboard shortcuts</h4>
                <div class="shortcut-list" data-shortcut-scope="${esc(site.shortcutScope)}"></div>` : ''}`;
    }

    /**
     * Keep each volume slider's readout in step with it. The slider is bound
     * to storage by SettingsForm like everything else; this only draws the
     * number beside it, on load and as it moves.
     */
    function wireVolumeOutputs(scope) {
        scope.querySelectorAll('.chess-volume').forEach((slider) => {
            const output = scope.querySelector(`#${CSS.escape(slider.id)}Out`);
            if (!output) return;
            const show = () => { output.textContent = `${slider.value}%`; };
            slider.addEventListener('input', show);
            slider.addEventListener('change', show);
            // SettingsForm writes the stored value in after this runs, so the
            // first draw waits a turn for it.
            setTimeout(show, 0);
            show();
        });
    }

    /** Fill every `[data-chess-settings="<site id>"]` on the page. */
    function mountAll(scope = document) {
        scope.querySelectorAll('[data-chess-settings]').forEach((panel) => {
            const site = ChessSites.get(panel.dataset.chessSettings);
            if (site) panel.innerHTML = panelHtml(site);
        });
        wireVolumeOutputs(scope);
    }

    BB.ChessSettings = { mountAll, panelHtml };
})(typeof globalThis !== 'undefined' ? globalThis : this);
