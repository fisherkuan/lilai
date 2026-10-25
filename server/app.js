const express = require('express');
const cors = require('cors');
const compression = require('compression');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const WebSocket = require('ws');

const { weekBounds } = require('./booking-time');
const { validateBooking, BookingInputError } = require('./booking-validation');
const { QUOTA_PER_WEEK, countHeld, quotaFor, reportFailure } = require('./booking-quota');
const { bookingSettings, sampleSendAfter, graceDeadline } = require('./booking-settings');
const { createBookingSchema } = require('./booking-schema');
const { BookingFormClient, readFormOptions } = require('./booking-form');
const { createScheduler } = require('./booking-scheduler');
const { findStaleEventIds, looksLikeIcsFeed } = require('./calendar-sync');
const { readServiceAccount, createGoogleCalendar } = require('./google-calendar');
const hosting = require('./event-hosting');
const { createPublisher } = require('./calendar-publish');
const { createPlaceAutocomplete } = require('./place-autocomplete');
const places = require('./places');
const adminAuthLib = require('./admin-auth');
const contactsLib = require('./contacts');
const chatLib = require('./event-chat');
const { importCalendar, createImportSchema, importedCalendarIds } = require('./calendar-import');
const access = require('./calendar-access');
const activity = require('./event-activity');
const waitingList = require('./waiting-list');
const { sanitizeHtmlText } = require('./html-text');
const { mergeContact, sendAfterForEdit } = require('./booking-edit');
const {
    expandRepeat, validateRule, describeRule, RepeatError, UNITS, MAX_EVERY, MAX_OCCURRENCES
} = require('./booking-repeat');
const { readBankDetails, renderEpcQrSvg } = require('./donation-bank');
const { createSeriesSchema, toSeriesView, LIST_SQL: SERIES_LIST_SQL, ONE_SQL: SERIES_ONE_SQL } = require('./booking-series');
const feedback = require('./feedback');
const {
    createProfileSchema, publicProfile, fullProfile, validateProfile
} = require('./booking-profiles');

// Load environment variables
require('dotenv').config();

// Validate required environment variables at startup
const requiredEnvVars = ['DATABASE_URL', 'ADMIN_API_KEY'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
}

const app = express();
// Heroku's router is the one proxy in front, so req.ip is the visitor (the place search's budget).
app.set('trust proxy', 1);

/*
 * Express 4 does not catch a rejected async handler: the request never answers, and Node
 * treats the rejection as fatal for the whole process. Every async route defined below is
 * wrapped so an unexpected error — a pool timeout before a handler's own try, or a rethrow
 * that means "this is not input trouble" — reaches the error middleware and becomes a 500.
 */
for (const method of ['get', 'post', 'put', 'delete']) {
    const define = app[method].bind(app);
    app[method] = (path, ...handlers) => handlers.length === 0
        ? define(path) // app.get('setting') is a getter, not a route
        : define(path, ...handlers.map((handler) => handler.constructor.name !== 'AsyncFunction'
            ? handler
            : (req, res, next) => handler(req, res, next).catch(next)));
}
const PORT = process.env.PORT || 3000;

// Middleware
// gzip: the band's events JSON and app.js shrink about 5x, which is most of their transfer time.
app.use(compression());
app.use(cors());
// Feedback carries its attachments base64 in the body, so it gets a larger limit. The
// general parser below skips a body that is already parsed.
app.use('/api/feedback', bodyParser.json({ limit: feedback.BODY_LIMIT }), (err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    next(err);
});
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from public directory
// The admin pages' files open only through their gated routes.
app.get(['/admin-donations.html', '/admin-places.html'], (req, res) => {
    res.redirect(302, req.path === '/admin-places.html' ? '/admin/places' : '/admin/donations');
});
app.use(express.static(path.join(__dirname, '../public')));

const isProduction = process.env.NODE_ENV === 'production';

// When the calendar feed was last pulled into the DB, to reduce external API calls
let calendarCache = {
    lastFetch: 0,
    refreshing: null // the in-flight refresh, so concurrent requests start only one
};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

/*
 * Heroku Postgres closes idle connections now and then (maintenance, failover, a credential
 * rotation). pg reports that as an 'error' event on the pool, and an 'error' event nobody
 * listens to ends the process: one dropped idle connection took the whole app down. The pool
 * has already discarded the dead client and opens a fresh one on the next query.
 */
pool.on('error', (error) => {
    console.error('Idle database connection dropped:', error.message);
});

// The saved places, held in memory (server/places.js); loaded once the schema exists.
const placeStore = places.createPlaceStore(pool);

// Admin sign-in by emailed code (server/admin-auth.js), for Donations and Places.
const adminAuth = adminAuthLib.createAdminAuth({ pool });

// Chat in an event (server/event-chat.js): anyone reads and likes, a signed-in email posts.
const chat = chatLib.createEventChat({ pool });

// Sign-in: a link by email, then a device session (server/contacts.js). The
// address's name is also its chat name, so changing it renames its messages.
const contacts = contactsLib.createContacts({ pool, onRename: chat.renameAuthor });

// Threads that read differently after a name change redraw.
function broadcastRenamed(renamedIn) {
    for (const eventId of renamedIn) broadcast({ type: 'event_message', payload: { action: 'renamed', eventId } });
}

// Read once at startup: an invalid IBAN stops the server rather than reaching a donor.
const bankDetails = readBankDetails();

// Lilai owns events; each Google calendar is a published copy, written through the API as a
// service account. Without GOOGLE_SERVICE_ACCOUNT_JSON events still work in Lilai and their
// copies wait; a key that is set but unreadable stops startup.
const serviceAccount = readServiceAccount();
const googleCalendar = serviceAccount ? createGoogleCalendar(serviceAccount) : null;
if (googleCalendar) {
    console.log(`Publishing to Google Calendar: share each calendar with ${googleCalendar.clientEmail} ("Make changes to events")`);
}
// Calendars Lilai has taken over from Google (calendar-import.js). The legacy feed is read
// only for the others.
let importedCalendars = new Set();

// Input validation helpers
function validateAttendeeName(name) {
    if (typeof name !== 'string') return null;
    const trimmed = name.trim();

    // Check length constraints
    if (trimmed.length === 0 || trimmed.length > 100) return null;

    // Block potential XSS patterns
    if (/<script|javascript:|onerror=|onclick=|onload=/i.test(trimmed)) return null;

    return trimmed;
}

// Load configuration
let appConfig = {};
try {
    appConfig = require('../config/app.json');
} catch (error) {
    console.error('Error loading config file:', error);
    appConfig = {
        calendars: [],
        events: { autoFetch: false, defaultTimeRange: 'future', refreshInterval: 300000 },
        rsvp: { allowAnonymous: false, requireName: true }
    };
}

// Links in emails and in the Google copies point here. PUBLIC_URL overrides it (local runs).
if (process.env.PUBLIC_URL) appConfig.publicUrl = process.env.PUBLIC_URL;

// Google Maps search for the event form's Where field; off without a key.
const placeAutocomplete = createPlaceAutocomplete({
    apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    referer: appConfig.publicUrl ? `${String(appConfig.publicUrl).replace(/\/+$/, '')}/` : ''
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

/*
 * Heroku's router closes any connection that carries no bytes for 55 seconds and logs it
 * as H15. This socket only speaks when an RSVP lands, which is silent for far longer than
 * that, so every idle client was being cut and reconnecting five seconds later, all day.
 *
 * A ping is bytes. It resets the router's timer, and it doubles as the liveness check we
 * did not have: a connection that died without a close frame sits in readyState OPEN for
 * ever, and broadcast() would keep writing to it.
 */
const HEARTBEAT_MS = 30000;

wss.on('connection', ws => {
    console.log('Client connected');
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // A malformed frame is an 'error' on this socket; unheard, it ends the process. ws closes
    // the connection itself, so logging is all that is left to do.
    ws.on('error', (error) => {
        console.error('WebSocket client error:', error.message);
    });
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        // Missed the whole interval without answering the last ping: it is gone.
        if (ws.isAlive === false) {
            ws.terminate();
            return;
        }
        ws.isAlive = false;
        ws.ping();
    });
}, HEARTBEAT_MS);
// Never a reason to hold the process open on the heartbeat's account.
heartbeat.unref();
wss.on('close', () => clearInterval(heartbeat));

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function unfoldIcsValue(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/\r\n\s/g, '') // Remove line folding per RFC 5545
        .replace(/\n\s/g, '');
}

function decodeIcsText(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

function extractIcsField(block, fieldName) {
    const regex = new RegExp(`${fieldName}:([\\s\\S]*?)(?=\\n[A-Z][A-Z0-9-]*:|$)`);
    const match = block.match(regex);
    if (!match) {
        return '';
    }

    const unfolded = unfoldIcsValue(match[1]);
    const decoded = decodeIcsText(unfolded);
    return sanitizeHtmlText(decoded);
}

// Initialize database schema
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS events (
                id VARCHAR(255) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                date TIMESTAMPTZ NOT NULL,
                description TEXT,
                location VARCHAR(255),
                source VARCHAR(255),
                endDate TIMESTAMPTZ,
                attendance_limit INTEGER
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS rsvps (
                id VARCHAR(255) PRIMARY KEY,
                event_id VARCHAR(255) REFERENCES events(id) ON DELETE CASCADE,
                attendee_name VARCHAR(255) NOT NULL,
                attendance VARCHAR(255) NOT NULL,
                timestamp TIMESTAMPTZ NOT NULL
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS donations (
                id VARCHAR(255) PRIMARY KEY,
                amount DECIMAL(10, 2) NOT NULL,
                description TEXT,
                donator VARCHAR(255),
                entry_date TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        
        // Add donator column if it doesn't exist (for existing tables)
        try {
            await client.query('ALTER TABLE donations ADD COLUMN donator VARCHAR(255)');
        } catch (error) {
            // Column already exists, ignore the error
            if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
                console.error('Error adding donator column:', error);
            }
        }
        
        // Add entry_date column if it doesn't exist (for existing tables)
        try {
            await client.query('ALTER TABLE donations ADD COLUMN entry_date TIMESTAMPTZ');
        } catch (error) {
            // Column already exists, ignore the error
            if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
                console.error('Error adding entry_date column:', error);
            }
        }
        
        // Remove created_by column if it exists (for existing tables)
        try {
            await client.query('ALTER TABLE donations DROP COLUMN IF EXISTS created_by');
        } catch (error) {
            // Ignore errors if column doesn't exist or can't be dropped
            console.log('Note: created_by column removal attempted (may not exist):', error.message);
        }

        await hosting.createHostingSchema(client);
        const activitySeeded = await activity.createActivitySchema(client);
        if (activitySeeded > 0) console.log(`[activity] event log started from ${activitySeeded} RSVPs on file.`);
        await createImportSchema(client);
        await access.createCalendarAccessSchema(client);
        await createBookingSchema(client);
        await createSeriesSchema(client);
        await feedback.createFeedbackSchema(client);
        await adminAuthLib.createAdminAuthSchema(client);
        await contactsLib.createContactsSchema(client);
        await chatLib.createChatSchema(client);
        const placesSeeded = await places.createPlacesSchema(client, appConfig.places || []);
        if (placesSeeded) console.log(`📍 Saved ${placesSeeded} places from config/app.json`);
        const seeded = await createProfileSchema(client, uuidv4);
        if (seeded.created > 0) {
            console.log(`[bookings] address book seeded from the queue: ${seeded.created} people, ${seeded.linked} entries linked.`);
        }

        // Create indexes for performance
        await client.query('CREATE INDEX IF NOT EXISTS idx_rsvps_event_id ON rsvps(event_id)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_rsvps_attendance ON rsvps(attendance)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_events_date ON events(date)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_events_source ON events(source)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_donations_entry_date ON donations(COALESCE(entry_date, created_at))');


        console.log('Database schema initialized with indexes.');
    } catch (error) {
        console.error('Error initializing database schema:', error);
    } finally {
        client.release();
    }
}

// Pull the legacy feed into the DB, for calendars not yet imported. One refresh at a time; it never throws, because
// nobody awaits it. The attempt time counts as the fetch time, so a failing feed is
// retried once per TTL rather than on every request.
function refreshCalendar() {
    if (calendarCache.refreshing) return calendarCache.refreshing;
    calendarCache.lastFetch = Date.now();
    calendarCache.refreshing = (async () => {
        try {
            await syncCalendarToDb(await fetchCalendarEvents());
            console.log('Calendar events fetched from Google Calendar');
        } catch (error) {
            console.error('Calendar refresh failed:', error);
        } finally {
            calendarCache.refreshing = null;
        }
    })();
    return calendarCache.refreshing;
}

// Whether any calendar still comes from its legacy feed.
function legacyFeedNeeded() {
    return publishedCalendars().some(c => !importedCalendars.has(c.id));
}

// The calendar id inside a configured embed, iCal or calendar URL, or null.
function calendarIdOf(calendarUrl) {
    let match = null;
    if (calendarUrl.includes('src=')) {
        match = calendarUrl.match(/src=([^&]+)/);
    } else if (calendarUrl.includes('calendar.google.com/calendar/ical/')) {
        match = calendarUrl.match(/ical\/([^\/]+)\//);
    } else {
        match = calendarUrl.match(/calendar\/([^\/?&]+)/);
    }
    return match ? decodeURIComponent(match[1]) : null;
}

// Every enabled calendar, as Lilai publishes it. A restricted one takes a calendar key to
// write to (calendar-access.js).
function publishedCalendars() {
    return (appConfig.calendars || [])
        .filter(c => c.enabled)
        .map(c => ({ name: c.name, id: calendarIdOf(c.url), restricted: Boolean(c.restricted) }))
        .filter(c => c.id);
}

function calendarById(id) {
    return publishedCalendars().find(c => c.id === id) || null;
}

// Function to fetch events from Google Calendar
async function fetchCalendarEvents() {
    if (!appConfig.calendars || appConfig.calendars.length === 0) {
        return { events: [], unreadSources: new Set() };
    }

    const allEvents = [];
    const unreadSources = new Set(); // calendars whose feed failed: their events must not be deleted
    for (const calendarEntry of appConfig.calendars) {
        if (!calendarEntry.enabled) {
            continue;
        }
        const calendarUrl = calendarEntry.url;
        const calendarId = calendarIdOf(calendarUrl);
        // A calendar Lilai has taken over is never read back: its events live here.
        if (calendarId && importedCalendars.has(calendarId)) {
            unreadSources.add(calendarId);
            continue;
        }

        if (!calendarId) {
            console.warn(`Could not extract calendar ID from URL: ${calendarUrl}`);
            continue;
        }

        try {
            const icalUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
            const response = await fetch(icalUrl);
            if (!response.ok) {
                console.error(`Error fetching calendar from ${icalUrl}: HTTP ${response.status}: ${response.statusText}`);
                unreadSources.add(calendarId);
                continue;
            }

            const icsText = await response.text();
            if (!looksLikeIcsFeed(icsText)) {
                console.error(`Calendar ${calendarId} answered with something that is not iCalendar`);
                unreadSources.add(calendarId);
                continue;
            }
            const veventBlocks = icsText.split('BEGIN:VEVENT').slice(1);
            
            for (const block of veventBlocks) {
                const summaryMatch = block.match(/SUMMARY:(.*)/);
                const dtstartMatch = block.match(/DTSTART(?:;[^:]+)?:([0-9T]+)/);
                const dtendMatch = block.match(/DTEND(?:;[^:]+)?:([0-9T]+)/);
                const uidMatch = block.match(/UID:(.*)/);
                const description = extractIcsField(block, 'DESCRIPTION');
                const location = extractIcsField(block, 'LOCATION');

                if (summaryMatch && dtstartMatch && uidMatch) {
                    let start = dtstartMatch[1];
                    if (start.length === 8) {
                        start = `${start.slice(0,4)}-${start.slice(4,6)}-${start.slice(6,8)}T00:00:00Z`;
                    } else if (start.length === 15 && start.endsWith('Z')) {
                        start = `${start.slice(0,4)}-${start.slice(4,6)}-${start.slice(6,8)}T${start.slice(9,11)}:${start.slice(11,13)}:${start.slice(13,15)}Z`;
                    } else if (start.length === 15 && start.includes('T')) {
                        start = `${start.slice(0,4)}-${start.slice(4,6)}-${start.slice(6,8)}T${start.slice(9,11)}:${start.slice(11,13)}:${start.slice(13,15)}Z`;
                    } else {
                        continue;
                    }

                    let end = dtendMatch ? dtendMatch[1] : null;
                    if (end) {
                        if (end.length === 8) {
                            end = `${end.slice(0,4)}-${end.slice(4,6)}-${end.slice(6,8)}T00:00:00Z`;
                        } else if (end.length === 15 && end.endsWith('Z')) {
                            end = `${end.slice(0,4)}-${end.slice(4,6)}-${end.slice(6,8)}T${end.slice(9,11)}:${end.slice(11,13)}:${end.slice(13,15)}Z`;
                        } else if (end.length === 15 && end.includes('T')) {
                            end = `${end.slice(0,4)}-${end.slice(4,6)}-${end.slice(6,8)}T${end.slice(9,11)}:${end.slice(11,13)}:${end.slice(13,15)}Z`;
                        }
                    }

                    const eventId = `cal-${uidMatch[1]}`.trim();
                    
                    allEvents.push({
                        id: eventId,
                        title: summaryMatch[1].replace(/\n/g, '\n').trim(),
                        date: start,
                        endDate: end,
                        description,
                        location,
                        source: calendarId
                    });
                }
            }
        } catch (error) {
            console.error(`Error fetching calendar ${calendarId}:`, error);
            unreadSources.add(calendarId);
        }
    }
    return { events: allEvents, unreadSources };
}


// API Routes

// Get configuration
app.get('/api/config', (req, res) => {
    try {
        res.json({
            ...appConfig,
            eventCreation: {
                publishing: Boolean(googleCalendar),
                calendars: publishedCalendars().map(c => ({ name: c.name, restricted: c.restricted }))
            }
        });
    } catch (error) {
        console.error('Error fetching config:', error);
        res.status(500).json({ error: 'Failed to fetch configuration' });
    }
});

// Bank details for the Donate page. 404 when none are configured.
app.get('/api/donation-details', (req, res) => {
    if (!bankDetails) {
        return res.status(404).json({ error: 'Donations by transfer are not set up' });
    }
    // Masked IBAN only: the full one travels in the QR code, not in page text.
    res.json({
        accountHolder: bankDetails.accountHolder,
        ibanMasked: bankDetails.ibanMasked,
        payLink: bankDetails.payLink
    });
});

// The full IBAN, fetched only when a donor presses Copy, so it stays out of page text.
app.get('/api/donation-iban', (req, res) => {
    if (!bankDetails) {
        return res.status(404).json({ error: 'Donations by transfer are not set up' });
    }
    res.set('Cache-Control', 'no-store').json({ iban: bankDetails.iban });
});

// SEPA "scan to pay" QR code for the same details.
app.get('/api/donation-qr.svg', async (req, res) => {
    if (!bankDetails) {
        return res.status(404).end();
    }
    try {
        const svg = await renderEpcQrSvg(bankDetails);
        res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
    } catch (error) {
        console.error('Error rendering donation QR code:', error);
        res.status(500).end();
    }
});

// Write one legacy feed snapshot to the DB: upsert every event, delete the ones the feed
// dropped. A calendar in unreadSources was not read, so none of its events count as dropped.
// A managed row is Lilai's: the feed neither overwrites nor deletes it.
async function syncCalendarToDb({ events: calendarEvents, unreadSources }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Until a calendar is imported, Google owns what it shows (title, time, description,
        // place); the limit, the links and the host fields are Lilai's and never touched here.
        if (calendarEvents.length > 0) {
            // Dedupe by id (last wins, like the per-row upserts did) — a
            // repeated id in one multi-row INSERT is a Postgres error.
            const rowsById = new Map();
            for (const event of calendarEvents) {
                rowsById.set(event.id, [event.id, event.title, event.date, event.endDate, event.description, event.location, event.source]);
            }

            // One multi-row upsert — per-row statements cost a network
            // round trip each, which is fatal when the DB isn't local.
            const upsertParams = [];
            const placeholders = [];
            for (const row of rowsById.values()) {
                const base = upsertParams.length;
                placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
                upsertParams.push(...row);
            }
            await client.query(
                `INSERT INTO events (id, title, date, endDate, description, location, source)
                 VALUES ${placeholders.join(', ')}
                 ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    date = EXCLUDED.date,
                    endDate = EXCLUDED.endDate,
                    description = EXCLUDED.description,
                    location = EXCLUDED.location,
                    source = EXCLUDED.source
                 WHERE events.managed = FALSE`,
                upsertParams
            );
        }

        // Remove deleted calendar events
        const dbEventsResult = await client.query('SELECT id, source FROM events WHERE source IS NOT NULL AND managed = FALSE');
        const staleEventIds = findStaleEventIds(dbEventsResult.rows, calendarEvents, unreadSources);

        if (staleEventIds.length > 0) {
            await client.query(`DELETE FROM events WHERE id = ANY($1::varchar[])`, [staleEventIds]);
        }

        await client.query('COMMIT');
    } catch (error) {
        // Without ROLLBACK the released connection poisons the pool.
        try { await client.query('ROLLBACK'); } catch (rollbackError) { /* connection gone */ }
        throw error;
    } finally {
        client.release();
    }
}

// Get all events
app.get('/api/events', async (req, res) => {
    const client = await pool.connect();
    try {
        const timeRange = req.query.timeRange || appConfig.events.defaultTimeRange;

        // Lilai's own events are already here. A calendar not yet taken over from Google is
        // still read from its feed, behind the request: a visitor never waits for Google.
        if (appConfig.events.autoFetch && legacyFeedNeeded() && Date.now() - calendarCache.lastFetch > CACHE_TTL) {
            refreshCalendar();
        }

        // Paginated past-events mode: ?before=<ISO>&limit=N
        // Returns events strictly before the cursor, newest-first, capped by limit.
        const beforeParam = req.query.before;
        let beforeCursor = null;
        if (beforeParam) {
            const d = new Date(beforeParam);
            if (!isNaN(d.getTime())) {
                beforeCursor = d;
            }
        }

        // Window mode: ?from=<ISO>&to=<ISO> returns events starting in [from, to).
        // The 14-day band uses it, so it no longer downloads every past event.
        const fromDate = new Date(req.query.from);
        const toDate = new Date(req.query.to);
        const windowed = req.query.from && req.query.to
            && !isNaN(fromDate.getTime()) && !isNaN(toDate.getTime());

        const parsedLimit = parseInt(req.query.limit, 10);
        const limit = (Number.isFinite(parsedLimit) && parsedLimit > 0)
            ? Math.min(parsedLimit, 100)
            : null;

        let whereClause = '';
        let orderClause = 'ORDER BY e.date';
        let limitClause = '';
        const params = [];

        if (beforeCursor) {
            params.push(beforeCursor.toISOString());
            whereClause = `WHERE e.date < $${params.length} AND e.cancelled_at IS NULL`;
            orderClause = 'ORDER BY e.date DESC';
            if (limit) {
                params.push(limit);
                limitClause = `LIMIT $${params.length}`;
            }
        } else if (windowed) {
            params.push(fromDate.toISOString(), toDate.toISOString());
            whereClause = 'WHERE e.date >= $1 AND e.date < $2 AND e.cancelled_at IS NULL';
        } else {
            switch (timeRange) {
                case 'future':
                    whereClause = 'WHERE e.date > NOW() AND e.cancelled_at IS NULL';
                    break;
                case 'past':
                    whereClause = 'WHERE e.date < NOW() AND e.cancelled_at IS NULL';
                    break;
                case 'all':
                default:
                    whereClause = 'WHERE e.cancelled_at IS NULL';
                    break;
            }
            if (limit) {
                params.push(limit);
                limitClause = `LIMIT $${params.length}`;
            }
        }

        const eventsResult = await client.query(`
            SELECT
                e.*,
                COALESCE(r.attendingCount, 0) as "attendingCount",
                r.attendees,
                COALESCE(r.pendingCount, 0) as "pendingCount",
                r.waitlist,
                COALESCE(m.messageCount, 0) as "messageCount"
            FROM events e
            LEFT JOIN (
                SELECT
                    event_id,
                    COUNT(*) FILTER (WHERE attendance = 'yes') as attendingCount,
                    array_agg(attendee_name ORDER BY timestamp) FILTER (WHERE attendance = 'yes') as attendees,
                    COUNT(*) FILTER (WHERE attendance = 'pending') as pendingCount,
                    array_agg(attendee_name ORDER BY timestamp, id) FILTER (WHERE attendance = 'waiting') as waitlist
                FROM rsvps
                GROUP BY event_id
            ) r ON e.id = r.event_id
            LEFT JOIN (
                SELECT event_id, COUNT(*) as messageCount FROM event_messages GROUP BY event_id
            ) m ON e.id = m.event_id
            ${whereClause}
            ${orderClause}
            ${limitClause}
        `, params);

        const eventsWithAttendance = eventsResult.rows.map(event => ({
            ...hosting.publicEvent(event),
            attendingCount: parseInt(event.attendingCount, 10),
            pendingCount: parseInt(event.pendingCount, 10),
            attendees: event.attendees || [],
            waitlist: event.waitlist || [],
            messageCount: parseInt(event.messageCount, 10)
        }));

        res.json(eventsWithAttendance);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    } finally {
        client.release();
    }
});

// What a repeat rule lands on, for the form's preview: the server's own expansion, so the
// sheet cannot promise a date the server would refuse. Before /api/events/:id, which would
// otherwise read "repeat-preview" as an id.
app.get('/api/events/repeat-preview', (req, res) => {
    const rule = {
        every: Number(req.query.every),
        unit: req.query.unit,
        weekdays: String(req.query.weekdays || '').split(',').filter(Boolean).map(Number),
        until: String(req.query.until || '')
    };
    try {
        const dates = expandRepeat(String(req.query.date || ''), rule, { cap: hosting.MAX_OCCURRENCES, noun: 'events' });
        res.json({ dates });
    } catch (error) {
        if (error instanceof RepeatError) return res.status(400).json({ error: error.message });
        throw error;
    }
});

// Get a specific event. A cancelled one is gone for the public.
app.get('/api/events/:id', async (req, res) => {
    const result = await pool.query('SELECT * FROM events WHERE id = $1 AND cancelled_at IS NULL', [req.params.id]);
    const event = result.rows[0];
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(hosting.publicEvent(event));
});

// Who holds a seat, how many requests wait for the host, and the waiting list in order. One
// shape for the RSVP answer, the broadcast and the host page.
async function attendanceOf(client, eventId) {
    const result = await client.query(
        `SELECT attendee_name, attendance FROM rsvps
         WHERE event_id = $1 AND attendance IN ('yes', 'pending', 'waiting') ORDER BY ${waitingList.ORDER}`,
        [eventId]
    );
    const named = status => result.rows.filter(r => r.attendance === status).map(r => r.attendee_name);
    const attendees = named(hosting.STATUS.YES);
    return {
        eventId,
        attendingCount: attendees.length,
        attendees,
        pendingCount: named(hosting.STATUS.PENDING).length,
        waitlist: named(hosting.STATUS.WAITING)
    };
}

// An RSVP refused inside the transaction: rolled back, answered with its status and message.
class RsvpRefusal extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const JOIN_KIND = { yes: 'joined', pending: 'asked', waiting: 'listed' };

// Submit RSVP. "add" takes a place; on an event whose host approves each person it asks to
// join instead ('pending', no seat until the host accepts). On a full event it joins the
// waiting list. "remove" gives up a place or a spot on the list, and the first name waiting
// moves up into what opened. All of it under the event row's lock, so two people cannot both
// take the last place.
app.post('/api/rsvp', async (req, res) => {
    const { eventId, action, attendeeName } = req.body;

    if (!eventId || !action) {
        return res.status(400).json({ success: false, message: 'Event ID and action are required' });
    }

    if (!['add', 'remove'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Invalid action. Must be "add" or "remove"' });
    }

    const validatedName = validateAttendeeName(attendeeName);
    if (!validatedName) {
        return res.status(400).json({
            success: false,
            message: action === 'add'
                ? 'Invalid attendee name. Name must be 1-100 characters and contain no scripts.'
                : 'Invalid attendee name'
        });
    }

    const client = await pool.connect();
    let status = null;
    let attendance;
    try {
        await client.query('BEGIN');
        const eventResult = await client.query('SELECT * FROM events WHERE id = $1 AND cancelled_at IS NULL FOR UPDATE', [eventId]);
        const event = eventResult.rows[0];
        if (!event) throw new RsvpRefusal(404, 'Event not found');

        if (action === 'add') {
            const counts = await waitingList.counts(client, eventId);
            status = waitingList.joinStatus({ limit: event.attendance_limit, approval: event.approval_required, ...counts });
            // One open request and one spot on the list per name: a second would only show the
            // host a duplicate. Two people may share a name in the places themselves.
            const watched = event.approval_required ? ['yes', 'pending', 'waiting'] : status === hosting.STATUS.WAITING ? ['waiting'] : [];
            const existing = watched.length ? await client.query(
                'SELECT attendance FROM rsvps WHERE event_id = $1 AND attendee_name = $2 AND attendance = ANY($3) LIMIT 1',
                [eventId, validatedName, watched]
            ) : { rows: [] };
            const already = existing.rows[0]?.attendance;
            if (already === hosting.STATUS.YES) throw new RsvpRefusal(400, `${validatedName} already has a place.`);
            if (already === hosting.STATUS.PENDING) throw new RsvpRefusal(400, `${validatedName} has already asked. The host decides.`);
            if (already === hosting.STATUS.WAITING) throw new RsvpRefusal(400, `${validatedName} is already on the waiting list.`);
            await client.query(
                'INSERT INTO rsvps (id, event_id, attendee_name, attendance, timestamp) VALUES ($1, $2, $3, $4, $5)',
                [uuidv4(), eventId, validatedName, status, new Date()]
            );
            await activity.logActivity(client, eventId, JOIN_KIND[status], { name: validatedName });
        } else {
            // A place first, else a spot on the list: someone holding both left the place.
            const gone = await client.query(
                `DELETE FROM rsvps WHERE id IN (
                    SELECT id FROM rsvps WHERE event_id = $1 AND attendee_name = $2 AND attendance IN ('yes', 'waiting')
                    ORDER BY (attendance = 'yes') DESC, timestamp DESC LIMIT 1)
                 RETURNING attendance`,
                [eventId, validatedName]
            );
            const left = gone.rows[0]?.attendance;
            if (left) await activity.logActivity(client, eventId, left === hosting.STATUS.WAITING ? 'leftlist' : 'left', { name: validatedName });
            await waitingList.promote(client, event);
        }
        attendance = await attendanceOf(client, eventId);
        await client.query('COMMIT');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { /* connection gone */ }
        if (error instanceof RsvpRefusal) return res.status(error.status).json({ success: false, message: error.message });
        console.error('Error submitting RSVP:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }

    broadcast({ type: 'attendance_update', payload: attendance });

    const pending = status === hosting.STATUS.PENDING;
    const listed = status === hosting.STATUS.WAITING;
    const position = listed ? attendance.waitlist.lastIndexOf(validatedName) + 1 : null;
    let message = `RSVP ${action === 'add' ? 'added' : 'removed'} successfully`;
    if (pending) message = 'Request sent. The host decides.';
    if (listed) message = `${validatedName} is ${waitingList.ordinal(position)} on the waiting list.`;

    // The list goes back in the response too. The broadcast above usually reaches the
    // caller first, so a client that patched its own copy would apply the change twice.
    res.json({ success: true, pending, listed, position, message, ...attendance });
});


// ---------------------------------------------------------------------------
// Making and managing events. Lilai's database holds them; the publisher copies each change to
// its Google calendar (calendar-publish.js).
// ---------------------------------------------------------------------------

function inputError(res, error) {
    if (error instanceof hosting.EventInputError) {
        res.status(400).json({ success: false, field: error.field, message: error.message });
        return true;
    }
    return false;
}

// The calendars a request may write to: the open ones, and each restricted one that a calendar
// key sent with it opens.
async function writableCalendars(keys) {
    const opened = await access.calendarsForKeys(pool, keys);
    return publishedCalendars().filter(c => !c.restricted || opened.has(c.name));
}

const EVENT_FIELDS_SQL = `title = $2, date = $3, endDate = $4, location = $5, description = $6, links = $7,
    attendance_limit = $8, approval_required = $9, location_address = $10, place_id = $11`;

function eventFieldParams(id, edit, start, end) {
    return [id, edit.title, start, end, edit.location || null, edit.description || null,
        JSON.stringify(edit.links), edit.limit, edit.approval, edit.locationAddress || null, edit.placeId || null];
}

// A change the Google copy must follow: next version, pushed as soon as the publisher runs.
const NEEDS_PUSH_SQL = 'version = version + 1, updated_at = NOW(), push_attempts = 0, push_error = NULL, next_push_at = NULL';

// Make an event, or a repeating one (one row per date, one series). Open to anyone signed in;
// the host email is the signed-in one, never typed. A restricted calendar takes one of its keys.
app.post('/api/events', async (req, res) => {
    const signedIn = await contacts.emailOf(req);
    if (!signedIn) return res.status(401).json({ success: false, field: 'hostEmail', message: 'Sign in to make an event.' });
    const calendars = publishedCalendars();
    let input;
    try {
        input = hosting.validateEvent({ ...req.body, hostEmail: signedIn }, { mode: 'create', calendars: calendars.map(c => c.name), places: placeList(), allowAnyPlace: !placeAutocomplete.enabled });
    } catch (error) {
        if (inputError(res, error)) return;
        throw error;
    }
    const calendar = calendars.find(c => c.name === input.calendar);
    const writable = await writableCalendars(req.body?.calendarKeys);
    if (!writable.some(c => c.name === calendar.name)) {
        return res.status(403).json({
            success: false,
            field: 'calendar',
            message: `Only ${calendar.name}'s admins can add events to it. Open your ${calendar.name} calendar link on this device first.`
        });
    }

    const token = hosting.newToken();
    const seriesId = input.occurrences.length > 1 ? uuidv4() : null;
    const ids = [];
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (seriesId) {
            await client.query('INSERT INTO event_series (id, rule) VALUES ($1, $2)', [seriesId, JSON.stringify(input.repeat)]);
        }
        for (const occurrence of input.occurrences) {
            const googleId = hosting.newGoogleEventId();
            const id = hosting.eventIdForGoogleId(googleId);
            ids.push(id);
            await client.query(
                `INSERT INTO events (id, title, date, endDate, location, description, links, attendance_limit,
                                     approval_required, location_address, place_id, source, host_name, host_email,
                                     google_calendar_id, google_event_id, series_id,
                                     managed, version, synced_version, created_in_app_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $12, $15, $16, TRUE, 1, 0, NOW(), NOW())`,
                [...eventFieldParams(id, input, occurrence.start, occurrence.end),
                    calendar.id, input.hostName, input.hostEmail, googleId, seriesId]
            );
            await activity.logActivity(client, id, 'created', { name: input.hostName });
            if (input.hostJoins) {
                await client.query(
                    'INSERT INTO rsvps (id, event_id, attendee_name, attendance, timestamp) VALUES ($1, $2, $3, $4, NOW())',
                    [uuidv4(), id, input.hostName, hosting.STATUS.YES]
                );
                await activity.logActivity(client, id, 'joined', { name: input.hostName });
            }
        }
        await client.query(
            'INSERT INTO event_host_links (id, token_hash, event_id, series_id, created_via) VALUES ($1, $2, $3, $4, $5)',
            [uuidv4(), hosting.hashToken(token), seriesId ? null : ids[0], seriesId, 'create']
        );
        await client.query('COMMIT');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { /* connection gone */ }
        throw error;
    } finally {
        client.release();
    }

    publisher.nudge();
    broadcast({ type: 'event_created', payload: { ids } });
    // The host's new name follows their email to their other devices.
    if (input.hostName) broadcastRenamed((await contacts.setName(signedIn, input.hostName)).renamedIn);

    const hostPath = `/host/${token}`;
    const emailed = input.hostEmail
        ? await hosting.mailHostLink({ to: input.hostEmail, title: input.title, url: publicUrl(req) + hostPath, count: ids.length })
            .catch((error) => {
                console.error('Host link mail failed:', error.message);
                return false;
            })
        : false;

    res.status(201).json({
        success: true,
        id: ids[0],
        ids,
        count: ids.length,
        date: input.occurrences[0].start.toISOString(),
        hostPath,
        emailed,
        publishing: Boolean(googleCalendar)
    });
});

// The address links point at: config's publicUrl, else the request's own origin.
function publicUrl(req) {
    if (appConfig.publicUrl) return appConfig.publicUrl.replace(/\/+$/, '');
    return `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
}

// A management link -> what it covers: { eventId } or { seriesId }. Null for a bad link.
async function hostScope(token) {
    if (!hosting.looksLikeToken(token)) return null;
    const result = await pool.query('SELECT event_id, series_id FROM event_host_links WHERE token_hash = $1', [hosting.hashToken(token)]);
    const row = result.rows[0];
    return row ? { eventId: row.event_id, seriesId: row.series_id } : null;
}

/*
 * The event a link manages: the one asked for, when the link covers it; else the link's own
 * event, or for a series its next date still on (then its next date, then its latest).
 */
async function linkedEvent(db, scope, eventId, { lock = false } = {}) {
    const forUpdate = lock ? ' FOR UPDATE' : '';
    if (scope.eventId) {
        if (eventId && eventId !== scope.eventId) return null;
        return (await db.query(`SELECT * FROM events WHERE id = $1${forUpdate}`, [scope.eventId])).rows[0] || null;
    }
    if (eventId) {
        return (await db.query(`SELECT * FROM events WHERE id = $1 AND series_id = $2${forUpdate}`, [eventId, scope.seriesId])).rows[0] || null;
    }
    return (await db.query(
        `SELECT * FROM events WHERE series_id = $1
         ORDER BY (date < NOW()), (cancelled_at IS NOT NULL), CASE WHEN date >= NOW() THEN date END, date DESC
         LIMIT 1`,
        [scope.seriesId]
    )).rows[0] || null;
}

// Everything the management page draws, for one event (and its series).
async function hostView(event) {
    const requests = await pool.query(
        `SELECT id, attendee_name, attendance, timestamp FROM rsvps WHERE event_id = $1 ORDER BY ${waitingList.ORDER}`,
        [event.id]
    );
    const calendar = calendarById(event.source);
    let series = null;
    if (event.series_id) {
        const [rule, dates] = await Promise.all([
            pool.query('SELECT rule FROM event_series WHERE id = $1', [event.series_id]),
            pool.query(
                `SELECT e.id, e.date, e.cancelled_at,
                        (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.attendance = 'yes')::int AS "attendingCount"
                 FROM events e WHERE e.series_id = $1 ORDER BY e.date`,
                [event.series_id]
            )
        ]);
        const r = rule.rows[0]?.rule;
        series = {
            rule: r ? `${describeRule(r)}, until ${r.until}` : '',
            dates: dates.rows.map(d => ({ id: d.id, date: d.date, cancelled: Boolean(d.cancelled_at), attendingCount: d.attendingCount }))
        };
    }
    return {
        success: true,
        event: {
            ...hosting.publicEvent(event),
            host_email: event.host_email,
            ...(await attendanceOf(pool, event.id)),
            cancelled: Boolean(event.cancelled_at),
            calendar: calendar ? { name: calendar.name, restricted: calendar.restricted } : null,
            publish: hosting.publishState(event, { publishing: Boolean(googleCalendar) }),
            form: hosting.formValues(event)
        },
        requests: requests.rows.map(r => ({ id: r.id, name: r.attendee_name, status: r.attendance, at: r.timestamp })),
        activity: await activity.listActivity(pool, event.id),
        messages: await chat.forHost(event),
        series
    };
}

// Resolve link + event for a write, inside a transaction with the event row locked.
async function lockLinkedEvent(client, req, res) {
    const scope = await hostScope(req.params.token);
    const event = scope ? await linkedEvent(client, scope, req.params.eventId, { lock: true }) : null;
    if (!event) {
        res.status(404).json({ success: false, message: 'This link does not open that event.' });
        return null;
    }
    if (!event.managed) {
        res.status(409).json({ success: false, message: 'Lilai has not taken this calendar over from Google yet, so it cannot change this event.' });
        return null;
    }
    return event;
}

// One write to a linked event, in a transaction. `work` returns the ids it changed, or null
// when it already answered.
async function withLinkedEvent(req, res, work) {
    const client = await pool.connect();
    let changed;
    let event;
    try {
        await client.query('BEGIN');
        event = await lockLinkedEvent(client, req, res);
        if (!event) {
            await client.query('ROLLBACK');
            return null;
        }
        changed = await work(client, event);
        if (!changed) {
            await client.query('ROLLBACK');
            return null;
        }
        await client.query('COMMIT');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { /* connection gone */ }
        if (inputError(res, error)) return null;
        throw error;
    } finally {
        client.release();
    }
    const fresh = (await pool.query('SELECT * FROM events WHERE id = $1', [event.id])).rows[0];
    return { changed, fresh };
}

app.get('/api/host/:token', async (req, res) => {
    const scope = await hostScope(req.params.token);
    const event = scope ? await linkedEvent(pool, scope, req.query.event || null) : null;
    if (!event) return res.status(404).json({ success: false, message: 'This link does not open any event.' });
    res.set('Cache-Control', 'no-store').json(await hostView(event));
});

// One 'edited' row naming the fields that changed; an edit that changed nothing logs nothing.
async function logEdit(client, before) {
    const after = (await client.query('SELECT * FROM events WHERE id = $1', [before.id])).rows[0];
    const fields = activity.changedFields(hosting.formValues(before), hosting.formValues(after));
    if (fields.length) await activity.logActivity(client, before.id, 'edited', { detail: fields.join(', ') });
}

// Edit. On a repeating event, scope 'later' gives the same changes to every later date still
// on, each keeping its own day.
app.put('/api/host/:token/events/:eventId', async (req, res) => {
    const result = await withLinkedEvent(req, res, async (client, event) => {
        const edit = hosting.validateEvent(req.body, { mode: 'edit', current: event, places: placeList(), allowAnyPlace: !placeAutocomplete.enabled });
        await client.query(`UPDATE events SET ${EVENT_FIELDS_SQL}, ${NEEDS_PUSH_SQL} WHERE id = $1`,
            eventFieldParams(event.id, edit, edit.start, edit.end));
        await logEdit(client, event);
        const changed = [event.id];
        if (edit.scope === 'later' && event.series_id) {
            const later = await client.query(
                `SELECT * FROM events WHERE series_id = $1 AND date > $2 AND cancelled_at IS NULL ORDER BY date FOR UPDATE`,
                [event.series_id, event.date]
            );
            for (const row of later.rows) {
                let times;
                try {
                    times = hosting.laterTimes(row, edit);
                } catch (error) {
                    throw new hosting.EventInputError('start', `On ${new Date(row.date).toISOString().slice(0, 10)} the clocks change and ${edit.startTime} does not exist. Pick another time.`);
                }
                await client.query(`UPDATE events SET ${EVENT_FIELDS_SQL}, ${NEEDS_PUSH_SQL} WHERE id = $1`,
                    eventFieldParams(row.id, edit, times.start, times.end));
                await logEdit(client, row);
                changed.push(row.id);
            }
        }
        // A raised limit, or one taken away, opens places for the waiting list.
        for (const id of changed) {
            await waitingList.promote(client, (await client.query('SELECT * FROM events WHERE id = $1', [id])).rows[0]);
        }
        return changed;
    });
    if (!result) return;
    publisher.nudge();
    broadcast({ type: 'event_update', payload: { ids: result.changed } });
    res.json(await hostView(result.fresh));
});

// Cancel: the event leaves Home and its Google copy is deleted. RSVPs stay, so Restore
// brings it back as it was.
app.post('/api/host/:token/events/:eventId/cancel', async (req, res) => {
    const later = req.body?.scope === 'later';
    const result = await withLinkedEvent(req, res, async (client, event) => {
        const done = await client.query(
            `UPDATE events SET cancelled_at = NOW(), ${NEEDS_PUSH_SQL}
             WHERE cancelled_at IS NULL AND (id = $1 OR ($2::uuid IS NOT NULL AND series_id = $2 AND date > $3))
             RETURNING id`,
            [event.id, later ? event.series_id : null, event.date]
        );
        for (const row of done.rows) await activity.logActivity(client, row.id, 'cancelled');
        return done.rows.map(r => r.id).concat(event.cancelled_at ? [event.id] : []);
    });
    if (!result) return;
    publisher.nudge();
    broadcast({ type: 'event_cancelled', payload: { ids: result.changed } });
    res.json(await hostView(result.fresh));
});

app.post('/api/host/:token/events/:eventId/restore', async (req, res) => {
    const result = await withLinkedEvent(req, res, async (client, event) => {
        if (!event.cancelled_at) return [event.id];
        await client.query(`UPDATE events SET cancelled_at = NULL, ${NEEDS_PUSH_SQL} WHERE id = $1`, [event.id]);
        await activity.logActivity(client, event.id, 'restored');
        return [event.id];
    });
    if (!result) return;
    publisher.nudge();
    broadcast({ type: 'event_update', payload: { ids: result.changed } });
    res.json(await hostView(result.fresh));
});

// Accept, decline, or put back among the requests or on the waiting list. Accepting respects
// the limit, under the row lock, so two quick taps cannot both take the last seat; moving
// someone in from the waiting list is the host's own call and may go past it. Whatever a
// decision frees goes to the first name waiting.
app.post('/api/host/:token/events/:eventId/requests/:rsvpId', async (req, res) => {
    const status = hosting.DECISIONS[req.body?.decision];
    if (!status) {
        return res.status(400).json({ success: false, message: 'Decision must be accept, decline, undo or wait.' });
    }
    const result = await withLinkedEvent(req, res, async (client, event) => {
        const found = await client.query('SELECT attendance, attendee_name FROM rsvps WHERE id = $1 AND event_id = $2', [req.params.rsvpId, event.id]);
        if (!found.rows[0]) {
            res.status(404).json({ success: false, message: 'That request is gone. Its owner may have withdrawn it.' });
            return null;
        }
        const from = found.rows[0].attendance;
        if (status === hosting.STATUS.YES && from !== hosting.STATUS.YES && from !== hosting.STATUS.WAITING && event.attendance_limit !== null) {
            const taken = await client.query('SELECT COUNT(*) FROM rsvps WHERE event_id = $1 AND attendance = $2', [event.id, hosting.STATUS.YES]);
            if (parseInt(taken.rows[0].count, 10) >= event.attendance_limit) {
                res.status(409).json({
                    success: false,
                    message: `All ${event.attendance_limit} places are taken. Free one first, or raise the limit.`
                });
                return null;
            }
        }
        await client.query('UPDATE rsvps SET attendance = $1 WHERE id = $2', [status, req.params.rsvpId]);
        const kind = activity.decisionKind(from, status);
        if (kind) await activity.logActivity(client, event.id, kind, { name: found.rows[0].attendee_name });
        await waitingList.promote(client, event);
        return [event.id];
    });
    if (!result) return;
    broadcast({ type: 'attendance_update', payload: await attendanceOf(pool, result.fresh.id) });
    res.json(await hostView(result.fresh));
});

// The host removes a message from the event's chat.
app.delete('/api/host/:token/events/:eventId/messages/:messageId', async (req, res) => {
    const scope = await hostScope(req.params.token);
    const event = scope ? await linkedEvent(pool, scope, req.params.eventId) : null;
    if (!event) return res.status(404).json({ success: false, message: 'This link does not open that event.' });
    let done;
    try {
        done = await chat.hostRemove(event.id, req.params.messageId);
    } catch (error) {
        if (chatError(res, error)) return;
        throw error;
    }
    broadcast({ type: 'event_message', payload: { action: 'deleted', eventId: event.id, id: done.id, count: done.count } });
    res.json(await hostView(event));
});

// ---------------------------------------------------------------------------
// Chat in an event (event-chat.js). Reading and liking are open; posting, editing and
// removing one's own message need the sign-in session.
// ---------------------------------------------------------------------------

function chatError(res, error) {
    if (!(error instanceof chatLib.ChatError)) return false;
    res.status(error.status).json({ success: false, field: error.field, message: error.message });
    return true;
}

// Every chat route answers through here, so a ChatError becomes its own status.
function chatRoute(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (error) {
            if (!chatError(res, error)) throw error;
        }
    };
}

app.get('/api/events/:id/messages', chatRoute(async (req, res) => {
    const email = await contacts.emailOf(req);
    const thread = await chat.list(req.params.id, { email, likerKey: req.query.liker });
    res.set('Cache-Control', 'no-store').json({ success: true, ...thread });
}));

app.post('/api/events/:id/messages', chatRoute(async (req, res) => {
    const email = await contacts.emailOf(req);
    const { message, count } = await chat.post(req.params.id, email, req.body, { ip: req.ip });
    broadcast({ type: 'event_message', payload: { action: 'posted', eventId: message.eventId, message: { ...message, mine: false, liked: false }, count } });
    res.status(201).json({ success: true, message, count });
}));

app.put('/api/events/:id/messages/:messageId', chatRoute(async (req, res) => {
    const email = await contacts.emailOf(req);
    const { message } = await chat.edit(req.params.id, req.params.messageId, email, req.body);
    broadcast({ type: 'event_message', payload: { action: 'edited', eventId: message.eventId, message: { ...message, mine: false, liked: false } } });
    res.json({ success: true, message });
}));

app.delete('/api/events/:id/messages/:messageId', chatRoute(async (req, res) => {
    const email = await contacts.emailOf(req);
    const done = await chat.remove(req.params.id, req.params.messageId, email);
    broadcast({ type: 'event_message', payload: { action: 'deleted', eventId: req.params.id, id: done.id, count: done.count } });
    res.json({ success: true, ...done });
}));

app.post('/api/events/:id/messages/:messageId/like', chatRoute(async (req, res) => {
    const done = await chat.like(req.params.id, req.params.messageId, req.body?.liker, req.body?.like !== false, { ip: req.ip });
    broadcast({ type: 'event_message', payload: { action: 'liked', eventId: req.params.id, id: done.id, likes: done.likes } });
    res.json({ success: true, ...done });
}));

// A sign-in link for the chat: any address may have one, and it comes back to the thread.
app.post('/api/events/:id/messages/signin', chatRoute(async (req, res) => {
    const eventId = String(req.params.id);
    try {
        await contacts.requestSignIn(req.body?.email, {
            ip: req.ip, baseUrl: publicUrl(req), next: `/#chat-${encodeURIComponent(eventId)}`
        });
    } catch (error) {
        if (!error.status) throw error;
        return res.status(error.status).json({ success: false, field: error.field, message: error.message });
    }
    res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// Calendar keys (calendar-access.js): a calendar's page, and a way into each of its events.
// ---------------------------------------------------------------------------

async function keyedCalendar(token) {
    const name = await access.calendarForKey(pool, token);
    return name ? publishedCalendars().find(c => c.name === name) || null : null;
}

app.get('/api/calendar-access/:token', async (req, res) => {
    const calendar = await keyedCalendar(req.params.token);
    if (!calendar) return res.status(404).json({ success: false, message: 'This calendar link does not work any more.' });
    const events = await pool.query(
        `SELECT e.id, e.title, e.date, e.endDate, e.location, e.attendance_limit, e.approval_required, e.series_id, e.managed,
                (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.attendance = 'yes')::int AS "attendingCount",
                (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.attendance = 'pending')::int AS "pendingCount"
         FROM events e
         WHERE e.source = $1 AND e.cancelled_at IS NULL AND e.date >= NOW() - INTERVAL '12 hours'
         ORDER BY e.date LIMIT 200`,
        [calendar.id]
    );
    res.set('Cache-Control', 'no-store').json({
        success: true,
        calendar: { name: calendar.name, restricted: calendar.restricted, imported: importedCalendars.has(calendar.id) },
        events: events.rows
    });
});

// A management link for one of the calendar's events, made for whoever holds the key. A
// series gets one link for all its dates.
app.post('/api/calendar-access/:token/events/:eventId/manage', async (req, res) => {
    const calendar = await keyedCalendar(req.params.token);
    if (!calendar) return res.status(404).json({ success: false, message: 'This calendar link does not work any more.' });
    const event = (await pool.query('SELECT id, source, managed, series_id FROM events WHERE id = $1', [req.params.eventId])).rows[0];
    if (!event || event.source !== calendar.id) {
        return res.status(404).json({ success: false, message: `That event is not in ${calendar.name}.` });
    }
    if (!event.managed) {
        return res.status(409).json({ success: false, message: 'Lilai has not taken this calendar over from Google yet, so its events cannot be managed here.' });
    }
    const token = hosting.newToken();
    await pool.query(
        'INSERT INTO event_host_links (id, token_hash, event_id, series_id, created_via) VALUES ($1, $2, $3, $4, $5)',
        [uuidv4(), hosting.hashToken(token), event.series_id ? null : event.id, event.series_id, 'calendar']
    );
    res.status(201).json({ success: true, hostPath: `/host/${token}` });
});

// The saved places, in the owner's order (server/places.js, edited on /admin/places).
function placeList() {
    return placeStore.list();
}

// google: whether the form may also search Google Maps (GOOGLE_MAPS_API_KEY is set).
app.get('/api/places', (req, res) => {
    res.json({ places: placeList(), google: placeAutocomplete.enabled });
});

// The saved places' admin (/admin/places), behind the admin key: the list is what every
// host is offered.
function placeError(res, error) {
    if (!(error instanceof places.PlaceInputError)) return false;
    res.status(error.message.startsWith('There is already') ? 409 : 400).json({ field: error.field, message: error.message });
    return true;
}

app.post('/api/places', adminAuth.requireAdmin, async (req, res) => {
    try {
        res.status(201).json({ place: await placeStore.add(req.body) });
    } catch (error) {
        if (!placeError(res, error)) throw error;
    }
});

app.put('/api/places/order', adminAuth.requireAdmin, async (req, res) => {
    await placeStore.reorder(req.body?.ids);
    res.json({ places: placeList() });
});

app.put('/api/places/:id', adminAuth.requireAdmin, async (req, res) => {
    try {
        const place = await placeStore.update(Number(req.params.id), req.body);
        if (!place) return res.status(404).json({ message: 'That place is gone.' });
        res.json({ place });
    } catch (error) {
        if (!placeError(res, error)) throw error;
    }
});

app.delete('/api/places/:id', adminAuth.requireAdmin, async (req, res) => {
    const removed = await placeStore.remove(Number(req.params.id));
    if (!removed) return res.status(404).json({ message: 'That place is gone.' });
    res.json({ success: true });
});

// Google Maps suggestions for what is typed, through server/place-autocomplete.js.
app.get('/api/places/search', async (req, res) => {
    try {
        const results = await placeAutocomplete.search(req.query.q, { sessionToken: req.query.session, caller: req.ip });
        res.json({ results });
    } catch (error) {
        console.error('[places]', error.message);
        res.status(502).json({ results: [], error: 'Google Maps search is not answering.' });
    }
});

// Donations API Routes

// Get all donations with balance calculation
app.get('/api/donations', async (req, res) => {
    const client = await pool.connect();
    try {
        const limit = parseInt(req.query.limit) || 20;
        
        // Get latest donations
        const donationsResult = await client.query(`
            SELECT id, amount, description, donator, entry_date, created_at
            FROM donations
            ORDER BY COALESCE(entry_date, created_at) DESC
            LIMIT $1
        `, [limit]);

        // Calculate total balance
        const balanceResult = await client.query(`
            SELECT COALESCE(SUM(amount), 0) as balance
            FROM donations
        `);

        const balance = parseFloat(balanceResult.rows[0].balance) || 0;

        res.json({
            balance: balance,
            donations: donationsResult.rows.map(row => ({
                id: row.id,
                amount: parseFloat(row.amount),
                description: row.description || '',
                donator: row.donator || '',
                entry_date: row.entry_date || null,
                created_at: row.created_at
            }))
        });
    } catch (error) {
        console.error('Error fetching donations:', error);
        res.status(500).json({ error: 'Failed to fetch donations' });
    } finally {
        client.release();
    }
});

// Create a new donation (admin only - requires API key)
app.post('/api/donations', adminAuth.requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { amount, description, donator, entry_date } = req.body;

        if (!amount || amount === 0) {
            return res.status(400).json({ success: false, message: 'Amount is required and must not be zero' });
        }

        const donationId = uuidv4();
        
        // Convert entry_date to TIMESTAMPTZ if provided
        let entryDateValue = null;
        if (entry_date) {
            entryDateValue = new Date(entry_date).toISOString();
        }
        
        await client.query(
            'INSERT INTO donations (id, amount, description, donator, entry_date) VALUES ($1, $2, $3, $4, $5)',
            [donationId, amount, description || null, donator || null, entryDateValue]
        );

        res.json({ 
            success: true, 
            message: 'Donation added successfully',
            donation: {
                id: donationId,
                amount: parseFloat(amount),
                description: description || '',
                donator: donator || '',
                entry_date: entryDateValue
            }
        });
    } catch (error) {
        console.error('Error creating donation:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// Sports booking queue
// ---------------------------------------------------------------------------

/*
 * The build marker the board's script declares about itself.
 *
 * Read from disk rather than duplicated here, so the two can only disagree when the browser
 * is genuinely running an older copy — which is exactly the condition worth reporting. Read
 * once at boot: the file does not change under a running server, and a failed read simply
 * means no claim is made.
 */
const BOARD_BUILD = (() => {
    try {
        const source = fs.readFileSync(path.join(__dirname, '../public/js/admin-bookings.js'), 'utf8');
        const match = /const BUILD = '([^']+)'/.exec(source);
        return match ? match[1] : null;
    } catch (error) {
        return null;
    }
})();

const QUEUED_STATUSES = ['queued', 'sending'];
const HISTORY_STATUSES = ['sent', 'unconfirmed', 'not_sent', 'failed', 'missed', 'cancelled'];

/*
 * Which half of the timeline a row belongs to.
 *
 * The board is ordered by the moment we act on a request — when it went out, or when its
 * window opens — not by the play date and not by the status. A cancelled slot whose window
 * has not opened yet is therefore still ahead of NOW, and has to stay where it sits.
 * Sweeping it into history put a December booking above tomorrow's, which is simply the
 * wrong order.
 */

/*
 * A cancellation shows for a short while, offering Undo, and then leaves the board.
 *
 * It is never deleted — the row keeps its cancelled status and its place in the record —
 * but a timeline of things that are NOT happening is noise, and it grows fastest exactly
 * when a recurring schedule is called off. $2 is the undo window in seconds. A cancellation
 * from before cancelled_at existed has none, which reads correctly as long over.
 */
const STILL_UNDOABLE = `(cancelled_at IS NOT NULL AND cancelled_at > NOW() - make_interval(secs => $2::int))`;

const STILL_AHEAD = `(status = ANY($1) OR (status = 'cancelled' AND opens_at > NOW() AND ${STILL_UNDOABLE}))`;
const ALREADY_BEHIND = `(status = ANY($1)
    AND NOT (status = 'cancelled' AND opens_at > NOW() AND ${STILL_UNDOABLE})
    AND (status <> 'cancelled' OR ${STILL_UNDOABLE}))`;

/*
 * The privacy boundary, in one place: the board shows names, never contact details.
 * Email and phone exist only to fill in the KU Leuven form. Every response that reaches
 * a browser goes through here.
 */
function toBoardEntry(row) {
    return {
        id: row.id,
        sport: row.sport,
        // A calendar day, not an instant — booking-schema.js keeps it a plain string.
        playDate: row.play_date,
        startPreferred: row.start_preferred,
        startAlternative: row.start_alternative,
        durationHours: Number(row.duration_hours),
        players: row.players,
        indoorOutdoor: row.indoor_outdoor,
        facility: row.facility,
        otherFacility: row.other_facility,
        remarks: row.remarks,
        name: row.name,
        // Which address book entry this was booked for — an id, so the sheet can preselect
        // the person on an edit. The contact details behind it still never come this way.
        profileId: row.profile_id || null,
        // Which recurring schedule produced it, so a row can be read as part of a habit.
        seriesId: row.series_id || null,
        // When it was cancelled, so the board can run the Undo window down to zero.
        cancelledAt: row.cancelled_at || null,
        // Set when a person, not the scheduler, marked the request failed.
        failureReportedAt: row.failure_reported_at || null,
        status: row.status,
        opensAt: row.opens_at,
        // The Undo countdown needs it: grace runs from the later of this and opensAt.
        sendAfter: row.send_after,
        queuedAt: row.queued_at,
        queuedBy: row.queued_by,
        submittedAt: row.submitted_at
    };
}

/*
 * The booking settings, read once. config/app.json is loaded once too, so re-parsing it on
 * every request bought nothing; and its booking block is edited by hand once a year
 * (seasonEndsOn), so a typo there must not take the calendar, RSVPs and donations down
 * with it. When it fails, the routes that read these settings answer 503 with the reason,
 * the scheduler is not started, and the rest of the app — the address book included, which
 * never reads them — runs as it always did.
 */
let BOOKING_SETTINGS = null;
let bookingConfigError = null;
try {
    BOOKING_SETTINGS = bookingSettings(appConfig);
} catch (error) {
    bookingConfigError = error;
    console.error(`Bookings are off until config/app.json is fixed: ${error.message}`);
}
app.use(['/api/bookings', '/api/booking-series'], (req, res, next) => {
    if (!bookingConfigError) return next();
    res.status(503).json({ success: false, message: `Bookings are off: ${bookingConfigError.message}` });
});

/*
 * One expanded date, checked the way both queue paths check it: the entry validates and
 * the slot is not already in the past. A window that has already opened is fine: the row
 * gets a send time of now, so it goes out on the next pass and its grace counts from
 * there. Returns the entry or the refusal — the caller
 * decides whether that refusal is the request's problem (the first date) or a date to
 * report as skipped (the rest).
 */
function screenOccurrence(body, playDate, now) {
    let entry;
    try {
        entry = validateBooking({ ...body, playDate }, { seasonEndsOn: BOOKING_SETTINGS.seasonEndsOn });
    } catch (error) {
        if (!(error instanceof BookingInputError)) throw error;
        return { refused: { message: error.message, field: error.field } };
    }
    if (now >= entry.startPreferred && now >= entry.startAlternative) {
        return { refused: { message: 'That slot is already in the past.', field: 'playDate' } };
    }
    return { entry };
}

/*
 * After a commit that may have queued a row into an open window: run a scheduler pass now
 * rather than at the next interval. Harmless when nothing is due.
 */
function sendDueNow() {
    if (bookingScheduler) bookingScheduler.nudge();
}

/*
 * One row into the queue, for the create path and the schedule edit alike. A column added
 * to one INSERT and not the other is exactly the drift this exists to make impossible.
 */
async function queueOccurrence(client, entry, { queuedBy, profileId, seriesId }) {
    const inserted = await client.query(`
        INSERT INTO booking_queue (
            id, sport, play_date, start_preferred, start_alternative, duration_hours,
            players, indoor_outdoor, facility, other_facility, language, valid_sports_card,
            name, name_key, email, phone, remarks, queued_by, opens_at, send_after,
            profile_id, series_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 'queued')
        RETURNING *
    `, [
        uuidv4(), entry.sport, entry.playDate, entry.startPreferred, entry.startAlternative, entry.durationHours,
        entry.players, entry.indoorOutdoor, entry.facility, entry.otherFacility, entry.language,
        entry.validSportsCard, entry.name, entry.nameKey, entry.email, entry.phone, entry.remarks,
        queuedBy, entry.opensAt, sampleSendAfter(entry.opensAt, BOOKING_SETTINGS), profileId, seriesId
    ]);
    return toBoardEntry(inserted.rows[0]);
}

// List the board: everything still owed a submission, plus a page of what has gone out.
app.get('/api/bookings', async (req, res) => {
    const client = await pool.connect();
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const settings = BOOKING_SETTINGS;
        const undoWindow = settings.cancelUndoSeconds;

        const queued = await client.query(
            `SELECT * FROM booking_queue WHERE ${STILL_AHEAD} ORDER BY send_after ASC`,
            [QUEUED_STATUSES, undoWindow]
        );

        const params = [HISTORY_STATUSES, undoWindow];
        let historySql = `SELECT * FROM booking_queue WHERE ${ALREADY_BEHIND}`;
        if (req.query.before) {
            const before = new Date(req.query.before);
            if (Number.isNaN(before.getTime())) {
                return res.status(400).json({ success: false, message: 'Invalid "before" timestamp' });
            }
            params.push(before);
            historySql += ` AND COALESCE(submitted_at, opens_at) < $${params.length}`;
        }
        params.push(limit + 1);
        historySql += ` ORDER BY COALESCE(submitted_at, opens_at) DESC LIMIT $${params.length}`;

        const history = await client.query(historySql, params);
        const hasMore = history.rows.length > limit;

        res.json({
            success: true,
            queued: queued.rows.map(toBoardEntry),
            history: history.rows.slice(0, limit).map(toBoardEntry),
            historyHasMore: hasMore,
            quotaPerWeek: QUOTA_PER_WEEK,
            // The board offers "Undo" only where a restore could actually succeed, which is
            // bounded by the grace window. It has to be the server's number.
            graceSeconds: settings.lateSubmissionGraceSeconds,
            // How long a cancelled row keeps its Undo before it leaves the board. The
            // client counts it down, so it must be the same number the server enforces.
            cancelUndoSeconds: undoWindow,
            // What the board's script should be. A browser running an older copy compares
            // this with its own constant and tells the reader, instead of misbehaving.
            build: BOARD_BUILD
        });
    } catch (error) {
        console.error('Error listing booking queue:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

// The live tally the queue sheet shows while someone types a name.
app.get('/api/bookings/quota', async (req, res) => {
    const client = await pool.connect();
    try {
        const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
        const playDate = typeof req.query.playDate === 'string' ? req.query.playDate.trim() : '';
        /*
         * An entry being edited must not count against itself. Without this the second slot
         * of a week, reopened and saved unchanged, reads as a third: the sheet declares the
         * week full and offers to swap the entry for itself.
         */
        const excludeId = typeof req.query.excludeId === 'string' ? req.query.excludeId.trim() : '';
        // The same courtesy for a whole schedule being rebuilt.
        const excludeSeries = typeof req.query.excludeSeries === 'string' ? req.query.excludeSeries.trim() : '';
        if (!name) return res.status(400).json({ success: false, message: 'A name is required' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(playDate)) {
            return res.status(400).json({ success: false, message: 'playDate must be YYYY-MM-DD' });
        }
        res.json({
            success: true,
            ...(await quotaFor(client, name, playDate, {
                excludeId: excludeId || null,
                excludeSeries: excludeSeries || null
            }))
        });
    } catch (error) {
        console.error('Error reading booking quota:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * What a repeat rule would actually produce.
 *
 * The sheet shows a count and a last date while someone is still choosing. That preview has
 * to be the server's own expansion, not a copy of the rule maths in the browser: a preview
 * that promises a date the server then refuses is worse than no preview, and two
 * implementations of a calendar rule drift.
 */
app.get('/api/bookings/repeat-preview', (req, res) => {
    const { seasonEndsOn } = BOOKING_SETTINGS;
    const playDate = String(req.query.playDate || '').trim();
    const weekdays = String(req.query.weekdays || '')
        .split(',')
        .filter((part) => part !== '')
        .map(Number);

    try {
        const rule = {
            every: Number(req.query.every),
            unit: String(req.query.unit || ''),
            weekdays,
            until: String(req.query.until || '').trim()
        };
        const dates = expandRepeat(playDate, rule, { seasonEndsOn });
        res.json({
            success: true,
            dates,
            summary: describeRule(validateRule(rule, playDate, seasonEndsOn))
        });
    } catch (error) {
        if (error instanceof RepeatError) {
            return res.status(400).json({ success: false, message: error.message, field: error.field });
        }
        throw error;
    }
});

/*
 * Recurring schedules.
 *
 * A series is the handle on a habit — "cancel the rest of the Tuesday badminton" is one
 * intent, and doing it one row at a time is how an occurrence gets missed. The rows remain
 * the truth: a series knows what it created and nothing more.
 */
app.get('/api/booking-series', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(SERIES_LIST_SQL);
        res.json({ success: true, series: result.rows.map(toSeriesView) });
    } catch (error) {
        console.error('Error listing booking series:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * Cancel everything in a series that has not gone out yet.
 *
 * Only `queued` rows: once the scheduler has claimed one it is in flight or already
 * answered, and a bulk button must not pretend to recall it. Those are counted and
 * reported rather than silently left behind.
 */
app.post('/api/booking-series/:id/cancel-remaining', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const series = await client.query('SELECT * FROM booking_series WHERE id = $1', [req.params.id]);
        if (series.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'No such schedule' });
        }

        const cancelled = await client.query(`
            UPDATE booking_queue SET status = 'cancelled', cancelled_at = NOW()
            WHERE series_id = $1 AND status = 'queued'
            RETURNING *
        `, [req.params.id]);

        const untouched = await client.query(`
            SELECT COUNT(*)::int AS n FROM booking_queue
            WHERE series_id = $1 AND status NOT IN ('queued', 'cancelled')
        `, [req.params.id]);

        await client.query('COMMIT');

        const boards = cancelled.rows.map(toBoardEntry);
        for (const board of boards) broadcast({ type: 'booking_update', booking: board });
        res.json({ success: true, cancelled: boards, alreadyGone: untouched.rows[0].n });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error cancelling a booking series:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * Undo a bulk cancellation, while it is still undoable.
 *
 * Cancelling eleven occurrences in one click and then having to restore them one at a time
 * inside a five-minute window is not an undo. Bounded by the same window as a single Undo,
 * and by the same closed-window rule: a slot whose grace has run out cannot come back.
 */
app.post('/api/booking-series/:id/restore-remaining', async (req, res) => {
    const settings = BOOKING_SETTINGS;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const restored = await client.query(`
            UPDATE booking_queue SET status = 'queued', cancelled_at = NULL
            WHERE series_id = $1
              AND status = 'cancelled'
              AND cancelled_at > NOW() - make_interval(secs => $2::int)
              AND GREATEST(opens_at, COALESCE(send_after, opens_at)) + make_interval(secs => $3::int) > NOW()
            RETURNING *
        `, [req.params.id, settings.cancelUndoSeconds, settings.lateSubmissionGraceSeconds]);

        await client.query('COMMIT');
        sendDueNow();

        /*
         * No quota check, deliberately — the same call the single Undo makes. These slots
         * held their week moments ago; refusing to give them back because the week now
         * reads as full would punish someone for the cancellation they are undoing.
         */
        const boards = restored.rows.map(toBoardEntry);
        for (const board of boards) broadcast({ type: 'booking_update', booking: board });
        res.json({ success: true, restored: boards });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error restoring a booking series:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * One schedule, with a template to edit it from.
 *
 * The rule lives on the series; everything else about a booking — duration, players,
 * indoor or out, remarks — lives on the occurrences. So the sheet needs one of them to
 * start from: the next one still waiting, or failing that the most recent, because a
 * schedule that has run its course can still be picked up and pointed at new dates.
 */
app.get('/api/booking-series/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const series = await client.query(SERIES_ONE_SQL, [req.params.id]);
        if (series.rowCount === 0) return res.status(404).json({ success: false, message: 'No such schedule' });

        const template = await client.query(`
            SELECT * FROM booking_queue
            WHERE series_id = $1
            ORDER BY (status = 'queued') DESC, play_date ASC
            LIMIT 1
        `, [req.params.id]);

        res.json({
            success: true,
            series: toSeriesView(series.rows[0]),
            template: template.rowCount > 0 ? toBoardEntry(template.rows[0]) : null
        });
    } catch (error) {
        console.error('Error reading a booking series:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * Edit a schedule: change the rule, the details, or both, and make the queue match.
 *
 * The reconciliation is the whole job, and it is deliberately conservative about what it
 * will touch:
 *
 *   a queued occurrence on a date the new rule still wants  → updated in place, keeping
 *     its id, so the board does not flicker a row out and an identical one back in
 *   a queued occurrence on a date the rule no longer wants  → cancelled, undoable like
 *     any other cancellation
 *   a date the rule wants with nothing queued for it        → a new occurrence
 *   anything already sent, in flight, or answered           → untouched, always
 *
 * That last line is the one that matters. A schedule's history is a record of what went to
 * KU Leuven, and no amount of editing the habit may rewrite it.
 */
app.put('/api/booking-series/:id', async (req, res) => {
    const settings = BOOKING_SETTINGS;
    const now = new Date();

    let profileId = null;
    let body;
    let rule;
    let dates;
    try {
        const resolved = await applyProfile(req.body);
        profileId = resolved.profileId;
        body = resolved.body;
        const playDate = String(body.playDate || '').trim();
        if (!body.repeat) {
            return res.status(400).json({
                success: false, field: 'repeatUntil',
                message: 'A schedule needs a repeat. To keep a single booking, edit the slot itself.'
            });
        }
        /*
         * Email and phone never reach the board, so the sheet cannot send them back. With a
         * profile the server reads them from the address book; without one it keeps what the
         * schedule's own occurrences already carry — the same rule the single-entry edit
         * follows, and for the same reason: blank must mean "unchanged", never "clear it".
         */
        if (!profileId) {
            const stored = await pool.query(
                'SELECT name, email, phone FROM booking_queue WHERE series_id = $1 ORDER BY play_date DESC LIMIT 1',
                [req.params.id]
            );
            if (stored.rowCount > 0) body = mergeContact(body, stored.rows[0]);
        }
        rule = validateRule(body.repeat, playDate, settings.seasonEndsOn);
        dates = expandRepeat(playDate, body.repeat, { seasonEndsOn: settings.seasonEndsOn });
    } catch (error) {
        if (error instanceof BookingInputError || error instanceof RepeatError) {
            return res.status(400).json({ success: false, message: error.message, field: error.field });
        }
        throw error;
    }

    // Validated before anything is written, exactly as the create path does it: the first
    // date's problems are the request's problems, later ones are reported as skipped.
    const wanted = new Map();
    const skipped = [];
    for (const playDate of dates) {
        const { entry, refused } = screenOccurrence(body, playDate, now);
        if (refused) {
            if (playDate === dates[0]) {
                return res.status(400).json({ success: false, message: refused.message, field: refused.field });
            }
            skipped.push({ playDate, reason: refused.message });
            continue;
        }
        wanted.set(playDate, entry);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const found = await client.query('SELECT * FROM booking_series WHERE id = $1', [req.params.id]);
        if (found.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'No such schedule' });
        }

        /*
         * Locks over the union of the weeks being left AND the weeks being entered, in one
         * sorted pass. An edit that moves Tuesday to Thursday touches the same week twice
         * and two overlapping edits in opposite orders would otherwise deadlock.
         */
        const existing = await client.query(
            'SELECT * FROM booking_queue WHERE series_id = $1 ORDER BY play_date ASC', [req.params.id]);
        const nameKeys = new Set([...wanted.values()].map((entry) => entry.nameKey));
        const weeks = new Set();
        for (const entry of wanted.values()) weeks.add(`${entry.nameKey}|${weekBounds(entry.playDate).start}`);
        for (const row of existing.rows) {
            if (row.status !== 'queued') continue;
            for (const nameKey of nameKeys) weeks.add(`${nameKey}|${weekBounds(row.play_date).start}`);
            weeks.add(`${row.name_key}|${weekBounds(row.play_date).start}`);
        }
        for (const key of [...weeks].sort()) {
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
        }

        // A date already covered by a request that went out is not a date to book again.
        const spoken = new Set(existing.rows
            .filter((row) => !['queued', 'cancelled'].includes(row.status))
            .map((row) => row.play_date));
        const queuedByDate = new Map(existing.rows
            .filter((row) => row.status === 'queued')
            .map((row) => [row.play_date, row]));

        const queuedBy = typeof body.queuedBy === 'string' && body.queuedBy.trim()
            ? body.queuedBy.trim().slice(0, 100)
            : [...wanted.values()][0].name;

        /*
         * No cancelled_at, deliberately. That column is what offers Undo — on the row, and
         * through the schedule's last_cancelled_at the card's "Undo all" — and an occurrence
         * the new rule no longer wants must not come back through either: restoring the
         * Tuesdays next to the Thursdays that replaced them would double the queue past the
         * quota and contradict the schedule that says Thursday. The undo of an edit is
         * another edit. Without the stamp these rows leave the board at once and still count
         * as cancelled in the schedule's tally.
         */
        const cancelled = [];
        for (const [playDate, row] of queuedByDate) {
            if (wanted.has(playDate)) continue;
            const gone = await client.query(`
                UPDATE booking_queue SET status = 'cancelled', cancelled_at = NULL
                WHERE id = $1 AND status = 'queued' RETURNING *
            `, [row.id]);
            if (gone.rowCount > 0) cancelled.push(toBoardEntry(gone.rows[0]));
        }

        /*
         * Room is counted once per week with this schedule's own queued rows left out —
         * they are the thing being rebuilt — then spent down in memory, so two occurrences
         * in one week cannot both be told there is space for one.
         */
        const roomLeft = new Map();
        const kept = [];
        const created = [];
        for (const [playDate, entry] of wanted) {
            if (spoken.has(playDate)) {
                skipped.push({ playDate, reason: 'A request for that day has already gone out.' });
                continue;
            }
            const weekKey = `${entry.nameKey}|${weekBounds(playDate).start}`;
            if (!roomLeft.has(weekKey)) {
                roomLeft.set(weekKey, QUOTA_PER_WEEK
                    - await countHeld(client, entry.nameKey, playDate, { excludeSeries: req.params.id }));
            }
            if (roomLeft.get(weekKey) <= 0) {
                skipped.push({ playDate, reason: `That week is already full for ${entry.name}.` });
                continue;
            }
            roomLeft.set(weekKey, roomLeft.get(weekKey) - 1);

            const standing = queuedByDate.get(playDate);
            if (standing) {
                // Kept, not replaced: the id survives, so an occurrence someone is looking
                // at does not vanish and come back as a stranger.
                const updated = await client.query(`
                    UPDATE booking_queue SET
                        sport = $2, start_preferred = $3, start_alternative = $4, duration_hours = $5,
                        players = $6, indoor_outdoor = $7, facility = $8, other_facility = $9,
                        language = $10, valid_sports_card = $11, name = $12, name_key = $13,
                        email = $14, phone = $15, remarks = $16, opens_at = $17, send_after = $18,
                        profile_id = $19
                    WHERE id = $1 AND status = 'queued'
                    RETURNING *
                `, [
                    standing.id, entry.sport, entry.startPreferred, entry.startAlternative, entry.durationHours,
                    entry.players, entry.indoorOutdoor, entry.facility, entry.otherFacility, entry.language,
                    entry.validSportsCard, entry.name, entry.nameKey, entry.email, entry.phone, entry.remarks,
                    entry.opensAt, sendAfterForEdit(standing, entry.opensAt, settings), profileId
                ]);
                if (updated.rowCount > 0) kept.push(toBoardEntry(updated.rows[0]));
                continue;
            }

            created.push(await queueOccurrence(client, entry, { queuedBy, profileId, seriesId: req.params.id }));
        }

        if (kept.length === 0 && created.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                reason: 'nothing_queued',
                message: 'None of those dates could be queued, so the schedule is unchanged.',
                skipped
            });
        }

        const first = [...wanted.values()][0];
        const saved = await client.query(`
            UPDATE booking_series SET
                name = $2, name_key = $3, profile_id = $4, sport = $5, every = $6, unit = $7,
                weekdays = $8, starts_on = $9, until = $10, start_preferred = $11, start_alternative = $12
            WHERE id = $1
            RETURNING id
        `, [
            req.params.id, first.name, first.nameKey, profileId, first.sport,
            rule.every, rule.unit, rule.weekdays, dates[0], rule.until,
            String(body.startPreferred).trim(), String(body.startAlternative).trim()
        ]);
        if (saved.rowCount === 0) throw new Error('the schedule vanished mid-edit');

        await client.query('COMMIT');
        sendDueNow();

        for (const board of [...cancelled, ...kept, ...created]) {
            broadcast({ type: 'booking_update', booking: board });
        }
        res.json({
            success: true,
            kept: kept.length,
            created,
            cancelled: cancelled.length,
            skipped
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error editing a booking series:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * The address book.
 *
 * Three facts per person, kept on the server so they survive a cleared cache and reach
 * every device. No login guards these routes, by the same decision the rest of this app
 * makes: it is a small community board, and a profile is an address book entry, not an
 * account. What the routes DO protect is bulk contact details — the list masks them, and
 * only a read of one profile returns the full record.
 */
app.get('/api/booking-profiles', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM booking_profiles ORDER BY name ASC');
        res.json({ success: true, profiles: result.rows.map(publicProfile) });
    } catch (error) {
        console.error('Error listing booking profiles:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

app.get('/api/booking-profiles/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM booking_profiles WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'No such person' });
        res.json({ success: true, profile: fullProfile(result.rows[0]) });
    } catch (error) {
        console.error('Error reading booking profile:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

app.post('/api/booking-profiles', async (req, res) => {
    let person;
    try {
        person = validateProfile(req.body);
    } catch (error) {
        if (error instanceof BookingInputError) {
            return res.status(400).json({ success: false, message: error.message, field: error.field });
        }
        throw error;
    }

    const client = await pool.connect();
    try {
        const result = await client.query(
            `INSERT INTO booking_profiles (id, name, name_key, email, phone)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (name_key) DO NOTHING
             RETURNING *`,
            [uuidv4(), person.name, person.nameKey, person.email, person.phone]
        );
        // The conflict is on the folded name — the same key the weekly quota counts on —
        // so the answer has to name the person who already holds it, not the spelling typed.
        if (result.rowCount === 0) {
            const existing = await client.query('SELECT * FROM booking_profiles WHERE name_key = $1', [person.nameKey]);
            return res.status(409).json({
                success: false,
                reason: 'already_exists',
                message: `${existing.rows[0].name} is already in the list.`,
                field: 'name',
                profile: publicProfile(existing.rows[0])
            });
        }
        res.status(201).json({ success: true, profile: fullProfile(result.rows[0]) });
    } catch (error) {
        console.error('Error creating booking profile:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * Editing a profile changes what the NEXT request will carry. Bookings already queued keep
 * the details they were made with: the row the scheduler posts has to be the row someone
 * read and approved, and history has to say what was actually sent.
 */
app.put('/api/booking-profiles/:id', async (req, res) => {
    let person;
    try {
        person = validateProfile(req.body);
    } catch (error) {
        if (error instanceof BookingInputError) {
            return res.status(400).json({ success: false, message: error.message, field: error.field });
        }
        throw error;
    }

    const client = await pool.connect();
    try {
        const clash = await client.query(
            'SELECT name FROM booking_profiles WHERE name_key = $1 AND id <> $2',
            [person.nameKey, req.params.id]
        );
        if (clash.rowCount > 0) {
            return res.status(409).json({
                success: false,
                reason: 'already_exists',
                message: `${clash.rows[0].name} already holds that name.`,
                field: 'name'
            });
        }
        const result = await client.query(
            `UPDATE booking_profiles
             SET name = $1, name_key = $2, email = $3, phone = $4, updated_at = NOW()
             WHERE id = $5 RETURNING *`,
            [person.name, person.nameKey, person.email, person.phone, req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'No such person' });
        res.json({ success: true, profile: fullProfile(result.rows[0]) });
    } catch (error) {
        console.error('Error updating booking profile:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * Removal takes the person out of the picker and nothing else. Their bookings keep the
 * name, email and phone they were queued with (profile_id is ON DELETE SET NULL), so a
 * request waiting for midnight still goes out complete. The count says how many, because
 * "this removes nothing else" is only believable with a number attached.
 */
app.delete('/api/booking-profiles/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const held = await client.query(
            `SELECT COUNT(*)::int AS waiting FROM booking_queue
             WHERE profile_id = $1 AND status IN ('queued', 'sending')`,
            [req.params.id]
        );
        const result = await client.query('DELETE FROM booking_profiles WHERE id = $1 RETURNING *', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'No such person' });
        res.json({ success: true, profile: publicProfile(result.rows[0]), stillQueued: held.rows[0].waiting });
    } catch (error) {
        console.error('Error deleting booking profile:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * The pickers in the queue sheet, read from the live form rather than hard-coded.
 * Cached for an hour, and the last good answer is served if KU Leuven is having a bad
 * day — a stale hall list is far better than a form nobody can fill in.
 */
let formOptionsCache = { value: null, fetchedAt: 0 };
const FORM_OPTIONS_TTL = 60 * 60 * 1000;

app.get('/api/bookings/form-options', async (req, res) => {
    /*
     * The season end rides along with the form options because both answer the same
     * question for the sheet: what may this request say? It is read fresh on every call
     * rather than folded into the cached form, so renewing the season in config takes
     * effect at once instead of an hour later.
     */
    const season = {
        seasonEndsOn: BOOKING_SETTINGS.seasonEndsOn,
        // The sheet must not offer a repeat the server would refuse.
        repeatUnits: UNITS,
        repeatMaxEvery: MAX_EVERY,
        repeatMax: MAX_OCCURRENCES
    };
    const fresh = Date.now() - formOptionsCache.fetchedAt < FORM_OPTIONS_TTL;
    if (formOptionsCache.value && fresh) {
        return res.json({ success: true, cached: true, ...formOptionsCache.value, ...season });
    }
    try {
        const options = readFormOptions(await new BookingFormClient().getForm());
        formOptionsCache = { value: options, fetchedAt: Date.now() };
        res.json({ success: true, cached: false, ...options, ...season });
    } catch (error) {
        console.error('Error reading booking form options:', error.message);
        if (formOptionsCache.value) {
            return res.json({ success: true, cached: true, stale: true, ...formOptionsCache.value, ...season });
        }
        res.status(503).json({ success: false, message: 'Could not read the booking form right now', ...season });
    }
});

/*
 * A request that names a profile takes its name, email and phone from the server.
 *
 * The profile is the one place those three facts are edited, so letting a client override
 * them would reintroduce exactly the drift profiles exist to remove. A request with no
 * profileId still carries its own contact details — the import path and any older client
 * work unchanged.
 */
async function applyProfile(body) {
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
    if (!profileId) return { body, profileId: null };
    const result = await pool.query('SELECT * FROM booking_profiles WHERE id = $1', [profileId]);
    if (result.rowCount === 0) {
        throw new BookingInputError('That person is no longer in the list.', 'name');
    }
    const person = result.rows[0];
    return {
        body: { ...body, name: person.name, email: person.email, phone: person.phone },
        profileId
    };
}

// Queue a slot.
app.post('/api/bookings', async (req, res) => {
    const settings = BOOKING_SETTINGS;
    const now = new Date();

    let profileId = null;
    let dates;
    let body;
    let rule = null;
    try {
        const resolved = await applyProfile(req.body);
        profileId = resolved.profileId;
        body = resolved.body;
        const playDate = String(body.playDate || '').trim();
        dates = expandRepeat(playDate, body.repeat, { seasonEndsOn: settings.seasonEndsOn });
        // Normalised here so the series record stores what was actually expanded, not what
        // was typed — an omitted weekday set becomes the first booking's own day.
        if (body.repeat) rule = validateRule(body.repeat, playDate, settings.seasonEndsOn);
    } catch (error) {
        if (error instanceof BookingInputError || error instanceof RepeatError) {
            return res.status(400).json({ success: false, message: error.message, field: error.field });
        }
        throw error;
    }

    /*
     * Every occurrence is checked before anything is written, and each one carries its own
     * reason when it cannot be queued. A repeat that silently dropped three weeks would be
     * worse than one that refuses: nobody re-reads a queue they believe worked.
     */
    const wanted = [];
    const skipped = [];
    for (const playDate of dates) {
        const { entry, refused } = screenOccurrence(body, playDate, now);
        if (refused) {
            // The first date's problems are the request's problems — a typo in the times is
            // not something to report as "week 1 skipped".
            if (playDate === dates[0]) {
                return res.status(400).json({ success: false, message: refused.message, field: refused.field });
            }
            skipped.push({ playDate, reason: refused.message });
            continue;
        }
        wanted.push(entry);
    }

    const queuedBy = typeof body.queuedBy === 'string' && body.queuedBy.trim()
        ? body.queuedBy.trim().slice(0, 100)
        : wanted[0].name;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        /*
         * Serialize every check-then-insert for one name in one play week, so two people
         * queueing the same name at the same moment cannot both pass a count of 1. A repeat
         * touches several weeks at once, so the locks are taken in a fixed order — two
         * overlapping repeats taking them in opposite orders would deadlock.
         */
        const weeks = [...new Set(wanted.map((entry) => `${entry.nameKey}|${weekBounds(entry.playDate).start}`))].sort();
        for (const key of weeks) {
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
        }

        /*
         * A repeat gets a series row: the handle the board needs to cancel the rest of it in
         * one act. It is a label on the occurrences, never their owner — the rows carry
         * everything needed to submit, and deleting the series cancels nothing.
         */
        let seriesId = null;
        if (rule) {
            seriesId = uuidv4();
            await client.query(`
                INSERT INTO booking_series (
                    id, name, name_key, profile_id, sport, every, unit, weekdays,
                    starts_on, until, start_preferred, start_alternative
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `, [
                seriesId, wanted[0].name, wanted[0].nameKey, profileId, wanted[0].sport,
                rule.every, rule.unit, rule.weekdays, dates[0], rule.until,
                String(body.startPreferred).trim(), String(body.startAlternative).trim()
            ]);
        }

        // Counted once per week up front, then spent down in memory, so two occurrences in
        // one week cannot both be told there is room for one.
        const roomLeft = new Map();
        const created = [];
        for (const entry of wanted) {
            const weekKey = `${entry.nameKey}|${weekBounds(entry.playDate).start}`;
            if (!roomLeft.has(weekKey)) {
                roomLeft.set(weekKey, QUOTA_PER_WEEK - await countHeld(client, entry.nameKey, entry.playDate));
            }
            if (roomLeft.get(weekKey) <= 0) {
                // A single booking that hits the quota is the sheet's "that week is full"
                // branch, which offers a swap. A repeat just reports the weeks it lost.
                if (dates.length === 1) {
                    await client.query('ROLLBACK');
                    const quota = await quotaFor(client, entry.name, entry.playDate);
                    return res.status(409).json({
                        success: false,
                        reason: 'quota_reached',
                        message: `That week is full for ${quota.name} — ${quota.used} of ${QUOTA_PER_WEEK}.`,
                        quota
                    });
                }
                skipped.push({ playDate: entry.playDate, reason: `That week is already full for ${entry.name}.` });
                continue;
            }
            roomLeft.set(weekKey, roomLeft.get(weekKey) - 1);

            created.push(await queueOccurrence(client, entry, { queuedBy, profileId, seriesId }));
        }

        if (created.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                reason: 'nothing_queued',
                message: 'None of those dates could be queued.',
                skipped
            });
        }

        await client.query('COMMIT');
        sendDueNow();

        for (const board of created) broadcast({ type: 'booking_update', booking: board });
        res.status(201).json({
            success: true,
            booking: created[0],
            created,
            skipped,
            quotaPerWeek: QUOTA_PER_WEEK
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error queueing booking:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * Edit a queued entry. Only while it is still `queued`: once the scheduler has claimed it
 * the request is either in flight or already answered, and there is nothing left to change.
 *
 * The whole entry is re-validated, not patched field by field, so an edit cannot produce a
 * combination the create path would have refused.
 */
app.put('/api/bookings/:id', async (req, res) => {
    const settings = BOOKING_SETTINGS;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const current = await client.query(
            'SELECT * FROM booking_queue WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (current.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'No such entry' });
        }
        const before = current.rows[0];
        if (before.status !== 'queued') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: `That request has already gone out (${before.status}). It cannot be changed.`
            });
        }

        /*
         * Email and phone are never sent to the board, so an edit form cannot show them
         * back. Blank means "leave them as they are" rather than "clear them" — which is
         * what lets the entry be edited without the contact details ever leaving the server.
         */
        let entry;
        let profileId = before.profile_id;
        try {
            // A profile named in the edit replaces all three contact facts at once; without
            // one, blank fields keep what is already stored.
            const resolved = await applyProfile(req.body);
            if (resolved.profileId) profileId = resolved.profileId;
            entry = validateBooking(mergeContact(resolved.body, before), { seasonEndsOn: settings.seasonEndsOn });
        } catch (error) {
            await client.query('ROLLBACK');
            if (error instanceof BookingInputError) {
                return res.status(400).json({ success: false, message: error.message, field: error.field });
            }
            throw error;
        }

        const now = new Date();
        // Moving the slot into a window that is already open re-rolls the send time to now,
        // so only an entry left sitting past its own grace is refused here.
        const sendAfter = sendAfterForEdit(before, entry.opensAt, settings);
        const deadline = graceDeadline(entry.opensAt, settings, sendAfter);
        if (now > deadline) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false, field: 'playDate',
                message: 'That booking window has already closed.'
            });
        }
        if (now >= entry.startPreferred && now >= entry.startAlternative) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, field: 'playDate', message: 'That slot is already in the past.' });
        }

        // Same lock as the create path, against the week the entry is moving INTO.
        const week = weekBounds(entry.playDate);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${entry.nameKey}|${week.start}`]);

        const held = await countHeld(client, entry.nameKey, entry.playDate, { excludeId: before.id });
        if (held >= QUOTA_PER_WEEK) {
            await client.query('ROLLBACK');
            const quota = await quotaFor(client, entry.name, entry.playDate, { excludeId: before.id });
            return res.status(409).json({
                success: false,
                reason: 'quota_reached',
                message: `That week is full for ${quota.name} — ${held} of ${QUOTA_PER_WEEK}.`,
                quota
            });
        }

        const updated = await client.query(`
            UPDATE booking_queue SET
                sport = $2, play_date = $3, start_preferred = $4, start_alternative = $5,
                duration_hours = $6, players = $7, indoor_outdoor = $8, facility = $9,
                other_facility = $10, language = $11, valid_sports_card = $12,
                name = $13, name_key = $14, email = $15, phone = $16, remarks = $17,
                opens_at = $18, send_after = $19, profile_id = $20
            WHERE id = $1 AND status = 'queued'
            RETURNING *
        `, [
            before.id, entry.sport, entry.playDate, entry.startPreferred, entry.startAlternative,
            entry.durationHours, entry.players, entry.indoorOutdoor, entry.facility,
            entry.otherFacility, entry.language, entry.validSportsCard,
            entry.name, entry.nameKey, entry.email, entry.phone, entry.remarks,
            entry.opensAt, sendAfter, profileId
        ]);

        await client.query('COMMIT');
        sendDueNow();

        const board = toBoardEntry(updated.rows[0]);
        broadcast({ type: 'booking_update', booking: board });
        res.json({ success: true, booking: board, quotaPerWeek: QUOTA_PER_WEEK });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error editing booking:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * One entry in full. Registered after the fixed paths above so /quota, /names and
 * /form-options are not swallowed by :id. Contact details stay server-side.
 */
app.get('/api/bookings/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT * FROM booking_queue WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'No such entry' });
        }
        const row = result.rows[0];
        res.json({
            success: true,
            booking: {
                ...toBoardEntry(row),
                language: row.language,
                validSportsCard: row.valid_sports_card,
                // Operator-facing only, and never the raw response body.
                responseNote: row.response_note
            }
        });
    } catch (error) {
        console.error('Error reading booking:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Take a slot out of the queue. Only while it is still waiting: once a request has gone
// to KU Leuven we cannot take it back, whatever they answer.
/*
 * Undo a cancellation, while the window is still ahead.
 *
 * No quota check. This puts back exactly what was there a moment ago, so the count returns
 * to what it already was; the gate exists to stop someone taking a THIRD slot in a week,
 * and an undo takes none. Re-checking made undo unusable for the imported bookings, which
 * are deliberately over the limit and whose names are still being sorted out — a button
 * that only works sometimes, for reasons the reader cannot see, is worse than the small
 * gap it closes. (The gap: cancel one, book another, then undo the first. Doing that on
 * purpose is possible; the two-a-week rule is a convention among people who know each
 * other, not a security boundary.)
 *
 * The original send delay is kept, so undoing does not quietly move the request to a
 * different place in the night's order.
 */
app.post('/api/bookings/:id/restore', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const current = await client.query(
            'SELECT * FROM booking_queue WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (current.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'No such entry' });
        }
        const entry = current.rows[0];
        if (entry.status !== 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: `That entry is ${entry.status}, not cancelled.`
            });
        }

        const settings = BOOKING_SETTINGS;

        /*
         * Undo is bounded by the same window the board shows it in. Once the row has left
         * the board there is no button to press, so accepting a restore after that would
         * only make the two disagree. A cancellation from before this column existed has no
         * cancelled_at, which reads correctly as long over.
         */
        const cancelledAt = entry.cancelled_at ? new Date(entry.cancelled_at).getTime() : 0;
        if (Date.now() > cancelledAt + settings.cancelUndoSeconds * 1000) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: 'The undo window for that cancellation has passed.'
            });
        }

        // Restoring cannot put a slot back into a window that has since closed.
        const deadline = graceDeadline(new Date(entry.opens_at), settings, entry.send_after);
        if (new Date() > deadline) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: 'That window has closed — the slot can no longer go out.'
            });
        }

        const restored = await client.query(`
            UPDATE booking_queue SET status = 'queued', cancelled_at = NULL
            WHERE id = $1 AND status = 'cancelled'
            RETURNING *
        `, [entry.id]);

        await client.query('COMMIT');
        sendDueNow();

        const board = toBoardEntry(restored.rows[0]);
        broadcast({ type: 'booking_update', booking: board });
        res.json({ success: true, booking: board });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error restoring booking:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

/*
 * Report a sent request as failed, by hand.
 *
 * KU Leuven answers by email, never to this app, so a refusal is invisible here until
 * someone says so. Until then the request keeps holding one of the person's two slots for
 * that week. Marking it `failed` gives the slot back. No undo: the person who pressed it can
 * queue the slot again, and that goes through the quota check like any new booking.
 */
app.post('/api/bookings/:id/report-failure', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await reportFailure(client, req.params.id);
        if (result.refused === null) {
            return res.status(404).json({ success: false, message: 'No such entry' });
        }
        if (result.refused) {
            return res.status(409).json({
                success: false,
                message: `That entry is ${result.refused}. Only a request that went out can be reported as failed.`
            });
        }
        const board = toBoardEntry(result.row);
        broadcast({ type: 'booking_update', booking: board });
        res.json({ success: true, booking: board });
    } catch (error) {
        console.error('Error reporting booking failure:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

app.delete('/api/bookings/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        /*
         * No attribution. There is no login here, so the only name available is whatever
         * the browser last booked under — a guess, and printing a guess as "removed by X"
         * states something the app cannot know. The cancelled_by column stays for the rows
         * already carrying one; nothing writes it any more.
         */
        const result = await client.query(`
            UPDATE booking_queue
            SET status = 'cancelled', cancelled_at = NOW()
            WHERE id = $1 AND status = 'queued'
            RETURNING *
        `, [req.params.id]);

        if (result.rows.length === 0) {
            const existing = await client.query('SELECT status FROM booking_queue WHERE id = $1', [req.params.id]);
            if (existing.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'No such entry' });
            }
            return res.status(409).json({
                success: false,
                message: `That request has already gone out (${existing.rows[0].status}). It cannot be taken back.`
            });
        }

        const board = toBoardEntry(result.rows[0]);
        broadcast({ type: 'booking_update', booking: board });
        res.json({ success: true, booking: board });
    } catch (error) {
        console.error('Error cancelling booking:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Feedback from the footer sheet: saved, then emailed when Resend is set up.
// The email is the owner's nudge, so a failed one is logged and the sender still sees Sent.
app.post('/api/feedback', async (req, res) => {
    let entry;
    try {
        entry = feedback.validateFeedback(req.body, req.get('user-agent'));
    } catch (error) {
        if (error instanceof feedback.FeedbackInputError) {
            return res.status(error.status).json({ error: error.code });
        }
        console.error('feedback', error);
        return res.status(500).json({ error: 'save' });
    }
    const id = uuidv4();
    try {
        await pool.query(
            `INSERT INTO feedback (id, message, email, page, user_agent, attachments)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, entry.message, entry.email, entry.page, entry.device, entry.files.map(f => f.name)]
        );
    } catch (error) {
        console.error('feedback', error);
        return res.status(502).json({ error: 'save' });
    }
    try {
        if (await feedback.mailFeedback(entry)) {
            await pool.query('UPDATE feedback SET emailed = TRUE WHERE id = $1', [id]);
        }
    } catch (error) {
        console.error('feedback mail', error);
    }
    res.status(204).end();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Events are managed on their own pages now; the admin area starts at the booking queue.
app.get(['/admin', '/admin/events'], (req, res) => {
    res.redirect(302, '/admin/bookings');
});

app.get('/admin/bookings', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin-bookings.html'));
});

app.get('/admin/bookings/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin-booking-detail.html'));
});

// Making an event is a sheet on Home.
app.get('/events/new', (req, res) => {
    res.redirect(302, '/#new');
});

// Management and calendar links carry their token in the path: keep it out of other sites'
// Referer headers and out of caches.
app.get('/host/:token', (req, res) => {
    res.set('Referrer-Policy', 'no-referrer').set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '../public/host.html'));
});

app.get('/calendars/:token', (req, res) => {
    res.set('Referrer-Policy', 'no-referrer').set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '../public/calendar.html'));
});

// The sign-in page (/me): it asks for an email, and the emailed link signs this device in.
// The link carries its token in the path, so it gets the management page's headers.
app.get(['/me', '/me/signin/:token'], (req, res) => {
    res.set('Referrer-Policy', 'no-referrer').set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '../public/me.html'));
});

app.post('/api/me/link', async (req, res) => {
    try {
        await contacts.requestSignIn(req.body?.email, { ip: req.ip, baseUrl: publicUrl(req), next: req.body?.next });
    } catch (error) {
        if (!error.status) throw error;
        return res.status(error.status).json({ success: false, field: error.field, message: error.message });
    }
    res.json({ success: true });
});

app.post('/api/me/session', async (req, res) => {
    const signedIn = await contacts.redeem(req.body?.token, req.get('user-agent'));
    if (!signedIn) return res.status(401).json({ success: false, message: 'This link has run out. Ask for a new one.' });
    contacts.signIn(res, signedIn.session);
    // Without a name yet, the page asks for one before going on (js/me.js).
    res.json({ success: true, ...(await contacts.profileOf(signedIn.email)) });
});

app.delete('/api/me/session', async (req, res) => {
    await contacts.signOut(req, res);
    res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
    const email = await contacts.emailOf(req);
    res.set('Cache-Control', 'no-store');
    if (!email) return res.status(401).json({ success: false, message: 'Not signed in.' });
    res.json({ success: true, ...(await contacts.profileOf(email)), chatMessages: await chat.countBy(email), ...(await contacts.eventsOf(email)) });
});

// The name a signed-in device fills in for RSVPs and new events (js/me.js).
app.put('/api/me/name', async (req, res) => {
    const email = await contacts.emailOf(req);
    if (!email) return res.status(401).json({ success: false, message: 'Sign in again.' });
    const { name, renamedIn } = await contacts.setName(email, req.body?.name);
    broadcastRenamed(renamedIn);
    res.json({ success: true, name });
});

app.post('/api/me/events/:eventId/manage', async (req, res) => {
    const email = await contacts.emailOf(req);
    if (!email) return res.status(401).json({ success: false, message: 'Sign in again.' });
    const hostPath = await contacts.manageLink(email, req.params.eventId);
    if (!hostPath) return res.status(404).json({ success: false, message: 'That event is not one of yours.' });
    res.status(201).json({ success: true, hostPath });
});

// Delete my email: the address leaves every event and RSVP, and every device signs out.
app.delete('/api/me', async (req, res) => {
    const email = await contacts.emailOf(req);
    if (!email) return res.status(401).json({ success: false, message: 'Sign in again.' });
    await contacts.forget(email);
    await chat.forget(email);
    await contacts.signOut(req, res);
    res.json({ success: true });
});

// Admin sign-in: a code to an address on ADMIN_EMAILS, then a 30-day cookie.
app.get('/admin/login', async (req, res) => {
    const next = String(req.query.next || '');
    if (await adminAuth.adminOf(req)) return res.redirect(302, next.startsWith('/admin/') ? next : '/admin/donations');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '../public/admin-login.html'));
});

app.post('/api/admin/code', async (req, res) => {
    const result = await adminAuth.sendCode(req.body?.email);
    if (!result.sent) return res.status(503).json({ message: result.reason });
    res.json({ success: true });
});

app.post('/api/admin/session', async (req, res) => {
    const token = await adminAuth.verifyCode(req.body?.email, req.body?.code);
    if (!token) return res.status(401).json({ field: 'code', message: 'That code is wrong or has run out. Ask for a new one.' });
    adminAuth.signIn(res, token);
    res.json({ success: true });
});

app.get('/api/admin/session', async (req, res) => {
    const email = await adminAuth.adminOf(req);
    if (!email) return res.status(401).json({ message: 'Not signed in.' });
    res.set('Cache-Control', 'no-store').json({ email });
});

app.delete('/api/admin/session', async (req, res) => {
    await adminAuth.signOut(req, res);
    res.json({ success: true });
});

app.get('/admin/places', adminAuth.requireAdminPage, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin-places.html'));
});

app.get('/admin/donations', adminAuth.requireAdminPage, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin-donations.html'));
});

app.get('/donate', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/donations.html'));
});

app.get('/donations', (req, res) => {
    res.redirect(301, '/donate');
});

// Serve the main application for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// Initialize database and start server
/*
 * Submission is off unless BOOKING_SUBMIT=live is set. Dry run exercises the claim and
 * the whole state machine without sending anything to KU Leuven.
 */
// Copies each change to an event into its Google calendar (calendar-publish.js).
const publisher = createPublisher({
    pool,
    googleCalendar,
    publicUrl: appConfig.publicUrl || null,
    places: () => placeList(),
    broadcast
});

/*
 * Take each calendar over from Google once (calendar-import.js). Needs credentials; a failure
 * is retried every ten minutes, and the legacy feed keeps that calendar fresh meanwhile.
 */
async function importCalendars() {
    if (!googleCalendar) return;
    let failed = false;
    for (const calendar of publishedCalendars()) {
        if (importedCalendars.has(calendar.id)) continue;
        try {
            const { imported, removed } = await importCalendar({ pool, googleCalendar, calendarId: calendar.id, sanitize: sanitizeHtmlText });
            importedCalendars.add(calendar.id);
            console.log(`[import] ${calendar.name}: took over ${imported} events from Google, dropped ${removed} gone ones.`);
            publisher.nudge();
            broadcast({ type: 'event_update', payload: { ids: [] } });
        } catch (error) {
            failed = true;
            console.error(`[import] ${calendar.name} failed:`, error.message);
        }
    }
    if (failed) setTimeout(importCalendars, 10 * 60 * 1000).unref();
}

const bookingScheduler = bookingConfigError ? null : createScheduler({
    pool,
    broadcast,
    settings: BOOKING_SETTINGS,
    live: process.env.BOOKING_SUBMIT === 'live',
    toBoardEntry
});

/*
 * The database can be unreachable for a moment while the dyno boots. A rejection here used to
 * crash the process, and Heroku backs off further after each crash, so the app stayed down
 * until someone restarted it. Wait and try again; give up loudly after about a minute.
 */
const DB_CONNECT_ATTEMPTS = 6;

async function initializeDatabaseWithRetry() {
    for (let attempt = 1; ; attempt++) {
        try {
            await initializeDatabase();
            await placeStore.load();
            return;
        } catch (error) {
            if (attempt >= DB_CONNECT_ATTEMPTS) throw error;
            const waitMs = Math.min(2000 * 2 ** (attempt - 1), 20000);
            console.error(`Database not ready (attempt ${attempt}/${DB_CONNECT_ATTEMPTS}): ${error.message}. Retrying in ${waitMs / 1000}s`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }
}

initializeDatabaseWithRetry().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Event Attendance App server running on http://localhost:${PORT}`);
        console.log('🎉 Ready to accept RSVPs!');
    });
    importedCalendarIds(pool).then((ids) => {
        importedCalendars = ids;
        // Pull the feed now for calendars not yet taken over, so the first visitor after a
        // restart is not the one who triggers it.
        if (appConfig.events.autoFetch && legacyFeedNeeded()) refreshCalendar();
        return importCalendars();
    }).catch((error) => console.error('Calendar takeover failed to start:', error.message));
    publisher.start();
    // Chat threads end 180 days after their event; checked at boot and every six hours.
    const expireChats = () => chat.expire()
        .then((n) => { if (n) console.log(`[chat] ${n} old messages deleted`); })
        .catch((error) => console.error('[chat] expiry failed:', error.message));
    expireChats();
    setInterval(expireChats, 6 * 3600 * 1000).unref();
    if (bookingScheduler) {
        bookingScheduler.start().catch((error) => {
            console.error('Booking scheduler failed to start:', error.message);
        });
    }
}).catch((error) => {
    console.error('Database unreachable, giving up:', error.message);
    process.exit(1);
});
