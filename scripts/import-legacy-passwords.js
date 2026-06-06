#!/usr/bin/env node
/* #3 — Keep legacy passwords, force a change on first login.
   Legacy NC_accounts.password is PLAINTEXT. We bcrypt-hash it at rest (never
   store plaintext) and set mustChange=true so the member logs in with their
   known password, then is forced to set a new one. Members with no legacy
   password get needsReset=true (set-a-password / email link instead).
   Usage: node scripts/import-legacy-passwords.js <current.sql> */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDump } from './import-chamberware.js';
import { hashPassword } from '../backend/auth.js';

const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', '_store');
const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/import-legacy-passwords.js <current.sql>'); process.exit(1); }

const { rows } = parseDump(fs.readFileSync(file, 'utf8'));
const pw = {};
for (const a of (rows['NC_accounts'] || [])) {
  const id = String(a.accounts_id || '').trim();
  const p = String(a.password || '').trim();
  if (id && p) pw[id] = p;
}

const usersPath = path.join(STORE, 'users.json');
const doc = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
const users = doc.users || [];
let hashed = 0, noLegacy = 0;
for (const u of users) {
  if (u.role && u.role !== 'member') continue;          // never touch staff
  const aid = String(u.memberId || '').replace(/^m/, '');
  const legacy = pw[aid];
  if (legacy) {
    u.passwordHash = hashPassword(legacy);              // bcrypt at rest
    u.passwordAlgo = 'bcrypt';
    u.needsReset = false;
    u.mustChange = true;                                // force change after login
    hashed++;
  } else {
    u.needsReset = true;                                // no legacy → set-a-password
    u.mustChange = false;
    noLegacy++;
  }
}
doc._meta = { ...(doc._meta || {}), legacyPasswordsAt: new Date().toISOString(), withLegacy: hashed, needsResetNoLegacy: noLegacy };
fs.writeFileSync(usersPath, JSON.stringify(doc, null, 2));
console.log(`legacy passwords hashed (mustChange=true): ${hashed}`);
console.log(`no legacy password (needsReset=true): ${noLegacy}`);
console.log(`note: passwords stored as bcrypt; member is forced to change on first login.`);
