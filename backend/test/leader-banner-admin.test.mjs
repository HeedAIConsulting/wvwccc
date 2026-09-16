/* Felicia, Sep 16 2026: "I was trying to update a Logo that resides on the
   static leader banner at the bottom of the website but not seeing where to do
   that. I went in to the Marriott profile and updated it there thinking it
   would populate it but it didn't. Can you please create a Leader Level Banner
   page in admin so we can make updates there?"

   She did everything right. The banner renders leaderLogo || logo (js/chamber.js),
   and on the live site 36 of the 37 members on it carry a leaderLogo left over
   from the build — including Marriott Warner Center, whose leaderLogo still
   pointed at /images/leaders/leaders_36.jpg while the profile logo she had just
   uploaded sat unread. Nothing in Admin showed the field that was winning.

   So: the admin profile route accepts leaderLogo (admin-only, like boardTitle),
   an empty string clears it, and a page lists the banner with a way to replace
   or remove each one. Clearing is the half that matters — it hands the banner
   back to the member's own logo, which is the one the member keeps current.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

let server, base, cookie, memberId;
const T = Date.now().toString(36);
const ADMIN = `banner-admin-${T}@test.woodlandhillscc.net`;
const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
const publicMember = async (id) => ((await (await fetch(`${base}/api/members`)).json()).members || [])
  .find((m) => m.id === id);

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Banner Test`;
  mock.module('../email.js', {
    namedExports: {
      send: async () => ({ ok: true, id: 'test', provider: 'stub' }),
      notifyTo: () => 'felicia@woodlandhillscc.net',
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
    },
  });
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const routes = (await import('../chamber-routes.js')).default;
  const app = express();
  app.set('trust proxy', 1);
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
  assert.equal(login.status, 200);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  const members = (await (await adm('/api/admin/members')).json()).members || [];
  const pick = members.find((m) => m.id && m.name);
  assert.ok(pick, 'the seed roster should have somebody to test with');
  memberId = pick.id;
});

after(async () => {
  // Put the borrowed member back the way it was found.
  if (memberId) await adm(`/api/admin/members/${encodeURIComponent(memberId)}/profile`, {
    method: 'PATCH', body: JSON.stringify({ leaderLogo: '' }),
  }).catch(() => {});
  server && server.close();
  mock.reset();
});

test('the office can set a banner logo', async () => {
  const r = await adm(`/api/admin/members/${encodeURIComponent(memberId)}/profile`, {
    method: 'PATCH', body: JSON.stringify({ leaderLogo: '/api/assets/asset-banner-test' }),
  });
  assert.equal(r.status, 200, await r.text());
  assert.equal((await publicMember(memberId)).leaderLogo, '/api/assets/asset-banner-test');
});

test('and clear it, which is what hands the banner back to the profile logo', async () => {
  const r = await adm(`/api/admin/members/${encodeURIComponent(memberId)}/profile`, {
    method: 'PATCH', body: JSON.stringify({ leaderLogo: '' }),
  });
  assert.equal(r.status, 200);
  const m = await publicMember(memberId);
  assert.ok(!m.leaderLogo, 'an empty override must be falsy, so leaderLogo || logo falls through');
});

test('a scheme that is not a picture is refused, not stored', async () => {
  await adm(`/api/admin/members/${encodeURIComponent(memberId)}/profile`, {
    method: 'PATCH', body: JSON.stringify({ leaderLogo: 'javascript:alert(1)' }),
  });
  assert.ok(!(await publicMember(memberId)).leaderLogo);
  await adm(`/api/admin/members/${encodeURIComponent(memberId)}/profile`, {
    method: 'PATCH', body: JSON.stringify({ leaderLogo: 'data:text/html,<script>' }),
  });
  assert.ok(!(await publicMember(memberId)).leaderLogo);
});

test('a member cannot put a logo on the banner themselves', () => {
  // Same reasoning as boardTitle: the wall is the Chamber's, not the member's,
  // so leaderLogo is read off the request in the ADMIN route only and never
  // from the shared sanitizer the member self-edit also runs through.
  const routes = read('backend/chamber-routes.js');
  const at = routes.indexOf("router.patch('/admin/members/:id/profile'");
  assert.match(routes.slice(at, at + 1600), /leaderLogo is ADMIN-ONLY/);

  const sAt = routes.indexOf('function sanitizeProfile(b)');
  const sanitize = routes.slice(sAt, routes.indexOf('\n}', sAt));
  assert.ok(!/leaderLogo/.test(sanitize),
    'the moment sanitizeProfile knows the field, a member can set it on themselves');
  assert.ok(!/'leaderLogo'/.test(routes.slice(routes.indexOf('MEMBER_STR_FIELDS'), routes.indexOf('MEMBER_STR_FIELDS') + 500)),
    'and it must not be an ordinary editable string field either');
});

test('the page exists, is on the menu, and is findable in the Guide', () => {
  const html = read('admin/leader-banner.html');
  assert.match(html, /Admin\.initLeaderBanner\(\)/);
  assert.match(html, /Leader Level Banner/);

  const admin = read('admin/admin.js');
  assert.match(admin, /href: 'leader-banner\.html'[^}]*label: 'Leader Banner'/,
    'a page nobody can find is the problem we just fixed');
  assert.match(admin, /id: 'leader-banner'[\s\S]{0,400}href: 'leader-banner\.html'/,
    'and the ❔ Guide should answer "leader banner logo"');
});

test('the page shows which field the banner is actually reading', () => {
  const admin = read('admin/admin.js');
  const at = admin.indexOf('async function initLeaderBanner');
  const fn = admin.slice(at, admin.indexOf('async function initSponsorships'));
  assert.match(fn, /m\.leaderLogo \|\| m\.logo \|\| \(m\.photos && m\.photos\[0\]\)/,
    'it must mirror what the public banner does, or it will lie about what is showing');
  assert.match(fn, /banner logo/, 'and say when an override is what is winning');
  assert.match(fn, /data-lb-clear/, 'removing the override is the half that matters');
  /* Found in a browser, not in review: Bob Blumenfield carries a banner logo
     and has no profile logo, so "Use profile logo" would have taken him off the
     banner while promising the opposite. The button reads the fallback and
     changes both its label and its warning when there is nothing to fall back
     to. */
  assert.match(fn, /const fallbackOf = \(m\) => m\.logo \|\| \(m\.photos && m\.photos\[0\]\) \|\| ''/);
  assert.match(fn, /Remove from banner/, 'a member with no profile logo leaves the banner — say that');
  assert.match(fn, /they will disappear from it until a logo is uploaded/);
  assert.match(fn, /RANK = \{ platinum: 1, gold: 2, silver: 3, bronze: 4, supporter: 5, friend: 6 \}/,
    'listed in the order they appear on the banner');
});
