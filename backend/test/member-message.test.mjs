/* Felicia, Aug 27 2026 — a member at the mixer was "unable to use the
   messaging feature to message a member". There wasn't one: the public
   directory strips email addresses on purpose. /api/members/:id/message now
   relays the message server-side — signed-in senders only, the recipient's
   address never leaves the server, Reply-To goes back to the sender, and the
   office sees the traffic in Admin → Inquiries. These tests pin that
   contract.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie, sent;
const T = Date.now().toString(36);
const ADMIN = `msg-admin-${T}@test.local`;
const RECIPIENT = `recipient-${T}@example.com`;
const MEMBER = 'm16008'; // stable seed member

before(async () => {
  sent = [];
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Message Test`;
  mock.module('../email.js', {
    namedExports: {
      send: async (m) => { sent.push(m); return { ok: true, id: 'test', provider: 'stub' }; },
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
  // Point the recipient member's LISTING email at a known address — the
  // shared dev store can carry values from earlier suite runs, and the
  // listing email is what the relay resolves.
  const r = await fetch(`${base}/api/admin/members/${MEMBER}/email`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ email: RECIPIENT }),
  });
  assert.equal(r.status, 200);
  sent = []; // drop any setup mail
});

after(async () => {
  server && server.close();
  mock.reset();
});

test('a signed-in user can message a member through the website', async () => {
  const r = await fetch(`${base}/api/members/${MEMBER}/message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ message: 'Loved meeting you at the mixer — can we talk referrals?', phone: '818-555-0100' }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  const mail = sent.find((m) => String(m.to).toLowerCase().includes(RECIPIENT.split('@')[0]));
  assert.ok(mail, 'mail delivered to the member');
  assert.equal(String(mail.replyTo).toLowerCase(), ADMIN.toLowerCase(), 'replies go back to the sender');
  assert.match(mail.text, /mixer/);
  assert.ok(!mail.text.includes(RECIPIENT), 'recipient address is not echoed in the body');
});

test('signing in is required to message a member', async () => {
  const r = await fetch(`${base}/api/members/${MEMBER}/message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'anonymous spam attempt' }),
  });
  assert.equal(r.status, 401);
});

test('an empty message is rejected', async () => {
  const r = await fetch(`${base}/api/members/${MEMBER}/message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ message: ' ' }),
  });
  assert.equal(r.status, 400);
});

test('a member with no email on file says so instead of failing silently', async () => {
  const roster = await (await fetch(`${base}/api/admin/members`, { headers: { cookie } })).json();
  const bare = (roster.members || []).find((m) => m.id !== MEMBER && !m.email);
  assert.ok(bare, 'a no-email member exists in the seed');
  const r = await fetch(`${base}/api/members/${bare.id}/message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ message: 'hello there' }),
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'no-email');
});
