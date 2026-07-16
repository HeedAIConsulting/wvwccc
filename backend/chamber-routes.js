/* ============================================================
   WVWCCC — API routes (mounted at /api by server.js)
   Durable data via backend/repo.js (Postgres when DATABASE_URL set).
   ============================================================ */
import express from 'express';
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

const router = express.Router();

// Per-member cooldown for the AI rewrite endpoint (simple in-memory guard).
const aiRewriteCooldown = new Map();
const magicLinkCooldown = new Map();
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Staff/admin gate — real session auth.
const requireAdmin = auth.requireAuth(['staff', 'admin', 'super_admin']);
const requireSuper = auth.requireAuth(['super_admin']);

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

// The identities a member can post an event "as" (per Diana/Felicia, Jul 15 —
// this replaces the old two-logins setup: one login, but a chair chooses
// whether an event is on behalf of their BUSINESS or a GROUP they lead).
// First entry is the default. Business (if they have a listing) leads, then
// each group they manage.
async function postingIdentities(user) {
  const out = [];
  const m = await myMember(user.mid);
  if (m) out.push({ key: 'business', kind: 'business', name: m.name, memberId: m.id });
  for (const g of await managedGroups(user.sub)) out.push({ key: g.slug, kind: 'group', name: g.name, slug: g.slug });
  return out;
}

router.get('/me/is-leader', auth.requireAuth(), async (req, res) => {
  try {
    const m = await myMember(req.user.mid); const g = await managedGroups(req.user.sub);
    res.json({ leader: memberIsLeader(m) || g.length > 0, canSubmit: !!req.user.mid, name: m ? m.name : null, groups: g.map((x) => x.name), identities: await postingIdentities(req.user) });
  } catch (e) { res.json({ leader: false }); }
});

router.get('/me/events', auth.requireAuth(), async (req, res) => {
  try {
    const mid = req.user.mid;
    const mine = (await loadEvents()).filter((e) => e.submittedBy && e.submittedBy === mid)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const identities = await postingIdentities(req.user);
    // canSubmit = any member with a listing may add an event (leaders publish
    // immediately; others go to the office's approval queue). isLeader is kept
    // for the immediate-publish path and the "posting as" chooser.
    res.json({ events: mine, canSubmit: !!mid, isLeader: memberIsLeader(await myMember(mid)) || identities.some((i) => i.kind === 'group'), identities });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

router.post('/me/event', auth.requireAuth(), async (req, res) => {
  const mid = req.user.mid;
  if (!mid) return res.status(400).json({ error: 'No member listing is linked to this account.' });
  const member = await myMember(mid);
  const lead = await managedGroups(req.user.sub);
  const b = req.body || {};
  if (!b.title || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) {
    return res.status(400).json({ error: 'An event title and a valid date are required.' });
  }
  // ANY member with a listing can submit an event (matching the old site, per
  // the office, Jul 16). Leaders/board/chairs publish immediately; a regular
  // member's event goes to the office's "Needs publish" queue for one-click
  // approval, so nothing hits the public calendar unreviewed.
  const immediate = memberIsLeader(member) || lead.length > 0;
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
    confirmed: immediate, status: immediate ? 'approved' : 'pending', showOnCalendar: true,
  };
  // Optional weekly recurrence: one event per week through `until` (cap 52).
  const dates = [];
  if (b.recurrence === 'weekly' && /^\d{4}-\d{2}-\d{2}$/.test(String(b.until || ''))) {
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

router.delete('/me/event/:id', auth.requireAuth(), async (req, res) => {
  const mid = req.user.mid;
  try {
    const all = await loadEvents();
    const ev = all.find((e) => e.id === req.params.id);
    if (!ev || ev.submittedBy !== mid) return res.status(404).json({ error: 'Event not found.' });
    const toDelete = ev.seriesId ? all.filter((e) => e.seriesId === ev.seriesId && e.submittedBy === mid) : [ev];
    for (const e of toDelete) await repo.deleteEvent(e.id);
    res.json({ ok: true, deleted: toDelete.length });
  } catch (e) { console.error('me/event delete', e); res.status(500).json({ error: 'Could not remove the event.' }); }
});

// Image upload (data URL) → stored in Postgres, served at /api/assets/:id.
router.post('/me/asset', auth.requireAuth(), async (req, res) => {
  const b = req.body || {};
  // Accept images (logos/photos/flyers/thumbnails) and PDFs (event documents).
  const m = /^data:(image\/(?:png|jpe?g|gif|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl || '');
  if (!m) return res.status(400).json({ error: 'Provide a PNG, JPG, GIF, or WebP image, or a PDF.' });
  const mime = m[1];
  const buffer = Buffer.from(m[2], 'base64');
  const limit = mime === 'application/pdf' ? 6_000_000 : 2_500_000;
  if (buffer.length > limit) return res.status(413).json({ error: mime === 'application/pdf' ? 'PDF too large (max ~6MB).' : 'Image too large (max ~2.5MB).' });
  const kind = mime === 'application/pdf' ? 'doc' : (b.kind === 'logo' ? 'logo' : 'photo');
  const id = 'asset-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  try {
    await repo.addAsset({ id, memberId: req.user.mid || null, kind, mime, buffer });
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

function buildEvent(b, existing = {}) {
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
    confirmed: b.confirmed !== undefined ? !!b.confirmed : (existing.confirmed ?? !!date),
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
        })).filter((t) => t.name)
      : (existing.ticketTypes || []),
    status: ['approved', 'pending', 'draft'].includes(b.status) ? b.status : (existing.status || 'approved'),
    images, links,
    // Attribution (who/what an event is posted on behalf of) is set on member
    // submissions; carry it through admin edits so a staff tweak never erases
    // the "Hosted by" line or drops the event off its group page.
    ...(pick(b, existing, ['hostKind', 'hostName', 'hostSlug', 'groupName', 'groupSlug', 'submittedBy', 'submittedByName', 'source', 'seriesId'])),
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
router.get('/events', async (_req, res) => {
  try {
    const all = await loadEvents();
    res.json({ events: all.filter((e) => (e.status || 'approved') === 'approved') });
  } catch (e) { console.error(e); res.status(500).json({ error: 'events unavailable' }); }
});
router.get('/events/:id', async (req, res) => {
  try {
    const ev = (await loadEvents()).find((e) => e.id === req.params.id);
    if (!ev || (ev.status || 'approved') !== 'approved') return res.status(404).json({ error: 'not found' });
    res.json(ev);
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
    res.json({ ok: true, group: g });
  } catch (e) { console.error(e); res.status(500).json({ error: 'save failed' }); }
});
router.delete('/admin/groups/:id', requireAdmin, async (req, res) => {
  try { await repo.deleteGroup(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'delete failed' }); }
});

// 📣 Email every active member of a group (meeting reminders, agendas,
// announcements). Roster entries added from the directory carry only a
// memberId — their email resolves from the member roster/login at send time.
router.post('/admin/groups/:id/announce', requireAdmin, async (req, res) => {
  const subject = String((req.body && req.body.subject) || '').trim().slice(0, 160);
  const message = String((req.body && req.body.message) || '').trim().slice(0, 5000);
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required.' });
  try {
    const g = (await loadGroups()).find((x) => x.id === req.params.id || x.slug === req.params.id);
    if (!g) return res.status(404).json({ error: 'group not found' });
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
    res.json({ ok: true, sent, skipped: roster.length - targets.size, total: roster.length });
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
const POPUP_DEFAULT = {
  enabled: true,
  image: 'assets/events/gala-2026-black-white-bold.jpg', // current flyer w/ First Bank + Horvath (Diana, Jul 16)
  title: 'Black, White & Bold Installation Gala',
  subtitle: 'Saturday, July 25 · Woodland Hills Country Club',
  buttonLabel: '🎟 Get tickets, sponsorships & program ads',
  href: 'checkout.html?type=ticket&event=le-11209',
  retireAt: '', // ISO date/datetime; blank = never auto-hide
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

// Pricing catalog (memberships, donation presets, ticket convention).
let _skus = null;
router.get('/skus', (_req, res) => {
  if (!_skus) { try { _skus = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'skus.json'), 'utf8')); } catch { _skus = { memberships: [], donations: [] }; } }
  res.json(_skus);
});

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
          amount: Number(b.amount), transactionId: result.transactionId || '',
          status: 'declined',
        });
      } catch (e) { console.error('declined-attempt log failed', e); }
      return res.status(402).json({ ok: false, error: result.responseText || 'declined', code: result.raw.response });
    }
    const order = {
      id: 'ord-' + Date.now().toString(36),
      kind: b.kind, sku: b.sku || '', email: b.email || '',
      name: [b.firstName, b.lastName].filter(Boolean).join(' '),
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
router.post('/contact', async (req, res) => {
  const b = req.body || {};
  // Bot protection — Cloudflare Turnstile (no-op until TURNSTILE_SECRET is set).
  const cap = await turnstile.verify(b['cf-turnstile-response'] || b.turnstileToken, req.ip);
  if (!cap.ok) return res.status(400).json({ ok: false, error: 'Please complete the human-verification check and try again.' });
  if (!b.email || !(b.message || b.company || b.name)) {
    return res.status(400).json({ ok: false, error: 'Please include your email and a message.' });
  }
  const lead = {
    id: 'lead-' + Date.now().toString(36),
    kind: b.kind || 'contact',
    name: [b.firstName, b.lastName].filter(Boolean).join(' ') || b.name || '',
    email: b.email, phone: b.phone || '', company: b.company || '',
    reason: b.reason || b.kind || '', event: b.event || '', message: b.message || '',
    status: 'new', received: new Date().toISOString(),
  };
  // Membership applications carry extra fields (business type, employee count,
  // level of interest) — keep them in the message so the office sees the full
  // application and one-click approval loses nothing.
  if (lead.kind === 'membership-application' && !lead.message) {
    lead.message = [
      b.businessType ? `Business type: ${String(b.businessType).slice(0, 120)}` : '',
      b.employees ? `Employees: ${String(b.employees).slice(0, 20)}` : '',
      b.level ? `Level of interest: ${String(b.level).slice(0, 80)}` : '',
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
  // If the lead references an event by raw id (older pages / direct API), resolve
  // it to the event title so the admin panel + office email are self-explanatory.
  if (lead.event && /^(le|ev)-/.test(lead.event)) {
    try {
      const ev = (await loadEvents()).find((x) => x.id === lead.event);
      if (ev) lead.event = `${ev.title}${ev.date ? ` (${ev.date})` : ''} [${ev.id}]`;
    } catch (e) { /* keep the raw id */ }
  }
  // If the inquiry came from a group page (e.g. a meeting RSVP), route the
  // notification to that group's manager instead of the general office.
  let notifyTo = email.notifyTo(), groupName = '';
  if (b.group) {
    try {
      const g = (await loadGroups()).find((x) => x.slug === b.group || x.id === b.group);
      if (g) { groupName = g.name; if (g.manager && g.manager.email) notifyTo = g.manager.email; lead.reason = lead.reason || `Group: ${g.name}`; }
    } catch (e) {}
  }
  try {
    await repo.addLead(lead);
    // A New Member application may carry a ribbon-cutting request (per the
    // Chamber office, Jul 2026 — the application is the only place that offers
    // it). File it as its own inquiry so it lands in the admin's pending
    // Ribbon Cutting queue with its one-click approve.
    if (lead.kind === 'membership-application' && b.ribbonCutting) {
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
    const isGroupManager = notifyTo !== email.notifyTo();
    if (officeWantsEmail || isGroupManager) {
      const body = `New ${lead.reason || lead.kind} from the website\n\n`
        + `Name: ${lead.name || '—'}\nEmail: ${lead.email}\nPhone: ${lead.phone || '—'}\n`
        + `Company: ${lead.company || '—'}\nEvent: ${lead.event || '—'}${groupName ? `\nGroup: ${groupName}` : ''}\n\nMessage:\n${lead.message || '—'}\n`;
      email.send({
        to: notifyTo,
        replyTo: lead.email,
        subject: `${groupName ? `[${groupName}] ` : ''}Website inquiry: ${lead.reason || lead.kind}${lead.company ? ' — ' + lead.company : ''}`,
        text: body,
      }).catch((e) => console.error('notify email failed', e));
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
      html: `<p>Welcome${hello}!</p>
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
      html: `<p>Hello${hello},</p><p>Here is your link to set a new password for your Chamber account (<strong>${addr}</strong>). It expires in 1 hour:</p><p><a href="${link}"><strong>Set your password</strong></a></p><p>If the link expires, ask the Chamber office to send a new one, or use “Forgot password” on the <a href="${base}/auth/login.html">sign-in page</a>.</p><p>West Valley · Warner Center Chamber of Commerce<br>(818) 347-4737</p>`,
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
      html: `<p>Hello${hello},</p><p>Click to sign straight in to your Chamber account (<strong>${addr}</strong>) — no password needed. This link expires in 20 minutes:</p><p><a href="${link}"><strong>Sign in to the Chamber</strong></a></p><p>Once you're in, you can set a password under your profile if you'd like.</p><p>West Valley · Warner Center Chamber of Commerce<br>(818) 347-4737</p>`,
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

router.get('/admin/summary', requireAdmin, async (_req, res) => {
  try {
    const { members, source } = await loadMembersFull();
    const leads = await repo.listLeads();
    const orders = await repo.listOrders();
    const pendingPosts = (await repo.listPosts({ status: 'pending' })).length;
    res.json({
      source,
      members: members.length,
      pendingMembers: members.filter((m) => m.status === 'pending').length,
      leaders: members.filter((m) => m.leaderStatus).length,
      newLeads: leads.filter((l) => l.status === 'new').length,
      pendingPosts,
      // Declined attempts are visible in the Pay Log but never count as money.
      orders: orders.filter((o) => (o.status || 'paid') !== 'declined').length,
      revenue: orders.filter((o) => (o.status || 'paid') === 'paid').reduce((s, o) => s + (Number(o.amount) || 0), 0),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'summary failed' }); }
});

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
          html: `<p>Welcome${m.contactName ? ', ' + m.contactName : ''}!</p><p>Your Chamber member listing for <strong>${m.name}</strong> is set up. Create your password to manage your listing:</p><p><a href="${link}">Set up your account</a> (link expires in 1 hour — otherwise use “Forgot password” on the sign-in page).</p><p>— West Valley · Warner Center Chamber of Commerce</p>`,
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
    html: `<p>Hello${displayName ? ' ' + displayName : ''},</p><p>Your member listing for <strong>${businessName}</strong> is live on the West Valley · Warner Center Chamber website, and a member login has been created for this email address.</p><p><a href="${link}">Set your password</a> to manage your listing — photos, description, offers, and more.</p><p>(The link expires in 1 hour — if it expires, just use “Forgot password” on the <a href="${base}/auth/login.html">sign-in page</a>.)</p><p>— West Valley · Warner Center Chamber of Commerce<br>(818) 347-4737</p>`,
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
      address: '', city: '', state: '', zip: '', website: '', tagline: '',
      description: '', joinDate: new Date().toISOString().slice(0, 10),
      tags: [], status: 'approved', seal: (name[0] || '?').toUpperCase(),
      paymentType: 'offline', addedManually: true, leaderStatus: 'New Member',
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
            html: `<p>Welcome${m.contactName ? ', ' + m.contactName : ''}!</p><p>Your membership for <strong>${m.name}</strong> is approved and your listing is live. <a href="${base}/auth/login.html">Sign in</a> with the email address and the password you chose on your application.</p><p>— West Valley · Warner Center Chamber of Commerce<br>(818) 347-4737</p>`,
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
  if (!['new', 'read', 'done'].includes(req.body.status)) return res.status(400).json({ error: 'bad status' });
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

export { sanitizeProfile };
export default router;
