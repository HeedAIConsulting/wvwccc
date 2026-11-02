/* ============================================================
   Explore: one search across the community guides, their sections and the
   member directory (Nov 2026).

   Michael asked for the hospitality guides to be searchable and for Wendy to
   be "a real guide": someone asking where to hold a birthday, or who does
   flowers for a wedding, should land on the right guide section and the
   member businesses in it, and be offered the Chamber's referral request when
   they are planning something. The /explore.html hub, Ask Wendy on every page
   and the site-wide voice agent all call this, so they agree.

   Pure functions over plain data; the route in chamber-routes.js supplies the
   guides and the public member list.
   ============================================================ */

const STOP = new Set(('a an and any are am as at be been by can could did do does for find from get go going has have help '
  + 'i if in into is it its looking me my near need of on or our please some something somewhere that the them there they '
  + 'this to us want we what when where which who will with would you your best good great place places west valley woodland '
  + 'hills warner center tarzana').split(' '));

/* Everyday words → the words the guides and the directory actually use. A
   visitor says "DJ", a member is filed under "Music"; a visitor says
   "quinceañera", the guide says "party". Kept small and literal. */
const SYNONYMS = {
  wedding: 'venue party event catering florist flowers photography rentals', weddings: 'wedding',
  birthday: 'party kids birthday', bday: 'birthday', quince: 'party venue', quinceanera: 'party venue',
  shower: 'party', anniversary: 'celebrate party', graduation: 'party', reunion: 'party venue', gala: 'event venue',
  fundraiser: 'event venue', mitzvah: 'party venue', celebration: 'celebrate party', celebrating: 'celebrate party',
  parties: 'party', events: 'event',
  dj: 'music entertainment', band: 'music entertainment', musician: 'music', singer: 'music entertainment',
  entertainer: 'entertainment', magician: 'entertainment',
  photographer: 'photography photos', photographers: 'photographer', photo: 'photography photos', photos: 'photography',
  video: 'video production', videographer: 'video production',
  flowers: 'florist flowers', florist: 'flowers', balloons: 'balloon', decor: 'rentals balloon florist',
  decorations: 'decor', tables: 'rentals', chairs: 'rentals', tent: 'rentals', tents: 'rentals', rental: 'rentals',
  caterer: 'catering', caterers: 'catering', cater: 'catering', food: 'catering restaurant',
  cake: 'bakery treats', cakes: 'cake', cookies: 'bakery treats', dessert: 'treats', desserts: 'treats', sweets: 'treats',
  'ice': 'frozen', yogurt: 'frozen treats', acai: 'treats',
  eat: 'restaurant dining', dinner: 'restaurant dining dinner', lunch: 'restaurant lunch', brunch: 'restaurant',
  breakfast: 'restaurant coffee', restaurants: 'restaurant', dining: 'restaurant', drinks: 'happy hour', bar: 'happy hour',
  coffee: 'coffee', tea: 'coffee tea', prom: 'party',
  sushi: 'restaurant', pizza: 'restaurant', steak: 'restaurant', steakhouse: 'restaurant', italian: 'restaurant',
  mexican: 'restaurant', mediterranean: 'restaurant', burgers: 'restaurant', tacos: 'restaurant', brazilian: 'restaurant',
  hotel: 'hotel stay', hotels: 'hotel', motel: 'hotel', stay: 'hotel stay', lodging: 'hotel stay', rooms: 'hotel',
  visiting: 'stay visitor', visitors: 'visitor', 'out-of-town': 'stay',
  limo: 'limousine', limousine: 'rides transportation', shuttle: 'transportation rides', transportation: 'rides',
  ride: 'rides', rides: 'transportation',
  invitations: 'print', printing: 'print', signs: 'print', swag: 'promotional', favors: 'promotional print', gifts: 'gifts',
  kids: 'family kids', kid: 'kids', children: 'kids family', family: 'family', grandparents: 'family',
  fun: 'activities entertainment', activities: 'activities', bowling: 'bowling', golf: 'golf',
  team: 'team company', teambuilding: 'team outing activities', outing: 'team outing activities', offsite: 'meeting offsite',
  office: 'company office', company: 'company corporate', corporate: 'company', coworkers: 'team',
  meeting: 'meeting', meetings: 'meeting', conference: 'meeting', retreat: 'meeting offsite hotel',
  venue: 'venue venues', venues: 'venue', hall: 'venue', ballroom: 'venue', banquet: 'venue',
  planner: 'planners planning', planners: 'planner', coordinator: 'planner', cleanup: 'cleaning', cleaning: 'cleanup',
};

export function words(q) {
  return String(q || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9-]+/).map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w));
}
// The visitor's words plus their everyday-word expansions, de-duplicated.
export function expand(q) {
  const out = [];
  const add = (w) => { if (w && !out.includes(w)) out.push(w); };
  for (const w of words(q)) {
    add(w);
    for (const x of String(SYNONYMS[w] || '').split(' ')) {
      add(x);
      for (const y of String(SYNONYMS[x] || '').split(' ')) add(y);
    }
  }
  return out.filter(Boolean);
}

const rx = (w) => new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (w.length > 3 ? '' : '\\b'));
// Score of one piece of text against the words: whole word or, for longer
// words, a word that starts with it ("photo" finds "photography").
function hit(text, list, weight) {
  const t = String(text || '').toLowerCase();
  if (!t) return 0;
  let s = 0;
  for (const w of list) if (rx(w).test(t)) s += weight;
  return s;
}

const catsOf = (m) => [m.category].concat(m.categories || []).filter(Boolean).map((c) => String(c).toLowerCase());

// Members a guide section actually shows: its listed slugs that still resolve,
// then anyone filed under one of its categories. Mirrors renderGuideSections.
export function sectionMembers(sec, members) {
  const bySlug = new Map(members.filter((m) => m.slug).map((m) => [m.slug, m]));
  const seen = new Set();
  const out = [];
  for (const s of sec.members || []) { const m = bySlug.get(s); if (m && !seen.has(m.id)) { seen.add(m.id); out.push(m); } }
  const cats = new Set((sec.categories || []).map((c) => String(c).toLowerCase()));
  if (cats.size) for (const m of members) if (!seen.has(m.id) && catsOf(m).some((c) => cats.has(c))) { seen.add(m.id); out.push(m); }
  return out;
}

/* Guides and guide sections that fit the question, best first. The visitor's
   own words count double their expansions, so "wedding flowers" puts the
   flowers section above every section that merely mentions a party. */
export function searchGuides(guides, members, q, { limitGuides = 4, limitSections = 6 } = {}) {
  const own = words(q);
  const all = expand(q);
  const extra = all.filter((w) => !own.includes(w));
  if (!all.length) return { guides: [], sections: [] };
  const score = (fields) => fields.reduce((s, [text, wt]) => s + hit(text, own, wt * 2) + hit(text, extra, wt), 0);
  const gs = [];
  const ss = [];
  for (const g of guides || []) {
    const gScore = score([[g.title, 6], [g.lede, 3], [g.kicker, 2], [g.intro, 1], [(g.keywords || []).join(' '), 4],
      [(g.categories || []).join(' '), 3], [g.ask && g.ask.context, 3]]);
    let best = 0;
    for (const sec of g.sections || []) {
      const sScore = score([[sec.title, 6], [sec.blurb, 3], [(sec.categories || []).join(' '), 4]]);
      if (!sScore) continue;
      const n = members ? sectionMembers(sec, members).length : 1;
      if (!n) continue;
      best = Math.max(best, sScore);
      ss.push({ slug: g.slug, sectionId: sec.id, title: sec.title, title_es: sec.title_es, guideTitle: g.title,
        guideTitle_es: g.title_es, emoji: g.emoji || '', count: n, url: `/guides/${g.slug}#${sec.id}`, score: sScore + gScore / 4 });
    }
    const total = gScore + best / 2;
    if (total > 0) gs.push({ slug: g.slug, title: g.title, title_es: g.title_es, emoji: g.emoji || '', lede: g.lede,
      lede_es: g.lede_es, url: `/guides/${g.slug}`, score: total });
  }
  gs.sort((a, b) => b.score - a.score);
  ss.sort((a, b) => b.score - a.score);
  return { guides: gs.slice(0, limitGuides), sections: ss.slice(0, limitSections) };
}

/* Is the visitor planning something the Chamber could help put together?
   Then Wendy and the hub offer the referral request, with the occasion and
   the services already ticked. Values match the boxes on referral.html. */
const OCCASIONS = [
  ['wedding', /\bwedding|bridal|engagement/],
  ['birthday', /birthday|\bbday|quince|sweet 16|mitzvah/],
  ['company', /company|corporate|office|team|holiday party|staff|employee|client appreciation|offsite|retreat/],
  ['family', /\bfamily|reunion|kids|grandparents|shower|graduation|anniversary/],
  ['fundraiser', /fundrais|gala|benefit|charity|nonprofit/],
  ['meeting', /meeting|conference|seminar|workshop/],
  ['stay', /hotel|room block|lodging|out[- ]of[- ]town|stay/],
];
const NEEDS = [
  ['venue', /venue|hall|ballroom|banquet|space|room for|where to (hold|have)|place to (hold|have)|country club/],
  ['catering', /cater|food|menu|buffet|appetizer|lunch for|dinner for/],
  ['desserts', /cake|dessert|cookie|sweet|treat|coffee cart|\btea\b/],
  ['planner', /planner|planning|coordinator|organi[sz]e/],
  ['rentals', /rental|tables|chairs|tent|linen|decor|balloon/],
  ['florist', /flower|florist|floral|centerpiece/],
  ['entertainment', /\bdj\b|band|music|entertain|magician|games|photo ?booth|performer/],
  ['photo', /photo(?!\s?booth)|video|camera/],
  ['transport', /limo|shuttle|transport|ride|bus\b/],
  ['printing', /invitation|print|sign|favor|swag|promotional|name tag|award/],
  ['lodging', /hotel|room block|lodging|stay/],
  ['cleaning', /clean/],
];
const PLANNING = /party|parties|wedding|birthday|\bbday|celebrat|\bevent|shower|quince|anniversar|\bgala|fundrais|reunion|graduation|mitzvah|banquet|reception|cater|venue|\bdj\b|\bband\b|photographer|planner|planning|team ?building|offsite|retreat|room block|rehearsal/;
export function referralFor(q) {
  const t = String(q || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!PLANNING.test(t)) return { suggest: false };
  const occasion = (OCCASIONS.find(([, re]) => re.test(t)) || [''])[0];
  const need = NEEDS.filter(([, re]) => re.test(t)).map(([k]) => k);
  const p = new URLSearchParams();
  if (occasion) p.set('occasion', occasion);
  if (need.length) p.set('need', need.join(','));
  const qs = p.toString();
  return { suggest: true, occasion, need, url: '/referral.html' + (qs ? '?' + qs : '') };
}
