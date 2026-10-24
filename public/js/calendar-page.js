// The calendar access page (/calendars/:token): opening it keeps the calendar's key on this
// device (js/device-links.js), so Home's "Make an event" offers that calendar even when it is
// restricted. It lists the calendar's upcoming events; Manage makes this device a management
// link for one of them (one link for every date of a repeating event).
(() => {
    'use strict';

    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
    const pageUrl = `${location.origin}/calendars/${encodeURIComponent(token)}`;
    const $ = (id) => document.getElementById(id);
    let calendar = null;

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
        $('cal-state').textContent = message;
        $('cal-state').classList.toggle('is-error', isError);
        $('cal-state').hidden = !message;
    }

    async function load() {
        try {
            const res = await fetch(`/api/calendar-access/${encodeURIComponent(token)}`, { cache: 'no-store' });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.success) {
                showState(result.message || 'This calendar link does not work any more.', true);
                return;
            }
            calendar = result.calendar;
            DeviceLinks.rememberCalendarKey(calendar.name, token);
            render(result.events);
        } catch (_) {
            showState('Could not reach Lilai. Check your network and reload.', true);
        }
    }

    function render(events) {
        document.title = `${calendar.name} — Calendar access — Lilai`;
        $('cal-title').textContent = calendar.name;
        $('cal-lede').textContent = calendar.restricted
            ? `Only ${calendar.name}'s admins can add events to it. This device is one of them now: "Make an event" on Home offers ${calendar.name}.`
            : `Anyone can add events to ${calendar.name}. This link also lets you manage every one of them.`;
        $('cal-make').href = `/#new=${encodeURIComponent(calendar.name)}`;
        $('cal-make').textContent = `Make a ${calendar.name} event`;
        $('cal-not-imported').hidden = calendar.imported;
        $('cal-count').textContent = events.length ? String(events.length) : '';
        $('cal-events').innerHTML = events.length ? events.map(e =>
            `<li class="ev-request"><span class="ev-request-who"><span class="ev-request-name">${escapeHtml(e.title)}</span>`
            + `<span class="ev-request-at">${escapeHtml(whenText(e.date))} · ${escapeHtml(seats(e))}${e.series_id ? ' · repeats' : ''}</span></span>`
            + `<span class="ev-request-actions">${e.managed
                ? `<button type="button" class="btn btn-line" data-manage="${escapeHtml(e.id)}" aria-label="${escapeHtml(`Manage ${e.title}`)}">Manage</button>`
                : ''}</span></li>`
        ).join('') : '<li class="ev-empty">No upcoming events.</li>';
        $('cal-body').hidden = false;
        showState('');
    }

    // A management link for this device, then straight to the page.
    async function manage(button) {
        button.disabled = true;
        $('cal-error').hidden = true;
        try {
            const res = await fetch(`/api/calendar-access/${encodeURIComponent(token)}/events/${encodeURIComponent(button.dataset.manage)}/manage`, { method: 'POST' });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.success) throw new Error(result.message || 'That did not go through. Try again.');
            location.href = result.hostPath;
        } catch (error) {
            $('cal-error').textContent = error.message;
            $('cal-error').hidden = false;
            button.disabled = false;
        }
    }

    async function sharePage() {
        const outcome = await DeviceLinks.share({
            title: `${calendar.name} on Lilai`,
            text: `This link lets you add and manage ${calendar.name} events on Lilai:`,
            url: pageUrl
        });
        const message = {
            copied: 'Link copied. Anyone you send it to can add and manage events in this calendar.',
            failed: `Copy this link: ${pageUrl}`
        }[outcome] || '';
        $('cal-share-status').textContent = message;
        $('cal-share-status').hidden = !message;
    }

    $('cal-events').addEventListener('click', (e) => {
        const button = e.target.closest('[data-manage]');
        if (button) manage(button);
    });
    $('cal-share').addEventListener('click', sharePage);
    load();
})();
