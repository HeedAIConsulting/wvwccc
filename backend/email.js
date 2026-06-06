/* Transactional email via Microsoft 365 SMTP (nodemailer).
   Configure in env (Render):
     SMTP_HOST  (default smtp.office365.com)
     SMTP_PORT  (default 587, STARTTLS)
     SMTP_USER  the sending mailbox, e.g. wendy@woodlandhillscc.net
     SMTP_PASS  an M365 app password for that mailbox (SMTP AUTH must be enabled)
     SMTP_FROM  optional display From (defaults to the chamber + SMTP_USER)
     CHAMBER_NOTIFY  where inbound inquiries go (defaults to SMTP_USER)
   No-op (logs only) until SMTP_USER + SMTP_PASS are set. */
let _tx = null;
const USER = () => process.env.SMTP_USER;
const PASS = () => process.env.SMTP_PASS;
export const enabled = () => !!(USER() && PASS());
export const notifyTo = () => process.env.CHAMBER_NOTIFY || USER() || 'info@woodlandhillscc.net';
const fromAddr = () => process.env.SMTP_FROM || `West Valley · Warner Center Chamber <${USER()}>`;

async function transport() {
  if (_tx) return _tx;
  const nodemailer = (await import('nodemailer')).default;
  _tx = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,            // STARTTLS on 587
    requireTLS: true,
    auth: { user: USER(), pass: PASS() },
  });
  return _tx;
}

export async function send({ to, subject, text, html, replyTo }) {
  if (!enabled()) { console.log('[email] not configured — skipped:', subject); return { skipped: true }; }
  try {
    const tx = await transport();
    const info = await tx.sendMail({ from: fromAddr(), to, subject, text, html, replyTo });
    return { ok: true, id: info.messageId };
  } catch (e) {
    console.error('[email] send failed:', e.message);
    return { ok: false, error: e.message };
  }
}
