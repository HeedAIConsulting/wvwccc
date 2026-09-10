/* Felicia, Sep 9 2026: "As of now if someone chooses to make a donation to our
   CBF, the money is going to our operating account."

   True, and it was true of every charge on the site: one AGMS/NMI merchant
   account, one destination. The Community Benefit Foundation is a separate
   501(c)(3), so its donations, its event tickets and its sponsorships were
   landing in the wrong legal entity's bank account.

   The fix is a `fund` on every payment, resolved from the Chamber's own
   records — the event the office marked, the donation project's CBF flag —
   and sent to the gateway as `processor_id` so NMI settles it into the
   Foundation's own processor. A fund is decided server-side for the same
   reason a ticket price is: anything the browser sends, a payer can edit.

   These tests stub the gateway. What they check is which fund the server
   picked, which processor it addressed, and what the Pay Log then says.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { normalizeFund, processorFor, fundRoutable, fundEntity } from '../payments-agms.js';

let server, base, cookie, chamberEv, cbfEv;
const T = Date.now().toString(36);
const ADMIN = `office-fund-${T}@test.woodlandhillscc.net`;
const FOUNDATION_PROCESSOR = 'cbfproc123';

// Every gateway POST the route makes, in order — the assertions read these.
let gatewayCalls = [];
const realFetch = globalThis.fetch;

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
async function pay(body) {
  const r = await realFetch(`${base}/api/pay`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentToken: 'tok-test', firstName: 'A', lastName: 'B',
      email: 'donor@example.com', phone: '8185551234',
      address1: '1 St', city: 'Woodland Hills', state: 'CA', zip: '91367',
      ...body,
    }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const lastGateway = () => gatewayCalls[gatewayCalls.length - 1];

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Test Office`;
  process.env.AGMS_SECURITY_KEY = 'test-security-key';
  process.env.AGMS_PROCESSOR_ID_FOUNDATION = FOUNDATION_PROCESSOR;
  delete process.env.AGMS_PROCESSOR_ID_CHAMBER;
  delete process.env.FOUNDATION_PAYMENTS_REQUIRE_ROUTING;

  // Approve every card, and record exactly what was sent to the gateway.
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('transact.php')) {
      gatewayCalls.push(Object.fromEntries(new URLSearchParams(String(opts && opts.body))));
      return new Response('response=1&responsetext=SUCCESS&transactionid=TXN' + gatewayCalls.length + '&authcode=OK');
    }
    return realFetch(url, opts);
  };

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

  const login = await realFetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN, password: 'test-passcode-1' }),
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  const mk = async (title, fund) => {
    const r = await adm('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({
        title, date: '2027-11-04', status: 'approved', ticketed: true, fund,
        ticketTypes: [{ name: 'General', price: 40 }],
      }),
    });
    const txt = await r.text();
    assert.equal(r.status, 200, txt);
    return JSON.parse(txt).event;
  };
  chamberEv = await mk(`Chamber mixer ${T}`, 'chamber');
  cbfEv = await mk(`Foundation gala ${T}`, 'foundation');
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const ev of [chamberEv, cbfEv]) {
    if (ev) await adm(`/api/admin/events/${encodeURIComponent(ev.id)}`, { method: 'DELETE' }).catch(() => {});
  }
  server && server.close();
  mock.reset();
});

test('the fund helpers only ever answer chamber or foundation', () => {
  assert.equal(normalizeFund('foundation'), 'foundation');
  assert.equal(normalizeFund('FOUNDATION'), 'foundation');
  assert.equal(normalizeFund(' Foundation '), 'foundation');
  // Anything else is the Chamber — including junk a payer could post.
  for (const v of ['chamber', '', null, undefined, 'cbf', 'charity', 0, {}]) {
    assert.equal(normalizeFund(v), 'chamber', `${JSON.stringify(v)} must not become the Foundation`);
  }
  assert.equal(processorFor('foundation'), FOUNDATION_PROCESSOR);
  assert.equal(processorFor('chamber'), '', 'the Chamber stays on the gateway default');
  assert.equal(fundRoutable('chamber'), true);
  assert.equal(fundRoutable('foundation'), true);
  assert.equal(fundEntity('foundation').taxDeductible, true);
  assert.equal(fundEntity('chamber').taxDeductible, false,
    'the Chamber is a 501(c)(6) — a gift to it is not a charitable deduction');
});

test('an event saves and reports which account its money goes to', async () => {
  const r = await adm(`/api/admin/events`);
  const list = JSON.parse(await r.text()).events || [];
  assert.equal(list.find((e) => e.id === cbfEv.id).fund, 'foundation');
  assert.equal(list.find((e) => e.id === chamberEv.id).fund, 'chamber');
});

test('a new event defaults to the Chamber, never silently to the Foundation', async () => {
  const r = await adm('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify({ title: `Unmarked ${T}`, date: '2027-11-05', status: 'draft' }),
  });
  const ev = JSON.parse(await r.text()).event;
  assert.equal(ev.fund, 'chamber');
  await adm(`/api/admin/events/${encodeURIComponent(ev.id)}`, { method: 'DELETE' });
});

test('a Foundation event ticket is addressed to the Foundation processor', async () => {
  const r = await pay({ kind: 'ticket', sku: `ticket:${cbfEv.id}:general`, amount: 40, quantity: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(lastGateway().processor_id, FOUNDATION_PROCESSOR);
  assert.equal(lastGateway().merchant_defined_field_2, 'foundation');
});

test('a Chamber event ticket sends no processor at all — the gateway default', async () => {
  const r = await pay({ kind: 'ticket', sku: `ticket:${chamberEv.id}:general`, amount: 40, quantity: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal('processor_id' in lastGateway(), false,
    'an empty processor_id is rejected by NMI rather than defaulted — it must be omitted');
  assert.equal(lastGateway().merchant_defined_field_2, 'chamber');
});

test('the browser cannot redirect a Chamber ticket to the Foundation', async () => {
  const r = await pay({ kind: 'ticket', sku: `ticket:${chamberEv.id}:general`, amount: 40, quantity: 1, fund: 'foundation' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal('processor_id' in lastGateway(), false,
    'the event record decides, not the posted body');
});

test('nor the other way round — a Foundation ticket stays with the Foundation', async () => {
  const r = await pay({ kind: 'ticket', sku: `ticket:${cbfEv.id}:general`, amount: 40, quantity: 1, fund: 'chamber' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(lastGateway().processor_id, FOUNDATION_PROCESSOR);
});

test('a CBF donation project routes to the Foundation', async () => {
  const r = await pay({
    kind: 'donation', sku: 'donation:don-50', amount: 50,
    project: 'Earth Day & Tree Planting',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(lastGateway().processor_id, FOUNDATION_PROCESSOR);
});

test('a project name is matched however it was typed', async () => {
  const r = await pay({
    kind: 'donation', sku: 'donation:don-50', amount: 50,
    project: '  earth day & TREE planting ',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(lastGateway().processor_id, FOUNDATION_PROCESSOR);
});

test('a Chamber donation project stays with the Chamber', async () => {
  // Grateful Hearts is the Chamber's own program, not the Foundation's.
  const r = await pay({
    kind: 'donation', sku: 'donation:don-50', amount: 50,
    project: 'Grateful Hearts', fund: 'foundation',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal('processor_id' in lastGateway(), false,
    'the project the office flagged decides — the posted fund does not');
});

test('membership dues are always the Chamber — the Foundation has no members', async () => {
  const r = await pay({ kind: 'membership', sku: 'mem-basic', amount: 300, fund: 'foundation' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal('processor_id' in lastGateway(), false);
});

test('a custom payment link the office built carries its own fund', async () => {
  const r = await pay({ kind: 'payment', sku: 'payment:gala-valet', amount: 1000, fund: 'foundation' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(lastGateway().processor_id, FOUNDATION_PROCESSOR);
});

test('the Pay Log records the fund, so the office can see where money went', async () => {
  const r = await adm('/api/admin/orders');
  const orders = JSON.parse(await r.text()).orders || [];
  const cbf = orders.find((o) => o.sku === `ticket:${cbfEv.id}:general`);
  const cham = orders.find((o) => o.sku === `ticket:${chamberEv.id}:general`);
  assert.equal(cbf.fund, 'foundation');
  assert.equal(cbf.fundRouted, true);
  assert.equal(cham.fund, 'chamber');
});

test('the admin payment link builds a Foundation URL', async () => {
  const r = await adm('/api/admin/payment-link', {
    method: 'POST',
    body: JSON.stringify({ for: 'Gala valet sponsorship', amount: 1000, fund: 'foundation' }),
  });
  const body = JSON.parse(await r.text());
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.match(body.url, /fund=foundation/);
  const r2 = await adm('/api/admin/payment-link', {
    method: 'POST', body: JSON.stringify({ for: 'Dues renewal', amount: 450 }),
  });
  assert.doesNotMatch(JSON.parse(await r2.text()).url, /fund=/,
    'an ordinary link must not pick up the Foundation');
});

/* ── Before AGMS supplies the processor ─────────────────────
   The whole point of the flag: a Foundation charge taken while there is
   nowhere for it to settle is still a Foundation charge, and the office has
   to be able to find it and move the money. */
test('with no Foundation processor the charge is flagged, not lost', async () => {
  delete process.env.AGMS_PROCESSOR_ID_FOUNDATION;
  try {
    assert.equal(fundRoutable('foundation'), false);
    const r = await pay({ kind: 'ticket', sku: `ticket:${cbfEv.id}:general`, amount: 40, quantity: 1 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal('processor_id' in lastGateway(), false);
    const orders = JSON.parse(await (await adm('/api/admin/orders')).text()).orders || [];
    const flagged = orders.find((o) => o.transactionId === 'TXN' + gatewayCalls.length);
    assert.equal(flagged.fund, 'foundation');
    assert.equal(flagged.fundRouted, false, 'this one owes the Foundation a transfer');
  } finally {
    process.env.AGMS_PROCESSOR_ID_FOUNDATION = FOUNDATION_PROCESSOR;
  }
});

test('the office can choose to refuse instead of mis-routing', async () => {
  delete process.env.AGMS_PROCESSOR_ID_FOUNDATION;
  process.env.FOUNDATION_PAYMENTS_REQUIRE_ROUTING = '1';
  const before = gatewayCalls.length;
  try {
    const r = await pay({ kind: 'ticket', sku: `ticket:${cbfEv.id}:general`, amount: 40, quantity: 1 });
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.match(r.body.error, /347-4737/, 'tell them who to call');
    assert.equal(gatewayCalls.length, before, 'no card may be touched');
    // The Chamber's own payments keep working throughout.
    const ok = await pay({ kind: 'ticket', sku: `ticket:${chamberEv.id}:general`, amount: 40, quantity: 1 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  } finally {
    delete process.env.FOUNDATION_PAYMENTS_REQUIRE_ROUTING;
    process.env.AGMS_PROCESSOR_ID_FOUNDATION = FOUNDATION_PROCESSOR;
  }
});

/* The Pay Log runs on JSON locally and on Postgres in production, and the
   Postgres INSERT lists its columns by name — a field added to the order
   object alone is kept locally and silently dropped live. That is how this
   feature would have looked perfect in test and shipped an always-empty
   "needs transfer" list. Pin both ends. */
test('the fund columns exist in Postgres too, not just in the JSON store', async () => {
  const { readFileSync } = await import('node:fs');
  const repo = readFileSync(new URL('../repo.js', import.meta.url), 'utf8');
  const insert = repo.slice(repo.indexOf('INSERT INTO orders'), repo.indexOf('INSERT INTO orders') + 400);
  for (const col of ['fund', 'fund_routed']) {
    assert.ok(insert.includes(col), `orders INSERT must write ${col} or production loses it`);
  }
  assert.match(repo, /fundRouted:\s*o\.fund_routed/,
    'and read it back — PG rows are snake_case, the admin UI is camelCase');
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  assert.match(schema, /ALTER TABLE orders ADD COLUMN IF NOT EXISTS fund\b/);
  assert.match(schema, /ALTER TABLE orders ADD COLUMN IF NOT EXISTS fund_routed\b/);
});
