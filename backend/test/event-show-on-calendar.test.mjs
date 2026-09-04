/* Diana via Felicia, Sep 4 2026: "Diana wants the below event to have a link
   for RSVPs but does not want it on the website for public view."

   Admin > Events already had a "Show on calendar" toggle, stored on the event
   and editable — and nothing on the public site ever read it. The office could
   untick it and the event carried on appearing, which is worse than the option
   not being there at all.

   Unticking it now removes the event from the public calendar and from the
   sitemap, while leaving it APPROVED. That distinction is the whole point: an
   unapproved event cannot take an RSVP, because the relay guard on
   /api/contact only resolves an approved one, so a "hidden" event would
   silently break the very link Diana wants to share. Approved-but-unlisted
   keeps /api/events/:id serving it, and RSVPs, guest confirmations and leader
   routing all behave normally.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie, evId;
const T = Date.now().toString(36);
const ADMIN = `office-cal-${T}@test.woodlandhillscc.net`;

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
const publicList = async () => ((await (await fetch(`${base}/api/events`)).json()).events || []);
const setCalendar = (on) => adm(`/api/admin/events/${encodeURIComponent(evId)}`, {
  method: 'PATCH', body: JSON.stringify({ showOnCalendar: on }),
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

  // Its OWN event, never a seed one. Every test file shares data/_store and
  // they run in parallel, so flipping a real event's flags here surfaced as
  // unrelated failures in the RSVP notification tests.
  const made = await adm('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify({
      title: `Show-on-calendar test ${T}`,
      date: '2027-03-11', time: '9:00 AM', venue: 'Test venue',
      category: 'Community', status: 'approved',
    }),
  });
  const body = await made.json().catch(() => ({}));
  assert.equal(made.status, 200, JSON.stringify(body));
  evId = body.event.id;
});

after(async () => {
  // Leave the shared dev store the way we found it.
  if (evId) await adm(`/api/admin/events/${encodeURIComponent(evId)}`, { method: 'DELETE' }).catch(() => {});
  server && server.close();
  mock.reset();
});

test('by default the event is on the public calendar', async () => {
  assert.ok((await publicList()).some((e) => e.id === evId));
});

test('unticking "Show on calendar" takes it off the calendar', async () => {
  const r = await setCalendar(false);
  assert.equal(r.status, 200, await r.text());
  assert.ok(!(await publicList()).some((e) => e.id === evId),
    'an event with Show on calendar off must not appear in the public list');
});

test('but its own link still works, so RSVPs can be taken', async () => {
  const r = await fetch(`${base}/api/events/${encodeURIComponent(evId)}`);
  assert.equal(r.status, 200, 'the direct link is what Diana shares — it must not 404');
  const ev = await r.json();
  assert.equal(ev.id, evId);
  assert.equal(ev.status || 'approved', 'approved',
    'it has to stay approved, or /api/contact will refuse to resolve the RSVP');
});

test('an RSVP to the unlisted event is still accepted and attributed', async () => {
  const ev = await (await fetch(`${base}/api/events/${encodeURIComponent(evId)}`)).json();
  const r = await fetch(`${base}/api/contact`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'rsvp', reason: 'RSVP', name: 'Unlisted Guest', email: 'guest@example.com',
      event: `${ev.title} [${evId}]`, eventTitle: ev.title, quantity: 1,
    }),
  });
  assert.equal(r.status, 200, await r.text());
  await new Promise((res) => setTimeout(res, 250));
  const leads = (await (await adm('/api/admin/leads')).json()).leads || [];
  assert.ok(leads.some((l) => l.kind === 'rsvp' && String(l.event || '').includes(evId)),
    'the RSVP should be filed against the event exactly as a listed one is');
});

test('ticking it back puts the event straight back on the calendar', async () => {
  await setCalendar(true);
  assert.ok((await publicList()).some((e) => e.id === evId));
});
