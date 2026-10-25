const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/sprites.js'), 'utf8');

function load(stored = {}) {
    const store = new Map(Object.entries(stored));
    const window = { localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) } };
    const context = { window, document: { querySelectorAll: () => [], querySelector: () => null, readyState: 'complete' } };
    vm.createContext(context);
    vm.runInContext(SRC, context);
    return context.window.Sprites;
}

test('every header sprite draws on a 16x16 grid with its own colours', () => {
    const Sprites = load();
    for (const name of ['star', 'question', 'coin', 'head', 'ghost', 'goomba']) {
        const svg = Sprites.svg(name);
        assert.match(svg, /viewBox="0 0 16 16"/, name);
        assert.doesNotMatch(svg, /fill="undefined"/, `${name} uses a letter missing from its palette`);
        const squares = [...svg.matchAll(/M(\d+) (\d+)h1/g)].map(m => [Number(m[1]), Number(m[2])]);
        assert.ok(squares.length > 40, name);
        assert.ok(squares.every(([x, y]) => x < 16 && y < 16), `${name} spills off the grid`);
    }
});

test('an unknown sprite draws nothing', () => {
    assert.strictEqual(load().svg('mushroom'), '');
});

function fakeLink() {
    const attrs = {};
    const classes = new Set();
    return {
        dataset: {}, title: '', innerHTML: '', textContent: '', attrs,
        setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; },
        classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: c => classes.has(c) }
    };
}

test('a header link shows its sprite by default and its short word in text mode', () => {
    const icons = fakeLink();
    load().iconize(icons, 'goomba', 'Report a bug', 'Bug');
    assert.match(icons.innerHTML, /class="sprite"/);
    assert.strictEqual(icons.attrs['aria-label'], 'Report a bug');
    assert.ok(icons.classList.has('hdr-icon'));

    const text = fakeLink();
    load({ 'lilai.headerStyle': 'text' }).iconize(text, 'goomba', 'Report a bug', 'Bug');
    assert.strictEqual(text.textContent, 'Bug');
    assert.strictEqual(text.attrs['aria-label'], 'Report a bug');
    assert.ok(text.classList.has('hdr-text'));

    const bug = fakeLink();
    load({ 'lilai.headerStyle': 'text' }).iconize(bug, 'goomba', 'Report a bug', 'Bug', '<svg class="line"></svg>');
    assert.strictEqual(bug.innerHTML, '<svg class="line"></svg>');
    assert.ok(bug.classList.has('hdr-glyph') && !bug.classList.has('hdr-text'));
});
