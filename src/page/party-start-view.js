/**
 * Starting a watch party from the popup: the design's frame B. Four ways to
 * connect, who drives, whether the room waits for a buffering member, and the
 * name the room sees.
 */
(function (root) {
    'use strict';

    const { Settings, PartyPanel, PartyViews } = root.BB;
    const { MODES, SITES } = PartyPanel;
    /** A tracker that has not opened its socket by now does not count as answering. */
    const PROBE_MS = 4000;

    /** How many of the trackers open a socket in time: the Tracker tile's "N answering". */
    function probeTrackers(list, { Socket = root.WebSocket, ms = PROBE_MS } = {}) {
        const urls = String(list || '').split(/\s+/).filter((url) => /^wss?:\/\//.test(url));
        return Promise.all(urls.map((url) => new Promise((resolve) => {
            let socket = null;
            let timer = null;
            const done = (ok) => {
                clearTimeout(timer);
                try { socket.close(); } catch (_) { /* never opened */ }
                resolve(ok);
            };
            timer = setTimeout(() => done(false), ms);
            try {
                socket = new Socket(url);
                socket.onopen = () => done(true);
                socket.onerror = () => done(false);
            } catch (_) {
                done(false);
            }
        }))).then((answers) => answers.filter(Boolean).length);
    }

    const seg = (key, options, value) => `<div class="party-seg" data-seg="${key}">${options.map(([v, label]) =>
        `<button type="button" data-act="seg" data-value="${v}" class="${String(v) === String(value) ? 'is-on' : ''}">${label}</button>`).join('')}</div>`;
    const segValue = (p, key) => p.body.querySelector(`[data-seg="${key}"] .is-on`).dataset.value;
    /** Server remembers its address in the setting; a relay is someone's own PC, typed each time. */
    const addressFor = (mode, p) => (mode === 'server' ? p.prefs.partyServerUrl : '');
    const wantsAddress = (mode) => mode === 'server' || mode === 'relay';

    function placeholder(p) {
        p.body.querySelector('#partyAddressIn').placeholder = p.mode === 'relay' ? 'ws://203.0.113.5:7070' : 'wss://party.example';
    }

    async function submit(p, button) {
        const name = p.body.querySelector('#partyNameIn').value.trim();
        let address = p.body.querySelector('#partyAddressIn').value.trim();
        // "ip:port" is how a relay gets written down; the socket needs the scheme.
        if (address && !/^wss?:\/\//i.test(address)) address = `ws://${address}`;
        if (wantsAddress(p.mode) && !address) return p.fail('address');
        const choices = { partyName: name, partyControl: segValue(p, 'control'), partyWaitForAll: segValue(p, 'wait') === 'true' };
        if (p.mode === 'server') choices.partyServerUrl = address;
        await Settings.set(choices);
        Object.assign(p.prefs, choices);
        button.disabled = true;
        button.textContent = 'Starting…';
        const answer = await p.send(wantsAddress(p.mode) ? { action: 'partyStart', server: address } : { action: 'partyStart', mode: p.mode });
        if (!answer.ok) return p.failed(answer, button, 'Start party');
        await p.refresh();
        // A code party has nobody in it until the host hands out an invite.
        return p.go(p.mode === 'codes' ? 'invite' : 'room', { fresh: p.mode === 'codes' });
    }

    PartyViews.start = {
        probeTrackers,
        render(p, { mode = 'codes' } = {}) {
            p.mode = mode;
            const tiles = MODES.map((m) => `<button type="button" class="party-mode${m.id === mode ? ' is-on' : ''}" data-act="mode" data-mode="${m.id}">
                <div class="party-mode-name">${m.label}${m.id === 'tracker' ? '<span class="party-mode-count" id="partyProbe">asking…</span>' : ''}</div>
                <div class="party-mode-note">${m.note}</div></button>`).join('');
            return `${p.subhead({ title: 'Start a watch party', note: `On this tab · ${SITES[p.site] || 'this page'}` })}
                <div class="party-scroll">
                    <div class="party-label">Connect through</div>
                    <div class="party-modes">${tiles}</div>
                    <div class="party-hint">Codes carry your IP and port to each guest directly. Trackers see IPs and timing, never content.</div>
                    <div class="party-card is-roomy">
                        ${p.field('Who controls playback', seg('control', [['everyone', 'Everyone'], ['host', 'Host and co-hosts']], p.prefs.partyControl))}
                        ${p.field('When someone buffers', seg('wait', [[true, 'Wait for them'], [false, 'They catch up']], p.prefs.partyWaitForAll))}
                        ${p.field('Address', `<input class="party-input is-mono" id="partyAddressIn" spellcheck="false" value="${p.esc(addressFor(mode, p))}">`,
        ` id="partyAddress"${wantsAddress(mode) ? '' : ' hidden'}`)}
                        ${p.field('Your name in the room', p.nameInput())}
                    </div>
                    <div class="party-fail" aria-live="polite"></div>
                    <div class="party-foot">
                        <button type="button" class="party-btn" data-act="back">Cancel</button>
                        <button type="button" class="party-btn is-primary" data-act="start">Start party</button>
                    </div>
                </div>`;
        },
        mount(p) {
            placeholder(p);
            probeTrackers(p.prefs.partyTrackers).then((n) => {
                const out = p.body.querySelector('#partyProbe');
                if (!out) return;
                out.textContent = n ? `${n} answering` : 'none answering';
                out.classList.toggle('is-none', !n);
            });
        },
        act(p, act, button) {
            if (act === 'mode') {
                p.mode = button.dataset.mode;
                for (const tile of p.body.querySelectorAll('.party-mode')) tile.classList.toggle('is-on', tile === button);
                p.body.querySelector('#partyAddress').hidden = !wantsAddress(p.mode);
                p.body.querySelector('#partyAddressIn').value = addressFor(p.mode, p);
                placeholder(p);
            } else if (act === 'seg') {
                for (const one of button.parentNode.children) one.classList.toggle('is-on', one === button);
            } else if (act === 'start') {
                submit(p, button);
            }
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = PartyViews.start;
})(typeof globalThis !== 'undefined' ? globalThis : this);
