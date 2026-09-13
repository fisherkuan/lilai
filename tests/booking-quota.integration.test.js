/*
 * Integration tests for the two-slots-a-week gate, against a real PostgreSQL.
 *
 * The pure rules are covered in booking-validation.test.js; what needs a live database
 * is the counting itself and, above all, the advisory lock that stops two people
 * queueing the same name at the same instant from both passing a count of one.
 *
 * Point TEST_DATABASE_URL at a scratch database. Skipped, not failed, when there is
 * none — the rest of the suite still has to run on a machine without Postgres.
 *
 *   createdb lilai_booking_test
 *   TEST_DATABASE_URL=postgresql://localhost/lilai_booking_test node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');

const { createBookingSchema } = require('../server/booking-schema');
const { createSeriesSchema } = require('../server/booking-series');
const { validateBooking } = require('../server/booking-validation');
const { weekBounds } = require('../server/booking-time');
const { QUOTA_PER_WEEK, countHeld, quotaFor } = require('../server/booking-quota');
const { bookingSettings, sampleSendAfter } = require('../server/booking-settings');

const CONNECTION = process.env.TEST_DATABASE_URL || 'postgresql://localhost/lilai_booking_test';
const settings = bookingSettings({});

let pool;
let reachable = false;

/*
 * These tests TRUNCATE booking_queue, so refuse to run against anything that is not
 * obviously a scratch database. A mistyped TEST_DATABASE_URL should cost nothing.
 */
function looksLikeScratch(connectionString) {
    try {
        const name = new URL(connectionString).pathname.replace(/^\//, '');
        return /test|scratch|local/i.test(name);
    } catch (error) {
        return false;
    }
}

test('connect to the scratch database', async (t) => {
    if (!looksLikeScratch(CONNECTION)) {
        t.skip(`refusing to truncate a database not named as a test one: ${CONNECTION}`);
        return;
    }
    pool = new Pool({ connectionString: CONNECTION, max: 8 });
    try {
        const client = await pool.connect();
        // Both, and in the order the server applies them: a test against a schema that has
        // drifted from production proves nothing, and series_id lives in the second one.
        await createBookingSchema(client);
        await createSeriesSchema(client);
        client.release();
        reachable = true;
    } catch (error) {
        await pool.end().catch(() => {});
        pool = null;
        t.skip(`no database at ${CONNECTION}: ${error.message}`);
    }
});

function skipUnlessReachable(t) {
    if (!reachable) {
        t.skip('no database');
        return true;
    }
    return false;
}

let counter = 0;

async function insert(client, overrides = {}) {
    const { status = 'queued', seriesId = null, ...rest } = overrides;
    const entry = validateBooking({
        sport: 'Badminton',
        playDate: '2026-09-26',
        startPreferred: '18:00',
        startAlternative: '20:00',
        durationHours: 2,
        players: 12,
        indoorOutdoor: 'Indoor',
        language: 'English',
        validSportsCard: true,
        name: 'Yuki Chen',
        email: 'yuki@student.kuleuven.be',
        phone: '+32 470 12 34 56',
        ...rest
    });
    counter += 1;
    const id = `test-${counter}`;
    await client.query(`
        INSERT INTO booking_queue (
            id, sport, play_date, start_preferred, start_alternative, duration_hours,
            players, indoor_outdoor, facility, other_facility, language, valid_sports_card,
            name, name_key, email, phone, remarks, queued_by, opens_at, send_after, status, series_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    `, [
        id, entry.sport, entry.playDate, entry.startPreferred, entry.startAlternative, entry.durationHours,
        entry.players, entry.indoorOutdoor, entry.facility, entry.otherFacility, entry.language,
        entry.validSportsCard, entry.name, entry.nameKey, entry.email, entry.phone, entry.remarks,
        entry.name, entry.opensAt, sampleSendAfter(entry.opensAt, settings), status, seriesId
    ]);
    return id;
}

async function fresh() {
    const client = await pool.connect();
    // booking_queue first: it carries the reference, so it has to let go before the
    // schedules it points at can be removed.
    await client.query('TRUNCATE booking_queue');
    await client.query('TRUNCATE booking_series CASCADE');
    return client;
}

test('two slots in one play week fill the quota', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        await insert(client, { playDate: '2026-09-22', startPreferred: '18:00', startAlternative: '20:00' });
        let quota = await quotaFor(client, 'Yuki Chen', '2026-09-26');
        assert.equal(quota.used, 1);
        assert.equal(quota.remaining, 1);

        await insert(client, { playDate: '2026-09-24', startPreferred: '19:00', startAlternative: '21:00' });
        quota = await quotaFor(client, 'Yuki Chen', '2026-09-26');
        assert.equal(quota.used, QUOTA_PER_WEEK);
        assert.equal(quota.remaining, 0);
        assert.deepEqual(quota.week, weekBounds('2026-09-26'));
    } finally {
        client.release();
    }
});

test('the next play week is a separate allowance', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        await insert(client, { playDate: '2026-09-22' });
        await insert(client, { playDate: '2026-09-24', startPreferred: '19:00', startAlternative: '21:00' });
        assert.equal((await quotaFor(client, 'Yuki Chen', '2026-09-24')).used, 2);
        assert.equal((await quotaFor(client, 'Yuki Chen', '2026-09-29')).used, 0);
    } finally {
        client.release();
    }
});

test('Sunday belongs to the week that just ended, Monday to the next one', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        // The question people actually ask at the form.
        await insert(client, { playDate: '2026-09-27' }); // Sunday
        assert.equal((await quotaFor(client, 'Yuki Chen', '2026-09-21')).used, 1); // same week
        assert.equal((await quotaFor(client, 'Yuki Chen', '2026-09-28')).used, 0); // next week
    } finally {
        client.release();
    }
});

test('only statuses that can hold a court consume a slot', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        // Nothing was booked by any of these, so none should cost the week a slot.
        await insert(client, { status: 'failed' });
        await insert(client, { status: 'missed', startPreferred: '19:00' });
        await insert(client, { status: 'cancelled', startPreferred: '20:00', startAlternative: '18:00' });
        assert.equal((await quotaFor(client, 'Yuki Chen', '2026-09-26')).used, 0);

        // These hold, or may hold, a court.
        await insert(client, { status: 'sent', playDate: '2026-09-22' });
        await insert(client, { status: 'unconfirmed', playDate: '2026-09-23' });
        assert.equal((await quotaFor(client, 'Yuki Chen', '2026-09-26')).used, 2);
    } finally {
        client.release();
    }
});

test('an unconfirmed request counts — the safe side of an unknown', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        await insert(client, { status: 'unconfirmed' });
        assert.equal(await countHeld(client, 'yuki chen', '2026-09-26'), 1);
    } finally {
        client.release();
    }
});

test('spelling variants of one name share the allowance', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        await insert(client, { name: 'Fisher Kuan', playDate: '2026-09-22' });
        await insert(client, { name: '  fisher   KUAN ', playDate: '2026-09-24' });
        const quota = await quotaFor(client, 'Fisher Kuan', '2026-09-26');
        assert.equal(quota.used, 2, 'two spellings of one person must not buy four slots');
        assert.equal(quota.remaining, 0);
    } finally {
        client.release();
    }
});

test('different people keep separate allowances', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        await insert(client, { name: 'Fisher Kuan' });
        await insert(client, { name: 'Fisher Kuang', startPreferred: '19:00' });
        assert.equal((await quotaFor(client, 'Fisher Kuan', '2026-09-26')).used, 1);
        assert.equal((await quotaFor(client, 'Fisher Kuang', '2026-09-26')).used, 1);
    } finally {
        client.release();
    }
});

test('only a slot that has not gone out yet is offered as swappable', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        await insert(client, { status: 'queued', playDate: '2026-09-22' });
        await insert(client, { status: 'sent', playDate: '2026-09-24' });
        const quota = await quotaFor(client, 'Yuki Chen', '2026-09-26');
        assert.deepEqual(quota.entries.map((e) => e.swappable), [true, false]);
    } finally {
        client.release();
    }
});

/*
 * Editing the second slot of a full week must not count that slot against itself.
 *
 * Without the exclusion, reopening an entry that is already one of the two reads as a
 * third: the sheet declares the week full and offers to swap the entry for itself, which
 * is a question with no sensible answer.
 */
test('an entry being edited does not fill its own week', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        const first = await insert(client, { playDate: '2026-09-22', startPreferred: '18:00', startAlternative: '20:00' });
        const second = await insert(client, { playDate: '2026-09-24', startPreferred: '19:00', startAlternative: '21:00' });

        // A brand new third slot: the week really is full, and both are offered as swaps.
        const asNew = await quotaFor(client, 'Yuki Chen', '2026-09-26');
        assert.equal(asNew.used, QUOTA_PER_WEEK);
        assert.equal(asNew.remaining, 0);
        assert.deepEqual(asNew.entries.map((e) => e.id).sort(), [first, second].sort());

        // Editing the second: one slot used, one left, and it is not among its own swaps.
        const editing = await quotaFor(client, 'Yuki Chen', '2026-09-26', { excludeId: second });
        assert.equal(editing.used, 1);
        assert.equal(editing.remaining, 1);
        assert.deepEqual(editing.entries.map((e) => e.id), [first]);

        // And the count the edit route gates on agrees with what the sheet was shown.
        assert.equal(await countHeld(client, 'yuki chen', '2026-09-26', { excludeId: second }), 1);
    } finally {
        client.release();
    }
});

/*
 * The same courtesy for a whole schedule being rebuilt.
 *
 * Editing a repeat re-expands its rule and reconciles the queue against it, so every one of
 * its still-waiting occurrences is about to be kept, moved or cancelled. Counting those as
 * competition would have a schedule blocking its own edit — in a week it fills by itself,
 * it would find no room to put anything back.
 */
test('a schedule being rebuilt is not competition for its own slots', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        await client.query(`
            INSERT INTO booking_series (
                id, name, name_key, sport, every, unit, weekdays,
                starts_on, until, start_preferred, start_alternative
            ) VALUES ('series-1', 'Yuki Chen', 'yuki chen', 'Badminton', 1, 'week', ARRAY[2, 4],
                      '2026-09-22', '2026-10-20', '18:00', '20:00')
        `);
        const tue = await insert(client, { playDate: '2026-09-22', seriesId: 'series-1' });
        await insert(client, { playDate: '2026-09-24', seriesId: 'series-1', startPreferred: '19:00', startAlternative: '21:00' });

        // Both belong to the schedule, so rebuilding it sees an empty week.
        assert.equal(await countHeld(client, 'yuki chen', '2026-09-26'), QUOTA_PER_WEEK);
        assert.equal(await countHeld(client, 'yuki chen', '2026-09-26', { excludeSeries: 'series-1' }), 0);

        const rebuilding = await quotaFor(client, 'Yuki Chen', '2026-09-26', { excludeSeries: 'series-1' });
        assert.equal(rebuilding.used, 0);
        assert.deepEqual(rebuilding.entries, []);

        /*
         * An occurrence that has already gone out is a different matter: a court may well be
         * held, so it keeps costing a slot no matter what the rule says now.
         */
        await client.query(`UPDATE booking_queue SET status = 'sent' WHERE id = $1`, [tue]);
        assert.equal(await countHeld(client, 'yuki chen', '2026-09-26', { excludeSeries: 'series-1' }), 1);
        const withSent = await quotaFor(client, 'Yuki Chen', '2026-09-26', { excludeSeries: 'series-1' });
        assert.equal(withSent.used, 1);
        assert.deepEqual(withSent.entries.map((e) => e.id), [tue]);

        // Somebody else's booking in that week is competition, schedule or no schedule.
        await insert(client, { playDate: '2026-09-23', name: 'Wei Lin', seriesId: null });
        assert.equal(await countHeld(client, 'wei lin', '2026-09-26', { excludeSeries: 'series-1' }), 1);
    } finally {
        client.release();
    }
});

test('two simultaneous requests for the last slot: exactly one gets in', async (t) => {
    if (skipUnlessReachable(t)) return;

    const setup = await fresh();
    await insert(setup, { playDate: '2026-09-22' }); // one slot held, one left
    setup.release();

    const week = weekBounds('2026-09-24');
    const lockKey = `yuki chen|${week.start}`;
    const LOCK = 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))';

    const a = await pool.connect();
    const b = await pool.connect();
    try {
        await a.query('BEGIN');
        await b.query('BEGIN');

        // A takes the lock first.
        await a.query(LOCK, [lockKey]);

        // B tries to take it and then counts. If the lock does its job this whole chain
        // is parked until A commits; without it, B counts straight away and sees the
        // stale total of 1 — which is exactly the double-book this test has to catch.
        let bCountedEarly = false;
        const bWork = (async () => {
            await b.query(LOCK, [lockKey]);
            const held = await countHeld(b, 'yuki chen', '2026-09-24');
            return held;
        })();
        const settled = await Promise.race([
            bWork.then(() => 'counted'),
            new Promise((resolve) => setTimeout(() => resolve('blocked'), 300))
        ]);
        bCountedEarly = settled === 'counted';

        // Meanwhile A completes its own check-then-insert and commits.
        const heldA = await countHeld(a, 'yuki chen', '2026-09-24');
        assert.equal(heldA, 1, 'A should see one slot held');
        await insert(a, { playDate: '2026-09-24', startPreferred: '19:00' });
        await a.query('COMMIT');

        assert.equal(bCountedEarly, false,
            'B read the quota while A was mid-transaction — the advisory lock is not holding it back');

        const heldB = await bWork;
        assert.equal(heldB, QUOTA_PER_WEEK, 'B must see A\'s row once the lock is released');

        // B is now correctly refused and rolls back.
        await b.query('ROLLBACK');
    } finally {
        a.release();
        b.release();
    }

    const check = await pool.connect();
    try {
        assert.equal(await countHeld(check, 'yuki chen', '2026-09-26'), QUOTA_PER_WEEK,
            'the week must hold exactly two slots, never three');
    } finally {
        check.release();
    }
});

test('a play date survives the round trip as a calendar day, not an instant', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        // Regression: pg parses DATE at LOCAL midnight, so in Brussels an unguarded
        // toISOString().slice(0, 10) reported the day before and a Monday slot looked
        // like it belonged to the previous quota week.
        await insert(client, { playDate: '2026-10-01', startPreferred: '18:00', startAlternative: '20:00' });
        const quota = await quotaFor(client, 'Yuki Chen', '2026-10-01');
        assert.equal(quota.entries[0].playDate, '2026-10-01');

        const raw = await client.query('SELECT play_date FROM booking_queue LIMIT 1');
        assert.equal(raw.rows[0].play_date, '2026-10-01');
        assert.equal(typeof raw.rows[0].play_date, 'string');
    } finally {
        client.release();
    }
});

test('the quota answers in the spelling already on record', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        await insert(client, { name: 'Yuki Chen' });
        const quota = await quotaFor(client, 'yuki   CHEN', '2026-09-26');
        assert.equal(quota.name, 'Yuki Chen');
        assert.equal(quota.typedName, 'yuki   CHEN');
    } finally {
        client.release();
    }
});

test('only a slot still waiting can be taken out of the queue', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        const CANCEL = `UPDATE booking_queue SET status = 'cancelled', cancelled_by = $2
                        WHERE id = $1 AND status = 'queued' RETURNING id`;

        const waiting = await insert(client, { status: 'queued' });
        const cancelled = await client.query(CANCEL, [waiting, 'Yuki Chen']);
        assert.equal(cancelled.rows.length, 1, 'a waiting slot can be withdrawn');

        // Once a request has reached KU Leuven we cannot take it back, whatever they answer.
        for (const status of ['sending', 'sent', 'unconfirmed', 'failed', 'missed']) {
            const id = await insert(client, { status, startPreferred: '20:00', startAlternative: '18:00' });
            const result = await client.query(CANCEL, [id, 'Yuki Chen']);
            assert.equal(result.rows.length, 0, `${status} must not be cancellable`);
            await client.query('DELETE FROM booking_queue WHERE id = $1', [id]);
        }
    } finally {
        client.release();
    }
});

test('a cancelled slot gives its allowance back', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        const first = await insert(client, { playDate: '2026-09-22' });
        await insert(client, { playDate: '2026-09-24', startPreferred: '19:00', startAlternative: '21:00' });
        assert.equal((await quotaFor(client, 'Yuki Chen', '2026-09-26')).remaining, 0);

        await client.query(`UPDATE booking_queue SET status = 'cancelled' WHERE id = $1`, [first]);
        assert.equal((await quotaFor(client, 'Yuki Chen', '2026-09-26')).remaining, 1);
    } finally {
        client.release();
    }
});

test('the database refuses a row the validator would never build', async (t) => {
    if (skipUnlessReachable(t)) return;
    const client = await fresh();
    try {
        // Belt and braces: the CHECK constraints are the last line if a future caller
        // reaches the table without going through validateBooking.
        await assert.rejects(
            client.query(`
                INSERT INTO booking_queue (id, sport, play_date, start_preferred, start_alternative,
                    duration_hours, players, indoor_outdoor, name, name_key, email, phone,
                    opens_at, send_after)
                VALUES ('bad-1','Badminton','2026-09-26', NOW(), NOW(), 2, 4, 'Indoor',
                    'X','x','x@y.be','+32', NOW(), NOW())
            `),
            /booking_queue_players_min/
        );
        await assert.rejects(
            client.query(`
                INSERT INTO booking_queue (id, sport, play_date, start_preferred, start_alternative,
                    duration_hours, players, indoor_outdoor, name, name_key, email, phone,
                    opens_at, send_after, status)
                VALUES ('bad-2','Badminton','2026-09-26', NOW(), NOW(), 2, 12, 'Indoor',
                    'X','x','x@y.be','+32', NOW(), NOW(), 'booked')
            `),
            /booking_queue_status/
        );
    } finally {
        client.release();
    }
});

test.after(async () => {
    if (pool) await pool.end().catch(() => {});
});
