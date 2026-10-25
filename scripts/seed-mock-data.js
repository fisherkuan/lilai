// Seeds the local Postgres DB with mock events, RSVPs, and donations
// so the UI can be exercised without a Google Calendar or Stripe round-trip.
//
// Usage:
//     npm run seed              # insert mock data (keeps existing rows)
//     npm run seed -- --reset   # wipe events/rsvps/donations, then insert
//
// IMPORTANT: set `events.autoFetch = false` in config/app.json while working
// with mock data, otherwise the calendar sync will delete any event that has
// a non-null `source` value not present in the live Google Calendar feed.

require('dotenv').config();
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('DATABASE_URL not set. Check your .env file.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const shouldReset = process.argv.includes('--reset');

function daysFromNow(n, hour = 19, minute = 0) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(hour, minute, 0, 0);
    return d;
}

function plusHours(date, hours) {
    return new Date(date.getTime() + hours * 3600 * 1000);
}

// --- Mock events ---
// Use `source: null` so the calendar-sync stale-cleanup skips these rows.
// IDs are prefixed `mock-` to avoid clashing with `cal-{UID}` calendar IDs.
const mockEvents = [
    {
        id: 'mock-001',
        title: 'Badminton — weekly meetup',
        date: daysFromNow(-14, 19),
        endDate: daysFromNow(-14, 21),
        description: 'Casual doubles at the SportsCenter. All levels welcome.',
        location: 'Sportkot, Tervuursevest 101',
        source: null,
        attendance_limit: 12
    },
    {
        id: 'mock-002',
        title: 'Taiwanese night market dinner',
        date: daysFromNow(-7, 18, 30),
        endDate: daysFromNow(-7, 22),
        description: 'Bubble tea, beef noodles, and xiao long bao. Bring friends!',
        location: 'Alma 2',
        source: null,
        attendance_limit: null
    },
    {
        id: 'mock-003',
        title: 'Board game night',
        date: daysFromNow(-3, 20),
        endDate: daysFromNow(-3, 23),
        description: 'Catan, Codenames, Splendor. Snacks provided.',
        location: 'Oude Markt',
        source: null,
        attendance_limit: 20
    },
    {
        id: 'mock-004',
        title: 'Morning run along Dijle',
        date: daysFromNow(1, 8),
        endDate: daysFromNow(1, 9, 30),
        description: '5km easy pace. Meet at Ladeuzeplein.',
        links: [{ url: 'https://maps.google.com/?q=Ladeuzeplein', label: 'Map' }],
        location: 'Ladeuzeplein',
        source: null,
        attendance_limit: null
    },
    {
        id: 'mock-005',
        title: 'Hot pot gathering',
        date: daysFromNow(3, 19),
        endDate: daysFromNow(3, 22),
        description: 'Communal hot pot — bring an ingredient.',
        location: 'Fisher\'s place',
        source: null,
        attendance_limit: 10
    },
    {
        id: 'mock-006',
        title: 'Basketball pickup',
        date: daysFromNow(7, 18),
        endDate: daysFromNow(7, 20),
        description: 'Friendly pickup game. Bring water.',
        location: 'Sportkot',
        source: null,
        attendance_limit: 14
    },
    {
        id: 'mock-007',
        title: 'Language exchange café',
        date: daysFromNow(10, 19),
        endDate: daysFromNow(10, 21),
        description: 'Mandarin / Dutch / English rotations.',
        location: 'Café Commerce',
        source: null,
        attendance_limit: null
    },
    {
        id: 'mock-008',
        title: 'Hiking day trip — Hallerbos',
        date: daysFromNow(14, 9),
        endDate: daysFromNow(14, 17),
        description: 'Carpool from Leuven station. Bluebells season!',
        location: 'Hallerbos',
        source: null,
        attendance_limit: 16
    }
];

// --- Mock RSVPs ---
const mockRsvps = [
    { event_id: 'mock-001', attendee_name: 'Fisher' },
    { event_id: 'mock-001', attendee_name: 'Amy' },
    { event_id: 'mock-001', attendee_name: 'Ben' },
    { event_id: 'mock-003', attendee_name: 'Amy' },
    { event_id: 'mock-004', attendee_name: 'Fisher' },
    { event_id: 'mock-005', attendee_name: 'Ben' },
    { event_id: 'mock-005', attendee_name: 'Clara' },
    { event_id: 'mock-005', attendee_name: 'Dan' },
    { event_id: 'mock-006', attendee_name: 'Clara' },
    { event_id: 'mock-008', attendee_name: 'Fisher' }
];

// --- Mock donations ---
const mockDonations = [
    { amount:  50.00, donator: 'Amy',   description: 'Happy to support',           entry_date: daysFromNow(-45) },
    { amount:  25.00, donator: 'Ben',   description: null,                          entry_date: daysFromNow(-30) },
    { amount: -14.99, donator: null,    description: 'Heroku hobby dyno',           entry_date: daysFromNow(-28) },
    { amount: 100.00, donator: 'Clara', description: 'Thanks for running this!',    entry_date: daysFromNow(-20) },
    { amount:  -7.50, donator: null,    description: 'Domain renewal',              entry_date: daysFromNow(-10) },
    { amount:  20.00, donator: 'Dan',   description: null,                          entry_date: daysFromNow(-2) }
];

async function seed() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (shouldReset) {
            console.log('--reset flag: clearing existing rows...');
            await client.query('DELETE FROM rsvps');
            await client.query('DELETE FROM events');
            await client.query('DELETE FROM donations');
        }

        // Upsert events
        for (const ev of mockEvents) {
            await client.query(
                `INSERT INTO events (id, title, date, endDate, description, location, source, attendance_limit, links)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    date = EXCLUDED.date,
                    endDate = EXCLUDED.endDate,
                    description = EXCLUDED.description,
                    location = EXCLUDED.location,
                    source = EXCLUDED.source,
                    attendance_limit = EXCLUDED.attendance_limit,
                    links = EXCLUDED.links`,
                [ev.id, ev.title, ev.date, ev.endDate, ev.description, ev.location, ev.source, ev.attendance_limit, JSON.stringify(ev.links || [])]
            );
        }
        console.log(`Upserted ${mockEvents.length} events.`);

        // RSVPs — insert fresh each run (delete mock RSVPs first to avoid dupes)
        await client.query(
            `DELETE FROM rsvps WHERE event_id = ANY($1::varchar[])`,
            [mockEvents.map(e => e.id)]
        );
        for (const r of mockRsvps) {
            await client.query(
                `INSERT INTO rsvps (id, event_id, attendee_name, attendance, timestamp)
                 VALUES ($1, $2, $3, 'yes', NOW())`,
                [randomUUID(), r.event_id, r.attendee_name]
            );
        }
        console.log(`Inserted ${mockRsvps.length} RSVPs.`);

        // Donations — insert fresh (clear existing mock donations first if reset)
        if (shouldReset) {
            for (const d of mockDonations) {
                await client.query(
                    `INSERT INTO donations (id, amount, description, donator, entry_date)
                     VALUES ($1,$2,$3,$4,$5)`,
                    [randomUUID(), d.amount, d.description, d.donator, d.entry_date]
                );
            }
            console.log(`Inserted ${mockDonations.length} donations.`);
        } else {
            // Non-reset: only insert if donations table is empty
            const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM donations');
            if (rows[0].n === 0) {
                for (const d of mockDonations) {
                    await client.query(
                        `INSERT INTO donations (id, amount, description, donator, entry_date)
                         VALUES ($1,$2,$3,$4,$5)`,
                        [randomUUID(), d.amount, d.description, d.donator, d.entry_date]
                    );
                }
                console.log(`Inserted ${mockDonations.length} donations (table was empty).`);
            } else {
                console.log(`Skipped donations insert — table already has ${rows[0].n} rows. Use --reset to replace.`);
            }
        }

        await client.query('COMMIT');
        console.log('Done.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Seed failed:', err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

seed();
