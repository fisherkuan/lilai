const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlaceInput, PlaceInputError } = require('../server/places');

const fieldOf = (body) => {
    try { validatePlaceInput(body); } catch (error) { assert.ok(error instanceof PlaceInputError); return error.field; }
    return null;
};

test('a place needs a name; address, other names and a Google id are optional', () => {
    assert.deepEqual(validatePlaceInput({ name: ' TSH 1 ' }), { name: 'TSH 1', address: '', aliases: [], placeId: null });
    assert.equal(fieldOf({ name: '  ' }), 'name');
    assert.equal(fieldOf({ name: 'x'.repeat(256) }), 'name');
    assert.equal(fieldOf({ name: 'A', address: 'x'.repeat(256) }), 'address');
});

test('other names come as a comma list or an array, trimmed and without repeats', () => {
    assert.deepEqual(validatePlaceInput({ name: 'Gym', aliases: ' Gymnasium, ,Gym klein,Gymnasium ' }).aliases, ['Gymnasium', 'Gym klein']);
    assert.deepEqual(validatePlaceInput({ name: 'Gym', aliases: ['A', 'B'] }).aliases, ['A', 'B']);
    assert.equal(fieldOf({ name: 'Gym', aliases: Array.from({ length: 11 }, (_, i) => `n${i}`) }), 'aliases');
});

test('a Google Maps id is kept only when it looks like one', () => {
    assert.equal(validatePlaceInput({ name: 'Het Moment', placeId: 'ChIJabcdefghijk' }).placeId, 'ChIJabcdefghijk');
    assert.equal(fieldOf({ name: 'Het Moment', placeId: 'nope' }), 'placeId');
});
