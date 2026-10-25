/*
 * Lost-link requests: name and email from /me, approved by the admin. The pure helpers
 * always run; the request, approve and decline flow needs a scratch PostgreSQL
 * (TEST_DATABASE_URL, see booking-quota.integration.test.js) and is skipped without one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { validateClaim, buildAdminMail, createClaimsSchema, createClaims } = require('../server/email-claims');
const { createContactsSchema, createContacts } = require('../server/contacts');
const hosting = require('../server/event-hosting');

test('a request needs a name and a real-looking email', () => {
    assert.deepEqual(validateClaim({ name: ' Ann ', email: ' Ann@Lilai.TEST ' }), { name: 'Ann', email: 'ann@lilai.test' });
    assert.throws(() => validateClaim({ name: '', email: 'a@b.be' }), { field: 'name' });
    assert.throws(() => validateClaim({ name: 'Ann', email: 'nope' }), { field: 'email' });
});

test('the admin mail names the person and links the admin page', () => {
    const mail = buildAdminMail({ name: 'Ann', email: 'ann@lilai.test', adminUrl: 'https://lilai.test/admin/requests' }, {});
    assert.deepEqual(mail.to, ['lilai@fisherkuan.com']);
    assert.equal(mail.subject, '[Lilai] Lost link: Ann');
    assert.match(mail.text, /https:\/\/lilai\.test\/admin\/requests/);
});

const CONNECTION = process.env.TEST_DATABASE_URL;
const scratch = CONNECTION && /test|scratch|local/i.test(new URL(CONNECTION).pathname);

test('the admin approves a request: the email lands on the event and its series, and a link goes out', { skip: !scratch && 'no TEST_DATABASE_URL' }, async () => {
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
            await createClaimsSchema(client);
        } finally {
            client.release();
        }
        await pool.query('TRUNCATE email_claims, contacts, contact_tokens, device_sessions, event_host_links, rsvps, events, event_series CASCADE');
        const series = '00000000-0000-4000-8000-000000000001';
        await pool.query(`INSERT INTO event_series (id, rule) VALUES ($1, '{}')`, [series]);
        await pool.query(
            `INSERT INTO events (id, title, date, host_name, managed, series_id) VALUES
             ('run1', 'Run', NOW() + INTERVAL '1 day', 'Ann Lee', TRUE, $1),
             ('run2', 'Run', NOW() + INTERVAL '8 days', 'Ann Lee', TRUE, $1),
             ('hike', 'Hike', NOW() + INTERVAL '2 days', 'Bob', TRUE, NULL)`,
            [series]
        );

        const mails = [];
        const fetchImpl = async (url, init) => { mails.push(JSON.parse(init.body)); return { ok: true, text: async () => '' }; };
        const env = { RESEND_API_KEY: 'k' };
        const contacts = createContacts({ pool, env, fetchImpl });
        const claims = createClaims({ pool, contacts, env, fetchImpl });

        await claims.submit({ name: 'ann', email: 'Ann@Lilai.test' }, { ip: '1.1.1.1', baseUrl: 'https://lilai.test' });
        await claims.submit({ name: 'Ann Lee', email: 'ann@lilai.test' }, { ip: '1.1.1.1', baseUrl: 'https://lilai.test' });
        assert.equal(mails.length, 1); // the admin hears once; asking again updates the name
        assert.match(mails[0].subject, /Lost link: ann$/);

        const { requests } = await claims.list();
        assert.equal(requests.length, 1);
        assert.equal(requests[0].name, 'Ann Lee');
        assert.deepEqual(requests[0].matches.map(m => [m.title, m.seriesCount]), [['Run', 2]]);
        assert.deepEqual((await claims.searchEvents('hik')).map(e => e.id), ['hike']);

        await assert.rejects(claims.approve(requests[0].id, [], { admin: 'boss@lilai.test', baseUrl: '' }), { field: 'events' });
        const result = await claims.approve(requests[0].id, ['run1'], { admin: 'boss@lilai.test', baseUrl: 'https://lilai.test' });
        assert.deepEqual(result, { attached: ['Run'], mailed: true });
        const emails = await pool.query('SELECT id, host_email FROM events ORDER BY id');
        assert.deepEqual(emails.rows, [
            { id: 'hike', host_email: null },
            { id: 'run1', host_email: 'ann@lilai.test' },
            { id: 'run2', host_email: 'ann@lilai.test' }
        ]);
        assert.deepEqual(mails[1].to, ['ann@lilai.test']);
        assert.match(mails[1].text, /Your email is now on "Run"/);
        assert.match(mails[1].text, /\/me\/signin\/[A-Za-z0-9_-]{32}/);
        assert.equal(await claims.approve(requests[0].id, ['run1'], { baseUrl: '' }), null); // decided once

        await claims.submit({ name: 'Mallory', email: 'm@lilai.test' }, { ip: '2.2.2.2', baseUrl: '' });
        const open = (await claims.list()).requests[0];
        assert.equal(await claims.decline(open.id, { admin: 'boss@lilai.test' }), true);
        assert.equal(await claims.decline(open.id, {}), false);
        const { decided } = await claims.list();
        assert.deepEqual(decided.map(d => [d.name, d.decision]).sort(), [['Ann Lee', 'approved'], ['Mallory', 'declined']]);
    } finally {
        await pool.end();
    }
});
