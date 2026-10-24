const test = require('node:test');
const assert = require('node:assert/strict');
const {
    validateNewEvent, googleEventResource, EventInputError,
    validateLinks, validateEventSettings, linkFromLegacyDescription,
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
    assert.equal(fieldOf({ ...base, links: [{ url: 'javascript:alert(1)' }] }), 'links');
    assert.equal(fieldOf({ ...base, hostName: '' }), 'hostName');
    assert.equal(fieldOf({ ...base, hostEmail: 'mei' }), 'hostEmail');
    assert.equal(fieldOf({ ...base, title: '<script>x</script>' }), 'title');
});

test('the nonexistent DST hour is refused, not guessed', () => {
    assert.equal(fieldOf({ ...base, date: '2027-03-28', start: '02:30', end: '04:00' }), 'start');
});

test('Google gets the description as written: no settings lines', () => {
    const e = validateNewEvent({ ...base, limit: '8', approval: true, description: 'Bring a bowl', links: [{ url: 'https://example.com/x' }] }, { calendars, now: NOW });
    assert.equal(googleEventResource(e).description, 'Bring a bowl');
    assert.equal(e.limit, 8);
    assert.deepEqual(e.links, [{ url: 'https://example.com/x' }]);
});

test('links: empty rows drop, labels stay, bad ones are refused', () => {
    assert.deepEqual(validateLinks(undefined), []);
    assert.deepEqual(validateLinks([
        { url: ' https://forms.gle/abc ', label: ' Sign-up ' },
        { url: '', label: 'forgotten row' },
        { url: 'https://maps.google.com/?q=Leuven' }
    ]), [
        { url: 'https://forms.gle/abc', label: 'Sign-up' },
        { url: 'https://maps.google.com/?q=Leuven' }
    ]);
    assert.throws(() => validateLinks('https://x.be'), EventInputError);
    assert.throws(() => validateLinks([{ url: 'ftp://x.be' }]), EventInputError);
    assert.throws(() => validateLinks([{ url: 'https://x.be', label: 'x'.repeat(41) }]), EventInputError);
    assert.throws(() => validateLinks(Array.from({ length: 6 }, (_, i) => ({ url: `https://x.be/${i}` }))), /At most 5/);
});

test('settings change only what is sent', () => {
    assert.deepEqual(validateEventSettings({ limit: '' }), { limit: null });
    assert.deepEqual(validateEventSettings({ links: [] }), { links: [] });
    assert.deepEqual(validateEventSettings({ limit: 4, links: [{ url: 'https://a.be' }] }), { limit: 4, links: [{ url: 'https://a.be/' }] });
    assert.throws(() => validateEventSettings({}), EventInputError);
    assert.throws(() => validateEventSettings({ limit: -1 }), EventInputError);
});

test('the one-time migration keeps the link an old description carried', () => {
    assert.equal(linkFromLegacyDescription('Run.\nLink: https://maps.google.com/?q=x)'), 'https://maps.google.com/?q=x');
    assert.equal(linkFromLegacyDescription('See https://a.be/b and https://c.be'), 'https://a.be/b');
    assert.equal(linkFromLegacyDescription('limit: 8'), null);
    assert.equal(linkFromLegacyDescription(null), null);
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
