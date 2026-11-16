/* Felicia, Nov 16 2026: "I am not receiving the generated payment receipts"
   and "I am also not receiving RSVP's for our Nov Mixer". One copy to her
   bounced on Nov 12, the email service blocked her address for good, and
   18 office emails went nowhere for four days without anyone being told.
   A blocked Chamber address is now recorded, Diana is emailed once, and the
   Admin dashboard shows it in red with an Unblock button.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const SECRET = 'whsec_' + Buffer.from('office-mail-test-key').toString('base64');
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
let server, base, sent, mod, repo;

before(async () => {
  sent = [];
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  delete process.env.OFFICE_ALERT_TO;
  mock.module('../email.js', {
    namedExports: {
      send: async (m) => { sent.push(m); return { ok: true, id: 'test', provider: 'stub' }; },
      notifyTo: () => 'felicia@woodlandhillscc.net',
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
    },
  });
  const express = (await import('express')).default;
  mod = await import('../email-events.js');
  repo = await import('../repo.js');
  await repo.setSetting(mod.OFFICE_KEY, '{}');
  const app = express();
  app.use('/api/email/events', express.raw({ type: () => true, limit: '1mb' }));
  app.use(express.json());
  app.post('/api/email/events', mod.handleEmailEvent);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server && server.close(); mock.reset(); delete process.env.RESEND_WEBHOOK_SECRET; });

const sign = (body) => {
  const id = 'msg_' + crypto.randomUUID(); const ts = Math.floor(Date.now() / 1000);
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}` };
};
const post = async (event) => {
  const body = JSON.stringify(event);
  const r = await fetch(`${base}/api/email/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...sign(body) }, body });
  await new Promise((res) => setTimeout(res, 150));
  return r;
};
const ev = (type, over = {}) => ({
  type, created_at: '2026-11-13T00:11:00.000Z',
  data: { email_id: 'em-' + crypto.randomUUID(), from: 'wendy@woodlandhillscc.net', to: ['felicia@woodlandhillscc.net'],
    subject: 'New RSVP — Bobby Burns for Networking Mixer', created_at: '2026-11-13T00:11:00.000Z', ...over },
});
const officeAlerts = (from) => sent.slice(from).filter((m) => /is not being delivered$/.test(m.subject));
const blocks = async () => mod.readBlocks(await repo.getSetting(mod.OFFICE_KEY));

test('a bounce to the office mailbox records it and tells Diana, once', async () => {
  const n = sent.length;
  const first = ev('email.bounced', { bounce: { message: 'smtp; 550 Mailbox does not exist!', type: 'Permanent' } });
  assert.equal((await post(first)).status, 200);
  // Resend reports the same email again as suppressed: not counted twice.
  await post({ ...first, type: 'email.suppressed' });
  // Every later RSVP and receipt copy is suppressed: counted, no new alert.
  await post(ev('email.suppressed', { subject: 'Paid Receipt For Tickets 12814630994', created_at: '2026-11-16T18:03:00.000Z' }));
  const a = officeAlerts(n);
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].to, ['diana@woodlandhillscc.net'], 'never to the address that is blocked');
  assert.equal(a[0].subject, 'Website email to felicia@woodlandhillscc.net is not being delivered');
  assert.match(a[0].text, /Since Nov 12, 4:11 PM, email from the Chamber website/);
  assert.match(a[0].text, /Why: 550 Mailbox does not exist!/);
  assert.match(a[0].text, /Admin → Pay Log/);
  assert.match(a[0].text, /"Unblock felicia@woodlandhillscc\.net"/);
  const b = (await blocks())['felicia@woodlandhillscc.net'];
  assert.equal(b.count, 2);
  assert.equal(b.since, '2026-11-13T00:11:00.000Z');
  assert.equal(b.last, '2026-11-16T18:03:00.000Z');
  assert.equal(b.lastSubject, 'Paid Receipt For Tickets 12814630994');
});

test('a customer address is not an office block, and delivered mail is ignored', async () => {
  const before = JSON.stringify(await blocks());
  await post(ev('email.bounced', { to: ['ctester@example.com'] }));
  await post(ev('email.delivered', { to: ['diana@woodlandhillscc.net'] }));
  assert.equal(JSON.stringify(await blocks()), before);
});

test('when Diana is the one blocked, the alert does not go to her', async () => {
  process.env.OFFICE_ALERT_TO = 'diana@woodlandhillscc.net';
  const n = sent.length;
  await post(ev('email.failed', { to: ['Diana@WoodlandHillsCC.net'], failed: { reason: 'quota' } }));
  assert.equal(officeAlerts(n).length, 0);
  assert.ok((await blocks())['diana@woodlandhillscc.net'], 'still recorded for the dashboard');
  delete process.env.OFFICE_ALERT_TO;
});

test('Unblock asks Resend to lift the block, then clears the notice', async () => {
  process.env.RESEND_API_KEY = 're_test';
  const calls = [];
  const ok = await mod.unblockOffice('felicia@woodlandhillscc.net', async (url, opts) => {
    calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ object: 'suppression', deleted: true }) };
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.wasSuppressed, true);
  assert.equal(calls[0].url, 'https://api.resend.com/suppressions/felicia%40woodlandhillscc.net');
  assert.equal(calls[0].opts.method, 'DELETE');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer re_test');
  assert.equal((await blocks())['felicia@woodlandhillscc.net'], undefined);
  const list = await mod.listOfficeBlocks();
  assert.deepEqual(list.map((x) => x.address), ['diana@woodlandhillscc.net']);
});

test('Unblock treats "not on the list" as done, and keeps the notice on any other refusal', async () => {
  process.env.RESEND_API_KEY = 're_test';
  const gone = await mod.unblockOffice('diana@woodlandhillscc.net', async () => ({ ok: false, status: 404, json: async () => ({}) }));
  assert.equal(gone.ok, true);
  assert.equal(gone.wasSuppressed, false);
  await post(ev('email.bounced', { to: ['felicia@woodlandhillscc.net'] }));
  const refused = await mod.unblockOffice('felicia@woodlandhillscc.net', async () => ({ ok: false, status: 401, json: async () => ({ message: 'This API key is restricted to only send emails' }) }));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /401 \(This API key is restricted to only send emails\)/);
  assert.match(refused.error, /Resend → Suppressions/);
  assert.ok((await blocks())['felicia@woodlandhillscc.net'], 'notice stays up');
  const outsider = await mod.unblockOffice('someone@example.com', async () => { throw new Error('must not call'); });
  assert.equal(outsider.status, 400);
  delete process.env.RESEND_API_KEY;
});

test('the dashboard shows the notice, where the data is, and the Unblock button', () => {
  assert.match(read('admin/index.html'), /<div id="mailBlocked" hidden><\/div>/);
  const js = read('admin/admin.js');
  assert.match(js, /mountShell\('dashboard'\);\n    renderMailBlocked\(\);/);
  assert.match(js, /api\('\/api\/admin\/office-mail'\)/);
  assert.match(js, /'\/api\/admin\/office-mail\/unblock'/);
  for (const label of ['Pay Log', 'Event RSVPs', 'RSVPs / $', 'Unblock ']) assert.ok(js.includes(label), label);
  const routes = read('backend/chamber-routes.js');
  assert.match(routes, /router\.get\('\/admin\/office-mail', requireAdmin/);
  assert.match(routes, /router\.post\('\/admin\/office-mail\/unblock', requireAdmin/);
});
