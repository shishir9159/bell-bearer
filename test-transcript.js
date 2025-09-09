const importedModule = require('./transcript.js');

class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }

    test(name, fn) {
        this.tests.push({ name, fn });
    }

    async run() {
        console.log('Starting YouTube Transcript API Tests\n');

        for (const { name, fn } of this.tests) {
            try {
                console.log(`Testing: ${name}`);
                await fn();
                console.log(`PASSED: ${name}\n`);
                this.passed++;
            } catch (error) {
                console.error(`FAILED: ${name}`);
                console.error(`Error: ${error.message}`);
                if (error.stack) {
                    console.error(`Stack: ${error.stack}`);
                }
                console.error('');
                this.failed++;
            }
        }

        console.log('\nTest Results:');
        console.log(`Passed: ${this.passed}`);
        console.log(`Failed: ${this.failed}`);
        console.log(`Total: ${this.tests.length}`);
    }
}

const TEST_VIDEO_IDS = {

    rickRoll: 'dQw4w9WgXcQ',
    shortVideo: 'jNQXAC9IVRw',
};

async function runTests() {
    const runner = new TestRunner();
    const yttApi = new importedModule.YouTubeTranscriptApi();

    runner.test('Fetch transcript for video ID', async () => {

        const videoId = TEST_VIDEO_IDS.rickRoll;
        const transcript = await yttApi.fetch(videoId);

        if (!transcript) {
            throw new Error('Transcript is null or undefined');
        }

        if (!(transcript instanceof importedModule.FetchedTranscript)) {
            throw new Error('Transcript is not an instance of FetchedTranscript');
        }

        if (transcript.length === 0) {
            throw new Error('Transcript has no snippets');
        }

        if (!transcript.videoId || transcript.videoId !== videoId) {
            throw new Error(`Video ID mismatch. Expected: ${videoId}, Got: ${transcript.videoId}`);
        }

        if (!transcript.languageCode) {
            throw new Error('Transcript missing languageCode');
        }

        console.log(`Fetched ${transcript.length} snippets`);
        console.log(`Language: ${transcript.language} (${transcript.languageCode})`);
        console.log(`Type: ${transcript.isGenerated ? 'Auto-generated' : 'Manual'}`);
    });

    runner.test('List available transcripts', async () => {

        const videoId = TEST_VIDEO_IDS.rickRoll;
        const transcriptList = await yttApi.listTranscripts(videoId);

        if (!Array.isArray(transcriptList)) {
            throw new Error('Transcript list is not an array');
        }

        if (transcriptList.length === 0) {
            throw new Error('No transcripts found');
        }

        transcriptList.forEach((t, i) => {
            if (!(t instanceof importedModule.TranscriptInfo)) {
                throw new Error(`Transcript ${i} is not an instance of TranscriptInfo`);
            }
            if (!t.languageCode) {
                throw new Error(`Transcript ${i} missing languageCode`);
            }
            if (!t.baseUrl) {
                throw new Error(`Transcript ${i} missing baseUrl`);
            }
        });

        console.log(`Found ${transcriptList.length} transcript(s)`);
        transcriptList.forEach(t => {
            console.log(`${t.language} (${t.languageCode}) - ${t.isGenerated ? 'Auto' : 'Manual'}`);
        });
    });

    runner.test('Test transcript methods', async () => {
        const videoId = TEST_VIDEO_IDS.rickRoll;
        const transcript = await yttApi.fetch(videoId);

        const text = transcript.getText();
        if (typeof text !== 'string') {
            throw new Error('getText() should return a string');
        }
        if (text.length === 0) {
            throw new Error('getText() returned empty string');
        }
        console.log(`getText() returned ${text.length} characters`);

        const formattedText = transcript.getFormattedText();
        if (typeof formattedText !== 'string') {
            throw new Error('getFormattedText() should return a string');
        }
        if (formattedText.length === 0) {
            throw new Error('getFormattedText() returned empty string');
        }
        console.log(`getFormattedText() returned ${formattedText.length} characters`);

        const timeStr = transcript.formatTime(125.5);
        if (timeStr !== '02:05') {
            throw new Error(`formatTime(125.5) should return '02:05', got '${timeStr}'`);
        }
        console.log(`formatTime() works correctly`);

        if (transcript.length > 0) {
            const firstSnippet = transcript.snippets[0];
            const snippetAtTime = transcript.getSnippetAtTime(firstSnippet.start + 0.1);
            if (!snippetAtTime) {
                throw new Error('getSnippetAtTime() returned null for valid time');
            }
            console.log(`getSnippetAtTime() works correctly`);
        }

        let count = 0;
        for (const snippet of transcript) {
            count++;
            if (!(snippet instanceof importedModule.FetchedTranscriptSnippet)) {
                throw new Error('Iterator should return FetchedTranscriptSnippet instances');
            }
        }
        if (count !== transcript.length) {
            throw new Error(`Iterator count mismatch. Expected: ${transcript.length}, Got: ${count}`);
        }
        console.log(`Iterator works correctly (${count} snippets)`);
    });

    runner.test('Test language selection', async () => {
        const videoId = TEST_VIDEO_IDS.rickRoll;

        const englishTranscript = await yttApi.fetch(videoId, { languages: ['en'] });
        if (!englishTranscript) {
            throw new Error('Failed to fetch English transcript');
        }
        console.log(`Fetched English transcript (${englishTranscript.languageCode})`);

        const multiLangTranscript = await yttApi.fetch(videoId, { languages: ['de', 'en', 'fr'] });
        if (!multiLangTranscript) {
            throw new Error('Failed to fetch transcript with multiple language preferences');
        }
        console.log(`Fetched transcript with multiple language preferences (${multiLangTranscript.languageCode})`);
    });

    runner.test('Test error handling for invalid video ID', async () => {
        try {
            await yttApi.fetch('invalid_video_id_12345');
            throw new Error('Should have thrown an error for invalid video ID');
        } catch (error) {
            if (!error.message) {
                throw new Error('Error should have a message');
            }
            console.log(`Correctly threw error: ${error.message}`);
        }
    });

    runner.test('Test snippet properties', async () => {
        const videoId = TEST_VIDEO_IDS.rickRoll;
        const transcript = await yttApi.fetch(videoId);

        if (transcript.length === 0) {
            throw new Error('No snippets to test');
        }

        const snippet = transcript.snippets[0];

        if (!(snippet instanceof importedModule.FetchedTranscriptSnippet)) {
            throw new Error('Snippet is not an instance of FetchedTranscriptSnippet');
        }

        if (typeof snippet.text !== 'string') {
            throw new Error('Snippet text should be a string');
        }

        if (typeof snippet.start !== 'number' || snippet.start < 0) {
            throw new Error('Snippet start should be a non-negative number');
        }

        if (typeof snippet.duration !== 'number' || snippet.duration <= 0) {
            throw new Error('Snippet duration should be a positive number');
        }

        console.log(`Snippet properties are valid`);
        console.log(`Sample snippet: "${snippet.text.substring(0, 50)}..." at ${snippet.start}s (${snippet.duration}s)`);
    });

    await runner.run();
}

if (typeof window === 'undefined') {

    console.log('Running in bun.js environment');
    try {
        runTests().catch(error => {
            console.error('Test execution failed:', error);
        });
    } catch (error) {
        console.error('Error loading transcript.js:', error);
    }
} else {

    console.log('Running in browser environment');
    console.log('Tests will run automatically when transcript.js is loaded\n');

    if (typeof YouTubeTranscriptApi !== 'undefined') {
        runTests().catch(error => {
            console.error('Test execution failed:', error);
        });
    } else {
        console.log('Waiting for transcript.js to load...');
        window.addEventListener('load', () => {
            if (typeof YouTubeTranscriptApi !== 'undefined') {
                runTests().catch(error => {
                    console.error('Test execution failed:', error);
                });
            } else {
                console.error('transcript.js not loaded. Please ensure it is included before this test file.');
            }
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runTests, TestRunner };
}