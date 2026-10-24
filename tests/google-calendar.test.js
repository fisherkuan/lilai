const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { readServiceAccount, signedAssertion, createGoogleCalendar } = require('../server/google-calendar');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const keyFile = JSON.stringify({ client_email: 'lilai@proj.iam.gserviceaccount.com', private_key: pem });

test('the key file reads as JSON or base64, and is optional', () => {
    assert.equal(readServiceAccount({}), null);
    assert.equal(readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: keyFile }).clientEmail, 'lilai@proj.iam.gserviceaccount.com');
    const b64 = Buffer.from(keyFile).toString('base64');
    assert.equal(readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: b64 }).privateKey, pem);
    assert.throws(() => readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"x"}' }), /private_key/);
    assert.throws(() => readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: 'not a key' }), /JSON/);
});

test('the assertion is an RS256 JWT for the calendar scope', () => {
    const account = readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: keyFile });
    const jwt = signedAssertion(account, Date.UTC(2026, 9, 24));
    const [header, claims, signature] = jwt.split('.');
    const body = JSON.parse(Buffer.from(claims, 'base64url').toString());
    assert.equal(body.iss, account.clientEmail);
    assert.equal(body.scope, 'https://www.googleapis.com/auth/calendar.events');
    assert.equal(body.exp - body.iat, 3600);
    const ok = crypto.createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'));
    assert.ok(ok);
});

function fakeGoogle(routes) {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url, method: init.method || 'GET', auth: init.headers?.Authorization });
        if (url.startsWith('https://oauth2.googleapis.com/token')) {
            return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
        }
        const [status, body] = routes(url, init);
        return { ok: status < 300, status, json: async () => body };
    };
    return { calls, fetchImpl };
}

test('one token serves several calls, and insert posts to the calendar', async () => {
    const account = readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: keyFile });
    const { calls, fetchImpl } = fakeGoogle(() => [200, { id: 'abc', iCalUID: 'abc@google.com' }]);
    const gc = createGoogleCalendar(account, { fetchImpl });
    const created = await gc.insertEvent('cal@group.calendar.google.com', { summary: 'x' });
    await gc.insertEvent('cal@group.calendar.google.com', { summary: 'y' });
    assert.equal(created.iCalUID, 'abc@google.com');
    assert.equal(calls.filter(c => c.url.includes('oauth2')).length, 1);
    const insert = calls.find(c => c.method === 'POST' && c.url.includes('/calendars/'));
    assert.equal(insert.url, 'https://www.googleapis.com/calendar/v3/calendars/cal%40group.calendar.google.com/events');
    assert.equal(insert.auth, 'Bearer tok');
});

test('eventGone: deleted is gone, present is not, an error is unknown', async () => {
    const account = readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: keyFile });
    const answers = { a: [200, { status: 'confirmed' }], b: [200, { status: 'cancelled' }], c: [404, {}], d: [500, {}] };
    const { fetchImpl } = fakeGoogle((url) => answers[url.split('/').pop()]);
    const gc = createGoogleCalendar(account, { fetchImpl });
    const original = console.error;
    console.error = () => {};
    try {
        assert.equal(await gc.eventGone('cal', 'a'), false);
        assert.equal(await gc.eventGone('cal', 'b'), true);
        assert.equal(await gc.eventGone('cal', 'c'), true);
        assert.equal(await gc.eventGone('cal', 'd'), null);
    } finally {
        console.error = original;
    }
});

test('a refused insert carries Google\'s status', async () => {
    const account = readServiceAccount({ GOOGLE_SERVICE_ACCOUNT_JSON: keyFile });
    const { fetchImpl } = fakeGoogle(() => [403, { error: { message: 'Forbidden' } }]);
    const gc = createGoogleCalendar(account, { fetchImpl });
    await assert.rejects(gc.insertEvent('cal', {}), (error) => error.status === 403 && /Forbidden/.test(error.message));
});
