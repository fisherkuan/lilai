const test = require('node:test');
const assert = require('node:assert/strict');

const { expandRepeat, describeRule, MAX_OCCURRENCES, MAX_EVERY } = require('../server/booking-repeat');

const fieldOf = (run) => {
    try {
        run();
        return null;
    } catch (error) {
        return error.field;
    }
};

// 2026-10-06 is a Tuesday. Every date below is checked against a real calendar.
const TUE = '2026-10-06';

test('no repeat is one date', () => {
    assert.deepEqual(expandRepeat(TUE, null), [TUE]);
    assert.deepEqual(expandRepeat(TUE, undefined), [TUE]);
});

test('a weekly repeat with no weekday chosen keeps the first booking’s own day', () => {
    const dates = expandRepeat(TUE, { every: 1, unit: 'week', until: '2026-11-03' });
    assert.deepEqual(dates, ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']);
    for (const iso of dates) {
        const [y, m, d] = iso.split('-').map(Number);
        assert.equal(new Date(Date.UTC(y, m - 1, d)).getUTCDay(), 2, `${iso} is not a Tuesday`);
    }
});

/*
 * Brussels changes clock on 2026-10-25. Adding days to a wall clock would slide the
 * weekday across that boundary; these are calendar dates and must not move.
 */
test('the clock change does not shift the weekday', () => {
    assert.deepEqual(expandRepeat('2026-10-18', { every: 1, unit: 'week', until: '2026-11-01' }),
        ['2026-10-18', '2026-10-25', '2026-11-01']);
});

test('several weekdays in one week come out in date order', () => {
    // Mon(1), Wed(3), Fri(5), starting on a Tuesday: the first Monday is behind the start
    // date and is left out, so the run opens on Wednesday.
    assert.deepEqual(expandRepeat(TUE, { every: 1, unit: 'week', weekdays: [1, 3, 5], until: '2026-10-19' }),
        ['2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19']);
});

test('Sunday sorts to the end of its Monday-Sunday week, not the front', () => {
    // Sunday is 0 in getUTCDay but the last day of the week the quota counts.
    assert.deepEqual(expandRepeat('2026-10-05', { every: 1, unit: 'week', weekdays: [0, 1], until: '2026-10-12' }),
        ['2026-10-05', '2026-10-11', '2026-10-12']);
});

test('every N weeks skips whole weeks, weekday set intact', () => {
    assert.deepEqual(expandRepeat(TUE, { every: 2, unit: 'week', weekdays: [2, 4], until: '2026-11-06' }),
        ['2026-10-06', '2026-10-08', '2026-10-20', '2026-10-22', '2026-11-03', '2026-11-05']);
});

test('duplicate weekdays collapse instead of double-booking', () => {
    assert.deepEqual(expandRepeat(TUE, { every: 1, unit: 'week', weekdays: [2, 2, 2], until: '2026-10-13' }),
        ['2026-10-06', '2026-10-13']);
});

test('every N days is a cadence, whatever weekday it lands on', () => {
    assert.deepEqual(expandRepeat(TUE, { every: 3, unit: 'day', until: '2026-10-18' }),
        ['2026-10-06', '2026-10-09', '2026-10-12', '2026-10-15', '2026-10-18']);
});

test('every N months keeps the date', () => {
    assert.deepEqual(expandRepeat('2026-10-06', { every: 1, unit: 'month', until: '2027-01-06' }),
        ['2026-10-06', '2026-11-06', '2026-12-06', '2027-01-06']);
    assert.deepEqual(expandRepeat('2026-10-06', { every: 2, unit: 'month', until: '2027-02-28' }),
        ['2026-10-06', '2026-12-06', '2027-02-06']);
});

/*
 * A monthly run anchored on the 31st must skip the months that have no 31st rather than
 * sliding onto the 28th. A booking on a day nobody asked for is worse than a gap.
 */
test('a monthly repeat skips months without that date, and never slides', () => {
    const dates = expandRepeat('2026-12-31', { every: 1, unit: 'month', until: '2027-05-31' });
    assert.deepEqual(dates, ['2026-12-31', '2027-01-31', '2027-03-31', '2027-05-31']);
    assert.equal(dates.some((iso) => iso.startsWith('2027-02')), false);
    assert.equal(dates.some((iso) => iso.endsWith('-28')), false);
});

test('weekdays belong to a weekly rule and nowhere else', () => {
    assert.equal(fieldOf(() => expandRepeat(TUE, { every: 1, unit: 'day', weekdays: [1], until: '2026-11-03' })),
        'repeatWeekdays');
    assert.equal(fieldOf(() => expandRepeat(TUE, { every: 1, unit: 'week', weekdays: [7], until: '2026-11-03' })),
        'repeatWeekdays');
    // An empty array is not a claim about weekdays, so it is allowed.
    assert.equal(expandRepeat(TUE, { every: 1, unit: 'day', weekdays: [], until: '2026-10-08' }).length, 3);
});

test('the unit and the interval are both checked', () => {
    assert.equal(fieldOf(() => expandRepeat(TUE, { every: 1, unit: 'fortnight', until: '2026-11-03' })), 'repeatUnit');
    assert.equal(fieldOf(() => expandRepeat(TUE, { unit: 'week', until: '2026-11-03' })), 'repeatEvery');
    for (const every of [0, -1, 1.5, MAX_EVERY + 1, '2', true]) {
        assert.equal(fieldOf(() => expandRepeat(TUE, { every, unit: 'week', until: '2026-11-03' })), 'repeatEvery');
    }
});

test('an end date is required, real, and not before the start', () => {
    assert.equal(fieldOf(() => expandRepeat(TUE, { every: 1, unit: 'week' })), 'repeatUntil');
    assert.equal(fieldOf(() => expandRepeat(TUE, { every: 1, unit: 'week', until: '03-11-2026' })), 'repeatUntil');
    assert.equal(fieldOf(() => expandRepeat(TUE, { every: 1, unit: 'week', until: '2026-09-01' })), 'repeatUntil');
});

test('a repeat cannot run past the season', () => {
    assert.equal(
        fieldOf(() => expandRepeat('2027-09-01', { every: 1, unit: 'week', until: '2027-10-15' }, { seasonEndsOn: '2027-09-30' })),
        'repeatUntil'
    );
    assert.equal(
        expandRepeat('2027-09-02', { every: 1, unit: 'week', until: '2027-09-30' }, { seasonEndsOn: '2027-09-30' }).length, 5);
});

test('too many occurrences is refused, not silently shortened', () => {
    assert.equal(MAX_OCCURRENCES, 52);
    assert.equal(fieldOf(() => expandRepeat(TUE, { every: 1, unit: 'day', until: '2027-10-06' })), 'repeatUntil');
    assert.equal(expandRepeat(TUE, { every: 1, unit: 'week', until: '2026-10-13' }, { cap: 2 }).length, 2);
    assert.equal(fieldOf(() => expandRepeat(TUE, { every: 1, unit: 'week', until: '2026-10-20' }, { cap: 2 })), 'repeatUntil');
});

test('a repeat needs a real first day', () => {
    assert.equal(fieldOf(() => expandRepeat('', { every: 1, unit: 'week', until: '2026-11-03' })), 'playDate');
    assert.equal(fieldOf(() => expandRepeat('next tuesday', { every: 1, unit: 'week', until: '2026-11-03' })), 'playDate');
});

test('a rule reads the same wherever it is shown', () => {
    assert.equal(describeRule(null), 'One-off');
    assert.equal(describeRule({ every: 1, unit: 'week', weekdays: [2] }), 'Every week on Tue');
    assert.equal(describeRule({ every: 2, unit: 'week', weekdays: [1, 3, 5] }), 'Every 2 weeks on Mon, Wed, Fri');
    assert.equal(describeRule({ every: 1, unit: 'day' }), 'Every day');
    assert.equal(describeRule({ every: 3, unit: 'day' }), 'Every 3 days');
    assert.equal(describeRule({ every: 1, unit: 'month' }), 'Every month');
});
