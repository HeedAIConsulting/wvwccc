/* Felicia, Sep 28 2026: "I updated emails for the Premier America Credit
   Union and even though it shows Erin and Wens as the new additions it is
   still showing Shawn's email."

   Her screenshot is the 🔑 Logins box. Under Erin's login the grey line read
   shawn.kamrava@… — that line is the login's USERNAME, and a login created
   without a name gets its email as its username. Changing the listing email
   moved Shawn's login to Erin's address and left the username behind, so the
   departed rep's address sat under the new rep's sign-in.

   Three things pinned here: the username follows the move when it was only
   ever the old address (and a real name is left alone); the one-time repair
   catches logins moved before the fix, and only those; and the Logins box no
   longer prints an address twice when the username is just the email again.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import * as store from '../store.js';
import { repairStaleUsernames, listByMemberId, bulkImportMembers } from '../users.js';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

let server, base, cookie;
const T = Date.now().toString(36);
const ADMIN = `office-un-${T}@test.woodlandhillscc.net`;
const REP = `rep-un-${T}@example.com`;
const REP_NEW = `rep-un-new-${T}@example.com`;
const NAMED = `named-un-${T}@example.com`;
const NAMED_NEW = `named-un-new-${T}@example.com`;
const MEMBER = 'm16008'; // stable seed member (public seed is PII-free)

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
const loginsOf = async () => (await (await adm(`/api/admin/members/${MEMBER}/logins`)).json()).logins;

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

after(async () => {
  for (const em of [REP, REP_NEW, NAMED, NAMED_NEW]) {
    await adm(`/api/admin/members/${MEMBER}/remove-login`, { method: 'POST', body: JSON.stringify({ email: em }) }).catch(() => {});
  }
  // planted rows from the repair test
  const mu = store.read('users.json', { users: [] });
  const arr = Array.isArray(mu) ? mu : (mu.users || []);
  const next = arr.filter((u) => !/-plant-/.test(String(u.email || '')));
  store.write('users.json', Array.isArray(mu) ? next : { ...mu, users: next });
  server && server.close();
  mock.reset();
});

test('a username that was only ever the address follows the address', async () => {
  /* Shawn's shape. The 🔑 Logins "Give them access" button always finds a name
     (the one typed, else the listing's contact name), so this row cannot be
     made through it — it is the ChamberWare import's, where a login with no
     name on file was given its email as its username. Planted the way the
     import writes it. */
  await bulkImportMembers([{
    id: 'mu-import-' + T, memberId: MEMBER, email: REP, username: REP,
    passwordHash: null, passwordAlgo: 'unknown', role: 'member', status: 'approved', needsReset: true,
  }]);
  let mine = (await loginsOf()).find((u) => u.email === REP);
  assert.ok(mine, 'the imported login is on the account');
  assert.equal(mine.username, REP, 'the placeholder username is the email');

  // Pin the listing email to this login, then move it — what Felicia did.
  for (const em of [REP, REP_NEW]) {
    const r = await adm(`/api/admin/members/${MEMBER}/email`, { method: 'PATCH', body: JSON.stringify({ email: em }) });
    assert.equal(r.status, 200, `listing email → ${em}`);
  }
  mine = (await loginsOf()).find((u) => u.email === REP_NEW);
  assert.ok(mine, 'the login moved');
  assert.equal(mine.username, REP_NEW, 'and the username moved with it');
  assert.ok(!(await loginsOf()).some((u) => String(u.username).toLowerCase() === REP),
    'the old address is nowhere on the account');
});

test('a real name is not overwritten by the move', async () => {
  let r = await adm(`/api/admin/members/${MEMBER}/create-login`, { method: 'POST', body: JSON.stringify({ email: NAMED, name: 'Wens Sanchez', sendInvite: false }) });
  assert.equal(r.status, 200);
  for (const em of [NAMED, NAMED_NEW]) {
    r = await adm(`/api/admin/members/${MEMBER}/email`, { method: 'PATCH', body: JSON.stringify({ email: em }) });
    assert.equal(r.status, 200);
  }
  const moved = (await loginsOf()).find((u) => u.email === NAMED_NEW);
  assert.ok(moved, 'the login moved');
  assert.equal(moved.username, 'Wens Sanchez', 'the name stays a name');
});

test('the one-time repair fixes exactly the stale ones', async () => {
  const plant = (email, username) => ({
    id: 'mu-plant-' + Math.random().toString(36).slice(2), memberId: MEMBER, email, username,
    passwordHash: null, passwordAlgo: 'unknown', role: 'member', status: 'approved', needsReset: true,
  });
  const STALE = `stale-plant-${T}@example.com`;
  const KEEP_NAME = `keep-plant-${T}@example.com`;
  const KEEP_SAME = `same-plant-${T}@example.com`;
  const mu = store.read('users.json', { users: [] });
  const arr = Array.isArray(mu) ? mu : (mu.users || []);
  const next = arr.concat([
    plant(STALE, `departed-plant-${T}@example.com`),   // Erin's shape: someone else's address
    plant(KEEP_NAME, 'Erin Stidman'),                    // a name
    plant(KEEP_SAME, KEEP_SAME),                         // the placeholder, correct as it is
  ]);
  store.write('users.json', Array.isArray(mu) ? next : { ...mu, users: next });

  const fixed = await repairStaleUsernames();
  assert.ok(fixed.includes(STALE), `the stale one is repaired (got ${fixed.join(', ') || 'none'})`);
  assert.ok(!fixed.includes(KEEP_NAME), 'a real name is not "repaired"');
  assert.ok(!fixed.includes(KEEP_SAME), 'nor a username that already matches');

  const after = await listByMemberId(MEMBER);
  const by = (em) => after.find((u) => u.email === em);
  assert.equal(by(STALE).username, STALE, 'the departed address is gone; the login\'s own stands in');
  assert.equal(by(KEEP_NAME).username, 'Erin Stidman');
  assert.equal(by(KEEP_SAME).username, KEEP_SAME);
  assert.deepEqual(await repairStaleUsernames().then((f) => f.filter((e) => /-plant-/.test(e))), [],
    'running it again finds nothing');
});

test('the repair runs once, on the same path as the other corrections', () => {
  const routes = read('backend/chamber-routes.js');
  assert.match(routes, /await applyVolunteerPointsOn\(\);\n  await repairLoginUsernames\(\);/,
    'wired where the other one-time corrections run, so it lands at first traffic');
  /* Only this function. applySustainableAndLegacyPage sits between it and
     applyFlyerCorrections and carries the same marker lines, so a slice that
     ran to the latter would pass with this function's guard deleted. */
  const start = routes.indexOf('async function repairLoginUsernames');
  const fn = routes.slice(start, routes.indexOf('\nasync function', start + 1));
  assert.match(fn, /const KEY = 'loginUsernames-20260929';/);
  assert.match(fn, /if \(await repo\.getSetting\(KEY\)\) return;/, 'keyed by a settings marker');
  assert.match(fn, /await repo\.setSetting\(KEY,/, 'and marked done afterwards');
  assert.match(fn, /_usernameFixChecked = false;/, 'a failure lets it retry next boot rather than marking itself done');
});

test('the Postgres branch makes the same two decisions', () => {
  // The suite runs on the JSON store; the SQL cannot run here, so hold its
  // shape to the JS it has to mirror.
  const js = read('backend/users.js');
  const move = js.slice(js.indexOf('export async function updateEmailByMemberId'), js.indexOf('export async function repairStaleUsernames'));
  assert.match(move, /username=CASE WHEN lower\(username\)=\$3 THEN \$1 ELSE username END/,
    'SQL: the placeholder follows, a name stays');
  assert.match(move, /lc\(arr\[i\]\.username\) === target\.email \? newEmail : arr\[i\]\.username/,
    'JSON: the same rule');
  const repair = js.slice(js.indexOf('export async function repairStaleUsernames'));
  assert.match(repair, /UPDATE users SET username=email WHERE username ~ /, 'SQL: only an email-shaped username');
  assert.match(repair, /AND lower\(username\) <> lower\(email\)/, 'that is not the login\'s own');
});

test('the Logins box does not print the address twice', () => {
  const admin = read('admin/admin.js');
  const box = admin.slice(admin.indexOf('async function openLoginsManager'), admin.indexOf("ov.querySelectorAll('[data-lg-view]')"));
  assert.match(box, /const who = u\.username && String\(u\.username\)\.toLowerCase\(\) !== String\(u\.email\)\.toLowerCase\(\) \? u\.username : '';/);
  assert.match(box, /\$\{esc\(who\)\}\$\{who \? ' · ' : ''\}\$\{when\}/, 'the grey line uses it');
  assert.ok(!/\$\{esc\(u\.username \|\| ''\)\}/.test(box), 'and never the raw username');
});
