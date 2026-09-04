/* Felicia, Sep 4 2026: "Are we able to go in to update the Group/Connection
   Circle meetings so we can change/update phone numbers and if meeting times
   change?"

   Meeting times were always editable. Phone numbers were not — there was no
   field for them, AND the admin group form left `phone` out of every save
   payload, so `normalizeGroupManager` defaulted it to '' and the leader's
   number was wiped each time anyone edited a group. A manager phone is office
   reference data that never renders on the public page, so nothing on screen
   ever showed the loss.

   The form now has the field; these pin the server side, so no other caller
   can quietly erase a number by leaving the key out.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie, groupId, original;
const T = Date.now().toString(36);
const ADMIN = `office-phone-${T}@test.woodlandhillscc.net`;

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts,
  headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
const group = async () => ((await (await adm('/api/admin/groups')).json()).groups || [])
  .find((g) => g.id === groupId);
const save = (body) => adm('/api/admin/groups', { method: 'POST', body: JSON.stringify(body) });

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

  const all = (await (await adm('/api/admin/groups')).json()).groups || [];
  const g = all.find((x) => x.slug === 'education-committee') || all[0];
  assert.ok(g, 'need at least one seeded group');
  groupId = g.id;
  original = JSON.parse(JSON.stringify(g));
});

after(async () => {
  // leave the shared dev store the way we found it
  if (original) await save(original).catch(() => {});
  server && server.close();
  mock.reset();
});

test('a leader phone number saves and reads back', async () => {
  const g = await group();
  const r = await save({ ...g, manager: { ...(g.manager || {}), name: 'Damon Buford', phone: '(602)690-2173' } });
  assert.equal(r.status, 200, await r.text());
  assert.equal((await group()).manager.phone, '(602)690-2173');
});

test('a save that omits phone entirely keeps the stored number', async () => {
  // Exactly the payload the admin form used to send: name + email, no phone.
  const g = await group();
  const r = await save({ ...g, manager: { name: 'Damon Buford', email: '', memberId: null } });
  assert.equal(r.status, 200, await r.text());
  assert.equal((await group()).manager.phone, '(602)690-2173',
    'omitting phone must not wipe the number — this was the bug');
});

test('an explicit empty phone still clears it on purpose', async () => {
  const g = await group();
  await save({ ...g, manager: { ...(g.manager || {}), phone: '' } });
  assert.equal((await group()).manager.phone, '',
    'an empty string is a deliberate clear; absent and empty mean different things');
});

test('the meeting schedule is editable — the other half of the question', async () => {
  const g = await group();
  await save({ ...g, meetingSchedule: '2nd Thursday of the month · 9:00 AM' });
  assert.equal((await group()).meetingSchedule, '2nd Thursday of the month · 9:00 AM');
});
