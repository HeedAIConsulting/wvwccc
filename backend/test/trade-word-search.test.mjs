/* Felicia, Sep 16 2026: "When we look up the word Plumber on the directory it
   only shows 3 of our members. When we type in plumbing, it show them all."

   The categories are trades — Plumbing, Catering, Roofing — and members search
   for the tradesperson. Neither spelling contains the other, so no substring
   test can connect them; the three she got were the businesses with "plumber"
   typed into their keywords by hand.

   The fix pairs -er/-ers with -ing in both directions. It is a derivation, not
   a stem, and that is the whole point: an earlier attempt matched any field
   beginning "clean" and returned eight dentists, because "teeth cleaning" sits
   in their keywords. Pairing the two spellings makes "cleaner" return exactly
   what "cleaning" already returns — they agree, and nothing new is invented.

   Measured against the live roster before shipping: plumber 3 -> 6 (matching
   "plumbing" exactly), caterer 0 -> 7, roofer 0 -> 2.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';

const ROOT = new URL('../../', import.meta.url);
const chamber = readFileSync(new URL('js/chamber.js', ROOT), 'utf8');

// The real shipped derivation, lifted out of the scorer by name.
const src = chamber.slice(chamber.indexOf('function tradeForms(w)'));
const tradeForms = new Function(`${src.slice(0, src.indexOf('\n    }') + 6)}; return tradeForms;`)();

test('a tradesperson finds the trade, and the trade finds the tradesperson', () => {
  assert.deepEqual(tradeForms('plumber'), ['plumbing', 'plumbers']);
  assert.deepEqual(tradeForms('plumbing'), ['plumber', 'plumbers']);
  assert.deepEqual(tradeForms('caterers'), ['catering', 'caterer']);
  assert.ok(tradeForms('roofer').includes('roofing'));
  assert.ok(tradeForms('printing').includes('printer'));
});

test('short words are left alone', () => {
  // "other" -> "oth" and "water" -> "wat" are not word roots, they are noise.
  for (const w of ['other', 'water', 'paper', 'over', 'ring']) {
    assert.deepEqual(tradeForms(w), [], `${w} should not be split`);
  }
});

test('a word with no -er/-ing ending gets nothing', () => {
  for (const w of ['restaurant', 'dentist', 'hotel', 'plumb']) assert.deepEqual(tradeForms(w), []);
});

test('the public scorer tries the twin, and only widens', () => {
  const at = chamber.indexOf('function scoreOf(m)');
  const fn = chamber.slice(at, chamber.indexOf('function render()', at));
  assert.match(fn, /const forms = \[w, \.\.\.tradeForms\(w\)\]/);
  assert.match(fn, /best = Math\.max\(best, scoreIn\(f, wb, fields\)\)/,
    'the best form wins, so a word that already matched scores exactly as before');
  assert.match(fn, /if \(best === 0\) return -1;/,
    'a word that matches no curated field on ANY form is still not a result');
});

/* ── and the same question asked of the server ── */

let server, base, cookie;
const T = Date.now().toString(36);
const ADMIN = `trade-admin-${T}@test.woodlandhillscc.net`;
const adm = (p) => fetch(base + p, { headers: { cookie } });

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Trade Test`;
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

test('the admin roster agrees with itself on both spellings', async () => {
  const names = async (q) => ((await (await adm('/api/admin/members?q=' + encodeURIComponent(q))).json()).members || [])
    .map((m) => m.id).sort();
  const trade = await names('plumbing');
  const person = await names('plumber');
  assert.ok(trade.length > 0, 'the seed roster should carry some plumbers');
  assert.deepEqual(person, trade,
    'typing the tradesperson must return the same businesses as typing the trade');
});

test('the earlier plural rule still works', async () => {
  // Diana's "restaurants" finding 2 of 40 — do not regress it while adding this.
  const count = async (q) => ((await (await adm('/api/admin/members?q=' + encodeURIComponent(q))).json()).members || []).length;
  assert.equal(await count('restaurants'), await count('restaurant'));
});
