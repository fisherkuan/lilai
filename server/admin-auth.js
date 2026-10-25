// Admin sign-in by emailed code. Only addresses in ADMIN_EMAILS (default the owner's) can
// sign in: they ask for a code, Resend mails six digits valid ten minutes, and the right
// code sets a 30-day session cookie. Codes and sessions are stored as hashes, in the
// database, so every dyno and restart sees the same ones. Guards the Donations and Places
// admin; the booking queue stays open by design.

const crypto = require('crypto');

const DEFAULT_ADMINS = 'lilai@fisherkuan.com';
const COOKIE = 'lilai_admin';
const CODE_MS = 10 * 60 * 1000;
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_TRIES = 5;
const CODES_PER_HOUR = 5;

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const normalEmail = (value) => String(value ?? '').trim().toLowerCase().slice(0, 254);

function adminEmails(env = process.env) {
    return (env.ADMIN_EMAILS || DEFAULT_ADMINS).split(',').map(normalEmail).filter(Boolean);
}

function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const name = part.slice(0, i).trim();
        try { out[name] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { /* skip a broken one */ }
    }
    return out;
}

function sessionCookie(token, { secure, maxAgeMs = SESSION_MS }) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`;
}

function buildCodeMail(to, code, env = process.env) {
    return {
        from: env.FEEDBACK_EMAIL_FROM || 'Lilai <onboarding@resend.dev>',
        to: [to],
        subject: `Lilai admin code: ${code}`,
        text: `Your Lilai admin code is ${code}.\n\nIt works for ten minutes. If you did not ask for it, ignore this email.`
    };
}

async function createAdminAuthSchema(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS admin_codes (
            email VARCHAR(254) PRIMARY KEY,
            code_hash CHAR(64) NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            tries INTEGER NOT NULL DEFAULT 0,
            sent_at TIMESTAMPTZ[] NOT NULL DEFAULT '{}'
        )`);
    await client.query(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
            token_hash CHAR(64) PRIMARY KEY,
            email VARCHAR(254) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL
        )`);
}

function createAdminAuth({ pool, env = process.env, fetchImpl = fetch, now = () => new Date(), emailOf = null }) {
    const secure = env.NODE_ENV === 'production';

    // Mails a code to an admin address. Answers the same for any address, so the form
    // never tells who is an admin; false only when a real admin's mail could not go out.
    async function sendCode(emailInput) {
        const email = normalEmail(emailInput);
        if (!adminEmails(env).includes(email)) return { sent: true };
        const at = now();
        const row = (await pool.query('SELECT sent_at FROM admin_codes WHERE email = $1', [email])).rows[0];
        const recent = (row?.sent_at || []).filter(t => at - new Date(t) < 3600 * 1000);
        if (recent.length >= CODES_PER_HOUR) return { sent: false, reason: 'Too many codes this hour. Try again later.' };
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        await pool.query(
            `INSERT INTO admin_codes (email, code_hash, expires_at, tries, sent_at) VALUES ($1, $2, $3, 0, $4)
             ON CONFLICT (email) DO UPDATE SET code_hash = $2, expires_at = $3, tries = 0, sent_at = $4`,
            [email, hash(code), new Date(at.getTime() + CODE_MS), [...recent, at]]
        );
        if (!env.RESEND_API_KEY) {
            console.error('[admin] RESEND_API_KEY is not set: no code can be emailed');
            return { sent: false, reason: 'Email is not set up on this server.' };
        }
        const res = await fetchImpl('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(buildCodeMail(email, code, env))
        });
        if (!res.ok) {
            console.error('[admin] code mail', res.status, await res.text());
            return { sent: false, reason: 'The email did not go out. Try again.' };
        }
        return { sent: true };
    }

    // A session token for the right code, else null. Five wrong tries spend the code.
    async function verifyCode(emailInput, codeInput) {
        const email = normalEmail(emailInput);
        const code = String(codeInput ?? '').replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) return null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const row = (await client.query('SELECT * FROM admin_codes WHERE email = $1 FOR UPDATE', [email])).rows[0];
            if (!row || new Date(row.expires_at) <= now() || row.tries >= MAX_TRIES) {
                await client.query('ROLLBACK');
                return null;
            }
            const right = crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hash(code)));
            if (!right) {
                await client.query('UPDATE admin_codes SET tries = tries + 1 WHERE email = $1', [email]);
                await client.query('COMMIT');
                return null;
            }
            // A code works once.
            await client.query('UPDATE admin_codes SET expires_at = $2 WHERE email = $1', [email, now()]);
            const token = crypto.randomBytes(32).toString('base64url');
            await client.query('INSERT INTO admin_sessions (token_hash, email, expires_at) VALUES ($1, $2, $3)',
                [hash(token), email, new Date(now().getTime() + SESSION_MS)]);
            await client.query('DELETE FROM admin_sessions WHERE expires_at < $1', [now()]);
            await client.query('COMMIT');
            return token;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    // The signed-in admin's email, or null. An address taken off ADMIN_EMAILS stops working.
    // A device signed in on /me (`emailOf`, the emailed link) with an admin address counts too,
    // so an admin is not asked for a code again.
    async function adminOf(req) {
        const admins = adminEmails(env);
        const token = parseCookies(req.headers.cookie)[COOKIE];
        if (token) {
            const row = (await pool.query('SELECT email FROM admin_sessions WHERE token_hash = $1 AND expires_at > $2',
                [hash(token), now()])).rows[0];
            if (row && admins.includes(row.email)) return row.email;
        }
        const email = emailOf ? await emailOf(req) : null;
        return email && admins.includes(email) ? email : null;
    }

    async function signOut(req, res) {
        const token = parseCookies(req.headers.cookie)[COOKIE];
        if (token) await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [hash(token)]);
        res.append('Set-Cookie', sessionCookie('', { secure, maxAgeMs: 0 }));
    }

    function signIn(res, token) {
        res.set('Set-Cookie', sessionCookie(token, { secure }));
    }

    // For admin APIs: 401 without a session. ADMIN_API_KEY in X-Admin-Key still works, for scripts.
    function requireAdmin(req, res, next) {
        const key = env.ADMIN_API_KEY;
        const given = req.headers['x-admin-key'];
        if (key && given && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key))) return next();
        adminOf(req).then(email => {
            if (!email) return res.status(401).json({ success: false, message: 'Sign in again.' });
            req.adminEmail = email;
            next();
        }, next);
    }

    // For admin pages: the sign-in page first, then back here.
    function requireAdminPage(req, res, next) {
        adminOf(req).then(email => {
            if (!email) return res.redirect(302, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
            next();
        }, next);
    }

    return { sendCode, verifyCode, adminOf, signIn, signOut, requireAdmin, requireAdminPage };
}

module.exports = {
    COOKIE, adminEmails, parseCookies, sessionCookie, buildCodeMail, createAdminAuthSchema, createAdminAuth
};
