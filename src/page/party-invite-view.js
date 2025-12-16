/**
 * A party's invites in the popup: the design's frame C. A code party's host
 * hands each guest their own invite and pastes back the reply; any other
 * party has the one code for the room, which anyone in it may pass on.
 */
(function (root) {
    'use strict';

    const { PartyPanel, PartyViews } = root.BB;
    const { MODES, ICONS, countdown } = PartyPanel;

    const WARN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    /** The NAT verdicts worth a warning before an invite goes out; see PartyRtc.natOf. */
    const NAT = {
        symmetric: 'Symmetric NAT.',
        blocked: 'No STUN server answered.',
    };

    /** "public 203.0.113.5:54012 and LAN 192.168.1.14:54012", each address set in mono. */
    function sharing(p, addresses) {
        const words = (addresses || []).map((one) => `<span class="party-mono">${p.esc(one.replace(/^local network /, 'LAN '))}</span>`);
        if (!words.length) return '';
        const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
        return `<div class="party-share">You share ${list}</div>`;
    }

    function natWarning(p) {
        const said = NAT[p.status.nat];
        return said ? `<div class="party-warn">${WARN}<div><strong>${said}</strong> Guests outside your network may not reach you. Add a TURN server in Settings, or use a server.</div></div>` : '';
    }

    function newInviteCard(p, invite) {
        if (!invite) return `<div class="party-card bb-framed"><div class="party-label">New invite</div><div class="party-wait"><span class="party-spin" aria-hidden="true"></span>Gathering your addresses…</div></div>`;
        return `<div class="party-card bb-framed">
            <div class="party-label party-label-row">New invite${invite.expires ? `<span class="party-time" data-until="${invite.expires}">expires ${countdown(invite.expires)}</span>` : ''}</div>
            <div class="party-code">${p.esc(invite.code)}</div>
            ${sharing(p, invite.addresses)}
            <div class="party-row"><button type="button" class="party-copy" data-act="copy" data-code="${p.esc(invite.code)}">${ICONS.copy}<span>Copy invite</span></button></div>
        </div>`;
    }

    function pendingList(p) {
        const others = (p.status.invites || []).filter((one) => one.code !== p.newCode);
        if (!others.length) return '';
        return `<div class="party-label party-label-row">Waiting on a reply<span>${others.length}</span></div>
            ${others.map((one) => `<div class="party-pending">
                <span class="party-pending-code">${p.esc(one.code)}</span>
                <span class="party-pending-left" data-until="${one.expires}">${countdown(one.expires)}</span>
                <button type="button" class="party-act is-ghost" data-act="revoke" data-code="${p.esc(one.code)}">Revoke</button>
            </div>`).join('')}`;
    }

    PartyViews.invite = {
        render(p, { fresh } = {}) {
            const s = p.status;
            const mode = s.mode === 'codes' ? 'codes' : s.mode === 'tracker' ? 'tracker' : 'server';
            const label = MODES.find((m) => m.id === mode).label;
            const pill = `<span class="party-pill is-big">${label}</span>`;
            if (mode !== 'codes') {
                // One code for the whole room: nothing expires, nobody replies.
                return `${p.subhead({ title: 'Invite', note: MODES.find((m) => m.id === mode).note, extra: pill })}
                    <div class="party-scroll">${newInviteCard(p, { code: s.invite })}</div>`;
            }
            const pending = s.invites || [];
            if (!fresh) p.newCode = pending.length ? pending[pending.length - 1].code : null;
            else p.newCode = null;
            const invite = pending.find((one) => one.code === p.newCode);
            return `${p.subhead({ title: 'Invite', note: 'One code per guest · expires after 10 min', extra: pill })}
                <div class="party-scroll">
                    <div id="partyNat">${natWarning(p)}</div>
                    <div id="partyNew">${fresh ? newInviteCard(p, null) : newInviteCard(p, invite)}</div>
                    <div class="party-card">
                        <div class="party-label">Their reply</div>
                        <textarea class="party-code-in is-short" id="partyReplyIn" spellcheck="false" placeholder="Paste the bbp1r. code your guest sends back"></textarea>
                        <div class="party-fail" aria-live="polite"></div>
                        <div class="party-end is-tucked"><button type="button" class="party-btn is-primary is-tiny" data-act="accept">Let them in</button></div>
                    </div>
                    <div class="party-pendings" id="partyPending">${pendingList(p)}</div>
                </div>`;
        },
        async mount(p, { fresh } = {}) {
            if (!fresh || p.status.mode !== 'codes') return;
            const answer = await p.send({ action: 'partyInvite' });
            if (p.view !== 'invite') return;
            if (!answer.ok) return p.fail(answer.error);
            p.newCode = answer.invite.code;
            await p.refresh();
            p.body.querySelector('#partyNew').innerHTML = newInviteCard(p, answer.invite);
            p.body.querySelector('#partyNat').innerHTML = natWarning(p);
            return undefined;
        },
        tick(p) {
            for (const out of p.body.querySelectorAll('[data-until]')) {
                const left = countdown(Number(out.dataset.until));
                out.textContent = out.classList.contains('party-time') ? `expires ${left}` : left;
            }
            const list = p.body.querySelector('#partyPending');
            if (list) {
                const next = pendingList(p);
                if (list.dataset.sig !== next) {
                    list.innerHTML = next;
                    list.dataset.sig = next;
                }
            }
        },
        async act(p, act, button) {
            if (act === 'revoke') {
                await p.send({ action: 'partyControl', op: 'revoke', code: button.dataset.code });
                return p.refresh();
            }
            if (act !== 'accept') return undefined;
            const code = p.body.querySelector('#partyReplyIn').value.trim();
            if (!code.startsWith('bbp1r.')) return p.fail('reply');
            button.disabled = true;
            button.textContent = 'Letting them in…';
            const answer = await p.send({ action: 'partyJoin', code });
            button.disabled = false;
            button.textContent = 'Let them in';
            if (!answer.ok) return p.fail(`reply-${answer.error}`);
            await p.refresh();
            return p.go('room');
        },
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyViews.invite;
})(typeof globalThis !== 'undefined' ? globalThis : this);
