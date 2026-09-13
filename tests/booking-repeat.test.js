const test = require('node:test');
const assert = require('node:assert/strict');

const { expandRepeat, MAX_OCCURRENCES } = require('../server/booking-repeat');

const fieldOf = (run) => {
    try {
        run();
        return null;
    } catch (error) {
        return error.field;
    }
};

test('no repeat is one date', () => {
    assert.deepEqual(expandRepeat('2026-10-06', null), ['2026-10-06']);
    assert.deepEqual(expandRepeat('2026-10-06', undefined), ['2026-10-06']);
});

test('a weekly repeat lands on the same weekday every time', () => {
    const dates = expandRepeat('2026-10-06', { every: 7, until: '2026-11-03' });
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
    const dates = expandRepeat('2026-10-18', { every: 7, until: '2026-11-01' });
    assert.deepEqual(dates, ['2026-10-18', '2026-10-25', '2026-11-01']);
});

test('a fortnightly repeat skips a week', () => {
    assert.deepEqual(expandRepeat('2026-10-06', { every: 14, until: '2026-11-17' }),
        ['2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17']);
});

test('the run stops at the until date, and includes it when it lands on one', () => {
    // One day short of the fifth Tuesday: four dates, not five.
    assert.equal(expandRepeat('2026-10-06', { every: 7, until: '2026-11-02' }).length, 4);
    assert.equal(expandRepeat('2026-10-06', { every: 7, until: '2026-11-03' }).length, 5);
});

test('a repeat that runs until its own start day is just that day', () => {
    assert.deepEqual(expandRepeat('2026-10-06', { every: 7, until: '2026-10-06' }), ['2026-10-06']);
});

test('only whole weeks, up to four apart', () => {
    for (const every of [7, 14, 21, 28]) {
        assert.equal(expandRepeat('2026-10-06', { every, until: '2026-10-06' }).length, 1);
    }
    for (const every of [1, 3, 10, 30, '7', null]) {
        assert.equal(fieldOf(() => expandRepeat('2026-10-06', { every, until: '2026-11-03' })), 'repeat');
    }
});

test('an end date is required, real, and not before the start', () => {
    assert.equal(fieldOf(() => expandRepeat('2026-10-06', { every: 7 })), 'repeatUntil');
    assert.equal(fieldOf(() => expandRepeat('2026-10-06', { every: 7, until: '03-11-2026' })), 'repeatUntil');
    assert.equal(fieldOf(() => expandRepeat('2026-10-06', { every: 7, until: '2026-09-01' })), 'repeatUntil');
});

test('a repeat cannot run past the season', () => {
    assert.equal(
        fieldOf(() => expandRepeat('2027-09-01', { every: 7, until: '2027-10-15' }, { seasonEndsOn: '2027-09-30' })),
        'repeatUntil'
    );
    // Right up to the last day is fine.
    assert.equal(
        expandRepeat('2027-09-02', { every: 7, until: '2027-09-30' }, { seasonEndsOn: '2027-09-30' }).length, 5);
});

/*
 * The cap refuses instead of truncating. A repeat that quietly stopped in March would look
 * exactly like one that worked.
 */
test('too many occurrences is refused, not silently shortened', () => {
    assert.equal(fieldOf(() => expandRepeat('2026-10-06', { every: 7, until: '2028-10-06' })), 'repeatUntil');
    const atTheCap = expandRepeat('2026-10-06', { every: 7, until: '2026-10-06' }, { cap: 1 });
    assert.equal(atTheCap.length, 1);
    assert.equal(fieldOf(() => expandRepeat('2026-10-06', { every: 7, until: '2026-10-13' }, { cap: 1 })), 'repeatUntil');
    assert.equal(MAX_OCCURRENCES, 26);
});

test('a repeat needs a real first day', () => {
    assert.equal(fieldOf(() => expandRepeat('', { every: 7, until: '2026-11-03' })), 'playDate');
    assert.equal(fieldOf(() => expandRepeat('next tuesday', { every: 7, until: '2026-11-03' })), 'playDate');
});
