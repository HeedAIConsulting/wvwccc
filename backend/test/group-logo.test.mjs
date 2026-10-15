/* Marcia Israel, Oct 1 2026: "For leader groups. Don't see a place to upload
   pictures." Oct 15: the Valley Senior Resource Network logo, inside a Word
   file, "Not sure how to size for the chamber website".

   There was nowhere for it. A group had a banner photo, which is cropped to
   fill a strip on the group card and darkened under the white title on the
   group page, so lettering on white comes out cut and grey; and only the
   office could set even that.

   A group now has its own logo, shown whole on white on its card and in a
   white tile on its page. The office sets it under Admin -> Groups and the
   group's own leader sets it on Manage group. VSRN's arrives by a one-time
   migration that only fills an empty slot.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import bcrypt from 'bcryptjs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

let server, base, cookie, groupLogoUrl;
const T = Date.now().toString(36);
const ADMIN = `office-gl-${T}@test.woodlandhillscc.net`;
let gid = '', slug = '';

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Test Office`;
  mock.module('../email.js', {
    namedExports: {
      send: async () => ({ ok: true, id: 'test', provider: 'stub' }),
      notifyTo: () => 'felicia@woodlandhillscc.net',
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
    },
  });
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const mod = await import('../chamber-routes.js');
  groupLogoUrl = mod.groupLogoUrl;
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', mod.default);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN, password: 'test-passcode-1' }),
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  // A throwaway group this login manages, so it can act as the group's leader.
  const r = await adm('/api/admin/groups', { method: 'POST', body: JSON.stringify({
    name: `Logo Test Group ${T}`, tagline: 'test', manager: { name: 'Test Leader', email: ADMIN },
    logo: '/images/groups/vsrn-logo.png',
  }) });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  gid = j.group.id; slug = j.group.slug;
});

after(async () => {
  if (gid) await adm(`/api/admin/groups/${encodeURIComponent(gid)}`, { method: 'DELETE' }).catch(() => {});
  server && server.close();
  mock.reset();
});

const pub = async () => (await (await fetch(`${base}/api/groups/${encodeURIComponent(slug)}`)).json()).group;
const lead = (body) => adm(`/api/me/group/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(body) });

test('only our own image paths are kept as a logo', () => {
  assert.equal(groupLogoUrl('/images/groups/vsrn-logo.png'), '/images/groups/vsrn-logo.png');
  assert.equal(groupLogoUrl('/api/assets/asset-mgx2k9a1b2'), '/api/assets/asset-mgx2k9a1b2');
  for (const bad of ['javascript:alert(1)', 'https://evil.example/x.png', '//evil.example/x.png',
    '/images/../server.js', '/images/../../private/x.png', 'https://evil.example/images/x.png', 'data:image/png;base64,AAAA', '/images/x.png" onerror="alert(1)', '/admin/index.html']) {
    assert.equal(groupLogoUrl(bad), '', bad);
  }
});

test('the office sets a logo and the public page gets it', async () => {
  assert.equal((await pub()).logo, '/images/groups/vsrn-logo.png');
});

test('a save that does not mention the logo leaves it alone', async () => {
  const r = await adm('/api/admin/groups', { method: 'POST', body: JSON.stringify({
    id: gid, name: `Logo Test Group ${T}`, tagline: 'changed', manager: { name: 'Test Leader', email: ADMIN },
  }) });
  assert.equal(r.status, 200);
  assert.equal((await pub()).logo, '/images/groups/vsrn-logo.png');
  const notes = await lead({ meetingNotes: 'Third Monday' });
  assert.equal(notes.status, 200);
  assert.equal((await pub()).logo, '/images/groups/vsrn-logo.png', 'saving notes keeps the logo');
});

test('the group leader can set, replace and remove the logo', async () => {
  let r = await lead({ logo: '/api/assets/asset-abc123' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).group.logo, '/api/assets/asset-abc123');
  assert.equal((await pub()).logo, '/api/assets/asset-abc123');
  const mine = await (await adm(`/api/me/group/${encodeURIComponent(slug)}`)).json();
  assert.equal(mine.group.logo, '/api/assets/asset-abc123', 'the leader page sees the current logo');
  r = await lead({ logo: '' });
  assert.equal(r.status, 200);
  assert.equal((await pub()).logo, '');
});

test('a leader cannot point the logo somewhere else', async () => {
  const r = await lead({ logo: 'javascript:alert(document.cookie)' });
  assert.equal(r.status, 400);
  const r2 = await lead({ logo: 'https://tracker.example/pixel.png' });
  assert.equal(r2.status, 400);
});

test('the card and the page show the logo whole, not as the cropped banner', () => {
  const js = read('js/chamber.js');
  assert.match(js, /\$\{g\.logo\s*\n[^]*?group-card__media--logo"><img src="\$\{esc\(g\.logo\)\}"/, 'the card draws the logo as an image');
  assert.match(js, /logoEl && g\.logo\) \{ logoEl\.src = g\.logo;/, 'the group page shows it');
  assert.match(read('groups/view.html'), /<img id="gLogo" class="group-hero__logo" alt="" hidden>/);
  const css = read('css/chamber.css');
  assert.match(css, /\.group-card__media--logo img \{[^}]*object-fit: contain/);
  assert.match(css, /\.group-hero__logo \{[^}]*background: #fff/);
});

test('the leader and the office each have a way to upload it', () => {
  const m = read('member/member.js');
  assert.match(m, /id="gmLogoFile"/);
  assert.match(m, /saveGroupLogo\(await uploadImage\(f, 'logo'\)\)/);
  assert.match(m, /saveGroupLogo\(''\)/);
  assert.match(read('admin/groups.html'), /Upload group logo<input type="file" accept="image\/\*" hidden id="grpLogo">/);
  assert.match(read('admin/admin.js'), /body\.logo = logoUrl;/);
});

test("VSRN's logo is in place, sized, and only ever fills an empty slot", () => {
  const png = readFileSync(new URL('images/groups/vsrn-logo.png', ROOT));
  assert.equal(png.readUInt32BE(16), 600, 'width');
  assert.equal(png.readUInt32BE(20), 400, 'height');
  assert.ok(statSync(new URL('images/groups/vsrn-logo.png', ROOT)).size < 200_000);
  const seed = JSON.parse(read('data/groups.json'));
  const vsrn = (seed.groups || seed).find((g) => g.id === 'grp-valley-senior');
  assert.equal(vsrn.logo, '/images/groups/vsrn-logo.png', 'a fresh deployment gets it too');
  const src = read('backend/chamber-routes.js');
  const fn = src.slice(src.indexOf('async function applyVsrnLogo'), src.indexOf('async function applyVsrnLogo') + 900);
  assert.match(fn, /if \(await repo\.getSetting\(KEY\)\) return;/, 'runs once');
  assert.match(fn, /if \(cur && !cur\.logo\)/, 'never replaces a logo someone set');
  assert.match(src, /await applyVsrnLogo\(\);\n  return repo\.listGroupsStore\(\);/, 'wired into the group load');
});
