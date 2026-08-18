/* Felicia, Aug 18 2026, on the notification the office receives: "Not liking
   this one... We like the look of the old receipts" - and separately, "I do
   like that the subject line says what event the RSVP is for!" So the subject
   is pinned here as well as the layout, to keep a later tidy-up from quietly
   dropping the part she asked to keep.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';

let server, base, sent;

before(async () => {
  sent = [];
  mock.module('../email.js', {
    namedExports: {
      send: async (m) => { sent.push(m); return { ok: true, id: 'test', provider: 'stub' }; },
      notifyTo: () => 'felicia@woodlandhillscc.net',
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
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

  await fetch(`${base}/api/contact`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'rsvp', reason: 'RSVP',
      firstName: 'Odelia', lastName: 'Samya',
      email: 'odelia@zoloins.com', phone: '818-389-8659',
      company: 'Zolo Insurance Services, Inc.',
      event: 'August 26th Networking Mixer [ev-mruu80zk6qp]',
      eventTitle: 'August 26th Networking Mixer',
      ticketType: 'Member Free With Pre-registration',
      quantity: 4,
      attendees: [
        { name: 'Shalom (Sam) Samya', email: 'sam@zoloins.com', phone: '818-300-5633' },
        { name: 'Kevin Safatian', email: 'kevin@zoloins.com', phone: '818-688-4418' },
      ],
      message: 'legacy blob kept for Admin -> Inquiries',
    }),
  });
  await new Promise((r) => setTimeout(r, 250));
});

after(() => { server && server.close(); mock.reset(); });

const note = () => sent.find((m) => /New RSVP/.test(m.subject || ''));

test('the subject still names the event and who RSVPd', () => {
  const n = note();
  assert.ok(n, 'the office should get an RSVP notification');
  assert.match(n.subject, /^New RSVP — August 26th Networking Mixer \(Odelia Samya\)$/);
});

test('it is laid out like the old confirmation, not a wall of text', () => {
  const { text, html } = note();
  for (const marker of ['THANK YOU', 'GUEST INFO', 'RSVP Qty: 4', 'Registration: Member Free With Pre-registration']) {
    assert.ok(text.includes(marker), `plain text missing: ${marker}`);
  }
  assert.ok(html, 'an HTML version should be sent so it renders like the receipt');
  assert.ok(html.includes('THANK YOU') && html.includes('GUEST INFO'));
  assert.match(text, /\* This is an RSVP only\. Please pay at the door\./);
});

test('every attendee is listed with their own contact details', () => {
  const { text } = note();
  for (const who of ['Shalom (Sam) Samya', 'sam@zoloins.com', '818-300-5633', 'Kevin Safatian', 'kevin@zoloins.com']) {
    assert.ok(text.includes(who), `missing attendee detail: ${who}`);
  }
});

test('the raw event id never reaches the inbox', () => {
  const { text, html } = note();
  assert.ok(!text.includes('ev-mruu80zk6qp'), 'plain text leaked the internal event id');
  assert.ok(!html.includes('ev-mruu80zk6qp'), 'html leaked the internal event id');
});

test('a non-RSVP inquiry keeps the plain generic body', async () => {
  const before2 = sent.length;
  await fetch(`${base}/api/contact`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'contact', email: 'someone@example.com', name: 'A Person', message: 'Just asking' }),
  });
  await new Promise((r) => setTimeout(r, 150));
  const extra = sent.slice(before2).find((m) => /THANK YOU/.test(m.text || ''));
  assert.equal(extra, undefined, 'only RSVPs should use the receipt layout');
});
