/**
 * The YouTube reader, for what only a real DOM answers: a player element
 * really moving out of the page and back, the transcript column drawn from
 * snippets, a selection made over it turning into a checkpoint, and the
 * panel dressed for every skin.
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
     * "put back at its index" can be told apart.
     */
    function stagePage() {
        teardown();
        const host = document.createElement('div');
        host.id = HOST_ID;
        host.innerHTML = `
            <div id="bb-reader-test-home"><span class="before"></span><div id="movie_player"
                 class="html5-video-player"><video class="html5-main-video"></video></div><span
                 class="after"></span></div>`;
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

    /** A transcript in the shape transcript.js hands over: long enough to scroll. */
    function makeTranscript(count = 60) {
        const snippets = [];
        for (let i = 0; i < count; i++) {
            snippets.push({ text: `Line ${i} of the talk, said at ${i * 3} seconds.`, start: i * 3, duration: 2.5 });
        }
        return { snippets, languageCode: 'en' };
    }

    function makeReader({
        transcript = null, video = { id: 'vid00000001', title: 'A talk' }, settings = {}, transcripts: given = null,
    } = {}) {
        const watcher = makeWatcher();
        let fetches = 0;
        const seeks = [];
        const values = Object.assign({}, window.BB.Settings.DEFAULTS, settings);
        const player = { seekTo: (t) => { seeks.push(t); return true; }, currentTime: () => 0 };
        const transcripts = given || { fetch: () => { fetches++; return Promise.resolve(transcript); } };
        const recorder = window.BB.Checkpoints.createRecorder({
            player, notify() {}, getVideo: () => video, transcripts,
        });
        const reader = Reader().createReader({
            player, watcher, getVideo: () => video, getSettings: () => values, transcripts, recorder,
        });
        return { reader, watcher, seeks, values, fetches: () => fetches };
    }

    const settle = () => new Promise((done) => setTimeout(done, 0));

    /**
     * content.css, for the specs that need the reader laid out — a column
     * with no height has nothing to scroll. Loaded here rather than for the
     * whole suite, where it would restyle every other spec's fixtures.
     */
    let styles = null;
    function loadStyles() {
        if (styles) return styles;
        styles = new Promise((done) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '../content.css';
            link.id = 'bb-reader-test-styles';
            link.onload = link.onerror = () => done();
            document.head.appendChild(link);
        });
        return styles;
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

    /** Select from one line's text to another's, and let go of the mouse. */
    async function highlight(reader, from, to, { fromOffset = 0, toOffset } = {}) {
        const texts = reader.element.querySelectorAll('.bb-rt-text');
        const start = texts[from].firstChild;
        const end = texts[to].firstChild;
        const range = document.createRange();
        range.setStart(start, fromOffset);
        range.setEnd(end, toOffset == null ? end.length : toOffset);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        texts[to].dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }

    const saved = async () => {
        const videos = await window.BB.Bookmarks.load();
        return videos.length ? videos[0].bookmarks : [];
    };

    async function waitFor(predicate, what, ms = 3000) {
        const started = Date.now();
        while (!(await predicate())) {
            if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
            await new Promise((done) => setTimeout(done, 10));
        }
    }

    suite('reader — highlight to checkpoint', () => {
        test('selecting lines saves exactly what was selected, and Undo takes it back', async () => {
            MockChrome.reset({ localStore: {} });
            stagePage();
            const { reader } = makeReader({ transcript: makeTranscript(10) });
            reader.open();
            await settle();
            await highlight(reader, 2, 3, { fromOffset: 5, toOffset: 6 });
            await waitFor(async () => (await saved()).length === 1, 'the checkpoint to be saved');

            const [checkpoint] = await saved();
            assertEqual(checkpoint.start, 6, 'the first line’s start');
            assertEqual(checkpoint.end, 11.5, 'the last line’s end');
            assertEqual(checkpoint.subtitle, '2 of the talk, said at 6 seconds. Line 3', 'not what was selected');
            assertEqual(checkpoint.note, '');
            assert(checkpoint.id, 'saved without an id');
            assert(window.getSelection().isCollapsed, 'the selection was left up');

            const toast = reader.element.querySelector('.bb-reader-toast');
            assert(!toast.hidden, 'no toast');
            toast.querySelector('button').click();
            await waitFor(async () => (await saved()).length === 0, 'Undo to remove it');
            reader.close();
            teardown();
        });

        test('two highlights beginning in the same second both survive', async () => {
            MockChrome.reset({ localStore: {} });
            stagePage();
            const { reader } = makeReader({ transcript: makeTranscript(10) });
            reader.open();
            await settle();
            await highlight(reader, 4, 4, { toOffset: 6 });
            await waitFor(async () => (await saved()).length === 1, 'the first');
            await highlight(reader, 4, 5);
            await waitFor(async () => (await saved()).length === 2, 'the second to survive');
            reader.close();
            teardown();
        });

        test('the same passage twice is one checkpoint', async () => {
            MockChrome.reset({ localStore: {} });
            stagePage();
            const { reader } = makeReader({ transcript: makeTranscript(10) });
            reader.open();
            await settle();
            await highlight(reader, 1, 1);
            await waitFor(async () => (await saved()).length === 1, 'the first');
            await highlight(reader, 1, 1);
            await waitFor(() => /already/i.test(reader.element.querySelector('.bb-reader-toast').textContent), 'the repeat to be noticed');
            assertEqual((await saved()).length, 1);
            reader.close();
            teardown();
        });

        test('checkpoints already saved are shaded on the right lines, and follow changes', async () => {
            MockChrome.reset({ localStore: {} });
            await window.BB.Bookmarks.save([{ id: 'vid00000001', title: 'A talk', url: 'u', bookmarks: [
                { id: 'a', time: 6, start: 6, end: 12 }, { id: 'b', time: 9, start: 9, end: 12 } ] }]);
            stagePage();
            const { reader } = makeReader({ transcript: makeTranscript(10) });
            reader.open();
            await waitFor(() => reader.element.querySelector('[data-bb-marks]'), 'the shading');
            const marks = () => Array.from(reader.element.querySelectorAll('.bb-rt-row'), (row) => row.dataset.bbMarks || '0');
            assertDeepEqual(marks().slice(0, 5), ['0', '0', '1', '2', '0']);

            await window.BB.Bookmarks.update((videos) => window.BB.Bookmarks.removeBookmarkById(videos, 'vid00000001', 'b'));
            await waitFor(() => marks()[3] === '1', 'a checkpoint deleted elsewhere to come off');
            reader.close();
            teardown();
        });

        test('with saving on selection off, the toast offers Save instead', async () => {
            MockChrome.reset({ localStore: {} });
            stagePage();
            const { reader } = makeReader({ transcript: makeTranscript(10), settings: { readerAutoCheckpoint: false } });
            reader.open();
            await settle();
            await highlight(reader, 1, 1);
            await new Promise((done) => setTimeout(done, 100));
            assertEqual((await saved()).length, 0, 'saved without being asked');
            const button = reader.element.querySelector('.bb-reader-toast button');
            assert(/save/i.test(button.textContent), 'no Save offered');
            button.click();
            await waitFor(async () => (await saved()).length === 1, 'Save to save it');
            reader.close();
            teardown();
        });
    });

    suite('reader — notes', () => {
        const seed = () => window.BB.Bookmarks.save([{ id: 'vid00000001', title: 'A talk', url: 'u', bookmarks: [
            { id: 'a', time: 6, start: 6, end: 9, subtitle: 'first said', note: '' },
            // From before ids, with the note Ctrl+B used to write for you.
            { time: 12, start: 12, end: 15, timestamp: 1700000000000, subtitle: 'second said', note: 'Checkpoint 0:12 - 0:15' },
        ] }]);

        test('the checkpoints are listed in time order with what was said', async () => {
            MockChrome.reset({ localStore: {} });
            await seed();
            stagePage();
            const { reader } = makeReader({ transcript: makeTranscript(10) });
            reader.open();
            await waitFor(() => reader.element.querySelectorAll('.bb-rn-item').length === 2, 'the list');
            const items = reader.element.querySelectorAll('.bb-rn-item');
            assert(/first said/.test(items[0].textContent) && /second said/.test(items[1].textContent));
            assertEqual(reader.element.querySelector('.bb-rn-count').textContent, '(2)');
            reader.close();
            teardown();
        });

        test('a note is written once the typing stops, and closing does not lose one', async () => {
            MockChrome.reset({ localStore: {} });
            await seed();
            stagePage();
            const { reader } = makeReader({ transcript: makeTranscript(10) });
            reader.open();
            await waitFor(() => reader.element.querySelectorAll('.bb-rn-note').length === 2, 'the list');
            const boxes = reader.element.querySelectorAll('.bb-rn-note');

            boxes[0].focus();
            boxes[0].value = 'worth rewatching';
            boxes[0].dispatchEvent(new Event('input', { bubbles: true }));
            assertEqual((await saved())[0].note, '', 'written on the keystroke rather than after it');
            await waitFor(async () => (await saved())[0].note === 'worth rewatching', 'the note to be written');
            assert(document.activeElement === reader.element.querySelector('.bb-rn-note'),
                'saving threw the caret out of the box being typed in');

            // The old record has no id; it is found by what never changes.
            const legacy = reader.element.querySelectorAll('.bb-rn-note')[1];
            legacy.value = 'edited';
            legacy.dispatchEvent(new Event('input', { bubbles: true }));
            reader.close();
            await waitFor(async () => (await saved())[1].note === 'edited', 'the pending note to be written on close');
            teardown();
        });

        test('deleting a checkpoint can be undone', async () => {
            MockChrome.reset({ localStore: {} });
            await seed();
            stagePage();
            const { reader } = makeReader({ transcript: makeTranscript(10) });
            reader.open();
            await waitFor(() => reader.element.querySelectorAll('.bb-rn-item').length === 2, 'the list');
            reader.element.querySelector('.bb-rn-delete').click();
            await waitFor(async () => (await saved()).length === 1, 'the delete');
            await waitFor(() => reader.element.querySelectorAll('.bb-rn-item').length === 1, 'the list to follow');
            reader.element.querySelector('.bb-reader-toast button').click();
            await waitFor(async () => (await saved()).length === 2, 'Undo to put it back');
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

        test('the transcript is drawn one row per line', async () => {
            stagePage();
            const { reader } = makeReader({ transcript: makeTranscript(5) });
            reader.open();
            await settle();
            const rows = reader.element.querySelectorAll('.bb-rt-row');
            assertEqual(rows.length, 5);
            assertEqual(rows[2].dataset.start, '6');
            assert(rows[0].classList.contains('is-active'), 'the opening line was not marked as playing');
            reader.close();
            teardown();
        });

        test('clicking a line plays from it', async () => {
            stagePage();
            const { reader, seeks } = makeReader({ transcript: makeTranscript(5) });
            reader.open();
            await settle();
            window.getSelection().removeAllRanges();
            reader.element.querySelectorAll('.bb-rt-text')[3].click();
            assertDeepEqual(seeks, [9]);
            reader.close();
            teardown();
        });

        test('the playing line follows the video, and the column with it', async () => {
            await loadStyles();
            const page = stagePage();
            const { reader } = makeReader({ transcript: makeTranscript() });
            reader.open();
            await settle();
            playTo(page, 40 * 3 + 1);
            const rows = reader.element.querySelectorAll('.bb-rt-row');
            assert(rows[40].classList.contains('is-active'), 'the playing line did not move');
            assertEqual(reader.element.querySelectorAll('.is-active').length, 1, 'the old line kept its mark');
            await new Promise((done) => setTimeout(done, 600));
            assert(reader.element.querySelector('.bb-reader-transcript').scrollTop > 0, 'the column did not follow');
            reader.close();
            teardown();
        });

        test('scrolling the column yourself stops it following for a while', async () => {
            await loadStyles();
            const page = stagePage();
            const { reader } = makeReader({ transcript: makeTranscript() });
            reader.open();
            await settle();
            const column = reader.element.querySelector('.bb-reader-transcript');
            column.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
            playTo(page, 50 * 3);
            await new Promise((done) => setTimeout(done, 600));
            assertEqual(column.scrollTop, 0, 'the column pulled itself back while being read');
            assert(column.querySelectorAll('.bb-rt-row')[50].classList.contains('is-active'),
                'the mark still moves, only the scrolling waits');
            reader.close();
            teardown();
        });

        test('a video with no transcript says so plainly', async () => {
            stagePage();
            const { reader } = makeReader({ transcript: null });
            reader.open();
            await new Promise((done) => setTimeout(done, 0));
            assert(/no transcript/i.test(reader.element.textContent), 'nothing said the transcript was missing');
            reader.close();
            teardown();
        });
    });
})();
