// Admin: the booking organisers (server/organizers.js). Signed in with an address on this list,
// a device shows the header's Admin link to the booking queue. Changes need the admin session.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let organizers = [];
    let removing = null;

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function send(method, url, body) {
        const res = await AdminSession.adminFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.message || 'That did not work. Try again.'), { field: data.field });
        return data;
    }

    function status(message, isError) {
        const el = $('list-message');
        el.textContent = message || '';
        el.className = `row-status${isError ? ' is-error' : ''}`;
        el.hidden = !message;
    }

    function fieldError(message) {
        const el = document.querySelector('[data-error-for="email"]');
        el.textContent = message || '';
        el.hidden = !message;
    }

    function rowHtml(o) {
        const actions = removing === o.email
            ? `<span class="pl-ask">Remove?</span>
               <button type="button" class="btn btn-line pl-btn" data-act="remove-yes">Remove</button>
               <button type="button" class="text-btn" data-act="remove-no">Keep</button>`
            : '<button type="button" class="text-btn" data-act="remove">Remove</button>';
        return `<li class="pl-row" data-email="${escapeHtml(o.email)}">
            <div class="pl-text"><span class="pl-name">${escapeHtml(o.email)}</span></div>
            <div class="pl-actions">${actions}</div>
        </li>`;
    }

    function draw() {
        $('org-count').textContent = String(organizers.length);
        $('org-rows').innerHTML = organizers.length
            ? organizers.map(rowHtml).join('')
            : '<li class="pl-empty">No organisers yet.</li>';
    }

    async function load() {
        try {
            organizers = (await send('GET', '/api/organizers')).organizers;
            draw();
        } catch (error) {
            status(error.message, true);
        }
    }

    $('org-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        fieldError('');
        const input = $('email');
        try {
            organizers = (await send('POST', '/api/organizers', { email: input.value })).organizers;
            input.value = '';
            removing = null;
            draw();
            status('');
        } catch (error) {
            if (error.field) fieldError(error.message);
            else status(error.message, true);
            input.focus();
        }
    });

    $('org-rows').addEventListener('click', async (e) => {
        const button = e.target.closest('[data-act]');
        if (!button) return;
        const email = button.closest('.pl-row').dataset.email;
        const focusRow = (act) => document.querySelector(`.pl-row[data-email="${CSS.escape(email)}"] [data-act="${act}"]`)?.focus();
        const act = button.dataset.act;
        if (act === 'remove') { removing = email; draw(); return focusRow('remove-no'); }
        if (act === 'remove-no') { removing = null; draw(); return focusRow('remove'); }
        if (act === 'remove-yes') {
            try {
                organizers = (await send('DELETE', `/api/organizers/${encodeURIComponent(email)}`)).organizers;
                removing = null;
                draw();
                status(`${email} removed.`);
            } catch (error) {
                status(error.message, true);
            }
        }
    });

    load();
})();
