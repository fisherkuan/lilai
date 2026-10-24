const test = require('node:test');
const assert = require('node:assert/strict');
const { findStaleEventIds, looksLikeIcsFeed } = require('../server/calendar-sync');

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
