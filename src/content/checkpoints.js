/**
 * Checkpoint recording: hold Ctrl+B over a passage, release, and the span plus
 * whatever the transcript said during it is saved.
 *
 * Also covers the segment mode (Ctrl+Shift+S to mark the start, again to mark
 * the end), which previously had no key bound to its start at all.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Bookmarks = ns.Bookmarks || req('../shared/bookmarks.js');
    const Time = ns.Time || req('../shared/time.js');

    const INDICATOR_ID = 'yt-bookmarker-recording-indicator';

    /** Below this a "hold" is really a tap, and the span is not worth saving. */
    const MIN_SPAN_SECONDS = 0.25;

    function createRecorder({ player, notify, getVideo, transcripts }) {
        let recording = false;
        let checkpointStart = null;
        let segmentStart = null;

        function currentVideo() {
            const video = getVideo();
            return video && video.id ? video : null;
        }

        // ------------------------------------------------------- indicator

        function showIndicator() {
            if (document.getElementById(INDICATOR_ID) || !document.body) return;
            const indicator = document.createElement('div');
            indicator.id = INDICATOR_ID;
            indicator.setAttribute('role', 'status');
            indicator.innerHTML = '<div class="recording-dot"></div><span>Recording checkpoints…</span>';
            document.body.appendChild(indicator);
        }

        function hideIndicator() {
            const indicator = document.getElementById(INDICATOR_ID);
            if (indicator) indicator.remove();
        }

        // --------------------------------------------------- hold to record

        function startRecording() {
            if (recording) return;
            if (!currentVideo()) {
                notify('No video detected', 'error');
                return;
            }
            recording = true;
            checkpointStart = player.currentTime();
            notify('Hold Ctrl+B to create a checkpoint…', 'info');
            showIndicator();
        }

        async function stopRecording() {
            if (!recording) return;
            recording = false;
            hideIndicator();

            const start = checkpointStart;
            const end = player.currentTime();
            checkpointStart = null;

            const video = currentVideo();
            if (!video) return;

            // The old guard was `start <= 0 || end <= 0`, which threw away a
            // perfectly good checkpoint made in the opening seconds of a video.
            // What actually makes a checkpoint useless is a zero-length span.
            if (start == null || end - start < MIN_SPAN_SECONDS) {
                notify('No checkpoint created — hold Ctrl+B a little longer', 'warning');
                return;
            }

            const subtitle = await transcripts.textInRange(video.id, start, end);
            await save(video, {
                time: Math.floor(start),
                start: Math.floor(start),
                end: Math.floor(end),
                timestamp: Date.now(),
                note: `Checkpoint ${Time.formatTime(start)} - ${Time.formatTime(end)}`,
                subtitle,
            });

            const preview = subtitle
                ? ` — "${subtitle.slice(0, 40)}${subtitle.length > 40 ? '…' : ''}"`
                : '';
            notify(`Checkpoint created at ${Time.formatTime(start)}!${preview}`, 'success');
        }

        // ------------------------------------------------------- segments

        function toggleSegment() {
            const video = currentVideo();
            if (!video) {
                notify('No video detected', 'error');
                return;
            }
            if (segmentStart === null) beginSegment();
            else endSegment(video);
        }

        function beginSegment() {
            segmentStart = Math.floor(player.currentTime());
            notify(`Segment start set at ${Time.formatTime(segmentStart)} — press Ctrl+Shift+S again to end`, 'info');
        }

        async function endSegment(video) {
            const start = segmentStart;
            const end = Math.floor(player.currentTime());
            segmentStart = null;

            if (end <= start) {
                notify('Segment end must be after its start', 'error');
                return;
            }

            const subtitle = await transcripts.textInRange(video.id, start, end);
            await save(video, {
                time: start,
                start,
                end,
                timestamp: Date.now(),
                note: `Segment: ${Time.formatTime(start)} - ${Time.formatTime(end)}`,
                subtitle,
            });
            notify(`Segment saved: ${Time.formatTime(start)} - ${Time.formatTime(end)}`, 'success');
        }

        /**
         * A passage highlighted in the reader's transcript, saved as it is.
         *
         * MIN_SPAN_SECONDS does not apply: a one-word highlight is a
         * deliberate act, not a slipped key. The subtitle is the selected
         * text exactly, not the whole of the lines it touched. The times are
         * kept to the hundredth, because the reader shades the lines a
         * checkpoint covers by comparing them, and a start floored to the
         * second would shade the line before the one you chose.
         *
         * Highlighting the very same passage twice is one checkpoint — ids
         * mean de-duplication no longer catches that on its own. Resolves to
         * `{ record, repeat }`, or null when nothing could be saved.
         */
        async function saveHighlight({ video, start, end, text }) {
            const subtitle = String(text || '').trim();
            if (!video || !video.id || !subtitle || !(end > start)) return null;
            const hundredth = (value) => Math.round(value * 100) / 100;
            const record = {
                id: Bookmarks.newId(),
                time: Math.floor(start),
                start: hundredth(start),
                end: hundredth(end),
                timestamp: Date.now(),
                note: '',
                title: subtitle.length > 60 ? `${subtitle.slice(0, 59)}…` : subtitle,
                subtitle,
            };
            let repeat = null;
            try {
                await Bookmarks.update((videos) => {
                    const entry = videos.find((v) => v.id === video.id);
                    repeat = entry && entry.bookmarks.find((b) =>
                        b.start === record.start && b.end === record.end && b.subtitle === subtitle) || null;
                    return repeat ? videos : Bookmarks.addBookmarks(videos, video, [record]).videos;
                });
            } catch (error) {
                console.error('Bell Bearer: could not save highlight', error);
                return null;
            }
            return repeat ? { record: repeat, repeat: true } : { record, repeat: false };
        }

        function cancelSegment() {
            if (segmentStart === null) return;
            segmentStart = null;
            notify('Segment cancelled', 'info');
        }

        // ---------------------------------------------------------- saving

        /**
         * Persist one checkpoint.
         *
         * Goes through Bookmarks.update so the read-modify-write is atomic: the
         * old code read the whole list, appended, and wrote it back, so a save
         * racing the dashboard's save silently dropped one of them.
         *
         * Every path mints its id here, so a checkpoint cannot be saved
         * without one. Resolves to the record as saved, or null.
         */
        async function save(video, bookmark) {
            const record = { id: Bookmarks.newId(), ...bookmark };
            try {
                await Bookmarks.update((videos) =>
                    Bookmarks.addBookmarks(videos, video, [record]).videos);
                return record;
            } catch (error) {
                console.error('Bell Bearer: could not save checkpoint', error);
                notify('Could not save the checkpoint', 'error');
                return null;
            }
        }

        return {
            startRecording, stopRecording,
            toggleSegment, cancelSegment, saveHighlight,
            get isRecording() { return recording; },
            get hasOpenSegment() { return segmentStart !== null; },
        };
    }

    const Checkpoints = { createRecorder, MIN_SPAN_SECONDS, INDICATOR_ID };

    root.BB = root.BB || {};
    root.BB.Checkpoints = Checkpoints;
    if (typeof module !== 'undefined' && module.exports) module.exports = Checkpoints;
})(typeof globalThis !== 'undefined' ? globalThis : this);
