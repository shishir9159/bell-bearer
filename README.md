# Bell Bearing Hunter

It's hard to keep up with newly published videos from all of your youtube's subscribed channels. A better way to organize is to tag channels of similar focus. So, you can occasionaly visit a dedicated dashboard to consume different area of your interests at your own pace. YouTube lacks all the good features a poweruser can benefit from, I have a roadmap to streamline YouTube experience for the power users.


## Features

- **Checkpoint Creation**: Hold Ctrl+B to create checkpoints while watching YouTube videos
- **Visual Feedback**: Snappy notifications for bookmark duration
- **Bookmark Management**: Clean interface to view and manage all bookmarks
- **Quick Navigation**: Jump to the bookmarked timestamp with a single click
- **Persistent Storage**: Persist Bookmarks across browser sessions
- **Import/Export**: Backup and restore bookmarks, import from YouTube timestamp links
- **Reward System**: Track watch credits to spend them on popcorn for later

## Offline Installation

### Method 1: Load as Unpacked Extension (Recommended for Development)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension directory
5. The extension should now appear in your extensions list


#### Import/Export Data Format
The JSON export file contains:
```json
{
  "version": "1.0",
  "exportDate": "2025-01-08T06:30:00.000Z",
  "totalVideos": 5,
  "totalBookmarks": 25,
  "videos": [
    {
      "id": "video_id",
      "title": "Video Title",
      "url": "https://www.youtube.com/watch?v=video_id",
      "bookmarks": [
        {
          "time": 120,
          "timestamp": 1234567890,
          "note": "Checkpoint description"
        }
      ]
    }
  ]
}
```

## Permissions

- `storage`: To save and retrieve bookmarks
- `activeTab`: To interact with YouTube pages
- `scripting`: To inject content scripts
- `host_permissions`: To access YouTube.com

## Persistance Storage

Chrome's storage API is used with the following data structure format:
```javascript
{
  youtubeBookmarks: [
    {
      id: "video_id",
      title: "Video Title",
      url: "https://youtube.com/watch?v=video_id",
      bookmarks: [
        {
          time: 120, // in seconds
          timestamp: 1234567890,
          note: "Checkpoint description"
        }
      ]
    }
  ]
}
```

### Import/Export Features

- **Smart Merging**: When importing, the extension intelligently merges bookmarks without creating duplicates
- **Format Validation**: Imported files are validated to ensure they contain valid bookmark data
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Multiple URL Formats**: Supports both youtube.com and youtu.be URLs with various timestamp formats

inspired by:
https://github.com/NabokD/pockettube
https://github.com/jdepoix/youtube-transcript-api.git