/**
 * A topic page on github.com searched for several topics at once: a box under
 * the page's Language and Sort menus that starts with the page's own topic and
 * takes more — and any of the search's filters, `stars:>500` or
 * `pushed:>2026-06-01` — then shows what has every topic in the page's own
 * cards, in place of the page's list. Clear gives that list back untouched; it
 * was only hidden.
 *
 * The filters and the sort are kept for the next topic page, since "only the
 * active ones" is a standing wish; the topics are each page's own. They are
 * put back in the box, not searched: a topic page that searched by itself
 * would spend one of ten searches a minute on every visit.
 *
 * The request and the page's markup are the adapter's (src/content/github-read.js);
 * the cards copy github.com's own, so they sit in its list as its own do.
 */
(function (root) {
    'use strict';

    const { ForgeSites, Dom, Settings, Icons } = root.BB;

    const esc = Dom.escapeHtml;

    const BOX_ID = 'bb-topic-search';
    /** On the page's column while a search is shown: everything of the page's own in it is hidden. */
    const SEARCHING = 'bb-topic-searching';
    const SORTS = [['stars', 'Most stars'], ['forks', 'Most forks'], ['updated', 'Recently updated'], ['', 'Best match']];

    /** Linguist's colours for the languages most repositories are in; any other goes without its dot. */
    const LANGUAGE_COLORS = {
        Go: '#00ADD8', Python: '#3572A5', JavaScript: '#f1e05a', TypeScript: '#3178c6', Java: '#b07219', Rust: '#dea584',
        'C++': '#f34b7d', C: '#555555', 'C#': '#178600', Shell: '#89e051', HTML: '#e34c26', Ruby: '#701516', PHP: '#4F5D95',
        Kotlin: '#A97BFF', Swift: '#F05138', HCL: '#844FBA', Dockerfile: '#384d54', 'Jupyter Notebook': '#DA5B0B',
    };

    /**
     * The card's glyphs, classed the way github.com classes its own octicons
     * so that its stylesheet sizes and places them as it does the rest.
     */
    const REPO_ICON = Icons.svg('book-bookmark', { cls: 'octicon octicon-repo color-fg-muted mr-2' });
    const STAR_ICON = Icons.svg('star', { cls: 'octicon octicon-star v-align-text-bottom mr-1' });
    const X_ICON = Icons.svg('x', { cls: 'octicon octicon-x' });

    const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
    const day = (iso) => {
        const at = new Date(iso);
        return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    /** "go, kubernetes and cloud-native". */
    const listed = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

    /** One repository as the topic page draws its own: name, stars, description, topics, when it moved and its language. */
    function cardHtml(repo) {
        const [owner, name] = repo.repo.split('/');
        const href = `/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
        const color = LANGUAGE_COLORS[repo.language];
        return `<article class="border rounded color-shadow-small color-bg-subtle my-4 tmp-my-4">
  <div class="px-3 tmp-px-3"><div class="d-flex flex-justify-between flex-items-start flex-wrap gap-2 my-3 tmp-my-3">
    <div class="d-flex flex-1"><span style="margin-top:2px">${REPO_ICON}</span>
      <h3 class="f3 color-fg-muted text-normal lh-condensed">
        <a data-turbo="false" href="/${esc(encodeURIComponent(owner))}" class="Link">${esc(owner)}</a> /
        <a data-turbo="false" href="${esc(href)}" class="Link text-bold wb-break-word">${esc(name)}</a></h3>
      ${repo.archived ? '<span class="Label Label--attention ml-2">Archived</span>' : ''}</div>
    <a data-turbo="false" href="${esc(href)}/stargazers" class="btn-sm btn color-bg-default" title="${esc(repo.stars.toLocaleString('en-US'))} stars">${STAR_ICON}${esc(compact.format(repo.stars).toLowerCase())}</a>
  </div></div>
  <div class="color-bg-default rounded-bottom-2 border-top color-border-muted">
    ${repo.description ? `<div class="px-3 pt-3 tmp-px-3 tmp-pt-3"><p class="color-fg-muted mb-0">${esc(repo.description)}</p></div>` : ''}
    ${repo.topics.length ? `<div class="d-flex flex-wrap border-bottom color-border-muted px-3 pt-2 pb-2 tmp-px-3">${repo.topics.map((topic) =>
        `<a title="Topic: ${esc(topic)}" href="/topics/${esc(encodeURIComponent(topic))}" class="topic-tag topic-tag-link Link f6 mb-2">${esc(topic)}</a>`).join('')}</div>` : ''}
    <div class="p-3 tmp-p-3"><ul class="d-flex f6 list-style-none color-fg-muted">
      ${repo.pushed ? `<li class="mr-4 tmp-mr-4">Updated <span class="no-wrap">${esc(day(repo.pushed))}</span></li>` : ''}
      ${repo.language ? `<li class="mr-4 tmp-mr-4">${color ? `<span class="repo-language-color" style="background-color: ${color}"></span> ` : ''}<span>${esc(repo.language)}</span></li>` : ''}
    </ul></div>
  </div>
</article>`;
    }

    /** Where the filters and sort are kept between topic pages; reading or writing them never throws into the page. */
    const STORE = {
        async load() {
            try {
                const stored = (await chrome.storage.local.get(Settings.DATA.topicSearch))[Settings.DATA.topicSearch];
                return stored && Array.isArray(stored.filters) ? stored : null;
            } catch (_) {
                return null;
            }
        },
        save(kept) {
            try { chrome.storage.local.set({ [Settings.DATA.topicSearch]: kept }).catch(() => {}); } catch (_) { /* the extension went away */ }
        },
    };

    function createTopicSearch({ adapter, watcher, getSettings, fetchImpl = root.fetch, store = STORE, win = root, doc = root.document }) {
        const topics = adapter.topics;
        let kept = { filters: [], sort: 'stars' };
        const loaded = store.load().then((stored) => { if (stored) kept = { ...kept, ...stored }; });

        const enabled = () => getSettings()[ForgeSites.siteKey(adapter.site, 'topicSearch')] === true;

        /** The box for one topic page; everything it searched for dies with it when the page moves on. */
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
    <button type="button" class="btn btn-sm bb-topic-clear" title="Back to this topic's own list" hidden>Clear</button>
  </form>
  <div class="bb-topic-results" hidden>
    <h2 class="h3 color-fg-muted mt-3 bb-topic-said"></h2>
    <div class="bb-topic-list"></div>
    <button type="button" class="ajax-pagination-btn btn color-border-default f6 mt-0 width-full bb-topic-more" hidden>Load more…</button>
  </div>`;
            const $ = (selector) => box.querySelector(selector);
            const input = $('.bb-topic-input');
            const sort = $('.bb-topic-sort');
            /** Each topic and filter added, in the order it was: `{ topic }` or `{ filter }`. */
            let terms = [];
            let page = 0;
            let asking = 0;

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

            function show(searching) {
                $('.bb-topic-results').hidden = !searching;
                $('.bb-topic-clear').hidden = !searching;
                if (box.parentElement) box.parentElement.classList.toggle(SEARCHING, searching);
            }

            async function ask(more = false) {
                const asked = search();
                const token = ++asking;
                const said = $('.bb-topic-said');
                const button = $('.bb-topic-more');
                page = more ? page + 1 : 1;
                if (!more) {
                    $('.bb-topic-list').innerHTML = '';
                    said.textContent = 'Searching…';
                    button.hidden = true;
                    kept = { filters: asked.filters, sort: asked.sort };
                    store.save(kept);
                }
                show(true);
                said.classList.remove('color-fg-danger');
                button.disabled = true;
                button.textContent = 'Loading more…';
                const found = await topics.search(asked, page, { fetchImpl });
                // A search asked again before this one answered has the box now.
                if (token !== asking) return;
                button.disabled = false;
                button.textContent = 'Load more…';
                if (found.error) {
                    page -= 1;
                    said.textContent = found.error;
                    said.classList.add('color-fg-danger');
                    return;
                }
                $('.bb-topic-list').insertAdjacentHTML('beforeend', found.repos.map(cardHtml).join(''));
                // Each word whole: GitHub balances a heading's lines, and broke
                // "cloud-native" at its hyphen to do it.
                const whole = (word) => `<span class="no-wrap">${esc(word)}</span>`;
                const names = listed(asked.topics.map(whole));
                const filters = asked.filters.map(whole).join(' ');
                said.innerHTML = found.total === 0
                    ? `No public repository has ${asked.topics.length > 1 ? `all of ${names}` : names}${filters ? ' with these filters' : ''}`
                    : `Here ${found.total === 1 ? 'is 1 public repository' : `are ${found.total.toLocaleString('en-US')} public repositories`} matching ${names}${filters ? `, with ${filters}` : ''}`;
                button.hidden = !found.more;
            }

            function clear() {
                asking++;
                terms = [];
                input.value = '';
                drawTerms();
                show(false);
                kept = { filters: [], sort: sort.value };
                store.save(kept);
            }

            $('.bb-topic-form').addEventListener('submit', (event) => {
                event.preventDefault();
                take();
                if (terms.length) ask();
                else clear();
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
                // What is shown follows the box: one fewer topic is searched again.
                if (!$('.bb-topic-results').hidden) {
                    if (terms.length) ask();
                    else clear();
                }
            });
            sort.addEventListener('change', () => { if (!$('.bb-topic-results').hidden) ask(); });
            $('.bb-topic-clear').addEventListener('click', clear);
            $('.bb-topic-more').addEventListener('click', () => ask(true));

            loaded.then(() => {
                terms = kept.filters.map((filter) => ({ filter }));
                sort.value = SORTS.some(([value]) => value === kept.sort) ? kept.sort : 'stars';
                drawTerms();
            });
            return box;
        }

        /** Put in under the page's own menus, kept in on its redraws, and taken out — with the page's list back — once off or elsewhere. */
        function place() {
            const topic = enabled() ? topics.at(win.location.pathname) : null;
            const placed = doc.getElementById(BOX_ID);
            if (placed && placed.dataset.topic !== topic) {
                if (placed.parentElement) placed.parentElement.classList.remove(SEARCHING);
                placed.remove();
            }
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

    const TopicSearch = { BOX_ID, SEARCHING, cardHtml, listed, createTopicSearch };

    root.BB.TopicSearch = TopicSearch;
    if (typeof module !== 'undefined' && module.exports) module.exports = TopicSearch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
