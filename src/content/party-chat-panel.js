/**
 * The watch party's chat on the page: the design's frame G panel. Who is
 * watching, what has been said, and a box to say something in.
 *
 * The conversation is the session's, not this page's: the session keeps the
 * log and hands it over whole when the tab connects (`chat-log`), then line
 * by line (`chat-line`). The tab is the part that reloads — following the
 * room to its next video is a reload — so all this keeps is a copy to draw.
 * The panel itself is not built until it is first opened.
 *
 * Where it goes. Frame G draws it beside the player, in the space YouTube
 * gives its own column, and that is where it goes when the page has room
 * there. With none (theater, a narrow window, and Netflix, which is all
 * player), in fullscreen, and in the reader, it goes over the player's right
 * edge instead — inside the player, like the chip, which is what carries it
 * into fullscreen and the reader with the video.
 *
 * Everything a member said is set as text. A name or a line is never markup.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const PartyChat = ns.PartyChat || req('../shared/party-chat.js');
    const PartyChip = ns.PartyChip || req('./party-chip.js');

    /** Frame G's panel: 328 wide, 12 in from whatever it sits against. */
    const WIDTH = 328;
    const GAP = 12;
    /** The reader's root (reader.js): the player in there has the transcript beside it, not room. */
    const READER = '#bb-reader';
    /** Scrolled up further than this, a new line does not pull the reader back down to it. */
    const STICK_PX = 40;
    /**
     * What stops at the panel. Keys typed in the box are nobody's shortcut,
     * and over the player a click on the panel is not a click on the video.
     */
    const KEPT = Object.freeze(['keydown', 'keyup', 'keypress', 'mousedown', 'pointerdown', 'click', 'dblclick']);

    const CLOSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    const SEND = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';

    const pad = (n) => String(n).padStart(2, '0');
    /** "12:04", the design's clock. */
    function clockTime(ms) {
        const d = new Date(ms);
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function createChatPanel({ site, getVideo, send, api = root.chrome, doc = root.document, now = () => Date.now(), onChange = () => {} }) {
        const s = { members: [], lines: [], unread: 0, open: false };
        let el = null;
        let parts = null;
        let sentAt = [];
        let watching = null;
        let frame = 0;
        let gone = false;

        function make(tag, className, text) {
            const node = doc.createElement(tag);
            node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        }

        function build() {
            const icon = (() => { try { return api.runtime.getURL('icons/icon128.png'); } catch (_) { return ''; } })();
            el = make('div', 'bb-party-chat');
            el.setAttribute('role', 'complementary');
            el.setAttribute('aria-label', 'Watch party chat');
            el.innerHTML = `<div class="bb-party-chat-head">${icon ? `<img src="${icon}" alt="">` : ''}
                    <div class="bb-party-chat-title"><div class="bb-party-chat-name">Watch party</div><div class="bb-party-chat-sub"></div></div>
                    <button type="button" class="bb-party-chat-close" data-act="close" aria-label="Close the chat">${CLOSE}</button>
                </div>
                <div class="bb-party-chat-members"></div>
                <div class="bb-party-chat-lines" role="log" aria-live="polite"></div>
                <div class="bb-party-chat-say">
                    <input class="bb-party-chat-in" type="text" placeholder="Say something" aria-label="Say something" autocomplete="off" maxlength="${PartyChat.MAX_CHARS}">
                    <button type="button" class="bb-party-chat-send" data-act="send" aria-label="Send">${SEND}</button>
                </div>`;
            parts = {
                sub: el.querySelector('.bb-party-chat-sub'),
                members: el.querySelector('.bb-party-chat-members'),
                lines: el.querySelector('.bb-party-chat-lines'),
                input: el.querySelector('.bb-party-chat-in'),
            };
            el.addEventListener('click', onClick);
            parts.input.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' || event.isComposing) return;
                event.preventDefault();
                say();
            });
            for (const type of KEPT) el.addEventListener(type, (event) => event.stopPropagation());
            if (ns.Theme) {
                ns.Theme.dress(el, { theme: 'dark', skin: 'default' });
                ns.Theme.appearance().then((look) => { if (el) ns.Theme.dress(el, look); }, () => {});
            }
        }

        function drawHead() {
            if (!el) return;
            const host = s.members.find((m) => m.role === 'host');
            const here = s.members.filter((m) => !m.away).length;
            parts.sub.textContent = `${host ? `${host.name}'s party · ` : ''}${here} watching`;
            parts.members.replaceChildren(...s.members.map((m) => {
                const chip = make('span', 'bb-party-chat-member');
                chip.append(make('span', `bb-party-dot ${m.ready && !m.solo && !m.away ? 'is-on' : 'is-off'}`), make('span', 'bb-party-chat-member-name', m.name || 'Someone'));
                return chip;
            }));
        }

        function lineOf(line) {
            if (line.sys) return make('div', 'bb-party-chat-note', line.stamp ? `${line.text} · ${clockTime(line.at)}` : line.text);
            const row = make('div', 'bb-party-chat-msg');
            const top = make('div', 'bb-party-chat-top');
            top.append(make('span', 'bb-party-chat-who', line.name), make('span', 'bb-party-chat-at', clockTime(line.at)));
            const text = make('div', 'bb-party-chat-text', line.text);
            // A line in Arabic or Hebrew reads from its own side.
            text.dir = 'auto';
            row.append(top, text);
            return row;
        }

        const toEnd = () => { parts.lines.scrollTop = parts.lines.scrollHeight; };

        function drawLines() {
            if (!el) return;
            parts.lines.replaceChildren(...s.lines.map(lineOf));
            toEnd();
        }

        function addLine(line) {
            s.lines.push(line);
            if (s.lines.length > PartyChat.KEEP) s.lines.shift();
            if (!el || !s.open) return;
            const box = parts.lines;
            const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < STICK_PX;
            box.appendChild(lineOf(line));
            if (box.childElementCount > PartyChat.KEEP) box.firstElementChild.remove();
            if (atEnd) toEnd();
        }

        /** Past what the room takes in a few seconds, a line stays in the box to send in a moment rather than be dropped on the way. */
        function say() {
            const text = PartyChat.clean(parts.input.value);
            if (!text) {
                parts.input.value = '';
                return;
            }
            const budget = PartyChat.allow(sentAt, now());
            sentAt = budget.recent;
            if (!budget.ok) return;
            sentAt.push(now());
            send({ t: 'chat', text });
            parts.input.value = '';
        }

        function onClick(event) {
            const act = event.target.closest('[data-act]');
            if (!act) return;
            if (act.dataset.act === 'close') close();
            else if (act.dataset.act === 'send') say();
        }

        /** Beside the player if the page has room to its right, else over its right edge. */
        function place() {
            frame = 0;
            if (!el || !s.open) return;
            const player = PartyChip.hostOf(site, getVideo, doc);
            const box = player && player.getBoundingClientRect();
            const beside = !!box && box.width > 0 && !doc.fullscreenElement && !player.closest(READER) &&
                doc.documentElement.clientWidth - box.right >= WIDTH + 2 * GAP;
            const parent = beside || !player ? doc.body : player;
            if (el.parentNode !== parent) parent.appendChild(el);
            el.classList.toggle('is-beside', beside);
            if (!beside) {
                el.style.left = el.style.top = el.style.height = '';
                return;
            }
            // Placed on the page rather than the screen, so it scrolls with
            // the player it sits beside and nothing has to follow the scroll.
            const base = root.getComputedStyle(doc.body).position === 'static'
                ? { left: -root.scrollX, top: -root.scrollY } : doc.body.getBoundingClientRect();
            el.style.left = `${Math.round(box.right - base.left + GAP)}px`;
            el.style.top = `${Math.round(box.top - base.top + GAP)}px`;
            el.style.height = `${Math.round(box.height - 2 * GAP)}px`;
        }

        const schedule = () => { if (!frame) frame = root.requestAnimationFrame(place); };

        /** While open: the player changing size (theater, the reader, fullscreen) or the window, moves it. */
        function watch(on) {
            if (on && !watching) {
                const player = PartyChip.hostOf(site, getVideo, doc);
                const observer = root.ResizeObserver && player ? new root.ResizeObserver(schedule) : null;
                if (observer) observer.observe(player);
                root.addEventListener('resize', schedule);
                doc.addEventListener('fullscreenchange', schedule);
                watching = { observer };
            } else if (!on && watching) {
                if (watching.observer) watching.observer.disconnect();
                root.removeEventListener('resize', schedule);
                doc.removeEventListener('fullscreenchange', schedule);
                if (frame) root.cancelAnimationFrame(frame);
                frame = 0;
                watching = null;
            }
        }

        function open() {
            if (gone) return;
            if (!el) build();
            s.open = true;
            s.unread = 0;
            el.hidden = false;
            // In the page before the lines are drawn: a list not yet laid
            // out has no height to scroll to its newest line with.
            place();
            watch(true);
            drawHead();
            drawLines();
            send({ t: 'chat-read', open: true });
            onChange();
        }

        function close() {
            if (!s.open) return;
            s.open = false;
            if (el) el.hidden = true;
            watch(false);
            send({ t: 'chat-read', open: false });
            onChange();
        }

        return {
            open,
            close,
            toggle: () => (s.open ? close() : open()),
            isOpen: () => s.open,
            unread: () => s.unread,
            /** What the session says: the room's members, and the chat's log, lines and asks to show. */
            room(msg) {
                switch (msg.t) {
                    case 'welcome':
                        s.members = (msg.room && msg.room.members) || [];
                        drawHead();
                        break;
                    case 'members':
                        s.members = msg.list || [];
                        drawHead();
                        break;
                    case 'chat-log':
                        s.lines = Array.isArray(msg.lines) ? msg.lines.slice(-PartyChat.KEEP) : [];
                        s.unread = s.open ? 0 : msg.unread || 0;
                        if (s.open) drawLines();
                        if (msg.open && !s.open) open();
                        else onChange();
                        break;
                    case 'chat-line':
                        if (!msg.line) break;
                        addLine(msg.line);
                        s.unread = s.open ? 0 : msg.unread || 0;
                        onChange();
                        break;
                    case 'chat-show': open(); break;
                    default: break;
                }
            },
            /** Gone with the party. */
            remove() {
                gone = true;
                watch(false);
                if (el) el.remove();
                el = null;
            },
            get element() { return el; },
        };
    }

    const PartyChatPanel = { WIDTH, GAP, clockTime, createChatPanel };

    root.BB = root.BB || {};
    root.BB.PartyChatPanel = PartyChatPanel;
    if (typeof module !== 'undefined' && module.exports) module.exports = PartyChatPanel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
