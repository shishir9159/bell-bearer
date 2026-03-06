/**
 * Joining a watch party from the popup, and sending a code party's reply back
 * (the design's frame D); and how a party ended, or failed to start (F).
 */
(function (root) {
    'use strict';

    const { Settings, PartyPanel, PartyViews, Icons } = root.BB;
    const { ENDED_KEY, ICONS, countdown } = PartyPanel;

    const LEFT = Icons.svg('user-minus', { size: 34 });

    /** The design's endings, by the code a party ended (or failed to start) with, and where each one's way on leads. */
    const ENDINGS = Object.freeze({
        'host-left': { title: 'The host left', body: 'A party made with codes ends with its host. Keep watching on your own, or ask for a new invite.', secondary: 'Keep watching solo', primary: 'Paste a new invite', go: 'join' },
        expired: { title: 'Nobody let you in', body: 'The host did not paste your reply within 10 minutes, so it expired. Ask them for a fresh invite.', secondary: 'Close', primary: 'Paste a new invite', go: 'join' },
        tracker: { title: 'No tracker answered', body: 'None of the trackers in Settings replied. Start with codes instead, one invite per guest.', secondary: 'Close', primary: 'Use codes', go: 'codes' },
        invite: { title: 'That code could not be read', body: 'It may have been cut short when it was copied. Ask for it again and paste the whole thing.', secondary: 'Close', primary: 'Paste again', go: 'join' },
        'no-host': { title: 'There is no host', body: 'The room is still there but nobody is carrying it. Start a new party from where you are.', secondary: 'Close', primary: 'Start a party', go: 'start' },
        // Not among the design's five, but real ways for a party to end,
        // said in the same voice with the same way back in.
        kicked: { title: 'You were removed', body: 'The host took you out of the party. Keep watching on your own, or ask for a new invite.', secondary: 'Close', primary: 'Paste a new invite', go: 'join' },
        ended: { title: 'The party ended', body: 'The room closed. Your video plays on as it was.', secondary: 'Close', primary: 'Start a party', go: 'start' },
    });

    /** What a pasted code is, in the words under the box; null for nothing typed. */
    function readCode(text, { PartyCode = root.BB.PartyCode, now = Date.now() } = {}) {
        const code = String(text || '').trim();
        if (!code) return null;
        if (code.startsWith('bbp1i.')) {
            const invite = PartyCode.readInvite(code);
            if (!invite) return { ok: false, kind: 'Invite code', note: ' · cut short, ask for it again' };
            const said = PartyCode.describe(invite.desc);
            const where = said.find((one) => /^(public|relay) /.test(one)) || said[0];
            const from = where ? ` · from ${where.replace(/^public /, '')}` : '';
            const mins = Math.ceil((invite.expires - now) / 60000);
            return mins > 0 ? { ok: true, kind: 'Invite code', note: `${from} · ${mins} min left` }
                : { ok: false, kind: 'Invite code', note: `${from} · expired, ask for a new one` };
        }
        if (code.startsWith('bbp1s.')) {
            let host = '';
            try { host = new URL(JSON.parse(atob(code.slice(6).replace(/-/g, '+').replace(/_/g, '/'))).url).host; } catch (_) { /* unreadable */ }
            return host ? { ok: true, kind: 'Server code', note: ` · on ${host}` } : { ok: false, kind: 'Server code', note: ' · cut short, ask for it again' };
        }
        if (code.startsWith('bbp1t.')) return { ok: true, kind: 'Tracker code', note: ' · meets through public trackers' };
        if (code.startsWith('bbp1r.')) return { ok: false, kind: 'A reply', note: ' · the host pastes this on their Invite screen' };
        return { ok: false, kind: 'Not a party code', note: '' };
    }

    /** A code guest's reply, and the wait for the host to paste it. */
    function replyCard(p) {
        const s = p.status;
        return `<div class="party-card bb-framed is-accent">
            <div class="party-label party-label-row">Send this reply to the host<span class="party-time" id="partyReplyLeft">${s.expires ? countdown(s.expires) : ''}</span></div>
            <div class="party-code">${p.esc(s.invite)}</div>
            <div class="party-row">
                <button type="button" class="party-copy is-solid" data-act="copy" data-code="${p.esc(s.invite)}">${ICONS.copy}<span>Copy reply</span></button>
                <span class="party-wait"><span class="party-spin" aria-hidden="true"></span>Waiting for the host to let you in</span>
            </div>
            <div class="party-hint">Keep this tab open. You join as soon as they paste it.</div>
        </div>`;
    }
    const waitingOnHost = (s) => s.active && s.mode === 'codes' && !s.up && !!s.invite;

    PartyViews.join = {
        readCode,
        render(p) {
            const waiting = waitingOnHost(p.status);
            return `${p.subhead({ title: 'Join a party', note: 'Paste any code that starts with bbp1' })}
                <div class="party-scroll">
                    ${waiting ? '' : `<div class="party-card is-snug">
                        <div class="party-label">Party code</div>
                        <textarea class="party-code-in" id="partyCodeIn" spellcheck="false" aria-label="Party code"></textarea>
                        <div class="party-code-read" id="partyCodeRead" aria-live="polite"></div>
                        ${p.field('Your name in the room', p.nameInput())}
                        <div class="party-fail" aria-live="polite"></div>
                        <div class="party-end"><button type="button" class="party-btn is-primary is-small" data-act="join">Join</button></div>
                    </div>`}
                    <div id="partyReply">${waiting ? replyCard(p) : ''}</div>
                </div>`;
        },
        mount(p) {
            const input = p.body.querySelector('#partyCodeIn');
            if (!input) return;
            input.focus();
            input.addEventListener('input', () => {
                const read = readCode(input.value);
                p.body.querySelector('#partyCodeRead').innerHTML = read
                    ? `<span class="${read.ok ? 'is-ok' : 'is-bad'}">${p.esc(read.kind)}</span><span>${p.esc(read.note.replace(/^ · /, '· '))}</span>` : '';
            });
        },
        tick(p) {
            const s = p.status;
            if (s.active && s.up) return p.go('room');
            const out = p.body.querySelector('#partyReply');
            if (waitingOnHost(s) && out && !out.firstElementChild) out.innerHTML = replyCard(p);
            const left = p.body.querySelector('#partyReplyLeft');
            if (left && s.expires) left.textContent = countdown(s.expires);
            return undefined;
        },
        async act(p, act, button) {
            if (act !== 'join') return undefined;
            const code = p.body.querySelector('#partyCodeIn').value.trim();
            const read = readCode(code);
            if (!read || !read.ok) return p.fail('code');
            const partyName = p.body.querySelector('#partyNameIn').value.trim();
            await Settings.set({ partyName });
            p.prefs.partyName = partyName;
            button.disabled = true;
            button.textContent = 'Joining…';
            const answer = await p.send({ action: 'partyJoin', code });
            if (!answer.ok) return p.failed(answer, button, 'Join');
            await p.refresh();
            // A code guest is in the party, but not the room until the host pastes the reply.
            return p.go(waitingOnHost(p.status) ? 'join' : 'room');
        },
    };

    PartyViews.ended = {
        ENDINGS,
        knows: (code) => !!ENDINGS[code],
        render(p, { code }) {
            const e = ENDINGS[code] || ENDINGS.ended;
            return `<div class="party-ended"><div class="party-ended-box">${LEFT}
                <h3>${e.title}</h3><p>${e.body}</p>
                <div class="party-row">
                    <button type="button" class="party-btn" data-act="secondary">${e.secondary}</button>
                    <button type="button" class="party-btn is-primary" data-act="primary">${e.primary}</button>
                </div></div></div>`;
        },
        async act(p, act) {
            try { await root.chrome.storage.session.remove(ENDED_KEY); } catch (_) { /* shown once either way */ }
            if (act !== 'primary') return p.go(null);
            const where = (ENDINGS[p.options.code] || ENDINGS.ended).go;
            return where === 'codes' ? p.go('start', { mode: 'codes' }) : p.go(where);
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = { join: PartyViews.join, ended: PartyViews.ended };
})(typeof globalThis !== 'undefined' ? globalThis : this);
