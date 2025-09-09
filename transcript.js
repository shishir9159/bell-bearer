const INNERTUBE_CONTEXT = {
    client: { clientName: 'ANDROID', clientVersion: '20.10.38' }
};

class FetchedTranscriptSnippet {
    constructor(text, start, duration) {
        this.text = text;
        this.start = start;
        this.duration = duration;
    }
}

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

class FetchedTranscript {
    constructor(data) {
        this.snippets = data.snippets;
        this.videoId = data.videoId;
        this.language = data.language;
        this.languageCode = data.languageCode;
        this.isGenerated = data.isGenerated;
    }

    get length() {
        return this.snippets.length;
    }

    getText() {
        return this.snippets.map(s => s.text).join(' ');
    }

    getFormattedText() {
        return this.snippets.map(s =>
            `[${this.formatTime(s.start)}] ${s.text}`
        ).join('\n');
    }

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        if (h > 0) {
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    getSnippetAtTime(time) {
        for (const snippet of this.snippets) {
            if (time >= snippet.start && time < snippet.start + snippet.duration) {
                return snippet;
            }
        }
        return null;
    }

    [Symbol.iterator]() {
        return this.snippets[Symbol.iterator]();
    }
}

class YouTubeTranscriptApi {
    /**
     * Fetch transcript for a video, optionally translated
     * @param {string} videoId
     * @param {Object} options
     * @param {string} [options.language='en'] - deprecate it
     * TODO:
     *   set from dashboard
     * @param {string[]} [options.languages=['en']] - Preferred transcript languages in order of preference
     * @param {string} [options.translateTo]
     * @returns {Promise<FetchedTranscript>}
     */
    async fetch(videoId, options = {}) {
        const { language, languages = ['en'], translateTo } = options;
        const preferredLanguages = language ? [language] : languages;

        const tracks = await this.listTranscripts(videoId);

        let track = null;
        for (const lang of preferredLanguages) {
            track = tracks.find(t => t.languageCode === lang || t.languageCode.startsWith(lang));
            if (track) break;
        }
        if (!track && tracks.length > 0) {
            track = tracks[0];
        }
        if (!track) {
            throw new Error(`No transcript found for video ${videoId}`);
        }

        let url = track.baseUrl;
        if (translateTo && track.isTranslatable) {
            url += `&tlang=${translateTo}`;
        }

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

    _parseXML(xml) {
        const snippets = [];
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

    _decodeHTML(text) {
        if (typeof document !== 'undefined') {
            const textarea = document.createElement('textarea');
            textarea.innerHTML = text;
            return textarea.value;
        } else {
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { YouTubeTranscriptApi, FetchedTranscriptSnippet, TranscriptInfo, FetchedTranscript };
}
if (typeof window !== 'undefined') {
    window.YouTubeTranscriptApi = YouTubeTranscriptApi;
    window.FetchedTranscriptSnippet = FetchedTranscriptSnippet;
    window.TranscriptInfo = TranscriptInfo;
    window.FetchedTranscript = FetchedTranscript;
}