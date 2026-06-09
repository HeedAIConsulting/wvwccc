#!/usr/bin/env node
/* Import legacy content pages (NC_news where news_type='page', active) → data/pages.json.
   Cleans legacy HTML to a safe whitelist, groups by heuristic, drops pages that duplicate
   existing feature pages. Run: node scripts/import-legacy-pages.js */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDump } from './import-chamberware.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEWS_SQL = process.env.NEWS_SQL || 'E:/WVWCCOC/NC_news.sql';

const slugify = (s) => String(s || '').toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

// Clean legacy HTML → safe whitelist (keep structure + links; drop scripts/styles/attrs).
function cleanHtml(h) {
  let s = String(h || '');
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<\/?(o:p|xml|meta|link|font|span|div|table|tbody|thead|tr|td|th|center)[^>]*>/gi, ' ');
  // keep anchors with href only
  s = s.replace(/<a\b[^>]*?href\s*=\s*"([^"]*)"[^>]*>/gi, (m, href) => /^javascript:/i.test(href) ? '<a>' : `<a href="${href}" target="_blank" rel="noopener">`);
  // normalize allowed block/inline tags, strip their attributes
  s = s.replace(/<(\/?(?:p|br|strong|b|em|i|u|ul|ol|li|h2|h3|h4|blockquote))\b[^>]*>/gi, '<$1>');
  // strip any remaining tags not in the whitelist
  s = s.replace(/<(?!\/?(?:a|p|br|strong|b|em|i|u|ul|ol|li|h2|h3|h4|blockquote)\b)[^>]*>/gi, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/(\s*<br>\s*){3,}/gi, '<br><br>');
  s = s.replace(/(<p>\s*<\/p>)+/gi, '').trim();
  return s;
}
const textLen = (h) => cleanHtml(h).replace(/<[^>]+>/g, '').trim().length;

// Titles that map to existing FEATURE pages — skip (don't duplicate).
const SKIP = /^(home|events?|calendar|membership directory|member directory|directory|join( now)?|member to member deals|m2m|deals|job ?board|jobs|contact( us)?|donate|search members?|renew(ing)?( a)?( membership)?|new members?|sign in|login)$/i;
// Stale announcements miscategorized as 'page' — not real content pages.
const JUNK = /\btest\b|postpon|bid online|silent auction|tournament|rsvp|buy tickets?|starting (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|new date|donate now|save while|\b(19|20)\d\d\b|privacy policy|featured event/i;

// Group heuristics for the mega-menu.
function groupOf(title) {
  const t = title.toLowerCase();
  if (/letter from|board of directors|chamber staff|ambassador|leaders|partnership|committee|about the chamber|about us|mission|history|wellness resource|benefits of member|advertising|membership$/.test(t)) return 'About & Membership';
  if (/woodland hills|reseda|tarzana|warner center|west valley|our community|district|demographic|beautification|community benefit|community choice|adopt-?a-?school|connection circle|millennial|gallery|forum/.test(t)) return 'Our Community';
  if (/visitor|attraction|hotel|motel|candy cane|golf|school|utilit|senior|bank|phone number|link|resource|dine|elected official|important/.test(t)) return 'Resources & Visitor Info';
  return 'More';
}

const { rows } = parseDump(fs.readFileSync(NEWS_SQL, 'utf8'));
const all = (rows['NC_news'] || []).filter((r) => String(r.news_type).toLowerCase() === 'page' && String(r.news_status).toLowerCase() === 'y');

const seen = new Set();
const pages = [];
for (const r of all) {
  const title = String(r.news_title || '').replace(/\s+/g, ' ').trim();
  if (!title || SKIP.test(title) || JUNK.test(title)) continue;
  const html = cleanHtml([r.copy1, r.copy2, r.copy3].filter(Boolean).join('\n'));
  if (textLen(html) < 40) continue; // skip near-empty pages
  let slug = slugify(title);
  if (!slug || seen.has(slug)) slug = slug + '-' + r.news_id;
  seen.add(slug);
  pages.push({ slug, title, group: groupOf(title), html, order: Number(r.order_placement) || 50 });
}
pages.sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || a.title.localeCompare(b.title));

fs.writeFileSync(path.join(ROOT, 'data', 'pages.json'), JSON.stringify({ _meta: { importedAt: '(static)', count: pages.length }, pages }, null, 2));
const byGroup = {};
pages.forEach((p) => { byGroup[p.group] = (byGroup[p.group] || 0) + 1; });
console.log(`imported ${pages.length} pages → data/pages.json`);
console.log('by group:', JSON.stringify(byGroup, null, 2));
console.log('sample:', pages.slice(0, 12).map((p) => `[${p.group}] ${p.title}`).join('\n        '));
