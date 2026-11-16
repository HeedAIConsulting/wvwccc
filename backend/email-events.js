/* Receipts that never reach the customer (Felicia, Oct 27 2026).

   Chris Gomberg typed cgomberg@ at checkout, a mailbox that does not exist.
   His Oct 1 receipt bounced, Resend put the address on its suppression list,
   and every receipt after that was quietly dropped. Nobody knew until he
   asked. Ruslam Teaca's went the same way on Oct 26 ("sbcglobal.cnet").

   Resend now calls POST /api/email/events when an email bounces, is
   suppressed or fails. For a payment receipt, the office is emailed who it
   was for, the address it went to, what they paid and why it did not arrive,
   so the receipt can be forwarded to the right address the same day.

   The request is signed by Resend (Svix scheme) with RESEND_WEBHOOK_SECRET.
   Without the secret, or with a bad signature, nothing is accepted: this
   route sends email to the office, so it must not be callable by anyone. */
import crypto from 'node:crypto';
import * as email from './email.js';
import * as repo from './repo.js';

const TOLERANCE_MS = 5 * 60 * 1000;
const UNDELIVERED = new Set(['email.bounced', 'email.suppressed', 'email.failed']);

// Svix signature check: HMAC-SHA256 of "<id>.<timestamp>.<raw body>" with the
// base64 secret after "whsec_", compared against each "v1,<sig>" in the header.
export function verifySignature(secret, headers, raw, now = Date.now()) {
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const sigs = String(headers['svix-signature'] || '');
  if (!secret || !id || !ts || !sigs) return false;
  const t = Number(ts) * 1000;
  if (!Number.isFinite(t) || Math.abs(now - t) > TOLERANCE_MS) return false;
  let key;
  try { key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64'); } catch { return false; }
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest();
  return sigs.split(' ').some((part) => {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

// "Paid Receipt For Tickets 12731617937" / "Paid Receipt 12728605712" → the ref.
export function receiptRef(subject) {
  const m = /^Paid Receipt(?: For Tickets)? (\S+)$/.exec(String(subject || '').trim());
  return m ? m[1] : '';
}

// The ref on a receipt is the gateway transaction id, or the order id when
// the gateway gave none (see the receipt in chamber-routes.js).
export function findOrder(orders, ref) {
  return orders.find((o) => String(o.transactionId || o.transaction_id || '') === ref)
    || orders.find((o) => String(o.id || '').replace('ord-', '').toUpperCase() === ref)
    || null;
}

function why(type, data) {
  if (type === 'email.suppressed') {
    return 'An earlier email to this address bounced, so the email service no longer sends to it. The address is most likely mistyped or no longer in use.';
  }
  const detail = (data.bounce && data.bounce.message) || (data.failed && data.failed.reason) || '';
  if (type === 'email.bounced') {
    return `The customer's mail server turned it away${detail ? `: ${detail}` : '.'} The address is most likely mistyped or no longer in use.`;
  }
  return `It could not be sent${detail ? `: ${detail}` : '.'}`;
}

export function alertFor({ type, data }, order, eventTitle = '') {
  const ref = receiptRef(data.subject);
  const to = (Array.isArray(data.to) ? data.to : [data.to]).filter(Boolean).join(', ');
  const name = (order && order.name) || 'the customer';
  const amount = order && order.amount != null ? `$${Number(order.amount).toFixed(2)}` : '';
  const what = eventTitle ? `Tickets: ${eventTitle}` : ((order && (order.memo || order.sku)) || '');
  const paid = order && order.created ? new Date(order.created).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const lines = [
    `The receipt for this payment did not reach ${name}.`,
    '',
    `Name:     ${name}`,
    `Sent to:  ${to}`,
    order && order.phone ? `Phone:    ${order.phone}` : null,
    what ? `For:      ${what}` : null,
    amount ? `Amount:   ${amount}` : null,
    paid ? `Paid:     ${paid}` : null,
    `Order:    ${ref}`,
    '',
    `Why: ${why(type, data)}`,
    '',
    'The payment went through; only the email was lost. Check the address with them,',
    `then forward them your copy of the receipt ("${data.subject}").`,
  ].filter((l) => l !== null);
  return { subject: `Receipt not delivered — ${name} (order ${ref})`, text: lines.join('\n') };
}

/* The office's own mailbox (Felicia, Nov 16 2026: "I am not receiving the
   generated payment receipts ... I am also not receiving RSVP's for our Nov
   Mixer"). On Nov 12 one copy to felicia@ bounced with "550 Mailbox does not
   exist!", Resend suppressed the address for good, and every receipt copy and
   RSVP after it was dropped for four days. Nobody was told, because the alert
   for an undelivered email goes to that same mailbox.

   Now any bounce, suppression or failure to a Chamber address is recorded in
   one settings key, OFFICE_KEY, keyed by address. The first one emails
   OFFICE_ALERT_TO (default Diana; never the blocked address itself), and
   Admin → Dashboard shows a red notice with an Unblock button until it is
   cleared. */
export const OFFICE_KEY = 'officeMailBlocks';
export const OFFICE_DOMAIN = 'woodlandhillscc.net';
export const isOfficeAddress = (a) => String(a || '').trim().toLowerCase().endsWith('@' + OFFICE_DOMAIN);
const officeAlertTo = (blocked) => String(process.env.OFFICE_ALERT_TO || 'diana@woodlandhillscc.net')
  .split(',').map((a) => a.trim().toLowerCase()).filter((a) => a && a !== blocked);

export function readBlocks(raw) {
  try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  catch { return {}; }
}
// One event folded into the record for its address. Returns null when this
// email was already counted (Resend reports a bounce and then a suppression).
export function foldBlock(prev, { type, data = {} }, now = new Date().toISOString()) {
  const id = String(data.email_id || '');
  const seen = (prev && prev.emailIds) || [];
  if (id && seen.includes(id)) return null;
  const detail = (data.bounce && Array.isArray(data.bounce.diagnosticCode) && data.bounce.diagnosticCode[0])
    || (data.bounce && data.bounce.message) || (data.failed && data.failed.reason) || '';
  return {
    since: (prev && prev.since) || data.created_at || now,
    last: data.created_at || now,
    count: ((prev && prev.count) || 0) + 1,
    firstReason: (prev && prev.firstReason) || (type === 'email.suppressed'
      ? 'An earlier email to this address bounced, so the email service stopped sending to it.'
      : String(detail).replace(/^smtp;\s*/i, '') || type),
    lastSubject: String(data.subject || '').slice(0, 200),
    emailIds: (id ? seen.concat(id) : seen).slice(-200),
  };
}
export function officeAlert(address, block) {
  const when = new Date(block.since).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return {
    subject: `Website email to ${address} is not being delivered`,
    text: [
      `Since ${when}, email from the Chamber website to ${address} is not arriving.`,
      `That includes copies of payment receipts and RSVP notices.`,
      '',
      `Why: ${block.firstReason}`,
      `Last one not delivered: "${block.lastSubject}"`,
      '',
      'Everything is still on the website: payments in Admin → Pay Log, RSVPs in',
      'Admin → Inquiries and on each event in Admin → Events.',
      '',
      'Once the mailbox is working, open Admin → Dashboard and click',
      `"Unblock ${address}" in the red notice at the top.`,
    ].join('\n'),
  };
}
async function recordOfficeBlocks(event) {
  const { data = {} } = event;
  const to = (Array.isArray(data.to) ? data.to : [data.to]).map((a) => String(a || '').trim().toLowerCase()).filter(isOfficeAddress);
  if (!to.length) return;
  const blocks = readBlocks(await repo.getSetting(OFFICE_KEY));
  const fresh = [];
  for (const addr of to) {
    const next = foldBlock(blocks[addr], event);
    if (!next) continue;
    if (!blocks[addr]) fresh.push(addr);
    blocks[addr] = next;
  }
  await repo.setSetting(OFFICE_KEY, JSON.stringify(blocks));
  for (const addr of fresh) {
    const { subject, text } = officeAlert(addr, blocks[addr]);
    const rcpt = officeAlertTo(addr);
    if (rcpt.length) await email.send({ to: rcpt, subject, text });
    console.warn(`[email-events] office address blocked: ${addr} (${blocks[addr].firstReason})`);
  }
}

// Everything the dashboard notice needs, newest first.
export async function listOfficeBlocks() {
  await seedKnownBlocks();
  const blocks = readBlocks(await repo.getSetting(OFFICE_KEY));
  return Object.entries(blocks)
    .map(([address, b]) => ({ address, since: b.since, last: b.last, count: b.count, reason: b.firstReason, lastSubject: b.lastSubject }))
    .sort((a, b) => String(b.since).localeCompare(String(a.since)));
}

/* Felicia's address was suppressed on Nov 13 2026 00:17 UTC, before this code
   existed, so no event recorded it. Seeded once on production only, and only
   when nothing is recorded for her yet. 18 = the 2 bounces plus the 16 the
   email service dropped up to Nov 16. Unblock clears it like any other. */
const SEED_MARKER = 'officeMailBlocks-seed-20261116';
async function seedKnownBlocks() {
  if (!process.env.DATABASE_URL) return;
  if (await repo.getSetting(SEED_MARKER)) return;
  const blocks = readBlocks(await repo.getSetting(OFFICE_KEY));
  const addr = 'felicia@woodlandhillscc.net';
  if (!blocks[addr]) {
    blocks[addr] = {
      since: '2026-11-13T00:11:00.000Z', last: '2026-11-16T18:03:00.000Z', count: 18,
      firstReason: '550 Mailbox does not exist!',
      lastSubject: 'Paid Receipt For Tickets 12814630994', emailIds: [],
    };
    await repo.setSetting(OFFICE_KEY, JSON.stringify(blocks));
  }
  await repo.setSetting(SEED_MARKER, new Date().toISOString());
}

/* Admin → Dashboard → Unblock. Takes the address off Resend's suppression
   list, then forgets the record. A 404 from Resend means it was not on the
   list (already removed by hand), which is the outcome wanted. Any other
   answer leaves the notice up and says why. */
export async function unblockOffice(address, fetchImpl = globalThis.fetch) {
  const addr = String(address || '').trim().toLowerCase();
  if (!isOfficeAddress(addr)) return { ok: false, status: 400, error: 'Only a Chamber address can be unblocked here.' };
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, status: 503, error: 'The email service key is not set on the server.' };
  const r = await fetchImpl(`https://api.resend.com/suppressions/${encodeURIComponent(addr)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${key}` },
  });
  if (!r.ok && r.status !== 404) {
    let detail = '';
    try { const j = await r.json(); detail = j && (j.message || j.name) ? ` (${j.message || j.name})` : ''; } catch {}
    console.error(`[email-events] unblock ${addr} failed: ${r.status}${detail}`);
    return { ok: false, status: 502, error: `The email service would not unblock ${addr}: ${r.status}${detail}. Ask Michael to remove it in Resend → Suppressions.` };
  }
  const blocks = readBlocks(await repo.getSetting(OFFICE_KEY));
  delete blocks[addr];
  await repo.setSetting(OFFICE_KEY, JSON.stringify(blocks));
  return { ok: true, address: addr, wasSuppressed: r.status !== 404 };
}

async function titleForSku(sku) {
  const id = (/^ticket:([^:]+):/.exec(String(sku || '')) || [])[1];
  if (!id) return '';
  try {
    const ev = (await repo.listEventsStore()).find((e) => e.id === id);
    return ev ? String(ev.title || '') : '';
  } catch { return ''; }
}

export async function handleEmailEvent(req, res) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'not configured' });
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  if (!verifySignature(secret, req.headers, raw)) return res.status(401).json({ error: 'bad signature' });
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'bad json' }); }
  const { type, data = {} } = event || {};
  res.json({ ok: true });

  if (UNDELIVERED.has(type)) {
    try { await recordOfficeBlocks(event); }
    catch (e) { console.error('[email-events] office block record failed', e); }
  }
  try {
    if (!UNDELIVERED.has(type)) return;
    const ref = receiptRef(data.subject);
    if (!ref) return;
    // The office's own copy bouncing is not something to email the office about.
    const office = String(email.notifyTo()).toLowerCase();
    const to = (Array.isArray(data.to) ? data.to : [data.to]).map((a) => String(a || '').toLowerCase());
    if (!to.length || to.every((a) => a === office)) return;
    // Resend retries, and a receipt can be reported as bounced and suppressed:
    // one alert per email.
    const key = `receiptUndelivered:${data.email_id || `${ref}:${to.join(',')}`}`;
    if (await repo.getSetting(key)) return;
    await repo.setSetting(key, `${type} ${new Date().toISOString()}`);
    const order = findOrder(await repo.listOrders(), ref);
    const { subject, text } = alertFor(event, order, order ? await titleForSku(order.sku) : '');
    await email.send({ to: email.notifyTo(), subject, text });
  } catch (e) { console.error('[email-events] receipt alert failed', e); }
}
