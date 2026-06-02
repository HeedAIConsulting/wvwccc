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

const API_BASE = process.env.AGMS_API_BASE || 'https://sandbox.nmi.com';
const SECURITY_KEY = process.env.AGMS_SECURITY_KEY || '';

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
  if (!SECURITY_KEY) throw new Error('AGMS_SECURITY_KEY not set');
  const body = new URLSearchParams({ security_key: SECURITY_KEY, ...params });
  const res = await fetch(`${API_BASE}/api/transact.php`, {
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
 *          productSku?:string, description?:string}} opts
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
    merchant_defined_field_1: opts.productSku || '', // SKU tracking per the deal
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
    plan_amount: Number(opts.planAmount).toFixed(2),
    // annual dues: month_frequency 12, day_of_month set; else use day_frequency
    month_frequency: opts.monthFrequency != null ? String(opts.monthFrequency) : '12',
    day_of_month: opts.dayOfMonth != null ? String(opts.dayOfMonth) : '1',
    plan_payments: opts.planPayments != null ? String(opts.planPayments) : '0', // 0 = until cancelled
    orderid: opts.orderId || '',
    email: opts.email || '',
  });
}

/** Capture the Heed 15% remittance figure for a settled charge (logging only). */
export function heedShare(amount) {
  const rate = Number(process.env.HEED_REVENUE_SHARE || '0.15');
  return Math.round(Number(amount) * rate * 100) / 100;
}

/* ── Front-end note (do NOT implement card fields ourselves) ──
   Load Collect.js on checkout pages:
     <script src="https://agms.transactiongateway.com/token/Collect.js"
             data-tokenization-key="<PUBLIC tokenization key from gateway>"></script>
   On submit, Collect.js returns `payment_token`; POST it to our /api/pay route,
   which calls sale()/addRecurring() above. v5 REST (invoices/customers/products/
   subscriptions) at `${API_BASE}/api/v5` is the alternative for hosted invoicing. */
