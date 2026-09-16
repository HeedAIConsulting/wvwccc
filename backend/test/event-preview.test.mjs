/* Felicia, Sep 14 2026: "We would like to be able to open a pending event to
   see all the details before we publish it. We would like that feature back
   please."

   The public event page deliberately 404s on anything not approved, so the
   only way to look at a pending event was the admin edit form — which is a
   form, not the page. The office was publishing first and checking after.

   /api/admin/events/:id serves the event to a signed-in staff account whatever
   its status, and the event page falls back to it and labels itself a preview.
   The two things that must stay true: the public route still refuses, and the
   staff route still requires a login. A preview that leaked a draft event to
   the public would be worse than no preview.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

let server, base, cookie, evId;
const T = Date.now().toString(36);
const ADMIN = `preview-admin-${T}@test.woodlandhillscc.net`;
const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Preview Test`;
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

  // Its own pending event — every test file shares data/_store.
  const made = await adm('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify({
      title: `Pending preview test ${T}`, date: '2027-04-08', time: '5:30 PM',
      venue: 'Test venue', category: 'Community', status: 'pending',
      summary: 'Not published yet.',
    }),
  });
  const out = await made.json().catch(() => ({}));
  assert.equal(made.status, 200, JSON.stringify(out));
  evId = out.event.id;
});

after(async () => {
  if (evId) await adm(`/api/admin/events/${encodeURIComponent(evId)}`, { method: 'DELETE' }).catch(() => {});
  server && server.close();
  mock.reset();
});

test('the public event page still refuses a pending event', async () => {
  const r = await fetch(`${base}/api/events/${encodeURIComponent(evId)}`);
  assert.equal(r.status, 404, 'a pending event must stay invisible until it is published');
  const list = (await (await fetch(`${base}/api/events`)).json()).events || [];
  assert.ok(!list.some((e) => e.id === evId), 'and it must not be in the public list either');
});

test('the office can see it in full', async () => {
  const r = await adm(`/api/admin/events/${encodeURIComponent(evId)}`);
  const ev = await r.json().catch(() => ({}));
  assert.equal(r.status, 200, JSON.stringify(ev));
  assert.equal(ev.id, evId);
  assert.equal(ev.status, 'pending');
  assert.equal(ev.summary, 'Not published yet.', 'the whole event, not a stub');
  assert.equal(ev._preview, true, 'the page needs to know to label itself a preview');
});

test('nobody else can', async () => {
  const r = await fetch(`${base}/api/admin/events/${encodeURIComponent(evId)}`);
  assert.ok(r.status === 401 || r.status === 403, `signed out should be refused, got ${r.status}`);
});

test('an id that does not exist is a 404, not a 500', async () => {
  const r = await adm('/api/admin/events/no-such-event-at-all');
  assert.equal(r.status, 404);
});

test('once published it is simply the public page again', async () => {
  const p = await adm(`/api/admin/events/${encodeURIComponent(evId)}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'approved', confirmed: true }),
  });
  assert.equal(p.status, 200, await p.text());
  const r = await fetch(`${base}/api/events/${encodeURIComponent(evId)}`);
  assert.equal(r.status, 200);
  assert.ok(!(await r.json())._preview, 'no preview banner on a live event');
});

test('the event page falls back to the staff route, and says it is a preview', () => {
  const js = read('js/chamber.js');
  const at = js.indexOf('async function initEventView');
  const fn = js.slice(at, at + 2600);
  assert.match(fn, /api\/admin\/events\//, 'the public fetch failing is what triggers the preview attempt');
  assert.match(fn, /getAuthed\(/, 'the session cookie has to go with it');
  assert.match(fn, /_preview/, 'and an unpublished event must be labelled as one');
  assert.ok(fn.indexOf('/api/events/') < fn.indexOf('/api/admin/events/'),
    'public first — a live event must never need a login to view');
});

test('a pending row in Admin > Events offers the preview', () => {
  const js = read('admin/admin.js');
  assert.match(js, /evPreviewLink/, 'the row needs a way into it');
  const at = js.indexOf('const evPreviewLink');
  const fn = js.slice(at, at + 700);
  assert.match(fn, /events\/view\.html\?id=/, 'it opens the real page, not another form');
  assert.match(fn, /target="_blank"/, 'in a new tab, so the events list is not lost');
  assert.match(fn, /Preview/);
});
