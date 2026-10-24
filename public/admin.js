const API_BASE_URL = window.location.origin;

let allAdminEvents = []; // Global variable to store event data
const linkEditors = new Map(); // event id -> EventLinks editor
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
    const card = document.querySelector(`.event[data-event-id="${CSS.escape(event.id)}"]`);
    if (!card) return;

    const idx = allAdminEvents.findIndex(ev => ev.id === event.id);
    if (idx > -1) allAdminEvents[idx] = { ...allAdminEvents[idx], ...event };

    const input = document.getElementById(`limit-${event.id}`);
    if (input && document.activeElement !== input) {
        input.value = event.attendance_limit || '';
    }
    // Someone else saved links: show them, unless this card is being edited right now.
    const editor = linkEditors.get(event.id);
    const box = document.getElementById(`links-${event.id}`);
    if (editor && event.links && box && !box.contains(document.activeElement)) editor.set(event.links);
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
        eventsList.innerHTML = '<p class="state-line is-error">Could not load events.</p>';
    }
}

// "18:00–20:00", the same 24-hour start and end as Home's meta line. An end on another
// day names that day; no end shows the start alone.
function formatEventTimes(event) {
    const start = new Date(event.date);
    const time = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    // Postgres folds the unquoted endDate column to lowercase, so accept either casing.
    const endRaw = event.endDate || event.enddate || null;
    const end = endRaw ? new Date(endRaw) : null;
    if (!end || !Number.isFinite(end.getTime()) || end <= start) return time(start);
    const endDay = end.toDateString() === start.toDateString()
        ? ''
        : `${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} `;
    return `${time(start)}–${endDay}${time(end)}`;
}

// Home's seat label, without the slots: "5 of 8 spots taken", "3 going".
function seatsLabel(event) {
    const count = event.attendingCount || 0;
    return event.attendance_limit ? `${count} of ${event.attendance_limit} spots taken` : `${count} going`;
}

// Home's event card (renderEvent in app.js): the day numeral, the title with its calendar
// shape, the meta line. The admin card swaps the names and Join for the limit control.
function eventCardHtml(event) {
    const st = styleFor(event);
    const id = escapeAttribute(event.id);
    const date = new Date(event.date);
    const isToday = date.toDateString() === new Date().toDateString();
    const weekday = date.toLocaleDateString('en-GB', { weekday: 'short' });
    const month = date.toLocaleDateString('en-GB', { month: 'short' });
    const location = typeof event.location === 'string' ? event.location : '';
    const meta = [
        `<span class="event-time">${escapeHtml(formatEventTimes(event))}</span>`,
        location ? escapeHtml(location) : '',
        escapeHtml(seatsLabel(event))
    ].filter(Boolean).join('<span class="sep" aria-hidden="true"> · </span>');

    return `
        <article class="event tone-${st.tone}" data-event-id="${id}" aria-labelledby="ev-${id}">
            <div class="event-date">
                <span class="event-day">${date.getDate()}</span>
                <span class="event-daymeta"><span>${escapeHtml(isToday ? 'Today' : weekday)}</span><span>${escapeHtml(month)}</span></span>
            </div>
            <div class="event-body">
                <h2 class="event-title" id="ev-${id}"><span class="event-mark">${shapeSvg(st.shape)}</span>${escapeHtml(event.title)}</h2>
                <p class="event-meta">${meta}</p>
                <div class="limit-row">
                    <label for="limit-${id}">Limit</label>
                    <input type="number" id="limit-${id}" class="input input-num" min="1" inputmode="numeric" value="${event.attendance_limit || ''}" aria-describedby="status-${id}">
                    <button type="button" class="btn btn-line" data-action="update">Save</button>
                    <button type="button" class="text-btn" data-action="remove">Remove limit</button>
                </div>
                <div class="links-block">
                    <p class="links-title" id="links-title-${id}">Links</p>
                    <div id="links-${id}" role="group" aria-labelledby="links-title-${id}"></div>
                    <button type="button" class="btn btn-line" data-action="save-links">Save links</button>
                </div>
                <p class="row-status" id="status-${id}" role="status" hidden></p>
            </div>
        </article>
    `;
}

function displayEvents(events) {
    const eventsList = document.getElementById('admin-events-list');

    if (!events.length) {
        eventsList.innerHTML = '<p class="state-line">No upcoming events.</p>';
        return;
    }

    eventsList.innerHTML = events.map(eventCardHtml).join('');

    linkEditors.clear();
    eventsList.querySelectorAll('.event[data-event-id]').forEach(card => {
        const eventId = card.dataset.eventId;
        const event = events.find(e => e.id === eventId);
        linkEditors.set(eventId, EventLinks.create(document.getElementById(`links-${eventId}`), { links: event && event.links }));
        card.querySelector('[data-action="save-links"]').addEventListener('click', () => saveLinks(eventId));
        card.querySelector('[data-action="update"]').addEventListener('click', () => updateAttendanceLimit(eventId));
        card.querySelector('[data-action="remove"]').addEventListener('click', () => removeAttendanceLimit(eventId));
    });
}

function printRowStatus(eventId, message, isError) {
    const status = document.getElementById(`status-${CSS.escape(eventId)}`);
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', !!isError);
    status.hidden = !message;
}

async function saveLinks(eventId) {
    const editor = linkEditors.get(eventId);
    const bad = editor.invalid();
    if (bad) {
        printRowStatus(eventId, 'That is not a web address. It starts with https://', true);
        bad.focus();
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/api/events/${encodeURIComponent(eventId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ links: editor.value() })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            printRowStatus(eventId, result.message || 'Error saving links.', true);
            return;
        }
        editor.set(result.event.links);
        const n = result.event.links.length;
        printRowStatus(eventId, n ? `Saved ${n} link${n === 1 ? '' : 's'}.` : 'Links removed.', false);
    } catch (error) {
        console.error('Error saving links:', error);
        printRowStatus(eventId, 'Error saving links. See console for details.', true);
    }
}

async function updateAttendanceLimit(eventId) {
    const input = document.getElementById(`limit-${eventId}`);
    const newLimit = input.value ? parseInt(input.value, 10) : null;

    if (newLimit !== null && newLimit <= 0) {
        printRowStatus(eventId, 'Limit must be a positive number.', true);
        return;
    }

    try {
        const updateResponse = await fetch(`${API_BASE_URL}/api/events/${encodeURIComponent(eventId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attendanceLimit: newLimit })
        });

        if (updateResponse.ok) {
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
    try {
        const updateResponse = await fetch(`${API_BASE_URL}/api/events/${encodeURIComponent(eventId)}`, {
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
