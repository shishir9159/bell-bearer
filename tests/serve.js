/**
 * A ~40-line static file server, so the suite can be opened over HTTP when the
 * browser refuses `file://` sub-resource loads.
 *
 *   node tests/serve.js        # then open http://localhost:5601/tests/
 *
 * Node only, no npm install — the suite itself has no dependencies and this
 * keeps it that way.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || process.argv[2] || 5601);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
    const requested = decodeURIComponent(req.url.split('?')[0]);
    const target = requested.endsWith('/') ? `${requested}index.html` : requested;
    const file = path.resolve(path.join(ROOT, target));

    // Never serve anything outside the extension folder.
    if (!file.startsWith(ROOT)) {
        res.writeHead(403).end('forbidden');
        return;
    }

    fs.readFile(file, (error, data) => {
        if (error) {
            res.writeHead(404).end(`not found: ${target}`);
            return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(PORT, () => {
    console.log(`bell-bearer: serving ${ROOT} at http://localhost:${PORT}/tests/`);
});
