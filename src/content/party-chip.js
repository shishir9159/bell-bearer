/**
 * The watch party on the page: the status chip over the player, and the toast
 * a host gets when someone asks for a pause (the design's frames H and G).
 *
 * The chip says one thing at a time, the most pressing first: the party
 * ended, the link is down, you stepped out, you are on another video, host
 * control just turned your click back, Netflix will not seek, the room is
 * waiting on someone, or — the usual — how closely you are in sync.
 *
 * Injected with party-media.js, which builds it and feeds it: `status` is the
 * adapter's own state, `room` everything else the room says. It hangs off the
 * player rather than the page, so it goes into fullscreen and into the reader
 * with the video.
 */
(function (root) {
    'use strict';

    const ns = root.BB || {};
    /** How long a passing notice (host control, no Netflix seek) stays before the chip goes back to the room. */
    const NOTICE_MS = 8000;
    /** A request nobody answers leaves on its own. */
    const TOAST_MS = 15000;
    /** The synced figure is redrawn at most this often: timeupdate is four times a second. */
    const DRIFT_REDRAW_MS = 1000;
    const HOSTS = Object.freeze({ youtube: ['#movie_player'], netflix: ['.watch-video', '.watch-video--player-view'] });
    const ASKS = Object.freeze({ pause: 'asks to pause', play: 'asks to play', seek: 'asks to skip', rate: 'asks for another speed' });
    /** The dot's colour, as a class: a page's CSP may refuse an inline style. */
    const ON = 'is-on';
    const OFF = 'is-off';
    const BAD = 'is-bad';
    const esc = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

    function createChip({ site, getVideo, api = root.chrome, doc = root.document, now = () => Date.now() }) {
        const icon = (() => { try { return api.runtime.getURL('icons/icon128.png'); } catch (_) { return ''; } })();
        const el = doc.createElement('div');
        el.className = 'bb-party-chip';
        el.setAttribute('role', 'status');
        const toast = doc.createElement('div');
        toast.className = 'bb-party-toast';
        toast.hidden = true;
        const look = { theme: 'dark', skin: 'default' };
        const s = { status: 'joining', detail: null, you: null, members: [], up: true, ended: null, noticeUntil: 0, notice: null };
        let media = null;
        let toastTimer = null;
        let noticeTimer = null;
        let drawnAt = 0;
        let gone = false;

        const nameOf = (id) => ((s.members.find((m) => m.id === id) || {}).name || 'Someone');

        function waitingOn(ids) {
            const names = (ids || []).filter((id) => id !== s.you).map(nameOf);
            if (!names.length) return 'Waiting…';
            return names.length === 1 ? `Waiting for ${names[0]}…` : `Waiting for ${names[0]} and ${names.length - 1} more…`;
        }

        /** What the chip says now: {dot, label, sub, a, b}. */
        function said() {
            if (s.ended === 'host-left') return { dot: BAD, label: 'Host left', a: ['Keep watching solo', 'dismiss'], b: ['Get a new invite', 'invite'] };
            if (s.ended === 'kicked') return { dot: BAD, label: 'Removed from the party', a: ['Keep watching solo', 'dismiss'] };
            if (s.ended) return { dot: BAD, label: 'The party ended', a: ['Keep watching solo', 'dismiss'] };
            if (!s.up) return { dot: OFF, label: 'Reconnecting…', sub: 'playing on your own meanwhile' };
            if (media && media.solo()) return { dot: OFF, label: 'Watching solo', a: ['Rejoin', 'rejoin'] };
            if (s.status === 'elsewhere') return { dot: OFF, label: 'Different video', sub: 'the party is on another one', a: ['Go to party video', 'follow'] };
            if (s.notice && now() < s.noticeUntil) return s.notice;
            if (s.status === 'waiting') return { dot: OFF, label: waitingOn(s.detail), sub: 'buffering' };
            if (s.status === 'synced') {
                const d = media && media.drift();
                const count = s.members.filter((m) => !m.away).length;
                return {
                    dot: ON, label: typeof d === 'number' ? `Synced ±${Math.round(Math.abs(d) * 1000)} ms` : 'Synced',
                    sub: count ? `· ${count} watching` : '',
                };
            }
            return { dot: OFF, label: 'Joining the party…' };
        }

        function host() {
            for (const selector of HOSTS[site] || []) {
                const found = doc.querySelector(selector);
                if (found) return found;
            }
            const video = getVideo();
            return video && video.parentElement;
        }

        const button = (label, act, filled) => `<button type="button" class="bb-party-btn${filled ? '' : ' is-quiet'}" data-act="${act}">${esc(label)}</button>`;

        function draw() {
            if (gone) return;
            const at = host();
            if (at && el.parentNode !== at) {
                at.appendChild(el);
                at.appendChild(toast);
            }
            const line = said();
            el.innerHTML = `<div class="bb-party-chip-line">${icon ? `<img src="${icon}" alt="">` : ''}
                <span class="bb-party-dot ${line.dot}"></span>
                <span class="bb-party-label">${esc(line.label)}</span>${line.sub ? `<span class="bb-party-sub">${esc(line.sub)}</span>` : ''}</div>
                ${line.a ? `<div class="bb-party-acts">${button(...line.a, true)}${line.b ? button(...line.b, false) : ''}</div>` : ''}`;
            drawnAt = now();
        }

        /** Say this for a few seconds, then go back to what the room is doing. */
        function notice(what) {
            s.notice = what;
            s.noticeUntil = now() + NOTICE_MS;
            clearTimeout(noticeTimer);
            noticeTimer = setTimeout(draw, NOTICE_MS + 20);
        }

        function ask(from, op) {
            clearTimeout(toastTimer);
            const doable = op === 'pause' || op === 'play';
            toast.innerHTML = `<span><strong>${esc(nameOf(from))}</strong> ${ASKS[op] || 'asks for a change'}</span>
                ${doable ? button(op === 'pause' ? 'Pause' : 'Play', op, true) : ''}${button('Ignore', 'ignore', false)}`;
            toast.hidden = false;
            toastTimer = setTimeout(() => { toast.hidden = true; }, TOAST_MS);
        }

        function remove() {
            gone = true;
            clearTimeout(toastTimer);
            clearTimeout(noticeTimer);
            doc.removeEventListener('timeupdate', onTime, true);
            el.remove();
            toast.remove();
        }

        function onClick(event) {
            const act = event.target.closest('[data-act]');
            if (!act) return;
            event.stopPropagation();
            const video = getVideo();
            switch (act.dataset.act) {
                case 'request':
                    media.request('pause');
                    s.notice = null;
                    break;
                case 'solo': media.setSolo(true); break;
                case 'rejoin': media.setSolo(false); break;
                case 'follow': media.goToRoomMedia(); break;
                // Done to the player as the user would: party-media hears it
                // as this member's own pause, and the room follows.
                case 'pause': if (video) video.pause(); toast.hidden = true; break;
                case 'play': if (video) video.play().catch(() => {}); toast.hidden = true; break;
                case 'ignore': toast.hidden = true; break;
                case 'dismiss': remove(); return;
                case 'invite':
                    try { api.runtime.sendMessage({ action: 'partyPopup' }).catch(() => {}); } catch (_) { /* the extension reloaded */ }
                    remove();
                    return;
                default: return;
            }
            draw();
        }

        function onTime(event) {
            if (s.status === 'synced' && event.target === getVideo() && now() - drawnAt >= DRIFT_REDRAW_MS) draw();
        }

        el.addEventListener('click', onClick);
        toast.addEventListener('click', onClick);
        // A click on the chip is not a click on the video under it.
        for (const one of [el, toast]) one.addEventListener('mousedown', (event) => event.stopPropagation());
        doc.addEventListener('timeupdate', onTime, { capture: true, passive: true });
        if (ns.Theme) {
            ns.Theme.dress(el, look);
            ns.Theme.dress(toast, look);
            ns.Theme.appearance().then((got) => { ns.Theme.dress(el, got); ns.Theme.dress(toast, got); }, () => {});
        }

        return {
            bind(adapter) {
                media = adapter;
                draw();
            },
            status(next, detail) {
                if (next === 'left') {
                    // Detached: gone with the party, unless there is something left to say about how it ended.
                    if (!s.ended) remove();
                    else draw();
                    return;
                }
                if (next === 'rejected' && detail === 'policy') {
                    notice({ dot: ON, label: 'Host has control', a: ['Request pause', 'request'], b: ['Watch solo', 'solo'] });
                } else if (next === 'no-seek') {
                    notice({ dot: OFF, label: 'Netflix seek unavailable', sub: 'play and pause only' });
                }
                if (next !== 'rejected' && next !== 'no-seek') {
                    s.status = next;
                    s.detail = detail;
                }
                draw();
            },
            room(msg) {
                switch (msg.t) {
                    case 'welcome':
                        s.you = msg.you;
                        s.members = (msg.room && msg.room.members) || [];
                        s.up = true;
                        break;
                    case 'members': s.members = msg.list || []; break;
                    case 'link': s.up = msg.up !== false; break;
                    case 'request': ask(msg.from, msg.op); return;
                    case 'error': s.ended = msg.code || 'ended'; break;
                    default: return;
                }
                draw();
            },
            said,
            element: el,
            toast,
            remove,
        };
    }

    const PartyChip = { NOTICE_MS, TOAST_MS, createChip };

    root.BB = root.BB || {};
    root.BB.PartyChip = PartyChip;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyChip;
})(typeof globalThis !== 'undefined' ? globalThis : this);
