/* Cloudflare Turnstile server-side verification.
   Reads TURNSTILE_SECRET from env. When unset (dev), verification is skipped so
   forms still work locally; set the secret in .env.local / Render to enforce. */
const SECRET = () => process.env.TURNSTILE_SECRET;
export const enabled = () => !!SECRET();

export async function verify(token, ip) {
  if (!enabled()) return { ok: true, skipped: true };   // not configured → allow
  if (!token) return { ok: false, error: 'missing-token' };
  try {
    const body = new URLSearchParams({ secret: SECRET(), response: String(token) });
    if (ip) body.set('remoteip', ip);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body, signal: ctrl.signal,
    });
    clearTimeout(to);
    const data = await res.json();
    return { ok: !!data.success, error: (data['error-codes'] || []).join(',') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
