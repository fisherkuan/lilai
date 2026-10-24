// Make an event: Home's slide-in sheet (index.html #event-sheet). Opens from any
// [data-make-event] button and from /#new (or /#new=<calendar>, which the calendar page uses).
// The form is js/event-form.js; the links this device holds are js/device-links.js.
(() => {
    'use strict';

    const NAME_KEY = 'lilai.attendeeName';
    const sheet = document.getElementById('event-sheet');
    const form = document.getElementById('event-sheet-form');
    const made = document.getElementById('event-made');
    const submitBtn = document.getElementById('event-submit');
    const fields = EventForm.create(document.getElementById('event-form-fields'), { mode: 'create' });
    let config = null;
    let returnFocus = null;

    function rememberedName() {
        try { return localStorage.getItem(NAME_KEY) || ''; } catch (_) { return ''; }
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // "Sat 3 Oct, 19:30" in the device's own zone, like Home.
    function whenText(iso) {
        const d = new Date(iso);
        return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }

    async function loadConfig() {
        if (config) return config;
        config = await (await fetch('/api/config')).json();
        return config;
    }

    // Open calendars, and restricted ones this device holds a key for.
    function writableCalendars() {
        const keys = DeviceLinks.calendarKeys();
        return ((config && config.eventCreation && config.eventCreation.calendars) || [])
            .filter(c => !c.restricted || keys[c.name]);
    }

    function showFormError(message) {
        const el = document.getElementById('event-form-error');
        el.textContent = message || '';
        el.hidden = !message;
    }

    async function open(preferredCalendar) {
        returnFocus = document.activeElement;
        sheet.classList.remove('hidden');
        if (!made.hidden) {
            // The last one is made; start a fresh form.
            made.hidden = true;
            form.hidden = false;
            fields.reset();
        }
        fields.setMinDate();
        if (!document.getElementById('event-form-fields').dataset.named) {
            fields.setHostName(rememberedName());
            document.getElementById('event-form-fields').dataset.named = '1';
        }
        try {
            await loadConfig();
            fields.setCalendars(writableCalendars(), preferredCalendar || config.events?.defaultCreateCalendar);
        } catch (_) {
            showFormError('Could not reach Lilai. Check your network and try again.');
        }
        setTimeout(() => fields.focus(), 60);
    }

    function close() {
        sheet.classList.add('hidden');
        if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
        returnFocus = null;
    }

    async function submit(e) {
        e.preventDefault();
        showFormError('');
        if (!fields.check()) return;
        const body = { ...fields.value(), calendarKeys: Object.values(DeviceLinks.calendarKeys()) };
        const text = submitBtn.querySelector('.text');
        submitBtn.disabled = true;
        text.textContent = 'Making…';
        try {
            const res = await fetch('/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.success) {
                if (!(result.field && fields.showError(result.field, result.message))) {
                    showFormError(result.message || 'That did not go through. Try again.');
                }
                return;
            }
            try { localStorage.setItem(NAME_KEY, body.hostName.trim()); } catch (_) { /* private mode */ }
            DeviceLinks.rememberHosted({ hostPath: result.hostPath, title: body.title.trim(), date: result.date, count: result.count });
            renderHosted();
            showMade(body, result);
        } catch (_) {
            showFormError('No connection. Check your network and try again.');
        } finally {
            submitBtn.disabled = false;
            text.textContent = 'Make event';
        }
    }

    function showMade(body, result) {
        const url = `${location.origin}${result.hostPath}`;
        form.hidden = true;
        document.getElementById('event-made-title').textContent = `${body.title.trim()} is on the calendar`;
        document.getElementById('event-made-when').textContent = result.count > 1
            ? `${result.count} dates, from ${whenText(result.date)}`
            : whenText(result.date);
        document.getElementById('event-made-url').textContent = url;
        document.getElementById('event-made-open').href = result.hostPath;
        document.getElementById('event-made-share').hidden = !navigator.share;
        const emailed = document.getElementById('event-made-emailed');
        emailed.hidden = !body.hostEmail.trim();
        emailed.textContent = result.emailed
            ? `We emailed it to ${body.hostEmail.trim()}.`
            : 'We could not email it. Copy it now; this device also keeps it under "You manage".';
        document.getElementById('event-made-publish').textContent = result.publishing
            ? 'Lilai is adding it to Google Calendar for subscribers now.'
            : 'It is in Lilai. Google Calendar subscribers will see it once publishing is set up.';
        made.hidden = false;
        made.focus();
    }

    async function shareMade(button, how) {
        const url = document.getElementById('event-made-url').textContent;
        const title = document.getElementById('event-made-title').textContent;
        let outcome;
        if (how === 'copy') {
            try {
                await navigator.clipboard.writeText(url);
                outcome = 'copied';
            } catch (_) {
                outcome = 'failed';
            }
        } else {
            outcome = await DeviceLinks.share({ title, text: 'Manage this Lilai event with me:', url });
        }
        const label = button.textContent;
        button.textContent = { copied: 'Copied', shared: 'Shared', failed: 'Select and copy it' }[outcome] || label;
        setTimeout(() => { button.textContent = label; }, 2000);
    }

    // "You manage" in the sidebar: events whose management link this device holds.
    function renderHosted() {
        const box = document.getElementById('hosted-list');
        if (!box) return;
        const now = Date.now();
        const list = DeviceLinks.hosted().filter(e => e.count > 1 || new Date(e.date).getTime() > now - 86400000);
        box.hidden = list.length === 0;
        document.getElementById('hosted-items').innerHTML = list.map(e =>
            `<li><a class="text-link" href="${escapeHtml(e.hostPath)}">${escapeHtml(e.title)}</a>`
            + `<span class="ev-hosted-when">${escapeHtml(e.count > 1 ? `${e.count} dates` : whenText(e.date))}</span></li>`
        ).join('');
    }

    // /#new or /#new=<calendar>: open the sheet, then drop the hash so a reload does not reopen it.
    function openFromHash() {
        const match = /^#new(?:=(.+))?$/.exec(location.hash);
        if (!match) return;
        history.replaceState(null, '', location.pathname + location.search);
        open(match[1] ? decodeURIComponent(match[1]) : null);
    }

    document.querySelectorAll('[data-make-event]').forEach(b => b.addEventListener('click', () => open()));
    sheet.addEventListener('click', (e) => {
        if (e.target === sheet || e.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !sheet.classList.contains('hidden')) close();
    });
    form.addEventListener('submit', submit);
    document.getElementById('event-made-copy').addEventListener('click', (e) => shareMade(e.currentTarget, 'copy'));
    document.getElementById('event-made-share').addEventListener('click', (e) => shareMade(e.currentTarget, 'share'));
    window.addEventListener('hashchange', openFromHash);
    renderHosted();
    openFromHash();
})();
