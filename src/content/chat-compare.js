/**
 * Two branches side by side: the answers to one prompt asked for twice, or
 * the answers to a prompt before and after it was edited.
 *
 * Picked by shift-clicking two turns in the panel's tree. A prompt picked
 * stands for its answer, since the answer is what differs; the prompts that
 * led to each are shown above them — once when it is the same prompt, and
 * diffed when the branches split at an edit, because then the edit is the
 * first thing to read.
 *
 * Side by side draws each answer whole, with what the other lacks marked; in
 * one column the two are interleaved, struck-through and underlined. Both are
 * drawn from one ChatDiff result, which rejoins exactly into either answer.
 * The text shown is the Markdown source rather than a rendering of it: a diff
 * is about the words, and a rendered table or code block would hide the one
 * character that changed.
 */
(function (root) {
    'use strict';

    const req = (path) => (typeof require === 'function' ? require(path) : null);
    const ns = root.BB || {};
    const Dom = ns.Dom || req('../shared/dom.js');
    const ChatTree = ns.ChatTree || req('../shared/chat-tree.js');
    const ChatDiff = ns.ChatDiff || req('../shared/chat-diff.js');
    const Overlay = ns.Overlay || req('./overlay.js');

    const OVERLAY_ID = 'bb-chat-compare';
    const esc = (text) => Dom.escapeHtml(text);

    /** The prompt and the answer a picked turn stands for. */
    function sides(conv, id) {
        const turn = ChatTree.node(conv, id);
        if (!turn) return null;
        if (turn.role === 'user') return { prompt: turn, answer: ChatTree.node(conv, newestChild(conv, turn)) };
        return { prompt: ChatTree.node(conv, turn.parent), answer: turn };
    }

    function newestChild(conv, turn) {
        const kids = turn.children.map((child) => ChatTree.node(conv, child)).filter(Boolean);
        return kids.length ? kids.reduce((best, kid) => (kid.at >= best.at ? kid : best)).id : null;
    }

    /** "2/3", or "A" and "B" when the two are not siblings at all. */
    function nameOf(conv, turn, fallback) {
        if (!turn) return fallback;
        const { index, count } = ChatTree.siblingIndex(conv, turn.id);
        return count > 1 ? `${index}/${count}` : fallback;
    }

    /** One side of a diff, with what only it has marked. */
    function sideHtml(ops, side) {
        const mark = side === 'a' ? '-' : '+';
        const tag = side === 'a' ? 'del' : 'ins';
        return ops.filter((piece) => piece.op === '=' || piece.op === mark)
            .map((piece) => (piece.op === '=' ? esc(piece.text) : `<${tag}>${esc(piece.text)}</${tag}>`)).join('');
    }

    function inlineHtml(ops) {
        return ops.map((piece) => {
            if (piece.op === '-') return `<del>${esc(piece.text)}</del>`;
            if (piece.op === '+') return `<ins>${esc(piece.text)}</ins>`;
            return esc(piece.text);
        }).join('');
    }

    const UNIT_NOTE = {
        word: '',
        line: 'The two differ too much to compare word by word, so this is line by line.',
        whole: 'The two have almost nothing in common, so each is shown whole.',
    };

    /** The comparison's markup, for `mode` 'side' or 'inline'. Pure. */
    function bodyHtml(conv, aId, bId, mode = 'side') {
        const a = sides(conv, aId);
        const b = sides(conv, bId);
        if (!a || !b) return '<p class="bb-muted">One of those turns is no longer in this chat.</p>';

        const nameA = nameOf(conv, a.answer || a.prompt, 'A');
        const nameB = nameOf(conv, b.answer || b.prompt, 'B');
        const samePrompt = a.prompt && b.prompt && a.prompt.id === b.prompt.id;
        const prompts = samePrompt
            ? `<div class="bb-chat-compare-prompt"><span class="bb-field-label">The prompt</span><div class="bb-chat-compare-text">${esc(a.prompt.text)}</div></div>`
            : `<div class="bb-chat-compare-prompt"><span class="bb-field-label">The prompts differ</span>
                   <div class="bb-chat-compare-text">${inlineHtml(ChatDiff.diff(a.prompt ? a.prompt.text : '', b.prompt ? b.prompt.text : ''))}</div></div>`;

        const { ops, unit } = ChatDiff.compare(a.answer ? a.answer.text : '', b.answer ? b.answer.text : '');
        const note = UNIT_NOTE[unit] ? `<p class="bb-chat-compare-note">${esc(UNIT_NOTE[unit])}</p>` : '';
        const model = (side) => (side.answer && side.answer.model ? ` · ${esc(side.answer.model)}` : '');

        const answers = mode === 'inline'
            ? `<div class="bb-chat-compare-cols is-inline"><div class="bb-chat-compare-col">
                   <span class="bb-field-label">${esc(nameA)} → ${esc(nameB)}</span>
                   <div class="bb-chat-compare-text">${inlineHtml(ops)}</div></div></div>`
            : `<div class="bb-chat-compare-cols">
                   <div class="bb-chat-compare-col"><span class="bb-field-label">${esc(nameA)}${model(a)}</span>
                       <div class="bb-chat-compare-text">${sideHtml(ops, 'a')}</div></div>
                   <div class="bb-chat-compare-col"><span class="bb-field-label">${esc(nameB)}${model(b)}</span>
                       <div class="bb-chat-compare-text">${sideHtml(ops, 'b')}</div></div>
               </div>`;
        return `${prompts}${note}${answers}`;
    }

    /** Open the comparison over the page. */
    function open({ conv, a, b, appearance, dress }) {
        let mode = 'side';
        const dialog = Overlay.open({
            id: OVERLAY_ID,
            contentHtml: `
                <div class="bb-panel bb-chat-compare-panel" data-bb-keep-panel="1">
                    <div class="bb-panel-head">
                        <h3>Compare two branches</h3>
                        <div class="bb-chat-compare-modes" role="group" aria-label="Layout">
                            <button type="button" class="bb-btn" data-bb-compare-mode="side">Side by side</button>
                            <button type="button" class="bb-btn" data-bb-compare-mode="inline">One column</button>
                        </div>
                        <button type="button" class="bb-close" data-bb-close="1" aria-label="Close">×</button>
                    </div>
                    <div class="bb-panel-body bb-chat-compare-body"></div>
                </div>`,
        });
        if (!dialog) return null;
        dialog.element.classList.add('bb-modal-top');
        dialog.element.setAttribute('data-bb-keep-panel', '1');
        appearance().then((look) => { if (dialog.element.isConnected) dress(dialog.element, look); });

        const draw = () => {
            dialog.element.querySelector('.bb-chat-compare-body').innerHTML = bodyHtml(conv, a, b, mode);
            dialog.element.querySelectorAll('[data-bb-compare-mode]').forEach((button) => {
                const on = button.dataset.bbCompareMode === mode;
                button.classList.toggle('bb-btn-primary', on);
                button.setAttribute('aria-pressed', String(on));
            });
        };
        dialog.element.querySelector('.bb-chat-compare-modes').addEventListener('click', (event) => {
            const button = event.target.closest('[data-bb-compare-mode]');
            if (!button) return;
            mode = button.dataset.bbCompareMode;
            draw();
        });
        draw();
        return dialog;
    }

    const ChatCompare = { open, bodyHtml, sides, OVERLAY_ID };

    root.BB = root.BB || {};
    root.BB.ChatCompare = ChatCompare;
    if (typeof module !== 'undefined' && module.exports) module.exports = ChatCompare;
})(typeof globalThis !== 'undefined' ? globalThis : this);
