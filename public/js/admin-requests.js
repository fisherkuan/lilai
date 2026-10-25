// Admin: lost-link requests from /me (server/email-claims.js). Each request lists the events
// whose host name matches; tick the person's events (or search for others) and Approve puts
// their email on them and mails them a Find my events sign-in link. Decline sends nothing.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function dayText(iso) {
        const d = new Date(iso);
        return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }

    function status(id, message, isError) {
        const el = $(id);
        el.textContent = message || '';
        el.className = `row-status${isError ? ' is-error' : ''}`;
        el.hidden = !message;
    }

    async function send(method, url, body) {
        const res = await AdminSession.adminFetch(url, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) throw new Error(data.message || 'That did not work. Try again.');
        return data;
    }

    function eventOption(e, checked) {
        const facts = [dayText(e.date), e.host_name ? `host ${e.host_name}` : 'no host name'];
        if (e.seriesCount > 1) facts.push(`${e.seriesCount} dates`);
        if (e.hasEmail) facts.push('already has an email');
        return `<li><label class="rq-event"><input type="checkbox" value="${escapeHtml(e.id)}"${checked ? ' checked' : ''}>`
            + `<span><span class="pl-name">${escapeHtml(e.title)}</span><span class="pl-address">${escapeHtml(facts.join(' · '))}</span></span></label></li>`;
    }

    function requestRow(r) {
        const exact = r.matches.filter(m => (m.host_name || '').trim().toLowerCase() === r.name.trim().toLowerCase() && !m.hasEmail);
        return `<li class="pl-row rq-row" data-id="${escapeHtml(r.id)}">`
            + `<div class="pl-text"><span class="pl-name">${escapeHtml(r.name)}</span>`
            + `<span class="pl-address">${escapeHtml(r.email)} · asked ${escapeHtml(dayText(r.created_at))}</span></div>`
            + `<p class="field-hint rq-hint">${r.matches.length ? 'Events with a matching host name. Tick the ones that are theirs.' : 'No event has this host name. Search below.'}</p>`
            + `<ul class="rq-events">${r.matches.map(m => eventOption(m, exact.length === 1 && exact[0].id === m.id)).join('')}</ul>`
            + '<div class="field rq-search"><label>Find another event</label>'
            + '<input type="search" class="input" data-search placeholder="Title or host name" autocomplete="off"></div>'
            + '<div class="pl-actions rq-actions"><button type="button" class="btn btn-solid pl-btn" data-approve>Approve</button>'
            + '<button type="button" class="text-btn" data-decline>Decline</button></div>'
            + '<p class="row-status" data-status role="status" hidden></p></li>';
    }

    function doneRow(r) {
        const what = r.decision === 'approved' ? `approved, ${r.eventCount} event${r.eventCount === 1 ? '' : 's'}` : 'declined';
        return `<li class="pl-row"><div class="pl-text"><span class="pl-name">${escapeHtml(r.name)}</span>`
            + `<span class="pl-address">${escapeHtml(r.email)} · ${escapeHtml(what)} · ${escapeHtml(dayText(r.decided_at))}</span></div></li>`;
    }

    async function load() {
        try {
            const data = await send('GET', '/api/admin/claims');
            $('open-count').textContent = data.requests.length ? String(data.requests.length) : '';
            $('open-rows').innerHTML = data.requests.length
                ? data.requests.map(requestRow).join('')
                : '<li class="pl-empty">No requests waiting.</li>';
            $('done-card').hidden = !data.decided.length;
            $('done-rows').innerHTML = data.decided.map(doneRow).join('');
        } catch (error) {
            status('open-message', error.message, true);
        }
    }

    function rowStatus(row, message, isError) {
        const el = row.querySelector('[data-status]');
        el.textContent = message || '';
        el.className = `row-status${isError ? ' is-error' : ''}`;
        el.hidden = !message;
    }

    // Search results join the list unticked; ones already listed stay as they are.
    let searchTimer = null;
    function search(input) {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            const q = input.value.trim();
            if (q.length < 2) return;
            const row = input.closest('.rq-row');
            try {
                const data = await send('GET', `/api/admin/claims/events?q=${encodeURIComponent(q)}`);
                const list = row.querySelector('.rq-events');
                const have = new Set([...list.querySelectorAll('input')].map(i => i.value));
                list.insertAdjacentHTML('beforeend', data.events.filter(e => !have.has(e.id)).map(e => eventOption(e, false)).join(''));
                rowStatus(row, data.events.length ? '' : 'Nothing found.');
            } catch (error) {
                rowStatus(row, error.message, true);
            }
        }, 250);
    }

    async function decide(row, how) {
        const id = row.dataset.id;
        const buttons = row.querySelectorAll('button');
        if (how === 'approve') {
            const eventIds = [...row.querySelectorAll('.rq-events input:checked')].map(i => i.value);
            if (!eventIds.length) return rowStatus(row, 'Tick at least one event.', true);
            buttons.forEach(b => { b.disabled = true; });
            try {
                const data = await send('POST', `/api/admin/claims/${encodeURIComponent(id)}/approve`, { eventIds });
                status('open-message', data.mailed
                    ? `Approved. ${data.attached.join(', ')} now carry the email, and the sign-in link went out.`
                    : `Approved, but the sign-in mail did not go out. They can ask for one on Find my events.`, !data.mailed);
                load();
            } catch (error) {
                rowStatus(row, error.message, true);
                buttons.forEach(b => { b.disabled = false; });
            }
            return;
        }
        buttons.forEach(b => { b.disabled = true; });
        try {
            await send('POST', `/api/admin/claims/${encodeURIComponent(id)}/decline`);
            status('open-message', 'Declined. Nothing was sent.');
            load();
        } catch (error) {
            rowStatus(row, error.message, true);
            buttons.forEach(b => { b.disabled = false; });
        }
    }

    $('open-rows').addEventListener('click', (e) => {
        const row = e.target.closest('.rq-row');
        if (!row) return;
        if (e.target.closest('[data-approve]')) decide(row, 'approve');
        if (e.target.closest('[data-decline]')) decide(row, 'decline');
    });
    $('open-rows').addEventListener('input', (e) => {
        if (e.target.matches('[data-search]')) search(e.target);
    });
    load();
})();
