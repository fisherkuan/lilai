const test = require('node:test');
const assert = require('node:assert/strict');
const { listHtml, displayLabel, normalizeUrl, safeUrl } = require('../public/js/event-links');

test('a link shows its name, else its site', () => {
    assert.equal(displayLabel({ url: 'https://forms.gle/x', label: 'Sign-up' }), 'Sign-up');
    assert.equal(displayLabel({ url: 'https://www.meetup.com/x' }), 'meetup.com');
});

test('a typed address gets https://, a scheme is kept', () => {
    assert.equal(normalizeUrl(' forms.gle/abc '), 'https://forms.gle/abc');
    assert.equal(normalizeUrl('http://a.be'), 'http://a.be');
    assert.equal(normalizeUrl(''), '');
    assert.equal(safeUrl(normalizeUrl('javascript:alert(1)')), null);
});

test('only web links reach the page, escaped', () => {
    assert.equal(listHtml([]), '');
    assert.equal(listHtml(undefined), '');
    const html = listHtml([
        { url: 'https://a.be/?q="x"', label: '<b>Map</b>' },
        { url: 'javascript:alert(1)', label: 'bad' }
    ]);
    assert.match(html, /&lt;b&gt;Map&lt;\/b&gt;/);
    assert.doesNotMatch(html, /javascript/);
    assert.match(html, /href="https:\/\/a\.be\/\?q=%22x%22"/);
    assert.equal((html.match(/<li>/g) || []).length, 1);
});
