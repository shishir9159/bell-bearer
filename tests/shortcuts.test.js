/**
 * Specs for the keyboard bindings.
 *
 * The interesting cases are the ones that used to misfire: modifier
 * combinations matching two bindings at once, and shortcuts firing while the
 * user was typing — which matters a lot more now that the content script runs
 * on every site rather than only YouTube.
 */

const K = window.BB.Shortcuts;

suite('shortcuts: typing guard', () => {
    function eventOn(node) {
        return { target: node, composedPath: () => path(node) };
    }
    function path(node) {
        const out = [];
        for (let el = node; el; el = el.parentElement) out.push(el);
        out.push(document.body);
        return out;
    }

    function withElement(html, run) {
        const host = document.createElement('div');
        host.style.display = 'none';
        host.innerHTML = html;
        document.body.appendChild(host);
        try {
            run(host.firstElementChild);
        } finally {
            host.remove();
        }
    }

    test('typing in a text field is never hijacked', () => {
        withElement('<input type="text">', (el) => assert(K.isTypingTarget(eventOn(el))));
        withElement('<textarea></textarea>', (el) => assert(K.isTypingTarget(eventOn(el))));
    });

    test('a contenteditable counts as typing', () => {
        withElement('<div contenteditable="true"></div>', (el) => assert(K.isTypingTarget(eventOn(el))));
    });

    test('an ARIA textbox counts as typing', () => {
        // YouTube's comment and search boxes are divs with role="textbox".
        withElement('<div role="textbox"></div>', (el) => assert(K.isTypingTarget(eventOn(el))));
    });

    test('a nested element inside a text field still counts', () => {
        withElement('<div contenteditable="true"><span><b>x</b></span></div>', (el) => {
            assert(K.isTypingTarget(eventOn(el.querySelector('b'))));
        });
    });

    test('ordinary page content does not count', () => {
        withElement('<div><p>hello</p></div>', (el) => assert(!K.isTypingTarget(eventOn(el))));
    });
});

suite('shortcuts: skipping in shorts', () => {
    /** The real dispatcher, on the real window, with the page's answers faked. */
    function withDispatcher({ shortsSeek = true, onShorts = true } = {}, run) {
        const skips = [];
        const uninstall = K.install({
            hasVideo: () => true,
            featureOn: (name) => (name === 'shortsSeek' ? shortsSeek : false),
            onShorts: () => onShorts,
            shortsSkip: (direction) => skips.push(direction),
            stopRecording() {},
        }, { canRecord: () => false });
        try {
            return run(skips);
        } finally {
            uninstall();
        }
    }

    const press = (code, target = document.body) => {
        const event = new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event;
    };

    test('the arrows skip back and forward on a Shorts page', () => {
        withDispatcher({}, (skips) => {
            const forward = press('ArrowRight');
            press('ArrowLeft');
            assertDeepEqual(skips, [1, -1]);
            assert(forward.defaultPrevented, 'the page also acted on the key');
        });
    });

    test('everywhere else, and with the setting off, the arrows are the page’s', () => {
        withDispatcher({ onShorts: false }, (skips) => {
            assert(!press('ArrowRight').defaultPrevented, 'an arrow was taken off a page that is not Shorts');
            assertDeepEqual(skips, []);
        });
        withDispatcher({ shortsSeek: false }, (skips) => {
            assert(!press('ArrowLeft').defaultPrevented);
            assertDeepEqual(skips, []);
        });
    });

    test('an arrow typed in a comment box moves the caret, not the short', () => {
        const box = document.createElement('textarea');
        document.body.appendChild(box);
        try {
            withDispatcher({}, (skips) => {
                press('ArrowLeft', box);
                assertDeepEqual(skips, []);
            });
        } finally { box.remove(); }
    });

    test('the short skipped is the active one, not a preloaded neighbour', () => {
        const host = document.createElement('div');
        host.innerHTML = `
            <ytd-reel-video-renderer><video style="display:block;width:200px;height:300px" data-n="1"></video></ytd-reel-video-renderer>
            <ytd-reel-video-renderer is-active><video style="display:block;width:200px;height:300px" data-n="2"></video></ytd-reel-video-renderer>`;
        document.body.appendChild(host);
        try {
            assertEqual(window.BB.Site.activeShortsVideo().dataset.n, '2');
        } finally { host.remove(); }
    });
});

suite('shortcuts: double tap', () => {
    /** The real dispatcher, on the real window, with a clock the spec moves by hand. */
    function withDispatcher(run) {
        const copies = [];
        const clock = { at: 1000 };
        const uninstall = K.install({
            hasVideo: () => false,
            featureOn: () => false,
            copyPageLink: () => copies.push(clock.at),
            stopRecording() {},
        }, { canRecord: () => false, now: () => clock.at });
        try {
            return run(copies, clock);
        } finally {
            uninstall();
        }
    }

    const press = (code, init = {}, target = document.body) => {
        const event = new KeyboardEvent('keydown', {
            code, key: code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true, ...init,
        });
        target.dispatchEvent(event);
        return event;
    };

    test('y twice copies, and only the second press is taken from the page', () => {
        withDispatcher((copies, clock) => {
            const first = press('KeyY');
            assertDeepEqual(copies, []);
            assert(!first.defaultPrevented, 'a single y was taken off the page');
            clock.at += 200;
            const second = press('KeyY');
            assertEqual(copies.length, 1);
            assert(second.defaultPrevented, 'the page also acted on the second press');
        });
    });

    test('a third press starts over rather than copying again', () => {
        withDispatcher((copies, clock) => {
            for (let i = 0; i < 3; i++) { press('KeyY'); clock.at += 100; }
            assertEqual(copies.length, 1);
            press('KeyY');
            assertEqual(copies.length, 2, 'four presses are two double taps');
        });
    });

    test('too slow, it is two single presses — and the late one can still be a first', () => {
        withDispatcher((copies, clock) => {
            press('KeyY');
            clock.at += window.BB.Keybindings.DOUBLE_TAP_MS + 1;
            assert(!press('KeyY').defaultPrevented, 'a slow second y was taken off the page');
            assertDeepEqual(copies, []);
            clock.at += 100;
            press('KeyY');
            assertEqual(copies.length, 1);
        });
    });

    test('another key between the two ends the wait', () => {
        withDispatcher((copies) => {
            press('KeyY');
            press('KeyA');
            assert(!press('KeyY').defaultPrevented);
            assertDeepEqual(copies, []);
        });
    });

    test('a held key is one press, however long it repeats', () => {
        withDispatcher((copies, clock) => {
            press('KeyY');
            for (let i = 0; i < 5; i++) { clock.at += 30; press('KeyY', { repeat: true }); }
            assertDeepEqual(copies, []);
            // Let go and pressed again at once: the hold was not half of a
            // double tap, so this is a first press.
            clock.at += 30;
            assert(!press('KeyY').defaultPrevented);
            assertDeepEqual(copies, []);
        });
    });

    test('a modifier going down in between is not another key', () => {
        withDispatcher((copies) => {
            press('KeyY');
            press('ShiftLeft', { key: 'Shift', shiftKey: true });
            press('KeyY');
            assertEqual(copies.length, 1);
        });
    });

    test('y y typed into a field is two letters, and never half of a tap on the page', () => {
        const box = document.createElement('textarea');
        document.body.appendChild(box);
        try {
            withDispatcher((copies) => {
                press('KeyY', {}, box);
                press('KeyY', {}, box);
                assertDeepEqual(copies, []);
                press('KeyY');
                press('KeyY', {}, box);
                press('KeyY');
                assertDeepEqual(copies, [], 'a y in the field counted towards one on the page');
            });
        } finally { box.remove(); }
    });
});

suite('shortcuts: y y on a video', () => {
    const pageInfo = {
        getVideoId: () => 'dQw4w9WgXcQ',
        getVideoTitle: () => 'A [live] set',
        getChannelInfo: () => ({ channelName: 'Somebody' }),
    };
    const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

    test('the link opens at the second it is given, and at the start given none', () => {
        const markdown = window.BB.Markdown.createMarkdown({ site: 'youtube', pageInfo });
        assertEqual(markdown.pageLink(83).markdown, `[A \\[live\\] set by Somebody](${watch}&t=83s)`);
        assertEqual(markdown.pageLink().markdown, `[A \\[live\\] set by Somebody](${watch})`);
    });

    test('the channel is named after "by" until settings ask for the title alone, and the switch is followed at once', () => {
        const settings = { youtubeLinkChannel: true };
        const markdown = window.BB.Markdown.createMarkdown({ site: 'youtube', pageInfo, getSettings: () => settings });
        assertEqual(markdown.pageLink().text, `A [live] set by Somebody ${watch}`);
        settings.youtubeLinkChannel = false;
        assertDeepEqual(markdown.pageLink(), { markdown: `[A \\[live\\] set](${watch})`, text: `A [live] set ${watch}` });
    });

    test('a page that is not a video copies as itself, whatever the second', () => {
        const home = window.BB.Markdown.createMarkdown({ site: 'youtube', pageInfo: { ...pageInfo, getVideoId: () => null } });
        const elsewhere = window.BB.Markdown.createMarkdown({ site: 'other', pageInfo });
        for (const markdown of [home, elsewhere]) {
            assertDeepEqual(markdown.pageLink(83), markdown.pageLink());
            assert(markdown.pageLink(83).markdown.endsWith(`(${location.href})`), 'not this page');
        }
    });

    test('as plain text it is the same link, the title and then the address', () => {
        const video = window.BB.Markdown.createMarkdown({ site: 'youtube', pageInfo });
        assertEqual(video.pageLink(83).text, `A [live] set by Somebody ${watch}&t=83s`);
        const elsewhere = window.BB.Markdown.createMarkdown({ site: 'other', pageInfo });
        assertEqual(elsewhere.pageLink().text, `${document.title} ${location.href}`);
    });

    test('an advert’s clock is never taken for the video’s', () => {
        const host = document.createElement('div');
        host.innerHTML = '<div id="movie_player" class="ad-showing"><video></video></div>';
        document.body.appendChild(host);
        try {
            assertEqual(window.BB.Site.playhead({ currentTime: 7.2 }), 0);
            host.firstElementChild.classList.remove('ad-showing');
            assertEqual(window.BB.Site.playhead({ currentTime: 7.2 }), 7);
        } finally { host.remove(); }
    });
});

suite('shortcuts: pasting a copied link', () => {
    const link = { markdown: '[A \\[live\\] set](https://example.com/a)', text: 'A [live] set https://example.com/a' };

    /**
     * The real listeners on the real window, a clock the spec moves by hand,
     * and a field with the caret in it. The clipboard is the spec's to
     * imagine: a copy "lands" there or not as `lands` says, and each paste
     * names what it carries. `copy` is where the link was copied: 'here',
     * 'before' — in another tab, before this one was opened — or nowhere.
     */
    async function withField(run, { tag = 'textarea', copy = 'here' } = {}) {
        const Dom = window.BB.Dom;
        const real = Dom.copyText;
        const clipboard = { lands: true };
        Dom.copyText = async () => clipboard.lands;
        const clock = { at: 1000 };
        if (copy === 'before') await anotherTab().copyLink(link);
        const markdown = anotherTab();
        const uninstall = markdown.installPlainPaste({ now: () => clock.at });
        const field = document.createElement(tag);
        if (tag === 'div') field.contentEditable = 'true';
        document.body.appendChild(field);
        field.focus();
        try {
            if (copy === 'here') await markdown.copyLink(link);
            return await run({ field, clock, markdown, clipboard });
        } finally {
            uninstall();
            field.remove();
            Dom.copyText = real;
            await chrome.storage.local.remove(window.BB.Settings.DATA.linkCopy);
        }
    }

    /** Another tab is another content script: a module of its own, over the same storage. */
    const anotherTab = () => window.BB.Markdown.createMarkdown({ site: 'other', pageInfo: {} });
    const settle = () => new Promise((done) => setTimeout(done, 0));

    const press = (init) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    const plainPaste = () => press({ code: 'KeyV', key: 'V', ctrlKey: true, shiftKey: true });

    /** A paste of `text` aimed at `target`, as the browser sends one. */
    const paste = (target, text) => {
        const data = new DataTransfer();
        data.setData('text/plain', text);
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event;
    };

    test('ctrl+shift+v pastes the link as plain text, and the Markdown never lands', async () => {
        await withField(({ field }) => {
            const reached = [];
            const onPaste = (event) => reached.push(event.clipboardData.getData('text/plain'));
            document.addEventListener('paste', onPaste);
            try {
                plainPaste();
                const event = paste(field, link.markdown);
                assert(event.defaultPrevented, 'the Markdown was left to paste as well');
                assertEqual(field.value, link.text);
                assertDeepEqual(reached, [link.text], 'the page was shown the Markdown too');
            } finally { document.removeEventListener('paste', onPaste); }
        });
    });

    test('ctrl+v pastes what the clipboard holds, which is the Markdown', async () => {
        await withField(({ field }) => {
            press({ code: 'KeyV', key: 'v', ctrlKey: true });
            assert(!paste(field, link.markdown).defaultPrevented, 'an ordinary paste was taken');
            assertEqual(field.value, '');
        });
    });

    test('an editor that reads its own pastes is handed the text, and nothing is typed in beside it', async () => {
        await withField(({ field }) => {
            const taken = [];
            field.addEventListener('paste', (event) => {
                taken.push(event.clipboardData.getData('text/plain'));
                event.preventDefault();
            });
            plainPaste();
            paste(field, link.markdown);
            assertDeepEqual(taken, [link.text]);
            assertEqual(field.textContent, '', 'typed in as well as handed over');
        }, { tag: 'div' });
    });

    test('a Markdown link that is not the one copied pastes as it is', async () => {
        await withField(({ field }) => {
            plainPaste();
            assert(!paste(field, '[somebody else’s](https://example.com/b)').defaultPrevented);
            assertEqual(field.value, '');
        });
    });

    test('the key goes stale: a paste long after it, or after another key, is an ordinary one', async () => {
        await withField(async ({ field, clock }) => {
            plainPaste();
            clock.at += window.BB.Markdown.PLAIN_PASTE_MS + 1;
            assert(!paste(field, link.markdown).defaultPrevented, 'a paste from the menu a while later was reworded');
            plainPaste();
            press({ code: 'KeyV', key: 'v', ctrlKey: true });
            assert(!paste(field, link.markdown).defaultPrevented, 'ctrl+v straight after was reworded');
            plainPaste();
            paste(field, link.markdown);
            await settle();
            assert(!paste(field, link.markdown).defaultPrevented, 'a paste from the menu just after one was taken for the same press');
            assertEqual(field.value, link.text);
        });
    });

    test('REGRESSION: a cancelled paste sent again for the same press is cancelled too, not pasted beside the text', async () => {
        // Chrome, handed the paste as an edit command with the key, takes
        // the cancelled command for a key nobody handled and pastes again
        // through its own binding. The Markdown landed after the text.
        await withField(({ field }) => {
            plainPaste();
            paste(field, link.markdown);
            assert(paste(field, link.markdown).defaultPrevented, 'the second paste of one press went through as Markdown');
            assertEqual(field.value, link.text, 'and the text is not typed in twice for it');
            plainPaste();
            paste(field, link.markdown);
            assertEqual(field.value, link.text + link.text, 'a second press is a second paste');
        });
    });

    test('a paste aimed at the page rather than a field is left alone', async () => {
        await withField(({ field }) => {
            field.readOnly = true;
            plainPaste();
            assert(!paste(field, link.markdown).defaultPrevented, 'a field that cannot be typed in');
            plainPaste();
            assert(!paste(document.body, link.markdown).defaultPrevented, 'the page itself');
        });
    });

    test('only a copy as Markdown is answered, and only one that reached the clipboard', async () => {
        await withField(async ({ field, markdown, clipboard }) => {
            assertEqual(await markdown.copyLink(link, false), true);
            plainPaste();
            assert(!paste(field, link.markdown).defaultPrevented, 'a copy as text has no other spelling to paste');
            clipboard.lands = false;
            assertEqual(await markdown.copyLink(link), false);
            plainPaste();
            assert(!paste(field, link.markdown).defaultPrevented, 'a link that never reached the clipboard');
            clipboard.lands = true;
            await markdown.copyLink(link);
            plainPaste();
            paste(field, link.markdown);
            assertEqual(field.value, link.text);
        }, { copy: false });
    });

    test('a link copied in another tab pastes as text in this one', async () => {
        await withField(async ({ field }) => {
            plainPaste();
            assert(!paste(field, link.markdown).defaultPrevented, 'nothing has been copied yet');
            await anotherTab().copyLink(link);
            plainPaste();
            paste(field, link.markdown);
            assertEqual(field.value, link.text);
        }, { copy: false });
    });

    test('and in a tab opened after the copy, once it has read what was copied', async () => {
        await withField(async ({ field }) => {
            await settle();
            plainPaste();
            paste(field, link.markdown);
            assertEqual(field.value, link.text);
        }, { copy: 'before' });
    });
});
