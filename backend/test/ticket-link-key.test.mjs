/* Diana, Sep 9 2026: "is there a feature when we create an event to have
   discount coupon price with a link? I want to hide a $50 ticket price option
   and share the link with certain members and Ambassadors only."

   There is — she asked for it herself in July, for board members selling $150
   gala tickets, and it shipped as `linkKey` on a ticket type. Admin > Events
   has the field, and the checkout dropdown hides that price unless the URL
   carries ?key=<the key>.

   But the hiding was BROWSER-SIDE ONLY. /api/pay recomputed the price from the
   event's ticketTypes and checked `available`, and never looked at linkKey —
   so the secret price could be bought by anyone who guessed the sku. The sku
   is ticket:<eventId>:<slug of the tier name>, so a tier called "Ambassador"
   is "ambassador". Not a hard guess for a $50 rate.

   These pin the server-side check. They deliberately do not go through the
   card gateway: the refusal must happen before any charge is attempted, so a
   400 with no gateway call is exactly the pass condition.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie, evId;
const T = Date.now().toString(36);
const ADMIN = `office-key-${T}@test.woodlandhillscc.net`;
const KEY = 'ambassador2026';

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
async function pay(body) {
  const r = await fetch(`${base}/api/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'ticket', quantity: 1, paymentToken: 'tok-test',
      firstName: 'A', lastName: 'B', email: 'a@example.com', phone: '8185551234',
      address1: '1 St', city: 'X', state: 'CA', zip: '91367',
      ...body,
    }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

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

  const r = await adm('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify({
      title: `Secret price event ${T}`, date: '2027-10-21', status: 'approved', ticketed: true,
      ticketTypes: [
        { name: 'General', price: 125 },
        { name: 'Ambassador', price: 50, linkKey: KEY },
      ],
    }),
  });
  const body = await r.json().catch(() => ({}));
  assert.equal(r.status, 200, JSON.stringify(body));
  evId = body.event.id;
});

after(async () => {
  if (evId) await adm(`/api/admin/events/${encodeURIComponent(evId)}`, { method: 'DELETE' }).catch(() => {});
  server && server.close();
  mock.reset();
});

test('the secret price is refused without the key — the whole point', async () => {
  const r = await pay({ sku: `ticket:${evId}:ambassador`, amount: 50 });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /not available at this link/i);
});

test('a wrong key is refused too', async () => {
  const r = await pay({ sku: `ticket:${evId}:ambassador`, amount: 50, linkKey: 'guessing' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not available at this link/i);
});

test('the right key gets past the price check', async () => {
  const r = await pay({ sku: `ticket:${evId}:ambassador`, amount: 50, linkKey: KEY });
  // The gateway is not configured in tests, so it cannot reach a charge — what
  // matters is that it is no longer refused for the KEY, and never for price.
  assert.ok(!/not available at this link/i.test(r.body.error || ''),
    `the key should be accepted, got: ${r.body.error}`);
  assert.ok(!/showed a different amount/i.test(r.body.error || ''),
    `$50 is the real price of this tier, got: ${r.body.error}`);
});

test('the key is not case-sensitive — people retype links by hand', async () => {
  const r = await pay({ sku: `ticket:${evId}:ambassador`, amount: 50, linkKey: KEY.toUpperCase() });
  assert.ok(!/not available at this link/i.test(r.body.error || ''));
});

test('the public price still needs no key at all', async () => {
  const r = await pay({ sku: `ticket:${evId}:general`, amount: 125 });
  assert.ok(!/not available at this link/i.test(r.body.error || ''),
    `an ordinary ticket must not be gated, got: ${r.body.error}`);
});

test('the key does not let someone pay the secret price for the public tier', async () => {
  const r = await pay({ sku: `ticket:${evId}:general`, amount: 50, linkKey: KEY });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /showed a different amount/i,
    'server-side price verification still governs — the key is access, not a discount');
});
