/* ============================================================
   WVWCCC — API routes (mounted at /api by server.js)
   Durable data via backend/repo.js (Postgres when DATABASE_URL set).
   ============================================================ */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sale, addRecurring, heedShare } from './payments-agms.js';
import * as auth from './auth.js';
import * as users from './users.js';
import * as repo from './repo.js';
import * as llm from './llm.js';
import * as turnstile from './turnstile.js';
import * as email from './email.js';

const router = express.Router();
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Staff/admin gate — real session auth.
const requireAdmin = auth.requireAuth(['staff', 'admin', 'super_admin']);
const requireSuper = auth.requireAuth(['super_admin']);

const LEADER_OPTS = ['', 'Leader', 'Board Member', 'New Member', 'Past President', 'Ambassador'];
const STATUS_OPTS = ['approved', 'pending', 'suspended', 'inactive'];

// ── Auth ────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
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
    auth.setCookie(res, auth.signSession(user));
    // mustChange = logged in with a legacy password → force a new one now.
    res.json({ ok: true, role: user.role, mustChange: !!user.mustChange });
  } catch (e) { console.error('login error', e); res.status(500).json({ error: 'login failed' }); }
});

router.post('/auth/logout', (_req, res) => { auth.clearCookie(res); res.json({ ok: true }); });

// Forgot password — records the request and (when SMTP is configured) emails a
// reset link. Always returns a generic success so we never reveal who has an
// account. NOTE: actual email delivery needs an SMTP/email sender (TODO).
router.post('/auth/forgot', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  try {
    const user = await users.getUserByEmail(email);
    if (user) {
      const token = auth.signResetToken(email);
      const base = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
      const link = `${base}/auth/reset.html?token=${encodeURIComponent(token)}`;
      await email.send({
        to: email,
        subject: 'Reset your West Valley · Warner Center Chamber password',
        text: `We received a request to reset your Chamber account password.\n\nReset it here (link expires in 1 hour):\n${link}\n\nIf you didn't request this, you can ignore this email.`,
        html: `<p>We received a request to reset your Chamber account password.</p><p><a href="${link}">Reset your password</a> (link expires in 1 hour).</p><p>If you didn't request this, you can ignore this email.</p>`,
      });
    }
  } catch (e) { /* swallow — never leak account existence */ }
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
  'description', 'leaderStatus', 'seal', 'featured', 'tags', 'keywords', 'categories',
  // richer profile (member-managed)
  'hours', 'occupation', 'typeOfBusiness', 'yearEstablished', 'employees',
  'logo', 'photos', 'social', 'reviewLinks', 'ctaLinks'];

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
  const [edits, overrides, added] = await Promise.all([repo.getMemberEdits(), repo.getOverrides(), repo.listAddedMembers()]);
  const base = members.concat(added || []);
  return { source, members: base.map((m) => ({ ...m, ...(edits[m.id] || {}), ...(overrides[m.id] || {}) })) };
}
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// Scalar fields a member may edit (admin-only: status/tier/leader/featured).
const MEMBER_STR_FIELDS = ['name', 'category', 'neighborhood', 'contactName', 'phone', 'fax',
  'website', 'address', 'city', 'state', 'zip', 'tagline', 'description', 'hours',
  'occupation', 'typeOfBusiness', 'yearEstablished', 'employees', 'logo'];
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
    for (const k of ['facebook', 'instagram', 'linkedin', 'x', 'youtube', 'tiktok']) if (b.social[k]) out[k] = clampUrl(b.social[k]);
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

// Member submits an offer/discount or a community post → pending admin approval.
router.post('/me/post', auth.requireAuth(), async (req, res) => {
  const mid = req.user.mid;
  if (!mid) return res.status(400).json({ error: 'No member listing is linked to this account.' });
  const b = req.body || {};
  const type = ['discount', 'member_post'].includes(b.type) ? b.type : null;
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
  };
  try { await repo.addPost(post); res.json({ ok: true, status: 'pending' }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'could not submit' }); }
});

router.get('/me/posts', auth.requireAuth(), async (req, res) => {
  if (!req.user.mid) return res.json({ posts: [] });
  try { res.json({ posts: await repo.listPosts({ memberId: req.user.mid }) }); }
  catch (e) { res.status(500).json({ error: 'failed' }); }
});

// Image upload (data URL) → stored in Postgres, served at /api/assets/:id.
router.post('/me/asset', auth.requireAuth(), async (req, res) => {
  const b = req.body || {};
  const m = /^data:(image\/(png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl || '');
  if (!m) return res.status(400).json({ error: 'Provide a PNG, JPG, GIF, or WebP image.' });
  const buffer = Buffer.from(m[3], 'base64');
  if (buffer.length > 2_500_000) return res.status(413).json({ error: 'Image too large (max ~2.5MB).' });
  const id = 'asset-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  try {
    await repo.addAsset({ id, memberId: req.user.mid || null, kind: b.kind === 'logo' ? 'logo' : 'photo', mime: m[1], buffer });
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
  const type = ['discount', 'member_post', 'news', 'announcement'].includes(req.query.type) ? req.query.type : undefined;
  try {
    const now = Date.now();
    const posts = (await repo.listPosts({ type, status: 'approved' }))
      .filter((p) => !p.expiresAt || new Date(p.expiresAt).getTime() > now);
    res.json({ posts });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});

// Homepage hero slider (admin-managed event photos).
router.get('/slides', async (_req, res) => {
  try { res.json({ slides: (await repo.listPosts({ type: 'slide', status: 'approved' })).filter((s) => s.imageUrl) }); }
  catch (e) { res.status(500).json({ error: 'failed' }); }
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
async function ensureEventsSeeded() {
  if (!(await repo.hasEvents())) {
    for (const e of readSeedEvents()) await repo.upsertEvent(buildEvent(e, e));
    _eventImgBackfillDone = true;
    return;
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
function buildEvent(b, existing = {}) {
  const date = b.date ?? existing.date ?? '';
  const d = date ? new Date(date + 'T12:00:00') : null;
  const images = Array.isArray(b.images)
    ? b.images.slice(0, 3).map(clampUrl).filter(Boolean)
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
    ticketed: b.ticketed !== undefined ? !!b.ticketed : (existing.ticketed ?? false),
    ticketCap: b.ticketCap ?? existing.ticketCap ?? null,
    rsvpCutoff: b.rsvpCutoff ?? existing.rsvpCutoff ?? null,
    featured: b.featured !== undefined ? !!b.featured : (existing.featured ?? false),
    status: ['approved', 'pending', 'draft'].includes(b.status) ? b.status : (existing.status || 'approved'),
    images, links,
    created: existing.created || new Date().toISOString(),
    updated: new Date().toISOString(),
  };
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

// ── Static content pages (migrated legacy IA) ──
let _pages = null;
function readPages() {
  if (_pages) return _pages;
  try { _pages = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'pages.json'), 'utf8')).pages || []; }
  catch { _pages = []; }
  return _pages;
}
router.get('/pages', (_req, res) => {
  res.json({ pages: readPages().map((p) => ({ slug: p.slug, title: p.title, group: p.group })) });
});
router.get('/pages/:slug', (req, res) => {
  const p = readPages().find((x) => x.slug === req.params.slug);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
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

// ── Payments (AGMS) ─────────────────────────────────────────
router.post('/pay', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.paymentToken) return res.status(400).json({ ok: false, error: 'missing payment token' });
    if (!b.amount || Number(b.amount) <= 0) return res.status(400).json({ ok: false, error: 'invalid amount' });

    const common = {
      paymentToken: b.paymentToken,
      email: b.email, firstName: b.firstName, lastName: b.lastName,
      orderId: b.sku || b.kind, description: b.description, productSku: b.sku,
    };
    const result = b.kind === 'membership' && b.recurring
      ? await addRecurring({ ...common, planAmount: b.amount, ...b.recurring })
      : await sale({ ...common, amount: b.amount });

    if (!result.approved) {
      return res.status(402).json({ ok: false, error: result.responseText || 'declined', code: result.raw.response });
    }
    const order = {
      id: 'ord-' + Date.now().toString(36),
      kind: b.kind, sku: b.sku || '', email: b.email || '',
      name: [b.firstName, b.lastName].filter(Boolean).join(' '),
      amount: Number(b.amount), transactionId: result.transactionId,
      heedShare: heedShare(b.amount), status: 'paid',
    };
    await repo.addOrder(order);
    // Email a receipt to the payer + the Chamber office.
    try {
      const amt = '$' + Number(b.amount).toFixed(2);
      const item = b.description || b.sku || b.kind || 'Payment';
      const body = `Thank you for your payment to the West Valley · Warner Center Chamber of Commerce.\n\n`
        + `Item: ${item}\nAmount: ${amt}${b.kind === 'membership' && b.recurring ? ' (annual, recurring)' : ''}\n`
        + `Transaction ID: ${result.transactionId}\nDate: ${new Date().toLocaleString()}\n\nWe appreciate your support!`;
      if (b.email) email.send({ to: b.email, subject: 'Your Chamber payment receipt', text: body }).catch(() => {});
      email.send({ to: email.notifyTo(), subject: `Payment received: ${b.kind || 'order'} ${amt}`, text: `${order.name || ''} ${b.email || ''}\n\n${body}` }).catch(() => {});
    } catch (e) { console.error('receipt email', e); }
    return res.json({ ok: true, transactionId: result.transactionId, authCode: result.authCode, heedShare: order.heedShare });
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
  try {
    await repo.addLead(lead);
    res.json({ ok: true });
    // Notify the Chamber office (Wendy's mailbox) — best-effort, after responding.
    const body = `New ${lead.reason || lead.kind} from the website\n\n`
      + `Name: ${lead.name || '—'}\nEmail: ${lead.email}\nPhone: ${lead.phone || '—'}\n`
      + `Company: ${lead.company || '—'}\nEvent: ${lead.event || '—'}\n\nMessage:\n${lead.message || '—'}\n`;
    email.send({
      to: email.notifyTo(),
      replyTo: lead.email,
      subject: `Website inquiry: ${lead.reason || lead.kind}${lead.company ? ' — ' + lead.company : ''}`,
      text: body,
    }).catch((e) => console.error('notify email failed', e));
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
// Force a member to reset their password (old password stops working).
router.post('/admin/members/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const email = await users.requireReset(req.params.id);
    if (!email) return res.status(404).json({ error: 'No login is linked to that member.' });
    res.json({ ok: true, email, message: `${email} will be required to set a new password at next login.` });
  } catch (e) { console.error('reset-password', e); res.status(500).json({ error: 'could not reset' }); }
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
      orders: orders.length,
      revenue: orders.reduce((s, o) => s + (Number(o.amount) || 0), 0),
      heedShare: orders.reduce((s, o) => s + (Number(o.heedShare ?? o.heed_share) || 0), 0),
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
    if (b.tier !== undefined) patch.tier = b.tier;
    if (b.featured !== undefined) patch.featured = !!b.featured;
    if (b.expireDate !== undefined) patch.expireDate = (b.expireDate && /^\d{4}-\d{2}-\d{2}$/.test(b.expireDate)) ? b.expireDate : null;
    if (b.termMonths !== undefined) patch.termMonths = (b.termMonths === null || b.termMonths === '') ? null : Number(b.termMonths) || null;
    await repo.setOverride(id, patch);
    res.json({ ok: true, id, applied: patch });
  } catch (e) { console.error(e); res.status(500).json({ error: 'update failed' }); }
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

router.get('/admin/leads', requireAdmin, async (_req, res) => {
  try { res.json({ leads: await repo.listLeads() }); }
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

const ADMIN_POST_TYPES = ['news', 'announcement', 'discount', 'member_post', 'event', 'slide'];
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
  if (!b.dataUrl) return res.status(400).json({ error: 'Upload a flyer image.' });
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
  } catch (e) { console.error('from-flyer', e); res.status(500).json({ error: 'Could not read the flyer. Try a clearer image (PNG/JPG, under ~4MB).' }); }
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

router.post('/staff-assistant', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const messages = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Send at least one user message.' });
  }
  try {
    const ctx = await chamberSnapshot();
    const system = 'You are the internal staff assistant for the West Valley · Warner Center Chamber of Commerce, powered by Claude. '
      + 'You help Chamber staff and admins: analyze the membership, identify gaps and opportunities, and draft ready-to-use, professional content '
      + '(recruitment emails, member newsletters, social posts, event copy, sponsor outreach, announcements). '
      + 'Voice: warm, local, professional, and concise. When asked to write something, return polished copy the admin can paste and send — '
      + 'use clear subject lines for emails. When analyzing, ground every claim in the live data below and be specific (cite category counts). '
      + 'If asked which categories need more members, reason from the per-category counts (low or missing categories are the gaps).\n\n'
      + '=== LIVE CHAMBER DATA (today) ===\n' + ctx;
    const out = await llm.chat({ system, messages, maxTokens: 1800 });
    res.json({ ok: true, answer: out.text, provider: out.provider, model: out.model });
  } catch (e) { console.error('staff-assistant', e); res.status(500).json({ error: 'The assistant is unavailable right now.' }); }
});

export default router;
