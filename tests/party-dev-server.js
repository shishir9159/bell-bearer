#!/usr/bin/env node
/**
 * A party server to point the extension at before the real one exists:
 * src/shared/party-room.js behind a WebSocket, one room per `create`.
 *
 *     node tests/party-dev-server.js [--port 7070] [--lag ms] [--jitter ms] [--loss %]
 *
 * This is a test fixture, not the product. The server people will run is
 * written in Zig or Go against the README's "Watch party protocol", and
 * tests/party-conformance.js is what holds it to the same behaviour as this.
 * So nothing here is hardened: no TLS, no limits on rooms, no persistence.
 *
 * The faults are there to watch the extension heal, not to test the room;
 * what each one does is in party-dev-socket.js, where they happen.
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const PartyRoom = require('../src/shared/party-room.js');
const DevSocket = require('./party-dev-socket.js');

const TICK_MS = 1000;
/** A room with nobody left in it is kept this long, then forgotten. */
const EMPTY_MS = 60000;

const base64url = (bytes) => bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function sameSecret(a, b) {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** The server. Resolves once it is listening; `port: 0` picks a free port. */
function startServer({ port = 7070, lag = 0, jitter = 0, loss = 0, random = Math.random, log = () => {} } = {}) {
    const faults = { lag, jitter, loss, random };
    const rooms = new Map();
    const conns = new Set();

    function openRoom(policy) {
        const r = { id: base64url(crypto.randomBytes(6)), secret: base64url(crypto.randomBytes(16)), links: new Map(), caught: null, emptySince: null };
        r.deliver = (member, msg) => {
            const conn = r.links.get(member);
            if (!conn) return;
            conn.send(msg);
            // A kick: the error, then the door.
            if (msg.t === 'error') {
                r.links.delete(member);
                conn.close();
            }
        };
        r.room = PartyRoom.createRoom({
            id: r.id, policy: policy || {},
            send(member, msg) {
                if (r.caught) r.caught.push({ member, msg });
                else r.deliver(member, msg);
            },
        });
        rooms.set(r.id, r);
        log(`room ${r.id} opened`);
        return r;
    }

    /** create or hello: which room, is this one allowed in, and as whom. */
    function greet(state, conn, msg) {
        if (msg.t !== 'create' && msg.t !== 'hello') return;
        const refuse = (code) => {
            conn.send({ t: 'error', code });
            conn.close();
        };
        if (msg.v !== PartyRoom.VERSION) return refuse('version');
        let r = rooms.get(msg.room);
        if (msg.t === 'create') {
            r = openRoom(msg.policy);
            conn.send({ t: 'created', room: r.id, secret: r.secret });
        } else if (!r) {
            return refuse('no-room');
        } else if (!msg.resume && !sameSecret(msg.secret, r.secret)) {
            return refuse('bad-secret');
        }
        // The room welcomes from inside join(), before the member id is ours,
        // so all it says meanwhile waits until the socket is linked. That
        // includes a resume: sent straight away, the welcome went to the old
        // socket, which is cut below — and with any lag it never got out.
        r.caught = [];
        const result = r.room.join({ name: msg.name, resume: msg.resume }, Date.now());
        const early = r.caught;
        r.caught = null;
        if (result.error) {
            early.forEach((one) => r.deliver(one.member, one.msg));
            return refuse(result.error);
        }

        // Resumed while the old socket still looked open: the new one wins.
        const old = r.links.get(result.member);
        if (old) old.sever();
        Object.assign(state, { room: r, member: result.member });
        r.links.set(result.member, conn);
        early.forEach((one) => r.deliver(one.member, one.msg));
        log(`${result.member} ${msg.resume ? 'resumed in' : 'joined'} ${r.id}`);
    }

    const server = http.createServer((req, res) => {
        res.writeHead(426, { 'content-type': 'text/plain' });
        res.end('bell bearer party dev server: connect with a WebSocket\n');
    });

    server.on('upgrade', (req, socket) => {
        const state = { room: null, member: null };
        const conn = DevSocket.accept(req, socket, faults, (msg) => {
            if (!state.member) return greet(state, conn, msg);
            state.room.room.handle(state.member, msg, Date.now());
            if (msg.t === 'bye') conn.close();
        }, () => {
            conns.delete(conn);
            // Hung up without a bye: still a member, away by silence, resumable.
            if (state.room && state.room.links.get(state.member) === conn) state.room.links.delete(state.member);
        });
        if (conn) conns.add(conn);
    });

    const ticker = setInterval(() => {
        const now = Date.now();
        for (const r of rooms.values()) {
            r.room.tick(now);
            if (r.room.members().length) {
                r.emptySince = null;
            } else if (r.emptySince === null) {
                r.emptySince = now;
            } else if (now - r.emptySince >= EMPTY_MS) {
                rooms.delete(r.id);
                log(`room ${r.id} closed`);
            }
        }
    }, TICK_MS);

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
            const bound = server.address().port;
            resolve({
                port: bound,
                url: `ws://localhost:${bound}`,
                rooms,
                /** Every socket dropped at once, as a network outage does it. */
                sever: () => [...conns].forEach((conn) => conn.sever()),
                close() {
                    clearInterval(ticker);
                    [...conns].forEach((conn) => conn.sever());
                    return new Promise((done) => server.close(done));
                },
            });
        });
    });
}

function options(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 2) {
        const name = argv[i].replace(/^--/, '');
        const value = Number(argv[i + 1]);
        if (!['port', 'lag', 'jitter', 'loss'].includes(name) || !Number.isFinite(value) || value < 0) {
            throw new Error(`usage: node tests/party-dev-server.js [--port 7070] [--lag ms] [--jitter ms] [--loss %]`);
        }
        out[name] = value;
    }
    return out;
}

module.exports = { TICK_MS, EMPTY_MS, startServer };

if (require.main === module) {
    const opts = options(process.argv.slice(2));
    startServer({ ...opts, log: (line) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`) }).then((server) => {
        const faults = [opts.lag && `lag ${opts.lag} ms`, opts.jitter && `jitter ±${opts.jitter} ms`, opts.loss && `loss ${opts.loss}%`].filter(Boolean);
        console.log(`party dev server on ${server.url}${faults.length ? ` (${faults.join(', ')})` : ''}`);
    }, (error) => {
        console.error(error.message);
        process.exit(1);
    });
}
