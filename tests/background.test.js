/**
 * Specs for background.js: the sowon reporting path (protobuf/gRPC-Web
 * framing + backoff), the copy-as-Markdown menus, and the settings gate.
 */

const M = window.MockChrome;

suite('background: sowon focus reporting', () => {
    function chromeTabs() {
        return [{
            id: 1, index: 0, windowId: 100, active: true,
            url: 'https://ziglang.org/documentation/', title: 'Zig Docs', pinned: false,
        }];
    }

    test('does not contact sowon unless the integration is enabled', async () => {
        M.reset({ tabs: chromeTabs(), localStore: {} });
        M.fire.activated(1, 100);
        await M.settle();
        assertEqual(M.state.fetchCalls.length, 0);
    });

    test('posts a gRPC-Web framed FocusUpdate to the right method path', async () => {
        M.reset({ tabs: chromeTabs(), localStore: { connectToSowon: true } });
        M.fire.activated(1, 100);
        await M.settle();

        assert(M.state.fetchCalls.length > 0, 'expected a fetch to sowon');
        const call = M.state.fetchCalls[0];
        assert(call.url.indexOf('/bellbearer.FocusService/ReportFocus') !== -1,
            'wrong method path: ' + call.url);
        assertEqual(call.opts.headers['Content-Type'], 'application/grpc-web+proto');

        const body = call.opts.body;
        assertEqual(body[0], 0, 'gRPC-Web data frame flag byte must be 0');
        const len = (body[1] << 24) | (body[2] << 16) | (body[3] << 8) | body[4];
        assertEqual(len, body.length - 5, 'frame length prefix must match payload');
    });

    test('encodes the domain with www. stripped', async () => {
        M.reset({
            tabs: [{
                id: 1, index: 0, windowId: 100, active: true,
                url: 'https://www.youtube.com/watch?v=abc', title: 'Vid', pinned: false,
            }],
            localStore: { connectToSowon: true },
        });
        M.fire.activated(1, 100);
        await M.settle();

        const body = M.state.fetchCalls[0].opts.body;
        const text = new TextDecoder().decode(body);
        assert(text.indexOf('youtube.com') !== -1, 'domain missing');
        assert(text.indexOf('www.youtube.com') === -1, 'www. should be stripped');
    });

    test('backs off after repeated failures when sowon is not running', async () => {
        M.reset({
            tabs: chromeTabs(),
            localStore: { connectToSowon: true },
            failFetch: true,
        });

        // Many focus changes while sowon is down.
        for (let i = 0; i < 12; i++) {
            M.fire.activated(1, 100);
            await M.settle(20);
        }
        await M.settle();

        assert(M.state.fetchCalls.length <= 4,
            'should stop hammering localhost; got ' + M.state.fetchCalls.length + ' attempts');
    });
});

suite('background: copy-as-Markdown context menus', () => {
    const someTab = { id: 7, windowId: 100, url: 'https://example.com/a', title: 'A' };

    test('creates link and page items on install (enabled by default)', async () => {
        M.reset({ localStore: {} });
        M.fire.installed();
        await M.settle();

        const ids = M.menuIds();
        assert(ids.indexOf('bb-copy-link-markdown') !== -1, 'link item missing: ' + ids);
        assert(ids.indexOf('bb-copy-page-markdown') !== -1, 'page item missing: ' + ids);
    });

    test('link item is scoped to the link context only', async () => {
        M.reset({ localStore: {} });
        M.fire.installed();
        await M.settle();

        const link = M.state.menus.find((m) => m.id === 'bb-copy-link-markdown');
        assertDeepEqual(link.contexts, ['link'], 'must only appear when right-clicking a link');
    });

    test('creates no menus when the setting is turned off', async () => {
        M.reset({ localStore: { markdownContextMenu: false } });
        M.fire.installed();
        await M.settle();
        assertEqual(M.menuIds().length, 0);
    });

    test('menus are rebuilt when the setting is toggled', async () => {
        M.reset({ localStore: { markdownContextMenu: false } });
        M.fire.installed();
        await M.settle();
        assertEqual(M.menuIds().length, 0);

        chrome.storage.local.set({ markdownContextMenu: true });
        await M.settle();
        assertEqual(M.menuIds().length, 2, 'enabling should recreate the items');
    });

    test('menus are recreated on browser startup', async () => {
        M.reset({ localStore: {} });
        M.fire.startup();
        await M.settle();
        assertEqual(M.menuIds().length, 2);
    });

    test('clicking the link item asks the page to convert that link', async () => {
        M.reset({ localStore: {} });
        M.fire.menuClicked({
            menuItemId: 'bb-copy-link-markdown',
            linkUrl: 'https://ziglang.org/',
            selectionText: '',
        }, someTab);
        await M.settle();

        assertEqual(M.state.messages.length, 1);
        assertEqual(M.state.messages[0].tabId, 7);
        assertEqual(M.state.messages[0].message.action, 'copyLinkAsMarkdown');
        assertEqual(M.state.messages[0].message.linkUrl, 'https://ziglang.org/');
    });

    test('clicking the page item asks the page to convert the page', async () => {
        M.reset({ localStore: {} });
        M.fire.menuClicked({ menuItemId: 'bb-copy-page-markdown' }, someTab);
        await M.settle();

        assertEqual(M.state.messages.length, 1);
        assertEqual(M.state.messages[0].message.action, 'copyMarkdownLink');
    });

    test('an unrelated menu item is ignored', async () => {
        M.reset({ localStore: {} });
        M.fire.menuClicked({ menuItemId: 'some-other-extension-item' }, someTab);
        await M.settle();
        assertEqual(M.state.messages.length, 0);
    });

    test('a link click with no URL does nothing', async () => {
        M.reset({ localStore: {} });
        M.fire.menuClicked({ menuItemId: 'bb-copy-link-markdown', linkUrl: '' }, someTab);
        await M.settle();
        assertEqual(M.state.messages.length, 0);
    });

    test('REGRESSION: nothing is triggered by copying, only by the menu', async () => {
        // The bug this replaced: Ctrl+C was intercepted and converted the page
        // whenever the selection *looked* empty (it is empty for shadow-DOM and
        // form-field selections), clobbering ordinary copies. background.js
        // must now never act on a keystroke — only on an explicit menu click.
        M.reset({ localStore: {} });
        M.fire.installed();
        await M.settle();
        M.state.messages = [];

        // Simulate every ambient event a plain Ctrl+C would produce.
        M.fire.activated(7, 100);
        M.fire.updated(7, { status: 'complete' }, someTab);
        await M.settle();

        assertEqual(M.state.messages.length, 0,
            'copying must never produce a Markdown conversion message');
    });
});

suite('background: protobuf / gRPC-Web encoding', () => {
    // These functions are defined at the top level of background.js.
    test('pbStringField encodes tag, length and UTF-8 payload', () => {
        const bytes = pbStringField(2, 'Hi');
        // field 2, wire type 2 -> (2<<3)|2 = 0x12; length 2; then "Hi"
        assertDeepEqual(bytes, [0x12, 0x02, 0x48, 0x69]);
    });

    test('pbStringField uses multi-byte varint for long strings', () => {
        const long = 'x'.repeat(300);
        const bytes = pbStringField(1, long);
        assertEqual(bytes[0], 0x0a, 'tag for field 1');
        // 300 = 0xAC 0x02 as a varint
        assertEqual(bytes[1], 0xac);
        assertEqual(bytes[2], 0x02);
        assertEqual(bytes.length, 3 + 300);
    });

    test('pbStringField handles multi-byte UTF-8 correctly', () => {
        const bytes = pbStringField(1, 'é');   // 2 bytes in UTF-8
        assertEqual(bytes[1], 2, 'length must be in BYTES, not characters');
        assertEqual(bytes.length, 4);
    });

    test('encodeFocusUpdateFrame matches the wire format sowon decodes', () => {
        const frame = encodeFocusUpdateFrame('Research', 'Zig docs', 'ziglang.org');
        assertEqual(frame[0], 0, 'uncompressed data frame');

        const len = (frame[1] << 24) | (frame[2] << 16) | (frame[3] << 8) | frame[4];
        assertEqual(len, frame.length - 5);

        // This exact byte sequence is asserted from the other side by the Zig
        // test `decodeFocusUpdate` in src/server.zig — the cross-language
        // contract for the FocusUpdate message.
        const payload = Array.from(frame.slice(5));
        const expected = []
            .concat([0x0a, 8], Array.from(new TextEncoder().encode('Research')))
            .concat([0x12, 8], Array.from(new TextEncoder().encode('Zig docs')))
            .concat([0x1a, 11], Array.from(new TextEncoder().encode('ziglang.org')));
        assertDeepEqual(payload, expected);
    });

    test('empty tab group still produces a well-formed message', () => {
        const frame = encodeFocusUpdateFrame('', 'Title', '');
        const payload = Array.from(frame.slice(5));
        assertEqual(payload[0], 0x0a, 'field 1 present');
        assertEqual(payload[1], 0, 'with zero length');
    });
});
