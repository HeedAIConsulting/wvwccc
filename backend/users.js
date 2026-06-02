/* User repository — Postgres in production, JSON store in dev.
   Staff accounts live in _store/staff.json (or users table, role='staff').
   Member accounts come from the ChamberWare import → _store/users.json. */
import * as db from './db.js';
import * as store from './store.js';

const lc = (s) => String(s || '').toLowerCase();

function mapRow(r) {
  return {
    id: r.id, memberId: r.member_id, email: r.email, username: r.username,
    passwordHash: r.password_hash, passwordAlgo: r.password_algo,
    needsReset: r.needs_reset, role: r.role, status: r.status,
  };
}
function storeUsers() {
  const mu = store.read('users.json', { users: [] });
  const members = Array.isArray(mu) ? mu : (mu.users || []);
  const staff = store.read('staff.json', []);
  return [...staff, ...members];
}

export async function getUserByEmail(email) {
  email = lc(email);
  if (db.enabled) {
    const r = await db.query(
      'SELECT id, member_id, email, username, password_hash, password_algo, needs_reset, role, status FROM users WHERE lower(email)=$1 LIMIT 1',
      [email]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  }
  return storeUsers().find((u) => lc(u.email) === email) || null;
}

export async function updatePassword(email, bcryptHash) {
  email = lc(email);
  if (db.enabled) {
    await db.query(
      "UPDATE users SET password_hash=$1, password_algo='bcrypt', needs_reset=false WHERE lower(email)=$2",
      [bcryptHash, email]);
    return;
  }
  // staff store first
  const staff = store.read('staff.json', []);
  const si = staff.findIndex((u) => lc(u.email) === email);
  if (si >= 0) { staff[si] = { ...staff[si], passwordHash: bcryptHash, passwordAlgo: 'bcrypt', needsReset: false }; store.write('staff.json', staff); return; }
  const mu = store.read('users.json', { users: [] });
  const arr = mu.users || [];
  const mi = arr.findIndex((u) => lc(u.email) === email);
  if (mi >= 0) { arr[mi] = { ...arr[mi], passwordHash: bcryptHash, passwordAlgo: 'bcrypt', needsReset: false }; store.write('users.json', { ...mu, users: arr }); }
}

export async function upsertStaff(email, bcryptHash, name) {
  email = lc(email);
  if (db.enabled) {
    await db.query(
      `INSERT INTO users (id, email, username, password_hash, password_algo, role, status)
       VALUES ($1,$2,$3,$4,'bcrypt','staff','approved')
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, username=EXCLUDED.username, role='staff'`,
      ['staff-' + Date.now().toString(36), email, name || email, bcryptHash]);
    return;
  }
  const staff = store.read('staff.json', []);
  const rec = { id: 'staff-' + Date.now().toString(36), email, username: name || email, passwordHash: bcryptHash, passwordAlgo: 'bcrypt', role: 'staff', status: 'approved' };
  const i = staff.findIndex((u) => lc(u.email) === email);
  if (i >= 0) staff[i] = { ...staff[i], ...rec }; else staff.push(rec);
  store.write('staff.json', staff);
}
