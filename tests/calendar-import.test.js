const test = require('node:test');
const assert = require('node:assert/strict');
const { rowFromGoogleEvent } = require('../server/calendar-import');

test('a Google event lands on the row the old feed made for it', () => {
    const row = rowFromGoogleEvent({
        id: 'abc', iCalUID: 'abc@google.com', summary: ' Badminton ', status: 'confirmed',
        start: { dateTime: '2026-11-07T19:00:00+01:00' }, end: { dateTime: '2026-11-07T21:00:00+01:00' },
        location: 'Sportkot', description: 'Rackets provided.\nlimit: 12', htmlLink: 'https://g/abc'
    }, 'cal-1');
    assert.equal(row.id, 'cal-abc@google.com');
    assert.equal(row.title, 'Badminton');
    assert.equal(row.date.toISOString(), '2026-11-07T18:00:00.000Z');
    assert.equal(row.googleEventId, 'abc');
    assert.equal(row.description, 'Rackets provided.');
    assert.equal(row.legacyLimit, 12);
    assert.equal(row.source, 'cal-1');
});

test('an event made in another app keeps its own UID', () => {
    const row = rowFromGoogleEvent({ id: 'gid', iCalUID: '27F07617-E0CD@apple', start: { dateTime: '2026-11-07T19:00:00Z' } }, 'c');
    assert.equal(row.id, 'cal-27F07617-E0CD@apple');
    assert.equal(row.googleEventId, 'gid');
});

test('instances of a repeating event each get their own row', () => {
    const a = rowFromGoogleEvent({ id: 'base_20261107', recurringEventId: 'base', iCalUID: 'base@google.com', start: { dateTime: '2026-11-07T19:00:00Z' } }, 'c');
    assert.equal(a.id, 'cal-base_20261107@google.com');
});

test('cancelled and dateless events are left out; an all-day one starts at Brussels midnight', () => {
    assert.equal(rowFromGoogleEvent({ id: 'x', status: 'cancelled', start: { dateTime: '2026-11-07T19:00:00Z' } }, 'c'), null);
    assert.equal(rowFromGoogleEvent({ id: 'x' }, 'c'), null);
    const allDay = rowFromGoogleEvent({ id: 'd', iCalUID: 'd@google.com', start: { date: '2026-11-07' } }, 'c');
    assert.equal(allDay.date.toISOString(), '2026-11-06T23:00:00.000Z');
});
