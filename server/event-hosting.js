/*
 * Events made inside Lilai: the create form's rules, the Google Calendar resource it
 * becomes, and the host's side of an approval event.
 *
 * Google Calendar still holds the event. Lilai writes it there through the API, then keeps
 * what Google has no field for on its own row: who hosts it, the host's secret link, and
 * whether the host approves each person who asks to join ("approval_required").
 *
 * There are no accounts. The host's page is reached by an unguessable link handed out once,
 * when the event is made; the table keeps only its SHA-256, so a database read cannot
 * reopen anyone's host page.
 */

const crypto = require('crypto');
const { parseBrusselsWallTime, BRUSSELS } = require('./booking-time');

const MAX_TITLE = 120;
const MAX_LOCATION = 255;
const MAX_DESCRIPTION = 4000;
const MAX_NAME = 100;
const MAX_LIMIT = 500;

// RSVP rows carry their state in the attendance column. Only 'yes' holds a seat.
const STATUS = { YES: 'yes', PENDING: 'pending', DECLINED: 'declined' };

class EventInputError extends Error {
    constructor(field, message) {
        super(message);
        this.field = field;
    }
}

function text(value, max, field, label, { required = false } = {}) {
    const trimmed = String(value ?? '').trim();
    if (required && !trimmed) throw new EventInputError(field, `${label} is required.`);
    if (trimmed.length > max) throw new EventInputError(field, `${label} is at most ${max} characters.`);
    if (/<\s*script/i.test(trimmed)) throw new EventInputError(field, `${label} cannot contain scripts.`);
    return trimmed;
}

function addDays(dateText, days) {
    const d = new Date(`${dateText}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// Body of POST /api/events -> a clean event, or EventInputError naming the field.
// calendars: the names the form may write to. An end at or before the start is read as
// the next day, which is what "20:00 to 01:00" means.
function validateNewEvent(body, { calendars, now = new Date() }) {
    const title = text(body?.title, MAX_TITLE, 'title', 'A title', { required: true });

    const calendar = String(body?.calendar ?? '').trim();
    if (!calendars.includes(calendar)) throw new EventInputError('calendar', 'Pick a calendar.');

    const date = String(body?.date ?? '').trim();
    const startTime = String(body?.start ?? '').trim();
    const endTime = String(body?.end ?? '').trim();
    let start;
    let end;
    try {
        start = parseBrusselsWallTime(date, startTime);
    } catch (error) {
        throw new EventInputError('start', 'Pick a day and a start time.');
    }
    const endsNextDay = /^\d{2}:\d{2}$/.test(endTime) && endTime <= startTime;
    const endDate = endsNextDay ? addDays(date, 1) : date;
    try {
        end = parseBrusselsWallTime(endDate, endTime);
    } catch (error) {
        throw new EventInputError('end', 'Pick an end time.');
    }
    if (start <= now) throw new EventInputError('start', 'That time has already passed.');

    let limit = null;
    const rawLimit = body?.limit;
    if (rawLimit !== undefined && rawLimit !== null && String(rawLimit).trim() !== '') {
        limit = Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
            throw new EventInputError('limit', `A limit is a whole number from 1 to ${MAX_LIMIT}.`);
        }
    }

    const link = String(body?.link ?? '').trim();
    if (link) {
        let url;
        try { url = new URL(link); } catch (error) { url = null; }
        if (!url || !['http:', 'https:'].includes(url.protocol) || link.length > 500) {
            throw new EventInputError('link', 'A link starts with https://');
        }
    }

    const hostEmail = String(body?.hostEmail ?? '').trim().slice(0, 254);
    if (hostEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hostEmail)) {
        throw new EventInputError('hostEmail', 'That email address does not look right.');
    }

    return {
        title,
        calendar,
        date,
        startTime,
        endTime,
        endDate,
        start,
        end,
        location: text(body?.location, MAX_LOCATION, 'location', 'The place'),
        description: text(body?.description, MAX_DESCRIPTION, 'description', 'The description'),
        link,
        limit,
        approval: body?.approval === true || body?.approval === 'true',
        hostName: text(body?.hostName, MAX_NAME, 'hostName', 'Your name', { required: true }),
        hostEmail: hostEmail || null,
        hostJoins: body?.hostJoins !== false && body?.hostJoins !== 'false'
    };
}

// The description Google Calendar gets. The "link:" and "limit:" lines are the ones the
// sync and the cards already read, so an organizer who edits the event in Google keeps
// working the way they always have.
function googleDescription(event) {
    const lines = [];
    if (event.description) lines.push(event.description);
    if (event.link) lines.push(`link: ${event.link}`);
    if (event.limit !== null) lines.push(`limit: ${event.limit}`);
    if (event.approval) lines.push(`Hosted by ${event.hostName}. Ask to join in Lilai; the host confirms each place.`);
    return lines.join('\n\n');
}

// The events.insert body. Times go as Brussels wall times so Google keeps the zone.
function googleEventResource(event) {
    return {
        summary: event.title,
        location: event.location || undefined,
        description: googleDescription(event) || undefined,
        start: { dateTime: `${event.date}T${event.startTime}:00`, timeZone: BRUSSELS },
        end: { dateTime: `${event.endDate}T${event.endTime}:00`, timeZone: BRUSSELS },
        extendedProperties: { private: { lilai: '1', lilaiApproval: event.approval ? '1' : '0' } }
    };
}

function newHostToken() {
    return crypto.randomBytes(24).toString('base64url');
}

function hashHostToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// A token looks like one before it costs a query.
function looksLikeHostToken(token) {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(token);
}

// Columns the public API never shows: the host's address and the hash behind their link.
function publicEvent(row) {
    if (!row) return row;
    const { host_token_hash: _hash, host_email: _email, ...rest } = row;
    return rest;
}

async function createHostingSchema(client) {
    for (const column of [
        'approval_required BOOLEAN NOT NULL DEFAULT FALSE',
        'host_name VARCHAR(100)',
        'host_email VARCHAR(254)',
        'host_token_hash CHAR(64)',
        'google_calendar_id VARCHAR(255)',
        'google_event_id VARCHAR(255)',
        'google_link TEXT',
        'created_in_app_at TIMESTAMPTZ'
    ]) {
        await client.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS ${column}`);
    }
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_host_token ON events(host_token_hash) WHERE host_token_hash IS NOT NULL');
}

// Emails the host their link through Resend, the same sender as feedback. Without
// RESEND_API_KEY it does nothing. Returns whether an email went out.
async function mailHostLink({ to, title, url }, env = process.env, fetchImpl = fetch) {
    const key = env.RESEND_API_KEY;
    if (!key) return false;
    const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: env.FEEDBACK_EMAIL_FROM || 'Lilai <onboarding@resend.dev>',
            to: [to],
            subject: `[Lilai] Your host link: ${title.slice(0, 60)}`,
            text: [
                `You made "${title}" in Lilai.`,
                '',
                'Your host page shows who is coming and, for an event you approve, who asked to join:',
                url,
                '',
                'Anyone with this link can accept or decline requests, so keep it to yourself.'
            ].join('\n')
        })
    });
    if (!res.ok) {
        console.error('host link mail', res.status, await res.text());
        return false;
    }
    return true;
}

// Which way a host's decision moves a request. 'pending' is the undo.
const DECISIONS = { accept: STATUS.YES, decline: STATUS.DECLINED, undo: STATUS.PENDING };

module.exports = {
    STATUS, DECISIONS, MAX_LIMIT,
    EventInputError, validateNewEvent, googleDescription, googleEventResource,
    newHostToken, hashHostToken, looksLikeHostToken, publicEvent, createHostingSchema, mailHostLink
};
