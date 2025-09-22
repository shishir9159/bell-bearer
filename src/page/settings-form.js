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

    function readControl(element) {
        if (element.type === 'checkbox') return element.checked;
        // A range's value is a string like a text input's, but what it stands
        // for is a number — stored as one, so that comparing it with what is
        // in storage does not come out unequal on every change.
        if (element.type === 'number' || element.type === 'range') {
            const value = Number(element.value);
            const min = element.min === '' ? -Infinity : Number(element.min);
            return Number.isFinite(value) ? Math.max(min, value) : Settings.DEFAULTS[element.id];
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

        Settings.get(wanted).then((values) => {
            for (const key of wanted) {
                const element = document.getElementById(key);
                if (!element) continue;

                writeControl(element, values[key]);

                const onChange = () => Settings.set({ [key]: readControl(element) });
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
            bound.forEach((off) => off());
            unwatch();
        };
    }

    const SettingsForm = { bindAll, readControl, writeControl };

    root.BB = root.BB || {};
    root.BB.SettingsForm = SettingsForm;
    if (typeof module !== 'undefined' && module.exports) module.exports = SettingsForm;
})(typeof globalThis !== 'undefined' ? globalThis : this);
