/**
 * const api = new YouTubeTranscriptApi();
 * 
 * // Fetch transcript
 * const transcript = await api.fetch('dQw4w9WgXcQ');
 * 
 * // Fetch translated transcript
 * const translated = await api.fetch('dQw4w9WgXcQ', { translateTo: 'es' });
 * 
 * // List available transcripts
 * const tracks = await api.listTranscripts('dQw4w9WgXcQ');
 */

const INNERTUBE_CONTEXT = {
    client: { clientName: 'ANDROID', clientVersion: '20.10.38' }
};

/**
 * Represents a single transcript snippet with text and timing
 */
class FetchedTranscriptSnippet {
    constructor(text, start, duration) {
        this.text = text;
        this.start = start;
        this.duration = duration;
    }
}

/**
 * Represents information about an available transcript track
 */
class TranscriptInfo {
    constructor(data) {
        this.language = data.language;
        this.languageCode = data.languageCode;
        this.baseUrl = data.baseUrl;
        this.isGenerated = data.isGenerated;
        this.isTranslatable = data.isTranslatable;
        this.translationLanguages = data.translationLanguages || [];
    }
}

/**
 * Time-based index for efficient snippet lookups using binary search.
 * Creates an in-memory index from FetchedTranscript snippets with start and duration values.
 */
class TimeIndex {
    /**
     * Build an index from transcript snippets
     * @param {FetchedTranscriptSnippet[]} snippets - Array of transcript snippets
     */
    constructor(snippets) {
        // Create indexed entries sorted by start time
        this.entries = snippets.map((snippet, index) => ({
            start: snippet.start,
            end: snippet.start + snippet.duration,
            duration: snippet.duration,
            index: index,
            snippet: snippet
        }));

        // Sort by start time (should already be sorted, but ensure consistency)
        this.entries.sort((a, b) => a.start - b.start);
    }

    /**
     * Binary search to find the index of the entry at or before the given time
     * @param {number} time - Time in seconds
     * @returns {number} Index in entries array, or -1 if time is before all entries
     */
    _binarySearchFloor(time) {
        let left = 0;
        let right = this.entries.length - 1;
        let result = -1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (this.entries[mid].start <= time) {
                result = mid;
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        return result;
    }

    /**
     * Get snippet at exact time (where time falls within start to start+duration)
     * Uses binary search for O(log n) performance
     * @param {number} time - Time in seconds
     * @returns {FetchedTranscriptSnippet|null}
     */
    getSnippetAtTime(time) {
        const idx = this._binarySearchFloor(time);
        if (idx === -1) return null;

        const entry = this.entries[idx];
        if (time >= entry.start && time < entry.end) {
            return entry.snippet;
        }
        return null;
    }

    /**
     * Get the snippet that starts at or before the given time.
     * Useful for checkpoint scenarios where you want to start from an earlier position.
     * @param {number} time - Time in seconds
     * @returns {FetchedTranscriptSnippet|null}
     */
    getSnippetAtOrBefore(time) {
        const idx = this._binarySearchFloor(time);
        if (idx === -1) return null;
        return this.entries[idx].snippet;
    }

    /**
     * Get the start time for a checkpoint at or before the given time
     * @param {number} time - Time in seconds
     * @returns {number|null} Start time in seconds, or null if no snippet found
     */
    getCheckpointStart(time) {
        const idx = this._binarySearchFloor(time);
        if (idx === -1) return null;
        return this.entries[idx].start;
    }

    /**
     * Get all snippets within a time range
     * @param {number} startTime - Start time in seconds (inclusive)
     * @param {number} endTime - End time in seconds (exclusive)
     * @returns {FetchedTranscriptSnippet[]}
     */
    getSnippetsInRange(startTime, endTime) {
        const startIdx = this._binarySearchFloor(startTime);
        const results = [];

        // Start from the found index (or 0 if before all entries)
        const searchStart = startIdx === -1 ? 0 : startIdx;

        for (let i = searchStart; i < this.entries.length; i++) {
            const entry = this.entries[i];
            // Stop if we've passed the end time
            if (entry.start >= endTime) break;
            // Include if snippet overlaps with the range
            if (entry.end > startTime) {
                results.push(entry.snippet);
            }
        }

        return results;
    }

    /**
     * Get all indexed entries (for debugging or iteration)
     * @returns {Array<{start: number, end: number, duration: number, index: number, snippet: FetchedTranscriptSnippet}>}
     */
    getEntries() {
        return this.entries;
    }

    /**
     * Get the total duration covered by the transcript
     * @returns {number} Duration in seconds
     */
    getTotalDuration() {
        if (this.entries.length === 0) return 0;
        const lastEntry = this.entries[this.entries.length - 1];
        return lastEntry.end;
    }
}

/**
 * Represents a fetched transcript with snippets and helper methods
 */
class FetchedTranscript {
    constructor(data) {
        this.snippets = data.snippets;
        this.videoId = data.videoId;
        this.language = data.language;
        this.languageCode = data.languageCode;
        this.isGenerated = data.isGenerated;

        // Build time index for efficient lookups
        this.timeIndex = new TimeIndex(this.snippets);
    }

    get length() {
        return this.snippets.length;
    }

    /**
     * Get all text joined as a single string
     */
    getText() {
        return this.snippets.map(s => s.text).join(' ');
    }

    /**
     * Get formatted text with timestamps
     */
    getFormattedText() {
        return this.snippets.map(s =>
            `[${this.formatTime(s.start)}] ${s.text}`
        ).join('\n');
    }

    /**
     * Format seconds to MM:SS or HH:MM:SS
     */
    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        if (h > 0) {
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    /**
     * Find the snippet at a given time (uses binary search via TimeIndex)
     */
    getSnippetAtTime(time) {
        return this.timeIndex.getSnippetAtTime(time);
    }

    /**
     * Get the snippet that starts at or before the given time.
     * Useful for starting playback from an earlier checkpoint.
     * @param {number} time - Time in seconds
     * @returns {FetchedTranscriptSnippet|null}
     */
    getSnippetAtOrBefore(time) {
        return this.timeIndex.getSnippetAtOrBefore(time);
    }

    /**
     * Get the start time for playback checkpoint at or before the given time
     * @param {number} time - Time in seconds
     * @returns {number|null} Start time in seconds
     */
    getCheckpointStart(time) {
        return this.timeIndex.getCheckpointStart(time);
    }

    /**
     * Get all snippets within a time range
     * @param {number} startTime - Start of range in seconds
     * @param {number} endTime - End of range in seconds
     * @returns {FetchedTranscriptSnippet[]}
     */
    getSnippetsInRange(startTime, endTime) {
        return this.timeIndex.getSnippetsInRange(startTime, endTime);
    }

    /**
     * Iterator support
     */
    [Symbol.iterator]() {
        return this.snippets[Symbol.iterator]();
    }
}

class YouTubeTranscriptApi {
    /**
     * Fetch transcript for a video, optionally translated
     * @param {string} videoId - YouTube video ID
     * @param {Object} options - Options
     * @param {string} [options.language='en'] - Preferred transcript language (deprecated, use languages)
     * @param {string[]} [options.languages=['en']] - Preferred transcript languages in order of preference
     * @param {string} [options.translateTo] - Target language code for translation
     * @returns {Promise<FetchedTranscript>}
     */
    async fetch(videoId, options = {}) {
        const { language, languages = ['en'], translateTo } = options;
        // Support both language (string) and languages (array)
        const preferredLanguages = language ? [language] : languages;

        const tracks = await this.listTranscripts(videoId);

        // Find matching track based on language preferences
        let track = null;
        for (const lang of preferredLanguages) {
            track = tracks.find(t => t.languageCode === lang || t.languageCode.startsWith(lang));
            if (track) break;
        }
        if (!track && tracks.length > 0) {
            track = tracks[0]; // Fallback to first available
        }
        if (!track) {
            throw new Error(`No transcript found for video ${videoId}`);
        }

        // Build URL with optional translation
        let url = track.baseUrl;
        if (translateTo && track.isTranslatable) {
            url += `&tlang=${translateTo}`;
        }

        // Fetch and parse transcript XML
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch transcript: ${response.status}`);
        }

        const xml = await response.text();
        const snippets = this._parseXML(xml);

        return new FetchedTranscript({
            snippets,
            videoId,
            language: translateTo || track.language,
            languageCode: translateTo || track.languageCode,
            isGenerated: track.isGenerated
        });
    }

    /**
     * List all available transcript tracks for a video
     * @param {string} videoId - YouTube video ID  
     * @returns {Promise<Array<{language: string, languageCode: string, baseUrl: string, isGenerated: boolean, isTranslatable: boolean, translationLanguages: Array}>>}
     */
    async listTranscripts(videoId) {
        const apiKey = await this._getInnertubeApiKey(videoId);
        const captionData = await this._getCaptionTracks(videoId, apiKey);

        return captionData.captionTracks.map(track => new TranscriptInfo({
            language: track.name?.runs?.[0]?.text || track.name?.simpleText || track.languageCode,
            languageCode: track.languageCode,
            baseUrl: track.baseUrl.replace('&fmt=srv3', ''),
            isGenerated: track.kind === 'asr',
            isTranslatable: track.isTranslatable || false,
            translationLanguages: (captionData.translationLanguages || []).map(t => ({
                language: t.languageName?.runs?.[0]?.text || t.languageName?.simpleText,
                languageCode: t.languageCode
            }))
        }));
    }

    /**
     * Extract Innertube API key from video page
     */
    async _getInnertubeApiKey(videoId) {
        const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: { 'Accept-Language': 'en-US' }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch video page: ${response.status}`);
        }

        const html = await response.text();
        const match = html.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);

        if (!match) {
            if (html.includes('class="g-recaptcha"')) {
                throw new Error('IP blocked by YouTube');
            }
            throw new Error('Could not extract API key from video page');
        }

        return match[1];
    }

    /**
     * Fetch caption tracks via Innertube API
     */
    async _getCaptionTracks(videoId, apiKey) {
        const response = await fetch(
            `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    context: INNERTUBE_CONTEXT,
                    videoId: videoId
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Innertube API request failed: ${response.status}`);
        }

        const data = await response.json();

        // Check playability
        const status = data.playabilityStatus?.status;
        if (status && status !== 'OK') {
            throw new Error(`Video not playable: ${data.playabilityStatus?.reason || status}`);
        }

        const captions = data.captions?.playerCaptionsTracklistRenderer;
        if (!captions?.captionTracks) {
            throw new Error('No captions available for this video');
        }

        return captions;
    }

    /**
     * Parse transcript XML into snippets
     */
    _parseXML(xml) {
        const snippets = [];

        // Check if we're in a browser environment with DOMParser
        if (typeof DOMParser !== 'undefined') {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, 'text/xml');
            const texts = doc.getElementsByTagName('text');

            for (let i = 0; i < texts.length; i++) {
                const el = texts[i];
                snippets.push(new FetchedTranscriptSnippet(
                    this._decodeHTML(el.textContent || ''),
                    parseFloat(el.getAttribute('start') || 0),
                    parseFloat(el.getAttribute('dur') || 0)
                ));
            }
        } else {
            // Node.js environment - use regex-based parsing
            const textRegex = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/g;
            let match;
            while ((match = textRegex.exec(xml)) !== null) {
                snippets.push(new FetchedTranscriptSnippet(
                    this._decodeHTML(match[3] || ''),
                    parseFloat(match[1] || 0),
                    parseFloat(match[2] || 0)
                ));
            }
        }
        return snippets;
    }

    /**
     * Decode HTML entities
     */
    _decodeHTML(text) {
        // Check if we're in a browser environment
        if (typeof document !== 'undefined') {
            const textarea = document.createElement('textarea');
            textarea.innerHTML = text;
            return textarea.value;
        } else {
            // Node.js environment - manual HTML entity decoding
            return text
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&apos;/g, "'")
                .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
                .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        }
    }

    /**
     * Format seconds to MM:SS or HH:MM:SS
     */
    _formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        if (h > 0) {
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
}

// Export for various environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { YouTubeTranscriptApi, FetchedTranscriptSnippet, TranscriptInfo, FetchedTranscript, TimeIndex };
}
if (typeof window !== 'undefined') {
    window.YouTubeTranscriptApi = YouTubeTranscriptApi;
    window.FetchedTranscriptSnippet = FetchedTranscriptSnippet;
    window.TranscriptInfo = TranscriptInfo;
    window.FetchedTranscript = FetchedTranscript;
    window.TimeIndex = TimeIndex;
}
