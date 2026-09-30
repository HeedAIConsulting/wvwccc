/* Nicole Cohen, Hawaiian Movers, Sep 30 2026: "I still cannot find the
   Hawaiian Movers Chamber member page in Google search results."

   Google still held her listing at its ChamberWare address,
   /profile.php?view_id=15884, and the site answered that with a temporary
   redirect to the homepage — so the record Google already had of her listing
   went nowhere, and nothing ever said it had moved to /members/hawaiian-movers.

   The lookup is tested on its own, and then against the real server started
   the way Render starts it, because the order the routes are registered in
   server.js is the whole fix: the catch-all for stray .php files sits right
   below, and would swallow these if it ran first.

   Run: npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { legacyMemberPath } from '../legacy-urls.js';

const ROOT = new URL('../../', import.meta.url);

const MEMBERS = [
  { id: 'm15884', slug: 'hawaiian-movers', name: 'Hawaiian Movers' },
  { id: 'm15701-400', slug: 'second-location', name: 'Second Location' },
  { id: 'm2212', slug: '', name: 'No Slug' },
];

test('a ChamberWare view_id goes to that member\'s page', () => {
  assert.equal(legacyMemberPath('15884', MEMBERS), '/members/hawaiian-movers');
  assert.equal(legacyMemberPath(15884, MEMBERS), '/members/hawaiian-movers', 'a number works as well as a string');
  assert.equal(legacyMemberPath(' 15884 ', MEMBERS), '/members/hawaiian-movers');
});

test('anything that is not exactly a listed member gets no answer', () => {
  assert.equal(legacyMemberPath('99999', MEMBERS), null, 'no such member');
  assert.equal(legacyMemberPath('15701', MEMBERS), null,
    'a second-location id is not the member with the bare number');
  assert.equal(legacyMemberPath('2212', MEMBERS), null, 'no slug, nowhere to send it');
  assert.equal(legacyMemberPath('', MEMBERS), null);
  assert.equal(legacyMemberPath(undefined, MEMBERS), null);
  assert.equal(legacyMemberPath(['15884', '1'], MEMBERS), null, 'a repeated view_id is not guessed at');
  assert.equal(legacyMemberPath('15884/../x', MEMBERS), null);
  assert.equal(legacyMemberPath('m15884', MEMBERS), null, 'ChamberWare ids were bare numbers');
  // Ids minted here after the import carry suffixes and prefixes. Only a bare
  // number is a ChamberWare id, so only a bare number may be looked up.
  assert.equal(legacyMemberPath('15701-400', MEMBERS), null,
    'a second-location id is ours, not ChamberWare\'s, and is not an old address');
});

test('a slug is escaped on its way into the Location header', () => {
  assert.equal(legacyMemberPath('1', [{ id: 'm1', slug: 'a b/c' }]), '/members/a%20b%2Fc');
});

// ── Against the real server ────────────────────────────────────────────────
let proc; let base; let real;

const freePort = () => new Promise((resolve) => {
  const s = createServer(); s.listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  // A member that exists in the local store, found the way the route finds it.
  const { loadMembersPublic } = await import('../chamber-routes.js');
  const { members } = await loadMembersPublic();
  real = members.find((m) => /^m\d+$/.test(m.id) && m.slug);
  assert.ok(real, 'the local store has a ChamberWare-numbered member to test with');

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: new URL('.', ROOT).pathname,
    env: { ...process.env, PORT: String(port), DATABASE_URL: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/ping')).ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

after(() => { proc && proc.kill(); });

const head = (p) => fetch(base + p, { redirect: 'manual' });

test('the old address of a listed member is a permanent move to their page', async () => {
  const view = real.id.slice(1);
  const r = await head(`/profile.php?view_id=${view}`);
  assert.equal(r.status, 301, 'permanent — a 302 tells Google to keep the old entry');
  assert.equal(r.headers.get('location'), `/members/${encodeURIComponent(real.slug)}`);
});

test('the extra parameters ChamberWare put on those links do not matter', async () => {
  const r = await head(`/profile.php?view_id=${real.id.slice(1)}&showmap=y`);
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), `/members/${encodeURIComponent(real.slug)}`);
});

test('an old address with no member behind it behaves exactly as before', async () => {
  for (const p of ['/profile.php?view_id=99999999', '/profile.php', '/profile.php?view_id=abc']) {
    const r = await head(p);
    assert.equal(r.status, 302, `${p} keeps the existing temporary redirect`);
    assert.equal(r.headers.get('location'), '/');
  }
});

test('the rest of the legacy table is untouched', async () => {
  const r = await head('/event_listings.php');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/events/');
  const stray = await head('/friends.php?view_id=10491');
  assert.equal(stray.status, 302);
  assert.equal(stray.headers.get('location'), '/');
});

test('the member route is registered ahead of the .php catch-all', () => {
  const src = readFileSync(new URL('server.js', ROOT), 'utf8');
  const route = src.indexOf("app.get('/profile.php'");
  const catchAll = src.indexOf("app.get(/^\\/[^/]+\\.php$/i");
  assert.ok(route > 0 && catchAll > 0);
  assert.ok(route < catchAll, 'otherwise the catch-all answers first and this never runs');
});
