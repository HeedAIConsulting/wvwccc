/* ============================================================
   WVWCCC — API routes (mounted at /api by server.js)
   Durable data via backend/repo.js (Postgres when DATABASE_URL set).
   ============================================================ */
import express from 'express';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sale, addRecurring, refundTransaction, voidTransaction } from './payments-agms.js';
import * as auth from './auth.js';
import * as users from './users.js';
import * as repo from './repo.js';
import * as llm from './llm.js';
import * as turnstile from './turnstile.js';
import * as email from './email.js';
import { SOCIAL_KEYS, sanitizePrimaryImage, sanitizeTeam, buildRewritePrompt, parseRewriteResponse } from './profile-helpers.js';
import { registerNewsletterImport } from './newsletter-import.js';

const router = express.Router();

// Per-member cooldown for the AI rewrite endpoint (simple in-memory guard).
const aiRewriteCooldown = new Map();
const magicLinkCooldown = new Map();
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Staff/admin gate — real session auth.
const requireAdmin = auth.requireAuth(['staff', 'admin', 'super_admin']);
const requireSuper = auth.requireAuth(['super_admin']);

// HTML-escape for the emails this file composes (payment links, notifications).
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LEADER_OPTS = ['', 'Leader', 'Board Member', 'New Member', 'Past President', 'Ambassador', 'Staff'];
const STATUS_OPTS = ['approved', 'pending', 'suspended', 'inactive'];

// ── Auth ────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const { email, password, remember } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const user = await users.getUserByEmail(email);
    if (!user || user.status === 'suspended' || user.status === 'inactive') {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (user.needsReset || user.passwordAlgo === 'unknown' || !user.passwordHash) {
      return res.status(403).json({ error: 'A password reset is required for this account.', needsReset: true });
    }
    const { ok, rehash } = auth.verifyPassword(password, user.passwordHash, user.passwordAlgo);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });
    if (rehash) { try { await users.updatePassword(email, rehash); } catch (e) { console.error('rehash failed', e.message); } }
    users.setLastLogin(email).catch(() => {});
    user.role = auth.effectiveRole(user.email, user.role);   // elevate super-admins
    // "Keep me signed in" → 30-day session instead of 8 hours.
    auth.setCookie(res, auth.signSession(user, !!remember), !!remember);
    // Members keep their existing password — we do NOT force a change on login
    // (per Chamber preference). Voluntary change is available on the account page.
    res.json({ ok: true, role: user.role });
  } catch (e) { console.error('login error', e); res.status(500).json({ error: 'login failed' }); }
});

router.post('/auth/logout', (_req, res) => { auth.clearCookie(res); res.json({ ok: true }); });

// Forgot password — records the request and (when SMTP is configured) emails a
// reset link. Always returns a generic success so we never reveal who has an
// account. NOTE: actual email delivery needs an SMTP/email sender (TODO).
router.post('/auth/forgot', async (req, res) => {
  // NB: keep the address in `addr` — `email` is the imported mail module.
  const addr = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return res.status(400).json({ error: 'Enter a valid email address.' });
  try {
    const user = await users.getUserByEmail(addr);
    if (user) {
      const token = auth.signResetToken(addr);
      const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
      const link = `${base}/auth/reset.html?token=${encodeURIComponent(token)}`;
      const result = await email.send({
        to: addr,
        subject: 'Reset your West Valley · Warner Center Chamber password',
        text: `We received a request to reset your Chamber account password.\n\nReset it here (link expires in 1 hour):\n${link}\n\nIf you didn't request this, you can ignore this email.`,
        html: `<p>We received a request to reset your Chamber account password.</p><p><a href="${link}">Reset your password</a> (link expires in 1 hour).</p><p>If you didn't request this, you can ignore this email.</p>`,
      });
      // Log server-side (never leaked to the client) so a missing mail provider
      // or a send failure is visible instead of silently swallowed.
      if (result && result.skipped) console.warn('[auth/forgot] email provider not configured — reset link NOT sent for', addr);
      else if (result && result.ok === false) console.error('[auth/forgot] reset email failed:', result.error);
    }
  } catch (e) { console.error('[auth/forgot] error:', e.message); }
  res.json({ ok: true, message: 'If an account exists for that email, password-reset instructions are on the way.' });
});

// Complete a password reset from the emailed link (stateless signed token).
router.post('/auth/reset', async (req, res) => {
  const { token, password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const email = auth.verifyResetToken(token);
  if (!email) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
  try { await users.updatePassword(email, auth.hashPassword(password)); res.json({ ok: true }); }
  catch (e) { console.error('reset failed', e); res.status(500).json({ error: 'Could not reset password.' }); }
});

// ── Magic-link login (passwordless) ─────────────────────────
// Request a one-time sign-in link by email. Generic response (never reveal
// whether an account exists). 60s per-email cooldown to prevent inbox spam.
router.post('/auth/magic/request', async (req, res) => {
  const addr = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const now = Date.now();
  if (now - (magicLinkCooldown.get(addr) || 0) < 60000) {
    return res.json({ ok: true, message: 'If an account exists for that email, a sign-in link is on the way.' });
  }
  magicLinkCooldown.set(addr, now);
  try {
    const user = await users.getUserByEmail(addr);
    if (user) {
      const token = auth.signMagicToken(addr);
      const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
      const link = `${base}/api/auth/magic/verify?token=${encodeURIComponent(token)}`;
      const result = await email.send({
        to: addr,
        subject: 'Your West Valley · Warner Center Chamber sign-in link',
        text: `Click to sign in to your Chamber account. This link expires in 20 minutes:\n${link}\n\nIf you didn't request this, you can ignore this email.`,
        html: `<p>Click to sign in to your Chamber account. This link expires in 20 minutes:</p><p><a href="${link}">Sign in to the Chamber</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      });
      if (result && result.skipped) console.warn('[auth/magic] email provider not configured — link NOT sent for', addr);
      else if (result && result.ok === false) console.error('[auth/magic] email failed:', result.error);
    }
  } catch (e) { console.error('[auth/magic] error:', e.message); }
  res.json({ ok: true, message: 'If an account exists for that email, a sign-in link is on the way.' });
});

// Consume the link → establish a session and redirect to the right home.
router.get('/auth/magic/verify', async (req, res) => {
  const addr = auth.verifyMagicToken(req.query.token);
  if (!addr) return res.redirect('/auth/login.html?magic=expired');
  try {
    const user = await users.getUserByEmail(addr);
    if (!user) return res.redirect('/auth/login.html?magic=expired');
    auth.setCookie(res, auth.signSession({ email: user.email, role: user.role, memberId: user.memberId }));
    const admin = ['staff', 'admin', 'super_admin'].includes(user.role);
    res.redirect(admin ? '/admin/index.html' : '/member/index.html');
  } catch (e) { console.error('[auth/magic/verify]', e.message); res.redirect('/auth/login.html?magic=error'); }
});

router.get('/auth/me', (req, res) => {
  const s = auth.readSession(req);
  if (!s) return res.status(401).json({ error: 'no session' });
  res.json({ email: s.sub, role: s.role, memberId: s.mid });
});

router.post('/auth/set-password', auth.requireAuth(), async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try { await users.updatePassword(req.user.sub, auth.hashPassword(password)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'could not update password' }); }
});

// ── Directory members ───────────────────────────────────────
// Base roster = imported store (gitignored) when present, else committed seed.
// Admin overrides (status/tier/leader/featured) come from the durable repo.
const PUBLIC_FIELDS = ['id', 'slug', 'name', 'category', 'group', 'tier', 'neighborhood', 'contactName',
  'address', 'city', 'state', 'zip', 'phone', 'fax', 'website', 'tagline',
  'description', 'leaderStatus', 'designations', 'boardTitle', 'leaderLogo', 'seal', 'featured', 'tags', 'keywords', 'categories',
  // richer profile (member-managed)
  'hours', 'occupation', 'typeOfBusiness', 'yearEstablished', 'employees',
  'logo', 'pageImage', 'photos', 'social', 'reviewLinks', 'ctaLinks', 'video',
  'services', 'accomplishments', 'associations', 'team', 'primaryImage'];

let _kw = null;
function readKeywords() {
  if (_kw) return _kw;
  try { _kw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'member-keywords.json'), 'utf8')); }
  catch { _kw = {}; }
  return _kw;
}
function rawMembers() {
  const storePath = path.join(ROOT, 'data', '_store', 'members.json');
  const seed = path.join(ROOT, 'data', 'directory.json');
  const usingStore = fs.existsSync(storePath);
  const raw = JSON.parse(fs.readFileSync(usingStore ? storePath : seed, 'utf8'));
  const kw = readKeywords();
  const members = (raw.members || []).map((m) => {
    const k = kw[m.id]; if (!k) return m;
    return {
      ...m,
      keywords: (k.keywords && k.keywords.length) ? k.keywords : m.keywords,
      description: (m.description && String(m.description).trim()) ? m.description : (k.description || m.description),
    };
  });
  return { source: usingStore ? 'imported' : 'seed', members };
}

// Merge precedence: base directory  <  member self-edits  <  admin overrides.
async function loadMembersFull() {
  const { source, members } = rawMembers();
  const [edits, overrides, added, userList] = await Promise.all([
    repo.getMemberEdits(), repo.getOverrides(), repo.listAddedMembers(),
    users.listUsers().catch(() => []),
  ]);
  // The directory roster doesn't carry the login email (it lives in the auth/users
  // store). Map it back by member id so admin views can show + act on each login.
  const emailByMember = {};
  for (const u of (userList || [])) if (u.memberId && u.email && !emailByMember[u.memberId]) emailByMember[u.memberId] = u.email;
  const base = members.concat(added || []);
  return { source, members: base.map((m) => {
    const merged = { ...m, ...(edits[m.id] || {}), ...(overrides[m.id] || {}) };
    if (!merged.email) merged.email = emailByMember[m.id] || '';
    return merged;
  }) };
}
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// Scalar fields a member may edit (admin-only: status/tier/leader/featured).
const MEMBER_STR_FIELDS = ['name', 'category', 'neighborhood', 'contactName', 'phone', 'fax',
  'website', 'address', 'city', 'state', 'zip', 'tagline', 'description', 'hours',
  'occupation', 'typeOfBusiness', 'yearEstablished', 'employees', 'logo', 'pageImage', 'video',
  'services', 'accomplishments', 'associations'];
const clampUrl = (s) => String(s || '').trim().slice(0, 600);
function sanitizeProfile(b) {
  const patch = {};
  for (const f of MEMBER_STR_FIELDS) if (b[f] !== undefined) patch[f] = String(b[f]).slice(0, 5000);
  // Member-selectable categories (up to 3). First one is the primary `category`.
  if (Array.isArray(b.categories)) {
    const cats = [...new Set(b.categories.map((c) => String(c || '').trim()).filter(Boolean))].slice(0, 3);
    patch.categories = cats;
    if (cats[0]) patch.category = cats[0];
  }
  if (b.social && typeof b.social === 'object') {
    const out = {};
    for (const k of SOCIAL_KEYS) if (b.social[k]) out[k] = clampUrl(b.social[k]);
    patch.social = out;
  }
  if (b.reviewLinks && typeof b.reviewLinks === 'object') {
    const out = {};
    for (const k of ['google', 'yelp']) if (b.reviewLinks[k]) out[k] = clampUrl(b.reviewLinks[k]);
    patch.reviewLinks = out;
  }
  if (Array.isArray(b.ctaLinks)) patch.ctaLinks = b.ctaLinks.slice(0, 4)
    .map((c) => ({ label: String(c.label || '').slice(0, 40), url: clampUrl(c.url) }))
    .filter((c) => c.label && c.url);
  if (Array.isArray(b.photos)) patch.photos = b.photos.slice(0, 8).map(clampUrl).filter(Boolean);
  if (Array.isArray(b.contacts)) patch.contacts = b.contacts.slice(0, 3)
    .map((c) => ({ name: String(c.name || '').slice(0, 80), email: String(c.email || '').slice(0, 160) }))
    .filter((c) => c.name || c.email);
  if (b.primaryImage !== undefined) { const p = sanitizePrimaryImage(b.primaryImage); if (p) patch.primaryImage = p; }
  if (Array.isArray(b.team)) patch.team = sanitizeTeam(b.team);
  return patch;
}

// ── Member portal (any signed-in user) ──────────────────────
router.get('/me', auth.requireAuth(), async (req, res) => {
  try {
    const mid = req.user.mid;
    const member = mid ? (await loadMembersFull()).members.find((x) => x.id === mid) || null : null;
    res.json({ user: { email: req.user.sub, role: req.user.role }, member });
  } catch (e) { res.status(500).json({ error: 'profile unavailable' }); }
});

router.patch('/me/profile', auth.requireAuth(), async (req, res) => {
  const mid = req.user.mid;
  if (!mid) return res.status(400).json({ error: 'No member listing is linked to this account.' });
  const patch = sanitizeProfile(req.body || {});
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No editable fields provided.' });
  try { await repo.setMemberEdit(mid, patch); res.json({ ok: true, applied: patch }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'could not save profile' }); }
});

// AI draft for tagline/description. Never saves — returns a suggestion the
// member edits, then saves via PATCH /me/profile. Gemini 2.5 Flash.
router.post('/me/profile/ai-rewrite', auth.requireAuth(), async (req, res) => {
  const mid = req.user.mid;
  if (!mid) return res.status(400).json({ error: 'No member listing is linked to this account.' });
  const now = Date.now();
  if (now - (aiRewriteCooldown.get(mid) || 0) < 8000) {
    return res.status(429).json({ error: 'Please wait a few seconds before trying again.' });
  }
  aiRewriteCooldown.set(mid, now);
  try {
    const member = (await loadMembersFull()).members.find((x) => x.id === mid);
    if (!member) return res.status(404).json({ error: 'Listing not found.' });
    if (!llm.enabled()) {
      return res.json({ unavailable: true, message: 'AI writing is not configured yet. You can still write your description by hand.' });
    }
    const { system, prompt } = buildRewritePrompt(member, req.body || {});
    // Prefer 2.5 Flash; fall back to the proven alias if that id isn't enabled for the key.
    let text = await llm.complete({ system, prompt, json: true, maxTokens: 500, model: 'gemini-2.5-flash' });
    let parsed = parseRewriteResponse(text);
    if (!parsed) { text = await llm.complete({ system, prompt, json: true, maxTokens: 500, model: 'gemini-flash-latest' }); parsed = parseRewriteResponse(text); }
    if (!parsed) return res.json({ unavailable: true, message: 'Could not draft a suggestion just now. Please try again.' });
    res.json({ ok: true, ...parsed });
  } catch (e) {
    console.error('ai-rewrite', e);
    res.status(500).json({ error: 'Could not generate a suggestion.' });
  }
});

// Member submits an offer/discount, community post, job opening, or
// real-estate listing → pending admin approval.
const MEMBER_POST_TYPES = ['discount', 'member_post', 'job', 'listing'];
function sanitizePostMeta(type, raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const s = (v, n) => String(v || '').slice(0, n);
  if (type === 'job') {
    return {
      jobType: ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'].includes(b.jobType) ? b.jobType : 'Full-time',
      location: s(b.location, 120),
      payRange: s(b.payRange, 80),
      applyEmail: s(b.applyEmail, 160),
    };
  }
  if (type === 'listing') {
    return {
      listingType: ['Commercial', 'Residential'].includes(b.listingType) ? b.listingType : 'Residential',
      dealType: ['For Sale', 'For Lease', 'For Rent'].includes(b.dealType) ? b.dealType : 'For Sale',
      price: s(b.price, 40),
      address: s(b.address, 200),
      beds: s(b.beds, 10),
      baths: s(b.baths, 10),
      sqft: s(b.sqft, 12),
    };
  }
  return undefined;
}
router.post('/me/post', auth.requireAuth(), async (req, res) => {
  const mid = req.user.mid;
  if (!mid) return res.status(400).json({ error: 'No member listing is linked to this account.' });
  const b = req.body || {};
  const type = MEMBER_POST_TYPES.includes(b.type) ? b.type : null;
  if (!type) return res.status(400).json({ error: 'Invalid post type.' });
  if (!b.title || !b.body) return res.status(400).json({ error: 'Title and body are required.' });
  const badWords = flagContent(`${b.title} ${b.body}`);
  if (badWords) return res.status(400).json({ error: badWords });
  let authorName = req.user.sub;
  try { authorName = (await loadMembersFull()).members.find((m) => m.id === mid)?.name || authorName; } catch (e) {}
  const post = {
    id: 'post-' + Date.now().toString(36),
    type, authorId: req.user.sub, authorName, memberId: mid,
    title: String(b.title).slice(0, 160), body: String(b.body).slice(0, 4000),
    imageUrl: clampUrl(b.imageUrl), linkUrl: clampUrl(b.linkUrl),
    ctaLabel: String(b.ctaLabel || '').slice(0, 40), ctaUrl: clampUrl(b.ctaUrl),
    code: String(b.code || '').slice(0, 80), status: 'pending', featuredHome: false,
    expiresAt: b.expiresAt || null,
    meta: sanitizePostMeta(type, b.meta),
  };
  try { await repo.addPost(post); res.json({ ok: true, status: 'pending' }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'could not submit' }); }
});

router.get('/me/posts', auth.requireAuth(), async (req, res) => {
  if (!req.user.mid) return res.json({ posts: [] });
  try { res.json({ posts: await repo.listPosts({ memberId: req.user.mid }) }); }
  catch (e) { res.status(500).json({ error: 'failed' }); }
});

/* ── Members manage their own posts (Felicia, Jul 29 2026) ──
   "You'd have the ability to edit your post, or duplicate it, or change it, or
   delete it." Editing sends it back through review — the office still has the
   last word on anything that reaches the public site. */
async function ownPost(req, id) {
  if (!req.user.mid) return null;
  const posts = await repo.listPosts({ memberId: req.user.mid });
  return posts.find((p) => p.id === id) || null;
}
router.patch('/me/post/:id', auth.requireAuth(), async (req, res) => {
  try {
    const p = await ownPost(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'That post is not yours, or no longer exists.' });
    const b = req.body || {};
    const patch = { status: 'pending' };   // any edit goes back through review
    if (b.title !== undefined) patch.title = String(b.title).slice(0, 160);
    if (b.body !== undefined) patch.body = String(b.body).slice(0, 4000);
    if (b.imageUrl !== undefined) patch.imageUrl = clampUrl(b.imageUrl);
    if (b.linkUrl !== undefined) patch.linkUrl = clampUrl(b.linkUrl);
    if (b.ctaLabel !== undefined) patch.ctaLabel = String(b.ctaLabel || '').slice(0, 40);
    if (b.ctaUrl !== undefined) patch.ctaUrl = clampUrl(b.ctaUrl);
    if (b.code !== undefined) patch.code = String(b.code || '').slice(0, 80);
    if (b.meta !== undefined) patch.meta = sanitizePostMeta(p.type, b.meta);
    if (!String(patch.title ?? p.title).trim() || !String(patch.body ?? p.body).trim()) {
      return res.status(400).json({ error: 'Title and details are both required.' });
    }
    const bad = flagContent(`${patch.title ?? p.title} ${patch.body ?? p.body}`);
    if (bad) return res.status(400).json({ error: bad });
    await repo.updatePost(req.params.id, patch);
    res.json({ ok: true, status: 'pending' });
  } catch (e) { console.error('me/post patch', e); res.status(500).json({ error: 'Could not save that change.' }); }
});
router.delete('/me/post/:id', auth.requireAuth(), async (req, res) => {
  try {
    const p = await ownPost(req, req.params.id);
    if (!p) return res.status(404).json({ error: 'That post is not yours, or no longer exists.' });
    await repo.deletePost(req.params.id);
    res.json({ ok: true });
  } catch (e) { console.error('me/post delete', e); res.status(500).json({ error: 'Could not remove that post.' }); }
});

/* ── Content guard for anything the public can submit ───────
   Michael's push-back on open posting (Jul 29 2026): the chamber's name is on
   whatever appears, so screen the obvious categories the board would never
   co-sign, on top of the captcha and the mandatory admin approval. This is a
   coarse first pass, not a substitute for the human review that follows. */
const BLOCKED_PATTERNS = [
  /\b(escort|escorts|hookup|hook-?ups?|adult\s+entertainment|strip\s?club|porn\w*|xxx|onlyfans|sugar\s?(baby|daddy|momma))\b/i,
  /\b(firearms?\s+(sales?|dealer)|gun\s?shows?|ammo\s+sales?|silencers?|ghost\s?guns?)\b/i,
  /\b(campaign\s+(for|to\s+elect)|vote\s+(for|against)\b|elect\s+\w+\s+for\b|ballot\s+measure|political\s+action\s+committee)\b/i,
  /\b(cbd|thc|cannabis|marijuana|dispensar\w+|kratom|vape\s+shop)\b/i,
  /\b(payday\s+loans?|debt\s+relief\s+guarantee|guaranteed\s+income|work\s+from\s+home\s+\$?\d|crypto\s+(giveaway|doubl\w+)|forex\s+signals?|mlm|multi-?level\s+marketing|pyramid\s+scheme)\b/i,
];
function flagContent(text) {
  const s = String(text || '');
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(s)) {
      return 'This posting covers a topic the Chamber does not publish (adult, firearms, political campaigning, cannabis, or high-risk financial offers). '
        + 'If you believe that is a mistake, call the office at (818) 347-4737 and we will post it for you.';
    }
  }
  return '';
}

/* ── Public (non-member) job posting ───────────────────────
   Felicia: "the public can post a position." Michael's conditions: a captcha,
   a content filter, a verified email so the post is attributable, and nothing
   goes live without an admin approving it. Non-members get the plain fields —
   no logo, no flyer, no linked profile — which is the member/non-member
   difference she asked for. */
/* ── Community (non-member) event submission ────────────────
   Felicia, Jul 29 2026: the chamber needs to see what else is happening on a
   date so its own events and members' ribbon cuttings don't collide with, say,
   another organisation's gala. Michael's condition was accountability: the
   submitter verifies their email FIRST, so every community listing is tied to
   a real address, is labelled as a non-member submission, and still needs an
   admin to approve it. Codes live in memory with a 30-minute life — this is a
   spam speed-bump, not an account system. */
const evCodes = new Map(); // email → { code, expires, tries }
const EV_CODE_TTL = 30 * 60 * 1000;
/* Abuse guards (Aug 2026). This route mails a code to WHATEVER address is in
   the request body, so it is the one public endpoint that can send to a
   stranger. The captcha above it fails open whenever TURNSTILE_SECRET is
   unset, which leaves only the global 120-req/min limiter — enough to push
   ~172k messages a day at one victim, out of the Chamber's sending domain.
   The sibling magic-link route already carries a per-address cooldown; this
   one now matches it, plus a per-IP cap on how many DIFFERENT addresses a
   single source may mail in an hour (a cooldown alone does not stop someone
   spraying thousands of distinct victims). Both are in-memory, like evCodes
   itself — a speed bump that survives no restart, which is the right weight
   for this, but the real fix is setting TURNSTILE_SECRET. */
const evCodeCooldown = new Map(); // email → last-sent ms
const evCodeByIp = new Map();     // ip → { hour, addrs:Set }
const EV_CODE_COOLDOWN = 60 * 1000;
const EV_CODE_IP_ADDRS_PER_HOUR = 8;
function pruneEvCodes() {
  const now = Date.now();
  for (const [k, v] of evCodes) if (v.expires < now) evCodes.delete(k);
  for (const [k, t] of evCodeCooldown) if (now - t > EV_CODE_COOLDOWN) evCodeCooldown.delete(k);
  const hour = Math.floor(now / 3600000);
  for (const [k, v] of evCodeByIp) if (v.hour !== hour) evCodeByIp.delete(k);
}
router.post('/public/event/verify', async (req, res) => {
  const b = req.body || {};
  const cap = await turnstile.verify(b['cf-turnstile-response'] || b.turnstileToken, req.ip);
  if (!cap.ok) return res.status(400).json({ error: 'Please complete the human-verification check and try again.' });
  const to = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  pruneEvCodes();
  // One code per address per minute. A visitor who genuinely missed the email
  // waits a moment; a script pointed at someone else's inbox gets nowhere.
  const now = Date.now();
  if (now - (evCodeCooldown.get(to) || 0) < EV_CODE_COOLDOWN) {
    return res.status(429).json({ error: 'A code was just sent to that address — please check your inbox (and spam folder), then try again in a minute.' });
  }
  // And one source may only mail a handful of DIFFERENT addresses per hour.
  const hour = Math.floor(now / 3600000);
  const ipKey = String(req.ip || 'unknown');
  let seen = evCodeByIp.get(ipKey);
  if (!seen || seen.hour !== hour) { seen = { hour, addrs: new Set() }; evCodeByIp.set(ipKey, seen); }
  if (!seen.addrs.has(to) && seen.addrs.size >= EV_CODE_IP_ADDRS_PER_HOUR) {
    console.warn('[event verify] per-IP address cap hit', ipKey);
    return res.status(429).json({ error: 'Too many verification codes requested from this connection. Please try again later, or call the office at (818) 347-4737 and we will add your event for you.' });
  }
  // 6 digits, generated server-side and never echoed in the response.
  const code = String(Math.floor(100000 + Math.random() * 900000));
  evCodes.set(to, { code, expires: Date.now() + EV_CODE_TTL, tries: 0 });
  const text = `Your West Valley · Warner Center Chamber of Commerce verification code is:\n\n    ${code}\n\n`
    + `Enter it on the community event form to finish submitting your event. The code expires in 30 minutes.\n\n`
    + `If you did not request this, you can ignore this email.\n`;
  try {
    const r = await email.send({ to, subject: `Your verification code: ${code}`, text });
    // `skipped` means no mail provider is configured — the visitor would never
    // receive the code, so never claim it was sent.
    if (!r || r.ok === false || r.skipped) throw new Error(r && r.skipped ? 'email not configured' : 'send failed');
    // Count it only once a message actually went out: a provider outage must
    // not lock a real visitor out of retrying, and a send that never happened
    // is not abuse worth throttling.
    evCodeCooldown.set(to, Date.now());
    seen.addrs.add(to);
    res.json({ ok: true, sent: true });
  } catch (e) {
    evCodes.delete(to);
    console.error('event verify send', e.message);
    res.status(502).json({ error: 'We could not send the code right now. Please call the office at (818) 347-4737 and we will add your event for you.' });
  }
});
router.post('/public/event', async (req, res) => {
  const b = req.body || {};
  const to = String(b.email || '').trim().toLowerCase();
  pruneEvCodes();
  const rec = evCodes.get(to);
  if (!rec) return res.status(400).json({ error: 'Please request a verification code first (or request a new one — codes expire after 30 minutes).' });
  if (rec.tries >= 5) { evCodes.delete(to); return res.status(429).json({ error: 'Too many incorrect codes. Please request a new one.' }); }
  if (String(b.code || '').trim() !== rec.code) {
    rec.tries++;
    return res.status(400).json({ error: 'That code does not match. Check the email and try again.' });
  }
  const title = String(b.title || '').trim().slice(0, 200);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : '';
  const org = String(b.organization || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'The event name is required.' });
  if (!date) return res.status(400).json({ error: 'Please give the event date.' });
  if (!org) return res.status(400).json({ error: 'Please name the organization putting on the event.' });
  const bad = flagContent(`${title} ${b.summary || ''} ${org}`);
  if (bad) return res.status(400).json({ error: bad });
  try {
    // Deliberately the plain fields — no flyer, no rich text, no images. That
    // is the member/non-member difference Felicia described.
    const ev = buildEvent({
      id: 'ce-' + Date.now().toString(36),
      title, date,
      time: String(b.time || '').slice(0, 40),
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(String(b.endDate || '')) ? b.endDate : '',
      venue: String(b.venue || '').slice(0, 160),
      address: String(b.address || '').slice(0, 200),
      summary: String(b.summary || '').slice(0, 600),
      category: 'Community',
      // No action button (Felicia, Aug 12 2026). This form offers no CTA choice,
      // so submissions used to publish with an RSVP button by default — the
      // ribbon-cutting host who wanted RSVPs sent to her own address had guests
      // clicking a button that filed nothing. The office adds a button on approval.
      hideCta: true,
      // Pending until an admin approves; confirmed because a date is required.
      status: 'pending', confirmed: true, showOnCalendar: true,
      imageMode: 'logo',        // no flyer to show, so no giant placeholder
      links: b.website ? [{ type: 'info', label: 'Event details', url: String(b.website).slice(0, 400) }] : [],
    }, {});
    // Attribution — the listing says who submitted it and that they are not a
    // Chamber member, so making the date visible never reads as an endorsement.
    ev.hostKind = 'community';
    ev.hostName = org;
    ev.submittedByName = org;
    ev.source = 'community';
    ev.communityEmail = to;
    await repo.upsertEvent(ev);
    evCodes.delete(to);
    res.json({ ok: true, status: 'pending' });
  } catch (e) { console.error('public event', e); res.status(500).json({ error: 'Could not submit the event — please try again.' }); }
});

router.post('/public/job', async (req, res) => {
  const b = req.body || {};
  const cap = await turnstile.verify(b['cf-turnstile-response'] || b.turnstileToken, req.ip);
  if (!cap.ok) return res.status(400).json({ error: 'Please complete the human-verification check and try again.' });
  const title = String(b.title || '').trim().slice(0, 160);
  const body = String(b.body || '').trim().slice(0, 4000);
  const company = String(b.company || '').trim().slice(0, 120);
  const contact = String(b.email || '').trim().slice(0, 160);
  if (!title || !body) return res.status(400).json({ error: 'The job title and the description are both required.' });
  if (!company) return res.status(400).json({ error: 'Please include the name of the business hiring.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) return res.status(400).json({ error: 'Please give a valid email address so we can confirm this posting with you.' });
  const bad = flagContent(`${title} ${body} ${company}`);
  if (bad) return res.status(400).json({ error: bad });
  const post = {
    id: 'post-' + Date.now().toString(36) + 'p',
    type: 'job',
    authorId: null, authorName: company, memberId: null,
    title, body,
    imageUrl: '', linkUrl: '',
    ctaLabel: '', ctaUrl: clampUrl(b.applyUrl),
    code: '', status: 'pending', featuredHome: false, expiresAt: null,
    // `community` + `submitterEmail` live in meta because that is the only
    // free-form field the posts table persists — they mark this as a community
    // submission on the public card and in the admin queue, so the Chamber is
    // never implying it vouches for the poster.
    meta: {
      ...sanitizePostMeta('job', b.meta),
      applyEmail: contact,
      community: true,
      submitterEmail: contact,
    },
  };
  try {
    await repo.addPost(post);
    res.json({ ok: true, status: 'pending' });
  } catch (e) { console.error('public job', e); res.status(500).json({ error: 'Could not submit the posting — please try again.' }); }
});

// ── Group-leader event submission → publishes straight to the calendar ──
// Chamber group/circle leaders and board members may add and manage their own
// events; regular members are routed to the office.
const EVENT_LEADER_STATUSES = ['Leader', 'Board Member', 'Ambassador', 'Past President'];
function memberIsLeader(m) {
  return !!m && (EVENT_LEADER_STATUSES.includes(m.leaderStatus) || String(m.tier || '').toLowerCase() === 'leader');
}
async function myMember(mid) {
  return mid ? (await loadMembersFull()).members.find((x) => x.id === mid) || null : null;
}
// A member who manages a Connection Circle counts as a leader even if their
// directory record carries no leaderStatus. Matched by the account email.
async function managedGroups(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return [];
  try { return (await loadGroups()).filter((g) => g && g.manager && String(g.manager.email || '').toLowerCase() === e); }
  catch { return []; }
}
// The groups this LOGIN leads: the named manager (by login email), or a roster
// entry with a leadership role — Leader / Chair / Co-Chair — matched by the
// roster email or by the member listing linked to the login. Needed because
// most groups name the office as manager (felicia@), so a chair like Priscilla
// has to count as the leader of her own group without an office email swap
// (Felicia call, Aug 19 2026).
async function groupsLedBy(user) {
  const e = String((user && user.sub) || '').toLowerCase();
  const mid = (user && user.mid) || null;
  if (!e && !mid) return [];
  try {
    return (await loadGroups()).filter((g) => {
      if (!g) return false;
      if (e && g.manager && String(g.manager.email || '').toLowerCase() === e) return true;
      return (g.members || []).some((m) => m && m.status !== 'pending'
        && /^(leader|chair|co-chair)$/i.test(String(m.role || ''))
        && ((e && String(m.email || '').toLowerCase() === e) || (mid && m.memberId === mid)));
    });
  } catch { return []; }
}

// The identities a member can post an event "as" (per Diana/Felicia, Jul 15 —
// this replaces the old two-logins setup: one login, but a chair chooses
// whether an event is on behalf of their BUSINESS or a GROUP they lead).
// First entry is the default. Business (if they have a listing) leads, then
// each group they manage.
async function postingIdentities(user) {
  const out = [];
  const m = await myMember(user.mid);
  if (m) out.push({ key: 'business', kind: 'business', name: m.name, memberId: m.id });
  for (const g of await groupsLedBy(user)) out.push({ key: g.slug, kind: 'group', name: g.name, slug: g.slug });
  return out;
}

router.get('/me/is-leader', auth.requireAuth(), async (req, res) => {
  try {
    const m = await myMember(req.user.mid); const g = await groupsLedBy(req.user);
    res.json({ leader: memberIsLeader(m) || g.length > 0, canSubmit: !!req.user.mid, name: m ? m.name : null, groups: g.map((x) => x.name), identities: await postingIdentities(req.user) });
  } catch (e) { res.json({ leader: false }); }
});

router.get('/me/events', auth.requireAuth(), async (req, res) => {
  try {
    const mid = req.user.mid;
    const mine = (await loadEvents()).filter((e) => e.submittedBy && e.submittedBy === mid)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const identities = await postingIdentities(req.user);
    // canSubmit = any member with a listing may add an event. isLeader drives
    // the "posting as" chooser; instantPublish tells the form whether leader
    // events skip the office queue (the Diana switch, Aug 20 2026).
    let leaderInstant = false;
    try { leaderInstant = (await repo.getSetting('leaderInstantPublish')) === 'on'; } catch (e) {}
    res.json({ events: mine, canSubmit: !!mid, isLeader: memberIsLeader(await myMember(mid)) || identities.some((i) => i.kind === 'group'), instantPublish: leaderInstant, identities });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

// The Diana switch (Aug 20 2026): do group-leader events publish instantly,
// or wait in "Needs publish" like everyone else's? Office-controlled from the
// admin Events page. Default OFF — approval required.
router.get('/admin/event-settings', requireAdmin, async (_req, res) => {
  try { res.json({ ok: true, leaderInstantPublish: (await repo.getSetting('leaderInstantPublish')) === 'on' }); }
  catch (e) { res.json({ ok: true, leaderInstantPublish: false }); }
});
router.post('/admin/event-settings', requireAdmin, async (req, res) => {
  try {
    await repo.setSetting('leaderInstantPublish', req.body && req.body.leaderInstantPublish ? 'on' : 'off');
    res.json({ ok: true, leaderInstantPublish: !!(req.body && req.body.leaderInstantPublish) });
  } catch (e) { res.status(500).json({ error: 'could not save' }); }
});

router.post('/me/event', auth.requireAuth(), async (req, res) => {
  const mid = req.user.mid;
  if (!mid) return res.status(400).json({ error: 'No member listing is linked to this account.' });
  const member = await myMember(mid);
  const lead = await groupsLedBy(req.user);
  const b = req.body || {};
  if (!b.title || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) {
    return res.status(400).json({ error: 'An event title and a valid date are required.' });
  }
  // ANY member with a listing can submit an event (matching the old site, per
  // the office, Jul 16). Whether group leaders/board publish IMMEDIATELY is an
  // office switch: Diana (Aug 20 2026, via Felicia) wants leader events
  // approved before publishing, reversing the office's own Jul 16 preference —
  // so it's a setting, default OFF, instead of another code flip-flop.
  // Everyone else always goes to the "Needs publish" queue.
  const isLeaderSubmitter = memberIsLeader(member) || lead.length > 0;
  let leaderInstant = false;
  try { leaderInstant = (await repo.getSetting('leaderInstantPublish')) === 'on'; } catch (e) {}
  const immediate = isLeaderSubmitter && leaderInstant;
  // Which identity are they posting as (their business, or a group they lead)?
  // Only identities they actually hold are accepted; default = business first,
  // else their first group (per Diana/Felicia, Jul 15).
  const identities = await postingIdentities(req.user);
  const host = identities.find((i) => i.key === b.postAs)
    || identities.find((i) => i.kind === 'business') || identities[0] || null;
  const base = {
    title: b.title, time: b.time, endTime: b.endTime, venue: b.venue, address: b.address,
    neighborhood: b.neighborhood, category: b.category || 'Community',
    description: b.description, summary: b.summary, flyer: b.flyer, thumbnail: b.thumbnail,
    // Always date-confirmed (a valid date is required above); `status` is the
    // public gate, not `confirmed`. A regular member's event sits as 'pending'
    // (hidden) until the office publishes it — and because it's already
    // confirmed, publishing makes it show on the calendar instead of staying
    // hidden (the bug Felicia hit: published events not populating).
    confirmed: true, status: immediate ? 'approved' : 'pending', showOnCalendar: true,
    // Action button (Felicia, Aug 12 2026): a member event starts with NO
    // button — the ribbon-cutting host published a default RSVP button that
    // collected nothing. The poster opts into RSVP and names the address the
    // RSVPs are emailed to (the box the old site opened). Ticket sales are
    // still set up by the office, so RSVP is the only opt-in here.
    hideCta: b.actionButton !== 'rsvp',
    rsvpEmail: b.actionButton === 'rsvp' ? b.rsvpEmail : '',
  };
  // Recurrence. Either an explicit, member-confirmed list of dates (the
  // monthly "first Monday of the next N months" wizard sends exactly the dates
  // the leader checked — Felicia call, Aug 19 2026), or the older weekly
  // repeat: one event per week through `until` (cap 52).
  let dates = [];
  if (Array.isArray(b.dates) && b.dates.length) {
    dates = [...new Set(b.dates.slice(0, 24).map((s) => String(s || '')).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)))].sort();
  } else if (b.recurrence === 'weekly' && /^\d{4}-\d{2}-\d{2}$/.test(String(b.until || ''))) {
    let cur = new Date(b.date + 'T12:00:00'); const until = new Date(b.until + 'T12:00:00'); let guard = 0;
    while (cur <= until && guard < 52) { dates.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 7); guard++; }
  }
  if (!dates.length) dates.push(b.date);
  const seriesId = dates.length > 1 ? ('ser-' + Date.now().toString(36)) : null;
  try {
    const ids = [];
    for (const dt of dates) {
      const ev = buildEvent({ ...base, date: dt }, {});
      ev.submittedBy = mid; ev.submittedByName = (member && member.name) || (lead[0] && lead[0].manager && lead[0].manager.name) || ''; ev.source = 'member';
      // Attribution from the chosen identity — a group they lead, or their own
      // business. hostName/hostSlug drive the public "Hosted by" line; groupSlug
      // also lands the event on that group's page.
      if (host && host.kind === 'group') {
        ev.hostKind = 'group'; ev.hostName = host.name; ev.hostSlug = host.slug;
        ev.groupName = host.name; ev.groupSlug = host.slug;
      } else if (host) {
        ev.hostKind = 'business'; ev.hostName = host.name; ev.hostSlug = '';
        ev.groupName = ''; ev.groupSlug = '';
      }
      if (seriesId) ev.seriesId = seriesId;
      await repo.upsertEvent(ev); ids.push(ev.id);
    }
    res.json({ ok: true, count: ids.length, seriesId, published: immediate });
  } catch (e) { console.error('me/event', e); res.status(500).json({ error: 'Could not add the event. Please try again.' }); }
});

// Can this login touch this event? Their own submission — or any event that
// belongs to a group they lead, however it got there (posted by the office,
// imported from the old site, or added by another leader). That is exactly
// Felicia's Aug 19 ask: leaders manage their group's postings, not just the
// ones they personally typed in.
async function canManageEvent(user, ev) {
  if (!ev) return false;
  if (user.mid && ev.submittedBy === user.mid) return true;
  if (!ev.groupSlug) return false;
  return (await groupsLedBy(user)).some((g) => g.slug === ev.groupSlug);
}

router.get('/me/event/:id', auth.requireAuth(), async (req, res) => {
  try {
    const ev = (await loadEvents()).find((e) => e.id === req.params.id);
    if (!(await canManageEvent(req.user, ev))) return res.status(404).json({ error: 'Event not found.' });
    // Only the plain fields the member form edits — never ticketing/admin state.
    const { id, title, date, time, endTime, venue, address, category, description,
      summary, flyer, hideCta, rsvpEmail, status, seriesId, groupSlug, groupName, hostKind, hostName } = ev;
    res.json({ ok: true, event: { id, title, date, time, endTime, venue, address, category, description: description || '', summary: summary || '', flyer: flyer || '', hideCta: !!hideCta, rsvpEmail: rsvpEmail || '', status, seriesId: seriesId || null, groupSlug: groupSlug || '', groupName: groupName || '', hostKind: hostKind || '', hostName: hostName || '' } });
  } catch (e) { console.error('me/event get', e); res.status(500).json({ error: 'Could not load the event.' }); }
});

// Edit an event (Felicia, Aug 19 2026 — the old site had Edit next to Delete;
// here leaders could only remove and re-type). A leader's edit goes straight
// to the live calendar; a regular member's goes back through office review,
// the same way an edited post does.
router.patch('/me/event/:id', auth.requireAuth(), async (req, res) => {
  const b = req.body || {};
  try {
    const all = await loadEvents();
    const ev = all.find((e) => e.id === req.params.id);
    if (!(await canManageEvent(req.user, ev))) return res.status(404).json({ error: 'Event not found.' });
    if (b.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) {
      return res.status(400).json({ error: 'Use a valid date (YYYY-MM-DD).' });
    }
    if (b.title !== undefined && !String(b.title).trim()) {
      return res.status(400).json({ error: 'The event needs a title.' });
    }
    // Only the plain details the member form carries — ticketing, images,
    // featured placement, and everything else admin-side stays exactly put.
    const patch = {};
    for (const k of ['title', 'date', 'time', 'endTime', 'venue', 'address', 'category', 'description', 'summary', 'flyer']) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    // RSVP button opt-in/out follows the same rules as posting (Aug 12 2026) —
    // but never on a ticketed event, whose buttons the office controls.
    if (b.actionButton !== undefined && !ev.ticketed) {
      patch.hideCta = b.actionButton !== 'rsvp';
      patch.rsvpEmail = b.actionButton === 'rsvp' ? (b.rsvpEmail || ev.rsvpEmail || '') : '';
    }
    const leaderNow = memberIsLeader(await myMember(req.user.mid)) || (await groupsLedBy(req.user)).length > 0;
    if (!leaderNow) patch.status = 'pending';
    const next = buildEvent(patch, ev);
    await repo.upsertEvent(next);
    res.json({ ok: true, published: next.status === 'approved' });
  } catch (e) { console.error('me/event patch', e); res.status(500).json({ error: 'Could not save the event.' }); }
});

router.delete('/me/event/:id', auth.requireAuth(), async (req, res) => {
  const mid = req.user.mid;
  try {
    const all = await loadEvents();
    const ev = all.find((e) => e.id === req.params.id);
    if (!(await canManageEvent(req.user, ev))) return res.status(404).json({ error: 'Event not found.' });
    const own = mid && ev.submittedBy === mid;
    // A series comes off together — scoped to what this login controls (their
    // own submissions, or their group's dates when acting as its leader).
    const toDelete = ev.seriesId
      ? all.filter((e) => e.seriesId === ev.seriesId && (own ? e.submittedBy === mid : e.groupSlug === ev.groupSlug))
      : [ev];
    for (const e of toDelete) await repo.deleteEvent(e.id);
    res.json({ ok: true, deleted: toDelete.length });
  } catch (e) { console.error('me/event delete', e); res.status(500).json({ error: 'Could not remove the event.' }); }
});

/* ── Group management for leaders (Felicia call, Aug 19 2026) ──
   "They were able to log into their group profile and see the events they have
   posted… edit, delete." One page per group: its upcoming events (with the
   RSVPs), the roster with join requests to approve, and add-a-member — the
   same jobs the office does in Admin → Groups, scoped to the one group this
   login leads. */

// Which events belong to a group — the same match the public group page uses:
// a groupSlug tag when a leader posted "as the group", else the group's
// eventMatch text appearing in the title or category (imported meetings).
function eventsOfGroup(g, evs) {
  const mm = String(g.eventMatch || '').toLowerCase();
  return evs.filter((e) => e.groupSlug === g.slug
    || (mm && ((e.title || '').toLowerCase().includes(mm) || (e.category || '').toLowerCase().includes(mm))));
}

// RSVP leads for one event. Recent leads carry the event id in brackets
// ("Summer Mixer (2026-08-26) [ev-x1]") — exact. Older, title-only leads fall
// back to title (+ the bracketed date when there is one), so a monthly series
// never soaks up every same-titled RSVP.
function rsvpsForEvent(ev, rsvpLeads) {
  const id = String(ev.id).toLowerCase();
  const title = String(ev.title || '').toLowerCase().slice(0, 40);
  return rsvpLeads.filter((l) => {
    const le = String(l.event || '').toLowerCase();
    if (!le) return false;
    const br = /\[((?:le|ev|ce)-[a-z0-9]+)\]/.exec(le);
    if (br) return br[1] === id;
    if (le === id) return true;
    if (!title || !le.includes(title)) return false;
    const d = /\((\d{4}-\d{2}-\d{2})\)/.exec(le);
    return d ? d[1] === ev.date : true;
  });
}
// Head count for one RSVP — the public form writes "Attending: N" into the
// message; a lead without it is one person.
const rsvpQty = (l) => { const m = /attending:\s*(\d+)/i.exec(String(l.message || '')); return m ? Math.max(1, Math.min(50, parseInt(m[1], 10))) : 1; };

/* ── Welcome-to-the-group email (Michael, Aug 20 2026) ──
   Anyone ADDED to a group's roster — approved from a join request, picked
   from the directory, or typed in by hand — gets one email saying what the
   group is, when it meets, and what they can do now (the group page, RSVPs,
   photo albums, their member portal). Fires on every roster write path
   (admin full save, admin roster-only save, leader save), diffing
   before/after so role edits and removals never email anyone. */
async function notifyNewGroupMembers(beforeMembers, g, req) {
  try {
    const wasActive = new Set((beforeMembers || [])
      .filter((m) => m && m.status !== 'pending').map((m) => m.id));
    const fresh = (g.members || []).filter((m) => m && m.status !== 'pending' && !wasActive.has(m.id));
    if (!fresh.length) return { welcomed: 0, noEmail: 0 };
    const skipped = [];
    const { members: dir } = await loadMembersFull();
    const emailById = new Map(dir.filter((m) => m.email).map((m) => [m.id, m.email]));
    const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    const groupUrl = `${base}/groups/${g.slug}`;
    const mgrName = (g.manager && g.manager.name) || 'the group leader';
    const replyTo = (g.manager && g.manager.email) || undefined;
    const eh = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const seen = new Set();
    for (const m of fresh) {
      const addr = String(m.email || emailById.get(m.memberId) || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) { skipped.push(m.name || '(unnamed)'); continue; }
      if (seen.has(addr)) continue;
      seen.add(addr);
      const first = String(m.name || '').trim().split(/\s+/)[0] || 'there';
      const meets = g.meetingSchedule ? `The group meets ${g.meetingSchedule}.` : '';
      const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:560px;border:1px solid #ccc;padding:20px 24px">
        <img src="https://woodlandhillscc.net/images/wvwccc-logo.png" alt="WVWC Chamber of Commerce" width="72" style="display:block;margin:0 0 12px">
        <p style="color:#188038;font-weight:bold;margin:0">WELCOME TO ${eh(String(g.name).toUpperCase())}</p>
        <p style="margin:12px 0 0">Hi ${eh(first)},</p>
        <p style="margin:10px 0 0">You've been added to <strong>${eh(g.name)}</strong>, a West Valley &middot; Warner Center Chamber group.${meets ? ' ' + eh(meets) : ''}</p>
        <p style="font-weight:bold;text-decoration:underline;margin:16px 0 6px">WHAT YOU CAN DO</p>
        <table style="border-collapse:collapse;font-size:14px">
          <tr><td style="padding:3px 10px 3px 0;vertical-align:top">&#128197;</td><td style="padding:3px 0"><strong>See the meetings.</strong> Every upcoming meeting and event is on <a href="${groupUrl}" style="color:#1E5631">the group's page</a> — open any event to RSVP or add it to your calendar.</td></tr>
          <tr><td style="padding:3px 10px 3px 0;vertical-align:top">&#128248;</td><td style="padding:3px 0"><strong>Share photos.</strong> The group's photo albums live on the same page — sign in and add your own shots from a meeting.</td></tr>
          <tr><td style="padding:3px 10px 3px 0;vertical-align:top">&#127963;</td><td style="padding:3px 0"><strong>Use your member portal.</strong> Sign in at <a href="${base}/auth/member-login.html" style="color:#1E5631">woodlandhillscc.net</a> with this email address — no password yet? Choose "Email me a sign-in link".</td></tr>
        </table>
        <p style="margin:16px 0 0">Questions about the group? Just reply to this email${replyTo ? ` — it goes to ${eh(mgrName)}` : ''} — or call the Chamber office at (818)&nbsp;347-4737.</p>
        <p style="margin:14px 0 0;color:#666;font-size:12px">West Valley &middot; Warner Center Chamber of Commerce &middot; <a href="${groupUrl}" style="color:#666">${groupUrl.replace(/^https?:\/\//, '')}</a></p>
      </div>`;
      const text = `Hi ${first},\n\nYou've been added to ${g.name}, a West Valley · Warner Center Chamber group.${meets ? ' ' + meets : ''}\n\nWHAT YOU CAN DO\n`
        + `• See the meetings — every upcoming meeting and event is on the group's page: ${groupUrl} — open any event to RSVP or add it to your calendar.\n`
        + `• Share photos — the group's photo albums live on the same page; sign in and add your own shots from a meeting.\n`
        + `• Use your member portal — sign in at ${base}/auth/member-login.html with this email address. No password yet? Choose "Email me a sign-in link".\n\n`
        + `Questions about the group? Just reply to this email${replyTo ? ` — it goes to ${mgrName}` : ''} — or call the Chamber office at (818) 347-4737.\n\n—\nWest Valley · Warner Center Chamber of Commerce\n${groupUrl}\n`;
      email.send({ to: addr, replyTo, subject: `Welcome to ${g.name}!`, text, html })
        .then((r) => { if (r && (r.skipped || r.ok === false)) console.error('group welcome email not sent', addr, r.error || 'mailer not configured'); });
    }
    // Callers surface this so a leader is never left believing "everyone gets
    // a welcome email" when someone had no address on file (Aug 20 2026 review).
    if (skipped.length) console.warn(`group welcome email: no address on file for ${skipped.join(', ')} (${g.slug})`);
    return { welcomed: seen.size, noEmail: skipped.length };
  } catch (e) { console.error('group welcome email', e); return { welcomed: 0, noEmail: 0 }; }
}

// Resolve :slug to a group the caller leads — or answer 404/403 and return null.
async function ledGroupOr403(req, res) {
  const g = (await loadGroups()).find((x) => x.slug === req.params.slug || x.id === req.params.slug);
  if (!g) { res.status(404).json({ error: 'That group no longer exists.' }); return null; }
  const led = await groupsLedBy(req.user);
  if (!led.some((x) => x.id === g.id)) { res.status(403).json({ error: 'You are not a leader of this group.' }); return null; }
  return g;
}

// The groups this login leads — drives the "Groups you lead" card on the
// member dashboard, so management sits at the very top at login.
router.get('/me/my-groups', auth.requireAuth(), async (req, res) => {
  try {
    const led = await groupsLedBy(req.user);
    res.json({ ok: true, groups: led.map((g) => ({
      slug: g.slug, name: g.name,
      memberCount: (g.members || []).filter((m) => m.status !== 'pending').length,
      pendingCount: (g.members || []).filter((m) => m.status === 'pending').length,
    })) });
  } catch (e) { res.json({ ok: true, groups: [] }); }
});

// Everything the management page needs in one call: the group, its roster
// (join requests included), its upcoming events, and each event's RSVPs.
router.get('/me/group/:slug', auth.requireAuth(), async (req, res) => {
  try {
    const g = await ledGroupOr403(req, res); if (!g) return;
    const today = new Date().toISOString().slice(0, 10);
    const all = await loadEvents();
    const mine = eventsOfGroup(g, all)
      .filter((e) => (e.date && e.date >= today) || e.status === 'pending')
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
      .slice(0, 30);
    let rsvpLeads = [];
    try { rsvpLeads = (await repo.listLeads()).filter((l) => l.kind === 'rsvp' && l.status !== 'spam'); } catch (e) {}
    const rsvps = {};
    const events = mine.map((e) => {
      const list = rsvpsForEvent(e, rsvpLeads).map((l) => ({
        name: l.name || '', company: l.company || '', email: l.email || '', phone: l.phone || '',
        qty: rsvpQty(l), received: l.received || '',
      }));
      if (list.length) rsvps[e.id] = list;
      return {
        id: e.id, title: e.title, date: e.date, time: e.time || '', endTime: e.endTime || '',
        venue: e.venue || '', address: e.address || '', status: e.status, seriesId: e.seriesId || null,
        groupSlug: e.groupSlug || '', hostName: e.hostName || '', flyer: e.flyer || '',
        hideCta: !!e.hideCta, ticketed: !!e.ticketed, rsvpEmail: e.rsvpEmail || '',
        rsvpCount: list.length, rsvpAttending: list.reduce((t, r) => t + r.qty, 0),
      };
    });
    res.json({ ok: true,
      group: {
        id: g.id, slug: g.slug, name: g.name, tagline: g.tagline || '',
        meetingSchedule: g.meetingSchedule || '', meetingNotes: g.meetingNotes || '',
        heroImage: g.heroImage || '',
        manager: { name: (g.manager && g.manager.name) || '', email: (g.manager && g.manager.email) || '' },
        members: g.members || [],
      },
      events, rsvps });
  } catch (e) { console.error('me/group', e); res.status(500).json({ error: 'Could not load the group.' }); }
});

// Roster save for a leader — approve/decline join requests, add from the
// directory or by hand, change roles, remove. Writes ONLY `members`, exactly
// like the admin roster-only save, so nothing else about the group can move.
router.post('/me/group/:slug/members', auth.requireAuth(), async (req, res) => {
  try {
    const g = await ledGroupOr403(req, res); if (!g) return;
    const before = (g.members || []).slice();
    const next = buildGroup({ ...g, members: Array.isArray(req.body && req.body.members) ? req.body.members : [] }, g);
    await repo.upsertGroup(next);
    const welcome = await notifyNewGroupMembers(before, next, req);
    res.json({ ok: true, members: next.members || [], welcome });
  } catch (e) { console.error('me group members', e); res.status(500).json({ error: 'Could not save the roster.' }); }
});

// Leader edits to the group page itself — meeting notes and the meeting
// schedule line (Michael, Aug 20 2026: "a place for meeting notes"). Nothing
// else about the group is writable from the portal.
router.patch('/me/group/:slug', auth.requireAuth(), async (req, res) => {
  try {
    const g = await ledGroupOr403(req, res); if (!g) return;
    const b = req.body || {};
    const patch = {};
    if (b.meetingNotes !== undefined) patch.meetingNotes = String(b.meetingNotes).slice(0, 12000);
    if (b.meetingSchedule !== undefined) patch.meetingSchedule = String(b.meetingSchedule).slice(0, 200);
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to save.' });
    const next = buildGroup({ ...g, ...patch }, g);
    await repo.upsertGroup(next);
    res.json({ ok: true, group: { meetingNotes: next.meetingNotes, meetingSchedule: next.meetingSchedule } });
  } catch (e) { console.error('me group patch', e); res.status(500).json({ error: 'Could not save.' }); }
});

// 📷 A leader creates a photo album for their group (Michael, Aug 20 2026 —
// "photo galleries of meetings and from members"). The album is tagged with
// the group's slug so it shows on the group page, and it starts UNLOCKED so
// any signed-in member can add their own shots from the album page.
router.post('/me/group/:slug/albums', auth.requireAuth(), async (req, res) => {
  try {
    const g = await ledGroupOr403(req, res); if (!g) return;
    const title = String((req.body && req.body.title) || '').trim().slice(0, 120);
    if (!title) return res.status(400).json({ error: 'Give the album a title — the meeting or event it covers.' });
    const bad = flagContent(title + ' ' + String((req.body && req.body.body) || ''));
    if (bad) return res.status(400).json({ error: bad });
    let who = req.user.name || req.user.sub;
    try { who = (await loadMembersFull()).members.find((m) => m.id === req.user.mid)?.name || who; } catch (e) {}
    const id = 'alb-' + Date.now().toString(36);
    const album = await saveAlbum(id, {
      title,
      body: String((req.body && req.body.body) || '').slice(0, 2000),
      groupSlug: g.slug,
      locked: false,
      authorName: who,
    }, null);
    res.json({ ok: true, album: albumOut(album, false) });
  } catch (e) { console.error('me group album', e); res.status(500).json({ error: 'Could not create the album.' }); }
});

// 📣 A leader emails their own group — same machinery as the admin announce.
router.post('/me/group/:slug/announce', auth.requireAuth(), async (req, res) => {
  const subject = String((req.body && req.body.subject) || '').trim().slice(0, 160);
  const message = String((req.body && req.body.message) || '').trim().slice(0, 5000);
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required.' });
  try {
    const g = await ledGroupOr403(req, res); if (!g) return;
    res.json({ ok: true, ...(await sendGroupAnnouncement(g, subject, message, req)) });
  } catch (e) { console.error('me group announce', e); res.status(500).json({ error: 'could not send' }); }
});

// Image upload (data URL) → stored in Postgres, served at /api/assets/:id.
router.post('/me/asset', auth.requireAuth(), async (req, res) => {
  const b = req.body || {};
  // Images (logos/photos/flyers/thumbnails), PDFs (event documents), and audio
  // (album slideshow soundtracks — Aug 5 2026).
  const m = /^data:(image\/(?:png|jpe?g|gif|webp)|application\/pdf|audio\/(?:mpeg|mp3|mp4|ogg|wav|x-m4a|aac));base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl || '');
  if (!m) return res.status(400).json({ error: 'Provide a PNG, JPG, GIF, or WebP image, a PDF, or an MP3/M4A audio file.' });
  const mime = m[1];
  const buffer = Buffer.from(m[2], 'base64');
  const isAudio = mime.startsWith('audio/');
  const limit = mime === 'application/pdf' ? 20_000_000 : (isAudio ? 15_000_000 : 2_500_000);
  if (buffer.length > limit) {
    return res.status(413).json({
      error: mime === 'application/pdf' ? 'PDF too large (max ~20MB). Please compress/optimize the PDF and try again.'
        : isAudio ? 'Audio too large (max ~15MB). A 3–4 minute MP3 at 128kbps is about 3MB.'
        : 'Image too large (max ~2.5MB).',
    });
  }
  const kind = mime === 'application/pdf' ? 'doc' : (isAudio ? 'audio' : (b.kind === 'logo' ? 'logo' : 'photo'));
  const id = 'asset-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  try {
    // The original filename becomes the library name so the gallery is
    // searchable from day one instead of a wall of unlabelled thumbnails.
    await repo.addAsset({
      id, memberId: req.user.mid || null, kind, mime, buffer,
      name: String(b.name || '').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 160),
      tags: String(b.tags || '').slice(0, 300),
    });
    res.json({ ok: true, id, url: '/api/assets/' + id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'upload failed' }); }
});

router.get('/assets/:id', async (req, res) => {
  try {
    const a = await repo.getAsset(req.params.id);
    if (!a) return res.status(404).end();
    res.type(a.mime).set('Cache-Control', 'public, max-age=86400').send(a.buffer);
  } catch (e) { res.status(500).end(); }
});

// ── Image Library (Felicia, Jul 29 2026) ────────────────────
// "Is there a gallery now in the back end?" — every image the office has ever
// uploaded, browsable and reusable, so a council-member headshot or a sponsor
// logo gets uploaded once and picked from a list forever after.
router.get('/admin/assets', requireAdmin, async (req, res) => {
  try {
    const rows = await repo.listAssets({
      q: String(req.query.q || '').trim().slice(0, 80),
      kind: ['logo', 'photo', 'headshot', 'doc'].includes(req.query.kind) ? req.query.kind : '',
      limit: +req.query.limit || 500,
      includeArchived: req.query.archived === '1',
    });
    res.json({ ok: true, assets: rows });
  } catch (e) { console.error('admin/assets', e); res.status(500).json({ error: 'Could not load the image library.' }); }
});

// A member's own uploads — lets the member portal reuse the same picker.
router.get('/me/assets', auth.requireAuth(), async (req, res) => {
  if (!req.user.mid) return res.json({ ok: true, assets: [] });
  try {
    res.json({ ok: true, assets: await repo.listAssets({ memberId: req.user.mid, limit: 200 }) });
  } catch (e) { res.status(500).json({ error: 'Could not load your images.' }); }
});

router.patch('/admin/assets/:id', requireAdmin, async (req, res) => {
  const b = req.body || {};
  try {
    await repo.updateAsset(req.params.id, {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.tags !== undefined ? { tags: b.tags } : {}),
      ...(b.kind !== undefined ? { kind: b.kind } : {}),
      ...(b.archived !== undefined ? { archived: b.archived } : {}),
    });
    res.json({ ok: true });
  } catch (e) { console.error('patch asset', e); res.status(500).json({ error: 'Could not save that change.' }); }
});

// Where is this image actually used? Checked before a delete so the office
// can't silently blank a live event flyer or a member logo.
async function assetUsage(id) {
  const url = '/api/assets/' + id;
  const hits = [];
  const scan = (val, where) => {
    if (!val) return;
    if (typeof val === 'string') { if (val.includes(url)) hits.push(where); return; }
    if (Array.isArray(val)) { val.forEach((v) => scan(v, where)); return; }
    if (typeof val === 'object') { Object.values(val).forEach((v) => scan(v, where)); }
  };
  try {
    for (const ev of await repo.listEventsStore()) scan(ev, `Event — ${ev.title || ev.id}`);
  } catch (_) {}
  try {
    const edits = await repo.getMemberEdits();
    for (const [mid, d] of Object.entries(edits)) scan(d, `Member profile ${mid}`);
  } catch (_) {}
  try {
    const ov = await repo.getOverrides();
    for (const [mid, d] of Object.entries(ov)) scan(d, `Member record ${mid}`);
  } catch (_) {}
  try {
    for (const g of await repo.listGroupsStore()) scan(g, `Group — ${g.name || g.id}`);
  } catch (_) {}
  try {
    for (const p of await repo.listPosts({})) scan(p, `Post — ${p.title || p.id}`);
  } catch (_) {}
  try { scan(await repo.getSetting('homePopup'), 'Homepage popup'); } catch (_) {}
  try { scan(await repo.getSetting('slides'), 'Homepage slides'); } catch (_) {}
  return [...new Set(hits)];
}

router.get('/admin/assets/:id/usage', requireAdmin, async (req, res) => {
  try { res.json({ ok: true, usedIn: await assetUsage(req.params.id) }); }
  catch (e) { res.status(500).json({ error: 'Could not check where this image is used.' }); }
});

router.delete('/admin/assets/:id', requireAdmin, async (req, res) => {
  try {
    const usedIn = await assetUsage(req.params.id);
    // Deleting an in-use image would leave broken images on the live site, so
    // it takes a deliberate second step (?force=1) after seeing the list.
    if (usedIn.length && req.query.force !== '1') {
      return res.status(409).json({ error: 'This image is still in use.', usedIn });
    }
    await repo.deleteAsset(req.params.id);
    res.json({ ok: true, usedIn });
  } catch (e) { console.error('delete asset', e); res.status(500).json({ error: 'Could not delete that image.' }); }
});

// ── Admin tools: QR codes + AI image creation (per Diana, Jul 24 2026) ──
// QR codes render server-side (qrcode npm) so admin pages need no client
// library. Returns a PNG data URL (preview / attach to an event) and an SVG
// (crisp at any print size).
router.get('/admin/tools/qr', requireAdmin, async (req, res) => {
  const data = String(req.query.data || '').slice(0, 1500);
  if (!data) return res.status(400).json({ error: 'data (the link to encode) is required' });
  try {
    const opts = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#12241a', light: '#ffffff' } };
    const png = await QRCode.toDataURL(data, { ...opts, width: 1024 });
    const svg = await QRCode.toString(data, { ...opts, type: 'svg' });
    res.json({ ok: true, png, svg });
  } catch (e) { console.error('qr', e); res.status(500).json({ error: 'Could not create the QR code.' }); }
});

// AI images via the Higgsfield platform (text-to-image, Soul model).
// Auth = `Key <key>:<secret>` header; submit returns a request_id, results are
// fetched from /requests/<id>/status. Needs HIGGSFIELD_API_KEY +
// HIGGSFIELD_API_SECRET set in the Render dashboard (see render.yaml).
const HF_BASE = 'https://platform.higgsfield.ai';
const HF_MODEL = process.env.HIGGSFIELD_MODEL || 'higgsfield-ai/soul/standard';
const HF_ASPECTS = ['1:1', '3:4', '4:3', '16:9', '9:16'];
const hfAuth = () => (process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_SECRET
  ? `Key ${process.env.HIGGSFIELD_API_KEY}:${process.env.HIGGSFIELD_API_SECRET}` : null);
const _hfIngested = new Map(); // request_id → stored asset url (re-polls stay idempotent)

router.post('/admin/tools/image', requireAdmin, async (req, res) => {
  const authz = hfAuth();
  if (!authz) return res.status(503).json({ error: 'Image creation is not configured yet — add HIGGSFIELD_API_KEY and HIGGSFIELD_API_SECRET on Render, then redeploy.' });
  const prompt = String((req.body || {}).prompt || '').trim().slice(0, 2000);
  if (!prompt) return res.status(400).json({ error: 'Describe the image you want.' });
  const aspect = HF_ASPECTS.includes((req.body || {}).aspect) ? req.body.aspect : '3:4';
  try {
    const r = await fetch(`${HF_BASE}/${HF_MODEL}`, {
      method: 'POST',
      headers: { Authorization: authz, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ prompt, aspect_ratio: aspect, resolution: '720p' }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out.request_id) {
      console.error('higgsfield submit', r.status, JSON.stringify(out).slice(0, 400));
      const raw = String(out.detail || out.error || '');
      const friendly = /not_enough_credits|insufficient/i.test(raw + JSON.stringify(out))
        ? 'The image account is out of credits — ask Michael to top up Higgsfield API credits, then try again.'
        : (raw || `The image service returned an error (${r.status}).`);
      return res.status(502).json({ error: friendly });
    }
    res.json({ ok: true, requestId: out.request_id });
  } catch (e) { console.error('higgsfield submit', e); res.status(502).json({ error: 'Could not reach the image service.' }); }
});

// Poll a generation. When it completes we pull the image into our own asset
// store (repo.addAsset) so the URL never expires — Higgsfield result links are
// temporary.
router.get('/admin/tools/image/:id', requireAdmin, async (req, res) => {
  const authz = hfAuth();
  if (!authz) return res.status(503).json({ error: 'Image creation is not configured.' });
  const id = String(req.params.id).slice(0, 80);
  if (_hfIngested.has(id)) return res.json({ ok: true, status: 'completed', url: _hfIngested.get(id) });
  try {
    const r = await fetch(`${HF_BASE}/requests/${encodeURIComponent(id)}/status`, { headers: { Authorization: authz, Accept: 'application/json' } });
    const out = await r.json().catch(() => ({}));
    const status = out.status || 'failed';
    if (status === 'failed' || status === 'nsfw') {
      return res.json({ ok: false, status, error: status === 'nsfw' ? 'The image was blocked by the content filter — try rewording the prompt.' : 'The image could not be generated — please try again.' });
    }
    if (status !== 'completed') return res.json({ ok: true, status }); // queued / in_progress
    const remote = out.images && out.images[0] && out.images[0].url;
    if (!remote) return res.json({ ok: false, status: 'failed', error: 'No image was returned.' });
    const img = await fetch(remote);
    const buffer = Buffer.from(await img.arrayBuffer());
    if (!img.ok || !buffer.length || buffer.length > 12_000_000) return res.json({ ok: false, status: 'failed', error: 'Could not download the finished image.' });
    const mime = (img.headers.get('content-type') || 'image/jpeg').split(';')[0];
    const assetId = 'asset-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    await repo.addAsset({ id: assetId, memberId: null, kind: 'photo', mime, buffer });
    const url = '/api/assets/' + assetId;
    _hfIngested.set(id, url);
    if (_hfIngested.size > 200) _hfIngested.delete(_hfIngested.keys().next().value);
    res.json({ ok: true, status: 'completed', url });
  } catch (e) { console.error('higgsfield poll', e); res.status(502).json({ error: 'Could not check on the image.' }); }
});

// Public posts feed (approved, not expired).
router.get('/posts', async (req, res) => {
  const type = ['discount', 'member_post', 'news', 'announcement', 'gallery', 'job', 'listing', 'newsletter'].includes(req.query.type) ? req.query.type : undefined;
  try {
    const now = Date.now();
    const posts = (await repo.listPosts({ type, status: 'approved' }))
      .filter((p) => !p.expiresAt || new Date(p.expiresAt).getTime() > now);
    res.json({ posts });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

// ── Link preview (Open Graph unfurl) ────────────────────────
// Fetches a URL and extracts og:image / title / description so the news feed
// can show rich preview cards for posts that link out. SSRF-guarded (http(s)
// only, private ranges blocked), size- and time-capped, cached in memory.
const _ogCache = new Map(); // url -> { data, exp }
const OG_TTL = 6 * 60 * 60 * 1000;
function isBlockedHost(host) {
  const h = (host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return true;
    if (a === 169 && b === 254) return true;          // link-local / cloud metadata
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  return false;
}
function metaTag(html, names) {
  for (const name of names) {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>', 'i');
    const tag = re.exec(html);
    if (tag) {
      const c = /content=["\']([^"\']*)["\']/i.exec(tag[0]);
      if (c && c[1]) return c[1].trim();
    }
  }
  return '';
}
const decodeEntities = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ');

router.get('/link-preview', async (req, res) => {
  let target;
  try { target = new URL(String(req.query.url || '')); } catch { return res.status(400).json({ error: 'bad url' }); }
  if (!/^https?:$/.test(target.protocol) || isBlockedHost(target.hostname)) {
    return res.status(400).json({ error: 'url not allowed' });
  }
  const key = target.href;
  const hit = _ogCache.get(key);
  if (hit && hit.exp > Date.now()) return res.json(hit.data);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(key, {
      redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': 'WVWCCC-LinkPreview/1.0 (+https://woodlandhillscc.net)', Accept: 'text/html,*/*' },
    }).finally(() => clearTimeout(timer));
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !/text\/html|application\/xhtml/i.test(ct)) {
      const data = { url: key, ok: false };
      _ogCache.set(key, { data, exp: Date.now() + OG_TTL });
      return res.json(data);
    }
    // read at most ~256KB of the <head>
    const reader = r.body.getReader();
    let html = '', received = 0;
    const dec = new TextDecoder();
    while (received < 262144) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    try { await reader.cancel(); } catch {}
    const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
    let image = metaTag(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
    if (image) { try { image = new URL(image, key).href; } catch {} }
    const data = {
      url: key, ok: true,
      siteName: decodeEntities(metaTag(html, ['og:site_name'])) || target.hostname.replace(/^www\./, ''),
      title: decodeEntities(metaTag(html, ['og:title', 'twitter:title']) || (titleTag ? titleTag[1] : '')).slice(0, 200),
      description: decodeEntities(metaTag(html, ['og:description', 'twitter:description', 'description'])).slice(0, 300),
      image: image || '',
    };
    _ogCache.set(key, { data, exp: Date.now() + OG_TTL });
    res.json(data);
  } catch (e) {
    const data = { url: key, ok: false };
    _ogCache.set(key, { data, exp: Date.now() + 10 * 60 * 1000 }); // short cache on failure
    res.json(data);
  }
});

// Homepage hero slider (admin-managed). Order is set in Admin → Hero Slider and
// stored on each slide's meta.sortOrder; slides without one sort to the end.
const slideOrder = (s) => { const n = Number(s && s.meta && s.meta.sortOrder); return Number.isFinite(n) ? n : 1e9; };
router.get('/slides', async (_req, res) => {
  try {
    const slides = (await repo.listPosts({ type: 'slide', status: 'approved' })).filter((s) => s.imageUrl);
    slides.sort((a, b) => slideOrder(a) - slideOrder(b));
    res.json({ slides });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

// ── Events ──────────────────────────────────────────────────
const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function readSeedEvents() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'events.json'), 'utf8')).events || []; }
  catch { return []; }
}
async function loadEvents() {
  await ensureEventsSeeded(); // seed-if-empty + one-time flyer backfill (covers public routes too)
  const stored = await repo.listEventsStore();
  return stored.length ? stored : readSeedEvents().map((e) => buildEvent(e, e));
}
let _eventImgBackfillDone = false;
let _legacyMergeChecked = false;
let _groupMergeChecked = false;
let _galaFlyerChecked = false;
let _urbrandPhotosChecked = false;
let _confirmPublishedChecked = false;
let _galaSoldOutChecked = false;
let _mixerPricesChecked = false;
let _foodWineButtonChecked = false;
let _galaAlbumChecked = false;
let _galaPopupChecked = false;
let _circleRsvpChecked = false;
let _confirmDatedChecked = false;
async function ensureEventsSeeded() {
  if (!(await repo.hasEvents())) {
    for (const e of readSeedEvents()) await repo.upsertEvent(buildEvent(e, e));
    _eventImgBackfillDone = true;
    try { await repo.setSetting('legacyEventsMerge-20260711', 'seeded ' + new Date().toISOString()); } catch (e) {}
    return;
  }
  // One-time add-only merge of the Jul 2026 archive recovery (166 legacy
  // events) so production gets them without an admin click. The settings
  // marker means it runs exactly once — events the office deletes afterwards
  // are never resurrected by a redeploy.
  if (!_legacyMergeChecked) {
    _legacyMergeChecked = true;
    try {
      const KEY = 'legacyEventsMerge-20260711';
      if (!(await repo.getSetting(KEY))) {
        const existing = new Set((await repo.listEventsStore()).map((e) => e.id));
        let added = 0;
        for (const e of readSeedEvents()) {
          if (existing.has(e.id)) continue;
          await repo.upsertEvent(buildEvent(e, e));
          added++;
        }
        await repo.setSetting(KEY, `merged ${added} @ ${new Date().toISOString()}`);
        console.log(`[events] one-time legacy merge: added ${added} restored events`);
      }
    } catch (e) { _legacyMergeChecked = false; console.error('legacy event merge failed (will retry next boot)', e); }
  }
  // One-time (Jul 14 2026, per Diana/Susan): list YPN / DBN / Martin's Circle
  // monthly meetings (generated from each group's real meeting schedule — the
  // old site only ever listed Health & Wellness this way), and correct the
  // 20th Annual Food & Wine date to Oct 21 (the legacy backup carried Sep 16).
  if (!_groupMergeChecked) {
    _groupMergeChecked = true;
    try {
      const KEY = 'groupEventsAndFoodWine-20260714';
      if (!(await repo.getSetting(KEY))) {
        const existing = new Set((await repo.listEventsStore()).map((e) => e.id));
        let added = 0;
        for (const e of readSeedEvents()) {
          if (!String(e.id).startsWith('grp-') || existing.has(e.id)) continue;
          await repo.upsertEvent(buildEvent(e, e));
          added++;
        }
        const fw = (await repo.listEventsStore()).find((e) => e.id === 'le-11262');
        // Only touch the date if the office hasn't already fixed it themselves.
        if (fw && fw.date === '2026-09-16') await repo.upsertEvent(buildEvent({ date: '2026-10-21', confirmed: true }, fw));
        await repo.setSetting(KEY, `applied +${added} @ ${new Date().toISOString()}`);
        console.log(`[events] one-time group meetings merge: added ${added}; Food & Wine date checked`);
      }
    } catch (e) { _groupMergeChecked = false; console.error('group events merge failed (will retry next boot)', e); }
  }
  // One-time (Jul 16 2026, per Diana): point the Gala (le-11209) at the current
  // Black, White & Bold flyer, replacing the old imported image — so the event
  // page matches the homepage popup. Only runs if the office hasn't already set
  // its own flyer.
  if (!_galaFlyerChecked) {
    _galaFlyerChecked = true;
    try {
      const KEY = 'galaFlyer-20260716';
      if (!(await repo.getSetting(KEY))) {
        const g = (await repo.listEventsStore()).find((e) => e.id === 'le-11209');
        const NEW = 'assets/events/gala-2026-black-white-bold.jpg';
        if (g && !g.flyer) {
          const imgs = (g.images || []).filter((u) => !/11209\.jpg/.test(String(u)));
          await repo.upsertEvent(buildEvent({ flyer: NEW, images: imgs }, g));
        }
        await repo.setSetting(KEY, `applied @ ${new Date().toISOString()}`);
        console.log('[events] one-time: gala flyer updated to current Black, White & Bold');
      }
    } catch (e) { _galaFlyerChecked = false; console.error('gala flyer update failed (will retry next boot)', e); }
  }
  // One-time (Jul 16 2026): remove the 3 cropped gallery photos UrBrand Studio
  // (m15911) asked to have taken down. Members can now remove their own gallery
  // photos, so this is just clearing the specific ones already flagged.
  if (!_urbrandPhotosChecked) {
    _urbrandPhotosChecked = true;
    try {
      const KEY = 'urbrandPhotos-20260716';
      if (!(await repo.getSetting(KEY))) {
        await repo.setMemberEdit('m15911', { photos: [] });
        await repo.setSetting(KEY, `cleared @ ${new Date().toISOString()}`);
        console.log('[members] one-time: cleared UrBrand Studio (m15911) gallery photos per request');
      }
    } catch (e) { _urbrandPhotosChecked = false; console.error('urbrand photos clear failed (will retry next boot)', e); }
  }
  // One-time (Jul 17 2026): repair events the office published that never showed
  // on the calendar. The old ✓ Publish only set status='approved' and left
  // `confirmed` false, but the public calendar hides unconfirmed events — so an
  // approved, dated event stayed invisible (Felicia: TCCC 7/26, Fogo 8/13, +1).
  // Any approved event that has a date should be confirmed; flip those on.
  if (!_confirmPublishedChecked) {
    _confirmPublishedChecked = true;
    try {
      const KEY = 'confirmPublishedEvents-20260717';
      if (!(await repo.getSetting(KEY))) {
        let fixed = 0;
        for (const ev of await repo.listEventsStore()) {
          if ((ev.status || 'approved') === 'approved' && ev.date && !ev.confirmed) {
            await repo.upsertEvent(buildEvent({ confirmed: true }, ev)); fixed++;
          }
        }
        await repo.setSetting(KEY, `confirmed ${fixed} @ ${new Date().toISOString()}`);
        console.log(`[events] one-time: confirmed ${fixed} approved+dated event(s) stuck hidden by the publish bug`);
      }
    } catch (e) { _confirmPublishedChecked = false; console.error('publish-confirm backfill failed (will retry next boot)', e); }
  }
  // One-time (Jul 24 2026, per Felicia): ticket sales for the July 25 Gala are
  // CLOSED — flag the event Sold Out (it stays listed; buttons become a Sold
  // Out notice and checkout refuses it). The marker means the office can
  // re-open sales from Admin → Events later without a redeploy flipping it back.
  if (!_galaSoldOutChecked) {
    _galaSoldOutChecked = true;
    try {
      const KEY = 'galaSoldOut-20260724';
      if (!(await repo.getSetting(KEY))) {
        const g = (await repo.listEventsStore()).find((e) => e.id === 'le-11209');
        if (g && !g.soldOut) await repo.upsertEvent(buildEvent({ soldOut: true }, g));
        await repo.setSetting(KEY, `applied @ ${new Date().toISOString()}`);
        console.log('[events] one-time: July 25 Gala (le-11209) marked Sold Out per Felicia');
      }
    } catch (e) { _galaSoldOutChecked = false; console.error('gala sold-out flag failed (will retry next boot)', e); }
  }
  /* One-time (Jul 30 2026, per Felicia): repair ticket rows whose NAME and
     AMOUNT disagree. The Aug 26 Belmont Village mixer went live with both rows
     at $100 — "Member Free With Pre-registration" would have charged $100, and
     "Guests $15 with Pre-registration" charged $100 instead of $15 (before that
     it had no amount at all, so the checkout said "Free / No payment needed",
     which is what she wrote in about). The rule is deliberately narrow: only
     touch a row whose own name states the price, and only set it to the number
     that name already promises. The marker means the office can overrule any of
     this from Admin → Events without a redeploy undoing their change. */
  if (!_mixerPricesChecked) {
    _mixerPricesChecked = true;
    try {
      const KEY = 'ticketNamePriceRepair-20260730';
      if (!(await repo.getSetting(KEY))) {
        const named = (n) => { const m = String(n || '').match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/); return m ? Number(m[1].replace(/,/g, '')) : null; };
        const saysFree = (n) => /\bfree\b/i.test(String(n || ''));
        let fixed = 0;
        for (const ev of await repo.listEventsStore()) {
          if (!Array.isArray(ev.ticketTypes) || !ev.ticketTypes.length) continue;
          let touched = false;
          const rows = ev.ticketTypes.map((t) => {
            const price = Number(t.price) || 0;
            const want = named(t.name);
            // "…$15…" priced at anything else → charge the $15 it advertises.
            if (want != null && Math.abs(want - price) >= 0.005) { touched = true; return { ...t, price: want }; }
            // "Member Free…" priced above zero → it says free, so make it free.
            if (want == null && saysFree(t.name) && price > 0) { touched = true; return { ...t, price: 0 }; }
            return t;
          });
          if (touched) {
            await repo.upsertEvent(buildEvent({ ticketTypes: rows }, ev));
            fixed++;
            console.log(`[events] one-time price repair on ${ev.id} (${ev.title}): `
              + rows.map((r) => `${r.name} → $${Number(r.price) || 0}`).join(' · '));
          }
        }
        await repo.setSetting(KEY, `repaired ${fixed} event(s) @ ${new Date().toISOString()}`);
      }
    } catch (e) { _mixerPricesChecked = false; console.error('ticket price repair failed (will retry next boot)', e); }
  }
  /* One-time (Aug 3 2026, per Felicia + Diana's call): the Oct 21 Food & Wine
     (le-11262) had four priced ticket rows and the custom button label
     "Sponsor/Exhibit/Purchase" saved, but ticketed was still false — the office
     set the prices and the wording without switching the Action button off
     "RSVP", so the public page kept a plain RSVP button and the prices were
     unreachable. Flip it to ticket sales. Narrow on purpose: only this event,
     and only while it still has priced rows but no ticket button. The marker
     means the office can change the button from Admin → Events later without a
     redeploy flipping it back. */
  if (!_foodWineButtonChecked) {
    _foodWineButtonChecked = true;
    try {
      const KEY = 'foodWineTicketButton-20260804';
      if (!(await repo.getSetting(KEY))) {
        const fw = (await repo.listEventsStore()).find((e) => e.id === 'le-11262');
        const priced = fw && Array.isArray(fw.ticketTypes) && fw.ticketTypes.some((t) => (Number(t.price) || 0) > 0);
        if (fw && priced && !fw.ticketed && !fw.soldOut && !fw.hideCta) {
          await repo.upsertEvent(buildEvent({ ticketed: true, alsoRsvp: false }, fw));
          console.log('[events] one-time: Food & Wine (le-11262) switched to ticket sales — its saved prices and "Sponsor/Exhibit/Purchase" button now show');
        }
        await repo.setSetting(KEY, `applied @ ${new Date().toISOString()}`);
      }
    } catch (e) { _foodWineButtonChecked = false; console.error('food & wine ticket-button flip failed (will retry next boot)', e); }
  }
  /* One-time (Aug 18 2026, per Felicia, Aug 11): strip the RSVP button off the
     recurring connection-circle and group meetings. Lee Levy and the other
     leaders posted a year of dates on the OLD site, where those listings had no
     RSVP link; the import gave every one of them the default RSVP button, so
     28 upcoming meetings were inviting RSVPs nobody collects. Her words: "The
     connection circles do not take RSVPs because they are category specific."

     The Aug 12 default-button change fixed only NEW events and deliberately
     left the existing 234 alone, which is why these survived it.

     Narrow on purpose, because the office DOES take RSVPs for real Chamber
     events: matched by the circle's own recurring name, and only while the
     event still shows a plain RSVP button (no tickets, no prices, not already
     switched off). Chamber events are named with a date prefix — "October 17th
     ~ LIGHT THE NIGHT Walk" — so none of them match. The marker means the
     office can switch a button back on from Admin → Events without a redeploy
     undoing it. */
  if (!_circleRsvpChecked) {
    _circleRsvpChecked = true;
    try {
      const KEY = 'circleRsvpButtonsOff-20260818';
      if (!(await repo.getSetting(KEY))) {
        // Leading-anchored so "Lee's Luncheon Connection Circle 9/9/2026" matches
        // while a one-off event that merely mentions a circle does not.
        const CIRCLES = [
          "martin's connection circle",
          "lee's luncheon connection circle",
          'young professionals network',
          'home improvement professionals network',
          'health & wellness resource network',
          'dynamic business networking',
          'valley senior resource and network',
          'board of directors monthly meeting',
        ];
        let off = 0;
        for (const ev of await repo.listEventsStore()) {
          const t = String(ev.title || '').trim().toLowerCase();
          if (!CIRCLES.some((c) => t.startsWith(c))) continue;
          // Only a plain, unpriced RSVP button — never touch ticketing.
          if (ev.hideCta || ev.ticketed || ev.soldOut) continue;
          if (Array.isArray(ev.ticketTypes) && ev.ticketTypes.length) continue;
          await repo.upsertEvent(buildEvent({ hideCta: true }, ev));
          off++;
        }
        await repo.setSetting(KEY, `applied @ ${new Date().toISOString()}`);
        console.log(`[events] one-time: RSVP button removed from ${off} connection-circle/group meetings per Felicia (Aug 11)`);
      }
    } catch (e) { _circleRsvpChecked = false; console.error('circle RSVP-button cleanup failed (will retry next boot)', e); }
  }
  /* One-time (Aug 19 2026, per Felicia): rescue any dated event left stuck at
     confirmed:false by the ?? bug fixed in buildEvent above. Those events look
     perfectly normal in Admin - approved, dated, showing on the list - but the
     public calendar filters on `confirmed && date`, so they were invisible to
     members with nothing on screen to explain why. Her Nov 18 mixer was one.
     Only touches events that already have a real date and are approved; a
     ribbon cutting still waiting on a date stays unconfirmed, which is what
     that flag is actually for. */
  if (!_confirmDatedChecked) {
    _confirmDatedChecked = true;
    try {
      const KEY = 'confirmDatedEvents-20260819';
      if (!(await repo.getSetting(KEY))) {
        let fixed = 0;
        for (const ev of await repo.listEventsStore()) {
          if (ev.confirmed) continue;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || ''))) continue;
          if ((ev.status || 'approved') !== 'approved') continue;
          await repo.upsertEvent(buildEvent({ confirmed: true }, ev));
          fixed++;
        }
        await repo.setSetting(KEY, `applied @ ${new Date().toISOString()}`);
        if (fixed) console.log(`[events] one-time: ${fixed} dated event(s) un-stuck from confirmed:false and now show on the calendar`);
      }
    } catch (e) { _confirmDatedChecked = false; console.error('confirmed-flag repair failed (will retry next boot)', e); }
  }
  /* One-time (Jul 30 2026): stand up the album Diana asked for by name — "a
     photo gallery for the Black and White Gala" — attached to the Gala event
     and covered by its flyer, so the office only has to drop photos in. Empty
     albums are legitimate: the page invites members to add the first shots. */
  if (!_galaAlbumChecked) {
    _galaAlbumChecked = true;
    try {
      const KEY = 'galaAlbum-20260730';
      if (!(await repo.getSetting(KEY))) {
        const have = (await repo.listPosts({ type: 'album' })).some((p) => (p.meta || {}).eventId === 'le-11209');
        if (!have) {
          await repo.addPost({
            id: 'alb-gala-2026',
            type: 'album',
            status: 'approved',
            authorName: 'Chamber office',
            title: 'Black, White & Bold Gala 2026',
            body: 'Photos from our 2026 installation gala at the Woodland Hills Country Club.',
            imageUrl: '/assets/events/gala-2026-black-white-bold.jpg',
            meta: { eventId: 'le-11209', groupSlug: '', locked: false, photos: [] },
          });
          console.log('[albums] one-time: created the Black, White & Bold Gala 2026 album (Diana, Jul 30)');
        }
        await repo.setSetting(KEY, `applied @ ${new Date().toISOString()}`);
      }
    } catch (e) { _galaAlbumChecked = false; console.error('gala album seed failed (will retry next boot)', e); }
  }
  /* One-time (Jul 30 2026, per Felicia — "the gala pop up program link is still
     displayed on mobile device view"): the homepage popup was still pushing the
     July 25 Gala program five days after the Gala, because it was saved with an
     empty end date and nothing retires a popup on its own. Turn it off. It only
     LOOKED like a mobile problem: the popup shows once per browser session, so
     the office dismissed it on the desktop they work on and then met it again
     on a phone. The admin now refuses to enable a popup with no end date, so
     the next one retires itself. */
  if (!_galaPopupChecked) {
    _galaPopupChecked = true;
    try {
      const KEY = 'retireGalaPopup-20260730';
      if (!(await repo.getSetting(KEY))) {
        const raw = await repo.getSetting(POPUP_KEY);
        const cur = raw ? JSON.parse(raw) : null;
        // Only touch it if it is still the Gala one — never stomp a popup the
        // office has since put up for something else.
        if (cur && cur.enabled && /gala/i.test(`${cur.title || ''} ${cur.image || ''} ${cur.buttonLabel || ''}`)) {
          await repo.setSetting(POPUP_KEY, JSON.stringify({ ...cur, enabled: false }));
          console.log('[popup] one-time: retired the July 25 Gala homepage popup (Felicia, Jul 30)');
        }
        await repo.setSetting(KEY, `applied @ ${new Date().toISOString()}`);
      }
    } catch (e) { _galaPopupChecked = false; console.error('gala popup retire failed (will retry next boot)', e); }
  }
  // Store already populated (e.g. seeded before flyers existed). Once per boot,
  // backfill flyer images from the committed seed onto stored events that lack
  // one. Add-only by id — never wipes admin edits or deletes events.
  if (!_eventImgBackfillDone) {
    _eventImgBackfillDone = true;
    try {
      const seed = new Map(readSeedEvents().map((e) => [e.id, e]));
      for (const ev of await repo.listEventsStore()) {
        const s = seed.get(ev.id);
        if (s && Array.isArray(s.images) && s.images.length && !(ev.images && ev.images.length)) {
          await repo.upsertEvent(buildEvent({ ...ev, images: s.images }, ev));
        }
      }
    } catch (e) { console.error('event image backfill failed', e); }
  }
}
// ── Rich event descriptions: server-side HTML allowlist sanitizer ──
// The admin editor writes formatted HTML (font/size/color/align + hyperlinks +
// linked images). Only these tags survive, and only href/style attributes with
// safe values — everything else (scripts, handlers, iframes) is stripped.
const RICH_TAGS = new Set(['a', 'b', 'strong', 'i', 'em', 'u', 's', 'p', 'div', 'br', 'ul', 'ol', 'li', 'h3', 'h4', 'span', 'blockquote']);
function sanitizeRichStyle(s) {
  const out = [];
  for (const decl of String(s || '').split(';')) {
    const m = decl.match(/^\s*(color|background-color|font-size|font-family|text-align|font-weight|font-style|text-decoration)\s*:\s*([^;<>"'{}]{1,90}?)\s*$/i);
    if (m && !/url\s*\(|expression|javascript|@import/i.test(m[2])) out.push(m[1].toLowerCase() + ':' + m[2]);
  }
  return out.join(';');
}
function sanitizeRichHref(u) {
  u = String(u || '').trim();
  if (/^(https?:|mailto:|tel:|\/)/i.test(u)) return u.slice(0, 600);
  if (/^www\./i.test(u)) return ('https://' + u).slice(0, 600);
  return '';
}
function richAttr(attrs, name) {
  const m = String(attrs || '').match(new RegExp(name + `\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[1] ?? m[2] ?? '') : '';
}
function sanitizeRichHtml(html) {
  let s = String(html || '').slice(0, 20000);
  if (!s.trim()) return '';
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|iframe|object|embed|form|link|meta|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<\/?([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g, (m0, tag, attrs) => {
    tag = tag.toLowerCase();
    if (tag === 'img') { // linked sponsor/inline images keep src (+ optional link handled via <a>)
      const src = sanitizeRichHref(richAttr(attrs, 'src'));
      // Keep the author's size (percent OR exact pixels) and position (wrap
      // left/right, centered) from the editor's image toolbar — per the
      // office, Jul 14 2026. Everything else is stripped.
      const st = richAttr(attrs, 'style') || '';
      const out = [];
      // Anchored to a declaration boundary so "max-width:100%" never matches.
      const wpct = /(?:^|;)\s*width:\s*(\d{1,3})%/i.exec(st);
      const wpx = /(?:^|;)\s*width:\s*(\d{2,4})(?:\.\d+)?px/i.exec(st);
      if (wpct) out.push(`width:${Math.min(100, Math.max(5, Number(wpct[1])))}%`);
      else if (wpx) out.push(`width:${Math.min(2000, Math.max(20, Number(wpx[1])))}px`);
      const fl = /float:\s*(left|right)/i.exec(st);
      if (fl) out.push(`float:${fl[1].toLowerCase()}`, fl[1].toLowerCase() === 'left' ? 'margin:4px 14px 8px 0' : 'margin:4px 0 8px 14px');
      else if (/display:\s*block/i.test(st) && /margin[^;]*auto/i.test(st)) out.push('display:block', 'margin:8px auto');
      out.push('max-width:100%');
      return src ? `<img src="${src}" alt="${richAttr(attrs, 'alt').replace(/[<>"]/g, '')}" style="${out.join(';')}">` : '';
    }
    if (!RICH_TAGS.has(tag)) return '';
    if (m0.startsWith('</')) return `</${tag}>`;
    let keep = '';
    if (tag === 'a') {
      const href = sanitizeRichHref(richAttr(attrs, 'href'));
      if (href) keep += ` href="${href}" target="_blank" rel="noopener"`;
    }
    const st = sanitizeRichStyle(richAttr(attrs, 'style'));
    if (st) keep += ` style="${st}"`;
    return tag === 'br' ? '<br>' : `<${tag}${keep}>`;
  });
  return s;
}

export function buildEvent(b, existing = {}) {
  const date = b.date ?? existing.date ?? '';
  const d = date ? new Date(date + 'T12:00:00') : null;
  // Images may be plain URLs or {src, href, label} (hyperlinked image, e.g. a
  // sponsor logo that clicks through to the sponsor's site). Up to 6.
  const images = Array.isArray(b.images)
    ? b.images.slice(0, 6).map((it) => {
        if (typeof it === 'string') return clampUrl(it);
        const src = clampUrl(it && (it.src || it.url));
        if (!src) return '';
        const href = it && it.href ? sanitizeRichHref(it.href) : '';
        return href ? { src, href, label: String(it.label || '').slice(0, 80) } : src;
      }).filter(Boolean)
    : (existing.images || []);
  const links = Array.isArray(b.links)
    ? b.links.slice(0, 8).map((l) => ({
        label: String(l.label || '').slice(0, 40),
        url: clampUrl(l.url),
        type: String(l.type || 'info').slice(0, 20),
      })).filter((l) => l.url)
    : (existing.links || []);
  return {
    id: existing.id || b.id || ('ev-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)),
    title: String(b.title ?? existing.title ?? '').slice(0, 200),
    category: String(b.category ?? existing.category ?? 'Event').slice(0, 40),
    /* A dated event is date-confirmed. `status` is the public gate, not this
       (Felicia, Aug 19 2026: her Nov 18 mixer saved fine, showed in Admin, and
       never appeared on the calendar). The old expression was
       `existing.confirmed ?? !!date`, and ?? only falls through on null or
       undefined - never on false. So an event first saved without a date stuck
       at confirmed:false, and adding the date afterwards could not clear it:
       the public list filters on `e.confirmed && e.date`, so it stayed
       invisible forever. Now the date decides, unless a caller says otherwise
       explicitly (the ribbon-cutting queue does, for a date not yet set). */
    confirmed: b.confirmed !== undefined ? !!b.confirmed : (date ? true : (existing.confirmed ?? false)),
    date,
    month: d ? MONTHS3[d.getMonth()] : (b.month ?? existing.month ?? ''),
    day: d ? String(d.getDate()).padStart(2, '0') : (existing.day ?? ''),
    time: String(b.time ?? existing.time ?? '').slice(0, 40),
    endDate: b.endDate ?? existing.endDate ?? '',
    endTime: String(b.endTime ?? existing.endTime ?? '').slice(0, 40),
    venue: String(b.venue ?? existing.venue ?? '').slice(0, 160),
    address: String(b.address ?? existing.address ?? '').slice(0, 200),
    neighborhood: String(b.neighborhood ?? existing.neighborhood ?? '').slice(0, 80),
    summary: String(b.summary ?? existing.summary ?? '').slice(0, 600),
    description: String(b.description ?? existing.description ?? '').slice(0, 8000),
    // Rich (formatted) description from the admin editor — sanitized HTML.
    // When present the public site renders this instead of plain `description`.
    descriptionHtml: b.descriptionHtml !== undefined ? sanitizeRichHtml(b.descriptionHtml) : (existing.descriptionHtml ?? ''),
    ticketed: b.ticketed !== undefined ? !!b.ticketed : (existing.ticketed ?? false),
    // Show BOTH buttons (RSVP + Buy tickets) — e.g. members RSVP free while
    // guests buy a ticket. Only meaningful when ticketed is true.
    alsoRsvp: b.alsoRsvp !== undefined ? !!b.alsoRsvp : (existing.alsoRsvp ?? false),
    // Sold out (per Felicia, Jul 24 2026): the event stays listed but every
    // RSVP/Buy button becomes a "Sold Out" notice and ticket checkout is closed.
    soldOut: b.soldOut !== undefined ? !!b.soldOut : (existing.soldOut ?? false),
    // No button at all (Felicia, Jul 30 2026): plenty of events take neither an
    // RSVP nor a payment — a ribbon cutting, a members-only briefing, or a
    // ticketed event whose prices are not settled yet. Wins over every other
    // CTA setting so the office can switch buttons off without clearing the
    // ticket prices they have already entered.
    hideCta: b.hideCta !== undefined ? !!b.hideCta : (existing.hideCta ?? false),
    ticketCap: b.ticketCap ?? existing.ticketCap ?? null,
    rsvpCutoff: b.rsvpCutoff ?? existing.rsvpCutoff ?? null,
    featured: b.featured !== undefined ? !!b.featured : (existing.featured ?? false),
    // Home-page placement order (lower = higher on the home page; among featured events).
    homeOrder: b.homeOrder !== undefined ? (b.homeOrder === null || b.homeOrder === '' ? null : Number(b.homeOrder)) : (existing.homeOrder ?? null),
    // Distinct images: a portrait flyer (detail) + a square thumbnail (cards). Fall back to images[].
    flyer: b.flyer !== undefined ? clampUrl(b.flyer) : (existing.flyer ?? ''),
    // Additional flyers (an event can attach several — all render in the detail view).
    flyers: Array.isArray(b.flyers) ? b.flyers.slice(0, 5).map(clampUrl).filter(Boolean) : (existing.flyers || []),
    thumbnail: b.thumbnail !== undefined ? clampUrl(b.thumbnail) : (existing.thumbnail ?? ''),
    // What fills the image slot on the event page (Felicia, Jul 29 2026). With
    // no flyer the chamber logo used to blow up to full width and shove the
    // details off the screen; the office now chooses:
    //   auto  — flyer if there is one, otherwise a compact logo banner (default)
    //   flyer — the flyer only; nothing at all when there isn't one
    //   logo  — the compact logo banner only, even if a flyer exists
    //   both  — the logo banner AND the flyer
    //   none  — no image block
    imageMode: ['auto', 'flyer', 'logo', 'both', 'none'].includes(b.imageMode)
      ? b.imageMode : (existing.imageMode ?? 'auto'),
    // Volunteer roles the office needs covered at this event (Felicia, Jul 29
    // 2026 — the ambassador tracker). Each role carries the points an
    // ambassador earns and how many people are needed.
    volunteerRoles: Array.isArray(b.volunteerRoles)
      ? b.volunteerRoles.slice(0, 12).map((r) => ({
          role: String((r && r.role) || '').slice(0, 80),
          points: Math.max(0, Math.min(100, Number(r && r.points) || 0)),
          needed: Math.max(1, Math.min(50, Number(r && r.needed) || 1)),
        })).filter((r) => r.role)
      : (existing.volunteerRoles || []),
    // Custom wording for the action button (Felicia, Jul 29 2026): "Buy Tickets"
    // is wrong when someone is buying an ad, a name badge or a sponsorship.
    // Blank = the standard label for whichever button kind is selected.
    ctaLabel: b.ctaLabel !== undefined ? String(b.ctaLabel || '').slice(0, 40) : (existing.ctaLabel ?? ''),
    // Where this event's RSVPs are emailed (Felicia, Aug 12 2026 — the old
    // site opened a box for this when a poster chose RSVP; usually the poster,
    // sometimes their assistant). Blank = the Chamber office only. Anything
    // that is not a plain email address is dropped rather than stored.
    rsvpEmail: b.rsvpEmail !== undefined
      ? (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.rsvpEmail || '').trim())
          ? String(b.rsvpEmail).trim().toLowerCase().slice(0, 160) : '')
      : (existing.rsvpEmail ?? ''),
    // Sponsor logos — each optionally hyperlinked to the sponsor's site.
    sponsorLogos: Array.isArray(b.sponsorLogos)
      ? b.sponsorLogos.slice(0, 8).map((s) => {
          const src = clampUrl(s && (s.src || s.url || (typeof s === 'string' ? s : '')));
          if (!src) return null;
          return { src, href: s && s.href ? sanitizeRichHref(s.href) : '', label: String((s && s.label) || '').slice(0, 80) };
        }).filter(Boolean)
      : (existing.sponsorLogos || []),
    homeBlurb: String(b.homeBlurb ?? existing.homeBlurb ?? '').slice(0, 400),
    showOnCalendar: b.showOnCalendar !== undefined ? !!b.showOnCalendar : (existing.showOnCalendar ?? true),
    // Up to 6 attached PDFs (forms: donation, sponsorship levels, menus, …).
    documents: Array.isArray(b.documents)
      ? b.documents.slice(0, 6).map((dme) => ({ label: String(dme.label || 'Document').slice(0, 80), url: clampUrl(dme.url) })).filter((dme) => dme.url)
      : (existing.documents || []),
    // Ticket types for AGMS checkout: name / price / quantity / available.
    ticketTypes: Array.isArray(b.ticketTypes)
      ? b.ticketTypes.slice(0, 30).map((t) => ({
          name: String(t.name || '').slice(0, 80),
          group: t.group ? String(t.group).slice(0, 40) : undefined,
          price: Math.max(0, Number(t.price) || 0),
          // Optional early-bird price used while now < earlyUntil (ISO date).
          earlyPrice: (t.earlyPrice === null || t.earlyPrice === undefined || t.earlyPrice === '') ? undefined : Math.max(0, Number(t.earlyPrice) || 0),
          earlyUntil: t.earlyUntil ? String(t.earlyUntil).slice(0, 40) : undefined,
          // Optional secret link key (per Diana, Jul 14 — board members sell
          // $150 gala tickets via a special link). The type only shows at
          // checkout when the URL carries ?key=<linkKey>.
          linkKey: t.linkKey ? String(t.linkKey).slice(0, 40).toLowerCase() : undefined,
          qty: (t.qty === null || t.qty === undefined || t.qty === '') ? null : Math.max(0, parseInt(t.qty, 10) || 0),
          available: t.available !== false,
          // Per-price sold-out: still listed in the checkout dropdown, but
          // greyed out as "SOLD OUT" and not selectable (Felicia, Jul 24).
          soldOut: t.soldOut === true ? true : undefined,
        })).filter((t) => t.name)
      : (existing.ticketTypes || []),
    status: ['approved', 'pending', 'draft'].includes(b.status) ? b.status : (existing.status || 'approved'),
    images, links,
    // Attribution (who/what an event is posted on behalf of) is set on member
    // submissions; carry it through admin edits so a staff tweak never erases
    // the "Hosted by" line or drops the event off its group page.
    // communityEmail keeps a non-member submission attributable even after an
    // admin edits the event (Felicia + Michael, Jul 29 2026).
    ...(pick(b, existing, ['hostKind', 'hostName', 'hostSlug', 'groupName', 'groupSlug', 'submittedBy', 'submittedByName', 'source', 'seriesId', 'communityEmail'])),
    created: existing.created || new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}
// Copy through only the keys that are present on the patch or the existing
// record — keeps buildEvent's output clean (no stray undefined fields).
function pick(b, existing, keys) {
  const out = {};
  for (const k of keys) { const v = b[k] !== undefined ? b[k] : existing[k]; if (v !== undefined) out[k] = v; }
  return out;
}

// Public: approved events only.
// Private contact addresses ride on the event record (where RSVPs are emailed,
// who submitted a community event) but must not be scrapeable from the public
// calendar API. The admin endpoint keeps the full record.
function publicEvent(ev) {
  const { rsvpEmail, communityEmail, ...pub } = ev;
  return pub;
}
router.get('/events', async (_req, res) => {
  try {
    const all = await loadEvents();
    res.json({ events: all.filter((e) => (e.status || 'approved') === 'approved').map(publicEvent) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'events unavailable' }); }
});
/* A real .ics download for one event (Aug 20 2026 — group members add the
   recurring meetings to their calendars). The site's "Apple / .ics" chip used
   a data: URI, which iOS Safari and in-app browsers quietly ignore — the exact
   phones group members carry to a mixer. A served file with the right
   Content-Type opens straight into Apple/Google/Outlook calendar apps.
   Times are floating local (no TZID), matching the client-side links.
   Registered BEFORE /events/:id so the .ics suffix isn't swallowed by it. */
router.get('/events/:id.ics', async (req, res) => {
  try {
    const ev = (await loadEvents()).find((e) => e.id === req.params.id);
    if (!ev || (ev.status || 'approved') !== 'approved' || !ev.date) return res.status(404).type('text/plain').send('not found');
    const esc2 = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const d8 = String(ev.date).replace(/-/g, '');
    // Mirrors the client's _parseTime exactly (js/chamber.js) — a naive %12
    // here turned office-typed 24-hour times ("18:00") into 6 AM and bare
    // "12:00" into midnight, disagreeing with the Google/Outlook chips
    // rendered beside the .ics link. Out-of-range → null → all-day entry.
    const parseT = (t) => {
      const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(String(t || ''));
      if (!m) return null;
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2] || '0', 10);
      const ap = (m[3] || '').toLowerCase();
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      if (h > 23 || min > 59) return null;
      return { h, min };
    };
    const t = parseT(ev.time);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WVWCCC//Events//EN', 'BEGIN:VEVENT',
      'UID:' + ev.id + '@wvwccc', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')];
    if (t) {
      const pad = (n) => String(n).padStart(2, '0');
      const start = `${d8}T${pad(t.h)}${pad(t.min)}00`;
      const te = parseT(ev.endTime);
      const endDate = new Date(`${ev.date}T${pad(t.h)}:${pad(t.min)}:00`);
      if (te) { endDate.setHours(te.h, te.min, 0, 0); if (endDate <= new Date(`${ev.date}T${pad(t.h)}:${pad(t.min)}:00`)) endDate.setHours(t.h + 2, t.min, 0, 0); }
      else endDate.setHours(endDate.getHours() + 2); // no end time on file → 2 hours
      const pd = (dd) => `${dd.getFullYear()}${pad(dd.getMonth() + 1)}${pad(dd.getDate())}T${pad(dd.getHours())}${pad(dd.getMinutes())}00`;
      lines.push('DTSTART:' + start, 'DTEND:' + pd(endDate));
    } else {
      // No time on file → all-day entry (DTEND is exclusive, so next day).
      const next = new Date(ev.date + 'T12:00:00'); next.setDate(next.getDate() + 1);
      const nd8 = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`;
      lines.push('DTSTART;VALUE=DATE:' + d8, 'DTEND;VALUE=DATE:' + nd8);
    }
    const loc = [ev.venue, ev.address].filter(Boolean).join(', ');
    const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    lines.push('SUMMARY:' + esc2(ev.title),
      'LOCATION:' + esc2(loc),
      'DESCRIPTION:' + esc2([ev.summary || '', `${base}/events/view.html?id=${ev.id}`].filter(Boolean).join('\n')),
      'URL:' + `${base}/events/view.html?id=${ev.id}`,
      'END:VEVENT', 'END:VCALENDAR');
    res.type('text/calendar')
      .set('Content-Disposition', `attachment; filename="${String(ev.id).replace(/[^a-z0-9-]/gi, '')}.ics"`)
      .send(lines.join('\r\n'));
  } catch (e) { console.error('event ics', e); res.status(500).type('text/plain').send('failed'); }
});
router.get('/events/:id', async (req, res) => {
  try {
    const ev = (await loadEvents()).find((e) => e.id === req.params.id);
    if (!ev || (ev.status || 'approved') !== 'approved') return res.status(404).json({ error: 'not found' });
    res.json(publicEvent(ev));
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

async function loadMembersPublic() {
  const { source, members } = await loadMembersFull();
  const pub = members
    .filter((m) => (m.status || 'approved') === 'approved')
    .map((m) => {
      const o = {};
      for (const f of PUBLIC_FIELDS) if (m[f] !== undefined) o[f] = m[f];
      return o;
    });
  return { _meta: { source, count: pub.length }, members: pub };
}

router.get('/members', async (_req, res) => {
  try { res.json(await loadMembersPublic()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'directory unavailable' }); }
});

// ── Groups / networks (YPN, Home Improvement, etc.) ─────────
function readSeedGroups() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'groups.json'), 'utf8')).groups || []; }
  catch { return []; }
}
const slugifyGroup = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
// Group roster entries. Handles directory members (memberId set), manual
// additions (name/email only), and pending join requests (status 'pending').
function normalizeGroupMembers(list) {
  if (!Array.isArray(list)) return [];
  const ROLES = ['Member', 'Leader', 'Chair', 'Co-Chair', 'Ambassador'];
  return list.slice(0, 1000).map((m, i) => ({
    id: String(m.id || ('gm-' + Date.now().toString(36) + i.toString(36) + Math.floor(Math.random() * 1e3).toString(36))),
    memberId: m.memberId ? String(m.memberId).slice(0, 48) : null,
    name: String(m.name || '').slice(0, 160),
    business: String(m.business || '').slice(0, 160),
    email: String(m.email || '').slice(0, 160),
    phone: String(m.phone || '').slice(0, 40),
    role: ROLES.includes(m.role) ? m.role : 'Member',
    status: m.status === 'pending' ? 'pending' : 'active',
    source: ['admin', 'manual', 'request'].includes(m.source) ? m.source : 'admin',
    message: m.message ? String(m.message).slice(0, 500) : undefined,
    added: m.added || new Date().toISOString(),
  })).filter((m) => m.name);
}

// The person who runs a group — receives its join requests & meeting RSVPs.
function normalizeGroupManager(m) {
  m = m || {};
  return { name: String(m.name || '').slice(0, 160), email: String(m.email || '').slice(0, 160), phone: String(m.phone || '').slice(0, 40), memberId: m.memberId ? String(m.memberId).slice(0, 48) : null };
}
// Group photos may carry an optional date + associated event for captions.
function normalizeGroupPhotos(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 24).map((p) => {
    const o = (typeof p === 'string') ? { url: p } : (p || {});
    return { url: clampUrl(o.url || ''), date: String(o.date || '').slice(0, 10), event: String(o.event || '').slice(0, 160) };
  }).filter((p) => p.url);
}

// Strip a group to what's safe for the public site: only ACTIVE members, the
// manager's NAME (never email), and never pending requests / internal notes.
function publicGroup(g) {
  const members = (g.members || []).filter((m) => m.status === 'active')
    .map((m) => ({ memberId: m.memberId || null, name: m.name, business: m.business || '', role: m.role || 'Member' }));
  return { ...g, members, memberCount: members.length, manager: { name: (g.manager && g.manager.name) || '' } };
}

function buildGroup(b, existing = {}) {
  const name = String(b.name ?? existing.name ?? '').slice(0, 120);
  return {
    id: existing.id || b.id || ('grp-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)),
    slug: slugifyGroup(b.slug ?? existing.slug ?? name),
    name,
    tagline: String(b.tagline ?? existing.tagline ?? '').slice(0, 200),
    description: String(b.description ?? existing.description ?? '').slice(0, 8000),
    heroImage: clampUrl(b.heroImage ?? existing.heroImage ?? ''),
    photos: normalizeGroupPhotos(b.photos ?? existing.photos),
    manager: normalizeGroupManager(b.manager ?? existing.manager),
    meetingSchedule: String(b.meetingSchedule ?? existing.meetingSchedule ?? '').slice(0, 200),
    meetingNotes: String(b.meetingNotes ?? existing.meetingNotes ?? '').slice(0, 12000),
    contactEmail: String(b.contactEmail ?? existing.contactEmail ?? '').slice(0, 160),
    eventMatch: String(b.eventMatch ?? existing.eventMatch ?? '').slice(0, 120),
    status: ['approved', 'draft'].includes(b.status) ? b.status : (existing.status || 'approved'),
    members: normalizeGroupMembers(b.members ?? existing.members ?? []),
    created: existing.created || new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}
let _groupsSeeded = false;
async function loadGroups() {
  if (!_groupsSeeded) {
    _groupsSeeded = true;
    try {
      if (!(await repo.hasGroups())) {
        for (const g of readSeedGroups()) await repo.upsertGroup(buildGroup(g, g));
      } else {
        // add-only for new groups; plus a one-time leader/manager BACKFILL for
        // existing groups that still have no roster/manager (so the imported
        // Connection Circle leaders land without clobbering any admin edits).
        const live = new Map((await repo.listGroupsStore()).map((g) => [g.id, g]));
        for (const g of readSeedGroups()) {
          const cur = live.get(g.id);
          if (!cur) { await repo.upsertGroup(buildGroup(g, g)); continue; }
          const noRoster = !Array.isArray(cur.members) || cur.members.length === 0;
          const noManager = !cur.manager || !cur.manager.email;
          const addRoster = noRoster && Array.isArray(g.members) && g.members.length;
          const addManager = noManager && g.manager && g.manager.email;
          if (addRoster || addManager) {
            const merged = { ...cur };
            if (addRoster) merged.members = g.members;
            if (addManager) merged.manager = g.manager;
            await repo.upsertGroup(buildGroup(merged, cur));
          }
        }
      }
    } catch (e) { console.error('group seed failed', e); }
  }
  return repo.listGroupsStore();
}
router.get('/groups', async (_req, res) => {
  try { res.json({ groups: (await loadGroups()).filter((g) => g.status === 'approved').map(publicGroup) }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'groups unavailable' }); }
});
router.get('/groups/:slug', async (req, res) => {
  try {
    const g = (await loadGroups()).find((x) => x.slug === req.params.slug || x.id === req.params.slug);
    if (!g || g.status !== 'approved') return res.status(404).json({ error: 'not found' });
    res.json({ group: publicGroup(g) });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});
// Public "Join this group" → a PENDING roster entry the admin approves.
router.post('/groups/:slug/join', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 160);
    const reqEmail = String(b.email || '').trim().slice(0, 160);
    const business = String(b.business || b.company || '').slice(0, 160);
    if (!name || !reqEmail) return res.status(400).json({ error: 'Name and email are required.' });
    const g = (await loadGroups()).find((x) => x.slug === req.params.slug || x.id === req.params.slug);
    if (!g || g.status !== 'approved') return res.status(404).json({ error: 'not found' });
    g.members = Array.isArray(g.members) ? g.members : [];
    const dupe = g.members.some((m) => m.email && m.email.toLowerCase() === reqEmail.toLowerCase()
      && (m.status === 'pending' || m.status === 'active'));
    if (!dupe) {
      g.members.push({
        id: 'gm-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        memberId: null, name, business, email: reqEmail,
        role: 'Member', status: 'pending', source: 'request',
        message: String(b.message || '').slice(0, 500), added: new Date().toISOString(),
      });
      await repo.upsertGroup(g);
      // Notify the group manager (falls back to the Chamber office), and log a
      // lead so the request also surfaces in Inquiries as a backstop.
      const to = (g.manager && g.manager.email) || email.notifyTo();
      email.send({ to, replyTo: reqEmail, subject: `New join request: ${g.name}`,
        text: `${name} <${reqEmail}>${business ? ` — ${business}` : ''} requested to join ${g.name}.\n\n${b.message || ''}\n\nApprove or decline in the admin → Groups & Networks.` }).catch(() => {});
      try { await repo.addLead({ id: 'lead-' + Date.now().toString(36), kind: 'group-join', name, email: reqEmail, company: business, reason: `Join request: ${g.name}`, message: b.message || '', status: 'new' }); } catch (e) {}
    }
    res.json({ ok: true });
  } catch (e) { console.error('group join', e); res.status(500).json({ error: 'Could not submit your request.' }); }
});
router.get('/admin/groups', requireAdmin, async (_req, res) => {
  try { res.json({ groups: await loadGroups() }); }
  catch (e) { res.status(500).json({ error: 'failed' }); }
});
router.post('/admin/groups', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const existing = b.id ? (await loadGroups()).find((g) => g.id === b.id) : null;
    const g = buildGroup(b, existing || {});
    await repo.upsertGroup(g);
    // Members added in this save get their welcome email — but only on an
    // EDIT of an existing group. Creating (or importing) a group with a
    // pre-filled roster stays silent: nobody "was just added" to a group
    // that didn't exist a second ago.
    if (existing) notifyNewGroupMembers(existing.members || [], g, req);
    res.json({ ok: true, group: g });
  } catch (e) { console.error(e); res.status(500).json({ error: 'save failed' }); }
});
// Roster-only save (Felicia, Jul 29 2026): approving a pending join request
// used to change the screen but nothing else — the roster only reached the
// server on "Save group", which is easy to miss, so the request came back as
// still-pending. Approve/Decline now writes through here immediately, and it
// touches nothing but `members` so unrelated edits in the open form are safe.
router.post('/admin/groups/:id/members', requireAdmin, async (req, res) => {
  try {
    const existing = (await loadGroups()).find((g) => g.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'That group no longer exists.' });
    const before = (existing.members || []).slice();
    const g = buildGroup({ ...existing, members: Array.isArray(req.body?.members) ? req.body.members : [] }, existing);
    await repo.upsertGroup(g);
    notifyNewGroupMembers(before, g, req);
    res.json({ ok: true, members: g.members || [] });
  } catch (e) { console.error('group members', e); res.status(500).json({ error: 'Could not save the roster.' }); }
});

router.delete('/admin/groups/:id', requireAdmin, async (req, res) => {
  try { await repo.deleteGroup(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'delete failed' }); }
});

// 📣 Email every active member of a group (meeting reminders, agendas,
// announcements). Roster entries added from the directory carry only a
// memberId — their email resolves from the member roster/login at send time.
// Shared by the admin route and the group leader's own announce.
async function sendGroupAnnouncement(g, subject, message, req) {
  const { members: dir } = await loadMembersFull();
  const emailById = new Map(dir.filter((m) => m.email).map((m) => [m.id, m.email]));
  const roster = (g.members || []).filter((m) => m.status !== 'pending');
  const targets = new Map(); // email → name (dedup)
  for (const m of roster) {
    const addr = String(m.email || emailById.get(m.memberId) || '').toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) && !targets.has(addr)) targets.set(addr, m.name || '');
  }
  const groupUrl = `${process.env.SITE_URL || `${req.protocol}://${req.get('host')}`}/groups/${g.slug}`;
  const text = `${message}\n\n—\n${g.name} · West Valley · Warner Center Chamber of Commerce\n${g.meetingSchedule ? `Meets: ${g.meetingSchedule}\n` : ''}${groupUrl}`;
  let sent = 0;
  for (const [addr] of targets) {
    // Individually addressed (never expose the roster in To/CC); best-effort per recipient.
    const r = await email.send({ to: addr, subject: `[${g.name}] ${subject}`, text, replyTo: (g.manager && g.manager.email) || undefined }).catch(() => null);
    if (r && r.ok) sent++;
  }
  return { sent, skipped: roster.length - targets.size, total: roster.length };
}
router.post('/admin/groups/:id/announce', requireAdmin, async (req, res) => {
  const subject = String((req.body && req.body.subject) || '').trim().slice(0, 160);
  const message = String((req.body && req.body.message) || '').trim().slice(0, 5000);
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required.' });
  try {
    const g = (await loadGroups()).find((x) => x.id === req.params.id || x.slug === req.params.id);
    if (!g) return res.status(404).json({ error: 'group not found' });
    res.json({ ok: true, ...(await sendGroupAnnouncement(g, subject, message, req)) });
  } catch (e) { console.error('group announce', e); res.status(500).json({ error: 'could not send' }); }
});

// ── Static content pages (migrated legacy IA) ──
let _pages = null;
function readPages() {
  if (_pages) return _pages;
  try { _pages = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'pages.json'), 'utf8')).pages || []; }
  catch { _pages = []; }
  return _pages;
}
router.get('/pages', async (req, res) => {
  const es = req.query.lang === 'es';
  const title = (p) => (es && p.title_es) ? p.title_es : p.title;
  try {
    const ov = await repo.getPageOverrides();
    res.json({ pages: readPages().filter((p) => !(ov[p.slug] && ov[p.slug].hidden))
      .map((p) => ({ slug: p.slug, title: title(p), group: p.group, translated: !!p.html_es })) });
  } catch (e) { res.json({ pages: readPages().map((p) => ({ slug: p.slug, title: title(p), group: p.group, translated: !!p.html_es })) }); }
});
router.get('/pages/:slug', async (req, res) => {
  const p = readPages().find((x) => x.slug === req.params.slug);
  if (!p) return res.status(404).json({ error: 'not found' });
  try {
    const ov = await repo.getPageOverrides();
    if (ov[p.slug] && ov[p.slug].hidden) return res.status(404).json({ error: 'not found' });
  } catch (e) {}
  if (req.query.lang === 'es') {
    return res.json({
      slug: p.slug, group: p.group,
      title: p.title_es || p.title, html: p.html_es || p.html,
      translated: !!p.html_es,
    });
  }
  res.json(p);
});

// Staff page manager — list every migrated page (incl. hidden) and hide/restore.
router.get('/admin/pages', requireAdmin, async (_req, res) => {
  try {
    const ov = await repo.getPageOverrides();
    res.json({ pages: readPages().map((p) => ({
      slug: p.slug, title: p.title, group: p.group,
      hidden: !!(ov[p.slug] && ov[p.slug].hidden),
      size: (p.html || '').length,
    })) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
});
router.patch('/admin/pages/:slug', requireAdmin, async (req, res) => {
  const p = readPages().find((x) => x.slug === req.params.slug);
  if (!p) return res.status(404).json({ error: 'not found' });
  const hidden = !!(req.body || {}).hidden;
  try { await repo.setPageOverride(p.slug, { hidden }); res.json({ ok: true, slug: p.slug, hidden }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'save failed' }); }
});

// ── Community guides (data-driven: Senior Living, Health & Wellness, …) ──
let _guides = null;
function readGuides() {
  if (_guides) return _guides;
  try { _guides = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'guides.json'), 'utf8')).guides || []; }
  catch { _guides = []; }
  return _guides;
}
router.get('/guides', (_req, res) => {
  res.json({ guides: readGuides().map(({ slug, title, kicker, lede, emoji, title_es, kicker_es, lede_es }) =>
    ({ slug, title, kicker, lede, emoji, title_es, kicker_es, lede_es })) });
});
router.get('/guides/:slug', (req, res) => {
  const g = readGuides().find((x) => x.slug === req.params.slug);
  if (!g) return res.status(404).json({ error: 'not found' });
  res.json(g);
});

// ── Featured placements: one sponsored member per page/guide slot ──
function placementSlots() {
  const fixed = [
    { slot: 'directory', label: 'Business Directory', page: '/members/directory.html' },
    { slot: 'dining', label: 'Dining Guide', page: '/dining.html' },
    { slot: 'deals', label: 'Member Deals', page: '/deals.html' },
    { slot: 'events', label: 'Events', page: '/events/index.html' },
    { slot: 'jobs', label: 'Jobs Board', page: '/jobs/index.html' },
    { slot: 'real-estate', label: 'Real Estate', page: '/real-estate.html' },
    { slot: 'news', label: 'Valley Biz Buzz', page: '/community/news.html' },
  ];
  const guides = readGuides().map((g) => ({ slot: 'guide:' + g.slug, label: 'Guide — ' + g.title, page: '/guides/' + g.slug }));
  return fixed.concat(guides);
}
// Public: resolve one or more slots to their featured member cards.
router.get('/featured', async (req, res) => {
  try {
    const want = String(req.query.slots || req.query.slot || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
    if (!want.length) return res.json({ featured: {} });
    const map = await repo.getPlacements();
    const ids = want.map((s) => map[s]).filter(Boolean);
    const out = {};
    if (ids.length) {
      const all = (await loadMembersPublic()).members;
      const byId = Object.fromEntries(all.map((m) => [m.id, m]));
      for (const s of want) if (map[s] && byId[map[s]]) out[s] = byId[map[s]];
    }
    res.json({ featured: out });
  } catch (e) { console.error('featured', e); res.status(500).json({ error: 'failed' }); }
});
router.get('/admin/placements', requireAdmin, async (_req, res) => {
  try {
    const map = await repo.getPlacements();
    const { members } = await loadMembersFull();
    const byId = Object.fromEntries(members.map((m) => [m.id, m]));
    const placements = placementSlots().map((s) => ({
      ...s,
      memberId: map[s.slot] || null,
      memberName: map[s.slot] && byId[map[s.slot]] ? byId[map[s.slot]].name : null,
    }));
    res.json({ placements });
  } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
});
router.post('/admin/placements', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const slot = String(b.slot || '');
  if (!placementSlots().some((s) => s.slot === slot)) return res.status(400).json({ error: 'Unknown placement slot.' });
  const memberId = b.memberId ? String(b.memberId) : null;
  if (memberId) {
    const exists = (await loadMembersFull()).members.some((m) => m.id === memberId);
    if (!exists) return res.status(404).json({ error: 'Member not found.' });
  }
  try { await repo.setPlacement(slot, memberId); res.json({ ok: true, slot, memberId }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'save failed' }); }
});

// ── Home "Featured this week" spotlight ──────────────────────
// The top-right card on the homepage. Blank until staff pick a member OR upload
// an image (Chamber feedback). Stored in the placements store under the reserved
// 'home' slot: a plain member id, or a JSON string {image,caption,href}.
function parseSpotlight(raw) {
  if (!raw) return null;
  if (typeof raw === 'string' && raw[0] === '{') {
    try { const o = JSON.parse(raw); if (o && o.image) return { type: 'image', image: o.image, caption: o.caption || '', href: o.href || '' }; } catch (e) { /* fall through */ }
  }
  return { type: 'member', memberId: String(raw) };
}
router.get('/home-spotlight', async (_req, res) => {
  try {
    const sp = parseSpotlight((await repo.getPlacements()).home);
    if (!sp) return res.json({ spotlight: null });
    if (sp.type === 'image') return res.json({ spotlight: sp });
    const m = (await loadMembersPublic()).members.find((x) => x.id === sp.memberId);
    return res.json({ spotlight: m ? { type: 'member', member: m } : null });
  } catch (e) { console.error('home-spotlight', e); res.status(500).json({ error: 'failed' }); }
});
router.get('/admin/home-spotlight', requireAdmin, async (_req, res) => {
  try {
    const sp = parseSpotlight((await repo.getPlacements()).home);
    let memberName = null;
    if (sp && sp.type === 'member') {
      const m = (await loadMembersFull()).members.find((x) => x.id === sp.memberId);
      memberName = m ? m.name : null;
    }
    res.json({ spotlight: sp, memberName });
  } catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
});
router.post('/admin/home-spotlight', requireAdmin, async (req, res) => {
  const b = req.body || {};
  try {
    let value = null;
    if (b.memberId) {
      const exists = (await loadMembersFull()).members.some((m) => m.id === String(b.memberId));
      if (!exists) return res.status(404).json({ error: 'Member not found.' });
      value = String(b.memberId);
    } else if (b.image) {
      value = JSON.stringify({ image: String(b.image).slice(0, 800), caption: String(b.caption || '').slice(0, 200), href: String(b.href || '').slice(0, 800) });
    }
    await repo.setPlacement('home', value);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'save failed' }); }
});

// ── Homepage popup (the "shows-once" promo over the homepage) ──
// Editable from Admin → Sponsorships so the office can swap the image/text and
// sell the placement, instead of it being hardcoded (Diana, Jul 16 2026).
const POPUP_KEY = 'homePopup';
/* Default = OFF. It used to default to the July 25 Gala, which meant a site
   with no popup saved would interrupt every visitor with a past event (Felicia,
   Jul 30 2026). The office turns one on in Admin → Homepage Management when
   there is something to promote, and gives it an end date. */
const POPUP_DEFAULT = {
  enabled: false,
  image: '',
  title: '',
  subtitle: '',
  buttonLabel: '',
  href: '',
  retireAt: '', // ISO date; blank = never auto-hide (the admin warns about this)
};
async function loadPopup() {
  try { const raw = await repo.getSetting(POPUP_KEY); return raw ? { ...POPUP_DEFAULT, ...JSON.parse(raw) } : { ...POPUP_DEFAULT }; }
  catch { return { ...POPUP_DEFAULT }; }
}
function cleanPopup(b) {
  return {
    enabled: !!b.enabled,
    image: clampUrl(b.image),
    title: String(b.title || '').slice(0, 160),
    subtitle: String(b.subtitle || '').slice(0, 240),
    buttonLabel: String(b.buttonLabel || '').slice(0, 80),
    href: clampUrl(b.href),
    retireAt: /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(String(b.retireAt || '')) ? String(b.retireAt).slice(0, 25) : '',
  };
}
router.get('/home-popup', async (_req, res) => {
  try { res.json({ popup: await loadPopup() }); }
  catch (e) { console.error('home-popup', e); res.status(500).json({ error: 'failed' }); }
});
router.get('/admin/home-popup', requireAdmin, async (_req, res) => {
  try { res.json({ popup: await loadPopup() }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'failed' }); }
});
router.post('/admin/home-popup', requireAdmin, async (req, res) => {
  try {
    const popup = cleanPopup(req.body || {});
    if (popup.enabled && (!popup.image || !popup.title)) return res.status(400).json({ error: 'An enabled popup needs at least an image and a title.' });
    await repo.setSetting(POPUP_KEY, JSON.stringify(popup));
    res.json({ ok: true, popup });
  } catch (e) { console.error('home-popup save', e); res.status(500).json({ error: 'save failed' }); }
});

/* ── Payment portal catalog (Felicia, Jul 29 2026) ──────────
   "Instead of them typing it in, they can choose from a drop down." The things
   people actually pay the Chamber for, with prices, so nobody guesses an amount
   and the office stops making correction calls. Office-editable in
   Admin → Pay Log, and this seed is the list Felicia named on the call —
   she is sending the confirmed prices, which drop straight in here. */
const PAY_ITEMS_KEY = 'payItems';
const PAY_ITEMS_DEFAULT = [
  { label: 'Breakfast tickets', amount: null, note: 'Monthly membership breakfast' },
  { label: 'Mixer tickets', amount: null, note: 'Evening networking mixer' },
  { label: 'Name badge', amount: null, note: 'Member name badge' },
  { label: 'Membership renewal', amount: null, note: 'Annual renewal — amount varies by level' },
  { label: 'New membership', amount: null, note: 'First-year dues' },
  { label: 'Sponsorship', amount: null, note: 'Event or program sponsorship' },
  { label: 'Program ad', amount: null, note: 'Ad in an event program' },
];
function cleanPayItems(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, 40).map((i) => ({
    label: String((i && i.label) || '').slice(0, 80),
    // null = "the office will tell you" → the payer types the amount.
    amount: i && i.amount !== '' && i.amount != null && !isNaN(Number(i.amount)) ? Number(i.amount) : null,
    note: String((i && i.note) || '').slice(0, 140),
  })).filter((i) => i.label);
}
async function loadPayItems() {
  try {
    const raw = await repo.getSetting(PAY_ITEMS_KEY);
    if (!raw) return PAY_ITEMS_DEFAULT;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const clean = cleanPayItems(parsed);
    return clean.length ? clean : PAY_ITEMS_DEFAULT;
  } catch (e) { return PAY_ITEMS_DEFAULT; }
}
router.get('/pay-items', async (_req, res) => {
  try { res.json({ ok: true, items: await loadPayItems() }); }
  catch (e) { res.json({ ok: true, items: PAY_ITEMS_DEFAULT }); }
});
router.get('/admin/pay-items', requireAdmin, async (_req, res) => {
  try { res.json({ ok: true, items: await loadPayItems() }); }
  catch (e) { res.status(500).json({ error: 'Could not load the payment list.' }); }
});
router.post('/admin/pay-items', requireAdmin, async (req, res) => {
  try {
    const items = cleanPayItems(req.body && req.body.items);
    await repo.setSetting(PAY_ITEMS_KEY, JSON.stringify(items));
    res.json({ ok: true, items });
  } catch (e) { console.error('pay-items save', e); res.status(500).json({ error: 'Could not save the payment list.' }); }
});

/* ══ Photo albums (Diana, Jul 30 2026) ══════════════════════════════════
   "A photo gallery for the Black and White Gala … a photo gallery for events
   or whatever the admins want to create. Especially to associate with the
   groups so that the members and group managers are encouraged to share
   activity. All the images should be shareable to social."

   An album is ONE post row (type 'album') carrying its photos in `meta`, not a
   row per photo — adding a photo is a single PATCH, and an album renders from
   one fetch. It can hang off an event, a group, both, or neither (a standalone
   album like the Gala). Per Michael, uploads go live immediately: no approval
   queue, because a queue is exactly the friction that stops members posting.
   Captions still run through flagContent, and the office can lock an album. */
const ALBUM_PHOTO_CAP = 300;
/* A photo URL is rendered both as <img src> AND as the <a href> behind the
   lightbox, so it has to be scheme-checked — clampUrl only trims length, and a
   `javascript:` href would run on click. Site-relative, http(s) and inline
   image data only. */
function safePhotoUrl(raw) {
  const u = clampUrl(raw);
  if (!u) return '';
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(u)) return u;
  return '';
}
function cleanPhotos(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, ALBUM_PHOTO_CAP).map((p) => {
    const url = safePhotoUrl(typeof p === 'string' ? p : (p && p.url));
    if (!url) return null;
    return {
      url,
      // Grid thumbnail. The album page used to put the FULL-SIZE photo in every
      // grid tile, so a 180-photo album pulled ~30MB on a phone before anyone
      // clicked anything. Optional and back-compatible: photos saved before
      // this have no thumb and simply fall back to `url` (Aug 5 2026, for the
      // 683-photo Gala set).
      thumb: safePhotoUrl(p && p.thumb) || '',
      caption: String((p && p.caption) || '').slice(0, 180),
      by: String((p && p.by) || '').slice(0, 80),
      at: (p && p.at) || new Date().toISOString(),
    };
  }).filter(Boolean);
}
function albumOut(p, full) {
  const meta = p.meta || {};
  const photos = Array.isArray(meta.photos) ? meta.photos : [];
  const base = {
    id: p.id,
    title: p.title || 'Photos',
    body: p.body || '',
    // Cover falls back to the first photo, so an album is never a blank card.
    // Prefer its thumbnail: the gallery page shows every album's cover at card
    // size, so full-size covers made that page heavy for no visible gain.
    cover: p.imageUrl || (photos[0] && (photos[0].thumb || photos[0].url)) || '',
    count: photos.length,
    eventId: meta.eventId || '',
    groupSlug: meta.groupSlug || '',
    locked: !!meta.locked,
    music: meta.music || '',
    musicCredit: meta.musicCredit || '',
    created: p.created,
  };
  return full ? { ...base, photos } : base;
}
async function loadAlbums() {
  return (await repo.listPosts({ type: 'album', status: 'approved' }));
}
router.get('/albums', async (req, res) => {
  try {
    const ev = String(req.query.event || '').trim();
    const grp = String(req.query.group || '').trim().toLowerCase();
    let list = await loadAlbums();
    if (ev) list = list.filter((p) => (p.meta || {}).eventId === ev);
    if (grp) list = list.filter((p) => String((p.meta || {}).groupSlug || '').toLowerCase() === grp);
    res.json({ ok: true, albums: list.map((p) => albumOut(p, false)) });
  } catch (e) { console.error('albums list', e); res.json({ ok: true, albums: [] }); }
});
router.get('/albums/:id', async (req, res) => {
  try {
    const p = (await loadAlbums()).find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Album not found.' });
    res.json({ ok: true, album: albumOut(p, true) });
  } catch (e) { console.error('album get', e); res.status(500).json({ error: 'Could not load the album.' }); }
});
// Shared writer for both the admin editor and a member adding shots.
async function saveAlbum(id, body, existing) {
  const meta = { ...((existing && existing.meta) || {}) };
  if (body.photos !== undefined) meta.photos = cleanPhotos(body.photos);
  if (body.eventId !== undefined) meta.eventId = String(body.eventId || '').slice(0, 60);
  if (body.groupSlug !== undefined) meta.groupSlug = String(body.groupSlug || '').slice(0, 80);
  if (body.locked !== undefined) meta.locked = !!body.locked;
  // Optional soundtrack for the slideshow ("Play as a video"). Scheme-checked
  // like a photo URL — it becomes an <audio src> on a public page. Office-only:
  // the member photo-add route never reaches saveAlbum's music branch.
  if (body.music !== undefined) meta.music = safePhotoUrl(body.music);
  if (body.musicCredit !== undefined) meta.musicCredit = String(body.musicCredit || '').slice(0, 200);
  meta.photos = cleanPhotos(meta.photos);
  const patch = {
    title: String(body.title || (existing && existing.title) || 'Photos').slice(0, 120),
    body: String(body.body != null ? body.body : ((existing && existing.body) || '')).slice(0, 2000),
    imageUrl: body.cover !== undefined ? safePhotoUrl(body.cover) : ((existing && existing.imageUrl) || ''),
    status: 'approved',
    meta,
  };
  if (existing) { await repo.updatePost(id, patch); return { ...existing, ...patch }; }
  const post = { id, type: 'album', authorId: body.authorId || '', authorName: body.authorName || '', ...patch };
  await repo.addPost(post);
  return post;
}
router.post('/admin/albums', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.title || '').trim()) return res.status(400).json({ error: 'Give the album a name.' });
    const id = 'alb-' + Date.now().toString(36);
    const saved = await saveAlbum(id, { ...b, authorName: req.user.name || 'Chamber office' }, null);
    res.json({ ok: true, album: albumOut(saved, true) });
  } catch (e) { console.error('album create', e); res.status(500).json({ error: 'Could not create the album.' }); }
});
router.patch('/admin/albums/:id', requireAdmin, async (req, res) => {
  try {
    const existing = (await repo.listPosts({ type: 'album' })).find((x) => x.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Album not found.' });
    const saved = await saveAlbum(req.params.id, req.body || {}, existing);
    res.json({ ok: true, album: albumOut(saved, true) });
  } catch (e) { console.error('album save', e); res.status(500).json({ error: 'Could not save the album.' }); }
});
router.delete('/admin/albums/:id', requireAdmin, async (req, res) => {
  try { await repo.deletePost(req.params.id); res.json({ ok: true }); }
  catch (e) { console.error('album delete', e); res.status(500).json({ error: 'Could not delete the album.' }); }
});
/* Members and group managers adding to an album. This is the whole point of
   the feature per Diana — the people who were AT the mixer have the photos. */
router.get('/me/albums', auth.requireAuth(), async (req, res) => {
  try {
    // groupsLedBy, not managedGroups — a roster chair (Leader/Chair/Co-Chair)
    // leads her group everywhere else on the site, so she can manage its
    // albums too (Aug 20 2026; before this, only the named manager email
    // counted and most groups name the office).
    const mine = (await groupsLedBy(req.user)).map((g) => String(g.slug).toLowerCase());
    res.json({
      ok: true,
      canAdd: !!req.user.mid || mine.length > 0,
      myGroups: mine,
      albums: (await loadAlbums()).map((p) => albumOut(p, false)),
    });
  } catch (e) { console.error('me albums', e); res.json({ ok: true, canAdd: false, myGroups: [], albums: [] }); }
});
router.post('/me/albums/:id/photos', auth.requireAuth(), async (req, res) => {
  try {
    const existing = (await repo.listPosts({ type: 'album' })).find((x) => x.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Album not found.' });
    const meta = existing.meta || {};
    const managed = (await groupsLedBy(req.user)).map((g) => String(g.slug).toLowerCase());
    const managesThis = meta.groupSlug && managed.includes(String(meta.groupSlug).toLowerCase());
    if (meta.locked && !managesThis) {
      return res.status(403).json({ error: 'This album is closed to new photos — contact the Chamber office.' });
    }
    if (!req.user.mid && !managed.length) {
      return res.status(403).json({ error: 'Only Chamber members can add photos.' });
    }
    const adding = cleanPhotos(req.body && req.body.photos);
    if (!adding.length) return res.status(400).json({ error: 'Pick at least one photo.' });
    const bad = flagContent(adding.map((p) => p.caption).join(' '));
    if (bad) return res.status(400).json({ error: bad });
    let who = req.user.name || req.user.sub;
    try { who = (await loadMembersFull()).members.find((m) => m.id === req.user.mid)?.name || who; } catch (e) {}
    const stamped = adding.map((p) => ({ ...p, by: p.by || who }));
    const photos = cleanPhotos([...(meta.photos || []), ...stamped]);
    if (photos.length > ALBUM_PHOTO_CAP) return res.status(400).json({ error: `An album holds up to ${ALBUM_PHOTO_CAP} photos.` });
    await repo.updatePost(existing.id, { meta: { ...meta, photos } });
    res.json({ ok: true, added: stamped.length, count: photos.length });
  } catch (e) { console.error('album add photos', e); res.status(500).json({ error: 'Could not add the photos.' }); }
});

/* ══ Ambassador / volunteer tracker (Felicia, Jul 29 2026) ══
   "We have ambassadors that volunteer for things and they can accumulate
   points." An ambassador signs in, claims a role at an upcoming event
   ("registration at the Aug 5 breakfast"), and the office sees who covered
   what plus a running total per person. Tiers are point thresholds the office
   sets, because Felicia said they had not settled on names yet. */
/* Points are OFF until the Chamber decides it wants a scoring system. Felicia,
   Jul 30 2026: "Points taking a backseat. We do not have a point system at this
   moment." Members were being shown a big points total and a tier name for a
   scheme that does not exist. The tracker still records who covered which role
   at which event — that part is useful on its own — it just stops keeping
   score. The office flips this on from Admin → Ambassador Tracker when they
   have settled on one. */
const VOL_POINTS_KEY = 'volunteerPointsOn';
async function pointsOn() {
  try { return String(await repo.getSetting(VOL_POINTS_KEY) || '') === '1'; }
  catch { return false; }
}
const VOL_TIERS_KEY = 'volunteerTiers';
const VOL_TIERS_DEFAULT = [
  { name: 'Bronze Ambassador', min: 0 },
  { name: 'Silver Ambassador', min: 25 },
  { name: 'Gold Ambassador', min: 60 },
  { name: 'Platinum Ambassador', min: 120 },
];
// Starting point for events that have no roles set — the tasks Felicia named
// plus the usual mixer/breakfast jobs. The office edits these per event.
const VOL_ROLE_SUGGESTIONS = [
  { role: 'Registration / check-in', points: 10, needed: 2 },
  { role: 'Greeter', points: 8, needed: 2 },
  { role: 'Setup', points: 8, needed: 2 },
  { role: 'Cleanup / breakdown', points: 8, needed: 2 },
  { role: 'Raffle / prizes', points: 6, needed: 1 },
  { role: 'Photographer', points: 6, needed: 1 },
  { role: 'Name badges', points: 6, needed: 1 },
];
function cleanTiers(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, 12).map((t) => ({
    name: String((t && t.name) || '').slice(0, 60),
    min: Math.max(0, Math.min(100000, Number(t && t.min) || 0)),
  })).filter((t) => t.name).sort((a, b) => a.min - b.min);
}
async function loadTiers() {
  try {
    const raw = await repo.getSetting(VOL_TIERS_KEY);
    if (!raw) return VOL_TIERS_DEFAULT;
    const clean = cleanTiers(typeof raw === 'string' ? JSON.parse(raw) : raw);
    return clean.length ? clean : VOL_TIERS_DEFAULT;
  } catch (e) { return VOL_TIERS_DEFAULT; }
}
const tierFor = (tiers, pts) => {
  let out = tiers[0] ? tiers[0].name : '';
  for (const t of tiers) if (pts >= t.min) out = t.name;
  return out;
};
// Only confirmed shifts count toward points — a no-show should not earn a tier.
const countsForPoints = (v) => v.status !== 'no-show';

// What an ambassador can sign up for: upcoming events that have roles defined,
// with the remaining headcount per role.
router.get('/me/volunteer/openings', auth.requireAuth(), async (_req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const events = (await loadEvents()).filter((e) =>
      e.date && e.date >= today && (e.status || 'approved') === 'approved'
      && Array.isArray(e.volunteerRoles) && e.volunteerRoles.length);
    const signups = await repo.listVolunteers({});
    const out = events
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((e) => ({
        id: e.id, title: e.title, date: e.date, time: e.time || '', venue: e.venue || '',
        roles: e.volunteerRoles.map((r) => {
          const taken = signups.filter((s) => s.eventId === e.id && s.role === r.role && s.status !== 'no-show').length;
          return { ...r, taken, open: Math.max(0, r.needed - taken) };
        }),
      }));
    res.json({ ok: true, events: out, pointsOn: await pointsOn() });
  } catch (e) { console.error('volunteer openings', e); res.status(500).json({ error: 'Could not load the volunteer list.' }); }
});

// My shifts + my running total and tier.
router.get('/me/volunteer', auth.requireAuth(), async (req, res) => {
  try {
    if (!req.user.mid) return res.json({ ok: true, mine: [], points: 0, tier: '' });
    const mine = await repo.listVolunteers({ memberId: req.user.mid });
    const tiers = await loadTiers();
    const points = mine.filter(countsForPoints).reduce((s, v) => s + (Number(v.points) || 0), 0);
    const on = await pointsOn();
    res.json({ ok: true, mine, points, tier: tierFor(tiers, points), tiers, pointsOn: on });
  } catch (e) { res.status(500).json({ error: 'Could not load your volunteer history.' }); }
});

router.post('/me/volunteer', auth.requireAuth(), async (req, res) => {
  const mid = req.user.mid;
  if (!mid) return res.status(400).json({ error: 'No member listing is linked to this account.' });
  const b = req.body || {};
  try {
    const ev = (await loadEvents()).find((e) => e.id === b.eventId);
    if (!ev) return res.status(404).json({ error: 'That event no longer exists.' });
    const role = (ev.volunteerRoles || []).find((r) => r.role === b.role);
    if (!role) return res.status(400).json({ error: 'That volunteer role is not on this event.' });
    const existing = await repo.listVolunteers({ eventId: ev.id });
    if (existing.some((v) => v.memberId === mid && v.role === role.role)) {
      return res.status(409).json({ error: 'You are already signed up for that role at this event.' });
    }
    const taken = existing.filter((v) => v.role === role.role && v.status !== 'no-show').length;
    if (taken >= role.needed) return res.status(409).json({ error: 'That role is already fully covered — thank you though! Try another one.' });
    const m = await myMember(mid);
    await repo.addVolunteer({
      id: 'vol-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      eventId: ev.id, eventTitle: ev.title || '', eventDate: ev.date || '',
      memberId: mid,
      name: (m && (m.contactName || m.name)) || req.user.sub,
      email: (m && m.email) || req.user.sub, phone: (m && m.phone) || '',
      role: role.role, points: Number(role.points) || 0,
      status: 'signed-up', note: String(b.note || '').slice(0, 300),
    });
    res.json({ ok: true });
  } catch (e) { console.error('volunteer signup', e); res.status(500).json({ error: 'Could not sign you up — please try again.' }); }
});

router.delete('/me/volunteer/:id', auth.requireAuth(), async (req, res) => {
  try {
    const mine = await repo.listVolunteers({ memberId: req.user.mid });
    if (!mine.some((v) => v.id === req.params.id)) return res.status(404).json({ error: 'That sign-up is not yours.' });
    await repo.deleteVolunteer(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Could not cancel that sign-up.' }); }
});

// Admin: every shift, plus the leaderboard the office asked to "look and see".
router.get('/admin/volunteers', requireAdmin, async (req, res) => {
  try {
    const all = await repo.listVolunteers(req.query.event ? { eventId: req.query.event } : {});
    const tiers = await loadTiers();
    const byPerson = new Map();
    for (const v of await repo.listVolunteers({})) {
      const key = v.memberId || (v.email || v.name || '').toLowerCase();
      if (!key) continue;
      const cur = byPerson.get(key) || { key, name: v.name, email: v.email || '', memberId: v.memberId || '', points: 0, shifts: 0, lastDate: '' };
      cur.shifts++;
      if (countsForPoints(v)) cur.points += Number(v.points) || 0;
      if (String(v.eventDate || '') > String(cur.lastDate)) cur.lastDate = v.eventDate || '';
      byPerson.set(key, cur);
    }
    const leaderboard = [...byPerson.values()]
      .map((p) => ({ ...p, tier: tierFor(tiers, p.points) }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    res.json({ ok: true, volunteers: all, leaderboard, tiers, roleSuggestions: VOL_ROLE_SUGGESTIONS });
  } catch (e) { console.error('admin volunteers', e); res.status(500).json({ error: 'Could not load the volunteer tracker.' }); }
});

// Add a helper by hand — plenty of ambassadors sign up by phone or in person.
router.post('/admin/volunteers', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'Whose name should go on the shift?' });
  try {
    let ev = null;
    if (b.eventId) ev = (await loadEvents()).find((e) => e.id === b.eventId) || null;
    const role = String(b.role || '').slice(0, 80);
    const fromEvent = ev && (ev.volunteerRoles || []).find((r) => r.role === role);
    await repo.addVolunteer({
      id: 'vol-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      eventId: ev ? ev.id : '', eventTitle: ev ? (ev.title || '') : String(b.eventTitle || '').slice(0, 200),
      eventDate: ev ? (ev.date || '') : String(b.eventDate || '').slice(0, 10),
      memberId: String(b.memberId || '') || null,
      name, email: String(b.email || '').slice(0, 160), phone: String(b.phone || '').slice(0, 40),
      role,
      points: b.points != null && b.points !== '' ? Math.max(0, Math.min(100, Number(b.points) || 0)) : (fromEvent ? fromEvent.points : 0),
      status: ['signed-up', 'confirmed', 'no-show'].includes(b.status) ? b.status : 'confirmed',
      note: String(b.note || '').slice(0, 300),
    });
    res.json({ ok: true });
  } catch (e) { console.error('admin volunteer add', e); res.status(500).json({ error: 'Could not add that volunteer.' }); }
});

router.patch('/admin/volunteers/:id', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.status !== undefined) {
    if (!['signed-up', 'confirmed', 'no-show'].includes(b.status)) return res.status(400).json({ error: 'Unknown status.' });
    patch.status = b.status;
  }
  if (b.points !== undefined) patch.points = Math.max(0, Math.min(100, Number(b.points) || 0));
  if (b.role !== undefined) patch.role = String(b.role).slice(0, 80);
  if (b.note !== undefined) patch.note = String(b.note).slice(0, 300);
  try {
    const ok = await repo.updateVolunteer(req.params.id, patch);
    if (!ok) return res.status(404).json({ error: 'That shift no longer exists.' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Could not save that change.' }); }
});

router.delete('/admin/volunteers/:id', requireAdmin, async (req, res) => {
  try { await repo.deleteVolunteer(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'Could not remove that shift.' }); }
});

router.get('/admin/volunteer-tiers', requireAdmin, async (_req, res) => {
  try { res.json({ ok: true, tiers: await loadTiers(), pointsOn: await pointsOn() }); }
  catch (e) { res.status(500).json({ error: 'Could not load the tiers.' }); }
});
router.post('/admin/volunteer-tiers', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    // The points switch rides along with the tiers — they are the same decision.
    if (b.pointsOn !== undefined) await repo.setSetting(VOL_POINTS_KEY, b.pointsOn ? '1' : '0');
    const tiers = cleanTiers(b.tiers);
    await repo.setSetting(VOL_TIERS_KEY, JSON.stringify(tiers));
    res.json({ ok: true, tiers, pointsOn: await pointsOn() });
  } catch (e) { res.status(500).json({ error: 'Could not save the tiers.' }); }
});

// CSV of every shift — the office keeps this history in Excel today.
router.get('/admin/volunteers.csv', requireAdmin, async (_req, res) => {
  try {
    const all = await repo.listVolunteers({});
    const tiers = await loadTiers();
    const totals = new Map();
    for (const v of all) {
      const k = v.memberId || (v.email || v.name || '').toLowerCase();
      if (countsForPoints(v)) totals.set(k, (totals.get(k) || 0) + (Number(v.points) || 0));
    }
    const cell = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const rows = [['Date', 'Event', 'Volunteer', 'Email', 'Phone', 'Task', 'Points', 'Status', 'Running total', 'Tier', 'Note']];
    for (const v of all) {
      const k = v.memberId || (v.email || v.name || '').toLowerCase();
      const tot = totals.get(k) || 0;
      rows.push([v.eventDate, v.eventTitle, v.name, v.email, v.phone, v.role, v.points, v.status, tot, tierFor(tiers, tot), v.note]);
    }
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="ambassador-tracker.csv"')
      .send(rows.map((r) => r.map(cell).join(',')).join('\r\n'));
  } catch (e) { res.status(500).send('export failed'); }
});

/* ── Community Benefit Foundation donation projects ─────────
   Felicia, Jul 29 2026: "We used to have a donation page for our Community
   Benefit Foundation... it pertained to each of the individual Community
   Benefit Foundation events." The legacy site did this with
   choose_donation_project.php; the initiatives here come from the Chamber's own
   archived CBF page (beautification, education, Adopt-A-School, Earth Day and
   tree planting), and the office can add or retire them without a developer. */
const DONATION_PROJECTS_KEY = 'donationProjects';
const DONATION_PROJECTS_DEFAULT = [
  { key: 'Beautification & Community Cleanups', blurb: 'Supplies and equipment for the Saturday cleanups — graffiti removal, weed cutting, litter pickup and parkway care across the West Valley.', cbf: true, active: true },
  { key: 'Earth Day & Tree Planting', blurb: 'Earth Day events and tree giveaways with the neighborhood councils. Over 500 trees planted in the West Valley so far.', cbf: true, active: true },
  { key: 'Education & Youth Programs', blurb: 'Career days, Get Empowered / Get Employed workshops, and education and art grants for West Valley students.', cbf: true, active: true },
  { key: 'Adopt-A-School Program', blurb: 'Connects West Valley businesses with local schools through cash grants and supplies — $500 minimum per adoption.', cbf: true, active: true },
  { key: 'Community Benefit Foundation — General Fund', blurb: 'Goes wherever the need is greatest across the Foundation\'s beautification and education work.', cbf: true, active: true },
  { key: 'Grateful Hearts', blurb: 'Honoring and supporting our local LAPD and LAFD first responders.', cbf: false, active: true },
  { key: 'Valley Asian Cultural Festival', blurb: 'Celebrating the Valley\'s vibrant Asian and Pacific Islander communities.', cbf: false, active: true },
];
function cleanDonationProjects(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, 40).map((p) => ({
    key: String((p && p.key) || '').slice(0, 120),
    blurb: String((p && p.blurb) || '').slice(0, 400),
    cbf: !!(p && p.cbf),
    active: p && p.active === false ? false : true,
  })).filter((p) => p.key);
}
async function loadDonationProjects() {
  try {
    const raw = await repo.getSetting(DONATION_PROJECTS_KEY);
    if (!raw) return DONATION_PROJECTS_DEFAULT;
    const clean = cleanDonationProjects(typeof raw === 'string' ? JSON.parse(raw) : raw);
    return clean.length ? clean : DONATION_PROJECTS_DEFAULT;
  } catch (e) { return DONATION_PROJECTS_DEFAULT; }
}
router.get('/donation-projects', async (req, res) => {
  try {
    let list = (await loadDonationProjects()).filter((p) => p.active);
    if (req.query.cbf === '1') list = list.filter((p) => p.cbf);
    res.json({ ok: true, projects: list });
  } catch (e) { res.json({ ok: true, projects: DONATION_PROJECTS_DEFAULT.filter((p) => p.active) }); }
});
router.get('/admin/donation-projects', requireAdmin, async (_req, res) => {
  try { res.json({ ok: true, projects: await loadDonationProjects() }); }
  catch (e) { res.status(500).json({ error: 'Could not load the donation projects.' }); }
});
router.post('/admin/donation-projects', requireAdmin, async (req, res) => {
  try {
    const projects = cleanDonationProjects(req.body && req.body.projects);
    await repo.setSetting(DONATION_PROJECTS_KEY, JSON.stringify(projects));
    res.json({ ok: true, projects });
  } catch (e) { console.error('donation-projects save', e); res.status(500).json({ error: 'Could not save the donation projects.' }); }
});

/* ── Custom payment link (Felicia + Michael, Jul 29 2026) ───
   The invoice equivalent: the office names the charge and the amount, gets a
   link, and can email it from the site. `lock=1` freezes the amount so the
   payer can't fat-finger $2,000 instead of $200. */
router.post('/admin/payment-link', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const what = String(b.for || '').trim().slice(0, 120);
  const amount = Number(b.amount);
  if (!what) return res.status(400).json({ error: 'Describe what the payment is for.' });
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount greater than zero.' });
  const origin = process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
  const qs = new URLSearchParams({ type: 'payment', for: what, amount: amount.toFixed(2) });
  if (b.lock !== false) qs.set('lock', '1');
  const url = `${origin}/checkout.html?${qs}`;

  // Nothing to send → just hand back the link for the office to paste.
  const to = String(b.to || '').trim();
  if (!to) return res.json({ ok: true, url, sent: false });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'That email address does not look right.' });

  const who = String(b.name || '').trim().slice(0, 80);
  const note = String(b.message || '').trim().slice(0, 1200);
  const subject = String(b.subject || '').trim().slice(0, 140)
    || `Your payment link — ${what} ($${amount.toFixed(2)})`;
  const text = [
    who ? `Hi ${who},` : 'Hello,',
    '',
    note || `Here is your secure payment link for ${what}.`,
    '',
    `${what} — $${amount.toFixed(2)}`,
    url,
    '',
    'The link opens our secure checkout. Card details are encrypted and never stored on our site.',
    '',
    'Thank you,',
    'West Valley · Warner Center Chamber of Commerce',
    '(818) 347-4737',
  ].join('\n');
  const html = `<p>${who ? `Hi ${esc(who)},` : 'Hello,'}</p>
    <p>${esc(note || `Here is your secure payment link for ${what}.`).replace(/\n/g, '<br>')}</p>
    <table role="presentation" style="border-collapse:collapse;margin:18px 0">
      <tr><td style="padding:10px 14px;border:1px solid #dcd6c4;background:#faf8f3">
        <strong>${esc(what)}</strong><br><span style="font-size:1.3rem;color:#12241a">$${amount.toFixed(2)}</span>
      </td></tr></table>
    <p><a href="${esc(url)}" style="display:inline-block;background:#C9A227;color:#12241a;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Pay securely →</a></p>
    <p style="font-size:.85rem;color:#5d6b63">Or paste this into your browser:<br>${esc(url)}</p>
    <p style="font-size:.85rem;color:#5d6b63">Card details are encrypted and never stored on our site.</p>
    <p>Thank you,<br><strong>West Valley · Warner Center Chamber of Commerce</strong><br>(818) 347-4737</p>`;
  try {
    const r = await email.send({ to, subject, text, html, replyTo: email.notifyTo() });
    // `skipped` = no mail provider configured; the link is still valid, but the
    // office needs to know it has to send it by hand.
    const sent = !!(r && r.ok !== false && !r.skipped);
    res.json({
      ok: true, url, sent, provider: email.provider(),
      ...(sent ? {} : { error: 'The link is ready, but the website could not send the email — copy the link and send it yourself.' }),
    });
  } catch (e) {
    console.error('payment-link send', e);
    res.json({ ok: true, url, sent: false, error: 'The link is ready, but the email could not be sent — copy the link and send it yourself.' });
  }
});

// Pricing catalog (memberships, donation presets, ticket convention).
let _skus = null;
function readSkus() {
  if (!_skus) { try { _skus = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'skus.json'), 'utf8')); } catch { _skus = { memberships: [], donations: [] }; } }
  return _skus;
}
router.get('/skus', (_req, res) => res.json(readSkus()));

// Distinct category list (for the member category picker + facets).
router.get('/categories', async (_req, res) => {
  try {
    const { members } = await loadMembersPublic();
    const set = new Set();
    for (const m of members) {
      if (m.category) set.add(m.category);
      if (Array.isArray(m.categories)) m.categories.forEach((c) => c && set.add(c));
    }
    res.json({ categories: [...set].sort((a, b) => a.localeCompare(b)) });
  } catch (e) { res.status(500).json({ error: 'categories unavailable' }); }
});

// Recently active members (signed in most recently) — for the homepage rotation.
router.get('/members/recent', async (_req, res) => {
  try {
    const ids = await users.recentMemberIds(8);
    const all = (await loadMembersPublic()).members;
    const byId = Object.fromEntries(all.map((m) => [m.id, m]));
    const members = ids.map((id) => byId[id]).filter(Boolean); // approved + public only
    res.json({ members });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

router.get('/members/:id', async (req, res) => {
  try {
    const key = req.params.id;
    const m = (await loadMembersPublic()).members.find((x) => x.id === key || x.slug === key);
    if (!m) return res.status(404).json({ error: 'not found' });
    res.json(m);
  } catch (e) { res.status(500).json({ error: 'directory unavailable' }); }
});

// ── Coupons (checkout promo codes) ──────────────────────────
// Shared validation: exists, active, unexpired, uses left, applies to this purchase.
async function validCoupon(code, kind, sku) {
  const c = await repo.getCoupon(code);
  if (!c) return { ok: false, error: 'Unknown promo code.' };
  if (!c.active) return { ok: false, error: 'This promo code is no longer active.' };
  if (c.expiresAt && Date.now() > Date.parse(c.expiresAt)) return { ok: false, error: 'This promo code has expired.' };
  if (c.maxUses != null && c.used >= c.maxUses) return { ok: false, error: 'This promo code has reached its limit.' };
  const scope = c.appliesTo || 'all';
  const applies = scope === 'all'
    || scope === kind
    || (scope.startsWith('event:') && String(sku || '').startsWith('ticket:' + scope.slice(6)));
  if (!applies) return { ok: false, error: 'This promo code does not apply to this purchase.' };
  return { ok: true, coupon: c };
}
const couponDiscount = (c, amount) => c.kind === 'fixed'
  ? Math.min(Number(c.amount), amount)
  : Math.round(amount * Number(c.amount)) / 100;

// Public: pre-check a code at checkout (server recomputes at /pay regardless).
router.get('/coupons/:code/validate', async (req, res) => {
  try {
    const v = await validCoupon(req.params.code, req.query.kind || 'ticket', req.query.sku || '');
    if (!v.ok) return res.json(v);
    const amt = Math.max(0, Number(req.query.amount) || 0);
    res.json({ ok: true, code: v.coupon.code, kind: v.coupon.kind, amount: v.coupon.amount,
      discount: amt ? couponDiscount(v.coupon, amt) : undefined });
  } catch (e) { res.status(500).json({ ok: false, error: 'validation failed' }); }
});

router.get('/admin/coupons', requireAdmin, async (_req, res) => {
  try { res.json({ coupons: await repo.listCoupons() }); }
  catch (e) { res.status(500).json({ error: 'coupons failed' }); }
});
router.post('/admin/coupons', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.code || !/^[A-Za-z0-9-]{3,24}$/.test(b.code)) return res.status(400).json({ error: 'Code: 3-24 letters/numbers/dashes.' });
  const amount = Number(b.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'Amount must be greater than 0.' });
  if (b.kind === 'percent' && amount > 100) return res.status(400).json({ error: 'Percent cannot exceed 100.' });
  try {
    const coupon = await repo.upsertCoupon({
      code: b.code, description: String(b.description || '').slice(0, 200),
      kind: b.kind === 'fixed' ? 'fixed' : 'percent', amount,
      appliesTo: String(b.appliesTo || 'all').slice(0, 60),
      expiresAt: b.expiresAt ? new Date(b.expiresAt).toISOString() : null,
      maxUses: b.maxUses ? Math.max(1, parseInt(b.maxUses, 10)) : null,
      active: b.active !== false,
    });
    res.json({ ok: true, coupon });
  } catch (e) { console.error('coupon save', e); res.status(500).json({ error: 'could not save' }); }
});
router.delete('/admin/coupons/:code', requireAdmin, async (req, res) => {
  try { await repo.deleteCoupon(req.params.code); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'delete failed' }); }
});

// ── Payments (AGMS) ─────────────────────────────────────────
router.post('/pay', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.paymentToken) return res.status(400).json({ ok: false, error: 'missing payment token' });
    if (!b.amount || Number(b.amount) <= 0) return res.status(400).json({ ok: false, error: 'invalid amount' });
    // Contact info is REQUIRED on every payment (Felicia, Aug 19 2026 call —
    // "Caroline paid and I can't call her to ask what for"). Checked before
    // the card is ever charged, so a refusal here costs nothing.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email || ''))) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email address so we can send your receipt.' });
    }
    if (!String(b.firstName || '').trim() && !String(b.lastName || '').trim() && !String(b.company || '').trim()) {
      return res.status(400).json({ ok: false, error: 'Please enter your name.' });
    }
    if (String(b.phone || '').replace(/\D/g, '').length < 7) {
      return res.status(400).json({ ok: false, error: 'Please enter a phone number so the office can reach you about this payment.' });
    }

    // Server-side price verification: never trust the browser's total for
    // tickets. sku = ticket:<eventId>:<type-slug>; recompute unit price from
    // the event's ticketTypes (honoring the early-bird window) × quantity.
    let amount = Number(b.amount);
    let subtotal = amount;
    if (b.kind === 'ticket') {
      const m = /^ticket:([^:]+):(.+)$/.exec(String(b.sku || ''));
      if (m) {
        const ev = (await loadEvents()).find((e) => e.id === m[1]);
        const t = ev && (ev.ticketTypes || []).find((x) =>
          x.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) === m[2]);
        if (t) {
          if (t.available === false) return res.status(400).json({ ok: false, error: 'That ticket type is no longer available.' });
          const qty = Math.max(1, Math.min(10, parseInt(b.quantity, 10) || 1));
          const unit = (t.earlyPrice != null && t.earlyUntil && Date.now() < Date.parse(t.earlyUntil))
            ? Number(t.earlyPrice) : Number(t.price);
          subtotal = Math.round(unit * qty * 100) / 100;
          // Never silently charge a different amount than the buyer saw
          // (Jul 2026: a "$1 test" became a $200 Gala charge). A mismatched
          // browser total is refused, not overridden.
          if (Math.abs(Number(b.amount) - subtotal) > 0.005) {
            return res.status(400).json({ ok: false,
              error: `The total for ${qty} × ${t.name} is $${subtotal.toFixed(2)} — the page showed a different amount, so no charge was made. Refresh the page and try again.` });
          }
          amount = subtotal;
        }
      }
    }
    // Membership dues follow the same rule as tickets: the price comes from the
    // catalog (data/skus.json), never from the browser. An office-quoted custom
    // amount still goes through when the sku is not in the catalog.
    if (b.kind === 'membership') {
      const item = (readSkus().memberships || []).find((x) => x.sku === String(b.sku || ''));
      if (item && item.amount != null) {
        subtotal = Number(item.amount);
        if (Math.abs(Number(b.amount) - subtotal) > 0.005) {
          return res.status(400).json({ ok: false,
            error: `${item.label} dues are $${subtotal.toFixed(2)} — the page showed a different amount, so no charge was made. Refresh the page and try again.` });
        }
        amount = subtotal;
      }
    }

    // Promo code: validated + applied server-side; use count bumped after approval.
    let coupon = null, discount = 0;
    if (b.couponCode) {
      const v = await validCoupon(b.couponCode, b.kind, b.sku);
      if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
      coupon = v.coupon;
      discount = couponDiscount(coupon, amount);
      amount = Math.round((amount - discount) * 100) / 100;
      if (amount <= 0) return res.status(400).json({ ok: false, error: 'Total after discount must be above $0.' });
    }
    b.amount = amount;

    const common = {
      paymentToken: b.paymentToken,
      email: b.email, firstName: b.firstName, lastName: b.lastName,
      // AVS: gateway requires billing street + ZIP or it declines "AVS REQUIRED"
      address1: b.address1, city: b.city, state: b.state, zip: b.zip,
      orderId: b.sku || b.kind, description: b.description, productSku: b.sku,
    };
    const result = b.kind === 'membership' && b.recurring
      ? await addRecurring({ ...common, planAmount: b.amount, ...b.recurring })
      : await sale({ ...common, amount: b.amount });

    if (!result.approved) {
      // Log the DECLINED attempt too (status 'declined', nothing to refund) so
      // the office can see it in the Pay Log — a declined auth can still leave
      // a temporary "pending" hold on the buyer's bank that drops off on its
      // own in a few days, and an invisible attempt caused real confusion
      // (Felicia, Jul 2026).
      try {
        await repo.addOrder({
          id: 'ord-' + Date.now().toString(36),
          kind: b.kind, sku: b.sku || '', email: b.email || '',
          name: [b.firstName, b.lastName].filter(Boolean).join(' '),
          phone: String(b.phone || '').slice(0, 40), company: String(b.company || '').slice(0, 160),
          address1: String(b.address1 || '').slice(0, 200), city: String(b.city || '').slice(0, 80),
          state: String(b.state || '').slice(0, 20), zip: String(b.zip || '').slice(0, 20),
          memo: String(b.description || '').slice(0, 300),
          amount: Number(b.amount), transactionId: result.transactionId || '',
          status: 'declined',
        });
      } catch (e) { console.error('declined-attempt log failed', e); }
      return res.status(402).json({ ok: false, error: result.responseText || 'declined', code: result.raw.response });
    }
    // Phone, company, and the full "what this is for" description now ride on
    // the order itself (Felicia, Aug 19 2026) — before this they only existed
    // in the receipt email, so the Pay Log couldn't answer "who is this and
    // what did they pay for".
    const order = {
      id: 'ord-' + Date.now().toString(36),
      kind: b.kind, sku: b.sku || '', email: b.email || '',
      name: [b.firstName, b.lastName].filter(Boolean).join(' '),
      phone: String(b.phone || '').slice(0, 40), company: String(b.company || '').slice(0, 160),
      // Billing address (Felicia, Aug 25 2026): it was always collected for
      // AVS but dropped here, so no receipt or applicant view could ever show
      // it. Persisted now — orders from before today simply won't have one.
      address1: String(b.address1 || '').slice(0, 200), city: String(b.city || '').slice(0, 80),
      state: String(b.state || '').slice(0, 20), zip: String(b.zip || '').slice(0, 20),
      memo: String(b.description || '').slice(0, 300),
      amount: Number(b.amount), transactionId: result.transactionId,
      status: 'paid',
    };
    // The card is ALREADY charged past this point — a logging failure must
    // never bubble up as a payment error (the buyer would retry and get
    // double-charged) and must never leave the office blind. If the insert
    // fails, alert the office with the gateway transaction id so the books
    // can be squared from the NMI report.
    try {
      await repo.addOrder(order);
    } catch (e) {
      console.error('CRITICAL: approved charge failed to log', order, e);
      try {
        email.send({
          to: email.notifyTo(),
          subject: `⚠ ALERT: approved charge NOT in Pay Log — $${Number(order.amount).toFixed(2)} (txn ${order.transactionId})`,
          text: `A payment was APPROVED by the gateway but could not be written to the Pay Log.\n\nAmount: $${Number(order.amount).toFixed(2)}\nPayer: ${order.name} ${order.email}\nFor: ${order.kind} ${order.sku}\nGateway transaction: ${order.transactionId}\n\nFind it in the NMI/AGMS gateway reports (agms.transactiongateway.com) — refund or void from there if needed.`,
        }).catch(() => {});
      } catch (e2) { /* alert only */ }
    }
    if (coupon) repo.incrementCouponUse(coupon.code).catch(() => {});
    // Email a receipt to the payer + the Chamber office, styled after the legacy
    // ChamberWare receipts (per Felicia): "Paid Receipt For Tickets <ref>" for
    // event tickets, "Paid Receipt <ref>" for everything else; order table +
    // GUEST INFO + GRAND TOTAL.
    try {
      const amt = '$' + Number(b.amount).toFixed(2);
      const ref = result.transactionId || order.id.replace('ord-', '').toUpperCase();
      const isTicket = b.kind === 'ticket';
      const subject = isTicket ? `Paid Receipt For Tickets ${ref}` : `Paid Receipt ${ref}`;
      const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const row = (k, v) => v ? `<tr><td style="padding:2px 16px 2px 0;font-weight:bold;vertical-align:top;white-space:nowrap">${k}:</td><td style="padding:2px 0">${h(v)}</td></tr>` : '';
      const cardMethod = b.cardType ? b.cardType.charAt(0).toUpperCase() + b.cardType.slice(1) : 'Card';
      const eventLine = isTicket
        ? [b.eventTitle, b.ticketType ? `(${b.ticketType})` : ''].filter(Boolean).join(' ')
        : '';
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:560px;border:1px solid #ccc;padding:20px 24px">
          <img src="https://woodlandhillscc.net/images/wvwccc-logo.png" alt="WVWC Chamber of Commerce" width="72" style="display:block;margin:0 0 12px">
          <p style="color:#188038;font-weight:bold;margin:0">THANK YOU</p>
          <p style="font-weight:bold;margin:2px 0 16px">Order #${h(ref)}</p>
          <table style="border-collapse:collapse;font-size:14px">
            ${row('Name', order.name)}
            ${row('Address', b.address1)}
            ${row('City', b.city)}
            ${row('State', b.state)}
            ${row('Postal Code', b.zip)}
            ${row('Payment Type', b.kind || 'payment')}
            ${row('Paid Method', cardMethod)}
            ${isTicket ? row('Event', eventLine) : row('Description', b.description || b.sku)}
            ${isTicket ? row('Tickets Qty', b.quantity) : ''}
            ${row('Card Number', b.cardLast4 ? 'XXXX-' + b.cardLast4 : '')}
          </table>
          <p style="font-weight:bold;text-decoration:underline;margin:16px 0 4px">GUEST INFO</p>
          <table style="border-collapse:collapse;font-size:14px">
            ${row('Company', b.company)}
            ${row('Name', order.name)}
            ${row('Email', b.email)}
            ${row('Phone', b.phone)}
            ${b.invitedBy ? row('Invited by', String(b.invitedBy).slice(0, 80)) : ''}
            ${(Array.isArray(b.attendees) ? b.attendees.slice(0, 10) : [])
              .map((a, i) => row(`Attendee ${i + 1}`,
                typeof a === 'object' && a
                  ? [String(a.name || '').slice(0, 80), String(a.email || '').slice(0, 80), String(a.phone || a.contact || '').slice(0, 80)].filter(Boolean).join(' · ')
                  : String(a).slice(0, 80))).join('')}
          </table>
          ${coupon ? `<table style="border-collapse:collapse;font-size:14px;margin-top:14px">
            ${row('Subtotal', '$' + subtotal.toFixed(2))}
            ${row(`Discount (${coupon.code})`, '-$' + discount.toFixed(2))}
          </table>` : ''}
          <p style="font-weight:bold;margin:18px 0 0">GRAND TOTAL: ${amt}${b.kind === 'membership' && b.recurring ? ' (annual, recurring)' : ''}</p>
        </div>`;
      const text = `THANK YOU\nOrder #${ref}\n\n`
        + `Name: ${order.name}\n${isTicket ? `Event: ${eventLine}\nTickets Qty: ${b.quantity || 1}\n` : `Description: ${b.description || b.sku || b.kind}\n`}`
        + `${b.cardLast4 ? `Card Number: XXXX-${b.cardLast4}\n` : ''}GRAND TOTAL: ${amt}\n\nWest Valley · Warner Center Chamber of Commerce`;
      if (b.email) email.send({ to: b.email, subject, text, html }).catch(() => {});
      email.send({ to: email.notifyTo(), subject, text, html }).catch(() => {});
    } catch (e) { console.error('receipt email', e); }
    return res.json({ ok: true, transactionId: result.transactionId, authCode: result.authCode });
  } catch (err) {
    console.error('pay error', err);
    return res.status(500).json({ ok: false, error: 'payment processing error' });
  }
});

// ── Contact / lead inquiries ────────────────────────────────
// Spam screening (Felicia, Jul 31 2026: real membership applications were
// drowning in junk). Turnstile is the real gate once its keys are set — this
// layer works today. Suspect leads are STORED with status 'spam' (never
// dropped) and skip the notification emails; the office rescues a real one
// from Admin → Inquiries → Spam by marking it New.
function leadSmellsLikeSpam(b, lead) {
  // Honeypot: a visually hidden field humans never see. Bots fill every box.
  if (String(b._gotcha || '').trim()) return true;
  // Event fields are screened too — they end up in outbound email subjects
  // and bodies, so a URL planted there is exactly as bad as one in the
  // message (Aug 20 2026 review).
  const text = [lead.name, lead.company, lead.message, lead.event, b.eventTitle,
    ...(Array.isArray(b.attendees) ? b.attendees.map((a) => `${(a && a.name) || ''} ${(a && a.email) || ''}`) : [])].join(' ');
  const links = (text.match(/https?:\/\/|www\.[a-z0-9-]/gi) || []).length;
  if (links >= 2) return true;
  const pitch = /(backlinks?|link.?building|guest post|seo (ranking|service|package)|rank (on google|#?1)|page ?(one|1) of google|website traffic|mass (e-?mail|marketing)|buy followers|crypto(currency)?|bitcoin|forex|casino|viagra|cialis|escorts?|adult traffic|loan (offer|approval))/i;
  if (links && pitch.test(text)) return true;
  // The site is English/Spanish — a mostly-Cyrillic message is not a member.
  if ((text.match(/[Ѐ-ӿ]/g) || []).length > 20) return true;
  return false;
}

router.post('/contact', async (req, res) => {
  const b = req.body || {};
  // Bot protection — Cloudflare Turnstile (no-op until TURNSTILE_SECRET is set).
  const cap = await turnstile.verify(b['cf-turnstile-response'] || b.turnstileToken, req.ip);
  if (!cap.ok) return res.status(400).json({ ok: false, error: 'Please complete the human-verification check and try again.' });
  if (!b.email || !(b.message || b.company || b.name)) {
    return res.status(400).json({ ok: false, error: 'Please include your email and a message.' });
  }
  // Length caps, like every other public write in this file. These values are
  // stranger-supplied and end up in the office's inbox, in notification
  // subjects, and (for an approved application) in the welcome email — so an
  // uncapped field is both a mail-bomb payload and a wall of text in Inquiries.
  const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
  const lead = {
    id: 'lead-' + Date.now().toString(36),
    kind: clip(b.kind || 'contact', 40),
    name: clip([b.firstName, b.lastName].filter(Boolean).join(' ') || b.name || '', 160),
    email: clip(b.email, 160), phone: clip(b.phone, 40), company: clip(b.company, 160),
    reason: clip(b.reason || b.kind || '', 120), event: clip(b.event, 200), message: clip(b.message, 5000),
    status: 'new', received: new Date().toISOString(),
  };
  // The address is echoed into the notification's Reply-To, so it has to look
  // like an address — the check above only asked that it be non-empty.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }
  // Membership applications carry extra fields (business type, employee count,
  // level of interest) — keep them in the message so the office sees the full
  // application and one-click approval loses nothing. The business address and
  // representatives (Felicia, Aug 19 2026 call) are ALSO stored structured on
  // the lead, so approval can copy them into the member record.
  if (lead.kind === 'membership-application') {
    lead.address = String(b.address || '').trim().slice(0, 200);
    lead.city = String(b.city || '').trim().slice(0, 80);
    lead.zip = String(b.zip || '').trim().slice(0, 20);
    lead.reps = [];
    for (let i = 1; i <= 4; i++) {
      const nm = String(b['rep' + i + 'Name'] || '').trim().slice(0, 120);
      const em = String(b['rep' + i + 'Email'] || '').trim().slice(0, 160);
      if (nm || em) lead.reps.push({ name: nm, email: em });
    }
  }
  if (lead.kind === 'membership-application' && !lead.message) {
    lead.message = [
      b.businessType ? `Business type: ${String(b.businessType).slice(0, 120)}` : '',
      b.employees ? `Employees: ${String(b.employees).slice(0, 20)}` : '',
      (lead.address || lead.city || lead.zip) ? `Business address: ${[lead.address, lead.city, lead.zip].filter(Boolean).join(', ')}` : '',
      b.nonprofit ? 'Non-profit rate requested: yes (501(c)(3) letter required)' : '',
      b.level ? `Level of interest: ${String(b.level).slice(0, 80)}` : '',
      ...(lead.reps || []).map((r, i) => `Representative ${i + 1}: ${r.name || '—'}${r.email ? ` <${r.email}>` : ''}`),
      b.ribbonCutting ? `Ribbon cutting requested: yes${b.ribbonDate ? ` (preferred ${String(b.ribbonDate).slice(0, 20)})` : ''}` : '',
      b.password ? 'Chose their own website password: yes (active when approved)' : '',
    ].filter(Boolean).join('\n');
  }
  // Applicant-chosen website password (New Member application, like the old
  // site). Hashed IMMEDIATELY — only the bcrypt hash rides on the lead, the
  // plaintext is discarded and never logged or emailed.
  if (b.password && lead.kind === 'membership-application') {
    const pw = String(b.password);
    if (pw.length >= 8 && pw.length <= 100) lead.passwordHash = auth.hashPassword(pw);
  }
  if (leadSmellsLikeSpam(b, lead)) lead.status = 'spam';
  // If the lead references an event by raw id (older pages / direct API), resolve
  // it to the event title so the admin panel + office email are self-explanatory.
  if (lead.event && /^(le|ev|ce)-/.test(lead.event)) {
    try {
      const ev = (await loadEvents()).find((x) => x.id === lead.event);
      if (ev) lead.event = `${ev.title}${ev.date ? ` (${ev.date})` : ''} [${ev.id}]`;
    } catch (e) { /* keep the raw id */ }
  }
  // An event can name its own RSVP address (Felicia, Aug 12 2026 — the old
  // site's "where should the RSVPs go" box). Resolve it from the event id the
  // checkout page carries in brackets, e.g. "Summer Mixer (2026-08-26) [ev-x1]".
  let rsvpTo = '';
  // The REAL event this RSVP references. Besides routing rsvpTo, it gates the
  // guest confirmation below: without it, /api/contact would be an open relay
  // that mails chamber-branded "confirmations" with attacker-typed subjects to
  // any address (found in the Aug 20 2026 review).
  let rsvpEvent = null;
  if (lead.kind === 'rsvp') {
    try {
      const ref = String(lead.event || '');
      const id = (/\[((?:le|ev|ce)-[a-z0-9]+)\]/i.exec(ref) || [])[1]
        || (/^(?:le|ev|ce)-[a-z0-9]+$/i.test(ref) ? ref : '');
      const ev = id && (await loadEvents()).find((x) => x.id === id);
      if (ev && (ev.status || 'approved') === 'approved') rsvpEvent = ev;
      if (rsvpEvent && rsvpEvent.rsvpEmail) rsvpTo = String(rsvpEvent.rsvpEmail).trim().toLowerCase();
    } catch (e) { /* the office copy still goes */ }
  }
  // If the inquiry came from a group page (e.g. a meeting RSVP), notify that
  // group's own leaders. Felicia, Jul 29 2026: the leaders were NOT getting
  // these — routing sent the mail to the manager INSTEAD of the office, so a
  // group with no manager email notified nobody, and the Wendy inbox lost its
  // copy. Now every group leader is emailed AND the Wendy inbox always keeps
  // one, as the log of all activity.
  let notifyTo = email.notifyTo(), groupName = '';
  const leaderTo = [];
  if (b.group) {
    try {
      const g = (await loadGroups()).find((x) => x.slug === b.group || x.id === b.group);
      if (g) {
        groupName = g.name;
        lead.reason = lead.reason || `Group: ${g.name}`;
        const ok = (a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(a || ''));
        const add = (a) => {
          const addr = String(a || '').trim().toLowerCase();
          if (ok(addr) && addr !== String(email.notifyTo()).toLowerCase() && !leaderTo.includes(addr)) leaderTo.push(addr);
        };
        add(g.manager && g.manager.email);
        add(g.contactEmail);
        // Roster leaders too (Leader / Chair / Co-Chair). Entries added from the
        // directory carry only a memberId, so resolve those against the roster.
        try {
          const { members: dir } = await loadMembersFull();
          const emailById = new Map(dir.filter((m) => m.email).map((m) => [m.id, m.email]));
          for (const m of (g.members || [])) {
            if (m.status === 'pending') continue;
            if (!/^(leader|chair|co-chair)$/i.test(String(m.role || ''))) continue;
            add(m.email || emailById.get(m.memberId));
          }
        } catch (e) { /* manager/contact address still gets it */ }
      }
    } catch (e) {}
  }
  try {
    await repo.addLead(lead);
    // A New Member application may carry a ribbon-cutting request (per the
    // Chamber office, Jul 2026 — the application is the only place that offers
    // it). File it as its own inquiry so it lands in the admin's pending
    // Ribbon Cutting queue with its one-click approve.
    if (lead.kind === 'membership-application' && b.ribbonCutting && lead.status !== 'spam') {
      const rcDate = String(b.ribbonDate || '').slice(0, 40);
      try {
        await repo.addLead({
          id: 'lead-' + Date.now().toString(36) + 'r',
          kind: 'ribbon-cutting',
          reason: 'Ribbon Cutting — new member application',
          name: lead.name, email: lead.email, phone: lead.phone, company: lead.company,
          event: rcDate,
          message: `OCCASION: Grand opening / new member ribbon cutting\nBUSINESS: ${lead.company || lead.name}\nPREFERRED DATE: ${rcDate || '—'}\n\n(Requested on the New Member application.)`,
          status: 'new', received: new Date().toISOString(),
        });
      } catch (e) { console.error('ribbon lead from application failed', e); }
    }
    res.json({ ok: true });
    // Inquiry notification emails to the OFFICE are off by default (per Felicia,
    // Jul 2026 — she only wants payment receipts by email; every inquiry is
    // visible under Admin → Inquiries). Re-enable with INQUIRY_EMAILS=on.
    // Group inquiries still notify that group's own manager either way.
    const officeWantsEmail = String(process.env.INQUIRY_EMAILS || '').toLowerCase() === 'on';
    // Group leaders always get theirs. The Wendy inbox gets a copy whenever a
    // leader was notified (so it stays the complete log) or when the office has
    // inquiry emails switched on.
    // RSVPs always email out (Felicia, Aug 11 2026: "those receipts/
    // notifications need to be generated to me!"): the office gets every one —
    // her July inquiries-off preference predates this and still applies to the
    // other inquiry kinds — and an event that names its own RSVP address gets
    // a copy there too (the poster or their assistant).
    const recipients = [...leaderTo];
    if (rsvpTo) recipients.push(rsvpTo);
    if (officeWantsEmail || leaderTo.length || lead.kind === 'rsvp') recipients.push(notifyTo);
    // Screened spam stays out of everyone's inbox — it waits in Admin →
    // Inquiries → Spam instead.
    if (recipients.length && lead.status !== 'spam') {
      const body = `New ${lead.reason || lead.kind} from the website\n\n`
        + `Name: ${lead.name || '—'}\nEmail: ${lead.email}\nPhone: ${lead.phone || '—'}\n`
        + `Company: ${lead.company || '—'}\nEvent: ${lead.event || '—'}${groupName ? `\nGroup: ${groupName}` : ''}\n\nMessage:\n${lead.message || '—'}\n`
        + `\n—\nAlso filed under Admin → Inquiries on the Chamber website.\n`;
      // An RSVP notification should read like one in the inbox — the event and
      // who's coming, not a generic "Website inquiry".
      const subject = lead.kind === 'rsvp'
        ? `${groupName ? `[${groupName}] ` : ''}New RSVP — ${String(lead.event || 'event').replace(/\s*\[[^\]]*\]\s*$/, '')}${lead.name ? ` (${lead.name})` : ''}`
        : `${groupName ? `[${groupName}] ` : ''}Website inquiry: ${lead.reason || lead.kind}${lead.company ? ' — ' + lead.company : ''}`;
      /* An RSVP notification is laid out like the old site's confirmation
         (Felicia, Aug 18 2026: "We like the look of the old receipts"). Same
         THANK YOU / GUEST INFO shape as the payment receipt above, so the two
         look like they come from the same Chamber. The generic inquiry body is
         kept for every other kind. The raw event id is stripped — it was
         showing in her inbox as "[ev-mruu80zk6qp]". */
      let html = '';
      let text = body;
      if (lead.kind === 'rsvp') {
        const eh = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const row = (k, v) => (v ? `<tr><td style="padding:2px 16px 2px 0;font-weight:bold;vertical-align:top;white-space:nowrap">${k}:</td><td style="padding:2px 0">${eh(v)}</td></tr>` : '');
        const evTitle = String(b.eventTitle || lead.event || '').replace(/\s*\[[^\]]*\]\s*$/, '');
        const qty = Math.max(1, Math.min(50, parseInt(b.quantity, 10) || 1));
        const tier = String(b.ticketType || '').slice(0, 120);
        const guests = (Array.isArray(b.attendees) ? b.attendees : []).slice(0, 20).map((a) => ({
          name: String((a && a.name) || '').slice(0, 120),
          email: String((a && a.email) || '').slice(0, 160),
          phone: String((a && a.phone) || '').slice(0, 40),
        })).filter((a) => a.name || a.email || a.phone);
        html = `
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:560px;border:1px solid #ccc;padding:20px 24px">
          <img src="https://woodlandhillscc.net/images/wvwccc-logo.png" alt="WVWC Chamber of Commerce" width="72" style="display:block;margin:0 0 12px">
          <p style="color:#188038;font-weight:bold;margin:0">THANK YOU</p>
          <table style="border-collapse:collapse;font-size:14px;margin-top:10px">
            ${row('Name', lead.name)}
            ${row('Event', evTitle)}
            ${row('Registration', tier)}
            ${row('RSVP Qty', String(qty))}
            ${groupName ? row('Group', groupName) : ''}
          </table>
          <p style="font-weight:bold;text-decoration:underline;margin:16px 0 4px">GUEST INFO</p>
          <table style="border-collapse:collapse;font-size:14px">
            ${row('Company', lead.company)}
            ${row('Name', lead.name)}
            ${row('Email', lead.email)}
            ${row('Phone', lead.phone)}
          </table>
          ${guests.length ? guests.map((g) => `
          <table style="border-collapse:collapse;font-size:14px;margin-top:10px">
            ${row('Name', g.name)}
            ${row('Email', g.email)}
            ${row('Phone', g.phone)}
          </table>`).join('') : ''}
          <p style="margin:14px 0 0;color:#666;font-size:12px">Also filed under Admin &rarr; Inquiries on the Chamber website.</p>
        </div>`;
        /* "* This is an RSVP only. Please pay at the door." used to close this
           receipt — removed entirely (Felicia, Aug 19 2026 call: members who
           attend free were being told to pay). When an event really does take
           money at the door, that belongs in the event description. */
        text = `THANK YOU\n\n`
          + `Name: ${lead.name || '—'}\nEvent: ${evTitle || '—'}\n`
          + `${tier ? `Registration: ${tier}\n` : ''}RSVP Qty: ${qty}\n${groupName ? `Group: ${groupName}\n` : ''}`
          + `\nGUEST INFO\n`
          + `Company: ${lead.company || '—'}\nName: ${lead.name || '—'}\nEmail: ${lead.email}\nPhone: ${lead.phone || '—'}\n`
          + guests.map((g) => `\nName: ${g.name || '—'}\nEmail: ${g.email || '—'}\nPhone: ${g.phone || '—'}\n`).join('')
          + `\n—\nAlso filed under Admin → Inquiries on the Chamber website.\n`;
      }
      // Individually addressed so leaders never see each other's addresses.
      for (const to of [...new Set(recipients)]) {
        email.send({ to, replyTo: lead.email, subject, text, ...(html ? { html } : {}) })
          .catch((e) => console.error('notify email failed', to, e));
      }
      // The person who RSVP'd gets their own copy (Aug 20 2026) — the screen
      // has promised "a confirmation is on its way to your email" since the
      // start, but nothing was ever sent to them; the receipt only went to
      // leaders and the office. Same THANK YOU box, minus the admin footer.
      // ONLY when the RSVP references a real approved event, and the subject
      // is built from OUR event record, never from submitter-typed text — an
      // unauthenticated route must not mail arbitrary content to arbitrary
      // addresses under the Chamber's own domain.
      if (lead.kind === 'rsvp' && rsvpEvent && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(lead.email || ''))) {
        const guestSubject = `Your RSVP is confirmed — ${String(rsvpEvent.title || 'Chamber event').replace(/[\r\n]+/g, ' ').slice(0, 140)}${rsvpEvent.date ? ` (${rsvpEvent.date})` : ''}`;
        const guestHtml = html.replace(/<p style="margin:14px 0 0;color:#666;font-size:12px">.*?<\/p>/s,
          '<p style="margin:14px 0 0;color:#666;font-size:12px">West Valley &middot; Warner Center Chamber of Commerce &middot; (818)&nbsp;347-4737</p>');
        const guestText = text.replace(/\n—\nAlso filed under Admin → Inquiries on the Chamber website\.\n$/,
          '\n—\nWest Valley · Warner Center Chamber of Commerce · (818) 347-4737\n');
        email.send({ to: lead.email, subject: guestSubject, text: guestText, html: guestHtml })
          .then((r) => { if (r && (r.skipped || r.ok === false)) console.error('rsvp guest confirmation not sent', r.error || 'mailer not configured'); });
      }
    }
  } catch (e) { console.error('lead save failed', e); res.status(500).json({ ok: false, error: 'could not send' }); }
});

// ── AI Concierge: natural-language member finder ────────────
// Keyword pre-rank → ground an LLM on the top candidates → return an answer +
// recommended members. Falls back to pure keyword results when no LLM key is set
// (so it always works). Real member data only — the model can't invent members.
const STOPWORDS = new Set(('a an and any are am as at be been by can could did do does for find from get has have help i if in is it looking me my near need of on or please some that the them they this to want we what when where which who with you your').split(' '));
function rankMembers(members, q, limit = 20) {
  const fields = [['name', 10], ['category', 6], ['categories', 6], ['typeOfBusiness', 6], ['keywords', 5], ['group', 5],
    ['neighborhood', 4], ['city', 4], ['tagline', 3], ['tags', 2], ['description', 1]];
  const words = String(q).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const scored = members.map((m) => {
    let total = 0;
    for (const w of words) {
      const wb = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      let best = 0;
      for (const [f, wt] of fields) { const v = m[f]; if (!v) continue; const lv = String(v).toLowerCase(); if (wb.test(lv)) best = Math.max(best, wt * 2); else if (w.length > 3 && lv.includes(w)) best = Math.max(best, wt); }
      total += best;
    }
    return [m, total];
  }).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  return scored.slice(0, limit).map(([m]) => m);
}

router.post('/concierge', async (req, res) => {
  const q = String((req.body && req.body.q) || '').trim().slice(0, 400);
  if (!q) return res.status(400).json({ error: 'Ask a question, e.g. "Who can cater a 50-person event in Tarzana?"' });
  try {
    const all = (await loadMembersPublic()).members;
    const candidates = rankMembers(all, q, 30);
    if (!candidates.length) {
      return res.json({ answer: `I couldn't find a Chamber member matching that. Try different words, browse the directory, or call the Chamber at (818) 347-4737.`, members: [], provider: 'none' });
    }
    if (!llm.enabled()) {
      // No LLM key → return the keyword matches directly.
      return res.json({ answer: `Here are the closest Chamber members for "${q}":`, members: candidates.slice(0, 6), provider: 'keyword' });
    }
    const list = candidates.map((m) => `- id:${m.id} | ${m.name} | ${m.category || m.group || ''} | ${m.neighborhood || ''}${m.tagline ? ' | ' + m.tagline : ''}`).join('\n');
    const system = 'You are Wendy, the friendly concierge for the West Valley · Warner Center Chamber of Commerce. Recommend ONLY businesses from the provided member list — never invent members. Be warm, brief, and local. You may refer to yourself as Wendy.';
    // memberIds FIRST + short answer so a truncated response still yields picks.
    const prompt = `Member candidates (id | name | category | area | tagline):\n${list}\n\nVisitor question: "${q}"\n\nChoose the up to 5 most relevant members. Reply with ONLY compact JSON, answer under 25 words:\n{"memberIds":["id1","id2"],"answer":"one short helpful sentence"}`;
    const raw = await llm.complete({ system, prompt, json: true, maxTokens: 800 });
    let parsed = {};
    try {
      const jsonMatch = String(raw).replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch (e) { console.error('concierge JSON parse failed:', String(raw).slice(0, 160)); parsed = {}; }
    const byId = Object.fromEntries(candidates.map((m) => [m.id, m]));
    let picked = (parsed.memberIds || []).map((id) => byId[id]).filter(Boolean);
    // Only fall back to raw keyword hits if the model didn't answer at all
    // (parse failure). If it answered with no picks, trust it (members: []).
    if (!picked.length && !parsed.answer) picked = candidates.slice(0, 5);
    res.json({ answer: parsed.answer || `Here are members that can help with "${q}":`, members: picked, provider: llm.provider() });
  } catch (e) {
    console.error('concierge error', e);
    res.status(500).json({ error: 'The concierge is unavailable right now. Please try the directory search.' });
  }
});

// ── Admin API ───────────────────────────────────────────────
// Send (or resend) the member welcome email — the office's welcome letter
// with their website login link (per Felicia, Jul 2026: "I approved a new
// member. Where/how do I send the welcome email?"). Works whether or not the
// login exists yet: it's created on the fly, and the email carries a
// set-your-password link either way.
router.post('/admin/members/:id/send-welcome', requireAdmin, async (req, res) => {
  try {
    const { members } = await loadMembersFull();
    const m = members.find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'member not found' });
    const addr = String((req.body && req.body.email) || m.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return res.status(400).json({ error: 'This member has no email on file — add one first.' });
    // Preview mode: return the exact copy without creating a login or sending
    // (per the office, Jul 2026 — "we want to see a copy of the welcome
    // letter that is being sent"). The sign-in link shows as a placeholder.
    if (req.body && req.body.preview) {
      const hi = m.contactName ? `, ${m.contactName}` : '';
      return res.json({ ok: true, preview: true, to: addr,
        subject: 'Welcome to the West Valley · Warner Center Chamber of Commerce!',
        text: `Welcome${hi}!\n\nLog in to your very own website profile on the Chamber of Commerce website — have your logo, headshot, and headline ready, and update often.\n\nSet your password and sign in here (link expires in 1 hour; after that use "Forgot password" on the sign-in page):\n[ their personal sign-in link goes here ]\n\nBe sure the Chamber office has all of your preferred contact information for publishing. You will be announced in our newsletter — if you would like a social media campaign to accompany that, it is only $50. Let us know!\n\nAnd join our WVWC Group on Facebook.\n\nBe Connected,\nWest Valley · Warner Center Chamber of Commerce\n(818) 347-4737 · www.woodlandhillscc.net` });
    }
    const existingUser = await users.getUserByEmail(addr);
    if (!existingUser) {
      await users.bulkImportMembers([{ email: addr, memberId: m.id, username: m.contactName || m.name, passwordHash: null, passwordAlgo: 'unknown', needsReset: true }]);
    }
    const token = auth.signResetToken(addr);
    const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/auth/reset.html?token=${encodeURIComponent(token)}`;
    const hello = m.contactName ? `, ${m.contactName}` : '';
    // Copy follows the office's longtime welcome letter (Felicia's sample,
    // Jul 2026): profile setup, publishing info, newsletter announcement +
    // $50 social campaign, Facebook group.
    const r = await email.send({
      to: addr,
      subject: `Welcome to the West Valley · Warner Center Chamber of Commerce!`,
      text: `Welcome${hello}!\n\nLog in to your very own website profile on the Chamber of Commerce website — have your logo, headshot, and headline ready, and update often.\n\nSet your password and sign in here (link expires in 1 hour; after that use "Forgot password" on the sign-in page):\n${link}\n\nBe sure the Chamber office has all of your preferred contact information for publishing. You will be announced in our newsletter — if you would like a social media campaign to accompany that, it is only $50. Let us know!\n\nAnd join our WVWC Group on Facebook.\n\nBe Connected,\nWest Valley · Warner Center Chamber of Commerce\n(818) 347-4737 · www.woodlandhillscc.net`,
      html: `<p>Welcome${esc(hello)}!</p>
<p>Log in to your very own website profile on the Chamber of Commerce website — have your logo, headshot, and headline ready, and update often.</p>
<p><a href="${link}"><strong>Set your password &amp; sign in</strong></a> (link expires in 1 hour; after that use “Forgot password” on the <a href="${base}/auth/login.html">sign-in page</a>).</p>
<p>Be sure the Chamber office has all of your preferred contact information for publishing. You will be announced in our newsletter — if you would like a social media campaign to accompany that, it is only <strong>$50</strong>. Let us know!</p>
<p>And join our <strong>WVWC Group on Facebook</strong>.</p>
<p>Be Connected,<br>West Valley · Warner Center Chamber of Commerce<br>(818) 347-4737 · <a href="https://www.woodlandhillscc.net">www.woodlandhillscc.net</a></p>`,
    });
    if (r && r.ok === false) return res.status(500).json({ error: 'Email could not be sent: ' + (r.error || 'provider error') });
    if (r && r.skipped) return res.status(500).json({ error: 'Email provider is not configured on the server.' });
    // Stamp the member so the panel shows "welcome sent <date>" instead of
    // leaving the office guessing whether it went out (Felicia, Jul 13).
    const welcomeSent = new Date().toISOString();
    try { await repo.setOverride(req.params.id, { welcomeSent }); } catch (e) { /* non-fatal */ }
    res.json({ ok: true, email: addr, loginCreated: !existingUser, welcomeSent });
  } catch (e) { console.error('send-welcome', e); res.status(500).json({ error: 'could not send the welcome email' }); }
});

// Force a member to reset their password (old password stops working).
router.post('/admin/members/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const email = await users.requireReset(req.params.id);
    if (!email) return res.status(404).json({ error: 'No login is linked to that member.' });
    res.json({ ok: true, email, message: `${email} will be required to set a new password at next login.` });
  } catch (e) { console.error('reset-password', e); res.status(500).json({ error: 'could not reset' }); }
});

// Admin sets a login's password directly (e.g. the office sets it for a member
// over the phone). Keyed by email (shown on the Users & Roles page). Min 8 chars;
// clears any pending reset so the member can sign in immediately.
router.post('/admin/users/:email/set-password', requireAdmin, async (req, res) => {
  const pw = String((req.body && req.body.password) || '');
  if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    await users.updatePassword(decodeURIComponent(req.params.email), auth.hashPassword(pw));
    res.json({ ok: true });
  } catch (e) { console.error('admin set-password', e); res.status(500).json({ error: 'could not set password' }); }
});

// Admin creates a LOGIN for an existing directory member who doesn't have one
// yet (e.g. imported roster rows without emails). Creates the account against
// the given email and sends the set-your-password invitation.
router.post('/admin/members/:id/create-login', requireAdmin, async (req, res) => {
  const emailAddr = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddr)) return res.status(400).json({ error: 'A valid email address is required.' });
  try {
    const m = (await loadMembersFull()).members.find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'member not found' });
    const existing = await users.getUserByEmail(emailAddr);
    if (existing && existing.memberId && existing.memberId !== m.id) {
      return res.status(409).json({ error: 'That email already belongs to another member\'s login.' });
    }
    const detail = await attachLoginAndInvite(m.id, emailAddr, m.contactName, m.name, req, req.body.sendInvite !== false);
    res.json({ ok: true, email: emailAddr, detail });
  } catch (e) { console.error('create-login', e); res.status(500).json({ error: 'could not create the login' }); }
});

// Admin generates a one-time SIGN-IN link for a member's login — so the office
// can open the member's portal view to assist them (open it in a private/
// incognito window to keep your admin session), or text/email it to the member.
// Uses the existing 20-minute magic-link tokens; no password is exposed.
router.get('/admin/members/:id/login-link', requireAdmin, async (req, res) => {
  try {
    const list = await users.listUsers();
    const u = (list || []).find((x) => x.memberId === req.params.id) || null;
    if (!u || !u.email) return res.status(404).json({ error: 'No login is linked to that member.' });
    const token = auth.signMagicToken(u.email);
    const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ ok: true, email: u.email, link: `${base}/api/auth/magic/verify?token=${encodeURIComponent(token)}`, expiresInMinutes: 20 });
  } catch (e) { console.error('login-link', e); res.status(500).json({ error: 'could not generate link' }); }
});

// Same 20-minute view link, resolved by EMAIL instead of member id (Felicia,
// Aug 20 2026 — she starts from Groups → Manage, where the group manager's
// LOGIN address is what's on file; it often differs from the address on their
// directory listing, so a listing lookup would come up empty).
router.get('/admin/login-link-by-email', requireAdmin, async (req, res) => {
  try {
    const em = String(req.query.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return res.status(400).json({ error: 'Provide a valid email address.' });
    const list = await users.listUsers();
    const u = (list || []).find((x) => String(x.email || '').toLowerCase() === em) || null;
    if (!u) return res.status(404).json({ error: 'no-login' });
    const token = auth.signMagicToken(u.email);
    const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ ok: true, email: u.email, link: `${base}/api/auth/magic/verify?token=${encodeURIComponent(token)}`, expiresInMinutes: 20 });
  } catch (e) { console.error('login-link-by-email', e); res.status(500).json({ error: 'could not generate link' }); }
});

// Admin generates a password-reset LINK for a login — useful while transactional
// email isn't configured yet: staff can copy the link and send it to the member.
router.get('/admin/users/:email/reset-link', requireAdmin, async (req, res) => {
  try {
    const em = decodeURIComponent(req.params.email);
    const token = auth.signResetToken(em);
    const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ ok: true, email: em, link: `${base}/auth/reset.html?token=${encodeURIComponent(token)}`, expiresInHours: 1 });
  } catch (e) { console.error('reset-link', e); res.status(500).json({ error: 'could not generate link' }); }
});

// Resolve a member's login address (per the office, Jul 15 — sends must go
// FROM the website, not pasted into staff Outlook where filters eat them).
async function memberLoginAddress(id) {
  const { members } = await loadMembersFull();
  const m = members.find((x) => x.id === id);
  if (!m) return { error: 'member not found', code: 404 };
  const addr = String(m.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return { error: 'This member has no email on file — add one first.', code: 400 };
  return { m, addr };
}

// Email the member a password-reset link, sent BY the website (Graph/Resend) —
// this is what the old "Reset link" button should have done instead of just
// copying a URL for staff to forward from Outlook (Felicia, Jul 15).
router.post('/admin/members/:id/send-reset', requireAdmin, async (req, res) => {
  try {
    const info = await memberLoginAddress(req.params.id);
    if (info.error) return res.status(info.code).json({ error: info.error });
    const { m, addr } = info;
    if (!(await users.getUserByEmail(addr))) {
      await users.bulkImportMembers([{ email: addr, memberId: m.id, username: m.contactName || m.name, passwordHash: null, passwordAlgo: 'unknown', needsReset: true }]);
    }
    const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/auth/reset.html?token=${encodeURIComponent(auth.signResetToken(addr))}`;
    const hello = m.contactName ? `, ${m.contactName}` : '';
    const r = await email.send({
      to: addr,
      subject: 'Set your West Valley · Warner Center Chamber password',
      text: `Hello${hello},\n\nHere is your link to set a new password for your Chamber account (${addr}). It expires in 1 hour:\n${link}\n\nIf the link expires, ask the Chamber office to send a new one, or use “Forgot password” on the sign-in page.\n\nWest Valley · Warner Center Chamber of Commerce\n(818) 347-4737`,
      html: `<p>Hello${esc(hello)},</p><p>Here is your link to set a new password for your Chamber account (<strong>${esc(addr)}</strong>). It expires in 1 hour:</p><p><a href="${link}"><strong>Set your password</strong></a></p><p>If the link expires, ask the Chamber office to send a new one, or use “Forgot password” on the <a href="${base}/auth/login.html">sign-in page</a>.</p><p>West Valley · Warner Center Chamber of Commerce<br>(818) 347-4737</p>`,
    });
    if (r && r.skipped) return res.status(500).json({ error: 'Email provider is not configured on the server.' });
    if (r && r.ok === false) return res.status(500).json({ error: 'Email could not be sent: ' + (r.error || 'provider error') });
    res.json({ ok: true, email: addr });
  } catch (e) { console.error('send-reset', e); res.status(500).json({ error: 'could not send the reset link' }); }
});

// Email the member a one-click passwordless SIGN-IN link, sent by the website.
// Best for members who can't manage passwords: they click and they're in.
router.post('/admin/members/:id/send-signin', requireAdmin, async (req, res) => {
  try {
    const info = await memberLoginAddress(req.params.id);
    if (info.error) return res.status(info.code).json({ error: info.error });
    const { m, addr } = info;
    // The magic-verify step needs a user record to exist; create a passwordless
    // one if there isn't a login yet, so the link works the first time too.
    if (!(await users.getUserByEmail(addr))) {
      await users.bulkImportMembers([{ email: addr, memberId: m.id, username: m.contactName || m.name, passwordHash: null, passwordAlgo: 'unknown', needsReset: true }]);
    }
    const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/api/auth/magic/verify?token=${encodeURIComponent(auth.signMagicToken(addr))}`;
    const hello = m.contactName ? `, ${m.contactName}` : '';
    const r = await email.send({
      to: addr,
      subject: 'Your West Valley · Warner Center Chamber sign-in link',
      text: `Hello${hello},\n\nClick to sign straight in to your Chamber account (${addr}) — no password needed. This link expires in 20 minutes:\n${link}\n\nOnce you're in, you can set a password under your profile if you'd like.\n\nWest Valley · Warner Center Chamber of Commerce\n(818) 347-4737`,
      html: `<p>Hello${esc(hello)},</p><p>Click to sign straight in to your Chamber account (<strong>${esc(addr)}</strong>) — no password needed. This link expires in 20 minutes:</p><p><a href="${link}"><strong>Sign in to the Chamber</strong></a></p><p>Once you're in, you can set a password under your profile if you'd like.</p><p>West Valley · Warner Center Chamber of Commerce<br>(818) 347-4737</p>`,
    });
    if (r && r.skipped) return res.status(500).json({ error: 'Email provider is not configured on the server.' });
    if (r && r.ok === false) return res.status(500).json({ error: 'Email could not be sent: ' + (r.error || 'provider error') });
    res.json({ ok: true, email: addr });
  } catch (e) { console.error('send-signin', e); res.status(500).json({ error: 'could not send the sign-in link' }); }
});

// Admin-only: verify the transactional-email pipeline end-to-end.
// GET /api/admin/email-test?to=someone@example.com  (defaults to the chamber notify inbox)
router.get('/admin/email-test', requireAdmin, async (req, res) => {
  const to = String(req.query.to || email.notifyTo());
  const detail = await email.diagnose(to);
  res.json({ enabled: email.enabled(), notifyTo: email.notifyTo(), to, ...detail });
});

/* Everything waiting on the office, in one list (Felicia, Jul 29 2026).
   "We don't need the notification sent to us as long as we could see it when
   we go into the dashboard." The pending counter used to mean members only, so
   a job posting or a community event could sit unseen. */
async function pendingApprovals() {
  const out = [];
  try {
    const { members } = await loadMembersFull();
    for (const m of members.filter((x) => x.status === 'pending')) {
      out.push({ kind: 'member', label: 'New member', title: m.name || m.contactName || m.id, id: m.id, href: 'approvals.html' });
    }
  } catch (e) {}
  try {
    for (const p of await repo.listPosts({ status: 'pending' })) {
      const community = p.meta && p.meta.community;
      out.push({
        kind: p.type === 'job' ? 'job' : 'post',
        label: p.type === 'job' ? (community ? 'Job posting (community)' : 'Job posting') : 'Member content',
        title: p.title || p.id, id: p.id, who: p.authorName || '', created: p.created || '',
        href: 'content.html',
      });
    }
  } catch (e) {}
  try {
    for (const ev of await loadEvents()) {
      if ((ev.status || 'approved') !== 'pending') continue;
      out.push({
        kind: ev.hostKind === 'community' ? 'community-event' : 'event',
        label: ev.hostKind === 'community' ? 'Community event' : 'Member event',
        title: ev.title || ev.id, id: ev.id, who: ev.hostName || ev.submittedByName || '',
        created: ev.date || '', href: 'events.html?tab=pending',
      });
    }
  } catch (e) {}
  try {
    for (const g of await loadGroups()) {
      for (const m of (g.members || [])) {
        if (m.status !== 'pending') continue;
        out.push({
          kind: 'group-join', label: `Join request — ${g.name}`,
          title: m.name || m.email || m.id, id: `${g.id}:${m.id}`, who: m.business || '',
          href: 'groups.html',
        });
      }
    }
  } catch (e) {}
  try {
    for (const l of await repo.listLeads()) {
      if (l.kind === 'ribbon-cutting' && l.status !== 'done') {
        out.push({ kind: 'ribbon', label: 'Ribbon cutting request', title: l.company || l.name || l.id, id: l.id, href: 'ribbon-cuttings.html' });
      }
    }
  } catch (e) {}
  return out;
}

router.get('/admin/approvals-feed', requireAdmin, async (_req, res) => {
  try {
    const items = await pendingApprovals();
    res.json({ ok: true, count: items.length, items });
  } catch (e) { console.error('approvals-feed', e); res.status(500).json({ error: 'Could not load the approvals list.' }); }
});

router.get('/admin/summary', requireAdmin, async (_req, res) => {
  try {
    const { members, source } = await loadMembersFull();
    const leads = await repo.listLeads();
    const orders = await repo.listOrders();
    const pendingPosts = (await repo.listPosts({ status: 'pending' })).length;
    const approvals = await pendingApprovals();
    res.json({
      source,
      members: members.length,
      pendingMembers: members.filter((m) => m.status === 'pending').length,
      leaders: members.filter((m) => m.leaderStatus).length,
      newLeads: leads.filter((l) => l.status === 'new').length,
      pendingPosts,
      // Every kind of approval, not just members — the office works off this
      // number instead of email notifications.
      pendingAll: approvals.length,
      pendingByKind: approvals.reduce((acc, a) => { acc[a.kind] = (acc[a.kind] || 0) + 1; return acc; }, {}),
      // Declined attempts are visible in the Pay Log but never count as money.
      orders: orders.filter((o) => (o.status || 'paid') !== 'declined').length,
      revenue: orders.filter((o) => (o.status || 'paid') === 'paid').reduce((s, o) => s + (Number(o.amount) || 0), 0),
      // ── At-a-glance detail for the dashboard cards (Michael, Jul 30 2026:
      // "the top cards need more description and information at a glance").
      // A bare number tells the office how much there is, never what it is —
      // these are the one-line answers to "…of what?" for each card.
      glance: await dashboardGlance({ members, leads, orders }),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'summary failed' }); }
});
/* The second line on each dashboard card. Everything here is derived from data
   the summary already loaded, plus the event list — no extra round trips. */
async function dashboardGlance({ members, leads, orders }) {
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const since7 = daysAgo(7);
  const since30 = daysAgo(30);
  // Leads stamp `received`, orders `created`, events `date` — without the
  // received fallback the "came in this week" hint always read zero.
  const when = (x) => String((x && (x.created || x.date || x.received)) || '');
  const paid = orders.filter((o) => (o.status || 'paid') === 'paid');
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  /* A bare 'YYYY-MM-DD' parses as UTC midnight, so formatting it in a US
     timezone lands on the day BEFORE — an Aug 3 event read "Aug 2" on the
     dashboard. Format date-only strings from their own parts and never involve
     a timezone; full timestamps (orders) still convert normally. */
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayLabel = (iso) => {
    const s = String(iso || '');
    const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return `${MON[Number(dateOnly[2]) - 1]} ${Number(dateOnly[3])}`;
    const d = new Date(s);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  let nextEvent = null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    nextEvent = (await loadEvents())
      .filter((e) => e.confirmed && e.date && e.date >= today && (e.status || 'approved') === 'approved')
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
  } catch (e) { /* events unavailable → the card just omits its hint */ }
  const lastPaid = paid.slice().sort((a, b) => when(b).localeCompare(when(a)))[0];
  return {
    membersPending: members.filter((m) => m.status === 'pending').length,
    membersActive: members.filter((m) => (m.status || 'approved') === 'approved').length,
    leads7: leads.filter((l) => l.status !== 'spam' && when(l) >= since7).length,
    revenue30: money(paid.filter((o) => when(o) >= since30).reduce((s, o) => s + (Number(o.amount) || 0), 0)),
    lastPayment: lastPaid ? `${money(Number(lastPaid.amount) || 0)} on ${dayLabel(when(lastPaid))}` : '',
    nextEvent: nextEvent ? { title: nextEvent.title, date: nextEvent.date, when: dayLabel(nextEvent.date), id: nextEvent.id } : null,
  };
}

router.get('/admin/members', requireAdmin, async (req, res) => {
  try {
    let { members } = await loadMembersFull();
    if (req.query.status) members = members.filter((m) => (m.status || 'approved') === req.query.status);
    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      members = members.filter((m) => [m.name, m.category, m.contactName, m.email, m.neighborhood]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    res.json({ members });
  } catch (e) { res.status(500).json({ error: 'members failed' }); }
});

router.patch('/admin/members/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const exists = (await loadMembersFull()).members.some((m) => m.id === id);
    if (!exists) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const patch = {};
    if (b.status !== undefined && STATUS_OPTS.includes(b.status)) patch.status = b.status;
    if (b.leaderStatus !== undefined && LEADER_OPTS.includes(b.leaderStatus)) patch.leaderStatus = b.leaderStatus;
  // Extra designations: a member can also appear on other leadership pages
  // (per the office, Jul 2026 — e.g. Board Member AND Ambassador).
  if (Array.isArray(b.designations)) patch.designations = b.designations.filter((d) => d && LEADER_OPTS.includes(d)).slice(0, 5);
    if (b.tier !== undefined) patch.tier = b.tier;
    if (b.featured !== undefined) patch.featured = !!b.featured;
    if (b.expireDate !== undefined) patch.expireDate = (b.expireDate && /^\d{4}-\d{2}-\d{2}$/.test(b.expireDate)) ? b.expireDate : null;
    if (b.termMonths !== undefined) patch.termMonths = (b.termMonths === null || b.termMonths === '') ? null : Number(b.termMonths) || null;
    await repo.setOverride(id, patch);
    res.json({ ok: true, id, applied: patch });
  } catch (e) { console.error(e); res.status(500).json({ error: 'update failed' }); }
});

// Admin edit of a member's PUBLIC PROFILE (name, contact, address, tagline…).
// Same sanitizer + storage as member self-edits, so precedence rules hold.
router.patch('/admin/members/:id/profile', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const exists = (await loadMembersFull()).members.some((m) => m.id === id);
    if (!exists) return res.status(404).json({ error: 'not found' });
    const patch = sanitizeProfile(req.body || {});
    // boardTitle is ADMIN-ONLY (members must not grant themselves an office) —
    // accepted here, never in the member self-edit sanitizer.
    if (req.body && req.body.boardTitle !== undefined) patch.boardTitle = String(req.body.boardTitle || '').slice(0, 80);
    await repo.setMemberEdit(id, patch);
    res.json({ ok: true, id, applied: patch });
  } catch (e) { console.error(e); res.status(500).json({ error: 'update failed' }); }
});

// Change the member's login/contact email (per Felicia's Jul 14 voicemail —
// members hand over a new or rep address, and welcome/reset/sign-in emails
// must follow it). Moves the linked login account at the same time.
router.patch('/admin/members/:id/email', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const newEmail = String((req.body || {}).email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return res.status(400).json({ error: 'That does not look like a valid email address.' });
  try {
    const m = (await loadMembersFull()).members.find((x) => x.id === id);
    if (!m) return res.status(404).json({ error: 'not found' });
    const taken = await users.getUserByEmail(newEmail);
    if (taken && taken.memberId !== id) return res.status(409).json({ error: 'Another login already uses that email address.' });
    const loginMoved = await users.updateEmailByMemberId(id, newEmail);
    await repo.setMemberEdit(id, { email: newEmail });
    res.json({ ok: true, email: newEmail, loginMoved, previous: m.email || '' });
  } catch (e) { console.error('member email change', e); res.status(500).json({ error: 'could not update the email' }); }
});

// Manually add a member (offline signup — paid offline).
router.post('/admin/members', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Business / member name is required.' });
  const id = 'm-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const name = String(b.name).slice(0, 160);
  const m = {
    id, slug: slugify(name) || id, name,
    category: String(b.category || 'Member').slice(0, 60),
    group: String(b.group || '').slice(0, 60),
    tier: String(b.tier || 'member').slice(0, 30),
    neighborhood: String(b.neighborhood || b.city || '').slice(0, 80),
    contactName: String(b.contactName || '').slice(0, 120),
    email: String(b.email || '').slice(0, 160),
    phone: String(b.phone || '').slice(0, 40),
    address: String(b.address || '').slice(0, 200),
    city: String(b.city || '').slice(0, 80),
    state: String(b.state || '').slice(0, 20),
    zip: String(b.zip || '').slice(0, 20),
    website: clampUrl(b.website),
    tagline: String(b.tagline || '').slice(0, 300),
    description: String(b.description || '').slice(0, 5000),
    joinDate: /^\d{4}-\d{2}-\d{2}$/.test(b.joinDate || '') ? b.joinDate : new Date().toISOString().slice(0, 10),
    tags: Array.isArray(b.tags) ? b.tags.slice(0, 12).map((t) => String(t).slice(0, 30)) : [],
    status: STATUS_OPTS.includes(b.status) ? b.status : 'approved',
    seal: (name[0] || '?').toUpperCase(),
    paymentType: 'offline',
    addedManually: true,
  };
  if (b.expireDate && /^\d{4}-\d{2}-\d{2}$/.test(b.expireDate)) m.expireDate = b.expireDate;
  if (b.termMonths) m.termMonths = Number(b.termMonths) || null;
  try {
    await repo.addMember(m);
    // Create a member login + email a "set your password" welcome link.
    let login = null;
    if (m.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email)) {
      try {
        await users.bulkImportMembers([{ email: m.email, memberId: m.id, username: m.contactName || m.name, passwordHash: null, passwordAlgo: 'unknown', needsReset: true }]);
        const token = auth.signResetToken(m.email);
        const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
        const link = `${base}/auth/reset.html?token=${encodeURIComponent(token)}`;
        const r = await email.send({
          to: m.email,
          subject: 'Welcome to the West Valley · Warner Center Chamber — set up your account',
          text: `Welcome${m.contactName ? ', ' + m.contactName : ''}!\n\nYour Chamber member listing for ${m.name} is set up. Create your password to manage your listing:\n${link}\n\n(This link expires in 1 hour — if it expires, just use "Forgot password" on the sign-in page.)\n\n— West Valley · Warner Center Chamber of Commerce`,
          html: `<p>Welcome${m.contactName ? ', ' + esc(m.contactName) : ''}!</p><p>Your Chamber member listing for <strong>${esc(m.name)}</strong> is set up. Create your password to manage your listing:</p><p><a href="${link}">Set up your account</a> (link expires in 1 hour — otherwise use “Forgot password” on the sign-in page).</p><p>— West Valley · Warner Center Chamber of Commerce</p>`,
        });
        login = r && r.ok ? 'login created · welcome email sent' : 'login created · email pending (' + (r && r.error ? r.error : 'not configured') + ')';
      } catch (e) { console.error('member login/email', e); login = 'member added; login/email step failed'; }
    }
    res.json({ ok: true, member: m, login });
  }
  catch (e) { console.error('add member', e); res.status(500).json({ error: 'could not add member' }); }
});

// ── Bulk member import (Felicia's CSV upload) ──────────────
// Accepts rows parsed client-side from a ChamberWare-style export. Matches by
// company name so re-uploading an overlapping export NEVER duplicates: an
// existing member gets its blank contact fields filled and (if the row has an
// email and the member has no login yet) a login attached; new companies are
// created like the single "Add a member" form. `sendInvites` controls whether
// welcome/set-password emails go out.
function normalizeJoinDate(s) {
  s = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // M/D/YYYY (ChamberWare)
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
}
async function attachLoginAndInvite(memberId, emailAddr, displayName, businessName, req, sendInvite) {
  await users.bulkImportMembers([{ email: emailAddr, memberId, username: displayName || businessName, passwordHash: null, passwordAlgo: 'unknown', needsReset: true }]);
  if (!sendInvite) return 'login created (no email sent)';
  const token = auth.signResetToken(emailAddr);
  const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
  const link = `${base}/auth/reset.html?token=${encodeURIComponent(token)}`;
  // Login-focused copy (not a "welcome" — the office sends its own welcome
  // letter when members join; this email is purely their website login).
  const r = await email.send({
    to: emailAddr,
    subject: 'Your member login for the Chamber website — set your password',
    text: `Hello${displayName ? ' ' + displayName : ''},\n\nYour member listing for ${businessName} is live on the West Valley · Warner Center Chamber website, and a member login has been created for this email address.\n\nSet your password here to manage your listing (photos, description, offers, and more):\n${link}\n\n(The link expires in 1 hour — if it expires, just use "Forgot password" on the sign-in page at ${base}/auth/login.html.)\n\n— West Valley · Warner Center Chamber of Commerce\n(818) 347-4737`,
    html: `<p>Hello${displayName ? ' ' + esc(displayName) : ''},</p><p>Your member listing for <strong>${esc(businessName)}</strong> is live on the West Valley · Warner Center Chamber website, and a member login has been created for this email address.</p><p><a href="${link}">Set your password</a> to manage your listing — photos, description, offers, and more.</p><p>(The link expires in 1 hour — if it expires, just use “Forgot password” on the <a href="${base}/auth/login.html">sign-in page</a>.)</p><p>— West Valley · Warner Center Chamber of Commerce<br>(818) 347-4737</p>`,
  });
  return r && r.ok ? 'login created · set-password email sent' : 'login created · email pending (' + ((r && r.error) || 'not configured') + ')';
}
router.post('/admin/members/import', requireAdmin, async (req, res) => {
  const rows = Array.isArray(req.body && req.body.members) ? req.body.members.slice(0, 500) : [];
  const sendInvites = !!(req.body && req.body.sendInvites);
  if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
  try {
    const { members: existing } = await loadMembersFull();
    // Several members can share one company name (e.g. multiple New York Life
    // agents). Group by slug and only treat a row as "the same member" when the
    // CONTACT agrees too — same last name, or the same login email. A same-name
    // company with a different rep becomes a NEW record; nothing gets overridden.
    const bySlug = new Map();
    for (const m of existing) {
      const s = m.slug || slugify(m.name);
      if (!bySlug.has(s)) bySlug.set(s, []);
      bySlug.get(s).push(m);
    }
    const lastWord = (s) => { const p = String(s || '').trim().toLowerCase().split(/\s+/); return p[p.length - 1] || ''; };
    const userList = await users.listUsers().catch(() => []);
    const hasLogin = new Set((userList || []).filter((u) => u.memberId).map((u) => u.memberId));
    const results = [];
    for (const raw of rows) {
      const name = String(raw.name || raw.company || '').trim().slice(0, 160);
      if (!name) { results.push({ name: '(blank)', action: 'skipped', detail: 'no company name' }); continue; }
      const contactName = String(raw.contactName || [raw.firstName, raw.lastName].filter(Boolean).join(' ')).trim().slice(0, 120);
      const emailAddr = String(raw.email || '').trim().toLowerCase().slice(0, 160);
      const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddr);
      const slug = slugify(name);
      const candidates = bySlug.get(slug) || [];
      const found = candidates.find((m) =>
        (emailOk && String(m.email || '').toLowerCase() === emailAddr) ||
        (contactName && lastWord(m.contactName) && lastWord(m.contactName) === lastWord(contactName)) ||
        (!contactName && !emailOk) ||
        (candidates.length === 1 && !String(m.contactName || '').trim()));
      try {
        if (found) {
          // Existing member: fill only blank fields, never overwrite live data.
          const patch = {};
          for (const [k, v] of Object.entries({
            contactName, phone: raw.phone, website: raw.website, address: raw.address,
            city: raw.city, state: raw.state, zip: raw.zip, category: raw.category,
          })) {
            const val = String(v || '').trim();
            if (val && !String(found[k] || '').trim()) patch[k] = val.slice(0, 200);
          }
          if (Object.keys(patch).length) await repo.setMemberEdit(found.id, patch);
          let detail = Object.keys(patch).length ? `filled: ${Object.keys(patch).join(', ')}` : 'already up to date';
          if (emailOk && !hasLogin.has(found.id)) {
            detail += ' · ' + await attachLoginAndInvite(found.id, emailAddr, contactName || found.contactName, found.name, req, sendInvites);
            hasLogin.add(found.id);
          }
          results.push({ name, action: 'matched existing', detail });
        } else {
          const id = 'm-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
          const m = {
            // Same company name already in the roster (different rep) → unique slug, separate record.
            id, slug: candidates.length ? `${slug}-${id.slice(-4)}` : (slug || id), name,
            category: String(raw.category || 'Member').slice(0, 60),
            group: '', tier: 'member',
            neighborhood: String(raw.city || '').slice(0, 80),
            contactName, email: emailOk ? emailAddr : '',
            phone: String(raw.phone || '').slice(0, 40),
            address: String(raw.address || '').slice(0, 200),
            city: String(raw.city || '').slice(0, 80),
            state: String(raw.state || '').slice(0, 20),
            zip: String(raw.zip || '').slice(0, 20),
            website: clampUrl(raw.website),
            tagline: '', description: '',
            joinDate: normalizeJoinDate(raw.joinDate) || new Date().toISOString().slice(0, 10),
            tags: [], status: 'approved', seal: (name[0] || '?').toUpperCase(),
            paymentType: 'offline', addedManually: true, leaderStatus: 'New Member',
          };
          await repo.addMember(m);
          if (!bySlug.has(slug)) bySlug.set(slug, []);
          bySlug.get(slug).push(m);
          let detail = candidates.length ? 'created as a separate record (same company name, different contact)' : 'created';
          if (emailOk) { detail += ' · ' + await attachLoginAndInvite(m.id, emailAddr, contactName, name, req, sendInvites); hasLogin.add(m.id); }
          results.push({ name, action: 'added', detail });
        }
      } catch (e) {
        console.error('import row', name, e);
        results.push({ name, action: 'error', detail: 'could not save this row' });
      }
    }
    const count = (a) => results.filter((r) => r.action === a).length;
    res.json({ ok: true, results, summary: { added: count('added'), matched: count('matched existing'), skipped: count('skipped'), errors: count('error') } });
  } catch (e) { console.error('bulk import', e); res.status(500).json({ error: 'import failed' }); }
});

// One-click membership approval: turn a membership-application inquiry into a
// live directory member (+ login & set-password invite), no manual re-entry.
router.post('/admin/leads/:id/approve-member', requireAdmin, async (req, res) => {
  try {
    const lead = (await repo.listLeads()).find((l) => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'inquiry not found' });
    const name = String(lead.company || lead.name || '').trim().slice(0, 160);
    if (!name) return res.status(400).json({ error: 'This inquiry has no company or name to create a member from.' });
    // Same-name guard: if this exact company already exists, don't double-add.
    const { members } = await loadMembersFull();
    const slug = slugify(name);
    const dupe = members.find((m) => (m.slug || slugify(m.name)) === slug && String(m.contactName || '').toLowerCase() === String(lead.name || '').toLowerCase());
    if (dupe) return res.status(409).json({ error: `"${name}" with contact ${lead.name} is already in the directory.` });
    const id = 'm-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(lead.email || ''));
    const m = {
      id, slug: members.some((x) => (x.slug || slugify(x.name)) === slug) ? `${slug}-${id.slice(-4)}` : (slug || id),
      name, category: 'Member', group: '', tier: 'member',
      neighborhood: '', contactName: String(lead.name || '').slice(0, 120),
      email: emailOk ? String(lead.email).toLowerCase() : '', phone: String(lead.phone || '').slice(0, 40),
      // Business address from the application (Felicia, Aug 19 2026 call) —
      // before this, staff re-typed it from the receipt or a phone call.
      address: String(lead.address || '').slice(0, 200), city: String(lead.city || '').slice(0, 80),
      state: '', zip: String(lead.zip || '').slice(0, 20), website: '', tagline: '',
      description: '', joinDate: new Date().toISOString().slice(0, 10),
      tags: [], status: 'approved', seal: (name[0] || '?').toUpperCase(),
      paymentType: 'offline', addedManually: true, leaderStatus: 'New Member',
      // Representatives from the application land as the public "team" list
      // (names only — their emails stay on the lead for the office/eblast,
      // never on the public page).
      ...(Array.isArray(lead.reps) && lead.reps.some((r) => r && r.name) ? {
        team: lead.reps.filter((r) => r && r.name).slice(0, 4)
          .map((r) => ({ name: String(r.name).slice(0, 80), title: 'Representative', bio: '', photo: '' })),
      } : {}),
    };
    await repo.addMember(m);
    let login = 'no email on the application — add one in Members to create their login';
    if (emailOk) {
      try {
        if (lead.passwordHash) {
          // They chose their password on the application (old-site flow) — the
          // login is active right away, no set-password link needed.
          await users.bulkImportMembers([{ email: m.email, memberId: m.id, username: m.contactName || m.name, passwordHash: lead.passwordHash, passwordAlgo: 'bcrypt', needsReset: false }]);
          const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
          const r = await email.send({
            to: m.email,
            subject: 'Your Chamber membership is approved — you can sign in now',
            text: `Welcome${m.contactName ? ', ' + m.contactName : ''}!\n\nYour membership for ${m.name} is approved and your listing is live. Sign in with the email address and the password you chose on your application:\n${base}/auth/login.html\n\n— West Valley · Warner Center Chamber of Commerce\n(818) 347-4737`,
            html: `<p>Welcome${m.contactName ? ', ' + esc(m.contactName) : ''}!</p><p>Your membership for <strong>${esc(m.name)}</strong> is approved and your listing is live. <a href="${base}/auth/login.html">Sign in</a> with the email address and the password you chose on your application.</p><p>— West Valley · Warner Center Chamber of Commerce<br>(818) 347-4737</p>`,
          });
          login = r && r.ok ? 'login active with the password they chose · sign-in email sent' : 'login active with the password they chose · email pending';
        } else {
          login = await attachLoginAndInvite(m.id, m.email, m.contactName, m.name, req, true);
        }
      } catch (e) { console.error('approve-member login', e); login = 'member added; login step failed'; }
    }
    try { await repo.setLeadStatus(lead.id, 'done'); } catch (e) { /* non-fatal */ }
    res.json({ ok: true, member: m, login });
  } catch (e) { console.error('approve-member', e); res.status(500).json({ error: 'could not approve' }); }
});

// ── Ribbon-cutting workflow (per Diana & Felicia, Jul 13 2026) ──
// The date is confirmed BY PHONE — never auto-scheduled. The office records
// the agreed date/time here, the flyer arrives afterwards (610px-wide JPG per
// the office template), and nothing goes public until Publish.
const RC_STAGES = ['new', 'date-set', 'flyer-received', 'published', 'declined'];
router.patch('/admin/leads/:id/ribbon', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const f = {};
  if (b.rcDate !== undefined) f.rcDate = (b.rcDate && /^\d{4}-\d{2}-\d{2}$/.test(b.rcDate)) ? b.rcDate : '';
  if (b.rcTime !== undefined) f.rcTime = String(b.rcTime || '').slice(0, 40);
  if (b.rcVenue !== undefined) f.rcVenue = String(b.rcVenue || '').slice(0, 200);
  if (b.rcFlyer !== undefined) f.rcFlyer = String(b.rcFlyer || '').slice(0, 300);
  if (b.rcStage !== undefined && RC_STAGES.includes(b.rcStage)) f.rcStage = b.rcStage;
  if (!Object.keys(f).length) return res.status(400).json({ error: 'nothing to update' });
  try {
    const ok = await repo.patchLeadRibbon(req.params.id, f);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) { console.error('ribbon patch', e); res.status(500).json({ error: 'update failed' }); }
});

// Ribbon-cutting / event request → calendar event in one click (per Felicia,
// Jul 2026 — requests sat under Inquiries with no approve button). A request
// that carries a usable date goes straight onto the public calendar; an
// undated one is created as Pending so the office confirms the date first.
// Office-confirmed details (rcDate/rcTime/rcVenue/rcFlyer, set after the
// phone call) always beat whatever the member typed on the request.
router.post('/admin/leads/:id/approve-event', requireAdmin, async (req, res) => {
  try {
    const lead = (await repo.listLeads()).find((l) => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'inquiry not found' });
    const msg = String(lead.message || '');
    const line = (label) => {
      const m = msg.match(new RegExp('^' + label + ':\\s*(.*)$', 'mi'));
      return m ? m[1].trim() : '';
    };
    const isRibbon = String(lead.kind || '') === 'ribbon-cutting';
    const dateMatch = (String(lead.event || '') + ' ' + line('PREFERRED DATE')).match(/\d{4}-\d{2}-\d{2}/);
    const date = (lead.rcDate && /^\d{4}-\d{2}-\d{2}$/.test(lead.rcDate)) ? lead.rcDate : (dateMatch ? dateMatch[0] : '');
    const timeMatch = line('PREFERRED DATE').match(/\bat\s+(.+)$/i);
    const occasion = line('OCCASION');
    const company = String(lead.company || lead.name || '').trim();
    const ev = buildEvent({
      title: ((isRibbon ? 'Ribbon Cutting — ' : '') + (company || occasion || 'New event')).slice(0, 200),
      category: isRibbon ? 'Ribbon Cutting' : 'Event',
      date,
      time: (lead.rcTime || (timeMatch ? timeMatch[1] : '')).slice(0, 40),
      venue: (lead.rcVenue || line('LOCATION')).slice(0, 160),
      flyer: lead.rcFlyer || '',
      summary: occasion ? `${occasion}${company ? ' · ' + company : ''}` : String(lead.reason || ''),
      description: msg,
      status: date ? 'approved' : 'pending',
      confirmed: !!date,
      showOnCalendar: true,
      // No action button (Felicia, Aug 12 2026) — a ribbon cutting takes neither
      // an RSVP nor a payment, so approving one no longer publishes a dead
      // RSVP button. The office can switch one on from the event editor.
      hideCta: true,
    });
    await repo.upsertEvent(ev);
    try { await repo.setLeadStatus(lead.id, 'done'); } catch (e) { /* non-fatal */ }
    if (isRibbon) { try { await repo.patchLeadRibbon(lead.id, { rcStage: 'published', rcEventId: ev.id }); } catch (e) { /* non-fatal */ } }
    res.json({ ok: true, event: ev });
  } catch (e) { console.error('approve-event', e); res.status(500).json({ error: 'could not create the event' }); }
});

// Add-only merge of the committed event seed into the live store — brings
// newly imported LEGACY events (pre-June-2026 history w/ sponsor text) into
// production WITHOUT touching events the office has created or edited.
// (Unlike /admin/events/reseed, which wipes everything.)
router.post('/admin/events/seed-merge', requireAdmin, async (_req, res) => {
  try {
    await ensureEventsSeeded();
    const existing = new Set((await repo.listEventsStore()).map((e) => e.id));
    let added = 0;
    for (const e of readSeedEvents()) {
      if (existing.has(e.id)) continue;
      await repo.upsertEvent(buildEvent(e, e));
      added++;
    }
    res.json({ ok: true, added, skippedExisting: existing.size });
  } catch (e) { console.error('seed-merge', e); res.status(500).json({ error: 'merge failed' }); }
});

router.get('/admin/leads', requireAdmin, async (_req, res) => {
  // The applicant-chosen password hash stays server-side; the panel only needs
  // to know one was chosen.
  try { res.json({ leads: (await repo.listLeads()).map(({ passwordHash, ...l }) => (passwordHash ? { ...l, chosePassword: true } : l)) }); }
  catch (e) { res.status(500).json({ error: 'leads failed' }); }
});

router.patch('/admin/leads/:id', requireAdmin, async (req, res) => {
  // 'spam' both ways: the office can flag junk the screen missed, and rescue a
  // real inquiry the screen caught (marking it New returns it to its section).
  if (!['new', 'read', 'done', 'spam'].includes(req.body.status)) return res.status(400).json({ error: 'bad status' });
  try {
    const ok = await repo.setLeadStatus(req.params.id, req.body.status);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'update failed' }); }
});

router.get('/admin/orders', requireAdmin, async (_req, res) => {
  try { res.json({ orders: await repo.listOrders() }); }
  catch (e) { res.status(500).json({ error: 'orders failed' }); }
});

// Refund from Admin → Payments. NMI only refunds SETTLED charges; anything still
// pending settlement must be VOIDED instead — try refund first, fall back to void.
router.post('/admin/orders/:id/refund', requireAdmin, async (req, res) => {
  try {
    const order = (await repo.listOrders()).find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'order not found' });
    if (order.status === 'refunded') return res.json({ ok: true, status: 'refunded' });
    const txn = order.transactionId;
    // Orders with no gateway transaction (imported / recorded offline) can't be
    // refunded through NMI — mark them refunded in the log so the books match
    // whatever the office did outside the system (check, cash back, etc.).
    if (!txn) {
      await repo.setOrderStatus(order.id, 'refunded');
      try {
        email.send({
          to: email.notifyTo(),
          subject: `Marked refunded (no gateway txn): ${order.kind || 'order'} $${Number(order.amount).toFixed(2)}`,
          text: `An order was marked refunded from the admin panel. It has no gateway transaction, so no money moved through NMI — settle it offline if needed.\n\nOrder: ${order.id}\nPayer: ${order.name || ''} ${order.email || ''}\nAmount: $${Number(order.amount).toFixed(2)}`,
        }).catch(() => {});
      } catch (e) { /* notification only */ }
      return res.json({ ok: true, status: 'refunded', how: 'manual' });
    }

    let result = await refundTransaction({ transactionId: txn });
    let how = 'refund';
    if (!result.approved) {
      const v = await voidTransaction({ transactionId: txn });
      if (v.approved) { result = v; how = 'void'; }
    }
    if (!result.approved) {
      return res.status(402).json({ ok: false, error: result.responseText || 'refund declined' });
    }
    await repo.setOrderStatus(order.id, 'refunded');
    // Notify the office so the books stay straight.
    try {
      email.send({
        to: email.notifyTo(),
        subject: `Refunded: ${order.kind || 'order'} $${Number(order.amount).toFixed(2)}`,
        text: `Refund issued from the admin panel (${how}).\n\nOrder: ${order.id}\nPayer: ${order.name || ''} ${order.email || ''}\nAmount: $${Number(order.amount).toFixed(2)}\nGateway transaction: ${txn}`,
      }).catch(() => {});
    } catch (e) { /* notification only */ }
    res.json({ ok: true, status: 'refunded', how });
  } catch (err) {
    console.error('refund error', err);
    res.status(500).json({ ok: false, error: 'refund failed' });
  }
});

router.get('/admin/options', requireAdmin, (_req, res) => {
  res.json({ leaderOptions: LEADER_OPTS, statusOptions: STATUS_OPTS });
});

// List login accounts (+ whether the caller is a super-admin, for the UI).
router.get('/admin/users', requireAdmin, async (req, res) => {
  try { res.json({ users: await users.listUsers(), isSuper: req.user.role === 'super_admin' }); }
  catch (e) { console.error('list users', e); res.status(500).json({ error: 'could not list users' }); }
});

// Bulk-import member logins (legacy migration) — SUPER-ADMIN ONLY.
router.post('/admin/users/import', requireSuper, async (req, res) => {
  const list = Array.isArray(req.body && req.body.users) ? req.body.users : [];
  if (!list.length) return res.status(400).json({ error: 'No users provided.' });
  try { res.json({ ok: true, imported: await users.bulkImportMembers(list) }); }
  catch (e) { console.error('users import', e); res.status(500).json({ error: e.message }); }
});

// Change a user's role — SUPER-ADMIN ONLY.
router.patch('/admin/users/:email/role', requireSuper, async (req, res) => {
  const role = (req.body || {}).role;
  try {
    const ok = await users.setRole(req.params.email, role);
    if (!ok) return res.status(400).json({ error: 'Role unchanged (account not found or is env-managed).' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message || 'could not set role' }); }
});

// Create / update a staff or member login.
router.post('/admin/users', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.email || !b.password || String(b.password).length < 8) {
    return res.status(400).json({ error: 'email and an 8+ character password are required' });
  }
  try {
    if (b.role === 'member') await users.upsertMember(b.email, auth.hashPassword(b.password), b.memberId || null, b.name);
    else await users.upsertStaff(b.email, auth.hashPassword(b.password), b.name);
    res.json({ ok: true, email: b.email, role: b.role === 'member' ? 'member' : 'staff' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'could not create user' }); }
});

// ── Admin content & approvals (posts: news/announcements/discounts/member posts) ──
router.get('/admin/posts', requireAdmin, async (req, res) => {
  try {
    const type = req.query.type || undefined;
    const status = req.query.status || undefined;
    res.json({ posts: await repo.listPosts({ type, status }) });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

const ADMIN_POST_TYPES = ['news', 'announcement', 'discount', 'member_post', 'event', 'slide', 'gallery', 'job', 'listing', 'newsletter'];
router.post('/admin/posts', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!ADMIN_POST_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid type.' });
  if (!b.title) return res.status(400).json({ error: 'Title required.' });
  const post = {
    id: 'post-' + Date.now().toString(36),
    type: b.type, authorId: req.user.sub, authorName: 'WVWC Chamber', memberId: b.memberId || null,
    title: String(b.title).slice(0, 200), body: String(b.body || '').slice(0, 8000),
    imageUrl: clampUrl(b.imageUrl), linkUrl: clampUrl(b.linkUrl),
    ctaLabel: String(b.ctaLabel || '').slice(0, 40), ctaUrl: clampUrl(b.ctaUrl),
    code: String(b.code || '').slice(0, 80),
    status: b.status === 'pending' ? 'pending' : 'approved',
    featuredHome: !!b.featuredHome, expiresAt: b.expiresAt || null,
  };
  try { await repo.addPost(post); res.json({ ok: true, id: post.id }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'could not create' }); }
});

// Newsletter import-from-link (Diana/Felicia self-serve — see backend/newsletter-import.js).
registerNewsletterImport(router, requireAdmin);

router.patch('/admin/posts/:id', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.status && ['pending', 'approved', 'rejected'].includes(b.status)) patch.status = b.status;
  if (b.featuredHome !== undefined) patch.featuredHome = !!b.featuredHome;
  for (const f of ['title', 'body', 'imageUrl', 'linkUrl', 'ctaLabel', 'ctaUrl', 'code', 'expiresAt']) if (b[f] !== undefined) patch[f] = b[f];
  try {
    const ok = await repo.updatePost(req.params.id, patch);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'update failed' }); }
});

router.delete('/admin/posts/:id', requireAdmin, async (req, res) => {
  try { await repo.deletePost(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'delete failed' }); }
});

// ── Hero slider manager (admin) ─────────────────────────────
// Slides are `slide`-type posts; display order lives in meta.sortOrder.
// Create/delete reuse the posts routes above; these add ordered listing + reorder.
router.get('/admin/slides', requireAdmin, async (_req, res) => {
  try {
    const slides = (await repo.listPosts({ type: 'slide' }));
    slides.sort((a, b) => slideOrder(a) - slideOrder(b));
    res.json({ slides });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

// Persist a new order. Body: { order: [id, id, ...] } — index becomes sortOrder.
router.post('/admin/slides/reorder', requireAdmin, async (req, res) => {
  const order = Array.isArray(req.body && req.body.order) ? req.body.order : null;
  if (!order) return res.status(400).json({ error: 'order array required' });
  try {
    for (let i = 0; i < order.length; i++) {
      await repo.updatePost(String(order[i]), { meta: { sortOrder: i } });
    }
    res.json({ ok: true });
  } catch (e) { console.error('slides/reorder', e); res.status(500).json({ error: 'reorder failed' }); }
});

// ── Admin events (full CRUD; seeds the store from data/events.json on first write) ──
router.get('/admin/events', requireAdmin, async (_req, res) => {
  try { await ensureEventsSeeded(); res.json({ events: await loadEvents() }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'events failed' }); }
});
router.post('/admin/events', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Title required.' });
  try {
    await ensureEventsSeeded();
    const ev = buildEvent(b);
    await repo.upsertEvent(ev);
    res.json({ ok: true, event: ev });
  } catch (e) { console.error(e); res.status(500).json({ error: 'could not create' }); }
});
router.patch('/admin/events/:id', requireAdmin, async (req, res) => {
  try {
    await ensureEventsSeeded();
    const existing = (await loadEvents()).find((e) => e.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const ev = buildEvent({ ...req.body, id: existing.id }, existing);
    await repo.upsertEvent(ev);
    res.json({ ok: true, event: ev });
  } catch (e) { console.error(e); res.status(500).json({ error: 'update failed' }); }
});
router.delete('/admin/events/:id', requireAdmin, async (req, res) => {
  try { await ensureEventsSeeded(); await repo.deleteEvent(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'delete failed' }); }
});
// Wipe the events store/DB and reload from the committed data/events.json seed.
router.post('/admin/events/reseed', requireAdmin, async (_req, res) => {
  try {
    for (const e of await repo.listEventsStore()) await repo.deleteEvent(e.id);
    const seed = readSeedEvents().map((e) => buildEvent(e, e));
    for (const e of seed) await repo.upsertEvent(e);
    res.json({ ok: true, count: seed.length });
  } catch (e) { console.error('reseed', e); res.status(500).json({ error: 'reseed failed' }); }
});

// Admin DB diagnostic — confirms Postgres is connected and the schema applied.
router.get('/admin/db-test', requireAdmin, async (_req, res) => {
  try {
    const db = await import('./db.js');
    const out = { dbEnabled: db.enabled };
    if (db.enabled) {
      const t = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
      out.tables = t.rows.map((r) => r.table_name);
      try { out.events = (await db.query('SELECT count(*)::int AS n FROM events')).rows[0].n; } catch (e) {}
      try { out.posts = (await db.query('SELECT count(*)::int AS n FROM posts')).rows[0].n; } catch (e) {}
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin LLM diagnostic — which providers work, and the raw error if not.
router.get('/admin/llm-test', requireAdmin, async (_req, res) => {
  try { res.json(await llm.diagnose()); }
  catch (e) { res.status(500).json({ error: 'diagnose failed: ' + e.message }); }
});

// Flyer → event: Claude/Gemini vision reads a flyer and returns a draft to review.
router.post('/admin/events/from-flyer', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.dataUrl) return res.status(400).json({ error: 'Upload a flyer image or PDF.' });
  try {
    const year = new Date().getFullYear();
    const instruction = 'You are reading an event flyer/poster for a Chamber of Commerce. Extract the event into JSON with EXACTLY these keys: '
      + 'title, date (YYYY-MM-DD or ""), time (e.g. "6:00 PM" or ""), endDate, endTime, venue, address, neighborhood, category, '
      + 'summary (a 1-2 sentence overview), description (any extra details/agenda/speakers), ticketed (true/false), '
      + 'links (array of {label,url,type} where type is one of tickets|register|sponsors|info — include only URLs actually printed on the flyer). '
      + `If the year is missing assume ${year} or the next future occurrence. Use "" for unknown text fields and [] when there are no links. Output JSON only.`;
    const out = await llm.visionJSON({ instruction, imageDataUrl: b.dataUrl });
    const raw = (out.text || '').replace(/^```json\s*|\s*```$/g, '').trim();
    let parsed = {};
    try { parsed = JSON.parse(raw); }
    catch (e) { const mm = /\{[\s\S]*\}/.exec(raw); if (mm) { try { parsed = JSON.parse(mm[0]); } catch (_) {} } }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    res.json({ ok: true, draft: parsed, provider: out.provider, model: out.model });
  } catch (e) { console.error('from-flyer', e); res.status(500).json({ error: 'Could not read the flyer. Try a clearer image (PNG/JPG) or a PDF, under ~4MB.' }); }
});

// ── Internal admin assistant (Claude / Anthropic) ───────────
// Grounds analysis in live Chamber data and drafts ready-to-use content.
async function chamberSnapshot() {
  const { members } = await loadMembersFull();
  const approved = members.filter((m) => (m.status || 'approved') === 'approved');
  const byCat = {};
  approved.forEach((m) => { const c = (m.category || 'Uncategorized').trim() || 'Uncategorized'; byCat[c] = (byCat[c] || 0) + 1; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const byHood = {};
  approved.forEach((m) => { const h = (m.neighborhood || m.city || '').trim(); if (h) byHood[h] = (byHood[h] || 0) + 1; });
  const hoods = Object.entries(byHood).sort((a, b) => b[1] - a[1]).slice(0, 15);
  let events = [], posts = [], leads = [];
  try { events = await loadEvents(); } catch (e) {}
  try { posts = await repo.listPosts({}); } catch (e) {}
  try { leads = await repo.listLeads(); } catch (e) {}
  const catLine = cats.slice(0, 120).map(([c, n]) => `${c} (${n})`).join(', ')
    + (cats.length > 120 ? `, …and ${cats.length - 120} more categories` : '');
  return [
    `Total members: ${members.length} (approved & public: ${approved.length}).`,
    `Distinct business categories: ${cats.length}.`,
    `Categories by member count: ${catLine}.`,
    `Top neighborhoods: ${hoods.map(([h, n]) => `${h} (${n})`).join(', ')}.`,
    `Events on file: ${events.length}. Content posts (all statuses): ${posts.length}. Inquiries/leads: ${leads.length}.`,
  ].join('\n');
}

// Parse data: URLs (image/PDF) into { mediaType, data } base64 blocks. Caps the
// number and total size so a stray upload can't blow the request budget.
function parseAttachments(list) {
  const re = /^data:(image\/(?:png|jpe?g|gif|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/;
  const out = [];
  let bytes = 0;
  for (const a of (Array.isArray(list) ? list : []).slice(0, 4)) {
    const m = re.exec(typeof a === 'string' ? a : (a && a.dataUrl) || '');
    if (!m) continue;
    bytes += Math.floor(m[2].length * 0.75);
    if (bytes > 12 * 1024 * 1024) break; // ~12MB total ceiling
    out.push({ mediaType: m[1], data: m[2] });
  }
  return out;
}

router.post('/staff-assistant', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const messages = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Send at least one user message.' });
  }
  const attachments = parseAttachments(b.attachments);
  try {
    const ctx = await chamberSnapshot();
    const system = 'You are the internal staff assistant for the West Valley · Warner Center Chamber of Commerce, powered by Claude. '
      + 'You help Chamber staff and admins: analyze the membership, identify gaps and opportunities, and draft ready-to-use, professional content '
      + '(recruitment emails, member newsletters, social posts, event copy, sponsor outreach, announcements). '
      + 'Voice: warm, local, professional, and concise. When asked to write something, return polished copy the admin can paste and send — '
      + 'use clear subject lines for emails. When analyzing, ground every claim in the live data below and be specific (cite category counts). '
      + 'If asked which categories need more members, reason from the per-category counts (low or missing categories are the gaps).\n\n'
      + (attachments.length ? 'The admin has attached one or more files (images/PDFs) — read them and use their contents to answer or draft. '
        + 'Common uses: read a flyer to build an event, summarize a contract, or rewrite a past email the admin pasted/attached.\n\n' : '')
      + '=== LIVE CHAMBER DATA (today) ===\n' + ctx;
    const out = await llm.chat({ system, messages, attachments, maxTokens: 1800 });
    res.json({ ok: true, answer: out.text, provider: out.provider, model: out.model });
  } catch (e) { console.error('staff-assistant', e); res.status(500).json({ error: 'The assistant is unavailable right now.' }); }
});

// ── Saved conversations (shared across staff) ───────────────
router.get('/admin/assistant/threads', requireAdmin, async (_req, res) => {
  try { res.json({ threads: await repo.listThreads() }); }
  catch (e) { console.error('listThreads', e); res.status(500).json({ error: 'could not load saved conversations' }); }
});
router.post('/admin/assistant/threads', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const messages = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 12000) }));
  if (!messages.length) return res.status(400).json({ error: 'Nothing to save yet.' });
  const id = (b.id && /^th-/.test(b.id)) ? b.id : ('th-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36));
  const title = String(b.title || messages.find((m) => m.role === 'user')?.content || 'Conversation').slice(0, 120);
  const thread = { id, title, messages, savedBy: (req.user && req.user.sub) || 'staff', updated: new Date().toISOString() };
  try { await repo.upsertThread(thread); res.json({ ok: true, thread }); }
  catch (e) { console.error('saveThread', e); res.status(500).json({ error: 'could not save' }); }
});
router.delete('/admin/assistant/threads/:id', requireAdmin, async (req, res) => {
  try { await repo.deleteThread(req.params.id); res.json({ ok: true }); }
  catch (e) { console.error('deleteThread', e); res.status(500).json({ error: 'could not delete' }); }
});

// ── Message template library (Felicia's reusable emails) ────
router.get('/admin/templates', requireAdmin, async (_req, res) => {
  try { res.json({ templates: await repo.listTemplates() }); }
  catch (e) { console.error('listTemplates', e); res.status(500).json({ error: 'could not load templates' }); }
});
router.post('/admin/templates', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const body = String(b.body || '').trim();
  if (!name || !body) return res.status(400).json({ error: 'A name and the message body are required.' });
  const id = (b.id && /^tpl-/.test(b.id)) ? b.id : ('tpl-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36));
  const tpl = { id, name: name.slice(0, 120), category: String(b.category || '').slice(0, 60),
    subject: String(b.subject || '').slice(0, 200), body: body.slice(0, 16000),
    savedBy: (req.user && req.user.sub) || 'staff', updated: new Date().toISOString() };
  try { await repo.upsertTemplate(tpl); res.json({ ok: true, template: tpl }); }
  catch (e) { console.error('saveTemplate', e); res.status(500).json({ error: 'could not save template' }); }
});
router.delete('/admin/templates/:id', requireAdmin, async (req, res) => {
  try { await repo.deleteTemplate(req.params.id); res.json({ ok: true }); }
  catch (e) { console.error('deleteTemplate', e); res.status(500).json({ error: 'could not delete template' }); }
});

// AI redraft: take a saved template (or pasted body) + specifics → fresh copy.
router.post('/admin/template-draft', requireAdmin, async (req, res) => {
  const b = req.body || {};
  let base = String(b.body || '').trim();
  if (!base && b.templateId) {
    try { const t = (await repo.listTemplates()).find((x) => x.id === b.templateId); if (t) base = `${t.subject ? 'Subject: ' + t.subject + '\n\n' : ''}${t.body}`; } catch (e) {}
  }
  if (!base) return res.status(400).json({ error: 'Pick a template or paste an example message first.' });
  const instructions = String(b.instructions || '').slice(0, 2000);
  try {
    const ctx = await chamberSnapshot();
    const system = 'You are the internal staff assistant for the West Valley · Warner Center Chamber of Commerce, powered by Claude. '
      + 'Felicia keeps a library of past emails she reuses. Given ONE example message and a few specifics, write a fresh version '
      + 'that keeps the original tone, structure, and signature style but adapts the details. Return ready-to-send copy: a clear '
      + '"Subject:" line on the first line when it is an email, then the body. No commentary, no markdown fences.\n\n'
      + '=== LIVE CHAMBER DATA (for accurate names/numbers) ===\n' + ctx;
    const prompt = `EXAMPLE MESSAGE (match this voice and format):\n"""\n${base.slice(0, 12000)}\n"""\n\nSPECIFICS FOR THE NEW VERSION:\n${instructions || '(none given — produce a clean, reusable version of the example)'}`;
    const out = await llm.chat({ system, messages: [{ role: 'user', content: prompt }], maxTokens: 1400 });
    res.json({ ok: true, draft: out.text, provider: out.provider, model: out.model });
  } catch (e) { console.error('template-draft', e); res.status(500).json({ error: 'Could not draft right now.' }); }
});

/* ── Sitemap feed ───────────────────────────────────────────────────────────
   The database-driven half of /sitemap.xml; server.js owns the static half and
   renders the XML. Every query below reuses the SAME filter as the matching
   public endpoint above (approved members, approved+confirmed events, approved
   groups, non-hidden pages), so the sitemap can never advertise a URL the site
   would 404 or deliberately hide. Each source is wrapped on its own: if the
   database is briefly unavailable we serve a smaller sitemap rather than a 500,
   because an empty sitemap is a far worse signal to Google than a short one. */
export async function sitemapEntries() {
  const out = [];

  try {
    const { members } = await loadMembersPublic();
    for (const m of members) if (m.slug) out.push(`/members/${m.slug}`);
  } catch (e) { console.error('sitemap: members unavailable —', e.message); }

  try {
    /* Upcoming events, plus the last 12 months of history. The public calendar
       deliberately hides past events, so listing every one ever held would hand
       Google a few hundred pages nothing on the site links to — they get
       crawled, not indexed, and clutter Search Console. A year back keeps the
       recent write-ups (still reachable from albums and news) without the tail.
       Dates are plain 'YYYY-MM-DD' and compared as strings on purpose: parsing
       them makes a bare date UTC midnight, which reads as the day before in
       California. */
    const cutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const events = (await loadEvents()).filter((e) =>
      (e.status || 'approved') === 'approved' && e.confirmed && e.date && e.date >= cutoff);
    for (const ev of events) out.push(`/events/view.html?id=${encodeURIComponent(ev.id)}`);
  } catch (e) { console.error('sitemap: events unavailable —', e.message); }

  try {
    const groups = (await loadGroups()).filter((g) => g.status === 'approved');
    for (const g of groups) if (g.slug) out.push(`/groups/${g.slug}`);
  } catch (e) { console.error('sitemap: groups unavailable —', e.message); }

  try {
    let ov = {};
    try { ov = await repo.getPageOverrides(); } catch { ov = {}; }
    for (const p of readPages()) {
      if (ov[p.slug] && ov[p.slug].hidden) continue;
      out.push(`/p/${p.slug}`);
      if (p.html_es) out.push(`/es/p/${p.slug}`);   // only when a translation exists
    }
  } catch (e) { console.error('sitemap: pages unavailable —', e.message); }

  try {
    for (const g of readGuides()) {
      if (!g.slug) continue;
      out.push(`/guides/${g.slug}`);
      if (g.title_es) out.push(`/es/guides/${g.slug}`);
    }
  } catch (e) { console.error('sitemap: guides unavailable —', e.message); }

  return out;
}

export { sanitizeProfile };
/* server.js stamps the real business details into /members/<slug> before the
   page leaves the building — same reason the album pages stamp their og:* tags.
   Exported here so there is one definition of "what the public may see" and
   the crawler can never be shown a field the API would have withheld. */
export { loadMembersPublic };
export default router;
