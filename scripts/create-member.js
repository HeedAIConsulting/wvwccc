#!/usr/bin/env node
/* Create or update a MEMBER login and link it to a directory listing.
   Usage: node scripts/create-member.js <email> <password> <memberId> [full name]
   memberId = the directory member id (e.g. providence-tarzana, or m16223 after import).
   Dev → data/_store/users.json · Prod (DATABASE_URL) → users table (role=member). */
import * as users from '../backend/users.js';
import { hashPassword } from '../backend/auth.js';

const [email, password, memberId, ...name] = process.argv.slice(2);
if (!email || !password || !memberId) {
  console.error('Usage: node scripts/create-member.js <email> <password> <memberId> [full name]');
  process.exit(1);
}
if (String(password).length < 8) { console.error('Password must be at least 8 characters.'); process.exit(1); }

try {
  await users.upsertMember(email, hashPassword(password), memberId, name.join(' '));
  console.log(`✓ Member login ready for ${email} → listing ${memberId}`);
  process.exit(0);
} catch (e) { console.error('failed:', e.message); process.exit(1); }
