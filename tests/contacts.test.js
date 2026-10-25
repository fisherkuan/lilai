/*
 * Sign-in: links by email and device sessions. The pure helpers always run;
 * the link, session and delete flow needs a scratch PostgreSQL (TEST_DATABASE_URL, see
 * booking-quota.integration.test.js) and is skipped without one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const {
    COOKIE, normalEmail, sessionCookie, buildSignInMail, collapseSeries, createContactsSchema, createContacts
} = require('../server/contacts');
const hosting = require('../server/event-hosting');

test('addresses compare lower-cased and trimmed', () => {
    assert.equal(normalEmail('  Host@Example.BE '), 'host@example.be');
});

test('the session cookie is HttpOnly and Lax for 90 days, Secure in production', () => {
    assert.match(sessionCookie('abc', { secure: true }), /^lilai_session=abc; Path=\/; HttpOnly; SameSite=Lax; Max-Age=7776000; Secure$/);
    assert.doesNotMatch(sessionCookie('abc', { secure: false }), /Secure/);
});

test('the sign-in mail carries the link and says it works once', () => {
    const mail = buildSignInMail('a@b.be', 'https://lilai.test/me/signin/x', { NOTIFY_EMAIL_FROM: 'Lilai <hi@lilai.test>' });
    assert.equal(mail.from, 'Lilai <hi@lilai.test>');
    assert.match(mail.text, /https:\/\/lilai\.test\/me\/signin\/x/);
    assert.match(mail.text, /once, for 30 minutes/);
});

test('a series shows once, as its next date still on', () => {
    const cutoff = new Date('2026-10-25T00:00:00Z');
    const rows = [
        { id: 'a1', series_id: 's', date: '2026-10-20T18:00:00Z' },
        { id: 'one', series_id: null, date: '2026-10-24T18:00:00Z' },
        { id: 'a2', series_id: 's', date: '2026-10-27T18:00:00Z', cancelled_at: '2026-10-21T00:00:00Z' },
        { id: 'a3', series_id: 's', date: '2026-11-03T18:00:00Z' },
        { id: 'b1', series_id: 't', date: '2026-09-01T18:00:00Z' },
        { id: 'b2', series_id: 't', date: '2026-09-08T18:00:00Z' }
    ];
    const out = collapseSeries(rows, cutoff);
    assert.deepEqual(out.map(e => [e.id, e.count]), [['b2', 2], ['one', 1], ['a3', 3]]);
});

const CONNECTION = process.env.TEST_DATABASE_URL;
const scratch = CONNECTION && /test|scratch|local/i.test(new URL(CONNECTION).pathname);

test('a host signs in by email, finds their events, manages one, and deletes the email', { skip: !scratch && 'no TEST_DATABASE_URL' }, async () => {
    const pool = new Pool({ connectionString: CONNECTION });
    try {
        const client = await pool.connect();
        try {
            await client.query(`CREATE TABLE IF NOT EXISTS events (
                id VARCHAR(255) PRIMARY KEY, title VARCHAR(255) NOT NULL, date TIMESTAMPTZ NOT NULL, description TEXT,
                location VARCHAR(255), source VARCHAR(255), endDate TIMESTAMPTZ, attendance_limit INTEGER)`);
            await client.query(`CREATE TABLE IF NOT EXISTS rsvps (
                id VARCHAR(255) PRIMARY KEY, event_id VARCHAR(255) REFERENCES events(id) ON DELETE CASCADE,
                attendee_name VARCHAR(255) NOT NULL, attendance VARCHAR(255) NOT NULL, timestamp TIMESTAMPTZ NOT NULL)`);
            await hosting.createHostingSchema(client);
            await createContactsSchema(client);
        } finally {
            client.release();
        }
        await pool.query('TRUNCATE contacts, contact_tokens, device_sessions, event_host_links, rsvps, events CASCADE');
        const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000);
        await pool.query(
            `INSERT INTO events (id, title, date, host_name, host_email, managed) VALUES
             ('e1', 'Badminton', $1, 'Ann', 'Ann@Lilai.test', TRUE),
             ('e2', 'Hike', $1, 'Bob', 'bob@lilai.test', TRUE)`,
            [soon]
        );
        await pool.query(`INSERT INTO rsvps (id, event_id, attendee_name, attendance, timestamp, contact_email)
                          VALUES ('r1', 'e2', 'Ann', 'yes', NOW(), 'ann@lilai.test')`);

        const mails = [];
        const fetchImpl = async (url, init) => { mails.push(JSON.parse(init.body)); return { ok: true, text: async () => '' }; };
        const contacts = createContacts({ pool, env: { RESEND_API_KEY: 'k' }, fetchImpl });
        const ask = (email, ip = '1.1.1.1') => contacts.requestSignIn(email, { ip, baseUrl: 'https://lilai.test' });

        // An address that made nothing gets the same answer and no mail.
        await ask('stranger@lilai.test');
        assert.equal(mails.length, 0);
        await assert.rejects(ask('not an email'), { status: 400 });

        await ask(' ANN@lilai.test ');
        assert.equal(mails.length, 1);
        assert.deepEqual(mails[0].to, ['ann@lilai.test']);
        const token = mails[0].text.match(/\/me\/signin\/([A-Za-z0-9_-]{32})/)[1];

        const signedIn = await contacts.redeem(token, 'test');
        assert.equal(signedIn.email, 'ann@lilai.test');
        assert.equal(await contacts.redeem(token, 'test'), null); // a link works once
        const verified = await pool.query('SELECT verified_at FROM contacts WHERE email = $1', ['ann@lilai.test']);
        assert.ok(verified.rows[0].verified_at);
        // Signing in takes the name from the address's events; the person can change or clear it.
        assert.deepEqual(await contacts.profileOf('ann@lilai.test'), { email: 'ann@lilai.test', name: 'Ann' });
        assert.deepEqual(await contacts.setName('ann@lilai.test', '  Ann   Lee '), { name: 'Ann Lee', renamedIn: [] });
        assert.equal((await contacts.profileOf('ann@lilai.test')).name, 'Ann Lee');

        const req = { headers: { cookie: `${COOKIE}=${signedIn.session}` } };
        assert.equal(await contacts.emailOf(req), 'ann@lilai.test');
        const mine = await contacts.eventsOf('ann@lilai.test');
        assert.deepEqual(mine.upcoming.map(e => e.id), ['e1']);
        assert.deepEqual(mine.joined.map(e => e.id), ['e2']);

        const hostPath = await contacts.manageLink('ann@lilai.test', 'e1');
        assert.match(hostPath, /^\/host\/[A-Za-z0-9_-]{32}$/);
        const link = await pool.query('SELECT event_id, created_via FROM event_host_links WHERE token_hash = $1',
            [hosting.hashToken(hostPath.split('/')[2])]);
        assert.deepEqual(link.rows[0], { event_id: 'e1', created_via: 'email' });
        assert.equal(await contacts.manageLink('ann@lilai.test', 'e2'), null); // Bob's event

        // Three links an hour per address; the fourth is dropped silently.
        await ask('ann@lilai.test');
        await ask('ann@lilai.test');
        await ask('ann@lilai.test');
        assert.equal(mails.length, 3);

        await contacts.forget('ann@lilai.test');
        assert.equal(await contacts.emailOf(req), null);
        const left = await pool.query(`SELECT
            (SELECT host_email FROM events WHERE id = 'e1') AS host,
            (SELECT host_name FROM events WHERE id = 'e1') AS name,
            (SELECT contact_email FROM rsvps WHERE id = 'r1') AS rsvp`);
        assert.deepEqual(left.rows[0], { host: null, name: 'Ann', rsvp: null });
        assert.equal((await contacts.profileOf('ann@lilai.test')).name, ''); // the name goes with the email
        // Deleted, the address no longer gets a link.
        await pool.query('DELETE FROM contact_tokens');
        await ask('ann@lilai.test');
        assert.equal(mails.length, 3);
    } finally {
        await pool.end();
    }
});

test('one network gets 20 tries an hour', async () => {
    const pool = { query: async () => ({ rows: [{ known: false }] }) };
    const contacts = createContacts({ pool, env: { RESEND_API_KEY: 'k' }, fetchImpl: async () => ({ ok: true }) });
    for (let i = 0; i < 20; i++) await contacts.requestSignIn(`x${i}@lilai.test`, { ip: '9.9.9.9', baseUrl: '' });
    await assert.rejects(contacts.requestSignIn('y@lilai.test', { ip: '9.9.9.9', baseUrl: '' }), { status: 429 });
    await contacts.requestSignIn('y@lilai.test', { ip: '8.8.8.8', baseUrl: '' });
});
