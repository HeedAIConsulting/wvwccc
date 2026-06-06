#!/usr/bin/env node
/* Verify the current-member roster from ChamberWare currency signals, then
   classify which members have a usable profile vs need one re-created.
   Usage: node scripts/verify-memberships.js <dump.sql> */
import fs from 'node:fs';
import { parseDump } from './import-chamberware.js';

const file = process.argv[2];
const activityFile = process.argv[3]; // optional WHCC_orders + WHCC_payment_orders dump
if (!file) { console.error('Usage: node scripts/verify-memberships.js <members.sql> [activity.sql]'); process.exit(1); }
const { rows } = parseDump(fs.readFileSync(file, 'utf8'));
const accts = rows['WHCC_accounts'] || [];
const profs = rows['WHCC_profile'] || [];

const clean = (v) => (v == null ? '' : String(v).trim());
const year = (d) => { const m = /^(\d{4})-/.exec(clean(d)); return m ? +m[1] : null; };
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };

// profile index
const profById = {};
for (const p of profs) profById[clean(p.accounts_id)] = p;
const profileScore = (p) => {
  if (!p) return 0;
  let s = 0;
  if (clean(p.about).length > 40) s += 2;
  if (clean(p.headline)) s += 1;
  if (['facebook_link','instagram_link','linkedin_link','youtube_link','twitter_link','yelp_link'].some(k => clean(p[k]))) s += 1;
  return s; // 0 none, 1 thin, 2-4 usable
};

const active = accts.filter(a => clean(a.active) === 'Y' && (clean(a.chamber_status) || 'member') === 'member' && clean(a.company));
console.log(`\nActive members (active=Y, chamber_status=member, company<>''): ${active.length}`);

// ── currency signal 1: joindate recency ──
const jy = {};
for (const a of active) { const y = year(a.joindate); const b = y == null ? 'no-joindate' : y >= 2023 ? '2023-2025' : y >= 2020 ? '2020-2022' : y >= 2015 ? '2015-2019' : y >= 2010 ? '2010-2014' : '≤2009'; jy[b] = (jy[b]||0)+1; }
console.log('\njoindate buckets:', JSON.stringify(jy));

// ── currency signal 2: dues / balance ──
const dues = active.map(a => num(a.dues)).filter(n => n != null && n > 0);
const bal = active.map(a => num(a.balance)).filter(n => n != null);
console.log(`dues>0 present: ${dues.length} of ${active.length}   balance present: ${bal.length}   balance>0 (owing): ${bal.filter(n=>n>0).length}`);

// ── currency signal 3: new_member / created_date recency ──
console.log('new_member=Y:', active.filter(a=>clean(a.new_member)==='Y').length,
            '  created_date≥2023:', active.filter(a=>{const y=year(a.created_date);return y&&y>=2023;}).length,
            '  submitted_date≥2023:', active.filter(a=>{const y=year(a.submitted_date);return y&&y>=2023;}).length);

// ── profile coverage among active members ──
let usable=0, thin=0, none=0;
for (const a of active) { const s = profileScore(profById[clean(a.accounts_id)]); if (s>=2) usable++; else if (s===1) thin++; else none++; }
console.log('\n— profile coverage among active members —');
console.log(`  usable profile (about/social): ${usable}`);
console.log(`  thin (headline or 1 link only): ${thin}`);
console.log(`  NO profile → re-create: ${none}`);

// ── combined: "verified-ish current" = active + (recent joindate OR has dues OR recent activity) ──
const isCurrentish = (a) => {
  const jy2 = year(a.joindate);
  return (jy2 && jy2 >= 2020) || num(a.dues) > 0 || clean(a.new_member) === 'Y'
      || (year(a.created_date) || 0) >= 2022 || (year(a.submitted_date) || 0) >= 2022;
};
const current = active.filter(isCurrentish);
console.log(`\n— "currentish" (active + a recency/dues signal): ${current.length} of ${active.length} —`);
let cu=0, ct=0, cn=0;
for (const a of current) { const s = profileScore(profById[clean(a.accounts_id)]); if (s>=2) cu++; else if (s===1) ct++; else cn++; }
console.log(`  of those: usable profile ${cu}, thin ${ct}, need re-create ${cn}`);

// ── authoritative recency from activity tables (payments + event orders) ──
if (activityFile) {
  const a2 = parseDump(fs.readFileSync(activityFile, 'utf8')).rows;
  const orders = a2['WHCC_orders'] || [];
  const pays = a2['WHCC_payment_orders'] || [];
  const ymd = (d) => { const m = /^(\d{4})-(\d{2})/.exec(clean(d)); return m ? +(m[1] + m[2]) : null; }; // YYYYMM int

  const lastPay = {}, lastOrder = {};
  let payMin = 9e9, payMax = 0, ordMin = 9e9, ordMax = 0;
  for (const p of pays) { const id = clean(p.accounts_id), v = ymd(p.date_placed); if (!id || !v) continue; lastPay[id] = Math.max(lastPay[id] || 0, v); payMin = Math.min(payMin, v); payMax = Math.max(payMax, v); }
  for (const o of orders) { const id = clean(o.accounts_id), v = ymd(o.date_placed); if (!id || !v) continue; lastOrder[id] = Math.max(lastOrder[id] || 0, v); ordMin = Math.min(ordMin, v); ordMax = Math.max(ordMax, v); }

  const fmt = (n) => (n && n < 9e9 ? String(n).replace(/(\d{4})(\d{2})/, '$1-$2') : 'n/a');
  console.log('\n══════════ AUTHORITATIVE RECENCY (activity tables) ══════════');
  console.log(`payment_orders date range: ${fmt(payMin)} … ${fmt(payMax)}   (${pays.length} rows, ${Object.keys(lastPay).length} accounts)`);
  console.log(`event orders   date range: ${fmt(ordMin)} … ${fmt(ordMax)}   (${orders.length} rows, ${Object.keys(lastOrder).length} accounts)`);

  const lastAny = (id) => Math.max(lastPay[id] || 0, lastOrder[id] || 0);
  const bucket = (v) => {
    if (!v) return 'never';
    const y = Math.floor(v / 100);
    if (y >= 2025) return '2025-2026';
    if (y === 2024) return '2024';
    if (y === 2023) return '2023';
    if (y >= 2021) return '2021-2022';
    return '≤2020';
  };
  const b = {};
  for (const a of active) { const k = bucket(lastAny(clean(a.accounts_id))); b[k] = (b[k] || 0) + 1; }
  console.log('\nactive members by LAST activity (payment or event order):');
  console.log(' ', JSON.stringify(b));

  // verified current = active + activity in 2024+ ; recent-ish = 2023+
  const cur24 = active.filter(a => Math.floor(lastAny(clean(a.accounts_id)) / 100) >= 2024);
  const cur23 = active.filter(a => Math.floor(lastAny(clean(a.accounts_id)) / 100) >= 2023);
  console.log(`\nVERIFIED current (activity 2024+): ${cur24.length}`);
  console.log(`Recent-ish     (activity 2023+): ${cur23.length}`);

  const gap = (set) => { let u = 0, t = 0, n = 0; for (const a of set) { const s = profileScore(profById[clean(a.accounts_id)]); if (s >= 2) u++; else if (s === 1) t++; else n++; } return { usable: u, thin: t, recreate: n }; };
  console.log('\nprofile gap among VERIFIED current (2024+):', JSON.stringify(gap(cur24)));
  console.log('profile gap among recent-ish     (2023+):', JSON.stringify(gap(cur23)));
} else {
  console.log('\n(no activity file given — pass wvwccc_activity_src.sql as 2nd arg for payment-verified roster)');
}
