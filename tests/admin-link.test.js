const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '../public');
const APP_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');

/*
 * The organizer entry point is obscurity, not access control: the admin pages are
 * deliberately ungated. The whole design rests on one property — the path never reaches a
 * casual visitor — so these tests pin that property rather than the cosmetics of the link.
 */

// A DOM small enough to run setupAdminLink and nothing else.
function makeHarness({ search = '', stored = null } = {}) {
    const navs = [{ name: 'header', children: [] }, { name: 'menu', children: [] }];
    navs.forEach(nav => {
        nav.querySelector = sel => nav.children.find(c => sel === '[data-admin-link]' && c.dataset.adminLink) || null;
        nav.appendChild = el => nav.children.push(el);
    });

    const store = new Map();
    if (stored !== null) store.set('lilaiOrganizer', stored);

    const replaced = [];
    const context = {
        console,
        URLSearchParams,
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k)
        },
        window: { location: { search, pathname: '/index.html' } },
        history: { replaceState: (a, b, url) => replaced.push(url) },
        document: {
            querySelectorAll: () => navs,
            createElement: () => ({ dataset: {}, href: '', textContent: '' })
        }
    };
    context.navs = navs;
    context.store = store;
    context.replaced = replaced;
    return context;
}

function runSetup(context) {
    const start = APP_JS.indexOf('const ADMIN_HOME');
    const end = APP_JS.indexOf('// ---------- Load events ----------');
    assert.ok(start > -1 && end > start, 'organizer block not found in app.js');
    vm.createContext(context);
    vm.runInContext(APP_JS.slice(start, end) + '\nsetupAdminLink();', context);
    return context.navs.flatMap(nav => nav.children);
}

test('a plain visit on a fresh device grows no admin link', () => {
    const links = runSetup(makeHarness());
    assert.deepStrictEqual(links, []);
});

test('?admin=1 reveals the link in both navs and remembers the device', () => {
    const ctx = makeHarness({ search: '?admin=1' });
    const links = runSetup(ctx);
    assert.strictEqual(links.length, 2);
    links.forEach(link => {
        assert.strictEqual(link.href, '/admin/events');
        assert.strictEqual(link.textContent, 'Admin');
    });
    assert.strictEqual(ctx.store.get('lilaiOrganizer'), '1');
});

test('the switch is stripped from the address bar so a shared URL does not carry it', () => {
    const ctx = makeHarness({ search: '?admin=1&timeRange=all' });
    runSetup(ctx);
    assert.deepStrictEqual(ctx.replaced, ['/index.html?timeRange=all']);
});

test('a remembered device keeps the link on later plain visits', () => {
    const links = runSetup(makeHarness({ stored: '1' }));
    assert.strictEqual(links.length, 2);
});

test('?admin=0 forgets the device and hides the link again', () => {
    const ctx = makeHarness({ search: '?admin=0', stored: '1' });
    const links = runSetup(ctx);
    assert.deepStrictEqual(links, []);
    assert.strictEqual(ctx.store.has('lilaiOrganizer'), false);
});

test('localStorage throwing (private browsing) degrades to no link, never to a crash', () => {
    const ctx = makeHarness();
    ctx.localStorage = {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
        removeItem() { throw new Error('denied'); }
    };
    assert.deepStrictEqual(runSetup(ctx), []);
});

test('no public HTML page leaks the admin path to view-source or a crawler', () => {
    const pages = fs.readdirSync(PUBLIC_DIR).filter(f => f.endsWith('.html') && !f.startsWith('admin'));
    assert.ok(pages.length > 0, 'expected public HTML pages to check');
    for (const page of pages) {
        const html = fs.readFileSync(path.join(PUBLIC_DIR, page), 'utf8');
        assert.ok(!/\/admin\b/.test(html), `${page} hard-codes an /admin link; the entry point must stay JS-injected`);
    }
});

test('the admin pages themselves ask crawlers to stay away', () => {
    const pages = fs.readdirSync(PUBLIC_DIR).filter(f => f.startsWith('admin') && f.endsWith('.html'));
    assert.ok(pages.length > 0, 'expected admin HTML pages to check');
    for (const page of pages) {
        const html = fs.readFileSync(path.join(PUBLIC_DIR, page), 'utf8');
        assert.match(html, /<meta name="robots" content="noindex/, `${page} is missing its noindex meta`);
    }
});
