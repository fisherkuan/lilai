const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/sprites.js'), 'utf8');

function load() {
    const context = { window: {}, document: { querySelectorAll: () => [] } };
    vm.createContext(context);
    vm.runInContext(SRC, context);
    return context.window.Sprites;
}

test('every header sprite draws on a 16x16 grid with its own colours', () => {
    const Sprites = load();
    for (const name of ['star', 'question', 'coin', 'head', 'goomba']) {
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
