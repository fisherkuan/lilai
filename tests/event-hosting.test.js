const test = require('node:test');
const assert = require('node:assert/strict');
const {
    validateNewEvent, googleEventResource, googleDescription, EventInputError,
    newHostToken, hashHostToken, looksLikeHostToken, publicEvent, mailHostLink
} = require('../server/event-hosting');

const NOW = new Date('2026-10-24T10:00:00Z');
const calendars = ['揪團啦'];
const base = {
    title: ' Hot pot ',
    calendar: '揪團啦',
    date: '2026-11-07',
    start: '19:00',
    end: '22:00',
    hostName: 'Mei'
};

function fieldOf(body) {
    try {
        validateNewEvent(body, { calendars, now: NOW });
    } catch (error) {
        assert.ok(error instanceof EventInputError);
        return error.field;
    }
    return null;
}

test('a plain event reads as Brussels wall time', () => {
    const e = validateNewEvent(base, { calendars, now: NOW });
    assert.equal(e.title, 'Hot pot');
    assert.equal(e.start.toISOString(), '2026-11-07T18:00:00.000Z'); // CET, UTC+1
    assert.equal(e.end.toISOString(), '2026-11-07T21:00:00.000Z');
    assert.equal(e.limit, null);
    assert.equal(e.approval, false);
    assert.equal(e.hostJoins, true);
});

test('an end at or before the start is the next day', () => {
    const e = validateNewEvent({ ...base, start: '22:00', end: '01:30' }, { calendars, now: NOW });
    assert.equal(e.endDate, '2026-11-08');
    assert.equal(e.end.toISOString(), '2026-11-08T00:30:00.000Z');
});

test('the form refuses what it cannot make', () => {
    assert.equal(fieldOf({ ...base, title: '  ' }), 'title');
    assert.equal(fieldOf({ ...base, calendar: 'SportsCenter' }), 'calendar');
    assert.equal(fieldOf({ ...base, date: '2026-10-23' }), 'start'); // passed
    assert.equal(fieldOf({ ...base, start: '7pm' }), 'start');
    assert.equal(fieldOf({ ...base, end: '' }), 'end');
    assert.equal(fieldOf({ ...base, limit: '0' }), 'limit');
    assert.equal(fieldOf({ ...base, limit: '2.5' }), 'limit');
    assert.equal(fieldOf({ ...base, link: 'javascript:alert(1)' }), 'link');
    assert.equal(fieldOf({ ...base, hostName: '' }), 'hostName');
    assert.equal(fieldOf({ ...base, hostEmail: 'mei' }), 'hostEmail');
    assert.equal(fieldOf({ ...base, title: '<script>x</script>' }), 'title');
});

test('the nonexistent DST hour is refused, not guessed', () => {
    assert.equal(fieldOf({ ...base, date: '2027-03-28', start: '02:30', end: '04:00' }), 'start');
});

test('limit and approval reach the Google description the sync reads', () => {
    const e = validateNewEvent({ ...base, limit: '8', approval: true, description: 'Bring a bowl', link: 'https://example.com/x' }, { calendars, now: NOW });
    const text = googleDescription(e);
    assert.match(text, /^Bring a bowl/);
    assert.match(text, /^link: https:\/\/example\.com\/x$/m);
    assert.match(text, /^limit: 8$/m);
    assert.match(text, /Mei.*confirms each place/);
    // The sync's own regex finds the limit.
    assert.equal(text.match(/limit:?\s*(\d+)/i)[1], '8');
});

test('the Google resource keeps the zone and marks the event as Lilai-made', () => {
    const e = validateNewEvent({ ...base, location: 'Ladeuzeplein' }, { calendars, now: NOW });
    const r = googleEventResource(e);
    assert.deepEqual(r.start, { dateTime: '2026-11-07T19:00:00', timeZone: 'Europe/Brussels' });
    assert.deepEqual(r.end, { dateTime: '2026-11-07T22:00:00', timeZone: 'Europe/Brussels' });
    assert.equal(r.location, 'Ladeuzeplein');
    assert.equal(r.description, undefined);
    assert.equal(r.extendedProperties.private.lilai, '1');
});

test('host tokens are long, url-safe, and stored only as a hash', () => {
    const token = newHostToken();
    assert.ok(looksLikeHostToken(token));
    assert.equal(hashHostToken(token).length, 64);
    assert.notEqual(hashHostToken(token), hashHostToken(newHostToken()));
    assert.equal(looksLikeHostToken('short'), false);
    assert.equal(looksLikeHostToken('../../etc/passwd/aaaaaaaaaaaaaaaaaaaaa'), false);
});

test('the public view drops the host email and the token hash', () => {
    const row = { id: 'cal-x', title: 'T', host_name: 'Mei', host_email: 'm@x.be', host_token_hash: 'h', approval_required: true };
    assert.deepEqual(publicEvent(row), { id: 'cal-x', title: 'T', host_name: 'Mei', approval_required: true });
});

test('the host link mail goes out only with a Resend key', async () => {
    let sent = null;
    const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return { ok: true }; };
    assert.equal(await mailHostLink({ to: 'm@x.be', title: 'Hot pot', url: 'https://l/host/t' }, {}, fetchImpl), false);
    assert.equal(sent, null);
    assert.equal(await mailHostLink({ to: 'm@x.be', title: 'Hot pot', url: 'https://l/host/t' }, { RESEND_API_KEY: 'k' }, fetchImpl), true);
    assert.deepEqual(sent.to, ['m@x.be']);
    assert.match(sent.text, /https:\/\/l\/host\/t/);
});
