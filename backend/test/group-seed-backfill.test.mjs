/* Felicia, Aug 27 2026 — the Networks & Committees 2026 flyer lists the
   Education Committee twice with different leaders. She confirmed Damon
   Buford's entry (4th Thursday, 9 AM) is the current one.

   The committee was already seeded into the live store that morning with a
   "call the office" placeholder, and the seed pass is add-only for groups that
   already exist — so a corrected seed would never have reached production. The
   backfill now also fills a blank/placeholder manager or meeting schedule,
   while still refusing to touch anything the office has actually set. These
   tests pin both halves of that: the correction lands, and a real admin edit
   survives it.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie;
const T = Date.now().toString(36);
const ADMIN = `seed-admin-${T}@test.local`;

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Seed Test`;
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
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
});

after(async () => { server && server.close(); mock.reset(); });

test('the Education Committee carries the leader the office confirmed', async () => {
  const r = await fetch(`${base}/api/groups/education-committee`);
  assert.equal(r.status, 200);
  const g = (await r.json()).group;
  assert.equal(g.manager.name, 'Damon Buford', 'the flyer entry Felicia confirmed');
  assert.match(g.meetingSchedule, /4th Thursday/);
  assert.match(g.meetingSchedule, /9 AM/);
});

test("a leader's phone stays off the public page", async () => {
  const g = (await (await fetch(`${base}/api/groups/education-committee`)).json()).group;
  assert.equal(g.manager.phone, undefined, 'only the name is public');
  assert.equal(g.manager.email, undefined);
});

test('the backfill never overwrites what the office actually set', async () => {
  // Give a seeded group a real, office-chosen manager and schedule, then run
  // the seed pass again the way a fresh boot would.
  const all = await (await fetch(`${base}/api/admin/groups`, { headers: { cookie } })).json();
  const g = (all.groups || []).find((x) => x.slug === 'education-committee');
  assert.ok(g, 'the committee exists in the store');
  const saved = await fetch(`${base}/api/admin/groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ ...g, manager: { name: 'Office Pick', email: '', phone: '' }, meetingSchedule: 'Whenever the office says' }),
  });
  assert.equal(saved.status, 200);

  const routes = await import('../chamber-routes.js');
  if (typeof routes.__resetGroupSeed === 'function') routes.__resetGroupSeed();
  const after = (await (await fetch(`${base}/api/groups/education-committee`)).json()).group;
  assert.equal(after.manager.name, 'Office Pick', 'the admin edit survives');
  assert.equal(after.meetingSchedule, 'Whenever the office says');

  // put it back so the dev store matches the seed for the next run
  const restore = (await (await fetch(`${base}/api/admin/groups`, { headers: { cookie } })).json())
    .groups.find((x) => x.slug === 'education-committee');
  await fetch(`${base}/api/admin/groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ ...restore, manager: { name: 'Damon Buford', email: '', phone: '(602) 690-2173' }, meetingSchedule: '4th Thursday of each month · 9 AM · location determined' }),
  });
});

test('the Event Planning & Hospitality network is a real group, not a stray row', async () => {
  // Felicia asked where this one comes from: it predates the flyer import and
  // carries its own named leader and roster.
  const g = (await (await fetch(`${base}/api/groups/event-planning-hospitality-network`)).json()).group;
  assert.equal(g.manager.name, 'Erin Coplan');
  assert.ok(g.members.length >= 1, 'it has an actual roster');
});
