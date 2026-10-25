/*
 * A small Google Calendar API client for creating events from inside Lilai.
 *
 * Lilai signs in as a Google service account (GOOGLE_SERVICE_ACCOUNT_JSON, the key file
 * Google hands out, as JSON or base64 of it). Each calendar Lilai writes to must be shared
 * with that account's email address with "Make changes to events". No SDK: a signed JWT
 * buys an access token, and the three calls Lilai needs are plain fetches.
 *
 * Lilai owns its events; each Google calendar is a published copy. This client writes that
 * copy (calendar-publish.js) and lists a calendar once, when Lilai takes it over
 * (calendar-import.js).
 */

const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

class GoogleCalendarError extends Error {
    constructor(message, status, reason = null) {
        super(message);
        this.status = status;
        this.reason = reason;
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

    async function call(method, path, body, query) {
        const qs = query ? `?${new URLSearchParams(query)}` : '';
        const res = await fetchImpl(`${API}${path}${qs}`, {
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
            throw new GoogleCalendarError(json.error?.message || `Google Calendar answered ${res.status}`, res.status,
                json.error?.errors?.[0]?.reason || null);
        }
        return json;
    }

    const eventPath = (calendarId, eventId) =>
        `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`;

    return {
        clientEmail: account.clientEmail,
        // resource.id, when set, is Lilai's own id for the copy: a retried insert then gets
        // a 409 instead of making a twin.
        insertEvent: (calendarId, resource) => call('POST', eventPath(calendarId), resource),
        // A full replace (PUT). It also brings back a copy someone deleted in Google.
        updateEvent: (calendarId, eventId, resource) => call('PUT', eventPath(calendarId, eventId), resource),
        deleteEvent: (calendarId, eventId) => call('DELETE', eventPath(calendarId, eventId)),

        // Every event in a calendar, all pages. Repeating events come as their instances,
        // bounded two years ahead so an endless series cannot run on forever.
        async listEvents(calendarId, { now = new Date() } = {}) {
            const timeMax = new Date(now.getTime() + 2 * 365 * 86400000).toISOString();
            const items = [];
            let pageToken;
            do {
                const page = await call('GET', eventPath(calendarId), null, {
                    singleEvents: 'true',
                    maxResults: '2500',
                    timeMax,
                    ...(pageToken ? { pageToken } : {})
                });
                items.push(...(page.items || []));
                pageToken = page.nextPageToken;
            } while (pageToken);
            return items;
        }
    };
}

module.exports = { readServiceAccount, signedAssertion, createGoogleCalendar, GoogleCalendarError };
