/**
 * Test file for transcript.js
 * 
 * This test can be run in Node.js (with fetch polyfill) or in a browser console.
 * 
 * Usage:
 * - In browser: Open test-transcript.html
 * - In Node.js: node test-transcript.js (requires node-fetch or similar)
 */

const importedModule = require('./transcript.js');

// Simple test runner
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
        console.log('🧪 Starting YouTube Transcript API Tests\n');
        
        for (const { name, fn } of this.tests) {
            try {
                console.log(`Testing: ${name}`);
                await fn();
                console.log(`✅ PASSED: ${name}\n`);
                this.passed++;
            } catch (error) {
                console.error(`❌ FAILED: ${name}`);
                console.error(`   Error: ${error.message}`);
                if (error.stack) {
                    console.error(`   Stack: ${error.stack}`);
                }
                console.error('');
                this.failed++;
            }
        }

        console.log('\n📊 Test Results:');
        console.log(`   ✅ Passed: ${this.passed}`);
        console.log(`   ❌ Failed: ${this.failed}`);
        console.log(`   📝 Total: ${this.tests.length}`);
    }
}

// Test video IDs (using well-known videos that should have transcripts)
const TEST_VIDEO_IDS = {
    // Rick Astley - Never Gonna Give You Up (popular test video)
    rickRoll: 'dQw4w9WgXcQ',
    // A shorter video for faster testing
    shortVideo: 'jNQXAC9IVRw',
};

async function runTests() {
    const runner = new TestRunner();
    const yttApi = new importedModule.YouTubeTranscriptApi();

    // Test 1: Fetch transcript for a known video
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
        
        console.log(`   ✓ Fetched ${transcript.length} snippets`);
        console.log(`   ✓ Language: ${transcript.language} (${transcript.languageCode})`);
        console.log(`   ✓ Type: ${transcript.isGenerated ? 'Auto-generated' : 'Manual'}`);
    });

    // Test 2: List available transcripts
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
        
        console.log(`   ✓ Found ${transcriptList.length} transcript(s)`);
        transcriptList.forEach(t => {
            console.log(`   ✓ ${t.language} (${t.languageCode}) - ${t.isGenerated ? 'Auto' : 'Manual'}`);
        });
    });

    // Test 3: Test transcript methods
    runner.test('Test transcript methods', async () => {
        const videoId = TEST_VIDEO_IDS.rickRoll;
        const transcript = await yttApi.fetch(videoId);
        
        // Test getText()
        const text = transcript.getText();
        if (typeof text !== 'string') {
            throw new Error('getText() should return a string');
        }
        if (text.length === 0) {
            throw new Error('getText() returned empty string');
        }
        console.log(`   ✓ getText() returned ${text.length} characters`);
        
        // Test getFormattedText()
        const formattedText = transcript.getFormattedText();
        if (typeof formattedText !== 'string') {
            throw new Error('getFormattedText() should return a string');
        }
        if (formattedText.length === 0) {
            throw new Error('getFormattedText() returned empty string');
        }
        console.log(`   ✓ getFormattedText() returned ${formattedText.length} characters`);
        
        // Test formatTime()
        const timeStr = transcript.formatTime(125.5);
        if (timeStr !== '02:05') {
            throw new Error(`formatTime(125.5) should return '02:05', got '${timeStr}'`);
        }
        console.log(`   ✓ formatTime() works correctly`);
        
        // Test getSnippetAtTime()
        if (transcript.length > 0) {
            const firstSnippet = transcript.snippets[0];
            const snippetAtTime = transcript.getSnippetAtTime(firstSnippet.start + 0.1);
            if (!snippetAtTime) {
                throw new Error('getSnippetAtTime() returned null for valid time');
            }
            console.log(`   ✓ getSnippetAtTime() works correctly`);
        }
        
        // Test iterator
        let count = 0;
        for (const snippet of transcript) {
            count++;
            if (!(snippet instanceof FetchedTranscriptSnippet)) {
                throw new Error('Iterator should return FetchedTranscriptSnippet instances');
            }
        }
        if (count !== transcript.length) {
            throw new Error(`Iterator count mismatch. Expected: ${transcript.length}, Got: ${count}`);
        }
        console.log(`   ✓ Iterator works correctly (${count} snippets)`);
    });

    // Test 4: Test language selection
    runner.test('Test language selection', async () => {
        const videoId = TEST_VIDEO_IDS.rickRoll;
        
        // Try to fetch with English
        const englishTranscript = await yttApi.fetch(videoId, { languages: ['en'] });
        if (!englishTranscript) {
            throw new Error('Failed to fetch English transcript');
        }
        console.log(`   ✓ Fetched English transcript (${englishTranscript.languageCode})`);
        
        // Try to fetch with multiple languages (should prefer first available)
        const multiLangTranscript = await yttApi.fetch(videoId, { languages: ['de', 'en', 'fr'] });
        if (!multiLangTranscript) {
            throw new Error('Failed to fetch transcript with multiple language preferences');
        }
        console.log(`   ✓ Fetched transcript with multiple language preferences (${multiLangTranscript.languageCode})`);
    });

    // Test 5: Test error handling
    runner.test('Test error handling for invalid video ID', async () => {
        try {
            await yttApi.fetch('invalid_video_id_12345');
            throw new Error('Should have thrown an error for invalid video ID');
        } catch (error) {
            if (!error.message) {
                throw new Error('Error should have a message');
            }
            console.log(`   ✓ Correctly threw error: ${error.message}`);
        }
    });

    // Test 6: Test snippet properties
    runner.test('Test snippet properties', async () => {
        const videoId = TEST_VIDEO_IDS.rickRoll;
        const transcript = await yttApi.fetch(videoId);
        
        if (transcript.length === 0) {
            throw new Error('No snippets to test');
        }
        
        const snippet = transcript.snippets[0];
        
        if (!(snippet instanceof FetchedTranscriptSnippet)) {
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
        
        console.log(`   ✓ Snippet properties are valid`);
        console.log(`   ✓ Sample snippet: "${snippet.text.substring(0, 50)}..." at ${snippet.start}s (${snippet.duration}s)`);
    });

    await runner.run();
}

// Run tests if this file is executed directly
if (typeof window === 'undefined') {
    // Node.js environment
    console.log('Running in Node.js environment');
    console.log('Note: You may need to install node-fetch or use a fetch polyfill\n');
    
    // Try to load transcript.js
    try {
        // In Node.js, you'd need to require or import the module
        // For now, we'll assume it's loaded via HTML or another method
        console.log('Please ensure transcript.js is loaded before running tests');
        console.log('You can run tests in the browser by opening test-transcript.html\n');

        runTests().catch(error => {
            console.error('Test execution failed:', error);
        });
    } catch (error) {
        console.error('Error loading transcript.js:', error);
    }
} else {
    // Browser environment
    console.log('Running in browser environment');
    console.log('Tests will run automatically when transcript.js is loaded\n');
    
    // Wait for transcript.js to load
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

// Export for use in other test frameworks
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runTests, TestRunner };
}

