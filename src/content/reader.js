/**
 * The distraction-free reader: YouTube's own player, the video's transcript
 * set as prose, and a pen to highlight it with.
 *
 * **The player is moved, never re-embedded.** `#movie_player` is adopted into
 * the reader and put back on close. Playback position, quality, volume,
 * captions and the rate Bell Bearer keeps all survive, because it is the same
 * element — which is the one thing an iframe of the video could never do,
 * and why the player here can be any size at all. Moving a playing <video>
 * does not pause it: the element is back in a document before the browser
 * gets round to asking whether it left.
 *
 * YouTube does not know it has been moved, so two of its habits are answered
 * here rather than fought. It sizes its controls off a resize event, so one
 * is sent whenever the player changes size. And it fullscreens its own
 * container rather than the player, so for the length of a fullscreen the
 * player goes home and comes back after.
 *
 * Five layouts (src/content/reader-layout.js), the transcript as paragraphs
 * of timed words (reader-transcript.js), and the pen and everything a
 * highlight carries (reader-highlights.js). Nothing on YouTube's page is
 * removed or rebuilt: one class on <html> and the stylesheet do the hiding.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const Theme = ns.Theme || req('./theme.js');
    const ReaderTranscript = ns.ReaderTranscript || req('./reader-transcript.js');
    const ReaderLayout = ns.ReaderLayout || req('./reader-layout.js');
    const ReaderHighlights = ns.ReaderHighlights || req('./reader-highlights.js');
    const Bookmarks = ns.Bookmarks || req('../shared/bookmarks.js');
    const Settings = ns.Settings || req('../shared/settings.js');
    const Time = ns.Time || req('../shared/time.js');
    const Markdown = ns.Markdown || req('./markdown.js');
    const Corners = ns.Corners || req('../shared/corners.js');

    const ROOT_ID = 'bb-reader';
    const SLOT_ID = 'bb-reader-slot';
    const PLAYER_ID = 'movie_player';
    /** On <html> while the reader is up; the stylesheet keys everything off it. */
    const OPEN_CLASS = 'bb-reader-open';

    /** How long a toast, and its Undo, stays up. */
    const TOAST_MS = 5000;
    /** How long Copy says Copied. */
    const COPIED_MS = 1600;

    /**
     * The typography settings, each clamped to what its control offers —
     * a number field holds whatever is typed into it. They scale each
     * layout's own type rather than replace it: focus is set larger than the
     * float card on purpose, and a size setting that flattened the two would
     * undo the design.
     */
    const TYPE = Object.freeze({
        readerFontSize: Object.freeze({ min: 12, max: 24, base: 16 }),
        readerLineHeight: Object.freeze({ min: 1.2, max: 2, base: 1.6 }),
        readerLineWidth: Object.freeze({ min: 30, max: 60, base: 44 }),
    });

    /** The settings as `{ scale, leadScale, measure }`, for ReaderLayout.geometry. */
    function typeScale(settings) {
        const value = (key) => {
            const { min, max } = TYPE[key];
            const number = Number(settings && settings[key]);
            return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : Settings.DEFAULTS[key];
        };
        return {
            scale: value('readerFontSize') / TYPE.readerFontSize.base,
            leadScale: value('readerLineHeight') / TYPE.readerLineHeight.base,
            measure: value('readerLineWidth'),
        };
    }

    const svg = (size, body, width = 1.75) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="${width}" stroke-linecap="round" aria-hidden="true">${body}</svg>`;
    const ICON = Object.freeze({
        close: svg(18, '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'),
        chevron: svg(14, '<path d="m6 9 6 6 6-6"></path>'),
        up: svg(14, '<path d="m18 15-6-6-6 6"></path>'),
        down: svg(14, '<path d="M12 5v14"></path><path d="m19 12-7 7-7-7"></path>'),
    });

    function listHtml(kind) {
        const copy = `<button type="button" class="rd-copy" title="Copy as a timestamped Markdown list">${ReaderHighlights.ICON.copy}<span>Copy as Markdown</span></button>`;
        const head = kind === 'side'
            ? `<div class="rd-list-head"><h3 class="rd-side-title">Highlights <span class="rd-list-count"></span></h3>${copy}</div>`
            : `<div class="rd-list-head"><span class="rd-list-count"></span>${copy}</div>`;
        return `${head}<p class="rd-list-empty">Drag across the transcript to highlight a passage.</p><div class="rd-list-items"></div>`;
    }

    /**
     * Deco's frame is the settings plate's: the same fan from BB.Corners in
     * each corner, painted from the reader's palette.
     */
    const FRAME_INK = Object.freeze({ accent: 'var(--rd-corner-accent)', gold: 'var(--rd-corner-gold)' });

    function shellHtml() {
        return `
            <div class="rd-tex"></div>
            <div class="rd-stage"></div>
            <header class="rd-bar">
                <div class="rd-title"><span class="rd-title-text"></span><span class="rd-channel"></span></div>
                <span class="rd-flex"></span>
                <div class="rd-layouts" role="radiogroup" aria-label="Layout">${ReaderLayout.LAYOUTS.map((layout) => `
                    <button type="button" role="radio" class="rd-layout" data-layout="${layout.id}" title="${layout.title}"
                            aria-label="${layout.title}">${layout.icon}</button>`).join('')}
                </div>
                <span class="rd-rule"></span>
                <button type="button" class="rd-close" title="Close the reader (Esc)" aria-label="Close the reader">${ICON.close}</button>
                <span class="rd-bar-band"></span>
            </header>
            <div class="rd-video"><div class="rd-screen"></div><div class="rd-vgrip" title="Drag to move the player"><span></span></div></div>
            <div class="rd-under">
                <h2 class="rd-under-title"></h2>
                <div class="rd-under-meta"></div>
                <div class="rd-chapters"></div>
            </div>
            <section class="rd-panel" aria-label="Transcript">
                <div class="rd-grip" title="Drag to move"><span></span></div>
                <div class="rd-tabs" role="tablist">
                    <button type="button" role="tab" class="rd-tab" data-tab="transcript" aria-selected="true">Transcript</button>
                    <button type="button" role="tab" class="rd-tab" data-tab="highlights" aria-selected="false">Highlights<span class="rd-tab-count"></span></button>
                    <span class="rd-flex"></span>
                    <label class="rd-lang" hidden><select aria-label="Transcript language"></select>${ICON.chevron}</label>
                </div>
                <div class="rd-scroll">
                    <div class="rd-content">
                        <div class="rd-paras"><p class="rd-empty">Loading the transcript…</p></div>
                        <div class="rd-bandrows"></div>
                    </div>
                </div>
                <div class="rd-list rd-list-pane">${listHtml('pane')}</div>
                <div class="rd-band-ctl"><span class="rd-band-count"></span><button type="button" class="rd-band-toggle"
                     title="Show the whole transcript"><span>Transcript</span>${ICON.up}</button></div>
                <div class="rd-toast" role="status" aria-live="polite" hidden><span class="rd-toast-text"></span><button
                     type="button" class="rd-toast-undo">Undo</button></div>
                <button type="button" class="rd-now" title="Follow the video again" hidden>${ICON.down}<span></span></button>
                <div class="rd-corners" aria-hidden="true"><span class="rd-frame-rule is-second"></span><span
                     class="rd-frame-rule is-third"></span>${Corners.html('fan', FRAME_INK, 'rd-corner')}</div>
                <div class="rd-tex"></div>
            </section>
            <aside class="rd-side rd-list" data-count-style="number" aria-label="Highlights">${listHtml('side')}</aside>`;
    }

    /** "1:02:03" or "2:03" as seconds; null for anything else. */
    function clock(text) {
        const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
        return match ? (Number(match[1] || 0) * 3600) + (Number(match[2]) * 60) + Number(match[3]) : null;
    }

    /**
     * The chapters YouTube lists for the video, as `[{ start, label }]`.
     *
     * Read off the page: the chapters panel and the description's chapter
     * cards are both `ytd-macro-markers-list-item-renderer`s, each with the
     * time and the title. An item whose link names another video is a
     * leftover from the last one — YouTube keeps the old panel for a moment
     * after a navigation. Failing those, the description's own list of
     * timestamps, which is what YouTube makes chapters from: a line per
     * chapter, the first at 0:00, at least three.
     */
    function chaptersOnPage(videoId, doc = document) {
        const found = new Map();
        for (const item of doc.querySelectorAll('ytd-macro-markers-list-item-renderer')) {
            const link = item.querySelector('a[href]');
            const href = link ? link.getAttribute('href') : '';
            const owner = /[?&]v=([\w-]{11})/.exec(href);
            if (owner && owner[1] !== videoId) continue;
            const heading = item.querySelector('h4');
            const label = String((heading && (heading.getAttribute('title') || heading.textContent)) || '').trim();
            const time = item.querySelector('#time');
            let start = time ? clock(time.textContent) : null;
            if (start === null) {
                const t = /[?&]t=(\d+)/.exec(href);
                start = t ? Number(t[1]) : null;
            }
            if (label && typeof start === 'number' && !found.has(start)) found.set(start, { start, label });
        }
        if (found.size) return Array.from(found.values()).sort((a, b) => a.start - b.start);
        return chaptersInText(descriptionText(doc));
    }

    function descriptionText(doc) {
        const node = doc.querySelector('ytd-watch-metadata #description-inline-expander, ytd-watch-metadata #description');
        return node ? node.textContent || '' : '';
    }

    /** YouTube's own rule for a description's chapter list. */
    function chaptersInText(text) {
        const out = [];
        for (const line of String(text || '').split(/\n/)) {
            const match = /^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|]?\s*(.+?)\s*$/.exec(line);
            if (!match) continue;
            const start = clock(match[1]);
            if (start === null || (out.length && start <= out[out.length - 1].start)) continue;
            out.push({ start, label: match[2] });
        }
        return out.length >= 3 && out[0].start === 0 ? out : [];
    }

    function createReader({ player, watcher, getVideo, getSettings, transcripts, copyText }) {
        /**
         * The open reader, or null. A fresh object per open, so an answer that
         * arrives after a close — the transcript fetch, the skin read — can
         * see it belongs to a reader that is gone and leave the page alone.
         */
        let session = null;

        // --------------------------------------------------- the player

        /**
         * Where the player lives on YouTube's page.
         *
         * The sibling is remembered and not an index: YouTube inserts and
         * removes things around the player while we hold it, so the index it
         * had is not the index it should go back to. The slot is only the
         * fallback for a sibling YouTube has since thrown away.
         */
        function rememberHome(node) {
            let slot = document.getElementById(SLOT_ID);
            if (!slot) {
                slot = document.createElement('div');
                slot.id = SLOT_ID;
            }
            node.parentNode.insertBefore(slot, node);
            session.home = { parent: node.parentNode, next: node.nextSibling, slot };
        }

        function adopt() {
            const node = document.getElementById(PLAYER_ID);
            if (!session || !node || !node.parentNode) return false;
            if (node.parentNode === session.screen) return true;
            rememberHome(node);
            session.screen.appendChild(node);
            session.player = node;
            nudge();
            return true;
        }

        /** Put the player back where YouTube had it. Safe with no player at all. */
        function restore() {
            const home = session && session.home;
            const node = session && session.player;
            if (!home || !node) return;
            const { parent, next, slot } = home;
            session.home = null;
            // YouTube threw ours away and built another: putting the old one
            // back would leave two players answering to one id.
            const replaced = !node.isConnected && document.getElementById(PLAYER_ID);
            if (parent.isConnected && !replaced) {
                if (next && next.parentNode === parent) parent.insertBefore(node, next);
                else if (slot.parentNode === parent) parent.insertBefore(node, slot);
                else parent.appendChild(node);
            }
            slot.remove();
            nudge();
        }

        /**
         * Tell YouTube its player changed size. It lays out the control bar and
         * the video box off window resize, and has no way to know the reader
         * moved it — without this the controls keep the width they had.
         */
        function nudge() {
            requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        }

        /**
         * YouTube fullscreens its own container, not the player. With the
         * player in the reader that container is empty, so the player goes
         * home for the length of it and is adopted again on the way out. A
         * fullscreen of the player itself is fine where it stands.
         */
        function onFullscreen() {
            if (!session) return;
            const full = document.fullscreenElement;
            if (full && session.player && session.home && !full.contains(session.player)) {
                session.lent = true;
                restore();
            } else if (!full && session.lent) {
                session.lent = false;
                adopt();
            }
        }

        // ------------------------------------------------ open and close

        function open() {
            if (session) return true;
            const video = getVideo();
            if (!video || !document.getElementById(PLAYER_ID)) return false;

            const element = document.createElement('div');
            element.id = ROOT_ID;
            element.className = 'bb-reader is-still';
            element.setAttribute('role', 'dialog');
            element.setAttribute('aria-label', 'Reader');
            element.innerHTML = shellHtml();
            // Dressed for the page's light or dark from the first frame, and
            // for the skin as soon as storage answers.
            Theme.dress(element, { theme: Theme.pageTheme(), skin: 'default' });
            const part = (selector) => element.querySelector(selector);

            session = {
                alive: true,
                videoId: video.id,
                element,
                screen: part('.rd-screen'),
                scroll: part('.rd-scroll'),
                player: null,
                home: null,
                lent: false,
                layout: ReaderLayout.layoutOf(getSettings().readerLayout),
                tab: 'transcript',
                bandOpen: false,
                card: { dx: 0, dy: 0 },
                vcard: { dx: 0, dy: 0 },
                model: null,
                transcript: null,
                chapters: chaptersOnPage(video.id),
                paraNodes: [],
                sentenceNodes: [],
                nowS: -1,
                nowP: -1,
                now: 0,
                following: true,
                auto: false,
                unwatch: null,
                highlights: null,
            };
            const mine = session;

            mine.highlights = ReaderHighlights.createHighlights({
                element,
                content: part('.rd-content'),
                lists: () => element.querySelectorAll('.rd-list'),
                getVideo,
                videoId: video.id,
                seek: (t) => player.seekTo(t),
                toast: (text, undo) => showToast(mine, text, undo),
                onChange: (count) => showCount(mine, count),
                onCopy: () => copyAll(mine),
            });

            document.body.appendChild(element);
            document.documentElement.classList.add(OPEN_CLASS);
            applyChrome(element);
            adopt();
            setLayout(mine.layout, { remember: false });
            fillTitle(mine, video);
            renderUnder(mine);
            requestAnimationFrame(() => element.classList.remove('is-still'));

            part('.rd-close').addEventListener('click', close);
            part('.rd-layouts').addEventListener('click', (event) => {
                const button = event.target.closest('.rd-layout');
                if (button) setLayout(button.dataset.layout);
            });
            part('.rd-tabs').addEventListener('click', (event) => {
                const tab = event.target.closest('.rd-tab');
                if (tab) setTab(mine, tab.dataset.tab);
                if (tab) mine.highlights.fitNotes();
            });
            part('.rd-band-toggle').addEventListener('click', () => {
                mine.bandOpen = !mine.bandOpen;
                applyBand(mine);
                layout();
            });
            part('.rd-now').addEventListener('click', () => {
                mine.following = true;
                scrollToNow(mine, true);
            });
            part('.rd-toast-undo').addEventListener('click', () => {
                const undo = mine.undo;
                hideToast(mine);
                if (undo) undo();
            });
            part('.rd-chapters').addEventListener('click', (event) => {
                const chip = event.target.closest('[data-t]');
                if (chip) player.seekTo(Number(chip.dataset.t));
            });
            part('.rd-content').addEventListener('click', (event) => {
                const stamp = event.target.closest('.rd-stamp');
                if (stamp) player.seekTo(Number(stamp.dataset.t));
            });
            part('.rd-lang select').addEventListener('change', (event) => switchLanguage(mine, event.target.value));
            mine.scroll.addEventListener('scroll', () => onScroll(mine), { passive: true });
            mine.scroll.addEventListener('scrollend', () => { mine.auto = false; });
            part('.rd-grip').addEventListener('pointerdown', (event) => startMove(mine, event, 'card'));
            part('.rd-vgrip').addEventListener('pointerdown', (event) => startMove(mine, event, 'vcard'));
            part('.rd-video').addEventListener('transitionend', (event) => {
                if (event.target === event.currentTarget && event.propertyName === 'width') nudge();
            });

            document.addEventListener('keydown', onKey, true);
            document.addEventListener('keyup', onKeyUp, true);
            window.addEventListener('blur', onBlur);
            document.addEventListener('timeupdate', onTime, { capture: true, passive: true });
            document.addEventListener('fullscreenchange', onFullscreen);
            mine.resize = new ResizeObserver(() => layout());
            mine.resize.observe(element);

            // YouTube reparents its player on some navigations. The task takes
            // it back, and reports done once the reader has closed, which is
            // DomWatch's cue to drop it. It also picks the chapters up if
            // YouTube had not drawn them yet when the reader opened.
            watcher.add('reader-player', () => {
                if (!mine.alive) return true;
                if (!mine.lent) adopt();
                if (!mine.chapters.length) {
                    mine.chapters = chaptersOnPage(mine.videoId);
                    if (mine.chapters.length) renderUnder(mine);
                }
                return false;
            });

            dress(mine);
            transcripts.fetch(video.id).then((transcript) => {
                if (!mine.alive) return;
                hydrate(mine, transcript);
                if (transcript) offerLanguages(mine, transcript.languageCode);
            });
            // A checkpoint saved, edited or deleted anywhere — this reader,
            // Ctrl+B, the dashboard in another tab — lands here.
            mine.unwatch = Settings.watch([Bookmarks.KEY], () => loadCheckpoints(mine));
            loadCheckpoints(mine);
            return true;
        }

        /**
         * The skin, read from storage, then everything drawn in its ink: the
         * pen's cursor and the paper's texture. The texture is the extension's
         * own file, so its address is the extension's, not the page's.
         */
        function dress(mine) {
            Theme.appearance().then((look) => {
                if (!mine.alive) return;
                Theme.dress(mine.element, look);
                const ink = getComputedStyle(mine.element).getPropertyValue('--rd-ink').trim() || '#ffd65a';
                mine.highlights.setCursors(ink);
                try {
                    for (const name of ['newsprint', 'parchment']) {
                        mine.element.style.setProperty(`--rd-tex-${name}`, `url("${chrome.runtime.getURL(`textures/${name}.png`)}")`);
                    }
                } catch (_) {
                    // The extension reloaded under this page: plain paper it is.
                }
                layout();
            }).catch(() => {});
        }

        async function loadCheckpoints(mine) {
            const videos = await Bookmarks.load();
            if (!mine.alive) return;
            const entry = videos.find((one) => one.id === mine.videoId);
            mine.highlights.load(entry ? entry.bookmarks : []);
        }

        // ----------------------------------------------- the transcript

        /**
         * Set the transcript. A video with no captions says so and carries
         * on — the player, the highlights list and every layout work the same
         * without one.
         */
        function hydrate(mine, transcript) {
            const paras = mine.element.querySelector('.rd-paras');
            const entries = ReaderTranscript.entriesOf(transcript);
            mine.transcript = transcript;
            mine.nowS = mine.nowP = -1;
            mine.model = entries.length ? ReaderTranscript.build(entries, { chapters: mine.chapters }) : null;
            if (!mine.model) {
                paras.innerHTML = '<p class="rd-empty">This video has no transcript.</p>';
                mine.paraNodes = mine.sentenceNodes = [];
                mine.highlights.setModel(null);
                renderUnder(mine);
                return;
            }
            paras.innerHTML = ReaderTranscript.paragraphsHtml(mine.model);
            mine.paraNodes = Array.from(paras.querySelectorAll('.rd-p'));
            mine.sentenceNodes = Array.from(paras.querySelectorAll('.rd-s'));
            mine.highlights.setModel(mine.model);
            renderUnder(mine);
            track(mine, player.currentTime());
            applyBand(mine);
            requestAnimationFrame(() => scrollToNow(mine, false));
        }

        /** A picker, but only for a video with more than one caption language. */
        async function offerLanguages(mine, current) {
            const found = transcripts.list ? await transcripts.list(mine.videoId) : [];
            if (!mine.alive || found.length < 2) return;
            const picker = mine.element.querySelector('.rd-lang select');
            picker.innerHTML = found.map((track) =>
                `<option value="${Dom.escapeAttr(track.code)}">${Dom.escapeHtml(track.label)}</option>`).join('');
            picker.value = found.some((track) => track.code === current) ? current : found[0].code;
            mine.element.querySelector('.rd-lang').hidden = false;
        }

        /**
         * The transcript in another language, through the same cached,
         * one-fetch-at-a-time wrapper. The highlights stay on the right words
         * without anything being moved: they are stored by time, and the new
         * words are laid over the same times.
         */
        async function switchLanguage(mine, code) {
            mine.element.querySelector('.rd-paras').innerHTML = '<p class="rd-empty">Loading the transcript…</p>';
            const transcript = await transcripts.fetch(mine.videoId, { language: code });
            if (mine.alive) hydrate(mine, transcript);
        }

        // ------------------------------------------- following the video

        /**
         * The one timeupdate listener. The word playing is a binary search
         * over the words' times — no layout read — and the page is touched
         * only when the sentence or the paragraph changes: a few times a
         * minute, not four times a second.
         */
        function onTime(event) {
            const mine = session;
            if (!mine || !mine.player || !mine.player.contains(event.target)) return;
            track(mine, event.target.currentTime);
        }

        function track(mine, t) {
            mine.now = t;
            const now = mine.element.querySelector('.rd-now span');
            if (!now.parentNode.hidden) now.textContent = `Now · ${Time.formatTime(t)}`;
            markChapter(mine);
            if (!mine.lengthKnown) renderUnderMeta(mine);
            if (!mine.model) return;
            const w = ReaderTranscript.wordAt(mine.model, t + 0.01);
            const s = w < 0 ? -1 : mine.model.words[w].s;
            const p = w < 0 ? -1 : mine.model.words[w].p;
            if (s !== mine.nowS) {
                if (mine.sentenceNodes[mine.nowS]) mine.sentenceNodes[mine.nowS].classList.remove('is-now');
                if (mine.sentenceNodes[s]) mine.sentenceNodes[s].classList.add('is-now');
                mine.nowS = s;
                if (isBandClosed(mine)) renderBand(mine);
            }
            if (p !== mine.nowP) {
                const was = mine.nowP;
                if (mine.paraNodes[was]) mine.paraNodes[was].classList.remove('is-now');
                if (mine.paraNodes[p]) mine.paraNodes[p].classList.add('is-now');
                // Everything before the playing paragraph is read: it greys.
                for (let i = Math.max(0, Math.min(was, p)); i < Math.max(was, p); i++) {
                    if (mine.paraNodes[i]) mine.paraNodes[i].classList.toggle('is-past', i < p);
                }
                mine.nowP = p;
                if (mine.following && getSettings().readerFollow !== false) scrollToNow(mine, true);
                showNow(mine);
            }
        }

        const isBandClosed = (mine) => mine.layout === 'band' && !mine.bandOpen;

        /**
         * The playing paragraph to a third of the way down the column. The
         * column is scrolled, not the paragraph "into view": scrollIntoView
         * also scrolls every ancestor that can be, and YouTube's page under
         * the reader is one of them.
         */
        function scrollToNow(mine, smooth) {
            const node = mine.paraNodes[mine.nowP];
            if (!node || isBandClosed(mine)) return;
            const scroll = mine.scroll;
            const top = Math.max(0, node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - scroll.clientHeight * 0.3);
            if (Math.abs(top - scroll.scrollTop) < 2) return;
            const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            // Scrolled by us, so the scroll it raises is not taken as the
            // user scrolling away. scrollend clears it; the timer is for a
            // browser without scrollend.
            mine.auto = true;
            clearTimeout(mine.autoTimer);
            mine.autoTimer = setTimeout(() => { mine.auto = false; }, 1200);
            scroll.scrollTo({ top, behavior: smooth && !still ? 'smooth' : 'auto' });
        }

        function nowVisible(mine) {
            const node = mine.paraNodes[mine.nowP];
            if (!node) return true;
            const a = mine.scroll.getBoundingClientRect();
            const b = node.getBoundingClientRect();
            return b.bottom > a.top + 8 && b.top < a.bottom - 8;
        }

        /**
         * Scrolled away from the playing paragraph, the column stops following
         * and offers the way back instead; scrolled back to it, it follows
         * again. A transcript that yanked itself back while you read ahead
         * would be unusable.
         */
        function onScroll(mine) {
            if (!mine.auto) mine.following = nowVisible(mine);
            showNow(mine);
        }

        function showNow(mine) {
            const button = mine.element.querySelector('.rd-now');
            const listing = mine.tabs && mine.tab === 'highlights';
            const hide = !mine.model || mine.nowP < 0 || isBandClosed(mine) || listing || nowVisible(mine);
            button.hidden = hide;
            if (!hide) button.querySelector('span').textContent = `Now · ${Time.formatTime(mine.now)}`;
        }

        // ---------------------------------------------------- the band

        /** The band: the sentence playing, set large, between the one before and the one after. */
        function renderBand(mine) {
            const rows = mine.element.querySelector('.rd-bandrows');
            const model = mine.model;
            if (!model || !isBandClosed(mine)) {
                rows.textContent = '';
                mine.highlights.setBand(false);
                return;
            }
            const now = Math.max(0, mine.nowS);
            const esc = Dom.escapeHtml;
            rows.innerHTML = [[now - 1, 'prev'], [now, 'cur'], [now + 1, 'next']]
                .filter(([s]) => model.sentences[s])
                .map(([s, role]) => {
                    const sentence = model.sentences[s];
                    const start = model.words[sentence.from].time;
                    let words = '';
                    for (let w = sentence.from; w <= sentence.to; w++) {
                        words += `<span class="rd-w" data-w="${w}">${esc(model.words[w].t)}</span>`;
                        if (w < sentence.to) words += `<span class="rd-sp" data-w="${w}"> </span>`;
                    }
                    return `<div class="rd-brow is-${role}"><button type="button" class="rd-stamp" data-t="${start}"
                        title="Play from here">${Time.formatTime(start)}</button><p class="rd-text">${words}</p></div>`;
                }).join('');
            mine.highlights.setBand(true);
        }

        function applyBand(mine) {
            const closed = isBandClosed(mine);
            mine.element.classList.toggle('is-band-open', mine.layout === 'band' && mine.bandOpen);
            mine.element.querySelector('.rd-paras').hidden = closed;
            const toggle = mine.element.querySelector('.rd-band-toggle');
            toggle.querySelector('span').textContent = mine.bandOpen ? 'Collapse' : 'Transcript';
            toggle.title = mine.bandOpen ? 'Back to three sentences' : 'Show the whole transcript';
            renderBand(mine);
            if (!closed) requestAnimationFrame(() => scrollToNow(mine, false));
        }

        // ------------------------------------------------------ layouts

        /** Write the current layout's boxes onto the pieces. */
        function layout() {
            const mine = session;
            if (!mine) return;
            const W = mine.element.clientWidth;
            const H = mine.element.clientHeight;
            if (!W || !H) return;
            const g = ReaderLayout.geometry(mine.layout, W, H, Object.assign({
                card: mine.card, vcard: mine.vcard, bandOpen: mine.bandOpen,
            }, typeScale(getSettings())));
            const place = (selector, box) => {
                const node = mine.element.querySelector(selector);
                node.hidden = !box;
                if (box) Object.assign(node.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
            };
            place('.rd-bar', g.bar);
            place('.rd-stage', g.stage);
            place('.rd-video', g.video);
            place('.rd-under', g.under);
            place('.rd-panel', g.panel);
            place('.rd-side', g.side);
            mine.tabs = g.tabs;
            const style = mine.element.style;
            style.setProperty('--rd-base-size', `${g.type.size}px`);
            style.setProperty('--rd-lead', String(g.type.lead));
            style.setProperty('--rd-gutter', `${g.type.gutter}px`);
            style.setProperty('--rd-pad', g.type.pad);
            if (!mine.element.classList.contains('is-moving')) {
                clearTimeout(mine.settle);
                // Once the move has finished: the toolbar is over a word that
                // has only now stopped moving.
                mine.settle = setTimeout(() => { if (mine.alive) mine.highlights.place(); }, 320);
            }
            mine.highlights.place();
        }

        /**
         * Switch layout live, and remember it as the one the next reader opens
         * in. The transcript is not fetched again and nothing is redrawn:
         * the same pieces are moved.
         */
        function setLayout(id, { remember = true } = {}) {
            const mine = session;
            if (!mine) return;
            mine.layout = ReaderLayout.layoutOf(id);
            mine.element.dataset.layout = mine.layout;
            for (const button of mine.element.querySelectorAll('.rd-layout')) {
                button.setAttribute('aria-checked', String(button.dataset.layout === mine.layout));
            }
            mine.bandOpen = false;
            mine.highlights.reset();
            setTab(mine, 'transcript');
            applyBand(mine);
            if (remember) Settings.set({ readerLayout: mine.layout });
            layout();
            nudge();
            mine.following = true;
            setTimeout(() => { if (mine.alive) scrollToNow(mine, false); }, 340);
        }

        function setTab(mine, id) {
            mine.tab = id === 'highlights' ? 'highlights' : 'transcript';
            mine.element.classList.toggle('is-listing', mine.tab === 'highlights');
            for (const tab of mine.element.querySelectorAll('.rd-tab')) {
                tab.setAttribute('aria-selected', String(tab.dataset.tab === mine.tab));
            }
            showNow(mine);
        }

        /**
         * Drag the float card, or the pinned player, by its grip. The move is
         * an offset from where the layout puts it, kept on the screen by the
         * layout, and it lasts as long as the reader is open.
         *
         * The pointer is followed on the window, not captured by the grip:
         * the card moves under the pointer, and a capture that did not take
         * — or a move the browser coalesced away — left it stranded short of
         * where it was let go. The release point is where it ends up.
         */
        function startMove(mine, event, key) {
            if (event.button !== 0) return;
            event.preventDefault();
            const from = { x: event.clientX, y: event.clientY, dx: mine[key].dx, dy: mine[key].dy };
            mine.element.classList.add('is-moving');
            const move = (at) => {
                mine[key] = { dx: from.dx + at.clientX - from.x, dy: from.dy + at.clientY - from.y };
                layout();
            };
            const up = (at) => {
                window.removeEventListener('pointermove', move, true);
                window.removeEventListener('pointerup', up, true);
                window.removeEventListener('pointercancel', up, true);
                if (!mine.alive) return;
                if (at.type === 'pointerup') move(at);
                mine.element.classList.remove('is-moving');
                // What the layout kept on the screen is where it is now, so
                // a card dragged past the edge comes straight back off it.
                const size = [mine.element.clientWidth, mine.element.clientHeight];
                const scale = typeScale(getSettings());
                const held = ReaderLayout.geometry(mine.layout, ...size, Object.assign({ card: mine.card, vcard: mine.vcard }, scale));
                const home = ReaderLayout.geometry(mine.layout, ...size, scale);
                const piece = key === 'card' ? 'panel' : 'video';
                mine[key] = { dx: held[piece].left - home[piece].left, dy: held[piece].top - home[piece].top };
                nudge();
                mine.highlights.place();
            };
            window.addEventListener('pointermove', move, true);
            window.addEventListener('pointerup', up, true);
            window.addEventListener('pointercancel', up, true);
        }

        // ---------------------------------------- title, chapters, counts

        function fillTitle(mine, video) {
            const channel = ns.PageInfo && ns.PageInfo.getChannelInfo ? (ns.PageInfo.getChannelInfo() || {}).name || '' : '';
            mine.channel = channel;
            mine.element.querySelector('.rd-title-text').textContent = video.title || 'Reader';
            mine.element.querySelector('.rd-channel').textContent = channel;
            mine.element.querySelector('.rd-under-title').textContent = video.title || '';
        }

        /** Under the docked player: what it is, whose, how long, in what captions — and its chapters. */
        function renderUnder(mine) {
            renderUnderMeta(mine);
            mine.element.querySelector('.rd-chapters').innerHTML = mine.chapters.map((chapter) => `
                <button type="button" class="rd-chip" data-t="${chapter.start}" title="Play from here"><span
                    class="rd-chip-time">${Time.formatTime(chapter.start)}</span>${Dom.escapeHtml(chapter.label)}</button>`).join('');
            mine.chapterAt = -2;
            markChapter(mine);
        }

        function markChapter(mine) {
            let at = -1;
            mine.chapters.forEach((chapter, i) => { if (chapter.start <= mine.now) at = i; });
            if (at === mine.chapterAt) return;
            mine.chapterAt = at;
            mine.element.querySelectorAll('.rd-chip').forEach((chip, i) => chip.classList.toggle('is-on', i === at));
        }

        /**
         * The channel, the length and the captions. The length is NaN until
         * the video's metadata has loaded, so until it is known this is asked
         * again as the video plays.
         */
        function renderUnderMeta(mine) {
            const media = mine.player && mine.player.querySelector('video');
            mine.lengthKnown = !!(media && Number.isFinite(media.duration) && media.duration > 0);
            const length = mine.lengthKnown ? Time.formatTime(media.duration) : '';
            const captions = mine.transcript && mine.transcript.language ? `${mine.transcript.language} captions` : '';
            mine.element.querySelector('.rd-under-meta').textContent = [mine.channel, length, captions].filter(Boolean).join(' · ');
        }

        function showCount(mine, count) {
            mine.element.querySelector('.rd-tab-count').textContent = String(count);
            mine.element.querySelector('.rd-band-count').textContent = count === 1 ? '1 highlight' : `${count} highlights`;
        }

        async function copyAll(mine) {
            const video = getVideo() || { id: mine.videoId };
            const text = Markdown.checkpointList(video, mine.highlights.records, Time.formatTime);
            const ok = await copyText(text);
            if (!mine.alive) return;
            if (!ok) {
                showToast(mine, 'Could not reach the clipboard');
                return;
            }
            mine.element.querySelectorAll('.rd-copy span').forEach((label) => { label.textContent = 'Copied'; });
            clearTimeout(mine.copied);
            mine.copied = setTimeout(() => {
                mine.element.querySelectorAll('.rd-copy span').forEach((label) => { label.textContent = 'Copy as Markdown'; });
            }, COPIED_MS);
        }

        // -------------------------------------------------------- toast

        /**
         * Inside the panel rather than our page-wide toast, because it carries
         * an Undo, and the Undo has to be where the highlight was just made.
         */
        function showToast(mine, text, undo) {
            const toast = mine.element.querySelector('.rd-toast');
            toast.querySelector('.rd-toast-text').textContent = text;
            toast.querySelector('.rd-toast-undo').hidden = !undo;
            mine.undo = undo || null;
            toast.hidden = false;
            clearTimeout(mine.toastTimer);
            mine.toastTimer = setTimeout(() => hideToast(mine), TOAST_MS);
        }

        function hideToast(mine) {
            clearTimeout(mine.toastTimer);
            mine.undo = null;
            mine.element.querySelector('.rd-toast').hidden = true;
        }

        // --------------------------------------------------------- keys

        /**
         * Escape lets go of a highlight, then leaves a field, then closes the
         * reader — a stray press mid-note does not throw the view away. In
         * fullscreen it is YouTube's, for leaving fullscreen. Alt held turns
         * the pen into an eraser; Backspace or Delete removes the highlight
         * picked.
         */
        function onKey(event) {
            const mine = session;
            if (!mine || document.fullscreenElement) return;
            if (event.key === 'Alt') {
                mine.highlights.setAlt(true);
                return;
            }
            const active = document.activeElement;
            const typing = active && /^(TEXTAREA|INPUT|SELECT)$/.test(active.tagName);
            if (event.key === 'Escape') {
                event.stopPropagation();
                if (typing && mine.element.contains(active)) active.blur();
                else if (!mine.highlights.escape()) close();
                return;
            }
            if ((event.key === 'Backspace' || event.key === 'Delete') && !typing && mine.highlights.removePicked()) {
                event.preventDefault();
                event.stopPropagation();
            }
        }

        function onKeyUp(event) {
            if (session && event.key === 'Alt') session.highlights.setAlt(false);
        }

        function onBlur() {
            if (session) session.highlights.setAlt(false);
        }

        // ------------------------------------------------- the settings

        /**
         * Over YouTube's header, or under it. Kept, the reader starts where
         * the masthead ends — measured once here, not tracked — so search
         * stays one click away.
         */
        function applyChrome(element) {
            const keep = getSettings().readerHideChrome === false;
            element.classList.toggle('is-under-masthead', keep);
            if (!keep) {
                element.style.top = '';
                return;
            }
            const bar = document.getElementById('masthead-container');
            const height = bar ? bar.getBoundingClientRect().height : 0;
            element.style.top = `${height || 56}px`;
        }

        /**
         * A setting changed. The type is re-applied and the skin re-read, so
         * an open reader follows the dashboard without being closed.
         */
        function refresh() {
            if (!session) return;
            applyChrome(session.element);
            layout();
            nudge();
            dress(session);
        }

        /**
         * Close from anywhere — Escape, the button, a navigation. Idempotent,
         * and safe when YouTube has already destroyed the player.
         */
        function close() {
            if (!session) return;
            const done = session;
            done.alive = false;
            // A note typed a moment ago is written, not lost with the panel.
            done.highlights.destroy();
            clearTimeout(done.toastTimer);
            clearTimeout(done.copied);
            clearTimeout(done.settle);
            if (done.unwatch) done.unwatch();
            if (done.resize) done.resize.disconnect();
            restore();
            session = null;
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', onBlur);
            document.removeEventListener('timeupdate', onTime, { capture: true });
            document.removeEventListener('fullscreenchange', onFullscreen);
            watcher.remove('reader-player');
            done.element.remove();
            document.documentElement.classList.remove(OPEN_CLASS);
        }

        function toggle() {
            if (!session) return open();
            close();
            return false;
        }

        /**
         * A navigation, or the player swapping its source. Only a different
         * video closes the reader: `loadstart` also fires when an advert hands
         * back to the video, and that is no reason to throw the reader away.
         */
        function onNavigate(videoId) {
            if (session && videoId !== session.videoId) close();
        }

        return {
            open, close, toggle, onNavigate, setLayout, refresh,
            get isOpen() { return !!session; },
            /** For the specs. */
            get element() { return session ? session.element : null; },
            get highlights() { return session ? session.highlights : null; },
        };
    }

    const Reader = {
        createReader, ROOT_ID, SLOT_ID, PLAYER_ID, OPEN_CLASS, TOAST_MS, TYPE, typeScale,
        chaptersOnPage, chaptersInText,
    };

    root.BB = root.BB || {};
    root.BB.Reader = Reader;
    if (typeof module !== 'undefined' && module.exports) module.exports = Reader;
})(typeof globalThis !== 'undefined' ? globalThis : this);
