/* The community-event code sender is the one public route that emails an
   address taken straight from the request body. Without a throttle it is an
   open relay — the captcha in front of it fails open whenever TURNSTILE_SECRET
   is unset, leaving only the global 120/min limiter. These tests pin the two
   guards that stop it: one code per address per minute, and a cap on how many
   DIFFERENT addresses a single IP may mail in an hour.

   Run: node --experimental-test-module-mocks --test backend/test/event-code-throttle.test.mjs */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';

let server, base, sent;

before(async () => {
  sent = [];
  // Stub the mail layer: a send that "succeeds" without touching a provider,
  // because the guards deliberately only count messages that actually went out.
  mock.module('../email.js', {
    namedExports: {
      send: async ({ to, subject }) => { sent.push({ to, subject }); return { ok: true, id: 'test', provider: 'stub' }; },
      notifyTo: () => 'office@example.com',
      enabled: () => true,
      provider: () => 'stub',
      diagnose: async () => ({}),
    },
  });
  const express = (await import('express')).default;
  const routes = (await import('../chamber-routes.js')).default;
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server && server.close(); mock.reset(); });

const ask = (email, ip) => fetch(`${base}/api/public/event/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
  body: JSON.stringify({ email }),
}).then((r) => r.status);

test('a first request for an address sends a code', async () => {
  const before2 = sent.length;
  assert.equal(await ask('first@example.com', '10.0.0.1'), 200);
  assert.equal(sent.length, before2 + 1);
  assert.match(sent.at(-1).subject, /verification code: \d{6}/);
});

test('a second request for the SAME address within the minute is refused', async () => {
  await ask('repeat@example.com', '10.0.0.2');
  const afterFirst = sent.length;
  for (const _ of [1, 2, 3]) {
    assert.equal(await ask('repeat@example.com', '10.0.0.2'), 429);
  }
  assert.equal(sent.length, afterFirst, 'no further mail should leave for a repeated address');
});

test('one IP may only mail a limited number of DIFFERENT addresses per hour', async () => {
  const ip = '10.0.0.3';
  const codes = [];
  for (let i = 1; i <= 11; i++) codes.push(await ask(`spray${i}@example.com`, ip));
  const allowed = codes.filter((c) => c === 200).length;
  const blocked = codes.filter((c) => c === 429).length;
  assert.ok(allowed <= 8, `expected the per-IP cap to hold, ${allowed} got through`);
  assert.ok(blocked >= 3, `expected the tail to be refused, only ${blocked} were`);
});

test('a different IP is unaffected by another IP hitting the cap', async () => {
  assert.equal(await ask('elsewhere@example.com', '10.9.9.9'), 200);
});

test('an invalid address is rejected before any mail is attempted', async () => {
  const before2 = sent.length;
  assert.equal(await ask('not-an-email', '10.0.0.4'), 400);
  assert.equal(sent.length, before2);
});
