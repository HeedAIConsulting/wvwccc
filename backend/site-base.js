/* ============================================================
   Links and names in the emails the site sends (Nov 2026).

   Sheryl Tratner forwarded the Ambassador Committee welcome Martin Carman
   got on Nov 4: it opened "Hi Computer," and every link in it went to
   wvwccc-web.onrender.com. Both came from the request: the links from the
   host the leader happened to be signed in on, the greeting from the roster
   row, which the directory picker names after the business.
   ============================================================ */

// The address every emailed link uses: the Chamber's own domain, whatever
// host the office or a leader was on when the email went out. A local
// server keeps its own host so a developer's reset links still work.
export function siteBase(req) {
  const env = process.env.SITE_URL || process.env.SITE_ORIGIN;
  if (env) return String(env).replace(/\/+$/, '');
  const host = String((req && req.get && req.get('host')) || '');
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) return `${req.protocol}://${host}`;
  return 'https://woodlandhillscc.net';
}

const HONORIFIC = /^(mr|mrs|ms|miss|mx|dr|prof|rev|hon)\.?$/i;
const first = (s) => {
  const parts = String(s || '').trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && HONORIFIC.test(parts[0])) parts.shift();
  return (parts[0] || '').replace(/[,;:]+$/, '');
};
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/* The first name to greet a roster row by. A row picked from the directory
   is named after the business ("Computer Doctor, The"), so the member's
   contact name wins; failing that, a row whose name is the business's is
   greeted as "there" rather than by its first word. A row typed in by hand
   carries the person's own name. */
export function greetingName(row, dirMember) {
  const d = dirMember || null;
  const name = String((row && row.name) || '').trim();
  const contact = d ? String(d.contactName || '').trim() : '';
  const isBusiness = !name || (d && norm(name) === norm(d.name))
    || (row && row.business && norm(name) === norm(row.business));
  // A name somebody typed for the row (a second rep of the business) is kept.
  if (!isBusiness) return first(name) || 'there';
  return (contact && first(contact)) || 'there';
}
