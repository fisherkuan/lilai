const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseBrusselsWallTime,
    brusselsDateOf,
    brusselsTimeOf,
    formStamp,
    opensAt,
    openingForPlayDate,
    openingFor,
    weekBounds
} = require('../server/booking-time');

test('the reference implementation\'s worked example: 25 Sep 2026 18:00 opens 11 Sep 00:00 CEST', () => {
    const start = parseBrusselsWallTime('2026-09-25', '18:00');
    assert.equal(start.toISOString(), '2026-09-25T16:00:00.000Z'); // CEST, +02:00
    assert.equal(opensAt(start).toISOString(), '2026-09-10T22:00:00.000Z'); // 11 Sep 00:00 CEST
});

test('the window is 14 calendar days, not 14 x 24 hours, across the autumn DST change', () => {
    // 24 Oct 2026 is still CEST (+02:00); DST ends on the 25th.
    assert.equal(openingForPlayDate('2026-11-07').toISOString(), '2026-10-23T22:00:00.000Z');
    // 26 Oct 2026 is CET (+01:00). Same 14 calendar days, one hour further out in UTC.
    assert.equal(openingForPlayDate('2026-11-09').toISOString(), '2026-10-25T23:00:00.000Z');
});

test('opening is midnight Brussels on the dot', () => {
    const opening = openingForPlayDate('2026-09-26');
    assert.equal(brusselsTimeOf(opening), '00:00');
    assert.equal(brusselsDateOf(opening), '2026-09-12');
});

test('nonexistent local times are rejected, not guessed', () => {
    // Clocks jump 02:00 -> 03:00 on 29 March 2026; 02:30 never happens.
    assert.throws(() => parseBrusselsWallTime('2026-03-29', '02:30'), /Nonexistent local time/);
    // The minute either side of the gap is fine.
    assert.equal(parseBrusselsWallTime('2026-03-29', '01:59').toISOString(), '2026-03-29T00:59:00.000Z');
    assert.equal(parseBrusselsWallTime('2026-03-29', '03:00').toISOString(), '2026-03-29T01:00:00.000Z');
});

test('ambiguous local times are rejected, not guessed', () => {
    // Clocks fall 03:00 -> 02:00 on 25 October 2026; 02:30 happens twice.
    assert.throws(() => parseBrusselsWallTime('2026-10-25', '02:30'), /Ambiguous local time/);
    assert.equal(parseBrusselsWallTime('2026-10-25', '01:30').toISOString(), '2026-10-24T23:30:00.000Z');
    assert.equal(parseBrusselsWallTime('2026-10-25', '03:30').toISOString(), '2026-10-25T02:30:00.000Z');
});

test('malformed and impossible dates are rejected', () => {
    assert.throws(() => parseBrusselsWallTime('2026-02-30', '18:00'), /No such date/);
    assert.throws(() => parseBrusselsWallTime('26-09-25', '18:00'), /Date must be YYYY-MM-DD/);
    assert.throws(() => parseBrusselsWallTime('2026-09-25', '6pm'), /Time must be HH:MM/);
    assert.throws(() => parseBrusselsWallTime('2026-09-25', '18:00:30'), /Time must be HH:MM/);
    assert.throws(() => parseBrusselsWallTime('2026-13-01', '18:00'), /out of range/);
});

test('the form stamp is local wall time with no offset', () => {
    assert.equal(formStamp(parseBrusselsWallTime('2026-09-25', '18:00')), '2026-09-25T18:00');
    assert.equal(formStamp(parseBrusselsWallTime('2026-01-15', '09:05')), '2026-01-15T09:05');
});

test('with two preferences, the later opening wins — both must be inside the window', () => {
    const earlier = parseBrusselsWallTime('2026-09-25', '18:00');
    const later = parseBrusselsWallTime('2026-09-27', '20:00');
    assert.equal(openingFor(earlier, later).toISOString(), openingForPlayDate('2026-09-27').toISOString());
    assert.equal(openingFor(later, earlier).toISOString(), openingForPlayDate('2026-09-27').toISOString());
});

test('two start times on one day share that day\'s opening', () => {
    const primary = parseBrusselsWallTime('2026-09-25', '18:00');
    const alternative = parseBrusselsWallTime('2026-09-25', '20:00');
    assert.equal(openingFor(primary, alternative).toISOString(), '2026-09-10T22:00:00.000Z');
});

test('a missing alternative falls back to the primary opening', () => {
    const primary = parseBrusselsWallTime('2026-09-25', '18:00');
    assert.equal(openingFor(primary, null).toISOString(), opensAt(primary).toISOString());
});

test('the quota week runs Monday to Sunday of the play date', () => {
    assert.deepEqual(weekBounds('2026-09-26'), { start: '2026-09-21', end: '2026-09-27' }); // Saturday
    assert.deepEqual(weekBounds('2026-09-21'), { start: '2026-09-21', end: '2026-09-27' }); // the Monday itself
    assert.deepEqual(weekBounds('2026-09-27'), { start: '2026-09-21', end: '2026-09-27' }); // the Sunday itself
    assert.deepEqual(weekBounds('2026-09-28'), { start: '2026-09-28', end: '2026-10-04' }); // next Monday
});

test('the quota week survives month and year boundaries', () => {
    assert.deepEqual(weekBounds('2026-01-01'), { start: '2025-12-29', end: '2026-01-04' });
    assert.deepEqual(weekBounds('2026-12-31'), { start: '2026-12-28', end: '2027-01-03' });
});

test('Sunday and Monday of the same calendar week are different quota weeks', () => {
    // The question people actually ask: "does Sunday count against this week or next?"
    assert.notDeepEqual(weekBounds('2026-09-27'), weekBounds('2026-09-28'));
    assert.deepEqual(weekBounds('2026-09-27'), weekBounds('2026-09-21'));
});
