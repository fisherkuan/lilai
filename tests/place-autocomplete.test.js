const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaceAutocomplete } = require('../server/place-autocomplete');

const answer = {
    suggestions: [
        { placePrediction: { placeId: 'ChIJmoment01', text: { text: 'Het Moment, Leuven' }, structuredFormat: { mainText: { text: 'Het Moment' }, secondaryText: { text: 'Bondgenotenlaan 1, Leuven' } } } },
        { queryPrediction: { text: { text: 'het moment leuven' } } }
    ]
};

function stub(body = answer, status = 200) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return { ok: status < 400, status, json: async () => body };
    };
    return { calls, fetchImpl };
}

test('off without a key, and too short a query asks nothing', async () => {
    const { calls, fetchImpl } = stub();
    assert.equal(createPlaceAutocomplete({ fetchImpl }).enabled, false);
    assert.deepEqual(await createPlaceAutocomplete({ fetchImpl }).search('het moment'), []);
    assert.deepEqual(await createPlaceAutocomplete({ apiKey: 'k', fetchImpl }).search('h'), []);
    assert.equal(calls.length, 0);
});

test('asks Places Autocomplete near Leuven and keeps name, address and id', async () => {
    const { calls, fetchImpl } = stub();
    const places = createPlaceAutocomplete({ apiKey: 'k', fetchImpl });
    const results = await places.search(' Het moment ', { sessionToken: 'a1b2c3d4-e5f6' });
    assert.deepEqual(results, [{ name: 'Het Moment', address: 'Bondgenotenlaan 1, Leuven', placeId: 'ChIJmoment01' }]);
    assert.equal(calls[0].url, 'https://places.googleapis.com/v1/places:autocomplete');
    assert.equal(calls[0].init.headers['X-Goog-Api-Key'], 'k');
    assert.equal(calls[0].body.input, 'Het moment');
    assert.equal(calls[0].body.sessionToken, 'a1b2c3d4-e5f6');
    assert.ok(calls[0].body.locationBias.circle.radius > 0);
});

test('names the site as Referer when given, for a key restricted to the website', async () => {
    const { calls, fetchImpl } = stub();
    await createPlaceAutocomplete({ apiKey: 'k', referer: 'https://lilai.fisherkuan.com/', fetchImpl }).search('het moment');
    assert.equal(calls[0].init.headers.Referer, 'https://lilai.fisherkuan.com/');
    await createPlaceAutocomplete({ apiKey: 'k', fetchImpl }).search('het moment');
    assert.equal(calls[1].init.headers.Referer, undefined);
});

test('the same query is answered from the cache', async () => {
    const { calls, fetchImpl } = stub();
    const places = createPlaceAutocomplete({ apiKey: 'k', fetchImpl });
    await places.search('het moment');
    await places.search('HET MOMENT');
    assert.equal(calls.length, 1);
});

test('one caller gets thirty searches a minute', async () => {
    const { calls, fetchImpl } = stub();
    let t = 0;
    const places = createPlaceAutocomplete({ apiKey: 'k', fetchImpl, now: () => t });
    for (let i = 0; i < 31; i += 1) await places.search(`query ${i}`, { caller: 'a' });
    assert.equal(calls.length, 30);
    await places.search('another', { caller: 'b' });
    assert.equal(calls.length, 31);
    t = 61000;
    await places.search('next minute', { caller: 'a' });
    assert.equal(calls.length, 32);
});

test('a refused call throws', async () => {
    const { fetchImpl } = stub({}, 403);
    await assert.rejects(createPlaceAutocomplete({ apiKey: 'k', fetchImpl }).search('het moment'), /403/);
});
