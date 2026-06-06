#!/usr/bin/env node
/* Re-scope member logins to the canonical 643 roster (members.json). One login
   per current member with an email. Passwords are NOT migrated (legacy plaintext)
   → needsReset=true. Preserves non-member logins (e.g. test) already present;
   staff/admin live in the separate staff.json and are untouched. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', '_store');
const usersPath = path.join(STORE, 'users.json');
const mem = JSON.parse(fs.readFileSync(path.join(STORE, 'members.json'), 'utf8')).members;

let existing = [];
try { existing = (JSON.parse(fs.readFileSync(usersPath, 'utf8')).users) || []; } catch {}
// keep only logins NOT tied to an imported member (id not starting with u#### / member-derived),
// i.e. preserve hand-made/test accounts; drop the prior roster's imported logins.
const preserved = existing.filter((u) => !/^u/.test(u.id) || u.needsReset === false);

const seen = new Set(preserved.map((u) => (u.email || '').toLowerCase()).filter(Boolean));
const users = [...preserved];
let added = 0, noEmail = 0, dup = 0;
for (const m of mem) {
  const email = (m.email || '').toLowerCase().trim();
  if (!email) { noEmail++; continue; }
  if (seen.has(email)) { dup++; continue; }
  seen.add(email);
  users.push({
    id: `u-${m.id}`, memberId: m.id, email,
    username: m.email, passwordHash: '', passwordAlgo: null,
    role: 'member', status: 'approved', needsReset: true,
  });
  added++;
}
fs.writeFileSync(usersPath, JSON.stringify({
  _meta: { rescopedAt: new Date().toISOString(), source: 'canonical 643 roster (members.json)',
    count: users.length, preserved: preserved.length, imported: added,
    note: 'Passwords not migrated; needsReset on all members. staff.json separate.' },
  users,
}, null, 2));
console.log(`re-scoped logins → ${users.length} total (${preserved.length} preserved + ${added} member logins)`);
console.log(`  members without email (no login): ${noEmail}   dup emails skipped: ${dup}`);
