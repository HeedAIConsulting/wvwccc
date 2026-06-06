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
const requireAdmin = auth.requireAuth(['staff', 'admin']);

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
    auth.setCookie(res, auth.signSession(user));
    // mustChange = logged in with a legacy password → force a new one now.
    res.json({ ok: true, role: user.role || 'member', mustChange: !!user.mustChange });
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
  'description', 'leaderStatus', 'seal', 'featured', 'tags',
  // richer profile (member-managed)
  'hours', 'occupation', 'typeOfBusiness', 'yearEstablished', 'employees',
  'logo', 'photos', 'social', 'reviewLinks', 'ctaLinks'];

function rawMembers() {
  const storePath = path.join(ROOT, 'data', '_store', 'members.json');
  const seed = path.join(ROOT, 'data', 'directory.json');
  const usingStore = fs.existsSync(storePath);
  const raw = JSON.parse(fs.readFileSync(usingStore ? storePath : seed, 'utf8'));
  return { source: usingStore ? 'imported' : 'seed', members: raw.members || [] };
}

// Merge precedence: base directory  <  member self-edits  <  admin overrides.
async function loadMembersFull() {
  const { source, members } = rawMembers();
  const [edits, overrides] = await Promise.all([repo.getMemberEdits(), repo.getOverrides()]);
  return { source, members: members.map((m) => ({ ...m, ...(edits[m.id] || {}), ...(overrides[m.id] || {}) })) };
}

// Scalar fields a member may edit (admin-only: status/tier/leader/featured).
const MEMBER_STR_FIELDS = ['name', 'category', 'neighborhood', 'contactName', 'phone', 'fax',
  'website', 'address', 'city', 'state', 'zip', 'tagline', 'description', 'hours',
  'occupation', 'typeOfBusiness', 'yearEstablished', 'employees', 'logo'];
const clampUrl = (s) => String(s || '').trim().slice(0, 600);
function sanitizeProfile(b) {
  const patch = {};
  for (const f of MEMBER_STR_FIELDS) if (b[f] !== undefined) patch[f] = String(b[f]).slice(0, 5000);
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
    // TODO: email receipt to payer + felicia@woodlandhillscc.net.
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
  const fields = [['name', 10], ['category', 6], ['typeOfBusiness', 6], ['group', 5],
    ['neighborhood', 4], ['city', 4], ['tagline', 3], ['description', 1]];
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
    await repo.setOverride(id, patch);
    res.json({ ok: true, id, applied: patch });
  } catch (e) { console.error(e); res.status(500).json({ error: 'update failed' }); }
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

export default router;
