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
  if (type) arr = arr.filter((p) => p.type === type);
  if (status) arr = arr.filter((p) => p.status === status);
  if (memberId) arr = arr.filter((p) => p.memberId === memberId);
  arr.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  return arr;
}
export async function updatePost(id, patch) {
  const allowed = ['title', 'body', 'imageUrl', 'linkUrl', 'ctaLabel', 'ctaUrl', 'code', 'status', 'featuredHome', 'expiresAt', 'meta'];
  const colMap = { imageUrl: 'image_url', linkUrl: 'link_url', ctaLabel: 'cta_label', ctaUrl: 'cta_url', featuredHome: 'featured_home', expiresAt: 'expires_at' };
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return false;
  if (db.enabled) {
    const sets = keys.map((k, i) => `${colMap[k] || k} = $${i + 2}`);
    const vals = keys.map((k) => (k === 'meta' && patch[k] != null) ? JSON.stringify(patch[k]) : patch[k]);
    const r = await db.query(`UPDATE posts SET ${sets.join(',')} WHERE id = $1`, [id, ...vals]);
    return r.rowCount > 0;
  }
  const arr = store.read('posts.json', []);
  const p = arr.find((x) => x.id === id);
  if (!p) return false;
  keys.forEach((k) => { p[k] = patch[k]; });
  store.write('posts.json', arr); return true;
}
export async function deletePost(id) {
  if (db.enabled) { await db.query('DELETE FROM posts WHERE id=$1', [id]); return; }
  store.write('posts.json', store.read('posts.json', []).filter((p) => p.id !== id));
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
    const r = await db.query('SELECT id, status, tier, leader_status, featured, expire_date, term_months FROM member_overrides');
    const map = {};
    for (const row of r.rows) {
      const o = {};
      if (row.status != null) o.status = row.status;
      if (row.tier != null) o.tier = row.tier;
      if (row.leader_status != null) o.leaderStatus = row.leader_status;
      if (row.featured != null) o.featured = row.featured;
      if (row.expire_date != null) o.expireDate = row.expire_date;
      if (row.term_months != null) o.termMonths = row.term_months;
      map[row.id] = o;
    }
    return map;
  }
  return store.read('member-admin.json', {});
}
export async function setOverride(id, patch) {
  if (db.enabled) {
    await db.query(
      `INSERT INTO member_overrides (id, status, tier, leader_status, featured, expire_date, term_months, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (id) DO UPDATE SET
         status        = COALESCE(EXCLUDED.status, member_overrides.status),
         tier          = COALESCE(EXCLUDED.tier, member_overrides.tier),
         leader_status = COALESCE(EXCLUDED.leader_status, member_overrides.leader_status),
         featured      = COALESCE(EXCLUDED.featured, member_overrides.featured),
         expire_date   = COALESCE(EXCLUDED.expire_date, member_overrides.expire_date),
         term_months   = COALESCE(EXCLUDED.term_months, member_overrides.term_months),
         updated_at    = now()`,
      [id,
       patch.status ?? null,
       patch.tier ?? null,
       patch.leaderStatus ?? null,
       patch.featured ?? null,
       patch.expireDate ?? null,
       patch.termMonths ?? null]);
    return;
  }
  const overrides = store.read('member-admin.json', {});
  overrides[id] = { ...(overrides[id] || {}), ...patch };
  // allow clearing a manual renewal date with null
  if (patch.expireDate === null) delete overrides[id].expireDate;
  store.write('member-admin.json', overrides);
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
