/* Diana, Sep 4 2026: "teach the ambassadors how to enter their activity on the
   tracker" — and the same day she sent Ambassador Tiers.xlsx, which opens:
   "These tiers describe the type and effort of the contribution—not the value
   of the person."

   Her five tiers are KINDS of work, not a ranking. Tiers 2, 3 and 4 happen at
   an event and the sign-up sheet already covers them. Tiers 1 and 5 do not
   happen at an event at all — a social post, a review for a member business, a
   Buddy check-in, a business referred — and there was nowhere to put them. An
   ambassador could not "enter their activity" for two of the five tiers
   because the tracker only knew about event shifts.

   /me/volunteer/log records one. The rules that matter: nobody scores
   themselves, the entry belongs to the person who made it, and it lands in the
   same tracker the office already reads.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie, memberCookie;
const T = Date.now().toString(36);
const ADMIN = `office-log-${T}@test.woodlandhillscc.net`;
const AMB_LOGIN = `amblog-${T}@example.com`;
const PW = 'log-passcode-3';
const AMBASSADOR = 'm12569';   // seeded ambassador; the committed seed is PII-free
const today = new Date().toISOString().slice(0, 10);
const made = [];

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
async function post(body, ck = memberCookie) {
  const r = await fetch(`${base}/api/me/volunteer/log`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ck },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function mine() {
  const r = await fetch(`${base}/api/me/volunteer`, { headers: { cookie: memberCookie } });
  const text = await r.text();               // read ONCE — a message argument is eager
  assert.equal(r.status, 200, text);
  return JSON.parse(text);
}

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

  await adm(`/api/admin/members/${AMBASSADOR}/create-login`, {
    method: 'POST', body: JSON.stringify({ email: AMB_LOGIN, sendInvite: false }),
  });
  await adm(`/api/admin/users/${encodeURIComponent(AMB_LOGIN)}/set-password`, {
    method: 'POST', body: JSON.stringify({ password: PW }),
  });
  const ml = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AMB_LOGIN, password: PW }),
  });
  assert.equal(ml.status, 200);
  memberCookie = (ml.headers.get('set-cookie') || '').split(';')[0];
});

after(async () => {
  // leave the shared dev store the way we found it
  for (const id of made) {
    await fetch(`${base}/api/me/volunteer/${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: { cookie: memberCookie } }).catch(() => {});
  }
  await adm(`/api/admin/members/${AMBASSADOR}/remove-login`,
    { method: 'POST', body: JSON.stringify({ email: AMB_LOGIN }) }).catch(() => {});
  server && server.close();
  mock.reset();
});

test('an ambassador logs a Tier 1 contribution that has no event', async () => {
  const r = await post({ tier: 'tier1', activity: 'Shared the breakfast post and tagged three members', date: today });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const list = (await mine()).mine.filter((v) => v.status === 'logged');
  const row = list.find((v) => v.role.startsWith('Shared the breakfast post'));
  assert.ok(row, 'the entry has to reach the same tracker the office reads');
  assert.equal(row.eventId || '', '', 'a social post belongs to no event — that is the whole point');
  assert.equal(row.eventTitle, 'Tier 1 — Connect & Promote', 'labelled with Diana’s own tier name');
  made.push(row.id);
});

test('nobody scores themselves — points sent by the member are ignored', async () => {
  const r = await post({ tier: 'tier5', activity: 'Buddy check-in with a new member', date: today, points: 999 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = (await mine()).mine.find((v) => v.role === 'Buddy check-in with a new member');
  assert.ok(row);
  assert.equal(row.points, 0, 'what a contribution is worth is the office’s call, not the ambassador’s');
  made.push(row.id);
});

test('a made-up tier is refused', async () => {
  const r = await post({ tier: 'tier9', activity: 'Something', date: today });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /kind of contribution/i);
});

test('an entry with nothing written in it is refused', async () => {
  const r = await post({ tier: 'tier1', activity: '   ', date: today });
  assert.equal(r.status, 400);
});

test('a future date is refused — log it after you have done it', async () => {
  const next = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const r = await post({ tier: 'tier3', activity: 'Helping at the gala', date: next });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /future/i);
});

test('the five tiers reach the portal so the form can offer them', async () => {
  const t = (await mine()).contributionTiers || [];
  assert.equal(t.length, 5);
  assert.deepEqual(t.map((x) => x.id), ['tier1', 'tier2', 'tier3', 'tier4', 'tier5']);
  assert.ok(t[4].track.includes('Buddy Report'),
    'the "What to Track" line is Diana’s and is what tells someone which detail is useful');
});

test('the 30-Day Challenge presets reach the portal, in Diana\u2019s order', async () => {
  const p = (await mine()).challengePresets || [];
  assert.equal(p.length, 8, 'eight items on page 12 of her deck, one for one');
  assert.match(p[0].label, /Attended a Chamber event/);
  assert.match(p[5].label, /Shared a Chamber or member post on social media/);
  assert.equal(p[5].tier, 'tier1', 'a social post is Connect & Promote');
  assert.equal(p[1].tier, 'tier5', 'welcoming a member is Grow & Retain');
  assert.equal(p[6].tier, '', 'learning the website maps to none of the five — no guessed tier');
  assert.equal(p[7].tier, '');
});

test('every preset tier that IS set names a real contribution tier', async () => {
  const r = await mine();
  const ids = new Set((r.contributionTiers || []).map((t) => t.id));
  for (const p of r.challengePresets || []) {
    if (p.tier) assert.ok(ids.has(p.tier), `preset ${p.id} points at a tier that does not exist: ${p.tier}`);
  }
});

test('a preset logs like anything else, and still scores zero', async () => {
  const r = await post({ tier: 'tier1', activity: 'Shared a Chamber or member post on social media', date: today });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = (await mine()).mine.find((v) => v.role === 'Shared a Chamber or member post on social media');
  assert.ok(row);
  assert.equal(row.points, 0);
  assert.equal(row.eventTitle, 'Tier 1 — Connect & Promote');
  made.push(row.id);
});

test('a signed-out visitor cannot log anything', async () => {
  const r = await fetch(`${base}/api/me/volunteer/log`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: 'tier1', activity: 'Not mine to add', date: today }),
  });
  assert.ok(r.status === 401 || r.status === 403, `expected a refusal, got ${r.status}`);
});

test('one ambassador cannot delete another persons entry', async () => {
  const r = await post({ tier: 'tier1', activity: 'Left a review for a member business', date: today });
  assert.equal(r.status, 200);
  const row = (await mine()).mine.find((v) => v.role === 'Left a review for a member business');
  made.push(row.id);
  // the office account has no member listing, so its "mine" is empty
  const bad = await fetch(`${base}/api/me/volunteer/${encodeURIComponent(row.id)}`,
    { method: 'DELETE', headers: { cookie } });
  assert.equal(bad.status, 404, 'deleting is scoped to the person who logged it');
});
