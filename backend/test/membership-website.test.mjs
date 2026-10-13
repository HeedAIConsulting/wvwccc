/* Felicia, Oct 12 2026: "when members sign up they are not putting in their
   website information. Can you please make that a required field". Oct 13:
   "either add their website or type in/select no website".

   The application now requires a website or "We don't have a website"; the
   answer is kept on the application, carried to checkout and the receipt,
   and copied onto the member's listing when the office approves.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readWebsite, memberWebsite, NO_WEBSITE } from '../website-field.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
let server, base, repo;
const made = [];

before(async () => {
  mock.module('../email.js', {
    namedExports: {
      send: async () => ({ ok: true, id: 'test', provider: 'stub' }),
      notifyTo: () => 'felicia@woodlandhillscc.net',
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
    },
  });
  repo = await import('../repo.js');
  const express = (await import('express')).default;
  const routes = (await import('../chamber-routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // The repo has no lead delete; tests run on the local JSON store, so take
  // the test applications back out of it directly.
  if (made.length && !process.env.DATABASE_URL) {
    const store = await import('../store.js');
    const keep = (store.read('leads.json', []) || []).filter((l) => !made.includes(l.id));
    store.write('leads.json', keep);
  }
  server && server.close();
  mock.reset();
});

test('a website is tidied into a link; the "none" answers all mean No website', () => {
  assert.deepEqual(readWebsite('yourbusiness.com'), { ok: true, value: 'https://yourbusiness.com' });
  assert.deepEqual(readWebsite('www.Fogo.com/'), { ok: true, value: 'https://www.fogo.com' });
  assert.deepEqual(readWebsite('http://example.org/menu'), { ok: true, value: 'http://example.org/menu' });
  assert.equal(readWebsite('facebook.com/mybakery').value, 'https://facebook.com/mybakery');
  for (const none of ['none', 'N/A', 'na', 'No website']) assert.equal(readWebsite(none).value, NO_WEBSITE, none);
  assert.equal(readWebsite('', 'yes').value, NO_WEBSITE, 'the tick box');
  assert.equal(readWebsite('ignored.com', 'on').value, NO_WEBSITE, 'the tick box wins');
});

test('blank or nonsense is refused with a message that says what to do', () => {
  assert.equal(readWebsite('').ok, false);
  assert.match(readWebsite('   ').error, /We don’t have a website/);
  for (const bad of ['my website', 'localhost', 'abc', 'http://', 'bad..com']) assert.equal(readWebsite(bad).ok, false, bad);
});

test('the listing gets the address, or nothing for No website', () => {
  assert.equal(memberWebsite('https://x.com'), 'https://x.com');
  assert.equal(memberWebsite(NO_WEBSITE), '');
  assert.equal(memberWebsite(''), '');
});

const apply = (extra) => fetch(`${base}/api/contact`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    kind: 'membership-application', company: 'Website Test Bistro', firstName: 'Ana', lastName: 'Test',
    email: `website-test-${Date.now()}@example.com`, phone: '818-555-0100',
    address: '1 Test St', city: 'Woodland Hills', zip: '91367', businessType: 'Restaurant', employees: '4',
    ...extra,
  }),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function newestLead(company) {
  const leads = await repo.listLeads();
  return leads.filter((l) => l.company === company).sort((a, b) => String(b.received).localeCompare(String(a.received)))[0];
}

test('an application with no website and no tick is refused', async () => {
  const r = await apply({});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /website/i);
});

test('an application with a website keeps it, tidied, and it is not mistaken for spam', async () => {
  const r = await apply({ website: 'websitetestbistro.com', message: 'See our menu at https://websitetestbistro.com/menu' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const lead = await newestLead('Website Test Bistro');
  made.push(lead.id);
  assert.equal(lead.website, 'https://websitetestbistro.com');
  assert.notEqual(lead.status, 'spam', 'their own website is not a planted link');
});

test('ticking "We don\'t have a website" is accepted and recorded as No website', async () => {
  const r = await apply({ company: 'No Site Cafe', noWebsite: 'yes' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const lead = await newestLead('No Site Cafe');
  made.push(lead.id);
  assert.equal(lead.website, NO_WEBSITE);
  assert.match(lead.message, /Website: No website/);
});

test('the form asks for it in both languages, and checkout, receipt, approval and the office view carry it', () => {
  for (const rel of ['join.html', 'es/join.html']) {
    const page = read(rel);
    assert.match(page, /name="website"[^>]*required/, `${rel}: required website input`);
    assert.match(page, /name="noWebsite"/, `${rel}: no-website box`);
    assert.match(page, /website: payload\.noWebsite \? 'No website'/, `${rel}: handed to checkout`);
  }
  const chamber = read('js/chamber.js');
  assert.match(chamber, /website: fd\.get\('noWebsite'\) \? 'No website'/, 'checkout sends it');
  const routes = read('backend/chamber-routes.js');
  assert.match(routes, /row\('Website', order\.website\)/, 'receipt shows it');
  assert.match(routes, /website: memberWebsite\(lead\.website\)/, 'approval copies it to the listing');
  assert.match(read('admin/admin.js'), /item\('Website', l\.website/, 'the applicant view shows it');
});
