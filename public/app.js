// Lilai Home: the date rail and its agenda, the events list and RSVP.

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
    wireAgenda();

    // Both event requests leave now instead of after /api/config answers,
    // so Home's three requests share one round trip.
    prefetchedEvents = fetchFutureEvents();
    prefetchedRail = fetchRailEvents();

    checkAdminDevice();

    loadConfig().then(() => {
        buildCalendarStyles();
        setupCalendar();
        populateCalendarFilter();
        setupFilterPills();
        setupEventListeners();
        setupWebSocket();
        loadEvents().then(pointAtLinkedEvent);
    }).catch(err => console.error('Init error:', err));

    // Card width changes with the viewport, so re-measure which descriptions clamp.
    window.addEventListener('resize', debounce(syncDescriptionToggles, 150));
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(syncDescriptionToggles);
    }
}

// An admin (ADMIN_EMAILS) signed in on this device sees Manage on every card, as a silent
// co-host. Asked only when the device notes a sign-in, so nobody else sends a request for it.
let adminDevice = false;
function checkAdminDevice() {
    if (!window.AccountLink || !AccountLink.signedIn()) return;
    fetch(`${API_BASE_URL}/api/admin/session`, { cache: 'no-store' })
        .then(r => {
            if (!r.ok) return;
            adminDevice = true;
            if (currentEvents.length) displayEvents();
        })
        .catch(() => {});
}

async function manageEvent(button) {
    button.disabled = true;
    try {
        const res = await fetch(`${API_BASE_URL}/api/me/events/${encodeURIComponent(button.dataset.eventId)}/manage`, { method: 'POST' });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.hostPath) {
            window.location.href = body.hostPath;
            return;
        }
        alert(body.message || 'Could not open its management page.');
    } catch (_) {
        alert('Could not open its management page. Check your connection.');
    }
    button.disabled = false;
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

// An emoji in the event title stands in for the shape on the date rail.
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

// The rail's mark for one event: its title emoji, else its calendar's shape.
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
// Requests started at boot. The first load takes each one; later loads (Refresh) fetch afresh.
let prefetchedEvents = null;
let prefetchedRail = null;

function setupCalendar() {
    if (!appConfig.calendars || appConfig.calendars.length === 0) {
        const dd = document.getElementById('add-to-calendar-dropdown');
        if (dd) dd.hidden = true;
        return;
    }

    loadAllCalendarEvents();

    populateAddToCalendarDropdown('add-to-calendar-dropdown');
}

// Links into Home ("/#event-<id>", from the management page and the Google copies): scroll to
// that card once the list is in.
function pointAtLinkedEvent() {
    const match = /^#event-(.+)$/.exec(window.location.hash);
    if (!match) return;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    scrollToEvent(decodeURIComponent(match[1]));
}

// Only the rail's days: every past event ever was most of Home's download.
function fetchRailEvents() {
    const from = startOfDay(new Date());
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + RAIL_DAYS);
    const query = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    return fetch(`${API_BASE_URL}/api/events?${query}`, { cache: 'no-store' });
}

async function loadAllCalendarEvents() {
    try {
        const request = prefetchedRail || fetchRailEvents();
        prefetchedRail = null;
        const res = await request;
        if (!res.ok) return;
        const events = await res.json();
        if (!Array.isArray(events)) return;
        allCalendarEvents = events;
        renderRail();
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

// ---------- The date rail and the two views ----------
// Today and the next 13 days as a row of day buttons (public/js/date-rail.js), each marked
// with its events' emoji or calendar shape. Two views share it. Cards: the events list as
// cards, and tapping a date scrolls to that day's first card. Rows: the cards go away and the
// selected day's events are listed under the rail, each with its own Join.
const RAIL_DAYS = 14;
const VIEW_KEY = 'lilaiHomeView';
let rail = null;
let homeView = 'cards';
// The agenda row tapped open in Rows view, kept across re-renders (live seat counts).
let openAgendaRow = null;

function railMark(ev) {
    const st = styleFor(ev);
    return `<span class="tone-${st.tone}">${bandMark(ev, st)}</span>`;
}

function renderRail() {
    const container = document.getElementById('rail-container');
    if (!container || typeof DateRail === 'undefined') return;
    const events = calendarSource() || [];
    if (!rail) {
        rail = DateRail.create(container, {
            count: RAIL_DAYS,
            events,
            mark: railMark,
            label: 'Pick a day',
            onSelect: (date, day, { via }) => onRailSelect(day, via)
        });
    } else {
        // Past midnight the rail starts on the new today.
        rail.update({ events, today: new Date() });
    }
    const range = document.getElementById('rail-range');
    if (range) range.textContent = DateRail.rangeLabel(rail.days);
    renderAgenda();
}

function onRailSelect(day, via) {
    openAgendaRow = null;
    renderAgenda();
    // Arrow keys only move the selection, so the rail stays in view while stepping.
    if (homeView === 'cards' && via === 'click' && day.events.length) scrollToEvent(day.events[0].id);
}

function agendaHeading(day) {
    const date = day.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const name = day.isToday ? 'Today' : day.date.toLocaleDateString('en-GB', { weekday: 'long' });
    return `${name} · ${date}`;
}

function renderAgenda() {
    const list = document.getElementById('agenda-list');
    if (!list || !rail) return;
    const day = rail.selected;
    const n = day.events.length;
    // Cards view lists a day's events as cards already; the agenda belongs to Rows view.
    document.getElementById('agenda').hidden = homeView === 'cards';
    document.getElementById('agenda-title').textContent = agendaHeading(day);
    document.getElementById('agenda-count').textContent = n === 0 ? '' : `${n} event${n === 1 ? '' : 's'}`;
    if (n === 0) {
        list.innerHTML = '<li class="agenda-empty">No events planned.</li>';
        return;
    }
    const now = Date.now();
    list.innerHTML = day.events.map(ev => {
        const d = new Date(ev.date);
        const isPast = d.getTime() < now;
        const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
        const detail = ev.location || styleFor(ev).name || '';
        const seats = seatsLabel(ev, { isPast });
        const meta = [detail, seats].filter(Boolean).join(' · ');
        let action = '';
        if (!isPast) {
            const label = joinsWaitlist(ev) ? 'Waiting list' : joinLabel(ev);
            action = `<button type="button" class="btn btn-line agenda-join" data-event-id="${escapeAttribute(ev.id)}" aria-label="${escapeAttribute(`${joinLabel(ev)}: ${ev.title}`)}">${label}</button>`;
        }
        const open = ev.id === openAgendaRow;
        const revealId = `agenda-reveal-${ev.id}`;
        return `<li class="agenda-row${isPast ? ' is-past' : ''}${open ? ' is-open' : ''}" data-event-id="${escapeAttribute(ev.id)}">`
            + `<span class="agenda-time">${escapeHtml(time)}</span>`
            + '<span class="agenda-bar" aria-hidden="true"></span>'
            + `<button type="button" class="agenda-main" aria-expanded="${open}" aria-controls="${escapeAttribute(revealId)}">`
            + `<span class="agenda-name">${escapeHtml(ev.title)}</span>`
            + (meta ? `<span class="agenda-meta">${escapeHtml(meta)}</span>` : '')
            + `</button>${action}`
            + `<span class="agenda-reveal" id="${escapeAttribute(revealId)}"${open ? '' : ' hidden'}>`
            + `<button type="button" class="text-btn agenda-to-card" data-event-id="${escapeAttribute(ev.id)}">Show card</button></span>`
            + '</li>';
    }).join('');
}

function wireAgenda() {
    const list = document.getElementById('agenda-list');
    if (list) {
        list.addEventListener('click', e => {
            const join = e.target.closest('.agenda-join');
            if (join) {
                if (join.dataset.eventId) openRsvpModal(join.dataset.eventId);
                return;
            }
            const toCard = e.target.closest('.agenda-to-card');
            if (toCard) {
                showCard(toCard.dataset.eventId);
                return;
            }
            // Anywhere else on a row opens it, revealing the way to its card; a second tap closes it.
            const row = e.target.closest('.agenda-row');
            if (!row) return;
            openAgendaRow = openAgendaRow === row.dataset.eventId ? null : row.dataset.eventId;
            renderAgenda();
        });
    }
    const toTop = document.getElementById('to-top-btn');
    if (toTop) {
        toTop.addEventListener('click', () => {
            const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
        });
    }
    let saved = null;
    try { saved = localStorage.getItem(VIEW_KEY); } catch (_) {}
    setHomeView(saved === 'rows' ? 'rows' : 'cards', { remember: false });
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => setHomeView(btn.dataset.view));
    });
}

// From a row to its card: switch to Cards, then scroll once the list is showing again.
function showCard(id) {
    openAgendaRow = null;
    setHomeView('cards');
    requestAnimationFrame(() => scrollToEvent(id));
}

function setHomeView(view, { remember = true } = {}) {
    homeView = view;
    const home = document.getElementById('home');
    if (home) home.classList.toggle('is-rows', view === 'rows');
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.setAttribute('aria-checked', btn.dataset.view === view ? 'true' : 'false');
    });
    if (remember) {
        try { localStorage.setItem(VIEW_KEY, view); } catch (_) {}
    }
    renderAgenda();
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
        link.innerHTML = `${shapeSvg(st.shape)}<span>${escapeHtml(cal.name)}</span><svg class="subscribe-out" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>`;
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
 * A home-screen app is a separate browser as far as storage goes: iOS gives it its own
 * localStorage, so the flag set in Safari does not follow it, and there is no address bar to
 * type ?admin=1 into. For that, five quick taps on the "Upcoming" heading flip the flag in
 * whatever browser the page is running in, the installed app included. Five more flip it back.
 *
 * Anyone who reads this file learns the path. That is the accepted cost, and it is the same
 * audience that would have typed /admin anyway.
 */
const ADMIN_FLAG_KEY = 'lilaiOrganizer';
const ORGANIZER_TAPS = 5;
const ORGANIZER_TAP_WINDOW_MS = 3000;

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

    showAdminLink(isRememberedOrganizer());
    listenForOrganizerTaps();
}

// The link itself lives in js/account-link.js, so every page with the header shows it.
function showAdminLink(on) {
    if (window.AccountLink) window.AccountLink.showAdmin(on);
}

function listenForOrganizerTaps() {
    const heading = document.getElementById('rail-title');
    if (!heading) return;
    let taps = [];
    heading.addEventListener('click', () => {
        const now = Date.now();
        taps = taps.filter(t => now - t < ORGANIZER_TAP_WINDOW_MS);
        taps.push(now);
        if (taps.length < ORGANIZER_TAPS) return;
        taps = [];
        const on = !isRememberedOrganizer();
        rememberOrganizer(on);
        showAdminLink(on);
    });
}

// ---------- Load events ----------
// Both modes initially load future events only.
// 'all' mode additionally exposes "Load earlier events" to lazy-fetch past batches.
function fetchFutureEvents() {
    const url = `${API_BASE_URL}/api/events?timeRange=future`;
    return fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
}

// quiet: a pull to refresh keeps the current list on screen until the new one arrives.
function loadEvents({ quiet = false } = {}) {
    oldestLoadedDate = null;
    hasMoreOlder = (currentRange === 'all');

    if (!quiet) eventsList.innerHTML = '<p class="state-line">Loading events…</p>';

    const request = prefetchedEvents || fetchFutureEvents();
    prefetchedEvents = null;
    return request
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
            renderRail();
            if (window.renderHosted) window.renderHosted();
            // In 'all' mode, eagerly fetch the first batch of past events so the user
            // doesn't need to click "Load earlier events" to see anything in the past.
            if (currentRange === 'all' && hasMoreOlder) {
                return loadOlderEvents({ preserveScroll: false });
            }
        })
        .catch(err => {
            console.error('Error loading events:', err);
            eventsList.innerHTML = '<p class="state-line is-error">Events did not load. Check your connection, then pull down to refresh.</p>';
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
    const pieces = [];

    if (currentRange === 'all' && hasMoreOlder) {
        pieces.push('<div class="load-earlier-wrap"><button type="button" class="text-btn load-earlier-btn">Load earlier events</button></div>');
    }

    // A month name where the cards cross into a new month (owner, 2026-10-25), and above the
    // first card when it is not in this month. The year shows only when it is not this one.
    const monthKey = d => `${d.getFullYear()}-${d.getMonth()}`;
    let lastMonth = monthKey(now);
    let firstCard = true;

    filtered.forEach(event => {
        const eventDate = new Date(event.date);
        const isPast = eventDate < now;
        const isToday = eventDate >= today && eventDate < new Date(today.getTime() + 86400000);

        const month = monthKey(eventDate);
        if (month !== lastMonth || (firstCard && month !== monthKey(now))) {
            const label = eventDate.toLocaleDateString('en-GB', eventDate.getFullYear() === now.getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' });
            pieces.push(`<h3 class="month-head">${escapeHtml(label)}</h3>`);
        }
        lastMonth = month;
        firstCard = false;

        // Insert today divider between last past and first future event (all range)
        if (currentRange === 'all' && !insertedTodayDivider && !isPast) {
            pieces.push(todayRule);
            insertedTodayDivider = true;
        }

        const prevNames = previous ? previous[event.id] : undefined;
        pieces.push(renderEventCard(event, { isPast, isToday, prevNames }));
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
// The seat count in words, shared by the seat row and the agenda.
// Empty when there is no limit and nobody yet.
function seatsLabel(event, { isPast }) {
    const count = event.attendingCount || 0;
    const hasLimit = event.attendance_limit !== null && event.attendance_limit !== undefined;
    const limit = hasLimit ? event.attendance_limit : null;
    // Requests waiting on the host and the waiting list hold no seat, so they ride after the count.
    const waiting = Array.isArray(event.waitlist) ? event.waitlist.length : 0;
    const asking = (!isPast && event.pendingCount > 0 ? ` · ${event.pendingCount} asking` : '')
        + (!isPast && waiting > 0 ? ` · ${waiting} waiting` : '');
    if (!hasLimit && count === 0) return asking ? `0 going${asking}` : '';
    if (isPast) return `${count} went`;
    if (hasLimit && count >= limit) return `Full · ${count} of ${limit}${asking}`;
    if (hasLimit) return `${count} of ${limit} spots taken${asking}`;
    return `${count} going${asking}`;
}

// A full event takes new names on its waiting list. So does one with a list already, so
// nobody overtakes it (on an approval event a seat can be free while the host decides).
function joinsWaitlist(event) {
    const hasLimit = event.attendance_limit !== null && event.attendance_limit !== undefined;
    const waiting = Array.isArray(event.waitlist) && event.waitlist.length > 0;
    return waiting || (hasLimit && (event.attendingCount || 0) >= event.attendance_limit);
}

// On an approval event, Join asks the host instead of taking a seat.
function joinLabel(event) {
    if (joinsWaitlist(event)) return 'Join the waiting list';
    return event.approval_required ? 'Ask to join' : 'Join';
}

// "1st", "2nd", "3rd", "11th": a place on the waiting list.
function ordinal(n) {
    const teen = n % 100 >= 11 && n % 100 <= 13;
    return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
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

function renderEventCard(event, { isPast, isToday, prevNames }) {
    const eventDate = new Date(event.date);
    const dayNum = String(eventDate.getDate());
    const weekdayAbbr = eventDate.toLocaleDateString('en-GB', { weekday: 'short' });
    const timeStr = eventDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    // Postgres folds the unquoted endDate column to lowercase, so accept either casing.
    const endRaw = event.endDate || event.enddate || null;
    const endDate = endRaw ? new Date(endRaw) : null;
    const hasEnd = endDate && Number.isFinite(endDate.getTime()) && endDate > eventDate;
    const st = styleFor(event);

    const sanitizedEventId = escapeAttribute(event.id);
    const sanitizedTitle = escapeHtml(event.title);
    // The description shows as written in Google Calendar: nothing in it is read as a setting.
    const shownDescription = typeof event.description === 'string' ? event.description.trim() : '';
    const sanitizedDescription = escapeHtml(shownDescription).replace(/\n/g, '<br>');
    const locationText = typeof event.location === 'string' ? event.location : '';

    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    const attendingCount = event.attendingCount || 0;
    const hasLimit = event.attendance_limit !== null && event.attendance_limit !== undefined;
    const isFull = hasLimit && attendingCount >= event.attendance_limit;
    const newFrom = prevNames ? prevNames.size : Infinity;

    // "16:00–18:00" leads the meta line under the title; an end on another day names that day.
    let times = escapeHtml(timeStr);
    if (hasEnd) {
        const endStr = endDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
        const sameDay = endDate.toDateString() === eventDate.toDateString();
        const endDay = sameDay ? '' : `${escapeHtml(endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))} `;
        times += `<span aria-hidden="true">–</span><span class="sr-only"> to </span>${endDay}${escapeHtml(endStr)}`;
    }

    // The title's shape already names the calendar, so the meta line is the time and the place.
    // The event's links sit on their own row under it.
    const hostNote = event.approval_required && event.host_name ? `${escapeHtml(event.host_name)} confirms each place` : '';
    const metaParts = [`<span class="event-time">${times}</span>`, locationText ? escapeHtml(locationText) : '', hostNote].filter(Boolean);
    const meta = `<p class="event-meta">${metaParts.join('<span class="sep" aria-hidden="true"> · </span>')}</p>`
        + EventLinks.listHtml(event.links);

    let names;
    if (attendees.length > 0) {
        names = `<ul class="names" aria-label="${escapeAttribute(isPast ? 'Who went' : 'Who is coming')}">${attendees.map(n => {
            const fresh = prevNames && !prevNames.has(n) ? ' class="is-new"' : '';
            return `<li${fresh}>${escapeHtml(n)}</li>`;
        }).join('')}</ul>`;
    } else {
        names = `<p class="names-empty">${isPast ? 'No one signed up.' : 'No one yet. Be the first.'}</p>`;
    }

    // The chat sits on every card, past ones too: a thread outlives its event (js/event-chat.js).
    const messageCount = event.messageCount || 0;
    const chatLabel = messageCount ? `Chat, ${messageCount} ${messageCount === 1 ? 'message' : 'messages'}` : 'Chat';
    const chat = `<button type="button" class="chat-trigger" data-event-id="${sanitizedEventId}" aria-label="${chatLabel}" title="Chat">`
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4Z"/></svg>'
        + `<span class="chat-count">${messageCount || ''}</span></button>`;

    // This device's name on the waiting list, and where it stands.
    const waitlist = Array.isArray(event.waitlist) ? event.waitlist : [];
    const mine = getRememberedName();
    const place = !isPast && mine ? waitlist.indexOf(mine) + 1 : 0;
    const waitNote = place > 0
        ? `<p class="waitlist-note">${escapeHtml(mine)} is ${ordinal(place)} on the waiting list</p>`
        : '';

    // Admins only: a key opens the event's management page (checkAdminDevice).
    const manage = adminDevice
        ? `<button type="button" class="icon-action manage-trigger" data-event-id="${sanitizedEventId}" aria-label="Manage" title="Manage">`
            + '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M18 12v3M15 12v2"/></svg></button>'
        : '';
    let actions = `<div class="event-actions">${chat}${manage}</div>`;
    if (!isPast) {
        // Every event carries the same weight: no lead event, no solid Join.
        const join = `<button type="button" class="btn btn-line rsvp-trigger-add" data-event-id="${sanitizedEventId}">${joinLabel(event)}</button>`;
        const remove = attendingCount > 0 || waitlist.length > 0
            // An icon, so the row keeps to one line on a phone (owner, 2026-10-25): leave, an
            // arrow out of a door. The name stays for screen readers and the hover tip.
            ? `<button type="button" class="icon-action rsvp-trigger-remove" data-event-id="${sanitizedEventId}" aria-label="Remove a name" title="Remove a name">`
                + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4.5H5.5v15H13M10 12h10M16.5 8.5 20 12l-3.5 3.5"/></svg></button>'
            : '';
        actions = `<div class="event-actions">${join}${remove}${chat}${manage}</div>`;
    }

    const classes = ['event', `tone-${st.tone}`];
    if (isPast) classes.push('is-past');
    if (isToday) classes.push('is-today');
    if (isFull) classes.push('is-full');

    return `
        <article class="${classes.join(' ')}" data-event-id="${sanitizedEventId}" aria-labelledby="ev-${sanitizedEventId}">
            <div class="event-date">
                <span class="event-day">${dayNum}</span>
                <span class="event-daymeta"><span>${escapeHtml(isToday ? 'Today' : weekdayAbbr)}</span></span>
            </div>
            <div class="event-body">
                <h3 class="event-title" id="ev-${sanitizedEventId}"><span class="event-mark">${shapeSvg(st.shape)}</span>${sanitizedTitle}</h3>
                ${meta}
                ${shownDescription ? `
                    <p class="event-desc">${sanitizedDescription}</p>
                    <button type="button" class="text-btn event-desc-toggle" aria-expanded="false" hidden>Show more</button>
                ` : ''}
                ${renderSeats(event, st, { isPast, hasLimit, isFull, newFrom })}
                ${names}
                ${waitNote}
                ${actions}
            </div>
        </article>
    `;
}

// One place to apply a new attendee list, whether it came from our own RSVP or a broadcast.
function applyAttendance(eventId, attendees, pendingCount, waitlist) {
    if (!Array.isArray(attendees)) return; // an older server answered without a list; the broadcast still brings it
    const count = attendees.length;
    [currentEvents, allCalendarEvents].forEach(list => {
        const ev = list.find(e => e.id === eventId);
        if (ev) {
            ev.attendees = attendees.slice();
            ev.attendingCount = count;
            if (typeof pendingCount === 'number') ev.pendingCount = pendingCount;
            if (Array.isArray(waitlist)) ev.waitlist = waitlist.slice();
        }
    });
    displayEvents();
    renderRail();
}

// ---------- RSVP sheets ----------
let lastSheetTrigger = null;

function showFieldError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
}

// "Saturday 3 October, 19:30–21:30": the same start and end as the event's date column.
function formatSheetDate(event) {
    const start = new Date(event.date);
    const time = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const day = start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const endRaw = event.endDate || event.enddate || null;
    const end = endRaw ? new Date(endRaw) : null;
    if (!end || !Number.isFinite(end.getTime()) || end <= start) return `${day}, ${time(start)}`;
    const endDay = end.toDateString() === start.toDateString()
        ? ''
        : `${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} `;
    return `${day}, ${time(start)}–${endDay}${time(end)}`;
}

// The rail's rows can name an event the list is hiding (its calendar unticked), so look in both.
function findEvent(eventId) {
    return currentEvents.find(e => e.id === eventId) || allCalendarEvents.find(e => e.id === eventId);
}

function openRsvpModal(eventId) {
    const event = findEvent(eventId);
    if (!event) return;
    currentEventForRsvp = event;
    lastSheetTrigger = document.activeElement;
    showFieldError('rsvp-error', '');
    rsvpModal.classList.remove('hidden');
    document.getElementById('modal-event-title').textContent = event.title;
    document.getElementById('modal-event-date').textContent = formatSheetDate(event);
    const desc = typeof event.description === 'string' ? event.description.trim() : '';
    const descEl = document.getElementById('modal-event-description');
    descEl.innerHTML = escapeHtml(desc).replace(/\n/g, '<br>');
    descEl.hidden = !desc;
    const linksEl = document.getElementById('modal-event-links');
    linksEl.innerHTML = EventLinks.listHtml(event.links);
    linksEl.hidden = !linksEl.innerHTML;

    const asks = Boolean(event.approval_required);
    const waits = joinsWaitlist(event);
    const approvalNote = document.getElementById('modal-approval-note');
    if (waits) {
        approvalNote.textContent = asks
            ? `Every place is taken. When one opens, the first name on the waiting list goes to ${event.host_name || 'the host'}, who confirms each place.`
            : 'Every place is taken. When one opens, it goes to the first name on the waiting list.';
    } else {
        approvalNote.textContent = asks
            ? `${event.host_name || 'The host'} confirms each place. Your name shows under who is coming once they accept.`
            : '';
    }
    approvalNote.hidden = !asks && !waits;
    document.querySelector('.rsvp-add-btn .text').textContent = waits ? 'Join the waiting list' : asks ? 'Ask to join' : 'Confirm';
    setRsvpSent(false);

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

// After a request to an approval event, or a name on the waiting list, the sheet says so
// instead of closing: no name prints under who is coming.
function setRsvpSent(sent, name = '', position = 0) {
    document.getElementById('rsvp-form-part').hidden = sent;
    const done = document.getElementById('rsvp-sent');
    done.hidden = !sent;
    if (sent) {
        document.getElementById('rsvp-sent-title').textContent = position ? 'On the waiting list' : 'Request sent';
        document.getElementById('rsvp-sent-text').textContent = position
            ? `${name} is ${ordinal(position)} on the waiting list. When a place opens, it goes to the first name on the list.`
            : `${name} is on the host's list. Your name shows under who is coming once they accept.`;
        document.getElementById('rsvp-sent-done').focus();
    }
}

function closeRsvpModal() {
    rsvpModal.classList.add('hidden');
    document.getElementById('attendee-name').value = '';
    currentEventForRsvp = null;
    restoreSheetFocus();
}

// Remove a name asks twice, like Remove on the management page: pick the name, then
// "Remove Ana?" with the name on the button. Keep them closes the sheet.
let removeConfirming = false;

function setRemoveStep(confirming) {
    const event = currentEventForRsvp;
    const name = document.getElementById('attendee-to-remove').value;
    removeConfirming = confirming;
    document.getElementById('remove-pick').hidden = confirming;
    document.getElementById('remove-modal-event-title').textContent = confirming ? `Remove ${name}?` : event.title;
    document.getElementById('remove-modal-event-date').textContent = confirming
        ? `${event.title}, ${formatSheetDate(event)}`
        : formatSheetDate(event);
    document.querySelector('.rsvp-remove-btn .text').textContent = confirming ? `Remove ${name}` : 'Remove';
    document.querySelector('#remove-rsvp-modal .sheet-actions .text-btn').textContent = confirming ? 'Keep them' : 'Keep it';
}

function openRemoveRsvpModal(eventId) {
    const event = findEvent(eventId);
    if (!event) return;
    currentEventForRsvp = event;
    lastSheetTrigger = document.activeElement;
    showFieldError('remove-error', '');
    const modal = document.getElementById('remove-rsvp-modal');
    modal.classList.remove('hidden');
    const selector = document.getElementById('attendee-to-remove');
    selector.innerHTML = '';
    (event.attendees || []).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        selector.appendChild(option);
    });
    // Names on the waiting list leave it the same way. A name both coming and waiting gives
    // up the place first, so it appears once.
    (event.waitlist || []).filter(name => !(event.attendees || []).includes(name)).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = `${name} (waiting list)`;
        selector.appendChild(option);
    });

    // Default to whoever this browser last RSVP'd as. Everyone else stays selectable —
    // this is a starting point, not a restriction.
    const remembered = getRememberedName();
    if (remembered && [...(event.attendees || []), ...(event.waitlist || [])].includes(remembered)) {
        selector.value = remembered;
    }
    setRemoveStep(false);
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
    textEl.textContent = event.approval_required && !joinsWaitlist(event) ? 'Asking…' : 'Joining…';

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
            if (result.pending || result.listed) {
                setRsvpSent(true, attendeeName, result.listed ? result.position : 0);
                applyAttendance(event.id, result.attendees, result.pendingCount, result.waitlist);
                return;
            }
            closeRsvpModal();
            // No toast: the name printing into the list is the confirmation.
            // Apply the server's list, never a patch of ours: the broadcast often lands
            // first, and adding the name again would show it twice.
            applyAttendance(event.id, result.attendees, result.pendingCount, result.waitlist);
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
    if (!removeConfirming) {
        setRemoveStep(true);
        document.querySelector('.rsvp-remove-btn').focus();
        return;
    }
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
            applyAttendance(event.id, result.attendees, result.pendingCount, result.waitlist);
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

        const manageBtn = e.target.closest('.manage-trigger');
        if (manageBtn) {
            manageEvent(manageBtn);
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

    if (typeof PullToRefresh !== 'undefined') {
        PullToRefresh.attach(() => Promise.all([loadEvents({ quiet: true }), loadAllCalendarEvents()]));
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
                const { eventId, attendees, pendingCount, waitlist } = data.payload;
                applyAttendance(eventId, Array.isArray(attendees) ? attendees : [], pendingCount, waitlist);
            } else if (data.type === 'event_message') {
                if (typeof EventChat !== 'undefined') EventChat.onBroadcast(data.payload);
            } else if (['event_created', 'event_update', 'event_cancelled'].includes(data.type)) {
                // An event was made, edited or cancelled: pick it up without a pull to refresh.
                loadEvents({ quiet: true });
                loadAllCalendarEvents();
            }
        } catch (err) {
            console.error('WebSocket message error:', err);
        }
    };
    ws.onclose = () => setTimeout(setupWebSocket, 5000);
    ws.onerror = (err) => console.error('WebSocket error:', err);
}
