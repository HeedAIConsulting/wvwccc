/* Felicia, Nov 7 2026 ("Follow Up on Requests and 2 Additional Request
   Please"): the breakfast/mixer jobs are on every Chamber breakfast and mixer
   without anyone adding them; one sign-up sheet the office and Sheryl can
   read; the ribbon cutting ask is a phone number, with no date picker; and
   inquiries get a Complete box. Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const FIVE = ['Greeter', 'Name Tags', 'Check In', 'Floater', 'Packing Items Up'];
const T = Date.now().toString(36);
const ADMIN = `office-n7-${T}@test.woodlandhillscc.net`;
let server, base, cookie, routes, repo;
const made = [];

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});

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
  routes = await import('../chamber-routes.js');
  repo = await import('../repo.js');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', routes.default);
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
  for (const id of made) await adm('/api/admin/events/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
  server && server.close();
  mock.reset();
});

/* ── 1-2. The jobs are static ─────────────────────────────── */
test('which events are the Chamber’s own breakfasts and mixers', () => {
  const { isChamberBreakfastOrMixer: is } = routes;
  assert.ok(is({ title: 'January 6th 2027 ~Start Your Month With a Motivating and Fun Breakfast at Fogo' }));
  assert.ok(is({ title: 'November 18th Networking Mixer Hosted By FAIRWINDS', category: '' }));
  assert.ok(is({ title: 'December 16th ~ Hosted by Marriott', category: 'Mixer' }));
  // Somebody else's breakfast, however it is worded.
  assert.equal(is({ title: 'Valley Senior Resources Network (VSRN) Breakfast', category: 'Community', source: 'community' }), false);
  assert.equal(is({ title: 'VSRN Breakfast', groupSlug: 'valley-senior-resources-network' }), false);
  assert.equal(is({ title: 'Our Networking Mixer', submittedBy: 'm15907' }), false);
  assert.equal(is({ title: 'LAPD Topanga Station Open House and Pancake Breakfast!', category: '' }), false);
  assert.equal(is(null), false);
});

test('withChamberJobs fills an empty upcoming one, and leaves the office’s choices alone', () => {
  const { withChamberJobs: w } = routes;
  const ev = { id: 'x', title: 'Networking Mixer', date: '2027-01-20', volunteerRoles: [] };
  assert.deepEqual(w(ev, '2026-11-07').volunteerRoles.map((r) => r.role), FIVE);
  assert.ok(w(ev, '2026-11-07').volunteerRoles.every((r) => r.needed === 2));
  const own = [{ role: 'Greeter', points: 8, needed: 3 }];
  assert.deepEqual(w({ ...ev, volunteerRoles: own }, '2026-11-07').volunteerRoles, own);
  assert.deepEqual(w({ ...ev, volunteerRolesOff: true }, '2026-11-07').volunteerRoles, []);
  assert.deepEqual(w({ ...ev, date: '2026-10-01' }, '2026-11-07').volunteerRoles, [], 'a past event is left as it was');
  assert.deepEqual(w({ ...ev, title: 'Board meeting' }, '2026-11-07').volunteerRoles, []);
});

test('a 2027 breakfast the office creates has the jobs without anyone adding them', async () => {
  const create = await adm('/api/admin/events', { method: 'POST', body: JSON.stringify({
    title: 'January 6th 2027 ~Start Your Month With a Motivating and Fun Breakfast', date: '2099-01-06', category: 'Networking', volunteerRoles: [],
  }) });
  assert.equal(create.status, 200);
  const ev = (await create.json()).event;
  made.push(ev.id);
  assert.deepEqual(ev.volunteerRoles.map((r) => r.role), FIVE);

  // Saved again from the form with nothing in the box: they come back.
  let r = await (await adm('/api/admin/events/' + ev.id, { method: 'PATCH', body: JSON.stringify({ volunteerRoles: [] }) })).json();
  assert.equal(r.event.volunteerRoles.length, 5);
  // A job the office changed is kept as changed.
  r = await (await adm('/api/admin/events/' + ev.id, { method: 'PATCH', body: JSON.stringify({ volunteerRoles: [{ role: 'Greeter', points: 8, needed: 4 }] }) })).json();
  assert.deepEqual(r.event.volunteerRoles.map((x) => [x.role, x.needed]), [['Greeter', 4]]);
  // "No Ambassador jobs at this event".
  r = await (await adm('/api/admin/events/' + ev.id, { method: 'PATCH', body: JSON.stringify({ volunteerRoles: [], volunteerRolesOff: true }) })).json();
  assert.deepEqual(r.event.volunteerRoles, []);
  assert.equal(r.event.volunteerRolesOff, true);
  // Ticked off again: the five return on the next save.
  r = await (await adm('/api/admin/events/' + ev.id, { method: 'PATCH', body: JSON.stringify({ volunteerRoles: [], volunteerRolesOff: false }) })).json();
  assert.equal(r.event.volunteerRoles.length, 5);
  // Duplicating it to the next month carries them.
  const dup = await (await adm('/api/admin/events/' + ev.id + '/duplicate', { method: 'POST', body: JSON.stringify({ date: '2099-02-03' }) })).json();
  made.push(dup.event.id);
  assert.deepEqual(dup.event.volunteerRoles.map((x) => x.role), FIVE);
});

test('the admin form has the off switch and says the jobs are automatic', () => {
  const js = read('admin/admin.js');
  assert.match(js, /No Ambassador jobs at this event/);
  assert.match(js, /volunteerRoles: volunteerRolesOff \? \[\] :/);
  assert.match(js, /get Greeter, Name Tags, Check In, Floater and Packing Items Up automatically/);
});

/* ── 1 & 4. One sign-up sheet, for the office and for Sheryl ── */
test('the sign-up sheet lists each job, who has it and what is still open', () => {
  const { signupSheet } = routes;
  const events = [
    { id: 'a', title: 'Mixer', date: '2026-11-18', status: 'approved', volunteerRoles: [{ role: 'Greeter', needed: 2 }, { role: 'Check In', needed: 2 }] },
    { id: 'old', title: 'Old', date: '2026-10-01', volunteerRoles: [{ role: 'Greeter', needed: 2 }] },
    { id: 'p', title: 'Pending', date: '2026-12-01', status: 'pending', volunteerRoles: [{ role: 'Greeter', needed: 2 }] },
    { id: 'none', title: 'No jobs', date: '2026-12-01', volunteerRoles: [] },
  ];
  const signups = [
    { eventId: 'a', role: 'Greeter', name: 'Martin Carman', phone: '818-000-0000', status: 'signed-up' },
    { eventId: 'a', role: 'Greeter', name: 'Gone', status: 'no-show' },
    { eventId: 'a', role: 'Check In', name: 'Sandy Rosenholz', status: 'confirmed' },
    { eventId: 'a', role: 'Check In', name: 'Corina Ayers', status: 'signed-up' },
  ];
  const sheet = signupSheet(events, signups, '2026-11-07');
  assert.deepEqual(sheet.map((e) => e.id), ['a']);
  const [greeter, checkIn] = sheet[0].jobs;
  assert.deepEqual(greeter.people.map((p) => p.name), ['Martin Carman']);
  assert.equal(greeter.open, 1);
  assert.equal(checkIn.open, 0);
});

test('Admin → Ambassadors opens with the sheet, and Sheryl’s Manage group page has it', async () => {
  const r = await adm('/api/admin/volunteer-sheet');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray((await r.json()).events));
  assert.match(read('admin/ambassadors.html'), /Who's signed up for the next events[\s\S]*Current ambassadors/);
  const src = read('backend/chamber-routes.js');
  assert.match(src, /router\.get\('\/me\/group\/:slug\/volunteer-sheet'[\s\S]{0,200}ledGroupOr403\(req, res\)[\s\S]{0,120}g\.id !== AMBASSADOR_GROUP_ID/);
  assert.match(src, /hasVolunteerSheet: g\.id === AMBASSADOR_GROUP_ID/);
  assert.equal(routes.default && typeof routes.signupSheet, 'function');
  assert.match(read('member/member.js'), /\/volunteer-sheet'\)/);
  // Not open to anyone signed out.
  assert.equal((await fetch(base + '/api/me/group/ambassador-committee/volunteer-sheet')).status, 401);
});

/* ── 3. Ribbon cuttings: a phone number, no date picker ─────── */
test('the application only says to call about a ribbon cutting', () => {
  for (const p of ['join.html', 'es/join.html', 'ribbon-cutting.html', 'es/ribbon-cutting.html']) {
    const html = read(p);
    assert.equal(/ribbonDate|joinRibbon|name="date1"|id="rcForm"/.test(html), false, `${p} still asks for a date`);
    assert.match(html, /href="tel:\+18183474737">818-347-4737<\/a>/, p);
  }
  assert.match(read('join.html'), /Interested in a Ribbon Cutting\? Call <a href="tel:\+18183474737">818-347-4737<\/a>\./);
});

/* ── 5. Inquiries: Complete ─────────────────────────────────── */
test('ticking Complete records who and when, and unticking clears it', async () => {
  const id = 'lead-n7-' + T;
  await repo.addLead({ id, kind: 'general', name: 'Test Person', email: 'test@example.com', reason: 'General', message: 'Hello', status: 'new', received: new Date().toISOString() });
  let r = await adm('/api/admin/leads/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
  assert.equal(r.status, 200);
  let l = (await repo.listLeads()).find((x) => x.id === id);
  assert.equal(l.status, 'done');
  assert.equal(l.doneBy, ADMIN);
  assert.ok(l.doneAt);
  r = await adm('/api/admin/leads/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'read' }) });
  l = (await repo.listLeads()).find((x) => x.id === id);
  assert.equal(l.status, 'read');
  assert.equal(l.doneBy, undefined);
  assert.equal(l.doneAt, undefined);
  assert.equal((await adm('/api/admin/leads/nope-' + T, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) })).status, 404);
});

test('the inquiries page has the Complete column and the completed list', () => {
  const js = read('admin/admin.js');
  assert.match(js, /<th style="width:84px;text-align:center">Complete<\/th>/);
  // One Completed box, last on the page, there even before anything is ticked
  // (Felicia, Nov 9: "I just saw a Spam section").
  assert.match(js, /id="leadsCompleted"/);
  assert.match(js, /host\.innerHTML = sectionsHtml \+ doneHtml;/);
  assert.match(js, /Nothing completed yet\. Tick Complete on an inquiry above and it moves here\./);
  assert.equal(/<details style="margin-top:10px"[^>]*><summary[^>]*>✓ Completed/.test(js), false, 'no per-section folded lists');
  assert.match(js, /markLead\(l, e\.target\.checked \? 'done' : 'read'\)/);
  const sql = read('backend/schema.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS done_at timestamptz/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS done_by text/);
});
