/**
 * Typing into a chat site's prompt box, and pressing its send button — the
 * only way anything of ours is ever sent. Nothing here makes a request: the
 * sites' send endpoints want anti-bot tokens only their own page mints, and
 * a prompt that arrived any other way is one the site is built to refuse.
 *
 * Both sites' composers are ProseMirror, and ProseMirror is told about text
 * the way a person gives it text: a paste. A synthetic `paste` carrying a
 * DataTransfer is handled like a real one, newlines become paragraphs, and
 * the editor's own state — the thing its send button reads — is updated.
 * (Checked on chatgpt.com: two lines pasted, two paragraphs, send enabled.)
 * execCommand('insertText') is the fallback, with insertParagraph between
 * lines because it does not reliably turn a newline into one. A plain
 * <textarea> gets the native value setter and an `input` event, so a React
 * page sees the change. Whatever was used, the box is read back; if the text
 * is not there, it goes on the clipboard and the caller says "paste it".
 *
 * submit() clicks the send button, and only an enabled one. Never a
 * synthetic Enter: that is an untrusted event, and a different code path on
 * each site.
 */
(function (root) {
    'use strict';

    const flat = (text) => String(text || '').replace(/\s+/g, ' ').trim();

    const isField = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');

    /** What is in the box, a line per paragraph. */
    function read(el) {
        if (!el) return '';
        if (isField(el)) return el.value;
        return String(el.innerText != null ? el.innerText : el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    }

    const isEmpty = (el) => !flat(isField(el) ? (el && el.value) : (el && el.textContent));

    /** The caret at the very end of the box, so an insert appends. */
    function caretToEnd(el) {
        el.focus();
        const selection = window.getSelection && window.getSelection();
        if (!selection) return;
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function setField(el, text) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function paste(el, text) {
        const data = new DataTransfer();
        data.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }

    function typeLines(el, text) {
        String(text).split('\n').forEach((line, index) => {
            if (index) document.execCommand('insertParagraph');
            if (line) document.execCommand('insertText', false, line);
        });
    }

    /**
     * Put `text` at the end of the box. Resolves true once it is read back
     * there; false when it went on the clipboard instead.
     */
    async function insert(el, text, { copy } = {}) {
        if (!el || !text) return false;
        const landed = () => flat(read(el)).includes(flat(text));

        if (isField(el)) {
            setField(el, el.value ? `${el.value}\n${text}` : text);
            if (landed()) return true;
        } else {
            caretToEnd(el);
            paste(el, text);
            if (landed()) return true;
            caretToEnd(el);
            try { typeLines(el, text); } catch (_) { /* no execCommand here */ }
            if (landed()) return true;
        }

        const put = copy || ((value) => navigator.clipboard.writeText(value).then(() => true, () => false));
        await put(text);
        return false;
    }

    /** Empty the box the way a person would: select all of it and delete. */
    function clear(el) {
        if (!el) return;
        if (isField(el)) { setField(el, ''); return; }
        caretToEnd(el);
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('delete');
    }

    /** Press send — only if there is an enabled one to press. */
    function submit(button) {
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
        button.click();
        return true;
    }

    const Composer = { insert, read, isEmpty, clear, submit };

    root.BB = root.BB || {};
    root.BB.Composer = Composer;
    if (typeof module !== 'undefined' && module.exports) module.exports = Composer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
