/*
 * The waiting list of a full event. The pure rules always run; promotion needs a scratch
 * PostgreSQL (TEST_DATABASE_URL, see booking-quota.integration.test.js) and is skipped without one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { joinStatus, openings, ordinal, promote, positionOf } = require('../server/waiting-list');
const hosting = require('../server/event-hosting');
const activity = require('../server/event-activity');

test('a new name takes a place, asks, or joins the list', () => {
    assert.equal(joinStatus({ limit: 3, approval: false, taken: 2, waiting: 0 }), 'yes');
    assert.equal(joinStatus({ limit: 3, approval: false, taken: 3, waiting: 0 }), 'waiting');
    assert.equal(joinStatus({ limit: null, approval: false, taken: 90, waiting: 0 }), 'yes');
    assert.equal(joinStatus({ limit: 3, approval: true, taken: 1, waiting: 0 }), 'pending');
    assert.equal(joinStatus({ limit: 3, approval: true, taken: 3, waiting: 0 }), 'waiting');
    // Nobody overtakes the list, even with a seat free while the host decides.
    assert.equal(joinStatus({ limit: 3, approval: true, taken: 2, waiting: 1 }), 'waiting');
});

test('openings: free seats, less the open requests on an approval event', () => {
    assert.equal(openings({ limit: 3, approval: false, taken: 2, asking: 0 }), 1);
    assert.equal(openings({ limit: 3, approval: false, taken: 4, asking: 0 }), 0);
    assert.equal(openings({ limit: 3, approval: true, taken: 1, asking: 1 }), 1);
    assert.equal(openings({ limit: 3, approval: true, taken: 1, asking: 2 }), 0);
    assert.equal(openings({ limit: null, approval: false, taken: 9, asking: 0 }), Infinity);
});

test('ordinals', () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(ordinal),
        ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '112th']);
});

test('host decisions on the waiting list have their own activity', () => {
    assert.equal(activity.decisionKind('waiting', 'yes'), 'movedin');
    assert.equal(activity.decisionKind('waiting', 'declined'), 'delisted');
    assert.equal(activity.decisionKind('declined', 'waiting'), 'relisted');
    for (const kind of ['listed', 'leftlist', 'promoted', 'movedin', 'delisted', 'relisted']) {
        assert.ok(activity.KINDS.includes(kind), kind);
    }
    assert.equal(hosting.DECISIONS.wait, 'waiting');
});

const CONNECTION = process.env.TEST_DATABASE_URL;
const scratch = CONNECTION && /test|scratch|local/i.test(new URL(CONNECTION).pathname);

test('the first name waiting moves up when a place opens, in order', { skip: !scratch && 'no TEST_DATABASE_URL' }, async () => {
    const pool = new Pool({ connectionString: CONNECTION });
    try {
        const client = await pool.connect();
        try {
            await client.query(`CREATE TABLE IF NOT EXISTS events (
                id VARCHAR(255) PRIMARY KEY, title VARCHAR(255) NOT NULL, date TIMESTAMPTZ NOT NULL, description TEXT,
                location VARCHAR(255), source VARCHAR(255), endDate TIMESTAMPTZ, attendance_limit INTEGER)`);
            await client.query(`CREATE TABLE IF NOT EXISTS rsvps (
                id VARCHAR(255) PRIMARY KEY, event_id VARCHAR(255) REFERENCES events(id) ON DELETE CASCADE,
                attendee_name VARCHAR(255) NOT NULL, attendance VARCHAR(255) NOT NULL, timestamp TIMESTAMPTZ NOT NULL)`);
            await hosting.createHostingSchema(client);
            await activity.createActivitySchema(client);
        } finally {
            client.release();
        }
        await pool.query('TRUNCATE event_activity, rsvps, events CASCADE');
        const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000);
        await pool.query(
            `INSERT INTO events (id, title, date, attendance_limit, approval_required, managed) VALUES
             ('open', 'Badminton', $1, 2, FALSE, TRUE), ('asks', 'Dinner', $1, 2, TRUE, TRUE)`,
            [soon]
        );
        const rsvp = (id, eventId, name, status, minute) => pool.query(
            'INSERT INTO rsvps (id, event_id, attendee_name, attendance, timestamp) VALUES ($1, $2, $3, $4, $5)',
            [id, eventId, name, status, new Date(Date.UTC(2026, 9, 1, 12, minute))]
        );
        await rsvp('a', 'open', 'Ann', 'yes', 0);
        await rsvp('b', 'open', 'Bob', 'yes', 1);
        await rsvp('d', 'open', 'Dee', 'waiting', 3);
        await rsvp('c', 'open', 'Cas', 'waiting', 2);
        const event = async id => (await pool.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
        const status = async id => (await pool.query('SELECT attendance FROM rsvps WHERE id = $1', [id])).rows[0].attendance;

        assert.equal(await positionOf(pool, 'open', 'Cas'), 1);
        assert.equal(await positionOf(pool, 'open', 'Dee'), 2);
        assert.equal(await positionOf(pool, 'open', 'Ann'), null);

        // Full: nothing moves.
        assert.deepEqual(await promote(pool, await event('open')), []);

        // Bob leaves: Cas, first on the list, takes the place; Dee is now first.
        await pool.query("DELETE FROM rsvps WHERE id = 'b'");
        assert.deepEqual(await promote(pool, await event('open')), ['Cas']);
        assert.equal(await status('c'), 'yes');
        assert.equal(await positionOf(pool, 'open', 'Dee'), 1);
        const log = await activity.listActivity(pool, 'open');
        assert.deepEqual([log[0].kind, log[0].name], ['promoted', 'Cas']);

        // The host takes the limit away: everyone waiting moves in.
        await pool.query("UPDATE events SET attendance_limit = NULL WHERE id = 'open'");
        assert.deepEqual(await promote(pool, await event('open')), ['Dee']);

        // Approval event: the first name waiting becomes a request, and only while the open
        // requests leave a seat for it.
        await rsvp('e', 'asks', 'Eve', 'yes', 0);
        await rsvp('f', 'asks', 'Fay', 'pending', 1);
        await rsvp('g', 'asks', 'Gus', 'waiting', 2);
        await rsvp('h', 'asks', 'Hal', 'waiting', 3);
        assert.deepEqual(await promote(pool, await event('asks')), []);
        await pool.query("UPDATE rsvps SET attendance = 'declined' WHERE id = 'f'");
        assert.deepEqual(await promote(pool, await event('asks')), ['Gus']);
        assert.equal(await status('g'), 'pending');
        assert.equal(await status('h'), 'waiting');
        const asked = await activity.listActivity(pool, 'asks');
        assert.equal(asked[0].detail, 'asking');
    } finally {
        await pool.end();
    }
});
