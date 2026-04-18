/**
 * The locks every store step holds on its keys, kept here because the worker
 * is the one place every page of the extension can reach — see the header of
 * src/shared/store.js for why a chain in each page was not enough.
 *
 * A page asks over a port and holds the lock until it lets go of the port, so
 * a tab closed in the middle of a step, or a content script whose extension
 * was reloaded, cannot keep a lock: its port goes with it. A holder that is
 * still there but stuck is let go of after LEASE_MS, because one wedged page
 * holding the checkpoints would otherwise stop every other page saving them.
 *
 * Requests are granted in the order they came, each once none of its names
 * is held. A request is not let past an earlier one waiting on a name they
 * share, or a steady stream of short steps on one key could hold back a step
 * on two keys for good.
 *
 * The worker being stopped drops every lock, which is fine: every port to it
 * is closed with it, and each page then goes ahead as it would with no worker.
 */
(function (root) {
    'use strict';

    const { Store } = root.BB;

    const LEASE_MS = 10000;

    function createLocks({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        const held = new Map();
        const waiting = [];

        const overlaps = (a, b) => a.names.some((name) => b.names.includes(name));

        function pump() {
            for (let at = 0; at < waiting.length;) {
                const request = waiting[at];
                if (request.names.some((name) => held.has(name)) || waiting.slice(0, at).some((one) => overlaps(one, request))) {
                    at++;
                    continue;
                }
                waiting.splice(at, 1);
                for (const name of request.names) held.set(name, request);
                request.lease = setTimer(() => release(request), LEASE_MS);
                request.grant();
            }
        }

        function release(request) {
            clearTimer(request.lease);
            let freed = false;
            for (const name of request.names) {
                if (held.get(name) === request) {
                    held.delete(name);
                    freed = true;
                }
            }
            const at = waiting.indexOf(request);
            if (at >= 0) {
                waiting.splice(at, 1);
                freed = true;
            }
            if (freed) pump();
        }

        /** Queued, not yet granted: the caller holds the request before pump() can hand it the lock. */
        const request = (names) => ({ names: [...new Set([].concat(names).map(String))], grant: () => {}, lease: 0 });

        /** The worker's own steps: resolves to the function that lets go. */
        const acquire = (names) => new Promise((resolve) => {
            const one = request(names);
            one.grant = () => resolve(() => release(one));
            waiting.push(one);
            pump();
        });

        /** A page's port. Its first message names the keys; letting go of the port lets go of them. */
        function connect(port) {
            if (!port || port.name !== Store.LOCK_PORT) return;
            let one = null;
            port.onMessage.addListener((msg) => {
                if (one || !msg || !Array.isArray(msg.names)) return;
                const mine = request(msg.names);
                mine.grant = () => {
                    try { port.postMessage({ granted: true }); } catch (_) { release(mine); }
                };
                one = mine;
                waiting.push(mine);
                pump();
            });
            port.onDisconnect.addListener(() => { if (one) release(one); });
        }

        return { acquire, connect, holding: () => [...held.keys()], queued: () => waiting.length };
    }

    const StoreLocks = { LEASE_MS, createLocks, here: null };

    const api = root.chrome;
    if (api && api.runtime && api.runtime.onConnect) {
        StoreLocks.here = createLocks();
        api.runtime.onConnect.addListener(StoreLocks.here.connect);
    }

    root.BB.StoreLocks = StoreLocks;
    if (typeof module !== 'undefined' && module.exports) module.exports = StoreLocks;
})(typeof globalThis !== 'undefined' ? globalThis : this);
