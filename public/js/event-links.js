// EventLinks: an event's links, [{ url, label? }], as Lilai holds them (no longer read out of
// the description). listHtml draws them on cards and sheets; create() is the editor on Make
// an event, the host page and the admin page. Works as a browser global and in Node.
(function (root) {
    'use strict';

    const MAX_LINKS = 5;

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Only http(s) ever reaches an href.
    function safeUrl(raw) {
        try {
            const url = new URL(String(raw || '').trim());
            return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
        } catch (_) {
            return null;
        }
    }

    // The name a link shows: its label, else its site ("docs.google.com").
    function displayLabel(link) {
        if (link.label && String(link.label).trim()) return String(link.label).trim();
        try {
            return new URL(link.url).hostname.replace(/^www\./, '');
        } catch (_) {
            return 'Link';
        }
    }

    // "forms.gle/abc" typed without a scheme gets https://, as a browser bar would.
    function normalizeUrl(raw) {
        const text = String(raw || '').trim();
        if (!text) return '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
        return `https://${text.replace(/^\/+/, '')}`;
    }

    function listHtml(links) {
        const shown = (Array.isArray(links) ? links : [])
            .map(link => ({ link, href: safeUrl(link && link.url) }))
            .filter(item => item.href);
        if (shown.length === 0) return '';
        return `<ul class="event-links">${shown.map(({ link, href }) =>
            `<li><a class="event-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayLabel(link))}`
            + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8M9 8h7v7"/></svg>'
            + '<span class="sr-only"> (opens in a new tab)</span></a></li>'
        ).join('')}</ul>`;
    }

    let uid = 0;

    // The editor: a row per link (address, optional name, remove) and "Add a link".
    // value() is what the API takes; an empty row is left out, not an error.
    function create(container, { links = [], onChange = () => {} } = {}) {
        const id = `links-${++uid}`;
        container.classList.add('link-editor');
        container.innerHTML = `<ul class="link-rows" id="${id}-rows"></ul>`
            + `<button type="button" class="text-btn link-add" aria-controls="${id}-rows">Add a link</button>`;
        const rows = container.querySelector('.link-rows');
        const addBtn = container.querySelector('.link-add');

        function rowHtml(link, n) {
            return `<li class="link-row">`
                + `<label class="sr-only" for="${id}-url-${n}">Link address</label>`
                + `<input type="url" id="${id}-url-${n}" class="input link-url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://" value="${escapeHtml(link.url || '')}">`
                + `<label class="sr-only" for="${id}-label-${n}">Link name</label>`
                + `<input type="text" id="${id}-label-${n}" class="input link-label" maxlength="40" autocomplete="off" placeholder="Name, e.g. Sign-up form" value="${escapeHtml(link.label || '')}">`
                + '<button type="button" class="icon-btn link-remove" aria-label="Remove this link">'
                + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>'
                + '</li>';
        }

        let count = 0;
        function addRow(link = {}, focus = false) {
            if (rows.children.length >= MAX_LINKS) return;
            rows.insertAdjacentHTML('beforeend', rowHtml(link, count++));
            sync();
            if (focus) rows.lastElementChild.querySelector('.link-url').focus();
        }

        function sync() {
            const full = rows.children.length >= MAX_LINKS;
            addBtn.hidden = full;
            addBtn.textContent = rows.children.length ? 'Add another link' : 'Add a link';
        }

        function set(next) {
            rows.innerHTML = '';
            (Array.isArray(next) ? next : []).slice(0, MAX_LINKS).forEach(link => addRow(link));
            sync();
        }

        addBtn.addEventListener('click', () => { addRow({}, true); onChange(); });
        rows.addEventListener('click', (e) => {
            const remove = e.target.closest('.link-remove');
            if (!remove) return;
            const row = remove.closest('.link-row');
            const next = row.nextElementSibling || row.previousElementSibling;
            row.remove();
            sync();
            (next ? next.querySelector('.link-url') : addBtn).focus();
            onChange();
        });
        rows.addEventListener('change', (e) => {
            if (e.target.classList.contains('link-url')) e.target.value = normalizeUrl(e.target.value);
            onChange();
        });
        rows.addEventListener('input', () => onChange());

        set(links);

        return {
            value() {
                return [...rows.children].map(row => ({
                    url: normalizeUrl(row.querySelector('.link-url').value),
                    label: row.querySelector('.link-label').value.trim()
                })).filter(link => link.url).map(link => (link.label ? link : { url: link.url }));
            },
            set,
            // The first address that is not a web address, to point at before a round trip.
            invalid() {
                const bad = [...rows.children].find(row => {
                    const url = normalizeUrl(row.querySelector('.link-url').value);
                    return url && !safeUrl(url);
                });
                return bad ? bad.querySelector('.link-url') : null;
            }
        };
    }

    const EventLinks = { MAX_LINKS, listHtml, displayLabel, normalizeUrl, safeUrl, create };
    if (typeof module !== 'undefined' && module.exports) module.exports = EventLinks;
    else root.EventLinks = EventLinks;
})(typeof window !== 'undefined' ? window : globalThis);
