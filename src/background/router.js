/**
 * One listener each for what the worker hears — messages, alarms, a browser
 * start — handing every event to whichever part registered for it by name.
 *
 * Six parts used to add their own runtime.onMessage listener, in three
 * conventions (a switch that returns true, a handler table, an action list),
 * so every message ran through all six; four added an onAlarm listener that
 * filtered by name. A part now says what it answers:
 *
 *     Router.on('skimSearch', async (message, sender) => result);
 *     Router.alarm('bb-activity', (alarm) => …);
 *     Router.started(() => …);   // onStartup and onInstalled alike
 *
 * A handler may answer with a value or a promise; a throw or a rejection is
 * answered `{ ok: false, error }`, and an action nobody registered is left
 * for another listener (the offscreen session keeps its own, keyed on `to`).
 *
 * The listeners are added here, as this file loads, because a worker's
 * listeners must be registered synchronously at top level — so this is loaded
 * before every part that registers with it.
 */
(function (root) {
    'use strict';

    const handlers = new Map();
    const alarms = new Map();
    const starts = [];

    const on = (action, handler) => { handlers.set(action, handler); };
    const alarm = (name, handler) => { alarms.set(name, handler); };
    const started = (handler) => { starts.push(handler); };

    const failure = (error) => ({ ok: false, error: String((error && error.message) || error) });

    /** The answer to `message`, or undefined when no part answers it. */
    function dispatch(message, sender) {
        const handler = message && handlers.get(message.action);
        if (!handler) return undefined;
        return Promise.resolve().then(() => handler(message, sender)).catch(failure);
    }

    function install(api) {
        if (!api || !api.runtime) return;
        if (api.runtime.onMessage) {
            api.runtime.onMessage.addListener((message, sender, respond) => {
                const answer = dispatch(message, sender);
                if (!answer) return false;
                answer.then((value) => {
                    try { respond(value); } catch (_) { /* the page went away mid-flight */ }
                });
                return true; // answered asynchronously, so the channel stays open
            });
        }
        if (api.alarms && api.alarms.onAlarm) {
            api.alarms.onAlarm.addListener((fired) => {
                const handler = fired && alarms.get(fired.name);
                if (handler) handler(fired);
            });
        }
        const start = () => {
            for (const handler of starts) {
                try { handler(); } catch (error) { console.error('Bell Bearer: a start handler failed', error); }
            }
        };
        if (api.runtime.onStartup) api.runtime.onStartup.addListener(start);
        if (api.runtime.onInstalled) api.runtime.onInstalled.addListener(start);
    }

    install(root.chrome);

    const Router = { on, alarm, started, dispatch };

    root.BB = root.BB || {};
    root.BB.Router = Router;
    if (typeof module !== 'undefined' && module.exports) module.exports = Router;
})(typeof globalThis !== 'undefined' ? globalThis : this);
