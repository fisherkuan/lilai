/*
 * Who may write to a calendar, and calendar keys.
 *
 * Most calendars are open: anyone signed in can make an event in them, as anyone can RSVP. A
 * calendar marked `restricted` in config/app.json (TSA) takes a signed-in email on its allow
 * list: CALENDAR_WRITERS ("TSA=a@x.be,b@y.be"; several calendars split by ";"), plus every
 * address on ADMIN_EMAILS. The list lives in the environment because the repo is public.
 *
 * A key is a link, /calendars/<token>, that the owner mints (scripts/calendar-link.js) and
 * hands to a calendar's admins. Opening it on a device opens the management page of any of
 * the calendar's events. It does not let anyone make events in a restricted calendar.
 *
 * Only a key's SHA-256 is stored. Revoking sets revoked_at; the link stops working at once.
 */

const crypto = require('crypto');
const { newToken, hashToken, looksLikeToken } = require('./event-hosting');
const { adminEmails } = require('./admin-auth');

const normalEmail = (value) => String(value ?? '').trim().toLowerCase();

// { calendar name: [email] } from CALENDAR_WRITERS.
function calendarWriters(env = process.env) {
    const out = {};
    for (const part of String(env.CALENDAR_WRITERS || '').split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const name = part.slice(0, i).trim();
        if (!name) continue;
        out[name] = [...(out[name] || []), ...part.slice(i + 1).split(',').map(normalEmail).filter(Boolean)];
    }
    return out;
}

// The calendars a signed-in email may make events in: the open ones, and each restricted one
// whose allow list (or ADMIN_EMAILS) holds the address.
function writableCalendars(calendars, email, env = process.env) {
    const who = normalEmail(email);
    if (!who) return [];
    const writers = calendarWriters(env);
    const admin = adminEmails(env).includes(who);
    return calendars.filter(c => !c.restricted || admin || (writers[c.name] || []).includes(who));
}

async function createCalendarAccessSchema(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS calendar_keys (
            id UUID PRIMARY KEY,
            calendar_name VARCHAR(255) NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            label VARCHAR(100),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            revoked_at TIMESTAMPTZ
        )
    `);
}

// Mints a key for a calendar. Returns the token, which is shown once and never stored.
async function createCalendarKey(client, calendarName, label = null) {
    const token = newToken();
    await client.query(
        'INSERT INTO calendar_keys (id, calendar_name, token_hash, label) VALUES ($1, $2, $3, $4)',
        [crypto.randomUUID(), calendarName, hashToken(token), label]
    );
    return token;
}

async function revokeCalendarKeys(client, calendarName) {
    const result = await client.query(
        'UPDATE calendar_keys SET revoked_at = NOW() WHERE calendar_name = $1 AND revoked_at IS NULL',
        [calendarName]
    );
    return result.rowCount;
}

// The calendar name a key opens, or null.
async function calendarForKey(client, token) {
    if (!looksLikeToken(token)) return null;
    const result = await client.query(
        'SELECT calendar_name FROM calendar_keys WHERE token_hash = $1 AND revoked_at IS NULL',
        [hashToken(token)]
    );
    return result.rows[0]?.calendar_name || null;
}

// The calendar names a device's keys open, from the list it sends with a request.
async function calendarsForKeys(client, tokens) {
    const hashes = (Array.isArray(tokens) ? tokens : []).filter(looksLikeToken).slice(0, 20).map(hashToken);
    if (hashes.length === 0) return new Set();
    const result = await client.query(
        'SELECT DISTINCT calendar_name FROM calendar_keys WHERE token_hash = ANY($1::char(64)[]) AND revoked_at IS NULL',
        [hashes]
    );
    return new Set(result.rows.map(r => r.calendar_name));
}

module.exports = { calendarWriters, writableCalendars, createCalendarAccessSchema, createCalendarKey, revokeCalendarKeys, calendarForKey, calendarsForKeys };
