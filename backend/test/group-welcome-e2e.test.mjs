/* The group welcome email as the office actually sends it (Nov 5 2026):
   Admin → Groups → Manage → add a member from the directory → Save group.
   Martin Carman's Ambassador welcome said "Hi Computer," and linked to
   wvwccc-web.onrender.com. Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import http from 'node:http';

let server, base, cookie, savedSite;
const T = Date.now().toString(36);
const ADMIN = `office-gw-${T}@test.woodlandhillscc.net`;
const GROUP = 'grp-ambassador-committee';
const sent = [];
let original = null;

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
// fetch cannot set Host; the office's browser on the Render address sends this one.
const postAsRenderHost = (p, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const rq = http.request(base + p, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), cookie, host: 'wvwccc-web.onrender.com',
  } }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); });
  rq.on('error', reject); rq.end(data);
});

before(async () => {
  savedSite = { SITE_URL: process.env.SITE_URL, SITE_ORIGIN: process.env.SITE_ORIGIN };
  delete process.env.SITE_URL; delete process.env.SITE_ORIGIN;
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Test Office`;
  mock.module('../email.js', {
    namedExports: {
      send: async (m) => { sent.push(m); return { ok: true, id: 'test', provider: 'stub' }; },
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
});

after(async () => {
  if (original) await adm(`/api/admin/groups/${GROUP}/members`, { method: 'POST', body: JSON.stringify({ members: original }) });
  server && server.close();
  mock.reset();
  for (const [k, v] of Object.entries(savedSite)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

test('adding a directory member to a group welcomes the person, on the Chamber domain, from the leader', async () => {
  const groups = await (await adm('/api/admin/groups')).json();
  const g = (groups.groups || groups).find((x) => x.id === GROUP);
  assert.ok(g, 'the Ambassador Committee is in the seed');
  original = (g.members || []).slice();
  assert.match(g.meetingSchedule, /calendar/, 'the seed no longer says "30 minutes before each mixer"');

  const row = { id: 'gm-test-' + T, memberId: 'm10053', name: 'Computer Doctor, The', business: 'Computer Services',
    email: `martin-${T}@test.woodlandhillscc.net`, role: 'Ambassador', status: 'active', source: 'admin' };
  const r = await postAsRenderHost(`/api/admin/groups/${GROUP}/members`, { members: original.concat([row]) });
  assert.equal(r.status, 200, r.text);
  for (let i = 0; i < 40 && !sent.some((m) => m.to === row.email); i++) await new Promise((res) => setTimeout(res, 25));

  const mail = sent.find((m) => m.to === row.email);
  assert.ok(mail, 'a welcome email went out');
  assert.match(mail.text, /^Hi Martin,/);
  assert.match(mail.html, /Hi Martin,/);
  assert.equal(/Hi Computer/.test(mail.text + mail.html), false);
  assert.equal(/onrender\.com/.test(mail.text + mail.html), false, 'no link to the Render host');
  assert.match(mail.html, /href="https:\/\/woodlandhillscc\.net\/groups\/ambassador-committee"/);
  assert.match(mail.text, /The group meets monthly — check the calendar for each meeting date\./);
  assert.equal(/mixer starts/.test(mail.text), false);
  if (g.manager && g.manager.email) {
    assert.equal(mail.replyTo, g.manager.email);
    assert.equal(mail.fromName, g.manager.name);
  }
});
