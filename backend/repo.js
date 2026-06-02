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

// ── Content posts (offers, member board, news/announcements) ──
const POST_COLS = ['id', 'type', 'author_id', 'author_name', 'member_id', 'title', 'body',
  'image_url', 'link_url', 'cta_label', 'cta_url', 'code', 'status', 'featured_home', 'expires_at'];
const toRow = (p) => ({
  id: p.id, type: p.type, author_id: p.authorId, author_name: p.authorName, member_id: p.memberId,
  title: p.title, body: p.body, image_url: p.imageUrl, link_url: p.linkUrl,
  cta_label: p.ctaLabel, cta_url: p.ctaUrl, code: p.code, status: p.status,
  featured_home: p.featuredHome, expires_at: p.expiresAt,
});
const fromRow = (r) => ({
  id: r.id, type: r.type, authorId: r.author_id, authorName: r.author_name, memberId: r.member_id,
  title: r.title, body: r.body, imageUrl: r.image_url, linkUrl: r.link_url,
  ctaLabel: r.cta_label, ctaUrl: r.cta_url, code: r.code, status: r.status,
  featuredHome: r.featured_home, expiresAt: r.expires_at, created: r.created,
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
  if (db.enabled) {
    const where = [], params = [];
    if (type) { params.push(type); where.push('type = $' + params.length); }
    if (status) { params.push(status); where.push('status = $' + params.length); }
    if (memberId) { params.push(memberId); where.push('member_id = $' + params.length); }
    const sql = 'SELECT * FROM posts' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created DESC';
    return (await db.query(sql, params)).rows.map(fromRow);
  }
  let arr = store.read('posts.json', []).slice().reverse();
  if (type) arr = arr.filter((p) => p.type === type);
  if (status) arr = arr.filter((p) => p.status === status);
  if (memberId) arr = arr.filter((p) => p.memberId === memberId);
  return arr;
}
export async function updatePost(id, patch) {
  const allowed = ['title', 'body', 'imageUrl', 'linkUrl', 'ctaLabel', 'ctaUrl', 'code', 'status', 'featuredHome', 'expiresAt'];
  const colMap = { imageUrl: 'image_url', linkUrl: 'link_url', ctaLabel: 'cta_label', ctaUrl: 'cta_url', featuredHome: 'featured_home', expiresAt: 'expires_at' };
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return false;
  if (db.enabled) {
    const sets = keys.map((k, i) => `${colMap[k] || k} = $${i + 2}`);
    const r = await db.query(`UPDATE posts SET ${sets.join(',')} WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
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
