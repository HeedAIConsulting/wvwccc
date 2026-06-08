#!/usr/bin/env node
/* Import the legacy event calendar (NC_news where news_type='event') → data/events.json.
   Upcoming window (>= START). Best-effort time/venue/category extraction; full body kept
   as description so the detail view is rich. Run: node scripts/import-legacy-events.js */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDump } from './import-chamberware.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEWS_SQL = process.env.NEWS_SQL || 'E:/WVWCCOC/NC_news.sql';
const START = process.env.EVENTS_START || '2026-06-01';

const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const stripHtml = (s) => String(s || '')
  .replace(/\r\n?/g, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<\/?(div|h\d|li|tr|table)[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const ymd = (s) => String(s || '').slice(0, 10);

function categoryOf(title) {
  const t = title.toLowerCase();
  if (/ribbon cutting/.test(t)) return 'Ribbon Cutting';
  if (/mixer/.test(t)) return 'Mixer';
  if (/breakfast|luncheon|connection circle|network/.test(t)) return 'Networking';
  if (/board of directors|committee|monthly meeting/.test(t)) return 'Chamber';
  if (/gala|food.*wine|black.*white/.test(t)) return 'Signature';
  if (/blood drive|shredding|cleanup|clean-up|walk|fundraiser|donate|pantry|grateful|family fair|menorah|jungle/.test(t)) return 'Community';
  if (/sustainab|education|seminar|workshop|webinar/.test(t)) return 'Education';
  return 'Event';
}
function timeOf(text) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i.exec(text);
  if (!m) return '';
  const h = m[1], min = m[2] || '00', ap = m[3].replace(/\./g, '').toUpperCase();
  return `${h}:${min} ${ap}`;
}
function venueOf(title) {
  const m = / at ([A-Z][^—–\-@]{2,60})/.exec(title);
  if (!m) return '';
  return m[1].split(/\s+(?:@|on\s|–|—)/i)[0].replace(/[,\s]+$/, '').trim();
}

const { rows } = parseDump(fs.readFileSync(NEWS_SQL, 'utf8'));
const all = (rows['NC_news'] || []).filter((r) => String(r.news_type).toLowerCase() === 'event' && String(r.news_status).toLowerCase() === 'y');
const events = [];
for (const r of all) {
  const date = ymd(r.calendar_news_date || r.news_date);
  if (!date || date < START) continue;
  const title = stripHtml(r.news_title) || '(untitled event)';
  const body = [r.copy1, r.copy2, r.copy3].map(stripHtml).filter(Boolean).join('\n\n');
  const summary = clip(stripHtml(r.news_info) || stripHtml(r.news_sub_title) || body.split('\n')[0] || '', 280);
  const ticketed = String(r.add_ticket).toLowerCase() === 'y';
  const links = [];
  if (String(r.redirect_url || '').startsWith('http')) {
    links.push({ label: clip(r.add_ticket_label || (ticketed ? 'Tickets' : 'Details'), 30), url: r.redirect_url, type: ticketed ? 'tickets' : 'info' });
  }
  const d = new Date(date + 'T12:00:00');
  events.push({
    id: 'le-' + r.news_id,
    title: clip(title, 200),
    category: categoryOf(title),
    confirmed: true,
    date,
    month: MONTHS3[d.getMonth()], day: String(d.getDate()).padStart(2, '0'),
    time: timeOf(title + ' ' + stripHtml(r.news_sub_title) + ' ' + body.slice(0, 400)),
    endDate: ymd(r.calendar_news_end_date) || '',
    endTime: '',
    venue: venueOf(title) || clip(stripHtml(r.news_sub_title), 120),
    address: '', neighborhood: '',
    summary,
    description: clip(body, 8000),
    ticketed,
    ticketCap: null,
    rsvpCutoff: (r.cutoff_date && r.cutoff_date !== '0000-00-00') ? ymd(r.cutoff_date) : null,
    featured: false,
    status: 'approved',
    images: [], links,
    created: new Date(0).toISOString(), updated: new Date(0).toISOString(),
  });
}
events.sort((a, b) => a.date.localeCompare(b.date));
const out = {
  _meta: { status: `Imported from legacy NC_news event calendar (>= ${START}).`, count: events.length, schema_version: 2 },
  events,
};
fs.writeFileSync(path.join(ROOT, 'data', 'events.json'), JSON.stringify(out, null, 2));
console.log(`imported ${events.length} events → data/events.json`);
console.log('first 6:', events.slice(0, 6).map((e) => `${e.date} ${e.title}`).join('\n          '));
