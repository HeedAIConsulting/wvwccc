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
    auth.setCookie(res, auth.signSession(user));
    res.json({ ok: true, role: user.role || 'member' });
  } catch (e) { console.error('login error', e); res.status(500).json({ error: 'login failed' }); }
});

router.post('/auth/logout', (_req, res) => { auth.clearCookie(res); res.json({ ok: true }); });

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
const PUBLIC_FIELDS = ['id', 'name', 'category', 'tier', 'neighborhood', 'contactName',
  'address', 'city', 'state', 'zip', 'phone', 'fax', 'website', 'tagline',
  'description', 'leaderStatus', 'seal', 'featured', 'tags'];

function rawMembers() {
  const storePath = path.join(ROOT, 'data', '_store', 'members.json');
  const seed = path.join(ROOT, 'data', 'directory.json');
  const usingStore = fs.existsSync(storePath);
  const raw = JSON.parse(fs.readFileSync(usingStore ? storePath : seed, 'utf8'));
  return { source: usingStore ? 'imported' : 'seed', members: raw.members || [] };
}

async function loadMembersFull() {
  const { source, members } = rawMembers();
  const overrides = await repo.getOverrides();
  return { source, members: members.map((m) => ({ ...m, ...(overrides[m.id] || {}) })) };
}

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

router.get('/members/:id', async (req, res) => {
  try {
    const m = (await loadMembersPublic()).members.find((x) => x.id === req.params.id);
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
  try { await repo.addLead(lead); res.json({ ok: true }); }
  catch (e) { console.error('lead save failed', e); res.status(500).json({ ok: false, error: 'could not send' }); }
  // TODO Phase 3: email office + felicia@woodlandhillscc.net.
});

// AI Concierge placeholder (Phase 3 — wire to backend/llm.js).
router.post('/concierge', (req, res) => {
  res.json({ ok: true, reply: 'The Concierge is coming online shortly. Meanwhile, search the directory or contact the Chamber at (818) 347-4737.' });
});

// ── Admin API ───────────────────────────────────────────────
router.get('/admin/summary', requireAdmin, async (_req, res) => {
  try {
    const { members, source } = await loadMembersFull();
    const leads = await repo.listLeads();
    const orders = await repo.listOrders();
    res.json({
      source,
      members: members.length,
      pendingMembers: members.filter((m) => m.status === 'pending').length,
      leaders: members.filter((m) => m.leaderStatus).length,
      newLeads: leads.filter((l) => l.status === 'new').length,
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

export default router;
