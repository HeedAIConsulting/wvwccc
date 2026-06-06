#!/usr/bin/env node
/* For the "profiles to re-create" set, audit what real content sources exist
   BEFORE resorting to web scraping: NC_accounts.webtext/bc_text/comments,
   and whether the member has a website to scrape as fallback.
   Usage: node scripts/audit-profile-sources.js <current.sql> */
import fs from 'node:fs';
import { parseDump } from './import-chamberware.js';

const file = process.argv[2];
const { rows } = parseDump(fs.readFileSync(file, 'utf8'));
const accounts = rows['NC_accounts'] || [];
const profs = rows['NC_new_profile'] || [];
const pays = rows['NC_payment_orders'] || [];
const clean = (v) => (v == null ? '' : String(v).trim());
const yearOf = (d) => { const m = /^(\d{4})-/.exec(clean(d)); return m ? +m[1] : null; };
const txt = (v) => clean(v).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

const profBy = {}; for (const p of profs) profBy[clean(p.accounts_id)] = p;
const lastPaid = {}; for (const p of pays) { const id = clean(p.accounts_id), y = yearOf(p.date_placed); if (id && y) lastPaid[id] = Math.max(lastPaid[id] || 0, y); }
const profUsable = (p) => p && (txt(p.about).length > 40 || ['facebook_link','instagram_link','linkedin_link','youtube_link','twitter_link','yelp_link'].some(k => clean(p[k])));

// recreate set = active member, paid 2023+ or profile updated 2024+, no usable profile
const recreate = [];
for (const a of accounts) {
  if (clean(a.active) !== 'Y' || (clean(a.chamber_status) || 'member') !== 'member' || !clean(a.company)) continue;
  const aid = clean(a.accounts_id); const prof = profBy[aid];
  const lp = lastPaid[aid] || 0; const pu = prof ? yearOf(prof.date_updated) : 0;
  const label = lp >= 2023 ? 'paid' : (pu >= 2024 ? 'engaged' : 'unconfirmed');
  if (label === 'unconfirmed' || profUsable(prof)) continue;
  recreate.push(a);
}
console.log(`profiles-to-recreate: ${recreate.length}`);

const len = (a, f) => txt(a[f]).length;
const cnt = (fn) => recreate.filter(fn).length;
console.log('\n— existing real content in NC_accounts for this set —');
console.log(`  webtext >40 chars: ${cnt(a => len(a,'webtext') > 40)}`);
console.log(`  bc_text >40 chars: ${cnt(a => len(a,'bc_text') > 40)}`);
console.log(`  comments >40 chars: ${cnt(a => len(a,'comments') > 40)}`);
console.log(`  ANY of the three >40: ${cnt(a => len(a,'webtext') > 40 || len(a,'bc_text') > 40 || len(a,'comments') > 40)}`);
console.log('\n— fallback signals —');
console.log(`  has website: ${cnt(a => clean(a.website))}`);
console.log(`  has NEITHER db-text NOR website (truly need manual): ${cnt(a => !(len(a,'webtext')>40||len(a,'bc_text')>40||len(a,'comments')>40) && !clean(a.website))}`);

console.log('\n— samples with webtext —');
for (const a of recreate.filter(a => len(a,'webtext') > 40).slice(0, 3))
  console.log(`  ${clean(a.company)}: "${txt(a.webtext).slice(0, 160)}..."`);
