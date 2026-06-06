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
    needsReset: r.needs_reset, mustChange: r.must_change, role: r.role, status: r.status,
  };
}
function storeUsers() {
  const mu = store.read('users.json', { users: [] });
  const members = Array.isArray(mu) ? mu : (mu.users || []);
  const staff = store.read('staff.json', []);
  return [...staff, ...members];
}

// Env-based admin bootstrap — lets named admin/admin-member accounts log in on
// any environment (incl. live) without seeding the DB. Format (one per line or
// ';;'-separated):  email|bcryptHash|memberId|role|Full Name
// memberId/role/name optional (role defaults to 'admin'). The bcrypt hash never
// exposes the password; set ADMIN_BOOTSTRAP in the host env (e.g. Render).
function bootstrapUsers() {
  const raw = process.env.ADMIN_BOOTSTRAP || '';
  return raw.split(/\n|;;/).map((s) => s.trim()).filter(Boolean).map((line) => {
    const [email, passwordHash, memberId, role, ...name] = line.split('|');
    return {
      id: 'boot-' + lc(email), email: lc(email), memberId: memberId || null,
      username: name.join('|') || email, passwordHash: passwordHash || '',
      passwordAlgo: 'bcrypt', needsReset: false, mustChange: false,
      role: role || 'admin', status: 'approved',
    };
  }).filter((u) => u.email && u.passwordHash);
}

export async function getUserByEmail(email) {
  email = lc(email);
  const boot = bootstrapUsers().find((u) => u.email === email);
  if (boot) return boot;          // env-configured admins win (works on live w/o DB)
  if (db.enabled) {
    const r = await db.query(
      'SELECT id, member_id, email, username, password_hash, password_algo, needs_reset, role, status FROM users WHERE lower(email)=$1 LIMIT 1',
      [email]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  }
  return storeUsers().find((u) => lc(u.email) === email) || null;
}

export async function setLastLogin(email) {
  email = lc(email);
  if (db.enabled) { try { await db.query('UPDATE users SET last_login=now() WHERE lower(email)=$1', [email]); } catch (e) {} return; }
  const now = new Date().toISOString();
  for (const fname of ['staff.json', 'users.json']) {
    if (fname === 'users.json') {
      const mu = store.read('users.json', { users: [] }); const arr = mu.users || [];
      const i = arr.findIndex((u) => lc(u.email) === email);
      if (i >= 0) { arr[i].lastLogin = now; store.write('users.json', { ...mu, users: arr }); return; }
    } else {
      const s = store.read('staff.json', []); const i = s.findIndex((u) => lc(u.email) === email);
      if (i >= 0) { s[i].lastLogin = now; store.write('staff.json', s); return; }
    }
  }
}

// Members whose linked login was used most recently (for "recently active" on home).
export async function recentMemberIds(limit = 8) {
  if (db.enabled) {
    const r = await db.query(
      "SELECT member_id FROM users WHERE role='member' AND member_id IS NOT NULL AND last_login IS NOT NULL ORDER BY last_login DESC LIMIT $1",
      [limit]);
    return r.rows.map((x) => x.member_id);
  }
  const mu = store.read('users.json', { users: [] });
  return (mu.users || [])
    .filter((u) => u.memberId && u.lastLogin)
    .sort((a, b) => String(b.lastLogin).localeCompare(String(a.lastLogin)))
    .slice(0, limit)
    .map((u) => u.memberId);
}

export async function updatePassword(email, bcryptHash) {
  email = lc(email);
  if (db.enabled) {
    await db.query(
      "UPDATE users SET password_hash=$1, password_algo='bcrypt', needs_reset=false, must_change=false WHERE lower(email)=$2",
      [bcryptHash, email]);
    return;
  }
  // staff store first
  const staff = store.read('staff.json', []);
  const si = staff.findIndex((u) => lc(u.email) === email);
  if (si >= 0) { staff[si] = { ...staff[si], passwordHash: bcryptHash, passwordAlgo: 'bcrypt', needsReset: false, mustChange: false }; store.write('staff.json', staff); return; }
  const mu = store.read('users.json', { users: [] });
  const arr = mu.users || [];
  const mi = arr.findIndex((u) => lc(u.email) === email);
  if (mi >= 0) { arr[mi] = { ...arr[mi], passwordHash: bcryptHash, passwordAlgo: 'bcrypt', needsReset: false, mustChange: false }; store.write('users.json', { ...mu, users: arr }); }
}

// Admin-triggered: force a member to set a new password on next login.
// Clears the stored hash so the old password no longer works.
export async function requireReset(memberId) {
  if (db.enabled) {
    const r = await db.query(
      "UPDATE users SET needs_reset=true, password_hash=NULL, password_algo='unknown' WHERE member_id=$1 RETURNING email",
      [memberId]);
    return r.rows[0]?.email || null;
  }
  const mu = store.read('users.json', { users: [] });
  const arr = mu.users || [];
  const i = arr.findIndex((u) => u.memberId === memberId);
  if (i < 0) return null;
  arr[i] = { ...arr[i], needsReset: true, mustChange: false, passwordHash: '', passwordAlgo: 'unknown' };
  store.write('users.json', { ...mu, users: arr });
  return arr[i].email || null;
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

export async function upsertMember(email, bcryptHash, memberId, name) {
  email = lc(email);
  if (db.enabled) {
    await db.query(
      `INSERT INTO users (id, member_id, email, username, password_hash, password_algo, role, status)
       VALUES ($1,$2,$3,$4,$5,'bcrypt','member','approved')
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, member_id=EXCLUDED.member_id, role='member'`,
      ['mu-' + Date.now().toString(36), memberId || null, email, name || email, bcryptHash]);
    return;
  }
  const mu = store.read('users.json', { users: [] });
  const arr = mu.users || [];
  const rec = { id: 'mu-' + Date.now().toString(36), memberId: memberId || null, email, username: name || email, passwordHash: bcryptHash, passwordAlgo: 'bcrypt', role: 'member', status: 'approved', needsReset: false };
  const i = arr.findIndex((u) => lc(u.email) === email);
  if (i >= 0) arr[i] = { ...arr[i], ...rec }; else arr.push(rec);
  store.write('users.json', { ...mu, users: arr });
}
