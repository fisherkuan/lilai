/*
 * Scheduler behaviour against a real database.
 *
 * The pure timing rules live in booking-scheduler.test.js. What needs a database is the
 * ordering that actually prevents a double booking: the claim is committed before the
 * POST, and nothing is ever retried automatically.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const { createBookingSchema } = require('../server/booking-schema');
const { validateBooking } = require('../server/booking-validation');
const { bookingSettings, sampleSendAfter } = require('../server/booking-settings');
const { createScheduler } = require('../server/booking-scheduler');
const { parseForm, FormChangedError } = require('../server/booking-form');

const CONNECTION = process.env.TEST_DATABASE_URL || 'postgresql://localhost/lilai_booking_test';
const FIXTURE = fs.readFileSync(path.join(__dirname, 'form.fixture.html'), 'utf8');
const settings = bookingSettings({});
const quiet = { info() {}, warn() {}, error() {} };

function looksLikeScratch(connectionString) {
    try {
        return /test|scratch|local/i.test(new URL(connectionString).pathname.replace(/^\//, ''));
    } catch (error) {
        return false;
    }
}

let pool;
let reachable = false;

test('connect to the scratch database', async (t) => {
    if (!looksLikeScratch(CONNECTION)) {
        t.skip(`refusing to truncate a database not named as a test one: ${CONNECTION}`);
        return;
    }
    pool = new Pool({ connectionString: CONNECTION, max: 6 });
    try {
        const client = await pool.connect();
        await createBookingSchema(client);
        client.release();
        reachable = true;
    } catch (error) {
        await pool.end().catch(() => {});
        pool = null;
        t.skip(`no database at ${CONNECTION}: ${error.message}`);
    }
});

function skipUnless(t) {
    if (!reachable) { t.skip('no database'); return true; }
    return false;
}

let counter = 0;

/** Insert one entry with its opening placed relative to now. */
async function seed(client, { opensAtOffsetMs = -1000, status = 'queued', sendAfterOffsetMs = null, playOffsetMs = 7 * 86400000 } = {}) {
    const entry = validateBooking({
        sport: 'Badminton', playDate: '2026-12-05', startPreferred: '18:00', startAlternative: '20:00',
        durationHours: 2, players: 12, indoorOutdoor: 'Indoor', validSportsCard: true,
        name: 'Yuki Chen', email: 'yuki@student.kuleuven.be', phone: '+32 470 12 34 56'
    });
    counter += 1;
    const id = `sched-${counter}`;
    const opensAt = new Date(Date.now() + opensAtOffsetMs);
    const sendAfter = sendAfterOffsetMs === null
        ? new Date(opensAt.getTime())
        : new Date(Date.now() + sendAfterOffsetMs);
    const play = new Date(Date.now() + playOffsetMs);

    await client.query(`
        INSERT INTO booking_queue (id, sport, play_date, start_preferred, start_alternative,
            duration_hours, players, indoor_outdoor, facility, other_facility, language,
            valid_sports_card, name, name_key, email, phone, remarks, queued_by,
            opens_at, send_after, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'','','English',true,$9,$10,$11,$12,'',$9,$13,$14,$15)
    `, [id, entry.sport, entry.playDate, play, new Date(play.getTime() + 7200000),
        entry.durationHours, entry.players, entry.indoorOutdoor, entry.name, entry.nameKey,
        entry.email, entry.phone, opensAt, sendAfter, status]);
    return id;
}

async function statusOf(client, id) {
    const result = await client.query('SELECT status, response_note FROM booking_queue WHERE id = $1', [id]);
    return result.rows[0];
}

/** A form client that never touches the network. */
function fakeClient({ onSubmit, form = FIXTURE } = {}) {
    const calls = { getForm: 0, submit: 0 };
    const factory = () => ({
        getForm: async () => { calls.getForm += 1; return parseForm(form); },
        submit: async (parsedForm, values) => {
            calls.submit += 1;
            return onSubmit ? onSubmit(parsedForm, values) : { status: 200, outcome: 'sent', html: '' };
        }
    });
    return { factory, calls };
}

async function fresh() {
    const client = await pool.connect();
    await client.query('TRUNCATE booking_queue');
    return client;
}

test('an entry whose window has not opened is left alone', async (t) => {
    if (skipUnless(t)) return;
    const client = await fresh();
    try {
        const id = await seed(client, { opensAtOffsetMs: 60 * 60 * 1000 });
        const fake = fakeClient();
        const summary = await createScheduler({ pool, settings, live: true, clientFactory: fake.factory, log: quiet }).tick();
        assert.equal(summary.due, 0);
        assert.equal(fake.calls.submit, 0);
        assert.equal((await statusOf(client, id)).status, 'queued');
    } finally { client.release(); }
});

test('dry run exercises the claim without sending anything', async (t) => {
    if (skipUnless(t)) return;
    const client = await fresh();
    try {
        const id = await seed(client);
        const fake = fakeClient();
        await createScheduler({ pool, settings, live: false, clientFactory: fake.factory, log: quiet }).tick();

        assert.equal(fake.calls.submit, 0, 'a dry run must not POST');
        const row = await statusOf(client, id);
        // `not_sent`, never `unconfirmed`: the board reports `unconfirmed` as "Request
        // sent", and nothing was sent. A dry run must be legible as one from the outside.
        assert.equal(row.status, 'not_sent');
        assert.notEqual(row.status, 'unconfirmed', 'a dry run must not read as a send');
        assert.match(row.response_note, /DRY RUN/);
    } finally { client.release(); }
});

test('the claim is committed BEFORE the request is sent', async (t) => {
    if (skipUnless(t)) return;
    const client = await fresh();
    try {
        const id = await seed(client);
        let statusAtSendTime = null;
        const fake = fakeClient({
            onSubmit: async () => {
                // Read through a separate connection: only a committed claim is visible.
                const probe = await pool.connect();
                try {
                    statusAtSendTime = (await probe.query('SELECT status FROM booking_queue WHERE id = $1', [id])).rows[0].status;
                } finally { probe.release(); }
                return { status: 200, outcome: 'sent', html: '' };
            }
        });
        await createScheduler({ pool, settings, live: true, clientFactory: fake.factory, log: quiet }).tick();

        assert.equal(statusAtSendTime, 'sending',
            'the entry must already be claimed when the POST goes out, or a crash could duplicate it');
        assert.equal((await statusOf(client, id)).status, 'sent');
    } finally { client.release(); }
});

test('a request we could not read becomes unconfirmed and is never retried', async (t) => {
    if (skipUnless(t)) return;
    const client = await fresh();
    try {
        const id = await seed(client);
        const fake = fakeClient({ onSubmit: async () => { throw new Error('socket hang up'); } });
        const scheduler = createScheduler({ pool, settings, live: true, clientFactory: fake.factory, log: quiet });

        await scheduler.tick();
        assert.equal((await statusOf(client, id)).status, 'unconfirmed');
        assert.equal(fake.calls.submit, 1);

        await scheduler.tick();
        await scheduler.tick();
        assert.equal(fake.calls.submit, 1, 'an uncertain request must never be sent a second time');
    } finally { client.release(); }
});

test('a validation page from EasyForm is a failure, not a receipt', async (t) => {
    if (skipUnless(t)) return;
    const client = await fresh();
    try {
        const id = await seed(client);
        const fake = fakeClient({ onSubmit: async () => ({ status: 200, outcome: 'failed', html: '' }) });
        await createScheduler({ pool, settings, live: true, clientFactory: fake.factory, log: quiet }).tick();
        assert.equal((await statusOf(client, id)).status, 'failed');
    } finally { client.release(); }
});

test('past the grace window an entry is marked missed, not sent late', async (t) => {
    if (skipUnless(t)) return;
    const client = await fresh();
    try {
        const id = await seed(client, { opensAtOffsetMs: -(settings.lateSubmissionGraceSeconds + 60) * 1000 });
        const fake = fakeClient();
        const summary = await createScheduler({ pool, settings, live: true, clientFactory: fake.factory, log: quiet }).tick();
        assert.equal(summary.missed, 1);
        assert.equal(fake.calls.submit, 0);
        assert.equal((await statusOf(client, id)).status, 'missed');
    } finally { client.release(); }
});

test('an entry waits out its own random delay', async (t) => {
    if (skipUnless(t)) return;
    const client = await fresh();
    try {
        const id = await seed(client, { opensAtOffsetMs: -1000, sendAfterOffsetMs: 30000 });
        const fake = fakeClient();
        const summary = await createScheduler({ pool, settings, live: true, clientFactory: fake.factory, log: quiet }).tick();
        assert.equal(summary.due, 1, 'it is due');
        assert.equal(fake.calls.submit, 0, 'but its sampled delay has not elapsed');
        assert.equal((await statusOf(client, id)).status, 'queued');
    } finally { client.release(); }
});

test('requests are paced apart rather than fired together', async (t) => {
    if (skipUnless(t)) return;
    const client = await fresh();
    try {
        await seed(client);
        await seed(client);
        const fake = fakeClient();
        const summary = await createScheduler({ pool, settings, live: true, clientFactory: fake.factory, log: quiet }).tick();
        assert.equal(fake.calls.submit, 1, 'only one goes out in this pass');
        assert.equal(summary.paced, 1, 'the other waits for the interval');
    } finally { client.release(); }
});

test('a changed form refuses to submit and does not consume the entry', async (t) => {
    if (skipUnless(t)) return;
    const client = await fresh();
    try {
        const id = await seed(client);
        // The security token is gone: buildPayload must refuse before anything is claimed.
        const broken = FIXTURE.replace(/<input[^>]*name="_authenticator"[^>]*>/, '');
        const fake = fakeClient({ form: broken });
        const summary = await createScheduler({ pool, settings, live: true, clientFactory: fake.factory, log: quiet }).tick();

        assert.equal(fake.calls.submit, 0);
        assert.equal(summary.errors, 1);
        assert.equal((await statusOf(client, id)).status, 'queued',
            'the entry stays queued so it can still go out if the form is fixed in time');
    } finally { client.release(); }
});

test('an interrupted submission is left uncertain on boot, never resent', async (t) => {
    if (skipUnless(t)) return;
    const client = await fresh();
    try {
        // A row still 'sending' means the process died mid-flight. We cannot know whether
        // KU Leuven received it, and retrying is the one thing that could double-book.
        const id = await seed(client, { status: 'sending' });
        const fake = fakeClient();
        const scheduler = createScheduler({ pool, settings, live: true, clientFactory: fake.factory, log: quiet });

        const recovered = await scheduler.recoverInterrupted(client);
        assert.equal(recovered, 1);
        const row = await statusOf(client, id);
        assert.equal(row.status, 'unconfirmed');
        assert.match(row.response_note, /Interrupted/);

        await scheduler.tick();
        assert.equal(fake.calls.submit, 0, 'recovery must never resend');
    } finally { client.release(); }
});

test.after(async () => {
    if (pool) await pool.end().catch(() => {});
});
