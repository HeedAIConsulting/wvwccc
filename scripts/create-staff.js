#!/usr/bin/env node
/* Create or update a staff/admin login.
   Usage: node scripts/create-staff.js <email> <password> [full name]
   Dev (no DATABASE_URL) → writes data/_store/staff.json.
   Prod (DATABASE_URL set) → upserts into the users table (role=staff). */
import * as users from '../backend/users.js';
import { hashPassword } from '../backend/auth.js';

const [email, password, ...name] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/create-staff.js <email> <password> [full name]');
  process.exit(1);
}
if (String(password).length < 8) { console.error('Password must be at least 8 characters.'); process.exit(1); }

try {
  await users.upsertStaff(email, hashPassword(password), name.join(' '));
  console.log('✓ Staff login ready for', email);
  process.exit(0);
} catch (e) {
  console.error('failed:', e.message);
  process.exit(1);
}
