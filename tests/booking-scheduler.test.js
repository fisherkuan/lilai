const test = require('node:test');
const assert = require('node:assert/strict');

const { dueState, createScheduler, TICK_MS } = require('../server/booking-scheduler');
const { bookingSettings } = require('../server/booking-settings');

const GRACE = 300;

function entry({ opensAt, play = '2026-10-01T16:00:00.000Z', alt = '2026-10-01T18:00:00.000Z' }) {
    return { opens_at: opensAt, start_preferred: play, start_alternative: alt };
}

const OPENS = '2026-09-17T22:00:00.000Z'; // 18 Sep, 00:00 Brussels

test('before its opening an entry is waiting', () => {
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-17T21:59:59Z'), GRACE), 'waiting');
});

test('an entry is due from the opening instant', () => {
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date(OPENS), GRACE), 'due');
});

test('an entry stays due for the whole grace window — this is what makes recovery stateless', () => {
    // Any process alive inside these five minutes picks the entry up through the ordinary
    // check, so a restart across midnight costs nothing and needs no catch-up path.
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-17T22:04:59Z'), GRACE), 'due');
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-17T22:05:00Z'), GRACE), 'due');
});

test('past the grace window it is missed, never submitted late', () => {
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-17T22:05:01Z'), GRACE), 'missed');
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-18T09:00:00Z'), GRACE), 'missed');
});

test('a slot whose own start time has passed is missed, even while still inside the grace', () => {
    // Opening late enough that the 24h grace is still running when kick-off arrives, so
    // only the play-time rule can be what expires this entry.
    const late = entry({ opensAt: '2026-09-30T22:00:00.000Z' });
    const generous = 86400;
    assert.equal(dueState(late, new Date('2026-10-01T15:59:00Z'), generous), 'due');
    assert.equal(dueState(late, new Date('2026-10-01T16:00:00Z'), generous), 'missed');
});

test('the earlier of the two preferences is the one that expires the entry', () => {
    // The alternative is earlier here, so it decides.
    const swapped = entry({
        opensAt: '2026-09-30T22:00:00.000Z',
        play: '2026-10-01T18:00:00.000Z',
        alt: '2026-10-01T16:00:00.000Z'
    });
    assert.equal(dueState(swapped, new Date('2026-10-01T15:59:00Z'), 86400), 'due');
    assert.equal(dueState(swapped, new Date('2026-10-01T16:00:00Z'), 86400), 'missed');
});

test('a grace of zero leaves exactly the opening instant', () => {
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date(OPENS), 0), 'due');
    assert.equal(dueState(entry({ opensAt: OPENS }), new Date('2026-09-17T22:00:01Z'), 0), 'missed');
});

test('a missing alternative falls back to the preferred start', () => {
    const single = {
        opens_at: '2026-09-30T22:00:00.000Z',
        start_preferred: '2026-10-01T16:00:00.000Z',
        start_alternative: null
    };
    assert.equal(dueState(single, new Date('2026-10-01T15:00:00Z'), 86400), 'due');
    assert.equal(dueState(single, new Date('2026-10-01T16:00:01Z'), 86400), 'missed');
});

// --- Surviving the database ---------------------------------------------------------------

const quiet = { info() {}, warn() {}, error() {} };

/** A pool that refuses the first `failures` connections and then hands out an empty database. */
function flakyPool(failures) {
    const pool = { connects: 0 };
    pool.connect = async () => {
        pool.connects += 1;
        if (pool.connects <= failures) throw new Error('connection refused');
        return { query: async () => ({ rows: [] }), release() {} };
    };
    return pool;
}

test('a connection refused on one tick does not retire the scheduler', async () => {
    const pool = flakyPool(1);
    const scheduler = createScheduler({ pool, settings: bookingSettings({}), log: quiet });

    await assert.rejects(scheduler.tick(), /connection refused/);
    const summary = await scheduler.tick();

    assert.equal(summary.skipped, undefined, 'the next tick must run, not report "already running"');
    assert.equal(pool.connects, 2);
});

test('a database unreachable at boot costs one pass, not the interval', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const pool = flakyPool(1);
    const scheduler = createScheduler({ pool, settings: bookingSettings({}), log: quiet });

    await scheduler.start();
    assert.equal(pool.connects, 1, 'the first pass tried and was refused');

    t.mock.timers.tick(TICK_MS);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pool.connects, 2, 'the interval fired and tried again');
    scheduler.stop();
});
