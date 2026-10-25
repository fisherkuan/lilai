/*
 * Chat in an event (#56). The pure helpers always run; the thread itself (post, edit, delete,
 * like, host removal, expiry, a chat sign-in for an address that made nothing) needs a scratch
 * PostgreSQL (TEST_DATABASE_URL, see booking-quota.integration.test.js) and is skipped without one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const chatLib = require('../server/event-chat');
const { createContactsSchema, createContacts, safeNext, signInUrl } = require('../server/contacts');
const hosting = require('../server/event-hosting');
const { stampText, groupStarts } = require('../public/js/event-chat');

test('a message is 1 to 1000 characters, trimmed', () => {
    assert.equal(chatLib.validateBody('  court 3 \r\n'), 'court 3');
    assert.throws(() => chatLib.validateBody('   '), { status: 400, field: 'body' });
    assert.throws(() => chatLib.validateBody('x'.repeat(1001)), { status: 400 });
    assert.equal(chatLib.validateName('  Ann   Lee '), 'Ann Lee');
    assert.throws(() => chatLib.validateName(''), { field: 'name' });
});

test('a like key is the browser\'s random key, stored only as a hash', () => {
    const key = '3f2a9c1e-7b44-4d1a-9a0e-5c6b7d8e9f00';
    assert.match(chatLib.likerHash(key), /^[0-9a-f]{64}$/);
    assert.equal(chatLib.likerHash(key), chatLib.likerHash(key));
    assert.equal(chatLib.likerHash('short'), null);
    assert.equal(chatLib.likerHash('<script>alert(1)</script>xxxxxxxx'), null);
});

test('the public message never carries the address; Host and mine come from it', () => {
    const row = { id: 'm', event_id: 'e', author_email: 'ann@lilai.test', author_name: 'Ann', body: 'hi', created_at: 'now', likes: '2' };
    const seen = chatLib.publicMessage(row, { email: 'ann@lilai.test', hostEmail: 'Ann@Lilai.test' });
    assert.equal(seen.host, true);
    assert.equal(seen.mine, true);
    assert.equal(seen.likes, 2);
    assert.equal(JSON.stringify(seen).includes('@'), false);
    assert.equal(chatLib.publicMessage(row, { email: 'bob@lilai.test', hostEmail: 'bob@lilai.test' }).host, false);
});

test('a chat sign-in link returns only to a path on Lilai', () => {
    assert.equal(safeNext('/#chat-cal-1%40google.com'), '/#chat-cal-1%40google.com');
    assert.equal(safeNext('//evil.test'), '');
    assert.equal(safeNext('/\\evil.test'), '');
    assert.equal(safeNext('https://evil.test'), '');
    assert.equal(signInUrl('https://lilai.test', 'tok', '/#chat-e1'), 'https://lilai.test/me/signin/tok?next=%2F%23chat-e1');
    assert.equal(signInUrl('https://lilai.test', 'tok', ''), 'https://lilai.test/me/signin/tok');
});

test('a run from one person within five minutes shows their name once', () => {
    const at = (min) => new Date(Date.UTC(2026, 9, 25, 18, min)).toISOString();
    const messages = [
        { name: 'Ann', mine: false, host: true, at: at(0) },
        { name: 'Ann', mine: false, host: true, at: at(3) },
        { name: 'Bob', mine: true, host: false, at: at(4) },
        { name: 'Bob', mine: true, host: false, at: at(20) }
    ];
    assert.deepEqual(groupStarts(messages), [true, false, true, true]);
    const now = new Date(at(30));
    assert.match(stampText(at(3), now), /^\d\d:\d\d$/);
    assert.match(stampText('2026-10-01T10:00:00Z', now), /, \d\d:\d\d$/);
});

const CONNECTION = process.env.TEST_DATABASE_URL;
const scratch = CONNECTION && /test|scratch|local/i.test(new URL(CONNECTION).pathname);

test('two people chat in an event, edit and delete their own, like, and the host removes one', { skip: !scratch && 'no TEST_DATABASE_URL' }, async () => {
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
            await chatLib.createChatSchema(client);
        } finally {
            client.release();
        }
        await pool.query('TRUNCATE event_message_likes, event_messages, contacts, contact_tokens, device_sessions, event_host_links, rsvps, events CASCADE');
        const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000);
        const old = new Date(Date.now() - 200 * 24 * 3600 * 1000);
        await pool.query(
            `INSERT INTO events (id, title, date, host_name, host_email, managed, cancelled_at) VALUES
             ('e1', 'Badminton', $1, 'Ann', 'Ann@Lilai.test', TRUE, NULL),
             ('gone', 'Hike', $1, 'Bob', 'bob@lilai.test', TRUE, NOW()),
             ('old', 'Spring run', $2, 'Bob', 'bob@lilai.test', TRUE, NULL)`,
            [soon, old]
        );

        // A chat sign-in reaches an address that never made an event, and comes back to the thread.
        const mails = [];
        const fetchImpl = async (url, init) => { mails.push(JSON.parse(init.body)); return { ok: true, text: async () => '' }; };
        const contacts = createContacts({ pool, env: { RESEND_API_KEY: 'k' }, fetchImpl });
        await contacts.requestSignIn('cleo@lilai.test', { ip: '1.1.1.1', baseUrl: 'https://lilai.test' });
        assert.equal(mails.length, 0); // Find my events still mails only known addresses
        await contacts.requestSignIn('cleo@lilai.test', { ip: '1.1.1.1', baseUrl: 'https://lilai.test', anyAddress: true, next: '/#chat-e1' });
        assert.equal(mails.length, 1);
        assert.match(mails[0].text, /event chat/);
        assert.match(mails[0].text, /\/me\/signin\/[A-Za-z0-9_-]{32}\?next=%2F%23chat-e1/);

        const chat = chatLib.createEventChat({ pool });
        const ann = 'ann@lilai.test';
        const cleo = 'cleo@lilai.test';
        const annLiker = 'aaaaaaaaaaaaaaaaaaaaaaaa';
        const bobLiker = 'bbbbbbbbbbbbbbbbbbbbbbbb';

        await assert.rejects(chat.post('e1', null, { body: 'hi', name: 'Ann' }), { status: 401 });
        await assert.rejects(chat.post('gone', ann, { body: 'hi', name: 'Ann' }), { status: 404 });

        const first = await chat.post('e1', ann, { body: 'Running 10 min late', name: 'Ann' });
        assert.equal(first.count, 1);
        assert.equal(first.message.host, true);
        assert.equal(first.message.mine, true);
        const second = await chat.post('e1', cleo, { body: 'Who brings the ball?', name: 'Cleo' });
        assert.equal(second.count, 2);
        assert.equal(second.message.host, false);

        // Someone not signed in reads it all, without anyone's address.
        const open = await chat.list('e1', {});
        assert.equal(open.me, null);
        assert.deepEqual(open.messages.map(m => [m.name, m.mine]), [['Ann', false], ['Cleo', false]]);
        assert.equal(JSON.stringify(open).includes('@'), false);
        const asCleo = await chat.list('e1', { email: cleo });
        assert.deepEqual(asCleo.me, { email: cleo, name: 'Cleo', host: false });
        assert.deepEqual(asCleo.messages.map(m => m.mine), [false, true]);

        // Only the author edits or deletes.
        await assert.rejects(chat.edit('e1', first.message.id, cleo, { body: 'hacked' }), { status: 403 });
        await assert.rejects(chat.remove('e1', first.message.id, cleo), { status: 403 });
        const edited = await chat.edit('e1', second.message.id, cleo, { body: 'Who brings the shuttles?' });
        assert.equal(edited.message.body, 'Who brings the shuttles?');
        assert.ok(edited.message.editedAt);

        // Anyone likes, once per device; a second like from the same device changes nothing.
        assert.equal((await chat.like('e1', first.message.id, annLiker, true)).likes, 1);
        assert.equal((await chat.like('e1', first.message.id, annLiker, true)).likes, 1);
        assert.equal((await chat.like('e1', first.message.id, bobLiker, true)).likes, 2);
        assert.equal((await chat.like('e1', first.message.id, annLiker, false)).likes, 1);
        const liked = await chat.list('e1', { likerKey: bobLiker });
        assert.deepEqual(liked.messages.map(m => [m.likes, m.liked]), [[1, true], [0, false]]);
        await assert.rejects(chat.like('e1', first.message.id, 'bad', true), { status: 400 });

        // The host removes any message; the author removes their own.
        assert.equal((await chat.hostRemove('e1', second.message.id)).count, 1);
        await assert.rejects(chat.hostRemove('e1', second.message.id), { status: 404 });
        assert.equal((await chat.remove('e1', first.message.id, ann)).count, 0);

        // Delete my email: the message stays under its name, and nobody can change it any more.
        const kept = await chat.post('e1', cleo, { body: 'See you there', name: 'Cleo' });
        await chat.forget(cleo);
        await assert.rejects(chat.edit('e1', kept.message.id, cleo, { body: 'x' }), { status: 403 });
        assert.equal((await chat.list('e1', {})).messages[0].name, 'Cleo');

        // A thread ends 180 days after its event.
        await pool.query(`INSERT INTO event_messages (id, event_id, author_name, body) VALUES (gen_random_uuid(), 'old', 'Bob', 'great run')`);
        assert.equal(await chat.expire(), 1);
        assert.equal(await chat.count('e1'), 1);
    } finally {
        await pool.end();
    }
});

test('one address posts ten messages a minute', { skip: !scratch && 'no TEST_DATABASE_URL' }, async () => {
    const pool = new Pool({ connectionString: CONNECTION });
    try {
        await pool.query('TRUNCATE event_messages CASCADE');
        const chat = chatLib.createEventChat({ pool });
        for (let i = 0; i < 10; i++) await chat.post('e1', 'dan@lilai.test', { body: `m${i}`, name: 'Dan' }, { ip: '2.2.2.2' });
        await assert.rejects(chat.post('e1', 'dan@lilai.test', { body: 'one more', name: 'Dan' }, { ip: '2.2.2.2' }), { status: 429 });
    } finally {
        await pool.end();
    }
});
