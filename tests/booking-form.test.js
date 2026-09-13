/*
 * The EasyForm client, tested against a saved snapshot of the real page.
 * No network: every response here is a fixture or a stub.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    FORM_URL, PREFIX, SUBMIT, FormChangedError, CookieJar,
    decodeEntities, parseForm, buildFields, buildPayload, encodeMultipart,
    classifyResponse, assertSafeRedirect, BookingFormClient, readFormOptions
} = require('../server/booking-form');
const { parseBrusselsWallTime } = require('../server/booking-time');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'form.fixture.html'), 'utf8');
// The real page KU Leuven answered a real accepted request with, on 2026-09-13 at
// 00:00:58 Brussels, captured by the Python reference. Contact details scrubbed.
const REAL_RECEIPT = fs.readFileSync(path.join(__dirname, 'thankspage.fixture.html'), 'utf8');

const THANKS_PAGE = `<!DOCTYPE html><html><body>
    <div class="easyform-thankspage portlet">
        <h1>Bedankt</h1><p>We hebben je aanvraag ontvangen.</p>
    </div>
</body></html>`;

function entry(overrides = {}) {
    return {
        name: 'Yuki Chen',
        email: 'yuki@student.kuleuven.be',
        phone: '+32 470 12 34 56',
        language: 'English',
        validSportsCard: true,
        sport: 'Badminton',
        players: 12,
        indoorOutdoor: 'Indoor',
        facility: '',
        otherFacility: '',
        durationHours: 2,
        remarks: '',
        startPreferred: parseBrusselsWallTime('2026-09-26', '18:00'),
        startAlternative: parseBrusselsWallTime('2026-09-26', '20:00'),
        ...overrides
    };
}

// --- Parsing --------------------------------------------------------------------------

test('the live form snapshot parses into the shape we submit against', () => {
    const form = parseForm(FIXTURE);
    assert.equal(form.found, true);
    assert.equal(form.action, FORM_URL);
    assert.equal(form.method, 'post');
    assert.equal(form.enctype, 'multipart/form-data');
    assert.equal(form.hidden._authenticator, 'fixture-token');
    assert.equal(form.thanks, false);
});

test('the hidden empty-markers are captured so they can be echoed back', () => {
    const form = parseForm(FIXTURE);
    for (const field of ['taal', 'ja-ik-heb-een-geldige-sportkaart', 'indoor-of-outdoor', 'sportveld', 'aantal-uren-1']) {
        assert.equal(form.hidden[`${PREFIX}${field}-empty-marker`], '1', `${field} marker missing`);
    }
});

test('choice values come from selects, radios and checkboxes alike', () => {
    const form = parseForm(FIXTURE);
    assert.deepEqual(form.choices[`${PREFIX}taal:list`], ['Nederlands', 'English']);
    assert.deepEqual(form.choices[`${PREFIX}aantal-uren-1:list`], ['1', '1.5', '2']);
    assert.deepEqual(form.choices[`${PREFIX}indoor-of-outdoor`], ['Indoor', 'Outdoor']);
    assert.deepEqual(form.choices[`${PREFIX}ja-ik-heb-een-geldige-sportkaart:list`], ['selected']);
    assert.ok(form.choices[`${PREFIX}sportveld`].includes('Andere / Other'));
});

test('entities in choice values are decoded, or the value would never match', () => {
    const form = parseForm(FIXTURE);
    assert.ok(form.choices[`${PREFIX}sportveld`].includes('B&C: Baseball- & Cricketveld / Baseball & Cricket field'));
    assert.equal(decodeEntities('A &amp; B &lt;x&gt; &#39;q&#39; &#x41;'), "A & B <x> 'q' A");
});

test('a ">" inside an attribute does not end the tag early', () => {
    const html = `<form id="form" action="${FORM_URL}" method="post" enctype="multipart/form-data">
        <input type="hidden" name="_authenticator" value="tok">
        <input type="radio" name="${PREFIX}sportveld" value="Hall > 3">
    </form>`;
    assert.deepEqual(parseForm(html).choices[`${PREFIX}sportveld`], ['Hall > 3']);
});

test('controls outside the booking form are ignored', () => {
    const html = `<input name="newsletter" value="x">
        <form id="form" action="${FORM_URL}" method="post" enctype="multipart/form-data">
            <input type="hidden" name="_authenticator" value="tok">
        </form>
        <form id="search"><input name="q"></form>`;
    const form = parseForm(html);
    assert.deepEqual(Object.keys(form.controls), ['_authenticator']);
});

test('the receipt marker is found even though no form remains', () => {
    const thanks = parseForm(THANKS_PAGE);
    assert.equal(thanks.thanks, true);
    assert.equal(thanks.found, false);
});

// --- Field construction ----------------------------------------------------------------

test('the field map matches the form widget names exactly', () => {
    const fields = buildFields(entry());
    assert.deepEqual(Object.keys(fields).sort(), [
        'aantal-spelers', 'aantal-uren-1:list', 'ander-sportveld-sportzaal',
        'indoor-of-outdoor', 'ja-ik-heb-een-geldige-sportkaart:list', 'naam',
        'opmerkingen', 'replyto', 'sportveld', 'taal:list',
        'telefoon-of-gsm-nummer', 'tijdstip-voorkeur-1', 'tijdstip-voorkeur-2', 'welke-sport'
    ].map((name) => PREFIX + name).sort());
});

test('both start times go out as local wall time with no offset', () => {
    const fields = buildFields(entry());
    assert.equal(fields[`${PREFIX}tijdstip-voorkeur-1`], '2026-09-26T18:00');
    assert.equal(fields[`${PREFIX}tijdstip-voorkeur-2`], '2026-09-26T20:00');
});

test('duration is formatted to match the option values, not the database type', () => {
    // Postgres hands back NUMERIC as "2.0"; the form only accepts "2".
    assert.equal(buildFields(entry({ durationHours: '2.0' }))[`${PREFIX}aantal-uren-1:list`], '2');
    assert.equal(buildFields(entry({ durationHours: 1.5 }))[`${PREFIX}aantal-uren-1:list`], '1.5');
    assert.equal(buildFields(entry({ durationHours: '1.0' }))[`${PREFIX}aantal-uren-1:list`], '1');
});

test('the sports-card checkbox carries the declaration, or nothing', () => {
    assert.equal(buildFields(entry())[`${PREFIX}ja-ik-heb-een-geldige-sportkaart:list`], 'selected');
    assert.equal(buildFields(entry({ validSportsCard: false }))[`${PREFIX}ja-ik-heb-een-geldige-sportkaart:list`], '');
});

test('a POST is never built without the second preferred time', () => {
    assert.throws(() => buildFields(entry({ startAlternative: null })), /second preferred time is required/);
});

// --- Payload guards ---------------------------------------------------------------------

test('a complete payload carries our values, the hidden fields and the submit button', () => {
    const form = parseForm(FIXTURE);
    const payload = buildPayload(form, buildFields(entry({ facility: 'TSH Unit 3' })));
    assert.equal(payload._authenticator, 'fixture-token');
    assert.equal(payload[SUBMIT], 'Verzenden');
    assert.equal(payload[`${PREFIX}sportveld`], 'TSH Unit 3');
    assert.equal(payload[`${PREFIX}taal-empty-marker`], '1');
});

test('"no preference" means the facility field is absent, not blank', () => {
    const form = parseForm(FIXTURE);
    const payload = buildPayload(form, buildFields(entry({ facility: '' })));
    assert.equal(`${PREFIX}sportveld` in payload, false);
});

test('a missing security token stops the submission', () => {
    const form = parseForm(FIXTURE);
    delete form.hidden._authenticator;
    assert.throws(() => buildPayload(form, buildFields(entry())), FormChangedError);
    assert.throws(() => buildPayload(form, buildFields(entry())), /security token/);
});

test('a changed endpoint, method or encoding stops the submission', () => {
    for (const change of [{ action: 'https://example.com/' }, { method: 'get' }, { enctype: 'application/x-www-form-urlencoded' }, { found: false }]) {
        const form = { ...parseForm(FIXTURE), ...change };
        assert.throws(() => buildPayload(form, buildFields(entry())), FormChangedError,
            `${JSON.stringify(change)} should have been refused`);
    }
});

test('a new field on the form stops the submission and names it', () => {
    const form = parseForm(FIXTURE);
    form.controls[`${PREFIX}rijksregisternummer`] = { name: 'x', type: 'text' };
    assert.throws(() => buildPayload(form, buildFields(entry())),
        /New form controls require review: form\.widgets\.rijksregisternummer/);
});

test('a field that disappeared stops the submission', () => {
    const form = parseForm(FIXTURE);
    delete form.controls[`${PREFIX}welke-sport`];
    assert.throws(() => buildPayload(form, buildFields(entry())), /Form field changed: form\.widgets\.welke-sport/);
});

test('a value the form does not offer stops the submission', () => {
    const form = parseForm(FIXTURE);
    assert.throws(() => buildPayload(form, buildFields(entry({ facility: 'Court 9 3/4' }))),
        /Invalid choice for form\.widgets\.sportveld: Court 9 3\/4/);
    assert.throws(() => buildPayload(form, buildFields(entry({ language: 'Français' }))),
        /Invalid choice for form\.widgets\.taal:list/);
    assert.throws(() => buildPayload(form, buildFields(entry({ durationHours: 3 }))),
        /Invalid choice for form\.widgets\.aantal-uren-1:list/);
});

test('the reset button is never sent', () => {
    const form = parseForm(FIXTURE);
    const payload = buildPayload(form, buildFields(entry()));
    assert.equal('form.buttons.reset' in payload, false);
});

// --- Wire format --------------------------------------------------------------------------

test('multipart encoding matches the wire format byte for byte', () => {
    const { body, contentType } = encodeMultipart({ a: '1', b: 'hé' }, 'FIXED');
    const boundary = '----LilaiBookingFIXED';
    assert.equal(contentType, `multipart/form-data; boundary=${boundary}`);
    assert.equal(body.toString('utf8'),
        `--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n`
        + `--${boundary}\r\nContent-Disposition: form-data; name="b"\r\n\r\nhé\r\n`
        + `--${boundary}--\r\n`);
});

test('non-ASCII values are measured in bytes, not characters', () => {
    const { body } = encodeMultipart({ naam: '林小明' }, 'FIXED');
    assert.ok(body.includes(Buffer.from('林小明', 'utf8')));
    assert.ok(body.length > '林小明'.length);
});

test('a field name that could forge a part boundary is refused', () => {
    assert.throws(() => encodeMultipart({ 'a"\r\nX': '1' }), /Invalid field name/);
});

// --- Reading the answer ---------------------------------------------------------------------

test('a receipt is 2xx, the marker, and no form left behind', () => {
    assert.equal(classifyResponse(200, THANKS_PAGE), 'sent');
});

test('the form coming back means it was not accepted', () => {
    // EasyForm answers validation errors with HTTP 200 and the form again.
    assert.equal(classifyResponse(200, FIXTURE), 'failed');
});

test('a 2xx with neither marker nor form is not a receipt', () => {
    assert.equal(classifyResponse(200, '<html><body>Onderhoud</body></html>'), 'failed');
});

test('error statuses are failures even if the page looks like a thank-you', () => {
    assert.equal(classifyResponse(500, THANKS_PAGE), 'failed');
    assert.equal(classifyResponse(403, THANKS_PAGE), 'failed');
});

/*
 * THANKS_PAGE above is a hand-written stand-in. This one is the page KU Leuven actually
 * returned for an accepted request. It is the only evidence we have of what success
 * really looks like, so the classifier is held to it directly: if a KU Leuven redesign
 * ever breaks the reading, this is the test that says so.
 */
test('the real accepted response from KU Leuven reads as a receipt', () => {
    const parsed = parseForm(REAL_RECEIPT);
    assert.equal(parsed.thanks, true, 'the thankspage marker is present');
    assert.equal(parsed.found, false, 'no form is left on the page');
    assert.equal(classifyResponse(200, REAL_RECEIPT), 'sent');
    assert.equal(classifyResponse(500, REAL_RECEIPT), 'failed');
});

/*
 * The receipt echoes the submitted values back as read-only spans, not inputs. That is
 * exactly why `found` must mean "a form with controls", not "the string form appears":
 * a looser parser would see these and call a genuine success a failure.
 */
test('the echoed values on the receipt are not mistaken for a form', () => {
    assert.match(REAL_RECEIPT, /id="form-widgets-naam"/);
    assert.equal(parseForm(REAL_RECEIPT).found, false);
});

// --- Redirects ---------------------------------------------------------------------------

test('redirects off the origin or off https are refused', () => {
    assert.equal(assertSafeRedirect('/sport/formulieren/ok', FORM_URL, 'GET').host, 'www.kuleuven.be');
    assert.throws(() => assertSafeRedirect('https://evil.example/x', FORM_URL, 'GET'), /another origin/);
    assert.throws(() => assertSafeRedirect('http://www.kuleuven.be/x', FORM_URL, 'GET'), /another origin/);
});

test('a POST is never replayed after a redirect', () => {
    assert.throws(() => assertSafeRedirect('/somewhere', FORM_URL, 'POST'), /Refusing to replay POST/);
});

// --- The client --------------------------------------------------------------------------

function stubResponse({ status = 200, body = '', headers = {} } = {}) {
    const setCookie = headers['set-cookie'] ? [].concat(headers['set-cookie']) : [];
    return {
        status,
        headers: {
            get: (name) => headers[name.toLowerCase()] ?? null,
            getSetCookie: () => setCookie
        },
        text: async () => body
    };
}

test('a body that stalls after the headers is abandoned by the same timer', async () => {
    const fetchImpl = async (url, init) => ({
        status: 200,
        headers: { get: () => null, getSetCookie: () => [] },
        // Headers answered; the body never comes — unless the signal fires, as a real body would.
        text: () => new Promise((resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        })
    });

    const client = new BookingFormClient({ fetchImpl, timeoutMs: 20 });
    await assert.rejects(client.request(FORM_URL, { method: 'GET', headers: {} }), /aborted/);
});

test('the session cookie from the GET is carried into the POST', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
        seen.push({ method: init.method, cookie: init.headers.Cookie ?? null });
        return init.method === 'GET'
            ? stubResponse({ body: FIXTURE, headers: { 'set-cookie': ['__ac=abc123; Path=/; HttpOnly'] } })
            : stubResponse({ body: THANKS_PAGE });
    };

    const client = new BookingFormClient({ fetchImpl });
    const form = await client.getForm();
    const result = await client.submit(form, buildFields(entry()));

    assert.equal(seen[0].cookie, null, 'the first request has no cookie yet');
    assert.equal(seen[1].cookie, '__ac=abc123', 'the POST must carry the session');
    assert.equal(result.outcome, 'sent');
    assert.equal(result.status, 200);
});

test('the POST is multipart, same-URL, with a matching Origin', async () => {
    let posted = null;
    const fetchImpl = async (url, init) => {
        if (init.method === 'POST') {
            posted = { url, init };
            return stubResponse({ body: THANKS_PAGE });
        }
        return stubResponse({ body: FIXTURE });
    };
    const client = new BookingFormClient({ fetchImpl });
    await client.submit(await client.getForm(), buildFields(entry()));

    assert.equal(posted.url, FORM_URL);
    assert.match(posted.init.headers['Content-Type'], /^multipart\/form-data; boundary=----LilaiBooking/);
    assert.equal(posted.init.headers.Origin, 'https://www.kuleuven.be');
    assert.equal(posted.init.headers.Referer, FORM_URL);
    assert.ok(posted.init.body.includes(Buffer.from('fixture-token', 'utf8')), 'the fresh token must be sent');
});

test('a redirected POST throws rather than sending twice', async () => {
    let posts = 0;
    const fetchImpl = async (url, init) => {
        if (init.method === 'POST') {
            posts += 1;
            return stubResponse({ status: 307, headers: { location: '/sport/formulieren/elders' } });
        }
        return stubResponse({ body: FIXTURE });
    };
    const client = new BookingFormClient({ fetchImpl });
    const form = await client.getForm();
    await assert.rejects(() => client.submit(form, buildFields(entry())), /Refusing to replay POST/);
    assert.equal(posts, 1, 'the request must not be repeated');
});

test('a GET redirect within the site is followed', async () => {
    let hops = 0;
    const fetchImpl = async (url) => {
        hops += 1;
        return hops === 1
            ? stubResponse({ status: 302, headers: { location: '/sport/formulieren/reservatie-sportinfrastructuur' } })
            : stubResponse({ body: FIXTURE });
    };
    const client = new BookingFormClient({ fetchImpl });
    assert.equal((await client.getForm()).hidden._authenticator, 'fixture-token');
    assert.equal(hops, 2);
});

test('a cookie jar keeps the latest value per name', () => {
    const jar = new CookieJar();
    jar.store(['a=1; Path=/', 'b=2']);
    jar.store(['a=3']);
    assert.equal(jar.header(), 'a=3; b=2');
});

test('the sheet pickers are read from the live form, not hard-coded', () => {
    const options = readFormOptions(parseForm(FIXTURE));
    assert.deepEqual(options.languages, ['Nederlands', 'English']);
    assert.deepEqual(options.durations, [1, 1.5, 2]);
    assert.deepEqual(options.placements, ['Indoor', 'Outdoor']);
    assert.equal(options.facilities.length, 18);
    assert.ok(options.facilities.includes('Andere / Other'));
});

test('reading options from a page with no form is refused', () => {
    assert.throws(() => readFormOptions(parseForm(THANKS_PAGE)), FormChangedError);
});
