/**
 * The YouTube reader, for what only a real DOM answers: a player element
 * really moving out of the page and back, the transcript set as paragraphs
 * of words, a stroke of the pen over those words turning into a checkpoint,
 * notes at the end of a highlight, five layouts, and every skin.
 *
 * The player is a stand-in with YouTube's id on it. What is under test is
 * where the element goes and whether it comes back to the right place — not
 * YouTube's own player, which a spec runner does not have.
 *
 * Wrapped, because this file shares the global scope with the other specs.
 */
(function () {
    'use strict';

    const Reader = () => window.BB.Reader;
    const Layout = () => window.BB.ReaderLayout;

    const HOST_ID = 'bb-reader-test';

    /** A watcher that keeps its tasks, so a spec can run a pass by hand. */
    function makeWatcher() {
        const tasks = new Map();
        return {
            tasks,
            add: (name, run) => tasks.set(name, run),
            remove: (name) => tasks.delete(name),
            has: (name) => tasks.has(name),
            schedule() {},
            stop() {},
            pass() {
                for (const [name, run] of tasks) if (run() === true) tasks.delete(name);
            },
        };
    }

    /**
     * YouTube's shape, as far as the reader cares: the player between two
     * siblings inside a container, so "put back against its sibling" and
     * "put back at its index" can be told apart. The video sits in its own
     * positioned container, absolutely placed and sized inline, as YouTube's
     * stylesheet has it now.
     */
    function stagePage({ chapters = '' } = {}) {
        teardown();
        const host = document.createElement('div');
        host.id = HOST_ID;
        host.innerHTML = `
            <div id="bb-reader-test-home"><span class="before"></span><div id="movie_player"
                 class="html5-video-player"><div class="html5-video-container" style="position:relative;z-index:10"><video
                 class="video-stream html5-main-video" style="position:absolute;width:640px;height:360px;left:0;top:0"></video></div></div><span
                 class="after"></span></div>${chapters}`;
        document.body.appendChild(host);
        return {
            home: host.querySelector('#bb-reader-test-home'),
            player: host.querySelector('#movie_player'),
            after: host.querySelector('.after'),
        };
    }

    function teardown() {
        const host = document.getElementById(HOST_ID);
        if (host) host.remove();
        document.querySelectorAll('#bb-reader').forEach((node) => node.remove());
        document.documentElement.classList.remove('bb-reader-open');
    }

    /**
     * A transcript in the shape transcript.js hands over: a sentence a line,
     * nine words each, long enough to scroll. Line i starts at 3i seconds
     * and its words are 9i to 9i + 8.
     */
    function makeTranscript(count = 60) {
        const snippets = [];
        for (let i = 0; i < count; i++) {
            snippets.push({ text: `Line ${i} of the talk, said at ${i * 3} seconds.`, start: i * 3, duration: 2.5 });
        }
        return { snippets, languageCode: 'en', language: 'English' };
    }

    function makeReader({
        transcript = makeTranscript(10), video = { id: 'vid00000001', title: 'A talk' }, settings = {}, transcripts: given = null,
    } = {}) {
        const watcher = makeWatcher();
        let fetches = 0;
        const seeks = [];
        const copied = [];
        const values = Object.assign({}, window.BB.Settings.DEFAULTS, settings);
        const player = { seekTo: (t) => { seeks.push(t); return true; }, currentTime: () => 0 };
        const transcripts = given || { fetch: () => { fetches++; return Promise.resolve(transcript); } };
        const reader = Reader().createReader({
            player, watcher, getVideo: () => video, getSettings: () => values, transcripts,
            copyText: async (text) => { copied.push(text); return true; },
        });
        return { reader, watcher, seeks, values, copied, fetches: () => fetches };
    }

    const settle = () => new Promise((done) => setTimeout(done, 0));
    const pause = (ms) => new Promise((done) => setTimeout(done, ms));

    async function waitFor(predicate, what, ms = 3000) {
        const started = Date.now();
        while (!(await predicate())) {
            if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
            await pause(10);
        }
    }

    /**
     * content.css, and the reader's own rules after it the way YouTube's
     * entry loads them, for the specs that need the reader laid out — a
     * pen needs words with somewhere to be. Loaded here rather than for the
     * whole suite, where they would restyle every other spec's fixtures.
     */
    let styles = null;
    function loadStyles() {
        if (styles) return styles;
        const sheet = (href, id) => new Promise((done) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.id = id;
            link.onload = link.onerror = () => done();
            document.head.appendChild(link);
        });
        styles = sheet('../content.css', 'bb-reader-test-styles')
            .then(() => sheet('../content-youtube.css', 'bb-reader-test-styles-youtube'));
        return styles;
    }

    /** Open a reader, laid out, with its transcript drawn. */
    async function openReady(options = {}) {
        await loadStyles();
        const page = stagePage(options.page || {});
        const made = makeReader(options);
        made.reader.open();
        await waitFor(() => !/Loading/.test(made.reader.element.querySelector('.rd-paras').textContent), 'the transcript');
        await pause(20);
        return Object.assign({ page }, made);
    }

    /** The page's <video> reporting a time, the way YouTube's would. */
    function playTo(page, seconds) {
        const video = page.player.querySelector('video');
        Object.defineProperty(video, 'currentTime', { configurable: true, get: () => seconds });
        video.dispatchEvent(new Event('timeupdate'));
    }

    /** Pretend the browser went fullscreen on `element`, or came out of it. */
    function fullscreen(element) {
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element });
        document.dispatchEvent(new Event('fullscreenchange'));
        if (!element) delete document.fullscreenElement;
    }

    const saved = async () => {
        const videos = await window.BB.Bookmarks.load();
        return videos.length ? videos[0].bookmarks : [];
    };

    const word = (reader, i) => reader.element.querySelector(`.rd-paras .rd-w[data-w="${i}"]`);
    const centre = (node) => {
        const box = node.getBoundingClientRect();
        return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    };

    /** A pointer event of `type` at the middle of `node`, from the left button. */
    function point(node, type, extra = {}) {
        node.dispatchEvent(new PointerEvent(type, Object.assign({
            bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true,
        }, centre(node), extra)));
    }

    /** Draw the pen from word `from` to word `to`, and lift it. */
    function stroke(reader, from, to, extra = {}) {
        point(word(reader, from), 'pointerdown', extra);
        point(word(reader, from + (to > from ? 1 : -1)), 'pointermove', extra);
        point(word(reader, to), 'pointermove', extra);
        point(word(reader, to), 'pointerup', extra);
    }

    /** A click of the pen: down and up on one word. */
    function tap(reader, i, extra = {}) {
        point(word(reader, i), 'pointerdown', extra);
        point(word(reader, i), 'pointerup', extra);
    }

    const toastText = (reader) => reader.element.querySelector('.rd-toast-text').textContent;
    const marked = (reader) => Array.from(reader.element.querySelectorAll('.rd-paras .rd-w.m'), (n) => n.textContent);

    suite('reader — the player', () => {
        test('opening adopts the real player rather than copying it', () => {
            const page = stagePage();
            const { reader } = makeReader();
            assert(reader.open(), 'the reader did not open on a page with a player');
            assert(reader.element.contains(page.player), 'the player was not moved into the reader');
            assertEqual(document.querySelectorAll('#movie_player').length, 1, 'there are two players');
            assert(document.documentElement.classList.contains('bb-reader-open'));
            reader.close();
            teardown();
        });

        test('the reader’s own styles stop at the player, whose controls are YouTube’s', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader, page } = await openReady();
            // REGRESSION: border-box reached into the player, and every icon in
            // YouTube's control bar drew at 24px in a 40px button.
            const control = document.createElement('div');
            control.style.cssText = 'width: 40px; padding: 8px';
            page.player.appendChild(control);
            assertEqual(getComputedStyle(control).boxSizing, 'content-box', 'the reader restyled a control of YouTube’s');
            assertEqual(control.getBoundingClientRect().width, 56);
            assertEqual(getComputedStyle(reader.element.querySelector('.rd-panel')).boxSizing, 'border-box');
            reader.close();
            teardown();
        });

        test('closing puts the player back against its sibling, not its index', () => {
            const page = stagePage();
            const { reader } = makeReader();
            reader.open();
            // YouTube inserting something ahead of the player while we hold
            // it moves the index it used to have.
            page.home.insertBefore(document.createElement('i'), page.home.firstChild);
            reader.close();

            assert(page.player.parentNode === page.home, 'the player did not go home');
            assert(page.player.nextSibling === page.after, 'the player went back in the wrong place');
            assertEqual(document.getElementById('bb-reader-slot'), null, 'the slot was left behind');
            assert(!document.documentElement.classList.contains('bb-reader-open'));
            teardown();
        });

        test('closing twice, or with the player gone, throws nothing', () => {
            const page = stagePage();
            const { reader } = makeReader();
            reader.open();
            reader.close();
            reader.close();

            reader.open();
            page.player.remove();
            reader.close();
            assertEqual(reader.isOpen, false);
            teardown();
        });

        test('a player YouTube reparents is taken back', () => {
            const page = stagePage();
            const { reader, watcher } = makeReader();
            reader.open();
            page.home.appendChild(page.player);
            watcher.pass();
            assert(reader.element.contains(page.player), 'the reparented player was left where YouTube put it');

            reader.close();
            watcher.pass();
            assert(!watcher.has('reader-player'), 'the task outlived the reader');
            teardown();
        });

        test('the player goes home for a fullscreen of YouTube’s own and comes back after', () => {
            const page = stagePage();
            const { reader } = makeReader();
            reader.open();

            fullscreen(page.home);
            assert(page.player.parentNode === page.home, 'fullscreen showed a container with no player in it');
            fullscreen(null);
            assert(reader.element.contains(page.player), 'the player was not taken back afterwards');

            // A fullscreen of the player itself works where it stands.
            fullscreen(page.player);
            assert(reader.element.contains(page.player), 'the player was moved out of its own fullscreen');
            fullscreen(null);
            reader.close();
            teardown();
        });
    });

    suite('reader — the transcript', () => {
        test('the transcript is set as paragraphs of words, each with its time in the gutter', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader } = await openReady({ transcript: makeTranscript(20) });
            const paras = reader.element.querySelectorAll('.rd-paras .rd-p');
            assert(paras.length > 1 && paras.length < 20, `${paras.length} paragraphs for twenty lines`);
            assertEqual(reader.element.querySelectorAll('.rd-paras .rd-w').length, 20 * 9);
            assertEqual(paras[0].querySelector('.rd-stamp').textContent, '0:00');
            assert(paras[0].classList.contains('is-now'), 'the opening paragraph was not marked as playing');
            reader.close();
            teardown();
        });

        test('a click on a word plays from it, and on a paragraph’s time from there', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader, seeks } = await openReady();
            tap(reader, 9 * 3);
            assertDeepEqual(seeks, [9], 'a word plays from when it is said');
            const stamps = reader.element.querySelectorAll('.rd-paras .rd-stamp');
            stamps[stamps.length - 1].click();
            assertEqual(seeks[1], Number(stamps[stamps.length - 1].dataset.t));
            assertEqual(window.BB.Bookmarks && (await saved()).length, 0, 'a click saved a highlight');
            reader.close();
            teardown();
        });

        test('the playing sentence and paragraph follow the video, and the column with it', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader, page } = await openReady({ transcript: makeTranscript() });
            playTo(page, 40 * 3 + 1);
            const now = reader.element.querySelectorAll('.rd-paras .rd-s.is-now');
            assertEqual(now.length, 1, 'more than one sentence is playing');
            assert(now[0].textContent.startsWith('Line 40 '), `"${now[0].textContent}" is not the sentence playing`);
            const paras = Array.from(reader.element.querySelectorAll('.rd-paras .rd-p'));
            const at = paras.findIndex((p) => p.classList.contains('is-now'));
            assert(at > 0 && paras.slice(0, at).every((p) => p.classList.contains('is-past')), 'what was said is not greyed');
            assert(!paras[at].classList.contains('is-past'), 'the playing paragraph greyed');
            await waitFor(() => reader.element.querySelector('.rd-scroll').scrollTop > 0, 'the column to follow');
            reader.close();
            teardown();
        });

        test('scrolled away it stops following, and offers the way back', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader, page } = await openReady({ transcript: makeTranscript() });
            const column = reader.element.querySelector('.rd-scroll');
            playTo(page, 30 * 3);
            await waitFor(() => column.scrollTop > 0, 'the column to follow');
            await pause(900);
            column.scrollTop = 0;
            column.dispatchEvent(new Event('scroll'));
            playTo(page, 50 * 3);
            await pause(400);
            assertEqual(column.scrollTop, 0, 'the column pulled itself back while being read');
            const back = reader.element.querySelector('.rd-now');
            assert(!back.hidden, 'nothing offered the way back');
            assert(/Now · 2:30/.test(back.textContent), back.textContent);
            back.click();
            await waitFor(() => column.scrollTop > 0, 'the Now button to scroll back');
            reader.close();
            teardown();
        });

        test('a video with no transcript says so plainly, and still lists its checkpoints', async () => {
            MockChrome.reset({ localStore: {} });
            await window.BB.Bookmarks.save([{ id: 'vid00000001', title: 'A talk', url: 'u', bookmarks: [
                { id: 'a', time: 6, start: 6, end: 9, subtitle: 'made with Ctrl+B' }] }]);
            const { reader } = await openReady({ transcript: null });
            assert(/no transcript/i.test(reader.element.querySelector('.rd-paras').textContent), 'nothing said the transcript was missing');
            await waitFor(() => /Ctrl\+B/.test(reader.element.querySelector('.rd-list-pane').textContent), 'the checkpoint in the list');
            reader.close();
            teardown();
        });
    });

    suite('reader — the pen', () => {
        test('a stroke saves exactly the words under it, and Undo takes it back', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader } = await openReady();
            stroke(reader, 20, 24);
            assertDeepEqual(marked(reader), ['of', 'the', 'talk,', 'said', 'at'], 'the ink is not where the pen went');
            await waitFor(async () => (await saved()).length === 1, 'the highlight to be saved');
            const [one] = await saved();
            assertEqual(one.subtitle, 'of the talk, said at');
            assert(one.id && one.start > 6 && one.end < 9 && one.time === 6, JSON.stringify(one));
            assert(/^Highlighted 0:06–0:0\d$/.test(toastText(reader)), toastText(reader));

            reader.element.querySelector('.rd-toast-undo').click();
            await waitFor(async () => (await saved()).length === 0, 'the Undo');
            assertDeepEqual(marked(reader), []);
            reader.close();
            teardown();
        });

        test('two highlights beginning in the same second both survive', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader } = await openReady();
            stroke(reader, 18, 19);
            stroke(reader, 22, 23);
            await waitFor(async () => (await saved()).length === 2, 'both highlights to be saved');
            const both = await saved();
            assertEqual(both[0].time, both[1].time, 'they do not share their second');
            reader.close();
            teardown();
        });

        test('a stroke that touches highlights joins them, and their notes go with it', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader } = await openReady();
            stroke(reader, 18, 19);
            stroke(reader, 23, 24);
            await waitFor(async () => (await saved()).length === 2, 'two highlights');
            const keys = (await saved()).map((one) => one.id);
            await window.BB.Bookmarks.update((videos) => window.BB.Bookmarks.editBookmark(videos, 'vid00000001', keys[0], { note: 'first' }));
            await window.BB.Bookmarks.update((videos) => window.BB.Bookmarks.editBookmark(videos, 'vid00000001', keys[1], { note: 'second' }));
            await pause(50);
            // 20 to 22 fills the gap: one passage now, drawn and stored as one.
            stroke(reader, 20, 22);
            await waitFor(async () => (await saved()).length === 1, 'the three to become one');
            const [one] = await saved();
            assertEqual(one.subtitle, 'Line 2 of the talk, said at');
            assertEqual(one.note, 'first second');
            assertEqual(one.id, keys[0], 'the one kept is the first it touched');
            assert(/^Extended to /.test(toastText(reader)), toastText(reader));
            reader.element.querySelector('.rd-toast-undo').click();
            await waitFor(async () => (await saved()).length === 2, 'the Undo to split them again');
            reader.close();
            teardown();
        });

        test('Alt with a click rubs a highlight out, and Undo puts it back', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader } = await openReady();
            stroke(reader, 27, 30);
            await waitFor(async () => (await saved()).length === 1, 'the highlight');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
            assert(reader.element.classList.contains('is-erasing'), 'Alt did not turn the pen into an eraser');
            tap(reader, 28, { altKey: true });
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
            assert(!reader.element.classList.contains('is-erasing'));
            await waitFor(async () => (await saved()).length === 0, 'the highlight to go');
            assertEqual(toastText(reader), 'Highlight removed');
            reader.element.querySelector('.rd-toast-undo').click();
            await waitFor(async () => (await saved()).length === 1, 'the Undo');
            reader.close();
            teardown();
        });

        test('a picked highlight shows its toolbar and knobs, a knob trims it, and Shift reaches it further', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader, seeks } = await openReady();
            stroke(reader, 36, 40);
            await waitFor(async () => (await saved()).length === 1, 'the highlight');
            tap(reader, 38);
            const toolbar = reader.element.querySelector('.rd-tb');
            assert(!toolbar.hidden, 'no toolbar over a picked highlight');
            toolbar.querySelector('.rd-tb-play').click();
            assertEqual(seeks[seeks.length - 1], (await saved())[0].start, 'Play did not play the highlight');

            const knob = reader.element.querySelector('.rd-knob-start');
            assert(!knob.hidden, 'no knobs');
            point(knob, 'pointerdown');
            point(word(reader, 38), 'pointermove');
            point(word(reader, 38), 'pointerup');
            // Words 36 to 40 are "Line 4 of the talk,": from 38 is "of the talk,".
            await waitFor(async () => (await saved())[0].subtitle === 'of the talk,', 'the trim');
            assert(/^Changed to /.test(toastText(reader)), toastText(reader));

            tap(reader, 46, { shiftKey: true });
            await waitFor(async () => (await saved())[0].subtitle === 'of the talk, said at 12 seconds. Line 5', 'the reach with Shift');
            assertEqual((await saved()).length, 1);
            reader.close();
            teardown();
        });

        test('Backspace removes the picked highlight; Escape lets go before it closes', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader } = await openReady();
            stroke(reader, 45, 47);
            stroke(reader, 54, 56);
            await waitFor(async () => (await saved()).length === 2, 'two highlights');
            tap(reader, 46);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
            await waitFor(async () => (await saved()).length === 1, 'Backspace to remove it');

            tap(reader, 55);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            assert(reader.isOpen, 'Escape closed the reader with a highlight picked');
            assert(reader.element.querySelector('.rd-tb').hidden, 'Escape did not let go of it');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            assertEqual(reader.isOpen, false);
            teardown();
        });
    });

    suite('reader — notes', () => {
        test('a note is written at the end of its highlight, and saved once the typing stops', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader } = await openReady({ transcript: makeTranscript(20) });
            // Across the paragraph break: the note belongs after the last of it.
            const paras = reader.element.querySelectorAll('.rd-paras .rd-p');
            const last = Number(paras[1].querySelector('.rd-w').dataset.w) + 2;
            stroke(reader, last - 6, last);
            await waitFor(async () => (await saved()).length === 1, 'the highlight');
            tap(reader, last - 1);
            reader.element.querySelector('.rd-tb-note').click();
            const box = reader.element.querySelector('.rd-edit textarea');
            assert(box && document.activeElement === box, 'the note box did not open, ready to type');
            assert(paras[1].contains(box), 'the note opened somewhere other than the end of its highlight');
            box.value = 'Worth a second look.';
            box.dispatchEvent(new Event('input', { bubbles: true }));
            await waitFor(async () => (await saved())[0].note === 'Worth a second look.', 'the note to be saved');
            box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            const note = reader.element.querySelector('.rd-note');
            assert(note && paras[1].contains(note), 'the note is not at the end of its highlight');
            assertEqual(note.textContent.trim(), 'Worth a second look.');
            reader.close();
            teardown();
        });

        test('a note typed in the list is kept, and closing does not lose one', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader } = await openReady();
            stroke(reader, 9, 12);
            await waitFor(async () => (await saved()).length === 1, 'the highlight');
            reader.element.querySelector('.rd-tab[data-tab="highlights"]').click();
            const box = reader.element.querySelector('.rd-list-pane .rd-li textarea');
            box.focus();
            box.value = 'typed and gone';
            box.dispatchEvent(new Event('input', { bubbles: true }));
            reader.close();
            await waitFor(async () => (await saved())[0].note === 'typed and gone', 'the note to survive the close');
            teardown();
        });

        test('the label Ctrl+B writes is not shown as a note', async () => {
            MockChrome.reset({ localStore: {} });
            await window.BB.Bookmarks.save([{ id: 'vid00000001', title: 'A talk', url: 'u', bookmarks: [
                { id: 'a', time: 6, start: 6, end: 9, note: 'Checkpoint 0:06 - 0:09' }] }]);
            const { reader } = await openReady();
            await waitFor(() => marked(reader).length > 0, 'the checkpoint drawn');
            assertDeepEqual(marked(reader), 'Line 2 of the talk, said at 6 seconds.'.split(' '), 'Ctrl+B’s span is not what was said in it');
            assertEqual(reader.element.querySelector('.rd-note'), null);
            reader.close();
            teardown();
        });
    });

    suite('reader — the highlights list', () => {
        test('every checkpoint is listed in time order, the ones past the transcript too, and copies as Markdown', async () => {
            MockChrome.reset({ localStore: {} });
            await window.BB.Bookmarks.save([{ id: 'vid00000001', title: 'A talk', url: 'u', bookmarks: [
                { id: 'b', time: 900, start: 900, end: 905, subtitle: 'after the end' },
                { id: 'a', time: 6, start: 6, end: 9, subtitle: 'Line 2', note: 'kept' }] }]);
            const { reader, copied } = await openReady();
            reader.element.querySelector('.rd-tab[data-tab="highlights"]').click();
            await waitFor(() => reader.element.querySelectorAll('.rd-list-pane .rd-li').length === 2, 'both in the list');
            const items = Array.from(reader.element.querySelectorAll('.rd-list-pane .rd-li'), (item) => item.querySelector('.rd-li-text').textContent);
            assertDeepEqual(items, ['Line 2', 'after the end']);
            assertEqual(reader.element.querySelector('.rd-tab-count').textContent, '2');
            reader.element.querySelector('.rd-list-pane .rd-copy').click();
            await waitFor(() => copied.length === 1, 'the copy');
            const lines = copied[0].split('\n');
            assert(lines.includes('  - kept'), 'the note is not under its passage');
            assertEqual(lines.indexOf('  - kept'), lines.findIndex((line) => line.includes('Line 2')) + 1);
            await waitFor(() => /Copied/.test(reader.element.querySelector('.rd-list-pane .rd-copy').textContent), 'Copied');
            reader.close();
            teardown();
        });
    });

    suite('reader — layouts', () => {
        test('it opens in the layout the setting names, and an old one in the nearest', () => {
            for (const [asked, opened] of [['focus', 'focus'], ['split', 'dock'], ['theatre', 'glass'], ['sideways', 'dock']]) {
                stagePage();
                const { reader } = makeReader({ settings: { readerLayout: asked } });
                reader.open();
                assertEqual(reader.element.dataset.layout, opened, asked);
                reader.close();
            }
            teardown();
        });

        test('every layout gives the player room, and switching fetches nothing again', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader, page, fetches } = await openReady();
            const first = reader.element.querySelector('.rd-paras .rd-p');
            for (const id of Layout().LAYOUT_IDS) {
                reader.element.querySelector(`.rd-layout[data-layout="${id}"]`).click();
                assertEqual(reader.element.dataset.layout, id);
                await pause(360);
                const box = page.player.getBoundingClientRect();
                assert(box.width > 200 && Math.abs(box.width / box.height - 16 / 9) < 0.03, `${id} left the player ${box.width}×${box.height}`);
                // REGRESSION: the picture went black with the sound still
                // playing. The video's container holds nothing but the
                // absolutely placed video, so it had no height, and the
                // video's height of 100% came to 0.
                const picture = page.player.querySelector('video').getBoundingClientRect();
                assert(Math.abs(picture.height - box.height) < 1 && Math.abs(picture.width - box.width) < 1,
                    `${id} gave the picture ${picture.width}×${picture.height} of a ${box.width}×${box.height} player`);
            }
            assertEqual(fetches(), 1, 'switching layout fetched the transcript again');
            assert(reader.element.querySelector('.rd-paras .rd-p') === first, 'switching redrew the transcript');
            await waitFor(async () => (await window.BB.Settings.get(['readerLayout'])).readerLayout === 'focus',
                'the last layout to be remembered');
            reader.close();
            teardown();
        });

        test('the band holds three sentences, the playing one in the middle, and opens to the whole transcript', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader, page } = await openReady({ settings: { readerLayout: 'band' } });
            playTo(page, 4 * 3 + 1);
            const rows = () => Array.from(reader.element.querySelectorAll('.rd-bandrows .rd-brow'));
            assertEqual(rows().length, 3);
            assert(rows()[1].classList.contains('is-cur') && rows()[1].textContent.includes('Line 4 '), rows()[1].textContent);
            assert(reader.element.querySelector('.rd-paras').hidden, 'the whole transcript shows in a closed band');
            playTo(page, 5 * 3 + 1);
            assert(rows()[1].textContent.includes('Line 5 '), 'the band did not move on');
            reader.element.querySelector('.rd-band-toggle').click();
            assert(!reader.element.querySelector('.rd-paras').hidden, 'the band did not open');
            assertEqual(rows().length, 0);
            reader.close();
            teardown();
        });

        test('the float card and the pinned player move by their grips, and stop at the edge', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader } = await openReady({ settings: { readerLayout: 'float' } });
            const panel = reader.element.querySelector('.rd-panel');
            const grip = reader.element.querySelector('.rd-grip');
            const before = panel.getBoundingClientRect();
            point(grip, 'pointerdown');
            const at = centre(grip);
            window.dispatchEvent(new PointerEvent('pointermove', { clientX: at.clientX - 120, clientY: at.clientY + 30 }));
            window.dispatchEvent(new PointerEvent('pointerup', { clientX: at.clientX - 120, clientY: at.clientY + 30 }));
            const after = panel.getBoundingClientRect();
            assertEqual(Math.round(before.left - after.left), 120, 'the card did not follow the grip');
            point(grip, 'pointerdown');
            window.dispatchEvent(new PointerEvent('pointerup', { clientX: -5000, clientY: -5000 }));
            assertEqual(Math.round(panel.getBoundingClientRect().left), 0, 'the card went off the screen');

            reader.setLayout('focus');
            await pause(360);
            const video = reader.element.querySelector('.rd-video');
            const vgrip = reader.element.querySelector('.rd-vgrip');
            const top = video.getBoundingClientRect().top;
            point(vgrip, 'pointerdown');
            const v = centre(vgrip);
            window.dispatchEvent(new PointerEvent('pointerup', { clientX: v.clientX, clientY: v.clientY - 100 }));
            assertEqual(Math.round(top - video.getBoundingClientRect().top), 100, 'the pinned player did not move');
            reader.close();
            teardown();
        });
    });

    suite('reader — caption languages', () => {
        test('switching language redraws the transcript, and a highlight stays on its moment', async () => {
            MockChrome.reset({ localStore: {} });
            await window.BB.Bookmarks.save([{ id: 'vid00000001', title: 'A talk', url: 'u', bookmarks: [
                { id: 'a', time: 6, start: 6, end: 9 }] }]);
            const english = makeTranscript(6);
            // The same talk in German, cut into different lines.
            const german = { languageCode: 'de', language: 'German', snippets: [0, 2, 4, 6.5, 8, 11, 14].map((start, i) =>
                ({ text: `Zeile ${i}`, start, duration: 2 })) };
            const fetched = [];
            const { reader } = await openReady({ transcripts: {
                fetch: (id, { language } = {}) => {
                    fetched.push(language || '');
                    return Promise.resolve(language === 'de' ? german : english);
                },
                list: () => Promise.resolve([{ code: 'en', label: 'English' }, { code: 'de', label: 'German' }]),
            } });
            const picker = reader.element.querySelector('.rd-lang');
            await waitFor(() => !picker.hidden, 'the picker for a video with two languages');
            await waitFor(() => marked(reader).length > 0, 'the English highlight');

            picker.querySelector('select').value = 'de';
            picker.querySelector('select').dispatchEvent(new Event('change'));
            await waitFor(() => /Zeile/.test(reader.element.querySelector('.rd-paras').textContent), 'the German words');
            // Every German word said between 6s and 9s, and none other.
            await waitFor(() => marked(reader).length > 0, 'the German highlight');
            assertDeepEqual(marked(reader), ['Zeile', '3', 'Zeile'], 'the highlight moved off its time');
            assertDeepEqual(fetched, ['', 'de']);
            reader.close();
            teardown();
        });

        test('a video with one language offers no picker', async () => {
            const { reader } = await openReady({ transcript: makeTranscript(3) });
            assert(reader.element.querySelector('.rd-lang').hidden);
            reader.close();
            teardown();
        });
    });

    suite('reader — chapters', () => {
        const item = (v, t, clock, title) => `<ytd-macro-markers-list-item-renderer><a id="endpoint"
            href="/watch?v=${v}&t=${t}s"><h4 title="${title}">${title}</h4><div id="time">${clock}</div></a></ytd-macro-markers-list-item-renderer>`;

        test('YouTube’s chapters become chips under the docked player, and the one playing is lit', async () => {
            MockChrome.reset({ localStore: {} });
            const chapters = item('vid00000001', 0, '0:00', 'Opening') + item('vid00000001', 12, '0:12', 'Middle') +
                item('vid00000002', 20, '0:20', 'Another video') + item('vid00000001', 21, '0:21', 'End');
            const { reader, page, seeks } = await openReady({ page: { chapters } });
            const chips = () => Array.from(reader.element.querySelectorAll('.rd-chip'));
            assertDeepEqual(chips().map((chip) => [chip.dataset.t, chip.lastChild.textContent.trim()]), [['0', 'Opening'], ['12', 'Middle'], ['21', 'End']],
                'a leftover chapter from another video was taken');
            playTo(page, 13);
            assertDeepEqual(chips().map((chip) => chip.classList.contains('is-on')), [false, true, false]);
            chips()[2].click();
            assertDeepEqual(seeks, [21]);
            assert(/A talk/.test(reader.element.querySelector('.rd-under').textContent), 'no title under the player');
            reader.close();
            teardown();
        });

        test('a description’s timestamps are chapters only the way YouTube counts them', () => {
            const parse = Reader().chaptersInText;
            assertDeepEqual(parse('Intro\n0:00 Start\n1:20 - Middle\n1:02:05 End'), [
                { start: 0, label: 'Start' }, { start: 80, label: 'Middle' }, { start: 3725, label: 'End' }]);
            assertDeepEqual(parse('0:00 Start\n1:20 Only two'), [], 'two timestamps are not chapters');
            assertDeepEqual(parse('0:30 a\n1:00 b\n2:00 c'), [], 'chapters start at 0:00');
        });
    });

    suite('reader — typography', () => {
        test('the settings scale each layout’s own type, and an open reader follows a change', async () => {
            MockChrome.reset({ localStore: {} });
            const { reader, values } = await openReady({ settings: { readerFontSize: 20 } });
            const text = () => getComputedStyle(reader.element.querySelector('.rd-paras .rd-text')).fontSize;
            assertEqual(text(), '20px', 'dock is 16px at the default 16');
            reader.setLayout('focus');
            assertEqual(text(), `${Math.round(19 * 20 / 16 * 10) / 10}px`, 'focus did not keep its larger type');
            values.readerFontSize = 16;
            reader.refresh();
            assertEqual(text(), '19px', 'an open reader did not follow the setting');
            reader.close();
            teardown();
        });
    });

    suite('reader — youtube’s header', () => {
        test('it covers the header by default, and starts under it when asked', async () => {
            await loadStyles();
            const page = stagePage();
            const masthead = document.createElement('div');
            masthead.id = 'masthead-container';
            masthead.style.height = '64px';
            page.home.parentNode.appendChild(masthead);

            const { reader, values } = makeReader();
            reader.open();
            assertEqual(reader.element.getBoundingClientRect().top, 0);
            values.readerHideChrome = false;
            reader.refresh();
            assertEqual(reader.element.getBoundingClientRect().top, 64, 'the header was covered anyway');
            assert(Number(getComputedStyle(reader.element).zIndex) < 2020, 'the header’s menus would open behind the reader');
            reader.close();
            teardown();
        });
    });

    suite('reader — skins', () => {
        test('the reader is dressed in each skin, with the skin’s own shape', async () => {
            for (const skin of ['default', 'riso', 'medieval', 'deco']) {
                MockChrome.reset({ localStore: { skin } });
                const { reader } = await openReady();
                await waitFor(() => reader.element.dataset.bbSkin === skin, `the ${skin} skin`);
                assert(['light', 'dark'].includes(reader.element.dataset.bbTheme), 'no light or dark');
                const radius = getComputedStyle(reader.element.querySelector('.rd-panel')).borderTopLeftRadius;
                if (skin === 'riso' || skin === 'deco') assertEqual(radius, '0px', `${skin} kept round corners`);
                else assert(radius !== '0px', `${skin} lost its corners`);
                const mark = getComputedStyle(reader.element.querySelector('.rd-paras .rd-stamp'), '::before').content;
                assertEqual(mark.includes('¶'), skin === 'medieval', `${skin}'s paragraph mark is ${mark}`);
                const corners = getComputedStyle(reader.element.querySelector('.rd-corners')).display;
                assertEqual(corners !== 'none', skin === 'deco', `${skin}'s corner ornament`);
                assert(reader.element.style.getPropertyValue('--rd-cursor-pen').includes('svg'), 'the pen is not the cursor');
                reader.close();
                teardown();
            }
        });

        test('a skin changed while the reader is open reaches it', async () => {
            MockChrome.reset({ localStore: { skin: 'default' } });
            stagePage();
            const { reader } = makeReader();
            reader.open();
            await waitFor(() => reader.element.dataset.bbSkin === 'default', 'the first skin');
            await chrome.storage.local.set({ skin: 'medieval' });
            reader.refresh();
            await waitFor(() => reader.element.dataset.bbSkin === 'medieval', 'the new skin');
            reader.close();
            teardown();
        });
    });

    suite('reader — opening and closing', () => {
        test('Escape closes, but leaves a field first', () => {
            stagePage();
            const { reader } = makeReader();
            reader.open();
            const field = document.createElement('textarea');
            reader.element.appendChild(field);
            field.focus();

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            assert(reader.isOpen, 'Escape in a note threw the reader away');
            assert(document.activeElement !== field, 'the field kept focus');

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            assertEqual(reader.isOpen, false);
            teardown();
        });

        test('only a different video closes it', () => {
            stagePage();
            const { reader } = makeReader();
            reader.open();
            reader.onNavigate('vid00000001');
            assert(reader.isOpen, 'an advert handing back to the video closed the reader');
            reader.onNavigate('vid00000002');
            assertEqual(reader.isOpen, false);
            teardown();
        });
    });
})();
