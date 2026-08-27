/* Felicia, Aug 25 2026 — "Can more than one representative have access to
   the profile account? Some accounts have 2 admins working on their
   profiles." Yes: every representative gets their OWN login (their email,
   their password), and each one opens the same business profile. These tests
   pin the behaviors that make a two-rep account safe to manage: forcing a
   reset on one rep never locks out the other, changing the listing email
   moves only the matching login (it used to crash into the unique-email
   constraint with two logins), a staff email can't be attached as a member
   sign-in (it used to silently wipe the staff password), re-inviting an
   existing rep keeps their password, and removing one rep leaves the other
   rep and the profile intact.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie;
const T = Date.now().toString(36);
const ADMIN = `office-${T}@test.woodlandhillscc.net`;
const REP1 = `rep1-${T}@example.com`;
const REP2 = `rep2-${T}@example.com`;
const REP1_NEW = `rep1-new-${T}@example.com`;
const MEMBER = 'm16008'; // stable seed member (public seed is PII-free)

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts,
  headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
const logins = async () => (await (await adm(`/api/admin/members/${MEMBER}/logins`)).json()).logins.map((u) => u.email);

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
  assert.ok(cookie.startsWith('wv_session='), 'admin session cookie');
});

after(async () => {
  // leave the shared dev store the way we found it
  for (const em of [REP1, REP2, REP1_NEW]) {
    await adm(`/api/admin/members/${MEMBER}/remove-login`, { method: 'POST', body: JSON.stringify({ email: em }) }).catch(() => {});
  }
  server && server.close();
  mock.reset();
});

test('two representatives can each have their own login on one member', async () => {
  for (const em of [REP1, REP2]) {
    const r = await adm(`/api/admin/members/${MEMBER}/create-login`, {
      method: 'POST', body: JSON.stringify({ email: em, sendInvite: false }),
    });
    assert.equal(r.status, 200, `create-login ${em}`);
  }
  const now = await logins();
  assert.ok(now.includes(REP1) && now.includes(REP2), `both reps listed, got: ${now}`);
});

test('with two logins, "see their view" asks which representative', async () => {
  const r = await adm(`/api/admin/members/${MEMBER}/login-link`);
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.equal(body.error, 'multiple-logins');
  assert.ok(body.logins.includes(REP1) && body.logins.includes(REP2));

  const r2 = await adm(`/api/admin/members/${MEMBER}/login-link?email=${encodeURIComponent(REP2)}`);
  assert.equal(r2.status, 200);
  const b2 = await r2.json();
  assert.equal(b2.email, REP2);
  assert.match(b2.link, /\/api\/auth\/magic\/verify\?token=/);
});

test('forcing a password reset targets one rep and never locks out the other', async () => {
  const ambiguous = await adm(`/api/admin/members/${MEMBER}/reset-password`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(ambiguous.status, 409);
  assert.equal((await ambiguous.json()).error, 'multiple-logins');

  const one = await adm(`/api/admin/members/${MEMBER}/reset-password`, { method: 'POST', body: JSON.stringify({ email: REP1 }) });
  assert.equal(one.status, 200);
  assert.equal((await one.json()).email, REP1);

  // rep2 sets a password and can sign in — rep1's reset didn't touch them.
  const set = await adm(`/api/admin/users/${encodeURIComponent(REP2)}/set-password`, {
    method: 'POST', body: JSON.stringify({ password: 'rep2-password-9' }),
  });
  assert.equal(set.status, 200);
  const rep2Login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: REP2, password: 'rep2-password-9' }),
  });
  assert.equal(rep2Login.status, 200, 'rep2 signs in fine');

  const rep1Login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: REP1, password: 'anything-at-all' }),
  });
  assert.equal(rep1Login.status, 403, 'rep1 is the one who must reset');
});

test('re-adding an existing rep does not wipe the password they set', async () => {
  const r = await adm(`/api/admin/members/${MEMBER}/create-login`, {
    method: 'POST', body: JSON.stringify({ email: REP2, sendInvite: false }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).already, true);
  const again = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: REP2, password: 'rep2-password-9' }),
  });
  assert.equal(again.status, 200, 'rep2 password survived the re-add');
});

test('changing the listing email moves only the matching login', async () => {
  // Pin the listing email to rep1 first so the run is repeatable, then move it.
  for (const em of [REP1, REP1_NEW]) {
    const r = await adm(`/api/admin/members/${MEMBER}/email`, { method: 'PATCH', body: JSON.stringify({ email: em }) });
    assert.equal(r.status, 200, `listing email → ${em}`);
  }
  const now = await logins();
  assert.ok(now.includes(REP1_NEW), 'rep1 login followed the new address');
  assert.ok(!now.includes(REP1), 'old rep1 address is gone');
  assert.ok(now.includes(REP2), 'rep2 login untouched');
});

test('a staff email can never become a member sign-in', async () => {
  const r = await adm(`/api/admin/members/${MEMBER}/create-login`, {
    method: 'POST', body: JSON.stringify({ email: ADMIN, sendInvite: false }),
  });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /staff/i);
  // and the staff login still works afterwards
  const still = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN, password: 'test-passcode-1' }),
  });
  assert.equal(still.status, 200);
});

test('removing one rep leaves the other rep and the profile intact', async () => {
  const r = await adm(`/api/admin/members/${MEMBER}/remove-login`, {
    method: 'POST', body: JSON.stringify({ email: REP1_NEW }),
  });
  assert.equal(r.status, 200);
  const now = await logins();
  assert.ok(!now.includes(REP1_NEW), 'removed rep is gone');
  assert.ok(now.includes(REP2), 'remaining rep still has access');
  const pub = await fetch(`${base}/api/members`);
  assert.equal(pub.status, 200, 'directory still serves');
});
