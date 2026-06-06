#!/usr/bin/env node
/* Draft profiles for current members lacking one, using THEIR OWN website content
   (meta/og description + title) — real member-authored text, never invented.
   Each draft is marked source+status so a member/admin reviews before publish.
   No website → flagged manual. Usage:
     node scripts/enrich-profiles.js <current.sql> [--limit N] [--out file]
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDump } from './import-chamberware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(__dirname, '..', 'data', '_store');
const file = process.argv[2];
const limit = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? +process.argv[i + 1] : Infinity; })();
const outFile = (() => { const i = process.argv.indexOf('--out'); return i > -1 ? process.argv[i + 1] : path.join(STORE, '_profile-drafts.json'); })();
if (!file) { console.error('Usage: node scripts/enrich-profiles.js <current.sql> [--limit N]'); process.exit(1); }

const clean = (v) => (v == null ? '' : String(v).trim());
const yearOf = (d) => { const m = /^(\d{4})-/.exec(clean(d)); return m ? +m[1] : null; };
const txt = (v) => clean(v).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
function siteUrl(v) { let s = clean(v); if (!s || s.includes('@') || /\s/.test(s)) return ''; s = s.replace(/^https?:\/\//i, ''); if (!/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return ''; return 'https://' + s.replace(/^\/+/, ''); }

const { rows } = parseDump(fs.readFileSync(file, 'utf8'));
const accounts = rows['NC_accounts'] || [];
const profs = rows['NC_new_profile'] || [];
const pays = rows['NC_payment_orders'] || [];
const profBy = {}; for (const p of profs) profBy[clean(p.accounts_id)] = p;
const lastPaid = {}; for (const p of pays) { const id = clean(p.accounts_id), y = yearOf(p.date_placed); if (id && y) lastPaid[id] = Math.max(lastPaid[id] || 0, y); }
const profUsable = (p) => p && (txt(p.about).length > 40 || ['facebook_link','instagram_link','linkedin_link','youtube_link','twitter_link','yelp_link'].some(k => clean(p[k])));

const targets = [];
for (const a of accounts) {
  if (clean(a.active) !== 'Y' || (clean(a.chamber_status) || 'member') !== 'member' || !clean(a.company)) continue;
  const aid = clean(a.accounts_id); const prof = profBy[aid];
  const lp = lastPaid[aid] || 0; const pu = prof ? yearOf(prof.date_updated) : 0;
  const label = lp >= 2023 ? 'paid' : (pu >= 2024 ? 'engaged' : 'unconfirmed');
  if (label === 'unconfirmed' || profUsable(prof)) continue;
  targets.push({ id: `m${aid}`, name: clean(a.company), category: clean(a.type_of_business), city: clean(a.city), website: siteUrl(a.website), label });
}

const decode = (s) => clean(s).replace(/&amp;/gi, '&').replace(/&#39;|&rsquo;|&lsquo;/gi, "'").replace(/&quot;|&ldquo;|&rdquo;/gi, '"').replace(/&nbsp;/gi, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
function extract(html) {
  const meta = (re) => { const m = re.exec(html); return m ? decode(m[1]) : ''; };
  const desc = meta(/<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']{20,400})["']/i)
            || meta(/<meta[^>]+content=["']([^"']{20,400})["'][^>]+(?:property=["']og:description["']|name=["']description["'])/i);
  const title = meta(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,120})["']/i) || meta(/<title[^>]*>([^<]{2,120})<\/title>/i);
  return { description: desc, tagline: title };
}
async function fetchOne(t) {
  if (!t.website) return { ...t, status: 'manual', reason: 'no website' };
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(t.website, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WVWCCC-DirectoryBot/1.0)' } });
    clearTimeout(to);
    if (!res.ok) return { ...t, status: 'manual', reason: `HTTP ${res.status}` };
    const html = (await res.text()).slice(0, 200000);
    const { description, tagline } = extract(html);
    if (!description) return { ...t, status: 'manual', reason: 'no meta description' };
    return { ...t, status: 'draft', source: 'website-meta', tagline: tagline.slice(0, 160), description: description.slice(0, 600) };
  } catch (e) { return { ...t, status: 'manual', reason: (e.name === 'AbortError' ? 'timeout' : e.message).slice(0, 60) }; }
}
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

const batch = targets.slice(0, limit);
console.log(`Enriching ${batch.length}/${targets.length} (${batch.filter(t => t.website).length} with sites)…`);
const results = await pool(batch, 6, fetchOne);
const drafts = results.filter(r => r.status === 'draft');
const manual = results.filter(r => r.status === 'manual');
fs.mkdirSync(STORE, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ _meta: { generatedAt: new Date().toISOString(), source: "each member's own website (meta/og description) — DRAFT, pending member review", drafted: drafts.length, manual: manual.length }, drafts, manual }, null, 2));
console.log(`✓ drafted ${drafts.length}, manual ${manual.length} → ${path.relative(path.join(__dirname,'..'), outFile)}`);
console.log('\nreasons (manual):', JSON.stringify(manual.reduce((m, x) => ((m[x.reason] = (m[x.reason]||0)+1), m), {})));
console.log('\n— sample drafts —');
for (const d of drafts.slice(0, 6)) console.log(`\n● ${d.name} (${d.city}) — ${d.website}\n  tagline: ${d.tagline}\n  desc: ${d.description.slice(0, 180)}`);
