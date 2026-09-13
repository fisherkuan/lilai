const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const WebSocket = require('ws');

const { weekBounds } = require('./booking-time');
const { validateBooking, BookingInputError } = require('./booking-validation');
const { QUOTA_PER_WEEK, countHeld, quotaFor } = require('./booking-quota');
const { bookingSettings, sampleSendAfter } = require('./booking-settings');
const { createBookingSchema } = require('./booking-schema');
const { BookingFormClient, readFormOptions } = require('./booking-form');
const { createScheduler } = require('./booking-scheduler');
const { mergeContact, sendAfterForEdit } = require('./booking-edit');
const {
    expandRepeat, validateRule, describeRule, RepeatError, UNITS, MAX_EVERY, MAX_OCCURRENCES
} = require('./booking-repeat');
const { createSeriesSchema, toSeriesView, LIST_SQL: SERIES_LIST_SQL, ONE_SQL: SERIES_ONE_SQL } = require('./booking-series');
const {
    createProfileSchema, publicProfile, fullProfile, validateProfile
} = require('./booking-profiles');

// Load environment variables
require('dotenv').config();

// Validate required environment variables at startup
const requiredEnvVars = ['DATABASE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'ADMIN_API_KEY'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
}

const app = express();

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
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

const isProduction = process.env.NODE_ENV === 'production';

// Calendar cache to reduce external API calls
let calendarCache = {
    events: [],
    lastFetch: 0
};
let lastSyncedFetch = 0; // calendarCache.lastFetch generation already synced to the DB
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Admin authentication middleware
function requireAdminKey(req, res, next) {
    const adminKey = process.env.ADMIN_API_KEY;

    if (!adminKey) {
        console.error('ADMIN_API_KEY not configured in environment variables');
        return res.status(500).json({ success: false, message: 'Server configuration error' });
    }

    const providedKey = req.headers['x-admin-key'] || req.body.adminKey;

    if (providedKey !== adminKey) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Invalid admin key' });
    }

    next();
}

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
        rsvp: { allowAnonymous: false, requireName: true },
        stripe: {
            donationPriceId: '',
            donationProgress: { current: 0, goal: 0 }
        }
    };
}

if (!appConfig.stripe) {
    appConfig.stripe = {
        donationPriceId: '',
        donationProgress: { current: 0, goal: 0 }
    };
} else {
    appConfig.stripe.donationProgress = appConfig.stripe.donationProgress || { current: 0, goal: 0 };
}

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
    console.log('Client connected');
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

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

function decodeHtmlEntities(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, '\'')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');
}

function sanitizeHtmlText(value) {
    if (typeof value !== 'string') {
        return '';
    }

    let text = value;

    text = text.replace(/<(br|hr)\s*\/?>/gi, '\n');
    text = text.replace(/<\/p\s*>/gi, '\n');
    text = text.replace(/<\/div\s*>/gi, '\n');

    text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (match, href, linkText) => {
        const trimmedLinkText = (linkText || '').trim();
        if (trimmedLinkText && trimmedLinkText !== href) {
            return `${trimmedLinkText} (${href})`;
        }
        return href;
    });

    text = text.replace(/<[^>]+>/g, '');

    return decodeHtmlEntities(text)
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
        .trim();
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

        await createBookingSchema(client);
        await createSeriesSchema(client);
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

// Function to fetch events from Google Calendar with caching
async function getCachedCalendarEvents() {
    const now = Date.now();
    if (now - calendarCache.lastFetch > CACHE_TTL) {
        calendarCache.events = await fetchCalendarEvents();
        calendarCache.lastFetch = now;
        console.log('Calendar events fetched from Google Calendar');
    } else {
        console.log('Using cached calendar events');
    }
    return calendarCache.events;
}

// Function to fetch events from Google Calendar
async function fetchCalendarEvents() {
    if (!appConfig.calendars || appConfig.calendars.length === 0) {
        return [];
    }

    let allEvents = [];
    try {
        for (const calendarEntry of appConfig.calendars) {
            if (!calendarEntry.enabled) {
                continue;
            }
            const calendarUrl = calendarEntry.url;
            let calendarId = null;
            if (calendarUrl.includes('src=')) {
                const match = calendarUrl.match(/src=([^&]+)/);
                if (match) calendarId = decodeURIComponent(match[1]);
            } else if (calendarUrl.includes('calendar.google.com/calendar/ical/')) {
                const match = calendarUrl.match(/ical\/([^\/]+)\//);
                if (match) calendarId = decodeURIComponent(match[1]);
            } else {
                const match = calendarUrl.match(/calendar\/([^\/?&]+)/);
                if (match) calendarId = decodeURIComponent(match[1]);
            }

            if (!calendarId) {
                console.warn(`Could not extract calendar ID from URL: ${calendarUrl}`);
                continue;
            }

            const icalUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
            const response = await fetch(icalUrl);
            if (!response.ok) {
                console.error(`Error fetching calendar from ${icalUrl}: HTTP ${response.status}: ${response.statusText}`);
                continue;
            }
            
            const icsText = await response.text();
            const veventBlocks = icsText.split('BEGIN:VEVENT').slice(1);
            
            for (const block of veventBlocks) {
                const summaryMatch = block.match(/SUMMARY:(.*)/);
                const dtstartMatch = block.match(/DTSTART(?:;[^:]+)?:([0-9T]+)/);
                const dtendMatch = block.match(/DTEND(?:;[^:]+)?:([0-9T]+)/);
                const uidMatch = block.match(/UID:(.*)/);
                const description = extractIcsField(block, 'DESCRIPTION');
                const location = extractIcsField(block, 'LOCATION');
                let attendanceLimitFromDescription = undefined; // Use undefined to signify "not specified"

                if (description) {
                    const limitMatch = description.match(/limit:?\s*(\d+)/i); // Only capture numbers
                    if (limitMatch) {
                        attendanceLimitFromDescription = parseInt(limitMatch[1], 10); // A number
                    }
                }

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
                        source: calendarId,
                        attendance_limit_from_description: attendanceLimitFromDescription
                    });
                }
            }
        }
        return allEvents;
    } catch (error) {
        console.error('Error fetching calendar events:', error);
        return allEvents;
    }
}


// API Routes

// Get configuration
app.get('/api/config', (req, res) => {
    try {
        res.json(appConfig);
    } catch (error) {
        console.error('Error fetching config:', error);
        res.status(500).json({ error: 'Failed to fetch configuration' });
    }
});

app.get('/api/stripe-key', (req, res) => {
    res.json({ publicKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// Get donation progress
app.get('/api/donation-progress', (req, res) => {
    const donationProgress = appConfig.stripe?.donationProgress || {};
    res.json({
        current: donationProgress.current ?? 600,
        goal: donationProgress.goal ?? 1000
    });
});

app.post('/api/create-donation-checkout-session', async (req, res) => {
    const priceId = appConfig.stripe?.donationPriceId;

    if (!priceId) {
        return res.status(500).json({ error: 'Donation price ID not configured' });
    }

    const session = await stripe.checkout.sessions.create({
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        mode: 'payment',
        submit_type: 'donate',
        success_url: `${req.headers.origin}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin}`,
    });

    res.json({ id: session.id });
});



// Get all events
app.get('/api/events', async (req, res) => {
    const client = await pool.connect();
    try {
        const timeRange = req.query.timeRange || appConfig.events.defaultTimeRange;

        // Sync at most once per calendar refresh — within the cache TTL the DB
        // already reflects the feed, so those requests skip the write path.
        // "Stale cache" must enter too: getCachedCalendarEvents() is what
        // refreshes the cache in the first place.
        const cacheIsStale = Date.now() - calendarCache.lastFetch > CACHE_TTL;
        if (appConfig.events.autoFetch && (cacheIsStale || calendarCache.lastFetch !== lastSyncedFetch)) {
            const calendarEvents = await getCachedCalendarEvents();
            // Snapshot the generation this request is about to write; a
            // concurrent refresh mid-sync must not be marked synced by us.
            const syncedGeneration = calendarCache.lastFetch;

            await client.query('BEGIN');

            // Sync calendar events
            if (calendarEvents.length > 0) {
                // Fetch existing events for comparison
                const existingEventsResult = await client.query('SELECT id, attendance_limit FROM events');
                const existingEventsMap = new Map(existingEventsResult.rows.map(row => [row.id, row]));

                // Dedupe by id (last wins, like the per-row upserts did) — a
                // repeated id in one multi-row INSERT is a Postgres error.
                const rowsById = new Map();
                for (const event of calendarEvents) {
                    let finalAttendanceLimit;
                    const existingEvent = existingEventsMap.get(event.id);

                    if (event.attendance_limit_from_description !== undefined) {
                        // Limit was explicitly specified in the description (a number)
                        finalAttendanceLimit = event.attendance_limit_from_description;
                    } else if (existingEvent) {
                        // Preserve existing limit if event already exists
                        finalAttendanceLimit = existingEvent.attendance_limit;
                    } else {
                        // New event, no limit in description, so default to null (unlimited)
                        finalAttendanceLimit = null;
                    }

                    rowsById.set(event.id, [event.id, event.title, event.date, event.endDate, event.description, event.location, event.source, finalAttendanceLimit]);
                }

                // One multi-row upsert — per-row statements cost a network
                // round trip each, which is fatal when the DB isn't local.
                const upsertParams = [];
                const placeholders = [];
                for (const row of rowsById.values()) {
                    const base = upsertParams.length;
                    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
                    upsertParams.push(...row);
                }
                await client.query(
                    `INSERT INTO events (id, title, date, endDate, description, location, source, attendance_limit)
                     VALUES ${placeholders.join(', ')}
                     ON CONFLICT (id) DO UPDATE SET
                        title = EXCLUDED.title,
                        date = EXCLUDED.date,
                        endDate = EXCLUDED.endDate,
                        description = EXCLUDED.description,
                        location = EXCLUDED.location,
                        source = EXCLUDED.source,
                        attendance_limit = EXCLUDED.attendance_limit`,
                    upsertParams
                );
            }

            // Remove deleted calendar events
            const dbEventsResult = await client.query('SELECT id, source FROM events WHERE source IS NOT NULL');
            const dbEventsBySource = dbEventsResult.rows.reduce((acc, row) => {
                if (!acc[row.source]) {
                    acc[row.source] = new Set();
                }
                acc[row.source].add(row.id);
                return acc;
            }, {});

            const calendarEventsBySource = calendarEvents.reduce((acc, event) => {
                if (!acc[event.source]) {
                    acc[event.source] = new Set();
                }
                acc[event.source].add(event.id);
                return acc;
            }, {});

            let staleEventIds = [];
            for (const source in dbEventsBySource) {
                const dbIds = dbEventsBySource[source];
                const calendarIds = calendarEventsBySource[source] || new Set();
                const staleIds = [...dbIds].filter(id => !calendarIds.has(id));
                staleEventIds.push(...staleIds);
            }

            if (staleEventIds.length > 0) {
                await client.query(`DELETE FROM events WHERE id = ANY($1::varchar[])`, [staleEventIds]);
            }

            await client.query('COMMIT');
            lastSyncedFetch = syncedGeneration;
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
            whereClause = `WHERE e.date < $${params.length}`;
            orderClause = 'ORDER BY e.date DESC';
            if (limit) {
                params.push(limit);
                limitClause = `LIMIT $${params.length}`;
            }
        } else {
            switch (timeRange) {
                case 'future':
                    whereClause = 'WHERE e.date > NOW()';
                    break;
                case 'past':
                    whereClause = 'WHERE e.date < NOW()';
                    break;
                case 'all':
                default:
                    whereClause = '';
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
                r.attendees
            FROM events e
            LEFT JOIN (
                SELECT
                    event_id,
                    COUNT(*) as attendingCount,
                    array_agg(attendee_name) as attendees
                FROM rsvps
                WHERE attendance = 'yes'
                GROUP BY event_id
            ) r ON e.id = r.event_id
            ${whereClause}
            ${orderClause}
            ${limitClause}
        `, params);

        const eventsWithAttendance = eventsResult.rows.map(event => ({
            ...event,
            attendingCount: parseInt(event.attendingCount, 10),
            attendees: event.attendees || []
        }));

        res.json(eventsWithAttendance);
    } catch (error) {
        // A failed sync leaves the transaction open; without ROLLBACK the
        // released connection poisons the pool for every later request.
        try { await client.query('ROLLBACK'); } catch (rollbackError) { /* connection gone */ }
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    } finally {
        client.release();
    }
});

// Get a specific event
app.get('/api/events/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const result = await client.query('SELECT * FROM events WHERE id = $1', [id]);
        const event = result.rows[0];

        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }

        res.json(event);
    } catch (error) {
        console.error('Error fetching event:', error);
        res.status(500).json({ error: 'Failed to fetch event' });
    } finally {
        client.release();
    }
});

// Submit RSVP
app.post('/api/rsvp', async (req, res) => {
    const client = await pool.connect();
    try {
        const { eventId, action, attendeeName } = req.body;

        if (!eventId || !action) {
            return res.status(400).json({ success: false, message: 'Event ID and action are required' });
        }

        if (!['add', 'remove'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid action. Must be "add" or "remove"' });
        }

        const eventResult = await client.query('SELECT * FROM events WHERE id = $1', [eventId]);
        if (eventResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Event not found' });
        }

        const event = eventResult.rows[0];

        if (action === 'add') {
            // Validate attendee name
            const validatedName = validateAttendeeName(attendeeName);
            if (!validatedName) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid attendee name. Name must be 1-100 characters and contain no scripts.'
                });
            }

            if (event.attendance_limit !== null) {
                const rsvpsResult = await client.query('SELECT COUNT(*) FROM rsvps WHERE event_id = $1 AND attendance = $2', [eventId, 'yes']);
                const attendingCount = parseInt(rsvpsResult.rows[0].count, 10);
                if (attendingCount >= event.attendance_limit) {
                    return res.status(400).json({ success: false, message: 'Event is full' });
                }
            }

            const newRsvp = {
                id: uuidv4(),
                eventId,
                attendance: 'yes',
                attendeeName: validatedName,
                timestamp: new Date()
            };
            await client.query(
                'INSERT INTO rsvps (id, event_id, attendee_name, attendance, timestamp) VALUES ($1, $2, $3, $4, $5)',
                [newRsvp.id, newRsvp.eventId, newRsvp.attendeeName, newRsvp.attendance, newRsvp.timestamp]
            );
        } else if (action === 'remove') {
            // Validate attendee name
            const validatedName = validateAttendeeName(attendeeName);
            if (!validatedName) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid attendee name'
                });
            }
            await client.query(
                'DELETE FROM rsvps WHERE id IN (SELECT id FROM rsvps WHERE event_id = $1 AND attendee_name = $2 AND attendance = $3 LIMIT 1)',
                [eventId, validatedName, 'yes']
            );
        }

        // After action, fetch updated attendance data and broadcast
        const eventRsvpsResult = await client.query('SELECT attendee_name FROM rsvps WHERE event_id = $1 AND attendance = $2', [eventId, 'yes']);
        const attendees = eventRsvpsResult.rows.map(rsvp => rsvp.attendee_name);
        const attendingCount = attendees.length;

        broadcast({
            type: 'attendance_update',
            payload: {
                eventId,
                attendingCount,
                attendees
            }
        });

        res.json({ success: true, message: `RSVP ${action === 'add' ? 'added' : 'removed'} successfully` });
    } catch (error) {
        console.error('Error submitting RSVP:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/events endpoint removed - events are managed via Google Calendar sync

// Update event attendance limit (ONLY - other fields sync from Google Calendar)
app.put('/api/events/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { attendanceLimit } = req.body;

        // ONLY allow attendance_limit updates - reject attempts to modify other fields
        const bodyKeys = Object.keys(req.body);
        if (bodyKeys.length !== 1 || attendanceLimit === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Only attendanceLimit can be updated. Other event fields are synced from Google Calendar.'
            });
        }

        // Validate attendance limit
        const limit = attendanceLimit === null || attendanceLimit === '' ? null : parseInt(attendanceLimit, 10);
        if (limit !== null && (isNaN(limit) || limit < 0)) {
            return res.status(400).json({
                success: false,
                message: 'Attendance limit must be a positive number or null'
            });
        }

        await client.query(
            'UPDATE events SET attendance_limit = $1 WHERE id = $2',
            [limit, id]
        );

        const updatedEventResult = await client.query('SELECT * FROM events WHERE id = $1', [id]);
        const updatedEvent = updatedEventResult.rows[0];

        if (!updatedEvent) {
            return res.status(404).json({ success: false, message: 'Event not found' });
        }

        const eventRsvpsResult = await client.query(
            'SELECT attendee_name FROM rsvps WHERE event_id = $1 AND attendance = $2',
            [id, 'yes']
        );
        const attendees = eventRsvpsResult.rows.map(rsvp => rsvp.attendee_name);
        const attendingCount = attendees.length;

        broadcast({
            type: 'event_update',
            payload: {
                ...updatedEvent,
                attendees,
                attendingCount
            }
        });

        res.json({ success: true, message: 'Attendance limit updated successfully', event: updatedEvent });
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

// DELETE /api/events/:id endpoint removed - events are managed via Google Calendar sync

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
app.post('/api/donations', requireAdminKey, async (req, res) => {
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
const HISTORY_STATUSES = ['sent', 'unconfirmed', 'failed', 'missed', 'cancelled'];

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
        status: row.status,
        opensAt: row.opens_at,
        queuedAt: row.queued_at,
        queuedBy: row.queued_by,
        submittedAt: row.submitted_at
    };
}

/*
 * The booking block of config/app.json is edited by hand once a year (seasonEndsOn), and a
 * typo there must not take the calendar, RSVPs and donations down with it. Checked once,
 * here: when it fails, every booking route answers 503 with the reason, the scheduler is
 * not started, and the rest of the app runs as it always did.
 */
let bookingConfigError = null;
try {
    bookingSettings(appConfig);
} catch (error) {
    bookingConfigError = error;
    console.error(`Bookings are off until config/app.json is fixed: ${error.message}`);
}
app.use(['/api/bookings', '/api/booking-series', '/api/booking-profiles'], (req, res, next) => {
    if (!bookingConfigError) return next();
    res.status(503).json({ success: false, message: `Bookings are off: ${bookingConfigError.message}` });
});

// List the board: everything still owed a submission, plus a page of what has gone out.
app.get('/api/bookings', async (req, res) => {
    const client = await pool.connect();
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const settings = bookingSettings(appConfig);
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
    const { seasonEndsOn } = bookingSettings(appConfig);
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
 * and by the same closed-window rule: a slot whose midnight has passed cannot come back.
 */
app.post('/api/booking-series/:id/restore-remaining', async (req, res) => {
    const settings = bookingSettings(appConfig);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const restored = await client.query(`
            UPDATE booking_queue SET status = 'queued', cancelled_at = NULL
            WHERE series_id = $1
              AND status = 'cancelled'
              AND cancelled_at > NOW() - make_interval(secs => $2::int)
              AND opens_at + make_interval(secs => $3::int) > NOW()
            RETURNING *
        `, [req.params.id, settings.cancelUndoSeconds, settings.lateSubmissionGraceSeconds]);

        await client.query('COMMIT');

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
    const settings = bookingSettings(appConfig);
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
        let entry;
        try {
            entry = validateBooking({ ...body, playDate }, { seasonEndsOn: settings.seasonEndsOn });
        } catch (error) {
            if (!(error instanceof BookingInputError)) throw error;
            if (playDate === dates[0]) {
                return res.status(400).json({ success: false, message: error.message, field: error.field });
            }
            skipped.push({ playDate, reason: error.message });
            continue;
        }
        const deadline = new Date(entry.opensAt.getTime() + settings.lateSubmissionGraceSeconds * 1000);
        if (now > deadline || (now >= entry.startPreferred && now >= entry.startAlternative)) {
            const message = now > deadline
                ? 'That booking window has already closed.'
                : 'That slot is already in the past.';
            if (playDate === dates[0]) {
                return res.status(400).json({ success: false, field: 'playDate', message });
            }
            skipped.push({ playDate, reason: message });
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

            const inserted = await client.query(`
                INSERT INTO booking_queue (
                    id, sport, play_date, start_preferred, start_alternative, duration_hours,
                    players, indoor_outdoor, facility, other_facility, language, valid_sports_card,
                    name, name_key, email, phone, remarks, queued_by, opens_at, send_after,
                    profile_id, series_id, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 'queued')
                RETURNING *
            `, [
                uuidv4(), entry.sport, playDate, entry.startPreferred, entry.startAlternative, entry.durationHours,
                entry.players, entry.indoorOutdoor, entry.facility, entry.otherFacility, entry.language,
                entry.validSportsCard, entry.name, entry.nameKey, entry.email, entry.phone, entry.remarks,
                queuedBy, entry.opensAt, sampleSendAfter(entry.opensAt, settings), profileId, req.params.id
            ]);
            created.push(toBoardEntry(inserted.rows[0]));
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
        seasonEndsOn: bookingSettings(appConfig).seasonEndsOn,
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
    const settings = bookingSettings(appConfig);
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
        let entry;
        try {
            entry = validateBooking({ ...body, playDate }, { seasonEndsOn: settings.seasonEndsOn });
        } catch (error) {
            if (!(error instanceof BookingInputError)) throw error;
            // The first date's problems are the request's problems — a typo in the times is
            // not something to report as "week 1 skipped".
            if (playDate === dates[0]) {
                return res.status(400).json({ success: false, message: error.message, field: error.field });
            }
            skipped.push({ playDate, reason: error.message });
            continue;
        }

        // Refuse a window that has already closed rather than accepting an entry that can
        // only ever become `missed`. Inside the grace window is fine: it fires immediately.
        const deadline = new Date(entry.opensAt.getTime() + settings.lateSubmissionGraceSeconds * 1000);
        if (now > deadline || (now >= entry.startPreferred && now >= entry.startAlternative)) {
            const message = now > deadline
                ? 'That booking window has already closed.'
                : 'That slot is already in the past.';
            if (playDate === dates[0]) {
                return res.status(400).json({ success: false, field: 'playDate', message });
            }
            skipped.push({ playDate, reason: message });
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
                queuedBy, entry.opensAt, sampleSendAfter(entry.opensAt, settings), profileId, seriesId
            ]);
            created.push(toBoardEntry(inserted.rows[0]));
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
    const settings = bookingSettings(appConfig);
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
        const deadline = new Date(entry.opensAt.getTime() + settings.lateSubmissionGraceSeconds * 1000);
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

        const sendAfter = sendAfterForEdit(before, entry.opensAt, settings);

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
                sendAfter: row.send_after,
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

        const settings = bookingSettings(appConfig);

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
        const deadline = new Date(new Date(entry.opens_at).getTime() + settings.lateSubmissionGraceSeconds * 1000);
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

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/admin', (req, res) => {
    res.redirect(301, '/admin/events');
});

app.get('/admin/events', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/admin/bookings', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin-bookings.html'));
});

app.get('/admin/bookings/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin-booking-detail.html'));
});

app.get('/admin/donations', (req, res) => {
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
const bookingScheduler = bookingConfigError ? null : createScheduler({
    pool,
    broadcast,
    settings: bookingSettings(appConfig),
    live: process.env.BOOKING_SUBMIT === 'live',
    toBoardEntry
});

initializeDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Event Attendance App server running on http://localhost:${PORT}`);
        console.log('🎉 Ready to accept RSVPs!');
    });
    if (bookingScheduler) {
        bookingScheduler.start().catch((error) => {
            console.error('Booking scheduler failed to start:', error.message);
        });
    }
});
