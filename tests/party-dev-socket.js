/**
 * The WebSocket side of the party dev server, written out by hand because the
 * server has no dependencies: the RFC 6455 handshake, and frames the way a
 * party uses them — masked text from the client, unmasked text back, at most
 * 8 KB — plus close and ping. Nothing else of the RFC is needed, so nothing
 * else is here.
 *
 * The faults live here too, since they happen on the wire:
 *
 * - `lag` delays every message each way, so the round trip is twice it.
 * - `jitter` spreads that delay by up to ± this much. Order is kept, as TCP
 *   keeps it; only the timing wobbles, which is what drift and the release
 *   lead have to absorb.
 * - `loss` drops that percentage of messages each way, except the ones a
 *   join depends on. A socket cannot lose a message, but a server under load
 *   and a client that missed one while reconnecting look just like it, and
 *   the ping's `seq` is what is supposed to heal it.
 */
'use strict';

const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 8192;
/** Never dropped by `loss`: without them there is no member to heal. */
const LOSSLESS = new Set(['create', 'hello', 'bye', 'created', 'welcome', 'error']);

function frame(opcode, payload = Buffer.alloc(0)) {
    const head = payload.length < 126 ? Buffer.from([0x80 | opcode, payload.length])
        : Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff]);
    return Buffer.concat([head, payload]);
}

/** Runs each thing handed to it after the lag, in the order it was handed over. */
function delayer({ lag, jitter, random }) {
    let last = 0;
    return (fn) => {
        if (!lag && !jitter) return fn();
        const at = Math.max(last, Date.now() + Math.max(0, lag + (random() * 2 - 1) * jitter));
        last = at;
        setTimeout(fn, at - Date.now());
    };
}

/**
 * One client's socket after the handshake: frames in, `onMessage(obj)` out,
 * and `send(obj)` / `close()` back, all through the fault injection.
 */
function connection(socket, faults, onMessage, onClose) {
    const inbound = delayer(faults);
    const outbound = delayer(faults);
    const lost = (msg) => !LOSSLESS.has(msg.t) && faults.random() * 100 < faults.loss;
    let buffer = Buffer.alloc(0);
    let pieces = [];
    let open = true;

    const write = (bytes) => { if (!socket.destroyed) socket.write(bytes); };
    function shut(code = 1000) {
        if (!open) return;
        open = false;
        const reason = Buffer.alloc(2);
        reason.writeUInt16BE(code);
        write(frame(0x8, reason));
        socket.end();
        onClose();
    }

    function text(data) {
        let msg;
        try { msg = JSON.parse(data); } catch (_) { msg = null; }
        // The protocol's rule: a frame that is not a JSON object ends the connection.
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return shut(1007);
        if (typeof msg.t === 'string' && !lost(msg)) inbound(() => open && onMessage(msg));
    }

    function read() {
        while (buffer.length >= 2) {
            const fin = buffer[0] & 0x80;
            const op = buffer[0] & 0x0f;
            let length = buffer[1] & 0x7f;
            let at = 2;
            if (length === 126) {
                if (buffer.length < 4) return;
                length = buffer.readUInt16BE(2);
                at = 4;
            } else if (length === 127) {
                return shut(1009);
            }
            // A client must mask what it sends.
            if (!(buffer[1] & 0x80)) return shut(1002);
            if (length > MAX_FRAME) return shut(1009);
            if (buffer.length < at + 4 + length) return;
            const mask = buffer.subarray(at, at + 4);
            const payload = Buffer.from(buffer.subarray(at + 4, at + 4 + length));
            for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
            buffer = buffer.subarray(at + 4 + length);

            if (op === 0x8) return shut(1000);
            if (op === 0x9) write(frame(0xa, payload));
            if (op === 0x1 || op === 0x0) {
                pieces.push(payload);
                if (pieces.reduce((sum, one) => sum + one.length, 0) > MAX_FRAME) return shut(1009);
                if (fin) {
                    const whole = Buffer.concat(pieces).toString('utf8');
                    pieces = [];
                    text(whole);
                }
            }
            if (op === 0x2) return shut(1003);
        }
    }

    socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (open) read();
    });
    socket.on('close', () => {
        if (!open) return;
        open = false;
        onClose();
    });
    socket.on('error', () => socket.destroy());

    return {
        send(msg) {
            if (!open || lost(msg)) return;
            const bytes = frame(0x1, Buffer.from(JSON.stringify(msg)));
            outbound(() => open && write(bytes));
        },
        /** After everything already sent, so an error arrives before the close. */
        close: () => outbound(() => shut(1000)),
        /** Gone without a word, as a dropped network looks. */
        sever() {
            open = false;
            socket.destroy();
            onClose();
        },
    };
}

/**
 * Answer an HTTP upgrade and return the connection, or null for a request
 * that was not a WebSocket one. `faults` is {lag, jitter, loss, random}.
 */
function accept(req, socket, faults, onMessage, onClose) {
    const key = req.headers['sec-websocket-key'];
    if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return null;
    }
    const answer = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${answer}\r\n\r\n`);
    socket.setNoDelay(true);
    return connection(socket, faults, onMessage, onClose);
}

module.exports = { MAX_FRAME, LOSSLESS, frame, delayer, accept };
