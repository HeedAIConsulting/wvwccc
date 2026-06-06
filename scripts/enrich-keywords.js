#!/usr/bin/env node
/* AI keyword enrichment for member recommendations.
   For each member, generate concise search keywords + a neutral 1-sentence
   description (no invented claims). Batched (15/call) via Gemini, resumable.
   Output: data/member-keywords.json  { id: { keywords:[], description:"" } }  (committed)
   Run: node scripts/enrich-keywords.js            (uses GEMINI_API_KEY from .env.local) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// load .env.local so GEMINI_API_KEY is available to llm.js
try {
  const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* rely on ambient env */ }

const llm = await import('../backend/llm.js');

const dir = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'directory.json'), 'utf8'));
const members = Array.isArray(dir) ? dir : (dir.members || dir.directory || []);
const OUT = path.join(ROOT, 'data', 'member-keywords.json');
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

const todo = members.filter((m) => !done[m.id]);
console.log(`members: ${members.length} | already enriched: ${Object.keys(done).length} | to do: ${todo.length} | provider: ${llm.provider()}`);

const SYSTEM = 'You tag Chamber of Commerce member businesses to power a recommendation search. '
  + 'For each business, output lowercase search KEYWORDS (6-12 services/products/specialties a person might search for) '
  + 'and a neutral one-sentence description (<=160 chars). Use ONLY the given name/category/tagline — do NOT invent '
  + 'awards, superlatives, or specific facts. If unsure, keep keywords general to the category. '
  + 'Return ONLY a JSON array: [{"id":"...","keywords":["..."],"description":"..."}].';

const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const batches = chunk(todo, 12);
let saved = 0;

for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  const prompt = 'Businesses:\n' + batch.map((m, i) =>
    `${i + 1}. id=${m.id} | name="${(m.name || '').replace(/"/g, '')}" | category="${m.category || ''}" | tagline="${(m.tagline || '').replace(/"/g, '').slice(0, 120)}"`).join('\n');
  try {
    const raw = await llm.complete({ system: SYSTEM, prompt, json: true, maxTokens: 4000 });
    let arr = [];
    try { arr = JSON.parse(String(raw).replace(/```json|```/g, '')); }
    catch (e) { const mm = /\[[\s\S]*\]/.exec(raw); if (mm) { try { arr = JSON.parse(mm[0]); } catch (_) { console.error('  parse fail:', String(raw).slice(0, 120)); } } }
    for (const it of (arr || [])) {
      if (!it || !it.id) continue;
      done[it.id] = {
        keywords: Array.isArray(it.keywords) ? it.keywords.slice(0, 12).map((k) => String(k).toLowerCase().slice(0, 30)) : [],
        description: String(it.description || '').slice(0, 200),
      };
      saved++;
    }
    fs.writeFileSync(OUT, JSON.stringify(done, null, 2));
    console.log(`batch ${b + 1}/${batches.length} → +${(arr || []).length} (total ${Object.keys(done).length})`);
  } catch (e) {
    console.error(`batch ${b + 1} failed: ${e.message} — saved progress, continue next run`);
  }
}
console.log(`\nDone. Enriched ${Object.keys(done).length}/${members.length} → data/member-keywords.json (${saved} this run)`);
