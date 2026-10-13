/* The applicant's business website, required on the membership application.

   Felicia, Oct 12 2026: "when members sign up they are not putting in their
   website information. Can you please make that a required field". Oct 13:
   "either add their website or type in/select no website".

   So the answer is never blank: a website, or the words "No website". The
   form has a "We don't have a website" box for that; typing "none" or "n/a"
   counts the same. A bare "yourbusiness.com" gets https:// in front so it
   opens as a link on the listing. Pure helpers, shared by the application,
   the checkout receipt and approval. */

export const NO_WEBSITE = 'No website';

export const WEBSITE_MISSING = 'Add your business website, or tick “We don’t have a website”.';
export const WEBSITE_INVALID = 'That website address does not look right. Use something like yourbusiness.com, or tick “We don’t have a website”.';

const ticked = (v) => v === true || /^(yes|on|true|1)$/i.test(String(v == null ? '' : v).trim());

/* Returns { ok, value } or { ok: false, error }. */
export function readWebsite(raw, noneFlag) {
  if (ticked(noneFlag)) return { ok: true, value: NO_WEBSITE };
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return { ok: false, error: WEBSITE_MISSING };
  if (/^(none|n\/?a|no|no website|no web ?site|-)$/i.test(s)) return { ok: true, value: NO_WEBSITE };
  if (/\s/.test(s) || s.length > 200) return { ok: false, error: WEBSITE_INVALID };
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: WEBSITE_INVALID }; }
  const host = u.hostname;
  if (!/^[a-z0-9.-]+$/i.test(host) || !/\.[a-z]{2,}$/i.test(host) || host.startsWith('.') || host.includes('..')) {
    return { ok: false, error: WEBSITE_INVALID };
  }
  const href = u.pathname === '/' && !u.search && !u.hash ? u.origin : u.href;
  return { ok: true, value: href };
}

/* What goes on the member's listing: the address, or nothing for "No website". */
export const memberWebsite = (v) => (v && v !== NO_WEBSITE ? String(v).slice(0, 200) : '');
