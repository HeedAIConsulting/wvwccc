/* Transactional email — Microsoft Graph (preferred) or SMTP (fallback).

   Graph (app-only, recommended — works even when tenant SMTP AUTH is disabled):
     MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET
     sender mailbox = GRAPH_SENDER || SMTP_USER || M365_PRIMARY_MAILBOX
     (the Graph app needs the application permission Mail.Send, admin-consented,
      scoped to the sender mailbox)

   SMTP fallback (Microsoft 365 basic auth):
     SMTP_HOST (default smtp.office365.com), SMTP_PORT (default 587, STARTTLS),
     SMTP_USER, SMTP_PASS (an M365 app password; "Authenticated SMTP" must be on)

   No-op (logs only) until one path is configured. */

// ---- config helpers ----
const TENANT  = () => process.env.MS_GRAPH_TENANT_ID;
const CLIENT  = () => process.env.MS_GRAPH_CLIENT_ID;
const CSECRET = () => process.env.MS_GRAPH_CLIENT_SECRET;
const SENDER  = () => process.env.GRAPH_SENDER || process.env.SMTP_USER || process.env.M365_PRIMARY_MAILBOX;
const graphReady = () => !!(TENANT() && CLIENT() && CSECRET() && SENDER());

const USER = () => process.env.SMTP_USER;
const PASS = () => process.env.SMTP_PASS;
const smtpReady = () => !!(USER() && PASS());

export const enabled  = () => graphReady() || smtpReady();
export const provider = () => (graphReady() ? 'graph' : smtpReady() ? 'smtp' : 'none');
export const notifyTo = () => process.env.CHAMBER_NOTIFY || SENDER() || USER() || 'info@woodlandhillscc.net';
const fromAddr = () => process.env.SMTP_FROM || `West Valley · Warner Center Chamber <${SENDER() || USER()}>`;

// ---- Microsoft Graph (app-only) ----
let _tok = null, _exp = 0;
async function graphToken() {
  const now = Date.now();
  if (_tok && now < _exp - 60000) return _tok;
  const url = `https://login.microsoftonline.com/${TENANT()}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT(),
    client_secret: CSECRET(),
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`token ${r.status}: ${j.error_description || j.error || 'unknown'}`);
  _tok = j.access_token;
  _exp = now + (Number(j.expires_in) || 3600) * 1000;
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
  let detail = '';
  try { detail = JSON.stringify(await r.json()); } catch { /* ignore */ }
  throw new Error(`graph sendMail ${r.status}: ${detail.slice(0, 300)}`);
}

// ---- SMTP fallback ----
let _tx = null;
async function transport() {
  if (_tx) return _tx;
  const nodemailer = (await import('nodemailer')).default;
  _tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,        // STARTTLS on 587
    requireTLS: true,
    auth: { user: USER(), pass: PASS() },
  });
  return _tx;
}
async function sendSmtp({ to, subject, text, html, replyTo }) {
  const tx = await transport();
  const info = await tx.sendMail({ from: fromAddr(), to, subject, text, html, replyTo });
  return { ok: true, id: info.messageId, provider: 'smtp' };
}

export async function send({ to, subject, text, html, replyTo }) {
  if (!enabled()) { console.log('[email] not configured — skipped:', subject); return { skipped: true, provider: 'none' }; }
  try {
    if (graphReady()) return await sendGraph({ to, subject, text, html, replyTo });
    return await sendSmtp({ to, subject, text, html, replyTo });
  } catch (e) {
    console.error('[email] send failed:', e.message);
    // Graph configured but failing, and SMTP also available → try SMTP.
    if (graphReady() && smtpReady()) {
      try { return await sendSmtp({ to, subject, text, html, replyTo }); }
      catch (e2) { console.error('[email] smtp fallback failed:', e2.message); return { ok: false, error: e2.message, provider: 'smtp' }; }
    }
    return { ok: false, error: e.message, provider: provider() };
  }
}
