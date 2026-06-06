#!/usr/bin/env node
/* Verify the CURRENT member roster from the LIVE NC_* tables (maintained through
   2026), using NC_payment_orders as the authoritative "paid, when" signal, and
   classify the profile gap via NC_new_profile.
   Usage: node scripts/verify-current-roster.js <current.sql> */
import fs from 'node:fs';
import { parseDump } from './import-chamberware.js';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/verify-current-roster.js <current.sql>'); process.exit(1); }
const { rows } = parseDump(fs.readFileSync(file, 'utf8'));
const accts = rows['NC_accounts'] || [];
const profs = rows['NC_new_profile'] || [];
const pays  = rows['NC_payment_orders'] || [];

const clean = (v) => (v == null ? '' : String(v).trim());
const ym = (d) => { const m = /^(\d{4})-(\d{2})/.exec(clean(d)); return m ? +(m[1] + m[2]) : null; };
const yr = (v) => (v ? Math.floor(v / 100) : 0);

const profById = {};
for (const p of profs) profById[clean(p.accounts_id)] = p;
const profileScore = (p) => { if (!p) return 0; let s = 0; if (clean(p.about).length > 40) s += 2; if (clean(p.headline)) s += 1; if (['facebook_link','instagram_link','linkedin_link','youtube_link','twitter_link','yelp_link'].some(k => clean(p[k]))) s += 1; return s; };

// last payment per account + overall range
const lastPay = {}; let pmin = 9e9, pmax = 0;
for (const p of pays) { const id = clean(p.accounts_id), v = ym(p.date_placed); if (!id || !v) continue; lastPay[id] = Math.max(lastPay[id] || 0, v); pmin = Math.min(pmin, v); pmax = Math.max(pmax, v); }
const fmt = (n) => (n && n < 9e9 ? String(n).replace(/(\d{4})(\d{2})/, '$1-$2') : 'n/a');

console.log(`\nNC_accounts: ${accts.length}   NC_new_profile: ${profs.length}   NC_payment_orders: ${pays.length}`);
console.log(`payment date range: ${fmt(pmin)} … ${fmt(pmax)}  (${Object.keys(lastPay).length} distinct paying accounts)`);

const active = accts.filter(a => clean(a.active) === 'Y' && (clean(a.chamber_status) || 'member') === 'member' && clean(a.company));
console.log(`\nactive=Y & chamber_status=member & company<>'' : ${active.length}`);
console.log('active enum spread (all):', JSON.stringify(Object.fromEntries(['Y','N','P'].map(k => [k, accts.filter(a => clean(a.active) === k).length]))));
console.log('chamber_status spread:', JSON.stringify(Object.fromEntries(['member','staff','suspended'].map(k => [k, accts.filter(a => clean(a.chamber_status) === k).length]))));

// bucket active members by last payment
const bucket = (v) => { const y = yr(v); if (!y) return 'never-paid'; if (y >= 2025) return '2025-2026'; if (y === 2024) return '2024'; if (y === 2023) return '2023'; if (y >= 2021) return '2021-2022'; return '≤2020'; };
const b = {};
for (const a of active) { const k = bucket(lastPay[clean(a.accounts_id)]); b[k] = (b[k] || 0) + 1; }
console.log('\nactive members by LAST PAYMENT:', JSON.stringify(b));

const gap = (set) => { let u = 0, t = 0, n = 0; for (const a of set) { const s = profileScore(profById[clean(a.accounts_id)]); if (s >= 2) u++; else if (s === 1) t++; else n++; } return { usable: u, thin: t, recreate: n }; };
for (const [label, minYear] of [['paid 2025-2026', 2025], ['paid 2024+', 2024], ['paid 2023+', 2023]]) {
  const set = active.filter(a => yr(lastPay[clean(a.accounts_id)]) >= minYear);
  console.log(`\n${label}: ${set.length} members  → profile gap ${JSON.stringify(gap(set))}`);
}

// fill rates on the strongest roster (paid 2024+)
const cur = active.filter(a => yr(lastPay[clean(a.accounts_id)]) >= 2024);
const has = (fn) => cur.filter(fn).length;
console.log(`\n— fill rates among "paid 2024+" (${cur.length}) —`);
for (const f of ['phone','website','email','address','city','type_of_business']) console.log(`  ${f}: ${has(a => clean(a[f]))}`);
console.log('\n— sample paid-2024+ members —');
for (const a of cur.slice(0, 5)) console.log(`  ${clean(a.company)} | ${clean(a.city)} | last paid ${fmt(lastPay[clean(a.accounts_id)])} | profile ${profileScore(profById[clean(a.accounts_id)]) >= 2 ? 'YES' : 'no'}`);
