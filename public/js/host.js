// The management page (/host/:token): one event, or one date of a repeating event, and
// everything a host does with it — edit, cancel or restore, share the page, and accept or
// decline the people who asked. The token in the path is the only key.
(() => {
    'use strict';

    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
    const pageUrl = `${location.origin}/host/${encodeURIComponent(token)}`;
    const CAL_STYLES = [
        { shape: 'circle', tone: 'blue' },
        { shape: 'square', tone: 'red' },
        { shape: 'triangle', tone: 'yellow' },
        { shape: 'diamond', tone: 'ink' }
    ];
    let view = null;
    let calendars = [];
    let busy = false;
    let selectedId = new URLSearchParams(location.search).get('event');
    const editFields = EventForm.create(document.getElementById('edit-fields'), { mode: 'edit' });

    const $ = (id) => document.getElementById(id);

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function time(d) {
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    // "Saturday 3 October, 19:30–21:30", as the RSVP sheet writes it.
    function whenText(event) {
        const start = new Date(event.date);
        const day = start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
        const endRaw = event.endDate || event.enddate;
        const end = endRaw ? new Date(endRaw) : null;
        if (!end || end <= start) return `${day}, ${time(start)}`;
        const endDay = end.toDateString() === start.toDateString()
            ? ''
            : `${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} `;
        return `${day}, ${time(start)}–${endDay}${time(end)}`;
    }

    // "asked 5 min ago", "asked Tue 14:02".
    function askedText(iso) {
        const d = new Date(iso);
        const minutes = Math.round((Date.now() - d.getTime()) / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes} min ago`;
        if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
        return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${time(d)}`;
    }

    // The calendar's shape, in config order like Home, so the host sees the same mark.
    function shapeFor(source) {
        const at = calendars.indexOf(source);
        const style = at < 0 ? CAL_STYLES[3] : CAL_STYLES[Math.min(at, CAL_STYLES.length - 1)];
        return `<span class="tone-${style.tone}"><svg class="shape s-${style.shape}" aria-hidden="true" focusable="false"><use href="#shape-${style.shape}"/></svg></span>`;
    }

    function showState(message, isError = false) {
        const el = $('host-state');
        el.textContent = message;
        el.classList.toggle('is-error', isError);
        el.hidden = !message;
    }

    function showError(id, message) {
        $(id).textContent = message || '';
        $(id).hidden = !message;
    }

    // ---------- Drawing ----------

    function row(request, actions) {
        const buttons = actions.map(([decision, label, style = 'line']) =>
            `<button type="button" class="btn btn-${style}" data-id="${escapeHtml(request.id)}" data-name="${escapeHtml(request.name)}" data-decision="${decision}"${style === 'danger' ? ' data-confirm' : ''} aria-label="${escapeHtml(`${label}: ${request.name}`)}">${label}</button>`
        ).join('');
        return `<li class="ev-request${request.status === 'declined' ? ' is-declined' : ''}">`
            + `<span class="ev-request-who"><span class="ev-request-name">${escapeHtml(request.name)}</span>`
            + `<span class="ev-request-at">${request.status === 'yes' ? 'joined' : 'asked'} ${escapeHtml(askedText(request.at))}</span></span>`
            + `<span class="ev-request-actions">${buttons}</span></li>`;
    }

    function renderSeries(series, event) {
        $('series').hidden = !series;
        if (!series) return;
        $('series-rule').textContent = series.rule;
        const live = series.dates.filter(d => !d.cancelled).length;
        $('series-count').textContent = `${series.dates.length} dates${live < series.dates.length ? `, ${series.dates.length - live} cancelled` : ''}`;
        $('series-dates').innerHTML = series.dates.map((d) => {
            const day = new Date(d.date);
            const label = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            const classes = ['ev-date-chip'];
            if (d.cancelled) classes.push('is-cancelled');
            if (day.getTime() < Date.now()) classes.push('is-past');
            return `<button type="button" class="${classes.join(' ')}" data-event="${escapeHtml(d.id)}" aria-pressed="${d.id === event.id}"`
                + ` aria-label="${escapeHtml(`${label}${d.cancelled ? ', cancelled' : ''}, ${d.attendingCount} coming`)}">`
                + `<span>${escapeHtml(label)}</span><span class="ev-date-chip-count" aria-hidden="true">${d.cancelled ? '—' : d.attendingCount}</span></button>`;
        }).join('');
        const current = $('series-dates').querySelector('[aria-pressed="true"]');
        if (current) current.scrollIntoView({ block: 'nearest', inline: 'center' });
    }

    function render() {
        const { event, requests, series } = view;
        const approval = event.approval_required;
        const isPast = new Date(event.date).getTime() < Date.now();
        const limit = event.attendance_limit;
        const waiting = requests.filter(r => r.status === 'pending');
        const coming = requests.filter(r => r.status === 'yes');
        const declined = requests.filter(r => r.status === 'declined');
        const full = limit !== null && coming.length >= limit;
        const editable = !event.cancelled;

        document.title = `${event.title} — Manage — Lilai`;
        $('host-cancelled').hidden = !event.cancelled;
        $('host-title').innerHTML = `${shapeFor(event.source)}<span>${escapeHtml(event.title)}</span>`;
        $('host-when').textContent = whenText(event);
        $('host-where').textContent = event.location || '';
        $('host-where').hidden = !event.location;
        $('host-links').innerHTML = EventLinks.listHtml(event.links);
        const meta = [
            event.calendar ? event.calendar.name : '',
            approval ? 'You approve each person' : 'Open to anyone',
            event.host_name ? `Hosted by ${event.host_name}` : ''
        ].filter(Boolean);
        $('host-meta').textContent = meta.join(' · ');
        $('host-publish').textContent = event.publish.text;
        $('host-publish').dataset.state = event.publish.state;

        renderSeries(series, event);

        $('edit-btn').hidden = !editable;
        $('cancel-btn').hidden = !editable;
        $('restore-btn').hidden = editable;

        $('tally-num').textContent = limit !== null ? `${coming.length}/${limit}` : String(coming.length);
        $('tally-label').textContent = limit !== null
            ? (full ? 'places taken · full' : 'places taken')
            : (isPast ? 'went' : 'coming');

        const act = !isPast && editable;
        $('waiting-section').hidden = !approval && waiting.length === 0;
        $('waiting-count').textContent = waiting.length ? String(waiting.length) : '';
        $('waiting-list').innerHTML = waiting.length
            ? waiting.map(r => row(r, !act ? [] : full ? [['decline', 'Decline']] : [['accept', 'Accept', 'solid'], ['decline', 'Decline']])).join('')
            : '<li class="ev-empty">No one is waiting.</li>';

        $('coming-count').textContent = coming.length ? String(coming.length) : '';
        $('coming-list').innerHTML = coming.length
            ? coming.map(r => row(r, act ? [['decline', 'Remove', 'danger']] : [])).join('')
            : '<li class="ev-empty">No one yet.</li>';

        // A declined name can come back: to the queue on an approval event, else straight in.
        $('declined-section').hidden = declined.length === 0;
        $('declined-count').textContent = String(declined.length);
        $('declined-list').innerHTML = declined.map(r => row(r, act ? [[approval ? 'undo' : 'accept', 'Undo']] : [])).join('');

        $('host-foot').textContent = series
            ? 'Anyone with this page\'s link can manage every date of this event. Share it only with people who host with you.'
            : 'Anyone with this page\'s link can manage the event. Share it only with people who host with you.';
        $('host-google').hidden = !event.google_link || event.cancelled;
        if (event.google_link) $('host-google').href = event.google_link;
        $('host-home').hidden = event.cancelled;
        $('host-home').href = `/#event-${encodeURIComponent(event.id)}`;

        $('host-event').hidden = false;
        showState('');

        // "You manage" on Home lists this page from now on.
        const next = series ? series.dates.find(d => !d.cancelled && new Date(d.date).getTime() > Date.now()) : null;
        DeviceLinks.rememberHosted({
            hostPath: location.pathname,
            title: event.title,
            date: next ? next.date : event.date,
            count: series ? series.dates.length : 1
        });
    }

    // ---------- Talking to the server ----------

    async function load() {
        try {
            const qs = selectedId ? `?event=${encodeURIComponent(selectedId)}` : '';
            const res = await fetch(`/api/host/${encodeURIComponent(token)}${qs}`, { cache: 'no-store' });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.success) {
                $('host-event').hidden = true;
                showState(result.message || 'This link does not open any event.', true);
                return;
            }
            view = result;
            selectedId = view.event.id;
            render();
        } catch (error) {
            if (!view) showState('Could not reach Lilai. Check your network and reload.', true);
        }
    }

    // One write to the event; the answer is the page's new view.
    async function send(path, method, body) {
        const res = await fetch(`/api/host/${encodeURIComponent(token)}/events/${encodeURIComponent(view.event.id)}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
        const result = await res.json().catch(() => ({}));
        if (res.ok && result.success) {
            view = result;
            render();
        }
        return { ok: res.ok && result.success, result };
    }

    async function decide(button) {
        if (busy) return;
        busy = true;
        showError('host-error', '');
        button.disabled = true;
        try {
            const { ok, result } = await send(`/requests/${encodeURIComponent(button.dataset.id)}`, 'POST', { decision: button.dataset.decision });
            if (!ok) {
                showError('host-error', result.message || 'That did not go through. Try again.');
                button.disabled = false;
            }
        } catch (error) {
            showError('host-error', 'No connection. Check your network and try again.');
            button.disabled = false;
        } finally {
            busy = false;
        }
    }

    // ---------- Sheets ----------

    let returnFocus = null;
    function openSheet(id) {
        returnFocus = document.activeElement;
        $(id).classList.remove('hidden');
    }
    function closeSheet(id) {
        $(id).classList.add('hidden');
        if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
        returnFocus = null;
    }
    ['edit-sheet', 'cancel-sheet', 'remove-sheet'].forEach((id) => {
        $(id).addEventListener('click', (e) => {
            if (e.target === $(id) || e.target.closest('[data-close]')) closeSheet(id);
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        ['edit-sheet', 'cancel-sheet', 'remove-sheet'].forEach((id) => { if (!$(id).classList.contains('hidden')) closeSheet(id); });
    });

    function wireScope(groupId) {
        const group = $(groupId);
        group.addEventListener('click', (e) => {
            const b = e.target.closest('[role="radio"]');
            if (!b) return;
            group.querySelectorAll('[role="radio"]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
        });
        return () => group.querySelector('[aria-checked="true"]').dataset.scope;
    }
    const editScope = wireScope('edit-scope');
    const cancelScope = wireScope('cancel-scope');
    function resetScope(groupId) {
        $(groupId).querySelectorAll('[role="radio"]').forEach(x => x.setAttribute('aria-checked', String(x.dataset.scope === 'this')));
    }

    function openEdit() {
        editFields.set(view.event.form);
        editFields.clearErrors();
        showError('edit-error', '');
        $('edit-scope-field').hidden = !view.series;
        resetScope('edit-scope');
        openSheet('edit-sheet');
        setTimeout(() => editFields.focus(), 60);
    }

    async function saveEdit(e) {
        e.preventDefault();
        showError('edit-error', '');
        if (!editFields.check()) return;
        const save = $('edit-save');
        const text = save.querySelector('.text');
        save.disabled = true;
        text.textContent = 'Saving…';
        try {
            const { ok, result } = await send('', 'PUT', { ...editFields.value(), scope: view.series ? editScope() : 'this' });
            if (!ok) {
                if (!(result.field && editFields.showError(result.field, result.message))) {
                    showError('edit-error', result.message || 'That did not go through. Try again.');
                }
                return;
            }
            closeSheet('edit-sheet');
        } catch (error) {
            showError('edit-error', 'No connection. Check your network and try again.');
        } finally {
            save.disabled = false;
            text.textContent = 'Save';
        }
    }

    function openCancel() {
        $('cancel-when').textContent = `${view.event.title}, ${whenText(view.event)}`;
        $('cancel-scope-field').hidden = !view.series;
        resetScope('cancel-scope');
        showError('cancel-error', '');
        openSheet('cancel-sheet');
    }

    // Removing someone who joined asks first: it takes their place away.
    let removing = null;
    function openRemove(button) {
        removing = button;
        $('remove-sheet-title').textContent = `Remove ${button.dataset.name}?`;
        openSheet('remove-sheet');
        $('remove-confirm').focus();
    }

    async function confirmRemove() {
        const button = removing;
        removing = null;
        closeSheet('remove-sheet');
        if (button && document.contains(button)) await decide(button);
    }

    async function confirmCancel() {
        const button = $('cancel-confirm');
        button.disabled = true;
        try {
            const { ok, result } = await send('/cancel', 'POST', { scope: view.series ? cancelScope() : 'this' });
            if (!ok) {
                showError('cancel-error', result.message || 'That did not go through. Try again.');
                return;
            }
            closeSheet('cancel-sheet');
        } catch (error) {
            showError('cancel-error', 'No connection. Check your network and try again.');
        } finally {
            button.disabled = false;
        }
    }

    async function restore() {
        const button = $('restore-btn');
        button.disabled = true;
        showError('host-error', '');
        try {
            const { ok, result } = await send('/restore', 'POST');
            if (!ok) showError('host-error', result.message || 'That did not go through. Try again.');
        } catch (error) {
            showError('host-error', 'No connection. Check your network and try again.');
        } finally {
            button.disabled = false;
        }
    }

    async function sharePage() {
        const outcome = await DeviceLinks.share({
            title: `Manage ${view.event.title}`,
            text: `Help me host ${view.event.title} on Lilai. This link lets you edit it and manage who comes:`,
            url: pageUrl
        });
        const status = $('share-status');
        const message = {
            shared: '',
            copied: 'Link copied. Anyone you send it to can manage this event.',
            failed: `Copy this link: ${pageUrl}`
        }[outcome] || '';
        status.textContent = message;
        status.hidden = !message;
    }

    // New requests and the Google copy's progress arrive live; any change to this event reloads.
    function listen() {
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
        ws.onmessage = (message) => {
            try {
                const data = JSON.parse(message.data);
                if (!view || busy) return;
                const id = view.event.id;
                const about = data.payload && (data.payload.eventId === id || data.payload.id === id
                    || (Array.isArray(data.payload.ids) && data.payload.ids.includes(id)));
                if (about) load();
            } catch (_) { /* not ours */ }
        };
        ws.onclose = () => setTimeout(listen, 5000);
    }

    async function init() {
        $('host-event').addEventListener('click', (e) => {
            const decision = e.target.closest('button[data-decision]');
            if (decision && decision.hasAttribute('data-confirm')) return openRemove(decision);
            if (decision) return decide(decision);
            const chip = e.target.closest('.ev-date-chip');
            if (chip) {
                selectedId = chip.dataset.event;
                history.replaceState(null, '', `${location.pathname}?event=${encodeURIComponent(selectedId)}`);
                load();
            }
        });
        $('edit-btn').addEventListener('click', openEdit);
        $('edit-form').addEventListener('submit', saveEdit);
        $('cancel-btn').addEventListener('click', openCancel);
        $('cancel-confirm').addEventListener('click', confirmCancel);
        $('remove-confirm').addEventListener('click', confirmRemove);
        $('restore-btn').addEventListener('click', restore);
        $('share-btn').addEventListener('click', sharePage);
        try {
            const config = await (await fetch('/api/config')).json();
            calendars = (config.calendars || []).filter(c => c.enabled).map(c => {
                try { return new URL(c.url).searchParams.get('src'); } catch (_) { return null; }
            }).filter(Boolean);
        } catch (_) { /* shapes fall back to the diamond */ }
        await load();
        listen();
    }

    init();
})();
