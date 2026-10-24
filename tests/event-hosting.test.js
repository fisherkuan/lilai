const test = require('node:test');
const assert = require('node:assert/strict');
const {
    validateEvent, googleEventResource, googleDescription, EventInputError, validateLinks,
    convertLegacyDescription, linkFromLegacyDescription, laterTimes, formValues, publishState,
    newToken, hashToken, looksLikeToken, publicEvent, mailHostLink, newGoogleEventId, eventIdForGoogleId
} = require('../server/event-hosting');

const NOW = new Date('2026-10-24T10:00:00Z');
const calendars = ['揪團啦', 'TSA'];
const base = {
    title: ' Hot pot ',
    calendar: '揪團啦',
    date: '2026-11-07',
    start: '19:00',
    end: '22:00',
    location: 'Optimist',
    hostName: 'Mei'
};
const make = (body) => validateEvent(body, { mode: 'create', calendars, now: NOW });

function fieldOf(body, opts = { mode: 'create', calendars, now: NOW }) {
    try {
        validateEvent(body, opts);
    } catch (error) {
        assert.ok(error instanceof EventInputError);
        return error.field;
    }
    return null;
}

test('a one-off event reads as Brussels wall time', () => {
    const e = make(base);
    assert.equal(e.title, 'Hot pot');
    assert.equal(e.start.toISOString(), '2026-11-07T18:00:00.000Z'); // CET, UTC+1
    assert.equal(e.occurrences.length, 1);
    assert.equal(e.occurrences[0].end.toISOString(), '2026-11-07T21:00:00.000Z');
    assert.equal(e.repeat, null);
    assert.equal(e.hostJoins, true);
});

test('an end at or before the start is the next day', () => {
    const e = make({ ...base, start: '22:00', end: '01:30' });
    assert.equal(e.end.toISOString(), '2026-11-08T00:30:00.000Z');
});

test('a weekly repeat makes one occurrence per date, each at Brussels time across the DST change', () => {
    const e = make({ ...base, date: '2027-03-16', repeat: { every: 1, unit: 'week', weekdays: [2], until: '2027-04-06' } });
    assert.deepEqual(e.occurrences.map(o => o.date), ['2027-03-16', '2027-03-23', '2027-03-30', '2027-04-06']);
    // 19:00 Brussels is 18:00 UTC before 28 March and 17:00 UTC after.
    assert.equal(e.occurrences[0].start.toISOString(), '2027-03-16T18:00:00.000Z');
    assert.equal(e.occurrences[2].start.toISOString(), '2027-03-30T17:00:00.000Z');
});

test('a repeat that is too long, empty or unreadable is refused on the repeat field', () => {
    assert.equal(fieldOf({ ...base, repeat: { every: 1, unit: 'day', until: '2027-06-01' } }), 'repeat');
    assert.equal(fieldOf({ ...base, repeat: { every: 1, unit: 'week', until: '' } }), 'repeat');
    assert.equal(fieldOf({ ...base, repeat: { every: 1, unit: 'year', until: '2027-01-01' } }), 'repeat');
});

test('the form refuses what it cannot make', () => {
    assert.equal(fieldOf({ ...base, title: '  ' }), 'title');
    assert.equal(fieldOf({ ...base, calendar: 'Elsewhere' }), 'calendar');
    assert.equal(fieldOf({ ...base, date: '2026-10-23' }), 'start'); // passed
    assert.equal(fieldOf({ ...base, start: '7pm' }), 'start');
    assert.equal(fieldOf({ ...base, end: '' }), 'end');
    assert.equal(fieldOf({ ...base, limit: '0' }), 'limit');
    assert.equal(fieldOf({ ...base, links: [{ url: 'javascript:alert(1)' }] }), 'links');
    assert.equal(fieldOf({ ...base, hostName: '' }), 'hostName');
    assert.equal(fieldOf({ ...base, hostEmail: 'mei' }), 'hostEmail');
    assert.equal(fieldOf({ ...base, date: '2027-03-28', start: '02:30', end: '04:00' }), 'start'); // DST gap
});

test('an edit may keep a start that has passed, but not move one into the past', () => {
    const current = { date: new Date('2026-10-24T08:00:00Z') }; // 10:00 Brussels, two hours ago
    const edit = { title: 'Brunch', date: '2026-10-24', start: '10:00', end: '12:00', location: 'Optimist', scope: 'later' };
    const e = validateEvent(edit, { mode: 'edit', now: NOW, current });
    assert.equal(e.scope, 'later');
    assert.equal(e.calendar, undefined);
    assert.equal(fieldOf({ ...edit, start: '09:00' }, { mode: 'edit', now: NOW, current }), 'start');
});

test('the place is required, and one of the owner\'s places when there is a list', () => {
    const places = [{ name: 'TSH 1', address: 'Topsporthal, Tervuursevest 101, 3001 Leuven' }, { name: 'Optimist' }];
    const withList = { mode: 'create', calendars, places, now: NOW };
    assert.equal(fieldOf({ ...base, location: ' ' }), 'location');
    assert.equal(fieldOf({ ...base, location: 'My kitchen' }, withList), 'location');
    assert.equal(validateEvent({ ...base, location: 'tsh 1' }, withList).location, 'TSH 1'); // the list's spelling
    // An edit keeps an old place the event already had, but cannot move to a new one off the list.
    const current = { date: new Date('2026-11-07T18:00:00Z'), location: 'Gymnasium\nTervuursevest 101' };
    const edit = { title: 'Hot pot', date: '2026-11-07', start: '19:00', end: '22:00', location: current.location };
    assert.equal(validateEvent(edit, { mode: 'edit', places, now: NOW, current }).location, current.location);
    assert.equal(fieldOf({ ...edit, location: 'Somewhere new' }, { mode: 'edit', places, now: NOW, current }), 'location');
});

test('the Google copy sends a listed place with its address', () => {
    const places = [{ name: 'TSH 1', address: 'Topsporthal, Tervuursevest 101, 3001 Leuven' }];
    const row = { id: 'cal-x@google.com', title: 'Badminton', date: '2026-11-07T18:00:00Z', location: 'TSH 1' };
    assert.equal(googleEventResource(row, { places }).location, 'TSH 1, Topsporthal, Tervuursevest 101, 3001 Leuven');
    assert.equal(googleEventResource({ ...row, location: 'Old hall' }, { places }).location, 'Old hall');
});

test('later dates of a series take the new clock times on their own day', () => {
    const row = { date: new Date('2026-12-01T18:00:00Z') };
    const t = laterTimes(row, { startTime: '20:00', endTime: '22:30' });
    assert.equal(t.start.toISOString(), '2026-12-01T19:00:00.000Z');
    assert.equal(t.end.toISOString(), '2026-12-01T21:30:00.000Z');
});

test('the edit sheet opens on the row in Brussels time', () => {
    const v = formValues({ title: 'T', date: new Date('2026-11-07T18:00:00Z'), enddate: new Date('2026-11-07T21:00:00Z'), links: [], attendance_limit: 8, approval_required: true });
    assert.deepEqual([v.date, v.start, v.end, v.limit, v.approval], ['2026-11-07', '19:00', '22:00', 8, true]);
});

test('the Google copy carries the links and a way back to Lilai, and keeps the zone', () => {
    const row = {
        id: 'cal-abc@google.com', title: 'Hike', date: new Date('2026-11-14T09:00:00Z'), enddate: new Date('2026-11-14T14:00:00Z'),
        location: 'Heverlee', description: 'Bring lunch', links: [{ url: 'https://forms.gle/x', label: 'Sign-up' }, { url: 'https://maps.example/y' }],
        approval_required: true
    };
    const r = googleEventResource(row, { publicUrl: 'https://lilai.example' });
    assert.equal(r.summary, 'Hike');
    assert.deepEqual(r.start, { dateTime: '2026-11-14T09:00:00.000Z', timeZone: 'Europe/Brussels' });
    assert.equal(r.status, 'confirmed');
    assert.equal(r.source.url, 'https://lilai.example/#event-cal-abc%40google.com');
    const d = googleDescription(row, 'https://lilai.example');
    assert.match(d, /^Bring lunch\n\nSign-up: https:\/\/forms\.gle\/x\nhttps:\/\/maps\.example\/y\n\nAsk to join, or see who is coming: https:\/\/lilai\.example\/#event-/);
    const noEnd = googleEventResource({ ...row, enddate: null }, {});
    assert.equal(noEnd.end.dateTime, '2026-11-14T11:00:00.000Z'); // two hours, Google needs an end
});

test('Lilai picks Google ids Google accepts, and keeps the old row naming', () => {
    const id = newGoogleEventId();
    assert.match(id, /^[0-9a-v]{32}$/);
    assert.equal(eventIdForGoogleId(id), `cal-${id}@google.com`);
});

test('old description settings move out once', () => {
    const c = convertLegacyDescription('Bring snacks.\nlimit: 8\nLink: https://forms.gle/abc\nSee https://x.be too');
    assert.equal(c.limit, 8);
    assert.equal(c.link, 'https://forms.gle/abc');
    assert.equal(c.description, 'Bring snacks.\nSee https://x.be too');
    const prose = convertLegacyDescription('Our limit is flexible, see https://a.be/b');
    assert.equal(prose.limit, null);
    assert.equal(prose.link, 'https://a.be/b');
    assert.equal(prose.description, 'Our limit is flexible, see https://a.be/b');
    assert.equal(linkFromLegacyDescription(null), null);
});

test('links: empty rows drop, labels stay, bad ones are refused', () => {
    assert.deepEqual(validateLinks([{ url: ' https://forms.gle/abc ', label: ' Sign-up ' }, { url: '' }]), [{ url: 'https://forms.gle/abc', label: 'Sign-up' }]);
    assert.throws(() => validateLinks([{ url: 'ftp://x.be' }]), EventInputError);
    assert.throws(() => validateLinks(Array.from({ length: 6 }, (_, i) => ({ url: `https://x.be/${i}` }))), /At most 5/);
});

test('where the Google copy stands, in words', () => {
    const row = { google_calendar_id: 'c', version: 2, synced_version: 2 };
    assert.equal(publishState(row, { publishing: true }).state, 'synced');
    assert.equal(publishState({ ...row, synced_version: 1 }, { publishing: false }).state, 'off');
    assert.equal(publishState({ ...row, synced_version: 1 }, { publishing: true }).state, 'sending');
    const retry = publishState({ ...row, synced_version: 1, push_error: 'Forbidden' }, { publishing: true });
    assert.equal(retry.state, 'retrying');
    assert.match(retry.text, /Forbidden/);
});

test('tokens are long, url-safe, and stored only as a hash', () => {
    const token = newToken();
    assert.ok(looksLikeToken(token));
    assert.equal(hashToken(token).length, 64);
    assert.equal(looksLikeToken('../../etc/passwd/aaaaaaaaaaaaaaaaaaaaa'), false);
});

test('the public view drops the host email and the publishing bookkeeping', () => {
    const row = { id: 'x', title: 'T', host_name: 'Mei', host_email: 'm@x.be', version: 3, synced_version: 2, push_error: 'e', push_attempts: 1, next_push_at: null };
    assert.deepEqual(publicEvent(row), { id: 'x', title: 'T', host_name: 'Mei' });
});

test('the management link mail goes out only with a Resend key', async () => {
    let sent = null;
    const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return { ok: true }; };
    assert.equal(await mailHostLink({ to: 'm@x.be', title: 'Hot pot', url: 'https://l/host/t' }, {}, fetchImpl), false);
    assert.equal(await mailHostLink({ to: 'm@x.be', title: 'Hot pot', url: 'https://l/host/t', count: 6 }, { RESEND_API_KEY: 'k' }, fetchImpl), true);
    assert.match(sent.text, /on 6 dates/);
    assert.match(sent.text, /https:\/\/l\/host\/t/);
});
