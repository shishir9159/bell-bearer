#!/usr/bin/env node
/**
 * Holds a party server to the cases in party-vectors.json: the same cases
 * node-check runs against src/shared/party-room.js, replayed over real
 * WebSockets against whatever answers at the address given.
 *
 *     node tests/party-conformance.js ws://localhost:7070 [--slack ms] [--only text]
 *
 * No dependencies: Node's global WebSocket (Node 22+) and the README's protocol.
 *
 * A server's clock cannot be injected, so the replay runs in real time — a
 * step `at` 15000 is sent fifteen seconds in — counted from the first
 * welcome's `now`. Expected times (`at`, `s`, `s2`, `since`) and `pos` match
 * within `--slack`. A `tick` sends nothing and allows the server's own
 * once-a-second timeouts a second more. Each case has its own room.
 *
 * Run it against a server without faults: jitter reorders clicks and loss
 * drops what a case waits for. Lag alone passes.
 */
'use strict';

const Vectors = require('./party-vectors.json');

const VERSION = 1;
const SLACK_MS = 300;
const TICK_MS = 1000;
/** How long after its last step a case keeps listening. */
const SETTLE_MS = 1500;
const JOIN_TIMEOUT_MS = 5000;
const TIME_FIELDS = new Set(['at', 's', 's2', 'since']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** "@a" becomes alias a's member id, wherever it appears. */
function withIds(value, ids) {
    if (typeof value === 'string' && value.startsWith('@')) return ids[value.slice(1)] || value;
    if (Array.isArray(value)) return value.map((one) => withIds(one, ids));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, one]) => [key, withIds(one, ids)]));
    return value;
}

/** node-check's matcher, with room times and positions allowed their slack. */
function matches(got, want, slack, key) {
    if (Array.isArray(want)) return Array.isArray(got) && got.length === want.length && want.every((one, i) => matches(got[i], one, slack));
    if (want && typeof want === 'object') return !!got && typeof got === 'object' && Object.keys(want).every((k) => matches(got[k], want[k], slack, k));
    if (typeof want === 'number' && typeof got === 'number') {
        if (TIME_FIELDS.has(key)) return Math.abs(got - (slack.start + want)) <= slack.ms;
        if (key === 'pos') return Math.abs(got - want) <= slack.ms / 1000;
    }
    return got === want;
}

/** A socket whose messages land in `inbox`; resolves once it is open. */
function dial(url, inbox) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.onmessage = (event) => {
            try { inbox.push(JSON.parse(event.data)); } catch (_) { /* not ours to judge here */ }
        };
        ws.onopen = () => resolve(ws);
        ws.onerror = () => reject(new Error(`could not connect to ${url}`));
    });
}

async function waitFor(inbox, from, test) {
    const until = Date.now() + JOIN_TIMEOUT_MS;
    while (Date.now() < until) {
        const found = inbox.slice(from).find(test);
        if (found) return found;
        await sleep(10);
    }
    return null;
}

async function runCase(url, vector, slackMs) {
    const ids = {};
    const resumes = {};
    const inboxes = {};
    const sockets = {};
    const opened = [];
    let room = null;
    let secret = null;
    let startLocal = null;
    let startRoom = null;

    try {
        for (const step of vector.steps) {
            if (startLocal === null) startLocal = Date.now();
            await sleep(startLocal + step.at - Date.now());

            if (step.join) {
                const alias = step.join;
                const inbox = (inboxes[alias] = inboxes[alias] || []);
                const from = inbox.length;
                const ws = await dial(url, inbox);
                opened.push(ws);
                sockets[alias] = ws;
                let hello;
                if (!room) hello = { t: 'create', v: VERSION, name: step.name, policy: vector.policy || {} };
                else if (step.resume) hello = { t: 'hello', v: VERSION, room, resume: resumes[step.resume] || step.resume };
                else hello = { t: 'hello', v: VERSION, room, secret, name: step.name };
                ws.send(JSON.stringify(hello));
                const answer = await waitFor(inbox, from, (msg) => msg.t === 'welcome' || msg.t === 'error');
                if (!answer) throw new Error(`${alias} was never welcomed or refused`);
                if (answer.t === 'welcome') {
                    ids[alias] = answer.you;
                    resumes[alias] = answer.resume;
                    if (!room) {
                        const created = inbox.find((msg) => msg.t === 'created');
                        if (!created) throw new Error('create was not answered with created');
                        ({ room, secret } = created);
                        startRoom = answer.now - step.at;
                    }
                }
            } else if (step.from) {
                const msg = withIds(step.msg, ids);
                if (msg.t === 'intent' && Number.isFinite(msg.at)) msg.at = startRoom + msg.at;
                sockets[step.from].send(JSON.stringify(msg));
            }
        }
        await sleep(SETTLE_MS + (vector.steps.some((step) => step.tick) ? TICK_MS : 0));
    } finally {
        for (const ws of opened) ws.close();
    }

    const slack = { start: startRoom, ms: slackMs + (vector.steps.some((step) => step.tick) ? TICK_MS : 0) };
    const next = {};
    for (const { to, msg } of vector.expect || []) {
        const want = withIds(msg, ids);
        const got = inboxes[to] || [];
        const found = got.findIndex((one, i) => i >= (next[to] || 0) && matches(one, want, slack));
        if (found < 0) throw new Error(`${to} was never sent ${JSON.stringify(want)} (in order)`);
        next[to] = found + 1;
    }
    for (const { to, msg } of vector.absent || []) {
        const want = withIds(msg, ids);
        if ((inboxes[to] || []).some((one) => matches(one, want, slack))) throw new Error(`${to} was sent ${JSON.stringify(want)}`);
    }
}

/** Every case, side by side. Resolves to [{name, error}], error null for a pass. */
async function run(url, { slack = SLACK_MS, only = '' } = {}) {
    const cases = Vectors.cases.filter((vector) => vector.name.includes(only));
    return Promise.all(cases.map(async (vector) => {
        try {
            await runCase(url, vector, slack);
            return { name: vector.name, error: null };
        } catch (error) {
            return { name: vector.name, error: error.message };
        }
    }));
}

module.exports = { SLACK_MS, matches, run };

if (require.main === module) {
    const [url, ...rest] = process.argv.slice(2);
    const flag = (name) => {
        const at = rest.indexOf(`--${name}`);
        return at < 0 ? undefined : rest[at + 1];
    };
    if (!/^wss?:\/\//.test(url || '') || typeof WebSocket !== 'function') {
        console.error('usage: node tests/party-conformance.js ws://host:port [--slack ms] [--only text]   (Node 22+)');
        process.exit(2);
    }
    const slack = flag('slack') === undefined ? SLACK_MS : Number(flag('slack'));
    console.log(`party conformance against ${url}, vectors v${Vectors.version}, slack ${slack} ms`);
    run(url, { slack, only: flag('only') || '' }).then((results) => {
        for (const { name, error } of results) {
            console.log(`  ${error ? 'FAIL' : 'ok  '}  ${name}`);
            if (error) console.log(`        ${error}`);
        }
        const failed = results.filter((one) => one.error).length;
        console.log(`${results.length - failed}/${results.length} passed`);
        process.exit(failed ? 1 : 0);
    });
}
