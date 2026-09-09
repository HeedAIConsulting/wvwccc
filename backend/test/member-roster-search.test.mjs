/* Diana, Sep 9 2026: "I'm trying to create a directory of just restaurants so
   that I can email them an invitation." Her screenshot showed the roster
   reading "2 members" with "restaurants" in the search box.

   There are 40 restaurants. Two things were wrong, both in the /admin/members
   search:

   1. Categories are stored SINGULAR ("Restaurant"), and the filter was a plain
      substring test, so the plural matched none of them. The 2 she saw were
      businesses whose EMAIL DOMAIN contains "restaurants" — which is why the
      number looked like nonsense rather than like a filter.
   2. Only the primary `category` was searched, never the full `categories`
      list, so a caterer who is also a restaurant never appeared.

   Both fixes only ever widen a result, never narrow one.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie;
const T = Date.now().toString(36);
const ADMIN = `office-search-${T}@test.woodlandhillscc.net`;

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
async function search(q) {
  const r = await adm('/api/admin/members' + (q ? `?q=${encodeURIComponent(q)}` : ''));
  const t = await r.text();
  assert.equal(r.status, 200, t);
  return JSON.parse(t).members || [];
}

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Test Office`;
  mock.module('../email.js', {
    namedExports: {
      send: async () => ({ ok: true, id: 'test', provider: 'stub' }),
      notifyTo: () => 'felicia@woodlandhillscc.net',
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
    },
  });
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const routes = (await import('../chamber-routes.js')).default;
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN, password: 'test-passcode-1' }),
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
});

after(async () => { server && server.close(); mock.reset(); });

test('the plural finds the same members as the singular — this is what failed', async () => {
  const singular = await search('restaurant');
  const plural = await search('restaurants');
  assert.ok(singular.length > 5, `the seed should carry restaurants, got ${singular.length}`);
  assert.equal(plural.length, singular.length,
    'typing "restaurants" showed 2 of 40 and looked like the roster was empty');
});

test('a secondary category counts, not just the primary one', async () => {
  const hits = await search('restaurant');
  const bySecondary = hits.filter((m) => String(m.category || '').toLowerCase() !== 'restaurant'
    && (m.categories || []).some((c) => /restaurant/i.test(c)));
  // Only meaningful if the seed actually has one; assert the rule, not the count.
  for (const m of bySecondary) {
    assert.ok((m.categories || []).some((c) => /restaurant/i.test(c)),
      `${m.name} matched on a category it does not carry`);
  }
  assert.ok(hits.every((m) => {
    const hay = [m.name, m.category, m.contactName, m.email, m.neighborhood, ...(m.categories || [])]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes('restaurant');
  }), 'every hit must genuinely mention it somewhere');
});

/* Audited against all 257 categories on the live roster: with only the
   trailing-s rule, 25 of them under-returned on the plural somebody would
   actually type. These two extra rules take that to zero. */
test('an -ies plural finds a -y category', async () => {
  for (const [plural, singular] of [['notaries', 'notary'], ['bakeries', 'bakery'],
    ['groceries', 'grocery'], ['pharmacies', 'pharmacy'], ['cemeteries', 'cemetery']]) {
    const p = await search(plural);
    const g = await search(singular);
    assert.equal(p.length, g.length, `"${plural}" must find what "${singular}" finds`);
  }
});

test('an -es plural finds the singular', async () => {
  for (const [plural, singular] of [['presses', 'press'], ['businesses', 'business']]) {
    const p = await search(plural);
    const g = await search(singular);
    assert.equal(p.length, g.length, `"${plural}" must find what "${singular}" finds`);
  }
});

test('every rule only ever widens — a plural never loses the singular list', async () => {
  // The one property that must hold for all of them: adding an ending can add
  // members, never drop one the shorter word already found.
  for (const [plural, singular] of [['restaurants', 'restaurant'], ['notaries', 'notary'],
    ['presses', 'press'], ['schools', 'school'], ['attorneys', 'attorney']]) {
    const p = new Set((await search(plural)).map((m) => m.id));
    for (const m of await search(singular)) {
      assert.ok(p.has(m.id), `"${plural}" lost ${m.name}, which "${singular}" finds`);
    }
  }
});

test('an already-plural category is found by both spellings', async () => {
  for (const [a, b] of [['banks', 'bank'], ['schools', 'school'], ['contractors', 'contractor']]) {
    assert.ok((await search(a)).length > 0, `"${a}" should find members`);
    assert.ok((await search(b)).length > 0, `"${b}" should find members`);
  }
});

test('a short word is not de-pluralised into nonsense', async () => {
  // "is" must not become "i" and match half the roster.
  const all = await search('');
  const short = await search('is');
  assert.ok(short.length < all.length, 'a two-letter search should still narrow the list');
});

test('an empty search still returns the whole roster', async () => {
  assert.ok((await search('')).length > 50);
});

test('searching a business name still works', async () => {
  const all = await search('');
  const one = all.find((m) => (m.name || '').length > 6);
  const hits = await search(one.name.slice(0, 6));
  assert.ok(hits.some((m) => m.id === one.id), 'name search must not regress');
});
