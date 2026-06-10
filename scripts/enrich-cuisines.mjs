/* Add cuisine keywords to restaurant members so Ask Wendy / directory search
   matches "French restaurant", "Italian restaurant", etc. High-confidence:
   only tags when a strong cuisine signal is in the name or existing keywords.
   Run: node scripts/enrich-cuisines.mjs */
import fs from 'node:fs';

const dir = JSON.parse(fs.readFileSync('data/directory.json', 'utf8'));
const members = dir.members || dir;
const kwPath = 'data/member-keywords.json';
const kw = JSON.parse(fs.readFileSync(kwPath, 'utf8'));

// cuisine -> strong signal (in name or existing keywords). Avoid weak signals
// like "la "/"le " that cause false positives.
const CUISINE = {
  french: /\b(bistro|brasserie|creperie|cr[eê]perie|patisserie|p[aâ]tisserie|french)\b/i,
  persian: /\b(persian|iranian|shiraz|tehran|kabob|kabab|kebab|saffron|caspian|shamshiri|attari)\b/i,
  italian: /\b(italian|trattoria|osteria|ristorante|pizzeria|pasta|cavaretta)\b/i,
  mexican: /\b(mexican|taqueria|cantina|taco|burrito|torito)\b/i,
  japanese: /\b(sushi|ramen|izakaya|japanese|teriyaki|hibachi)\b/i,
  thai: /\bthai\b/i,
  chinese: /\b(chinese|szechuan|sichuan|dim sum|mandarin|wok)\b/i,
  korean: /\b(korean|bbq korean|bulgogi|kimchi)\b/i,
  mediterranean: /\b(mediterranean|greek|falafel|hummus|shawarma|gyro|kabob grill)\b/i,
  indian: /\b(indian|tandoori|curry|masala|biryani)\b/i,
  brazilian: /\b(brazilian|churrascaria|fogo)\b/i,
  american: /\b(steakhouse|burger|bbq|barbecue|grill house|diner)\b/i,
};
const isRest = (m) => {
  const k = kw[m.id] || {};
  return /restaurant|dining|grill|cafe|caf[eé]|bistro|kitchen|eatery|cuisine|food/i
    .test((m.category || '') + ' ' + JSON.stringify(k.keywords || []));
};

let changed = 0; const log = [];
for (const m of members) {
  if (!isRest(m)) continue;
  const entry = kw[m.id] || (kw[m.id] = { keywords: [] });
  const list = Array.isArray(entry.keywords) ? entry.keywords : [];
  const blob = (m.name + ' ' + (m.category || '') + ' ' + (m.tagline || '') + ' ' + list.join(' ')).toLowerCase();
  const added = [];
  for (const [cui, re] of Object.entries(CUISINE)) {
    if (!re.test(blob)) continue;
    for (const tag of [cui, `${cui} restaurant`, `${cui} food`, `${cui} cuisine`]) {
      if (!list.some((x) => String(x).toLowerCase() === tag)) { list.push(tag); added.push(tag); }
    }
  }
  if (added.length) {
    if (!list.some((x) => String(x).toLowerCase() === 'restaurant')) list.push('restaurant');
    entry.keywords = list; changed++; log.push(`${m.name}: +${added.join(', ')}`);
  }
}
fs.writeFileSync(kwPath, JSON.stringify(kw, null, 0));
console.log(`enriched ${changed} restaurant members:`);
log.forEach((l) => console.log('  ' + l));
