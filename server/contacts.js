// Sign-in: one email, proven by a link, is a person's way back to the events they host and
// what they post under. Type an address on /me and Resend mails a sign-in link and a six-digit
// code, both good for 30 minutes. Opening the link, or typing the code where it was asked for,
// signs that device in. The code is for an iPhone home-screen app: Mail opens links in Safari,
// whose cookies the app does not share. Signing in sets the cookie lilai_session (90 days)
// and confirms the address. The signed-in device lists the address's events and mints fresh management links on request. "Delete my email"
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
const CODE_TRIES = 5;
const HOUR_MS = 3600 * 1000;

const normalEmail = (value) => String(value ?? '').trim().toLowerCase().slice(0, 254);
const looksLikeEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function sessionCookie(token, { secure, maxAgeMs = SESSION_MS }) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`;
}

// Where a chat sign-in link lands afterwards: a path on Lilai, never another site.
function safeNext(next) {
    const text = String(next || '');
    return /^\/(?![\/\\])/.test(text) ? text.slice(0, 300) : '';
}

function signInUrl(baseUrl, token, next) {
    return `${baseUrl}/me/signin/${token}${next ? `?next=${encodeURIComponent(next)}` : ''}`;
}

function mailFrom(env) {
    return env.NOTIFY_EMAIL_FROM || env.FEEDBACK_EMAIL_FROM || 'Lilai <onboarding@resend.dev>';
}

const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const hashCode = (email, code) => crypto.createHash('sha256').update(`${email}:${code}`).digest('hex');

function buildSignInMail(to, url, code, env = process.env, { purpose = 'signin' } = {}) {
    return {
        from: mailFrom(env),
        to: [to],
        subject: `${code} is your Lilai sign-in code`,
        // The code first, as its own line: Gmail and iOS Mail offer to copy or fill it. The link
        // is the fallback.
        html: [
            `<p>${purpose === 'chat' ? 'Your code to post in an event chat on Lilai:' : 'Your Lilai sign-in code:'}</p>`,
            `<p style="font-size:28px;font-weight:600;letter-spacing:4px;font-family:monospace">${code}</p>`,
            '<p>Type it where Lilai asked for it. It works for 30 minutes.</p>',
            `<p>Or open this link on the device you want to sign in on:<br><a href="${url}">${url}</a></p>`,
            '<p>If you did not ask for it, ignore this email.</p>'
        ].join('\n'),
        text: [
            purpose === 'chat' ? 'Your code to post in an event chat on Lilai:' : 'Your Lilai sign-in code:',
            '',
            code,
            '',
            'Type it where Lilai asked for it. It works for 30 minutes.',
            '',
            'Or open this link on the device you want to sign in on:',
            url,
            '',
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
    // The six-digit code mailed with the link; five wrong tries spend it.
    await client.query('ALTER TABLE contact_tokens ADD COLUMN IF NOT EXISTS code_hash CHAR(64)');
    await client.query('ALTER TABLE contact_tokens ADD COLUMN IF NOT EXISTS code_tries INT NOT NULL DEFAULT 0');
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
    // Filled by "Email me about changes" on RSVP (phase 2 of #55); read by the sign-in page now.
    await client.query('ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS contact_email VARCHAR(254)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rsvps_contact_email ON rsvps (lower(contact_email)) WHERE contact_email IS NOT NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_events_host_email ON events (lower(host_email)) WHERE host_email IS NOT NULL');
}

function createContacts({ pool, env = process.env, fetchImpl = fetch, now = () => new Date(), onRename = null }) {
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

    /*
     * Mails a sign-in link to any address: opening it proves the address, which is all a
     * session needs. Throws a { status, message } error for a bad address, too many tries from
     * one network, or a server without email. `next` takes the person back where they came
     * from (an event's chat).
     */
    async function requestSignIn(emailInput, { ip, baseUrl, next = '' }) {
        const email = normalEmail(emailInput);
        if (!looksLikeEmail(email)) throw Object.assign(new Error('That email address does not look right.'), { status: 400, field: 'email' });
        if (!env.RESEND_API_KEY) {
            console.error('[contacts] RESEND_API_KEY is not set: no sign-in link can be emailed');
            throw Object.assign(new Error('Email is not set up on this server.'), { status: 503 });
        }
        if (!ipAllowed(ip || 'unknown')) {
            throw Object.assign(new Error('Too many tries from this network. Try again in an hour.'), { status: 429 });
        }
        const sent = await pool.query(
            'SELECT COUNT(*)::int AS n FROM contact_tokens WHERE email = $1 AND created_at > $2',
            [email, new Date(now().getTime() - HOUR_MS)]
        );
        if (sent.rows[0].n >= LINKS_PER_HOUR) return;

        const back = safeNext(next);
        const token = hosting.newToken();
        const code = newCode();
        await pool.query(
            'INSERT INTO contact_tokens (token_hash, email, purpose, created_at, expires_at, code_hash) VALUES ($1, $2, $3, $4, $5, $6)',
            [hosting.hashToken(token), email, 'signin', now(), new Date(now().getTime() + SIGNIN_MS), hashCode(email, code)]
        );
        const res = await fetchImpl('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(buildSignInMail(email, signInUrl(baseUrl, token, back), code, env, { purpose: back.startsWith('/#chat-') ? 'chat' : 'signin' }))
        });
        if (!res.ok) console.error('[contacts] sign-in mail', res.status, await res.text());
    }

    // A sign-in link -> a new device session token, else null. A link works any number of
    // times until it runs out (30 minutes): mail scanners open links first. Opening it proves the address, so the contact is confirmed (and brought back if it was deleted).
    async function redeem(tokenInput, userAgent) {
        if (!hosting.looksLikeToken(tokenInput)) return null;
        return startSession(userAgent, (client) => client.query(
            `UPDATE contact_tokens SET used_at = COALESCE(used_at, $2)
             WHERE token_hash = $1 AND expires_at > $2 RETURNING email`,
            [hosting.hashToken(tokenInput), now()]
        ));
    }

    // The emailed code, typed with its address -> a new device session token, else null. Any
    // of the address's codes still running counts; a wrong one costs each of them a try, and
    // five wrong tries spend a code.
    async function redeemCode(emailInput, codeInput, userAgent) {
        const email = normalEmail(emailInput);
        const code = String(codeInput ?? '').replace(/\s/g, '');
        if (!looksLikeEmail(email) || !/^\d{6}$/.test(code)) return null;
        const signedIn = await startSession(userAgent, (client) => client.query(
            `UPDATE contact_tokens SET used_at = COALESCE(used_at, $3)
             WHERE email = $1 AND code_hash = $2 AND expires_at > $3 AND code_tries < $4 RETURNING email`,
            [email, hashCode(email, code), now(), CODE_TRIES]
        ));
        if (!signedIn) {
            await pool.query(
                'UPDATE contact_tokens SET code_tries = code_tries + 1 WHERE email = $1 AND expires_at > $2 AND code_hash IS NOT NULL',
                [email, now()]
            );
        }
        return signedIn;
    }

    // Opening a link or typing a code proves the address: `claim` marks it used and answers its
    // email, and the contact is confirmed (and brought back if it was deleted).
    async function startSession(userAgent, claim) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const used = await claim(client);
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
        res.append('Set-Cookie', sessionCookie('', { secure, maxAgeMs: 0 }));
    }

    // What a signed-in device fills in: { email, name }.
    async function profileOf(email) {
        const row = (await pool.query('SELECT name FROM contacts WHERE email = $1', [email])).rows[0];
        return { email, name: row?.name || '' };
    }

    /*
     * The address's one name: filled in for RSVPs and new events, and what its chat messages
     * show. An empty name clears it. `onRename(client, email, name)` (server/event-chat.js)
     * renames what the address wrote, in the same transaction, and answers the events that
     * changed: { name, renamedIn }.
     */
    async function setName(email, nameInput) {
        const name = String(nameInput ?? '').replace(/\s+/g, ' ').trim().slice(0, 100) || null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT 1 FROM contacts WHERE email = $1 FOR UPDATE', [email]);
            await client.query('UPDATE contacts SET name = $2 WHERE email = $1', [email, name]);
            const renamedIn = onRename ? await onRename(client, email, name) : [];
            await client.query('COMMIT');
            return { name: name || '', renamedIn };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
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
    // An admin (anyEvent) gets one for any event Lilai owns, as a silent co-host: the link is
    // marked 'admin' and nothing on the event names them.
    async function manageLink(email, eventId, { anyEvent = false } = {}) {
        const event = (await pool.query(
            anyEvent
                ? 'SELECT id, series_id FROM events WHERE id = $1 AND managed'
                : 'SELECT id, series_id FROM events WHERE id = $1 AND lower(host_email) = $2',
            anyEvent ? [eventId] : [eventId, email]
        )).rows[0];
        if (!event) return null;
        const token = hosting.newToken();
        await pool.query(
            'INSERT INTO event_host_links (id, token_hash, event_id, series_id, created_via) VALUES ($1, $2, $3, $4, $5)',
            [crypto.randomUUID(), hosting.hashToken(token), event.series_id ? null : event.id, event.series_id, anyEvent ? 'admin' : 'email']
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

    return { requestSignIn, redeem, redeemCode, emailOf, signIn, signOut, profileOf, setName, eventsOf, manageLink, forget };
}

module.exports = {
    COOKIE, normalEmail, sessionCookie, buildSignInMail, signInUrl, safeNext, collapseSeries, createContactsSchema, createContacts
};
