/* Backfill flyer images for events that lack one, by extracting the best
   embedded image from the legacy NC_news body and downloading it locally.
   Run: node scripts/backfill-event-images.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { parseDump } from './import-chamberware.js';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const EVENTS = path.join(ROOT, 'data', 'events.json');
const ASSETS = path.join(ROOT, 'assets', 'events');
const NEWS_SQL = process.env.NEWS_SQL || 'E:/WVWCCOC/NC_news.sql';
fs.mkdirSync(ASSETS, { recursive: true });

const SITE = 'https://www.woodlandhillscc.net';
const SKIP_HOSTS = /duckduckgo\.com|google\.|bing\./i;
const SKIP_NAME = /logo|sponsor|shield|icon|button|spacer|divider|header_|footer_|banner_ad/i;

function candidates(r) {
  const body = [r.copy1, r.copy2, r.copy3, r.news_info].join(' ');
  const urls = [...body.matchAll(/(?:src|href)=["']([^"']+\.(?:jpg|jpeg|png|gif))/gi)].map((m) => m[1].replace(/&amp;/g, '&').trim());
  const out = [];
  for (let u of urls) {
    if (SKIP_HOSTS.test(u)) continue;
    const name = u.split('/').pop() || '';
    if (SKIP_NAME.test(name)) continue;
    if (u.startsWith('//')) u = 'https:' + u;
    else if (u.startsWith('/')) u = SITE + u.replace(/^\/+/, '/');
    else if (!/^https?:/i.test(u)) u = SITE + '/' + u;
    // collapse accidental double slashes in path (keep protocol)
    u = u.replace(/(https?:\/\/[^/]+)\/+/, '$1/').replace(/([^:])\/{2,}/g, '$1/');
    out.push(encodeURI(u));
  }
  return [...new Set(out)];
}

async function tryDownload(url, dest) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') || '';
    if (!/image\//i.test(type)) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 15000) return false; // skip tiny logos/icons
    fs.writeFileSync(dest, buf);
    return buf.length;
  } catch { return false; }
}

const { rows } = parseDump(fs.readFileSync(NEWS_SQL, 'utf8'));
const newsById = new Map((rows['NC_news'] || []).map((r) => [String(r.news_id), r]));

const data = JSON.parse(fs.readFileSync(EVENTS, 'utf8'));
const today = '2026-06-10';
let filled = 0;
for (const ev of data.events) {
  if (ev.images && ev.images.length) continue;
  if (!ev.date || ev.date < today) continue; // only backfill upcoming
  const id = String(ev.id).replace(/^le-/, '');
  const r = newsById.get(id);
  if (!r) continue;
  for (const url of candidates(r)) {
    const ext = (url.split('.').pop().split(/[?#]/)[0] || 'jpg').toLowerCase();
    const dest = path.join(ASSETS, `${id}.${ext}`);
    const size = await tryDownload(url, dest);
    if (size) {
      const rel = `assets/events/${id}.${ext}`;
      ev.images = [rel]; ev.image = rel;
      filled++;
      console.log(`  ${id} <- ${Math.round(size / 1024)}KB  ${url.slice(0, 90)}`);
      break;
    }
  }
}
fs.writeFileSync(EVENTS, JSON.stringify(data, null, 2));
const up = data.events.filter((e) => e.date >= today);
console.log(`\nbackfilled ${filled} more. upcoming with image: ${up.filter((e) => e.images && e.images.length).length}/${up.length}`);
