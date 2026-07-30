/* Cloudflare Turnstile server-side verification.
   Reads TURNSTILE_SECRET from env. When unset (dev), verification is skipped so
   forms still work locally; set the secret in .env.local / Render to enforce. */
const SECRET = () => process.env.TURNSTILE_SECRET;
export const enabled = () => !!SECRET();

/* Fail-open is deliberate (dev and preview environments have no secret), but in
   production it silently turns every public write endpoint into an open door.
   Say so loudly at boot so a dropped env var shows up in the Render logs instead
   of being discovered from a flooded approval queue. */
if (process.env.NODE_ENV === 'production' && !SECRET()) {
  console.warn(
    '[turnstile] TURNSTILE_SECRET is not set — captcha verification is SKIPPED. '
    + '/api/contact, /api/public/job and /api/public/event/verify accept unverified '
    + 'submissions. Set it in the Render dashboard (service: wvwccc-web).',
  );
}

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
