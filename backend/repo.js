/* ============================================================
   Durable data access — Postgres when DATABASE_URL is set,
   JSON store (data/_store, dev only) otherwise.
   Covers leads, orders, and member admin-overrides. (Auth users
   live in backend/users.js; directory base data is seed/import.)
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import * as store from './store.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Committed legacy content (NC_news + NC_coupons import). Public, no PII.
// Merged into listPosts so it shows without a database; ids are prefixed 'lp-'.
let _postsSeed = null;
function readPostsSeed() {
  if (_postsSeed) return _postsSeed;
  try { _postsSeed = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'posts-seed.json'), 'utf8')).posts || []; }
  catch { _postsSeed = []; }
  return _postsSeed;
}

// ── Leads ───────────────────────────────────────────────────
export async function addLead(lead) {
  if (db.enabled) {
    await db.query(
      `INSERT INTO leads (id, kind, name, email, phone, company, reason, event, message, status, received, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), $11)`,
      [lead.id, lead.kind, lead.name, lead.email, lead.phone, lead.company,
       lead.reason, lead.event, lead.message, lead.status || 'new', lead.passwordHash || null]);
    return;
  }
  store.append('leads.json', lead);
}
export async function listLeads() {
  if (db.enabled) {
    const r = await db.query('SELECT * FROM leads ORDER BY received DESC');
    return r.rows.map(({ password_hash, rc_date, rc_time, rc_venue, rc_flyer, rc_stage, rc_event_id, ...x }) => ({
      ...x, received: x.received,
      ...(rc_date != null ? { rcDate: rc_date } : {}),
      ...(rc_time != null ? { rcTime: rc_time } : {}),
      ...(rc_venue != null ? { rcVenue: rc_venue } : {}),
      ...(rc_flyer != null ? { rcFlyer: rc_flyer } : {}),
      ...(rc_stage != null ? { rcStage: rc_stage } : {}),
      ...(rc_event_id != null ? { rcEventId: rc_event_id } : {}),
      ...(password_hash ? { passwordHash: password_hash } : {}),
    }));
  }
  return store.read('leads.json', []).slice().reverse();
}
// Ribbon-cutting fields on a request — only the provided keys change.
export async function patchLeadRibbon(id, f) {
  if (db.enabled) {
    const r = await db.query(
      `UPDATE leads SET
         rc_date     = COALESCE($1, rc_date),
         rc_time     = COALESCE($2, rc_time),
         rc_venue    = COALESCE($3, rc_venue),
         rc_flyer    = COALESCE($4, rc_flyer),
         rc_stage    = COALESCE($5, rc_stage),
         rc_event_id = COALESCE($6, rc_event_id)
       WHERE id=$7`,
      [f.rcDate ?? null, f.rcTime ?? null, f.rcVenue ?? null,
       f.rcFlyer ?? null, f.rcStage ?? null, f.rcEventId ?? null, id]);
    return r.rowCount > 0;
  }
  const leads = store.read('leads.json', []);
  const l = leads.find((x) => x.id === id);
  if (!l) return false;
  for (const k of ['rcDate', 'rcTime', 'rcVenue', 'rcFlyer', 'rcStage', 'rcEventId']) if (f[k] !== undefined) l[k] = f[k];
  store.write('leads.json', leads); return true;
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
      `INSERT INTO orders (id, kind, sku, member_id, name, email, amount, transaction_id, status, created)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
      [order.id, order.kind, order.sku, order.memberId || null, order.name,
       order.email, order.amount, order.transactionId, order.status || 'paid']);
    return;
  }
  store.append('orders.json', order);
}
export async function listOrders() {
  if (db.enabled) {
    const r = await db.query('SELECT * FROM orders ORDER BY created DESC');
    // PG rows are snake_case; the admin UI reads camelCase (matches the JSON store).
    return r.rows.map((o) => ({ ...o, transactionId: o.transaction_id }));
  }
  return store.read('orders.json', []).slice().reverse();
}
export async function setOrderStatus(id, status) {
  if (db.enabled) {
    const r = await db.query('UPDATE orders SET status=$1 WHERE id=$2', [status, id]);
    return r.rowCount > 0;
  }
  const orders = store.read('orders.json', []);
  const o = orders.find((x) => x.id === id);
  if (!o) return false;
  o.status = status; store.write('orders.json', orders); return true;
}

// ── Coupons (checkout promo codes) ──────────────────────────
const couponRow = (c) => ({
  code: c.code, description: c.description || '', kind: c.kind || 'percent',
  amount: Number(c.amount) || 0, appliesTo: c.applies_to ?? c.appliesTo ?? 'all',
  expiresAt: c.expires_at ?? c.expiresAt ?? null, maxUses: c.max_uses ?? c.maxUses ?? null,
  used: Number(c.used) || 0, active: c.active !== false, created: c.created,
});
export async function listCoupons() {
  if (db.enabled) {
    const r = await db.query('SELECT * FROM coupons ORDER BY created DESC');
    return r.rows.map(couponRow);
  }
  return store.read('coupons.json', []).map(couponRow);
}
export async function getCoupon(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  if (db.enabled) {
    const r = await db.query('SELECT * FROM coupons WHERE code=$1', [c]);
    return r.rows[0] ? couponRow(r.rows[0]) : null;
  }
  const hit = store.read('coupons.json', []).find((x) => x.code === c);
  return hit ? couponRow(hit) : null;
}
export async function upsertCoupon(c) {
  const row = couponRow({ ...c, code: String(c.code || '').trim().toUpperCase() });
  if (!row.code) throw new Error('coupon code required');
  if (db.enabled) {
    await db.query(
      `INSERT INTO coupons (code, description, kind, amount, applies_to, expires_at, max_uses, used, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (code) DO UPDATE SET description=$2, kind=$3, amount=$4, applies_to=$5,
         expires_at=$6, max_uses=$7, active=$9`,
      [row.code, row.description, row.kind, row.amount, row.appliesTo,
       row.expiresAt, row.maxUses, row.used, row.active]);
    return row;
  }
  const all = store.read('coupons.json', []);
  const i = all.findIndex((x) => x.code === row.code);
  if (i >= 0) all[i] = { ...all[i], ...row, used: all[i].used || 0 };
  else all.push(row);
  store.write('coupons.json', all);
  return row;
}
export async function deleteCoupon(code) {
  const c = String(code || '').trim().toUpperCase();
  if (db.enabled) { await db.query('DELETE FROM coupons WHERE code=$1', [c]); return true; }
  store.write('coupons.json', store.read('coupons.json', []).filter((x) => x.code !== c));
  return true;
}
export async function incrementCouponUse(code) {
  const c = String(code || '').trim().toUpperCase();
  if (db.enabled) { await db.query('UPDATE coupons SET used = used + 1 WHERE code=$1', [c]); return; }
  const all = store.read('coupons.json', []);
  const hit = all.find((x) => x.code === c);
  if (hit) { hit.used = (hit.used || 0) + 1; store.write('coupons.json', all); }
}

// ── Content posts (offers, member board, news/announcements) ──
const POST_COLS = ['id', 'type', 'author_id', 'author_name', 'member_id', 'title', 'body',
  'image_url', 'link_url', 'cta_label', 'cta_url', 'code', 'status', 'featured_home', 'expires_at', 'meta'];
const toRow = (p) => ({
  id: p.id, type: p.type, author_id: p.authorId, author_name: p.authorName, member_id: p.memberId,
  title: p.title, body: p.body, image_url: p.imageUrl, link_url: p.linkUrl,
  cta_label: p.ctaLabel, cta_url: p.ctaUrl, code: p.code, status: p.status,
  featured_home: p.featuredHome, expires_at: p.expiresAt,
  meta: p.meta ? JSON.stringify(p.meta) : null,
});
const fromRow = (r) => ({
  id: r.id, type: r.type, authorId: r.author_id, authorName: r.author_name, memberId: r.member_id,
  title: r.title, body: r.body, imageUrl: r.image_url, linkUrl: r.link_url,
  ctaLabel: r.cta_label, ctaUrl: r.cta_url, code: r.code, status: r.status,
  featuredHome: r.featured_home, expiresAt: r.expires_at, meta: r.meta || undefined, created: r.created,
});

export async function addPost(post) {
  if (db.enabled) {
    const row = toRow(post);
    await db.query(
      `INSERT INTO posts (${POST_COLS.join(',')}, created)
       VALUES (${POST_COLS.map((_, i) => '$' + (i + 1)).join(',')}, now())`,
      POST_COLS.map((c) => row[c]));
    return;
  }
  store.append('posts.json', { ...post, created: new Date().toISOString() });
}
export async function listPosts({ type, status, memberId } = {}) {
  let arr = db.enabled
    ? (await db.query('SELECT * FROM posts ORDER BY created DESC')).rows.map(fromRow)
    : store.read('posts.json', []).slice().reverse();
  // Merge committed legacy seed for ids not already present in the live store/DB.
  const have = new Set(arr.map((p) => p.id));
  for (const p of readPostsSeed()) if (!have.has(p.id)) arr.push(p);
  // Tombstones: deleting a seed-backed post can't remove the committed seed,
  // so deletePost records a status:'deleted' row under the same id (which lands
  // in `have` above, suppressing the seed). Drop those markers from every result.
  arr = arr.filter((p) => p.status !== 'deleted');
  if (type) arr = arr.filter((p) => p.type === type);
  if (status) arr = arr.filter((p) => p.status === status);
  if (memberId) arr = arr.filter((p) => p.memberId === memberId);
  arr.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  return arr;
}
// Seed post + patch → a full live record (used when editing/reordering a
// seed-backed post for the first time, so the change has a row to live on).
function mergeSeed(seed, patch) {
  const out = { ...seed, ...patch };
  if (patch && patch.meta) out.meta = { ...(seed.meta || {}), ...patch.meta };
  return out;
}
export async function updatePost(id, patch) {
  const allowed = ['title', 'body', 'imageUrl', 'linkUrl', 'ctaLabel', 'ctaUrl', 'code', 'status', 'featuredHome', 'expiresAt', 'meta'];
  const colMap = { imageUrl: 'image_url', linkUrl: 'link_url', ctaLabel: 'cta_label', ctaUrl: 'cta_url', featuredHome: 'featured_home', expiresAt: 'expires_at' };
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return false;
  const seed = readPostsSeed().find((p) => p.id === id);
  if (db.enabled) {
    const sets = keys.map((k, i) => `${colMap[k] || k} = $${i + 2}`);
    const vals = keys.map((k) => (k === 'meta' && patch[k] != null) ? JSON.stringify(patch[k]) : patch[k]);
    const r = await db.query(`UPDATE posts SET ${sets.join(',')} WHERE id = $1`, [id, ...vals]);
    if (r.rowCount > 0) return true;
    // No live row: a seed-backed post (e.g. a hero slide). Materialize it with
    // the patch applied so the edit/reorder sticks (the seed merge then skips it).
    if (seed) { await addPost(mergeSeed(seed, patch)); return true; }
    return false;
  }
  const arr = store.read('posts.json', []);
  let p = arr.find((x) => x.id === id);
  if (!p) {
    if (!seed) return false;
    p = { ...seed }; arr.push(p);          // materialize the seed as a live row
  }
  keys.forEach((k) => { p[k] = (k === 'meta') ? { ...(p.meta || {}), ...(patch.meta || {}) } : patch[k]; });
  store.write('posts.json', arr); return true;
}
export async function deletePost(id) {
  // Seed-backed posts (data/posts-seed.json — e.g. the hero slides) have no live
  // row to delete; without a tombstone listPosts would re-merge them on next read,
  // so a delete would silently "not stick". Record a deleted-marker under the id.
  const seed = readPostsSeed().find((p) => p.id === id);
  if (db.enabled) {
    await db.query('DELETE FROM posts WHERE id=$1', [id]);
    if (seed) {
      await db.query(
        `INSERT INTO posts (id, type, status, created) VALUES ($1, $2, 'deleted', now())
         ON CONFLICT (id) DO UPDATE SET status = 'deleted'`,
        [id, seed.type || 'slide']);
    }
    return;
  }
  const next = store.read('posts.json', []).filter((p) => p.id !== id);
  if (seed) next.push({ id, type: seed.type || 'slide', status: 'deleted', created: new Date().toISOString() });
  store.write('posts.json', next);
}

// ── Events (jsonb blob in Postgres, or dev file) ────────────
export async function listEventsStore() {
  if (db.enabled) {
    const r = await db.query("SELECT data FROM events ORDER BY (data->>'date') ASC NULLS LAST");
    return r.rows.map((x) => x.data);
  }
  return store.read('events.json', []);
}
export async function hasEvents() {
  if (db.enabled) return (await db.query('SELECT 1 FROM events LIMIT 1')).rowCount > 0;
  return store.read('events.json', []).length > 0;
}
export async function upsertEvent(ev) {
  if (db.enabled) {
    await db.query(
      `INSERT INTO events (id, data, created, updated) VALUES ($1, $2::jsonb, now(), now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated = now()`,
      [ev.id, JSON.stringify(ev)]);
    return;
  }
  const arr = store.read('events.json', []);
  const i = arr.findIndex((e) => e.id === ev.id);
  if (i >= 0) arr[i] = ev; else arr.push(ev);
  store.write('events.json', arr);
}
export async function deleteEvent(id) {
  if (db.enabled) { await db.query('DELETE FROM events WHERE id=$1', [id]); return; }
  store.write('events.json', store.read('events.json', []).filter((e) => e.id !== id));
}

// ── Groups / networks (jsonb blob in Postgres, or dev file) ──
export async function listGroupsStore() {
  if (db.enabled) {
    const r = await db.query("SELECT data FROM groups ORDER BY data->>'name' ASC");
    return r.rows.map((x) => x.data);
  }
  return store.read('groups.json', []);
}
export async function hasGroups() {
  if (db.enabled) return (await db.query('SELECT 1 FROM groups LIMIT 1')).rowCount > 0;
  return store.read('groups.json', []).length > 0;
}
export async function upsertGroup(g) {
  if (db.enabled) {
    await db.query(
      `INSERT INTO groups (id, data, created, updated) VALUES ($1, $2::jsonb, now(), now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated = now()`,
      [g.id, JSON.stringify(g)]);
    return;
  }
  const arr = store.read('groups.json', []);
  const i = arr.findIndex((x) => x.id === g.id);
  if (i >= 0) arr[i] = g; else arr.push(g);
  store.write('groups.json', arr);
}
export async function deleteGroup(id) {
  if (db.enabled) { await db.query('DELETE FROM groups WHERE id=$1', [id]); return; }
  store.write('groups.json', store.read('groups.json', []).filter((g) => g.id !== id));
}

// ── AI Assistant saved threads (shared conversation history) ────
export async function listThreads() {
  if (db.enabled) {
    const r = await db.query('SELECT id, data, updated FROM assistant_threads ORDER BY updated DESC');
    return r.rows.map((x) => ({ ...x.data, id: x.id, updated: x.updated }));
  }
  return store.read('threads.json', []).slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
}
export async function upsertThread(t) {
  if (db.enabled) {
    await db.query(
      `INSERT INTO assistant_threads (id, data, created, updated) VALUES ($1, $2::jsonb, now(), now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated = now()`,
      [t.id, JSON.stringify(t)]);
    return;
  }
  const arr = store.read('threads.json', []);
  const i = arr.findIndex((x) => x.id === t.id);
  if (i >= 0) arr[i] = t; else arr.push(t);
  store.write('threads.json', arr);
}
export async function deleteThread(id) {
  if (db.enabled) { await db.query('DELETE FROM assistant_threads WHERE id=$1', [id]); return; }
  store.write('threads.json', store.read('threads.json', []).filter((t) => t.id !== id));
}

// ── Reusable message templates (Felicia's email library) ────────
export async function listTemplates() {
  if (db.enabled) {
    const r = await db.query('SELECT id, data, updated FROM message_templates ORDER BY updated DESC');
    return r.rows.map((x) => ({ ...x.data, id: x.id, updated: x.updated }));
  }
  return store.read('templates.json', []).slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
}
export async function upsertTemplate(t) {
  if (db.enabled) {
    await db.query(
      `INSERT INTO message_templates (id, data, created, updated) VALUES ($1, $2::jsonb, now(), now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated = now()`,
      [t.id, JSON.stringify(t)]);
    return;
  }
  const arr = store.read('templates.json', []);
  const i = arr.findIndex((x) => x.id === t.id);
  if (i >= 0) arr[i] = t; else arr.push(t);
  store.write('templates.json', arr);
}
export async function deleteTemplate(id) {
  if (db.enabled) { await db.query('DELETE FROM message_templates WHERE id=$1', [id]); return; }
  store.write('templates.json', store.read('templates.json', []).filter((t) => t.id !== id));
}

// ── Image assets (Postgres bytea, or dev files) ─────────────
export async function addAsset({ id, memberId, kind, mime, buffer }) {
  if (db.enabled) {
    await db.query('INSERT INTO assets (id, member_id, kind, mime, bytes, created) VALUES ($1,$2,$3,$4,$5, now())',
      [id, memberId, kind, mime, buffer]);
    return;
  }
  const idx = store.read('assets.json', {});
  idx[id] = { memberId, kind, mime, b64: buffer.toString('base64') };
  store.write('assets.json', idx);
}
export async function getAsset(id) {
  if (db.enabled) {
    const r = await db.query('SELECT mime, bytes FROM assets WHERE id=$1', [id]);
    if (!r.rows[0]) return null;
    return { mime: r.rows[0].mime, buffer: r.rows[0].bytes };
  }
  const idx = store.read('assets.json', {});
  if (!idx[id]) return null;
  return { mime: idx[id].mime, buffer: Buffer.from(idx[id].b64, 'base64') };
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
    const r = await db.query('SELECT id, status, tier, leader_status, featured, expire_date, term_months, designations, welcome_sent FROM member_overrides');
    const map = {};
    for (const row of r.rows) {
      const o = {};
      if (row.status != null) o.status = row.status;
      if (row.tier != null) o.tier = row.tier;
      if (row.leader_status != null) o.leaderStatus = row.leader_status;
      if (row.featured != null) o.featured = row.featured;
      if (row.expire_date != null) o.expireDate = row.expire_date;
      if (row.term_months != null) o.termMonths = row.term_months;
      if (row.welcome_sent != null) o.welcomeSent = row.welcome_sent;
      // comma-joined in the column; '' means "explicitly none"
      if (row.designations != null) o.designations = String(row.designations).split(',').filter(Boolean);
      map[row.id] = o;
    }
    return map;
  }
  return store.read('member-admin.json', {});
}
export async function setOverride(id, patch) {
  if (db.enabled) {
    await db.query(
      `INSERT INTO member_overrides (id, status, tier, leader_status, featured, expire_date, term_months, designations, welcome_sent, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (id) DO UPDATE SET
         status        = COALESCE(EXCLUDED.status, member_overrides.status),
         tier          = COALESCE(EXCLUDED.tier, member_overrides.tier),
         leader_status = COALESCE(EXCLUDED.leader_status, member_overrides.leader_status),
         featured      = COALESCE(EXCLUDED.featured, member_overrides.featured),
         expire_date   = COALESCE(EXCLUDED.expire_date, member_overrides.expire_date),
         term_months   = COALESCE(EXCLUDED.term_months, member_overrides.term_months),
         designations  = COALESCE(EXCLUDED.designations, member_overrides.designations),
         welcome_sent  = COALESCE(EXCLUDED.welcome_sent, member_overrides.welcome_sent),
         updated_at    = now()`,
      [id,
       patch.status ?? null,
       patch.tier ?? null,
       patch.leaderStatus ?? null,
       patch.featured ?? null,
       patch.expireDate ?? null,
       patch.termMonths ?? null,
       Array.isArray(patch.designations) ? patch.designations.join(',') : null,
       patch.welcomeSent ?? null]);
    return;
  }
  const overrides = store.read('member-admin.json', {});
  overrides[id] = { ...(overrides[id] || {}), ...patch };
  // allow clearing a manual renewal date with null
  if (patch.expireDate === null) delete overrides[id].expireDate;
  store.write('member-admin.json', overrides);
}

// ── Settings: tiny key/value store (one-time migration markers, flags) ──
export async function getSetting(key) {
  if (db.enabled) {
    const r = await db.query('SELECT value FROM settings WHERE key=$1', [key]);
    return r.rows.length ? r.rows[0].value : null;
  }
  return store.read('settings.json', {})[key] ?? null;
}
export async function setSetting(key, value) {
  if (db.enabled) {
    await db.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [key, String(value)]);
    return;
  }
  const s = store.read('settings.json', {});
  s[key] = String(value);
  store.write('settings.json', s);
}

// ── Featured placements (one member per page/guide slot) ───
export async function getPlacements() {
  if (db.enabled) {
    const r = await db.query('SELECT slot, member_id FROM placements');
    const map = {};
    for (const row of r.rows) if (row.member_id) map[row.slot] = row.member_id;
    return map;
  }
  return store.read('placements.json', {});
}
export async function setPlacement(slot, memberId) {
  if (db.enabled) {
    if (!memberId) { await db.query('DELETE FROM placements WHERE slot=$1', [slot]); return; }
    await db.query(
      `INSERT INTO placements (slot, member_id, updated_at) VALUES ($1,$2, now())
       ON CONFLICT (slot) DO UPDATE SET member_id = EXCLUDED.member_id, updated_at = now()`,
      [slot, memberId]);
    return;
  }
  const map = store.read('placements.json', {});
  if (!memberId) delete map[slot]; else map[slot] = memberId;
  store.write('placements.json', map);
}

// ── Content-page overrides (staff hide/restore migrated pages) ──
export async function getPageOverrides() {
  if (db.enabled) {
    const r = await db.query('SELECT slug, hidden FROM page_overrides');
    const map = {};
    for (const row of r.rows) map[row.slug] = { hidden: !!row.hidden };
    return map;
  }
  return store.read('page-overrides.json', {});
}
export async function setPageOverride(slug, { hidden }) {
  if (db.enabled) {
    await db.query(
      `INSERT INTO page_overrides (slug, hidden, updated_at) VALUES ($1,$2, now())
       ON CONFLICT (slug) DO UPDATE SET hidden = EXCLUDED.hidden, updated_at = now()`,
      [slug, !!hidden]);
    return;
  }
  const map = store.read('page-overrides.json', {});
  map[slug] = { hidden: !!hidden };
  store.write('page-overrides.json', map);
}

// ── Manually-added members (offline signups) ────────────────
export async function listAddedMembers() {
  if (db.enabled) return (await db.query('SELECT data FROM added_members ORDER BY created DESC')).rows.map((x) => x.data);
  return store.read('added-members.json', []);
}
export async function addMember(m) {
  if (db.enabled) {
    await db.query('INSERT INTO added_members (id, data, created) VALUES ($1,$2::jsonb, now()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data',
      [m.id, JSON.stringify(m)]);
    return;
  }
  const arr = store.read('added-members.json', []);
  const i = arr.findIndex((x) => x.id === m.id);
  if (i >= 0) arr[i] = m; else arr.push(m);
  store.write('added-members.json', arr);
}
