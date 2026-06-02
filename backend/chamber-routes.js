/* ============================================================
   WVWCCC — API routes (mounted at /api by server.js)
   ============================================================ */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sale, addRecurring, heedShare } from './payments-agms.js';
import * as store from './store.js';
import * as auth from './auth.js';
import * as users from './users.js';

const router = express.Router();
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Staff/admin gate — real session auth (replaces the old token stub).
const requireAdmin = auth.requireAuth(['staff', 'admin']);

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

// Member directory source: imported store (real roster, gitignored) when present,
// else the committed seed. Only PUBLIC display fields are exposed — emails and
// password hashes live in data/_store/users.json and are NEVER served.
const PUBLIC_FIELDS = ['id', 'name', 'category', 'tier', 'neighborhood', 'contactName',
  'address', 'city', 'state', 'zip', 'phone', 'fax', 'website', 'tagline',
  'description', 'leaderStatus', 'seal', 'featured', 'tags'];
function loadMembers() {
  const storePath = path.join(ROOT, 'data', '_store', 'members.json');
  const seed = path.join(ROOT, 'data', 'directory.json');
  const usingStore = fs.existsSync(storePath);
  const raw = JSON.parse(fs.readFileSync(usingStore ? storePath : seed, 'utf8'));
  const overrides = store.read(ADMIN_OVERRIDE, {});
  const members = (raw.members || [])
    .map((m) => ({ ...m, ...(overrides[m.id] || {}) }))      // apply admin edits
    .filter((m) => (m.status || 'approved') === 'approved')  // hide pending/suspended/inactive
    .map((m) => {                                            // expose public fields only
      const o = {};
      for (const f of PUBLIC_FIELDS) if (m[f] !== undefined) o[f] = m[f];
      return o;
    });
  return { _meta: { source: usingStore ? 'imported' : 'seed', count: members.length }, members };
}

router.get('/members', (_req, res) => {
  try { res.json(loadMembers()); }
  catch (e) { res.status(500).json({ error: 'directory unavailable' }); }
});

router.get('/members/:id', (req, res) => {
  try {
    const m = loadMembers().members.find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ error: 'not found' });
    res.json(m);
  } catch (e) { res.status(500).json({ error: 'directory unavailable' }); }
});

/**
 * POST /api/pay
 * body: { kind:'ticket'|'donation'|'membership', paymentToken, amount,
 *         email, firstName, lastName, sku, description,
 *         recurring?: { monthFrequency, dayOfMonth, planPayments } }
 * Card data is tokenized client-side by Collect.js — only the token reaches us.
 */
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
      heedShare: heedShare(b.amount), status: 'paid', created: new Date().toISOString(),
    };
    store.append('orders.json', order);
    // TODO: email receipt to payer + felicia@woodlandhillscc.net.
    return res.json({ ok: true, transactionId: result.transactionId, authCode: result.authCode, heedShare: order.heedShare });
  } catch (err) {
    console.error('pay error', err);
    return res.status(500).json({ ok: false, error: 'payment processing error' });
  }
});

/**
 * POST /api/contact — contact / membership / lead inquiries.
 * Generates a notification to the Chamber (Diana's requirement). For now we
 * log and 200; Phase 3 wires this to M365/email → office + felicia@.
 */
router.post('/contact', (req, res) => {
  const b = req.body || {};
  if (!b.email || !(b.message || b.company || b.name)) {
    return res.status(400).json({ ok: false, error: 'Please include your email and a message.' });
  }
  const lead = {
    kind: b.kind || 'contact', received: new Date().toISOString(),
    name: [b.firstName, b.lastName].filter(Boolean).join(' ') || b.name || '',
    email: b.email, phone: b.phone || '', company: b.company || '',
    reason: b.reason || b.kind || '', event: b.event || '', message: b.message || '',
  };
  lead.id = 'lead-' + Date.now().toString(36);
  lead.status = 'new';
  store.append('leads.json', lead);
  // TODO Phase 3: also email office + felicia@woodlandhillscc.net.
  res.json({ ok: true });
});

// Placeholder for the AI Concierge (Phase 3 — wire to backend/llm.js).
router.post('/concierge', (req, res) => {
  res.json({ ok: true, reply: 'The Concierge is coming online shortly. Meanwhile, search the directory or contact the Chamber at (818) 347-4737.' });
});

// ── Admin API (status radios, approvals, pay log, notifications) ──
const ADMIN_OVERRIDE = 'member-admin.json'; // { [id]: { status, tier, leaderStatus, featured } }

function loadMembersFull() {
  const storePath = path.join(ROOT, 'data', '_store', 'members.json');
  const seed = path.join(ROOT, 'data', 'directory.json');
  const usingStore = fs.existsSync(storePath);
  const raw = JSON.parse(fs.readFileSync(usingStore ? storePath : seed, 'utf8'));
  const overrides = store.read(ADMIN_OVERRIDE, {});
  const members = (raw.members || []).map((m) => ({ ...m, ...(overrides[m.id] || {}) }));
  return { source: usingStore ? 'imported' : 'seed', members };
}

router.get('/admin/summary', requireAdmin, (_req, res) => {
  const { members, source } = loadMembersFull();
  const leads = store.read('leads.json', []);
  const orders = store.read('orders.json', []);
  res.json({
    source,
    members: members.length,
    pendingMembers: members.filter((m) => m.status === 'pending').length,
    leaders: members.filter((m) => m.leaderStatus).length,
    newLeads: leads.filter((l) => l.status === 'new').length,
    orders: orders.length,
    revenue: orders.reduce((s, o) => s + (o.amount || 0), 0),
    heedShare: orders.reduce((s, o) => s + (o.heedShare || 0), 0),
  });
});

router.get('/admin/members', requireAdmin, (req, res) => {
  let { members } = loadMembersFull();
  if (req.query.status) members = members.filter((m) => (m.status || 'approved') === req.query.status);
  if (req.query.q) {
    const q = req.query.q.toLowerCase();
    members = members.filter((m) => [m.name, m.category, m.contactName, m.email, m.neighborhood]
      .filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  res.json({ members });
});

const LEADER_OPTS = ['', 'Leader', 'Board Member', 'New Member', 'Past President', 'Ambassador'];
const STATUS_OPTS = ['approved', 'pending', 'suspended', 'inactive'];
router.patch('/admin/members/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { members } = loadMembersFull();
  if (!members.find((m) => m.id === id)) return res.status(404).json({ error: 'not found' });
  const overrides = store.read(ADMIN_OVERRIDE, {});
  const cur = overrides[id] || {};
  const b = req.body || {};
  if (b.status !== undefined && STATUS_OPTS.includes(b.status)) cur.status = b.status;
  if (b.leaderStatus !== undefined && LEADER_OPTS.includes(b.leaderStatus)) cur.leaderStatus = b.leaderStatus;
  if (b.tier !== undefined) cur.tier = b.tier;
  if (b.featured !== undefined) cur.featured = !!b.featured;
  overrides[id] = cur;
  store.write(ADMIN_OVERRIDE, overrides);
  res.json({ ok: true, id, applied: cur });
});

router.get('/admin/leads', requireAdmin, (_req, res) => {
  res.json({ leads: store.read('leads.json', []).slice().reverse() });
});
router.patch('/admin/leads/:id', requireAdmin, (req, res) => {
  const leads = store.read('leads.json', []);
  const lead = leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'not found' });
  if (['new', 'read', 'done'].includes(req.body.status)) lead.status = req.body.status;
  store.write('leads.json', leads);
  res.json({ ok: true });
});

router.get('/admin/orders', requireAdmin, (_req, res) => {
  res.json({ orders: store.read('orders.json', []).slice().reverse() });
});

router.get('/admin/options', requireAdmin, (_req, res) => {
  res.json({ leaderOptions: LEADER_OPTS, statusOptions: STATUS_OPTS });
});

export default router;
