const test = require('node:test');
const assert = require('node:assert/strict');
const { createPublisher, retryDelaySeconds, pushAction } = require('../server/calendar-publish');

test('retries wait longer each time, up to six hours', () => {
    assert.deepEqual([1, 2, 3, 4].map(retryDelaySeconds), [30, 60, 120, 240]);
    assert.equal(retryDelaySeconds(40), 6 * 3600);
});

test('a push inserts a first copy, replaces a known one, deletes a cancelled one', () => {
    assert.equal(pushAction({ synced_version: 0 }), 'insert');
    assert.equal(pushAction({ synced_version: 3 }), 'update');
    assert.equal(pushAction({ synced_version: 0, cancelled_at: new Date() }), 'delete');
});

// A pool that serves one batch of rows and records every write.
function fakePool(rows) {
    const writes = [];
    let served = false;
    return {
        writes,
        async query(sql, params) {
            if (/^\s*SELECT/.test(sql)) {
                const batch = served ? [] : rows;
                served = true;
                return { rows: batch };
            }
            writes.push({ sql, params });
            return { rowCount: 1, rows: [] };
        }
    };
}

function googleError(status) {
    return Object.assign(new Error(`Google ${status}`), { status });
}

const row = (extra) => ({
    id: 'cal-a@google.com', title: 'T', date: new Date('2026-11-07T18:00:00Z'), enddate: null, links: [],
    google_calendar_id: 'cal', google_event_id: 'a', version: 2, synced_version: 0, push_attempts: 0, ...extra
});

test('a retried insert that Google already has becomes an update, and records the version', async () => {
    const calls = [];
    const googleCalendar = {
        insertEvent: async (cal, r) => { calls.push(['insert', r.id]); throw googleError(409); },
        updateEvent: async (cal, id) => { calls.push(['update', id]); return { htmlLink: 'https://g/x' }; }
    };
    const pool = fakePool([row()]);
    await createPublisher({ pool, googleCalendar }).tick();
    assert.deepEqual(calls, [['insert', 'a'], ['update', 'a']]);
    assert.match(pool.writes[0].sql, /synced_version = \$2/);
    assert.deepEqual(pool.writes[0].params, ['cal-a@google.com', 2, 'https://g/x']);
});

test('a copy deleted in Google comes back on the next update', async () => {
    const calls = [];
    const googleCalendar = {
        updateEvent: async () => { calls.push('update'); throw googleError(404); },
        insertEvent: async (cal, r) => { calls.push(`insert ${r.id}`); return {}; }
    };
    await createPublisher({ pool: fakePool([row({ synced_version: 1 })]), googleCalendar }).tick();
    assert.deepEqual(calls, ['update', 'insert a']);
});

test('deleting a copy that is already gone counts as done', async () => {
    const googleCalendar = { deleteEvent: async () => { throw googleError(410); } };
    const pool = fakePool([row({ cancelled_at: new Date(), synced_version: 1 })]);
    await createPublisher({ pool, googleCalendar }).tick();
    assert.match(pool.writes[0].sql, /synced_version = \$2/);
});

test('a refusal is kept for the management page and retried later', async () => {
    const googleCalendar = { insertEvent: async () => { throw googleError(403); } };
    const pool = fakePool([row()]);
    const original = console.error;
    console.error = () => {};
    try {
        await createPublisher({ pool, googleCalendar }).tick();
    } finally {
        console.error = original;
    }
    assert.match(pool.writes[0].sql, /push_attempts = \$2, push_error = \$3/);
    assert.deepEqual(pool.writes[0].params.slice(1), [1, 'Google 403', 30]);
});

test('without Google credentials nothing is pushed', async () => {
    const pool = fakePool([row()]);
    await createPublisher({ pool, googleCalendar: null }).tick();
    assert.equal(pool.writes.length, 0);
});
