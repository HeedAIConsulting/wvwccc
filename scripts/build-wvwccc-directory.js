#!/usr/bin/env node
/* ============================================================
   WVWCCC — ChamberWare(LIVE NC_* tables) → members.json + users.json

   IMPORTANT: the dump has TWO datasets. WHCC_* is the DEAD 2017 site;
   NC_* is the LIVE site (maintained through 2026). We build from NC_*.
   (See scripts/verify-current-roster.js and table_recency.py.)

   Joins:  NC_accounts ⋈ NC_new_profile (by accounts_id)
           ⋈ NC_payment_orders (last online payment date → currency)
   Category: NC_accounts.type_of_business (NC_accounts_categories is empty).

   Roster: active='Y' AND chamber_status='member' AND company<>''  (~1,546).
   Nothing is dropped — each member is TAGGED:
     verification.lastPaid        last online payment year (null if none)
     verification.profileUpdated  NC_new_profile.date_updated year (null)
     verification.label           'paid' | 'engaged' | 'unconfirmed'
   Public status: 'approved' when paid 2023+ OR profile updated 2024+,
   else 'pending' (held for chamber/QuickBooks reconciliation — the ~951
   active accounts with no ONLINE payment may still pay by check/invoice).

   Output: data/_store/members.json, data/_store/users.json (gitignored),
           data/_store/_profiles-to-recreate.json (report)
   Usage:  node scripts/build-wvwccc-directory.js <current.sql>
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDump } from './import-chamberware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, 'data', '_store');
const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/build-wvwccc-directory.js <current.sql>'); process.exit(1); }

const DIRECTORY_TIERS = ['platinum', 'gold', 'silver', 'bronze', 'supporter'];
const clean = (v) => (v == null ? '' : String(v).trim());
const yearOf = (d) => { const m = /^(\d{4})-/.exec(clean(d)); return m ? +m[1] : null; };
const stripHtml = (s) => clean(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&#39;|&rsquo;|&lsquo;/gi, "'").replace(/&quot;/gi, '"')
  .replace(/\s+/g, ' ').trim();
function url(v) {
  let s = clean(v); if (!s) return '';
  s = s.replace(/^https?:\/\//i, '');
  if (s.includes('@') || /\s/.test(s)) return '';
  if (/^www\./i.test(s) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return ('https://' + s.replace(/^\/+/, '')).slice(0, 300);
  return '';
}
const seal = (name) => (name.replace(/[^A-Za-z0-9]/g, '')[0] || '?').toUpperCase();

const { rows } = parseDump(fs.readFileSync(file, 'utf8'));
const accounts = rows['NC_accounts'] || [];
const profRows = rows['NC_new_profile'] || [];
const payRows  = rows['NC_payment_orders'] || [];
if (!accounts.length) { console.error('No NC_accounts rows — wrong dump? Expected the "current" extract.'); process.exit(1); }

// accounts_id → profile (latest), and → last payment year
const profByAcct = {};
for (const p of profRows) { const id = clean(p.accounts_id); if (id) profByAcct[id] = p; }
const lastPaidByAcct = {};
for (const p of payRows) { const id = clean(p.accounts_id), y = yearOf(p.date_placed); if (!id || !y) continue; lastPaidByAcct[id] = Math.max(lastPaidByAcct[id] || 0, y); }

const profileUsable = (p) => p && (clean(p.about).length > 40 || ['facebook_link','instagram_link','linkedin_link','youtube_link','twitter_link','yelp_link'].some(k => clean(p[k])));

const members = [];
const counts = { total: accounts.length, inactive: 0, pending: 0, suspended: 0, staff: 0, noCompany: 0, kept: 0, approved: 0, heldPending: 0 };
const toRecreate = [];

for (const a of accounts) {
  const active = clean(a.active), chamber = clean(a.chamber_status) || 'member';
  if (chamber === 'suspended') { counts.suspended++; continue; }
  if (chamber === 'staff') { counts.staff++; continue; }
  if (active === 'N') { counts.inactive++; continue; }
  if (active === 'P') { counts.pending++; continue; }
  if (active !== 'Y') { counts.inactive++; continue; }
  const name = clean(a.company);
  if (!name) { counts.noCompany++; continue; }

  const aid = clean(a.accounts_id);
  const id = `m${aid}`;
  const prof = profByAcct[aid] || null;
  const category = clean(a.type_of_business) || 'Member';

  const don = clean(a.donation_status).toLowerCase();
  const tier = DIRECTORY_TIERS.includes(don) ? don : 'member';

  const lastPaid = lastPaidByAcct[aid] || null;
  const profileUpdated = prof ? yearOf(prof.date_updated) : null;
  const label = (lastPaid && lastPaid >= 2023) ? 'paid'
              : (profileUpdated && profileUpdated >= 2024) ? 'engaged' : 'unconfirmed';
  const status = label === 'unconfirmed' ? 'pending' : 'approved';
  if (status === 'approved') counts.approved++; else counts.heldPending++;

  const social = {};
  if (prof) {
    if (url(prof.facebook_link))  social.facebook  = url(prof.facebook_link);
    if (url(prof.instagram_link)) social.instagram = url(prof.instagram_link);
    if (url(prof.linkedin_link))  social.linkedin  = url(prof.linkedin_link);
    if (url(prof.youtube_link))   social.youtube   = url(prof.youtube_link);
    if (url(prof.twitter_link))   social.x         = url(prof.twitter_link);
  }
  const reviewLinks = {};
  if (prof && url(prof.yelp_link)) reviewLinks.yelp = url(prof.yelp_link);

  const m = {
    id,
    name,
    category,
    tier,
    neighborhood: clean(a.city),
    contactName: [clean(a.firstname), clean(a.lastname)].filter(Boolean).join(' ') || clean(a.contact1),
    address: clean(a.address),
    city: clean(a.city),
    state: clean(a.state),
    zip: clean(a.zipcode),
    phone: clean(a.phone),
    fax: clean(a.fax),
    website: url(a.website),
    email: clean(a.email),                         // private; stripped by API
    tagline: prof ? stripHtml(prof.headline).slice(0, 160) : '',
    description: prof ? stripHtml(prof.about).slice(0, 2000) : '',
    typeOfBusiness: clean(a.type_of_business),
    yearEstablished: clean(a.year_established),
    employees: clean(a.no_of_employees),
    leaderStatus: clean(a.board) === 'Y' ? 'Board Member' : clean(a.ambassador) === 'Y' ? 'Ambassador' : clean(a.new_member) === 'Y' ? 'New Member' : '',
    joinDate: clean(a.joindate) || '',
    status,
    featured: clean(a.featured_account) === 'y',
    seal: seal(name),
    legacyAccountId: aid,
    verification: { label, lastPaid, profileUpdated, hasProfile: !!profileUsable(prof) },
  };
  if (Object.keys(social).length) m.social = social;
  if (Object.keys(reviewLinks).length) m.reviewLinks = reviewLinks;
  for (const k of Object.keys(m)) if (m[k] === '' || m[k] === undefined) delete m[k];

  members.push(m);
  counts.kept++;

  // profiles-to-recreate: a current member (paid/engaged) lacking a usable profile
  if (label !== 'unconfirmed' && !profileUsable(prof)) {
    toRecreate.push({ id, name, category, city: clean(a.city), website: m.website || '', lastPaid, profileUpdated, label });
  }
}

members.sort((a, b) => a.name.localeCompare(b.name));

// ── users.json (logins) — merge, never clobber; passwords NOT migrated ──
const usersPath = path.join(STORE, 'users.json');
let existingUsers = [];
try { existingUsers = (JSON.parse(fs.readFileSync(usersPath, 'utf8')).users) || []; } catch {}
const seenEmail = new Set(existingUsers.map((u) => clean(u.email).toLowerCase()).filter(Boolean));
const users = [...existingUsers];
let preserved = existingUsers.length, dupEmail = 0, noEmail = 0;
for (const a of accounts) {
  if ((clean(a.chamber_status) || 'member') !== 'member') continue;
  if (clean(a.active) !== 'Y' || !clean(a.company)) continue;
  const email = clean(a.email).toLowerCase();
  if (!email) { noEmail++; continue; }
  if (seenEmail.has(email)) { dupEmail++; continue; }
  seenEmail.add(email);
  users.push({ id: `u${clean(a.accounts_id)}`, memberId: `m${clean(a.accounts_id)}`, email,
    username: clean(a.email), passwordHash: '', passwordAlgo: null, role: 'member', status: 'approved', needsReset: true });
}

fs.mkdirSync(STORE, { recursive: true });
const meta = {
  importedAt: new Date().toISOString(),
  source: 'woodlandhillscc.net LIVE dataset — NC_accounts ⋈ NC_new_profile ⋈ NC_payment_orders',
  roster_rule: "active='Y' AND chamber_status='member' AND company<>''",
  count: members.length,
  approved_public: counts.approved,
  held_pending_review: counts.heldPending,
  excluded: counts,
  verification_note: "lastPaid = last ONLINE payment (NC_payment_orders). The held-pending accounts have no recent online payment but may pay by check/invoice — reconcile with chamber billing (QuickBooks) before dropping. status='approved' = paid 2023+ or profile updated 2024+.",
  tier_note: 'donation_status honored only when a directory tier word; else member. Real tiers TBD by chamber.',
};
fs.writeFileSync(path.join(STORE, 'members.json'), JSON.stringify({ _meta: meta, members }, null, 2));
fs.writeFileSync(usersPath, JSON.stringify({ _meta: { importedAt: meta.importedAt, source: 'NC_accounts active members with email', count: users.length, preservedExisting: preserved, note: 'Legacy passwords plaintext — NOT migrated; needsReset on all imported.', skipped: { noEmail, dupEmail } }, users }, null, 2));
fs.writeFileSync(path.join(STORE, '_profiles-to-recreate.json'), JSON.stringify({ _meta: { count: toRecreate.length, note: 'Current members (paid/engaged) with no usable legacy profile — build these.' }, members: toRecreate }, null, 2));

console.log(`\n✓ ${members.length} NC members → data/_store/members.json`);
console.log(`  public (approved): ${counts.approved}   held (pending review): ${counts.heldPending}`);
console.log(`  excluded: ${counts.inactive} inactive, ${counts.pending} pending(P), ${counts.suspended} suspended, ${counts.staff} staff`);
const byLabel = members.reduce((m, x) => ((m[x.verification.label] = (m[x.verification.label] || 0) + 1), m), {});
console.log(`  verification: ${JSON.stringify(byLabel)}`);
console.log(`  fill — phone ${members.filter(m=>m.phone).length}, website ${members.filter(m=>m.website).length}, profile/about ${members.filter(m=>m.description).length}, social ${members.filter(m=>m.social).length}`);
console.log(`✓ ${users.length} logins → data/_store/users.json (${preserved} preserved + ${users.length - preserved} imported)`);
console.log(`✓ ${toRecreate.length} profiles to re-create → data/_store/_profiles-to-recreate.json`);
