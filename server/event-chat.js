// Chat in an event (#56): one thread per event, for "running 10 min late" and "court 3".
//
// Reading and liking are open to anyone, like the guest list. Posting needs a signed-in email
// (Find my events' lilai_session, server/contacts.js), so nobody can post under another
// person's name without leaving their own address behind, and a host's messages carry a Host
// mark only when the address is the event's own. A message's author edits or removes it; the
// host removes any message from the management page. A like belongs to a device (a random key
// it keeps), stored as a hash, one per message.
//
// Messages are kept until 180 days after the event, then deleted with their likes.

const crypto = require('crypto');

const MAX_BODY = 1000;
const MAX_NAME = 60;
const KEEP_DAYS = 180;
const MINUTE_MS = 60 * 1000;
const POSTS_PER_MINUTE = 10;      // per address
const IP_POSTS_PER_MINUTE = 30;   // per network
const IP_LIKES_PER_MINUTE = 120;

class ChatError extends Error {
    constructor(status, message, field) {
        super(message);
        this.status = status;
        this.field = field;
    }
}

function validateBody(value) {
    const body = String(value ?? '').replace(/\r\n?/g, '\n').trim();
    if (!body) throw new ChatError(400, 'Write a message first.', 'body');
    if (body.length > MAX_BODY) throw new ChatError(400, `Keep it under ${MAX_BODY} characters.`, 'body');
    return body;
}

function validateName(value) {
    const name = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!name) throw new ChatError(400, 'Type your name, so people know who wrote.', 'name');
    if (name.length > MAX_NAME) throw new ChatError(400, `Keep your name under ${MAX_NAME} characters.`, 'name');
    return name;
}

// A device's like key: 16 to 64 letters, digits or dashes, made by the browser.
function likerHash(key) {
    const text = String(key ?? '');
    if (!/^[A-Za-z0-9-]{16,64}$/.test(text)) return null;
    return crypto.createHash('sha256').update(`liker:${text}`).digest('hex');
}

// What anyone may see of a message. The author's address never leaves the server.
function publicMessage(row, { email = null, hostEmail = null } = {}) {
    const author = row.author_email || null;
    return {
        id: row.id,
        eventId: row.event_id,
        name: row.author_name,
        body: row.body,
        at: row.created_at,
        editedAt: row.edited_at || null,
        likes: Number(row.likes || 0),
        liked: Boolean(row.liked),
        host: Boolean(author && hostEmail && author === String(hostEmail).toLowerCase()),
        mine: Boolean(author && email && author === email)
    };
}

async function createChatSchema(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS event_messages (
            id UUID PRIMARY KEY,
            event_id VARCHAR(255) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            author_email VARCHAR(254),
            author_name VARCHAR(${MAX_NAME}) NOT NULL,
            body TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            edited_at TIMESTAMPTZ
        )`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_event_messages_event ON event_messages(event_id, created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_event_messages_author ON event_messages(author_email) WHERE author_email IS NOT NULL');
    await client.query(`
        CREATE TABLE IF NOT EXISTS event_message_likes (
            message_id UUID NOT NULL REFERENCES event_messages(id) ON DELETE CASCADE,
            liker_hash CHAR(64) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (message_id, liker_hash)
        )`);
    // The name a signed-in address last posted under, offered the next time.
    await client.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS chat_name VARCHAR(${MAX_NAME})`);
}

function createEventChat({ pool, now = () => new Date() }) {
    // Per address and per network, in memory: one dyno, and a restart forgives a minute.
    const tries = new Map();

    function allowed(key, limit) {
        const at = now().getTime();
        const recent = (tries.get(key) || []).filter(t => at - t < MINUTE_MS);
        if (recent.length >= limit) {
            tries.set(key, recent);
            return false;
        }
        recent.push(at);
        tries.set(key, recent);
        if (tries.size > 20000) tries.clear();
        return true;
    }

    // A thread exists while its event does and is not cancelled.
    async function openEvent(db, eventId) {
        const event = (await db.query(
            'SELECT id, host_email FROM events WHERE id = $1 AND cancelled_at IS NULL',
            [String(eventId ?? '')]
        )).rows[0];
        if (!event) throw new ChatError(404, 'This event is not on Lilai any more.');
        return event;
    }

    const SELECT = `SELECT m.*,
            (SELECT COUNT(*) FROM event_message_likes l WHERE l.message_id = m.id)::int AS likes,
            EXISTS (SELECT 1 FROM event_message_likes l WHERE l.message_id = m.id AND l.liker_hash = $2) AS liked
        FROM event_messages m`;

    async function one(db, id, { email, hostEmail, liker = null }) {
        const row = (await db.query(`${SELECT} WHERE m.id = $1`, [id, liker])).rows[0];
        return row ? publicMessage(row, { email, hostEmail }) : null;
    }

    async function count(eventId, db = pool) {
        const result = await db.query('SELECT COUNT(*)::int AS n FROM event_messages WHERE event_id = $1', [eventId]);
        return result.rows[0].n;
    }

    // The thread, oldest first, and who this device is when it is signed in.
    async function list(eventId, { email = null, likerKey = null } = {}) {
        const event = await openEvent(pool, eventId);
        const rows = await pool.query(
            `${SELECT} WHERE m.event_id = $1 ORDER BY m.created_at, m.id LIMIT 500`,
            [event.id, likerHash(likerKey)]
        );
        let me = null;
        if (email) {
            // The name last posted under, else the one this address fills in for RSVPs.
            const contact = (await pool.query('SELECT chat_name, name FROM contacts WHERE email = $1', [email])).rows[0];
            const name = contact?.chat_name || String(contact?.name || '').slice(0, MAX_NAME);
            me = { email, name, host: email === String(event.host_email || '').toLowerCase() };
        }
        return { messages: rows.rows.map(r => publicMessage(r, { email, hostEmail: event.host_email })), me };
    }

    async function post(eventId, email, input, { ip } = {}) {
        if (!email) throw new ChatError(401, 'Sign in with your email to post.');
        const body = validateBody(input?.body);
        const name = validateName(input?.name);
        if (!allowed(`post:${email}`, POSTS_PER_MINUTE) || !allowed(`ip:${ip || 'unknown'}`, IP_POSTS_PER_MINUTE)) {
            throw new ChatError(429, 'That is a lot of messages. Wait a minute and try again.');
        }
        const event = await openEvent(pool, eventId);
        const id = crypto.randomUUID();
        await pool.query(
            'INSERT INTO event_messages (id, event_id, author_email, author_name, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
            [id, event.id, email, name, body, now()]
        );
        await pool.query(
            `INSERT INTO contacts (email, chat_name) VALUES ($1, $2)
             ON CONFLICT (email) DO UPDATE SET chat_name = $2`,
            [email, name]
        );
        return { message: await one(pool, id, { email, hostEmail: event.host_email }), count: await count(event.id) };
    }

    // The author's own message in this event, else a 404 that names nothing about it.
    async function ownMessage(eventId, id, email) {
        if (!email) throw new ChatError(401, 'Sign in with your email to change your messages.');
        const event = await openEvent(pool, eventId);
        const row = (await pool.query(
            'SELECT id, author_email FROM event_messages WHERE id = $1::uuid AND event_id = $2',
            [validId(id), event.id]
        )).rows[0];
        if (!row) throw new ChatError(404, 'That message is gone.');
        if (row.author_email !== email) throw new ChatError(403, 'Only the person who wrote a message can change it.');
        return event;
    }

    function validId(id) {
        const text = String(id ?? '');
        if (!/^[0-9a-f-]{36}$/i.test(text)) throw new ChatError(404, 'That message is gone.');
        return text;
    }

    async function edit(eventId, id, email, input) {
        const body = validateBody(input?.body);
        const event = await ownMessage(eventId, id, email);
        await pool.query('UPDATE event_messages SET body = $2, edited_at = $3 WHERE id = $1 AND body <> $2', [id, body, now()]);
        return { message: await one(pool, id, { email, hostEmail: event.host_email }) };
    }

    async function remove(eventId, id, email) {
        const event = await ownMessage(eventId, id, email);
        await pool.query('DELETE FROM event_messages WHERE id = $1', [id]);
        return { id, count: await count(event.id) };
    }

    // From the management page: any message of the event the link manages. Allowed on a
    // cancelled event too, so a host can still clean up.
    async function hostRemove(eventId, id) {
        const done = await pool.query('DELETE FROM event_messages WHERE id = $1::uuid AND event_id = $2 RETURNING id', [validId(id), eventId]);
        if (!done.rows[0]) throw new ChatError(404, 'That message is gone.');
        return { id, count: await count(eventId) };
    }

    // The management page's view of the thread: newest last, with the names, never addresses.
    async function forHost(event) {
        const rows = await pool.query(
            `${SELECT} WHERE m.event_id = $1 ORDER BY m.created_at, m.id LIMIT 500`,
            [event.id, null]
        );
        return rows.rows.map(r => publicMessage(r, { hostEmail: event.host_email }));
    }

    async function like(eventId, id, likerKey, on, { ip } = {}) {
        const liker = likerHash(likerKey);
        if (!liker) throw new ChatError(400, 'This browser cannot like messages. Reload and try again.');
        if (!allowed(`like:${ip || 'unknown'}`, IP_LIKES_PER_MINUTE)) {
            throw new ChatError(429, 'Too many likes from this network. Wait a minute.');
        }
        const event = await openEvent(pool, eventId);
        const found = (await pool.query('SELECT id FROM event_messages WHERE id = $1::uuid AND event_id = $2', [validId(id), event.id])).rows[0];
        if (!found) throw new ChatError(404, 'That message is gone.');
        if (on) {
            await pool.query(
                'INSERT INTO event_message_likes (message_id, liker_hash, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                [id, liker, now()]
            );
        } else {
            await pool.query('DELETE FROM event_message_likes WHERE message_id = $1 AND liker_hash = $2', [id, liker]);
        }
        const likes = (await pool.query('SELECT COUNT(*)::int AS n FROM event_message_likes WHERE message_id = $1', [id])).rows[0].n;
        return { id, likes, liked: Boolean(on) };
    }

    // Delete my email: messages keep their name and text, and nobody can change them any more.
    async function forget(email) {
        await pool.query('UPDATE event_messages SET author_email = NULL WHERE author_email = $1', [email]);
        await pool.query('UPDATE contacts SET chat_name = NULL WHERE email = $1', [email]);
    }

    // Threads end KEEP_DAYS after their event.
    async function expire() {
        const done = await pool.query(
            `DELETE FROM event_messages m USING events e
             WHERE e.id = m.event_id AND e.date < $1::timestamptz - make_interval(days => $2)`,
            [now(), KEEP_DAYS]
        );
        return done.rowCount;
    }

    return { list, post, edit, remove, hostRemove, forHost, like, count, forget, expire };
}

module.exports = {
    ChatError, MAX_BODY, MAX_NAME, KEEP_DAYS,
    validateBody, validateName, likerHash, publicMessage, createChatSchema, createEventChat
};
