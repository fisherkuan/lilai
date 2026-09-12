const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
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

const QUEUED_STATUSES = ['queued', 'sending'];
const HISTORY_STATUSES = ['sent', 'unconfirmed', 'failed', 'missed', 'cancelled'];

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
        status: row.status,
        opensAt: row.opens_at,
        queuedAt: row.queued_at,
        queuedBy: row.queued_by,
        submittedAt: row.submitted_at,
        cancelledBy: row.cancelled_by
    };
}

// List the board: everything still owed a submission, plus a page of what has gone out.
app.get('/api/bookings', async (req, res) => {
    const client = await pool.connect();
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

        const queued = await client.query(
            `SELECT * FROM booking_queue WHERE status = ANY($1) ORDER BY send_after ASC`,
            [QUEUED_STATUSES]
        );

        const params = [HISTORY_STATUSES];
        let historySql = `SELECT * FROM booking_queue WHERE status = ANY($1)`;
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
            quotaPerWeek: QUOTA_PER_WEEK
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
        if (!name) return res.status(400).json({ success: false, message: 'A name is required' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(playDate)) {
            return res.status(400).json({ success: false, message: 'playDate must be YYYY-MM-DD' });
        }
        res.json({ success: true, ...(await quotaFor(client, name, playDate)) });
    } catch (error) {
        console.error('Error reading booking quota:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Names known to the queue, newest first — the autocomplete behind the name field.
app.get('/api/bookings/names', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT DISTINCT ON (name_key) name_key, name
            FROM booking_queue
            ORDER BY name_key, queued_at DESC
        `);
        res.json({ success: true, names: result.rows.map((row) => row.name) });
    } catch (error) {
        console.error('Error listing booking names:', error);
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
    const fresh = Date.now() - formOptionsCache.fetchedAt < FORM_OPTIONS_TTL;
    if (formOptionsCache.value && fresh) {
        return res.json({ success: true, cached: true, ...formOptionsCache.value });
    }
    try {
        const options = readFormOptions(await new BookingFormClient().getForm());
        formOptionsCache = { value: options, fetchedAt: Date.now() };
        res.json({ success: true, cached: false, ...options });
    } catch (error) {
        console.error('Error reading booking form options:', error.message);
        if (formOptionsCache.value) {
            return res.json({ success: true, cached: true, stale: true, ...formOptionsCache.value });
        }
        res.status(503).json({ success: false, message: 'Could not read the booking form right now' });
    }
});

// Queue a slot.
app.post('/api/bookings', async (req, res) => {
    let entry;
    try {
        entry = validateBooking(req.body);
    } catch (error) {
        if (error instanceof BookingInputError) {
            return res.status(400).json({ success: false, message: error.message, field: error.field });
        }
        throw error;
    }

    const settings = bookingSettings(appConfig);
    const now = new Date();

    // Refuse a window that has already closed rather than accepting an entry that can
    // only ever become `missed`. Inside the grace window is fine: it fires immediately.
    const deadline = new Date(entry.opensAt.getTime() + settings.lateSubmissionGraceSeconds * 1000);
    if (now > deadline) {
        return res.status(400).json({
            success: false,
            field: 'playDate',
            message: 'That booking window has already closed — it opened more than five minutes ago.'
        });
    }
    if (now >= entry.startPreferred && now >= entry.startAlternative) {
        return res.status(400).json({ success: false, field: 'playDate', message: 'That slot is already in the past.' });
    }

    const queuedBy = typeof req.body.queuedBy === 'string' && req.body.queuedBy.trim()
        ? req.body.queuedBy.trim().slice(0, 100)
        : entry.name;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Serialize every check-then-insert for one name in one play week, so two people
        // queueing the same name at the same moment cannot both pass a count of 1.
        const week = weekBounds(entry.playDate);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${entry.nameKey}|${week.start}`]);

        const held = await countHeld(client, entry.nameKey, entry.playDate);
        if (held >= QUOTA_PER_WEEK) {
            await client.query('ROLLBACK');
            const quota = await quotaFor(client, entry.name, entry.playDate);
            return res.status(409).json({
                success: false,
                reason: 'quota_reached',
                message: `That week is full for ${quota.name} — ${held} of ${QUOTA_PER_WEEK}.`,
                quota
            });
        }

        const id = uuidv4();
        const sendAfter = sampleSendAfter(entry.opensAt, settings);

        const inserted = await client.query(`
            INSERT INTO booking_queue (
                id, sport, play_date, start_preferred, start_alternative, duration_hours,
                players, indoor_outdoor, facility, other_facility, language, valid_sports_card,
                name, name_key, email, phone, remarks, queued_by, opens_at, send_after, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'queued')
            RETURNING *
        `, [
            id, entry.sport, entry.playDate, entry.startPreferred, entry.startAlternative, entry.durationHours,
            entry.players, entry.indoorOutdoor, entry.facility, entry.otherFacility, entry.language,
            entry.validSportsCard, entry.name, entry.nameKey, entry.email, entry.phone, entry.remarks,
            queuedBy, entry.opensAt, sendAfter
        ]);

        await client.query('COMMIT');

        const board = toBoardEntry(inserted.rows[0]);
        broadcast({ type: 'booking_update', booking: board });
        res.status(201).json({ success: true, booking: board, quotaPerWeek: QUOTA_PER_WEEK });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error queueing booking:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Take a slot out of the queue. Only while it is still waiting: once a request has gone
// to KU Leuven we cannot take it back, whatever they answer.
app.delete('/api/bookings/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const by = typeof req.body.cancelledBy === 'string' && req.body.cancelledBy.trim()
            ? req.body.cancelledBy.trim().slice(0, 100)
            : null;

        const result = await client.query(`
            UPDATE booking_queue
            SET status = 'cancelled', cancelled_by = $2
            WHERE id = $1 AND status = 'queued'
            RETURNING *
        `, [req.params.id, by]);

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
initializeDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Event Attendance App server running on http://localhost:${PORT}`);
        console.log('🎉 Ready to accept RSVPs!');
    });
});
