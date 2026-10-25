const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '../public');
// The link is drawn by account-link.js, which every page with the header loads.
const ACCOUNT_LINK_JS = fs.readFileSync(path.join(PUBLIC_DIR, 'js/account-link.js'), 'utf8');

/*
 * The header's Admin link shows only for a signed-in address the server calls an admin or a
 * booking organiser (GET /api/me/roles). A device that never signed in asks nothing.
 */

// A DOM small enough to run account-link.js. roles: the /api/me/roles answer, or a status.
function makeHarness({ signedIn = null, roles = null, status = 200, stored = {} } = {}) {
    const navs = [{ name: 'header', children: [] }, { name: 'menu', children: [] }];
    navs.forEach(nav => {
        nav.querySelector = sel => nav.children.find(c => sel === '[data-admin-link]' && c.dataset.adminLink) || null;
        nav.appendChild = el => {
            el.remove = () => nav.children.splice(nav.children.indexOf(el), 1);
            nav.children.push(el);
        };
    });
    const store = new Map(Object.entries(stored));
    if (signedIn) store.set('lilai.signedIn', signedIn);
    const asked = [];
    const localStorage = {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k)
    };
    const context = {
        console,
        Promise,
        window: { localStorage },
        fetch: (url) => {
            asked.push(url);
            return Promise.resolve({ ok: status === 200, json: () => Promise.resolve(roles || {}) });
        },
        document: {
            querySelectorAll: sel => (sel === '.masthead' ? navs : []),
            createElement: () => ({ dataset: {}, href: '', textContent: '' })
        }
    };
    context.navs = navs;
    context.store = store;
    context.asked = asked;
    return context;
}

async function run(context) {
    vm.createContext(context);
    vm.runInContext(ACCOUNT_LINK_JS, context);
    await new Promise(r => setImmediate(r));
    return context.navs.flatMap(nav => nav.children);
}

test('a device that never signed in asks nothing and shows no admin link', async () => {
    const ctx = makeHarness();
    assert.deepStrictEqual(await run(ctx), []);
    assert.deepStrictEqual(ctx.asked, []);
});

test('a signed-in organiser sees Admin, to the booking queue, in every header', async () => {
    const ctx = makeHarness({ signedIn: 'ann@lilai.test', roles: { admin: false, organizer: true } });
    const links = await run(ctx);
    assert.deepStrictEqual(ctx.asked, ['/api/me/roles']);
    assert.strictEqual(links.length, 2);
    links.forEach(a => assert.strictEqual(a.href, '/admin/bookings'));
});

test('a signed-in address that is neither gets no link', async () => {
    const ctx = makeHarness({ signedIn: 'bob@lilai.test', roles: { admin: false, organizer: false } });
    assert.deepStrictEqual(await run(ctx), []);
});

test('a stale sign-in note (the server says 401) gets no link', async () => {
    const ctx = makeHarness({ signedIn: 'bob@lilai.test', status: 401 });
    assert.deepStrictEqual(await run(ctx), []);
});

test('the retired organiser flag is cleared and opens nothing', async () => {
    const ctx = makeHarness({ stored: { lilaiOrganizer: '1' } });
    assert.deepStrictEqual(await run(ctx), []);
    assert.strictEqual(ctx.store.has('lilaiOrganizer'), false);
});

test('localStorage throwing (private browsing) degrades to no link, never to a crash', async () => {
    const ctx = makeHarness();
    ctx.window.localStorage = {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
        removeItem() { throw new Error('denied'); }
    };
    assert.deepStrictEqual(await run(ctx), []);
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
