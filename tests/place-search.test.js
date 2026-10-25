const test = require('node:test');
const assert = require('node:assert/strict');
const { rank } = require('../public/js/place-search');

const places = [
    { name: 'TSH 1', address: 'Topsporthal, Tervuursevest 101, 3001 Leuven' },
    { name: 'TSH 2', address: 'Topsporthal, Tervuursevest 101, 3001 Leuven' },
    { name: 'Topsporthal', address: 'Tervuursevest 101, 3001 Leuven', aliases: ['TSH'] },
    { name: 'GDN A', aliases: ['GDN grote zaal A'] },
    { name: 'Padel courts', address: 'USC Padelterreinen, 3001 Leuven', aliases: ['Padel'] },
    { name: "'t Celestijntje", address: 'Celestijnenlaan 19, 3001 Leuven' },
    { name: 'Baseball and cricket field', aliases: ['魯汶大學紅土棒球場'] },
    { name: 'Café Élan' }
];
const names = (q, limit) => rank(places, q, limit).map(p => p.name);

test('an empty search lists the places in the owner\'s order', () => {
    assert.deepEqual(names('', 3), ['TSH 1', 'TSH 2', 'Topsporthal']);
});

test('spaces and case do not matter, and the exact name comes first', () => {
    assert.equal(names('tsh1')[0], 'TSH 1');
    assert.equal(names('TSH 2')[0], 'TSH 2');
    assert.deepEqual(names('tsh').slice(0, 3), ['Topsporthal', 'TSH 1', 'TSH 2']); // its alias, typed in full
});

test('a name beats an address, and an address still finds the place', () => {
    assert.equal(names('topsport')[0], 'Topsporthal');
    assert.ok(names('celestijnenlaan').includes("'t Celestijntje"));
    assert.ok(names('usc').includes('Padel courts'));
});

test('aliases, accents, other scripts and words in any order', () => {
    assert.equal(names('grote zaal')[0], 'GDN A');
    assert.equal(names('cafe elan')[0], 'Café Élan');
    assert.equal(names('棒球')[0], 'Baseball and cricket field');
    assert.equal(names('cricket baseball')[0], 'Baseball and cricket field');
});

test('a word start beats a match inside a word', () => {
    assert.deepEqual(names('court'), ['Padel courts']);
    assert.deepEqual(names('cel'), ["'t Celestijntje"]); // no guesses beside a real match
});

test('letters in order still find a place; nonsense finds nothing', () => {
    assert.equal(names('pdl')[0], 'Padel courts');
    assert.deepEqual(names('zzzz'), []);
    assert.deepEqual(names('tsh3'), []); // no hall 3 here, and the addresses do not count loosely
});
