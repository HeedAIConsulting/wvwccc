/* Felicia, Oct 27 2026: Chris Gomberg "did not receive a generated receipt".
   He had typed cgomberg@, a mailbox that does not exist; his first receipt
   bounced on Oct 1, Resend suppressed the address, and nobody found out until
   he asked. Resend now reports bounced, suppressed and failed emails to
   /api/email/events, and a receipt among them emails the office.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const SECRET = 'whsec_' + Buffer.from('test-signing-key-0123456789').toString('base64');
const T = Date.now().toString(36);
const REF = '9' + String(Date.now()).slice(-10);
let server, base, sent, mod;

before(async () => {
  sent = [];
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  mock.module('../email.js', {
    namedExports: {
      send: async (m) => { sent.push(m); return { ok: true, id: 'test', provider: 'stub' }; },
      notifyTo: () => 'felicia@woodlandhillscc.net',
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
    },
  });
  const express = (await import('express')).default;
  mod = await import('../email-events.js');
  const repo = await import('../repo.js');
  await repo.addOrder({
    id: 'ord-test' + T, kind: 'ticket', sku: 'ticket:ev-nosuchevent:member-ticket',
    name: 'Chris Tester', email: 'ctester@example.com', phone: '818-555-0100',
    amount: 35, transactionId: REF, status: 'paid', memo: '',
  });
  // Same order as server.js: raw body for this path, before express.json.
  const app = express();
  app.use('/api/email/events', express.raw({ type: () => true, limit: '1mb' }));
  app.use(express.json());
  app.post('/api/email/events', mod.handleEmailEvent);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server && server.close(); mock.reset(); delete process.env.RESEND_WEBHOOK_SECRET; });

const sign = (body, { id = 'msg_' + crypto.randomUUID(), ts = Math.floor(Date.now() / 1000), secret = SECRET } = {}) => {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}` };
};
const post = async (event, opts) => {
  const body = JSON.stringify(event);
  const r = await fetch(`${base}/api/email/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...sign(body, opts) }, body,
  });
  await new Promise((res) => setTimeout(res, 150));
  return r;
};
const ev = (type, over = {}) => ({
  type, created_at: new Date().toISOString(),
  data: { email_id: 'em-' + crypto.randomUUID(), from: 'wendy@woodlandhillscc.net', to: ['ctester@example.com'],
    subject: `Paid Receipt For Tickets ${REF}`, ...over },
});
const alerts = (from) => sent.slice(from).filter((m) => /^Receipt not delivered/.test(m.subject));

test('a suppressed receipt emails the office who, where, what and what to do', async () => {
  const n = sent.length;
  const r = await post(ev('email.suppressed'));
  assert.equal(r.status, 200);
  const a = alerts(n);
  assert.equal(a.length, 1);
  assert.equal(a[0].to, 'felicia@woodlandhillscc.net');
  assert.equal(a[0].subject, `Receipt not delivered — Chris Tester (order ${REF})`);
  assert.match(a[0].text, /Sent to:  ctester@example\.com/);
  assert.match(a[0].text, /Phone:    818-555-0100/);
  assert.match(a[0].text, /Amount:   \$35\.00/);
  assert.match(a[0].text, /An earlier email to this address bounced/);
  assert.match(a[0].text, new RegExp(`forward them your copy of the receipt \\("Paid Receipt For Tickets ${REF}"\\)`));
  assert.doesNotMatch(a[0].text, /\n\n\n/, 'no stray blank lines from fields the order lacks');
});

test('a bounce says what the mail server said', async () => {
  const n = sent.length;
  await post(ev('email.bounced', { bounce: { message: 'Mailbox does not exist', type: 'Permanent' } }));
  const a = alerts(n);
  assert.equal(a.length, 1);
  assert.match(a[0].text, /turned it away: Mailbox does not exist/);
});

test('the same email reported twice alerts once', async () => {
  const n = sent.length;
  const e = ev('email.bounced');
  await post(e);
  await post({ ...e, type: 'email.suppressed' });
  assert.equal(alerts(n).length, 1);
});

test('nothing is accepted without a valid, fresh signature', async () => {
  const n = sent.length;
  const body = JSON.stringify(ev('email.bounced'));
  const unsigned = await fetch(`${base}/api/email/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(unsigned.status, 401);
  const forged = await post(ev('email.bounced'), { secret: 'whsec_' + Buffer.from('someone-else').toString('base64') });
  assert.equal(forged.status, 401);
  const stale = await post(ev('email.bounced'), { ts: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal(stale.status, 401);
  // A valid signature over a different body does not carry over.
  const real = JSON.stringify(ev('email.bounced'));
  const tampered = await fetch(`${base}/api/email/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...sign(real) },
    body: real.replace('ctester@example.com', 'someone@example.com'),
  });
  assert.equal(tampered.status, 401);
  assert.equal(alerts(n).length, 0);
});

test('without the secret the route refuses everything', async () => {
  const keep = process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.RESEND_WEBHOOK_SECRET;
  try {
    const r = await post(ev('email.bounced'));
    assert.equal(r.status, 503);
  } finally { process.env.RESEND_WEBHOOK_SECRET = keep; }
});

test('only undelivered customer receipts alert', async () => {
  const n = sent.length;
  await post(ev('email.delivered'));
  await post(ev('email.bounced', { subject: 'Your West Valley · Warner Center Chamber sign-in link' }));
  await post(ev('email.bounced', { to: ['felicia@woodlandhillscc.net'] }));
  assert.equal(alerts(n).length, 0);
});

test('a receipt with no matching order still alerts with what is known', async () => {
  const n = sent.length;
  await post(ev('email.suppressed', { subject: 'Paid Receipt 00000000001', to: ['nobody@example.com'] }));
  const a = alerts(n);
  assert.equal(a.length, 1);
  assert.match(a[0].text, /Sent to:  nobody@example\.com/);
  assert.match(a[0].text, /Order:    00000000001/);
});

test('receipt refs are read from both receipt subjects, and nothing else', () => {
  assert.equal(mod.receiptRef('Paid Receipt For Tickets 12731617937'), '12731617937');
  assert.equal(mod.receiptRef('Paid Receipt 12728605712'), '12728605712');
  assert.equal(mod.receiptRef('Re: Paid Receipt 12728605712'), '');
  assert.equal(mod.receiptRef('Your RSVP is confirmed — Mixer'), '');
});

test('the server keeps the raw body for this route ahead of the JSON parser', () => {
  const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  const raw = src.indexOf("app.use('/api/email/events', express.raw(");
  const json = src.indexOf('app.use(express.json(');
  assert.ok(raw > 0 && raw < json, 'express.raw for /api/email/events must come before express.json');
  assert.match(src, /app\.post\('\/api\/email\/events', handleEmailEvent\);\napp\.use\('\/api', chamberRoutes\);/);
});
