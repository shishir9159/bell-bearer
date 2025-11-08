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
         */
        async function save(video, bookmark) {
            try {
                await Bookmarks.update((videos) =>
                    Bookmarks.addBookmarks(videos, video, [bookmark]).videos);
            } catch (error) {
                console.error('Bell Bearer: could not save checkpoint', error);
                notify('Could not save the checkpoint', 'error');
            }
        }

        return {
            startRecording, stopRecording,
            toggleSegment, cancelSegment,
            get isRecording() { return recording; },
            get hasOpenSegment() { return segmentStart !== null; },
        };
    }

    const Checkpoints = { createRecorder, MIN_SPAN_SECONDS, INDICATOR_ID };

    root.BB = root.BB || {};
    root.BB.Checkpoints = Checkpoints;
    if (typeof module !== 'undefined' && module.exports) module.exports = Checkpoints;
})(typeof globalThis !== 'undefined' ? globalThis : this);
