/* /api/contact takes stranger-supplied text and puts it in the office's inbox,
   in notification subjects, and — once an application is approved — inside the
   HTML of a welcome email sent from the Chamber's own domain. These pin the
   input limits that keep that safe.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';

let server, base, sent;

before(async () => {
  sent = [];
  mock.module('../email.js', {
    namedExports: {
      send: async (m) => { sent.push(m); return { ok: true, id: 'test', provider: 'stub' }; },
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
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server && server.close(); mock.reset(); });

const post = (body) => fetch(`${base}/api/contact`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('an address that is not an address is refused', async () => {
  const r = await post({ email: 'definitely-not-an-email', message: 'hello' });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.ok, false);
  assert.match(j.error, /valid email/i);
});

test('a valid submission is still accepted', async () => {
  const r = await post({ email: 'someone@example.com', name: 'Jane Doe', message: 'Interested in joining.' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('an enormous message is truncated rather than relayed whole', async () => {
  // kind 'rsvp' always notifies the office, so the stored text reaches the stub.
  const huge = 'A'.repeat(50_000);
  const before2 = sent.length;
  const r = await post({ kind: 'rsvp', reason: 'RSVP', email: 'guest@example.com', name: 'Guest', message: huge });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 120)); // notification is fire-and-forget
  const note = sent.slice(before2).find((m) => /RSVP/i.test(m.subject || ''));
  assert.ok(note, 'expected an RSVP notification to the office');
  assert.ok(note.text.length < 10_000, `notification body should be bounded, was ${note.text.length}`);
  assert.ok(!note.text.includes('A'.repeat(6000)), 'the 50k message should not survive intact');
});

test('an over-long name and company are bounded too', async () => {
  const r = await post({
    email: 'long@example.com',
    name: 'N'.repeat(5000),
    company: 'C'.repeat(5000),
    message: 'short',
  });
  assert.equal(r.status, 200);
});
