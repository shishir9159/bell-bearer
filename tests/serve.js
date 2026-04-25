/**
 * A static server for the suite, for when the browser refuses `file://` loads.
 *
 *     node tests/serve.js        # then open http://localhost:5601/tests/
 *
 * It answers this machine alone, and only with the kinds of file the
 * extension is made of. It used to listen on every interface, serve any file
 * at all — a sibling folder whose name began with this one's included, since
 * `bell-bearer-old/` starts with `bell-bearer` — and a malformed escape in an
 * address threw out of the handler and took the server down.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || process.argv[2] || 5601);
const HOSTS = ['127.0.0.1', '::1'];

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
};

/**
 * The file a request path names, or null for one it may not have: outside
 * the folder, under a dot-folder (.git, .github, an editor's), or of a kind
 * not in TYPES — the notes and plans kept beside the code are Markdown.
 */
function resolve(url) {
    let requested;
    try {
        requested = decodeURIComponent(new URL(url, 'http://localhost').pathname);
    } catch (_) {
        return null;
    }
    if (requested.includes('\0')) return null;
    const target = requested.endsWith('/') ? `${requested}index.html` : requested;
    const file = path.resolve(ROOT, `.${target}`);
    const inside = path.relative(ROOT, file);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
    if (inside.split(path.sep).some((part) => part.startsWith('.'))) return null;
    return TYPES[path.extname(file).toLowerCase()] ? file : null;
}

function handle(req, res) {
    const file = resolve(req.url || '/');
    if (!file) {
        res.writeHead(404).end('not found');
        return;
    }
    fs.readFile(file, (error, data) => {
        if (error) {
            res.writeHead(404).end('not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] });
        res.end(data);
    });
}

function start() {
    for (const host of HOSTS) {
        const server = http.createServer(handle);
        server.on('clientError', (_, socket) => socket.destroy());
        // A machine without IPv6 has no ::1 to listen on; 127.0.0.1 serves alone.
        server.on('error', (error) => { if (host === '127.0.0.1') throw error; });
        server.listen(PORT, host, () => {
            if (host === '127.0.0.1') console.log(`bell-bearer: serving ${ROOT} at http://localhost:${PORT}/tests/`);
        });
    }
}

if (require.main === module) start();

module.exports = { ROOT, TYPES, HOSTS, resolve };
