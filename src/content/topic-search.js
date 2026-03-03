/**
 * A topic page on github.com searched for several topics at once: a box under
 * the page's Language and Sort menus that starts with the page's own topic and
 * takes more — and any of the search's filters, `stars:>500` or
 * `pushed:>2026-06-01` — then searches for what has every one of them.
 *
 * The page's markup is the adapter's (src/content/github-read.js); the box is
 * GitHub's own form-control holding its own topic tags, so it sits under the
 * page's menus as if the page had drawn it.
 */
(function (root) {
    'use strict';

    const { ForgeSites, Dom } = root.BB;

    const esc = Dom.escapeHtml;

    const BOX_ID = 'bb-topic-search';
    const SORTS = [['stars', 'Most stars'], ['forks', 'Most forks'], ['updated', 'Recently updated'], ['', 'Best match']];

    /** github.com's own octicon, as its pages draw it. */
    const X_ICON = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon octicon-x"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg>';

    /** GitHub's own search for repositories, sorted as the box asks; a blank sort is its best match. */
    function searchUrl(query, sort) {
        const params = new URLSearchParams({ q: query, type: 'repositories' });
        if (sort) {
            params.set('s', sort);
            params.set('o', 'desc');
        }
        return `/search?${params}`;
    }

    function createTopicSearch({ adapter, watcher, getSettings, win = root, doc = root.document }) {
        const topics = adapter.topics;

        const enabled = () => getSettings()[ForgeSites.siteKey(adapter.site, 'topicSearch')] === true;

        /** The box for one topic page; what was typed into it goes with it when the page moves on. */
        function build(topic) {
            const box = doc.createElement('div');
            box.id = BOX_ID;
            box.className = 'bb-topic-search';
            box.dataset.topic = topic;
            box.innerHTML = `<form class="bb-topic-form" role="search" aria-label="Repositories with every one of these topics">
    <div class="form-control bb-topic-field"><span class="topic-tag f6" title="This page's topic">${esc(topic)}</span><span class="bb-topic-terms"></span>
      <input type="text" class="bb-topic-input" autocomplete="off" spellcheck="false" aria-label="Add a topic, or a filter such as stars:>500"
             placeholder="Add a topic, or stars:>500 pushed:>2026-06-01"></div>
    <select class="form-select select-sm bb-topic-sort" aria-label="Sort">${SORTS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
    <button type="submit" class="btn btn-sm btn-primary">Search</button>
  </form>`;
            const $ = (selector) => box.querySelector(selector);
            const input = $('.bb-topic-input');
            const sort = $('.bb-topic-sort');
            /** Each topic and filter added, in the order it was: `{ topic }` or `{ filter }`. */
            let terms = [];

            function drawTerms() {
                $('.bb-topic-terms').innerHTML = terms.map((term, i) => {
                    const word = term.topic || term.filter;
                    return `<span class="topic-tag f6 ${term.filter ? 'bb-topic-filter' : ''}">${esc(word)}<button type="button" class="bb-topic-remove" data-index="${i}" aria-label="Remove ${esc(word)}">${X_ICON}</button></span>`;
                }).join('');
                // The example is for an empty box; beside the tags it only wraps.
                input.placeholder = terms.length ? 'Add a topic or a filter' : 'Add a topic, or stars:>500 pushed:>2026-06-01';
            }

            /** Whatever is typed, as terms; a word that is neither a topic nor a filter stays in the box. */
            function take() {
                const left = [];
                for (const word of input.value.split(/[\s,]+/).filter(Boolean)) {
                    const term = topics.term(word);
                    if (!term || term.topic === topic) {
                        if (!term) left.push(word);
                        continue;
                    }
                    if (!terms.some((one) => (one.topic || one.filter) === (term.topic || term.filter))) terms.push(term);
                }
                input.value = left.join(' ');
                drawTerms();
            }

            const search = () => ({
                topics: [topic, ...terms.filter((term) => term.topic).map((term) => term.topic)],
                filters: terms.filter((term) => term.filter).map((term) => term.filter),
                sort: sort.value,
            });

            $('.bb-topic-form').addEventListener('submit', (event) => {
                event.preventDefault();
                take();
                if (!terms.length) return;
                const asked = search();
                win.location.assign(searchUrl(topics.query(asked), asked.sort));
            });
            input.addEventListener('keydown', (event) => {
                if ((event.key === ' ' || event.key === ',') && input.value.trim()) {
                    event.preventDefault();
                    take();
                } else if (event.key === 'Backspace' && !input.value && terms.length) {
                    terms.pop();
                    drawTerms();
                }
            });
            $('.bb-topic-field').addEventListener('click', (event) => {
                const remove = event.target.closest('.bb-topic-remove');
                if (!remove) {
                    input.focus();
                    return;
                }
                terms.splice(Number(remove.dataset.index), 1);
                drawTerms();
            });
            return box;
        }

        /** Put in under the page's own menus, kept in on its redraws, and taken out once off or elsewhere. */
        function place() {
            const topic = enabled() ? topics.at(win.location.pathname) : null;
            const placed = doc.getElementById(BOX_ID);
            if (placed && placed.dataset.topic !== topic) placed.remove();
            if (!topic || doc.getElementById(BOX_ID)) return false;
            const column = topics.column(doc);
            if (!column) return false;
            const anchor = topics.anchor(column);
            const box = build(topic);
            if (anchor) anchor.after(box);
            else column.prepend(box);
            return false;
        }

        function onNavigate() {
            watcher.add('topic-search', place);
        }

        return { install: onNavigate, onNavigate, refreshSurfaces: onNavigate };
    }

    const TopicSearch = { BOX_ID, searchUrl, createTopicSearch };

    root.BB.TopicSearch = TopicSearch;
    if (typeof module !== 'undefined' && module.exports) module.exports = TopicSearch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
