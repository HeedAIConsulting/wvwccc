/* Diana, Oct 13 2026, through the support form: "As Admin I need to either
   take down or update Biz Buzz under community. I cannot find on Dashboard or
   on backend." The page's stories were unlabelled rows in Admin → Content and
   the rest of it was hardcoded. Now one settings record, edited in Admin →
   Content → Biz Buzz page, drives the page, and a switch takes it down.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { BIZBUZZ_DEFAULT, BIZBUZZ_KEY, cleanBizBuzz } from '../bizbuzz.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const ADMIN = 'bizbuzz-test@wvwccc.test';
let server, base, cookie, repo, saved;

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Biz Buzz Test`;
  mock.module('../email.js', {
    namedExports: {
      send: async () => ({ ok: true, id: 'test', provider: 'stub' }),
      notifyTo: () => 'felicia@woodlandhillscc.net',
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
    },
  });
  repo = await import('../repo.js');
  saved = await repo.getSetting(BIZBUZZ_KEY);
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const routes = (await import('../chamber-routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN, password: 'test-passcode-1' }),
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
});

after(async () => {
  // Leave the local store as we found it.
  await repo.setSetting(BIZBUZZ_KEY, saved == null ? JSON.stringify(cleanBizBuzz({})) : saved);
  server && server.close();
  mock.reset();
});

test('the defaults are the copy the page already had, so nothing changes until the office edits it', () => {
  const page = read('community/news.html');
  assert.equal(cleanBizBuzz({}).hidden, false);
  assert.ok(page.includes(BIZBUZZ_DEFAULT.tagline.replace('&', '&amp;')), 'tagline');
  assert.ok(page.includes(BIZBUZZ_DEFAULT.podcastBlurb.replace('&', '&amp;')), 'podcast blurb');
  assert.ok(page.includes(BIZBUZZ_DEFAULT.newsletterBlurb), 'newsletter blurb');
});

test('bad input is cleaned, blank text falls back, long text is clipped', () => {
  const c = cleanBizBuzz({ hidden: 'true', tagline: '   ', storyMonths: 7, podcastBlurb: 'x'.repeat(900), showPodcast: false });
  assert.equal(c.hidden, true);
  assert.equal(c.tagline, BIZBUZZ_DEFAULT.tagline);
  assert.equal(c.storyMonths, 0, 'only 0, 3, 6 or 12 months');
  assert.equal(c.podcastBlurb.length, 300);
  assert.equal(c.showPodcast, false);
  assert.equal(c.showNewsletter, true, 'an omitted switch keeps its default');
  assert.equal(cleanBizBuzz(null).showStories, true);
});

test('only staff can change the page', async () => {
  const r = await fetch(`${base}/api/admin/bizbuzz-page`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: true }),
  });
  assert.ok([401, 403].includes(r.status), String(r.status));
});

test('what the office saves is what the public page reads', async () => {
  const save = await fetch(`${base}/api/admin/bizbuzz-page`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ tagline: 'Fresh from the Chamber office', storyMonths: 6, showNewsletter: false }),
  });
  assert.equal(save.status, 200);
  const { page } = await fetch(`${base}/api/bizbuzz-page`).then((r) => r.json());
  assert.equal(page.tagline, 'Fresh from the Chamber office');
  assert.equal(page.storyMonths, 6);
  assert.equal(page.showNewsletter, false);
  assert.equal(page.hidden, false);
});

test('taking the page down redirects its address, ahead of the static files', () => {
  const server = read('server.js');
  const route = server.indexOf("app.get(['/community/news.html', '/community/news', '/es/community/news.html', '/es/community/news']");
  assert.ok(route > 0, 'the take-down route exists');
  assert.ok(route < server.indexOf('app.use(express.static(__dirname'), 'it runs before the page file would be served');
  assert.match(server.slice(route, route + 700), /\.hidden\) return next\(\);[\s\S]*podcast\.html/);
});

test('the page is wired to the settings, and the stale hardcoded parts are gone', () => {
  for (const rel of ['community/news.html', 'es/community/news.html']) {
    const page = read(rel);
    for (const id of ['bizTagline', 'podcastBlurb', 'newsletterBlurb', 'bizEditions', 'podcast', 'newsletter']) {
      assert.ok(page.includes(`id="${id}"`), `${rel}: #${id}`);
    }
    assert.ok(!page.includes('const EDITIONS'), `${rel}: hardcoded edition list removed`);
    assert.ok(!/Valley Biz Buzz Newsletter|Boletín Valley Biz Buzz/i.test(page), `${rel}: the newsletter is Valley Biz Connect`);
  }
});

test('the office can find it: a Content panel, a dashboard shortcut and the task search', () => {
  assert.ok(read('admin/content.html').includes('id="bizBuzzPanel"'));
  assert.ok(read('admin/index.html').includes('content.html#bizBuzzPanel'));
  assert.match(read('admin/admin.js'), /t: 'Update or take down the Biz Buzz page'/);
});
