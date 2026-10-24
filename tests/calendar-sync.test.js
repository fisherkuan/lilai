const test = require('node:test');
const assert = require('node:assert/strict');
const { findStaleEventIds, appEventsToCheck, keepAppEvent, looksLikeIcsFeed } = require('../server/calendar-sync');

const dbRows = [
    { id: 'cal-a1', source: 'a' },
    { id: 'cal-a2', source: 'a' },
    { id: 'cal-b1', source: 'b' }
];

test('an event the feed dropped is stale', () => {
    const feed = [{ id: 'cal-a1', source: 'a' }, { id: 'cal-b1', source: 'b' }];
    assert.deepEqual(findStaleEventIds(dbRows, feed, new Set()), ['cal-a2']);
});

test('a calendar that could not be read keeps every event it had', () => {
    const feed = [{ id: 'cal-a1', source: 'a' }, { id: 'cal-a2', source: 'a' }];
    assert.deepEqual(findStaleEventIds(dbRows, feed, new Set(['b'])), []);
});

test('nothing is deleted when no calendar could be read', () => {
    assert.deepEqual(findStaleEventIds(dbRows, [], new Set(['a', 'b'])), []);
});

test('a calendar that was read and is empty loses its events', () => {
    const feed = [{ id: 'cal-a1', source: 'a' }, { id: 'cal-a2', source: 'a' }];
    assert.deepEqual(findStaleEventIds(dbRows, feed, new Set()), ['cal-b1']);
});

test('a feed body must be an iCalendar document', () => {
    assert.equal(looksLikeIcsFeed('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'), true);
    assert.equal(looksLikeIcsFeed('<!DOCTYPE html><html>Sign in</html>'), false);
    assert.equal(looksLikeIcsFeed(''), false);
});

test('an event Lilai made is checked with Google before the feed can drop it', () => {
    const rows = [
        { id: 'cal-a1', source: 'a', google_event_id: null },
        { id: 'cal-new', source: 'a', google_event_id: 'g1' },
        { id: 'cal-b-new', source: 'b', google_event_id: 'g2' }
    ];
    const feed = [{ id: 'cal-a1', source: 'a' }];
    assert.deepEqual(appEventsToCheck(rows, feed, new Set(['b'])).map(r => r.id), ['cal-new']);
    assert.deepEqual(findStaleEventIds(rows, feed, new Set(['b']), new Set(['cal-new'])), []);
    assert.deepEqual(findStaleEventIds(rows, feed, new Set(['b'])), ['cal-new']);
});

test('keepAppEvent: Google decides; without an answer, a day of grace', () => {
    const now = Date.UTC(2026, 9, 24, 12);
    assert.equal(keepAppEvent(false, null, now), true);
    assert.equal(keepAppEvent(true, new Date(now).toISOString(), now), false);
    assert.equal(keepAppEvent(null, new Date(now - 3600e3).toISOString(), now), true);
    assert.equal(keepAppEvent(null, new Date(now - 25 * 3600e3).toISOString(), now), false);
});
