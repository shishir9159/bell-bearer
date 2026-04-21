/**
 * The worker: sowon reporting (gRPC-Web framing and back-off), the
 * copy-as-Markdown menus, and the prompt queue's alarm.
 */

const M = window.MockChrome;

suite('background: sowon focus reporting', () => {
    const tabAt = (url, title = 'Zig Docs') => [{ id: 1, index: 0, windowId: 100, active: true, url, title, pinned: false }];

    // Through a write, as the popup does: the worker keeps the setting it
    // read and lets go only when a write says it changed.
    const integration = (on) => chrome.storage.local.set({ connectToSowon: on });

    test('does not contact sowon unless the integration is enabled', async () => {
        M.reset({ tabs: tabAt('https://ziglang.org/documentation/') });
        await integration(false);
        M.fire.activated(1, 100);
        await M.settle();
        assertEqual(M.state.fetchCalls.length, 0);
    });

    test('posts a gRPC-Web framed FocusUpdate to the right method path', async () => {
        M.reset({ tabs: tabAt('https://ziglang.org/documentation/') });
        await integration(true);
        M.fire.activated(1, 100);
        await M.settle();

        assert(M.state.fetchCalls.length > 0, 'expected a fetch to sowon');
        const call = M.state.fetchCalls[0];
        assert(call.url.includes('/bellbearer.FocusService/ReportFocus'), 'wrong method path: ' + call.url);
        assertEqual(call.opts.headers['Content-Type'], 'application/grpc-web+proto');

        const body = call.opts.body;
        assertEqual(body[0], 0, 'data frame flag byte');
        const len = (body[1] << 24) | (body[2] << 16) | (body[3] << 8) | body[4];
        assertEqual(len, body.length - 5, 'length prefix');
    });

    test('encodes the domain with www. stripped', async () => {
        M.reset({ tabs: tabAt('https://www.youtube.com/watch?v=abc', 'Vid') });
        await integration(true);
        M.fire.activated(1, 100);
        await M.settle();

        const text = new TextDecoder().decode(M.state.fetchCalls[0].opts.body);
        assert(text.includes('youtube.com'), 'domain missing');
        assert(!text.includes('www.youtube.com'), 'www. kept');
    });

    test('backs off after repeated failures when sowon is not running', async () => {
        M.reset({ tabs: tabAt('https://ziglang.org/documentation/'), failFetch: true });
        await integration(true);
        for (let i = 0; i < 12; i++) {
            M.fire.activated(1, 100);
            await M.settle(20);
        }
        await M.settle();
        assert(M.state.fetchCalls.length <= 4, `kept hammering localhost: ${M.state.fetchCalls.length} attempts`);
    });
});

suite('background: copy-as-Markdown context menus', () => {
    const someTab = { id: 7, windowId: 100, url: 'https://example.com/a', title: 'A' };
    // "Open in reader" is there whatever the switch says.
    const markdownIds = () => M.menuIds().filter((id) => id !== 'bb-open-reader');
    const installed = async (localStore = {}) => {
        M.reset({ localStore });
        M.fire.installed();
        await M.settle();
    };

    test('creates link and page items on install, the link one for links only', async () => {
        await installed();
        assertDeepEqual(markdownIds().sort(), ['bb-copy-link-markdown', 'bb-copy-page-markdown']);
        assertDeepEqual(M.state.menus.find((m) => m.id === 'bb-copy-link-markdown').contexts, ['link']);
    });

    test('creates no Markdown menus when the setting is turned off, and still offers the reader', async () => {
        await installed({ markdownContextMenu: false });
        assertEqual(markdownIds().length, 0);
        const reader = M.state.menus.find((m) => m.id === 'bb-open-reader');
        assert(reader, 'the reader went with the Markdown switch');
        assertDeepEqual(reader.contexts, ['page']);
    });

    test('menus are rebuilt when the setting is toggled', async () => {
        await installed({ markdownContextMenu: false });
        chrome.storage.local.set({ markdownContextMenu: true });
        await M.settle();
        assertEqual(markdownIds().length, 2);
        assertEqual(M.menuIds().filter((id) => id === 'bb-open-reader').length, 1, 'the reader was offered twice');
    });

    test('menus are recreated on browser startup', async () => {
        M.reset();
        M.fire.startup();
        await M.settle();
        assertEqual(markdownIds().length, 2);
    });

    test('clicking an item asks the page to convert that link, or the page', async () => {
        M.reset();
        M.fire.menuClicked({ menuItemId: 'bb-copy-link-markdown', linkUrl: 'https://ziglang.org/', selectionText: '' }, someTab);
        await M.settle();
        assertDeepEqual(M.state.messages.map((m) => [m.tabId, m.message.action, m.message.linkUrl]),
            [[7, 'copyLinkAsMarkdown', 'https://ziglang.org/']]);

        M.reset();
        M.fire.menuClicked({ menuItemId: 'bb-copy-page-markdown' }, someTab);
        await M.settle();
        assertDeepEqual(M.state.messages.map((m) => m.message.action), ['copyMarkdownLink']);
    });

    test('an unrelated item, or a link item with no URL, does nothing', async () => {
        M.reset();
        M.fire.menuClicked({ menuItemId: 'some-other-extension-item' }, someTab);
        M.fire.menuClicked({ menuItemId: 'bb-copy-link-markdown', linkUrl: '' }, someTab);
        await M.settle();
        assertEqual(M.state.messages.length, 0);
    });

    test('REGRESSION: nothing is triggered by copying, only by the menu', async () => {
        // Ctrl+C was once intercepted and converted the page whenever the
        // selection looked empty (it does in shadow DOM and form fields).
        await installed();
        M.state.messages = [];
        M.fire.activated(7, 100);
        M.fire.updated(7, { status: 'complete' }, someTab);
        await M.settle();
        assertEqual(M.state.messages.length, 0);
    });
});

suite('background: protobuf / gRPC-Web encoding', () => {
    test('pbStringField encodes tag, length and UTF-8 payload', () => {
        // Field 2, wire type 2: (2 << 3) | 2.
        assertDeepEqual(pbStringField(2, 'Hi'), [0x12, 0x02, 0x48, 0x69]);
    });

    test('pbStringField uses multi-byte varint for long strings', () => {
        const bytes = pbStringField(1, 'x'.repeat(300));
        assertDeepEqual(bytes.slice(0, 3), [0x0a, 0xac, 0x02], 'tag, then 300 as a varint');
        assertEqual(bytes.length, 3 + 300);
    });

    test('pbStringField counts the length in UTF-8 bytes', () => {
        const bytes = pbStringField(1, 'é');
        assertEqual(bytes[1], 2);
        assertEqual(bytes.length, 4);
    });

    test('encodeFocusUpdateFrame matches the wire format sowon decodes', () => {
        const frame = encodeFocusUpdateFrame('Research', 'Zig docs', 'ziglang.org');
        assertEqual(frame[0], 0, 'uncompressed data frame');
        const len = (frame[1] << 24) | (frame[2] << 16) | (frame[3] << 8) | frame[4];
        assertEqual(len, frame.length - 5);

        // sowon's Zig test `decodeFocusUpdate` asserts these same bytes.
        const utf8 = (text) => Array.from(new TextEncoder().encode(text));
        assertDeepEqual(Array.from(frame.slice(5)), [
            0x0a, 8, ...utf8('Research'),
            0x12, 8, ...utf8('Zig docs'),
            0x1a, 11, ...utf8('ziglang.org'),
        ]);
    });

    test('empty tab group still produces a well-formed message', () => {
        const payload = Array.from(encodeFocusUpdateFrame('', 'Title', '').slice(5));
        assertDeepEqual(payload.slice(0, 2), [0x0a, 0], 'field 1, empty');
    });
});

suite('background: the prompt queue worker', () => {
    const Worker = () => window.BB.PromptQueueWorker;
    const item = (extra) => Object.assign({
        id: 'q1', site: 'chatgpt', conv: 'abc12345', chain: 'pc_1', text: 'Later', model: '',
        notBefore: 0, status: 'waiting', note: '', createdAt: 1, sentAt: 0,
    }, extra);
    const due = (extra) => item({ notBefore: Date.now() - 1000, ...extra });

    test('a queue change keeps one alarm, at the earliest a prompt is due', async () => {
        M.reset();
        const soon = Date.now() + 3600000;
        await chrome.storage.local.set({ bbPromptQueue: { items: [item({ notBefore: soon + 5000 }), item({ id: 'q2', notBefore: soon })] } });
        await M.settle();
        assertEqual(M.state.alarms[Worker().ALARM].when, soon);
        await chrome.storage.local.set({ bbPromptQueue: { items: [] } });
        await M.settle();
        assertEqual(M.state.alarms[Worker().ALARM], undefined, 'the alarm outlived the queue');
    });

    test('a due prompt whose chat is open wakes that tab, and opens nothing', async () => {
        M.reset({
            tabs: [{ id: 5, index: 0, windowId: 100, url: 'https://chatgpt.com/c/abc12345' },
                { id: 6, index: 1, windowId: 100, url: 'https://chatgpt.com/c/other' }],
            localStore: { bbPromptQueue: { items: [due()] } },
        });
        await Worker().wake();
        assertDeepEqual(M.state.messages, [{ tabId: 5, message: { action: 'promptQueueWake' } }]);
        assertEqual(M.state.created.length, 0);
    });

    test('with no tab on that chat, one is opened in the background', async () => {
        M.reset({ localStore: { bbPromptQueue: { items: [due(), due({ id: 'q2' })] } } });
        await Worker().wake();
        assertDeepEqual(M.state.created, [{ url: 'https://chatgpt.com/c/abc12345', active: false }], 'one tab per chat, not per prompt');
    });

    test('a new chat’s prompt opens the new-chat page with its model, and the setting can say no', async () => {
        M.reset({ localStore: { bbPromptQueue: { items: [due({ conv: null, model: 'gpt-5' })] } } });
        await Worker().wake();
        assertDeepEqual(M.state.created, [{ url: 'https://chatgpt.com/?model=gpt-5', active: false }]);

        M.reset({ localStore: { chatgptQueueOpenTab: false, bbPromptQueue: { items: [due()] } } });
        await Worker().wake();
        assertEqual(M.state.created.length, 0, 'a tab was opened with the setting off');
    });

    test('a prompt that came due while the browser was shut is woken for as it starts, and once', async () => {
        // Only an alarm woke a chat, set for a time to come, and Chrome
        // does not promise to keep one across a restart.
        M.reset({ localStore: { bbPromptQueue: { items: [due()] } } });
        Worker().forget();
        M.fire.startup();
        await M.settle();
        assertDeepEqual(M.state.created, [{ url: 'https://chatgpt.com/c/abc12345', active: false }]);
        await Worker().wake(); // the alarm Chrome did keep, fired late as it starts
        assertEqual(M.state.created.length, 1, 'a second tab while the first was still loading');
    });

    test('a paused chat, a site switched off and a prompt long past its time open nothing', async () => {
        Worker().forget();
        const stale = due({ id: 'q3', conv: 'stale1', notBefore: Date.now() - 13 * 3600e3 });
        M.reset({ localStore: {
            sitesOff: ['claude'],
            bbPromptQueue: { items: [due(), due({ id: 'q2', site: 'claude', conv: 'a0b1c2d3-e4f5-a6b7-c8d9-e0f1a2b3c4d5' }), stale], paused: { 'chatgpt:abc12345': true } },
        } });
        await Worker().wake();
        assertEqual(M.state.created.length, 0);
        const held = M.state.localStore.bbPromptQueue.items.find((one) => one.id === 'q3');
        assertEqual(held.status, 'held', 'the stale one was not held for a yes');
    });
});
