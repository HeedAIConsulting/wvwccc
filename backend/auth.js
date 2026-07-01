/* ============================================================
   WVWCCC — authentication core
   bcrypt for new hashes; legacy md5/sha1/sha256/bcrypt verification
   so ChamberWare members keep their existing login (rehash on success).
   Sessions = signed JWT in an HttpOnly cookie.
   ============================================================ */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const PROD = process.env.NODE_ENV === 'production';
export const COOKIE = 'wv_session';

if (PROD && SECRET === 'dev-only-insecure-secret') {
  console.warn('[auth] WARNING: JWT_SECRET is not set in production.');
}

export function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }

// Super-admins (can grant/revoke admin). Set SUPER_ADMINS env (comma-separated);
// defaults to the project owner so role management works out of the box.
const SUPERS = (process.env.SUPER_ADMINS || 'mbowers@heedconsulting.ai,ai.admin@woodlandhillscc.net')
  .toLowerCase().split(/[,;\s]+/).filter(Boolean);
export function isSuper(email) { return SUPERS.includes(String(email || '').toLowerCase()); }
export function effectiveRole(email, role) { return isSuper(email) ? 'super_admin' : (role || 'member'); }

function legacyHex(algo, pw) { return crypto.createHash(algo).update(pw).digest('hex'); }

/**
 * Verify a password against a stored hash.
 * @returns {{ok:boolean, rehash?:string|null}} rehash = new bcrypt hash to persist
 *          (set only when a legacy hash verified successfully).
 */
export function verifyPassword(pw, hash, algo) {
  if (!hash) return { ok: false };
  if (algo === 'bcrypt' || /^\$2[aby]\$/.test(hash)) return { ok: bcrypt.compareSync(pw, hash) };
  const supported = { md5: 'md5', sha1: 'sha1', sha256: 'sha256' };
  if (supported[algo]) {
    const ok = legacyHex(supported[algo], pw) === String(hash).toLowerCase();
    return { ok, rehash: ok ? hashPassword(pw) : null };
  }
  return { ok: false }; // unknown algorithm → force a password reset
}

export function signSession(user) {
  return jwt.sign(
    { sub: user.email, role: user.role || 'member', mid: user.memberId || user.member_id || null },
    SECRET, { expiresIn: '8h' });
}
export function setCookie(res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, secure: PROD, sameSite: 'lax', maxAge: 8 * 3600 * 1000, path: '/' });
}
export function clearCookie(res) { res.clearCookie(COOKIE, { path: '/' }); }

// Stateless password-reset link — a short-lived signed token (no DB table needed).
export function signResetToken(email) {
  return jwt.sign({ sub: String(email).toLowerCase(), purpose: 'reset' }, SECRET, { expiresIn: '1h' });
}
export function verifyResetToken(token) {
  try { const p = jwt.verify(token || '', SECRET); return p.purpose === 'reset' ? p.sub : null; }
  catch { return null; }
}

// Stateless magic-link login — short-lived signed token, distinct purpose so a
// reset token can never be used to sign in (and vice versa).
export function signMagicToken(email) {
  return jwt.sign({ sub: String(email).toLowerCase(), purpose: 'magic' }, SECRET, { expiresIn: '20m' });
}
export function verifyMagicToken(token) {
  try { const p = jwt.verify(token || '', SECRET); return p.purpose === 'magic' ? p.sub : null; }
  catch { return null; }
}

export function readSession(req) {
  try { return jwt.verify((req.cookies && req.cookies[COOKIE]) || '', SECRET); }
  catch { return null; }
}

/** Express middleware: require a valid session, optionally restricted to role(s). */
export function requireAuth(roles) {
  const allow = roles ? [].concat(roles) : null;
  return (req, res, next) => {
    const s = readSession(req);
    if (!s) return res.status(401).json({ error: 'authentication required' });
    if (allow && !allow.includes(s.role)) return res.status(403).json({ error: 'forbidden' });
    req.user = s;
    next();
  };
}
