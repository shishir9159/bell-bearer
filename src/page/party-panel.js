/**
 * The watch party in the popup: starting one, joining one, the room, the code
 * exchange, and how a party ended — every view the design draws, over one
 * `#partyView` that stands in for the rest of the popup while it is up.
 *
 * Loaded only when a party is asked for or already on (popup.js#openParty),
 * like the party's page code: a popup opened on a video nobody watches
 * together parses none of this.
 *
 * The popup lives for seconds at a time and the party for an evening, so
 * nothing here holds the party. It asks the worker for the status once a
 * second while open, and every view is drawn from that answer. A view with
 * something typed in it is never redrawn wholesale; only its live parts (a
 * countdown, the member list) are, so a half-pasted code survives the tick.
 */
(function (root) {
    'use strict';

    const { Settings, Dom, Ui } = root.BB;
    const esc = Dom.escapeHtml;

    /** PartyWorker.ENDED_KEY: why the authority ended the last party. */
    const ENDED_KEY = 'bbPartyEnded';
    /** PartyLoader.KEY: the party's tab. */
    const TAB_KEY = 'bbPartyTab';
    const TICK_MS = 1000;
    const SITES = Object.freeze({ youtube: 'YouTube', netflix: 'Netflix' });
    const MODES = Object.freeze([
        { id: 'server', label: 'Server', note: 'One code, anyone can join' },
        { id: 'relay', label: 'Relay', note: 'Your own server, ip:port + token' },
        { id: 'codes', label: 'Codes', note: 'Browser only, one invite per guest' },
        { id: 'tracker', label: 'Tracker', note: 'One code, meets via public trackers' },
    ]);
    /** What a failed start or join says in place, for the failures the design has no screen for. */
    const FAILURES = Object.freeze({
        site: 'Open a YouTube or Netflix video first.',
        tab: 'Open a YouTube or Netflix video first.',
        inject: 'Reload the video\'s tab first; Bell Bearer could not reach it.',
        address: 'That is not a ws:// or wss:// address.',
        unreachable: 'Nobody answered at that address.',
        code: 'That is not a party code.',
        unsupported: 'This browser cannot hold a party.',
    });

    const ICONS = {
        copy: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    };

    const send = (message) => new Promise((resolve) => {
        try {
            root.chrome.runtime.sendMessage(message, (answer) => resolve(root.chrome.runtime.lastError ? { ok: false } : answer || { ok: false }));
        } catch (_) {
            resolve({ ok: false });
        }
    });
    const sessionGet = async (keys) => {
        try { return await root.chrome.storage.session.get(keys); } catch (_) { return {}; }
    };

    /** m:ss until `at`, never negative. */
    function countdown(at, now = Date.now()) {
        const s = Math.max(0, Math.round((at - now) / 1000));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    /** `site` is the active tab's, for "On this tab · YouTube". */
    function createPanel({ body, site, onClose, openDashboard }) {
        const views = root.BB.PartyViews;
        const panel = {
            body, site, status: { active: false }, view: null, timer: null, tab: null,
            send, esc, openDashboard,
            /** Settings the views share: the name, and the start's choices. */
            prefs: null,
            go, close, refresh, subhead, fail, failed, field, nameInput,
        };

        function field(label, inner, extra = '') {
            return `<div class="party-field"${extra}><div class="party-label">${label}</div>${inner}</div>`;
        }

        function nameInput() {
            return `<input class="party-input" id="partyNameIn" maxlength="40" placeholder="How the room sees you" value="${esc(panel.prefs.partyName)}">`;
        }

        function subhead({ title, note = '', back = true, extra = '' }) {
            return `<div class="party-sub">${back ? '<button class="party-back" type="button" data-act="back" aria-label="Back">←</button>' : ''}
                <div class="party-sub-text"><h3>${esc(title)}</h3><div class="party-sub-note">${note}</div></div>${extra}</div>`;
        }

        function fail(error) {
            const out = body.querySelector('.party-fail');
            if (out) out.textContent = FAILURES[error] || `That did not work (${error || 'no answer'}).`;
        }

        /** A start or join the worker refused: the design's screen when it has one, a line under the button when not. */
        function failed(answer, button, label) {
            button.disabled = false;
            button.textContent = label;
            const error = answer && answer.error;
            if (views.ended && views.ended.knows(error)) go('ended', { code: error });
            else fail(error);
        }

        async function refresh() {
            const answer = await send({ action: 'partyStatus' });
            const was = panel.status;
            panel.status = (answer && answer.status) || { active: false };
            const tab = (await sessionGet(TAB_KEY))[TAB_KEY];
            if (tab && root.chrome.tabs) {
                try { panel.tab = await root.chrome.tabs.get(tab.tabId); } catch (_) { panel.tab = null; }
            }
            if (was.active && !panel.status.active) {
                const ended = (await sessionGet(ENDED_KEY))[ENDED_KEY];
                return go(ended ? 'ended' : null, { code: ended && ended.code });
            }
            const view = views[panel.view];
            if (view && view.tick) view.tick(panel);
            return panel.status;
        }

        function go(name, options = {}) {
            const view = name && views[name];
            if (!view) return close();
            panel.view = name;
            panel.options = options;
            body.innerHTML = view.render(panel, options);
            if (view.mount) view.mount(panel, options);
            return panel.status;
        }

        function close() {
            clearInterval(panel.timer);
            panel.timer = null;
            body.innerHTML = '';
            body.hidden = true;
            onClose();
        }

        body.addEventListener('click', (event) => {
            const button = event.target.closest('[data-act]');
            if (!button || button.disabled) return;
            const act = button.dataset.act;
            if (act === 'back') return go(panel.status.active ? 'room' : null);
            if (act === 'copy') {
                Ui.copyText(button.dataset.code || '');
                const label = button.lastChild;
                const was = label.textContent;
                label.textContent = 'Copied';
                setTimeout(() => { label.textContent = was; }, 1200);
                return undefined;
            }
            const view = views[panel.view];
            if (view && view.act) view.act(panel, act, button, event);
            return undefined;
        });

        /** Where the popup lands: the room when a party is on, how it ended when it just did, else what was asked. */
        panel.open = async (asked) => {
            panel.prefs = await Settings.get(['partyName', 'partyControl', 'partyWaitForAll', 'partyServerUrl', 'partyTrackers']);
            body.hidden = false;
            await refresh();
            const ended = (await sessionGet(ENDED_KEY))[ENDED_KEY];
            const s = panel.status;
            if (s.active) go(s.mode === 'codes' && !s.up && s.invite ? 'join' : s.mode === 'codes' && s.invites && s.invites.length ? 'invite' : 'room');
            else if (!asked && ended) go('ended', { code: ended.code });
            else go(asked || null);
            panel.timer = setInterval(refresh, TICK_MS);
        };

        return panel;
    }

    const PartyPanel = { ENDED_KEY, TAB_KEY, SITES, MODES, FAILURES, ICONS, countdown, createPanel };

    root.BB = root.BB || {};
    root.BB.PartyPanel = PartyPanel;
    /** Each view file adds its views here: {render, mount?, tick?, act?} by name. */
    root.BB.PartyViews = root.BB.PartyViews || {};
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyPanel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
