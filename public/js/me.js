// Find my events (/me): type an email, open the emailed link (/me/signin/<token>), and this
// device lists the events that address hosts. Manage mints a fresh management link and keeps
// it under "You manage" (js/device-links.js). Sign out ends this device's session; Delete my
// email takes the address off every event and signs out every device.
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const parts = location.pathname.split('/').filter(Boolean);
    const signinToken = parts[1] === 'signin' ? decodeURIComponent(parts[2] || '') : '';
    let email = '';
    const NAME_KEY = 'lilai.attendeeName';

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function whenText(iso) {
        const d = new Date(iso);
        return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }

    function seats(e) {
        const asking = e.pendingCount ? ` · ${e.pendingCount} asking` : '';
        return e.attendance_limit !== null ? `${e.attendingCount} of ${e.attendance_limit}${asking}` : `${e.attendingCount} coming${asking}`;
    }

    function showState(message, isError = false) {
        $('me-state').textContent = message;
        $('me-state').classList.toggle('is-error', isError);
        $('me-state').hidden = !message;
    }

    function showOnly(id) {
        for (const section of ['me-ask', 'me-redeem', 'me-list']) $(section).hidden = section !== id;
        showState('');
    }

    function showError(id, message) {
        $(id).textContent = message || '';
        $(id).hidden = !message;
    }

    async function api(url, options = {}) {
        const res = await fetch(url, {
            cache: 'no-store',
            ...options,
            headers: options.body ? { 'Content-Type': 'application/json' } : undefined
        });
        const result = await res.json().catch(() => ({}));
        return { status: res.status, ok: res.ok && result.success !== false, result };
    }

    // ---------- Not signed in ----------

    function showAsk() {
        showOnly('me-ask');
        $('me-form').hidden = false;
        $('me-sent').hidden = true;
        if (!$('lost-name').value) {
            try { $('lost-name').value = localStorage.getItem(NAME_KEY) || ''; } catch (_) { /* private mode */ }
        }
        if (location.hash === '#lost') $('lost').scrollIntoView();
    }

    async function sendLink(e) {
        e.preventDefault();
        showError('me-error', '');
        const typed = $('me-email').value.trim();
        if (!typed) return showError('me-error', 'Type your email.');
        const button = $('me-send');
        const text = button.querySelector('.text');
        button.disabled = true;
        text.textContent = 'Sending…';
        try {
            const { ok, result } = await api('/api/me/link', { method: 'POST', body: JSON.stringify({ email: typed }) });
            if (!ok) return showError('me-error', result.message || 'That did not go through. Try again.');
            $('me-form').hidden = true;
            $('me-sent-text').textContent = `If ${typed} made an event on Lilai, a link is on its way. It works once, for 30 minutes.`;
            $('me-sent').hidden = false;
            $('me-sent').focus();
        } catch (_) {
            showError('me-error', 'No connection. Check your network and try again.');
        } finally {
            button.disabled = false;
            text.textContent = 'Email me a link';
        }
    }

    // Lost a management link, no email on the event: a request for the admin.
    async function sendClaim(e) {
        e.preventDefault();
        showError('lost-error', '');
        const name = $('lost-name').value.trim();
        const typed = $('lost-email').value.trim();
        if (!name) return showError('lost-error', 'Add your name.');
        if (!typed) return showError('lost-error', 'Add an email.');
        const button = $('lost-send');
        const text = button.querySelector('.text');
        button.disabled = true;
        text.textContent = 'Sending…';
        try {
            const { ok, result } = await api('/api/me/claims', { method: 'POST', body: JSON.stringify({ name, email: typed }) });
            if (!ok) return showError('lost-error', result.message || 'That did not go through. Try again.');
            try { localStorage.setItem(NAME_KEY, name); } catch (_) { /* private mode */ }
            $('lost-form').hidden = true;
            $('lost-sent').hidden = false;
            $('lost-sent').focus();
        } catch (_) {
            showError('lost-error', 'No connection. Check your network and try again.');
        } finally {
            button.disabled = false;
            text.textContent = 'Send';
        }
    }

    // ---------- The emailed link ----------

    // A tap, not on load: mail scanners open links, and the link works only once.
    async function redeem() {
        const button = $('me-redeem-btn');
        button.disabled = true;
        showError('me-redeem-error', '');
        try {
            const { ok, result } = await api('/api/me/session', { method: 'POST', body: JSON.stringify({ token: signinToken }) });
            if (!ok) {
                showError('me-redeem-error', result.message || 'That did not go through. Try again.');
                button.disabled = false;
                return;
            }
            history.replaceState(null, '', '/me');
            await load();
        } catch (_) {
            showError('me-redeem-error', 'No connection. Check your network and try again.');
            button.disabled = false;
        }
    }

    // ---------- Signed in ----------

    function row(e, { manage = true, note = '' } = {}) {
        const label = e.cancelled ? `${e.title} (cancelled)` : e.title;
        const repeats = e.count > 1 ? ` · ${e.count} dates` : '';
        return `<li class="ev-request${e.cancelled ? ' is-declined' : ''}"><span class="ev-request-who">`
            + `<span class="ev-request-name">${escapeHtml(label)}</span>`
            + `<span class="ev-request-at">${escapeHtml(whenText(e.date))} · ${escapeHtml(seats(e))}${repeats}${note}</span></span>`
            + `<span class="ev-request-actions">${manage
                ? `<button type="button" class="btn btn-line" data-manage="${escapeHtml(e.id)}" aria-label="${escapeHtml(`Manage ${e.title}`)}">Manage</button>`
                : `<a class="btn btn-line" href="/#event-${encodeURIComponent(e.id)}" aria-label="${escapeHtml(`Open ${e.title}`)}">Open</a>`}</span></li>`;
    }

    function render(data) {
        email = data.email;
        $('me-who').textContent = `Signed in as ${email}`;
        $('me-upcoming-count').textContent = data.upcoming.length ? String(data.upcoming.length) : '';
        $('me-upcoming').innerHTML = data.upcoming.length
            ? data.upcoming.map(e => row(e)).join('')
            : '<li class="ev-empty">No upcoming events made with this email.</li>';
        $('me-joined-block').hidden = !data.joined.length;
        $('me-joined').innerHTML = data.joined
            .map(e => row(e, { manage: false, note: e.attendance === 'pending' ? ' · you asked to join' : '' })).join('');
        $('me-past-block').hidden = !data.past.length;
        $('me-past').innerHTML = data.past.map(e => row(e)).join('');
        $('me-delete-confirm').hidden = true;
        showOnly('me-list');
    }

    async function load() {
        try {
            const { status, ok, result } = await api('/api/me');
            if (status === 401) return showAsk();
            if (!ok) return showState(result.message || 'Could not load your events. Reload to try again.', true);
            render(result);
        } catch (_) {
            showState('Could not reach Lilai. Check your network and reload.', true);
        }
    }

    // This device's link for the event when it has one, else a fresh one; then the page.
    async function manage(button) {
        const id = button.dataset.manage;
        const known = DeviceLinks.hosted().find(h => h.eventId === id);
        if (known) {
            location.href = known.hostPath;
            return;
        }
        button.disabled = true;
        showError('me-list-error', '');
        try {
            const { status, ok, result } = await api(`/api/me/events/${encodeURIComponent(id)}/manage`, { method: 'POST' });
            if (status === 401) return showAsk();
            if (!ok) throw new Error(result.message || 'That did not go through. Try again.');
            const name = button.closest('.ev-request').querySelector('.ev-request-name').textContent;
            DeviceLinks.rememberHosted({ hostPath: result.hostPath, eventId: id, title: name, date: new Date().toISOString() });
            location.href = result.hostPath;
        } catch (error) {
            showError('me-list-error', error.message);
            button.disabled = false;
        }
    }

    async function signOut() {
        await api('/api/me/session', { method: 'DELETE' }).catch(() => {});
        showAsk();
    }

    function askDelete() {
        $('me-delete-text').textContent = `This takes ${email} off every event you made and signs out every device. `
            + 'Your events, your name and who is coming stay. Keep your management links: without the email, they are the only way in.';
        $('me-delete-confirm').hidden = false;
        $('me-delete-confirm').focus();
    }

    async function deleteEmail() {
        const button = $('me-delete-yes');
        button.disabled = true;
        try {
            const { ok, result } = await api('/api/me', { method: 'DELETE' });
            if (!ok) throw new Error(result.message || 'That did not go through. Try again.');
            showAsk();
            $('me-form').hidden = true;
            $('me-sent-text').textContent = `Deleted. Lilai no longer has ${email}.`;
            $('me-sent').hidden = false;
        } catch (error) {
            showError('me-list-error', error.message);
        } finally {
            button.disabled = false;
        }
    }

    $('me-form').addEventListener('submit', sendLink);
    $('lost-form').addEventListener('submit', sendClaim);
    $('me-other').addEventListener('click', () => {
        showAsk();
        $('me-email').value = '';
        $('me-email').focus();
    });
    $('me-redeem-btn').addEventListener('click', redeem);
    document.querySelector('#me-list').addEventListener('click', (e) => {
        const button = e.target.closest('[data-manage]');
        if (button) manage(button);
    });
    $('me-signout').addEventListener('click', signOut);
    $('me-delete').addEventListener('click', askDelete);
    $('me-delete-no').addEventListener('click', () => { $('me-delete-confirm').hidden = true; });
    $('me-delete-yes').addEventListener('click', deleteEmail);

    if (signinToken) showOnly('me-redeem');
    else load();
})();
