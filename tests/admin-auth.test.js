/*
 * Admin sign-in by emailed code. The pure helpers always run; the code and session flow
 * needs a scratch PostgreSQL (TEST_DATABASE_URL, see booking-quota.integration.test.js)
 * and is skipped without one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const {
    adminEmails, parseCookies, sessionCookie, buildCodeMail, createAdminAuthSchema, createAdminAuth, COOKIE
} = require('../server/admin-auth');

test('the admin list defaults to the owner and reads ADMIN_EMAILS otherwise', () => {
    assert.deepEqual(adminEmails({}), ['lilai@fisherkuan.com']);
    assert.deepEqual(adminEmails({ ADMIN_EMAILS: ' A@x.be, b@y.be ,' }), ['a@x.be', 'b@y.be']);
});

test('cookies parse, and the session cookie is HttpOnly and Lax, Secure in production', () => {
    assert.deepEqual(parseCookies('a=1; lilai_admin=tok%2Den; broken'), { a: '1', lilai_admin: 'tok-en' });
    const c = sessionCookie('abc', { secure: true });
    assert.match(c, /^lilai_admin=abc; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
    assert.doesNotMatch(sessionCookie('abc', { secure: false }), /Secure/);
    assert.match(sessionCookie('', { secure: false, maxAgeMs: 0 }), /Max-Age=0/);
});

test('the code mail names the code in the subject', () => {
    const mail = buildCodeMail('lilai@fisherkuan.com', '042917', {});
    assert.equal(mail.subject, 'Lilai admin code: 042917');
    assert.deepEqual(mail.to, ['lilai@fisherkuan.com']);
    assert.match(mail.text, /ten minutes/);
});

const CONNECTION = process.env.TEST_DATABASE_URL;
const scratch = CONNECTION && /test|scratch|local/i.test(new URL(CONNECTION).pathname);

test('a code signs an admin in once; wrong codes run out; others get nothing', { skip: !scratch && 'no TEST_DATABASE_URL' }, async () => {
    const pool = new Pool({ connectionString: CONNECTION });
    try {
        const client = await pool.connect();
        try { await createAdminAuthSchema(client); } finally { client.release(); }
        await pool.query('TRUNCATE admin_codes, admin_sessions');
        const mails = [];
        const fetchImpl = async (url, init) => { mails.push(JSON.parse(init.body)); return { ok: true, text: async () => '' }; };
        const env = { RESEND_API_KEY: 'k', ADMIN_EMAILS: 'boss@lilai.test' };
        const auth = createAdminAuth({ pool, env, fetchImpl });

        assert.deepEqual(await auth.sendCode('stranger@lilai.test'), { sent: true });
        assert.equal(mails.length, 0); // same answer, no mail

        assert.deepEqual(await auth.sendCode(' Boss@lilai.test '), { sent: true });
        const code = mails[0].subject.match(/(\d{6})$/)[1];
        const wrong = code === '000000' ? '111111' : '000000';
        assert.equal(await auth.verifyCode('boss@lilai.test', wrong), null);
        const token = await auth.verifyCode('boss@lilai.test', code);
        assert.ok(token);
        assert.equal(await auth.verifyCode('boss@lilai.test', code), null); // used up

        const req = { headers: { cookie: `${COOKIE}=${token}` } };
        assert.equal(await auth.adminOf(req), 'boss@lilai.test');
        // Taken off the list, the session stops working.
        assert.equal(await createAdminAuth({ pool, env: { ...env, ADMIN_EMAILS: 'other@lilai.test' } }).adminOf(req), null);

        // Five wrong tries spend a fresh code.
        await auth.sendCode('boss@lilai.test');
        const fresh = mails[1].subject.match(/(\d{6})$/)[1];
        const bad = fresh === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i += 1) await auth.verifyCode('boss@lilai.test', bad);
        assert.equal(await auth.verifyCode('boss@lilai.test', fresh), null);

        // Five codes an hour.
        for (let i = 0; i < 3; i += 1) await auth.sendCode('boss@lilai.test');
        assert.equal((await auth.sendCode('boss@lilai.test')).sent, false);

        const res = { headers: {}, set(k, v) { this.headers[k] = v; } };
        await auth.signOut(req, res);
        assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
        assert.equal(await auth.adminOf(req), null);
    } finally {
        await pool.end();
    }
});
