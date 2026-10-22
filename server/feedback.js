// Feedback from the footer's "Send feedback" sheet, ported from splitly's form.
// POST /api/feedback saves the message to the feedback table, then emails it through
// Resend when RESEND_API_KEY is set. Attachments travel in the email only: Heroku's disk
// is wiped on every restart, so the table keeps their names, not their bytes.
//
// Lilai has no accounts, so a sender is anonymous unless they leave an email address,
// which becomes the email's Reply-To.

const MAX_MESSAGE = 10000;
const MAX_FILES = 5;
// Total, not per file: the files arrive base64 in one JSON body, which costs 4/3 the size.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BODY_LIMIT = '15mb';

// Lilai's own address; the subject still names the app, so forwarded mail stays sorted.
const INBOX = 'lilai@fisherkuan.com';
const DEFAULT_FROM = 'Lilai <onboarding@resend.dev>';

class FeedbackInputError extends Error {
    constructor(code, status) {
        super(code);
        this.code = code;
        this.status = status;
    }
}

// Keeps a file name readable in the email without control characters or a path.
function safeName(name) {
    return String(name || '').replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
}

// Loose on purpose: the address is only a Reply-To, so a typo costs the sender a reply,
// not the team a message.
function readEmail(value) {
    const email = String(value || '').trim().slice(0, 254);
    if (!email) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new FeedbackInputError('bad_email', 400);
    return email;
}

// Body: { message, email?, page?, files?: [{ name, type, data: base64 }] }.
function validateFeedback(body, userAgent) {
    const message = String(body?.message ?? '').trim();
    if (!message) throw new FeedbackInputError('empty', 400);
    if (message.length > MAX_MESSAGE) throw new FeedbackInputError('too_long', 413);

    const raw = Array.isArray(body?.files) ? body.files : [];
    if (raw.length > MAX_FILES) throw new FeedbackInputError('too_many_files', 413);
    const files = raw.map(f => ({
        name: safeName(f?.name),
        type: String(f?.type || 'application/octet-stream').slice(0, 100),
        content: Buffer.from(String(f?.data || ''), 'base64')
    })).filter(f => f.content.length > 0);
    const total = files.reduce((sum, f) => sum + f.content.length, 0);
    if (total > MAX_FILE_BYTES) throw new FeedbackInputError('too_large', 413);

    return {
        message,
        email: readEmail(body?.email),
        page: String(body?.page || '').slice(0, 500) || null,
        device: String(userAgent || '').slice(0, 500) || null,
        files
    };
}

// Senders only write; the owner reads the table with psql (heroku pg:psql -a lilai-eu).
async function createFeedbackSchema(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS feedback (
            id VARCHAR(255) PRIMARY KEY,
            message TEXT NOT NULL,
            email VARCHAR(254),
            page TEXT,
            user_agent TEXT,
            attachments TEXT[] NOT NULL DEFAULT '{}',
            emailed BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
}

// The Resend request body for one piece of feedback.
function buildFeedbackMail(f, env = process.env) {
    const to = env.FEEDBACK_EMAIL_TO || INBOX;
    const text = [
        f.message,
        '',
        '---',
        `From: ${f.email ?? 'anonymous'}`,
        `Page: ${f.page ?? 'unknown'}`,
        `Device: ${f.device ?? 'unknown'}`
    ].join('\n');
    return {
        from: env.FEEDBACK_EMAIL_FROM || DEFAULT_FROM,
        to: to.split(',').map(a => a.trim()).filter(Boolean),
        reply_to: f.email ?? undefined,
        subject: `[Lilai] Feedback: ${f.message.split('\n')[0].slice(0, 60)}`,
        text,
        attachments: f.files.map(file => ({ filename: file.name, content: file.content.toString('base64') }))
    };
}

// Emails the feedback through Resend. Without RESEND_API_KEY it does nothing.
// Returns whether an email went out; the caller only logs a failure.
async function mailFeedback(f, env = process.env, fetchImpl = fetch) {
    const key = env.RESEND_API_KEY;
    if (!key) return false;
    const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildFeedbackMail(f, env))
    });
    if (!res.ok) {
        console.error('feedback mail', res.status, await res.text());
        return false;
    }
    return true;
}

module.exports = {
    BODY_LIMIT, MAX_FILES, MAX_FILE_BYTES, MAX_MESSAGE,
    FeedbackInputError, validateFeedback, createFeedbackSchema, buildFeedbackMail, mailFeedback
};
