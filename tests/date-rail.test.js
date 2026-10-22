const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDays, rangeLabel, marksFor, dayKey } = require('../public/js/date-rail');

const at = (y, m, d, h = 12) => new Date(y, m, d, h);
const ev = (id, date) => ({ id, title: id, date: date.toISOString() });

test('the rail holds today and the next 13 days, in order, empty days included', () => {
    const days = buildDays(at(2026, 9, 22, 9), 14, []);
    assert.equal(days.length, 14);
    assert.equal(days[0].isToday, true);
    assert.deepEqual(days.map(d => d.date.getDate()), [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 1, 2, 3, 4]);
    assert.ok(days.every(d => d.events.length === 0));
});

test('a month change is marked on its first day only', () => {
    const days = buildDays(at(2026, 9, 22), 14, []);
    assert.deepEqual(days.filter(d => d.startsMonth).map(d => dayKey(d.date)), ['2026-10-1']);
    assert.equal(buildDays(at(2026, 10, 1), 14, [])[0].startsMonth, false);
});

test('the year boundary rolls over, and the range label then names both years', () => {
    const days = buildDays(at(2026, 11, 25), 14, []);
    assert.equal(days[7].date.getFullYear(), 2027);
    assert.equal(days[7].date.getDate(), 1);
    assert.equal(rangeLabel(days), '25 Dec 2026 – 7 Jan 2027');
    assert.equal(rangeLabel(buildDays(at(2026, 9, 22), 14, [])), '22 Oct – 4 Nov');
});

test('the DST change in late October neither skips nor repeats a day', () => {
    const days = buildDays(at(2026, 9, 24), 4, []);
    assert.deepEqual(days.map(d => d.date.getDate()), [24, 25, 26, 27]);
});

test('events land on their local day, sorted by start time; outside the range they drop', () => {
    const events = [ev('late', at(2026, 9, 23, 20)), ev('early', at(2026, 9, 23, 9)), ev('past', at(2026, 9, 21)), ev('beyond', at(2026, 10, 5))];
    const days = buildDays(at(2026, 9, 22), 14, events);
    assert.deepEqual(days[1].events.map(e => e.id), ['early', 'late']);
    assert.equal(days.reduce((n, d) => n + d.events.length, 0), 2);
});

test('up to three marks; past three, two marks and the rest as a count', () => {
    const mark = e => e.id;
    assert.deepEqual(marksFor(['a', 'b', 'c'].map(id => ({ id })), mark), { shown: ['a', 'b', 'c'], more: 0 });
    assert.deepEqual(marksFor(['a', 'b', 'c', 'd', 'e'].map(id => ({ id })), mark), { shown: ['a', 'b'], more: 3 });
});
