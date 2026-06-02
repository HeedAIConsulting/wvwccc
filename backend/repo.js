/* ============================================================
   Durable data access — Postgres when DATABASE_URL is set,
   JSON store (data/_store, dev only) otherwise.
   Covers leads, orders, and member admin-overrides. (Auth users
   live in backend/users.js; directory base data is seed/import.)
   ============================================================ */
import * as db from './db.js';
import * as store from './store.js';

// ── Leads ───────────────────────────────────────────────────
export async function addLead(lead) {
  if (db.enabled) {
    await db.query(
      `INSERT INTO leads (id, kind, name, email, phone, company, reason, event, message, status, received)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())`,
      [lead.id, lead.kind, lead.name, lead.email, lead.phone, lead.company,
       lead.reason, lead.event, lead.message, lead.status || 'new']);
    return;
  }
  store.append('leads.json', lead);
}
export async function listLeads() {
  if (db.enabled) {
    const r = await db.query('SELECT * FROM leads ORDER BY received DESC');
    return r.rows.map((x) => ({ ...x, received: x.received }));
  }
  return store.read('leads.json', []).slice().reverse();
}
export async function setLeadStatus(id, status) {
  if (db.enabled) { await db.query('UPDATE leads SET status=$1 WHERE id=$2', [status, id]); return true; }
  const leads = store.read('leads.json', []);
  const l = leads.find((x) => x.id === id);
  if (!l) return false;
  l.status = status; store.write('leads.json', leads); return true;
}

// ── Orders ──────────────────────────────────────────────────
export async function addOrder(order) {
  if (db.enabled) {
    await db.query(
      `INSERT INTO orders (id, kind, sku, member_id, name, email, amount, transaction_id, heed_share, status, created)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())`,
      [order.id, order.kind, order.sku, order.memberId || null, order.name,
       order.email, order.amount, order.transactionId, order.heedShare, order.status || 'paid']);
    return;
  }
  store.append('orders.json', order);
}
export async function listOrders() {
  if (db.enabled) {
    const r = await db.query('SELECT * FROM orders ORDER BY created DESC');
    return r.rows;
  }
  return store.read('orders.json', []).slice().reverse();
}

// ── Member self-service profile edits ──────────────────────
export async function getMemberEdits() {
  if (db.enabled) {
    const r = await db.query('SELECT id, data FROM member_profiles');
    const map = {};
    for (const row of r.rows) map[row.id] = row.data || {};
    return map;
  }
  return store.read('member-profiles.json', {});
}
export async function setMemberEdit(id, patch) {
  if (db.enabled) {
    await db.query(
      `INSERT INTO member_profiles (id, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET
         data = member_profiles.data || EXCLUDED.data,
         updated_at = now()`,
      [id, JSON.stringify(patch)]);
    return;
  }
  const all = store.read('member-profiles.json', {});
  all[id] = { ...(all[id] || {}), ...patch };
  store.write('member-profiles.json', all);
}

// ── Member admin overrides ──────────────────────────────────
export async function getOverrides() {
  if (db.enabled) {
    const r = await db.query('SELECT id, status, tier, leader_status, featured FROM member_overrides');
    const map = {};
    for (const row of r.rows) {
      const o = {};
      if (row.status != null) o.status = row.status;
      if (row.tier != null) o.tier = row.tier;
      if (row.leader_status != null) o.leaderStatus = row.leader_status;
      if (row.featured != null) o.featured = row.featured;
      map[row.id] = o;
    }
    return map;
  }
  return store.read('member-admin.json', {});
}
export async function setOverride(id, patch) {
  if (db.enabled) {
    // merge: only overwrite provided keys (COALESCE keeps existing)
    await db.query(
      `INSERT INTO member_overrides (id, status, tier, leader_status, featured, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (id) DO UPDATE SET
         status        = COALESCE(EXCLUDED.status, member_overrides.status),
         tier          = COALESCE(EXCLUDED.tier, member_overrides.tier),
         leader_status = COALESCE(EXCLUDED.leader_status, member_overrides.leader_status),
         featured      = COALESCE(EXCLUDED.featured, member_overrides.featured),
         updated_at    = now()`,
      [id,
       patch.status ?? null,
       patch.tier ?? null,
       patch.leaderStatus ?? null,
       patch.featured ?? null]);
    return;
  }
  const overrides = store.read('member-admin.json', {});
  overrides[id] = { ...(overrides[id] || {}), ...patch };
  store.write('member-admin.json', overrides);
}
