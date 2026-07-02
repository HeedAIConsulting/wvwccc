/* Transactional email — Resend relay (preferred), Microsoft Graph, or SMTP.

   RESEND (recommended — no M365 tenant admin needed; sends over HTTPS):
     RESEND_API_KEY   API key from https://resend.com (server-side only)
     EMAIL_FROM       From header, e.g. "West Valley · Warner Center Chamber <wendy@woodlandhillscc.net>"
                      (the domain in EMAIL_FROM must be verified in Resend via DNS)

   MICROSOFT GRAPH (app-only — needs Mail.Send Application + admin consent):
     MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET
     sender mailbox = GRAPH_SENDER || SMTP_USER || M365_PRIMARY_MAILBOX

   SMTP (M365 basic auth — blocked when tenant Security Defaults are on):
     SMTP_HOST/PORT/USER/PASS

   Selection order: Resend → Graph → SMTP → no-op (logs only). */

// ---- shared config ----
const FROM     = () => process.env.EMAIL_FROM || process.env.SMTP_FROM
  || `West Valley · Warner Center Chamber <${process.env.SMTP_USER || process.env.M365_PRIMARY_MAILBOX || 'wendy@woodlandhillscc.net'}>`;
export const notifyTo = () => process.env.CHAMBER_NOTIFY || process.env.SMTP_USER || process.env.M365_PRIMARY_MAILBOX || 'felicia@woodlandhillscc.net';

// ---- Resend ----
const RESEND_KEY  = () => process.env.RESEND_API_KEY;
const resendReady = () => !!RESEND_KEY();
async function sendResend({ to, subject, text, html, replyTo }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM(),
      to: [].concat(to).filter(Boolean),
      subject,
      ...(text ? { text } : {}),
      ...(html ? { html } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.id) return { ok: true, id: j.id, provider: 'resend' };
  throw new Error(`resend ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
}

// ---- Microsoft Graph (app-only) ----
const TENANT  = () => process.env.MS_GRAPH_TENANT_ID;
const CLIENT  = () => process.env.MS_GRAPH_CLIENT_ID;
const CSECRET = () => process.env.MS_GRAPH_CLIENT_SECRET;
const SENDER  = () => process.env.GRAPH_SENDER || process.env.SMTP_USER || process.env.M365_PRIMARY_MAILBOX;
const graphReady = () => !!(TENANT() && CLIENT() && CSECRET() && SENDER());

let _tok = null, _exp = 0;
async function graphToken() {
  const now = Date.now();
  if (_tok && now < _exp - 60000) return _tok;
  const url = `https://login.microsoftonline.com/${TENANT()}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT(), client_secret: CSECRET(),
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
  });
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`token ${r.status}: ${j.error_description || j.error || 'unknown'}`);
  _tok = j.access_token; _exp = now + (Number(j.expires_in) || 3600) * 1000;
  return _tok;
}
async function sendGraph({ to, subject, text, html, replyTo }) {
  const token = await graphToken();
  const message = {
    subject,
    body: { contentType: html ? 'HTML' : 'Text', content: html || text || '' },
    toRecipients: [].concat(to).filter(Boolean).map((a) => ({ emailAddress: { address: a } })),
  };
  if (replyTo) message.replyTo = [{ emailAddress: { address: replyTo } }];
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER())}/sendMail`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (r.status === 202) return { ok: true, id: 'graph-202', provider: 'graph' };
  let detail = ''; try { detail = JSON.stringify(await r.json()); } catch { /* ignore */ }
  throw new Error(`graph sendMail ${r.status}: ${detail.slice(0, 300)}`);
}

// ---- SMTP fallback ----
const USER = () => process.env.SMTP_USER;
const PASS = () => process.env.SMTP_PASS;
const smtpReady = () => !!(USER() && PASS());
let _tx = null;
async function transport() {
  if (_tx) return _tx;
  const nodemailer = (await import('nodemailer')).default;
  _tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false, requireTLS: true,
    auth: { user: USER(), pass: PASS() },
  });
  return _tx;
}
async function sendSmtp({ to, subject, text, html, replyTo }) {
  const tx = await transport();
  const info = await tx.sendMail({ from: FROM(), to, subject, text, html, replyTo });
  return { ok: true, id: info.messageId, provider: 'smtp' };
}

// ---- public API ----
export const enabled  = () => resendReady() || graphReady() || smtpReady();
export const provider = () => (resendReady() ? 'resend' : graphReady() ? 'graph' : smtpReady() ? 'smtp' : 'none');

export async function send({ to, subject, text, html, replyTo }) {
  if (!enabled()) { console.log('[email] not configured — skipped:', subject); return { skipped: true, provider: 'none' }; }
  const args = { to, subject, text, html, replyTo };
  try {
    if (resendReady()) return await sendResend(args);
    if (graphReady())  return await sendGraph(args);
    return await sendSmtp(args);
  } catch (e) {
    console.error('[email] send failed:', e.message);
    return { ok: false, error: e.message, provider: provider() };
  }
}

// Admin diagnostic — tests each configured path independently and reports raw errors.
export async function diagnose(to) {
  const out = {
    provider: provider(), from: FROM(), notifyTo: notifyTo(),
    resendReady: resendReady(), graphReady: graphReady(), smtpReady: smtpReady(),
  };
  if (resendReady()) {
    try { out.resendSend = await sendResend({ to, subject: 'WVWCCC email test (Resend)', text: 'Resend test — if you see this, relay email works.' }); }
    catch (e) { out.resendSend = 'FAIL: ' + e.message; }
  }
  if (graphReady()) {
    out.graphSender = SENDER() || null;
    try { await graphToken(); out.graphToken = 'ok'; } catch (e) { out.graphToken = 'FAIL: ' + e.message; }
    if (out.graphToken === 'ok') {
      try { out.graphSend = await sendGraph({ to, subject: 'WVWCCC email test (Graph)', text: 'Graph test.' }); }
      catch (e) { out.graphSend = 'FAIL: ' + e.message; }
    }
  }
  if (smtpReady()) {
    try { out.smtpSend = await sendSmtp({ to, subject: 'WVWCCC email test (SMTP)', text: 'SMTP test.' }); }
    catch (e) { out.smtpSend = 'FAIL: ' + e.message; }
  }
  return out;
}
