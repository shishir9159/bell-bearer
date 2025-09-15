# YouTube Transcript API Documentation

Minimal JavaScript implementation for fetching YouTube video transcripts with translation support.

## Quick Start

```javascript
const api = new YouTubeTranscriptApi();

// Fetch transcript
const transcript = await api.fetch('dQw4w9WgXcQ');
console.log(transcript.getText());

// Fetch translated transcript (e.g., Spanish)
const translated = await api.fetch('dQw4w9WgXcQ', { translateTo: 'es' });
console.log(translated.getText());

// List available transcripts
const tracks = await api.listTranscripts('dQw4w9WgXcQ');
console.log(tracks);
```

---

## API Reference

### `fetch(videoId, options?)`

Fetch a transcript, optionally translated.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `language` | string | `'en'` | Preferred source transcript language |
| `translateTo` | string | - | Target language code for translation |

**Returns:** `{ snippets, language, languageCode, isGenerated, getText(), getFormattedText() }`

### `listTranscripts(videoId)`

List all available transcript tracks.

**Returns:** Array of tracks with `{ language, languageCode, baseUrl, isGenerated, isTranslatable, translationLanguages }`

---

## HTTP Requests (curl)

The API makes three HTTP requests:

### 1. Fetch Video Page (extract API key)

```bash
curl -s "https://www.youtube.com/watch?v=dQw4w9WgXcQ" \
  -H "Accept-Language: en-US" \
  | grep -oP '"INNERTUBE_API_KEY":"[^"]+"'
```

### 2. Get Caption Tracks (Innertube API)

```bash
curl -X POST "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8" \
  -H "Content-Type: application/json" \
  -d '{
    "context": {
      "client": {
        "clientName": "ANDROID",
        "clientVersion": "20.10.38"
      }
    },
    "videoId": "dQw4w9WgXcQ"
  }'
```

**Response contains:** `captions.playerCaptionsTracklistRenderer.captionTracks[].baseUrl`

### 3. Fetch Transcript XML

```bash
# Original transcript
curl -s "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en"

# Translated transcript (add &tlang parameter)
curl -s "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en&tlang=es"
```

**Response format:**
```xml
<transcript>
  <text start="0.5" dur="2.1">First line of text</text>
  <text start="2.6" dur="3.0">Second line of text</text>
</transcript>
```

---

## Interaction Diagram

```mermaid
sequenceDiagram
    participant Client
    participant YouTube
    participant InnertubeAPI
    participant TranscriptAPI

    Client->>YouTube: GET /watch?v={videoId}
    YouTube-->>Client: HTML (contains INNERTUBE_API_KEY)
    
    Client->>InnertubeAPI: POST /youtubei/v1/player
    Note right of Client: Body: {context, videoId}
    InnertubeAPI-->>Client: JSON (captionTracks with baseUrl)
    
    alt No Translation
        Client->>TranscriptAPI: GET {baseUrl}
    else With Translation
        Client->>TranscriptAPI: GET {baseUrl}&tlang={lang}
    end
    
    TranscriptAPI-->>Client: XML transcript
    
    Note over Client: Parse XML → snippets[]
```

---

## Translation Languages

Common language codes for `translateTo`:

| Code | Language |
|------|----------|
| `en` | English |
| `es` | Spanish |
| `fr` | French |
| `de` | German |
| `ja` | Japanese |
| `ko` | Korean |
| `zh-Hans` | Chinese (Simplified) |
| `pt` | Portuguese |
| `ar` | Arabic |
| `hi` | Hindi |

Full list available via `track.translationLanguages` from `listTranscripts()`.

---

## Error Handling

| Error | Cause |
|-------|-------|
| `IP blocked by YouTube` | Too many requests; use proxy |
| `No captions available` | Video has no transcripts |
| `Video not playable` | Private/deleted/region-locked |

---

## Browser Extension Usage

When used in a content script on YouTube pages, the API key extraction step can be skipped by reading from `ytInitialPlayerResponse`:

```javascript
// Extract from page context
const playerResponse = window.ytInitialPlayerResponse;
const tracks = playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
```
