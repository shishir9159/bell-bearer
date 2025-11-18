/**
 * A chat's queue, drawn: the strip above the composer and the panel's Queue
 * tab, which are the same list in two places.
 *
 * Each row is the prompt's first line, when it goes, and what can be done to
 * it — edit, move up or down, remove; send a held one anyway; retry a failed
 * one. The strip also pauses and resumes the chat's queue as a whole.
 *
 * The markup and the one delegated handler are here; what the buttons change
 * is src/shared/prompt-queue.js, written through the `write` it is handed.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const ChatTree = ns.ChatTree || req('../shared/chat-tree.js');
    const PromptQueue = ns.PromptQueue || req('../shared/prompt-queue.js');

    const esc = (text) => Dom.escapeHtml(text);

    /** The items worth showing: everything not yet sent, and what failed. */
    const shown = (items) => items.filter((item) => item.status !== 'sent');

    /** "now", "at 7:42 PM", "tomorrow at 9:00 AM". */
    function whenText(item, now = Date.now()) {
        if (item.status === 'sending') return 'sending…';
        if (item.status === 'held') return 'held';
        if (item.status === 'failed') return 'failed';
        if (!item.notBefore || item.notBefore <= now) return 'next';
        const at = new Date(item.notBefore);
        const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const today = new Date(now);
        const days = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()) -
            new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5);
        if (days === 0) return `at ${time}`;
        if (days === 1) return `tomorrow at ${time}`;
        return `${at.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
    }

    const ICON = {
        up: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 14l6-6 6 6"/></svg>',
        down: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 10l6 6 6-6"/></svg>',
        edit: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
        remove: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>',
    };

    const act = (name, id, label, body = ICON[name]) =>
        `<button type="button" class="bb-chat-q-act" data-bb-q="${name}" data-bb-q-id="${Dom.escapeAttr(id)}" title="${esc(label)}" aria-label="${esc(label)}">${body}</button>`;

    function rowHtml(item, index, count, { editing, now }) {
        if (editing === item.id) {
            return `<li class="bb-chat-q-row is-editing">
                <textarea class="bb-input bb-chat-q-edit" data-bb-q-text="${Dom.escapeAttr(item.id)}" rows="3">${esc(item.text)}</textarea>
                <div class="bb-chat-q-edit-actions">
                    <button type="button" class="bb-btn" data-bb-q="cancel" data-bb-q-id="${Dom.escapeAttr(item.id)}">Cancel</button>
                    <button type="button" class="bb-btn bb-btn-primary" data-bb-q="save" data-bb-q-id="${Dom.escapeAttr(item.id)}">Save</button>
                </div></li>`;
        }
        const extra = item.status === 'held' ? act('release', item.id, 'Send it anyway', 'Send')
            : item.status === 'failed' ? act('retry', item.id, 'Try it again', 'Retry') : '';
        return `<li class="bb-chat-q-row is-${item.status}">
            <span class="bb-chat-q-when">${esc(whenText(item, now))}</span>
            <span class="bb-chat-q-text" title="${Dom.escapeAttr(item.text)}">${esc(ChatTree.firstLine(item.text, 90))}</span>
            ${item.note ? `<span class="bb-chat-q-note">${esc(item.note)}</span>` : ''}
            <span class="bb-chat-q-acts">${extra}
                ${index > 0 ? act('up', item.id, 'Move up') : ''}${index < count - 1 ? act('down', item.id, 'Move down') : ''}
                ${item.status === 'sending' ? '' : act('edit', item.id, 'Edit')}${item.status === 'sending' ? '' : act('remove', item.id, 'Remove')}
            </span></li>`;
    }

    /** The list, with a head saying how many and whether the queue is paused. */
    function listHtml(items, { paused = false, editing = null, now = Date.now(), head = true } = {}) {
        const rows = shown(items);
        if (!rows.length) return '';
        const title = `${rows.length} queued${paused ? ' · paused' : ''}`;
        const toggle = `<button type="button" class="bb-chat-q-pause" data-bb-q="${paused ? 'resume' : 'pause'}">${paused ? 'Resume' : 'Pause'}</button>`;
        return `${head ? `<div class="bb-chat-q-head"><span>${esc(title)}</span>${toggle}</div>` : ''}
            <ol class="bb-chat-q-list">${rows.map((item, index) => rowHtml(item, index, rows.length, { editing, now })).join('')}</ol>`;
    }

    /**
     * What a click on a list asks for, done through `write`. Returns the new
     * editing id, since editing is the one piece of state the caller keeps.
     */
    function onClick(event, { items, key, write, editing }) {
        const button = event.target.closest('[data-bb-q]');
        if (!button) return editing;
        const verb = button.dataset.bbQ;
        const id = button.dataset.bbQId;
        const rows = shown(items);
        const at = rows.findIndex((item) => item.id === id);
        switch (verb) {
            case 'edit': return id;
            case 'cancel': return null;
            case 'save': {
                const field = button.closest('li').querySelector('[data-bb-q-text]');
                const text = field ? field.value.trim() : '';
                if (text) write((state) => PromptQueue.patch(state, id, { text }));
                return null;
            }
            case 'remove': write((state) => PromptQueue.remove(state, id)); break;
            case 'up': write((state) => PromptQueue.move(state, id, rows[at - 1].id)); break;
            case 'down': write((state) => PromptQueue.move(state, rows[at + 1].id, id)); break;
            case 'release':
            case 'retry':
                write((state) => PromptQueue.pause(PromptQueue.patch(state, id, { status: 'waiting', note: '', notBefore: 0 }), key, false));
                break;
            case 'pause': write((state) => PromptQueue.pause(state, key, true)); break;
            case 'resume': write((state) => PromptQueue.pause(state, key, false)); break;
            default: break;
        }
        return editing;
    }

    const ChatQueueView = { listHtml, onClick, whenText, shown };

    root.BB = root.BB || {};
    root.BB.ChatQueueView = ChatQueueView;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatQueueView;
})(typeof globalThis !== 'undefined' ? globalThis : this);
