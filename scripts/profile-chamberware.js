#!/usr/bin/env node
/* Profile the ChamberWare WHCC_accounts table to design the correct member mapping.
   Usage: node scripts/profile-chamberware.js <dump.sql> */
import fs from 'node:fs';
import { parseDump } from './import-chamberware.js';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/profile-chamberware.js <dump.sql>'); process.exit(1); }

const { rows } = parseDump(fs.readFileSync(file, 'utf8'));
const accts = rows['WHCC_accounts'] || [];
const cats  = rows['WHCC_accounts_categories'] || [];
const profs = rows['WHCC_profile'] || [];

const dist = (arr, key, fn = (r) => r[key]) => {
  const m = {};
  for (const r of arr) { const v = fn(r) ?? '(null)'; m[v] = (m[v] || 0) + 1; }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};
const has = (arr, fn) => arr.filter(fn).length;

console.log(`\nWHCC_accounts rows: ${accts.length}`);
console.log('\nactive:', JSON.stringify(Object.fromEntries(dist(accts, 'active'))));
console.log('chamber_status:', JSON.stringify(Object.fromEntries(dist(accts, 'chamber_status'))));
console.log('status (varchar3):', JSON.stringify(Object.fromEntries(dist(accts, 'status').slice(0, 12))));
console.log('donation_status:', JSON.stringify(Object.fromEntries(dist(accts, 'donation_status'))));
console.log('profile_status:', JSON.stringify(Object.fromEntries(dist(accts, 'profile_status'))));
console.log('new_member:', JSON.stringify(Object.fromEntries(dist(accts, 'new_member'))));
console.log('board=Y:', has(accts, r => r.board === 'Y'), ' ambassador=Y:', has(accts, r => r.ambassador === 'Y'));

console.log('\n— field fill rates (all accounts) —');
for (const f of ['company','phone','website','email','address','city','zipcode','type_of_business','joindate']) {
  console.log(`  ${f}: ${has(accts, r => r[f] && String(r[f]).trim())}`);
}

const active = accts.filter(r => r.active === 'Y');
const activeMember = active.filter(r => (r.chamber_status || 'member') === 'member');
const activeNamed = activeMember.filter(r => r.company && r.company.trim());
console.log('\n— candidate roster sizes —');
console.log('  active=Y:', active.length);
console.log('  active=Y & chamber_status=member:', activeMember.length);
console.log('  ^ with non-empty company:', activeNamed.length);
console.log('  active=Y with company:', active.filter(r => r.company && r.company.trim()).length);

console.log('\n— donation_status among active=Y members —');
console.log(JSON.stringify(Object.fromEntries(dist(activeMember, 'donation_status'))));

console.log('\n— categories table —');
console.log('  rows:', cats.length, ' distinct accounts:', new Set(cats.map(c => c.accounts_id)).size);
console.log('  top categories:', JSON.stringify(dist(cats, 'category').slice(0, 15)));

console.log('\n— profiles table —');
console.log('  rows:', profs.length, ' distinct accounts:', new Set(profs.map(p => p.accounts_id)).size);
console.log('  with facebook:', has(profs, p => p.facebook_link && p.facebook_link.trim()),
            ' instagram:', has(profs, p => p.instagram_link && p.instagram_link.trim()),
            ' about:', has(profs, p => p.about && p.about.trim()));

console.log('\n— sample active member —');
const s = activeNamed[0];
if (s) console.log(JSON.stringify({
  accounts_id: s.accounts_id, company: s.company, type_of_business: s.type_of_business,
  donation_status: s.donation_status, active: s.active, chamber_status: s.chamber_status,
  city: s.city, phone: s.phone, website: s.website, joindate: s.joindate,
}, null, 2));
