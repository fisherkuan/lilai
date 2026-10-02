// Lilai Home: the 14-day band, the events list and RSVP.

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
    setupAdminLink();
    wireBandReadout();

    loadConfig().then(() => {
        buildCalendarStyles();
        setupCalendar();
        populateCalendarFilter();
        setupFilterPills();
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

// ---------- Calendar shapes ----------
// Each enabled calendar owns one primary shape, in config order. The shape is the
// calendar's identity everywhere: the 14-day band, the event titles, the seat slots.
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

// An emoji in the event title stands in for the shape on the band and its readout.
// Only graphemes that render as emoji by default (or carry VS16) count, so a © or a
// digit in a title keeps the calendar's shape. Without Intl.Segmenter every event keeps its shape.
const titleSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const EMOJI_GRAPHEME = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;

function titleEmoji(title) {
    if (!titleSegmenter || !title) return null;
    for (const { segment } of titleSegmenter.segment(title)) {
        if (EMOJI_GRAPHEME.test(segment)) return segment;
    }
    return null;
}

// The band's mark for one event: its title emoji, else its calendar's shape.
function bandMark(ev, st) {
    const emoji = titleEmoji(ev.title);
    return emoji ? `<span class="band-emoji" aria-hidden="true">${escapeHtml(emoji)}</span>` : shapeSvg(st.shape);
}

function shapeSvg(shape, extraClass = '') {
    return `<svg class="shape s-${shape}${extraClass ? ' ' + extraClass : ''}" aria-hidden="true" focusable="false"><use href="#shape-${shape}"/></svg>`;
}

function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function scrollToEvent(id) {
    const card = document.querySelector(`.event[data-event-id="${CSS.escape(id)}"]`);
    if (!card) {
        revealEvent(id);
        return false;
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.add('is-pointed');
    setTimeout(() => card.classList.remove('is-pointed'), 1600);
    return true;
}

// ---------- Calendar sources ----------
let allCalendarEvents = []; // independent of the events list filter — always all events

function setupCalendar() {
    if (!appConfig.calendars || appConfig.calendars.length === 0) {
        const dd = document.getElementById('add-to-calendar-dropdown');
        if (dd) dd.hidden = true;
        return;
    }

    loadAllCalendarEvents();

    const joinLink = document.getElementById('join-group-link');
    if (joinLink && appConfig.joinGroupUrl) joinLink.href = appConfig.joinGroupUrl;

    populateAddToCalendarDropdown('add-to-calendar-dropdown');

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
            const src = calendarIdFromUrl(match.url);
            if (src) href += `&src=${encodeURIComponent(src)}`;
        }
    }
    const createBtn = document.getElementById('create-event-btn');
    if (createBtn) createBtn.href = href;
}

async function loadAllCalendarEvents() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/events?timeRange=all`, { cache: 'no-store' });
        if (!res.ok) return;
        const events = await res.json();
        if (!Array.isArray(events)) return;
        allCalendarEvents = events;
        renderBand();
    } catch (err) {
        console.error('Error loading all events for calendar:', err);
    }
}

function dayKey(d) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// The band always shows ALL events, independent of the events-list filter.
// It falls back to currentEvents before allCalendarEvents has loaded.
function calendarSource() {
    return allCalendarEvents.length > 0 ? allCalendarEvents : currentEvents;
}

function eventsByDayKey() {
    const byDay = {};
    (calendarSource() || []).forEach(ev => {
        const k = dayKey(new Date(ev.date));
        if (!byDay[k]) byDay[k] = [];
        byDay[k].push(ev);
    });
    Object.values(byDay).forEach(list => list.sort((a, b) => new Date(a.date) - new Date(b.date)));
    return byDay;
}

// ---------- The 14-day band ----------
// Every event in the next two weeks drawn as its calendar's shape, sized by headcount.
const BAND_DAYS = 14;
let bandCounts = null; // eventId -> attendingCount at the last render, to grow shapes on change

function renderBand() {
    const band = document.getElementById('band-container');
    if (!band) return;

    const today = startOfDay(new Date());
    const byDay = eventsByDayKey();
    const nextCounts = {};
    let total = 0;
    const bandEvents = [];

    const days = [];
    for (let i = 0; i < BAND_DAYS; i++) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
        const dayEvents = byDay[dayKey(d)] || [];
        total += dayEvents.length;

        bandEvents.push(...dayEvents);
        const shapes = dayEvents.map(ev => {
            const st = styleFor(ev);
            const count = ev.attendingCount || 0;
            nextCounts[ev.id] = count;
            const grew = bandCounts && bandCounts[ev.id] !== undefined && count > bandCounts[ev.id];
            const when = new Date(ev.date).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const label = `${ev.title}, ${when}, ${count} going`;
            const pressed = ev.id === bandSelectedId ? 'true' : 'false';
            return `<button type="button" class="band-ev tone-${st.tone}${grew ? ' is-grown' : ''}" data-event-id="${escapeAttribute(ev.id)}" style="--n:${Math.min(count, 12)}" aria-label="${escapeAttribute(label)}" aria-pressed="${pressed}">${bandMark(ev, st)}</button>`;
        }).join('');

        const classes = ['band-day'];
        if (i === 0) classes.push('is-today');
        if (d.getDay() === 1) classes.push('is-monday');
        const dow = d.toLocaleDateString('en-GB', { weekday: 'narrow' });
        days.push(`<li class="${classes.join(' ')}"><span class="band-dow" aria-hidden="true">${escapeHtml(dow)}</span><span class="band-date" aria-hidden="true">${d.getDate()}</span><div class="band-shapes">${shapes}</div></li>`);
    }

    bandCounts = nextCounts;
    const metaEl = document.getElementById('events-section-meta');
    if (metaEl) metaEl.textContent = total === 0 ? 'Nothing planned' : `${total} event${total === 1 ? '' : 's'}`;
    const empty = total === 0
        ? '<p class="band-empty">Nothing on the calendar in the next two weeks.</p>'
        : '';
    band.innerHTML = `<ol class="band-days" aria-label="Events in the next 14 days">${days.join('')}</ol>${empty}`;

    bandEventsById = {};
    bandEvents.forEach(ev => { bandEventsById[ev.id] = ev; });
    // A selection whose event has left the band goes with it.
    if (bandSelectedId && !bandEventsById[bandSelectedId]) bandSelectedId = null;
    bandPreviewId = null;
    const nowMs = Date.now();
    const upcoming = bandEvents.find(ev => new Date(ev.date).getTime() >= nowMs);
    bandDefaultId = upcoming ? upcoming.id : null;

    band.querySelectorAll('.band-ev').forEach(btn => {
        const id = btn.dataset.eventId;
        btn.addEventListener('click', () => onBandShapeClick(id));
        btn.addEventListener('pointerenter', () => { if (canHover.matches) previewBandEvent(id); });
        btn.addEventListener('pointerleave', () => { if (canHover.matches) previewBandEvent(null); });
        btn.addEventListener('focus', () => previewBandEvent(id));
        btn.addEventListener('blur', () => previewBandEvent(null));
    });
    renderBandReadout();
}

// ---------- The band readout ----------
// One line under the band names one event: the hovered or focused shape, else the
// selected one, else the next upcoming event. Phones have no hover, so there the
// first tap selects a shape and a second tap (or Show) jumps to its card.
const canHover = window.matchMedia('(hover: hover)');
let bandEventsById = {};
let bandSelectedId = null;
let bandPreviewId = null;
let bandDefaultId = null;
let bandReadoutShownId = null;

function bandReadoutId() {
    return bandPreviewId || bandSelectedId || bandDefaultId;
}

function onBandShapeClick(id) {
    if (canHover.matches || bandSelectedId === id) {
        selectBandEvent(id);
        scrollToEvent(id);
        return;
    }
    selectBandEvent(id);
}

function selectBandEvent(id) {
    bandSelectedId = id;
    document.querySelectorAll('#band-container .band-ev').forEach(btn => {
        btn.setAttribute('aria-pressed', btn.dataset.eventId === id ? 'true' : 'false');
    });
    renderBandReadout();
}

function previewBandEvent(id) {
    bandPreviewId = id;
    renderBandReadout();
}

function bandReadoutText(ev, title = ev.title) {
    const d = new Date(ev.date);
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = [day, time, title];
    const seats = seatsLabel(ev, { isPast: d.getTime() < Date.now() });
    if (seats) parts.push(seats);
    return parts.join(' · ');
}

function renderBandReadout() {
    const readout = document.getElementById('band-readout');
    if (!readout) return;
    const id = bandReadoutId();
    const ev = id ? bandEventsById[id] : null;
    const text = readout.querySelector('.band-readout-text');
    const show = readout.querySelector('.band-readout-show');
    if (!ev) {
        readout.classList.add('is-empty');
        text.textContent = '';
        text.dataset.key = '';
        show.hidden = true;
        bandReadoutShownId = null;
        return;
    }
    const st = styleFor(ev);
    // The shape mark sits inline at the start, so it stays on the first line when the text wraps.
    // Rewrite only on a real change, so a WebSocket re-render does not re-announce the line.
    // An emoji mark is lifted out of the title, so the line does not show it twice.
    const emoji = titleEmoji(ev.title);
    const title = emoji ? (ev.title.replace(emoji, '').replace(/\s+/g, ' ').trim() || ev.title) : ev.title;
    const line = bandReadoutText(ev, title);
    const key = `${st.tone}|${st.shape}|${emoji || ''}|${line}`;
    readout.classList.remove('is-empty');
    if (text.dataset.key !== key) {
        text.innerHTML = `<span class="band-readout-mark tone-${st.tone}" aria-hidden="true">${bandMark(ev, st)}</span>${escapeHtml(line)}`;
        text.dataset.key = key;
    }
    show.hidden = false;
    show.dataset.eventId = ev.id;
    show.setAttribute('aria-label', `Show ${ev.title}`);
    // Motion only when the named event changes.
    if (bandReadoutShownId !== ev.id) {
        readout.classList.remove('is-changed');
        void readout.offsetWidth;
        readout.classList.add('is-changed');
    }
    bandReadoutShownId = ev.id;
}

function wireBandReadout() {
    const show = document.querySelector('#band-readout .band-readout-show');
    if (!show) return;
    show.addEventListener('click', () => {
        if (show.dataset.eventId) scrollToEvent(show.dataset.eventId);
    });
}

function populateAddToCalendarDropdown(id) {
    const dd = document.getElementById(id);
    if (!dd) return;
    dd.innerHTML = '';
    appConfig.calendars.forEach(cal => {
        if (!cal.enabled) return;
        const calendarId = calendarIdFromUrl(cal.url);
        if (!calendarId) return;
        const st = calendarStyleBySource[calendarId] || UNSOURCED_STYLE;
        const link = document.createElement('a');
        link.href = `https://www.google.com/calendar/render?cid=${calendarId}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = `subscribe-link tone-${st.tone}`;
        link.innerHTML = `${shapeSvg(st.shape)}<span>${escapeHtml(cal.name)}</span>`;
        dd.appendChild(link);
    });
}

// ---------- Calendar filter (the shape legend) ----------
// Filters the events list only. The band never reads it.
function populateCalendarFilter() {
    const container = document.querySelector('.calendar-filter-container');
    if (!container) return;
    container.innerHTML = '';
    if (!appConfig.calendars || appConfig.calendars.length === 0) return;

    appConfig.calendars.forEach(cal => {
        if (!cal.enabled) return;
        const calendarId = calendarIdFromUrl(cal.url);
        if (!calendarId) return;
        const st = calendarStyleBySource[calendarId] || UNSOURCED_STYLE;
        const label = document.createElement('label');
        label.className = `legend-item tone-${st.tone}`;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'calendar-checkbox';
        checkbox.value = calendarId;
        checkbox.checked = true;
        checkbox.addEventListener('change', () => displayEvents());
        label.appendChild(checkbox);
        label.insertAdjacentHTML('beforeend', `${shapeSvg(st.shape)}<span>${escapeHtml(cal.name)}</span>`);
        container.appendChild(label);
    });
}

/*
 * The band shows every event of the next 14 days, but the list can be hiding one: an event
 * earlier today has ended, so "Upcoming" drops it, or its calendar is switched off in the
 * legend. Undo whichever is hiding it, then scroll. Tries once, so a missing event cannot loop.
 */
async function revealEvent(id) {
    const event = allCalendarEvents.find(e => e.id === id);
    if (!event) return;
    const boxes = [...document.querySelectorAll('.calendar-checkbox')];
    const box = boxes.find(cb => cb.value === event.source);
    if (box ? !box.checked : boxes.some(cb => !cb.checked)) {
        // No box of its own (an unsourced event) shows only while every box is ticked.
        (box ? [box] : boxes).forEach(cb => { cb.checked = true; });
        displayEvents();
    }
    if (!currentEvents.some(e => e.id === id) && currentRange !== 'all') {
        const allPill = document.querySelector('.filter-pill[data-range="all"]');
        if (allPill) setRangePill(allPill);
        await loadEvents();
        // "All" jumps to the Today marker on the next frame; scroll after it, not before.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    const card = document.querySelector(`.event[data-event-id="${CSS.escape(id)}"]`);
    if (card) scrollToEvent(id);
}

function setRangePill(pill) {
    document.querySelectorAll('.filter-pill').forEach(p => {
        p.classList.toggle('active', p === pill);
        p.setAttribute('aria-selected', p === pill ? 'true' : 'false');
    });
    currentRange = pill.dataset.range;
    // sync hidden select for any legacy consumer
    const hidden = document.getElementById('time-range');
    if (hidden) hidden.value = currentRange;
}

// ---------- Filter pills (Upcoming / All) ----------
function setupFilterPills() {
    const pills = document.querySelectorAll('.filter-pill');
    pills.forEach(pill => {
        pill.addEventListener('click', () => {
            const range = pill.dataset.range;
            if (!range || range === currentRange) return;
            setRangePill(pill);
            loadEvents();
        });
    });
}

// ---------- Organizer entry point ----------
/*
 * The admin pages stay ungated on purpose: the handful of people who run events should not
 * have to log in to fix a typo. What is protected is discovery, not access. The string
 * "/admin" never appears in any served HTML, so view-source shows nothing and a crawler has
 * no link to follow. The header grows an Admin link only on a device that has been told once.
 *
 * Telling a device: open the site as /?admin=1. /?admin=0 makes it forget again, which is
 * what you use on a borrowed phone. The flag lives in localStorage, so it is per device and
 * per browser, and it survives nothing you did not do yourself.
 *
 * Anyone who reads this file learns the path. That is the accepted cost, and it is the same
 * audience that would have typed /admin anyway.
 */
const ADMIN_HOME = '/admin/events';
const ADMIN_FLAG_KEY = 'lilaiOrganizer';

function isRememberedOrganizer() {
    try {
        return localStorage.getItem(ADMIN_FLAG_KEY) === '1';
    } catch (error) {
        return false;
    }
}

function rememberOrganizer(on) {
    try {
        if (on) localStorage.setItem(ADMIN_FLAG_KEY, '1');
        else localStorage.removeItem(ADMIN_FLAG_KEY);
    } catch (error) {
        /* private browsing: this visit still works, the device just will not remember */
    }
}

function setupAdminLink() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('admin')) {
        rememberOrganizer(params.get('admin') !== '0');
        // Drop the switch from the address bar so a shared or bookmarked URL does not carry it.
        params.delete('admin');
        const query = params.toString();
        history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
    }

    if (!isRememberedOrganizer()) return;

    document.querySelectorAll('.app-header-links').forEach(nav => {
        if (nav.querySelector('[data-admin-link]')) return;
        const link = document.createElement('a');
        link.href = ADMIN_HOME;
        link.textContent = 'Admin';
        link.dataset.adminLink = 'true';
        nav.appendChild(link);
    });
}

// ---------- Load events ----------
function loadEvents() {
    oldestLoadedDate = null;
    hasMoreOlder = (currentRange === 'all');

    // Both modes initially load future events only.
    // 'all' mode additionally exposes "Load earlier events" to lazy-fetch past batches.
    const url = `${API_BASE_URL}/api/events?timeRange=future`;
    eventsList.innerHTML = '<p class="state-line">Loading events…</p>';

    return fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
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
            renderBand();
            // In 'all' mode, eagerly fetch the first batch of past events so the user
            // doesn't need to click "Load earlier events" to see anything in the past.
            if (currentRange === 'all' && hasMoreOlder) {
                return loadOlderEvents({ preserveScroll: false });
            }
        })
        .catch(err => {
            console.error('Error loading events:', err);
            eventsList.innerHTML = '<p class="state-line is-error">Events did not load. Check your connection, then press Refresh.</p>';
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
// Past this many places a row of shapes stops reading as seats, so the label says it alone.
const MAX_SLOTS = 10;
let knownAttendees = null; // eventId -> Set of names at the last render, to mark new arrivals

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
    checkboxes.forEach(c => c.closest('.legend-item').classList.toggle('is-off', !c.checked));

    const previous = knownAttendees;
    knownAttendees = {};
    currentEvents.forEach(e => { knownAttendees[e.id] = new Set(e.attendees || []); });

    if (filtered.length === 0) {
        eventsList.innerHTML = noneSelected
            ? '<p class="state-line">No calendars selected. Tick one above to see its events.</p>'
            : '<p class="state-line">No events to show. New ones appear here as soon as they are on the calendar.</p>';
        return;
    }

    const now = new Date();
    const today = startOfDay(now);
    const todayLabel = `Today · ${now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
    const todayRule = `<div class="today-rule" id="today-marker"><span>${escapeHtml(todayLabel)}</span></div>`;
    let insertedTodayDivider = false;
    let markedNext = false;
    const pieces = [];

    if (currentRange === 'all' && hasMoreOlder) {
        pieces.push('<div class="load-earlier-wrap"><button type="button" class="text-btn load-earlier-btn">Load earlier events</button></div>');
    }

    filtered.forEach(event => {
        const eventDate = new Date(event.date);
        const isPast = eventDate < now;
        const isToday = eventDate >= today && eventDate < new Date(today.getTime() + 86400000);

        // Insert today divider between last past and first future event (all range)
        if (currentRange === 'all' && !insertedTodayDivider && !isPast) {
            pieces.push(todayRule);
            insertedTodayDivider = true;
        }

        const isNext = !isPast && !markedNext;
        if (isNext) markedNext = true;
        const prevNames = previous ? previous[event.id] : undefined;
        pieces.push(renderEventCard(event, { isPast, isToday, isNext, prevNames }));
    });

    // If range=all and the divider wasn't inserted (all events are in past),
    // append it at the end to anchor "now"
    if (currentRange === 'all' && !insertedTodayDivider) {
        pieces.push(todayRule);
    }

    eventsList.innerHTML = pieces.join('');

    // The description is line-clamped by CSS, so only measurement can tell whether
    // "Show more" is needed — character counts guess wrong at narrow widths.
    requestAnimationFrame(syncDescriptionToggles);

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
    eventsList.querySelectorAll('.event').forEach(card => {
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

// The seat count in words, shared by the seat row and the band readout.
// Empty when there is no limit and nobody yet.
function seatsLabel(event, { isPast }) {
    const count = event.attendingCount || 0;
    const hasLimit = event.attendance_limit !== null && event.attendance_limit !== undefined;
    const limit = hasLimit ? event.attendance_limit : null;
    if (!hasLimit && count === 0) return '';
    if (isPast) return `${count} went`;
    if (hasLimit && count >= limit) return `Full · ${count} of ${limit}`;
    if (hasLimit) return `${count} of ${limit} spots taken`;
    return `${count} going`;
}

// Seats: one slot per place, drawn only for a small limited event. With no limit, or more
// than MAX_SLOTS places, the label carries the count alone.
// Open slots are outlines, taken slots carry the calendar's colour, a full row turns black.
function renderSeats(event, st, { isPast, hasLimit, isFull, newFrom }) {
    const count = event.attendingCount || 0;
    const shown = hasLimit && event.attendance_limit <= MAX_SLOTS ? event.attendance_limit : 0;

    let slots = '';
    for (let i = 0; i < shown; i++) {
        const taken = i < count;
        const cls = ['slot'];
        if (taken) cls.push('is-taken');
        if (taken && i >= newFrom) cls.push('is-new');
        slots += `<span class="${cls.join(' ')}">${shapeSvg(st.shape)}</span>`;
    }

    // No limit and nobody yet: there is nothing to draw, and the names line already says so.
    const label = seatsLabel(event, { isPast });
    if (!label) return '';

    const row = slots ? `<span class="slots" aria-hidden="true">${slots}</span>` : '';
    return `<div class="seats${isFull ? ' is-full' : ''}">${row}<span class="seats-label">${escapeHtml(label)}</span></div>`;
}

function renderEventCard(event, { isPast, isToday, isNext, prevNames }) {
    const eventDate = new Date(event.date);
    const dayNum = String(eventDate.getDate());
    const monthAbbr = eventDate.toLocaleDateString('en-GB', { month: 'short' });
    const weekdayAbbr = eventDate.toLocaleDateString('en-GB', { weekday: 'short' });
    const timeStr = eventDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    // Postgres folds the unquoted endDate column to lowercase, so accept either casing.
    const endRaw = event.endDate || event.enddate || null;
    const durationStr = endRaw ? formatDuration(eventDate, new Date(endRaw)) : '';
    const st = styleFor(event);

    const sanitizedEventId = escapeAttribute(event.id);
    const sanitizedTitle = escapeHtml(event.title);
    const descriptionText = typeof event.description === 'string' ? event.description : '';
    const sanitizedDescription = escapeHtml(descriptionText).replace(/\n/g, '<br>');
    const locationText = typeof event.location === 'string' ? event.location : '';
    const eventLink = extractEventLink(descriptionText);

    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    const attendingCount = event.attendingCount || 0;
    const hasLimit = event.attendance_limit !== null && event.attendance_limit !== undefined;
    const isFull = hasLimit && attendingCount >= event.attendance_limit;
    const newFrom = prevNames ? prevNames.size : Infinity;

    const metaParts = [];
    if (durationStr) metaParts.push(escapeHtml(durationStr));
    if (locationText) metaParts.push(escapeHtml(locationText));
    if (eventLink) metaParts.push(`<a href="${escapeAttribute(eventLink)}" target="_blank" rel="noopener noreferrer">Event link</a>`);
    if (st.name) metaParts.push(escapeHtml(st.name));

    let names;
    if (attendees.length > 0) {
        names = `<ul class="names" aria-label="${escapeAttribute(isPast ? 'Who went' : 'Who is coming')}">${attendees.map(n => {
            const fresh = prevNames && !prevNames.has(n) ? ' class="is-new"' : '';
            return `<li${fresh}>${escapeHtml(n)}</li>`;
        }).join('')}</ul>`;
    } else {
        names = `<p class="names-empty">${isPast ? 'No one signed up.' : 'No one yet. Be the first.'}</p>`;
    }

    let actions = '';
    if (!isPast) {
        // Only the next event's Join is solid; the rest are outlined, so one black block leads the page.
        const btnStyle = isNext ? 'btn-solid' : 'btn-line';
        const join = isFull
            ? `<button type="button" class="btn ${btnStyle}" disabled>Full</button>`
            : `<button type="button" class="btn ${btnStyle} rsvp-trigger-add" data-event-id="${sanitizedEventId}">Join</button>`;
        const remove = attendingCount > 0
            ? `<button type="button" class="text-btn rsvp-trigger-remove" data-event-id="${sanitizedEventId}">Remove a name</button>`
            : '';
        actions = `<div class="event-actions">${join}${remove}</div>`;
    }

    const classes = ['event', `tone-${st.tone}`];
    if (isPast) classes.push('is-past');
    if (isToday) classes.push('is-today');
    if (isNext) classes.push('is-next');
    if (isFull) classes.push('is-full');

    return `
        <article class="${classes.join(' ')}" data-event-id="${sanitizedEventId}" aria-labelledby="ev-${sanitizedEventId}">
            <div class="event-date">
                <span class="event-day">${dayNum}</span>
                <span class="event-daymeta"><span>${escapeHtml(isToday ? 'Today' : weekdayAbbr)}</span><span>${escapeHtml(monthAbbr)}</span><span class="event-time">${escapeHtml(timeStr)}</span></span>
            </div>
            <div class="event-body">
                <h3 class="event-title" id="ev-${sanitizedEventId}"><span class="event-mark">${shapeSvg(st.shape)}</span>${sanitizedTitle}</h3>
                <p class="event-meta">${metaParts.join('<span class="sep" aria-hidden="true"> · </span>')}</p>
                ${descriptionText ? `
                    <p class="event-desc">${sanitizedDescription}</p>
                    <button type="button" class="text-btn event-desc-toggle" aria-expanded="false" hidden>Show more</button>
                ` : ''}
                ${renderSeats(event, st, { isPast, hasLimit, isFull, newFrom })}
                ${names}
                ${actions}
            </div>
        </article>
    `;
}

// One place to apply a new attendee list, whether it came from our own RSVP or a broadcast.
function applyAttendance(eventId, attendees) {
    if (!Array.isArray(attendees)) return; // an older server answered without a list; the broadcast still brings it
    const count = attendees.length;
    [currentEvents, allCalendarEvents].forEach(list => {
        const ev = list.find(e => e.id === eventId);
        if (ev) {
            ev.attendees = attendees.slice();
            ev.attendingCount = count;
        }
    });
    displayEvents();
    renderBand();
}

// ---------- RSVP sheets ----------
let lastSheetTrigger = null;

function showFieldError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
}

function formatSheetDate(date) {
    return new Date(date).toLocaleString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
    });
}

function openRsvpModal(eventId) {
    const event = currentEvents.find(e => e.id === eventId);
    if (!event) return;
    currentEventForRsvp = event;
    lastSheetTrigger = document.activeElement;
    showFieldError('rsvp-error', '');
    rsvpModal.classList.remove('hidden');
    document.getElementById('modal-event-title').textContent = event.title;
    document.getElementById('modal-event-date').textContent = formatSheetDate(event.date);
    const desc = typeof event.description === 'string' ? event.description : '';
    const descEl = document.getElementById('modal-event-description');
    descEl.innerHTML = escapeHtml(desc).replace(/\n/g, '<br>');
    descEl.hidden = !desc;

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

function restoreSheetFocus() {
    if (lastSheetTrigger && document.contains(lastSheetTrigger)) lastSheetTrigger.focus();
    lastSheetTrigger = null;
}

function closeRsvpModal() {
    rsvpModal.classList.add('hidden');
    document.getElementById('attendee-name').value = '';
    currentEventForRsvp = null;
    restoreSheetFocus();
}

function openRemoveRsvpModal(eventId) {
    const event = currentEvents.find(e => e.id === eventId);
    if (!event) return;
    currentEventForRsvp = event;
    lastSheetTrigger = document.activeElement;
    showFieldError('remove-error', '');
    const modal = document.getElementById('remove-rsvp-modal');
    modal.classList.remove('hidden');
    document.getElementById('remove-modal-event-title').textContent = event.title;
    document.getElementById('remove-modal-event-date').textContent = formatSheetDate(event.date);
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
    setTimeout(() => selector.focus(), 50);
}

function closeRemoveRsvpModal() {
    document.getElementById('remove-rsvp-modal').classList.add('hidden');
    currentEventForRsvp = null;
    restoreSheetFocus();
}

function submitRsvp(action) {
    if (!currentEventForRsvp) return;
    const attendeeName = document.getElementById('attendee-name').value.trim();
    if (!attendeeName) {
        showFieldError('rsvp-error', 'Type your name first.');
        document.getElementById('attendee-name').focus();
        return;
    }
    showFieldError('rsvp-error', '');
    const event = currentEventForRsvp;
    const submitBtn = document.querySelector('.rsvp-add-btn');
    const textEl = submitBtn.querySelector('.text');
    const originalText = textEl.textContent;
    submitBtn.disabled = true;
    textEl.textContent = 'Joining…';

    fetch(`${API_BASE_URL}/api/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, action, attendeeName })
    })
    .then(res => res.json())
    .then(result => {
        submitBtn.disabled = false;
        textEl.textContent = originalText;
        if (result.success) {
            if (navigator.vibrate) navigator.vibrate(30);
            rememberName(attendeeName);
            closeRsvpModal();
            // No toast: the name printing into the list is the confirmation.
            // Apply the server's list, never a patch of ours: the broadcast often lands
            // first, and adding the name again would show it twice.
            applyAttendance(event.id, result.attendees);
        } else {
            showFieldError('rsvp-error', result.message || 'That did not go through. Try again.');
        }
    })
    .catch(err => {
        console.error('RSVP error:', err);
        submitBtn.disabled = false;
        textEl.textContent = originalText;
        showFieldError('rsvp-error', 'No connection. Check your network and try again.');
    });
}

function submitRemoveRsvp() {
    if (!currentEventForRsvp) return;
    const event = currentEventForRsvp;
    const attendeeName = document.getElementById('attendee-to-remove').value;
    const submitBtn = document.querySelector('.rsvp-remove-btn');
    const textEl = submitBtn.querySelector('.text');
    const originalText = textEl.textContent;
    submitBtn.disabled = true;
    textEl.textContent = 'Removing…';

    fetch(`${API_BASE_URL}/api/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, action: 'remove', attendeeName })
    })
    .then(res => res.json())
    .then(result => {
        submitBtn.disabled = false;
        textEl.textContent = originalText;
        if (result.success) {
            closeRemoveRsvpModal();
            // The server's list, not ours minus one name: when the broadcast lands first,
            // subtracting again would hide a second person with the same name.
            applyAttendance(event.id, result.attendees);
        } else {
            showFieldError('remove-error', result.message || 'That did not go through. Try again.');
        }
    })
    .catch(err => {
        console.error('Remove RSVP error:', err);
        submitBtn.disabled = false;
        textEl.textContent = originalText;
        showFieldError('remove-error', 'No connection. Check your network and try again.');
    });
}

// ---------- Event delegation ----------
function setupEventListeners() {
    eventsList.addEventListener('click', (e) => {
        // Expand/collapse long descriptions
        const toggle = e.target.closest('.event-desc-toggle');
        if (toggle) {
            const card = toggle.closest('.event');
            if (card) {
                const expanded = card.classList.toggle('expanded');
                toggle.textContent = expanded ? 'Show less' : 'Show more';
                toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                // Collapsing may reveal that the text now fits (card widened while open).
                if (!expanded) syncDescriptionToggles();
            }
            return;
        }

        const addBtn = e.target.closest('.rsvp-trigger-add');
        if (addBtn) {
            const ev = currentEvents.find(x => x.id === addBtn.dataset.eventId);
            if (!ev || new Date(ev.date) < new Date()) return;
            openRsvpModal(ev.id);
            return;
        }

        const removeBtn = e.target.closest('.rsvp-trigger-remove');
        if (removeBtn) {
            const ev = currentEvents.find(x => x.id === removeBtn.dataset.eventId);
            if (!ev) return;
            openRemoveRsvpModal(ev.id);
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

    // Enter in the name field confirms.
    document.getElementById('attendee-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitRsvp('add'); }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!rsvpModal.classList.contains('hidden')) closeRsvpModal();
            const rm = document.getElementById('remove-rsvp-modal');
            if (rm && !rm.classList.contains('hidden')) closeRemoveRsvpModal();
        }
    });

    // Backdrop click closes a sheet
    rsvpModal.addEventListener('click', (e) => {
        if (e.target === rsvpModal) closeRsvpModal();
    });
    const removeModal = document.getElementById('remove-rsvp-modal');
    if (removeModal) {
        removeModal.addEventListener('click', (e) => {
            if (e.target === removeModal) closeRemoveRsvpModal();
        });
    }

    const refreshBtn = document.getElementById('refresh-events-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', debounce(() => {
            loadEvents();
            loadAllCalendarEvents();
        }, 250));
    }
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
                const { eventId, attendees } = data.payload;
                applyAttendance(eventId, Array.isArray(attendees) ? attendees : []);
            }
        } catch (err) {
            console.error('WebSocket message error:', err);
        }
    };
    ws.onclose = () => setTimeout(setupWebSocket, 5000);
    ws.onerror = (err) => console.error('WebSocket error:', err);
}
