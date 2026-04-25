/**
 * Binds the settings form to storage.
 *
 * The dashboard used to spell out every control twice — once to load its value,
 * once to save it — about sixty lines of copy-pasted null checks, where adding a
 * setting meant remembering both halves. A control is now bound by giving its
 * element the same id as the setting key.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Settings = ns.Settings || req('../shared/settings.js');

    /** A bound from the control's attribute, or none where it has none. */
    const limit = (text, none) => (text === '' || !Number.isFinite(Number(text)) ? none : Number(text));

    function readControl(element) {
        if (element.type === 'checkbox') return element.checked;
        // A range's value is a string like a text input's, but what it stands
        // for is a number — stored as one, so that comparing it with what is
        // in storage does not come out unequal on every change. Held to the
        // field's max as well as its min: a typed 9999 went into storage as
        // 9999 days for a field that says it stops at 365.
        if (element.type === 'number' || element.type === 'range') {
            const value = Number(element.value);
            if (element.value === '' || !Number.isFinite(value)) return Settings.DEFAULTS[element.id];
            return Math.min(limit(element.max, Infinity), Math.max(limit(element.min, -Infinity), value));
        }
        return element.value;
    }

    function writeControl(element, value) {
        if (element.type === 'checkbox') element.checked = value === true;
        else element.value = value;
    }

    /**
     * Bind every setting in Settings.DEFAULTS that has a matching element id.
     * Returns a teardown function.
     */
    function bindAll({ keys } = {}) {
        const wanted = keys || Settings.KEYS;
        const bound = [];
        let disposed = false;

        Settings.get(wanted).then((values) => {
            // Torn down while the read was out: binding now would leave
            // listeners nothing will ever take off again.
            if (disposed) return;
            for (const key of wanted) {
                const element = document.getElementById(key);
                if (!element) continue;

                writeControl(element, values[key]);

                const onChange = () => {
                    const value = readControl(element);
                    // What was stored, shown: a number held to its bounds, or
                    // a field left empty, put back as the value that is kept.
                    if (element.type !== 'checkbox' && String(value) !== element.value) writeControl(element, value);
                    Settings.set({ [key]: value });
                };
                element.addEventListener('change', onChange);
                bound.push(() => element.removeEventListener('change', onChange));
            }
        });

        // Reflect changes made elsewhere (the popup, another dashboard tab).
        const unwatch = Settings.watch(wanted, (changed) => {
            for (const [key, value] of Object.entries(changed)) {
                const element = document.getElementById(key);
                if (element && readControl(element) !== value) writeControl(element, value);
            }
        });

        return () => {
            disposed = true;
            bound.forEach((off) => off());
            unwatch();
        };
    }

    const SettingsForm = { bindAll, readControl, writeControl };

    root.BB = root.BB || {};
    root.BB.SettingsForm = SettingsForm;
    if (typeof module !== 'undefined' && module.exports) module.exports = SettingsForm;
})(typeof globalThis !== 'undefined' ? globalThis : this);
