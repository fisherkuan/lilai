// Admin: the saved places an event's Where offers first (server/places.js). Reading the list
// is public; each change sends the admin key, asked for once and kept in this browser.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let places = [];
    let editing = null;
    let removing = null;
    let picked = null;

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function adminKey() {
        let key = null;
        try { key = localStorage.getItem('adminKey'); } catch (_) { /* private mode */ }
        if (!key) {
            key = prompt('Enter admin key (will be saved locally in your browser):');
            if (key) try { localStorage.setItem('adminKey', key); } catch (_) { /* kept for this page only */ }
        }
        return key;
    }

    // Sends a change. Answers the parsed body, or throws an Error with .field when the server
    // points at one.
    async function send(method, url, body) {
        const key = adminKey();
        if (!key) throw new Error('The admin key is needed for changes.');
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            try { localStorage.removeItem('adminKey'); } catch (_) { /* nothing stored */ }
            throw new Error('That admin key is wrong. Try again.');
        }
        if (!res.ok) throw Object.assign(new Error(data.message || 'That did not work. Try again.'), { field: data.field });
        return data;
    }

    function status(id, message, isError) {
        const el = $(id);
        el.textContent = message || '';
        el.className = `row-status${isError ? ' is-error' : ''}`;
        el.hidden = !message;
    }

    function fieldError(scope, field, message) {
        scope.querySelectorAll('[data-error-for]').forEach(el => { el.hidden = true; el.textContent = ''; });
        const el = field && scope.querySelector(`[data-error-for="${field}"]`);
        if (!el) return false;
        el.textContent = message;
        el.hidden = false;
        el.closest('.field')?.querySelector('input')?.focus();
        return true;
    }

    // ---------- The list ----------
    async function load() {
        const res = await fetch('/api/places');
        const body = await res.json();
        places = body.places || [];
        $('find-field').hidden = !body.google;
        draw();
    }

    function rowHtml(place, index) {
        if (editing === place.id) {
            return `<li class="pl-row is-editing" data-id="${place.id}">
                <form class="pl-edit" novalidate>
                    <div class="field"><label for="e-name">Name</label>
                        <input id="e-name" name="name" class="input" maxlength="255" value="${escapeHtml(place.name)}">
                        <p class="field-error" data-error-for="name" role="alert" hidden></p></div>
                    <div class="field"><label for="e-address">Address</label>
                        <input id="e-address" name="address" class="input" maxlength="255" value="${escapeHtml(place.address)}">
                        <p class="field-error" data-error-for="address" role="alert" hidden></p></div>
                    <div class="field"><label for="e-aliases">Other names</label>
                        <input id="e-aliases" name="aliases" class="input" value="${escapeHtml(place.aliases.join(', '))}">
                        <p class="field-error" data-error-for="aliases" role="alert" hidden></p></div>
                    <div class="sheet-actions">
                        <button type="submit" class="btn btn-solid">Save</button>
                        <button type="button" class="text-btn" data-act="cancel">Cancel</button>
                    </div>
                </form>
            </li>`;
        }
        const actions = removing === place.id
            ? `<span class="pl-ask">Remove?</span>
               <button type="button" class="btn btn-line pl-btn" data-act="remove-yes">Remove</button>
               <button type="button" class="text-btn" data-act="remove-no">Keep</button>`
            : `<button type="button" class="icon-btn" data-act="up" aria-label="Move ${escapeHtml(place.name)} up"${index === 0 ? ' disabled' : ''}>
                   <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg></button>
               <button type="button" class="icon-btn" data-act="down" aria-label="Move ${escapeHtml(place.name)} down"${index === places.length - 1 ? ' disabled' : ''}>
                   <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10l6 6 6-6"/></svg></button>
               <button type="button" class="text-btn" data-act="edit">Edit</button>
               <button type="button" class="text-btn" data-act="remove">Remove</button>`;
        return `<li class="pl-row" data-id="${place.id}">
            <div class="pl-text">
                <span class="pl-name">${escapeHtml(place.name)}</span>
                ${place.address ? `<span class="pl-address">${escapeHtml(place.address)}</span>` : ''}
                ${place.aliases.length ? `<span class="pl-aliases">Also ${escapeHtml(place.aliases.join(', '))}</span>` : ''}
            </div>
            <div class="pl-actions">${actions}</div>
        </li>`;
    }

    function draw() {
        $('place-count').textContent = String(places.length);
        $('place-rows').innerHTML = places.length
            ? places.map(rowHtml).join('')
            : '<li class="pl-empty">No places yet.</li>';
        if (editing) $('e-name')?.focus();
    }

    async function move(id, step) {
        const ids = places.map(p => p.id);
        const from = ids.indexOf(id);
        const to = from + step;
        if (from < 0 || to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        try {
            const body = await send('PUT', '/api/places/order', { ids });
            places = body.places;
            status('list-message', '');
            draw();
            document.querySelector(`.pl-row[data-id="${id}"] [data-act="${step < 0 ? 'up' : 'down'}"]:not([disabled])`)?.focus();
        } catch (error) {
            status('list-message', error.message, true);
        }
    }

    $('place-rows').addEventListener('click', async (e) => {
        const button = e.target.closest('[data-act]');
        if (!button) return;
        const id = Number(button.closest('.pl-row').dataset.id);
        const place = places.find(p => p.id === id);
        const act = button.dataset.act;
        if (act === 'up' || act === 'down') return move(id, act === 'up' ? -1 : 1);
        if (act === 'edit') { editing = id; removing = null; return draw(); }
        if (act === 'cancel') { editing = null; draw(); return document.querySelector(`.pl-row[data-id="${id}"] [data-act="edit"]`)?.focus(); }
        if (act === 'remove') { removing = id; editing = null; draw(); return document.querySelector(`.pl-row[data-id="${id}"] [data-act="remove-no"]`)?.focus(); }
        if (act === 'remove-no') { removing = null; draw(); return document.querySelector(`.pl-row[data-id="${id}"] [data-act="remove"]`)?.focus(); }
        if (act === 'remove-yes') {
            try {
                await send('DELETE', `/api/places/${id}`);
                removing = null;
                await load();
                status('list-message', `Removed ${place.name}. Events already there keep their place.`);
            } catch (error) {
                status('list-message', error.message, true);
            }
        }
    });

    $('place-rows').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const id = Number(form.closest('.pl-row').dataset.id);
        const current = places.find(p => p.id === id);
        try {
            await send('PUT', `/api/places/${id}`, {
                name: form.name.value, address: form.address.value, aliases: form.aliases.value, placeId: current.placeId
            });
            editing = null;
            await load();
            status('list-message', `Saved ${form.name.value.trim()}.`);
        } catch (error) {
            if (!fieldError(form, error.field, error.message)) status('list-message', error.message, true);
        }
    });

    // ---------- Add a place ----------
    const form = $('place-form');
    function resetForm() {
        form.reset();
        picked = null;
        fieldError(form, null);
    }
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $('name').value.trim();
        try {
            await send('POST', '/api/places', {
                name, address: $('address').value, aliases: $('aliases').value,
                placeId: picked && picked.name === name ? picked.placeId : null
            });
            resetForm();
            await load();
            status('form-message', `Added ${name}. Hosts see it under Where now.`);
        } catch (error) {
            if (!fieldError(form, error.field, error.message)) status('form-message', error.message, true);
        }
    });
    $('reset-btn').addEventListener('click', () => { resetForm(); status('form-message', ''); });
    $('clear-key-btn').addEventListener('click', () => {
        try { localStorage.removeItem('adminKey'); } catch (_) { /* nothing stored */ }
        status('list-message', 'Admin key cleared. The next change asks for it again.');
    });

    // ---------- Find on Google Maps: fills the name and address ----------
    const find = $('find');
    const findList = $('find-list');
    let results = [];
    let active = -1;
    let timer = null;
    let session = '';
    function drawResults() {
        findList.innerHTML = results.length
            ? results.map((r, i) => `<li role="option" id="find-${i}" data-index="${i}" aria-selected="${i === active}">`
                + `<span class="ev-place-name">${escapeHtml(r.name)}</span>`
                + (r.address ? `<span class="ev-place-address">${escapeHtml(r.address)}</span>` : '') + '</li>').join('')
            : '<li class="ev-place-none" role="presentation">No place found.</li>';
        findList.hidden = false;
        find.setAttribute('aria-expanded', 'true');
        if (active >= 0) find.setAttribute('aria-activedescendant', `find-${active}`);
        else find.removeAttribute('aria-activedescendant');
    }
    function closeResults() {
        findList.hidden = true;
        find.setAttribute('aria-expanded', 'false');
        find.removeAttribute('aria-activedescendant');
    }
    function pick(r) {
        picked = r;
        $('name').value = r.name;
        $('address').value = r.address || '';
        find.value = '';
        session = '';
        closeResults();
        $('name').focus();
    }
    find.addEventListener('input', () => {
        clearTimeout(timer);
        const q = find.value.trim();
        if (q.length < 2) return closeResults();
        if (!session) session = window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now());
        timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/places/search?q=${encodeURIComponent(q)}&session=${session}`);
                results = (await res.json()).results || [];
            } catch (_) {
                results = [];
            }
            if (find.value.trim() !== q) return;
            active = results.length ? 0 : -1;
            drawResults();
        }, 250);
    });
    find.addEventListener('keydown', (e) => {
        if (findList.hidden) return;
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length) {
            e.preventDefault();
            active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
            drawResults();
        } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            pick(results[active]);
        } else if (e.key === 'Escape') {
            closeResults();
        }
    });
    findList.addEventListener('pointerdown', (e) => e.preventDefault());
    findList.addEventListener('click', (e) => {
        const li = e.target.closest('[role="option"]');
        if (li) pick(results[Number(li.dataset.index)]);
    });
    find.addEventListener('blur', closeResults);

    load().catch(() => status('list-message', 'Could not load the places. Reload the page.', true));
})();
