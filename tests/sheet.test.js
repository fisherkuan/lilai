const test = require('node:test');
const assert = require('node:assert/strict');

const { settle } = require('../public/js/sheet');

const half = { full: false, height: 400 };
const full = { full: true, height: 800 };

test('a short slow drag puts the sheet back where it was', () => {
    assert.equal(settle({ ...half, dy: 30, velocity: 0.1 }), 'normal');
    assert.equal(settle({ ...half, dy: -30, velocity: -0.1 }), 'normal');
    assert.equal(settle({ ...full, dy: 40, velocity: 0.1 }), 'full');
});

test('dragging the grabber down far enough dismisses the sheet', () => {
    assert.equal(settle({ ...half, dy: 130, velocity: 0.1 }), 'dismiss');
    assert.equal(settle({ full: false, height: 200, dy: 60, velocity: 0.1 }), 'dismiss');
});

test('dragging it up fills the screen', () => {
    assert.equal(settle({ ...half, dy: -80, velocity: -0.1 }), 'full');
});

test('a flick counts as much as a long drag, in its own direction only', () => {
    assert.equal(settle({ ...half, dy: 20, velocity: 0.9 }), 'dismiss');
    assert.equal(settle({ ...half, dy: -20, velocity: -0.9 }), 'full');
    assert.equal(settle({ ...half, dy: -5, velocity: 0.9 }), 'normal');
});

test('from full screen, down goes back to the usual height before it dismisses', () => {
    assert.equal(settle({ ...full, dy: 120, velocity: 0.1 }), 'normal');
    assert.equal(settle({ ...full, dy: 30, velocity: 0.9 }), 'normal');
    assert.equal(settle({ ...full, dy: 500, velocity: 0.1 }), 'dismiss');
});
