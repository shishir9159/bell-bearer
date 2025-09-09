/**
 * YouTube Transcript API - JavaScript Implementation
 * Based on the Python youtube-transcript-api library
 * 
 * This module allows you to retrieve transcripts/subtitles for YouTube videos
 * without requiring an API key or headless browser.
 * 
 * Usage example:
 * ```javascript
 * const yttApi = new YouTubeTranscriptApi();
 * 
 * // Fetch transcript for a video
 * const transcript = await yttApi.fetch('dQw4w9WgXcQ');
 * 
 * // Get plain text
 * console.log(transcript.getText());
 * 
 * // Get formatted text with timestamps
 * console.log(transcript.getFormattedText());
 * 
 * // Access individual snippets
 * for (const snippet of transcript) {
 *   console.log(`[${snippet.start}s] ${snippet.text}`);
 * }
 * 
 * // Get snippet at specific time
 * const snippet = transcript.getSnippetAtTime(10.5);
 * 
 * // List all available transcripts
 * const transcripts = await yttApi.listTranscripts('dQw4w9WgXcQ');
 * 
 * // Fetch with specific language
 * const germanTranscript = await yttApi.fetch('dQw4w9WgXcQ', { languages: ['de'] });
 * ```
 */

class YouTubeTranscriptApi {
    constructor() {
        this.baseUrl = 'https://www.youtube.com';
    }

    /**
     * Fetch transcript for a given video ID
     * @param {string} videoId - YouTube video ID
     * @param {Object} options - Options for fetching transcript
     * @param {string[]} options.languages - Preferred languages (default: ['en'])
     * @param {boolean} options.excludeGenerated - Exclude auto-generated transcripts
     * @param {boolean} options.excludeManuallyCreated - Exclude manually created transcripts
     * @returns {Promise<FetchedTranscript>} Transcript object
     */
    async fetch(videoId, options = {}) {
        const {
            languages = ['en'],
            excludeGenerated = false,
            excludeManuallyCreated = false
        } = options;

        if (!videoId) {
            throw new Error('Video ID is required');
        }

        // First, get the list of available transcripts
        const transcriptList = await this.listTranscripts(videoId);

        // Find the best matching transcript
        let transcript = null;
        
        for (const lang of languages) {
            // Try exact match first
            transcript = transcriptList.find(t => 
                t.languageCode === lang || 
                t.language.toLowerCase() === lang.toLowerCase()
            );
            
            if (transcript) break;
            
            // Try partial match (e.g., 'en' matches 'en-US')
            transcript = transcriptList.find(t => 
                t.languageCode.startsWith(lang) || 
                lang.startsWith(t.languageCode)
            );
            
            if (transcript) break;
        }

        // If no match found, try to get any available transcript
        if (!transcript && transcriptList.length > 0) {
            transcript = transcriptList[0];
        }

        if (!transcript) {
            throw new Error(`No transcript found for video ${videoId}`);
        }

        // Filter based on exclude options
        if (excludeGenerated && transcript.isGenerated) {
            const manualTranscript = transcriptList.find(t => !t.isGenerated);
            if (manualTranscript) {
                transcript = manualTranscript;
            } else {
                throw new Error('No manually created transcript available');
            }
        }

        if (excludeManuallyCreated && !transcript.isGenerated) {
            const generatedTranscript = transcriptList.find(t => t.isGenerated);
            if (generatedTranscript) {
                transcript = generatedTranscript;
            } else {
                throw new Error('No auto-generated transcript available');
            }
        }

        // Fetch the actual transcript data
        return await this.fetchTranscriptData(videoId, transcript);
    }

    /**
     * List all available transcripts for a video
     * @param {string} videoId - YouTube video ID
     * @returns {Promise<TranscriptInfo[]>} Array of transcript information
     */
    async listTranscripts(videoId) {
        const videoUrl = `${this.baseUrl}/watch?v=${videoId}`;
        
        try {
            // In browser extension context, we might need to use different approach
            // Try fetching the page
            const response = await fetch(videoUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch video page: ${response.status} ${response.statusText}`);
            }

            const html = await response.text();
            
            // Extract transcript data from the page
            // YouTube embeds transcript data in the page HTML
            const transcriptData = this.extractTranscriptData(html, videoId);
            
            if (!transcriptData || transcriptData.length === 0) {
                throw new Error(`No transcripts found for video ${videoId}. The video may not have captions available.`);
            }

            return transcriptData.map(t => new TranscriptInfo(t));
        } catch (error) {
            // If fetch fails (e.g., CORS), try alternative method
            if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
                throw new Error(`Cannot fetch video page. This may be due to CORS restrictions. In a browser extension, you may need to use a content script to access the page. Original error: ${error.message}`);
            }
            throw new Error(`Error fetching transcripts: ${error.message}`);
        }
    }

    /**
     * Extract transcript data from HTML page
     * @param {string} html - HTML content of the video page
     * @param {string} videoId - Video ID
     * @returns {TranscriptInfo[]} Array of transcript information
     */
    extractTranscriptData(html, videoId) {
        const transcripts = [];

        // Method 1: Try to extract from ytInitialPlayerResponse
        try {
            // YouTube embeds the player response as a script tag
            // Look for the pattern: var ytInitialPlayerResponse = {...};
            // Use [\s\S] instead of . with 's' flag for better compatibility
            const patterns = [
                /var\s+ytInitialPlayerResponse\s*=\s*({[\s\S]+?});/,
                /ytInitialPlayerResponse\s*=\s*({[\s\S]+?});/,
            ];

            let playerResponse = null;
            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match && match[1]) {
                    try {
                        // The JSON might be very large, so we need to handle it carefully
                        // Try to find the matching closing brace
                        let jsonStr = match[1];
                        let braceCount = 0;
                        let lastValidIndex = 0;
                        
                        for (let i = 0; i < jsonStr.length; i++) {
                            if (jsonStr[i] === '{') braceCount++;
                            if (jsonStr[i] === '}') {
                                braceCount--;
                                if (braceCount === 0) {
                                    lastValidIndex = i + 1;
                                    break;
                                }
                            }
                        }
                        
                        if (lastValidIndex > 0) {
                            jsonStr = jsonStr.substring(0, lastValidIndex);
                            playerResponse = JSON.parse(jsonStr);
                            break;
                        }
                    } catch (e) {
                        // Try next pattern or method
                        continue;
                    }
                }
            }

            if (playerResponse) {
                const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
                
                for (const track of captionTracks) {
                    if (track.baseUrl) {
                        transcripts.push({
                            videoId: videoId,
                            language: track.name?.simpleText || track.name?.runs?.[0]?.text || track.languageCode || 'Unknown',
                            languageCode: track.languageCode,
                            isGenerated: track.kind === 'asr',
                            isTranslatable: track.isTranslatable || false,
                            baseUrl: track.baseUrl
                        });
                    }
                }
            }
        } catch (e) {
            console.warn('Error extracting transcript from ytInitialPlayerResponse:', e);
        }

        // Method 2: Try to extract from embedded JSON-LD or other data structures
        if (transcripts.length === 0) {
            try {
                // Look for transcript-related data in various formats
                const captionTracksPattern = /captionTracks["\s]*:[\s]*\[([^\]]+)\]/g;
                let match;
                
                while ((match = captionTracksPattern.exec(html)) !== null) {
                    const trackSection = match[0];
                    const baseUrlMatch = trackSection.match(/baseUrl["\s]*:["\s]*"([^"]+)"/);
                    const langMatch = trackSection.match(/languageCode["\s]*:["\s]*"([^"]+)"/);
                    const nameMatch = trackSection.match(/name["\s]*:[\s]*\{[^}]*simpleText["\s]*:["\s]*"([^"]+)"/);
                    const kindMatch = trackSection.match(/kind["\s]*:["\s]*"([^"]+)"/);
                    
                    if (baseUrlMatch && langMatch) {
                        transcripts.push({
                            videoId: videoId,
                            language: nameMatch ? nameMatch[1] : langMatch[1],
                            languageCode: langMatch[1],
                            isGenerated: kindMatch && kindMatch[1] === 'asr',
                            isTranslatable: false,
                            baseUrl: baseUrlMatch[1]
                        });
                    }
                }
            } catch (e) {
                console.warn('Error extracting transcript from regex patterns:', e);
            }
        }

        return transcripts;
    }

    /**
     * Fetch the actual transcript data from a transcript URL
     * @param {string} videoId - YouTube video ID
     * @param {TranscriptInfo} transcriptInfo - Transcript information
     * @returns {Promise<FetchedTranscript>} Fetched transcript object
     */
    async fetchTranscriptData(videoId, transcriptInfo) {
        if (!transcriptInfo.baseUrl) {
            throw new Error('Transcript base URL not available');
        }

        try {
            // Fetch the transcript XML
            const response = await fetch(transcriptInfo.baseUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch transcript: ${response.status}`);
            }

            const xmlText = await response.text();
            
            // Parse the XML transcript
            const snippets = this.parseTranscriptXML(xmlText);

            return new FetchedTranscript({
                snippets: snippets,
                videoId: videoId,
                language: transcriptInfo.language,
                languageCode: transcriptInfo.languageCode,
                isGenerated: transcriptInfo.isGenerated
            });
        } catch (error) {
            throw new Error(`Error fetching transcript data: ${error.message}`);
        }
    }

    /**
     * Parse transcript XML into snippets
     * @param {string} xmlText - XML content of the transcript
     * @returns {FetchedTranscriptSnippet[]} Array of transcript snippets
     */
    parseTranscriptXML(xmlText) {
        const snippets = [];
        
        try {
            // Try using DOMParser (works in browser context)
            if (typeof DOMParser !== 'undefined') {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
                
                // Check for parsing errors
                const parserError = xmlDoc.querySelector('parsererror');
                if (parserError) {
                    throw new Error('XML parsing error');
                }
                
                const textElements = xmlDoc.getElementsByTagName('text');
                
                for (let i = 0; i < textElements.length; i++) {
                    const textEl = textElements[i];
                    const start = parseFloat(textEl.getAttribute('start') || 0);
                    const duration = parseFloat(textEl.getAttribute('dur') || 0);
                    const text = textEl.textContent || '';
                    
                    snippets.push(new FetchedTranscriptSnippet({
                        text: text.trim(),
                        start: start,
                        duration: duration
                    }));
                }
            } else {
                // Fallback: Parse XML using regex (less reliable but works everywhere)
                const textPattern = /<text start="([^"]+)" dur="([^"]+)"[^>]*>([^<]*)<\/text>/g;
                let match;
                
                while ((match = textPattern.exec(xmlText)) !== null) {
                    const start = parseFloat(match[1] || 0);
                    const duration = parseFloat(match[2] || 0);
                    const text = match[3] || '';
                    
                    snippets.push(new FetchedTranscriptSnippet({
                        text: text.trim(),
                        start: start,
                        duration: duration
                    }));
                }
            }
        } catch (error) {
            throw new Error(`Error parsing transcript XML: ${error.message}`);
        }

        return snippets;
    }
}

/**
 * Transcript Information
 */
class TranscriptInfo {
    constructor(data) {
        this.videoId = data.videoId;
        this.language = data.language;
        this.languageCode = data.languageCode;
        this.isGenerated = data.isGenerated || false;
        this.isTranslatable = data.isTranslatable || false;
        this.baseUrl = data.baseUrl;
    }
}

/**
 * Fetched Transcript
 */
class FetchedTranscript {
    constructor(data) {
        this.snippets = data.snippets || [];
        this.videoId = data.videoId;
        this.language = data.language;
        this.languageCode = data.languageCode;
        this.isGenerated = data.isGenerated || false;
    }

    /**
     * Get transcript as plain text
     * @returns {string} Plain text transcript
     */
    getText() {
        return this.snippets.map(s => s.text).join(' ');
    }

    /**
     * Get transcript as formatted text with timestamps
     * @returns {string} Formatted transcript
     */
    getFormattedText() {
        return this.snippets.map(s => 
            `[${this.formatTime(s.start)}] ${s.text}`
        ).join('\n');
    }

    /**
     * Format time in seconds to HH:MM:SS
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time string
     */
    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Get snippet at a specific time
     * @param {number} time - Time in seconds
     * @returns {FetchedTranscriptSnippet|null} Snippet at the time or null
     */
    getSnippetAtTime(time) {
        return this.snippets.find(s => 
            time >= s.start && time < s.start + s.duration
        ) || null;
    }

    /**
     * Iterator support
     */
    [Symbol.iterator]() {
        return this.snippets[Symbol.iterator]();
    }

    /**
     * Get length (number of snippets)
     */
    get length() {
        return this.snippets.length;
    }
}

/**
 * Transcript Snippet
 */
class FetchedTranscriptSnippet {
    constructor(data) {
        this.text = data.text;
        this.start = data.start;
        this.duration = data.duration;
    }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        YouTubeTranscriptApi,
        FetchedTranscript,
        FetchedTranscriptSnippet,
        TranscriptInfo
    };
}

// Also make available globally
if (typeof window !== 'undefined') {
    window.YouTubeTranscriptApi = YouTubeTranscriptApi;
    window.FetchedTranscript = FetchedTranscript;
    window.FetchedTranscriptSnippet = FetchedTranscriptSnippet;
    window.TranscriptInfo = TranscriptInfo;
}

