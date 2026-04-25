/**
 * The extension pages' dialogs to a keyboard and a screen reader: named, Tab
 * kept inside, the page behind out of reach, and focus handed back.
 */
(function () {
    'use strict';

    const Ui = () => window.BB.Ui;
    const press = (key, shiftKey = false) => document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    const dialogs = () => Array.from(document.querySelectorAll('.import-modal[role="dialog"]'));
    const label = (dialog, attribute) => document.getElementById(dialog.getAttribute(attribute)).textContent;

    /** A button on the page that has focus when the dialog opens. */
    function opener() {
        const button = document.createElement('button');
        button.textContent = 'Delete everything';
        document.body.appendChild(button);
        button.focus();
        return button;
    }

    function tidy(button) {
        button.remove();
        dialogs().forEach((dialog) => dialog.remove());
    }

    suite('dialogs — named, kept to themselves, and handing focus back', () => {
        test('a confirm is named by its title, keeps Tab inside, shuts the page out, and gives focus back', async () => {
            const behind = opener();
            try {
                const answer = Ui().confirmDialog({ title: 'Delete it?', message: 'It cannot be undone.', confirmLabel: 'Delete', danger: true });
                const [dialog] = dialogs();
                assertEqual(label(dialog, 'aria-labelledby'), 'Delete it?');
                assertEqual(label(dialog, 'aria-describedby'), 'It cannot be undone.');
                assertEqual(document.activeElement.textContent, 'Cancel', 'a dangerous confirm starts anywhere but Cancel');
                const seen = [];
                for (const shift of [false, false, true, true]) {
                    press('Tab', shift);
                    seen.push(document.activeElement.textContent);
                }
                assertDeepEqual(seen, ['Delete', 'Cancel', 'Delete', 'Cancel'], 'Tab walked out of the dialog');
                assertEqual(behind.inert, true, 'the page behind could still be clicked and read');
                press('Escape');
                assertEqual(await answer, false);
                assertEqual(document.activeElement, behind, 'focus did not go back to what had it');
                assertEqual(behind.inert, false, 'the page was left shut out');
            } finally {
                tidy(behind);
            }
        });

        test('a dialog over another answers Escape alone, and the one under it comes back to life', async () => {
            const behind = opener();
            try {
                const first = Ui().confirmDialog({ title: 'First?', message: 'Under.' });
                const second = Ui().promptDialog({ title: 'Second?', label: 'Name' });
                assertEqual(document.activeElement.id, 'bb-prompt-input');
                assertEqual(dialogs()[0].inert, true, 'the first dialog took keys while the second was open');
                press('Escape');
                assertEqual(await second, null);
                assertEqual(dialogs().length, 1, 'Escape closed both');
                assertEqual(dialogs()[0].inert, false);
                press('Escape');
                assertEqual(await first, false);
                assertEqual(document.activeElement, behind);
            } finally {
                tidy(behind);
            }
        });
    });
})();
