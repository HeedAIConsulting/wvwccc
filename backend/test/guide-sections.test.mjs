/* Dining and hospitality guides, Oct 2026: Dine West Valley by occasion,
   client lunch near Warner Center, the Holiday Party & Catering Guide, and
   Meeting Spaces & Business Lunches. They are the pages the restaurant
   membership drive links to, so a typo in guides.json is a dead link in an
   email that has already gone out.

   These guards keep the data honest: every guide slug is unique and URL-safe,
   every `related` slug points at a guide that exists, every section has a
   title and lists members by slug, and the four campaign guides are present.
   Member slugs themselves are checked against the live directory by the
   script that writes them, because the seed directory here is months older
   than production.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const { guides } = JSON.parse(readFileSync(new URL('data/guides.json', ROOT), 'utf8'));
const bySlug = new Map(guides.map((g) => [g.slug, g]));

test('guide slugs are unique and URL-safe', () => {
  assert.equal(bySlug.size, guides.length, 'duplicate slug in guides.json');
  for (const g of guides) assert.match(g.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, g.slug);
});

test('the four campaign guides are present', () => {
  for (const s of ['dine-west-valley', 'client-lunch-warner-center', 'holiday-parties-catering', 'meeting-spaces-business-lunches']) {
    assert.ok(bySlug.has(s), `missing guide ${s}`);
  }
});

test('related guides all exist and never point at themselves', () => {
  for (const g of guides) {
    for (const r of g.related || []) {
      assert.ok(bySlug.has(r), `${g.slug} relates to missing guide ${r}`);
      assert.notEqual(r, g.slug, `${g.slug} relates to itself`);
    }
  }
});

test('sections have a title, a unique id, and members listed by slug', () => {
  for (const g of guides) {
    if (!g.sections) continue;
    assert.ok(Array.isArray(g.sections) && g.sections.length, `${g.slug}: sections must be a non-empty array`);
    const ids = new Set();
    for (const s of g.sections) {
      assert.ok(s.title, `${g.slug}: a section has no title`);
      if (s.id) {
        assert.match(s.id, /^[a-z0-9-]+$/, `${g.slug}: bad section id ${s.id}`);
        assert.ok(!ids.has(s.id), `${g.slug}: duplicate section id ${s.id}`);
        ids.add(s.id);
      }
      assert.ok(Array.isArray(s.members), `${g.slug}/${s.title}: members must be an array`);
      for (const m of s.members) assert.match(m, /^[a-z0-9-]+$/, `${g.slug}/${s.title}: ${m} is not a member slug`);
      assert.ok(s.members.length || (s.categories || []).length, `${g.slug}/${s.title}: lists no members and no categories`);
    }
  }
});

test('a guide with sections and Spanish copy translates every section title', () => {
  for (const g of guides) {
    if (!g.sections || !g.title_es) continue;
    for (const s of g.sections) assert.ok(s.title_es, `${g.slug}/${s.title}: no title_es`);
  }
});

test('deal highlight patterns compile', () => {
  for (const g of guides) {
    if (g.deals && g.deals.highlight) assert.doesNotThrow(() => new RegExp(g.deals.highlight, 'i'), g.slug);
  }
});

test('the guide renderer sends Ask Wendy scope separately from the question', () => {
  const chamber = readFileSync(new URL('js/chamber.js', ROOT), 'utf8');
  const routes = readFileSync(new URL('backend/chamber-routes.js', ROOT), 'utf8');
  assert.match(chamber, /JSON\.stringify\(\{ q: q\.slice\(0, 400\), context: g\.ask\.context/);
  // The keyword fallback answer quotes `q`, so `context` must never be folded into it.
  assert.match(routes, /rankMembers\(all, context \? q \+ ' ' \+ context : q, 30\)/);
  assert.match(routes, /closest Chamber members for "\$\{q\}"/);
});

/* Covers and link previews (Oct 13 2026). A guide's `image` must be a real
   file, and the server must stamp that guide's own title, description and
   cover into the HTML, because social sites never run the page's JavaScript. */
import { existsSync, statSync } from 'node:fs';
import { stampGuideHtml, guideShareFields } from '../guide-meta.js';

test('every guide cover exists on disk', () => {
  for (const g of guides) {
    if (!g.image) continue;
    assert.match(g.image, /^\/images\/guides\/[a-z0-9-]+\.(jpg|png|webp)$/, g.slug);
    const f = new URL('.' + g.image, ROOT);
    assert.ok(existsSync(f), `${g.slug}: ${g.image} is missing`);
    assert.ok(statSync(f).size > 10_000, `${g.slug}: ${g.image} looks empty`);
  }
});

test('a guide page is stamped with its own share tags', () => {
  const page = '<html><head>\n<title>Community Guide</title>\n</head><body></body></html>';
  const g = bySlug.get('holiday-parties-catering');
  const out = stampGuideHtml(page, g, 'en', 'https://woodlandhillscc.net');
  assert.match(out, /<title>Holiday Party &amp; Catering Guide — West Valley · Warner Center Chamber of Commerce<\/title>/);
  assert.match(out, /property="og:image" content="https:\/\/woodlandhillscc\.net\/images\/guides\/holiday-parties-catering\.jpg"/);
  assert.match(out, /property="og:url" content="https:\/\/woodlandhillscc\.net\/guides\/holiday-parties-catering"/);
  assert.match(out, /name="twitter:card" content="summary_large_image"/);
  assert.equal((out.match(/<\/head>/g) || []).length, 1);
});

test('the Spanish page gets the Spanish title and URL, and quotes are escaped', () => {
  const g = { slug: 'x', title: 'A "quoted" <guide>', title_es: 'Guía', lede: 'L', lede_es: 'Resumen' };
  const es = guideShareFields(g, 'es', 'https://example.org');
  assert.equal(es.url, 'https://example.org/es/guides/x');
  assert.match(es.title, /^Guía — /);
  assert.equal(es.description, 'Resumen');
  const out = stampGuideHtml('<head><title>t</title></head>', g, 'en', 'https://example.org');
  assert.ok(!out.includes('<guide>'), 'raw markup leaked into the head');
  assert.match(out, /A &quot;quoted&quot; &lt;guide&gt;/);
  assert.match(out, /og:image" content="https:\/\/example\.org\/images\/wvwccc-logo\.png"/, 'no cover falls back to the seal');
});
