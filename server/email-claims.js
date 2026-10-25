// Lost a management link, for an event made without an email: the person sends their name
// and an email from /me; the owner is mailed, matches the name to events on
// /admin/requests and approves. Approving puts the email on those events (every date of a
// series) and mails the person a Find my events sign-in link, so they get in on their own.
// Nothing is attached without the admin; a decline sends nothing.

const crypto = require('crypto');
const { normalEmail } = require('./contacts');

const MAX_NAME = 100;
const IP_TRIES_PER_HOUR = 10;
const HOUR_MS = 3600 * 1000;
const INBOX = 'lilai@fisherkuan.com';

class ClaimInputError extends Error {
    constructor(field, message) {
        super(message);
        this.field = field;
        this.status = 400;
    }
}

function validateClaim(body) {
    const name = String(body?.name ?? '').trim().slice(0, MAX_NAME);
    if (!name) throw new ClaimInputError('name', 'Add your name, as you gave it when you made the event.');
    const email = normalEmail(body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ClaimInputError('email', 'That email address does not look right.');
    return { name, email };
}

function buildAdminMail({ name, email, adminUrl }, env = process.env) {
    return {
        from: env.NOTIFY_EMAIL_FROM || env.FEEDBACK_EMAIL_FROM || 'Lilai <onboarding@resend.dev>',
        to: (env.FEEDBACK_EMAIL_TO || INBOX).split(',').map(s => s.trim()).filter(Boolean),
        subject: `[Lilai] Lost link: ${name}`,
        text: [
            `${name} lost a management link and asks to attach ${email} to their events.`,
            '',
            `Check it and approve: ${adminUrl}`
        ].join('\n')
    };
}

async function createClaimsSchema(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS email_claims (
            id UUID PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(254) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            decided_at TIMESTAMPTZ,
            decision VARCHAR(10),
            event_ids TEXT[] NOT NULL DEFAULT '{}',
            decided_by VARCHAR(254)
        )`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_email_claims_open ON email_claims(created_at) WHERE decided_at IS NULL');
}

// The admin's picks: upcoming and recent events, newest first. A series shows once.
const EVENT_COLUMNS = `DISTINCT ON (COALESCE(e.series_id::text, e.id)) e.id, e.title, e.date, e.host_name, e.series_id,
    (e.host_email IS NOT NULL) AS "hasEmail",
    (SELECT COUNT(*) FROM events s WHERE s.series_id = e.series_id)::int AS "seriesCount"`;
const EVENT_WINDOW = `e.managed AND e.cancelled_at IS NULL AND e.date >= NOW() - INTERVAL '60 days'`;

function createClaims({ pool, contacts, env = process.env, fetchImpl = fetch, now = () => new Date() }) {
    const ipTries = new Map();

    function ipAllowed(ip) {
        const at = now().getTime();
        const recent = (ipTries.get(ip) || []).filter(t => at - t < HOUR_MS);
        const allowed = recent.length < IP_TRIES_PER_HOUR;
        if (allowed) recent.push(at);
        ipTries.set(ip, recent);
        if (ipTries.size > 10000) ipTries.clear();
        return allowed;
    }

    // One open request per email: asking again updates the name.
    async function submit(body, { ip, baseUrl }) {
        const claim = validateClaim(body);
        if (!ipAllowed(ip || 'unknown')) {
            throw Object.assign(new Error('Too many requests from this network. Try again in an hour.'), { status: 429 });
        }
        const open = await pool.query('SELECT id FROM email_claims WHERE email = $1 AND decided_at IS NULL', [claim.email]);
        if (open.rows[0]) {
            await pool.query('UPDATE email_claims SET name = $2, created_at = $3 WHERE id = $1', [open.rows[0].id, claim.name, now()]);
            return;
        }
        await pool.query('INSERT INTO email_claims (id, name, email, created_at) VALUES ($1, $2, $3, $4)',
            [crypto.randomUUID(), claim.name, claim.email, now()]);
        if (!env.RESEND_API_KEY) return;
        const res = await fetchImpl('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(buildAdminMail({ ...claim, adminUrl: `${baseUrl}/admin/requests` }, env))
        }).catch(error => ({ ok: false, status: 0, text: async () => error.message }));
        if (!res.ok) console.error('[claims] admin mail', res.status, await res.text());
    }

    // Open requests, each with the events whose host name matches, then recent decisions.
    async function list() {
        const [open, decided] = await Promise.all([
            pool.query('SELECT id, name, email, created_at FROM email_claims WHERE decided_at IS NULL ORDER BY created_at'),
            pool.query(`SELECT id, name, email, decision, decided_at, cardinality(event_ids) AS "eventCount"
                        FROM email_claims WHERE decided_at IS NOT NULL ORDER BY decided_at DESC LIMIT 20`)
        ]);
        const requests = [];
        for (const claim of open.rows) {
            const matches = await pool.query(
                `SELECT * FROM (SELECT ${EVENT_COLUMNS} FROM events e
                   WHERE ${EVENT_WINDOW} AND e.host_name IS NOT NULL
                     AND (lower(e.host_name) = lower($1) OR lower(e.host_name) LIKE '%' || lower($1) || '%'
                          OR lower($1) LIKE '%' || lower(e.host_name) || '%')
                   ORDER BY COALESCE(e.series_id::text, e.id), e.date) x ORDER BY date DESC LIMIT 30`,
                [claim.name]
            );
            requests.push({ ...claim, matches: matches.rows });
        }
        return { requests, decided: decided.rows };
    }

    // Any event by title or host, for a request whose name matches nothing.
    async function searchEvents(q) {
        const text = String(q ?? '').trim().slice(0, 100);
        if (text.length < 2) return [];
        const result = await pool.query(
            `SELECT * FROM (SELECT ${EVENT_COLUMNS} FROM events e
               WHERE ${EVENT_WINDOW} AND (e.title ILIKE '%' || $1 || '%' OR e.host_name ILIKE '%' || $1 || '%')
               ORDER BY COALESCE(e.series_id::text, e.id), e.date) x ORDER BY date DESC LIMIT 20`,
            [text]
        );
        return result.rows;
    }

    /*
     * Approve: the request's email goes on each picked event and every date of its series,
     * then a sign-in link goes to the person. Answers what was attached, or null when the
     * request is gone or already decided.
     */
    async function approve(id, eventIds, { admin, baseUrl }) {
        const ids = Array.isArray(eventIds) ? eventIds.map(String).slice(0, 50) : [];
        if (!ids.length) throw new ClaimInputError('events', 'Tick at least one event.');
        const client = await pool.connect();
        let claim;
        let titles;
        try {
            await client.query('BEGIN');
            claim = (await client.query('SELECT * FROM email_claims WHERE id = $1 AND decided_at IS NULL FOR UPDATE', [id])).rows[0];
            if (!claim) {
                await client.query('ROLLBACK');
                return null;
            }
            const updated = await client.query(
                `UPDATE events SET host_email = $2
                 WHERE id = ANY($1) OR series_id IN (SELECT series_id FROM events WHERE id = ANY($1) AND series_id IS NOT NULL)
                 RETURNING id, title, series_id`,
                [ids, claim.email]
            );
            if (!updated.rows.length) throw new ClaimInputError('events', 'Those events are gone. Reload.');
            titles = [...new Set(updated.rows.map(r => r.title))];
            await client.query(
                `UPDATE email_claims SET decided_at = $2, decision = 'approved', event_ids = $3, decided_by = $4 WHERE id = $1`,
                [id, now(), updated.rows.map(r => r.id), admin || null]
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
        const mailed = await contacts.sendSignInLink(claim.email, {
            baseUrl,
            lead: `Your email is now on ${titles.length === 1 ? `"${titles[0]}"` : `${titles.length} events`} in Lilai. Open this link to see and manage them:`
        }).catch((error) => {
            console.error('[claims] sign-in mail', error.message);
            return false;
        });
        return { attached: titles, mailed };
    }

    async function decline(id, { admin }) {
        const result = await pool.query(
            `UPDATE email_claims SET decided_at = $2, decision = 'declined', decided_by = $3 WHERE id = $1 AND decided_at IS NULL RETURNING id`,
            [id, now(), admin || null]
        );
        return result.rowCount > 0;
    }

    return { submit, list, searchEvents, approve, decline };
}

module.exports = { ClaimInputError, validateClaim, buildAdminMail, createClaimsSchema, createClaims };
