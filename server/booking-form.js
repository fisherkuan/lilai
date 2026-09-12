/*
 * The KU Leuven booking form: read it, fill it, post it.
 *
 * A Node port of the verified reference implementation at ~/code/sports-booking-bot
 * (booking_bot.py: Form, fields, payload, multipart, SafeRedirect, Client). The page is
 * Plone EasyForm: a multipart POST back to the same URL carrying `form.widgets.*`
 * fields, the hidden empty-markers, a fresh `_authenticator` taken from the GET, and
 * `form.buttons.submit=Verzenden`.
 *
 * The guards are the point. A form that quietly changes shape must break loudly here,
 * not book nothing for weeks while entries sail through and come back rejected.
 *
 * No browser, no CAPTCHA solving, no credentials, no 2FA. It sends the public form the
 * same way a person's browser does.
 */

const FORM_URL = 'https://www.kuleuven.be/sport/formulieren/reservatie-sportinfrastructuur';
const PREFIX = 'form.widgets.';
const SUBMIT = 'form.buttons.submit';
const RESET = 'form.buttons.reset';
const DEFAULT_SUBMIT_VALUE = 'Verzenden';
const USER_AGENT = 'LilaiBookingQueue/1.0 (+https://github.com/fisherkuan/lilai)';

const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'"
};

function decodeEntities(text) {
    return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X'
                ? parseInt(body.slice(2), 16)
                : parseInt(body.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        const named = NAMED_ENTITIES[body.toLowerCase()];
        return named === undefined ? whole : named;
    });
}

// Walk tags while respecting quoted attribute values, so a ">" inside one is not a tag end.
function* eachTag(html) {
    const pattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        yield { closing: match[1] === '/', name: match[2].toLowerCase(), rawAttrs: match[3] };
    }
}

function parseAttrs(raw) {
    const attrs = {};
    const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
        attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return attrs;
}

/**
 * Pull out the booking form's successful controls and the values each choice accepts.
 * `thanks` is the EasyForm receipt marker, and it is looked for across the whole page —
 * on a successful submission there is no form left to scope it to.
 */
function parseForm(html) {
    const form = {
        found: false,
        action: '',
        method: '',
        enctype: '',
        hidden: {},
        controls: {},
        choices: {},
        thanks: false
    };

    let active = false;
    let openSelect = null;

    for (const tag of eachTag(html)) {
        if (tag.closing) {
            if (tag.name === 'form') active = false;
            if (tag.name === 'select') openSelect = null;
            continue;
        }

        const attrs = parseAttrs(tag.rawAttrs);

        if ((attrs.class || '').split(/\s+/).includes('easyform-thankspage')) {
            form.thanks = true;
        }

        if (tag.name === 'form' && attrs.id === 'form') {
            active = true;
            form.found = true;
            form.action = new URL(attrs.action || '', FORM_URL).toString();
            form.method = (attrs.method || '').toLowerCase();
            form.enctype = (attrs.enctype || '').toLowerCase();
        }

        if (!active) continue;

        const name = attrs.name;
        if (name && ['input', 'select', 'textarea', 'button'].includes(tag.name)) {
            form.controls[name] = attrs;
            if (attrs.type === 'hidden') form.hidden[name] = attrs.value ?? '';
            if (attrs.type === 'radio' || attrs.type === 'checkbox') {
                (form.choices[name] ||= []).push(attrs.value ?? '');
            }
            if (tag.name === 'select') {
                openSelect = name;
                form.choices[name] = [];
            }
        }

        if (tag.name === 'option' && openSelect) {
            form.choices[openSelect].push(attrs.value ?? '');
        }
    }

    return form;
}

/** The `form.widgets.*` values for one queued entry. */
function buildFields(entry) {
    if (!entry.startAlternative) {
        throw new Error('A second preferred time is required before building the POST');
    }
    const { formStamp } = require('./booking-time');

    const values = {
        'naam': entry.name,
        'replyto': entry.email,
        'telefoon-of-gsm-nummer': entry.phone,
        'taal:list': entry.language,
        // The declaration the requester made; an empty string means the box stays unticked.
        'ja-ik-heb-een-geldige-sportkaart:list': entry.validSportsCard === true ? 'selected' : '',
        'welke-sport': entry.sport,
        'aantal-spelers': String(entry.players),
        'indoor-of-outdoor': entry.indoorOutdoor,
        'sportveld': entry.facility || '',
        'ander-sportveld-sportzaal': entry.otherFacility || '',
        'tijdstip-voorkeur-1': formStamp(entry.startPreferred),
        'tijdstip-voorkeur-2': formStamp(entry.startAlternative),
        // Number formatting must match the option values exactly: "2", not "2.0".
        'aantal-uren-1:list': String(Number(entry.durationHours)),
        'opmerkingen': entry.remarks || ''
    };

    const prefixed = {};
    for (const [key, value] of Object.entries(values)) prefixed[PREFIX + key] = value;
    return prefixed;
}

class FormChangedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FormChangedError';
    }
}

/**
 * Merge our values with the live form's hidden fields into the exact POST body.
 * Refuses rather than guesses whenever the form is not the one we know.
 */
function buildPayload(form, values) {
    if (!form.found || form.action !== FORM_URL || form.method !== 'post'
        || form.enctype !== 'multipart/form-data') {
        throw new FormChangedError('Booking form endpoint or encoding changed; inspect before submitting');
    }
    if (!form.hidden._authenticator) {
        throw new FormChangedError('Missing fresh security token; the page did not serve a usable form');
    }
    if (!(SUBMIT in form.controls)) {
        throw new FormChangedError('Submit control changed');
    }

    // A control we neither set nor echo back is a field KU Leuven added. Stop.
    const known = new Set([...Object.keys(values), ...Object.keys(form.hidden), SUBMIT, RESET]);
    const unknown = Object.keys(form.controls).filter((name) => !known.has(name)).sort();
    if (unknown.length > 0) {
        throw new FormChangedError(`New form controls require review: ${unknown.join(', ')}`);
    }

    for (const [name, value] of Object.entries(values)) {
        if (!(name in form.controls)) {
            throw new FormChangedError(`Form field changed: ${name}`);
        }
        if (value && form.choices[name] && !form.choices[name].includes(value)) {
            throw new FormChangedError(`Invalid choice for ${name}: ${value}`);
        }
    }

    const payload = {
        ...form.hidden,
        ...values,
        [SUBMIT]: form.controls[SUBMIT].value || DEFAULT_SUBMIT_VALUE
    };

    // "No preference" is the field being absent, not the field being blank.
    if (!values[`${PREFIX}sportveld`]) delete payload[`${PREFIX}sportveld`];

    return payload;
}

function encodeMultipart(values, boundarySeed = null) {
    const boundary = `----LilaiBooking${boundarySeed || require('crypto').randomUUID().replace(/-/g, '')}`;
    const chunks = [];
    for (const [name, value] of Object.entries(values)) {
        if (/[\r\n"]/.test(name)) throw new Error('Invalid field name');
        chunks.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
            'utf8'
        ));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Read a submission response.
 *   sent   - 2xx, the EasyForm receipt marker is there, and no booking form came back.
 *   failed - anything else we could actually read: a validation page, an error page.
 * A request we could not read at all is never classified here; the caller records it as
 * unconfirmed, because we genuinely cannot tell whether it landed.
 */
function classifyResponse(status, html) {
    const parsed = parseForm(html || '');
    const accepted = status >= 200 && status < 300 && parsed.thanks && !parsed.found;
    return accepted ? 'sent' : 'failed';
}

/**
 * The choices the live form actually offers, for the queue sheet's pickers.
 *
 * These are read from the page rather than hard-coded: KU Leuven can add or rename a
 * hall at any time, and a stale list here would mean a request refused at midnight by
 * the choice guard in buildPayload.
 */
function readFormOptions(form) {
    if (!form.found) throw new FormChangedError('No booking form on the page');
    return {
        facilities: [...(form.choices[`${PREFIX}sportveld`] || [])],
        languages: [...(form.choices[`${PREFIX}taal:list`] || [])],
        durations: (form.choices[`${PREFIX}aantal-uren-1:list`] || []).map(Number),
        placements: [...(form.choices[`${PREFIX}indoor-of-outdoor`] || [])],
        fetchedAt: new Date().toISOString()
    };
}

// --- Cookies -------------------------------------------------------------------------

/** Just enough cookie jar to carry the session from the GET into the POST. */
class CookieJar {
    constructor() {
        this.cookies = new Map();
    }

    store(setCookieHeaders = []) {
        for (const header of setCookieHeaders) {
            const [pair] = header.split(';');
            const index = pair.indexOf('=');
            if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
    }

    header() {
        return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
}

function assertSafeRedirect(location, base, method) {
    const target = new URL(location, base);
    const origin = new URL(FORM_URL);
    if (target.protocol !== 'https:' || target.host !== origin.host) {
        throw new Error('Redirect to another origin; manual review required');
    }
    if (method === 'POST') {
        throw new Error('Refusing to replay POST after redirect');
    }
    return target;
}

class BookingFormClient {
    constructor({ url = FORM_URL, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
        this.url = url;
        this.fetchImpl = fetchImpl;
        this.timeoutMs = timeoutMs;
        this.jar = new CookieJar();
    }

    async request(url, init, { maxRedirects = 5 } = {}) {
        let current = url;
        let currentInit = init;

        for (let hop = 0; hop <= maxRedirects; hop += 1) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            let response;
            try {
                response = await this.fetchImpl(current, {
                    ...currentInit,
                    redirect: 'manual',
                    signal: controller.signal,
                    headers: {
                        'User-Agent': USER_AGENT,
                        ...(this.jar.header() ? { Cookie: this.jar.header() } : {}),
                        ...currentInit.headers
                    }
                });
            } finally {
                clearTimeout(timer);
            }

            const setCookie = typeof response.headers.getSetCookie === 'function'
                ? response.headers.getSetCookie()
                : [response.headers.get('set-cookie')].filter(Boolean);
            this.jar.store(setCookie);

            if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
                // urllib only replays 301/302/303, and always as a GET. Same rule here.
                if (currentInit.method === 'POST' && ![301, 302, 303].includes(response.status)) {
                    throw new Error('Refusing to replay POST after redirect');
                }
                const target = assertSafeRedirect(
                    response.headers.get('location'),
                    current,
                    currentInit.method === 'POST' ? null : currentInit.method
                );
                current = target.toString();
                currentInit = { method: 'GET', headers: {} };
                continue;
            }

            return { status: response.status, url: current, html: await response.text() };
        }
        throw new Error('Too many redirects');
    }

    /** Fetch the page and parse the live form, including a fresh security token. */
    async getForm() {
        const response = await this.request(this.url, {
            method: 'GET',
            headers: { 'Cache-Control': 'no-cache' }
        });
        return parseForm(response.html);
    }

    /** POST one entry. Returns { status, outcome, html }. Never retried automatically. */
    async submit(form, values) {
        const { body, contentType } = encodeMultipart(buildPayload(form, values));
        const response = await this.request(this.url, {
            method: 'POST',
            body,
            headers: {
                'Content-Type': contentType,
                Referer: this.url,
                Origin: new URL(this.url).origin
            }
        });
        return {
            status: response.status,
            outcome: classifyResponse(response.status, response.html),
            html: response.html
        };
    }
}

module.exports = {
    FORM_URL,
    PREFIX,
    SUBMIT,
    RESET,
    FormChangedError,
    CookieJar,
    decodeEntities,
    parseForm,
    readFormOptions,
    buildFields,
    buildPayload,
    encodeMultipart,
    classifyResponse,
    assertSafeRedirect,
    BookingFormClient
};
