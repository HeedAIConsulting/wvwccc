#!/usr/bin/env node
/* Load member logins from the local JSON store into production Postgres.
   This is the "loader step" referenced by DEPLOY.md and scripts/README-import.md.

   WHY THIS EXISTS: data/_store/ is gitignored (it holds member PII + password
   hashes), so it never reaches the deploy repo. `npm run migrate` only applies
   schema.sql — it does NOT seed users. Without this step the prod `users` table
   is empty, so no member can log in with their migrated password and /auth/forgot
   finds nobody to email. Run this once, from the machine that has data/_store,
   with DATABASE_URL pointed at the Render Postgres:

     DATABASE_URL="<render external connection string>" \
       node scripts/load-users-to-pg.js

   Flags:
     --dry-run   read the store and print what WOULD load; touch nothing.
     --file <p>  use a store file other than data/_store/users.json.

   Idempotent: bulkImportMembers upserts on email (ON CONFLICT). Re-running will
   NOT clobber members who have since changed their password through the site,
   except by re-applying the store's hash — so run it before members start using
   the site, not after. Staff/admin logins are NOT touched (use create-staff.js).
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from '../backend/db.js';
import * as users from '../backend/users.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileArg = args[args.indexOf('--file') + 1];
const storePath = fileArg && args.includes('--file')
  ? path.resolve(fileArg)
  : path.join(ROOT, 'data', '_store', 'users.json');

if (!fs.existsSync(storePath)) {
  console.error(`No user store at ${storePath}. Run the ChamberWare import first (scripts/README-import.md).`);
  process.exit(1);
}

const doc = JSON.parse(fs.readFileSync(storePath, 'utf8'));
const all = Array.isArray(doc) ? doc : (doc.users || []);
// Only member logins belong in this loader; staff/admins are provisioned separately.
const list = all.filter((u) => u && u.email && (!u.role || u.role === 'member'));

const withLegacy = list.filter((u) => u.passwordHash && u.passwordAlgo === 'bcrypt' && u.mustChange).length;
const needsReset = list.filter((u) => u.needsReset || !u.passwordHash).length;
const skippedNonMember = all.length - list.length;

console.log(`store:           ${storePath}`);
console.log(`member logins:   ${list.length}`);
console.log(`  with legacy password (mustChange on first login): ${withLegacy}`);
console.log(`  no legacy password (needsReset / set-a-password):  ${needsReset}`);
if (skippedNonMember) console.log(`  skipped non-member rows (staff/admin):             ${skippedNonMember}`);

if (dryRun) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

if (!db.enabled) {
  console.error('\nDATABASE_URL is not set. Refusing to run: this loader is for production Postgres.');
  console.error('Set DATABASE_URL to the target Postgres and re-run (omit --dry-run).');
  process.exit(1);
}

try {
  const imported = await users.bulkImportMembers(list);
  console.log(`\n✓ Loaded ${imported} member logins into Postgres at ${process.env.DATABASE_URL.replace(/:\/\/.*@/, '://***@')}`);
  console.log('  Members can now sign in with their migrated password (and are prompted to set a new one).');
} catch (e) {
  console.error('\nload failed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
