/**
 * Specs for the keyboard bindings.
 *
 * The interesting cases are the ones that used to misfire: modifier
 * combinations matching two bindings at once, and shortcuts firing while the
 * user was typing — which matters a lot more now that the content script runs
 * on every site rather than only YouTube.
 */

const K = window.BB.Shortcuts;

/** A KeyboardEvent-shaped object; the bindings only read these fields. */
function key(code, { key: keyName, ctrl = false, shift = false, alt = false, meta = false, repeat = false } = {}) {
    return {
        code,
        key: keyName !== undefined ? keyName : code,
        ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta, repeat,
    };
}

/** Bindings with everything enabled, so match() is what is under test. */
function bindings() {
    return K.createBindings({}, { canRecord: () => true });
}

/** Names of every binding that claims `event`. */
function matches(event) {
    return bindings().filter((binding) => binding.match(event)).map((binding) => binding.name);
}

suite('shortcuts: matching', () => {
    test('each combination is claimed by exactly one binding', () => {
        const combos = [
            key('Digit3', { alt: true }),
            key('Digit3', { shift: true, key: '#' }),
            key('Digit3', { ctrl: true, shift: true, key: '#' }),
            key('Period', { shift: true, key: '>' }),
            key('Comma', { shift: true, key: '<' }),
            key('Equal', { shift: true, key: '+' }),
            key('KeyB', { ctrl: true, key: 'b' }),
            key('KeyS', { ctrl: true, shift: true, key: 'S' }),
        ];

        for (const event of combos) {
            const claimed = matches(event);
            assertEqual(claimed.length, 1, `${event.code} claimed by ${JSON.stringify(claimed)}`);
        }
    });

    test('skip forward is Alt+digit, backward is Shift+digit', () => {
        assertDeepEqual(matches(key('Digit5', { alt: true })), ['skip-forward']);
        assertDeepEqual(matches(key('Digit5', { shift: true, key: '%' })), ['skip-backward']);
    });

    test('Ctrl+Shift+digit boosts rather than skipping', () => {
        // Both digit bindings check the full modifier set, so adding Ctrl moves
        // the keystroke cleanly from "skip back" to "boost".
        assertDeepEqual(matches(key('Digit4', { ctrl: true, shift: true, key: '$' })), ['speed-boost']);
    });

    test('Digit0 is not a shortcut', () => {
        assertDeepEqual(matches(key('Digit0', { alt: true })), []);
    });

    test('numpad digits work like the number row', () => {
        assertDeepEqual(matches(key('Numpad7', { alt: true })), ['skip-forward']);
    });

    test('speed keys match by physical key as well as by character', () => {
        // On layouts where Shift+. is not ">", the code still identifies it.
        assertDeepEqual(matches(key('Period', { shift: true, key: '>' })), ['speed-up']);
        assertDeepEqual(matches(key('Period', { shift: true, key: ':' })), ['speed-up']);
        assertDeepEqual(matches(key('Comma', { shift: true, key: '<' })), ['speed-down']);
    });

    test('the OS/Command modifier is never ours', () => {
        assertDeepEqual(matches(key('Period', { shift: true, meta: true, key: '>' })), []);
        assertDeepEqual(matches(key('KeyB', { meta: true, key: 'b' })), []);
    });

    test('auto-repeat does not restart a held recording', () => {
        assertDeepEqual(matches(key('KeyB', { ctrl: true, key: 'b', repeat: true })), []);
    });
});

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

suite('shortcuts: digit parsing', () => {
    test('reads 1-9 from either the number row or the numpad', () => {
        assertEqual(K.digitOf({ code: 'Digit1' }), 1);
        assertEqual(K.digitOf({ code: 'Numpad9' }), 9);
    });

    test('rejects 0 and non-digit keys', () => {
        assertEqual(K.digitOf({ code: 'Digit0' }), null);
        assertEqual(K.digitOf({ code: 'KeyA' }), null);
        assertEqual(K.digitOf({}), null);
    });
});
