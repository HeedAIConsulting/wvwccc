#!/usr/bin/env node
/* Import legacy NC_news (posts) and NC_coupons (deals) → data/posts-seed.json
   (committed, public content — no PII). Last ~12 months / active only; text + links
   (images/PDFs are a later pass). Run:
     node scripts/import-legacy-content.js
   Inputs (override via env): NEWS_SQL, COUP_SQL (extracted by extract-legacy-content.py). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDump } from './import-chamberware.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEWS_SQL = process.env.NEWS_SQL || 'E:/WVWCCOC/NC_news.sql';
const COUP_SQL = process.env.COUP_SQL || 'E:/WVWCCOC/NC_coupons.sql';
const CUTOFF = new Date(Date.now() - 366 * 86400000);  // ~12 months back

const dir = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'directory.json'), 'utf8'));
const memberIds = new Set((Array.isArray(dir) ? dir : dir.members || dir.directory || []).map((m) => m.id));

const stripHtml = (s) => String(s || '')
  .replace(/\r\n?/g, '\n')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<\/?(div|h\d|li|tr)[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const linkOf = (m, accId) => (accId && memberIds.has('m' + accId)) ? 'm' + accId : null;

const posts = [];

// ── NEWS ──
const { rows: nrows } = parseDump(fs.readFileSync(NEWS_SQL, 'utf8'));
let nKept = 0, nSeen = 0;
for (const r of (nrows['NC_news'] || [])) {
  nSeen++;
  if (String(r.news_status || '').toLowerCase() !== 'y') continue;
  const type = String(r.news_type || '').toLowerCase();
  if (type === 'event') continue;                          // events handled separately
  const dt = r.news_date ? new Date(String(r.news_date).replace(' ', 'T')) : null;
  if (!dt || isNaN(dt) || dt < CUTOFF) continue;
  const title = stripHtml(r.news_title) || '(untitled)';
  const body = [r.copy1, r.copy2, r.copy3].map(stripHtml).filter(Boolean).join('\n\n') || stripHtml(r.news_info);
  posts.push({
    id: 'lp-news-' + r.news_id, type: 'news',
    authorId: 'legacy-import', authorName: 'WVWC Chamber',
    memberId: linkOf(r, r.accounts_id),
    title: clip(title, 200), body: clip(body, 6000),
    imageUrl: '', linkUrl: String(r.redirect_url || '').startsWith('http') ? r.redirect_url : '',
    ctaLabel: '', ctaUrl: '', code: '',
    status: 'approved', featuredHome: false, expiresAt: null,
    created: dt.toISOString(),
  });
  nKept++;
}

// ── COUPONS / deals (active + not expired) ──
const { rows: crows } = parseDump(fs.readFileSync(COUP_SQL, 'utf8'));
let cKept = 0, cSeen = 0;
for (const r of (crows['NC_coupons'] || [])) {
  cSeen++;
  if (String(r.active || '').toLowerCase() !== 'y') continue;
  const exp = (r.expire_date && r.expire_date !== '0000-00-00') ? new Date(r.expire_date + 'T12:00:00') : null;
  if (exp && !isNaN(exp) && exp < new Date()) continue;     // skip already-expired
  const desc = stripHtml(r.description) || 'Member offer';
  posts.push({
    id: 'lp-deal-' + r.coupons_id, type: 'discount',
    authorId: 'legacy-import', authorName: 'WVWC Chamber',
    memberId: linkOf(r, r.accounts_id),
    title: clip(desc, 120), body: clip(desc, 2000),
    imageUrl: '', linkUrl: '', ctaLabel: '', ctaUrl: '', code: '',
    status: 'approved', featuredHome: false,
    expiresAt: (exp && !isNaN(exp)) ? exp.toISOString() : null,
    created: new Date().toISOString(),
  });
  cKept++;
}

posts.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
const out = {
  _meta: { importedAt: new Date().toISOString(), source: 'NC_news + NC_coupons (active, last ~12mo)', newsKept: nKept, newsSeen: nSeen, dealsKept: cKept, dealsSeen: cSeen },
  posts,
};
fs.writeFileSync(path.join(ROOT, 'data', 'posts-seed.json'), JSON.stringify(out, null, 2));
console.log(`news: kept ${nKept}/${nSeen} | deals: kept ${cKept}/${cSeen} | total posts: ${posts.length}`);
console.log('→ data/posts-seed.json (' + (fs.statSync(path.join(ROOT, 'data', 'posts-seed.json')).size / 1024).toFixed(0) + ' KB)');
