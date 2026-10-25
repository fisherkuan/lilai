// Find my events: one optional email, proven by a link, is a person's way back to the events
// they host. Type an address on /me; if it made an event (events.host_email) or was confirmed
// before, Resend mails a sign-in link that works once for 30 minutes. Opening it signs that
// device in (cookie lilai_session, 90 days) and confirms the address. The signed-in device
// lists the address's events and mints fresh management links on request. "Delete my email"
// takes the address off every row and ends its sessions; names and RSVPs stay.
//
// No passwords, no profile: a "person" is only the rows whose email matches. Tokens and
// sessions are stored as SHA-256 hashes, like management links. Design: .plans/VERIFIED_CONTACT_plan.md.

const crypto = require('crypto');
const { parseCookies } = require('./admin-auth');
const hosting = require('./event-hosting');

const COOKIE = 'lilai_session';
const SIGNIN_MS = 30 * 60 * 1000;
const SESSION_MS = 90 * 24 * 3600 * 1000;
const LINKS_PER_HOUR = 3;
const IP_TRIES_PER_HOUR = 20;
const HOUR_MS = 3600 * 1000;

const normalEmail = (value) => String(value ?? '').trim().toLowerCase().slice(0, 254);
const looksLikeEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function sessionCookie(token, { secure, maxAgeMs = SESSION_MS }) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`;
}

function mailFrom(env) {
    return env.NOTIFY_EMAIL_FROM || env.FEEDBACK_EMAIL_FROM || 'Lilai <onboarding@resend.dev>';
}

function buildSignInMail(to, url, env = process.env) {
    return {
        from: mailFrom(env),
        to: [to],
        subject: 'Your Lilai sign-in link',
        text: [
            'Open this link to see the events you host on Lilai:',
            url,
            '',
            'It works once, for 30 minutes, on the device you open it on.',
            'If you did not ask for it, ignore this email.'
        ].join('\n')
    };
}

/*
 * A series shows once, as its next date still on (else its next cancelled date, else its
 * latest), with how many dates it has. Rows arrive sorted by date; so does the answer.
 */
function collapseSeries(rows, cutoff) {
    const groups = new Map();
    const out = [];
    for (const row of rows) {
        if (!row.series_id) {
            out.push({ ...row, count: 1 });
            continue;
        }
        if (!groups.has(row.series_id)) groups.set(row.series_id, []);
        groups.get(row.series_id).push(row);
    }
    for (const dates of groups.values()) {
        const ahead = dates.filter(d => new Date(d.date) >= cutoff);
        const pick = ahead.find(d => !d.cancelled_at) || ahead[0] || dates[dates.length - 1];
        out.push({ ...pick, count: dates.length });
    }
    return out.sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function createContactsSchema(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS contacts (
            email VARCHAR(254) PRIMARY KEY,
            verified_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        )`);
    await client.query(`
        CREATE TABLE IF NOT EXISTS contact_tokens (
            token_hash CHAR(64) PRIMARY KEY,
            email VARCHAR(254) NOT NULL,
            purpose VARCHAR(10) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ
        )`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_contact_tokens_email ON contact_tokens(email, created_at)');
    // The name a signed-in device fills in for RSVPs and new events. Set only through a proven
    // address: on sign-in from the latest event's host name, then by the person.
    await client.query('ALTER TABLE contacts ADD COLUMN IF NOT EXISTS name VARCHAR(100)');
    await client.query(`
        CREATE TABLE IF NOT EXISTS device_sessions (
            token_hash CHAR(64) PRIMARY KEY,
            email VARCHAR(254) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            user_agent TEXT
        )`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_device_sessions_email ON device_sessions(email)');
    // Filled by "Email me about changes" on RSVP (phase 2 of #55); read by Find my events now.
    await client.query('ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS contact_email VARCHAR(254)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsvps_contact_email ON rsvps (lower(contact_email)) WHERE contact_email IS NOT NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_events_host_email ON events (lower(host_email)) WHERE host_email IS NOT NULL');
}

function createContacts({ pool, env = process.env, fetchImpl = fetch, now = () => new Date() }) {
    const secure = env.NODE_ENV === 'production';
    // Per network, in memory: one dyno, and a restart only forgives a few tries.
    const ipTries = new Map();

    function ipAllowed(ip) {
        const at = now().getTime();
        const recent = (ipTries.get(ip) || []).filter(t => at - t < HOUR_MS);
        if (recent.length >= IP_TRIES_PER_HOUR) {
            ipTries.set(ip, recent);
            return false;
        }
        recent.push(at);
        ipTries.set(ip, recent);
        if (ipTries.size > 10000) ipTries.clear();
        return true;
    }

    // An address may sign in when it made an event or was confirmed before (and not deleted).
    async function knownAddress(email) {
        const result = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM events WHERE lower(host_email) = $1)
                 OR EXISTS (SELECT 1 FROM contacts WHERE email = $1 AND verified_at IS NOT NULL AND deleted_at IS NULL) AS known`,
            [email]
        );
        return result.rows[0].known;
    }

    /*
     * Mails a sign-in link to a known address. The answer is the same for every address, so
     * the form never tells whose address made an event. Throws a { status, message } error
     * only for what does not depend on the address: a bad address, too many tries from one
     * network, or a server without email.
     */
    async function requestSignIn(emailInput, { ip, baseUrl }) {
        const email = normalEmail(emailInput);
        if (!looksLikeEmail(email)) throw Object.assign(new Error('That email address does not look right.'), { status: 400, field: 'email' });
        if (!env.RESEND_API_KEY) {
            console.error('[contacts] RESEND_API_KEY is not set: no sign-in link can be emailed');
            throw Object.assign(new Error('Email is not set up on this server.'), { status: 503 });
        }
        if (!ipAllowed(ip || 'unknown')) {
            throw Object.assign(new Error('Too many tries from this network. Try again in an hour.'), { status: 429 });
        }
        if (!(await knownAddress(email))) return;
        const sent = await pool.query(
            'SELECT COUNT(*)::int AS n FROM contact_tokens WHERE email = $1 AND created_at > $2',
            [email, new Date(now().getTime() - HOUR_MS)]
        );
        if (sent.rows[0].n >= LINKS_PER_HOUR) return;

        const token = hosting.newToken();
        await pool.query(
            'INSERT INTO contact_tokens (token_hash, email, purpose, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)',
            [hosting.hashToken(token), email, 'signin', now(), new Date(now().getTime() + SIGNIN_MS)]
        );
        const res = await fetchImpl('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(buildSignInMail(email, `${baseUrl}/me/signin/${token}`, env))
        });
        if (!res.ok) console.error('[contacts] sign-in mail', res.status, await res.text());
    }

    // A sign-in link -> a new device session token, else null. A link works once. Opening it
    // proves the address, so the contact is confirmed (and brought back if it was deleted).
    async function redeem(tokenInput, userAgent) {
        if (!hosting.looksLikeToken(tokenInput)) return null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const used = await client.query(
                `UPDATE contact_tokens SET used_at = $2
                 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 RETURNING email`,
                [hosting.hashToken(tokenInput), now()]
            );
            const email = used.rows[0]?.email;
            if (!email) {
                await client.query('ROLLBACK');
                return null;
            }
            await client.query(
                `INSERT INTO contacts (email, verified_at) VALUES ($1, $2)
                 ON CONFLICT (email) DO UPDATE SET verified_at = COALESCE(contacts.verified_at, $2), deleted_at = NULL`,
                [email, now()]
            );
            await client.query(
                `UPDATE contacts SET name = (SELECT host_name FROM events WHERE lower(host_email) = $1 AND host_name IS NOT NULL
                                             ORDER BY created_in_app_at DESC NULLS LAST, date DESC LIMIT 1)
                 WHERE email = $1 AND name IS NULL`,
                [email]
            );
            const session = hosting.newToken();
            await client.query(
                'INSERT INTO device_sessions (token_hash, email, created_at, last_seen_at, expires_at, user_agent) VALUES ($1, $2, $3, $3, $4, $5)',
                [hosting.hashToken(session), email, now(), new Date(now().getTime() + SESSION_MS), String(userAgent || '').slice(0, 500) || null]
            );
            await client.query('DELETE FROM device_sessions WHERE expires_at < $1', [now()]);
            await client.query('DELETE FROM contact_tokens WHERE expires_at < $1', [new Date(now().getTime() - 24 * HOUR_MS)]);
            await client.query('COMMIT');
            return { email, session };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    // The signed-in device's email, or null.
    async function emailOf(req) {
        const token = parseCookies(req.headers.cookie)[COOKIE];
        if (!hosting.looksLikeToken(token)) return null;
        const result = await pool.query(
            'UPDATE device_sessions SET last_seen_at = $2 WHERE token_hash = $1 AND expires_at > $2 RETURNING email',
            [hosting.hashToken(token), now()]
        );
        return result.rows[0]?.email || null;
    }

    function signIn(res, session) {
        res.set('Set-Cookie', sessionCookie(session, { secure }));
    }

    async function signOut(req, res) {
        const token = parseCookies(req.headers.cookie)[COOKIE];
        if (hosting.looksLikeToken(token)) await pool.query('DELETE FROM device_sessions WHERE token_hash = $1', [hosting.hashToken(token)]);
        res.set('Set-Cookie', sessionCookie('', { secure, maxAgeMs: 0 }));
    }

    // What a signed-in device fills in: { email, name }.
    async function profileOf(email) {
        const row = (await pool.query('SELECT name FROM contacts WHERE email = $1', [email])).rows[0];
        return { email, name: row?.name || '' };
    }

    // An empty name clears it.
    async function setName(email, nameInput) {
        const name = String(nameInput ?? '').trim().slice(0, 100) || null;
        await pool.query('UPDATE contacts SET name = $2 WHERE email = $1', [email, name]);
        return name || '';
    }

    // Every event the address hosts (upcoming, and the last year's past ones) and every
    // upcoming one it joined with that address. Series show once.
    async function eventsOf(email) {
        const at = now();
        const counts = `(SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.attendance = 'yes')::int AS "attendingCount",
                        (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.attendance = 'pending')::int AS "pendingCount"`;
        const [hosted, joined] = await Promise.all([
            pool.query(
                `SELECT e.id, e.title, e.date, e.location, e.attendance_limit, e.series_id, e.source, e.managed, e.cancelled_at, ${counts}
                 FROM events e
                 WHERE lower(e.host_email) = $1 AND e.date >= $2::timestamptz - INTERVAL '1 year'
                 ORDER BY e.date LIMIT 500`,
                [email, at]
            ),
            pool.query(
                `SELECT DISTINCT ON (e.id) e.id, e.title, e.date, e.location, e.attendance_limit, e.series_id, e.source, r.attendance, ${counts}
                 FROM rsvps r JOIN events e ON e.id = r.event_id
                 WHERE lower(r.contact_email) = $1 AND e.cancelled_at IS NULL AND e.date >= $2::timestamptz - INTERVAL '12 hours'
                   AND r.attendance IN ('yes', 'pending', 'waiting')
                 ORDER BY e.id, r.timestamp DESC`,
                [email, at]
            )
        ]);
        const cutoff = new Date(at.getTime() - 12 * HOUR_MS);
        const all = collapseSeries(hosted.rows, cutoff).map(e => ({ ...e, cancelled: Boolean(e.cancelled_at) }));
        const isUpcoming = (e) => new Date(e.date) >= cutoff;
        return {
            upcoming: all.filter(isUpcoming),
            past: all.filter(e => !isUpcoming(e)).reverse().slice(0, 20),
            joined: joined.rows.sort((a, b) => new Date(a.date) - new Date(b.date))
        };
    }

    // A fresh management link for an event the address hosts (a series: one for every date).
    async function manageLink(email, eventId) {
        const event = (await pool.query(
            'SELECT id, series_id FROM events WHERE id = $1 AND lower(host_email) = $2',
            [eventId, email]
        )).rows[0];
        if (!event) return null;
        const token = hosting.newToken();
        await pool.query(
            'INSERT INTO event_host_links (id, token_hash, event_id, series_id, created_via) VALUES ($1, $2, $3, $4, $5)',
            [crypto.randomUUID(), hosting.hashToken(token), event.series_id ? null : event.id, event.series_id, 'email']
        );
        return `/host/${token}`;
    }

    // Delete my email: off every event and RSVP, every session and link ended. Names stay.
    async function forget(email) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE events SET host_email = NULL WHERE lower(host_email) = $1', [email]);
            await client.query('UPDATE rsvps SET contact_email = NULL WHERE lower(contact_email) = $1', [email]);
            await client.query('DELETE FROM device_sessions WHERE email = $1', [email]);
            await client.query('DELETE FROM contact_tokens WHERE email = $1', [email]);
            await client.query(
                `INSERT INTO contacts (email, deleted_at) VALUES ($1, $2)
                 ON CONFLICT (email) DO UPDATE SET verified_at = NULL, deleted_at = $2, name = NULL`,
                [email, now()]
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    return { requestSignIn, redeem, emailOf, signIn, signOut, profileOf, setName, eventsOf, manageLink, forget };
}

module.exports = {
    COOKIE, normalEmail, sessionCookie, buildSignInMail, collapseSeries, createContactsSchema, createContacts
};
