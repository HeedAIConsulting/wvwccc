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
