/*
 * Events as Lilai owns them: the form's rules (make and edit, one-off or repeating), the copy
 * each event publishes to its Google calendar, and the links that let a host manage it.
 *
 * Lilai's database is the source of truth. A Google calendar is a published copy that people
 * subscribe to (calendar-publish.js writes it); nothing is read back from it once Lilai has
 * taken the calendar over (calendar-import.js).
 *
 * There are no accounts. Managing an event takes its link, /host/<token>, handed out when it
 * is made. A repeating event is a series of ordinary events, and one link covers the series.
 * The tables keep only a token's SHA-256, so a database read cannot reopen anyone's page.
 */

const crypto = require('crypto');
const { parseBrusselsWallTime, brusselsDateOf, brusselsTimeOf, BRUSSELS } = require('./booking-time');
const { expandRepeat, validateRule, RepeatError } = require('./booking-repeat');

const MAX_TITLE = 120;
const MAX_LOCATION = 255;
const MAX_DESCRIPTION = 4000;
const MAX_NAME = 100;
const MAX_LIMIT = 500;
const MAX_LINKS = 5;
const MAX_LINK_LABEL = 40;
const MAX_URL = 500;
const MAX_OCCURRENCES = 52;

// RSVP rows carry their state in the attendance column. Only 'yes' holds a seat.
const STATUS = { YES: 'yes', PENDING: 'pending', DECLINED: 'declined' };

// Which way a host's decision moves a request. 'pending' is the undo.
const DECISIONS = { accept: STATUS.YES, decline: STATUS.DECLINED, undo: STATUS.PENDING };

// An edit or a cancellation of a repeating event reaches this date only, or later ones too.
const SCOPES = ['this', 'later'];

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

/*
 * One date's start and end, from Brussels clock times. An end at or before the start is the
 * next day, which is what "20:00 to 01:00" means. Throws on a time the DST change skips or
 * repeats rather than guessing.
 */
function timesOn(date, startTime, endTime) {
    const start = parseBrusselsWallTime(date, startTime);
    const endDate = /^\d{2}:\d{2}$/.test(endTime) && endTime <= startTime ? addDays(date, 1) : date;
    const end = parseBrusselsWallTime(endDate, endTime);
    return { start, end };
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

// The event's links: [{ url, label }], label optional. Rows with no address are dropped (an
// empty row in the editor is not a mistake).
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

// The repeat as the booking sheet sends it: { every, unit, weekdays, until }. Null when off.
function readRepeat(raw) {
    if (raw === undefined || raw === null || raw === false) return null;
    return {
        every: Number(raw.every),
        unit: raw.unit,
        weekdays: Array.isArray(raw.weekdays) ? raw.weekdays.map(Number) : [],
        until: raw.until
    };
}

/*
 * The form's body -> a clean event, or EventInputError naming the field.
 *
 * mode 'create' also reads the calendar, the host and the repeat, and answers every date the
 * repeat lands on. mode 'edit' reads only what the event itself carries; `current` is the row
 * being edited, so an event that has already started can still be corrected as long as its
 * start does not move.
 */
// The place, required: one of the owner's places (config/app.json `places`), spelled as the
// list spells it. An edit may keep a place the event already had, so old events stay editable.
function validatePlace(value, places, current) {
    const name = text(value, MAX_LOCATION, 'location', 'The place');
    if (!name) throw new EventInputError('location', 'Pick a place.');
    if (!places || !places.length) return name;
    const fold = (t) => String(t || '').trim().toLowerCase();
    const match = places.find(p => fold(p.name) === fold(name));
    if (match) return match.name;
    if (current && name === String(current.location || '').trim()) return name;
    throw new EventInputError('location', 'Pick a place from the list.');
}

function validateEvent(body, { mode = 'create', calendars = [], places = null, now = new Date(), current = null } = {}) {
    const title = text(body?.title, MAX_TITLE, 'title', 'A title', { required: true });

    const date = String(body?.date ?? '').trim();
    const startTime = String(body?.start ?? '').trim();
    const endTime = String(body?.end ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime)) {
        throw new EventInputError('start', 'Pick a day and a start time.');
    }
    if (!/^\d{2}:\d{2}$/.test(endTime)) throw new EventInputError('end', 'Pick an end time.');
    let start;
    let end;
    try {
        ({ start, end } = timesOn(date, startTime, endTime));
    } catch (error) {
        throw new EventInputError('start', 'That time does not exist on that day (the clocks change). Pick another.');
    }
    const moved = !current || new Date(current.date).getTime() !== start.getTime();
    if (moved && start <= now) throw new EventInputError('start', 'That time has already passed.');

    const event = {
        title,
        date,
        startTime,
        endTime,
        start,
        end,
        location: validatePlace(body?.location, places, current),
        description: text(body?.description, MAX_DESCRIPTION, 'description', 'The description'),
        links: validateLinks(body?.links),
        limit: validateLimit(body?.limit),
        approval: body?.approval === true || body?.approval === 'true'
    };
    if (mode === 'edit') {
        event.scope = SCOPES.includes(body?.scope) ? body.scope : 'this';
        return event;
    }

    const calendar = String(body?.calendar ?? '').trim();
    if (!calendars.includes(calendar)) throw new EventInputError('calendar', 'Pick a calendar.');

    const hostEmail = String(body?.hostEmail ?? '').trim().slice(0, 254);
    if (hostEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hostEmail)) {
        throw new EventInputError('hostEmail', 'That email address does not look right.');
    }

    // Every date the repeat lands on, each with its own start and end.
    let repeat = readRepeat(body?.repeat);
    let dates;
    try {
        dates = expandRepeat(date, repeat, { cap: MAX_OCCURRENCES, noun: 'events' });
        // Kept as the series' rule, with a weekly repeat's weekday filled in.
        if (repeat) repeat = validateRule(repeat, date);
    } catch (error) {
        if (error instanceof RepeatError) throw new EventInputError('repeat', error.message);
        throw error;
    }
    const occurrences = dates.map((day) => {
        try {
            return { date: day, ...timesOn(day, startTime, endTime) };
        } catch (error) {
            throw new EventInputError('repeat', `On ${day} the clocks change and ${startTime} does not exist. Pick another time.`);
        }
    });

    return {
        ...event,
        calendar,
        repeat,
        occurrences,
        hostName: text(body?.hostName, MAX_NAME, 'hostName', 'Your name', { required: true }),
        hostEmail: hostEmail || null,
        hostJoins: body?.hostJoins !== false && body?.hostJoins !== 'false'
    };
}

// The clock times an edit gives to a later date of the same series, on that date.
function laterTimes(row, edit) {
    return timesOn(brusselsDateOf(new Date(row.date)), edit.startTime, edit.endTime);
}

// A row's form values, for the edit sheet: Brussels day and clock times.
function formValues(row) {
    const start = new Date(row.date);
    const endRaw = row.enddate || row.endDate;
    const end = endRaw ? new Date(endRaw) : new Date(start.getTime() + 2 * 3600000);
    return {
        title: row.title,
        date: brusselsDateOf(start),
        start: brusselsTimeOf(start),
        end: brusselsTimeOf(end),
        location: row.location || '',
        description: row.description || '',
        links: row.links || [],
        limit: row.attendance_limit,
        approval: Boolean(row.approval_required)
    };
}

/*
 * The copy a Google calendar shows. Subscribers only see Google, so the description carries
 * the links and a way back to Lilai. Output only: Lilai never reads it back.
 */
function googleDescription(row, publicUrl) {
    const parts = [];
    if (row.description) parts.push(row.description);
    const links = Array.isArray(row.links) ? row.links : [];
    if (links.length) parts.push(links.map(l => (l.label ? `${l.label}: ${l.url}` : l.url)).join('\n'));
    const verb = row.approval_required ? 'Ask to join' : 'Join';
    parts.push(`${verb}, or see who is coming: ${eventUrl(row.id, publicUrl)}`);
    return parts.join('\n\n');
}

function eventUrl(id, publicUrl) {
    return `${String(publicUrl || '').replace(/\/+$/, '')}/#event-${encodeURIComponent(id)}`;
}

function googleEventResource(row, { publicUrl, places } = {}) {
    const start = new Date(row.date);
    const endRaw = row.enddate || row.endDate;
    const end = endRaw && new Date(endRaw) > start ? new Date(endRaw) : new Date(start.getTime() + 2 * 3600000);
    const resource = {
        summary: row.title,
        description: googleDescription(row, publicUrl),
        start: { dateTime: start.toISOString(), timeZone: BRUSSELS },
        end: { dateTime: end.toISOString(), timeZone: BRUSSELS },
        status: 'confirmed',
        extendedProperties: { private: { lilai: '1' } }
    };
    // A place on the owner's list goes to Google with its address, so the copy opens in maps.
    const place = row.location && (places || []).find(p => p.name === row.location && p.address);
    if (row.location) resource.location = place ? `${place.name}, ${place.address}` : row.location;
    if (publicUrl && /^https?:\/\//.test(publicUrl)) resource.source = { title: 'Lilai', url: eventUrl(row.id, publicUrl) };
    return resource;
}

// Lilai chooses each copy's Google id: 32 hex characters fit Google's base32hex rule, and a
// retried insert with the same id is refused instead of making a twin.
function newGoogleEventId() {
    return crypto.randomUUID().replace(/-/g, '');
}

// Lilai's own id for an event, the same shape the old feed used (cal-<iCal UID>), so the
// import lands on the rows that already hold RSVPs.
function eventIdForGoogleId(googleId) {
    return `cal-${googleId}@google.com`;
}

/*
 * Before 2026-10-24 a description could carry settings: "limit: N" and "link: URL" lines.
 * Run once per event, when Lilai takes its calendar over: the values move into their own
 * fields and the lines leave the text. The first address in prose was the old card's link,
 * so it becomes a link too, but the prose keeps it.
 */
function convertLegacyDescription(description) {
    const textIn = typeof description === 'string' ? description : '';
    const limitMatch = textIn.match(/^[ \t]*limit:?[ \t]*(\d+)[ \t]*$/im);
    const link = linkFromLegacyDescription(textIn);
    const cleaned = textIn
        .replace(/^[ \t]*limit:?[ \t]*\d+[ \t]*(\r?\n|$)/gim, '')
        .replace(/^[ \t]*link:?[ \t]*https?:\/\/\S+[ \t]*(\r?\n|$)/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return { description: cleaned, limit: limitMatch ? parseInt(limitMatch[1], 10) : null, link };
}

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

// Event and calendar links share one token shape: 24 random bytes, 32 url-safe characters.
function newToken() {
    return crypto.randomBytes(24).toString('base64url');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// A token looks like one before it costs a query.
function looksLikeToken(token) {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(token);
}

// Columns the public API never shows: the host's address and the publishing bookkeeping.
const PRIVATE_COLUMNS = ['host_email', 'host_token_hash', 'version', 'synced_version', 'push_attempts', 'push_error', 'next_push_at'];

function publicEvent(row) {
    if (!row) return row;
    const out = { ...row };
    for (const column of PRIVATE_COLUMNS) delete out[column];
    return out;
}

// Where the event's Google copy stands, in words the management page can show as they are.
function publishState(row, { publishing }) {
    if (!row.google_calendar_id) return { state: 'local', text: 'This event is not in a Google calendar.' };
    const pending = Number(row.version) > Number(row.synced_version);
    if (!pending) {
        return row.cancelled_at
            ? { state: 'synced', text: 'Removed from Google Calendar.' }
            : { state: 'synced', text: 'In Google Calendar.' };
    }
    if (!publishing) return { state: 'off', text: 'Not in Google Calendar yet: publishing is not set up on this server.' };
    if (row.push_error) {
        return { state: 'retrying', text: `Google Calendar has not taken the latest change yet (${row.push_error}). Lilai keeps trying.` };
    }
    return { state: 'sending', text: 'Sending to Google Calendar…' };
}

async function createHostingSchema(client) {
    for (const column of [
        'approval_required BOOLEAN NOT NULL DEFAULT FALSE',
        'host_name VARCHAR(100)',
        'host_email VARCHAR(254)',
        'google_calendar_id VARCHAR(255)',
        'google_event_id VARCHAR(255)',
        'google_link TEXT',
        'created_in_app_at TIMESTAMPTZ',
        // Lilai owns this row: the feed never touches it, the publisher keeps Google in step.
        'managed BOOLEAN NOT NULL DEFAULT FALSE',
        // The Google copy needs a push while version > synced_version.
        'version INTEGER NOT NULL DEFAULT 1',
        'synced_version INTEGER NOT NULL DEFAULT 0',
        'push_attempts INTEGER NOT NULL DEFAULT 0',
        'push_error TEXT',
        'next_push_at TIMESTAMPTZ',
        'cancelled_at TIMESTAMPTZ',
        'updated_at TIMESTAMPTZ',
        'series_id UUID'
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

    await client.query(`
        CREATE TABLE IF NOT EXISTS event_series (
            id UUID PRIMARY KEY,
            rule JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // A management link opens one event, or every date of a series.
    await client.query(`
        CREATE TABLE IF NOT EXISTS event_host_links (
            id UUID PRIMARY KEY,
            token_hash CHAR(64) NOT NULL UNIQUE,
            event_id VARCHAR(255) REFERENCES events(id) ON DELETE CASCADE,
            series_id UUID REFERENCES event_series(id) ON DELETE CASCADE,
            created_via VARCHAR(20) NOT NULL DEFAULT 'create',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK ((event_id IS NULL) <> (series_id IS NULL))
        )
    `);

    // Links made before the table existed lived on the event row.
    const hadTokenColumn = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'host_token_hash'`
    );
    if (hadTokenColumn.rows.length > 0) {
        await client.query(`
            INSERT INTO event_host_links (id, token_hash, event_id)
            SELECT gen_random_uuid(), host_token_hash, id FROM events WHERE host_token_hash IS NOT NULL
            ON CONFLICT (token_hash) DO NOTHING
        `);
        await client.query('ALTER TABLE events DROP COLUMN host_token_hash');
        // Events made in Lilai before it owned events were already in Google.
        await client.query(`UPDATE events SET managed = TRUE, version = 1, synced_version = 1
                            WHERE created_in_app_at IS NOT NULL AND managed = FALSE`);
    }

    await client.query('CREATE INDEX IF NOT EXISTS idx_events_series ON events(series_id) WHERE series_id IS NOT NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_events_push ON events(next_push_at) WHERE managed AND version > synced_version');
}

// Emails the host their link through Resend, the same sender as feedback. Without
// RESEND_API_KEY it does nothing. Returns whether an email went out.
async function mailHostLink({ to, title, url, count = 1 }, env = process.env, fetchImpl = fetch) {
    const key = env.RESEND_API_KEY;
    if (!key) return false;
    const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: env.FEEDBACK_EMAIL_FROM || 'Lilai <onboarding@resend.dev>',
            to: [to],
            subject: `[Lilai] Manage your event: ${title.slice(0, 60)}`,
            text: [
                count > 1 ? `You made "${title}" in Lilai, on ${count} dates.` : `You made "${title}" in Lilai.`,
                '',
                'Edit it, cancel it, and see who is coming here:',
                url,
                '',
                'Anyone with this link can manage the event. Share it only with people who host with you.'
            ].join('\n')
        })
    });
    if (!res.ok) {
        console.error('host link mail', res.status, await res.text());
        return false;
    }
    return true;
}

module.exports = {
    STATUS, DECISIONS, SCOPES, MAX_LIMIT, MAX_LINKS, MAX_OCCURRENCES,
    EventInputError, validateEvent, validateLimit, validateLinks, timesOn, laterTimes, formValues,
    googleDescription, googleEventResource, newGoogleEventId, eventIdForGoogleId,
    convertLegacyDescription, linkFromLegacyDescription,
    newToken, hashToken, looksLikeToken, publicEvent, publishState, createHostingSchema, mailHostLink
};
