/* ============================================================
   WVWCCC — Payments via AGMS (Avant Garde Marketing Solutions)
   on the NMI gateway (transactiongateway.com / sandbox.nmi.com).

   Merchant of record = the Chamber. Heed never holds card data.
   PCI posture: SAQ-A — card fields are tokenized client-side with
   Collect.js; the raw PAN never touches this server.

   Flows used by the site:
   • Event tickets / donations  → one-time `sale()`
   • Memberships (annual)       → `addRecurring()` (NMI recurring) or v5 subscriptions
   • Receipts                   → emailed to payer + felicia@woodlandhillscc.net
   ============================================================ */
import { Buffer } from 'node:buffer';

// LIVE merchant account `woodlandhillscc` on transactiongateway.com (keys from
// Eduardo @ AGMS, 2026-07-02 — see agms/, gitignored). The security key only
// authenticates on this gateway. Override with AGMS_API_BASE if the account moves.
// Read at call time, not module load: server.js loads .env.local AFTER imports
// are evaluated (ES imports hoist), so a load-time read is empty in local dev.
const apiBase = () => process.env.AGMS_API_BASE || 'https://agms.transactiongateway.com';
const securityKey = () => process.env.AGMS_SECURITY_KEY || '';

/* ── Two funds, two bank accounts (Felicia, Sep 9 2026) ──────
   The Chamber and the Community Benefit Foundation are separate legal
   entities: the Foundation is a 501(c)(3) and its donations are
   tax-deductible. Until now every charge on the site ran through the one
   gateway account and landed in the Chamber's OPERATING account — including
   gifts made on the Foundation's own donation page.

   Eduardo @ AGMS adds a SECOND PROCESSOR under the same gateway; NMI then
   routes a transaction by the `processor_id` we send. So the security key
   and Collect.js tokenization key stay exactly as they are, and the only
   thing that decides where the money settles is the id below.

   Set AGMS_PROCESSOR_ID_FOUNDATION once AGMS hands it over. Leave
   AGMS_PROCESSOR_ID_CHAMBER unset unless the Chamber's own processor stops
   being the gateway default — an empty processor_id means "use the default",
   which is today's behaviour. */
export const FUNDS = ['chamber', 'foundation'];
export function normalizeFund(fund) {
  return String(fund || '').trim().toLowerCase() === 'foundation' ? 'foundation' : 'chamber';
}
/** Gateway processor for a fund; '' = the gateway's default processor. */
export function processorFor(fund) {
  return normalizeFund(fund) === 'foundation'
    ? String(process.env.AGMS_PROCESSOR_ID_FOUNDATION || '').trim()
    : String(process.env.AGMS_PROCESSOR_ID_CHAMBER || '').trim();
}
/** True once a fund has somewhere of its own to settle into. */
export function fundRoutable(fund) {
  return normalizeFund(fund) === 'chamber' ? true : !!processorFor(fund);
}
/** Legal entity behind a fund — for receipts, which must name who was paid. */
export function fundEntity(fund) {
  return normalizeFund(fund) === 'foundation'
    ? { name: 'WVWCCC Community Benefit Foundation', short: 'Community Benefit Foundation', taxDeductible: true }
    : { name: 'West Valley \u00b7 Warner Center Chamber of Commerce', short: 'Chamber of Commerce', taxDeductible: false };
}

/** Parse NMI's application/x-www-form-urlencoded response body. */
export function parseNmiResponse(body) {
  const p = new URLSearchParams(body);
  const code = p.get('response'); // 1=approved, 2=declined, 3=error
  return {
    approved: code === '1',
    declined: code === '2',
    error: code === '3',
    responseText: p.get('responsetext') || '',
    transactionId: p.get('transactionid') || '',
    authCode: p.get('authcode') || '',
    avs: p.get('avsresponse') || '',
    cvv: p.get('cvvresponse') || '',
    orderId: p.get('orderid') || '',
    raw: Object.fromEntries(p.entries()),
  };
}

async function post(params) {
  if (!securityKey()) throw new Error('AGMS_SECURITY_KEY not set');
  // An EMPTY processor_id is not the same as none: NMI rejects the blank
  // value rather than falling back to the default processor. Drop the key.
  const clean = { ...params };
  if (!clean.processor_id) delete clean.processor_id;
  const body = new URLSearchParams({ security_key: securityKey(), ...clean });
  const res = await fetch(`${apiBase()}/api/transact.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return parseNmiResponse(await res.text());
}

/**
 * One-time sale. `paymentToken` comes from Collect.js (client-side tokenization).
 * @param {{paymentToken:string, amount:number|string, orderId?:string,
 *          email?:string, firstName?:string, lastName?:string,
 *          productSku?:string, description?:string,
 *          fund?:'chamber'|'foundation', processorId?:string}} opts
 */
export function sale(opts) {
  return post({
    type: 'sale',
    payment_token: opts.paymentToken,
    amount: Number(opts.amount).toFixed(2),
    orderid: opts.orderId || '',
    order_description: opts.description || '',
    email: opts.email || '',
    first_name: opts.firstName || '',
    last_name: opts.lastName || '',
    // AVS (account requires it): billing street + ZIP
    address1: opts.address1 || '',
    city: opts.city || '',
    state: opts.state || '',
    zip: opts.zip || '',
    merchant_defined_field_1: opts.productSku || '', // SKU tracking per the deal
    // Which of the two merchant accounts settles this charge (see FUNDS above).
    processor_id: opts.processorId || '',
    merchant_defined_field_2: normalizeFund(opts.fund), // readable in gateway reports
  });
}

/**
 * Recurring membership. NMI bills `planAmount` on `planPayments` schedule.
 * @param {{paymentToken:string, planAmount:number, dayFrequency?:number,
 *          monthFrequency?:number, dayOfMonth?:number, planPayments?:number,
 *          email?:string, orderId?:string}} opts
 */
export function addRecurring(opts) {
  return post({
    recurring: 'add_subscription',
    payment_token: opts.paymentToken,
    // AVS (account requires it): billing street + ZIP
    address1: opts.address1 || '',
    city: opts.city || '',
    zip: opts.zip || '',
    plan_amount: Number(opts.planAmount).toFixed(2),
    // annual dues: month_frequency 12, day_of_month set; else use day_frequency
    month_frequency: opts.monthFrequency != null ? String(opts.monthFrequency) : '12',
    day_of_month: opts.dayOfMonth != null ? String(opts.dayOfMonth) : '1',
    plan_payments: opts.planPayments != null ? String(opts.planPayments) : '0', // 0 = until cancelled
    orderid: opts.orderId || '',
    email: opts.email || '',
    processor_id: opts.processorId || '',
  });
}

/** Refund a SETTLED charge (full refund when amount is omitted). */
export function refundTransaction(opts) {
  const p = { type: 'refund', transactionid: opts.transactionId };
  if (opts.amount != null) p.amount = Number(opts.amount).toFixed(2);
  return post(p);
}

/** Void a charge still PENDING settlement (NMI rejects refunds on those). */
export function voidTransaction(opts) {
  return post({ type: 'void', transactionid: opts.transactionId });
}

/* ── Front-end note (do NOT implement card fields ourselves) ──
   Load Collect.js on checkout pages:
     <script src="https://agms.transactiongateway.com/token/Collect.js"
             data-tokenization-key="<PUBLIC tokenization key from gateway>"></script>
   On submit, Collect.js returns `payment_token`; POST it to our /api/pay route,
   which calls sale()/addRecurring() above. v5 REST (invoices/customers/products/
   subscriptions) at `${API_BASE}/api/v5` is the alternative for hosted invoicing. */
