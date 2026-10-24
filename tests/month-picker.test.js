const test = require('node:test');
const assert = require('node:assert/strict');

const { monthCells, addDays } = require('../public/js/month-picker');

test('a month starts on its weekday, Monday first, and fills whole weeks', () => {
    const oct = monthCells(2026, 9); // 1 October 2026 is a Thursday
    assert.deepEqual(oct.slice(0, 4), [null, null, null, '2026-10-01']);
    assert.equal(oct.length % 7, 0);
    assert.equal(oct.filter(Boolean).length, 31);
    assert.equal(oct.filter(Boolean).at(-1), '2026-10-31');
});

test('a month that starts on Monday has no leading blanks; February counts leap years', () => {
    assert.equal(monthCells(2027, 1)[0], '2027-02-01'); // 1 February 2027 is a Monday
    assert.equal(monthCells(2028, 1).filter(Boolean).length, 29);
    assert.equal(monthCells(2027, 1).filter(Boolean).length, 28);
});

test('stepping days crosses months, years and the DST change by the calendar', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-12-28', 7), '2027-01-04');
    assert.equal(addDays('2026-10-25', -7), '2026-10-18');
    assert.equal(addDays('2027-03-27', 1), '2027-03-28');
});
