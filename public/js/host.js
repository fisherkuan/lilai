// The host page (/host/:token): one event and everyone who asked to join. The token in the
// path is the only key; it goes to the API as is and never into localStorage from here.
(() => {
    'use strict';

    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
    const CAL_STYLES = [
        { shape: 'circle', tone: 'blue' },
        { shape: 'square', tone: 'red' },
        { shape: 'triangle', tone: 'yellow' },
        { shape: 'diamond', tone: 'ink' }
    ];
    let view = null;
    let calendars = [];
    let busy = false;

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
        const at = calendars.findIndex(id => id === source);
        const style = at < 0 ? CAL_STYLES[3] : CAL_STYLES[Math.min(at, CAL_STYLES.length - 1)];
        return `<span class="tone-${style.tone}"><svg class="shape s-${style.shape}" aria-hidden="true" focusable="false"><use href="#shape-${style.shape}"/></svg></span>`;
    }

    function showState(message, isError = false) {
        const el = document.getElementById('host-state');
        el.textContent = message;
        el.classList.toggle('is-error', isError);
        el.hidden = !message;
    }

    function showError(message) {
        const el = document.getElementById('host-error');
        el.textContent = message || '';
        el.hidden = !message;
    }

    function row(request, actions) {
        const buttons = actions.map(([decision, label, solid]) =>
            `<button type="button" class="btn ${solid ? 'btn-solid' : 'btn-line'}" data-id="${escapeHtml(request.id)}" data-decision="${decision}" aria-label="${escapeHtml(`${label}: ${request.name}`)}">${label}</button>`
        ).join('');
        return `<li class="ev-request${request.status === 'declined' ? ' is-declined' : ''}">`
            + `<span class="ev-request-who"><span class="ev-request-name">${escapeHtml(request.name)}</span>`
            + `<span class="ev-request-at">asked ${escapeHtml(askedText(request.at))}</span></span>`
            + `<span class="ev-request-actions">${buttons}</span></li>`;
    }

    function render() {
        const { event, requests } = view;
        const approval = event.approval_required;
        const isPast = new Date(event.date).getTime() < Date.now();
        const limit = event.attendance_limit;
        const waiting = requests.filter(r => r.status === 'pending');
        const coming = requests.filter(r => r.status === 'yes');
        const declined = requests.filter(r => r.status === 'declined');
        const full = limit !== null && coming.length >= limit;

        document.title = `${event.title} — Host page — Lilai`;
        document.getElementById('host-title').innerHTML = `${shapeFor(event.source)}<span>${escapeHtml(event.title)}</span>`;
        document.getElementById('host-when').textContent = whenText(event);
        const where = document.getElementById('host-where');
        where.textContent = event.location || '';
        where.hidden = !event.location;
        document.getElementById('host-mode').textContent = approval
            ? 'You approve each person who asks to join.'
            : 'Open: anyone who joins has a place.';

        document.getElementById('tally-num').textContent = limit !== null ? `${coming.length}/${limit}` : String(coming.length);
        document.getElementById('tally-label').textContent = limit !== null
            ? (full ? 'places taken · full' : 'places taken')
            : (isPast ? 'went' : 'coming');

        // Waiting: only an approval event has a queue. Accept is the main action.
        document.getElementById('waiting-section').hidden = !approval && waiting.length === 0;
        document.getElementById('waiting-count').textContent = waiting.length ? String(waiting.length) : '';
        document.getElementById('waiting-list').innerHTML = waiting.length
            ? waiting.map(r => row(r, full ? [['decline', 'Decline']] : [['accept', 'Accept', true], ['decline', 'Decline']])).join('')
            : '<li class="ev-empty">No one is waiting.</li>';

        document.getElementById('coming-count').textContent = coming.length ? String(coming.length) : '';
        document.getElementById('coming-list').innerHTML = coming.length
            ? coming.map(r => row(r, isPast ? [] : [['decline', 'Remove']])).join('')
            : '<li class="ev-empty">No one yet.</li>';

        // A declined name can come back: to the queue on an approval event, else straight in.
        document.getElementById('declined-section').hidden = declined.length === 0;
        document.getElementById('declined-count').textContent = String(declined.length);
        document.getElementById('declined-list').innerHTML = declined.map(r =>
            row(r, isPast ? [] : [[approval ? 'undo' : 'accept', 'Undo']])
        ).join('');

        const google = document.getElementById('host-google');
        google.hidden = !event.google_link;
        if (event.google_link) google.href = event.google_link;
        document.getElementById('host-home').href = `/#event-${encodeURIComponent(event.id)}`;

        document.getElementById('host-event').hidden = false;
        showState('');
    }

    async function load() {
        try {
            const res = await fetch(`/api/host/${encodeURIComponent(token)}`, { cache: 'no-store' });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.success) {
                document.getElementById('host-event').hidden = true;
                showState(result.message || 'This host link does not open any event.', true);
                return;
            }
            view = result;
            render();
        } catch (error) {
            if (!view) showState('Could not reach Lilai. Check your network and reload.', true);
        }
    }

    async function decide(button) {
        if (busy) return;
        busy = true;
        showError('');
        button.disabled = true;
        try {
            const res = await fetch(`/api/host/${encodeURIComponent(token)}/requests/${encodeURIComponent(button.dataset.id)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: button.dataset.decision })
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.success) {
                showError(result.message || 'That did not go through. Try again.');
                button.disabled = false;
                return;
            }
            view = result;
            render();
        } catch (error) {
            showError('No connection. Check your network and try again.');
            button.disabled = false;
        } finally {
            busy = false;
        }
    }

    // New requests arrive live: any attendance change on this event reloads the lists.
    function listen() {
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
        ws.onmessage = (message) => {
            try {
                const data = JSON.parse(message.data);
                if (data.type === 'attendance_update' && view && data.payload.eventId === view.event.id && !busy) load();
            } catch (_) { /* not ours */ }
        };
        ws.onclose = () => setTimeout(listen, 5000);
    }

    async function init() {
        document.getElementById('host-event').addEventListener('click', (e) => {
            const button = e.target.closest('button[data-decision]');
            if (button) decide(button);
        });
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
