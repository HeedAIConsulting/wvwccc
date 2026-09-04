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
      // le-11343 is a real approved seed event — the guest confirmation only
      // goes out when the RSVP resolves to a real event (Aug 20 2026 review).
      // It is Martin's Connection Circle, i.e. a GROUP meeting, so this RSVP
      // also exercises the Sep 4 2026 leader routing below.
      event: "Martin's Connection Circle [le-11343]",
      eventTitle: "Martin's Connection Circle",
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
  assert.ok(n, 'an RSVP notification should go out');
  // The [group] prefix is there because this event IS a group meeting; the part
  // Felicia asked to keep is the event and the name that follow it.
  assert.match(n.subject, /^\[Martin's Connection Circle\] New RSVP — Martin's Connection Circle \(Odelia Samya\)$/);
});

test('it is laid out like the old confirmation, not a wall of text', () => {
  const { text, html } = note();
  for (const marker of ['THANK YOU', 'GUEST INFO', 'RSVP Qty: 4', 'Registration: Member Free With Pre-registration']) {
    assert.ok(text.includes(marker), `plain text missing: ${marker}`);
  }
  assert.ok(html, 'an HTML version should be sent so it renders like the receipt');
  assert.ok(html.includes('THANK YOU') && html.includes('GUEST INFO'));
});

test('the "pay at the door" line is GONE (Felicia, Aug 19 2026 — members who attend free were told to pay)', () => {
  const { text, html } = note();
  assert.ok(!/pay at the door/i.test(text), 'plain text still tells people to pay at the door');
  assert.ok(!/pay at the door/i.test(html), 'html still tells people to pay at the door');
});

test('the person who RSVPd gets their own confirmation copy (Aug 20 2026)', () => {
  const guest = sent.find((m) => m.to === 'odelia@zoloins.com' && /Your RSVP is confirmed/.test(m.subject || ''));
  assert.ok(guest, 'the RSVP submitter should receive a confirmation email');
  // The subject comes from OUR event record, never submitter-typed text — the
  // route must not be usable as a chamber-branded relay for arbitrary content.
  assert.match(guest.subject, /^Your RSVP is confirmed — Martin's Connection Circle \(\d{4}-\d{2}-\d{2}\)$/);
  assert.ok(guest.text.includes('THANK YOU'), 'the guest copy keeps the receipt layout');
  assert.ok(!/pay at the door/i.test(guest.text));
  assert.ok(!/Admin/.test(guest.text), 'the guest copy must not carry the admin footer');
  assert.ok(!guest.text.includes('le-11343'), 'the guest copy leaked the internal event id');
});

test('no guest confirmation when the RSVP does not reference a real event (relay guard)', async () => {
  const before3 = sent.length;
  await fetch(`${base}/api/contact`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'rsvp', name: 'Mallory', email: 'victim@example.com',
      event: 'Click here to claim your prize [ev-doesnotexist1]', eventTitle: 'Fake', quantity: 1,
    }),
  });
  await new Promise((r) => setTimeout(r, 200));
  const guest = sent.slice(before3).find((m) => m.to === 'victim@example.com');
  assert.equal(guest, undefined, 'an unresolvable event must never trigger a submitter-addressed email');
});

test('every attendee is listed with their own contact details', () => {
  const { text } = note();
  for (const who of ['Shalom (Sam) Samya', 'sam@zoloins.com', '818-300-5633', 'Kevin Safatian', 'kevin@zoloins.com']) {
    assert.ok(text.includes(who), `missing attendee detail: ${who}`);
  }
});

test('the raw event id never reaches the inbox', () => {
  const { text, html } = note();
  assert.ok(!text.includes('le-11343'), 'plain text leaked the internal event id');
  assert.ok(!html.includes('le-11343'), 'html leaked the internal event id');
});

/* Felicia, Sep 3 2026: "All the RSVPs are coming to me again... The Group RSVPs
   should be going to the group leaders, not me." They had never reached the
   leaders at all — an RSVP only carried a group when it started ON the group
   page, so the same meeting RSVP'd from the main calendar mailed the office and
   no one else. Both halves are pinned here: leaders get it, the office doesn't. */
test("a group meeting's RSVP goes to that group's leaders, not the office", () => {
  // One send per recipient, so the whole set has to be checked — looking at any
  // single message would pass no matter who else was copied. Scoped to THIS
  // event: other tests in this file post their own RSVPs into the same log.
  const to = sent
    .filter((m) => /New RSVP/.test(m.subject || '') && /Martin's Connection Circle/.test(m.subject))
    .map((m) => m.to);
  assert.ok(to.includes('martin.carman@synapticsystems.biz'),
    "Martin's Connection Circle leader should receive his own group's RSVP");
  assert.ok(!to.includes('felicia@woodlandhillscc.net'),
    'the office should no longer be copied on a group RSVP (Felicia, Sep 3 2026)');
});

/* The other half of the same instruction: a Chamber event is NOT a group
   meeting, and its RSVPs must still reach the office (Felicia, Aug 11 2026).
   This is the regression guard for matching events to groups by keyword — the
   Ambassador Committee's eventMatch is the single word "Mixer", so a substring
   rule would divert the Chamber's own mixers to that committee and away from
   Felicia. le-11188 is a real Networking Mixer with no group of its own. */
test('a Chamber event RSVP still reaches the office, and no committee grabs it', async () => {
  const before = sent.length;
  await fetch(`${base}/api/contact`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'rsvp', reason: 'RSVP', name: 'Pat Attendee',
      email: 'pat@example.com',
      event: 'February 25th~Networking Mixer Hosted by Safir Mediterranean Cuisine [le-11188]',
      eventTitle: 'February 25th~Networking Mixer Hosted by Safir Mediterranean Cuisine',
      quantity: 1,
    }),
  });
  await new Promise((r) => setTimeout(r, 250));
  const notes = sent.slice(before).filter((m) => /New RSVP/.test(m.subject || ''));
  assert.ok(notes.length, 'a mixer RSVP should still notify someone');
  assert.ok(notes.map((m) => m.to).includes('felicia@woodlandhillscc.net'),
    'the office must keep receiving RSVPs for the Chamber\'s own events');
  for (const m of notes) {
    assert.doesNotMatch(m.subject, /^\[/, 'no group should have claimed a Chamber mixer');
  }
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
