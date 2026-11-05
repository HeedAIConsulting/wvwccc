/* Nov 2 2026, Michael: hospitality and event guides that are searchable and
   shareable, a referral request that reaches Felicia, the restaurant guide
   brought up to date, and Wendy as "a real guide" that points people at the
   right guide and the referral request. Plus the cards from the November
   Event Planning & Hospitality network meeting, added to its roster.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchGuides, referralFor, expand, sectionMembers } from '../explore.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const guides = JSON.parse(read('data/guides.json')).guides;
const bySlug = Object.fromEntries(guides.map((g) => [g.slug, g]));

// A small directory: one business per kind the tests ask about.
const M = (id, slug, name, category, categories) => ({ id, slug, name, category, categories: categories || [category] });
const members = [
  M('m1', 'woodland-warner-flowers', 'Woodland Warner Flowers', 'Florist'),
  M('m2', 'scott-detweiler-music', 'Scott Detweiler Music', 'Music'),
  M('m3', 'corbin-bowl', 'Corbin Bowl', 'Bowling Alley', ['Bowling Alley', 'Events Services']),
  M('m4', 'marriott-warner-center', 'Marriott Warner Center', 'Hotel / Motel'),
  M('m5', 'lady-fortunes', 'Lady Fortunes', 'Bakery'),
  M('m6', 'taomi-tea-n-treats', 'Taomi Tea N Treats', 'Member', ['Member', 'Coffee,Tea']),
  M('m7', 'ace-plumbing', 'Ace Plumbing', 'Plumbing'),
];

test('the four occasion guides exist, in both languages, and link each other', () => {
  for (const slug of ['plan-an-event-west-valley', 'family-fun-west-valley', 'company-parties-team-outings', 'where-to-stay-west-valley']) {
    const g = bySlug[slug];
    assert.ok(g, slug);
    for (const k of ['title_es', 'lede_es', 'intro_es', 'kicker_es']) assert.ok(g[k], `${slug}.${k}`);
    assert.ok(g.sections.length >= 5, `${slug} has its sections`);
    for (const s of g.sections) assert.ok(s.title_es && s.blurb_es, `${slug}#${s.id} Spanish`);
    for (const r of g.related) assert.ok(bySlug[r], `${slug} relates to ${r}`);
    assert.ok(g.ask && g.ask.context && g.ask.placeholder_es, `${slug} has a scoped Ask Wendy`);
  }
});

test('sections fill themselves from categories, so a new member appears without an edit', () => {
  const rentals = bySlug['plan-an-event-west-valley'].sections.find((s) => s.id === 'rentals');
  assert.deepEqual(sectionMembers(rentals, members).map((m) => m.slug), ['woodland-warner-flowers']);
  const joined = members.concat([M('m9', 'new-florist', 'New Florist', 'Florist')]);
  assert.ok(sectionMembers(rentals, joined).some((m) => m.slug === 'new-florist'));
});

test('the dining guide picks up the members it was missing', () => {
  const dine = bySlug['dine-west-valley'];
  assert.ok(dine.categories.includes('Frozen Dessert'), 'Tang & Java');
  const sec = Object.fromEntries(dine.sections.map((s) => [s.id, s]));
  assert.ok(sec.quick.members.includes('mcdonald-s') && sec.quick.members.includes('mcdonald-s-2'), 'both McDonald\'s, Victory and Ventura');
  assert.deepEqual(sec.drinks.categories, ['Wine Tasting / Wine Sales'], 'Whatever Vineyards');
  assert.ok(sec.treats && sec.treats.categories.includes('Frozen Dessert'));
  assert.ok(bySlug.shopping.categories.includes('Wine Retailer'), 'Total Wine');
});

test('the dining page reads every category a member is filed under', () => {
  const js = read('js/chamber.js');
  assert.match(js, /function isDining\(m\) \{\n\s+return \[m\.category\]\.concat\(m\.categories \|\| \[\]/);
  assert.match(js, /const dining = members\.filter\(isDining\);/);
  assert.ok(!/DINING_RE\.test\(m\.category \|\| ''\)/.test(js), 'no first-category-only test left');
});

test('a question lands on the guide section that fits it', () => {
  const top = (q) => searchGuides(guides, members, q).sections[0];
  assert.equal(top('wedding flowers').url, '/guides/plan-an-event-west-valley#rentals');
  assert.equal(top('a DJ for a quinceañera').url, '/guides/plan-an-event-west-valley#entertainment');
  assert.equal(searchGuides(guides, members, 'where to take the kids').guides[0].slug, 'family-fun-west-valley');
  assert.equal(searchGuides(guides, members, 'hotel for out-of-town guests').sections[0].sectionId, 'stay');
  // A section nobody fills is never offered: there is no cleaner in this directory.
  assert.ok(!searchGuides(guides, members, 'cleanup after the party').sections.some((s) => s.sectionId === 'cleanup'));
  assert.deepEqual(searchGuides(guides, members, '').sections, []);
});

test('everyday words reach the directory\'s own words', () => {
  assert.ok(expand('DJ').includes('music'));
  assert.ok(expand('quinceañera').includes('party'));
  assert.ok(expand('limo').includes('transportation'));
  assert.deepEqual(expand('the of in'), []);
});

test('planning something offers the referral request with the right boxes ticked', () => {
  const r = referralFor("DJ for my daughter's quinceañera");
  assert.equal(r.suggest, true);
  assert.equal(r.occasion, 'birthday');
  assert.deepEqual(r.need, ['entertainment']);
  assert.equal(r.url, '/referral.html?occasion=birthday&need=entertainment');
  assert.equal(referralFor('wedding flowers and a photographer').url, '/referral.html?occasion=wedding&need=florist%2Cphoto');
  // "team" is not "tea": a team outing does not ask for desserts.
  assert.deepEqual(referralFor('team building for 20 people').need, []);
  assert.equal(referralFor('sushi in Tarzana').suggest, false);
  assert.equal(referralFor('plumber in Reseda').suggest, false);
});

test('every occasion and service Wendy can tick is a real box on both referral pages', () => {
  const en = read('referral.html');
  const es = read('es/referral.html');
  const keys = (html, name) => [...html.matchAll(new RegExp(`name="${name}" data-key="([a-z]+)"`, 'g'))].map((m) => m[1]);
  const occ = (html) => [...html.matchAll(/data-key="([a-z]+)" value=/g)].map((m) => m[1]);
  const all = ['wedding flowers photographer venue cater cake planner tables dj limo invitation hotel cleanup',
    'birthday company fundraiser family meeting hotel stay'].join(' ');
  const r = referralFor('party ' + all);
  for (const k of r.need) { assert.ok(keys(en, 'need').includes(k), `en need ${k}`); assert.ok(keys(es, 'need').includes(k), `es need ${k}`); }
  for (const k of ['wedding', 'birthday', 'company', 'family', 'fundraiser', 'meeting', 'stay']) {
    assert.ok(occ(en).includes(k) && occ(es).includes(k), `occasion ${k}`);
  }
  // The office reads one language: the Spanish page sends the English values.
  const vals = (html) => [...html.matchAll(/name="need" data-key="[a-z]+" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(vals(es), vals(en));
  assert.match(es, /<html lang="es">/);
});

/* ── the routes ─────────────────────────────────────────────── */
let server, base, sent;
before(async () => {
  sent = [];
  mock.module('../email.js', {
    namedExports: {
      send: async (m) => { sent.push(m); return { ok: true, id: 'test', provider: 'stub' }; },
      notifyTo: () => 'felicia@woodlandhillscc.net',
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
    },
  });
  mock.module('../llm.js', {
    namedExports: { enabled: () => false, provider: () => 'none', complete: async () => '{}' },
  });
  const express = (await import('express')).default;
  const routes = (await import('../chamber-routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server && server.close(); mock.reset(); });

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/explore returns guide sections, public member fields and the referral offer', async () => {
  const r = await (await fetch(`${base}/api/explore?q=${encodeURIComponent('wedding venue')}`)).json();
  assert.ok(r.sections.some((s) => s.slug === 'plan-an-event-west-valley'), 'the event guide');
  assert.equal(r.referral.suggest, true);
  assert.ok(r.members.length > 0);
  for (const m of r.members) {
    assert.ok(m.url.startsWith('/members/'));
    assert.equal(m.email, undefined, 'no member email in a public search');
  }
  const empty = await (await fetch(`${base}/api/explore?q=`)).json();
  assert.deepEqual(empty.members, []);
});

test('Ask Wendy hands back guide links and the referral request with her answer', async () => {
  const r = await (await post('/api/concierge', { q: 'a photographer for my wedding' })).json();
  assert.ok(Array.isArray(r.sections) && r.sections.length, 'guide sections');
  assert.equal(r.referral.suggest, true);
  assert.match(r.referral.url, /^\/referral\.html\?occasion=wedding/);
  const plain = await (await post('/api/concierge', { q: 'plumber' })).json();
  assert.equal(plain.referral.suggest, false, 'a plumber is not an event');
});

test('a referral request reaches the office inbox; an ordinary inquiry still does not', async () => {
  sent.length = 0;
  const ok = await (await post('/api/contact', {
    kind: 'referral', reason: 'Referral request — Wedding or engagement', name: 'Ana Ruiz',
    email: 'ana@example.com', phone: '818-555-0100', message: 'OCCASION: Wedding or engagement\nLOOKING FOR: Flowers',
  })).json();
  assert.equal(ok.ok, true);
  await new Promise((r) => setTimeout(r, 150));
  const n = sent.find((m) => m.to === 'felicia@woodlandhillscc.net');
  assert.ok(n, 'the office is emailed');
  assert.equal(n.subject, 'Referral request — Wedding or engagement — Ana Ruiz');
  assert.equal(n.replyTo, 'ana@example.com');
  assert.ok(!sent.some((m) => m.to === 'ana@example.com'), 'nothing is mailed to the address typed in');

  sent.length = 0;
  await post('/api/contact', { kind: 'contact', name: 'Bo', email: 'bo@example.com', message: 'hello' });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sent.length, 0, 'INQUIRY_EMAILS is still off for everything else');
});

test('Admin → Inquiries files referral requests in their own section', () => {
  const a = read('admin/admin.js');
  assert.match(a, /if \(kind === 'ribbon-cutting' \|\| reason\.includes\('ribbon'\)\) return 'ribbon';\n\s+\/\/[^\n]*\n\s+if \(kind === 'referral'\) return 'referral';\n\s+if \(l\.event/);
  assert.match(a, /\['referral', '🤝 Referral requests'/);
});

/* ── the November network meeting ───────────────────────────── */
test('the network roster gains the people at the meeting, once each', async () => {
  // Imported here, after the mocks above, so the routes module loads once with them.
  const { HOSPITALITY_ROSTER, hospitalityRosterAdds } = await import('../chamber-routes.js');
  const live = {
    manager: { name: 'Monica Battisti', email: 'mbattisti@fogo.com' },
    members: [
      { name: 'Gary Huettinger', email: 'gary@ladyfortunes.com' },
      // Typed differently by the office, same address: still the same person.
      { name: 'Tawny G.', email: 'TAWNY@roomrite.io' },
      { name: 'Natalia Solis-Guerra', email: 'nguerra@doodycalls.com' },
    ],
  };
  const adds = hospitalityRosterAdds(live);
  assert.equal(adds.length, HOSPITALITY_ROSTER.length - 2, 'Gary and Tawny are already on it');
  assert.ok(!adds.some((p) => /Battisti/.test(p.name)), 'the manager is not a roster row');
  assert.ok(adds.every((p) => p.role === 'Member' && p.status === 'active' && p.source === 'admin'));
  assert.equal(new Set(adds.map((p) => p.id)).size, adds.length, 'unique ids');
  // Applied a second time (or after the office re-adds someone) it adds nobody.
  assert.deepEqual(hospitalityRosterAdds({ ...live, members: live.members.concat(adds) }), []);
  // Whoever manages the group is not added to its roster as well.
  assert.ok(!hospitalityRosterAdds({ manager: { name: 'Ron Rubin' }, members: [] }).some((p) => p.name === 'Ron Rubin'));
  // Matched by name even when the office typed no email.
  assert.ok(!hospitalityRosterAdds({ members: [{ name: 'ron  rubin' }] }).some((p) => p.name === 'Ron Rubin'));
});

test('the roster migration runs once and only ever adds', () => {
  const src = read('backend/chamber-routes.js');
  const fn = src.slice(src.indexOf('async function applyHospitalityRoster()'), src.indexOf('async function applyHospitalityRoster()') + 900);
  assert.match(fn, /const KEY = 'hospitalityRoster-20261102';/);
  assert.match(fn, /if \(await repo\.getSetting\(KEY\)\) return;/);
  assert.match(fn, /members: \(cur\.members \|\| \[\]\)\.concat\(adds\)/);
  assert.match(src, /await applyHospitalityRoster\(\);\n  await applyHospitalityRosterFix\(\);\n/);
});

test('upcoming events for the voice agent: approved, on the calendar, in the window, in order', async () => {
  const { upcomingEvents } = await import('../chamber-routes.js');
  const ev = (id, date, extra = {}) => ({ id, title: id, date, ...extra });
  const list = upcomingEvents([
    ev('past', '2026-10-30'),
    ev('multi', '2026-10-31', { endDate: '2026-11-03' }),
    ev('later', '2026-11-20', { time: '6:00 PM' }),
    ev('soon', '2026-11-05'),
    ev('pending', '2026-11-06', { status: 'pending' }),
    ev('hidden', '2026-11-07', { showOnCalendar: false }),
    ev('far', '2027-03-01'),
  ], '2026-11-02', 45);
  assert.deepEqual(list.map((e) => e.title), ['multi', 'soon', 'later']);
  assert.equal(list[1].url, '/events/view.html?id=soon');
  assert.ok(JSON.stringify(list).length < 2000, 'small');
});

test('the network roster is members only, and Amanda is Amanda Dickey', async () => {
  const { HOSPITALITY_ROSTER, hospitalityRosterFix, HOSPITALITY_NONMEMBER_IDS } = await import('../chamber-routes.js');
  // Every row but Tawny's (already on the roster by her own request) is a member.
  assert.deepEqual(HOSPITALITY_ROSTER.filter((p) => !p.memberId).map((p) => p.name), ['Tawny Goralnick']);
  assert.ok(HOSPITALITY_ROSTER.some((p) => p.name === 'Amanda Dickey'));
  // Production, where the first pass already added them:
  const live = [
    { id: 'gm-mvfms1bs3vk', name: 'Tawny Goralnick', memberId: null },
    { id: 'gm-hosp-linda-campanella', name: 'Linda Campanella', memberId: null },
    { id: 'gm-hosp-lacey', name: 'Lacey', memberId: null },
    { id: 'gm-hosp-alex-asencio', name: 'Alex Asencio', memberId: null },
    { id: 'gm-hosp-alice-roth', name: 'Alice Roth', memberId: null },
    { id: 'gm-hosp-amanda-sajcy', name: 'Amanda Sajcy', memberId: 'm14965', email: '' },
    { id: 'gm-hosp-rob-dickey', name: 'Rob Dickey', memberId: 'm14965' },
  ];
  const { members, changed } = hospitalityRosterFix(live);
  assert.equal(changed, 5);
  assert.deepEqual(members.map((m) => m.name), ['Tawny Goralnick', 'Amanda Dickey', 'Rob Dickey'], 'the office\'s own rows stay');
  assert.equal(members[1].email, 'amanda@allvalleypartyrentals.com');
  // Linked to a listing since (she joined): kept. Renamed by the office: kept as they wrote it.
  const after = hospitalityRosterFix([{ id: 'gm-hosp-linda-campanella', name: 'Linda Campanella', memberId: 'm-new' }, { id: 'gm-hosp-amanda-sajcy', name: 'Amanda D.' }]);
  assert.equal(after.changed, 0);
  assert.equal(HOSPITALITY_NONMEMBER_IDS.length, 4);
});
