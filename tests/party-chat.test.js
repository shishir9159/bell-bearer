/**
 * The party's chat on the page (src/content/party-chat-panel.js), and the
 * chip's side of it, against the real DOM: what a member said is set as
 * text, the box sends within the room's budget and keeps its keys to itself,
 * opening the panel is reading it, and it sits beside the player when the
 * page has room and over the player's edge when it has not.
 */

const chatWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chatAt = (h, m) => new Date(2025, 11, 19, h, m).getTime();

/**
 * party-page.css, for the spec that needs the panel laid out: without it the
 * panel is a static block that nothing can place. Every rule in it is a
 * .bb-party-* one, so loading it touches no other spec's fixtures.
 */
let chatStyles = null;
function chatLoadStyles() {
    chatStyles = chatStyles || new Promise((done) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '../party-page.css';
        link.onload = link.onerror = () => done();
        document.head.appendChild(link);
    });
    return chatStyles;
}

/**
 * A stand-in player, and a panel on it. Found as the video's parent — the way
 * a site whose player selectors all miss is — rather than as #movie_player,
 * which another spec's fixture may have left in the page first.
 */
function chatHarness({ width = '320px' } = {}) {
    const player = document.createElement('div');
    player.style.cssText = `position:fixed;left:0;top:0;width:${width};height:300px;`;
    const video = document.createElement('video');
    player.appendChild(video);
    document.body.appendChild(player);
    const sent = [];
    const api = { runtime: { getURL: (path) => `../${path}` } };
    const getVideo = () => video;
    let chip = null;
    const chat = window.BB.PartyChatPanel.createChatPanel({
        site: 'elsewhere', getVideo, api,
        send: (msg) => sent.push(msg),
        onChange: () => { if (chip) chip.refresh(); },
    });
    return {
        chat, player, sent,
        /** The chip over the same player, synced, told the chat is there. */
        withChip() {
            chip = window.BB.PartyChip.createChip({ site: 'elsewhere', getVideo, api, chat });
            chip.bind({ drift: () => 0.04, solo: () => false });
            chip.status('synced');
            return chip;
        },
        destroy() {
            chat.remove();
            if (chip) chip.remove();
            player.remove();
        },
    };
}

const chatMembers = {
    t: 'members',
    list: [
        { id: 'm1', name: 'Nadia', role: 'host', ready: true, solo: false, away: false },
        { id: 'm2', name: 'Sam', role: 'guest', ready: false, why: 'buffering', solo: false, away: false },
    ],
};

suite('party chat: the panel on the page', () => {
    test('what a member said is set as text, and a stamped note carries its time', () => {
        const h = chatHarness();
        try {
            h.chat.room(chatMembers);
            h.chat.room({
                t: 'chat-log', unread: 2, open: false, lines: [
                    { id: 'n1', sys: true, stamp: true, at: chatAt(12, 4), text: 'Waiting for Sam…' },
                    { id: 'c1', from: 'm2', name: '<img src=x onerror="window.__bbChatPwned=1">', at: chatAt(11, 52), text: '<b>mine</b> is buffering' },
                ],
            });
            assertEqual(h.chat.unread(), 2);
            assertEqual(h.chat.element, null, 'nothing is built until it is opened');
            h.chat.open();
            const el = h.chat.element;
            assertEqual(el.querySelector('.bb-party-chat-note').textContent, 'Waiting for Sam… · 12:04');
            assertEqual(el.querySelector('.bb-party-chat-who').textContent, '<img src=x onerror="window.__bbChatPwned=1">');
            assertEqual(el.querySelector('.bb-party-chat-at').textContent, '11:52');
            assertEqual(el.querySelector('.bb-party-chat-text').textContent, '<b>mine</b> is buffering');
            assert(!el.querySelector('.bb-party-chat-lines img, .bb-party-chat-lines b'), 'no markup from a member');
            assertEqual(el.querySelector('.bb-party-chat-sub').textContent, 'Nadia\'s party · 2 watching');
            assertDeepEqual([...el.querySelectorAll('.bb-party-chat-member .bb-party-dot')].map((dot) => dot.classList.contains('is-on')), [true, false]);
            assertDeepEqual([h.sent, h.chat.unread()], [[{ t: 'chat-read', open: true }], 0], 'opened is read');
        } finally { h.destroy(); }
    });

    test('enter sends the line cleaned and empties the box; past the room\'s budget it stays, and no key leaks out', () => {
        const h = chatHarness();
        let leaked = 0;
        const spy = () => { leaked++; };
        document.addEventListener('keydown', spy);
        try {
            h.chat.open();
            const input = h.chat.element.querySelector('.bb-party-chat-in');
            const enter = (text) => {
                input.value = text;
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            };
            enter('   ');
            for (let i = 1; i <= 6; i++) enter(`  line   ${i} `);
            assertDeepEqual(h.sent.filter((msg) => msg.t === 'chat').map((msg) => msg.text), ['line 1', 'line 2', 'line 3', 'line 4', 'line 5']);
            assertEqual(input.value, '  line   6 ', 'kept, to send in a moment rather than be dropped');
            assertEqual(leaked, 0, 'the page never heard a key typed in the box');
        } finally {
            document.removeEventListener('keydown', spy);
            h.destroy();
        }
    });

    test('a line said while it is shut counts on the chip, and a click on the chip opens it', () => {
        const h = chatHarness();
        try {
            const chip = h.withChip();
            chip.room(chatMembers);
            h.chat.room(chatMembers);
            assertEqual(chip.said().sub, '· 2 watching');
            h.chat.room({ t: 'chat-line', unread: 3, line: { id: 'c9', from: 'm2', name: 'Sam', at: chatAt(12, 6), text: 'can we pause?' } });
            assertEqual(chip.said().sub, '· 3 new in chat');
            chip.element.querySelector('[data-act="chat"]').click();
            assert(h.chat.isOpen(), 'the chip opens it');
            assertEqual(chip.said().sub, '· 2 watching', 'and it is read');
            assertEqual(h.chat.element.querySelector('.bb-party-chat-text').textContent, 'can we pause?');
            chip.element.querySelector('[data-act="chat"]').click();
            assert(!h.chat.isOpen() && h.chat.element.hidden, 'and shuts it again');
            assertDeepEqual(h.sent, [{ t: 'chat-read', open: true }, { t: 'chat-read', open: false }]);
        } finally { h.destroy(); }
    });

    test('beside the player when the page has room, over its right edge when it has not', async () => {
        await chatLoadStyles();
        const h = chatHarness();
        try {
            h.chat.open();
            const panel = () => h.chat.element.getBoundingClientRect();
            const player = () => h.player.getBoundingClientRect();
            if (document.documentElement.clientWidth - player().right >= window.BB.PartyChatPanel.WIDTH + 24) {
                assertEqual(h.chat.element.parentNode, document.body);
                assertDeepEqual([panel().left, panel().top, panel().height], [player().right + 12, player().top + 12, player().height - 24], 'beside, 12 in');
            }
            h.player.style.width = '100%';
            for (let i = 0; i < 25 && h.chat.element.parentNode !== h.player; i++) await chatWait(20);
            assertEqual(h.chat.element.parentNode, h.player, 'no room beside: inside the player, to go where it goes');
            assert(!h.chat.element.classList.contains('is-beside'));
        } finally { h.destroy(); }
    });

    test('the popup\'s "Open on page" and a log that was open both open it, and the party ending takes it', () => {
        const h = chatHarness();
        try {
            h.chat.room({ t: 'chat-show' });
            assert(h.chat.isOpen());
            h.chat.close();
            h.chat.room({ t: 'chat-log', lines: [], unread: 0, open: true });
            assert(h.chat.isOpen(), 'the next video\'s tab, mid-conversation');
            const el = h.chat.element;
            h.chat.remove();
            assert(!el.isConnected, 'gone with the party');
            h.chat.room({ t: 'chat-show' });
            assertEqual(h.chat.element, null, 'and not back');
        } finally { h.destroy(); }
    });
});
