/*
 * A small Google Calendar API client for creating events from inside Lilai.
 *
 * Lilai signs in as a Google service account (GOOGLE_SERVICE_ACCOUNT_JSON, the key file
 * Google hands out, as JSON or base64 of it). Each calendar Lilai writes to must be shared
 * with that account's email address with "Make changes to events". No SDK: a signed JWT
 * buys an access token, and the three calls Lilai needs are plain fetches.
 *
 * Reading still goes through the public iCal feed (fetchCalendarEvents in app.js); this
 * client only writes, and checks whether an event it made still exists.
 */

const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

class GoogleCalendarError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

// The key file from env, or null when event creation is not set up.
// Throws on a value that is set but unreadable, so a bad deploy fails at startup.
function readServiceAccount(env = process.env) {
    const raw = (env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!raw) return null;
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    let key;
    try {
        key = JSON.parse(text);
    } catch (error) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is neither JSON nor base64 of JSON');
    }
    if (!key.client_email || !key.private_key) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON needs client_email and private_key');
    }
    return { clientEmail: key.client_email, privateKey: key.private_key };
}

function base64url(value) {
    return Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// The JWT a service account trades for an access token (RFC 7523).
function signedAssertion(account, nowMs = Date.now()) {
    const iat = Math.floor(nowMs / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({
        iss: account.clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat,
        exp: iat + 3600
    }));
    const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.privateKey);
    return `${header}.${claims}.${base64url(signature)}`;
}

function createGoogleCalendar(account, { fetchImpl = fetch, now = Date.now } = {}) {
    let token = null; // { value, expiresAt }

    async function accessToken() {
        if (token && token.expiresAt - 60000 > now()) return token.value;
        const res = await fetchImpl(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: signedAssertion(account, now())
            }).toString()
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.access_token) {
            throw new GoogleCalendarError(`Google sign-in failed: ${body.error_description || body.error || res.status}`, res.status);
        }
        token = { value: body.access_token, expiresAt: now() + (body.expires_in || 3600) * 1000 };
        return token.value;
    }

    async function call(method, path, body) {
        const res = await fetchImpl(`${API}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${await accessToken()}`,
                ...(body ? { 'Content-Type': 'application/json' } : {})
            },
            body: body ? JSON.stringify(body) : undefined
        });
        if (res.status === 204) return null;
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new GoogleCalendarError(json.error?.message || `Google Calendar answered ${res.status}`, res.status);
        }
        return json;
    }

    const eventPath = (calendarId, eventId) =>
        `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;

    return {
        clientEmail: account.clientEmail,
        insertEvent: (calendarId, resource) => call('POST', eventPath(calendarId), resource),
        deleteEvent: (calendarId, eventId) => call('DELETE', eventPath(calendarId, eventId)),

        // true: deleted in Google. false: still there. null: could not tell.
        async eventGone(calendarId, eventId) {
            try {
                const event = await call('GET', eventPath(calendarId, eventId));
                return event.status === 'cancelled';
            } catch (error) {
                if (error.status === 404 || error.status === 410) return true;
                console.error(`Could not check Google event ${eventId}:`, error.message);
                return null;
            }
        }
    };
}

module.exports = { readServiceAccount, signedAssertion, createGoogleCalendar, GoogleCalendarError };
