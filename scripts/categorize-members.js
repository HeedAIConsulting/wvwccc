#!/usr/bin/env node
/* Index the directory: map the raw ChamberWare categories into ~20 browsable
   parent groups (word-start keyword match over every category the member carries), add `group` to each
   member, and add searchable `tags`. Keeps the specific category as the subtitle. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', '_store');
const file = path.join(STORE, 'members.json');

// The taxonomy now lives in data/category-groups.json so this script and
// scripts/import-directory-categories.py can never drift apart.
const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// `keywords` match at a word start (prefixes); `exact` match a whole word only.
const GROUPS = JSON.parse(fs.readFileSync(path.join(STORE, '..', 'category-groups.json'), 'utf8'))
  .groups.map((g) => [g.name, new RegExp([
    ...g.keywords.map((k) => '\\b' + esc(k)),
    ...(g.exact || []).map((k) => '\\b' + esc(k) + '\\b'),
  ].join('|'))]);

const clean = (v) => (v == null ? '' : String(v).toLowerCase());
function groupOf(m) {
  // Every category the member carries counts, not just the primary one.
  const hay = [clean(m.category), (m.categories || []).map(clean).join(' '), clean(m.typeOfBusiness)]
    .join(' ').trim();
  // "Other" rather than the stored group — see the note in
  // scripts/import-directory-categories.py: keeping a value the taxonomy no
  // longer agrees with would preserve the old substring-matching mistakes.
  if (!hay) return 'Other';
  for (const [name, re] of GROUPS) if (re.test(hay)) return name;
  return 'Other';
}

const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const counts = {};
for (const m of doc.members) {
  m.group = groupOf(m);
  counts[m.group] = (counts[m.group] || 0) + 1;
  // build a small tags array for search if missing (category words)
  if (!m.tags) {
    const words = (clean(m.category) + ' ' + clean(m.typeOfBusiness)).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    m.tags = [...new Set(words)].slice(0, 8);
  }
}
doc._meta = { ...doc._meta, categorizedAt: new Date().toISOString(), groups: Object.keys(counts).length };
fs.writeFileSync(file, JSON.stringify(doc, null, 2));

console.log('group distribution (', Object.keys(counts).length, 'groups ):');
for (const [g, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${g}`);
