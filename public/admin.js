const API_BASE_URL = window.location.origin;

let allAdminEvents = []; // Global variable to store event data
let appConfig = {};

// ---------- Calendar shapes ----------
// Copied from public/app.js's styleFor/shapeSvg mapping (not imported: admin
// pages stay off app.js). Each enabled calendar owns one primary shape, in
// config order — see DESIGN.md, The One Shape Per Calendar Rule.
const CAL_STYLES = [
    { shape: 'circle', tone: 'blue' },
    { shape: 'square', tone: 'red' },
    { shape: 'triangle', tone: 'yellow' },
    { shape: 'diamond', tone: 'ink' }
];
const UNSOURCED_STYLE = { shape: 'diamond', tone: 'ink', name: '' };
let calendarStyleBySource = {};

function calendarIdFromUrl(url) {
    try {
        return new URL(url).searchParams.get('src');
    } catch (_) {
        return null;
    }
}

function buildCalendarStyles() {
    calendarStyleBySource = {};
    let i = 0;
    (appConfig.calendars || []).forEach(cal => {
        if (!cal.enabled) return;
        const id = calendarIdFromUrl(cal.url);
        if (!id) return;
        const base = CAL_STYLES[Math.min(i, CAL_STYLES.length - 1)];
        calendarStyleBySource[id] = { ...base, name: cal.name };
        i += 1;
    });
}

function styleFor(event) {
    return calendarStyleBySource[event.source] || UNSOURCED_STYLE;
}

function shapeSvg(shape, extraClass = '') {
    return `<svg class="shape s-${shape}${extraClass ? ' ' + extraClass : ''}" aria-hidden="true" focusable="false"><use href="#shape-${shape}"/></svg>`;
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function escapeAttribute(str) {
    return escapeHtml(str);
}

document.addEventListener('DOMContentLoaded', () => {
    init();
    setupWebSocket();
});

async function init() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/config`, { cache: 'no-cache' });
        appConfig = await res.json();
    } catch (error) {
        console.error('Error loading config:', error);
        appConfig = {};
    }
    buildCalendarStyles();
    loadEvents();
}

function setupWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsProtocol}://${window.location.host}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connection established');
    };

    ws.onmessage = (message) => {
        try {
            const data = JSON.parse(message.data);
            if (data.type === 'event_update') {
                updateEventInUI(data.payload);
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed. Attempting to reconnect...');
        setTimeout(setupWebSocket, 5000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function updateEventInUI(event) {
    const row = document.querySelector(`tr[data-event-id="${CSS.escape(event.id)}"]`);
    if (!row) return;

    const idx = allAdminEvents.findIndex(ev => ev.id === event.id);
    if (idx > -1) allAdminEvents[idx] = { ...allAdminEvents[idx], ...event };

    const input = document.getElementById(`limit-${event.id}`);
    if (input && document.activeElement !== input) {
        input.value = event.attendance_limit || '';
    }

    const updateBtn = row.querySelector('[data-action="update"]');
    if (updateBtn) updateBtn.textContent = event.attendance_limit ? 'Update' : 'Set';
}

async function loadEvents() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/events?timeRange=future`, { cache: 'no-cache' });
        const events = await response.json();
        allAdminEvents = events;
        displayEvents(events);
    } catch (error) {
        console.error('Error loading events:', error);
        const eventsList = document.getElementById('admin-events-list');
        eventsList.innerHTML = '<tr role="row"><td role="cell" colspan="3"><p class="state-line is-error">Could not load events.</p></td></tr>';
    }
}

function formatEventWhen(dateStr) {
    return new Date(dateStr).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function displayEvents(events) {
    const eventsList = document.getElementById('admin-events-list');

    if (!events.length) {
        eventsList.innerHTML = '<tr role="row"><td role="cell" colspan="3"><p class="state-line">No upcoming events.</p></td></tr>';
        return;
    }

    eventsList.innerHTML = events.map(event => {
        const st = styleFor(event);
        const buttonText = event.attendance_limit ? 'Update' : 'Set';
        const id = escapeAttribute(event.id);
        return `
            <tr data-event-id="${id}" role="row">
                <td role="cell">
                    <div class="row-title"><span class="shape-mark tone-${st.tone}">${shapeSvg(st.shape)}</span>${escapeHtml(event.title)}</div>
                    <div class="row-meta">${escapeHtml(formatEventWhen(event.date))}</div>
                </td>
                <td class="col-num" role="cell">
                    <span class="col-label" aria-hidden="true">Limit</span>
                    <label class="sr-only" for="limit-${id}">Attendance limit for ${escapeAttribute(event.title)}</label>
                    <input type="number" id="limit-${id}" class="input input-num" min="1" placeholder="No limit" value="${event.attendance_limit || ''}">
                </td>
                <td role="cell">
                    <div class="row-actions">
                        <button type="button" class="text-btn" data-action="update">${buttonText}</button>
                        <button type="button" class="text-btn" data-action="remove">Remove</button>
                    </div>
                    <p class="row-status" id="status-${id}" hidden></p>
                </td>
            </tr>
        `;
    }).join('');

    eventsList.querySelectorAll('tr[data-event-id]').forEach(row => {
        const eventId = row.dataset.eventId;
        row.querySelector('[data-action="update"]').addEventListener('click', () => updateAttendanceLimit(eventId));
        row.querySelector('[data-action="remove"]').addEventListener('click', () => removeAttendanceLimit(eventId));
    });
}

function printRowStatus(eventId, message, isError) {
    const status = document.getElementById(`status-${CSS.escape(eventId)}`);
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', !!isError);
    status.hidden = !message;
}

function descriptionLimitConflict(event, newLimit) {
    if (!event || !event.description) return undefined;
    const match = event.description.trim().match(/limit:?\s*(\d+)/i);
    if (!match) return undefined;
    const descriptionLimit = parseInt(match[1], 10);
    return descriptionLimit !== newLimit ? descriptionLimit : undefined;
}

async function updateAttendanceLimit(eventId) {
    const input = document.getElementById(`limit-${eventId}`);
    const newLimit = input.value ? parseInt(input.value, 10) : null;

    if (newLimit !== null && newLimit <= 0) {
        printRowStatus(eventId, 'Limit must be a positive number.', true);
        return;
    }

    const currentEvent = allAdminEvents.find(event => event.id === eventId);
    if (descriptionLimitConflict(currentEvent, newLimit) !== undefined) {
        printRowStatus(eventId, 'Not effective — this event’s limit comes from its calendar description. Remove it there first.', true);
        return;
    }

    try {
        const updateResponse = await fetch(`${API_BASE_URL}/api/events/${eventId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attendanceLimit: newLimit })
        });

        if (updateResponse.ok) {
            const updatedEvent = await updateResponse.json();
            printRowStatus(eventId, `Updated to ${newLimit ? newLimit : 'unlimited'}.`, false);
        } else {
            const error = await updateResponse.json();
            printRowStatus(eventId, error.message || 'Error updating limit.', true);
        }
    } catch (error) {
        console.error('Error updating attendance limit:', error);
        printRowStatus(eventId, 'Error updating limit. See console for details.', true);
    }
}

async function removeAttendanceLimit(eventId) {
    const currentEvent = allAdminEvents.find(event => event.id === eventId);
    if (descriptionLimitConflict(currentEvent, null) !== undefined) {
        printRowStatus(eventId, 'Not effective — this event’s limit comes from its calendar description. Remove it there first.', true);
        return;
    }

    try {
        const updateResponse = await fetch(`${API_BASE_URL}/api/events/${eventId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attendanceLimit: null })
        });

        if (updateResponse.ok) {
            document.getElementById(`limit-${eventId}`).value = '';
            printRowStatus(eventId, 'Limit removed.', false);
        } else {
            const error = await updateResponse.json();
            printRowStatus(eventId, error.message || 'Error removing limit.', true);
        }
    } catch (error) {
        console.error('Error removing attendance limit:', error);
        printRowStatus(eventId, 'Error removing limit. See console for details.', true);
    }
}
