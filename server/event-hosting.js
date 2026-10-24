/*
 * Events made inside Lilai: the create form's rules, the Google Calendar resource it
 * becomes, and the host's side of an approval event.
 *
 * Google Calendar still holds the event. Lilai writes it there through the API, then keeps
 * what Google has no field for on its own row: who hosts it, the host's secret link,
 * whether the host approves each person who asks to join ("approval_required"), the seat
 * limit and the links. Nothing is read back out of the description: Google owns the title,
 * time, place and description, Lilai owns the rest.
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
const MAX_LINKS = 5;
const MAX_LINK_LABEL = 40;
const MAX_URL = 500;

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

    const limit = validateLimit(body?.limit);
    const links = validateLinks(body?.links);

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
        links,
        limit,
        approval: body?.approval === true || body?.approval === 'true',
        hostName: text(body?.hostName, MAX_NAME, 'hostName', 'Your name', { required: true }),
        hostEmail: hostEmail || null,
        hostJoins: body?.hostJoins !== false && body?.hostJoins !== 'false'
    };
}

// Empty, null or missing -> no limit. Anything else must be a whole number in range.
function validateLimit(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new EventInputError('limit', `A limit is a whole number from 1 to ${MAX_LIMIT}.`);
    }
    return limit;
}

// The event's links: [{ url, label }], label optional. Lilai holds them; nothing reads a
// link out of the description any more. Rows with no address are dropped (an empty row
// in the editor is not a mistake).
function validateLinks(raw) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new EventInputError('links', 'Links must be a list.');
    const links = raw
        .map(item => ({ url: String(item?.url ?? '').trim(), label: String(item?.label ?? '').trim() }))
        .filter(item => item.url);
    if (links.length > MAX_LINKS) throw new EventInputError('links', `At most ${MAX_LINKS} links.`);
    return links.map(({ url, label }) => {
        let parsed;
        try { parsed = new URL(url); } catch (error) { parsed = null; }
        if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || url.length > MAX_URL) {
            throw new EventInputError('links', `"${url.slice(0, 60)}" is not a web address. It starts with https://`);
        }
        if (label.length > MAX_LINK_LABEL) {
            throw new EventInputError('links', `A link's name is at most ${MAX_LINK_LABEL} characters.`);
        }
        if (/<\s*script/i.test(label)) throw new EventInputError('links', 'A link name cannot contain scripts.');
        return label ? { url: parsed.href, label } : { url: parsed.href };
    });
}

// What a host or the admin page may change on an existing event: the limit, the links, or
// both. Missing keys stay as they are.
function validateEventSettings(body) {
    const settings = {};
    if (body && 'limit' in body) settings.limit = validateLimit(body.limit);
    if (body && 'links' in body) settings.links = validateLinks(body.links);
    if (Object.keys(settings).length === 0) throw new EventInputError('limit', 'Nothing to change.');
    return settings;
}

// Before 2026-10-24 an event's link was read out of its description ("link: URL", else the
// first address). Run once, when the links column arrives, so those events keep their link.
function linkFromLegacyDescription(description) {
    if (typeof description !== 'string') return null;
    const match = description.match(/link:?\s*(https?:\/\/\S+)/i) || description.match(/https?:\/\/\S+/i);
    if (!match) return null;
    const raw = (match[1] || match[0]).replace(/[\s"'<>)]*$/, '');
    try {
        const url = new URL(raw);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch (error) {
        return null;
    }
}

// The events.insert body. Times go as Brussels wall times so Google keeps the zone.
function googleEventResource(event) {
    return {
        summary: event.title,
        location: event.location || undefined,
        description: event.description || undefined,
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

    const hadLinks = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'links'`
    );
    if (hadLinks.rows.length === 0) {
        await client.query(`ALTER TABLE events ADD COLUMN links JSONB NOT NULL DEFAULT '[]'::jsonb`);
        const rows = await client.query('SELECT id, description FROM events WHERE description IS NOT NULL');
        for (const row of rows.rows) {
            const url = linkFromLegacyDescription(row.description);
            if (url) await client.query('UPDATE events SET links = $1 WHERE id = $2', [JSON.stringify([{ url }]), row.id]);
        }
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
    STATUS, DECISIONS, MAX_LIMIT, MAX_LINKS,
    EventInputError, validateNewEvent, validateLimit, validateLinks, validateEventSettings,
    linkFromLegacyDescription, googleEventResource,
    newHostToken, hashHostToken, looksLikeHostToken, publicEvent, createHostingSchema, mailHostLink
};
