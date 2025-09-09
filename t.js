
const importedModule = require('./transcript.js');

const api = new importedModule.YouTubeTranscriptApi();

// Fetch transcript
// const transcript = await api.fetch('WpADmeiNfQ8');

// // Fetch translated transcript
// const translated = await api.fetch('WpADmeiNfQ8', { translateTo: 'es' });

// List available transcripts
const tracks = await api.listTranscripts('-_x9aWccFCE');
// { languages: ['en'] }
const translated = await api.fetch('-_x9aWccFCE', { languages: ['English (auto-generated)'] });
console.log(translated)

