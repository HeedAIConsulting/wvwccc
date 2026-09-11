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

/* ── Diana, Sep 10 2026: "Still not there." ──────────────────
   She had done it right: a Discount Ticket row at $50 with the link key
   filled in, and the share link the admin built for her. Opening it showed
   the five ordinary prices.

   The event's `updated` was still two days old. The row had never been
   saved — and the admin had handed her a link for it anyway, because the
   first version built the link the instant the key was typed. A link that
   cannot work yet is worse than no link, so the row now withholds it until
   the key is saved, and the save hands it over.

   Two things kept her from saving without noticing: the form raises a
   confirm() over a suspect price, cancelling it saves nothing, and one of
   that event's existing rows — "Party Pack - Buy 5 get 1 Ticket Free!
   Early Bird $325" — tripped the "name says free but charges $325" check
   on every single save. The word belongs to the offer; the name states its
   own price and charges it.

   The link-building and the warning both live in admin.js and are verified
   in a browser. What is pinned here is the half that crosses the wire. */
test('a link key added to an existing event survives the save', async () => {
  const r = await adm(`/api/admin/events/${encodeURIComponent(evId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ticketTypes: [
        { name: 'General', price: 125 },
        { name: 'Ambassador', price: 50, linkKey: KEY },
        { name: 'Discount Ticket', price: 50, qty: 20, linkKey: 'Discount' },
      ],
    }),
  });
  const txt = await r.text();
  assert.equal(r.status, 200, txt);
  const rows = JSON.parse(txt).event.ticketTypes;
  const row = rows.find((t) => t.name === 'Discount Ticket');
  assert.ok(row, 'the new row must persist — this is what had not happened');
  assert.equal(row.linkKey, 'discount', 'stored lower-case, so the URL compares regardless of how it was typed');
  assert.equal(row.price, 50);
  // and the key still gates the charge
  const bad = await pay({ sku: `ticket:${evId}:discount-ticket`, amount: 50 });
  assert.match(bad.body.error, /not available at this link/i);
  const ok = await pay({ sku: `ticket:${evId}:discount-ticket`, amount: 50, linkKey: 'discount' });
  assert.ok(!/not available at this link/i.test(ok.body.error || ''));
});

test('the admin never offers a share link for a key the server lacks', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../admin/admin.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function refreshTicketLinks'), src.indexOf('function refreshTicketLinks') + 1800);
  assert.ok(fn.includes('savedLinkKeys.has'),
    'the row must check the key against what was actually saved before offering a link');
  assert.ok(/savedLinkKeys = new Set\(/.test(src) && src.includes('ev.ticketTypes'),
    'and that set must be refilled from the event whenever the form is opened');
});

/* Diana again, Sep 11: "I'm not seeing a special link for the hidden ticket."

   Her screenshot showed the Discount Tickets row filled in correctly and my
   own note underneath it reading "...and in the confirmation at the top".
   #eventMsg is at the BOTTOM of the form, immediately above the Save event
   button. She looked where the note sent her, found nothing, and reported the
   link missing. The event's `updated` was still Sep 9, so it had never been
   saved either — the note was the only thing standing between her and the
   link, and it pointed the wrong way. */
test('the unsaved-key note points at the button, not into space', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../admin/admin.js', import.meta.url), 'utf8');
  // Strip comments first: this file explains the mistake, and the explanation
  // naturally quotes the wrong wording. Assert on what Diana sees, not on the
  // commentary about it.
  const fn = src.slice(src.indexOf('function refreshTicketLinks'), src.indexOf('function refreshTicketLinks') + 2400)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/at the top/i.test(fn),
    'the confirmation is at the bottom of the form — never send her to the top');
  assert.ok(/Save event/.test(fn), 'name the button she has to press');
  assert.ok(/bottom/i.test(fn), 'and say where that button is');
});

test('a save that produced links scrolls them into view', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../admin/admin.js', import.meta.url), 'utf8');
  const at = src.indexOf('showShareLinks(savedId, keyed)');
  assert.ok(at > -1, 'the save should still hand over the links');
  assert.match(src.slice(at, at + 260), /msg\.scrollIntoView/,
    'saving resets the form and reflows the page — put the links on screen rather than hoping');
});
