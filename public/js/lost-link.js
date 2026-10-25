// Lost a management link: Home's sheet (index.html #lost-link-sheet), opened by any
// [data-lost-link] button and by /#lost-link (the FAQ links there). It lists where the link
// may still be, then sends a request to the admins through /api/feedback: they check the
// host and reply with a new link (a calendar key's Manage mints one).
(() => {
    'use strict';

    const NAME_KEY = 'lilai.attendeeName';
    const sheet = document.getElementById('lost-link-sheet');
    if (!sheet) return;
    const form = document.getElementById('lost-link-form');
    const ask = document.getElementById('lost-link-ask');
    const sent = document.getElementById('lost-link-sent');
    const select = document.getElementById('lost-event');
    const sendBtn = document.getElementById('lost-send');
    let events = [];
    let returnFocus = null;

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function dayText(iso) {
        return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    }

    function showError(message) {
        const el = document.getElementById('lost-error');
        el.textContent = message || '';
        el.hidden = !message;
    }

    async function loadEvents() {
        try {
            const res = await fetch('/api/events?timeRange=future');
            const data = await res.json();
            events = (Array.isArray(data) ? data : data.events || []).filter(e => e && e.id);
        } catch (_) {
            events = [];
        }
        select.innerHTML = '<option value="">Pick the event</option>'
            + events.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(`${dayText(e.date)} · ${e.title}`)}</option>`).join('');
    }

    function open() {
        returnFocus = document.activeElement;
        sent.hidden = true;
        ask.hidden = false;
        showError('');
        if (!document.getElementById('lost-name').value) {
            try { document.getElementById('lost-name').value = localStorage.getItem(NAME_KEY) || ''; } catch (_) { /* private mode */ }
        }
        sheet.classList.remove('hidden');
        loadEvents();
    }

    function close() {
        sheet.classList.add('hidden');
        if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
        returnFocus = null;
    }

    async function submit(e) {
        e.preventDefault();
        showError('');
        const event = events.find(ev => ev.id === select.value);
        const name = document.getElementById('lost-name').value.trim();
        const email = document.getElementById('lost-email').value.trim();
        if (!event) return showError('Pick the event.');
        if (!name) return showError('Add your name.');
        if (!email) return showError('Add an email for the new link.');
        const text = sendBtn.querySelector('.text');
        sendBtn.disabled = true;
        text.textContent = 'Sending…';
        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: [
                        'Lost management link',
                        `Event: ${event.title}, ${dayText(event.date)}`,
                        `Event id: ${event.id}`,
                        `Host name given: ${name}`,
                        `Recorded host: ${event.host_name || 'none'}`
                    ].join('\n'),
                    email,
                    page: 'lost-link'
                })
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || result.success === false) {
                showError(result.error === 'bad_email' ? 'That email address does not look right.' : 'That did not go through. Try again.');
                return;
            }
            ask.hidden = true;
            sent.hidden = false;
            sent.focus();
        } catch (_) {
            showError('No connection. Check your network and try again.');
        } finally {
            sendBtn.disabled = false;
            text.textContent = 'Send';
        }
    }

    function openFromHash() {
        if (location.hash !== '#lost-link') return;
        history.replaceState(null, '', location.pathname + location.search);
        open();
    }

    document.querySelectorAll('[data-lost-link]').forEach(b => b.addEventListener('click', open));
    sheet.addEventListener('click', (e) => {
        if (e.target === sheet || e.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !sheet.classList.contains('hidden')) close();
    });
    form.addEventListener('submit', submit);
    window.addEventListener('hashchange', openFromHash);
    openFromHash();
})();
