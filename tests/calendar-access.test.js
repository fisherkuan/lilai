const test = require('node:test');
const assert = require('node:assert/strict');
const { calendarWriters, writableCalendars } = require('../server/calendar-access');

const calendars = [
    { name: 'SportsCenter', restricted: false },
    { name: 'TSA', restricted: true },
    { name: '揪團啦', restricted: false }
];
const env = { ADMIN_EMAILS: 'boss@lilai.test', CALENDAR_WRITERS: ' TSA = A@x.be, b@y.be ; Other=c@z.be' };
const names = (email, e = env) => writableCalendars(calendars, email, e).map(c => c.name);

test('reads the allow lists per calendar, in lower case', () => {
    assert.deepEqual(calendarWriters(env), { TSA: ['a@x.be', 'b@y.be'], Other: ['c@z.be'] });
    assert.deepEqual(calendarWriters({}), {});
});

test('an address on the list may write to the restricted calendar', () => {
    assert.deepEqual(names('a@X.be'), ['SportsCenter', 'TSA', '揪團啦']);
});

test('an admin may write to every restricted calendar', () => {
    assert.deepEqual(names('Boss@lilai.test'), ['SportsCenter', 'TSA', '揪團啦']);
});

test('anyone else gets the open calendars only', () => {
    assert.deepEqual(names('c@z.be'), ['SportsCenter', '揪團啦']);
    assert.deepEqual(names('c@z.be', { ADMIN_EMAILS: 'boss@lilai.test' }), ['SportsCenter', '揪團啦']);
});

test('nobody signed in writes nowhere', () => {
    assert.deepEqual(names(null), []);
});
