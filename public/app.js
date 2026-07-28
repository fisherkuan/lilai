// Event Attendance App - Main JavaScript (redesigned)

// ---------- Utilities ----------
function debounce(func, wait, immediate) {
    let timeout;
    return function () {
        const context = this, args = arguments;
        const later = function () {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

// ---------- Remembered attendee name ----------
// A convenience only: it saves retyping and never gates anything. Anyone can still
// RSVP or cancel under any name — see the trust model this app is built on.
const ATTENDEE_NAME_KEY = 'lilai.attendeeName';

// localStorage throws in Safari private browsing and when storage is disabled, so
// every access is guarded — a browser without it simply behaves as it always did.
function getRememberedName() {
    try {
        const stored = localStorage.getItem(ATTENDEE_NAME_KEY);
        return stored ? stored.trim() : '';
    } catch (_) {
        return '';
    }
}

function rememberName(name) {
    try {
        localStorage.setItem(ATTENDEE_NAME_KEY, name);
    } catch (_) { /* not fatal — the name just won't persist */ }
}

function forgetName() {
    try {
        localStorage.removeItem(ATTENDEE_NAME_KEY);
    } catch (_) { /* nothing to clean up */ }
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/\n/g, '&#10;');
}

function sanitizeUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;
    const trimmed = rawUrl.trim().replace(/[\s"'<>)]*$/, '');
    try {
        const validated = new URL(trimmed);
        if (validated.protocol === 'http:' || validated.protocol === 'https:') {
            return validated.href;
        }
    } catch (error) {
        return null;
    }
    return null;
}

function extractEventLink(value) {
    if (typeof value !== 'string' || value.length === 0) return null;
    const linkMatch = value.match(/link:?\s*(https?:\/\/\S+)/i);
    if (linkMatch) {
        const sanitized = sanitizeUrl(linkMatch[1]);
        if (sanitized) return sanitized;
    }
    const fallbackMatch = value.match(/https?:\/\/\S+/i);
    if (fallbackMatch) {
        const sanitized = sanitizeUrl(fallbackMatch[0]);
        if (sanitized) return sanitized;
    }
    return null;
}

// ---------- Toast ----------
let toastTimeout = null;
function showToast(message, type = 'info', duration = 3500) {
    const existing = document.querySelector('.toast');
    if (existing) {
        existing.remove();
        if (toastTimeout) clearTimeout(toastTimeout);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    toastTimeout = setTimeout(() => {
        toast.remove();
        toastTimeout = null;
    }, duration);
    toast.addEventListener('click', () => {
        toast.remove();
        if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
    });
}

// ---------- State ----------
const API_BASE_URL = window.location.origin;
const PAST_BATCH = 10;

let appConfig = {};
let currentEvents = [];         // events currently shown
let currentRange = 'future';    // 'future' | 'all'
let oldestLoadedDate = null;    // ISO string of earliest loaded event (for 'all' range)
let hasMoreOlder = true;        // whether more past events may exist
let currentEventForRsvp = null;

// DOM
const calendarContainer = document.getElementById('calendar-container');
const eventsList = document.getElementById('events-list');
const rsvpModal = document.getElementById('rsvp-modal');

// ---------- Service Worker ----------
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
    loadConfig().then(() => {
        setupCalendar();
        populateCalendarFilter();
        setupFilterPills();
        setupMobileActions();
        setupEventListeners();
        setupWebSocket();
        loadEvents();
    }).catch(err => console.error('Init error:', err));

    // Card width changes with the viewport, so re-measure which descriptions clamp.
    window.addEventListener('resize', debounce(syncDescriptionToggles, 150));
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(syncDescriptionToggles);
    }
}

// ---------- Config ----------
async function loadConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/config`);
        appConfig = await response.json();
    } catch (error) {
        console.error('Error loading configuration:', error);
        appConfig = {
            calendars: [],
            events: { autoFetch: false, defaultTimeRange: 'future' },
            rsvp: { requireName: true }
        };
    }
}

// ---------- Calendar (custom month grid) ----------
let currentCalendarMonth = null; // { year, month } — month is 0-indexed
let allCalendarEvents = [];      // independent of the events list filter — always all events

function setupCalendar() {
    if (!calendarContainer) return;

    if (!appConfig.calendars || appConfig.calendars.length === 0) {
        calendarContainer.innerHTML = '<p class="calendar-loading">Calendar not configured.</p>';
        const dd = document.getElementById('add-to-calendar-dropdown');
        if (dd && dd.parentElement) dd.parentElement.style.display = 'none';
        return;
    }

    const now = new Date();
    currentCalendarMonth = { year: now.getFullYear(), month: now.getMonth() };
    renderCalendarGrid();
    loadAllCalendarEvents();

    // Join group links (desktop + mobile)
    const joinLink = document.getElementById('join-group-link');
    if (joinLink && appConfig.joinGroupUrl) joinLink.href = appConfig.joinGroupUrl;
    const mobileJoinLink = document.getElementById('mobile-join-group-link');
    if (mobileJoinLink && appConfig.joinGroupUrl) mobileJoinLink.href = appConfig.joinGroupUrl;

    // Add-to-calendar dropdowns (desktop + mobile)
    populateAddToCalendarDropdown('add-to-calendar-dropdown');
    populateAddToCalendarDropdown('mobile-add-to-calendar-dropdown');

    // Point the "Create event" buttons at the configured default calendar (if any)
    wireCreateEventButtons();
}

function wireCreateEventButtons() {
    const defaultName = appConfig.events && appConfig.events.defaultCreateCalendar;
    // The documented "create event in calendar X" endpoint is render?action=TEMPLATE.
    let href = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
    if (defaultName && Array.isArray(appConfig.calendars)) {
        const match = appConfig.calendars.find(c => c.enabled && c.name === defaultName);
        if (match) {
            try {
                const u = new URL(match.url);
                const src = u.searchParams.get('src');
                if (src) {
                    href += `&src=${encodeURIComponent(src)}`;
                }
            } catch (_) { /* ignore */ }
        }
    }
    const desktopBtn = document.getElementById('create-event-btn');
    if (desktopBtn) desktopBtn.href = href;
    const mobileBtn = document.getElementById('mobile-create-event');
    if (mobileBtn) mobileBtn.href = href;
}

async function loadAllCalendarEvents() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/events?timeRange=all`, { cache: 'no-store' });
        if (!res.ok) return;
        const events = await res.json();
        if (!Array.isArray(events)) return;
        allCalendarEvents = events;
        renderCalendarGrid();
    } catch (err) {
        console.error('Error loading all events for calendar:', err);
    }
}

function dayKey(d) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function renderCalendarGrid() {
    if (!calendarContainer || !currentCalendarMonth) return;
    const { year, month } = currentCalendarMonth;

    const first = new Date(year, month, 1);
    const monthLabel = first.toLocaleString(undefined, { month: 'long', year: 'numeric' });

    // Sync the header chip (e.g. "April 2026")
    const chipLabel = document.getElementById('calendar-month-label');
    if (chipLabel) chipLabel.textContent = monthLabel;

    // Monday-first grid: JS getDay() is 0=Sun..6=Sat; shift to 0=Mon..6=Sun
    const leading = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;

    // Calendar always shows ALL events, independent of the events-list filter.
    // Falls back to currentEvents before allCalendarEvents has loaded.
    const calendarSource = allCalendarEvents.length > 0 ? allCalendarEvents : currentEvents;
    const eventsByDay = {};
    (calendarSource || []).forEach(ev => {
        const d = new Date(ev.date);
        const k = dayKey(d);
        if (!eventsByDay[k]) eventsByDay[k] = [];
        eventsByDay[k].push(ev);
    });

    const todayKey = dayKey(new Date());

    let cells = '';
    for (let i = 0; i < totalCells; i++) {
        const cellDate = new Date(year, month, 1 + i - leading);
        const isOut = cellDate.getMonth() !== month;
        const k = dayKey(cellDate);
        const isToday = k === todayKey;
        const dayEvents = (eventsByDay[k] || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));

        const classes = ['cal-cell'];
        if (isOut) classes.push('out');
        if (isToday) classes.push('today');
        if (dayEvents.length > 0) classes.push('has-ev');

        let evMarkup = '';
        if (isToday && dayEvents.length === 0) {
            evMarkup = '<span class="ev">Today</span>';
        } else if (dayEvents.length > 0) {
            const first = dayEvents[0];
            const extra = dayEvents.length > 1 ? ` +${dayEvents.length - 1}` : '';
            const titleAttr = escapeAttribute(dayEvents.map(e => e.title).join(', '));
            evMarkup = `<span class="ev" title="${titleAttr}">${escapeHtml(first.title)}${extra}</span>`;
        }

        const firstId = dayEvents[0] ? dayEvents[0].id : '';
        const clickAttrs = firstId ? ` data-event-id="${escapeAttribute(firstId)}" role="button" tabindex="0"` : '';
        cells += `<div class="${classes.join(' ')}"${clickAttrs}>${cellDate.getDate()}${evMarkup}</div>`;
    }

    calendarContainer.innerHTML = `
        <div class="calendar-preview">
            <div class="cal-month-head">
                <span class="mlabel">${escapeHtml(monthLabel)}</span>
                <div class="arrows">
                    <button type="button" class="cal-nav" data-dir="-1" aria-label="Previous month">&#x2039;</button>
                    <button type="button" class="cal-nav" data-dir="0" aria-label="Jump to today">•</button>
                    <button type="button" class="cal-nav" data-dir="1" aria-label="Next month">&#x203A;</button>
                </div>
            </div>
            <div class="cal-dow">
                <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
            </div>
            <div class="cal-grid">${cells}</div>
            <p class="cal-caption">Events synced from Google Calendar</p>
        </div>
    `;

    calendarContainer.querySelectorAll('.cal-nav').forEach(btn => {
        btn.addEventListener('click', () => {
            const dir = parseInt(btn.dataset.dir, 10);
            if (dir === 0) {
                const n = new Date();
                currentCalendarMonth = { year: n.getFullYear(), month: n.getMonth() };
            } else {
                let m = currentCalendarMonth.month + dir;
                let y = currentCalendarMonth.year;
                if (m < 0) { m = 11; y -= 1; }
                else if (m > 11) { m = 0; y += 1; }
                currentCalendarMonth = { year: y, month: m };
            }
            renderCalendarGrid();
        });
    });

    calendarContainer.querySelectorAll('.cal-cell[data-event-id]').forEach(cell => {
        const activate = () => {
            const id = cell.dataset.eventId;
            const card = document.querySelector(`.event-card[data-event-id="${CSS.escape(id)}"]`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('cal-highlight');
                setTimeout(() => card.classList.remove('cal-highlight'), 1500);
            }
        };
        cell.addEventListener('click', activate);
        cell.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        });
    });
}

function populateAddToCalendarDropdown(id) {
    const dd = document.getElementById(id);
    if (!dd) return;
    dd.innerHTML = '';
    appConfig.calendars.forEach(cal => {
        if (!cal.enabled) return;
        try {
            const u = new URL(cal.url);
            const calendarId = u.searchParams.get('src');
            if (!calendarId) return;
            const link = document.createElement('a');
            link.href = `https://www.google.com/calendar/render?cid=${calendarId}`;
            link.textContent = cal.name;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            dd.appendChild(link);
        } catch (_) { /* ignore */ }
    });
}

// ---------- Calendar filter (chips) ----------
function populateCalendarFilter() {
    const container = document.querySelector('.calendar-filter-container');
    if (!container) return;
    container.innerHTML = '';
    if (!appConfig.calendars || appConfig.calendars.length === 0) return;

    appConfig.calendars.forEach(cal => {
        if (!cal.enabled) return;
        try {
            const u = new URL(cal.url);
            const calendarId = u.searchParams.get('src');
            if (!calendarId) return;
            const label = document.createElement('label');
            label.className = 'calendar-filter-item active';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'calendar-checkbox';
            checkbox.value = calendarId;
            checkbox.checked = true;
            checkbox.addEventListener('change', () => {
                label.classList.toggle('active', checkbox.checked);
                displayEvents();
            });
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(` ${cal.name}`));
            container.appendChild(label);
        } catch (_) { /* ignore */ }
    });
}

// ---------- Filter pills (Upcoming / All) ----------
function setupFilterPills() {
    const pills = document.querySelectorAll('.filter-pill');
    pills.forEach(pill => {
        pill.addEventListener('click', () => {
            const range = pill.dataset.range;
            if (!range || range === currentRange) return;
            pills.forEach(p => {
                p.classList.toggle('active', p === pill);
                p.setAttribute('aria-selected', p === pill ? 'true' : 'false');
            });
            currentRange = range;
            // sync hidden select for any legacy consumer
            const hidden = document.getElementById('time-range');
            if (hidden) hidden.value = range;
            loadEvents();
        });
    });
}

// ---------- Mobile actions ----------
function setupMobileActions() {
    const toggle = document.getElementById('menu-toggle');
    const panel = document.getElementById('menu-panel');
    const backdrop = document.getElementById('menu-backdrop');
    const closeBtn = document.getElementById('menu-close');
    if (!toggle || !panel || !backdrop) return;

    const subscribeDetails = panel.querySelector('.menu-subscribe');

    const openMenu = () => {
        panel.classList.add('open');
        backdrop.hidden = false;
        requestAnimationFrame(() => backdrop.classList.add('visible'));
        toggle.setAttribute('aria-expanded', 'true');
        panel.setAttribute('aria-hidden', 'false');
        document.body.classList.add('menu-open');
    };

    const closeMenu = () => {
        panel.classList.remove('open');
        backdrop.classList.remove('visible');
        toggle.setAttribute('aria-expanded', 'false');
        panel.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('menu-open');
        if (subscribeDetails) subscribeDetails.open = false;
        setTimeout(() => { backdrop.hidden = true; }, 200);
    };

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel.classList.contains('open')) closeMenu(); else openMenu();
    });
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    backdrop.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel.classList.contains('open')) closeMenu();
    });

    panel.querySelectorAll('a[href]').forEach(a => {
        a.addEventListener('click', () => closeMenu());
    });
}

// ---------- Load events ----------
function loadEvents() {
    oldestLoadedDate = null;
    hasMoreOlder = (currentRange === 'all');

    // Both modes initially load future events only.
    // 'all' mode additionally exposes "Load earlier events" to lazy-fetch past batches.
    const url = `${API_BASE_URL}/api/events?timeRange=future`;
    eventsList.innerHTML = '<div class="loading">Loading events...</div>';

    fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
        .then(res => res.json())
        .then(events => {
            events.sort((a, b) => new Date(a.date) - new Date(b.date));
            currentEvents = events;
            if (events.length > 0) {
                oldestLoadedDate = events[0].date;
            } else {
                // No future events — anchor cursor at "now" so past-batch fetch works
                oldestLoadedDate = new Date().toISOString();
            }
            displayEvents({ scrollToToday: currentRange === 'all' });
            renderCalendarGrid();
            // In 'all' mode, eagerly fetch the first batch of past events so the user
            // doesn't need to click "Load earlier events" to see anything in the past.
            if (currentRange === 'all' && hasMoreOlder) {
                loadOlderEvents({ preserveScroll: false });
            }
        })
        .catch(err => {
            console.error('Error loading events:', err);
            eventsList.innerHTML = '<p class="error-message">Error loading events. Please try again later.</p>';
        });
}

async function loadOlderEvents(options = {}) {
    if (!oldestLoadedDate || !hasMoreOlder) return;
    const preserveScroll = options.preserveScroll !== false;
    const btn = document.querySelector('.load-earlier-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

    try {
        const url = `${API_BASE_URL}/api/events?before=${encodeURIComponent(oldestLoadedDate)}&limit=${PAST_BATCH}`;
        const res = await fetch(url, { cache: 'no-store' });
        const older = await res.json();
        if (!Array.isArray(older) || older.length === 0) {
            hasMoreOlder = false;
            displayEvents();
            return;
        }
        older.sort((a, b) => new Date(a.date) - new Date(b.date));
        const existingIds = new Set(currentEvents.map(e => e.id));
        const prepend = older.filter(e => !existingIds.has(e.id));
        if (prepend.length === 0) {
            hasMoreOlder = false;
        } else {
            currentEvents = prepend.concat(currentEvents);
            oldestLoadedDate = currentEvents[0].date;
            if (older.length < PAST_BATCH) hasMoreOlder = false;
        }

        if (preserveScroll) {
            const prevHeight = eventsList.scrollHeight;
            displayEvents();
            const newHeight = eventsList.scrollHeight;
            window.scrollBy(0, newHeight - prevHeight);
        } else {
            displayEvents({ scrollToToday: true });
        }
    } catch (err) {
        console.error('Error loading older events:', err);
        if (btn) { btn.disabled = false; btn.textContent = 'Load earlier events'; }
    }
}

// ---------- Render events ----------
function displayEvents(options = {}) {
    const checkboxes = Array.from(document.querySelectorAll('.calendar-checkbox'));
    const selectedIds = checkboxes.filter(c => c.checked).map(c => c.value);
    const noneSelected = checkboxes.length > 0 && selectedIds.length === 0;
    let filtered = currentEvents;
    // All boxes ticked = no filtering, so events without a source (created via admin)
    // stay visible. Any partial selection — including none — filters strictly.
    if (checkboxes.length > 0 && selectedIds.length < checkboxes.length) {
        filtered = currentEvents.filter(e => selectedIds.includes(e.source));
    }

    // Update events section meta (count of upcoming)
    const metaEl = document.getElementById('events-section-meta');
    if (metaEl) {
        const futureCount = filtered.filter(e => new Date(e.date) >= new Date()).length;
        metaEl.textContent = futureCount === 0
            ? 'No upcoming events'
            : `${futureCount} upcoming event${futureCount === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
        eventsList.innerHTML = noneSelected
            ? '<p class="no-events">No calendars selected.</p>'
            : '<p class="no-events">No events to show.</p>';
        return;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let insertedTodayDivider = false;
    const pieces = [];

    if (currentRange === 'all' && hasMoreOlder) {
        pieces.push(`<div class="load-earlier-wrap"><button class="load-earlier-btn"><span aria-hidden="true">↑</span> Load earlier events</button></div>`);
    }

    filtered.forEach((event, idx) => {
        const eventDate = new Date(event.date);
        const isPast = eventDate < now;
        const isToday = eventDate >= today && eventDate < new Date(today.getTime() + 86400000);

        // Insert today divider between last past and first future event (all range)
        if (currentRange === 'all' && !insertedTodayDivider && !isPast) {
            pieces.push(`<div class="today-divider" id="today-marker"><span class="today-divider-label">Today · ${new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>`);
            insertedTodayDivider = true;
        }

        pieces.push(renderEventCard(event, { isPast, isToday }));
    });

    // If range=all and the divider wasn't inserted (all events are in past),
    // append it at the end to anchor "now"
    if (currentRange === 'all' && !insertedTodayDivider) {
        pieces.push(`<div class="today-divider" id="today-marker"><span class="today-divider-label">Today · ${new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>`);
    }

    eventsList.innerHTML = pieces.join('');

    // The description is line-clamped by CSS, so only measurement can tell whether
    // "Show more" is needed — character counts guess wrong at narrow widths.
    requestAnimationFrame(syncDescriptionToggles);

    // Wire up load-earlier
    const loadBtn = eventsList.querySelector('.load-earlier-btn');
    if (loadBtn) loadBtn.addEventListener('click', loadOlderEvents);

    // Anchor scroll to today divider on initial 'all' load
    if (options.scrollToToday) {
        const marker = document.getElementById('today-marker');
        if (marker) {
            requestAnimationFrame(() => {
                marker.scrollIntoView({ behavior: 'auto', block: 'start' });
            });
        }
    }
}

// Show "Show more" only on descriptions the CSS line-clamp actually truncates.
// Expanded cards keep their toggle: unclamped text always measures as non-overflowing.
function syncDescriptionToggles() {
    eventsList.querySelectorAll('.event-card').forEach(card => {
        const desc = card.querySelector('.event-desc');
        const toggle = card.querySelector('.event-desc-toggle');
        if (!desc || !toggle) return;
        if (card.classList.contains('expanded')) {
            toggle.hidden = false;
            return;
        }
        toggle.hidden = desc.scrollHeight <= desc.clientHeight + 1;
    });
}

// Human-readable duration between start and end (e.g. "3 hrs", "1 hr 30 min", "45 min").
function formatDuration(start, end) {
    const ms = end - start;
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (hours) parts.push(`${hours} hr${hours > 1 ? 's' : ''}`);
    if (minutes) parts.push(`${minutes} min`);
    return parts.join(' ');
}

function renderEventCard(event, { isPast, isToday }) {
    const eventDate = new Date(event.date);
    const dayNum = String(eventDate.getDate()).padStart(2, '0');
    const monthAbbr = eventDate.toLocaleDateString('en-US', { month: 'short' });
    const weekdayAbbr = eventDate.toLocaleDateString('en-US', { weekday: 'short' });
    const timeStr = eventDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    // Postgres folds the unquoted endDate column to lowercase, so accept either casing.
    const endRaw = event.endDate || event.enddate || null;
    const durationStr = endRaw ? formatDuration(eventDate, new Date(endRaw)) : '';

    const sanitizedEventId = escapeAttribute(event.id);
    const sanitizedTitle = escapeHtml(event.title);
    const descriptionText = typeof event.description === 'string' ? event.description : '';
    const sanitizedDescription = escapeHtml(descriptionText).replace(/\n/g, '<br>');
    const locationText = typeof event.location === 'string' ? event.location : '';
    const sanitizedLocation = escapeHtml(locationText);
    const eventLink = extractEventLink(descriptionText);

    const attendeesList = Array.isArray(event.attendees) ? event.attendees.map(escapeHtml) : [];
    const attendeesAttr = escapeAttribute(attendeesList.join('\n'));
    const attendingCount = event.attendingCount || 0;
    const hasLimit = event.attendance_limit !== null && event.attendance_limit !== undefined;
    const isFull = hasLimit && attendingCount >= event.attendance_limit;
    const fillPct = hasLimit ? Math.min(100, Math.round((attendingCount / event.attendance_limit) * 100)) : 0;

    // Chip: status based on fill / past
    let chipHtml = '';
    if (isPast) {
        chipHtml = `<span class="chip"><span class="dot" style="background: var(--text-muted);"></span>Ended</span>`;
    } else if (isFull) {
        chipHtml = `<span class="chip danger"><span class="dot"></span>Full</span>`;
    } else if (hasLimit && fillPct >= 66) {
        chipHtml = `<span class="chip accent"><span class="dot"></span>Filling up</span>`;
    } else if (hasLimit) {
        chipHtml = `<span class="chip"><span class="dot"></span>Open</span>`;
    }

    const attendanceLabel = hasLimit
        ? `${attendingCount} / ${event.attendance_limit} going`
        : `${attendingCount} going`;

    // Side: attend-meter (bar + count) + rsvp-controls. Past events show "N attended" only.
    let sideContent;
    if (isPast) {
        sideContent = `
            <div class="attend-meter">
                <span class="attendance-count" title="${attendeesAttr}" tabindex="0" role="button" aria-label="${escapeHtml(attendingCount + ' attended')}. View attendees."><span class="num">${attendingCount}</span> attended</span>
            </div>
        `;
    } else {
        const barHtml = hasLimit
            ? `<div class="attend-bar"><span style="width: ${fillPct}%;"></span></div>`
            : '';
        const countHtml = hasLimit
            ? `<span><span class="num">${attendingCount}</span> / ${event.attendance_limit}</span>`
            : `<span><span class="num">${attendingCount}</span> going</span>`;
        sideContent = `
            <div class="attend-meter ${isFull ? 'full' : ''}">
                ${barHtml}
                <span class="attendance-count" title="${attendeesAttr}" tabindex="0" role="button" aria-label="${escapeHtml(attendanceLabel)}. View attendees.">
                    ${countHtml}
                </span>
            </div>
            <div class="rsvp-controls">
                <button type="button" class="rsvp-trigger-remove" data-event-id="${sanitizedEventId}" ${attendingCount === 0 ? 'disabled' : ''} aria-label="Remove RSVP" title="Cancel RSVP">−</button>
                <button type="button" class="primary rsvp-trigger-add" data-event-id="${sanitizedEventId}" ${isFull ? 'disabled' : ''} aria-label="RSVP" title="RSVP">＋</button>
            </div>
        `;
    }

    const metaParts = [];
    if (locationText) metaParts.push(`<span>📍 ${sanitizedLocation}</span>`);
    if (durationStr) metaParts.push(`<span>⏱ ${escapeHtml(durationStr)}</span>`);
    if (eventLink) metaParts.push(`<span>🔗 <a href="${escapeAttribute(eventLink)}" target="_blank" rel="noopener noreferrer">Link</a></span>`);
    if (chipHtml) metaParts.push(chipHtml);
    const metaHtml = metaParts.join('');

    const classes = ['event-card'];
    if (isPast) classes.push('past');
    if (isToday) classes.push('today');

    return `
        <article class="${classes.join(' ')}" data-event-id="${sanitizedEventId}">
            <div class="event-date-block">
                <div class="month">${escapeHtml(monthAbbr)}</div>
                <div class="day">${dayNum}</div>
                <div class="weekday">${escapeHtml(weekdayAbbr)}</div>
                <div class="time">${escapeHtml(timeStr)}</div>
            </div>
            <div class="event-body">
                <h3>${sanitizedTitle}</h3>
                <div class="event-meta meta">${metaHtml}</div>
                ${descriptionText ? `
                    <p class="event-description event-desc">${sanitizedDescription}</p>
                    <button type="button" class="event-desc-toggle" aria-expanded="false" hidden>Show more</button>
                ` : ''}
            </div>
            <div class="event-side">
                ${sideContent}
            </div>
        </article>
    `;
}

// ---------- RSVP modals ----------
function openRsvpModal(eventId) {
    const event = currentEvents.find(e => e.id === eventId);
    if (!event) return;
    currentEventForRsvp = event;
    rsvpModal.classList.remove('hidden');
    document.getElementById('modal-event-title').textContent = event.title;
    document.getElementById('modal-event-date').textContent = new Date(event.date).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    const desc = typeof event.description === 'string' ? event.description : '';
    document.getElementById('modal-event-description').innerHTML = escapeHtml(desc).replace(/\n/g, '<br>');

    // Pre-fill the remembered name and select it, so overtyping is a single action.
    const nameInput = document.getElementById('attendee-name');
    const remembered = getRememberedName();
    nameInput.value = remembered;
    const forgetBtn = document.getElementById('forget-name-btn');
    if (forgetBtn) forgetBtn.hidden = !remembered;

    setTimeout(() => {
        nameInput.focus();
        if (remembered) nameInput.select();
    }, 50);
}

function closeRsvpModal() {
    rsvpModal.classList.add('hidden');
    document.getElementById('attendee-name').value = '';
    currentEventForRsvp = null;
}

function openRemoveRsvpModal(eventId) {
    const event = currentEvents.find(e => e.id === eventId);
    if (!event) return;
    currentEventForRsvp = event;
    const modal = document.getElementById('remove-rsvp-modal');
    modal.classList.remove('hidden');
    document.getElementById('remove-modal-event-title').textContent = event.title;
    document.getElementById('remove-modal-event-date').textContent = new Date(event.date).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    const selector = document.getElementById('attendee-to-remove');
    selector.innerHTML = '';
    (event.attendees || []).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        selector.appendChild(option);
    });

    // Default to whoever this browser last RSVP'd as. Everyone else stays selectable —
    // this is a starting point, not a restriction.
    const remembered = getRememberedName();
    if (remembered && (event.attendees || []).includes(remembered)) {
        selector.value = remembered;
    }
}

function closeRemoveRsvpModal() {
    document.getElementById('remove-rsvp-modal').classList.add('hidden');
    currentEventForRsvp = null;
}

function submitRsvp(action) {
    if (!currentEventForRsvp) {
        showToast('No event selected', 'error');
        return;
    }
    const attendeeName = document.getElementById('attendee-name').value.trim();
    if (!attendeeName) {
        showToast('Please enter your name', 'error');
        return;
    }
    const submitBtn = document.querySelector('.rsvp-add-btn');
    const textEl = submitBtn.querySelector('.text');
    const originalText = textEl.textContent;
    submitBtn.disabled = true;
    textEl.textContent = 'Submitting...';

    fetch(`${API_BASE_URL}/api/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: currentEventForRsvp.id, action, attendeeName })
    })
    .then(res => res.json())
    .then(result => {
        submitBtn.disabled = false;
        textEl.textContent = originalText;
        if (result.success) {
            if (navigator.vibrate) navigator.vibrate(30);
            rememberName(attendeeName);
            closeRsvpModal();
            showToast('RSVP confirmed', 'success');
        } else {
            showToast(result.message || 'Error submitting RSVP', 'error');
        }
    })
    .catch(err => {
        console.error('RSVP error:', err);
        submitBtn.disabled = false;
        textEl.textContent = originalText;
        showToast('Connection error — please try again', 'error');
    });
}

function submitRemoveRsvp() {
    if (!currentEventForRsvp) return;
    const attendeeName = document.getElementById('attendee-to-remove').value;
    const submitBtn = document.querySelector('.rsvp-remove-btn');
    const textEl = submitBtn.querySelector('.text');
    const originalText = textEl.textContent;
    submitBtn.disabled = true;
    textEl.textContent = 'Removing...';

    fetch(`${API_BASE_URL}/api/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: currentEventForRsvp.id, action: 'remove', attendeeName })
    })
    .then(res => res.json())
    .then(result => {
        submitBtn.disabled = false;
        textEl.textContent = originalText;
        if (result.success) {
            closeRemoveRsvpModal();
            showToast('RSVP removed', 'success');
        } else {
            showToast(result.message || 'Error removing RSVP', 'error');
        }
    })
    .catch(err => {
        console.error('Remove RSVP error:', err);
        submitBtn.disabled = false;
        textEl.textContent = originalText;
        showToast('Connection error — please try again', 'error');
    });
}

// ---------- Attendee tooltip (mobile) ----------
let activeTooltip = null;
function showAttendeeTooltip(target) {
    removeAttendeeTooltip();
    const names = target.getAttribute('title');
    if (!names || !names.trim()) return;
    const tooltip = document.createElement('div');
    tooltip.className = 'attendee-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    const list = document.createElement('ul');
    names.split('\n').forEach(name => {
        const li = document.createElement('li');
        li.textContent = name;
        list.appendChild(li);
    });
    tooltip.appendChild(list);
    document.body.appendChild(tooltip);
    const rect = target.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    let top = rect.top - tipRect.height - 8 + window.scrollY;
    if (top < window.scrollY + 8) top = rect.bottom + 8 + window.scrollY;
    let left = rect.left;
    if (left + tipRect.width > window.innerWidth - 8) {
        left = window.innerWidth - tipRect.width - 8;
    }
    if (left < 8) left = 8;
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip._owner = target;
    activeTooltip = tooltip;
}
function removeAttendeeTooltip() {
    if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
    }
}

// ---------- Event delegation ----------
function setupEventListeners() {
    // Event card interactions
    eventsList.addEventListener('click', (e) => {
        // Expand/collapse long descriptions
        const toggle = e.target.closest('.event-desc-toggle');
        if (toggle) {
            const card = toggle.closest('.event-card');
            if (card) {
                const expanded = card.classList.toggle('expanded');
                toggle.textContent = expanded ? 'Show less' : 'Show more';
                toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                // Collapsing may reveal that the text now fits (card widened while open).
                if (!expanded) syncDescriptionToggles();
            }
            return;
        }

        // Attendee list tooltip — toggle on click (works on desktop + mobile)
        const attendanceCount = e.target.closest('.attendance-count');
        if (attendanceCount) {
            e.stopPropagation();
            if (activeTooltip && activeTooltip._owner === attendanceCount) {
                removeAttendeeTooltip();
            } else {
                showAttendeeTooltip(attendanceCount);
            }
            return;
        }

        const addBtn = e.target.closest('.rsvp-trigger-add');
        if (addBtn) {
            const eventId = addBtn.dataset.eventId;
            const ev = currentEvents.find(x => x.id === eventId);
            if (!ev) return;
            if (new Date(ev.date) < new Date()) {
                showToast('Past event — RSVP closed', 'error');
                return;
            }
            openRsvpModal(eventId);
            return;
        }

        const removeBtn = e.target.closest('.rsvp-trigger-remove');
        if (removeBtn) {
            const eventId = removeBtn.dataset.eventId;
            const ev = currentEvents.find(x => x.id === eventId);
            if (!ev) return;
            openRemoveRsvpModal(eventId);
            return;
        }
    });

    // "Not you?" — drop the remembered name and start typing from empty.
    const forgetBtn = document.getElementById('forget-name-btn');
    if (forgetBtn) {
        forgetBtn.addEventListener('click', () => {
            forgetName();
            const nameInput = document.getElementById('attendee-name');
            nameInput.value = '';
            forgetBtn.hidden = true;
            nameInput.focus();
        });
    }

    document.addEventListener('click', (e) => {
        if (activeTooltip && !e.target.closest('.attendance-count') && !e.target.closest('.attendee-tooltip')) {
            removeAttendeeTooltip();
        }
    });

    // Desktop hover tooltip for attendee names (skip on coarse pointers / touch)
    const isHoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (isHoverCapable) {
        eventsList.addEventListener('mouseover', (e) => {
            const target = e.target.closest('.attendance-count');
            if (!target) return;
            if (activeTooltip && activeTooltip._owner === target) return;
            showAttendeeTooltip(target);
        });
        eventsList.addEventListener('mouseout', (e) => {
            const target = e.target.closest('.attendance-count');
            if (!target) return;
            const to = e.relatedTarget;
            // Don't close if moving into the tooltip itself
            if (to && (to.closest && to.closest('.attendee-tooltip'))) return;
            removeAttendeeTooltip();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            removeAttendeeTooltip();
            if (!rsvpModal.classList.contains('hidden')) closeRsvpModal();
            const rm = document.getElementById('remove-rsvp-modal');
            if (rm && !rm.classList.contains('hidden')) closeRemoveRsvpModal();
        }
    });

    // Modal backdrop click
    rsvpModal.addEventListener('click', (e) => {
        if (e.target === rsvpModal) closeRsvpModal();
    });
    const removeModal = document.getElementById('remove-rsvp-modal');
    if (removeModal) {
        removeModal.addEventListener('click', (e) => {
            if (e.target === removeModal) closeRemoveRsvpModal();
        });
    }

    // Refresh button
    const refreshBtn = document.getElementById('refresh-events-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', debounce(loadEvents, 250));

    // Donate
    const donateBtn = document.getElementById('donate-btn');
    if (donateBtn) donateBtn.addEventListener('click', donate);

}

// ---------- WebSocket ----------
function setupWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsProtocol}://${window.location.host}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (message) => {
        try {
            const data = JSON.parse(message.data);
            if (data.type === 'attendance_update') {
                const { eventId, attendingCount, attendees } = data.payload;
                const idx = currentEvents.findIndex(e => e.id === eventId);
                if (idx !== -1) {
                    currentEvents[idx].attendingCount = attendingCount;
                    currentEvents[idx].attendees = attendees;
                    displayEvents();
                }
            }
        } catch (err) {
            console.error('WebSocket message error:', err);
        }
    };
    ws.onclose = () => setTimeout(setupWebSocket, 5000);
    ws.onerror = (err) => console.error('WebSocket error:', err);
}

// ---------- Donate ----------
async function donate() {
    try {
        const keyResponse = await fetch(`${API_BASE_URL}/api/stripe-key`);
        const { publicKey } = await keyResponse.json();
        const stripe = window.Stripe(publicKey);
        const response = await fetch(`${API_BASE_URL}/api/create-donation-checkout-session`, { method: 'POST' });
        const session = await response.json();
        const result = await stripe.redirectToCheckout({ sessionId: session.id });
        if (result.error) alert(result.error.message);
    } catch (err) {
        console.error('Donate error:', err);
        alert('Error creating checkout session. Please try again.');
    }
}
