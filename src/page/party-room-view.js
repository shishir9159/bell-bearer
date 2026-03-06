/**
 * The party in the popup once you are in it: the design's frame E. Who is
 * watching and how each of them is doing, and for the host, the controls
 * over them and over the room.
 */
(function (root) {
    'use strict';

    const { PartyViews, Icons } = root.BB;

    const DOTS = Icons.svg('dots-three', { size: 13 });
    const LOCK = Icons.svg('lock-simple', { size: 14 });
    const BUBBLE = Icons.svg('chat', { size: 14 });
    const ROLE = { host: 'Host', cohost: 'Co-host' };

    const me = (s) => (s.members || []).find((m) => m.id === s.you) || {};
    const isHost = (s) => me(s).role === 'host';
    /** A code party's host makes invites; any other party has the one code, which anyone may pass on. */
    const canInvite = (s) => (s.mode === 'codes' ? Array.isArray(s.invites) : !!s.invite);

    function stateOf(m) {
        if (m.away) return 'Away';
        if (m.solo) return 'Watching solo';
        if (!m.ready) return m.why === 'ad' ? 'Ad playing' : m.why === 'loading' ? 'Loading' : 'Buffering';
        return 'Ready';
    }

    function syncLine(p) {
        const s = p.status;
        const title = p.tab && p.tab.title ? ` · ${p.esc(p.tab.title.replace(/ - (YouTube|Netflix)$/, ''))}` : '';
        if (!s.up) return `<span class="party-dot is-off"></span><span class="party-line">Reconnecting…${title}</span>`;
        const drift = typeof s.drift === 'number' ? ` ±${Math.round(Math.abs(s.drift))} ms` : '';
        return `<span class="party-dot"></span><span class="party-line">Synced${drift}${title}</span>`;
    }

    /**
     * A round trip as the authority reported it. A party server, or another
     * browser hosting, can send anything there, and it went into the markup
     * as it came: a number is shown, and anything else is not.
     */
    const rttOf = (m, mine) => (!mine && Number.isFinite(m.rtt) ? `${Math.round(m.rtt)} ms` : '—');

    function memberRow(p, m) {
        const s = p.status;
        const mine = m.id === s.you;
        const menu = isHost(s) && !mine;
        const open = menu && p.openMember === m.id;
        return `<div class="party-member">
            <div class="party-member-main">
                <div class="party-member-text">
                    <div class="party-member-name">${p.esc(m.name || 'Someone')}${mine ? ' (you)' : ''}${ROLE[m.role] ? `<span class="party-pill">${ROLE[m.role]}</span>` : ''}${m.lagging ? '<span class="party-pill is-warn">lagging</span>' : ''}</div>
                    <div class="party-member-state">${stateOf(m)}</div>
                </div>
                <span class="party-rtt">${rttOf(m, mine)}</span>
                ${menu ? `<button type="button" class="party-menu" data-act="menu" data-member="${p.esc(m.id)}" aria-label="More for ${p.esc(m.name)}" aria-expanded="${open}">${DOTS}</button>` : ''}
            </div>
            ${open ? `<div class="party-member-acts">
                <button type="button" class="party-act is-soft" data-act="role" data-member="${p.esc(m.id)}" data-role="${m.role === 'cohost' ? 'guest' : 'cohost'}">${m.role === 'cohost' ? 'Make guest' : 'Make co-host'}</button>
                <button type="button" class="party-act" data-act="role" data-member="${p.esc(m.id)}" data-role="host">Make host</button>
                <button type="button" class="party-act is-danger" data-act="kick" data-member="${p.esc(m.id)}">Remove from party</button>
            </div>` : ''}
        </div>`;
    }

    /** Lines said while the chat on the page was shut, and the way to it; nothing when there are none. */
    function chatStrip(p) {
        const chat = p.status.chat;
        if (!chat || !chat.unread) return '';
        return `<div class="party-chat-strip">${BUBBLE}
            <span class="party-chat-strip-text"><strong>${chat.unread} new</strong> in chat${chat.last ? ` · last from ${p.esc(chat.last)}` : ''}</span>
            <button type="button" class="party-chat-open" data-act="chat">Open on page</button>
        </div>`;
    }

    function hostCard(p) {
        const policy = p.status.policy || {};
        const seg = (key, options) => `<div class="party-seg">${options.map(([value, label]) =>
            `<button type="button" data-act="policy" data-key="${key}" data-value="${value}" class="${String(policy[key]) === String(value) ? 'is-on' : ''}">${label}</button>`).join('')}</div>`;
        return `<div class="party-card is-tight">
            <div class="party-label">Host controls</div>
            ${seg('control', [['everyone', 'Everyone controls'], ['host', 'Hosts only']])}
            ${seg('wait', [[true, 'Wait for buffering'], [false, 'Let them catch up']])}
            <button type="button" class="party-lock" data-act="lock" role="switch" aria-checked="${!!policy.locked}">
                ${LOCK}<span class="party-lock-text">Lock the room <span>· no new joiners</span></span><span class="party-switch"></span>
            </button>
        </div>`;
    }

    PartyViews.room = {
        render(p) {
            const s = p.status;
            const members = s.members || [];
            const host = members.find((m) => m.role === 'host');
            const extra = `${canInvite(s) ? '<button type="button" class="party-small" data-act="invite">Invite</button>' : ''}
                <button type="button" class="party-small is-danger" data-act="leave">Leave</button>`;
            p.roomSig = JSON.stringify([members, s.policy, s.up, s.drift, p.openMember, p.tab && p.tab.title, s.chat]);
            return `${p.subhead({ title: host ? `${host.name || 'Someone'}'s party` : 'Watch party', note: syncLine(p), back: false, extra })}
                <div class="party-scroll">
                    ${chatStrip(p)}
                    <div class="party-card is-list">
                        <div class="party-label party-label-row">Watching<span>${members.length}</span></div>
                        ${members.map((m) => memberRow(p, m)).join('')}
                    </div>
                    ${isHost(s) ? hostCard(p) : ''}
                </div>`;
        },
        tick(p) {
            const s = p.status;
            const sig = JSON.stringify([s.members, s.policy, s.up, s.drift, p.openMember, p.tab && p.tab.title, s.chat]);
            if (sig !== p.roomSig) p.go('room');
        },
        async act(p, act, button) {
            const member = button.dataset.member;
            if (act === 'invite') return p.go('invite', { fresh: true });
            // The party's tab comes forward with its chat open. The popup
            // goes, as it does whenever another tab is brought up; when the
            // party's tab is this one, it is closed so the chat can be seen.
            if (act === 'chat') {
                const answer = await p.send({ action: 'partyChat' });
                if (answer.ok && typeof root.close === 'function') root.close();
                return answer.ok ? undefined : p.refresh();
            }
            if (act === 'leave') {
                await p.send({ action: 'partyLeave' });
                return p.go(null);
            }
            if (act === 'menu') {
                p.openMember = p.openMember === member ? null : member;
                return p.go('room');
            }
            const policy = p.status.policy || {};
            const control = act === 'role' ? { op: 'role', member, role: button.dataset.role }
                : act === 'kick' ? { op: 'kick', member }
                    : act === 'lock' ? { op: 'policy', locked: !policy.locked }
                        : act === 'policy' ? { op: 'policy', [button.dataset.key]: button.dataset.key === 'wait' ? button.dataset.value === 'true' : button.dataset.value }
                            : null;
            if (!control) return undefined;
            if (act === 'kick' || act === 'role') p.openMember = null;
            await p.send({ action: 'partyControl', ...control });
            return p.refresh();
        },
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = PartyViews.room;
})(typeof globalThis !== 'undefined' ? globalThis : this);
