
const importedModule = require('./transcript.js');

const api = new importedModule.YouTubeTranscriptApi();
const tracks = await api.listTranscripts('-_x9aWccFCE');
// { languages: ['en'] }
const translated = await api.fetch('-_x9aWccFCE', { languages: ['English (auto-generated)'] });
console.log(translated)

