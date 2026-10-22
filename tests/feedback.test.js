const test = require('node:test');
const assert = require('node:assert/strict');
const {
    FeedbackInputError, validateFeedback, buildFeedbackMail, mailFeedback, MAX_FILE_BYTES
} = require('../server/feedback');

const b64 = text => Buffer.from(text).toString('base64');

function rejects(body, code) {
    assert.throws(() => validateFeedback(body), err => err instanceof FeedbackInputError && err.code === code);
}

test('validateFeedback trims the message and keeps page and device', () => {
    const f = validateFeedback({ message: '  hi \n', page: '/donate' }, 'Safari');
    assert.equal(f.message, 'hi');
    assert.equal(f.page, '/donate');
    assert.equal(f.device, 'Safari');
    assert.equal(f.email, null);
    assert.deepEqual(f.files, []);
});

test('validateFeedback refuses an empty or overlong message', () => {
    rejects({ message: '   ' }, 'empty');
    rejects({}, 'empty');
    rejects({ message: 'x'.repeat(10001) }, 'too_long');
});

test('validateFeedback refuses a malformed email but accepts none', () => {
    rejects({ message: 'hi', email: 'not an email' }, 'bad_email');
    assert.equal(validateFeedback({ message: 'hi', email: ' a@b.be ' }).email, 'a@b.be');
});

test('validateFeedback decodes files and cleans their names', () => {
    const f = validateFeedback({ message: 'hi', files: [{ name: '../../etc/pass wd', type: 'text/plain', data: b64('abc') }] });
    assert.equal(f.files.length, 1);
    assert.equal(f.files[0].name, '.._.._etc_pass_wd');
    assert.equal(f.files[0].content.toString(), 'abc');
});

test('validateFeedback caps the file count and their total size', () => {
    const one = { name: 'a', data: b64('a') };
    rejects({ message: 'hi', files: Array(6).fill(one) }, 'too_many_files');
    const half = Buffer.alloc(MAX_FILE_BYTES / 2 + 1).toString('base64');
    rejects({ message: 'hi', files: [{ name: 'a', data: half }, { name: 'b', data: half }] }, 'too_large');
});

test('buildFeedbackMail names the app, replies to the sender and attaches files', () => {
    const f = validateFeedback({ message: 'Rail is wrong\nmore', email: 'a@b.be', page: '/', files: [{ name: 'x.png', data: b64('png') }] }, 'UA');
    const mail = buildFeedbackMail(f, { FEEDBACK_EMAIL_TO: 'one@x.be, two@x.be' });
    assert.equal(mail.subject, '[Lilai] Feedback: Rail is wrong');
    assert.deepEqual(mail.to, ['one@x.be', 'two@x.be']);
    assert.equal(mail.reply_to, 'a@b.be');
    assert.match(mail.text, /From: a@b\.be/);
    assert.deepEqual(mail.attachments, [{ filename: 'x.png', content: b64('png') }]);
});

test('buildFeedbackMail falls back to the Lilai inbox and an anonymous sender', () => {
    const mail = buildFeedbackMail(validateFeedback({ message: 'hi' }), {});
    assert.deepEqual(mail.to, ['lilai@fisherkuan.com']);
    assert.equal(mail.reply_to, undefined);
    assert.match(mail.text, /From: anonymous/);
});

test('mailFeedback does nothing without RESEND_API_KEY', async () => {
    let called = false;
    const sent = await mailFeedback(validateFeedback({ message: 'hi' }), {}, () => { called = true; });
    assert.equal(sent, false);
    assert.equal(called, false);
});

test('mailFeedback posts to Resend with the key', async () => {
    let request;
    const fakeFetch = async (url, init) => {
        request = { url, init };
        return { ok: true };
    };
    const sent = await mailFeedback(validateFeedback({ message: 'hi' }), { RESEND_API_KEY: 'k' }, fakeFetch);
    assert.equal(sent, true);
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.equal(request.init.headers.Authorization, 'Bearer k');
    assert.equal(JSON.parse(request.init.body).subject, '[Lilai] Feedback: hi');
});
